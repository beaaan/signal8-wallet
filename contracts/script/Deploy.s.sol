// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../src/interfaces/IPlanModule.sol";
import {ISignalAttestor} from "../src/interfaces/ISignalAttestor.sol";
import {PlanModule} from "../src/PlanModule.sol";
import {PlanGuard} from "../src/PlanGuard.sol";
import {SignalAttestor} from "../src/SignalAttestor.sol";
import {LocalSafe} from "../src/LocalSafe.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockMMFVault} from "../src/mocks/MockMMFVault.sol";
import {FlowCreditLine} from "../src/mocks/FlowCreditLine.sol";
import {PaymentRouter} from "../src/mocks/PaymentRouter.sol";
import {MockSignalCover} from "../src/mocks/MockSignalCover.sol";
import {EvidenceRegistry} from "../src/mocks/EvidenceRegistry.sol";

/// @notice Deploys every contract, configures PlanModule from the plan book, mints demo balances and
///         writes deployments/<network>.json.
///
/// Local (anvil, chain 31337): uses anvil's public dev accounts unless overridden, deploys a LocalSafe and
/// enables the module with the owner's dev key.
///   anvil
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
/// Base Sepolia: needs SAFE_ADDRESS (the 2-of-3 Safe), DEPLOYER_PRIVATE_KEY and the role addresses
/// (AGENT_ADDRESS, GUARDIAN_ADDRESS, HKO_RELAYER_ADDRESS, GDACS_RELAYER_ADDRESS, DEMO_CLIENT_ADDRESS).
/// The owners then sign enableModule(PlanModule) in Safe Wallet; the script prints what to sign.
///
/// Plan parameters come from `npm run plan:hash` output (PLAN_PARAMS, default the example plan book's).
/// Rehearsing on an anvil fork of Base Sepolia keeps chain id 84532: set NETWORK=anvil-fork so the run does not
/// overwrite deployments/base-sepolia.json.
contract Deploy is Script {
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    uint256 internal constant USD = 1e6;

    struct Roles {
        address owner;
        address agent;
        address guardian;
        address hko;
        address gdacs;
        address nchmf;
        address client;
    }

    bool internal local;
    bytes32 internal region;
    string internal regionName;
    uint256 internal timeUnit;
    Roles internal roles;
    address internal safe;
    MockUSD internal usd;
    SignalAttestor internal attestor;
    MockMMFVault internal vault;
    FlowCreditLine internal credit;
    PaymentRouter internal router;
    MockSignalCover internal cover;
    EvidenceRegistry internal evidence;
    PlanModule internal module;
    PlanGuard internal guard;
    string internal params;

    function run() external {
        local = block.chainid == 31337;
        timeUnit = vm.envOr("TIME_UNIT", uint256(1));
        params = vm.readFile(vm.envOr("PLAN_PARAMS", string("../data/fixtures/plans/plan-params.example.json")));
        regionName = _region();
        region = keccak256(bytes(regionName));
        _checkParams();
        _roles();
        uint256 startBlock = block.number;

        vm.startBroadcast(_key("DEPLOYER_PRIVATE_KEY", 0));
        safe = local && bytes(vm.envOr("SAFE_ADDRESS", string(""))).length == 0
            ? address(new LocalSafe(roles.owner))
            : vm.envAddress("SAFE_ADDRESS");
        _deployContracts();
        _deployModule();
        guard = new PlanGuard(
            safe,
            timeUnit,
            _addrOr("MULTISEND_CALL_ONLY", 0x9641d764fc13c8B624c04430C7356C1C7C8102e2) // Safe v1.4.1 canonical
        );
        _mint();
        vm.stopBroadcast();

        if (local) {
            vm.startBroadcast(_key("OWNER_PRIVATE_KEY", 1));
            LocalSafe(payable(safe)).enableModule(address(module));
            vm.stopBroadcast();
        } else {
            console2.log("Owners must now sign, in Safe Wallet, a Safe transaction to the Safe itself:");
            console2.log("  enableModule(address)", address(module));
            console2.log("Optional, after testing on a throwaway Safe: setGuard(address)", address(guard));
        }

        _write(startBlock);
    }

    // ------------------------------------------------------------------ steps

    /// REGION from env, else the plan book's (plan:hash writes it); the two must agree when both are given.
    function _region() internal view returns (string memory r) {
        bool inParams = vm.keyExistsJson(params, ".region");
        string memory fromParams = inParams ? vm.parseJsonString(params, ".region") : "HK";
        r = vm.envOr("REGION", fromParams);
        require(
            !inParams || keccak256(bytes(r)) == keccak256(bytes(fromParams)),
            "REGION differs from the plan book's region"
        );
    }

    /// Both plans must store the plan book's hash, as the agent and /plan check it against the plan book.
    function _checkParams() internal view {
        bytes32 h = vm.parseJsonBytes32(params, ".planHash");
        require(
            vm.parseJsonBytes32(params, ".plans.base.planHash") == h &&
                vm.parseJsonBytes32(params, ".plans.storm.planHash") == h,
            "plan params: base and storm planHash must equal planHash"
        );
    }

    function _roles() internal {
        roles = Roles({
            // only the stand-in LocalSafe on anvil has an owner key here; on Base Sepolia the Safe already exists
            owner: local ? _addr("OWNER_ADDRESS", 1) : address(0),
            agent: _addr("AGENT_ADDRESS", 5),
            guardian: _addr("GUARDIAN_ADDRESS", 4),
            hko: _addr("HKO_RELAYER_ADDRESS", 6),
            gdacs: _addr("GDACS_RELAYER_ADDRESS", 7),
            nchmf: _addrOr("NCHMF_RELAYER_ADDRESS", address(0)),
            client: _addr("DEMO_CLIENT_ADDRESS", 8)
        });
        require(roles.hko != roles.gdacs && roles.hko != roles.nchmf && roles.gdacs != roles.nchmf, "relayers need separate keys");
    }

    function _deployContracts() internal {
        usd = new MockUSD();
        attestor = new SignalAttestor(
            vm.envOr("ATTESTOR_CHAIN_ID", block.chainid),
            timeUnit,
            safe,
            roles.hko,
            roles.gdacs,
            roles.nchmf
        );
        vault = new MockMMFVault(IERC20Metadata(address(usd)));
        credit = new FlowCreditLine(usd, safe, 50_000 * USD);
        router = new PaymentRouter(usd, safe, credit, ISignalAttestor(address(attestor)), region, 1000);
        cover = new MockSignalCover(usd, safe, 20_000 * USD, ISignalAttestor(address(attestor)), region);
        evidence = new EvidenceRegistry();
    }

    function _deployModule() internal {
        uint256 n;
        while (vm.keyExistsJson(params, string(abi.encodePacked(".payees[", vm.toString(n), "]")))) n++;
        PlanModule.PayeeInit[] memory payees = new PlanModule.PayeeInit[](n);
        for (uint256 i = 0; i < n; i++) {
            string memory p = string(abi.encodePacked(".payees[", vm.toString(i), "]"));
            payees[i] = PlanModule.PayeeInit(
                vm.parseJsonAddress(params, string(abi.encodePacked(p, ".address"))),
                uint8(vm.parseJsonUint(params, string(abi.encodePacked(p, ".planMask"))))
            );
        }
        module = new PlanModule(
            PlanModule.Config({
                safe: safe,
                token: address(usd),
                region: region,
                timeUnit: timeUnit,
                agent: roles.agent,
                guardian: roles.guardian,
                attestor: address(attestor),
                targets: PlanModule.Targets(address(vault), address(credit), address(cover), address(evidence)),
                basePlan: _plan(".plans.base"),
                stormPlan: _plan(".plans.storm"),
                dailyCeiling: vm.parseJsonUint(params, ".dailyCeiling"),
                payees: payees
            })
        );
    }

    function _plan(string memory k) internal view returns (IPlanModule.Plan memory) {
        return
            IPlanModule.Plan({
                perTxCap: vm.parseJsonUint(params, string(abi.encodePacked(k, ".perTxCap"))),
                dailyCap: vm.parseJsonUint(params, string(abi.encodePacked(k, ".dailyCap"))),
                creditCapPerEvent: vm.parseJsonUint(params, string(abi.encodePacked(k, ".creditCapPerEvent"))),
                actions: uint8(vm.parseJsonUint(params, string(abi.encodePacked(k, ".actions")))),
                active: vm.parseJsonBool(params, string(abi.encodePacked(k, ".active"))),
                planHash: vm.parseJsonBytes32(params, string(abi.encodePacked(k, ".planHash")))
            });
    }

    function _mint() internal {
        usd.mint(safe, 50_000 * USD);
        usd.mint(address(credit), 200_000 * USD);
        usd.mint(address(cover), 100_000 * USD);
        usd.mint(roles.client, 100_000 * USD);
    }

    function _write(uint256 startBlock) internal {
        string memory network = vm.envOr("NETWORK", local ? string("anvil") : string("base-sepolia"));
        string memory c = "contracts";
        vm.serializeAddress(c, "Safe", safe);
        vm.serializeAddress(c, "PlanModule", address(module));
        vm.serializeAddress(c, "PlanGuard", address(guard));
        vm.serializeAddress(c, "SignalAttestor", address(attestor));
        vm.serializeAddress(c, "MockUSD", address(usd));
        vm.serializeAddress(c, "MockSignalCover", address(cover));
        vm.serializeAddress(c, "FlowCreditLine", address(credit));
        vm.serializeAddress(c, "PaymentRouter", address(router));
        vm.serializeAddress(c, "MockMMFVault", address(vault));
        c = vm.serializeAddress(c, "EvidenceRegistry", address(evidence));

        string memory root = "root";
        vm.serializeString(root, "network", network);
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "startBlock", startBlock);
        vm.serializeString(root, "region", regionName);
        vm.serializeUint(root, "timeUnit", timeUnit);
        vm.serializeBytes32(root, "planHash", vm.parseJsonBytes32(params, ".planHash"));
        root = vm.serializeString(root, "contracts", c);
        string memory path = string(abi.encodePacked("deployments/", network, ".json"));
        vm.writeJson(root, path);
        console2.log("wrote", path);
    }

    // ------------------------------------------------------------------ env helpers

    /// A private key from env; on anvil, falls back to the public dev account at `index`.
    function _key(string memory name, uint32 index) internal view returns (uint256) {
        string memory v = vm.envOr(name, string(""));
        if (bytes(v).length > 0) return vm.parseUint(v);
        require(local, string(abi.encodePacked(name, " is required off anvil")));
        return vm.deriveKey(ANVIL_MNEMONIC, index);
    }

    /// An address from env; on anvil, falls back to the public dev account at `index`.
    function _addr(string memory name, uint32 index) internal view returns (address) {
        string memory v = vm.envOr(name, string(""));
        if (bytes(v).length > 0) return vm.parseAddress(v);
        require(local, string(abi.encodePacked(name, " is required off anvil")));
        return vm.addr(vm.deriveKey(ANVIL_MNEMONIC, index));
    }

    function _addrOr(string memory name, address otherwise) internal view returns (address) {
        string memory v = vm.envOr(name, string(""));
        return bytes(v).length > 0 ? vm.parseAddress(v) : otherwise;
    }
}

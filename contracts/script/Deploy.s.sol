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
import {MockVNDDeposit} from "../src/MockVNDDeposit.sol";
import {MockMMFVault} from "../src/mocks/MockMMFVault.sol";
import {FlowCreditLine} from "../src/mocks/FlowCreditLine.sol";
import {PaymentRouter} from "../src/mocks/PaymentRouter.sol";
import {MockSignalCover} from "../src/mocks/MockSignalCover.sol";
import {EvidenceRegistry} from "../src/mocks/EvidenceRegistry.sol";

/// @dev The two mock tokens (MockUSD, MockVNDDeposit) share this shape.
interface IMockToken is IERC20Metadata {
    function mint(address to, uint256 amount) external;
}

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
///
/// Local FISCO BCOS (Yagi, stretch; exact command in contracts/README.md): NETWORK=fisco, TOKEN=mVND (a mock
/// bank-issued VND deposit token instead of MockUSD), LOCAL_SAFE=true (the standalone wallet: a LocalSafe whose one
/// admin is OWNER_ADDRESS, module enabled with OWNER_PRIVATE_KEY; there is no Safe on FISCO), TIME_UNIT=1000 (FISCO's
/// block.timestamp is in milliseconds) and ATTESTOR_CHAIN_ID=20200 (what eth_chainId and CHAINID return there).
contract Deploy is Script {
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    uint256 internal constant USD = 1e6;
    /// @dev TOKEN=mVND sizes the mock balances, credit line and cover in dong at about 25,000 VND per US dollar, so
    ///      they keep the dollar demo's proportions. Sizing only, not an exchange rate.
    uint256 internal constant VND_SIZING = 25_000;

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
    bool internal localSafe; // deploy a LocalSafe: anvil, or LOCAL_SAFE=true (the standalone FISCO wallet)
    bytes32 internal region;
    string internal regionName;
    uint256 internal timeUnit;
    uint256 internal attestorChainId;
    uint256 internal unit; // one dollar (mUSD) or 25,000 dong (mVND), in token units
    string internal tokenKey; // "MockUSD" or "MockVNDDeposit": the token's key in deployments/<network>.json
    Roles internal roles;
    address internal safe;
    IMockToken internal usd;
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
        bool hasSafe = bytes(vm.envOr("SAFE_ADDRESS", string(""))).length > 0;
        bool standalone = vm.envOr("LOCAL_SAFE", false);
        require(!(standalone && hasSafe), "LOCAL_SAFE deploys its own wallet: unset SAFE_ADDRESS");
        localSafe = standalone || (local && !hasSafe);
        timeUnit = vm.envOr("TIME_UNIT", uint256(1));
        attestorChainId = vm.envOr("ATTESTOR_CHAIN_ID", block.chainid);
        _token();
        params = vm.readFile(vm.envOr("PLAN_PARAMS", string("../data/fixtures/plans/plan-params.example.json")));
        regionName = _region();
        region = keccak256(bytes(regionName));
        _checkParams();
        _roles();
        uint256 startBlock = block.number;

        vm.startBroadcast(_key("DEPLOYER_PRIVATE_KEY", 0));
        safe = localSafe ? address(new LocalSafe(roles.owner)) : vm.envAddress("SAFE_ADDRESS");
        _deployContracts();
        _deployModule();
        guard = new PlanGuard(
            safe,
            timeUnit,
            _addrOr("MULTISEND_CALL_ONLY", 0x9641d764fc13c8B624c04430C7356C1C7C8102e2) // Safe v1.4.1 canonical
        );
        _mint();
        vm.stopBroadcast();

        if (localSafe) {
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

    /// TOKEN: mUSD (default) or mVND, the mock bank-issued VND deposit token of the Vietnam (Yagi) deployment.
    function _token() internal {
        bytes32 t = keccak256(bytes(vm.envOr("TOKEN", string("mUSD"))));
        if (t == keccak256("mUSD")) {
            tokenKey = "MockUSD";
            unit = USD;
        } else if (t == keccak256("mVND")) {
            tokenKey = "MockVNDDeposit";
            unit = USD * VND_SIZING;
        } else {
            revert("TOKEN must be mUSD or mVND");
        }
    }

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
            // only a LocalSafe (anvil, or the standalone FISCO wallet) has an owner key here; on Base Sepolia the
            // Safe already exists
            owner: localSafe ? _addr("OWNER_ADDRESS", 1) : address(0),
            agent: _addr("AGENT_ADDRESS", 5),
            guardian: _addr("GUARDIAN_ADDRESS", 4),
            hko: _addr("HKO_RELAYER_ADDRESS", 6),
            gdacs: _addr("GDACS_RELAYER_ADDRESS", 7),
            // anvil: dev account 9, so a Yagi rehearsal (region VN-QN-HP) works with the agent's dev keys
            nchmf: _addrOr("NCHMF_RELAYER_ADDRESS", local ? vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 9)) : address(0)),
            client: _addr("DEMO_CLIENT_ADDRESS", 8)
        });
        require(roles.hko != roles.gdacs && roles.hko != roles.nchmf && roles.gdacs != roles.nchmf, "relayers need separate keys");
    }

    function _deployContracts() internal {
        usd = keccak256(bytes(tokenKey)) == keccak256("MockUSD")
            ? IMockToken(address(new MockUSD()))
            : IMockToken(address(new MockVNDDeposit()));
        attestor = new SignalAttestor(
            attestorChainId,
            timeUnit,
            safe,
            roles.hko,
            roles.gdacs,
            roles.nchmf
        );
        vault = new MockMMFVault(IERC20Metadata(address(usd)));
        credit = new FlowCreditLine(usd, safe, 50_000 * unit);
        router = new PaymentRouter(usd, safe, credit, ISignalAttestor(address(attestor)), region, 1000);
        cover = new MockSignalCover(usd, safe, 20_000 * unit, ISignalAttestor(address(attestor)), region);
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
        usd.mint(safe, 50_000 * unit);
        usd.mint(address(credit), 200_000 * unit);
        usd.mint(address(cover), 100_000 * unit);
        usd.mint(roles.client, 100_000 * unit);
    }

    function _write(uint256 startBlock) internal {
        // never default another chain to base-sepolia.json (a FISCO deploy without NETWORK would overwrite it)
        string memory fallbackName = local ? "anvil" : block.chainid == 84532 ? "base-sepolia" : "";
        string memory network = vm.envOr("NETWORK", fallbackName);
        require(bytes(network).length > 0, "set NETWORK (e.g. fisco) to name deployments/<network>.json");
        string memory c = "contracts";
        vm.serializeAddress(c, "Safe", safe);
        vm.serializeAddress(c, "PlanModule", address(module));
        vm.serializeAddress(c, "PlanGuard", address(guard));
        vm.serializeAddress(c, "SignalAttestor", address(attestor));
        vm.serializeAddress(c, tokenKey, address(usd));
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
        vm.serializeUint(root, "attestorChainId", attestorChainId);
        string memory t = "token";
        vm.serializeString(t, "contract", tokenKey);
        vm.serializeString(t, "symbol", usd.symbol());
        t = vm.serializeUint(t, "decimals", usd.decimals());
        vm.serializeString(root, "token", t);
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

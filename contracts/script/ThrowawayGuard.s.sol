// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Script, console2} from "forge-std/Script.sol";
import {ISafeV141, ISafeProxyFactoryV141, SafeV141} from "../src/interfaces/ISafeV141.sol";
import {PlanGuard} from "../src/PlanGuard.sol";
import {MockUSD} from "../src/MockUSD.sol";

/// @notice Live check of PlanGuard on a throwaway Safe (SECURITY.md known risk 7). Never touches the demo Safe.
///   1. creates a 1-of-1 Safe v1.4.1 (canonical SafeProxyFactory, SafeL2 singleton, CompatibilityFallbackHandler)
///      owned by the DEPLOYER_PRIVATE_KEY address;
///   2. deploys a PlanGuard bound to it and sets it with a Safe transaction the deployer signs;
///   3. sends one allowed Safe transaction through the guard: a MockUSD transfer back to the deployer (1 mUSD, minted
///      to the Safe first, when the deployer owns MockUSD; otherwise 0 mUSD, still a full guarded Safe transaction);
///   4. simulates, without broadcasting, two blocked ones (addOwnerWithThreshold, setGuard(address(0))) and requires
///      each to revert with PlanGuard.Blocked(selector);
///   5. writes deployments/<NETWORK>-throwaway-guard.json; `--sig "record()"` then adds the broadcast tx hashes.
///
///   source ../.env   # DEPLOYER_PRIVATE_KEY, BASE_SEPOLIA_RPC
///   forge script script/ThrowawayGuard.s.sol --rpc-url base_sepolia --broadcast --slow
///   forge script script/ThrowawayGuard.s.sol --sig "record()"
///
/// Rehearse on an anvil fork with NETWORK=anvil-fork (the fork keeps chain id 84532) so the real file is not
/// overwritten. Optional: MOCK_USD (default: deployments/base-sepolia.json), SALT_NONCE (default: block time).
contract ThrowawayGuard is Script {
    uint256 internal constant ONE_USD = 1e6;
    bytes4 internal constant GUARD_INTERFACE_ID = 0xe6d7a83a;
    /// address the blocked addOwnerWithThreshold tries to add: keccak256("signal8.throwaway-guard.attacker")
    address internal constant ATTACKER = address(uint160(uint256(keccak256("signal8.throwaway-guard.attacker"))));

    uint256 internal key;
    address internal deployer;
    ISafeV141 internal safe;
    PlanGuard internal guard;
    MockUSD internal usd;
    string internal steps; // comma-separated broadcast steps, in order, for record()

    function run() external {
        key = vm.parseUint(vm.envString("DEPLOYER_PRIVATE_KEY"));
        deployer = vm.addr(key);
        string memory network = vm.envOr("NETWORK", string("base-sepolia"));
        _requireSafeV141();
        usd = MockUSD(vm.envOr("MOCK_USD", vm.parseJsonAddress(vm.readFile("deployments/base-sepolia.json"), ".contracts.MockUSD")));
        require(address(usd).code.length > 0, "no MockUSD at MOCK_USD");
        bool canMint = usd.owner() == deployer;
        uint256 amount = canMint ? ONE_USD : 0;
        uint256 saltNonce = vm.envOr("SALT_NONCE", block.timestamp);
        uint256 startBlock = block.number;

        vm.startBroadcast(key);
        address[] memory owners = new address[](1);
        owners[0] = deployer;
        safe = ISafeV141(
            ISafeProxyFactoryV141(SafeV141.PROXY_FACTORY).createProxyWithNonce(
                SafeV141.SAFE_L2_SINGLETON,
                abi.encodeWithSelector(
                    ISafeV141.setup.selector,
                    owners,
                    1,
                    address(0),
                    bytes(""),
                    SafeV141.FALLBACK_HANDLER,
                    address(0),
                    0,
                    payable(address(0))
                ),
                saltNonce
            )
        );
        steps = "createSafe";
        guard = new PlanGuard(address(safe), 1, SafeV141.MULTI_SEND_CALL_ONLY);
        steps = string(abi.encodePacked(steps, ",deployGuard"));
        if (canMint) {
            usd.mint(address(safe), amount);
            steps = string(abi.encodePacked(steps, ",mint"));
        }
        // a guard bound to another Safe would lock this one (NotSafe on every transaction): check before setting
        require(guard.safe() == address(safe) && guard.supportsInterface(GUARD_INTERFACE_ID), "guard not bound to this Safe");
        bytes32 setGuardTx = _exec(address(safe), abi.encodeWithSelector(ISafeV141.setGuard.selector, address(guard)));
        steps = string(abi.encodePacked(steps, ",setGuard"));
        bytes32 allowedTx = _exec(address(usd), abi.encodeWithSelector(usd.transfer.selector, deployer, amount));
        steps = string(abi.encodePacked(steps, ",allowedTransfer"));
        vm.stopBroadcast();

        require(_guardOf() == address(guard), "guard not set");
        require(safe.getThreshold() == 1 && safe.getOwners().length == 1, "unexpected owners");

        // simulated only: the guard must refuse these without a matured queue entry
        bytes memory addOwner = _simulateBlocked(abi.encodeWithSelector(ISafeV141.addOwnerWithThreshold.selector, ATTACKER, 1));
        bytes memory removeGuard = _simulateBlocked(abi.encodeWithSelector(ISafeV141.setGuard.selector, address(0)));
        require(_guardOf() == address(guard) && safe.getOwners().length == 1, "blocked call changed the Safe");

        console2.log("throwaway Safe", address(safe));
        console2.log("PlanGuard", address(guard));
        console2.log("allowed MockUSD transfer through the guard, amount", amount);
        console2.log("blocked as expected (simulated, not broadcast): addOwnerWithThreshold, setGuard(address(0))");

        _write(network, startBlock, saltNonce, amount, setGuardTx, allowedTx, addOwner, removeGuard);
    }

    /// Adds the broadcast tx hashes (broadcast/ThrowawayGuard.s.sol/<chainId>/run-latest.json) to the deployments file.
    function record() external {
        string memory path = _path(vm.envOr("NETWORK", string("base-sepolia")));
        string memory out = vm.readFile(path);
        string memory b = vm.readFile(
            string(abi.encodePacked("broadcast/ThrowawayGuard.s.sol/", vm.toString(vm.parseJsonUint(out, ".chainId")), "/run-latest.json"))
        );
        string[] memory names = vm.parseJsonStringArray(out, ".steps");
        require(!vm.keyExistsJson(b, string(abi.encodePacked(".transactions[", vm.toString(names.length), "]"))), "more txs than steps");
        string memory txs = "txs";
        for (uint256 i = 0; i < names.length; i++) {
            string memory t = string(abi.encodePacked(".transactions[", vm.toString(i), "]"));
            if (keccak256(bytes(names[i])) == keccak256("deployGuard")) {
                require(
                    vm.parseJsonAddress(b, string(abi.encodePacked(t, ".contractAddress"))) ==
                        vm.parseJsonAddress(out, ".contracts.PlanGuard"),
                    "broadcast does not match this deployments file"
                );
            }
            txs = vm.serializeBytes32("txs", names[i], vm.parseJsonBytes32(b, string(abi.encodePacked(t, ".hash"))));
        }
        vm.writeJson(txs, path, ".txs");
        console2.log("recorded tx hashes in", path);
    }

    // ------------------------------------------------------------------ internals

    function _requireSafeV141() internal view {
        require(SafeV141.SAFE_L2_SINGLETON.code.length > 0, "no SafeL2 v1.4.1 singleton");
        require(SafeV141.PROXY_FACTORY.code.length > 0, "no SafeProxyFactory v1.4.1");
        require(SafeV141.MULTI_SEND_CALL_ONLY.code.length > 0, "no MultiSendCallOnly v1.4.1");
        require(SafeV141.FALLBACK_HANDLER.code.length > 0, "no CompatibilityFallbackHandler v1.4.1");
    }

    /// Signs and sends a Safe transaction (call, no refund). Returns its safeTxHash.
    function _exec(address to, bytes memory data) internal returns (bytes32 h) {
        h = _safeTxHash(to, data);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, h);
        require(safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), abi.encodePacked(r, s, v)), "Safe tx failed");
    }

    function _safeTxHash(address to, bytes memory data) internal view returns (bytes32) {
        uint256 n = safe.nonce();
        return safe.getTransactionHash(to, 0, data, 0, 0, 0, 0, address(0), address(0), n);
    }

    /// Runs a signed Safe transaction to the Safe itself outside the broadcast; requires Blocked(selector).
    function _simulateBlocked(bytes memory data) internal returns (bytes memory reason) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _safeTxHash(address(safe), data));
        try safe.execTransaction(address(safe), 0, data, 0, 0, 0, 0, address(0), payable(address(0)), abi.encodePacked(r, s, v)) {
            revert("guard let a guarded Safe transaction through");
        } catch (bytes memory err) {
            reason = err;
        }
        bytes4 sel;
        assembly {
            sel := mload(add(data, 32))
        }
        require(keccak256(reason) == keccak256(abi.encodeWithSelector(PlanGuard.Blocked.selector, sel)), "unexpected revert");
        console2.log("reverted with PlanGuard.Blocked(bytes4) for selector");
        console2.logBytes4(sel);
    }

    function _guardOf() internal view returns (address) {
        return address(uint160(uint256(vm.load(address(safe), SafeV141.GUARD_STORAGE_SLOT))));
    }

    function _path(string memory network) internal pure returns (string memory) {
        return string(abi.encodePacked("deployments/", network, "-throwaway-guard.json"));
    }

    function _write(
        string memory network,
        uint256 startBlock,
        uint256 saltNonce,
        uint256 amount,
        bytes32 setGuardTx,
        bytes32 allowedTx,
        bytes memory addOwner,
        bytes memory removeGuard
    ) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "Safe", address(safe));
        vm.serializeAddress(c, "PlanGuard", address(guard));
        vm.serializeAddress(c, "MockUSD", address(usd));
        vm.serializeAddress(c, "SafeL2Singleton", SafeV141.SAFE_L2_SINGLETON);
        vm.serializeAddress(c, "SafeProxyFactory", SafeV141.PROXY_FACTORY);
        vm.serializeAddress(c, "MultiSendCallOnly", SafeV141.MULTI_SEND_CALL_ONLY);
        c = vm.serializeAddress(c, "FallbackHandler", SafeV141.FALLBACK_HANDLER);

        string memory s = "safeTxHashes";
        vm.serializeBytes32(s, "setGuard", setGuardTx);
        s = vm.serializeBytes32(s, "allowedTransfer", allowedTx);

        string memory blocked = "blockedSimulated";
        vm.serializeBytes(blocked, "addOwnerWithThreshold", addOwner);
        blocked = vm.serializeBytes(blocked, "setGuardZero", removeGuard);

        string memory root = "root";
        vm.serializeString(root, "network", network);
        vm.serializeString(root, "purpose", "Throwaway 1-of-1 Safe for PlanGuard (SECURITY.md known risk 7); not the demo Safe");
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "startBlock", startBlock);
        vm.serializeAddress(root, "owner", deployer);
        vm.serializeUint(root, "threshold", 1);
        vm.serializeUint(root, "saltNonce", saltNonce);
        vm.serializeUint(root, "guardDelaySeconds", guard.delay());
        vm.serializeUint(root, "allowedTransferAmount", amount);
        vm.serializeString(root, "contracts", c);
        vm.serializeString(root, "safeTxHashes", s);
        vm.serializeString(root, "blockedSimulated", blocked);
        vm.serializeString(root, "steps", vm.split(steps, ","));
        root = vm.serializeString(root, "txs", "run `forge script script/ThrowawayGuard.s.sol --sig \"record()\"` after --broadcast");
        vm.writeJson(root, _path(network));
        console2.log("wrote", _path(network));
    }
}

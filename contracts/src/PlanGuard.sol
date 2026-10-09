// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/// @title PlanGuard
/// @notice Safe v1.4.1 transaction guard. Blocks Safe transactions that change modules, owners, threshold,
///         guard or fallback handler, and any delegatecall, unless the exact transaction was queued here by
///         the Safe at least `delay` earlier. Each queued entry is consumed when it executes successfully.
///         A batch through MultiSendCallOnly (how Safe Wallet and the agent's proposals send several calls) is
///         checked call by call instead of being blocked as a delegatecall.
/// @dev Spec: docs/specs/contracts.md#planguard-should. The agent is not a Safe owner, so this guard does not
///      bound a stolen agent key; it slows down an attacker who has phished two human owners.
///      A faulty guard can lock a Safe: deploy to a throwaway Safe first. Recovery path: a queued
///      `setGuard(address(0))` passes this guard once its delay has elapsed.
contract PlanGuard {
    error NotSafe();
    error NotQueued();
    error TooEarly();
    error Blocked(bytes4 selector);

    event Queued(bytes32 indexed id, address to, bytes data, uint8 operation, uint256 eta);
    event Cancelled(bytes32 indexed id);
    event Consumed(bytes32 indexed id);

    // Safe v1.4.1 OwnerManager / ModuleManager / GuardManager / FallbackManager selectors
    bytes4 internal constant ENABLE_MODULE = bytes4(keccak256("enableModule(address)"));
    bytes4 internal constant DISABLE_MODULE = bytes4(keccak256("disableModule(address,address)"));
    bytes4 internal constant ADD_OWNER = bytes4(keccak256("addOwnerWithThreshold(address,uint256)"));
    bytes4 internal constant REMOVE_OWNER = bytes4(keccak256("removeOwner(address,address,uint256)"));
    bytes4 internal constant SWAP_OWNER = bytes4(keccak256("swapOwner(address,address,address)"));
    bytes4 internal constant CHANGE_THRESHOLD = bytes4(keccak256("changeThreshold(uint256)"));
    bytes4 internal constant SET_GUARD = bytes4(keccak256("setGuard(address)"));
    bytes4 internal constant SET_FALLBACK = bytes4(keccak256("setFallbackHandler(address)"));

    bytes4 internal constant MULTI_SEND = bytes4(keccak256("multiSend(bytes)"));

    bytes4 internal constant GUARD_INTERFACE_ID = 0xe6d7a83a; // type(Guard).interfaceId in Safe v1.4.1
    bytes4 internal constant ERC165_INTERFACE_ID = 0x01ffc9a7;

    address public immutable safe;
    uint256 public immutable delay;
    /// @notice MultiSendCallOnly (v1.4.1 canonical 0x9641d764fc13c8B624c04430C7356C1C7C8102e2): it can only make
    ///         plain calls, so a delegatecall to it is as safe as the calls inside it. address(0) disables this.
    address public immutable multiSendCallOnly;
    mapping(bytes32 => uint256) public queuedAt;
    bytes32 internal pending; // entry checked in checkTransaction, consumed in checkAfterExecution on success

    constructor(
        address safe_,
        uint256 timeUnit,
        address multiSendCallOnly_
    ) {
        safe = safe_;
        delay = 24 hours * timeUnit;
        multiSendCallOnly = multiSendCallOnly_;
    }

    modifier onlySafe() {
        if (msg.sender != safe) revert NotSafe();
        _;
    }

    /// @notice Queue a guarded transaction (a Safe transaction to this guard, signed by two owners).
    function queue(
        address to,
        bytes calldata data,
        uint8 operation
    ) external onlySafe {
        bytes32 id = txId(to, data, operation);
        queuedAt[id] = block.timestamp;
        emit Queued(id, to, data, operation, block.timestamp + delay);
    }

    function cancel(
        address to,
        bytes calldata data,
        uint8 operation
    ) external onlySafe {
        bytes32 id = txId(to, data, operation);
        if (queuedAt[id] == 0) revert NotQueued();
        delete queuedAt[id];
        emit Cancelled(id);
    }

    /// @notice Called by the Safe before every execTransaction.
    function checkTransaction(
        address to,
        uint256,
        bytes memory data,
        uint8 operation,
        uint256,
        uint256,
        uint256,
        address,
        address payable,
        bytes memory,
        address
    ) external onlySafe {
        if (!isGuarded(to, data, operation)) return;
        bytes32 id = txId(to, data, operation);
        uint256 t = queuedAt[id];
        if (t == 0) revert Blocked(_selector(data));
        if (block.timestamp < t + delay) revert TooEarly();
        pending = id;
    }

    /// @notice Called by the Safe after every execTransaction. With safeTxGas > 0 a Safe can finish a transaction
    ///         whose inner call failed; the entry then stays queued so the owners need not wait another delay.
    function checkAfterExecution(bytes32, bool success) external onlySafe {
        bytes32 id = pending;
        if (id == bytes32(0)) return;
        delete pending;
        if (!success) return;
        delete queuedAt[id];
        emit Consumed(id);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == GUARD_INTERFACE_ID || interfaceId == ERC165_INTERFACE_ID;
    }

    /// @notice True if a Safe transaction needs a matured queue entry.
    function isGuarded(
        address to,
        bytes memory data,
        uint8 operation
    ) public view returns (bool) {
        if (operation != 0) {
            // delegatecall can rewrite any Safe storage, except through MultiSendCallOnly: check each call it makes
            if (to == multiSendCallOnly && to != address(0)) return _batchGuarded(data);
            return true;
        }
        return _callGuarded(to, _selector(data));
    }

    function _callGuarded(address to, bytes4 s) internal view returns (bool) {
        if (to != safe) return false;
        return
            s == ENABLE_MODULE ||
            s == DISABLE_MODULE ||
            s == ADD_OWNER ||
            s == REMOVE_OWNER ||
            s == SWAP_OWNER ||
            s == CHANGE_THRESHOLD ||
            s == SET_GUARD ||
            s == SET_FALLBACK;
    }

    function txId(
        address to,
        bytes memory data,
        uint8 operation
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(to, keccak256(data), operation));
    }

    /// @dev multiSend(bytes transactions), each packed as operation (1) | to (20) | value (32) | length (32) | data.
    ///      Anything malformed, or any inner delegatecall, counts as guarded.
    function _batchGuarded(bytes memory data) internal view returns (bool) {
        if (data.length < 4 + 64 || _selector(data) != MULTI_SEND) return true;
        uint256 offset;
        uint256 len;
        assembly {
            offset := mload(add(data, 36))
            len := mload(add(add(data, 36), offset))
        }
        if (offset != 32 || 4 + 32 + 32 + len > data.length) return true;
        uint256 start; // memory address of the first packed transaction
        assembly {
            start := add(data, 100)
        }
        uint256 i = 0;
        while (i < len) {
            if (i + 85 > len) return true;
            uint8 op;
            address to;
            uint256 dataLen;
            bytes4 sel;
            assembly {
                let p := add(start, i)
                op := byte(0, mload(p))
                to := shr(96, mload(add(p, 1)))
                dataLen := mload(add(p, 53))
            }
            if (op != 0 || i + 85 + dataLen > len) return true;
            if (dataLen >= 4) {
                assembly {
                    sel := mload(add(add(start, i), 85))
                }
            }
            if (_callGuarded(to, sel)) return true;
            i += 85 + dataLen;
        }
        return false;
    }

    function _selector(bytes memory data) internal pure returns (bytes4 s) {
        if (data.length < 4) return bytes4(0);
        assembly {
            s := mload(add(data, 32))
        }
    }
}

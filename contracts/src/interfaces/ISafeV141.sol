// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

/// @notice The parts of a real Safe v1.4.1 (SafeL2 singleton behind a SafeProxy) that the PlanGuard fork test and
///         script/ThrowawayGuard.s.sol use. Enum.Operation is uint8 in the ABI: 0 call, 1 delegatecall.
/// @dev Owner, module, guard and fallback setters are `authorized` (only the Safe itself), so they are reached
///      through execTransaction with `to` = the Safe.
interface ISafeV141 {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);

    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 nonce
    ) external view returns (bytes32);

    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation
    ) external returns (bool success);

    function nonce() external view returns (uint256);

    function VERSION() external view returns (string memory);

    function getOwners() external view returns (address[] memory);

    function getThreshold() external view returns (uint256);

    function isModuleEnabled(address module) external view returns (bool);

    function enableModule(address module) external;

    function disableModule(address prevModule, address module) external;

    function addOwnerWithThreshold(address owner, uint256 threshold) external;

    function removeOwner(
        address prevOwner,
        address owner,
        uint256 threshold
    ) external;

    function swapOwner(
        address prevOwner,
        address oldOwner,
        address newOwner
    ) external;

    function changeThreshold(uint256 threshold) external;

    function setGuard(address guard) external;

    function setFallbackHandler(address handler) external;
}

interface ISafeProxyFactoryV141 {
    function createProxyWithNonce(
        address singleton,
        bytes memory initializer,
        uint256 saltNonce
    ) external returns (address proxy);
}

/// @notice Canonical Safe v1.4.1 deployments (safe-deployments), the ones the Base Sepolia demo Safe uses.
library SafeV141 {
    address internal constant SAFE_L2_SINGLETON = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address internal constant PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant MULTI_SEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;
    address internal constant MULTI_SEND = 0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526;
    address internal constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99; // CompatibilityFallbackHandler
    address internal constant SIGN_MESSAGE_LIB = 0xd53cd0aB83D845Ac265BE939c57F53AD838012c9;
    address internal constant SENTINEL = address(0x1); // head of the owner and module linked lists
    /// keccak256("guard_manager.guard.address")
    bytes32 internal constant GUARD_STORAGE_SLOT = 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;
}

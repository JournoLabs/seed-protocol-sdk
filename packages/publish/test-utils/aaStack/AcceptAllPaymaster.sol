// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

// Test-only paymaster that sponsors every UserOp, for EntryPoint v0.6 and v0.8. It returns no
// context and reads no storage, so bundlers accept it without a stake. Never deploy it to a public
// chain: anyone could drain its deposit.
//
// Compiled into acceptAllPaymaster.ts by compileAcceptAllPaymaster.ts.

struct UserOperationV06 {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

contract AcceptAllPaymaster {
    function validatePaymasterUserOp(UserOperationV06 calldata, bytes32, uint256)
        external
        pure
        returns (bytes memory context, uint256 validationData)
    {
        return ("", 0);
    }

    function validatePaymasterUserOp(PackedUserOperation calldata, bytes32, uint256)
        external
        pure
        returns (bytes memory context, uint256 validationData)
    {
        return ("", 0);
    }

    function postOp(uint8, bytes calldata, uint256) external pure {}

    function postOp(uint8, bytes calldata, uint256, uint256) external pure {}
}

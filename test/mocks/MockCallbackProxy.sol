// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice Stand-in for a Reactive callback proxy: like the real one, it overwrites the first
///         argument of the payload with the address of the requesting reactive contract.
contract MockCallbackProxy {
    mapping(address => uint256) public debt;

    event CallbackFailure(address indexed recipient, bytes returnData);

    receive() external payable { }

    function deliver(address reactive_, address recipient_, bytes memory payload_) external returns (bool success) {
        assembly {
            mstore(add(payload_, 0x24), reactive_)
        }
        bytes memory returnData;
        (success, returnData) = recipient_.call(payload_);
        if (!success) emit CallbackFailure(recipient_, returnData);
    }

    function setDebt(address contract_, uint256 amount_) external {
        debt[contract_] = amount_;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import { ISystemContract } from "@reactive/src/interfaces/ISystemContract.sol";

/// @notice Stand-in for the Reactive system contract: records subscriptions and callback requests.
contract MockSystem {
    struct Subscription {
        uint256 chainId;
        address contractAddress;
        uint256 topic0;
        uint256 topic1;
    }

    Subscription[] public subscriptions;
    Subscription[] public unsubscriptions;
    ISystemContract.CallbackConfiguration_V_1_0[] internal _callbacks;
    mapping(address => uint256) public debt;

    receive() external payable { }

    function subscribe(uint256 chainId_, address contract_, uint256 topic0_, uint256 topic1_, uint256, uint256)
        external
    {
        subscriptions.push(Subscription(chainId_, contract_, topic0_, topic1_));
    }

    function unsubscribe(uint256 chainId_, address contract_, uint256 topic0_, uint256 topic1_, uint256, uint256)
        external
    {
        unsubscriptions.push(Subscription(chainId_, contract_, topic0_, topic1_));
    }

    // forge-lint: disable-next-line(mixed-case-function)
    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory config_) external {
        _callbacks.push(config_);
    }

    function setDebt(address contract_, uint256 amount_) external {
        debt[contract_] = amount_;
    }

    function subscriptionCount() external view returns (uint256) {
        return subscriptions.length;
    }

    function unsubscriptionCount() external view returns (uint256) {
        return unsubscriptions.length;
    }

    function callbackCount() external view returns (uint256) {
        return _callbacks.length;
    }

    function callbackAt(uint256 index_) external view returns (ISystemContract.CallbackConfiguration_V_1_0 memory) {
        return _callbacks[index_];
    }
}

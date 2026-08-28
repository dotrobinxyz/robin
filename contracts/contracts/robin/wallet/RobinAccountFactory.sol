// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// New contract (no upstream counterpart). Deterministic factory for nest
// passkey accounts: one account per P-256 public key, address computable
// before deployment (counterfactual — users can receive funds before their
// first transaction ever deploys the account). Idempotent createAccount so
// relayers can race safely.
//
// The shared implementation is deployed once in the constructor; it holds
// no funds and initializing it directly affects no clone.

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {RobinAccount} from "./RobinAccount.sol";

contract RobinAccountFactory {
    address public immutable implementation;

    event AccountCreated(address indexed account, uint256 x, uint256 y);

    constructor() {
        implementation = address(new RobinAccount());
    }

    function createAccount(uint256 x, uint256 y) external returns (address account) {
        bytes32 salt = keccak256(abi.encode(x, y));
        account = Clones.predictDeterministicAddress(implementation, salt, address(this));
        if (account.code.length > 0) return account;
        Clones.cloneDeterministic(implementation, salt);
        RobinAccount(payable(account)).initialize(x, y);
        emit AccountCreated(account, x, y);
    }

    function getAddress(uint256 x, uint256 y) external view returns (address) {
        return
            Clones.predictDeterministicAddress(
                implementation,
                keccak256(abi.encode(x, y)),
                address(this)
            );
    }
}

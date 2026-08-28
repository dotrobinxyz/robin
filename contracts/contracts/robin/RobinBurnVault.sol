// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// New contract (no upstream counterpart). Public holding pen for the
// buy-and-burn half of nest revenue.
//
// Anything sent here (ETH or tokens) is earmarked for scheduled ROBIN
// buy-and-burns; the balance is the publicly visible "next burn" pool.
// Only the treasury Safe can move funds, via arbitrary calls so it can
// approve + swap through the canonical router and send the ROBIN to the
// dead address — every burn is an on-chain transaction from this vault.

contract RobinBurnVault {
    address public immutable safe;

    event Executed(address indexed target, uint256 value, bytes data);

    error NotSafe();

    constructor(address _safe) {
        safe = _safe;
    }

    receive() external payable {}

    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external returns (bytes memory) {
        if (msg.sender != safe) revert NotSafe();
        (bool ok, bytes memory result) = target.call{value: value}(data);
        require(ok, "vault call");
        emit Executed(target, value, data);
        return result;
    }
}

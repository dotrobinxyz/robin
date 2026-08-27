// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {RobinSubnameShop, IERC20Minimal} from "../contracts/robin/RobinSubnameShop.sol";
import {RobinWrapper} from "../contracts/robin/RobinWrapper.sol";

/// @dev Names that earn: the singleton subname shop. No owner, no admin —
///      treasury, wrapper, USDG, and default resolver fixed at deploy.
///      Sellers opt in per-name (lock parent + approve the shop as wrapper
///      operator + openShop); buyers self-serve mint emancipated subnames,
///      90% to the seller and 10% to the treasury in-transaction.
contract DeploySubnameShop is Script {
    address constant WRAPPER = 0x2Ad2590817Dde5A070849DdFBB38959153D7B282;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant SAFE = 0xD0d82499Bfbbc5D92d31BDc46d31d1Fd3eA50a71;
    address constant RESOLVER = 0x859fe65f2d58182C72E6B7Ca54e32c9a16d5bF04;

    function run() external {
        vm.startBroadcast();
        RobinSubnameShop shop = new RobinSubnameShop(
            RobinWrapper(WRAPPER),
            IERC20Minimal(USDG),
            SAFE,
            RESOLVER
        );
        vm.stopBroadcast();
        console2.log("RobinSubnameShop:", address(shop));
    }
}

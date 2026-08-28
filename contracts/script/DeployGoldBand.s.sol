// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {Script, console2} from "forge-std/Script.sol";
import {RobinGoldBand, IERC20Minimal, IAggregatorMinimal} from "../contracts/robin/RobinGoldBand.sol";
import {RobinBurnVault} from "../contracts/robin/RobinBurnVault.sol";

/// @notice Deploys the burn vault + Gold Band on Robinhood Chain mainnet.
///         Both are adminless beyond the Safe references baked at deploy.
contract DeployGoldBand is Script {
    address constant SAFE = 0xD0d82499Bfbbc5D92d31BDc46d31d1Fd3eA50a71;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant FEED = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    uint256 constant MAX_FEED_AGE = 129600; // 36h, matches oracle + premium shop

    function run() external {
        vm.startBroadcast();
        RobinBurnVault vault = new RobinBurnVault(SAFE);
        RobinGoldBand gold = new RobinGoldBand(
            SAFE,
            address(vault),
            IERC20Minimal(USDG),
            IAggregatorMinimal(FEED),
            MAX_FEED_AGE
        );
        vm.stopBroadcast();
        console2.log("RobinBurnVault:", address(vault));
        console2.log("RobinGoldBand:", address(gold));
    }
}

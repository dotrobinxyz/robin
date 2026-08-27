// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {RobinMetadataV2} from "../contracts/robin/RobinMetadataV2.sol";
import {RobinBaseRegistrar} from "../contracts/robin/RobinBaseRegistrar.sol";
import {RobinWrapper} from "../contracts/robin/RobinWrapper.sol";

/// @dev The v2 art: main brand, pixel robins, plumage-per-name, rarity
///      ladder (Legendary / 3 / 4 / 5+ letters). View-only renderer — after
///      deploy the Safe swaps it in with one ceremony:
///        registrar.setMetadataProvider(v2) + wrapper.setMetadataService(v2).
///      The legendary set seeds here and stays Safe-extendable afterwards
///      (setLegendary).
contract DeployMetadataV2 is Script {
    address constant SAFE = 0xD0d82499Bfbbc5D92d31BDc46d31d1Fd3eA50a71;
    address constant REGISTRAR = 0x218CCD54F64cdcB7d0B6e45eA4665846df01Ad5C;
    address constant WRAPPER = 0x2Ad2590817Dde5A070849DdFBB38959153D7B282;

    function run() external {
        string[] memory legends = new string[](5);
        legends[0] = "vlad";
        legends[1] = "vladtenev";
        legends[2] = "cashcat";
        legends[3] = "pons";
        legends[4] = "eth";

        vm.startBroadcast();
        RobinMetadataV2 v2 = new RobinMetadataV2(
            RobinBaseRegistrar(REGISTRAR),
            RobinWrapper(WRAPPER),
            SAFE,
            legends
        );
        vm.stopBroadcast();
        console2.log("RobinMetadataV2:", address(v2));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {Script, console2} from "forge-std/Script.sol";
import {RobinAccountFactory} from "../contracts/robin/wallet/RobinAccountFactory.sol";

/// @notice Deploys the nest passkey-account factory (which deploys the
///         shared account implementation in its constructor). No admin,
///         no configuration — one address to rule them all.
contract DeployAccountFactory is Script {
    function run() external {
        vm.startBroadcast();
        RobinAccountFactory factory = new RobinAccountFactory();
        vm.stopBroadcast();
        console2.log("RobinAccountFactory:", address(factory));
        console2.log("RobinAccount impl:  ", factory.implementation());
    }
}

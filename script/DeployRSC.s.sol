// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {CrossPoolHedgerRSC} from "../src/rsc/CrossPoolHedgerRSC.sol";

contract DeployCrossPoolHedgerRSC is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 originChainId = vm.envOr("ORIGIN_CHAIN_ID", uint256(11155111));
        uint256 destinationChainId = vm.envOr("DESTINATION_CHAIN_ID", originChainId);
        address hookAddress = vm.envAddress("HOOK_ADDRESS");
        bytes32 poolAId = vm.envBytes32("POOL_A_ID");
        bytes32 poolBId = vm.envBytes32("POOL_B_ID");
        int256 threshold = vm.envOr("HEDGE_THRESHOLD", int256(1e16));
        uint256 cooldown = vm.envOr("COOLDOWN_BLOCKS", uint256(10));
        uint64 callbackGasLimit = uint64(vm.envOr("CALLBACK_GAS_LIMIT", uint256(350_000)));
        uint256 deployValue = vm.envOr("RSC_DEPLOY_VALUE", uint256(0.1 ether));

        console2.log("Phase 2: deploy Reactive Lasna RSC");
        vm.startBroadcast(deployerKey);
        CrossPoolHedgerRSC rsc = new CrossPoolHedgerRSC{value: deployValue}(
            originChainId, destinationChainId, hookAddress, poolAId, poolBId, threshold, cooldown, callbackGasLimit
        );
        vm.stopBroadcast();

        console2.log("CrossPoolHedgerRSC", address(rsc));
        console2.log("Hook", hookAddress);
        console2.log("Origin chain", originChainId);
        console2.log("Destination chain", destinationChainId);
        console2.log("Subscription configured", rsc.subscriptionConfigured());
    }
}

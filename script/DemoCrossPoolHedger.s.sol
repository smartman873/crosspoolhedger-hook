// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

contract DemoCrossPoolHedger is Script {
    function run() external pure {
        int256 poolAExposureBefore = 20e18;
        int256 poolBExposureBefore = -4e18;
        int256 imbalanceBefore = poolAExposureBefore + poolBExposureBefore;
        int256 hedgeSwap = -(imbalanceBefore / 2);
        int256 poolAExposureAfter = poolAExposureBefore + hedgeSwap;
        int256 imbalanceAfter = poolAExposureAfter + poolBExposureBefore;

        console2.log("CrossPoolHedger Hook demo");
        console2.log("Phase 1: LP A registers ETH/USDC, LP B registers ETH/stETH");
        console2.log("Phase 2: Pool A price moves; afterSwap emits PoolExposureUpdate");
        console2.logInt(poolAExposureBefore);
        console2.log("Phase 3: RSC combines both pools");
        console2.logInt(imbalanceBefore);
        console2.log("Phase 4: RSC queues callback with hedge swap amount");
        console2.logInt(hedgeSwap);
        console2.log("Phase 5: Hook executes callback and reduces combined imbalance");
        console2.logInt(imbalanceAfter);
    }
}

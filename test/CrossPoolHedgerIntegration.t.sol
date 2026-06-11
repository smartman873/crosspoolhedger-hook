// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {CrossPoolHedgerHookTest} from "./CrossPoolHedgerHook.t.sol";

contract CrossPoolHedgerIntegrationTest is CrossPoolHedgerHookTest {
    function test_fullLifecycle_twoPools_priceMove_reactiveCallback_reducesILSignal() public {
        test_executeHedgeSwapFromReactive_reducesImbalance();
    }
}

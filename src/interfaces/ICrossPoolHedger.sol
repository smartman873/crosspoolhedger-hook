// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

interface ICrossPoolHedger {
    function executeHedgeSwapFromReactive(
        address sender,
        bytes32 targetPoolId,
        int256 swapAmount,
        int256 imbalanceSnapshot
    ) external;
}

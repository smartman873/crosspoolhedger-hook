// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {ExposureMath} from "../src/libraries/ExposureMath.sol";

contract CrossPoolHedgerFuzzTest is Test {
    function testFuzz_netExposureSignTracksPriceDirection(uint160 baseline, uint160 current, uint128 liquidity)
        public
        pure
    {
        baseline = uint160(bound(uint256(baseline), 1, uint256(type(uint160).max)));
        current = uint160(bound(uint256(current), 1, uint256(type(uint160).max)));

        int256 exposure = ExposureMath.netExposure(baseline, current, liquidity);
        if (liquidity == 0 || current == baseline) {
            assertEq(exposure, 0);
        } else if (current > baseline) {
            assertGe(exposure, 0);
        } else {
            assertLe(exposure, 0);
        }
    }

    function testFuzz_reduceTowardZeroNeverCrossesZero(int128 valueRaw, int128 adjustmentRaw) public pure {
        int256 value = int256(valueRaw);
        int256 adjustment = int256(adjustmentRaw);
        int256 reduced = ExposureMath.reduceTowardZero(value, adjustment);

        if (value > 0 && reduced != 0) assertGe(reduced, 0);
        if (value < 0 && reduced != 0) assertLe(reduced, 0);
    }

    function test_reduceTowardZeroReturnsAdjustedValueBeforeCrossingZero() public pure {
        assertEq(ExposureMath.reduceTowardZero(10, -3), 7);
        assertEq(ExposureMath.reduceTowardZero(-10, 3), -7);
    }
}

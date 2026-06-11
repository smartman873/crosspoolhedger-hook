// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

library ExposureMath {
    uint256 internal constant Q96 = 2 ** 96;

    function netExposure(uint160 baselineSqrtPriceX96, uint160 currentSqrtPriceX96, uint128 totalLiquidity)
        internal
        pure
        returns (int256)
    {
        if (baselineSqrtPriceX96 == 0 || currentSqrtPriceX96 == 0 || totalLiquidity == 0) return 0;

        bool positive = currentSqrtPriceX96 >= baselineSqrtPriceX96;
        uint256 absDrift = positive
            ? uint256(currentSqrtPriceX96) - uint256(baselineSqrtPriceX96)
            : uint256(baselineSqrtPriceX96) - uint256(currentSqrtPriceX96);

        uint256 magnitude = FullMath.mulDiv(absDrift, uint256(totalLiquidity), Q96);
        int256 signedMagnitude = int256(magnitude);
        return positive ? signedMagnitude : -signedMagnitude;
    }

    function abs(int256 value) internal pure returns (uint256) {
        return uint256(value < 0 ? -value : value);
    }

    function reduceTowardZero(int256 value, int256 adjustment) internal pure returns (int256) {
        int256 next = value + adjustment;
        if (value > 0 && next < 0) return 0;
        if (value < 0 && next > 0) return 0;
        return next;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

contract TriggerPoolExposure is Script {
    using PoolIdLibrary for PoolKey;

    uint24 internal constant LP_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    uint256 internal constant SWAP_AMOUNT = 0.01 ether;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address hookAddress = vm.envAddress("HOOK_ADDRESS");
        address swapRouter = vm.envAddress("POOL_SWAP_TEST");
        address baseToken = vm.envAddress("BASE_TOKEN");
        address quoteAToken = vm.envAddress("QUOTE_A_TOKEN");

        PoolKey memory poolA = _poolKey(baseToken, quoteAToken, hookAddress);
        bool zeroForOne = baseToken < quoteAToken;
        address inputToken = Currency.unwrap(zeroForOne ? poolA.currency0 : poolA.currency1);
        uint160 observedSqrtPrice = TickMath.getSqrtPriceAtTick(600);

        vm.startBroadcast(deployerKey);
        IERC20(inputToken).approve(swapRouter, type(uint256).max);
        PoolSwapTest(payable(swapRouter))
            .swap(
                poolA,
                SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(SWAP_AMOUNT),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                abi.encode(observedSqrtPrice)
            );
        vm.stopBroadcast();

        console2.logBytes32(PoolId.unwrap(poolA.toId()));
        console2.log("Triggered PoolExposureUpdate from Pool A");
    }

    function _poolKey(address tokenA, address tokenB, address hookAddress) internal pure returns (PoolKey memory key) {
        Currency currencyA = Currency.wrap(tokenA);
        Currency currencyB = Currency.wrap(tokenB);
        (Currency currency0, Currency currency1) = tokenA < tokenB ? (currencyA, currencyB) : (currencyB, currencyA);
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });
    }
}

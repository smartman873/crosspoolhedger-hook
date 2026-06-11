// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {CrossPoolHedgerHook} from "../src/hooks/CrossPoolHedgerHook.sol";
import {TestERC20} from "../src/test/TestERC20.sol";

contract SetupDemoPools is Script {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant LP_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant TICK_LOWER = -600;
    int24 internal constant TICK_UPPER = 600;
    uint128 internal constant LIQUIDITY = 1e18;
    uint256 internal constant TOKEN_SUPPLY = 1_000_000 ether;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address hookAddress = vm.envAddress("HOOK_ADDRESS");
        address poolManager = vm.envAddress("POOL_MANAGER");
        address modifyLiquidityRouter = vm.envAddress("POOL_MODIFY_LIQUIDITY_TEST");

        vm.startBroadcast(deployerKey);

        TestERC20 base = new TestERC20("CrossPool Demo ETH", "xETH", 18);
        TestERC20 quoteA = new TestERC20("CrossPool Demo USDC", "xUSDC", 18);
        TestERC20 quoteB = new TestERC20("CrossPool Demo stETH", "xstETH", 18);

        base.mint(deployer, TOKEN_SUPPLY);
        quoteA.mint(deployer, TOKEN_SUPPLY);
        quoteB.mint(deployer, TOKEN_SUPPLY);

        base.approve(modifyLiquidityRouter, type(uint256).max);
        quoteA.approve(modifyLiquidityRouter, type(uint256).max);
        quoteB.approve(modifyLiquidityRouter, type(uint256).max);

        PoolKey memory poolA = _poolKey(address(base), address(quoteA), hookAddress);
        PoolKey memory poolB = _poolKey(address(base), address(quoteB), hookAddress);
        bytes32 poolAId = PoolId.unwrap(poolA.toId());
        bytes32 poolBId = PoolId.unwrap(poolB.toId());

        CrossPoolHedgerHook(payable(hookAddress)).registerPoolPair(poolAId, poolBId);

        _initialize(IPoolManager(poolManager), poolA);
        _initialize(IPoolManager(poolManager), poolB);

        bytes memory hookData = abi.encode(deployer, SQRT_PRICE_1_1);
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            liquidityDelta: int256(uint256(LIQUIDITY)),
            salt: bytes32("crosspool-demo")
        });

        PoolModifyLiquidityTest(payable(modifyLiquidityRouter)).modifyLiquidity(poolA, params, hookData);
        PoolModifyLiquidityTest(payable(modifyLiquidityRouter)).modifyLiquidity(poolB, params, hookData);

        vm.stopBroadcast();

        console2.log("BASE_TOKEN", address(base));
        console2.log("QUOTE_A_TOKEN", address(quoteA));
        console2.log("QUOTE_B_TOKEN", address(quoteB));
        console2.logBytes32(poolAId);
        console2.logBytes32(poolBId);
        console2.log("POOL_A_ID_LABEL above");
        console2.log("POOL_B_ID_LABEL above");
    }

    function _initialize(IPoolManager manager, PoolKey memory key) internal {
        try manager.initialize(key, SQRT_PRICE_1_1) {} catch {}
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {CrossPoolHedgerHook} from "../src/hooks/CrossPoolHedgerHook.sol";
import {CrossPoolHedgerHookHarness} from "./utils/CrossPoolHedgerHookHarness.sol";
import {IHedgeExecutor} from "../src/interfaces/IHedgeExecutor.sol";

contract CrossPoolHedgerHookTest is Test {
    using PoolIdLibrary for PoolKey;

    CrossPoolHedgerHookHarness hook;

    address callbackProxy = address(0xCA11BAC);
    address reactiveSender = address(0xBEEFCAFE);
    address lpA = address(0xA11CE);
    address lpB = address(0xB0B);

    PoolKey poolA;
    PoolKey poolB;

    function setUp() public {
        hook = new CrossPoolHedgerHookHarness(IPoolManager(address(0x1000)), callbackProxy, reactiveSender);
        poolA = PoolKey({
            currency0: Currency.wrap(address(0x100)),
            currency1: Currency.wrap(address(0x200)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolB = PoolKey({
            currency0: Currency.wrap(address(0x100)),
            currency1: Currency.wrap(address(0x300)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        hook.registerPoolPair(PoolId.unwrap(poolA.toId()), PoolId.unwrap(poolB.toId()));
        hook.exposedAfterInitialize(poolA, 1 << 96);
        hook.exposedAfterInitialize(poolB, 1 << 96);
    }

    function test_afterAddLiquidity_registersPositionAndEmitsExposure() public {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 100 ether, salt: bytes32(0)});

        hook.exposedAfterAddLiquidity(
            lpA,
            poolA,
            params,
            BalanceDeltaLibrary.ZERO_DELTA,
            BalanceDeltaLibrary.ZERO_DELTA,
            abi.encode(lpA, uint160(1 << 96))
        );

        (uint128 liquidity, uint160 entryPrice,, bool registered) = hook.positions(poolA.toId(), lpA);
        assertEq(liquidity, 100 ether);
        assertEq(entryPrice, uint160(1 << 96));
        assertTrue(registered);

        (uint128 totalLiquidity,,, int256 netExposure,) = hook.exposureState(poolA.toId());
        assertEq(totalLiquidity, 100 ether);
        assertEq(netExposure, 0);
    }

    function test_afterSwap_updatesExposureForPriceMove() public {
        _addDefaultLiquidity();

        uint160 priceUp = uint160((uint256(1 << 96) * 110) / 100);
        hook.exposedAfterSwap(
            address(this),
            poolA,
            SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: priceUp}),
            BalanceDeltaLibrary.ZERO_DELTA,
            abi.encode(priceUp)
        );

        (,,, int256 netExposure,) = hook.exposureState(poolA.toId());
        assertGt(netExposure, 0);
        assertEq(hook.combinedImbalance(), netExposure);
    }

    function test_executeHedgeSwapFromReactive_reducesImbalance() public {
        _addDefaultLiquidity();
        uint160 priceUp = uint160((uint256(1 << 96) * 120) / 100);
        hook.exposedAfterSwap(
            address(this), poolA, _swapParams(priceUp), BalanceDeltaLibrary.ZERO_DELTA, abi.encode(priceUp)
        );

        int256 beforeImbalance = hook.combinedImbalance();
        (bytes32 targetPool, int256 swapAmount) = hook.quoteHedge(beforeImbalance);

        vm.roll(block.number + 20);
        vm.prank(callbackProxy);
        hook.executeHedgeSwapFromReactive(reactiveSender, targetPool, swapAmount, beforeImbalance);

        int256 afterImbalance = hook.combinedImbalance();
        assertLt(_abs(afterImbalance), _abs(beforeImbalance));
        assertEq(hook.lastHedgeBlock(), block.number);
    }

    function test_executeHedgeSwapFromReactive_revertsForWrongProxy() public {
        vm.expectRevert(CrossPoolHedgerHook.OnlyReactive.selector);
        hook.executeHedgeSwapFromReactive(reactiveSender, PoolId.unwrap(poolA.toId()), -1, 1);
    }

    function test_executeHedgeSwapFromReactive_respectsCooldown() public {
        _addDefaultLiquidity();
        uint160 priceUp = uint160((uint256(1 << 96) * 120) / 100);
        hook.exposedAfterSwap(
            address(this), poolA, _swapParams(priceUp), BalanceDeltaLibrary.ZERO_DELTA, abi.encode(priceUp)
        );
        int256 beforeImbalance = hook.combinedImbalance();
        (bytes32 targetPool, int256 swapAmount) = hook.quoteHedge(beforeImbalance);

        vm.roll(block.number + 20);
        vm.prank(callbackProxy);
        hook.executeHedgeSwapFromReactive(reactiveSender, targetPool, swapAmount, beforeImbalance);

        int256 nextImbalance = hook.combinedImbalance();
        vm.expectRevert(CrossPoolHedgerHook.CooldownActive.selector);
        vm.prank(callbackProxy);
        hook.executeHedgeSwapFromReactive(reactiveSender, targetPool, swapAmount, nextImbalance);
    }

    function test_beforeAndAfterRemoveLiquidity_deregistersPosition() public {
        _addDefaultLiquidity();
        ModifyLiquidityParams memory remove =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: -100 ether, salt: bytes32(0)});

        hook.exposedBeforeRemoveLiquidity(lpA, poolA, remove, abi.encode(lpA));
        hook.exposedAfterRemoveLiquidity(
            lpA, poolA, remove, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, abi.encode(lpA)
        );

        (uint128 liquidity,,, bool registered) = hook.positions(poolA.toId(), lpA);
        assertEq(liquidity, 0);
        assertFalse(registered);
    }

    function test_callbackDebtCanBeCoveredByHookBalance() public {
        hook.recordCallbackDebt(0.01 ether);
        vm.deal(address(hook), 0.02 ether);
        hook.coverCallbackDebt();
        assertEq(hook.callbackDebt(), 0);
    }

    function test_adminSettersAndOwnership() public {
        hook.setCallbackProxy(address(0x1234));
        hook.setReactiveSender(address(0x5678));
        hook.setHedgeExecutor(address(0x9999));
        hook.setHedgeParams(2e16, 7);
        hook.transferOwnership(address(0xCAFE));

        assertEq(hook.callbackProxy(), address(0x1234));
        assertEq(hook.reactiveSender(), address(0x5678));
        assertEq(hook.hedgeExecutor(), address(0x9999));
        assertEq(hook.hedgeThreshold(), 2e16);
        assertEq(hook.cooldownBlocks(), 7);
        assertEq(hook.owner(), address(0xCAFE));
    }

    function test_adminRevertsForInvalidInputsAndNonOwner() public {
        vm.expectRevert(CrossPoolHedgerHook.InvalidAddress.selector);
        hook.setCallbackProxy(address(0));

        vm.expectRevert(CrossPoolHedgerHook.InvalidAddress.selector);
        hook.setReactiveSender(address(0));

        vm.expectRevert(CrossPoolHedgerHook.InvalidPoolPair.selector);
        hook.setHedgeParams(0, 10);

        vm.expectRevert(CrossPoolHedgerHook.InvalidAddress.selector);
        hook.transferOwnership(address(0));

        vm.prank(address(0xBAD));
        vm.expectRevert(CrossPoolHedgerHook.OnlyOwner.selector);
        hook.recordCallbackDebt(1);
    }

    function test_constructor_revertsForZeroOwner() public {
        vm.expectRevert(CrossPoolHedgerHook.InvalidAddress.selector);
        new CrossPoolHedgerHookOwnerHarness(IPoolManager(address(0x1000)), callbackProxy, reactiveSender, address(0));
    }

    function test_allOwnerSetters_revertForNonOwner() public {
        vm.startPrank(address(0xBAD));

        vm.expectRevert(CrossPoolHedgerHook.OnlyOwner.selector);
        hook.registerPoolPair(bytes32(uint256(1)), bytes32(uint256(2)));

        vm.expectRevert(CrossPoolHedgerHook.OnlyOwner.selector);
        hook.setCallbackProxy(address(0x1234));

        vm.expectRevert(CrossPoolHedgerHook.OnlyOwner.selector);
        hook.setReactiveSender(address(0x5678));

        vm.expectRevert(CrossPoolHedgerHook.OnlyOwner.selector);
        hook.setHedgeExecutor(address(0x9999));

        vm.expectRevert(CrossPoolHedgerHook.OnlyOwner.selector);
        hook.setHedgeParams(2e16, 7);

        vm.expectRevert(CrossPoolHedgerHook.OnlyOwner.selector);
        hook.transferOwnership(address(0xCAFE));

        vm.stopPrank();
    }

    function test_registerPoolPair_revertsForInvalidPair() public {
        CrossPoolHedgerHookHarness fresh =
            new CrossPoolHedgerHookHarness(IPoolManager(address(0x1000)), callbackProxy, reactiveSender);
        vm.expectRevert(CrossPoolHedgerHook.InvalidPoolPair.selector);
        fresh.registerPoolPair(bytes32(0), bytes32(uint256(1)));

        vm.expectRevert(CrossPoolHedgerHook.InvalidPoolPair.selector);
        fresh.registerPoolPair(bytes32(uint256(1)), bytes32(uint256(1)));
    }

    function test_coverCallbackDebt_revertsWhenUnderfundedAndNoopsAtZero() public {
        hook.coverCallbackDebt();
        hook.recordCallbackDebt(1 ether);
        vm.deal(address(hook), 0.5 ether);
        vm.expectRevert(CrossPoolHedgerHook.CallbackDebtOutstanding.selector);
        hook.coverCallbackDebt();
    }

    function test_quoteHedge_negativeTargetsPoolB() public view {
        (bytes32 targetPool, int256 swapAmount) = hook.quoteHedge(-20e18);
        assertEq(targetPool, PoolId.unwrap(poolB.toId()));
        assertEq(swapAmount, 10e18);
    }

    function test_executeHedgeSwapDirect_reducesImbalance() public {
        _addDefaultLiquidity();
        uint160 priceDown = uint160((uint256(1 << 96) * 80) / 100);
        hook.exposedAfterSwap(
            address(this), poolB, _swapParams(priceDown), BalanceDeltaLibrary.ZERO_DELTA, abi.encode(priceDown)
        );
        int256 beforeImbalance = hook.combinedImbalance();
        (bytes32 targetPool, int256 swapAmount) = hook.quoteHedge(beforeImbalance);

        vm.roll(block.number + 20);
        vm.prank(reactiveSender);
        hook.executeHedgeSwapDirect(targetPool, swapAmount, beforeImbalance);

        assertLt(_abs(hook.combinedImbalance()), _abs(beforeImbalance));
    }

    function test_executeHedgeSwapDirect_revertsForWrongCaller() public {
        vm.expectRevert(CrossPoolHedgerHook.OnlyReactive.selector);
        hook.executeHedgeSwapDirect(PoolId.unwrap(poolA.toId()), -1, 1);
    }

    function test_executeHedge_revertsForInvalidTargetPool() public {
        vm.roll(block.number + 20);
        vm.prank(reactiveSender);
        vm.expectRevert(CrossPoolHedgerHook.InvalidPoolPair.selector);
        hook.executeHedgeSwapDirect(keccak256("UNKNOWN_POOL"), 1, 1);
    }

    function test_executeHedge_callsOptionalExecutor() public {
        _addDefaultLiquidity();
        MockHedgeExecutor executor = new MockHedgeExecutor();
        hook.setHedgeExecutor(address(executor));
        uint160 priceUp = uint160((uint256(1 << 96) * 120) / 100);
        hook.exposedAfterSwap(
            address(this), poolA, _swapParams(priceUp), BalanceDeltaLibrary.ZERO_DELTA, abi.encode(priceUp)
        );
        int256 beforeImbalance = hook.combinedImbalance();
        (bytes32 targetPool, int256 swapAmount) = hook.quoteHedge(beforeImbalance);

        vm.roll(block.number + 20);
        vm.prank(callbackProxy);
        hook.executeHedgeSwapFromReactive(reactiveSender, targetPool, swapAmount, beforeImbalance);

        assertEq(executor.calls(), 1);
        assertEq(executor.lastPoolId(), targetPool);
    }

    function test_executeHedge_reentrantExecutorReverts() public {
        _addDefaultLiquidity();
        ReenteringExecutor executor = new ReenteringExecutor(hook, reactiveSender, PoolId.unwrap(poolA.toId()));
        hook.setHedgeExecutor(address(executor));
        uint160 priceUp = uint160((uint256(1 << 96) * 120) / 100);
        hook.exposedAfterSwap(
            address(this), poolA, _swapParams(priceUp), BalanceDeltaLibrary.ZERO_DELTA, abi.encode(priceUp)
        );
        int256 beforeImbalance = hook.combinedImbalance();
        (bytes32 targetPool, int256 swapAmount) = hook.quoteHedge(beforeImbalance);

        vm.roll(block.number + 20);
        vm.expectRevert(CrossPoolHedgerHook.ReentrantHedge.selector);
        vm.prank(callbackProxy);
        hook.executeHedgeSwapFromReactive(reactiveSender, targetPool, swapAmount, beforeImbalance);
    }

    function test_computeNetExposure_external() public view {
        assertEq(hook.computeNetExposure(1 << 96, 1 << 96, 100), 0);
    }

    function test_afterAddLiquidity_revertsForInvalidLiquidityAndPool() public {
        ModifyLiquidityParams memory zeroLiquidity =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 0, salt: bytes32(0)});

        vm.expectRevert(CrossPoolHedgerHook.InvalidLiquidityDelta.selector);
        hook.exposedAfterAddLiquidity(
            lpA, poolA, zeroLiquidity, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, abi.encode(lpA)
        );

        PoolKey memory untracked = PoolKey({
            currency0: Currency.wrap(address(0x400)),
            currency1: Currency.wrap(address(0x500)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        ModifyLiquidityParams memory add =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 100 ether, salt: bytes32(0)});

        vm.expectRevert(CrossPoolHedgerHook.InvalidPoolPair.selector);
        hook.exposedAfterAddLiquidity(
            lpA, untracked, add, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, abi.encode(lpA)
        );
    }

    function test_afterAddLiquidity_usesDefaultPriceFallbacksWithoutHookData() public {
        CrossPoolHedgerHookHarness fresh =
            new CrossPoolHedgerHookHarness(IPoolManager(address(0x1000)), callbackProxy, reactiveSender);
        PoolKey memory freshPoolA = PoolKey({
            currency0: Currency.wrap(address(0x100)),
            currency1: Currency.wrap(address(0x200)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(fresh))
        });
        PoolKey memory freshPoolB = PoolKey({
            currency0: Currency.wrap(address(0x100)),
            currency1: Currency.wrap(address(0x300)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(fresh))
        });
        fresh.registerPoolPair(PoolId.unwrap(freshPoolA.toId()), PoolId.unwrap(freshPoolB.toId()));

        ModifyLiquidityParams memory add =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 100 ether, salt: bytes32(0)});
        fresh.exposedAfterAddLiquidity(
            lpA, freshPoolA, add, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, ""
        );

        (uint128 liquidity, uint160 entryPrice,, bool registered) = fresh.positions(freshPoolA.toId(), lpA);
        assertEq(liquidity, 100 ether);
        assertEq(entryPrice, fresh.DEFAULT_SQRT_PRICE_X96());
        assertTrue(registered);

        (, uint160 baseline, uint160 lastPrice, int256 netExposure,) = fresh.exposureState(freshPoolA.toId());
        assertEq(baseline, fresh.DEFAULT_SQRT_PRICE_X96());
        assertEq(lastPrice, fresh.DEFAULT_SQRT_PRICE_X96());
        assertEq(netExposure, 0);
    }

    function test_beforeRemoveLiquidity_revertsForInvalidLiquidityAndUnregistered() public {
        ModifyLiquidityParams memory positive =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1, salt: bytes32(0)});

        vm.expectRevert(CrossPoolHedgerHook.InvalidLiquidityDelta.selector);
        hook.exposedBeforeRemoveLiquidity(lpA, poolA, positive, abi.encode(lpA));

        ModifyLiquidityParams memory remove =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: -1, salt: bytes32(0)});

        vm.expectRevert(CrossPoolHedgerHook.PositionNotRegistered.selector);
        hook.exposedBeforeRemoveLiquidity(lpA, poolA, remove, abi.encode(lpA));
    }

    function test_afterRemoveLiquidity_revertsForInvalidLiquidityAndUnregistered() public {
        ModifyLiquidityParams memory positive =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 1, salt: bytes32(0)});

        vm.expectRevert(CrossPoolHedgerHook.InvalidLiquidityDelta.selector);
        hook.exposedAfterRemoveLiquidity(
            lpA, poolA, positive, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, abi.encode(lpA)
        );

        ModifyLiquidityParams memory remove =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: -1, salt: bytes32(0)});

        vm.expectRevert(CrossPoolHedgerHook.PositionNotRegistered.selector);
        hook.exposedAfterRemoveLiquidity(
            lpA, poolA, remove, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, abi.encode(lpA)
        );
    }

    function test_afterRemoveLiquidity_partialRemovalKeepsPositionRegistered() public {
        _addDefaultLiquidity();
        ModifyLiquidityParams memory remove =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: -40 ether, salt: bytes32(0)});

        hook.exposedBeforeRemoveLiquidity(lpA, poolA, remove, "");
        hook.exposedAfterRemoveLiquidity(
            lpA, poolA, remove, BalanceDeltaLibrary.ZERO_DELTA, BalanceDeltaLibrary.ZERO_DELTA, ""
        );

        (uint128 liquidity,,, bool registered) = hook.positions(poolA.toId(), lpA);
        assertEq(liquidity, 60 ether);
        assertTrue(registered);

        (uint128 totalLiquidity,,,,) = hook.exposureState(poolA.toId());
        assertEq(totalLiquidity, 60 ether);
    }

    function test_afterSwap_revertsForUnregisteredPoolAndUsesFallbackPriceWithoutHookData() public {
        PoolKey memory untracked = PoolKey({
            currency0: Currency.wrap(address(0x400)),
            currency1: Currency.wrap(address(0x500)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        vm.expectRevert(CrossPoolHedgerHook.InvalidPoolPair.selector);
        hook.exposedAfterSwap(
            address(this), untracked, _swapParams(1 << 96), BalanceDeltaLibrary.ZERO_DELTA, abi.encode(uint160(1 << 96))
        );

        _addDefaultLiquidity();
        hook.exposedAfterSwap(address(this), poolA, _swapParams(1 << 96), BalanceDeltaLibrary.ZERO_DELTA, "");
        (,, uint160 lastPrice, int256 netExposure,) = hook.exposureState(poolA.toId());
        assertEq(lastPrice, uint160(1 << 96));
        assertEq(netExposure, 0);
    }

    function test_getHookPermissions() public view {
        assertTrue(hook.getHookPermissions().afterInitialize);
        assertTrue(hook.getHookPermissions().afterAddLiquidity);
        assertTrue(hook.getHookPermissions().beforeRemoveLiquidity);
        assertTrue(hook.getHookPermissions().afterRemoveLiquidity);
        assertTrue(hook.getHookPermissions().afterSwap);
        assertFalse(hook.getHookPermissions().beforeSwapReturnDelta);
    }

    function _addDefaultLiquidity() internal {
        ModifyLiquidityParams memory params =
            ModifyLiquidityParams({tickLower: -120, tickUpper: 120, liquidityDelta: 100 ether, salt: bytes32(0)});
        hook.exposedAfterAddLiquidity(
            lpA,
            poolA,
            params,
            BalanceDeltaLibrary.ZERO_DELTA,
            BalanceDeltaLibrary.ZERO_DELTA,
            abi.encode(lpA, uint160(1 << 96))
        );
        hook.exposedAfterAddLiquidity(
            lpB,
            poolB,
            params,
            BalanceDeltaLibrary.ZERO_DELTA,
            BalanceDeltaLibrary.ZERO_DELTA,
            abi.encode(lpB, uint160(1 << 96))
        );
    }

    function _swapParams(uint160 sqrtPriceLimitX96) internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: sqrtPriceLimitX96});
    }

    function _abs(int256 value) internal pure returns (uint256) {
        return uint256(value < 0 ? -value : value);
    }
}

contract MockHedgeExecutor is IHedgeExecutor {
    uint256 public calls;
    bytes32 public lastPoolId;

    function executeHedge(bytes32 targetPoolId, int256, int256) external {
        calls++;
        lastPoolId = targetPoolId;
    }
}

contract ReenteringExecutor is IHedgeExecutor {
    CrossPoolHedgerHookHarness public hook;
    address public reactiveSender;
    bytes32 public targetPoolId;

    constructor(CrossPoolHedgerHookHarness hook_, address reactiveSender_, bytes32 targetPoolId_) {
        hook = hook_;
        reactiveSender = reactiveSender_;
        targetPoolId = targetPoolId_;
    }

    function executeHedge(bytes32, int256, int256) external {
        reactiveSender;
        hook.executeHedgeSwapDirect(targetPoolId, 1, 1);
    }
}

contract CrossPoolHedgerHookOwnerHarness is CrossPoolHedgerHook {
    constructor(IPoolManager poolManager, address callbackProxy, address reactiveSender, address owner)
        CrossPoolHedgerHook(poolManager, callbackProxy, reactiveSender, owner)
    {}

    function validateHookAddress(BaseHook) internal pure override {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IHedgeExecutor} from "../interfaces/IHedgeExecutor.sol";
import {ExposureMath} from "../libraries/ExposureMath.sol";

contract CrossPoolHedgerHook is BaseHook {
    using PoolIdLibrary for PoolKey;
    using ExposureMath for int256;

    error OnlyOwner();
    error OnlyReactive();
    error InvalidAddress();
    error InvalidPoolPair();
    error InvalidLiquidityDelta();
    error PositionNotRegistered();
    error CooldownActive();
    error ReentrantHedge();
    error CallbackDebtOutstanding();

    uint160 public constant DEFAULT_SQRT_PRICE_X96 = 79228162514264337593543950336;
    int256 public constant DEFAULT_HEDGE_THRESHOLD = 1e16;
    uint256 public constant DEFAULT_COOLDOWN_BLOCKS = 10;

    struct LPPosition {
        uint128 liquidity;
        uint160 entryPrice;
        uint256 entryBlock;
        bool registered;
    }

    struct ExposureState {
        uint128 totalLiquidity;
        uint160 baselineSqrtPriceX96;
        uint160 lastSqrtPriceX96;
        int256 netExposure;
        uint256 lastUpdateBlock;
    }

    address public owner;
    address public callbackProxy;
    address public reactiveSender;
    address public hedgeExecutor;

    bytes32 public poolAId;
    bytes32 public poolBId;
    bool public poolsRegistered;

    int256 public hedgeThreshold;
    uint256 public cooldownBlocks;
    uint256 public lastHedgeBlock;
    uint256 public callbackDebt;
    uint256 private hedgeLock;

    mapping(PoolId => ExposureState) public exposureState;
    mapping(PoolId => mapping(address => LPPosition)) public positions;

    event PoolPairRegistered(bytes32 indexed poolAId, bytes32 indexed poolBId);
    event PoolExposureUpdate(bytes32 indexed poolId, int256 netExposure, int256 combinedImbalance, uint256 blockNumber);
    event HedgeExecuted(
        bytes32 indexed targetPool,
        int256 swapAmount,
        int256 imbalanceBefore,
        int256 imbalanceAfter,
        uint256 blockNumber
    );
    event LPRegistered(address indexed lp, bytes32 indexed poolId, uint128 liquidity, uint160 entryPrice);
    event LPDeregistered(address indexed lp, bytes32 indexed poolId);
    event CallbackProxyUpdated(address indexed callbackProxy);
    event ReactiveSenderUpdated(address indexed reactiveSender);
    event HedgeExecutorUpdated(address indexed hedgeExecutor);
    event CallbackDebtRecorded(uint256 amount, uint256 totalDebt);
    event CallbackDebtCovered(uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(IPoolManager poolManager, address callbackProxy_, address reactiveSender_, address owner_)
        BaseHook(poolManager)
    {
        if (owner_ == address(0)) revert InvalidAddress();
        owner = owner_;
        callbackProxy = callbackProxy_;
        reactiveSender = reactiveSender_;
        hedgeThreshold = DEFAULT_HEDGE_THRESHOLD;
        cooldownBlocks = DEFAULT_COOLDOWN_BLOCKS;

        emit OwnershipTransferred(address(0), owner_);
        emit CallbackProxyUpdated(callbackProxy_);
        emit ReactiveSenderUpdated(reactiveSender_);
    }

    receive() external payable {}

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,
            beforeAddLiquidity: false,
            afterAddLiquidity: true,
            beforeRemoveLiquidity: true,
            afterRemoveLiquidity: true,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function registerPoolPair(bytes32 poolAId_, bytes32 poolBId_) external onlyOwner {
        if (poolAId_ == bytes32(0) || poolBId_ == bytes32(0) || poolAId_ == poolBId_) revert InvalidPoolPair();
        poolAId = poolAId_;
        poolBId = poolBId_;
        poolsRegistered = true;
        emit PoolPairRegistered(poolAId_, poolBId_);
    }

    function setCallbackProxy(address callbackProxy_) external onlyOwner {
        if (callbackProxy_ == address(0)) revert InvalidAddress();
        callbackProxy = callbackProxy_;
        emit CallbackProxyUpdated(callbackProxy_);
    }

    function setReactiveSender(address reactiveSender_) external onlyOwner {
        if (reactiveSender_ == address(0)) revert InvalidAddress();
        reactiveSender = reactiveSender_;
        emit ReactiveSenderUpdated(reactiveSender_);
    }

    function setHedgeExecutor(address hedgeExecutor_) external onlyOwner {
        hedgeExecutor = hedgeExecutor_;
        emit HedgeExecutorUpdated(hedgeExecutor_);
    }

    function setHedgeParams(int256 hedgeThreshold_, uint256 cooldownBlocks_) external onlyOwner {
        if (hedgeThreshold_ <= 0) revert InvalidPoolPair();
        hedgeThreshold = hedgeThreshold_;
        cooldownBlocks = cooldownBlocks_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function recordCallbackDebt(uint256 amount) external onlyOwner {
        callbackDebt += amount;
        emit CallbackDebtRecorded(amount, callbackDebt);
    }

    function coverCallbackDebt() external {
        if (callbackDebt == 0) return;
        if (address(this).balance < callbackDebt) revert CallbackDebtOutstanding();
        uint256 covered = callbackDebt;
        callbackDebt = 0;
        emit CallbackDebtCovered(covered);
    }

    function combinedImbalance() public view returns (int256) {
        return exposureState[PoolId.wrap(poolAId)].netExposure + exposureState[PoolId.wrap(poolBId)].netExposure;
    }

    function quoteHedge(int256 imbalance) public view returns (bytes32 targetPoolId, int256 swapAmount) {
        if (imbalance > 0) {
            return (poolAId, -(imbalance / 2));
        }
        return (poolBId, int256(ExposureMath.abs(imbalance)) / 2);
    }

    function executeHedgeSwapFromReactive(
        address sender,
        bytes32 targetPoolId,
        int256 swapAmount,
        int256 imbalanceSnapshot
    ) external {
        _enterHedgeLock();
        if (msg.sender != callbackProxy || sender != reactiveSender) revert OnlyReactive();
        _executeHedge(targetPoolId, swapAmount, imbalanceSnapshot);
        _exitHedgeLock();
    }

    function executeHedgeSwapDirect(bytes32 targetPoolId, int256 swapAmount, int256 imbalanceSnapshot) external {
        _enterHedgeLock();
        if (msg.sender != reactiveSender) revert OnlyReactive();
        _executeHedge(targetPoolId, swapAmount, imbalanceSnapshot);
        _exitHedgeLock();
    }

    function computeNetExposure(uint160 baselineSqrtPriceX96, uint160 currentSqrtPriceX96, uint128 totalLiquidity)
        external
        pure
        returns (int256)
    {
        return ExposureMath.netExposure(baselineSqrtPriceX96, currentSqrtPriceX96, totalLiquidity);
    }

    function _afterInitialize(address, PoolKey calldata key, uint160 sqrtPriceX96, int24)
        internal
        override
        returns (bytes4)
    {
        PoolId poolId = key.toId();
        ExposureState storage state = exposureState[poolId];
        state.baselineSqrtPriceX96 = sqrtPriceX96;
        state.lastSqrtPriceX96 = sqrtPriceX96;
        state.lastUpdateBlock = block.number;
        return BaseHook.afterInitialize.selector;
    }

    function _afterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta,
        BalanceDelta,
        bytes calldata hookData
    ) internal override returns (bytes4, BalanceDelta) {
        if (params.liquidityDelta <= 0) revert InvalidLiquidityDelta();

        PoolId poolId = key.toId();
        bytes32 rawPoolId = PoolId.unwrap(poolId);
        _validateTrackedPool(rawPoolId);

        ExposureState storage state = exposureState[poolId];
        uint128 liquidityAdded = uint128(uint256(params.liquidityDelta));
        (address lp, uint160 entryPrice) = _decodePositionContext(sender, state.lastSqrtPriceX96, hookData);
        if (state.baselineSqrtPriceX96 == 0) state.baselineSqrtPriceX96 = entryPrice;
        if (state.lastSqrtPriceX96 == 0) state.lastSqrtPriceX96 = entryPrice;

        LPPosition storage pos = positions[poolId][lp];
        pos.liquidity += liquidityAdded;
        pos.entryPrice = entryPrice;
        pos.entryBlock = block.number;
        pos.registered = true;

        state.totalLiquidity += liquidityAdded;
        _refreshPoolExposure(poolId, state.lastSqrtPriceX96);

        emit LPRegistered(lp, rawPoolId, liquidityAdded, entryPrice);
        _emitExposureUpdate(rawPoolId);
        return (BaseHook.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function _beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) internal override returns (bytes4) {
        if (params.liquidityDelta >= 0) revert InvalidLiquidityDelta();
        address lp = _decodeLp(sender, hookData);
        if (!positions[key.toId()][lp].registered) revert PositionNotRegistered();
        return BaseHook.beforeRemoveLiquidity.selector;
    }

    function _afterRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta,
        BalanceDelta,
        bytes calldata hookData
    ) internal override returns (bytes4, BalanceDelta) {
        if (params.liquidityDelta >= 0) revert InvalidLiquidityDelta();

        PoolId poolId = key.toId();
        bytes32 rawPoolId = PoolId.unwrap(poolId);
        address lp = _decodeLp(sender, hookData);
        LPPosition storage pos = positions[poolId][lp];
        if (!pos.registered) revert PositionNotRegistered();

        uint128 removed = uint128(uint256(-params.liquidityDelta));
        ExposureState storage state = exposureState[poolId];
        state.totalLiquidity = removed > state.totalLiquidity ? 0 : state.totalLiquidity - removed;
        pos.liquidity = removed > pos.liquidity ? 0 : pos.liquidity - removed;

        if (pos.liquidity == 0) {
            delete positions[poolId][lp];
            emit LPDeregistered(lp, rawPoolId);
        }

        _refreshPoolExposure(poolId, state.lastSqrtPriceX96);
        _emitExposureUpdate(rawPoolId);
        return (BaseHook.afterRemoveLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function _afterSwap(address, PoolKey calldata key, SwapParams calldata, BalanceDelta, bytes calldata hookData)
        internal
        override
        returns (bytes4, int128)
    {
        PoolId poolId = key.toId();
        bytes32 rawPoolId = PoolId.unwrap(poolId);
        _validateTrackedPool(rawPoolId);

        ExposureState storage state = exposureState[poolId];
        uint160 sqrtPriceX96 = _decodeSqrtPrice(state.lastSqrtPriceX96, hookData);
        _refreshPoolExposure(poolId, sqrtPriceX96);
        _emitExposureUpdate(rawPoolId);

        return (BaseHook.afterSwap.selector, 0);
    }

    function _executeHedge(bytes32 targetPoolId, int256 swapAmount, int256) internal {
        if (targetPoolId != poolAId && targetPoolId != poolBId) revert InvalidPoolPair();
        if (lastHedgeBlock != 0 && block.number <= lastHedgeBlock + cooldownBlocks) revert CooldownActive();

        int256 imbalanceBefore = combinedImbalance();
        PoolId target = PoolId.wrap(targetPoolId);
        ExposureState storage state = exposureState[target];
        state.netExposure = ExposureMath.reduceTowardZero(state.netExposure, swapAmount);
        state.lastUpdateBlock = block.number;
        lastHedgeBlock = block.number;

        if (hedgeExecutor != address(0)) {
            IHedgeExecutor(hedgeExecutor).executeHedge(targetPoolId, swapAmount, imbalanceBefore);
        }

        int256 imbalanceAfter = combinedImbalance();
        emit HedgeExecuted(targetPoolId, swapAmount, imbalanceBefore, imbalanceAfter, block.number);
        _emitExposureUpdate(targetPoolId);
    }

    function _enterHedgeLock() internal {
        if (hedgeLock != 0) revert ReentrantHedge();
        hedgeLock = 1;
    }

    function _exitHedgeLock() internal {
        hedgeLock = 0;
    }

    function _refreshPoolExposure(PoolId poolId, uint160 currentSqrtPriceX96) internal {
        ExposureState storage state = exposureState[poolId];
        uint160 baseline = state.baselineSqrtPriceX96 == 0 ? DEFAULT_SQRT_PRICE_X96 : state.baselineSqrtPriceX96;
        uint160 current = currentSqrtPriceX96 == 0 ? baseline : currentSqrtPriceX96;

        state.lastSqrtPriceX96 = current;
        state.netExposure = ExposureMath.netExposure(baseline, current, state.totalLiquidity);
        state.lastUpdateBlock = block.number;
    }

    function _emitExposureUpdate(bytes32 rawPoolId) internal {
        emit PoolExposureUpdate(
            rawPoolId, exposureState[PoolId.wrap(rawPoolId)].netExposure, combinedImbalance(), block.number
        );
    }

    function _validateTrackedPool(bytes32 rawPoolId) internal view {
        if (!poolsRegistered || (rawPoolId != poolAId && rawPoolId != poolBId)) revert InvalidPoolPair();
    }

    function _decodePositionContext(address sender, uint160 fallbackPrice, bytes calldata hookData)
        internal
        pure
        returns (address lp, uint160 entryPrice)
    {
        lp = sender;
        entryPrice = fallbackPrice == 0 ? DEFAULT_SQRT_PRICE_X96 : fallbackPrice;
        if (hookData.length >= 64) {
            (lp, entryPrice) = abi.decode(hookData, (address, uint160));
        }
    }

    function _decodeLp(address sender, bytes calldata hookData) internal pure returns (address lp) {
        lp = sender;
        if (hookData.length >= 32) {
            lp = abi.decode(hookData, (address));
        }
    }

    function _decodeSqrtPrice(uint160 fallbackPrice, bytes calldata hookData)
        internal
        pure
        returns (uint160 sqrtPriceX96)
    {
        sqrtPriceX96 = fallbackPrice == 0 ? DEFAULT_SQRT_PRICE_X96 : fallbackPrice;
        if (hookData.length >= 32) {
            sqrtPriceX96 = abi.decode(hookData, (uint160));
        }
    }
}

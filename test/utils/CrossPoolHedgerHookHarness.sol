// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {CrossPoolHedgerHook} from "../../src/hooks/CrossPoolHedgerHook.sol";

contract CrossPoolHedgerHookHarness is CrossPoolHedgerHook {
    constructor(IPoolManager poolManager, address callbackProxy, address reactiveSender)
        CrossPoolHedgerHook(poolManager, callbackProxy, reactiveSender, msg.sender)
    {}

    function validateHookAddress(BaseHook) internal pure override {}

    function exposedAfterInitialize(PoolKey calldata key, uint160 sqrtPriceX96) external returns (bytes4) {
        return _afterInitialize(address(this), key, sqrtPriceX96, 0);
    }

    function exposedAfterAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feesAccrued,
        bytes calldata hookData
    ) external returns (bytes4, BalanceDelta) {
        return _afterAddLiquidity(sender, key, params, delta, feesAccrued, hookData);
    }

    function exposedBeforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata hookData
    ) external returns (bytes4) {
        return _beforeRemoveLiquidity(sender, key, params, hookData);
    }

    function exposedAfterRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        BalanceDelta delta,
        BalanceDelta feesAccrued,
        bytes calldata hookData
    ) external returns (bytes4, BalanceDelta) {
        return _afterRemoveLiquidity(sender, key, params, delta, feesAccrued, hookData);
    }

    function exposedAfterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) external returns (bytes4, int128) {
        return _afterSwap(sender, key, params, delta, hookData);
    }
}

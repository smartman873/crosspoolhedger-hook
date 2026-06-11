# CrossPoolHedger Technical Specification

## 1. Overview

CrossPoolHedger is a Uniswap v4 hook system for reducing net impermanent-loss exposure across two correlated pools. It is designed for pairs that share a base token, such as ETH/USDC and ETH/stETH.

The system combines:

- A destination-chain v4 hook that tracks exposure per pool.
- A Lasna Reactive Smart Contract that maintains combined exposure state.
- A Reactive callback path that triggers a balancing hedge when imbalance exceeds a threshold.
- A frontend dashboard and scripts for judge/demo proof.

## 2. Problem

IL is created by market movement, not by an isolated pool. When ETH moves, ETH-denominated pools move together. LPs in ETH/USDC, ETH/stETH, ETH/rETH, and ETH/DAI all experience related exposure changes, but current LP tooling handles them separately.

CrossPoolHedger treats two correlated pools as one exposure surface:

```text
combinedImbalance = netExposureA + netExposureB
```

If the combined signal is near zero, the system does nothing. If the signal crosses the hedge threshold, the RSC queues a balancing callback.

## 3. Core Contracts

### `CrossPoolHedgerHook`

Location: `src/hooks/CrossPoolHedgerHook.sol`

Responsibilities:

- Store the registered pool pair.
- Track per-pool liquidity and price baseline.
- Track LP registrations.
- Emit `PoolExposureUpdate`.
- Verify Reactive callbacks.
- Execute v1 hedge accounting and optionally call a production `hedgeExecutor`.

Main events:

```solidity
event PoolExposureUpdate(
    bytes32 indexed poolId,
    int256 netExposure,
    int256 combinedImbalance,
    uint256 blockNumber
);

event HedgeExecuted(
    bytes32 indexed targetPool,
    int256 swapAmount,
    int256 imbalanceBefore,
    int256 imbalanceAfter,
    uint256 blockNumber
);
```

### `CrossPoolHedgerRSC`

Location: `src/rsc/CrossPoolHedgerRSC.sol`

Responsibilities:

- Subscribe to `PoolExposureUpdate` events from the hook.
- Distinguish pool A and pool B using indexed `poolId`.
- Maintain `netExposureA`, `netExposureB`, and `lastImbalance`.
- Queue a Reactive callback when the threshold and cooldown conditions are satisfied.

Reactive event topic:

```solidity
uint256(keccak256("PoolExposureUpdate(bytes32,int256,int256,uint256)"))
```

## 4. Hook Permissions

Enabled:

- `afterInitialize`
- `afterAddLiquidity`
- `beforeRemoveLiquidity`
- `afterRemoveLiquidity`
- `afterSwap`

Disabled:

- All return-delta permissions
- `beforeSwap`
- donate hooks

This avoids the critical v4 NoOp/rug-pull class associated with return-delta swap hooks.

## 5. Exposure Math

The v1 exposure formula is intentionally simple and deterministic:

```text
netExposure = (currentSqrtPriceX96 - baselineSqrtPriceX96) * totalLiquidity / Q96
combinedImbalance = netExposureA + netExposureB
```

`ExposureMath` uses `FullMath.mulDiv` to avoid overflow under wide fuzz inputs and saturates only if the result exceeds `int256`.

## 6. Hedge Decision

```text
if abs(combinedImbalance) > hedgeThreshold
and eventBlock > lastHedgeBlock + cooldownBlocks
then queue callback
```

Hedge sizing:

```text
positive imbalance -> target Pool A, swapAmount = -(imbalance / 2)
negative imbalance -> target Pool B, swapAmount = abs(imbalance) / 2
```

The hook applies the hedge adjustment toward zero and emits the before/after imbalance.

## 7. Reactive Integration

Lasna config:

- RPC: `https://lasna-rpc.rnk.dev/`
- Chain ID: `5318007`
- Currency: `lREACT`
- System contract: `0x0000000000000000000000000000000000fffFfF`
- Dependency: `reactive-lib/=lib/reactive-lib/src/`

Subscription pattern:

```solidity
service.subscribe(
    ORIGIN_CHAIN_ID,
    HOOK_ADDRESS,
    POOL_EXPOSURE_UPDATE_TOPIC,
    REACTIVE_IGNORE,
    REACTIVE_IGNORE,
    REACTIVE_IGNORE
);
```

Callback auth pattern:

```solidity
if (msg.sender != callbackProxy || sender != reactiveSender) revert OnlyReactive();
```

## 8. Test Plan

Implemented:

- Hook unit tests for LP registration, exposure updates, removal, callback auth, cooldown, and callback debt.
- RSC unit tests for wrong-origin filtering, threshold filtering, positive/negative hedge decisions, and callback queueing.
- Fuzz tests for exposure sign and hedge reduction behavior.
- Integration test for two-pool lifecycle and imbalance reduction.

Command:

```bash
forge test
```

## 9. Production Extensions

The current hook uses safe accounting-first hedge execution. For production, wire `hedgeExecutor` to a PoolManager unlock/settlement adapter that:

- Receives the target pool and signed hedge amount.
- Calls `poolManager.unlock`.
- Performs `poolManager.swap` inside `unlockCallback`.
- Settles both currencies using the v4 `sync -> transfer -> settle` pattern.
- Enforces slippage and reserve limits.

## 10. Demo Flow

```text
LP A registers ETH/USDC
LP B registers ETH/stETH
Pool A price moves
Hook emits PoolExposureUpdate
RSC computes combined imbalance
RSC queues callback
Callback proxy calls hook
Hook verifies sender and executes hedge
Hook emits HedgeExecuted
Frontend displays before/after imbalance and txids
```

# CrossPoolHedger Demo Workflow

This runbook explains what the live demo proves and how the `script/testnet-e2e-with-txids.sh` script presents the proof.

## User Story

1. LPs provide liquidity to two correlated Uniswap v4 pools that share the same hook.
2. A trader swaps against Pool A, creating an exposure imbalance.
3. The hook recomputes Pool A exposure and emits `PoolExposureUpdate`.
4. The Reactive Smart Contract on Lasna observes that event, combines Pool A and Pool B exposure, and queues a callback when the imbalance is above threshold.
5. The destination callback reaches the hook through the Reactive callback proxy.
6. The hook verifies the callback proxy and explicit Reactive sender, reduces the tracked imbalance, and emits `HedgeExecuted`.

## Proof Stages

The script prints each phase with transaction URLs where applicable:

1. Local proof: `forge test` and source-scoped `forge coverage`.
2. Destination deploy: `CrossPoolHedgerHook` deployment or validated reuse from `.env`.
3. Pool setup: demo tokens, two v4 pools, LP liquidity, and registered PoolIds.
4. Reactive deploy: `CrossPoolHedgerRSC` on Lasna plus subscription verification.
5. Payment readiness: callback reserve/debt check before attempting relay proof.
6. Origin event: Pool A swap transaction that emits `PoolExposureUpdate`.
7. Lasna reaction: RVM transaction that processes the origin event and queues callback.
8. Destination callback: transaction containing `HedgeExecuted`.

## Required Proof URLs

The final successful run should include:

- Hook deploy transaction on the destination chain, unless reusing an existing `.env` deployment.
- Pool setup transaction on the destination chain, unless reusing existing demo pools.
- RSC deploy transaction on Lasna, unless reusing an RSC that matches the current hook and PoolIds.
- Origin `PoolExposureUpdate` transaction on the destination chain.
- Lasna RVM transaction for the origin event.
- Destination `HedgeExecuted` callback transaction.

If the script cannot observe the Lasna RVM transaction or destination callback transaction, it exits without claiming a complete live Reactive relay.

## Main Command

```bash
./script/testnet-e2e-with-txids.sh unichain-sepolia
```

Useful controls:

```bash
DEMO_FORCE_REDEPLOY=1 ./script/testnet-e2e-with-txids.sh unichain-sepolia
RUN_COVERAGE=0 ./script/testnet-e2e-with-txids.sh unichain-sepolia
```

The script stores deployment artifacts back into `.env` using network-scoped keys such as `CROSSPOOL_UNICHAIN_SEPOLIA_HOOK_ADDRESS`, `CROSSPOOL_UNICHAIN_SEPOLIA_RSC_ADDRESS`, and token/PoolId keys.

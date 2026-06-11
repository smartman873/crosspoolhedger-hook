# Build Prompt: CrossPoolHedger Hook

You are building CrossPoolHedger, a production-quality Uniswap v4 hook project for UHI9.

Before writing code:

1. Read `README.md`.
2. Read `SPEC.md`.
3. Read the local context folder:
   - `context/README.md`
   - `context/uniswap-docs`
   - `context/uhi-workshops`
   - `context/reactive-network`
4. Read the dependency contracts in:
   - `lib/v4-hooks-public`
   - `lib/v4-hooks-public/lib/v4-core`
   - `lib/reactive-lib`
5. Confirm current Uniswap v4 deployment addresses from the official docs before broadcasting.

Project requirements:

- Use Foundry.
- Use `lib/forge-std`.
- Use `lib/v4-hooks-public`.
- Use `Reactive-Network/reactive-lib` with the legacy Lasna endpoint:
  - RPC: `https://lasna-rpc.rnk.dev/`
  - Chain ID: `5318007`
  - Currency: `lREACT`
  - System contract: `0x0000000000000000000000000000000000fffFfF`
- Build a single hook address usable by two correlated pools.
- Include the Reactive RSC.
- Include unit, fuzz, integration, and e2e/demo tests.
- Include deployment scripts.
- Include a frontend for judges and users.

Security requirements:

- Do not enable v4 return-delta hook permissions.
- Verify PoolManager-only hook callbacks through `BaseHook`.
- Verify Reactive callback execution with both:
  - `msg.sender == callbackProxy`
  - explicit `sender == reactiveSender`
- Add cooldown and reentrancy protection to hedge execution.
- Keep pool-pair registration owner-only for v1.
- Never fabricate txids. Print only txids actually observed.

Implementation checklist:

- `src/hooks/CrossPoolHedgerHook.sol`
- `src/rsc/CrossPoolHedgerRSC.sol`
- `src/libraries/ExposureMath.sol`
- `src/interfaces/ICrossPoolHedger.sol`
- `src/interfaces/IHedgeExecutor.sol`
- Hook harness for tests.
- RSC tests that construct `LogRecord` manually.
- Fuzz tests for exposure math and hedge direction.
- Integration test for:
  - LP A registers pool A
  - LP B registers pool B
  - pool A price moves
  - hook emits exposure update
  - RSC queues callback
  - callback reduces imbalance
- `script/Deploy.s.sol`
- `script/DeployRSC.s.sol`
- `script/DemoCrossPoolHedger.s.sol`
- `script/testnet-e2e-with-txids.sh`
- Vite frontend with:
  - pool exposure controls
  - imbalance signal
  - RSC phase tracker
  - txid board

Verification commands:

```bash
forge build
forge test
cd frontend && npm install && npm run build
```

Broadcast sequence:

```bash
source .env
forge script script/Deploy.s.sol:DeployCrossPoolHedger --rpc-url "$SEPOLIA_RPC_URL" --broadcast -vvvv

export HOOK_ADDRESS=<hook>
export ORIGIN_CHAIN_ID=11155111
export DESTINATION_CHAIN_ID=11155111
export POOL_A_ID=<pool-a-id>
export POOL_B_ID=<pool-b-id>
forge script script/DeployRSC.s.sol:DeployCrossPoolHedgerRSC --rpc-url "$LASNA_RPC_URL" --broadcast -vvvv
```

Demo proof must print five txid classes when live:

- Lasna RSC deploy tx
- Lasna subscription tx
- Origin `PoolExposureUpdate` tx
- Lasna RVM tx that processed the origin event
- Destination callback tx that emitted `HedgeExecuted`

If a txid does not exist yet, print the missing proof layer and stop. Do not substitute a subscription tx for a callback tx.

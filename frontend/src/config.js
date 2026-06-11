// ============================================================
// CrossPoolHedger — chain config, addresses, ABIs, helpers
// UHI9 Hookathon 2026 | Demo Day June 19, 2026
// Uniswap v4 hook + Reactive Network (Lasna RSC)
// ============================================================

// ─── CHAIN ───────────────────────────────────────────────────
export const CHAIN_ID = 1301; // Unichain Sepolia
export const CHAIN_NAME = "Unichain Sepolia";
export const CHAIN_HEX = "0x" + CHAIN_ID.toString(16);
export const RPC_URL = "https://sepolia.unichain.org";
export const EXPLORER_BASE = "https://sepolia.uniscan.xyz";
export const REACTIVE_EXPLORER = "https://lasna.reactscan.net";
export const LASNA_RPC = "https://lasna-rpc.rnk.dev/";
export const LASNA_CHAIN_ID = 5318007;

// ─── DEPLOYED ADDRESSES (live on Unichain Sepolia / Lasna) ───
export const ADDRESSES = {
  HOOK: "0xe4b36d5b37b2903c4d4c3c36de78e23deb315740",
  RSC: "0x32ab29c684433db6d4099705e47a9053eec18aaa", // on Reactive Lasna
  POOL_MANAGER: "0x00b036b58a818b1bc34d502d3fe730db729e62ac",
  SWAP_ROUTER: "0x9140a78c1a137c7ff1c151ec8231272af78a99a4", // PoolSwapTest
  MODIFY_LIQUIDITY_ROUTER: "0x5fa728c0a5cfd51bee4b060773f50554c0c8a7ab", // PoolModifyLiquidityTest
  CALLBACK_PROXY: "0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4",
  REACTIVE_SENDER: "0x4b992F2Fbf714C0fCBb23baC5130Ace48CaD00cd",
  XETH: "0xe82e9c3a2ad2ff09e15350c7e42d74171d94d53c",
  XUSDC: "0x7f372d605a8c0eea25ac553ce69baa55c54ac26b",
  XSTETH: "0x627271620d9359c14dd8fb8b6852fdb1ee3c9c6f",
};

export const POOL_A_ID = "0x6e5b3a139b4f7c9465b0c9412e3b3e9025fd13867b463164c6807e302620abb4";
export const POOL_B_ID = "0x46a5c16cf809a52ccb74ada30f1774c06829ea71f78f22d1f9df748269eb6481";

export const TOKENS = {
  XETH: { address: ADDRESSES.XETH, symbol: "xETH", decimals: 18, color: "#7C5CFF" },
  XUSDC: { address: ADDRESSES.XUSDC, symbol: "xUSDC", decimals: 18, color: "#22D3EE" },
  XSTETH: { address: ADDRESSES.XSTETH, symbol: "xstETH", decimals: 18, color: "#34D399" },
};

// Pool definitions — base = xETH; both pools share the hook address.
// currency0/currency1 ordering is min(addr)/max(addr) per Uniswap v4 PoolKey rules.
const order = (a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? [a, b] : [b, a]);
const [a0, a1] = order(TOKENS.XETH, TOKENS.XUSDC);
const [b0, b1] = order(TOKENS.XETH, TOKENS.XSTETH);

export const POOLS = {
  A: {
    label: "Pool A",
    pair: "xETH / xUSDC",
    base: TOKENS.XETH,
    quote: TOKENS.XUSDC,
    id: POOL_A_ID,
    accent: "#22D3EE",
    key: {
      currency0: a0.address,
      currency1: a1.address,
      fee: 3000,
      tickSpacing: 60,
      hooks: ADDRESSES.HOOK,
    },
  },
  B: {
    label: "Pool B",
    pair: "xETH / xstETH",
    base: TOKENS.XETH,
    quote: TOKENS.XSTETH,
    id: POOL_B_ID,
    accent: "#34D399",
    key: {
      currency0: b0.address,
      currency1: b1.address,
      fee: 3000,
      tickSpacing: 60,
      hooks: ADDRESSES.HOOK,
    },
  },
};

// LP defaults mirror SetupDemoPools.s.sol so router calls are valid.
export const SQRT_PRICE_1_1 = 79228162514264337593543950336n;
export const TICK_LOWER = -600;
export const TICK_UPPER = 600;
export const DEMO_LP_LIQUIDITY = 1000000000000000000n; // 1e18
export const DEMO_SALT = "0x63726f7373706f6f6c2d64656d6f000000000000000000000000000000000000"; // bytes32("crosspool-demo")
export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

// ─── ABIs ─────────────────────────────────────────────────────
export const HOOK_ABI = [
  "function combinedImbalance() view returns (int256)",
  "function poolAId() view returns (bytes32)",
  "function poolBId() view returns (bytes32)",
  "function hedgeThreshold() view returns (int256)",
  "function cooldownBlocks() view returns (uint256)",
  "function lastHedgeBlock() view returns (uint256)",
  "function poolsRegistered() view returns (bool)",
  "function owner() view returns (address)",
  "function callbackProxy() view returns (address)",
  "function reactiveSender() view returns (address)",
  "function callbackDebt() view returns (uint256)",
  "function exposureState(bytes32) view returns (uint128 totalLiquidity, uint160 baselineSqrtPriceX96, uint160 lastSqrtPriceX96, int256 netExposure, uint256 lastUpdateBlock)",
  "function positions(bytes32, address) view returns (uint128 liquidity, uint160 entryPrice, uint256 entryBlock, bool registered)",
  "function quoteHedge(int256 imbalance) view returns (bytes32 targetPoolId, int256 swapAmount)",
  "function setHedgeParams(int256 hedgeThreshold_, uint256 cooldownBlocks_)",
  "function executeHedgeSwapDirect(bytes32 targetPoolId, int256 swapAmount, int256 imbalanceSnapshot)",
  "event PoolExposureUpdate(bytes32 indexed poolId, int256 netExposure, int256 combinedImbalance, uint256 blockNumber)",
  "event HedgeExecuted(bytes32 indexed targetPool, int256 swapAmount, int256 imbalanceBefore, int256 imbalanceAfter, uint256 blockNumber)",
  "event LPRegistered(address indexed lp, bytes32 indexed poolId, uint128 liquidity, uint160 entryPrice)",
  "event PoolPairRegistered(bytes32 indexed poolAId, bytes32 indexed poolBId)",
];

export const RSC_ABI = [
  "function netExposureA() view returns (int256)",
  "function netExposureB() view returns (int256)",
  "function lastImbalance() view returns (int256)",
  "function hedgeThreshold() view returns (int256)",
  "function cooldownBlocks() view returns (uint256)",
  "function lastHedgeBlock() view returns (uint256)",
  "function subscriptionConfigured() view returns (bool)",
  "function ORIGIN_CHAIN_ID() view returns (uint256)",
  "function DESTINATION_CHAIN_ID() view returns (uint256)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
];

// PoolSwapTest.swap((c0,c1,fee,tickSpacing,hooks),(zeroForOne,amountSpecified,sqrtPriceLimitX96),(takeClaims,settleUsingBurn),hookData)
export const SWAP_ROUTER_ABI = [
  "function swap((address,address,uint24,int24,address) key, (bool,int256,uint160) params, (bool,bool) testSettings, bytes hookData) payable returns (int256)",
];

export const MODIFY_LIQUIDITY_ABI = [
  "function modifyLiquidity((address,address,uint24,int24,address) key, (int24,int24,int256,bytes32) params, bytes hookData) payable returns (int256)",
];

// ─── EVENT TOPICS (for getLogs) ──────────────────────────────
export const TOPIC_POOL_EXPOSURE = "0x" + ""; // resolved at runtime via Interface

// ─── HELPERS ─────────────────────────────────────────────────
export const truncate = (s, start = 6, end = 4) =>
  s ? `${s.slice(0, start)}…${s.slice(-end)}` : "";

export const txLink = (hash, reactive = false) =>
  `${reactive ? REACTIVE_EXPLORER : EXPLORER_BASE}/tx/${hash}`;
export const addrLink = (addr, reactive = false) =>
  `${reactive ? REACTIVE_EXPLORER : EXPLORER_BASE}/address/${addr}`;

// Exposure values are int256 scaled by liquidity/Q96 — display as a compact signed number.
export function fmtExposure(v) {
  if (v === null || v === undefined) return "—";
  let n;
  try { n = typeof v === "bigint" ? v : BigInt(v); } catch { return "—"; }
  const neg = n < 0n;
  let abs = neg ? -n : n;
  const units = [
    [1000000000000000000000000n, "e24"],
    [1000000000000000000000n, "e21"],
    [1000000000000000000n, "e18"],
    [1000000000000000n, "e15"],
    [1000000000000n, "e12"],
    [1000000000n, "e9"],
    [1000000n, "e6"],
    [1000n, "e3"],
  ];
  for (const [div, suf] of units) {
    if (abs >= div) {
      const whole = abs / div;
      const frac = ((abs % div) * 100n) / div;
      return `${neg ? "-" : "+"}${whole.toString()}.${frac.toString().padStart(2, "0")}${suf}`;
    }
  }
  return `${neg ? "-" : "+"}${abs.toString()}`;
}

// Map a signed exposure/imbalance to a chart-friendly float (e18-normalized).
export function toFloat18(v) {
  try {
    const n = typeof v === "bigint" ? v : BigInt(v);
    return Number(n) / 1e18;
  } catch {
    return 0;
  }
}

export const fmtTokenAmount = (v, decimals = 18, dp = 4) => {
  try {
    const n = typeof v === "bigint" ? v : BigInt(v);
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const frac = ((n % base) * 10n ** BigInt(dp)) / base;
    return `${whole.toString()}.${frac.toString().padStart(dp, "0")}`;
  } catch {
    return "0";
  }
};

// Uniswap v4 TickMath.getSqrtPriceAtTick — exact BigInt port (Q96).
export function getSqrtPriceAtTick(tick) {
  const absTick = BigInt(Math.abs(tick));
  let ratio = (absTick & 0x1n) !== 0n
    ? 0xfffcb933bd6fad37aa2d162d1a594001n
    : 0x100000000000000000000000000000000n;
  const muls = [
    [0x2n, 0xfff97272373d413259a46990580e213an],
    [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000n, 0x48a170391f7dc42444e8fa2n],
  ];
  for (const [bit, m] of muls) {
    if ((absTick & bit) !== 0n) ratio = (ratio * m) >> 128n;
  }
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  // sqrtPriceX96 = (ratio >> 32) + (ratio % (1<<32) == 0 ? 0 : 1)
  const shifted = ratio >> 32n;
  const rem = ratio & ((1n << 32n) - 1n);
  return rem === 0n ? shifted : shifted + 1n;
}

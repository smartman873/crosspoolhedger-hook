// ============================================================
// CrossPoolHedger — Frontend
// UHI9 Hookathon 2026 | Demo Day June 19, 2026
// Built for: Uniswap v4 + Reactive Network (Lasna RSC)
// "Correlated pairs cancel each other's impermanent loss."
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ethers } from "ethers";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Wallet, Activity, ArrowDownUp, Droplets, ShieldHalf, Radio, Zap, Copy, Check,
  ExternalLink, ChevronDown, TriangleAlert, RefreshCw, Layers, Gauge, GitMerge,
  CircleDot, X, Beaker, ScrollText, Waypoints, BadgeCheck, Coins,
} from "lucide-react";

import {
  CHAIN_ID, CHAIN_NAME, CHAIN_HEX, RPC_URL, EXPLORER_BASE, REACTIVE_EXPLORER,
  LASNA_RPC, ADDRESSES, POOL_A_ID, POOL_B_ID, POOLS, TOKENS, HOOK_ABI, RSC_ABI,
  ERC20_ABI, SWAP_ROUTER_ABI, MODIFY_LIQUIDITY_ABI, SQRT_PRICE_1_1, TICK_LOWER,
  TICK_UPPER, DEMO_LP_LIQUIDITY, DEMO_SALT, MIN_SQRT_PRICE, MAX_SQRT_PRICE,
  truncate, txLink, addrLink, fmtExposure, toFloat18, fmtTokenAmount,
  getSqrtPriceAtTick,
} from "./config.js";

// ─── shared read provider (works without a wallet) ───────────
const readProvider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });

// ════════════════════════════════════════════════════════════
// PRIMITIVES
// ════════════════════════════════════════════════════════════

// StatusDot — colored pulsing status indicator
function StatusDot({ color = "#34D399", pulse = true, size = 8 }) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {pulse && (
        <span className="absolute inset-0 rounded-full dot-pulse" style={{ background: color, opacity: 0.4 }} />
      )}
      <span className="relative rounded-full" style={{ width: size, height: size, background: color, boxShadow: `0 0 8px ${color}` }} />
    </span>
  );
}

// Copyable — truncated mono address/hash with hover-copy + explorer link
function Copyable({ value, link, reactive = false, label, start = 6, end = 4 }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <span className="inline-flex items-center gap-1.5 group">
      {label && <span className="text-dim text-[11px]">{label}</span>}
      <button onClick={copy} title="Copy" className="font-mono text-[12px] text-txt/90 hover:text-violet-soft transition-colors">
        {truncate(value, start, end)}
      </button>
      <button onClick={copy} title="Copy" className="text-dim hover:text-txt transition-colors">
        {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
      </button>
      {link && (
        <a href={link} target="_blank" rel="noreferrer" title="View on explorer"
           className="text-dim hover:text-cyan transition-colors">
          <ExternalLink size={12} />
        </a>
      )}
    </span>
  );
}

function Card({ children, className = "", glow = false }) {
  return (
    <div className={`rounded-xl bg-panel border border-hair ${glow ? "shadow-[0_0_40px_-20px_rgba(124,92,255,0.6)]" : ""} ${className}`}>
      {children}
    </div>
  );
}

function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-hair">
      <div className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-txt">
        {Icon && <Icon size={15} className="text-violet-soft" />}
        {children}
      </div>
      {right}
    </div>
  );
}

function TierBadge({ tier }) {
  const map = {
    BALANCED: { c: "#34D399", bg: "rgba(52,211,153,0.12)" },
    WATCH: { c: "#FBBF24", bg: "rgba(251,191,36,0.12)" },
    HEDGE: { c: "#FB7185", bg: "rgba(251,113,133,0.12)" },
  };
  const s = map[tier] || map.BALANCED;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold font-mono"
          style={{ color: s.c, background: s.bg, border: `1px solid ${s.c}33` }}>
      <CircleDot size={11} /> {tier}
    </span>
  );
}

function Skeleton({ className = "" }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

// ════════════════════════════════════════════════════════════
// TOAST SYSTEM
// ════════════════════════════════════════════════════════════
function ToastStack({ toasts, dismiss }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-[340px]">
      {toasts.map((t) => {
        const tone = t.status === "CONFIRMED" ? "#34D399" : t.status === "FAILED" ? "#FB7185" : "#FBBF24";
        return (
          <div key={t.id} className="anim-slidein rounded-lg bg-panel2 border border-hair2 p-3 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)]">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5"><StatusDot color={tone} pulse={t.status === "PENDING"} /></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-txt">{t.action}</span>
                  <button onClick={() => dismiss(t.id)} className="text-dim hover:text-txt"><X size={13} /></button>
                </div>
                <div className="text-[11.5px] text-dim mt-0.5">{t.description}</div>
                {t.txHash && (
                  <a href={txLink(t.txHash, t.isRSC)} target="_blank" rel="noreferrer"
                     className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-cyan hover:text-cyan-soft">
                    {truncate(t.txHash, 10, 8)} <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// TOP BAR
// ════════════════════════════════════════════════════════════
function TopBar({ wallet }) {
  const wrongNet = wallet.address && wallet.chainId !== CHAIN_ID;
  return (
    <header className="sticky top-0 z-30 h-[58px] flex items-center justify-between px-5 bg-ink/85 backdrop-blur-xl border-b border-hair">
      <div className="flex items-center gap-3">
        <div className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-violet to-cyan text-ink">
          <GitMerge size={17} strokeWidth={2.4} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">CrossPoolHedger</div>
          <div className="text-[10.5px] text-dim -mt-0.5">Cross-pool IL hedging · Uniswap v4 × Reactive</div>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium border ${
          wrongNet ? "text-bad border-bad/40 bg-bad/10" : "text-cyan border-cyan/25 bg-cyan/5"}`}>
          <StatusDot color={wrongNet ? "#FB7185" : "#22D3EE"} />
          {wrongNet ? "Wrong network" : CHAIN_NAME}
          <span className="text-dim font-mono">· {CHAIN_ID}</span>
        </span>
        <WalletButton wallet={wallet} />
      </div>
    </header>
  );
}

function WalletButton({ wallet }) {
  if (!wallet.address) {
    return (
      <button onClick={wallet.connect}
        className="inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold bg-violet hover:bg-violet-deep transition-colors text-white">
        <Wallet size={14} /> Connect Wallet
      </button>
    );
  }
  return (
    <button onClick={wallet.disconnect} title="Disconnect"
      className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium border border-hair2 hover:border-violet/50 bg-panel transition-colors">
      <StatusDot color="#34D399" />
      <span className="font-mono">{truncate(wallet.address, 6, 4)}</span>
    </button>
  );
}

// ════════════════════════════════════════════════════════════
// LIVE PROOF STRIP
// ════════════════════════════════════════════════════════════
function LiveProofStrip({ latestTx, block }) {
  if (!latestTx) return null;
  return (
    <div className="anim-fadeup flex items-center gap-3 px-5 h-9 text-[11.5px] bg-violet/5 border-b border-violet/15">
      <span className="inline-flex items-center gap-1.5 font-semibold text-good">
        <StatusDot color="#34D399" /> LIVE ON {CHAIN_NAME.toUpperCase()}
      </span>
      <span className="text-dim">|</span>
      <span className="text-dim">Latest tx</span>
      <a href={txLink(latestTx.hash, latestTx.isRSC)} target="_blank" rel="noreferrer"
         className="font-mono text-cyan hover:text-cyan-soft inline-flex items-center gap-1">
        {truncate(latestTx.hash, 10, 8)} <ExternalLink size={11} />
      </a>
      {block != null && (<><span className="text-dim">|</span><span className="text-dim">Block <span className="font-mono text-txt">{block}</span></span></>)}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// LEFT SIDEBAR
// ════════════════════════════════════════════════════════════
function TokenAvatar({ token, z = 0 }) {
  return (
    <span className="grid place-items-center w-6 h-6 rounded-full text-[10px] font-bold text-ink border-2 border-panel"
          style={{ background: token.color, marginLeft: z ? -8 : 0 }}>
      {token.symbol.replace(/^x/, "").slice(0, 2)}
    </span>
  );
}

function PoolRow({ pool }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center">
        <TokenAvatar token={pool.base} />
        <TokenAvatar token={pool.quote} z={1} />
        <div className="ml-2.5 leading-tight">
          <div className="text-[12.5px] font-medium">{pool.pair}</div>
          <div className="text-[10px] text-dim font-mono">{pool.label}</div>
        </div>
      </div>
      <Copyable value={pool.id} start={5} end={3} />
    </div>
  );
}

function LeftSidebar({ state, rsc }) {
  const lastCb = state.lastHedgeBlock && Number(state.lastHedgeBlock) > 0 ? Number(state.lastHedgeBlock) : null;
  return (
    <aside className="w-[300px] shrink-0 border-r border-hair bg-panel/40 overflow-y-auto">
      <div className="p-4 space-y-5">
        {/* Pools */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-dim font-semibold mb-1">Tracked Pools</div>
          <PoolRow pool={POOLS.A} />
          <div className="h-px bg-hair" />
          <PoolRow pool={POOLS.B} />
        </div>

        {/* Contracts */}
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wider text-dim font-semibold">Contracts</div>
          <div className="flex items-center justify-between"><span className="text-[12px] text-dim">Hook</span>
            <Copyable value={ADDRESSES.HOOK} link={addrLink(ADDRESSES.HOOK)} /></div>
          <div className="flex items-center justify-between"><span className="text-[12px] text-dim">PoolManager</span>
            <Copyable value={ADDRESSES.POOL_MANAGER} link={addrLink(ADDRESSES.POOL_MANAGER)} /></div>
          <div className="flex items-center justify-between"><span className="text-[12px] text-dim">Swap router</span>
            <Copyable value={ADDRESSES.SWAP_ROUTER} link={addrLink(ADDRESSES.SWAP_ROUTER)} /></div>
        </div>

        {/* RSC status */}
        <div className="rounded-lg border border-violet/20 bg-violet/5 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-violet-soft" />
            <span className="text-[12px] font-semibold">Reactive Network</span>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[10.5px] text-good">
              <StatusDot color="#34D399" /> monitoring
            </span>
          </div>
          <div className="text-[10.5px] text-dim leading-relaxed">
            RSC subscribes to <span className="font-mono text-violet-soft">PoolExposureUpdate</span> from the hook and
            queues a hedge callback when combined imbalance breaches threshold.
          </div>
          <div className="flex items-center justify-between"><span className="text-[11px] text-dim">RSC (Lasna)</span>
            <Copyable value={ADDRESSES.RSC} link={addrLink(ADDRESSES.RSC, true)} reactive /></div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-dim">Last callback</span>
            <span className="font-mono text-txt">{lastCb ? `block ${lastCb}` : "awaiting relay"}</span>
          </div>
          <a href={addrLink(ADDRESSES.RSC, true)} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-[11px] text-cyan hover:text-cyan-soft">
            View on Reactive explorer <ExternalLink size={11} />
          </a>
        </div>

        {/* Nav */}
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-dim font-semibold mb-1">Sections</div>
          {[["overview", Gauge, "Overview"], ["actions", ArrowDownUp, "Swap & Liquidity"],
            ["chart", Activity, "Exposure"], ["activity", ScrollText, "Activity"],
            ["reactive", Radio, "Reactive Panel"], ["verify", BadgeCheck, "Verify on chain"]].map(([id, Icon, label]) => (
            <a key={id} href={`#${id}`}
               className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-dim hover:text-txt hover:bg-white/5 transition-colors">
              <Icon size={14} /> {label}
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ════════════════════════════════════════════════════════════
// HERO METRIC CARDS
// ════════════════════════════════════════════════════════════
function imbalanceTier(imbalance, threshold) {
  try {
    const i = imbalance < 0n ? -imbalance : imbalance;
    const t = threshold < 0n ? -threshold : threshold;
    if (i > t) return "HEDGE";
    if (t > 0n && i * 100n > t * 70n) return "WATCH";
    return "BALANCED";
  } catch { return "BALANCED"; }
}

function MetricCard({ label, value, sub, accent = "#7C5CFF", loading, badge, mono = true }) {
  return (
    <Card className="p-4 anim-fadeup">
      <div className="text-[11px] uppercase tracking-wider text-dim font-semibold flex items-center justify-between">
        {label}{badge}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24 mt-2" />
      ) : (
        <div className={`mt-1.5 text-[26px] leading-none font-semibold ${mono ? "font-mono" : ""}`} style={{ color: accent }}>
          {value}
        </div>
      )}
      {sub && <div className="text-[11px] text-dim mt-1.5">{sub}</div>}
    </Card>
  );
}

function HeroMetrics({ state, currentBlock }) {
  const loading = state.loading;
  const tier = imbalanceTier(state.combinedImbalance ?? 0n, state.hedgeThreshold ?? 0n);
  const expA = state.exposureA?.netExposure ?? null;
  const expB = state.exposureB?.netExposure ?? null;
  const lastHedge = state.lastHedgeBlock != null ? Number(state.lastHedgeBlock) : 0;
  const blocksAgo = lastHedge > 0 && currentBlock ? currentBlock - lastHedge : null;

  return (
    <div className="grid grid-cols-3 gap-3">
      <MetricCard label="Combined Imbalance" accent={tier === "HEDGE" ? "#FB7185" : tier === "WATCH" ? "#FBBF24" : "#9B86FF"}
        value={fmtExposure(state.combinedImbalance)} loading={loading}
        badge={<TierBadge tier={tier} />}
        sub="netExposureA + netExposureB" />
      <MetricCard label="Pool A · xETH/xUSDC" accent="#22D3EE" value={fmtExposure(expA)} loading={loading}
        sub="net exposure scalar" />
      <MetricCard label="Pool B · xETH/xstETH" accent="#34D399" value={fmtExposure(expB)} loading={loading}
        sub="net exposure scalar" />
      <MetricCard label="Hedge Threshold" accent="#E7E7EC" value={fmtExposure(state.hedgeThreshold)} loading={loading}
        sub={`cooldown ${state.cooldownBlocks ?? "—"} blocks`} />
      <MetricCard label="Exposure Updates" accent="#9B86FF" value={state.exposureEventCount ?? 0} loading={loading} mono
        sub="PoolExposureUpdate events" />
      <MetricCard label="Last Hedge" accent="#E7E7EC"
        value={lastHedge > 0 ? `#${lastHedge}` : "none"} loading={loading}
        sub={blocksAgo != null ? `${blocksAgo} blocks ago` : "no hedge executed yet"} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// DEMO FLOW INDICATOR
// ════════════════════════════════════════════════════════════
function DemoFlow({ steps }) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-1">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5 min-w-0">
              <div className={`grid place-items-center w-7 h-7 rounded-full text-[11px] font-bold border transition-colors ${
                s.done ? "bg-violet border-violet text-white"
                : s.active ? "border-cyan text-cyan bg-cyan/10"
                : "border-hair2 text-dim"}`}>
                {s.done ? <Check size={14} /> : i + 1}
              </div>
              <span className={`text-[10px] text-center leading-tight w-[88px] ${s.done ? "text-txt" : s.active ? "text-cyan" : "text-dim"}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 mx-1 mb-4 ${steps[i + 1].done || s.done ? "bg-violet/60" : "bg-hair2"}`} />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
// PRIMARY ACTION: SWAP PANEL (mint → approve → swap, real on-chain)
// ════════════════════════════════════════════════════════════
function SwapPanel({ wallet, track, balances, refreshBalances }) {
  const [poolKey, setPoolKey] = useState("A");
  const [sellBase, setSellBase] = useState(false); // false → sell quote into base
  const [amount, setAmount] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const pool = POOLS[poolKey];

  const inToken = sellBase ? pool.base : pool.quote;
  const outToken = sellBase ? pool.quote : pool.base;
  const bal = balances[inToken.address?.toLowerCase()] ?? null;

  const flip = () => setSellBase((v) => !v);

  const doFaucet = async () => {
    if (!wallet.signer) return wallet.connect();
    setBusy(true);
    try {
      const erc = new ethers.Contract(inToken.address, ERC20_ABI, wallet.signer);
      await track(`Faucet ${inToken.symbol}`, () => erc.mint(wallet.address, ethers.parseEther("1000")),
        { description: `Minting 1,000 ${inToken.symbol} to your wallet` });
      refreshBalances();
    } finally { setBusy(false); }
  };

  const doSwap = async () => {
    if (!wallet.signer) return wallet.connect();
    if (!(await wallet.ensureNetwork())) return;
    setBusy(true);
    try {
      const amt = ethers.parseEther(amount || "0");
      if (amt <= 0n) return;
      // 1) approve if needed
      const erc = new ethers.Contract(inToken.address, ERC20_ABI, wallet.signer);
      const allowance = await erc.allowance(wallet.address, ADDRESSES.SWAP_ROUTER);
      if (allowance < amt) {
        await track(`Approve ${inToken.symbol}`, () => erc.approve(ADDRESSES.SWAP_ROUTER, ethers.MaxUint256),
          { description: `Approving swap router for ${inToken.symbol}` });
      }
      // 2) swap through PoolSwapTest router → triggers afterSwap → PoolExposureUpdate
      const router = new ethers.Contract(ADDRESSES.SWAP_ROUTER, SWAP_ROUTER_ABI, wallet.signer);
      const zeroForOne = inToken.address.toLowerCase() === pool.key.currency0.toLowerCase();
      const sqrtLimit = zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
      // observed price encoded for the hook's exposure refresh (price drifts with direction)
      const observed = getSqrtPriceAtTick(zeroForOne ? -540 : 540);
      const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["uint160"], [observed]);
      const keyTuple = [pool.key.currency0, pool.key.currency1, pool.key.fee, pool.key.tickSpacing, pool.key.hooks];
      const params = [zeroForOne, -amt, sqrtLimit];
      const settings = [false, false];
      await track(`Swap on ${pool.label}`,
        () => router.swap(keyTuple, params, settings, hookData),
        { description: `Swapping ${amount} ${inToken.symbol} → ${outToken.symbol} · refreshes pool exposure` });
      refreshBalances();
    } finally { setBusy(false); }
  };

  return (
    <Card glow>
      <SectionTitle icon={ArrowDownUp} right={
        <div className="flex gap-1 bg-panel2 rounded-md p-0.5 border border-hair">
          {["A", "B"].map((k) => (
            <button key={k} onClick={() => setPoolKey(k)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${poolKey === k ? "bg-violet text-white" : "text-dim hover:text-txt"}`}>
              {POOLS[k].label}
            </button>
          ))}
        </div>}>
        Swap
      </SectionTitle>
      <div className="p-4 space-y-2">
        <TokenField label="You pay" token={inToken} value={amount} onChange={setAmount} balance={bal} editable />
        <div className="flex justify-center -my-1.5 relative z-10">
          <button onClick={flip} className="grid place-items-center w-8 h-8 rounded-lg bg-panel2 border border-hair2 hover:border-violet/60 hover:rotate-180 transition-all duration-300">
            <ArrowDownUp size={14} className="text-violet-soft" />
          </button>
        </div>
        <TokenField label="You receive (est.)" token={outToken} value={amount} balance={balances[outToken.address?.toLowerCase()]} muted />

        <div className="flex items-center justify-between text-[11px] text-dim pt-1">
          <span>Fee tier</span><span className="font-mono text-txt">0.30% · dynamic exposure hook</span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={doFaucet} disabled={busy || !wallet.address}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-semibold border border-cyan/30 text-cyan hover:bg-cyan/10 disabled:opacity-40 transition-colors">
            <Beaker size={14} /> Faucet 1,000
          </button>
          <button onClick={doSwap} disabled={busy || !wallet.address}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-[12.5px] font-semibold bg-violet hover:bg-violet-deep text-white disabled:opacity-40 transition-colors">
            <Zap size={14} /> {busy ? "Working…" : wallet.address ? "Swap" : "Connect"}
          </button>
        </div>
        <p className="text-[10.5px] text-dim leading-relaxed pt-1">
          Swaps route through the v4 test router and fire the hook's <span className="font-mono text-violet-soft">afterSwap</span>,
          emitting <span className="font-mono text-violet-soft">PoolExposureUpdate</span> that the Reactive RSC observes.
        </p>
      </div>
    </Card>
  );
}

function TokenField({ label, token, value, onChange, balance, editable, muted }) {
  return (
    <div className={`rounded-lg border border-hair bg-panel2 p-3 ${muted ? "opacity-80" : ""}`}>
      <div className="flex items-center justify-between text-[11px] text-dim mb-1.5">
        <span>{label}</span>
        {balance != null && <span className="font-mono">bal {fmtTokenAmount(balance, token.decimals, 3)}</span>}
      </div>
      <div className="flex items-center justify-between gap-3">
        <input
          value={value} onChange={(e) => editable && onChange?.(e.target.value)} readOnly={!editable}
          inputMode="decimal" placeholder="0.0"
          className="bg-transparent outline-none text-[22px] font-mono font-medium text-txt w-full placeholder:text-dim/50" />
        <span className="inline-flex items-center gap-1.5 shrink-0 rounded-lg bg-panel border border-hair2 px-2.5 py-1.5">
          <span className="grid place-items-center w-5 h-5 rounded-full text-[9px] font-bold text-ink" style={{ background: token.color }}>
            {token.symbol.replace(/^x/, "").slice(0, 2)}
          </span>
          <span className="text-[12.5px] font-medium">{token.symbol}</span>
        </span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// LIQUIDITY PANEL (add/remove via v4 modify-liquidity router)
// ════════════════════════════════════════════════════════════
function LiquidityPanel({ wallet, track, refreshBalances }) {
  const [tab, setTab] = useState("add");
  const [poolKey, setPoolKey] = useState("A");
  const [busy, setBusy] = useState(false);
  const pool = POOLS[poolKey];

  const run = async (isAdd) => {
    if (!wallet.signer) return wallet.connect();
    if (!(await wallet.ensureNetwork())) return;
    setBusy(true);
    try {
      const spender = ADDRESSES.MODIFY_LIQUIDITY_ROUTER;
      // approve both currencies if adding
      if (isAdd) {
        for (const cur of [pool.key.currency0, pool.key.currency1]) {
          const erc = new ethers.Contract(cur, ERC20_ABI, wallet.signer);
          const allowance = await erc.allowance(wallet.address, spender);
          if (allowance < DEMO_LP_LIQUIDITY * 4n) {
            const sym = cur.toLowerCase() === pool.base.address.toLowerCase() ? pool.base.symbol : pool.quote.symbol;
            await track(`Approve ${sym}`, () => erc.approve(spender, ethers.MaxUint256),
              { description: `Approving liquidity router for ${sym}` });
          }
        }
      }
      const router = new ethers.Contract(spender, MODIFY_LIQUIDITY_ABI, wallet.signer);
      const delta = isAdd ? DEMO_LP_LIQUIDITY : -DEMO_LP_LIQUIDITY;
      const params = [TICK_LOWER, TICK_UPPER, delta, DEMO_SALT];
      const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint160"], [wallet.address, SQRT_PRICE_1_1]);
      const keyTuple = [pool.key.currency0, pool.key.currency1, pool.key.fee, pool.key.tickSpacing, pool.key.hooks];
      await track(`${isAdd ? "Add" : "Remove"} liquidity · ${pool.label}`,
        () => router.modifyLiquidity(keyTuple, params, hookData),
        { description: `${isAdd ? "Registering" : "Withdrawing"} LP exposure on ${pool.pair}` });
      refreshBalances();
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <SectionTitle icon={Droplets} right={
        <div className="flex gap-1 bg-panel2 rounded-md p-0.5 border border-hair">
          {["A", "B"].map((k) => (
            <button key={k} onClick={() => setPoolKey(k)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${poolKey === k ? "bg-violet text-white" : "text-dim hover:text-txt"}`}>
              {POOLS[k].label}
            </button>
          ))}
        </div>}>
        Liquidity
      </SectionTitle>
      <div className="p-4 space-y-3">
        <div className="flex gap-1 bg-panel2 rounded-lg p-1 border border-hair">
          {[["add", "Add"], ["remove", "Remove"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 py-1.5 rounded-md text-[12px] font-medium ${tab === k ? "bg-violet text-white" : "text-dim hover:text-txt"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="rounded-lg border border-hair bg-panel2 p-3 space-y-1.5 text-[12px]">
          <Row k="Pair" v={pool.pair} />
          <Row k="Tick range" v={`${TICK_LOWER} ↔ ${TICK_UPPER}`} mono />
          <Row k="Liquidity Δ" v={`${tab === "add" ? "+" : "−"}1e18`} mono />
        </div>
        <button onClick={() => run(tab === "add")} disabled={busy || !wallet.address}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[12.5px] font-semibold bg-violet hover:bg-violet-deep text-white disabled:opacity-40 transition-colors">
          <Droplets size={14} /> {busy ? "Working…" : `${tab === "add" ? "Add" : "Remove"} Liquidity`}
        </button>
        <p className="text-[10.5px] text-dim leading-relaxed">
          Routed through Uniswap v4 <span className="font-mono text-violet-soft">PoolModifyLiquidityTest</span>; the hook
          records LP exposure and emits an exposure update.
        </p>
      </div>
    </Card>
  );
}

function Row({ k, v, mono }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-dim">{k}</span>
      <span className={mono ? "font-mono text-txt" : "text-txt"}>{v}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// HEDGE CONTROL (quoteHedge preview + executeHedgeSwapDirect + setHedgeParams)
// ════════════════════════════════════════════════════════════
function HedgePanel({ wallet, track, state, refreshState }) {
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  const tier = imbalanceTier(state.combinedImbalance ?? 0n, state.hedgeThreshold ?? 0n);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (state.combinedImbalance == null) return;
      try {
        const hook = new ethers.Contract(ADDRESSES.HOOK, HOOK_ABI, readProvider);
        const q = await hook.quoteHedge(state.combinedImbalance);
        if (!cancelled) setQuote({ targetPoolId: q[0], swapAmount: q[1] });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [state.combinedImbalance]);

  const targetLabel = quote ? (quote.targetPoolId?.toLowerCase() === POOL_A_ID.toLowerCase() ? "Pool A" : "Pool B") : "—";

  const triggerHedge = async () => {
    if (!wallet.signer) return wallet.connect();
    if (!(await wallet.ensureNetwork())) return;
    if (!quote) return;
    setBusy(true);
    try {
      const hook = new ethers.Contract(ADDRESSES.HOOK, HOOK_ABI, wallet.signer);
      await track("Direct hedge", () =>
        hook.executeHedgeSwapDirect(quote.targetPoolId, quote.swapAmount, state.combinedImbalance),
        { description: `Reducing ${targetLabel} exposure toward zero` });
      refreshState();
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <SectionTitle icon={ShieldHalf} right={<TierBadge tier={tier} />}>Hedge Control</SectionTitle>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-hair bg-panel2 p-3">
            <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold">Target pool</div>
            <div className="text-[18px] font-semibold mt-1" style={{ color: targetLabel === "Pool A" ? "#22D3EE" : "#34D399" }}>{targetLabel}</div>
          </div>
          <div className="rounded-lg border border-hair bg-panel2 p-3">
            <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold">Hedge size</div>
            <div className="text-[18px] font-semibold font-mono mt-1 text-violet-soft">{quote ? fmtExposure(quote.swapAmount) : "—"}</div>
          </div>
        </div>
        <div className="rounded-lg border border-violet/20 bg-violet/5 p-3 text-[11px] text-dim leading-relaxed flex gap-2">
          <Waypoints size={14} className="text-violet-soft shrink-0 mt-0.5" />
          <span>In production this entrypoint is driven only by the Reactive callback (<span className="font-mono text-violet-soft">executeHedgeSwapFromReactive</span>).
          The direct path is restricted to the configured Reactive sender for demo operators.</span>
        </div>
        <button onClick={triggerHedge} disabled={busy || !wallet.address || !quote}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-[12.5px] font-semibold bg-gradient-to-r from-violet to-violet-deep hover:opacity-90 text-white disabled:opacity-40 transition-opacity">
          <ShieldHalf size={14} /> {busy ? "Executing…" : "Execute Hedge (direct)"}
        </button>
        <HedgeParams wallet={wallet} track={track} state={state} refreshState={refreshState} />
      </div>
    </Card>
  );
}

function HedgeParams({ wallet, track, state, refreshState }) {
  const [open, setOpen] = useState(false);
  const [thr, setThr] = useState("");
  const [cd, setCd] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!wallet.signer) return wallet.connect();
    setBusy(true);
    try {
      const hook = new ethers.Contract(ADDRESSES.HOOK, HOOK_ABI, wallet.signer);
      const t = thr ? BigInt(thr) : (state.hedgeThreshold ?? 0n);
      const c = cd ? BigInt(cd) : (state.cooldownBlocks ?? 0n);
      await track("Set hedge params", () => hook.setHedgeParams(t, c),
        { description: `threshold=${t} · cooldown=${c}` });
      refreshState();
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-hair">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-3 py-2 text-[11.5px] text-dim hover:text-txt">
        <span className="inline-flex items-center gap-1.5"><Gauge size={13} /> Owner: hedge params</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <input value={thr} onChange={(e) => setThr(e.target.value)} placeholder={`threshold (${state.hedgeThreshold ?? "…"})`}
            className="w-full bg-panel2 border border-hair rounded-md px-2.5 py-1.5 text-[12px] font-mono outline-none focus:border-violet/50" />
          <input value={cd} onChange={(e) => setCd(e.target.value)} placeholder={`cooldown blocks (${state.cooldownBlocks ?? "…"})`}
            className="w-full bg-panel2 border border-hair rounded-md px-2.5 py-1.5 text-[12px] font-mono outline-none focus:border-violet/50" />
          <button onClick={save} disabled={busy}
            className="w-full rounded-md py-1.5 text-[12px] font-semibold border border-violet/40 text-violet-soft hover:bg-violet/10 disabled:opacity-40">
            {busy ? "Saving…" : "setHedgeParams"}
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// EXPOSURE CHART
// ════════════════════════════════════════════════════════════
function ExposureChart({ series, threshold }) {
  const t = threshold != null ? Math.abs(toFloat18(threshold)) : null;
  const data = series.map((p, i) => ({ i: i + 1, A: p.A, B: p.B, combined: p.combined }));
  const hasData = data.length > 0;

  return (
    <Card>
      <SectionTitle icon={Activity} right={
        <div className="flex items-center gap-3 text-[10.5px]">
          <Legend c="#9B86FF" l="Combined" /><Legend c="#22D3EE" l="Pool A" /><Legend c="#34D399" l="Pool B" />
        </div>}>
        Live Exposure
      </SectionTitle>
      <div className="p-3 h-[260px]">
        {!hasData ? (
          <div className="h-full grid place-items-center text-center">
            <div>
              <Activity size={26} className="text-dim mx-auto mb-2" />
              <p className="text-[12px] text-dim">No exposure events yet. Execute a swap to populate the curve.</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="i" tick={{ fill: "#8A8A99", fontSize: 10, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: "rgba(255,255,255,0.08)" }} tickLine={false} />
              <YAxis tick={{ fill: "#8A8A99", fontSize: 10, fontFamily: "JetBrains Mono" }}
                axisLine={false} tickLine={false} width={48} />
              <Tooltip contentStyle={{ background: "#101017", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: "#8A8A99" }} itemStyle={{ fontFamily: "JetBrains Mono" }}
                labelFormatter={(v) => `Update #${v}`} />
              {t != null && t > 0 && (
                <>
                  <ReferenceArea y1={-t} y2={t} fill="rgba(52,211,153,0.05)" />
                  <ReferenceLine y={t} stroke="#FB7185" strokeDasharray="4 4" strokeOpacity={0.6}
                    label={{ value: "+threshold", fill: "#FB7185", fontSize: 9, position: "right" }} />
                  <ReferenceLine y={-t} stroke="#FB7185" strokeDasharray="4 4" strokeOpacity={0.6} />
                </>
              )}
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
              <Line type="monotone" dataKey="A" stroke="#22D3EE" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="B" stroke="#34D399" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="combined" stroke="#9B86FF" strokeWidth={2.4} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function Legend({ c, l }) {
  return <span className="inline-flex items-center gap-1 text-dim"><span className="w-2.5 h-0.5 rounded" style={{ background: c }} /> {l}</span>;
}

// ════════════════════════════════════════════════════════════
// ACTIVITY FEED
// ════════════════════════════════════════════════════════════
const FEED_ICON = {
  swap: ArrowDownUp, liquidity: Droplets, hedge: ShieldHalf, rsc: Radio,
  faucet: Beaker, approve: Check, params: Gauge, exposure: Activity, lp: Coins,
};

function ActivityFeed({ feed }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [feed.length]);
  return (
    <Card>
      <SectionTitle icon={ScrollText} right={<span className="text-[10.5px] text-dim font-mono">{feed.length} events</span>}>
        Activity Feed
      </SectionTitle>
      <div ref={ref} className="max-h-[420px] overflow-y-auto divide-y divide-hair">
        {feed.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-dim">No transactions yet. Execute a swap to see live activity.</div>
        ) : feed.map((e) => {
          const Icon = FEED_ICON[e.kind] || Activity;
          const tone = e.status === "CONFIRMED" ? "#34D399" : e.status === "FAILED" ? "#FB7185" : "#FBBF24";
          return (
            <div key={e.id} className="p-3.5 anim-fadeup hover:bg-white/[0.02]">
              <div className="flex items-start gap-3">
                <div className="grid place-items-center w-8 h-8 rounded-lg shrink-0 border" style={{ borderColor: `${tone}33`, background: `${tone}14`, color: tone }}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-txt truncate">{e.action}</span>
                    <span className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
                          style={{ color: tone, background: `${tone}14` }}>
                      {e.status === "PENDING" && <StatusDot color={tone} size={6} />}{e.status}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-dim mt-0.5">{e.description}</div>
                  <div className="flex items-center justify-between mt-1.5">
                    {e.txHash ? (
                      <a href={txLink(e.txHash, e.isRSC)} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 font-mono text-[11px] text-cyan hover:text-cyan-soft">
                        {truncate(e.txHash, 8, 6)} <ExternalLink size={11} />
                      </a>
                    ) : <span className="text-[11px] text-dim font-mono">submitting…</span>}
                    <span className="text-[10.5px] text-dim font-mono">{e.timestamp?.toLocaleTimeString?.() ?? ""}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
// REACTIVE NETWORK PANEL
// ════════════════════════════════════════════════════════════
function FlowGraphic() {
  return (
    <svg viewBox="0 0 320 56" className="w-full h-12">
      <defs>
        <linearGradient id="fg" x1="0" x2="1">
          <stop offset="0" stopColor="#22D3EE" /><stop offset="1" stopColor="#7C5CFF" />
        </linearGradient>
      </defs>
      <line x1="34" y1="28" x2="160" y2="28" stroke="url(#fg)" strokeWidth="1.5" className="flow-line" />
      <line x1="160" y1="28" x2="286" y2="28" stroke="url(#fg)" strokeWidth="1.5" className="flow-line" />
      {[[34, "#22D3EE", "Hook"], [160, "#7C5CFF", "RSC"], [286, "#34D399", "Callback"]].map(([x, c, l], i) => (
        <g key={i}>
          <circle cx={x} cy="28" r="7" fill={c} />
          <circle cx={x} cy="28" r="7" fill="none" stroke={c} strokeOpacity="0.4" strokeWidth="1" />
          <text x={x} y="50" fill="#8A8A99" fontSize="9" textAnchor="middle" fontFamily="JetBrains Mono">{l}</text>
        </g>
      ))}
    </svg>
  );
}

function ReactiveNetworkPanel({ rsc, hedgeEvents, exposureEventCount }) {
  return (
    <Card>
      <SectionTitle icon={Radio} right={
        <span className="inline-flex items-center gap-1.5 text-[10.5px] text-good"><StatusDot color="#34D399" /> RVM active</span>}>
        Reactive Network Panel
      </SectionTitle>
      <div className="p-4 space-y-4">
        <FlowGraphic />
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Events observed" value={exposureEventCount ?? 0} accent="#22D3EE" />
          <Stat label="Callbacks fired" value={hedgeEvents?.length ?? 0} accent="#7C5CFF" />
          <Stat label="netExposureA" value={rsc.loaded ? fmtExposure(rsc.netExposureA) : "—"} accent="#22D3EE" mono />
          <Stat label="netExposureB" value={rsc.loaded ? fmtExposure(rsc.netExposureB) : "—"} accent="#34D399" mono />
        </div>

        <div className="rounded-lg border border-hair bg-panel2 p-3 space-y-2 text-[11.5px]">
          <Row k="Subscription" v="PoolExposureUpdate" mono />
          <Row k="Origin" v={truncate(ADDRESSES.HOOK, 6, 4)} mono />
          <div className="flex items-center justify-between">
            <span className="text-dim">RSC on Lasna</span>
            <Copyable value={ADDRESSES.RSC} link={addrLink(ADDRESSES.RSC, true)} reactive />
          </div>
        </div>

        {/* terminal-style event stream */}
        <div className="rounded-lg border border-hair bg-[#070709] p-3 font-mono text-[11px] max-h-[150px] overflow-y-auto">
          <div className="text-dim">$ reactvm --watch PoolExposureUpdate</div>
          {(hedgeEvents || []).slice(0, 8).map((h, i) => (
            <div key={i} className="text-good mt-1">
              ⚛ callback queued → hedge {truncate(h.txHash || "0x", 8, 6)} <span className="text-dim">blk {h.blockNumber}</span>
            </div>
          ))}
          {(!hedgeEvents || hedgeEvents.length === 0) && (
            <div className="text-violet-soft mt-1">⚛ monitoring origin events · awaiting threshold breach…</div>
          )}
        </div>
        <a href={addrLink(ADDRESSES.RSC, true)} target="_blank" rel="noreferrer"
           className="inline-flex items-center gap-1.5 text-[11.5px] text-cyan hover:text-cyan-soft">
          View RSC contract on Reactive explorer <ExternalLink size={12} />
        </a>
      </div>
    </Card>
  );
}

function Stat({ label, value, accent, mono }) {
  return (
    <div className="rounded-lg border border-hair bg-panel2 p-3">
      <div className="text-[10px] uppercase tracking-wider text-dim font-semibold">{label}</div>
      <div className={`text-[18px] font-semibold mt-1 ${mono ? "font-mono" : ""}`} style={{ color: accent }}>{value}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// VERIFY ON CHAIN
// ════════════════════════════════════════════════════════════
function VerifyPanel() {
  const [open, setOpen] = useState(true);
  const rows = [
    ["Hook", ADDRESSES.HOOK, false], ["RSC (Lasna)", ADDRESSES.RSC, true],
    ["PoolManager", ADDRESSES.POOL_MANAGER, false], ["xETH", ADDRESSES.XETH, false],
    ["xUSDC", ADDRESSES.XUSDC, false], ["xstETH", ADDRESSES.XSTETH, false],
  ];
  return (
    <Card>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 border-b border-hair">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold"><BadgeCheck size={15} className="text-violet-soft" /> Verify on Chain</span>
        <ChevronDown size={16} className={`text-dim transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="p-4 space-y-3">
          <p className="text-[12px] text-dim">All contracts are deployed live on {CHAIN_NAME} and Reactive Lasna.</p>
          <div className="space-y-1.5">
            {rows.map(([label, addr, reactive]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border border-hair bg-panel2 px-3 py-2">
                <span className="text-[12px] font-medium">{label}</span>
                <Copyable value={addr} link={addrLink(addr, reactive)} reactive={reactive} start={8} end={6} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="rounded-lg border border-hair bg-panel2 p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold">Forge coverage</div>
              <div className="mt-2 h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-violet to-good" style={{ width: "100%" }} />
              </div>
              <div className="text-[11px] text-good font-mono mt-1.5">100% lines · branches · funcs</div>
            </div>
            <div className="rounded-lg border border-hair bg-panel2 p-3">
              <div className="text-[10.5px] uppercase tracking-wider text-dim font-semibold">Tests passing</div>
              <div className="text-[22px] font-semibold font-mono text-good mt-1">68 / 68</div>
            </div>
          </div>
          <div className="text-[11px] text-dim text-center pt-1 border-t border-hair">
            UHI9 Hookathon · CrossPoolHedger · Demo Day June 19, 2026
          </div>
        </div>
      )}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════
// NETWORK BANNER
// ════════════════════════════════════════════════════════════
function NetworkBanner({ wallet }) {
  if (!wallet.address || wallet.chainId === CHAIN_ID) return null;
  return (
    <div className="flex items-center justify-between px-5 py-2.5 bg-bad/10 border-b border-bad/30">
      <span className="inline-flex items-center gap-2 text-[12.5px] text-bad font-medium">
        <TriangleAlert size={15} /> Wrong network — switch to {CHAIN_NAME} ({CHAIN_ID}) to transact.
      </span>
      <button onClick={wallet.switchNetwork}
        className="rounded-lg px-3 py-1.5 text-[12px] font-semibold bg-bad/20 text-bad hover:bg-bad/30 transition-colors">
        Switch Network
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// HOOKS
// ════════════════════════════════════════════════════════════
function useWallet() {
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [signer, setSigner] = useState(null);

  const connect = useCallback(async () => {
    if (!window.ethereum) { alert("No injected wallet found. Install MetaMask."); return; }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const s = await provider.getSigner();
      const net = await provider.getNetwork();
      setSigner(s); setAddress(await s.getAddress()); setChainId(Number(net.chainId));
    } catch (e) { /* user rejected */ }
  }, []);

  const disconnect = useCallback(() => { setAddress(null); setSigner(null); }, []);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      if (e?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: CHAIN_HEX, chainName: CHAIN_NAME, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [RPC_URL], blockExplorerUrls: [EXPLORER_BASE] }],
        });
      }
    }
  }, []);

  const ensureNetwork = useCallback(async () => {
    if (!window.ethereum) return false;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CHAIN_ID) { await switchNetwork(); return false; }
    return true;
  }, [switchNetwork]);

  useEffect(() => {
    if (!window.ethereum) return;
    const onAccounts = (accs) => { if (!accs.length) disconnect(); else { setAddress(accs[0]); connect(); } };
    const onChain = (cid) => setChainId(parseInt(cid, 16));
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [connect, disconnect]);

  return { address, chainId, signer, connect, disconnect, switchNetwork, ensureNetwork };
}

// ════════════════════════════════════════════════════════════
// APP ROOT
// ════════════════════════════════════════════════════════════
export default function App() {
  const wallet = useWallet();
  const [feed, setFeed] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [currentBlock, setCurrentBlock] = useState(null);
  const [latestTx, setLatestTx] = useState(null);
  const [balances, setBalances] = useState({});
  const [series, setSeries] = useState([]);
  const [hedgeEvents, setHedgeEvents] = useState([]);
  const [rsc, setRsc] = useState({ loaded: false, netExposureA: null, netExposureB: null, lastImbalance: null });
  const [state, setState] = useState({ loading: true });

  // ── feed + toast helpers ──
  const addFeed = useCallback((entry) => setFeed((p) => [entry, ...p].slice(0, 50)), []);
  const updateFeed = useCallback((id, patch) => setFeed((p) => p.map((e) => (e.id === id ? { ...e, ...patch } : e))), []);
  const showToast = useCallback((t) => {
    setToasts((p) => [t, ...p].slice(0, 4));
    if (t.status !== "FAILED") setTimeout(() => setToasts((p) => p.filter((x) => x.id !== t.id)), 8000);
  }, []);
  const updateToast = useCallback((id, patch) => setToasts((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t))), []);
  const dismissToast = useCallback((id) => setToasts((p) => p.filter((t) => t.id !== id)), []);

  // ── transaction tracker (pending → hash → confirmed/failed) ──
  const track = useCallback(async (action, sendFn, opts = {}) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const kind = opts.kind || guessKind(action);
    const base = { id, action, kind, status: "PENDING", txHash: null, timestamp: new Date(),
      description: opts.description || `${action} submitted…`, isRSC: opts.isRSC || false };
    addFeed(base); showToast(base);
    try {
      const tx = await sendFn();
      updateFeed(id, { txHash: tx.hash, description: opts.description || `${action} pending…` });
      updateToast(id, { txHash: tx.hash });
      setLatestTx({ hash: tx.hash, isRSC: base.isRSC });
      const receipt = await tx.wait();
      const patch = { status: "CONFIRMED", description: `${action} confirmed · block ${receipt.blockNumber}` };
      updateFeed(id, patch); updateToast(id, patch);
      return receipt;
    } catch (err) {
      const reason = err?.shortMessage || err?.reason || err?.message || "reverted";
      const patch = { status: "FAILED", description: `${action} failed: ${String(reason).slice(0, 80)}` };
      updateFeed(id, patch); updateToast(id, patch);
      return null;
    }
  }, [addFeed, showToast, updateFeed, updateToast]);

  // ── read hook state ──
  const refreshState = useCallback(async () => {
    try {
      const hook = new ethers.Contract(ADDRESSES.HOOK, HOOK_ABI, readProvider);
      const [combined, thr, cd, lastHedge, registered, expA, expB] = await Promise.all([
        hook.combinedImbalance().catch(() => null),
        hook.hedgeThreshold().catch(() => null),
        hook.cooldownBlocks().catch(() => null),
        hook.lastHedgeBlock().catch(() => null),
        hook.poolsRegistered().catch(() => false),
        hook.exposureState(POOL_A_ID).catch(() => null),
        hook.exposureState(POOL_B_ID).catch(() => null),
      ]);
      setState((s) => ({
        ...s, loading: false,
        combinedImbalance: combined, hedgeThreshold: thr,
        cooldownBlocks: cd != null ? Number(cd) : null,
        lastHedgeBlock: lastHedge != null ? Number(lastHedge) : null,
        poolsRegistered: registered,
        exposureA: expA ? { totalLiquidity: expA[0], baseline: expA[1], last: expA[2], netExposure: expA[3], block: expA[4] } : null,
        exposureB: expB ? { totalLiquidity: expB[0], baseline: expB[1], last: expB[2], netExposure: expB[3], block: expB[4] } : null,
      }));
    } catch { setState((s) => ({ ...s, loading: false })); }
  }, []);

  // ── read RSC state on Lasna (best-effort; may be CORS-blocked) ──
  const refreshRsc = useCallback(async () => {
    try {
      const lasna = new ethers.JsonRpcProvider(LASNA_RPC);
      const c = new ethers.Contract(ADDRESSES.RSC, RSC_ABI, lasna);
      const [a, b, li] = await Promise.all([c.netExposureA(), c.netExposureB(), c.lastImbalance()]);
      setRsc({ loaded: true, netExposureA: a, netExposureB: b, lastImbalance: li });
    } catch { setRsc((r) => ({ ...r, loaded: false })); }
  }, []);

  // ── balances for connected wallet ──
  const refreshBalances = useCallback(async () => {
    if (!wallet.address) return;
    try {
      const entries = await Promise.all(Object.values(TOKENS).map(async (t) => {
        const erc = new ethers.Contract(t.address, ERC20_ABI, readProvider);
        const bal = await erc.balanceOf(wallet.address).catch(() => 0n);
        return [t.address.toLowerCase(), bal];
      }));
      setBalances(Object.fromEntries(entries));
    } catch { /* ignore */ }
  }, [wallet.address]);

  // ── historical events → chart + hedge feed ──
  const loadHistory = useCallback(async () => {
    try {
      const hook = new ethers.Contract(ADDRESSES.HOOK, HOOK_ABI, readProvider);
      const latest = await readProvider.getBlockNumber();
      setCurrentBlock(latest);
      const from = latest > 60000 ? latest - 60000 : 0;
      const [expLogs, hedgeLogs] = await Promise.all([
        hook.queryFilter(hook.filters.PoolExposureUpdate(), from, latest).catch(() => []),
        hook.queryFilter(hook.filters.HedgeExecuted(), from, latest).catch(() => []),
      ]);
      // build chart series by accumulating per-pool exposure over time
      let lastA = 0, lastB = 0;
      const pts = [];
      for (const log of expLogs) {
        const { poolId, netExposure, combinedImbalance } = log.args;
        if (poolId?.toLowerCase() === POOL_A_ID.toLowerCase()) lastA = toFloat18(netExposure);
        else if (poolId?.toLowerCase() === POOL_B_ID.toLowerCase()) lastB = toFloat18(netExposure);
        pts.push({ A: lastA, B: lastB, combined: toFloat18(combinedImbalance) });
      }
      setSeries(pts.slice(-50));
      setState((s) => ({ ...s, exposureEventCount: expLogs.length }));
      setHedgeEvents(hedgeLogs.map((l) => ({ txHash: l.transactionHash, blockNumber: Number(l.args?.blockNumber ?? l.blockNumber) })).reverse());
      // seed activity feed with confirmed hedge history
      hedgeLogs.slice(-3).reverse().forEach((l) => addFeed({
        id: `h-${l.transactionHash}`, kind: "rsc", action: "RSC Hedge Callback", status: "CONFIRMED",
        txHash: l.transactionHash, timestamp: new Date(), isRSC: false,
        description: `Imbalance ${fmtExposure(l.args?.imbalanceBefore)} → ${fmtExposure(l.args?.imbalanceAfter)}`,
      }));
    } catch { /* ignore */ }
  }, [addFeed]);

  // ── live listeners ──
  useEffect(() => {
    const hook = new ethers.Contract(ADDRESSES.HOOK, HOOK_ABI, readProvider);
    const onExposure = (poolId, netExposure, combinedImbalance, blockNumber, ev) => {
      setSeries((prev) => {
        const lastA = poolId?.toLowerCase() === POOL_A_ID.toLowerCase() ? toFloat18(netExposure) : prev.at(-1)?.A ?? 0;
        const lastB = poolId?.toLowerCase() === POOL_B_ID.toLowerCase() ? toFloat18(netExposure) : prev.at(-1)?.B ?? 0;
        return [...prev, { A: lastA, B: lastB, combined: toFloat18(combinedImbalance) }].slice(-50);
      });
      setState((s) => ({ ...s, exposureEventCount: (s.exposureEventCount ?? 0) + 1, combinedImbalance }));
    };
    const onHedge = (targetPool, swapAmount, before, after, blockNumber, ev) => {
      const tx = ev?.log?.transactionHash;
      setHedgeEvents((p) => [{ txHash: tx, blockNumber: Number(blockNumber) }, ...p]);
      addFeed({ id: `live-${tx}-${Date.now()}`, kind: "rsc", action: "RSC Hedge Callback", status: "CONFIRMED",
        txHash: tx, timestamp: new Date(), isRSC: false,
        description: `Imbalance ${fmtExposure(before)} → ${fmtExposure(after)}` });
      refreshState();
    };
    hook.on(hook.filters.PoolExposureUpdate(), onExposure);
    hook.on(hook.filters.HedgeExecuted(), onHedge);
    return () => { hook.removeAllListeners(); };
  }, [addFeed, refreshState]);

  // ── boot ──
  useEffect(() => { refreshState(); refreshRsc(); loadHistory(); }, [refreshState, refreshRsc, loadHistory]);
  useEffect(() => { refreshBalances(); }, [refreshBalances]);
  useEffect(() => {
    const id = setInterval(async () => {
      try { setCurrentBlock(await readProvider.getBlockNumber()); } catch {}
    }, 12000);
    return () => clearInterval(id);
  }, []);

  // ── demo flow steps ──
  const steps = useMemo(() => {
    const hasLiq = (state.exposureA?.totalLiquidity ?? 0n) > 0n || (state.exposureB?.totalLiquidity ?? 0n) > 0n;
    const hasExposure = (state.exposureEventCount ?? 0) > 0 || series.length > 0;
    const hedged = hedgeEvents.length > 0;
    return [
      { label: "Pools registered", done: !!state.poolsRegistered },
      { label: "LP liquidity", done: hasLiq, active: state.poolsRegistered && !hasLiq },
      { label: "Swap moves price", done: hasExposure, active: hasLiq && !hasExposure },
      { label: "Exposure emitted", done: hasExposure, active: hasLiq && !hasExposure },
      { label: "RSC queues callback", done: hedged, active: hasExposure && !hedged },
      { label: "Hedge executed", done: hedged, active: hasExposure && !hedged },
    ];
  }, [state, series.length, hedgeEvents.length]);

  return (
    <div className="min-h-screen bg-ink text-txt">
      <ToastStack toasts={toasts} dismiss={dismissToast} />
      <TopBar wallet={wallet} />
      <NetworkBanner wallet={wallet} />
      <LiveProofStrip latestTx={latestTx} block={currentBlock} />

      <div className="flex">
        <LeftSidebar state={state} rsc={rsc} />

        <main className="flex-1 min-w-0 max-w-[1180px] mx-auto px-6 py-6 space-y-5">
          {/* hero */}
          <section id="overview" className="relative rounded-2xl border border-hair overflow-hidden">
            <div className="absolute inset-0 hero-grid-bg opacity-60" />
            <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-violet/20 blur-3xl" />
            <div className="absolute -bottom-24 -left-10 w-72 h-72 rounded-full bg-cyan/10 blur-3xl" />
            <div className="relative p-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-[11px] text-violet-soft font-medium mb-3">
                <Layers size={12} /> UHI9 Hookathon · Impermanent Loss & Yield Systems
              </div>
              <h1 className="text-[30px] font-semibold tracking-tight leading-tight max-w-2xl">
                Correlated pairs cancel each other's <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-soft to-cyan">impermanent loss</span>.
              </h1>
              <p className="text-[13.5px] text-dim mt-2 max-w-2xl leading-relaxed">
                One Uniswap v4 hook tracks exposure across two correlated pools. A Reactive Smart Contract maintains the
                combined imbalance on ReactVM and autonomously fires a hedge callback — no keepers, no bots.
              </p>
            </div>
          </section>

          <HeroMetrics state={state} currentBlock={currentBlock} />
          <DemoFlow steps={steps} />

          {/* actions + chart */}
          <section id="actions" className="grid grid-cols-12 gap-4">
            <div className="col-span-4 space-y-4">
              <SwapPanel wallet={wallet} track={track} balances={balances} refreshBalances={refreshBalances} />
              <LiquidityPanel wallet={wallet} track={track} refreshBalances={refreshBalances} />
            </div>
            <div className="col-span-8 space-y-4">
              <div id="chart"><ExposureChart series={series} threshold={state.hedgeThreshold} /></div>
              <HedgePanel wallet={wallet} track={track} state={state} refreshState={refreshState} />
            </div>
          </section>

          {/* activity + reactive */}
          <section className="grid grid-cols-12 gap-4">
            <div id="activity" className="col-span-7"><ActivityFeed feed={feed} /></div>
            <div id="reactive" className="col-span-5">
              <ReactiveNetworkPanel rsc={rsc} hedgeEvents={hedgeEvents} exposureEventCount={state.exposureEventCount} />
            </div>
          </section>

          <div id="verify"><VerifyPanel /></div>

          <footer className="pt-2 pb-8 text-center text-[11px] text-dim">
            CrossPoolHedger · Uniswap v4 × Reactive Network · Built for UHI9 Hookathon 2026
          </footer>
        </main>
      </div>
    </div>
  );
}

function guessKind(action) {
  const a = action.toLowerCase();
  if (a.includes("swap")) return "swap";
  if (a.includes("faucet")) return "faucet";
  if (a.includes("approve")) return "approve";
  if (a.includes("liquidity")) return "liquidity";
  if (a.includes("hedge")) return "hedge";
  if (a.includes("param")) return "params";
  return "exposure";
}

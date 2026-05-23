// Phase 5: regime-adaptive bidirectional. A single "strategy" that picks
// long or short based on a higher-timeframe trend. We run BOTH train and test
// so we can immediately see whether the OOS PnL stays positive.

import { loadOrFetch } from "./cache.js";
import { runStrategy, expectedValue } from "./engine.js";
import { FEES } from "./config.js";
import { ema } from "./indicators.js";

const SYMBOL = "SUIUSDT";
const INTERVAL = "1m";
const TOTAL_DAYS = 30;
const TRAIN_FRAC = 2 / 3;
const FEE = FEES.futuresMakerRoundTrip;
const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

function buildCtx(candles) {
  const closes = candles.map((c) => c.close);
  return {
    candles,
    closes,
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    ema480: ema(closes, 480), // ~8h trend
    ema1440: ema(closes, 1440), // ~1d trend
  };
}

// Regime is determined by a slow EMA. We then enter a short-term trade in the
// direction of the regime ONLY when the fast EMA (50) also agrees, to avoid
// counter-trend entries.

function makeRegimeStrategy({ slowEma, tp, sl }) {
  const stratLong = {
    side: "long",
    tp,
    sl,
    shouldEnter: (i, ctx) =>
      ctx.ema50[i] != null &&
      ctx[slowEma][i] != null &&
      ctx.closes[i] > ctx.ema50[i] &&
      ctx.closes[i] > ctx[slowEma][i],
  };
  const stratShort = {
    side: "short",
    tp,
    sl,
    shouldEnter: (i, ctx) =>
      ctx.ema50[i] != null &&
      ctx[slowEma][i] != null &&
      ctx.closes[i] < ctx.ema50[i] &&
      ctx.closes[i] < ctx[slowEma][i],
  };
  return { stratLong, stratShort };
}

function combinedEval(name, { stratLong, stratShort }, candles, ctx, startIdx, endIdx, days) {
  const L = runStrategy(candles, ctx, stratLong, { startIdx, endIdx });
  const S = runStrategy(candles, ctx, stratShort, { startIdx, endIdx });
  const evL = expectedValue(L.winRatePess, stratLong.tp, stratLong.sl, FEE);
  const evS = expectedValue(S.winRatePess, stratShort.tp, stratShort.sl, FEE);
  const pnlL = L.resolved * evL;
  const pnlS = S.resolved * evS;
  return {
    name,
    longTr: L.resolved,
    longWin: L.winRatePess,
    longPnl: pnlL,
    shortTr: S.resolved,
    shortWin: S.winRatePess,
    shortPnl: pnlS,
    totalTr: L.resolved + S.resolved,
    totalPnl: pnlL + pnlS,
    pnlPerDay: (pnlL + pnlS) / days,
  };
}

async function main() {
  console.log(`\nPhase 5: regime-adaptive bidirectional — ${SYMBOL}\n`);
  const candles = await loadOrFetch(SYMBOL, INTERVAL, TOTAL_DAYS, 30);
  const split = Math.floor(candles.length * TRAIN_FRAC);
  const ctx = buildCtx(candles);
  const trainStart = 1440;
  const trainEnd = split - 1;
  const testStart = split;
  const testEnd = candles.length - 1;
  const trainDays = (candles[trainEnd].closeTime - candles[trainStart].openTime) / 86_400_000;
  const testDays = (candles[testEnd].closeTime - candles[testStart].openTime) / 86_400_000;
  console.log(`  train: ${trainDays.toFixed(1)} days   test: ${testDays.toFixed(1)} days`);
  console.log(`  Direction picked by fast EMA50 AND slow regime EMA agreeing.\n`);

  const variants = [];
  for (const slowEma of ["ema200", "ema480", "ema1440"]) {
    for (const [tp, sl] of [
      [0.005, 0.01],
      [0.007, 0.007],
      [0.006, 0.008],
      [0.01, 0.005],
      [0.008, 0.008],
    ]) {
      variants.push({
        label: `${slowEma} | TP ${fmtPct(tp)} / SL ${fmtPct(sl)}`,
        strats: makeRegimeStrategy({ slowEma, tp, sl }),
      });
    }
  }

  const rows = [];
  for (const v of variants) {
    const train = combinedEval(v.label, v.strats, candles, ctx, trainStart, trainEnd, trainDays);
    const test = combinedEval(v.label, v.strats, candles, ctx, testStart, testEnd, testDays);
    rows.push({
      Variant: v.label,
      "Tr Tr": train.totalTr,
      "Tr PnL": fmtPct(train.totalPnl),
      "Tr /day": fmtPct(train.pnlPerDay),
      "Te Tr": test.totalTr,
      "Te PnL": fmtPct(test.totalPnl),
      "Te /day": fmtPct(test.pnlPerDay),
      "Both >0": train.totalPnl > 0 && test.totalPnl > 0 ? "YES" : "no",
    });
  }
  rows.sort((a, b) => parseFloat(b["Te PnL"]) - parseFloat(a["Te PnL"]));
  console.table(rows);

  // Pick best variant where both train and test are positive
  const robust = rows.filter((r) => r["Both >0"] === "YES");
  console.log(`\n${robust.length} of ${rows.length} variants are profitable on BOTH train and test.\n`);
  if (robust.length === 0) {
    console.log("No regime-adaptive variant survived. Honest conclusion: no edge here.\n");
    return;
  }
  const best = robust[0];
  console.log(`Best surviving variant: ${best.Variant}\n`);

  // Reconstruct the best strategy and print its trade-level detail
  const m = best.Variant.match(/^(\w+) \| TP ([\d.]+)% \/ SL ([\d.]+)%/);
  const slowEma = m[1];
  const tp = parseFloat(m[2]) / 100;
  const sl = parseFloat(m[3]) / 100;
  const { stratLong, stratShort } = makeRegimeStrategy({ slowEma, tp, sl });
  const Lte = runStrategy(candles, ctx, stratLong, { startIdx: testStart, endIdx: testEnd });
  const Ste = runStrategy(candles, ctx, stratShort, { startIdx: testStart, endIdx: testEnd });
  const allTrades = [...Lte.trades, ...Ste.trades]
    .filter((t) => t.resolved)
    .sort((a, b) => a.entryTime - b.entryTime);
  const byDay = new Map();
  for (const t of allTrades) {
    const day = new Date(t.entryTime).toISOString().slice(0, 10);
    const r = t.outcomePess === "win" ? tp - FEE : -(sl + FEE);
    if (!byDay.has(day)) byDay.set(day, { pnl: 0, trades: 0, wins: 0 });
    const d = byDay.get(day);
    d.pnl += r;
    d.trades += 1;
    if (t.outcomePess === "win") d.wins += 1;
  }
  console.log("Test-set daily PnL for best variant:\n");
  let cum = 0;
  const tbl = [...byDay.entries()].sort().map(([day, d]) => {
    cum += d.pnl;
    return {
      Day: day,
      Trades: d.trades,
      Wins: d.wins,
      "Win%": fmtPct(d.wins / d.trades),
      "PnL %": fmtPct(d.pnl),
      "Cum %": fmtPct(cum),
    };
  });
  console.table(tbl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

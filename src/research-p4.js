// Phase 4: out-of-sample validation. Run the 4 best candidates from Phase 3
// against the held-out test window (last ~10 days) AND the full window for
// comparison. If the OOS PnL is positive and the strategy survives, we ship.

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
    ema30: ema(closes, 30),
    ema50: ema(closes, 50),
  };
}

const CANDIDATES = [
  {
    name: "A: long 1.0/0.5 ema50_up",
    side: "long",
    tp: 0.01,
    sl: 0.005,
    shouldEnter: (i, ctx) => ctx.ema50[i] != null && ctx.closes[i] > ctx.ema50[i],
  },
  {
    name: "B: long 0.5/1.0 ema30_up (original shape)",
    side: "long",
    tp: 0.005,
    sl: 0.01,
    shouldEnter: (i, ctx) => ctx.ema30[i] != null && ctx.closes[i] > ctx.ema30[i],
  },
  {
    name: "C: long 0.5/1.0 ema50_up",
    side: "long",
    tp: 0.005,
    sl: 0.01,
    shouldEnter: (i, ctx) => ctx.ema50[i] != null && ctx.closes[i] > ctx.ema50[i],
  },
  {
    name: "D-long: long 0.6/1.0 ema50_up",
    side: "long",
    tp: 0.006,
    sl: 0.01,
    shouldEnter: (i, ctx) => ctx.ema50[i] != null && ctx.closes[i] > ctx.ema50[i],
  },
  {
    name: "D-short: short 0.6/1.0 ema50_dn",
    side: "short",
    tp: 0.006,
    sl: 0.01,
    shouldEnter: (i, ctx) => ctx.ema50[i] != null && ctx.closes[i] < ctx.ema50[i],
  },
];

function evaluate(strategy, candles, ctx, startIdx, endIdx) {
  const s = runStrategy(candles, ctx, strategy, { startIdx, endIdx });
  const ev = expectedValue(s.winRatePess, strategy.tp, strategy.sl, FEE);
  const totalPnl = s.resolved * ev;
  return {
    trades: s.resolved,
    winRate: s.winRatePess,
    avgMin: s.avgMinutes,
    evPerTrade: ev,
    totalPnl,
    selectivity: s.selectivity,
    trades_obj: s.trades,
  };
}

function dailyPnlSeries(trades, tp, sl) {
  const byDay = new Map();
  for (const t of trades) {
    if (!t.resolved) continue;
    const day = new Date(t.entryTime).toISOString().slice(0, 10);
    const win = t.outcomePess === "win";
    const r = win ? tp - FEE : -(sl + FEE);
    byDay.set(day, (byDay.get(day) ?? 0) + r);
  }
  return [...byDay.entries()].sort();
}

async function main() {
  console.log(`\nPhase 4: out-of-sample validation — ${SYMBOL}\n`);
  const candles = await loadOrFetch(SYMBOL, INTERVAL, TOTAL_DAYS, 30);
  const split = Math.floor(candles.length * TRAIN_FRAC);
  const ctx = buildCtx(candles);
  const trainStart = 200;
  const trainEnd = split - 1;
  const testStart = split;
  const testEnd = candles.length - 1;
  const trainDays = (candles[trainEnd].closeTime - candles[trainStart].openTime) / 86_400_000;
  const testDays = (candles[testEnd].closeTime - candles[testStart].openTime) / 86_400_000;
  console.log(`  train: ${trainDays.toFixed(1)} days, ${trainEnd - trainStart} candles`);
  console.log(`  test:  ${testDays.toFixed(1)} days, ${testEnd - testStart} candles\n`);

  const summary = [];
  for (const cand of CANDIDATES) {
    const train = evaluate(cand, candles, ctx, trainStart, trainEnd);
    const test = evaluate(cand, candles, ctx, testStart, testEnd);
    summary.push({
      Strategy: cand.name,
      "Train Tr": train.trades,
      "Train Win%": fmtPct(train.winRate),
      "Train PnL%": fmtPct(train.totalPnl),
      "Train PnL/day": fmtPct(train.totalPnl / trainDays),
      "Test Tr": test.trades,
      "Test Win%": fmtPct(test.winRate),
      "Test PnL%": fmtPct(test.totalPnl),
      "Test PnL/day": fmtPct(test.totalPnl / testDays),
    });
  }
  console.table(summary);

  console.log("\n----- Daily PnL on TEST set for top candidate (B) -----\n");
  const candB = CANDIDATES[1];
  const testB = evaluate(candB, candles, ctx, testStart, testEnd);
  const daily = dailyPnlSeries(testB.trades_obj, candB.tp, candB.sl);
  let cum = 0;
  const dailyRows = daily.map(([day, p]) => {
    cum += p;
    return { Day: day, "PnL %": fmtPct(p), "Cumulative %": fmtPct(cum), "Trades": testB.trades_obj.filter((t) => t.resolved && new Date(t.entryTime).toISOString().slice(0, 10) === day).length };
  });
  console.table(dailyRows);

  console.log("\n----- Sample of test-set trades (B) -----\n");
  const sampleTrades = testB.trades_obj.filter((t) => t.resolved).slice(0, 12).map((t) => ({
    Entry: new Date(t.entryTime).toISOString().replace("T", " ").slice(0, 16),
    Price: t.entryPrice.toFixed(4),
    Side: t.side,
    Outcome: t.outcomePess,
    Min: t.minutes.toFixed(0),
  }));
  console.table(sampleTrades);

  console.log("\n----- Verdict -----\n");
  for (const row of summary) {
    const trainPnl = parseFloat(row["Train PnL%"]);
    const testPnl = parseFloat(row["Test PnL%"]);
    const ratio = trainPnl !== 0 ? testPnl / trainPnl : 0;
    let v;
    if (testPnl > 0 && ratio > 0.4) v = "ROBUST — held up out-of-sample";
    else if (testPnl > 0) v = "WEAKER OOS — partial generalization";
    else if (testPnl < 0) v = "FAILED — overfit to train";
    else v = "FLAT";
    console.log(`  ${row.Strategy.padEnd(48)}  train=${row["Train PnL%"].padStart(8)} test=${row["Test PnL%"].padStart(8)}  ${v}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

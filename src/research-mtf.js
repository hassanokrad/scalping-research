// Multi-timeframe indicator test: aggregate 1m -> 15m, run regime-adaptive
// bidirectional with proper next-bar entry (look-ahead fixed).

import { loadOrFetch } from "./cache.js";
import { runStrategy, expectedValue } from "./engine.js";
import { ema } from "./indicators.js";

const COINS = ["SUIUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"];
const FEE = 0.0004;
const TRAIN_FRAC = 2 / 3;
const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

function aggregate(candles, factor) {
  const out = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    out.push({
      openTime: slice[0].openTime,
      open: slice[0].open,
      high: Math.max(...slice.map((c) => c.high)),
      low: Math.min(...slice.map((c) => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((a, c) => a + c.volume, 0),
      closeTime: slice[slice.length - 1].closeTime,
    });
  }
  return out;
}

function buildCtx(candles) {
  const closes = candles.map((c) => c.close);
  return {
    candles,
    closes,
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
  };
}

function regimeEval(candles, ctx, startIdx, endIdx, tp, sl) {
  const longS = runStrategy(candles, ctx, {
    side: "long", tp, sl,
    shouldEnter: (i) => ctx.ema50[i] != null && ctx.ema200[i] != null && ctx.closes[i] > ctx.ema50[i] && ctx.closes[i] > ctx.ema200[i],
  }, { startIdx, endIdx });
  const shortS = runStrategy(candles, ctx, {
    side: "short", tp, sl,
    shouldEnter: (i) => ctx.ema50[i] != null && ctx.ema200[i] != null && ctx.closes[i] < ctx.ema50[i] && ctx.closes[i] < ctx.ema200[i],
  }, { startIdx, endIdx });
  const evL = expectedValue(longS.winRatePess, tp, sl, FEE);
  const evS = expectedValue(shortS.winRatePess, tp, sl, FEE);
  return {
    longTr: longS.resolved, longWin: longS.winRatePess, longPnl: longS.resolved * evL,
    shortTr: shortS.resolved, shortWin: shortS.winRatePess, shortPnl: shortS.resolved * evS,
    totalTr: longS.resolved + shortS.resolved,
    totalPnl: longS.resolved * evL + shortS.resolved * evS,
  };
}

async function main() {
  console.log(`\n===== Multi-timeframe indicator test (bug-fixed engine) =====`);
  console.log(`Strategy: EMA50/EMA200 regime-adaptive bidirectional`);
  console.log(`TP/SL scaled per timeframe; entry at next bar open\n`);

  const timeframes = [
    { name: "5m", factor: 5, tp: 0.005, sl: 0.005 },
    { name: "15m", factor: 15, tp: 0.01, sl: 0.01 },
    { name: "1h", factor: 60, tp: 0.02, sl: 0.02 },
  ];

  for (const tf of timeframes) {
    console.log(`\n--- Timeframe: ${tf.name} (TP=${fmtPct(tf.tp)}, SL=${fmtPct(tf.sl)}) ---`);
    const rows = [];
    for (const c of COINS) {
      const raw = await loadOrFetch(c, "1m", 90, 24 * 60);
      const candles = aggregate(raw, tf.factor);
      const split = Math.floor(candles.length * TRAIN_FRAC);
      const ctx = buildCtx(candles);
      const train = regimeEval(candles, ctx, 200, split - 1, tf.tp, tf.sl);
      const test = regimeEval(candles, ctx, split, candles.length - 1, tf.tp, tf.sl);
      rows.push({
        Coin: c,
        "Tr Tr": train.totalTr,
        "Tr PnL": fmtPct(train.totalPnl),
        "Te Tr": test.totalTr,
        "Te PnL": fmtPct(test.totalPnl),
        Robust: train.totalPnl > 0 && test.totalPnl > 0 ? "YES" : "no",
      });
    }
    console.table(rows);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

// Multi-coin robustness test. Runs the Phase-5 winning strategy
// (regime-adaptive bidirectional, EMA50 & EMA200, TP 1.0% / SL 0.5%)
// against a watchlist of coins on the same 20d-train / 10d-test split.

import { loadOrFetch } from "./cache.js";
import { runStrategy, expectedValue } from "./engine.js";
import { FEES } from "./config.js";
import { buildSignalContext, STRATEGY_CONFIG } from "./strategy.js";

const WATCHLIST = [
  "SUIUSDT",
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "AVAXUSDT",
  "NEARUSDT",
  "APTUSDT",
  "SEIUSDT",
  "INJUSDT",
  "DOGEUSDT",
];

const INTERVAL = "1m";
const TOTAL_DAYS = 30;
const TRAIN_FRAC = 2 / 3;
const FEE = FEES.futuresMakerRoundTrip;
const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

function longStrat() {
  return {
    side: "long",
    tp: STRATEGY_CONFIG.tp,
    sl: STRATEGY_CONFIG.sl,
    shouldEnter: (i, ctx) =>
      ctx.ema50[i] != null &&
      ctx.ema200[i] != null &&
      ctx.closes[i] > ctx.ema50[i] &&
      ctx.closes[i] > ctx.ema200[i],
  };
}
function shortStrat() {
  return {
    side: "short",
    tp: STRATEGY_CONFIG.tp,
    sl: STRATEGY_CONFIG.sl,
    shouldEnter: (i, ctx) =>
      ctx.ema50[i] != null &&
      ctx.ema200[i] != null &&
      ctx.closes[i] < ctx.ema50[i] &&
      ctx.closes[i] < ctx.ema200[i],
  };
}

function totalEval(candles, ctx, startIdx, endIdx) {
  const L = runStrategy(candles, ctx, longStrat(), { startIdx, endIdx });
  const S = runStrategy(candles, ctx, shortStrat(), { startIdx, endIdx });
  const evL = expectedValue(L.winRatePess, STRATEGY_CONFIG.tp, STRATEGY_CONFIG.sl, FEE);
  const evS = expectedValue(S.winRatePess, STRATEGY_CONFIG.tp, STRATEGY_CONFIG.sl, FEE);
  return {
    longTr: L.resolved,
    longWin: L.winRatePess,
    longPnl: L.resolved * evL,
    shortTr: S.resolved,
    shortWin: S.winRatePess,
    shortPnl: S.resolved * evS,
    totalTr: L.resolved + S.resolved,
    totalPnl: L.resolved * evL + S.resolved * evS,
  };
}

async function main() {
  console.log(`\nMulti-coin robustness test — strategy: ${STRATEGY_CONFIG.name}`);
  console.log(`TP=${fmtPct(STRATEGY_CONFIG.tp)} / SL=${fmtPct(STRATEGY_CONFIG.sl)}, futures-maker fee\n`);

  const rows = [];
  for (const symbol of WATCHLIST) {
    try {
      const candles = await loadOrFetch(symbol, INTERVAL, TOTAL_DAYS, 60);
      const split = Math.floor(candles.length * TRAIN_FRAC);
      const ctx = buildSignalContext(candles);
      const trainStart = 200;
      const trainEnd = split - 1;
      const testStart = split;
      const testEnd = candles.length - 1;
      const trainDays = (candles[trainEnd].closeTime - candles[trainStart].openTime) / 86_400_000;
      const testDays = (candles[testEnd].closeTime - candles[testStart].openTime) / 86_400_000;

      const train = totalEval(candles, ctx, trainStart, trainEnd);
      const test = totalEval(candles, ctx, testStart, testEnd);
      const both = train.totalPnl > 0 && test.totalPnl > 0;

      rows.push({
        Symbol: symbol,
        "Tr Tr": train.totalTr,
        "Tr Win%": train.totalTr ? fmtPct((train.longWin * train.longTr + train.shortWin * train.shortTr) / train.totalTr) : "-",
        "Tr PnL": fmtPct(train.totalPnl),
        "Tr /day": fmtPct(train.totalPnl / trainDays),
        "Te Tr": test.totalTr,
        "Te Win%": test.totalTr ? fmtPct((test.longWin * test.longTr + test.shortWin * test.shortTr) / test.totalTr) : "-",
        "Te PnL": fmtPct(test.totalPnl),
        "Te /day": fmtPct(test.totalPnl / testDays),
        "Both>0": both ? "YES" : "no",
      });
    } catch (err) {
      console.log(`  ${symbol} FAILED: ${err.message}`);
    }
  }

  rows.sort((a, b) => parseFloat(b["Te PnL"]) - parseFloat(a["Te PnL"]));
  console.log();
  console.table(rows);

  const robust = rows.filter((r) => r["Both>0"] === "YES");
  console.log(`\nProfitable on BOTH train and test: ${robust.length} / ${rows.length}`);
  console.log(`Profitable on TEST only:           ${rows.filter((r) => parseFloat(r["Te PnL"]) > 0).length} / ${rows.length}`);
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

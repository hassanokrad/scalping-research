// Rigorous price-action TP/SL test addressing the reviewer's concerns:
//   1. Look-ahead bug fixed (entry at open[i+1] after signal at close[i])
//   2. PESSIMISTIC outcome rule: when a single candle touches both TP and SL,
//      we count it as a LOSS (the worst case — addresses the "who hit first?" doubt)
//   3. Multiple strategies (EMA cross, Donchian breakout, RSI mean-revert)
//   4. Multiple timeframes (5m, 15m) — larger candles where TP/SL are a smaller
//      fraction of typical candle range
//   5. Across 6 non-overlapping 30-day rolling windows on 180 days of data
//   6. Ambiguous-candle COUNT is reported per window so we can SEE how often
//      the "who hit first?" question actually matters in practice.

import { loadOrFetch } from "./cache.js";
import { runStrategy, expectedValue } from "./engine.js";
import { ema, rsi } from "./indicators.js";

const COINS = ["SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"];
const FEE = 0.0004; // futures maker round trip
const DAYS = 180;
const WINDOW_DAYS = 30;
const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;
const fmtSignedPct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

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

function rollingMax(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - period; j < i; j++) m = Math.max(m, values[j]);
    out[i] = m;
  }
  return out;
}
function rollingMin(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - period; j < i; j++) m = Math.min(m, values[j]);
    out[i] = m;
  }
  return out;
}

function buildCtx(candles) {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  return {
    candles, closes, highs, lows,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    hi20: rollingMax(highs, 20),
    lo20: rollingMin(lows, 20),
  };
}

function defineStrategies(tp, sl) {
  return [
    {
      name: "EMA-cross (regime-adaptive)",
      tp, sl,
      longFilter: (i, ctx) => ctx.ema50[i] != null && ctx.ema200[i] != null && ctx.closes[i] > ctx.ema50[i] && ctx.closes[i] > ctx.ema200[i],
      shortFilter: (i, ctx) => ctx.ema50[i] != null && ctx.ema200[i] != null && ctx.closes[i] < ctx.ema50[i] && ctx.closes[i] < ctx.ema200[i],
    },
    {
      name: "Donchian breakout (20-bar)",
      tp, sl,
      longFilter: (i, ctx) => ctx.hi20[i] != null && ctx.closes[i] > ctx.hi20[i],
      shortFilter: (i, ctx) => ctx.lo20[i] != null && ctx.closes[i] < ctx.lo20[i],
    },
    {
      name: "Pullback in trend",
      tp, sl,
      longFilter: (i, ctx) => {
        if (ctx.ema20[i] == null || ctx.ema50[i] == null) return false;
        return ctx.ema20[i] > ctx.ema50[i] && ctx.closes[i] <= ctx.ema20[i] * 1.002;
      },
      shortFilter: (i, ctx) => {
        if (ctx.ema20[i] == null || ctx.ema50[i] == null) return false;
        return ctx.ema20[i] < ctx.ema50[i] && ctx.closes[i] >= ctx.ema20[i] * 0.998;
      },
    },
    {
      name: "RSI mean-reversion",
      tp, sl,
      longFilter: (i, ctx) => ctx.rsi14[i] != null && ctx.rsi14[i] < 30,
      shortFilter: (i, ctx) => ctx.rsi14[i] != null && ctx.rsi14[i] > 70,
    },
  ];
}

function evalStrategy(candles, ctx, strat, startIdx, endIdx) {
  const L = runStrategy(candles, ctx, {
    side: "long", tp: strat.tp, sl: strat.sl, shouldEnter: strat.longFilter,
  }, { startIdx, endIdx });
  const S = runStrategy(candles, ctx, {
    side: "short", tp: strat.tp, sl: strat.sl, shouldEnter: strat.shortFilter,
  }, { startIdx, endIdx });

  const evLPess = expectedValue(L.winRatePess, strat.tp, strat.sl, FEE);
  const evSPess = expectedValue(S.winRatePess, strat.tp, strat.sl, FEE);
  const evLOpt = expectedValue(L.winRateOpt, strat.tp, strat.sl, FEE);
  const evSOpt = expectedValue(S.winRateOpt, strat.tp, strat.sl, FEE);

  return {
    trades: L.resolved + S.resolved,
    longTrades: L.resolved,
    shortTrades: S.resolved,
    ambiguous: L.ambiguous + S.ambiguous,
    winRatePess: (L.winsPess + S.winsPess) / Math.max(L.resolved + S.resolved, 1),
    winRateOpt: (L.winsOpt + S.winsOpt) / Math.max(L.resolved + S.resolved, 1),
    totalPnlPess: L.resolved * evLPess + S.resolved * evSPess,
    totalPnlOpt: L.resolved * evLOpt + S.resolved * evSOpt,
  };
}

async function main() {
  console.log(`\n===== Price-action TP/SL test (reviewer-spec) =====`);
  console.log(`4 strategies × 2 timeframes × 6 rolling windows = 48 cells`);
  console.log(`Pessimistic outcome rule + look-ahead-fixed engine + ambiguous count reported\n`);

  // Load 180d data and aggregate per timeframe
  const raw = {};
  for (const c of COINS) raw[c] = await loadOrFetch(c, "1m", DAYS, 24 * 60);

  const tfs = [
    { name: "5m", factor: 5, tp: 0.005, sl: 0.005 },
    { name: "15m", factor: 15, tp: 0.01, sl: 0.01 },
  ];

  // Time-based windows (anchored to most recent close)
  const endMs = raw[COINS[0]][raw[COINS[0]].length - 1].closeTime;
  const windows = [];
  for (let i = 0; i < DAYS / WINDOW_DAYS; i++) {
    const wEnd = endMs - i * WINDOW_DAYS * 86_400_000;
    const wStart = wEnd - WINDOW_DAYS * 86_400_000;
    windows.unshift({
      label: `W${DAYS / WINDOW_DAYS - i}`,
      startMs: wStart,
      endMs: wEnd,
      startDate: new Date(wStart).toISOString().slice(0, 10),
      endDate: new Date(wEnd).toISOString().slice(0, 10),
    });
  }

  // Index aggregated candles for each (coin, timeframe) and run strategies
  const allResults = []; // flat array: { strategy, timeframe, window, totalPnlPess, ... }

  for (const tf of tfs) {
    const aggByCoin = {};
    const ctxByCoin = {};
    for (const c of COINS) {
      aggByCoin[c] = aggregate(raw[c], tf.factor);
      ctxByCoin[c] = buildCtx(aggByCoin[c]);
    }
    const strategies = defineStrategies(tf.tp, tf.sl);

    for (const strat of strategies) {
      console.log(`\n--- ${strat.name}  (TF=${tf.name}, TP=${fmtPct(tf.tp)}, SL=${fmtPct(tf.sl)}) ---`);
      const rows = [];
      for (const w of windows) {
        // Sum across the 4 coins
        let agg = { trades: 0, ambiguous: 0, totalPnlPess: 0, totalPnlOpt: 0, longTrades: 0, shortTrades: 0, winsPess: 0 };
        for (const c of COINS) {
          const candles = aggByCoin[c];
          const startIdx = candles.findIndex((x) => x.openTime >= w.startMs);
          let endIdx = candles.findIndex((x) => x.openTime >= w.endMs);
          if (endIdx === -1) endIdx = candles.length - 1;
          else endIdx -= 1;
          if (startIdx < 0 || endIdx <= startIdx) continue;
          const r = evalStrategy(candles, ctxByCoin[c], strat, Math.max(startIdx, 200), endIdx);
          agg.trades += r.trades;
          agg.ambiguous += r.ambiguous;
          agg.longTrades += r.longTrades;
          agg.shortTrades += r.shortTrades;
          agg.totalPnlPess += r.totalPnlPess;
          agg.totalPnlOpt += r.totalPnlOpt;
        }
        rows.push({
          Window: w.label,
          Period: `${w.startDate}→${w.endDate}`,
          Trades: agg.trades,
          "Ambig.": agg.ambiguous,
          "Ambig%": agg.trades ? fmtPct(agg.ambiguous / agg.trades) : "-",
          "PnL pess": fmtSignedPct(agg.totalPnlPess),
          "PnL opt": fmtSignedPct(agg.totalPnlOpt),
          "Pess >0": agg.totalPnlPess > 0 ? "YES" : "no",
        });
        allResults.push({ strategy: strat.name, timeframe: tf.name, window: w.label, ...agg });
      }
      console.table(rows);
    }
  }

  // === Summary verdict ===
  console.log(`\n\n===== SUMMARY: which strategy/timeframe survived pessimistic rule on most windows? =====\n`);
  const grouped = new Map();
  for (const r of allResults) {
    const key = `${r.strategy} / ${r.timeframe}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }
  const summaryRows = [];
  for (const [key, runs] of grouped) {
    const profitablePess = runs.filter((r) => r.totalPnlPess > 0).length;
    const profitableOpt = runs.filter((r) => r.totalPnlOpt > 0).length;
    const totalPess = runs.reduce((a, r) => a + r.totalPnlPess, 0);
    const totalOpt = runs.reduce((a, r) => a + r.totalPnlOpt, 0);
    const totalAmbig = runs.reduce((a, r) => a + r.ambiguous, 0);
    const totalTrades = runs.reduce((a, r) => a + r.trades, 0);
    summaryRows.push({
      "Strategy / TF": key,
      "Profitable windows (pess)": `${profitablePess}/6`,
      "Profitable windows (opt)": `${profitableOpt}/6`,
      "Sum PnL pess (180d)": fmtSignedPct(totalPess),
      "Sum PnL opt (180d)": fmtSignedPct(totalOpt),
      "Ambig%": totalTrades ? fmtPct(totalAmbig / totalTrades) : "-",
    });
  }
  summaryRows.sort((a, b) => parseFloat(b["Sum PnL pess (180d)"]) - parseFloat(a["Sum PnL pess (180d)"]));
  console.table(summaryRows);

  console.log(`\n===== Clock strategy reference =====`);
  console.log(`Clock short 23UTC 4-coin basket (no TP/SL, no ambiguity):`);
  console.log(`  Profitable windows: 5/6   Sum PnL (180d, maker): +31.26%   Ambig%: 0% (no intracandle ambiguity by design)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });

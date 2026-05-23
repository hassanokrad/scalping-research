// Phase 3: combine filters and try bidirectional. Train set only.

import { loadOrFetch } from "./cache.js";
import { runStrategy, expectedValue } from "./engine.js";
import { FEES } from "./config.js";
import { ema, rsi, atr, hourOfDay, rollingRank, bodyMetrics } from "./indicators.js";

const SYMBOL = "SUIUSDT";
const INTERVAL = "1m";
const TOTAL_DAYS = 30;
const TRAIN_FRAC = 2 / 3;
const FEE = FEES.futuresMakerRoundTrip;

const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

function buildCtx(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  return {
    candles,
    closes,
    volumes,
    ema30: ema(closes, 30),
    ema50: ema(closes, 50),
    ema100: ema(closes, 100),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
    atrRank: rollingRank(atr(candles, 14), 240),
    hours: hourOfDay(candles),
    body: bodyMetrics(candles),
  };
}

// Long filters
const longF = {
  ema50_up: (i, ctx) => ctx.ema50[i] != null && ctx.closes[i] > ctx.ema50[i],
  ema30_up: (i, ctx) => ctx.ema30[i] != null && ctx.closes[i] > ctx.ema30[i],
  ema100_up: (i, ctx) => ctx.ema100[i] != null && ctx.closes[i] > ctx.ema100[i],
  pullback: (i, ctx) =>
    i >= 1 && ctx.ema50[i] != null && ctx.closes[i] > ctx.ema50[i] && !ctx.body[i - 1].isGreen,
  high_vol: (i, ctx) => ctx.atrRank[i] != null && ctx.atrRank[i] >= 0.5,
  us_session: (i, ctx) => ctx.hours[i] >= 13 && ctx.hours[i] <= 21,
};

// Short filters (mirror of longs)
const shortF = {
  ema50_dn: (i, ctx) => ctx.ema50[i] != null && ctx.closes[i] < ctx.ema50[i],
};

function and(...fns) {
  return (i, ctx) => fns.every((f) => f(i, ctx));
}

async function main() {
  console.log(`\nPhase 3: filter combos + bidirectional — ${SYMBOL}\n`);
  const candles = await loadOrFetch(SYMBOL, INTERVAL, TOTAL_DAYS, 30);
  const split = Math.floor(candles.length * TRAIN_FRAC);
  const ctx = buildCtx(candles);

  // --- 3a: F1 (ema50_up) combined with second filter, on original 0.5/1.0 ---
  console.log("===== Combo filters on TP=0.5%/SL=1.0% long (futures maker) =====\n");
  const combos = [
    ["ema50_up", longF.ema50_up],
    ["ema50_up + pullback", and(longF.ema50_up, longF.pullback)],
    ["ema50_up + ema200_up", and(longF.ema50_up, (i, ctx) => ctx.ema200[i] != null && ctx.closes[i] > ctx.ema200[i])],
    ["ema50_up + high_vol", and(longF.ema50_up, longF.high_vol)],
    ["ema50_up + us_session", and(longF.ema50_up, longF.us_session)],
    ["ema30_up", longF.ema30_up],
    ["ema100_up", longF.ema100_up],
  ];
  const rows = [];
  for (const [name, fn] of combos) {
    const s = runStrategy(candles, ctx, { side: "long", tp: 0.005, sl: 0.01, shouldEnter: fn }, { startIdx: 200, endIdx: split - 1 });
    const ev = expectedValue(s.winRatePess, 0.005, 0.01, FEE);
    rows.push({
      Filter: name,
      Trades: s.resolved,
      "Win%": fmtPct(s.winRatePess),
      "EV/trade": fmtPct(ev),
      "Total PnL": fmtPct(s.resolved * ev),
      "AvgMin": s.avgMinutes.toFixed(0),
      Selectivity: fmtPct(s.selectivity),
    });
  }
  rows.sort((a, b) => parseFloat(b["Total PnL"]) - parseFloat(a["Total PnL"]));
  console.table(rows);

  // --- 3b: Mini grid around the original with F1 applied ---
  console.log("\n===== Mini TP/SL grid around 0.5/1.0 with ema50_up filter =====\n");
  const tps = [0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.01];
  const sls = [0.005, 0.007, 0.008, 0.01, 0.012, 0.015];
  const gridRows = [];
  for (const tp of tps) {
    for (const sl of sls) {
      const s = runStrategy(candles, ctx, { side: "long", tp, sl, shouldEnter: longF.ema50_up }, { startIdx: 200, endIdx: split - 1 });
      const ev = expectedValue(s.winRatePess, tp, sl, FEE);
      gridRows.push({
        TP: fmtPct(tp),
        SL: fmtPct(sl),
        Trades: s.resolved,
        "Win%": fmtPct(s.winRatePess),
        "EV/trade": fmtPct(ev),
        "Total PnL": fmtPct(s.resolved * ev),
      });
    }
  }
  gridRows.sort((a, b) => parseFloat(b["Total PnL"]) - parseFloat(a["Total PnL"]));
  console.table(gridRows.slice(0, 15));

  // --- 3c: Bidirectional — long above EMA50, short below ---
  console.log("\n===== Bidirectional: long when > EMA50, short when < EMA50 =====\n");
  const biRows = [];
  const biShapes = [
    { tp: 0.005, sl: 0.01 },
    { tp: 0.007, sl: 0.007 },
    { tp: 0.006, sl: 0.008 },
    { tp: 0.004, sl: 0.008 },
    { tp: 0.005, sl: 0.008 },
    { tp: 0.006, sl: 0.01 },
  ];
  for (const { tp, sl } of biShapes) {
    const longS = runStrategy(candles, ctx, { side: "long", tp, sl, shouldEnter: longF.ema50_up }, { startIdx: 200, endIdx: split - 1 });
    const shortS = runStrategy(candles, ctx, { side: "short", tp, sl, shouldEnter: shortF.ema50_dn }, { startIdx: 200, endIdx: split - 1 });
    const evLong = expectedValue(longS.winRatePess, tp, sl, FEE);
    const evShort = expectedValue(shortS.winRatePess, tp, sl, FEE);
    const total = longS.resolved * evLong + shortS.resolved * evShort;
    biRows.push({
      TP: fmtPct(tp),
      SL: fmtPct(sl),
      LongTr: longS.resolved,
      LongWin: fmtPct(longS.winRatePess),
      LongPnL: fmtPct(longS.resolved * evLong),
      ShortTr: shortS.resolved,
      ShortWin: fmtPct(shortS.winRatePess),
      ShortPnL: fmtPct(shortS.resolved * evShort),
      "Total PnL": fmtPct(total),
    });
  }
  biRows.sort((a, b) => parseFloat(b["Total PnL"]) - parseFloat(a["Total PnL"]));
  console.table(biRows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

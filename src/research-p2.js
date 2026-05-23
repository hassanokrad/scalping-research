// Phase 2: entry filters on long-side SUI, train window only.
// We test 9 filters on 3 representative TP/SL shapes and report whether any
// filter materially lifts the pessimistic EV per trade.

import { loadOrFetch } from "./cache.js";
import { runStrategy, expectedValue } from "./engine.js";
import { FEES } from "./config.js";
import {
  ema,
  rsi,
  atr,
  hourOfDay,
  rollingRank,
  bodyMetrics,
} from "./indicators.js";

const SYMBOL = "SUIUSDT";
const INTERVAL = "1m";
const TOTAL_DAYS = 30;
const TRAIN_FRAC = 2 / 3;

const TP_SL_CANDIDATES = [
  { name: "original", tp: 0.005, sl: 0.01 },
  { name: "symmetric-scalp", tp: 0.007, sl: 0.007 },
  { name: "p1-winner", tp: 0.012, sl: 0.02 },
];

const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

function buildCtx(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);
  const atrRank = rollingRank(atr14, 240); // 4h rank
  const hours = hourOfDay(candles);
  const body = bodyMetrics(candles);

  // SMA of volume for spike detection
  const volSma20 = new Array(volumes.length).fill(null);
  let vsum = 0;
  for (let i = 0; i < volumes.length; i++) {
    vsum += volumes[i];
    if (i >= 20) vsum -= volumes[i - 20];
    if (i >= 19) volSma20[i] = vsum / 20;
  }

  return {
    candles,
    closes,
    volumes,
    ema50,
    ema200,
    rsi14,
    atr14,
    atrRank,
    hours,
    body,
    volSma20,
  };
}

// Each filter: shouldEnter(i, ctx) -> boolean
const FILTERS = {
  "F0_none": () => true,
  "F1_ema50_up": (i, ctx) =>
    ctx.ema50[i] != null && ctx.closes[i] > ctx.ema50[i],
  "F2_ema200_up": (i, ctx) =>
    ctx.ema200[i] != null && ctx.closes[i] > ctx.ema200[i],
  "F3_pullback_in_uptrend": (i, ctx) => {
    if (i < 1) return false;
    return (
      ctx.ema50[i] != null &&
      ctx.closes[i] > ctx.ema50[i] &&
      !ctx.body[i - 1].isGreen
    );
  },
  "F4_rsi_lt35": (i, ctx) => ctx.rsi14[i] != null && ctx.rsi14[i] < 35,
  "F5_rsi_30_to_50": (i, ctx) =>
    ctx.rsi14[i] != null && ctx.rsi14[i] >= 30 && ctx.rsi14[i] <= 50,
  "F6_vol_spike_1.5x": (i, ctx) => {
    if (i < 1 || ctx.volSma20[i - 1] == null) return false;
    return ctx.volumes[i - 1] >= 1.5 * ctx.volSma20[i - 1];
  },
  "F7_low_vol_regime": (i, ctx) =>
    ctx.atrRank[i] != null && ctx.atrRank[i] < 0.5,
  "F8_high_vol_regime": (i, ctx) =>
    ctx.atrRank[i] != null && ctx.atrRank[i] >= 0.5,
  "F9_us_session": (i, ctx) => {
    const h = ctx.hours[i];
    return h >= 13 && h <= 21; // UTC
  },
};

async function main() {
  console.log(`\nPhase 2: filter sweep — ${SYMBOL} ${INTERVAL}, ${TOTAL_DAYS}d, train portion\n`);
  const candles = await loadOrFetch(SYMBOL, INTERVAL, TOTAL_DAYS, 30);
  const split = Math.floor(candles.length * TRAIN_FRAC);
  console.log(`  train: 0..${split - 1} (${split} candles)\n`);

  const ctx = buildCtx(candles);
  const fee = FEES.futuresMakerRoundTrip;

  for (const cand of TP_SL_CANDIDATES) {
    console.log(`\n===== TP=${fmtPct(cand.tp)} / SL=${fmtPct(cand.sl)} (${cand.name}) =====`);
    console.log(`Venue: futures maker (fee ${fmtPct(fee)} round trip)\n`);

    const rows = [];
    for (const [fname, fn] of Object.entries(FILTERS)) {
      const strat = { side: "long", tp: cand.tp, sl: cand.sl, shouldEnter: fn };
      const s = runStrategy(candles, ctx, strat, { startIdx: 200, endIdx: split - 1 });
      const evTrade = expectedValue(s.winRatePess, cand.tp, cand.sl, fee);
      const totalPnl = s.resolved * evTrade;
      rows.push({
        Filter: fname,
        Trades: s.resolved,
        "Win%": s.resolved ? fmtPct(s.winRatePess) : "-",
        "EV/trade": fmtPct(evTrade),
        "Total PnL": fmtPct(totalPnl),
        "AvgMin": s.avgMinutes.toFixed(0),
      });
    }
    // sort by total PnL descending
    rows.sort((a, b) => parseFloat(b["Total PnL"]) - parseFloat(a["Total PnL"]));
    console.table(rows);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

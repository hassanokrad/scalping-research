// Scan 12 candidate coins for the 23:00 UTC short pattern, validated across
// non-overlapping 30-day rolling windows on 365 days of data.

import { loadOrFetch } from "./cache.js";

const COINS = [
  "SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT",
  "NEARUSDT", "SEIUSDT", "APTUSDT", "AVAXUSDT",
  "DOGEUSDT", "XRPUSDT", "FETUSDT", "RNDRUSDT",
];
const ENTRY_HOUR = 23;
const HOLD_MIN = 90;
const FEE_RT = 0.0004; // futures maker
const DAYS = 365;
const WINDOW_DAYS = 30;
const fmtPct = (x) => `${(x * 100).toFixed(3)}%`;
const fmtSignedPct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(3)}%`;

function dailyShortReturns(candles) {
  const out = [];
  for (let i = 0; i < candles.length - HOLD_MIN; i++) {
    const t = new Date(candles[i].openTime);
    if (t.getUTCHours() !== ENTRY_HOUR || t.getUTCMinutes() !== 0) continue;
    const entry = candles[i].open;
    const exit = candles[i + HOLD_MIN].open;
    if (entry <= 0) continue;
    const gross = (entry - exit) / entry;
    out.push({ day: t.toISOString().slice(0, 10), gross, net: gross - FEE_RT, ts: candles[i].openTime });
  }
  return out;
}

function tStat(values) {
  const n = values.length;
  if (n < 2) return { mean: 0, t: 0, n };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const t = sd === 0 ? 0 : mean / (sd / Math.sqrt(n));
  return { mean, t, n, sd };
}

async function main() {
  console.log(`\n===== Coin scan: 23:00 UTC short, 90m hold, 365d data =====`);
  console.log(`Fee assumption: futures maker (${fmtPct(FEE_RT)} round trip)\n`);

  const rows = [];
  for (const c of COINS) {
    const candles = await loadOrFetch(c, "1m", DAYS, 24 * 60);
    const trades = dailyShortReturns(candles);
    const overall = tStat(trades.map((t) => t.net));

    // Split into 30-day non-overlapping windows by day index
    const days = trades.map((t) => t.day);
    const endMs = trades[trades.length - 1]?.ts ?? Date.now();
    const windows = [];
    for (let i = 0; i < Math.floor(DAYS / WINDOW_DAYS); i++) {
      const wEnd = endMs - i * WINDOW_DAYS * 86_400_000;
      const wStart = wEnd - WINDOW_DAYS * 86_400_000;
      const slice = trades.filter((t) => t.ts >= wStart && t.ts < wEnd);
      if (slice.length === 0) continue;
      const total = slice.reduce((a, x) => a + x.net, 0);
      windows.unshift({ start: new Date(wStart).toISOString().slice(0, 10), total, n: slice.length });
    }
    const profitableWindows = windows.filter((w) => w.total > 0).length;

    rows.push({
      Coin: c,
      Trades: trades.length,
      "Mean/trade": fmtSignedPct(overall.mean),
      "t-stat": overall.t.toFixed(2),
      "Total 365d": fmtSignedPct(trades.reduce((a, x) => a + x.net, 0)),
      "Windows +": `${profitableWindows}/${windows.length}`,
      "Win%/window": ((profitableWindows / windows.length) * 100).toFixed(0) + "%",
    });
  }

  // Sort by total return descending
  rows.sort((a, b) => parseFloat(b["Total 365d"]) - parseFloat(a["Total 365d"]));
  console.table(rows);

  // Recommended basket: top N coins by combined criterion (positive total AND >= 60% windows profitable)
  const qualifies = rows.filter((r) => {
    const totalPos = parseFloat(r["Total 365d"]) > 0;
    const winsPct = parseFloat(r["Win%/window"]);
    return totalPos && winsPct >= 60 && parseFloat(r["t-stat"]) > 0.5;
  });

  console.log(`\n===== Recommended basket =====`);
  console.log(`(Criteria: total return > 0, ≥60% of 30-day windows profitable, t-stat > 0.5)\n`);
  if (qualifies.length === 0) {
    console.log(`  No coins meet all criteria.`);
  } else {
    for (const r of qualifies) {
      console.log(`  ${r.Coin}  total=${r["Total 365d"]}  t=${r["t-stat"]}  windows=${r["Windows +"]}`);
    }
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });

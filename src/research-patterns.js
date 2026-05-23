// Phase: pure clock-based pattern discovery. No indicators, no look-ahead.
// Entries are triggered by UTC clock time. Exits are after a fixed hold.

import { loadOrFetch } from "./cache.js";

const COINS = ["SUIUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"];
const FEE_ROUND_TRIP = 0.0004; // futures maker
const TRAIN_FRAC = 2 / 3; // first 60 days train, last 30 days test
const fmtPct = (x) => `${(x * 100).toFixed(3)}%`;

function tStat(returns) {
  const n = returns.length;
  if (n < 2) return { mean: 0, sd: 0, t: 0, n };
  const mean = returns.reduce((a, b) => a + b, 0) / n;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const t = sd === 0 ? 0 : mean / (sd / Math.sqrt(n));
  return { mean, sd, t, n };
}

// For each candle at UTC hour h:00, compute return of holding from open[i]
// to open[i + holdBars]. Bucket by hour.
function hourOfDayReturns(candles, holdBars) {
  const buckets = Array.from({ length: 24 }, () => []);
  for (let i = 0; i < candles.length - holdBars; i++) {
    const t = new Date(candles[i].openTime);
    if (t.getUTCMinutes() !== 0) continue;
    const entry = candles[i].open;
    const exit = candles[i + holdBars].open;
    if (entry <= 0) continue;
    const r = (exit - entry) / entry - FEE_ROUND_TRIP;
    buckets[t.getUTCHours()].push(r);
  }
  return buckets.map((rs, hour) => ({ hour, ...tStat(rs) }));
}

function dayOfWeekReturns(candles, holdBars) {
  const buckets = Array.from({ length: 7 }, () => []);
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let i = 0; i < candles.length - holdBars; i++) {
    const t = new Date(candles[i].openTime);
    if (t.getUTCHours() !== 0 || t.getUTCMinutes() !== 0) continue;
    const entry = candles[i].open;
    const exit = candles[i + holdBars].open;
    if (entry <= 0) continue;
    const r = (exit - entry) / entry - FEE_ROUND_TRIP;
    buckets[t.getUTCDay()].push(r);
  }
  return buckets.map((rs, day) => ({ day: labels[day], ...tStat(rs) }));
}

function baselineHourlyDrift(candles) {
  // Mean return of holding for 60 minutes, sampled every 60 minutes,
  // averaged over the whole window — the "always-on" baseline to compare to.
  const rs = [];
  for (let i = 0; i < candles.length - 60; i += 60) {
    const entry = candles[i].open;
    const exit = candles[i + 60].open;
    if (entry <= 0) continue;
    rs.push((exit - entry) / entry - FEE_ROUND_TRIP);
  }
  return tStat(rs);
}

async function main() {
  console.log(`\n===== Pattern discovery on 5 coins, 90d, train/test 60/30 =====\n`);

  const all = {};
  for (const symbol of COINS) {
    const candles = await loadOrFetch(symbol, "1m", 90, 24 * 60);
    const split = Math.floor(candles.length * TRAIN_FRAC);
    const train = candles.slice(0, split);
    const test = candles.slice(split);
    all[symbol] = { candles, train, test };
    const base = baselineHourlyDrift(train);
    console.log(`  ${symbol}  train ${train.length} bars  test ${test.length} bars  baseline 1h return = ${fmtPct(base.mean)} (t=${base.t.toFixed(2)})`);
  }
  console.log();

  // --- Hour-of-day patterns, 1h hold ---
  console.log(`===== Hour-of-day patterns, hold = 60 minutes (long) =====`);
  console.log(`Showing mean return per bucket, t-stat, and baseline-adjusted excess.\n`);
  for (const symbol of COINS) {
    const trainStats = hourOfDayReturns(all[symbol].train, 60);
    const testStats = hourOfDayReturns(all[symbol].test, 60);
    const base = baselineHourlyDrift(all[symbol].train).mean;

    const merged = trainStats.map((tr, i) => {
      const te = testStats[i];
      return {
        Hour: `${String(tr.hour).padStart(2, "0")}:00`,
        "Train mean": fmtPct(tr.mean),
        "Tr excess vs baseline": fmtPct(tr.mean - base),
        "Tr t": tr.t.toFixed(2),
        "Tr n": tr.n,
        "Test mean": fmtPct(te.mean),
        "Te t": te.t.toFixed(2),
        "Same sign?": Math.sign(tr.mean - base) === Math.sign(te.mean - base) ? "YES" : "no",
      };
    });
    console.log(`\n--- ${symbol} ---`);
    // sort by train excess descending
    const sorted = [...merged].sort((a, b) => parseFloat(b["Tr excess vs baseline"]) - parseFloat(a["Tr excess vs baseline"]));
    console.table(sorted);
  }

  // --- Day-of-week patterns, 24h hold ---
  console.log(`\n\n===== Day-of-week patterns, hold = 24 hours (long) =====\n`);
  for (const symbol of COINS) {
    const trainStats = dayOfWeekReturns(all[symbol].train, 60 * 24);
    const testStats = dayOfWeekReturns(all[symbol].test, 60 * 24);
    const rows = trainStats.map((tr, i) => {
      const te = testStats[i];
      return {
        Day: tr.day,
        "Train mean": fmtPct(tr.mean),
        "Tr t": tr.t.toFixed(2),
        "Tr n": tr.n,
        "Test mean": fmtPct(te.mean),
        "Te t": te.t.toFixed(2),
        "Same sign?": Math.sign(tr.mean) === Math.sign(te.mean) ? "YES" : "no",
      };
    });
    console.log(`\n--- ${symbol} ---`);
    console.table(rows);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

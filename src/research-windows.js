// Clock-window strategy: enter at fixed UTC time, exit after fixed hold.
// No look-ahead — entry signal is wall-clock, not indicator.
//
// We simulate three candidate strategies:
//   S1: SHORT every day at 23:00 UTC, cover at 00:00 (the strongest pattern)
//   S2: LONG  every day at 19:00 UTC, exit at 20:00
//   S3: combined basket of S1 + S2 across 5 coins
//
// For each, we report: daily PnL series, cumulative curve, win-day rate,
// best/worst day, train vs test stability.

import { loadOrFetch } from "./cache.js";

const COINS = ["SUIUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"];
const FEE_ROUND_TRIP = 0.0004;
const TRAIN_FRAC = 2 / 3;
const fmtPct = (x) => `${(x * 100).toFixed(3)}%`;

function clockTrade(candles, hourUtc, holdBars, side) {
  const trades = [];
  for (let i = 0; i < candles.length - holdBars; i++) {
    const t = new Date(candles[i].openTime);
    if (t.getUTCHours() !== hourUtc || t.getUTCMinutes() !== 0) continue;
    const entry = candles[i].open;
    const exit = candles[i + holdBars].open;
    if (entry <= 0) continue;
    const gross = side === "long" ? (exit - entry) / entry : (entry - exit) / entry;
    const net = gross - FEE_ROUND_TRIP;
    trades.push({
      day: new Date(candles[i].openTime).toISOString().slice(0, 10),
      side,
      entry,
      exit,
      gross,
      net,
    });
  }
  return trades;
}

function summarize(trades, label) {
  const n = trades.length;
  if (n === 0) return { label, n: 0 };
  const total = trades.reduce((a, t) => a + t.net, 0);
  const mean = total / n;
  const wins = trades.filter((t) => t.net > 0).length;
  const winRate = wins / n;
  const best = Math.max(...trades.map((t) => t.net));
  const worst = Math.min(...trades.map((t) => t.net));
  const variance = trades.reduce((a, t) => a + (t.net - mean) ** 2, 0) / Math.max(n - 1, 1);
  const sd = Math.sqrt(variance);
  const t = sd === 0 ? 0 : mean / (sd / Math.sqrt(n));
  return { label, n, total, mean, winRate, best, worst, t, sd };
}

function dailyBasketPnl(allTradesByCoin) {
  // Aggregate all coin-trades by entry day and side.
  const byDay = new Map();
  for (const [coin, trades] of Object.entries(allTradesByCoin)) {
    for (const t of trades) {
      const key = t.day;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push({ coin, ...t });
    }
  }
  const days = [...byDay.keys()].sort();
  let cum = 0;
  return days.map((day) => {
    const ts = byDay.get(day);
    const pnl = ts.reduce((a, x) => a + x.net, 0) / 5; // equal-weighted across 5 coins
    cum += pnl;
    return { day, trades: ts.length, pnl, cum };
  });
}

async function main() {
  console.log(`\n===== Clock-window strategy simulation =====`);
  console.log(`Hold = 60 minutes. Equal weight across 5 coins.`);
  console.log(`Fee (round trip): ${fmtPct(FEE_ROUND_TRIP)}\n`);

  const allCandles = {};
  for (const c of COINS) {
    allCandles[c] = await loadOrFetch(c, "1m", 90, 24 * 60);
  }
  const len = allCandles[COINS[0]].length;
  const split = Math.floor(len * TRAIN_FRAC);

  const windows = [
    { label: "S1_short_23UTC", hour: 23, side: "short" },
    { label: "S2_long_19UTC", hour: 19, side: "long" },
  ];

  for (const w of windows) {
    console.log(`\n=== ${w.label} (${w.side.toUpperCase()} at ${w.hour}:00 UTC, hold 60m) ===\n`);

    const perCoinTrain = {};
    const perCoinTest = {};
    const rows = [];
    for (const c of COINS) {
      const all = clockTrade(allCandles[c], w.hour, 60, w.side);
      const train = all.filter((t, idx) => {
        const tIdx = allCandles[c].findIndex((x) => x.openTime === new Date(t.day + "T" + String(w.hour).padStart(2, "0") + ":00:00Z").getTime());
        return tIdx >= 0 && tIdx < split;
      });
      const test = all.filter((t) => !train.includes(t));
      perCoinTrain[c] = train;
      perCoinTest[c] = test;
      const trS = summarize(train, "train");
      const teS = summarize(test, "test");
      rows.push({
        Coin: c,
        "Tr n": trS.n,
        "Tr mean": fmtPct(trS.mean),
        "Tr t": trS.t.toFixed(2),
        "Tr winDay%": fmtPct(trS.winRate),
        "Tr total": fmtPct(trS.total),
        "Te n": teS.n,
        "Te mean": fmtPct(teS.mean),
        "Te t": teS.t.toFixed(2),
        "Te winDay%": fmtPct(teS.winRate),
        "Te total": fmtPct(teS.total),
      });
    }
    console.table(rows);

    // Basket equity curve on TEST set
    const dailyTest = dailyBasketPnl(perCoinTest);
    if (dailyTest.length > 0) {
      const winDays = dailyTest.filter((d) => d.pnl > 0).length;
      const finalCum = dailyTest[dailyTest.length - 1].cum;
      console.log(`\nBasket (equal weight 5 coins) on TEST set:`);
      console.log(`  Days:           ${dailyTest.length}`);
      console.log(`  Win days:       ${winDays} (${(winDays / dailyTest.length * 100).toFixed(1)}%)`);
      console.log(`  Cumulative PnL: ${fmtPct(finalCum)}`);
      console.log(`  Per day avg:    ${fmtPct(finalCum / dailyTest.length)}`);
      console.log(`  Best day:       ${fmtPct(Math.max(...dailyTest.map((d) => d.pnl)))}`);
      console.log(`  Worst day:      ${fmtPct(Math.min(...dailyTest.map((d) => d.pnl)))}`);
    }
  }

  // Combined: both S1 (short 23) and S2 (long 19), basket
  console.log(`\n\n=== COMBINED: short 23UTC + long 19UTC across 5-coin basket on TEST set ===\n`);
  const combinedDays = new Map();
  for (const c of COINS) {
    const short23 = clockTrade(allCandles[c].slice(split), 23, 60, "short");
    const long19 = clockTrade(allCandles[c].slice(split), 19, 60, "long");
    for (const t of [...short23, ...long19]) {
      if (!combinedDays.has(t.day)) combinedDays.set(t.day, []);
      combinedDays.get(t.day).push({ coin: c, ...t });
    }
  }
  const sortedDays = [...combinedDays.keys()].sort();
  let cum = 0;
  const dailyCombined = sortedDays.map((day) => {
    const ts = combinedDays.get(day);
    // Two trades per coin per day → 10 trades per day if all execute. Equal weight per trade.
    const pnl = ts.reduce((a, x) => a + x.net, 0) / 10;
    cum += pnl;
    return { day, trades: ts.length, pnl, cum };
  });
  console.table(dailyCombined.map((d) => ({
    Day: d.day,
    Trades: d.trades,
    "Day PnL": fmtPct(d.pnl),
    "Cum PnL": fmtPct(d.cum),
  })));

  const winDays = dailyCombined.filter((d) => d.pnl > 0).length;
  const cumFinal = dailyCombined[dailyCombined.length - 1].cum;
  console.log(`\nCombined basket summary (TEST set, ~30 days):`);
  console.log(`  Trading days:   ${dailyCombined.length}`);
  console.log(`  Win days:       ${winDays} (${(winDays / dailyCombined.length * 100).toFixed(1)}%)`);
  console.log(`  Cumulative:     ${fmtPct(cumFinal)}`);
  console.log(`  Per day avg:    ${fmtPct(cumFinal / dailyCombined.length)}`);
  console.log(`  On $500:        $${(500 * cumFinal).toFixed(2)} over ${dailyCombined.length} days`);
}

main().catch((e) => { console.error(e); process.exit(1); });

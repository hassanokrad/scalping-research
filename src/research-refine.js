// Refine the 23:00 UTC short pattern: sweep hold time, coin selection.
// Also: extend to nearby hours (22, 23, 00, 01) — maybe the true window is bigger.

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
    trades.push({ day: new Date(candles[i].openTime).toISOString().slice(0, 10), gross, net: gross - FEE_ROUND_TRIP });
  }
  return trades;
}

function stats(trades) {
  const n = trades.length;
  if (n === 0) return { n: 0, mean: 0, total: 0, winRate: 0, t: 0 };
  const total = trades.reduce((a, x) => a + x.net, 0);
  const mean = total / n;
  const variance = trades.reduce((a, x) => a + (x.net - mean) ** 2, 0) / Math.max(n - 1, 1);
  const sd = Math.sqrt(variance);
  const t = sd === 0 ? 0 : mean / (sd / Math.sqrt(n));
  const winRate = trades.filter((x) => x.net > 0).length / n;
  return { n, mean, total, winRate, t };
}

async function main() {
  console.log(`\n===== Refine 23:00 UTC short — hold time sweep =====\n`);
  const allCandles = {};
  for (const c of COINS) {
    allCandles[c] = await loadOrFetch(c, "1m", 90, 24 * 60);
  }
  const len = allCandles[COINS[0]].length;
  const split = Math.floor(len * TRAIN_FRAC);

  const holds = [15, 30, 45, 60, 90, 120, 180];
  for (const c of COINS) {
    console.log(`\n--- ${c} ---`);
    const rows = [];
    for (const h of holds) {
      const train = clockTrade(allCandles[c].slice(0, split), 23, h, "short");
      const test = clockTrade(allCandles[c].slice(split), 23, h, "short");
      const trS = stats(train);
      const teS = stats(test);
      rows.push({
        Hold: `${h}m`,
        "Tr mean": fmtPct(trS.mean),
        "Tr t": trS.t.toFixed(2),
        "Tr total": fmtPct(trS.total),
        "Te mean": fmtPct(teS.mean),
        "Te t": teS.t.toFixed(2),
        "Te total": fmtPct(teS.total),
        "Te winDay%": fmtPct(teS.winRate),
        "Same sign?": Math.sign(trS.mean) === Math.sign(teS.mean) ? "YES" : "no",
      });
    }
    console.table(rows);
  }

  console.log(`\n\n===== Hour sweep around 22:00-01:00 UTC (short, 60m hold) — test set only =====\n`);
  for (const c of COINS) {
    console.log(`\n--- ${c} ---`);
    const rows = [];
    for (const hour of [21, 22, 23, 0, 1, 2]) {
      const test = clockTrade(allCandles[c].slice(split), hour, 60, "short");
      const teS = stats(test);
      rows.push({
        Hour: `${String(hour).padStart(2, "0")}:00`,
        "Test mean": fmtPct(teS.mean),
        "Test t": teS.t.toFixed(2),
        "Test total": fmtPct(teS.total),
        "Test winDay%": fmtPct(teS.winRate),
        n: teS.n,
      });
    }
    console.table(rows);
  }

  // Best basket: drop BTC (weakest signal), use SUI+ETH+SOL+INJ, optimal hold time
  console.log(`\n\n===== Optimized basket: 4 coins (no BTC), 23:00 UTC short =====\n`);
  for (const h of holds) {
    const all = {};
    for (const c of ["SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"]) {
      all[c] = clockTrade(allCandles[c].slice(split), 23, h, "short");
    }
    const byDay = new Map();
    for (const [coin, ts] of Object.entries(all)) {
      for (const t of ts) {
        if (!byDay.has(t.day)) byDay.set(t.day, []);
        byDay.get(t.day).push({ coin, ...t });
      }
    }
    const days = [...byDay.keys()].sort();
    let cum = 0;
    const dayPnls = days.map((d) => {
      const ts = byDay.get(d);
      const p = ts.reduce((a, x) => a + x.net, 0) / 4;
      cum += p;
      return p;
    });
    const winDays = dayPnls.filter((p) => p > 0).length;
    console.log(`  Hold ${String(h).padStart(3)}m: cum ${fmtPct(cum)} | per-day ${fmtPct(cum / days.length)} | winDays ${winDays}/${days.length} (${fmtPct(winDays / days.length)})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

// Rolling-window robustness test of the clock strategy.
// Fetches 180 days of 1m data for the 4 strategy coins, slices into 6
// non-overlapping 30-day windows, and runs the strategy on each. If the
// edge is real (not just a lucky test slice), it should appear in most
// of the 6 windows. If it shows up in 1-2 only, it's noise / regime-bound.

import { loadOrFetch } from "./cache.js";

const COINS = ["SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"];
const ENTRY_HOUR_UTC = 23;
const HOLD_MIN = 90;
const FEE_MAKER_RT = 0.0004;
const FEE_TAKER_RT = 0.001;
const DAYS = 180;
const WINDOW_DAYS = 30;
const fmtPct = (x) => `${(x * 100).toFixed(3)}%`;
const fmtSignedPct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(3)}%`;

function tradesInWindow(candles, hourUtc, holdBars, side, startMs, endMs) {
  const trades = [];
  for (let i = 0; i < candles.length - holdBars; i++) {
    const c = candles[i];
    if (c.openTime < startMs || c.openTime >= endMs) continue;
    const t = new Date(c.openTime);
    if (t.getUTCHours() !== hourUtc || t.getUTCMinutes() !== 0) continue;
    const entry = c.open;
    const exit = candles[i + holdBars].open;
    if (entry <= 0) continue;
    const gross = side === "short" ? (entry - exit) / entry : (exit - entry) / entry;
    trades.push({
      day: new Date(c.openTime).toISOString().slice(0, 10),
      gross,
    });
  }
  return trades;
}

function windowStats(basketDailyPnl) {
  const n = basketDailyPnl.length;
  if (n === 0) return null;
  const total = basketDailyPnl.reduce((a, b) => a + b, 0);
  const mean = total / n;
  const wins = basketDailyPnl.filter((x) => x > 0).length;
  const best = Math.max(...basketDailyPnl);
  const worst = Math.min(...basketDailyPnl);
  const variance = basketDailyPnl.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(n - 1, 1);
  const sd = Math.sqrt(variance);
  const t = sd === 0 ? 0 : mean / (sd / Math.sqrt(n));
  return { n, total, mean, wins, winRate: wins / n, best, worst, sd, t };
}

async function main() {
  console.log(`\n===== Rolling-window robustness test =====`);
  console.log(`Strategy: short 4-coin basket at 23:00 UTC, hold ${HOLD_MIN}m`);
  console.log(`Data: ${DAYS} days, sliced into ${DAYS / WINDOW_DAYS} non-overlapping ${WINDOW_DAYS}-day windows\n`);

  const allCandles = {};
  for (const c of COINS) {
    allCandles[c] = await loadOrFetch(c, "1m", DAYS, 24 * 60);
  }

  // Define windows: most-recent first
  const endMs = allCandles[COINS[0]][allCandles[COINS[0]].length - 1].closeTime;
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

  console.log(`Windows (oldest to newest):`);
  for (const w of windows) console.log(`  ${w.label}  ${w.startDate}  →  ${w.endDate}`);
  console.log();

  const rows = [];
  for (const w of windows) {
    // For each window, build per-day basket PnL by averaging across coins
    const byDay = new Map();
    for (const c of COINS) {
      const ts = tradesInWindow(allCandles[c], ENTRY_HOUR_UTC, HOLD_MIN, "short", w.startMs, w.endMs);
      for (const t of ts) {
        if (!byDay.has(t.day)) byDay.set(t.day, []);
        byDay.get(t.day).push({ coin: c, gross: t.gross });
      }
    }
    const days = [...byDay.keys()].sort();
    const dailyGross = days.map((d) => byDay.get(d).reduce((a, x) => a + x.gross, 0) / COINS.length);
    const grossStats = windowStats(dailyGross);
    const dailyMaker = dailyGross.map((x) => x - FEE_MAKER_RT);
    const dailyTaker = dailyGross.map((x) => x - FEE_TAKER_RT);
    const makerStats = windowStats(dailyMaker);
    const takerStats = windowStats(dailyTaker);

    rows.push({
      Window: w.label,
      Period: `${w.startDate} → ${w.endDate}`,
      Days: grossStats?.n ?? 0,
      "Cum gross": grossStats ? fmtSignedPct(grossStats.total) : "-",
      "Cum maker": makerStats ? fmtSignedPct(makerStats.total) : "-",
      "Cum taker": takerStats ? fmtSignedPct(takerStats.total) : "-",
      "Per-day maker": makerStats ? fmtSignedPct(makerStats.mean) : "-",
      "Win days": grossStats ? `${grossStats.wins}/${grossStats.n} (${(grossStats.winRate * 100).toFixed(0)}%)` : "-",
      "Best/Worst day": grossStats ? `${fmtSignedPct(grossStats.best)} / ${fmtSignedPct(grossStats.worst)}` : "-",
      "Maker t-stat": makerStats ? makerStats.t.toFixed(2) : "-",
    });
  }
  console.table(rows);

  // Aggregate verdict
  const positive = rows.filter((r) => parseFloat(r["Cum maker"]) > 0).length;
  const profitableMaker = rows.filter((r) => parseFloat(r["Per-day maker"]) > 0.04).length;
  const total = rows.length;

  console.log(`\n  ===== ROBUSTNESS VERDICT =====`);
  console.log(`  Profitable windows (any positive cum, maker):     ${positive}/${total}`);
  console.log(`  Windows beating backtest threshold (>+0.04%/day): ${profitableMaker}/${total}`);
  console.log();

  if (positive === total) {
    console.log(`  HIGH CONFIDENCE: edge holds in EVERY 30-day window over ${DAYS} days.`);
  } else if (positive >= total - 1) {
    console.log(`  GOOD: edge holds in ${positive}/${total} windows; one weak window is normal for a thin edge.`);
  } else if (positive >= total / 2) {
    console.log(`  MIXED: edge holds in some windows but not others. Likely regime-dependent.`);
  } else {
    console.log(`  WEAK: edge does NOT hold consistently. Be very cautious.`);
  }
  console.log();

  // Show across-window total for context
  const grandTotalMaker = rows.reduce((a, r) => a + parseFloat(r["Cum maker"]), 0);
  console.log(`  Sum of all-window cum PnL (maker fees): ${fmtSignedPct(grandTotalMaker / 100)}`);
  console.log(`  Average per-day across all ${DAYS} days:  ${fmtSignedPct(grandTotalMaker / 100 / DAYS)}`);
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });

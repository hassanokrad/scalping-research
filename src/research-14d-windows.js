// Simulate the "14-day forward test" against all possible historical
// 14-day windows in the 180-day dataset. Every window is real data; the
// only thing this can't capture is live execution friction.
//
// We compute daily basket PnL for every day, then form every rolling
// 14-day window and report the distribution of outcomes.

import { loadOrFetch } from "./cache.js";

const COINS = ["SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"];
const ENTRY_HOUR_UTC = 23;
const HOLD_MIN = 90;
const FEE_MAKER_RT = 0.0004;
const FEE_TAKER_RT = 0.001;
const DAYS = 180;
const WINDOW = 14;
const fmtPct = (x) => `${(x * 100).toFixed(3)}%`;
const fmtSignedPct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(3)}%`;
const fmtUsd = (x, cap) => `${x >= 0 ? "+$" : "-$"}${Math.abs(x * cap).toFixed(2)}`;

// Build daily basket PnL series (gross of fees)
function dailyBasketPnl(candlesByCoin) {
  const byDay = new Map();
  for (const c of COINS) {
    const candles = candlesByCoin[c];
    for (let i = 0; i < candles.length - HOLD_MIN; i++) {
      const t = new Date(candles[i].openTime);
      if (t.getUTCHours() !== ENTRY_HOUR_UTC || t.getUTCMinutes() !== 0) continue;
      const entry = candles[i].open;
      const exit = candles[i + HOLD_MIN].open;
      if (entry <= 0) continue;
      // short
      const gross = (entry - exit) / entry;
      const day = t.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { coins: 0, gross: 0 });
      const d = byDay.get(day);
      d.coins += 1;
      d.gross += gross;
    }
  }
  const days = [...byDay.keys()].sort();
  return days.map((day) => {
    const d = byDay.get(day);
    return { day, basketGross: d.gross / d.coins, coinsTraded: d.coins };
  });
}

function summary(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
  const sd = Math.sqrt(variance);
  const q = (p) => sorted[Math.min(Math.floor(p * n), n - 1)];
  return {
    n, mean, sd,
    min: sorted[0],
    p10: q(0.10),
    p25: q(0.25),
    median: q(0.50),
    p75: q(0.75),
    p90: q(0.90),
    max: sorted[n - 1],
  };
}

async function main() {
  console.log(`\n===== "What if you'd done this for 14 days?" — every possible window =====`);
  console.log(`Strategy: short 4-coin basket at 23:00 UTC, hold ${HOLD_MIN}m\n`);

  const candlesByCoin = {};
  for (const c of COINS) candlesByCoin[c] = await loadOrFetch(c, "1m", DAYS, 24 * 60);

  const daily = dailyBasketPnl(candlesByCoin);
  console.log(`Daily basket trades available: ${daily.length}`);
  console.log(`Date range: ${daily[0].day}  →  ${daily[daily.length - 1].day}\n`);

  // === All non-overlapping 14-day windows ===
  console.log(`===== Non-overlapping 14-day windows (independent samples) =====\n`);
  const nonOverlapping = [];
  for (let i = 0; i + WINDOW <= daily.length; i += WINDOW) {
    const chunk = daily.slice(i, i + WINDOW);
    const grossCum = chunk.reduce((a, d) => a + d.basketGross, 0);
    const makerCum = grossCum - WINDOW * FEE_MAKER_RT;
    const takerCum = grossCum - WINDOW * FEE_TAKER_RT;
    const winDays = chunk.filter((d) => d.basketGross > FEE_MAKER_RT).length;
    nonOverlapping.push({
      Window: `${chunk[0].day} → ${chunk[chunk.length - 1].day}`,
      "Gross %": fmtSignedPct(grossCum),
      "Maker %": fmtSignedPct(makerCum),
      "Taker %": fmtSignedPct(takerCum),
      "Win days": `${winDays}/14`,
      "On $500 (maker)": fmtUsd(makerCum, 500),
      "On $10K (maker)": fmtUsd(makerCum, 10000),
    });
  }
  console.table(nonOverlapping);

  const profitableMaker = nonOverlapping.filter((w) => parseFloat(w["Maker %"]) > 0).length;
  const profitableTaker = nonOverlapping.filter((w) => parseFloat(w["Taker %"]) > 0).length;
  console.log(`\n  ${profitableMaker} of ${nonOverlapping.length} non-overlapping windows profitable on maker fees`);
  console.log(`  ${profitableTaker} of ${nonOverlapping.length} non-overlapping windows profitable on taker fees\n`);

  // === Rolling 14-day windows — full distribution ===
  console.log(`===== Rolling 14-day windows — full distribution =====\n`);
  const rolling = [];
  for (let i = 0; i + WINDOW <= daily.length; i++) {
    const chunk = daily.slice(i, i + WINDOW);
    const grossCum = chunk.reduce((a, d) => a + d.basketGross, 0);
    const makerCum = grossCum - WINDOW * FEE_MAKER_RT;
    rolling.push({
      start: chunk[0].day,
      gross: grossCum,
      maker: makerCum,
    });
  }

  const grossStats = summary(rolling.map((r) => r.gross));
  const makerStats = summary(rolling.map((r) => r.maker));

  console.log(`  ${rolling.length} rolling 14-day windows analyzed.\n`);
  console.log(`  Distribution of 14-day cumulative returns (MAKER fees):`);
  console.log(`    Min:    ${fmtSignedPct(makerStats.min)}    (worst-case 14d if you started on the unluckiest day)`);
  console.log(`    P10:    ${fmtSignedPct(makerStats.p10)}    (10% of windows did worse)`);
  console.log(`    P25:    ${fmtSignedPct(makerStats.p25)}`);
  console.log(`    Median: ${fmtSignedPct(makerStats.median)}`);
  console.log(`    Mean:   ${fmtSignedPct(makerStats.mean)}`);
  console.log(`    P75:    ${fmtSignedPct(makerStats.p75)}`);
  console.log(`    P90:    ${fmtSignedPct(makerStats.p90)}`);
  console.log(`    Max:    ${fmtSignedPct(makerStats.max)}    (best-case 14d if you started on the luckiest day)`);
  console.log(`    SD:     ${fmtPct(makerStats.sd)}\n`);

  const positive = rolling.filter((r) => r.maker > 0).length;
  const beatThreshold = rolling.filter((r) => r.maker > 0.005).length; // >0.5% over 14d
  console.log(`  Positive windows (maker):                 ${positive}/${rolling.length} (${(positive / rolling.length * 100).toFixed(1)}%)`);
  console.log(`  Windows beating +0.5% over 14d (maker):   ${beatThreshold}/${rolling.length} (${(beatThreshold / rolling.length * 100).toFixed(1)}%)\n`);

  // What does this mean for the $500 / $10K user?
  console.log(`===== "If you did this for 14 days starting on a random day, you'd see..." =====`);
  console.log(`  (using MAKER fees, futures, equal weight across 4 coins)\n`);
  console.log(`  On $500 capital:`);
  console.log(`    Median outcome:    ${fmtUsd(makerStats.median, 500)}`);
  console.log(`    Worst 10% of starts: ${fmtUsd(makerStats.p10, 500)} or worse`);
  console.log(`    Best 10% of starts:  ${fmtUsd(makerStats.p90, 500)} or better`);
  console.log(`    Worst case:        ${fmtUsd(makerStats.min, 500)}\n`);
  console.log(`  On $10,000 capital:`);
  console.log(`    Median outcome:    ${fmtUsd(makerStats.median, 10000)}`);
  console.log(`    Worst 10% of starts: ${fmtUsd(makerStats.p10, 10000)} or worse`);
  console.log(`    Best 10% of starts:  ${fmtUsd(makerStats.p90, 10000)} or better`);
  console.log(`    Worst case:        ${fmtUsd(makerStats.min, 10000)}\n`);

  console.log(`===== Practical interpretation =====\n`);
  if (positive / rolling.length >= 0.7) {
    console.log(`  Edge appears in ${(positive / rolling.length * 100).toFixed(0)}% of all possible 14-day windows.`);
    console.log(`  A "bad start" is real but the strategy recovers in most starting points.`);
  } else if (positive / rolling.length >= 0.55) {
    console.log(`  Edge appears in ${(positive / rolling.length * 100).toFixed(0)}% of all possible 14-day windows.`);
    console.log(`  Some starting points lose money over 14 days. You need patience to ride through.`);
  } else {
    console.log(`  Edge appears in only ${(positive / rolling.length * 100).toFixed(0)}% of windows — risky.`);
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });

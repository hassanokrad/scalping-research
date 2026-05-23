// Phase 1: TP/SL grid search on SUI, train set only (first 20 of 30 days).
// Goal: find any TP/SL combo whose pessimistic EV is positive at any venue.

import { loadOrFetch } from "./cache.js";
import { runStrategy, expectedValue } from "./engine.js";
import { FEES } from "./config.js";

const SYMBOL = "SUIUSDT";
const INTERVAL = "1m";
const TOTAL_DAYS = 30;
const TRAIN_FRAC = 2 / 3; // first 20 of 30 days

const TP_GRID = [0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.01, 0.012, 0.015, 0.02];
const SL_GRID = [0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.01, 0.012, 0.015, 0.02];

const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

async function main() {
  console.log(`\nPhase 1: TP/SL grid search — ${SYMBOL} ${INTERVAL}, ${TOTAL_DAYS}d data\n`);
  const candles = await loadOrFetch(SYMBOL, INTERVAL, TOTAL_DAYS, 30);
  const split = Math.floor(candles.length * TRAIN_FRAC);
  console.log(`  train: candles 0..${split - 1} (${split} bars)`);
  console.log(`  test:  candles ${split}..${candles.length - 1} (held out)\n`);

  const ctx = { candles };
  const noFilter = { shouldEnter: () => true };

  const venues = [
    ["spot-taker", FEES.spotTakerRoundTrip],
    ["spot+BNB", FEES.spotTakerBnbRoundTrip],
    ["fut-taker", FEES.futuresTakerRoundTrip],
    ["fut-maker", FEES.futuresMakerRoundTrip],
  ];

  console.log("Long-only, no filter:\n");
  const longResults = [];
  for (const tp of TP_GRID) {
    for (const sl of SL_GRID) {
      const strat = { side: "long", tp, sl, ...noFilter };
      const s = runStrategy(candles, ctx, strat, { startIdx: 0, endIdx: split - 1 });
      const evByVenue = Object.fromEntries(
        venues.map(([n, f]) => [n, expectedValue(s.winRatePess, tp, sl, f)]),
      );
      const totalByVenue = Object.fromEntries(
        venues.map(([n, f]) => [n, s.resolved * expectedValue(s.winRatePess, tp, sl, f)]),
      );
      longResults.push({
        tp,
        sl,
        trades: s.resolved,
        winRate: s.winRatePess,
        avgMin: s.avgMinutes,
        evByVenue,
        totalByVenue,
      });
    }
  }

  // Best by total PnL on fut-maker (cheapest), then on spot-taker (worst)
  console.log("Top 10 LONG strategies by total PnL on fut-maker (pessimistic):\n");
  const ranked = [...longResults].sort(
    (a, b) => b.totalByVenue["fut-maker"] - a.totalByVenue["fut-maker"],
  );
  console.table(
    ranked.slice(0, 10).map((r) => ({
      TP: fmtPct(r.tp),
      SL: fmtPct(r.sl),
      Trades: r.trades,
      "Win%": fmtPct(r.winRate),
      "AvgMin": r.avgMin.toFixed(0),
      "EV/trade fut-maker": fmtPct(r.evByVenue["fut-maker"]),
      "Total% fut-maker": fmtPct(r.totalByVenue["fut-maker"]),
      "Total% spot-taker": fmtPct(r.totalByVenue["spot-taker"]),
    })),
  );

  // Same grid, short side
  console.log("\nLong-only no-filter: any combo profitable on spot-taker?");
  const profitableSpot = longResults.filter((r) => r.evByVenue["spot-taker"] > 0);
  console.log(`  ${profitableSpot.length} of ${longResults.length} combos\n`);

  console.log("Short side, no filter — top 10 by fut-maker total PnL:\n");
  const shortResults = [];
  for (const tp of TP_GRID) {
    for (const sl of SL_GRID) {
      const strat = { side: "short", tp, sl, ...noFilter };
      const s = runStrategy(candles, ctx, strat, { startIdx: 0, endIdx: split - 1 });
      const evByVenue = Object.fromEntries(
        venues.map(([n, f]) => [n, expectedValue(s.winRatePess, tp, sl, f)]),
      );
      const totalByVenue = Object.fromEntries(
        venues.map(([n, f]) => [n, s.resolved * expectedValue(s.winRatePess, tp, sl, f)]),
      );
      shortResults.push({ tp, sl, trades: s.resolved, winRate: s.winRatePess, avgMin: s.avgMinutes, evByVenue, totalByVenue });
    }
  }
  const rankedShort = [...shortResults].sort(
    (a, b) => b.totalByVenue["fut-maker"] - a.totalByVenue["fut-maker"],
  );
  console.table(
    rankedShort.slice(0, 10).map((r) => ({
      TP: fmtPct(r.tp),
      SL: fmtPct(r.sl),
      Trades: r.trades,
      "Win%": fmtPct(r.winRate),
      "AvgMin": r.avgMin.toFixed(0),
      "EV/trade fut-maker": fmtPct(r.evByVenue["fut-maker"]),
      "Total% fut-maker": fmtPct(r.totalByVenue["fut-maker"]),
      "Total% spot-taker": fmtPct(r.totalByVenue["spot-taker"]),
    })),
  );

  // Save results JSON for downstream phases
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    "data/phase1-results.json",
    JSON.stringify({ longResults, shortResults }, null, 2),
  );
  console.log("\nSaved -> data/phase1-results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { fetchKlines } from "./binance.js";
import { summarize } from "./stats.js";
import { simulateWalkForward, expectedValue } from "./simulator.js";
import {
  WATCHLIST,
  LOOKBACK_DAYS,
  INTERVAL,
  THRESHOLDS,
  FEES,
  STRATEGY,
  INVERSE_STRATEGY,
} from "./config.js";

const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;
const fmtCount = (n, pct) => `${n.toLocaleString()} (${pct.toFixed(1)}%)`;

function breakEvenWinRate(tp, sl, feeRoundTrip) {
  const netWin = tp - feeRoundTrip;
  const netLoss = sl + feeRoundTrip;
  if (netWin <= 0) return null;
  return netLoss / (netWin + netLoss);
}

async function run() {
  console.log(
    `\nFetching last ${LOOKBACK_DAYS} days of ${INTERVAL} candles for ${WATCHLIST.length} symbols...\n`,
  );

  const results = [];
  for (const symbol of WATCHLIST) {
    process.stdout.write(`  ${symbol}... `);
    const t0 = Date.now();
    try {
      const candles = await fetchKlines(symbol, INTERVAL, LOOKBACK_DAYS);
      const freq = summarize(symbol, candles, THRESHOLDS, STRATEGY, INVERSE_STRATEGY);
      const mainSim = simulateWalkForward(candles, STRATEGY.tp, STRATEGY.sl);
      const inverseSim = simulateWalkForward(
        candles,
        INVERSE_STRATEGY.tp,
        INVERSE_STRATEGY.sl,
      );
      results.push({ symbol, candles, freq, mainSim, inverseSim });
      console.log(`${candles.length} candles in ${Date.now() - t0}ms`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
  }

  if (results.length === 0) {
    console.log("No data fetched. Exiting.");
    return;
  }

  console.log("\n========== MOVE FREQUENCY (1m candles, last 7 days) ==========\n");
  console.table(
    results.map((r) => ({
      Symbol: r.symbol,
      Candles: r.freq.total.toLocaleString(),
      "+0.5% up": fmtCount(r.freq.up05, r.freq.up05Pct),
      "+1% up": fmtCount(r.freq.up10, r.freq.up10Pct),
      "-0.5% down": fmtCount(r.freq.down05, r.freq.down05Pct),
      "-1% down": fmtCount(r.freq.down10, r.freq.down10Pct),
      "+0.5%/hr": r.freq.up05PerHour.toFixed(2),
      Price: r.freq.lastPrice,
    })),
  );

  console.log(
    "\n========== WALK-FORWARD TRADE SIMULATION (non-overlapping) ==========\n",
  );
  console.log(
    "Each entry holds across multiple candles until TP or SL is hit. After a trade",
  );
  console.log(
    "resolves we re-enter on the next candle. 'Optimistic' assumes TP first when a",
  );
  console.log(
    "candle hits both levels; 'Pessimistic' assumes SL first. Honest answer lives",
  );
  console.log("between them.\n");

  console.log(`Main:    TP=+${fmtPct(STRATEGY.tp)} / SL=-${fmtPct(STRATEGY.sl)}`);
  console.table(
    results.map((r) => ({
      Symbol: r.symbol,
      Trades: r.mainSim.resolved,
      Unresolved: r.mainSim.unresolved,
      "Wins (opt)": r.mainSim.winsOpt,
      "Wins (pess)": r.mainSim.winsPess,
      Ambiguous: r.mainSim.ambiguous,
      "Win% (opt)": fmtPct(r.mainSim.winRateOpt),
      "Win% (pess)": fmtPct(r.mainSim.winRatePess),
      "Median min": r.mainSim.medianMinutes.toFixed(0),
      "Avg min": r.mainSim.avgMinutes.toFixed(1),
    })),
  );

  console.log(
    `\nInverse: TP=+${fmtPct(INVERSE_STRATEGY.tp)} / SL=-${fmtPct(INVERSE_STRATEGY.sl)}`,
  );
  console.table(
    results.map((r) => ({
      Symbol: r.symbol,
      Trades: r.inverseSim.resolved,
      Unresolved: r.inverseSim.unresolved,
      "Wins (opt)": r.inverseSim.winsOpt,
      "Wins (pess)": r.inverseSim.winsPess,
      Ambiguous: r.inverseSim.ambiguous,
      "Win% (opt)": fmtPct(r.inverseSim.winRateOpt),
      "Win% (pess)": fmtPct(r.inverseSim.winRatePess),
      "Median min": r.inverseSim.medianMinutes.toFixed(0),
      "Avg min": r.inverseSim.avgMinutes.toFixed(1),
    })),
  );

  console.log("\n========== BREAK-EVEN WIN RATES (incl. fees) ==========\n");
  const venues = [
    ["Spot taker", FEES.spotTakerRoundTrip],
    ["Spot taker + BNB", FEES.spotTakerBnbRoundTrip],
    ["Futures taker", FEES.futuresTakerRoundTrip],
    ["Futures maker", FEES.futuresMakerRoundTrip],
  ];
  console.table(
    venues.map(([name, fee]) => {
      const main = breakEvenWinRate(STRATEGY.tp, STRATEGY.sl, fee);
      const inv = breakEvenWinRate(INVERSE_STRATEGY.tp, INVERSE_STRATEGY.sl, fee);
      return {
        Venue: name,
        "Fee (RT)": fmtPct(fee),
        "Main break-even": main == null ? "impossible" : fmtPct(main),
        "Inverse break-even": inv == null ? "impossible" : fmtPct(inv),
      };
    }),
  );

  console.log("\n========== EXPECTED VALUE PER TRADE (Main strategy) ==========\n");
  console.log(
    "EV is what you net per trade on average, as % of position. Negative = bleeding.",
  );
  console.log("Shown using PESSIMISTIC win rate (the realistic floor).\n");
  console.table(
    results.map((r) => {
      const row = { Symbol: r.symbol, "Pess win%": fmtPct(r.mainSim.winRatePess) };
      for (const [name, fee] of venues) {
        const ev = expectedValue(
          r.mainSim.winRatePess,
          STRATEGY.tp,
          STRATEGY.sl,
          fee,
        );
        row[name] = fmtPct(ev);
      }
      return row;
    }),
  );

  console.log("\n========== VERDICT (Main strategy, pessimistic) ==========\n");
  for (const r of results) {
    const wr = r.mainSim.winRatePess;
    const evFuturesMaker = expectedValue(
      wr,
      STRATEGY.tp,
      STRATEGY.sl,
      FEES.futuresMakerRoundTrip,
    );
    const evSpotTaker = expectedValue(
      wr,
      STRATEGY.tp,
      STRATEGY.sl,
      FEES.spotTakerRoundTrip,
    );

    let verdict;
    if (r.mainSim.resolved < 10) {
      verdict = `THIN SAMPLE (${r.mainSim.resolved} trades) — re-run with more data`;
    } else if (evSpotTaker > 0) {
      verdict = "PROFITABLE on Spot taker — strong candidate";
    } else if (evFuturesMaker > 0) {
      verdict = "PROFITABLE only on Futures maker — needs cheap fees";
    } else {
      verdict = "UNPROFITABLE at any venue — skip";
    }
    console.log(
      `  ${r.symbol.padEnd(10)}  win%=${fmtPct(wr).padStart(7)}  ` +
        `EV(spot-taker)=${fmtPct(evSpotTaker).padStart(7)}  ` +
        `EV(fut-maker)=${fmtPct(evFuturesMaker).padStart(7)}  →  ${verdict}`,
    );
  }
  console.log();
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

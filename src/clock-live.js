// Print the plan for today's clock trade. Run any time of day.
//
// Usage: node src/clock-live.js [capitalUsd]
//        e.g.  node src/clock-live.js 500

import { planForToday, CLOCK_STRATEGY } from "./clock-strategy.js";
import { fetchKlines } from "./binance.js";

const capital = parseFloat(process.argv[2] || "500");

async function main() {
  const plan = planForToday(new Date(), capital);
  console.log(`\n  Strategy:    ${plan.strategy}`);
  console.log(`  Capital:     $${plan.capitalUsd.toFixed(2)} total  ($${plan.perCoinUsd.toFixed(2)} per coin)`);
  console.log(`  Side:        ${plan.side.toUpperCase()}`);
  console.log(`  Coins:       ${plan.coins.join(", ")}`);
  console.log(`  Hold:        ${plan.holdMinutes} minutes\n`);
  console.log(`  NEXT ENTRY:  ${plan.nextEntry}`);
  console.log(`  EXIT BY:     ${plan.nextExit}`);
  console.log(`  Time until entry: ${plan.minutesUntilEntry.toFixed(1)} minutes\n`);

  // Show current prices for context
  console.log(`  Current prices (last close):`);
  for (const c of plan.coins) {
    try {
      const candles = await fetchKlines(c, "1m", 1);
      const last = candles[candles.length - 2];
      console.log(`    ${c.padEnd(10)}  ${last.close}`);
    } catch (err) {
      console.log(`    ${c.padEnd(10)}  fetch failed: ${err.message}`);
    }
  }

  console.log(`\n  Action checklist:`);
  console.log(`    1) Set up 4 SHORT positions at 23:00 UTC sharp (use limit orders 1-2 seconds before for maker fee)`);
  console.log(`    2) Set a take-profit alarm/exit for 00:30 UTC (90 min later)`);
  console.log(`    3) At 00:30 UTC sharp, CLOSE all 4 positions (market or limit)`);
  console.log(`    4) Log the result. Expected per-day: ~+0.04% to +0.10% basket (some days are losses, that's normal)`);
  console.log(`    5) Repeat the next day.\n`);

  console.log(`  REMINDER: this is a small statistical edge, not a guaranteed earner.`);
  console.log(`  Expected ~50% of days are winners. Worst single day in 30-day test: -1.5%.\n`);
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });

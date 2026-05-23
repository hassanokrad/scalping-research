// Fetch the freshest candles from Binance and report what the strategy says
// to do RIGHT NOW. Read-only — never sends an order.
//
// Usage:
//   node src/live-signal.js              (default SUIUSDT)
//   node src/live-signal.js SOLUSDT      (any USDT pair)

import { fetchKlines } from "./binance.js";
import { buildSignalContext, signalAt, computeOrder, STRATEGY_CONFIG } from "./strategy.js";

const SYMBOL = (process.argv[2] || "SUIUSDT").toUpperCase();

async function main() {
  console.log(`\n  Strategy: ${STRATEGY_CONFIG.name}`);
  console.log(`  Symbol:   ${SYMBOL}\n`);

  // 1 day of 1m candles is plenty to warm up EMA200.
  const candles = await fetchKlines(SYMBOL, "1m", 1);
  const ctx = buildSignalContext(candles);
  // The last candle Binance returns is usually still forming — its close is
  // moving second-to-second. Use the previous fully-closed candle instead.
  const i = candles.length - 2;
  const last = candles[i];
  const signal = signalAt(i, ctx);

  console.log(`  Last CLOSED candle close: ${last.close}`);
  console.log(`  EMA50:                    ${ctx.ema50[i]?.toFixed(6) ?? "n/a"}`);
  console.log(`  EMA200:                   ${ctx.ema200[i]?.toFixed(6) ?? "n/a"}`);
  console.log(`  Candle close time:        ${new Date(last.closeTime).toISOString()}`);
  console.log(`  NOTE: actual fill price when you click 'buy' will be the current market price, not this close.\n`);

  if (signal === "flat") {
    console.log(`  >> SIGNAL: FLAT — no entry. Price is between EMA50 and EMA200.`);
    console.log(`  >> Wait until both EMAs agree before taking a position.\n`);
    return;
  }

  const order = computeOrder(last.close, signal);
  const tpDist = Math.abs(order.takeProfit - order.entry) / order.entry;
  const slDist = Math.abs(order.stopLoss - order.entry) / order.entry;

  console.log(`  >> SIGNAL: ${signal.toUpperCase()}`);
  console.log(`  >> Entry (market):  ${order.entry}`);
  console.log(`  >> Take profit:     ${order.takeProfit.toFixed(6)}  (${(tpDist * 100).toFixed(2)}%)`);
  console.log(`  >> Stop loss:       ${order.stopLoss.toFixed(6)}  (${(slDist * 100).toFixed(2)}%)`);
  console.log(`\n  Venue: ${STRATEGY_CONFIG.venue}, fee assumption: ${(STRATEGY_CONFIG.feeRoundTrip * 100).toFixed(2)}% round trip`);
  console.log(`  This is a paper signal. Verify the trend, check the orderbook spread, then enter manually on Binance demo.\n`);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

// Fetch 365 days of 1m data for an extended candidate basket.
import { loadOrFetch } from "./cache.js";

const COINS = [
  "SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT",  // current basket
  "NEARUSDT", "SEIUSDT", "APTUSDT", "AVAXUSDT", // strong candidates from prior research
  "DOGEUSDT", "XRPUSDT", "FETUSDT", "RNDRUSDT", // additional diverse coins
];

for (const c of COINS) {
  try {
    const candles = await loadOrFetch(c, "1m", 365, 24 * 60);
    console.log(`  ${c}: ${candles.length} candles`);
  } catch (e) {
    console.log(`  ${c}: FAILED — ${e.message}`);
  }
}

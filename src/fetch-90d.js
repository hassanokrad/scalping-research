// Cache 90 days of 1m data for the research basket.
import { loadOrFetch } from "./cache.js";

const COINS = ["SUIUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"];

for (const c of COINS) {
  const candles = await loadOrFetch(c, "1m", 90, 24 * 60); // re-fetch if older than 24h
  console.log(`  ${c}: ${candles.length} candles`);
}

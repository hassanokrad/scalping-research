import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchKlines } from "./binance.js";

const CACHE_DIR = path.resolve("data");

async function ensureDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function cachePath(symbol, interval, days) {
  return path.join(CACHE_DIR, `${symbol}-${interval}-${days}d.json`);
}

export async function loadOrFetch(symbol, interval, days, maxAgeMin = 30) {
  await ensureDir();
  const p = cachePath(symbol, interval, days);
  try {
    const stat = await fs.stat(p);
    const ageMin = (Date.now() - stat.mtimeMs) / 60_000;
    if (ageMin < maxAgeMin) {
      const raw = await fs.readFile(p, "utf8");
      const data = JSON.parse(raw);
      console.log(`  [cache hit] ${symbol} ${interval} ${days}d (${ageMin.toFixed(1)} min old, ${data.length} candles)`);
      return data;
    }
  } catch {
    // miss
  }
  console.log(`  [fetching] ${symbol} ${interval} ${days}d ...`);
  const candles = await fetchKlines(symbol, interval, days);
  await fs.writeFile(p, JSON.stringify(candles));
  console.log(`  [cached]   ${candles.length} candles -> ${p}`);
  return candles;
}

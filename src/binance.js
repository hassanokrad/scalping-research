const BASE = "https://api.binance.com";
const KLINES_PATH = "/api/v3/klines";
const MAX_LIMIT = 1000;

const MS = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};

function parseKline(k) {
  return {
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  };
}

async function fetchKlinePage(symbol, interval, startTime, endTime) {
  const url = `${BASE}${KLINES_PATH}?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${MAX_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Binance ${symbol} ${res.status}: ${body}`);
  }
  const raw = await res.json();
  return raw.map(parseKline);
}

export async function fetchKlines(symbol, interval, lookbackDays) {
  const intervalMs = MS[interval];
  if (!intervalMs) throw new Error(`Unsupported interval: ${interval}`);

  const end = Date.now();
  const start = end - lookbackDays * 24 * 60 * 60_000;
  const pageSpanMs = MAX_LIMIT * intervalMs;

  const all = [];
  let cursor = start;
  while (cursor < end) {
    const pageEnd = Math.min(cursor + pageSpanMs - 1, end);
    const page = await fetchKlinePage(symbol, interval, cursor, pageEnd);
    if (page.length === 0) break;
    all.push(...page);
    const lastCloseTime = page[page.length - 1].closeTime;
    if (lastCloseTime <= cursor) break;
    cursor = lastCloseTime + 1;
  }
  return all;
}

// Forward-testing logger for the clock strategy.
//
// Subcommands:
//   node src/clock-logger.js entry        Record today's entry prices (run at/after 23:00 UTC)
//   node src/clock-logger.js exit         Record today's exit prices and compute PnL (run at/after 00:30 UTC)
//   node src/clock-logger.js status       Show running track record
//   node src/clock-logger.js auto         Daemon: wait until 23:00 UTC, log entry, wait until 00:30, log exit, repeat
//   node src/clock-logger.js show <day>   Show a single day's trade detail
//
// Log file: data/trade-log.json
//
// We always store the open price of the matching 1-minute candle on Binance
// Spot. That's what the simulator used, so live and simulated results are
// directly comparable.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchKlines } from "./binance.js";
import { CLOCK_STRATEGY } from "./clock-strategy.js";

const LOG_PATH = path.resolve("data", "trade-log.json");
const FEES = {
  makerRoundTrip: 0.0004,
  takerRoundTrip: 0.001,
};
const fmtPct = (x) => `${(x * 100).toFixed(3)}%`;
const fmtSignedPct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(3)}%`;
const fmtUsd = (x) => `${x >= 0 ? "+" : "-"}$${Math.abs(x).toFixed(2)}`;

async function loadLog() {
  try {
    const raw = await fs.readFile(LOG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { trades: [] };
  }
}
async function saveLog(log) {
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
  await fs.writeFile(LOG_PATH, JSON.stringify(log, null, 2));
}

function todayUtcDate(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function entryDateForNow(now = new Date()) {
  // Entry happens at 23:00 UTC. If we're past 23:00 today, today's entry is today.
  // If we're before 23:00 today, the most recent entry was yesterday.
  const today = todayUtcDate(now);
  const entryToday = new Date(today.getTime() + 23 * 3600_000);
  return now >= entryToday ? today : new Date(today.getTime() - 86_400_000);
}

function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Fetch last 2 days of 1m candles and find the one whose openTime exactly
// equals the target UTC timestamp.
async function fetchPriceAt(symbol, targetTimeMs) {
  const candles = await fetchKlines(symbol, "1m", 2);
  const match = candles.find((c) => c.openTime === targetTimeMs);
  if (!match) {
    throw new Error(`No candle found at ${new Date(targetTimeMs).toISOString()} for ${symbol}`);
  }
  return match.open;
}

async function recordEntry() {
  const log = await loadLog();
  const entryDate = entryDateForNow();
  const dayKey = ymd(entryDate);
  const entryTime = new Date(entryDate.getTime() + 23 * 3600_000); // 23:00 UTC

  if (entryTime > new Date()) {
    console.log(`Entry time ${entryTime.toISOString()} is in the future. Wait until then.`);
    return;
  }

  const existing = log.trades.find((t) => t.date === dayKey);
  if (existing && existing.entries) {
    console.log(`Entry for ${dayKey} already recorded. Use 'exit' next.`);
    return;
  }

  console.log(`\n  Recording entry for ${dayKey} at ${entryTime.toISOString()}\n`);
  const entries = {};
  for (const c of CLOCK_STRATEGY.coins) {
    const price = await fetchPriceAt(c, entryTime.getTime());
    entries[c] = price;
    console.log(`    ${c.padEnd(10)} entry @ ${price}`);
  }

  if (existing) {
    existing.entryTime = entryTime.toISOString();
    existing.entries = entries;
  } else {
    log.trades.push({
      date: dayKey,
      entryTime: entryTime.toISOString(),
      entries,
      side: CLOCK_STRATEGY.side,
    });
  }
  await saveLog(log);
  console.log(`\n  Saved. Run 'exit' after ${new Date(entryTime.getTime() + CLOCK_STRATEGY.holdMinutes * 60_000).toISOString()}\n`);
}

async function recordExit() {
  const log = await loadLog();
  const entryDate = entryDateForNow();
  const dayKey = ymd(entryDate);
  const entryTime = new Date(entryDate.getTime() + 23 * 3600_000);
  const exitTime = new Date(entryTime.getTime() + CLOCK_STRATEGY.holdMinutes * 60_000);

  const trade = log.trades.find((t) => t.date === dayKey);
  if (!trade || !trade.entries) {
    console.log(`No entry recorded for ${dayKey}. Run 'entry' first.`);
    return;
  }
  if (trade.exits) {
    console.log(`Exit for ${dayKey} already recorded. See 'status'.`);
    return;
  }
  if (exitTime > new Date()) {
    console.log(`Exit time ${exitTime.toISOString()} is in the future. Wait until then.`);
    return;
  }

  console.log(`\n  Recording exit for ${dayKey} at ${exitTime.toISOString()}\n`);
  const exits = {};
  const pnlPerCoin = {};
  let basketSum = 0;
  for (const c of CLOCK_STRATEGY.coins) {
    const price = await fetchPriceAt(c, exitTime.getTime());
    exits[c] = price;
    const entry = trade.entries[c];
    const gross = trade.side === "short" ? (entry - price) / entry : (price - entry) / entry;
    pnlPerCoin[c] = gross;
    basketSum += gross;
    console.log(`    ${c.padEnd(10)} entry ${entry}  exit ${price}  gross ${fmtSignedPct(gross)}`);
  }
  const basketGross = basketSum / CLOCK_STRATEGY.coins.length;

  trade.exitTime = exitTime.toISOString();
  trade.exits = exits;
  trade.pnlPerCoinGross = pnlPerCoin;
  trade.basketGrossPct = basketGross;
  await saveLog(log);

  const makerNet = basketGross - FEES.makerRoundTrip;
  const takerNet = basketGross - FEES.takerRoundTrip;
  console.log(`\n  Basket gross:        ${fmtSignedPct(basketGross)}`);
  console.log(`  After maker fees:    ${fmtSignedPct(makerNet)}`);
  console.log(`  After taker fees:    ${fmtSignedPct(takerNet)}\n`);
}

async function status(capitalUsd = 500) {
  const log = await loadLog();
  const completed = log.trades.filter((t) => t.exits);
  if (completed.length === 0) {
    console.log("No completed trades yet. Run 'entry' at 23:00 UTC and 'exit' at 00:30 UTC.");
    return;
  }

  console.log(`\n  Forward-test track record (${completed.length} completed trades)`);
  console.log(`  Capital reference: $${capitalUsd}\n`);

  let cumGross = 0;
  let cumMaker = 0;
  let cumTaker = 0;
  let winsGross = 0;
  const rows = completed.map((t) => {
    cumGross += t.basketGrossPct;
    cumMaker += t.basketGrossPct - FEES.makerRoundTrip;
    cumTaker += t.basketGrossPct - FEES.takerRoundTrip;
    if (t.basketGrossPct > FEES.takerRoundTrip) winsGross++;
    return {
      Date: t.date,
      "Basket gross": fmtSignedPct(t.basketGrossPct),
      "Net (maker)": fmtSignedPct(t.basketGrossPct - FEES.makerRoundTrip),
      "Net (taker)": fmtSignedPct(t.basketGrossPct - FEES.takerRoundTrip),
      "Cum (maker)": fmtSignedPct(cumMaker),
      "$ (maker)": fmtUsd((t.basketGrossPct - FEES.makerRoundTrip) * capitalUsd),
    };
  });
  console.table(rows);

  const n = completed.length;
  console.log(`\n  Cumulative basket gross:       ${fmtSignedPct(cumGross)}   ($${(cumGross * capitalUsd).toFixed(2)})`);
  console.log(`  Cumulative after maker fees:   ${fmtSignedPct(cumMaker)}   ($${(cumMaker * capitalUsd).toFixed(2)})`);
  console.log(`  Cumulative after taker fees:   ${fmtSignedPct(cumTaker)}   ($${(cumTaker * capitalUsd).toFixed(2)})`);
  console.log(`  Per-day avg (maker):           ${fmtSignedPct(cumMaker / n)}`);
  console.log(`  Win days (gross > taker fee):  ${winsGross} / ${n} (${(winsGross / n * 100).toFixed(1)}%)`);
  console.log(`  Best day (gross):              ${fmtSignedPct(Math.max(...completed.map((t) => t.basketGrossPct)))}`);
  console.log(`  Worst day (gross):             ${fmtSignedPct(Math.min(...completed.map((t) => t.basketGrossPct)))}`);
  console.log(`\n  Backtest expected:             +0.04% to +0.10% per day (maker)`);
  if (n >= 5) {
    const dailyAvgMaker = cumMaker / n;
    if (dailyAvgMaker > 0.0004) console.log(`  Status: ABOVE backtest expectation ✓`);
    else if (dailyAvgMaker > 0) console.log(`  Status: WITHIN backtest range`);
    else console.log(`  Status: BELOW expectation — edge may be decaying or sample too small`);
  } else {
    console.log(`  Status: too few trades (need >=5) to compare meaningfully`);
  }
  console.log();
}

async function showDay(dayArg) {
  const log = await loadLog();
  const t = log.trades.find((x) => x.date === dayArg);
  if (!t) {
    console.log(`No trade logged for ${dayArg}`);
    return;
  }
  console.log(`\n  ${dayArg}`);
  console.log(`  Entry: ${t.entryTime || "(not recorded)"}`);
  console.log(`  Exit:  ${t.exitTime || "(not recorded)"}`);
  if (t.entries) {
    console.log(`\n  Entries (${t.side}):`);
    for (const [c, p] of Object.entries(t.entries)) console.log(`    ${c.padEnd(10)} ${p}`);
  }
  if (t.exits) {
    console.log(`\n  Exits:`);
    for (const [c, p] of Object.entries(t.exits)) console.log(`    ${c.padEnd(10)} ${p}  (gross ${fmtSignedPct(t.pnlPerCoinGross[c])})`);
    console.log(`\n  Basket gross: ${fmtSignedPct(t.basketGrossPct)}`);
  }
  console.log();
}

async function sleepUntil(targetMs) {
  while (Date.now() < targetMs) {
    const remaining = targetMs - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(remaining, 60_000)));
  }
}

async function autoLoop() {
  console.log(`\n  Auto mode. Will record entries at 23:00 UTC and exits at 00:30 UTC every day.`);
  console.log(`  Press Ctrl+C to stop.\n`);
  while (true) {
    const now = new Date();
    const today = todayUtcDate(now);
    let nextEntry = new Date(today.getTime() + 23 * 3600_000);
    if (now >= nextEntry) nextEntry = new Date(nextEntry.getTime() + 86_400_000);
    console.log(`  [${new Date().toISOString()}] Sleeping until next entry: ${nextEntry.toISOString()}`);
    await sleepUntil(nextEntry.getTime() + 60_000); // wait an extra minute so the candle is fully closed and indexable
    try {
      await recordEntry();
    } catch (e) {
      console.error(`  Entry error: ${e.message}`);
    }
    const exitTime = new Date(nextEntry.getTime() + CLOCK_STRATEGY.holdMinutes * 60_000);
    console.log(`  [${new Date().toISOString()}] Sleeping until exit: ${exitTime.toISOString()}`);
    await sleepUntil(exitTime.getTime() + 60_000);
    try {
      await recordExit();
    } catch (e) {
      console.error(`  Exit error: ${e.message}`);
    }
  }
}

async function main() {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  switch (cmd) {
    case "entry": await recordEntry(); break;
    case "exit": await recordExit(); break;
    case "status": await status(arg ? parseFloat(arg) : 500); break;
    case "show": await showDay(arg); break;
    case "auto": await autoLoop(); break;
    default:
      console.log(`Usage:
  node src/clock-logger.js entry          Record entries at/after 23:00 UTC
  node src/clock-logger.js exit           Record exits and compute PnL at/after 00:30 UTC
  node src/clock-logger.js status [cap]   Show track record (default capital $500)
  node src/clock-logger.js show YYYY-MM-DD
  node src/clock-logger.js auto           Daemon: log entries/exits automatically`);
  }
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });

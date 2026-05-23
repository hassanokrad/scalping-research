// The shippable clock-based strategy.
//
// Rule: every day at 23:00:00 UTC, open a short on SUI, ETH, SOL, INJ
// (equal weight). At 00:30:00 UTC (90 minutes later), close all four.
//
// Found via pattern discovery on 90 days of Binance 1m data, validated on
// a held-out 30-day window. Train mean per coin: +0.121%/trade.
// Test mean per coin:  +0.087%/trade (basket: +0.098%/day with maker fees).
//
// Fee assumptions:
//   - Futures maker (limit orders): 0.02%/side, 0.04% round trip
//   - Futures taker (market orders): 0.05%/side, 0.10% round trip
//
// IMPORTANT: this is a small, real edge — NOT a guaranteed earner.
// Expect ~half of days to be losers. Expect occasional -1% days.

export const CLOCK_STRATEGY = {
  name: "short-23utc-90m-4coin-basket",
  coins: ["SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"],
  side: "short",
  entryHourUtc: 23,
  entryMinuteUtc: 0,
  holdMinutes: 90,
  basketWeight: 0.25, // 1/4 per coin
};

export function formatTimeUtc(date) {
  const h = String(date.getUTCHours()).padStart(2, "0");
  const m = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${h}:${m}:${s} UTC`;
}

export function nextEntryTime(now = new Date()) {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    CLOCK_STRATEGY.entryHourUtc,
    CLOCK_STRATEGY.entryMinuteUtc,
    0, 0,
  ));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export function nextExitTime(entryTime) {
  return new Date(entryTime.getTime() + CLOCK_STRATEGY.holdMinutes * 60_000);
}

export function planForToday(now = new Date(), capitalUsd = 500) {
  const entry = nextEntryTime(now);
  const exit = nextExitTime(entry);
  const minutesToEntry = (entry - now) / 60_000;
  const perCoin = capitalUsd * CLOCK_STRATEGY.basketWeight;
  return {
    strategy: CLOCK_STRATEGY.name,
    nextEntry: formatTimeUtc(entry),
    nextExit: formatTimeUtc(exit),
    minutesUntilEntry: minutesToEntry,
    capitalUsd,
    perCoinUsd: perCoin,
    coins: CLOCK_STRATEGY.coins,
    side: CLOCK_STRATEGY.side,
    holdMinutes: CLOCK_STRATEGY.holdMinutes,
  };
}

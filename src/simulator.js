// Walk-forward trade simulator.
//
// For each candle, "enter long" at its open. Walk subsequent candles until
// either the take-profit or stop-loss level is hit. If the same candle hits
// both, the intracandle path is unknown — we report two bounds:
//   - optimistic: assume TP was reached first (best case)
//   - pessimistic: assume SL was reached first (worst case, the honest one)
//
// Mode "nonOverlapping" (default): after a trade resolves at candle N,
// the next entry is candle N+1 — no overlapping positions. This matches how
// you would actually trade with one position at a time.

export function simulateWalkForward(candles, tp, sl, opts = {}) {
  const nonOverlapping = opts.nonOverlapping !== false;
  const trades = [];

  let i = 0;
  while (i < candles.length - 1) {
    const entry = candles[i];
    if (entry.open <= 0) {
      i++;
      continue;
    }
    const tpPrice = entry.open * (1 + tp);
    const slPrice = entry.open * (1 - sl);

    let resolved = false;
    let outcomeOpt = null; // optimistic outcome
    let outcomePess = null; // pessimistic outcome
    let exitIdx = candles.length - 1;

    for (let j = i + 1; j < candles.length; j++) {
      const c = candles[j];
      const hitTp = c.high >= tpPrice;
      const hitSl = c.low <= slPrice;
      if (hitTp && hitSl) {
        outcomeOpt = "win";
        outcomePess = "loss";
        exitIdx = j;
        resolved = true;
        break;
      } else if (hitTp) {
        outcomeOpt = "win";
        outcomePess = "win";
        exitIdx = j;
        resolved = true;
        break;
      } else if (hitSl) {
        outcomeOpt = "loss";
        outcomePess = "loss";
        exitIdx = j;
        resolved = true;
        break;
      }
    }

    const minutes = resolved
      ? (candles[exitIdx].closeTime - entry.openTime) / 60_000
      : null;

    trades.push({
      entryIdx: i,
      entryTime: entry.openTime,
      entryPrice: entry.open,
      exitIdx,
      resolved,
      outcomeOpt,
      outcomePess,
      minutes,
    });

    if (nonOverlapping && resolved) {
      i = exitIdx + 1;
    } else if (nonOverlapping && !resolved) {
      break; // no more entries fit
    } else {
      i++;
    }
  }

  return aggregate(trades, tp, sl);
}

function aggregate(trades, tp, sl) {
  const resolved = trades.filter((t) => t.resolved);
  const winsOpt = resolved.filter((t) => t.outcomeOpt === "win").length;
  const winsPess = resolved.filter((t) => t.outcomePess === "win").length;
  const ambiguous = resolved.filter(
    (t) => t.outcomeOpt === "win" && t.outcomePess === "loss",
  ).length;
  const unresolved = trades.length - resolved.length;

  const winRateOpt = resolved.length ? winsOpt / resolved.length : 0;
  const winRatePess = resolved.length ? winsPess / resolved.length : 0;

  const minutes = resolved.map((t) => t.minutes);
  const avgMinutes =
    minutes.length > 0 ? minutes.reduce((a, b) => a + b, 0) / minutes.length : 0;
  const medianMinutes = median(minutes);

  return {
    tp,
    sl,
    totalEntries: trades.length,
    resolved: resolved.length,
    unresolved,
    winsOpt,
    winsPess,
    ambiguous,
    winRateOpt,
    winRatePess,
    avgMinutes,
    medianMinutes,
    trades,
  };
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// Expected value per trade, as a fraction of capital, given a win rate and
// a fee charged once per round trip.
export function expectedValue(winRate, tp, sl, feeRoundTrip) {
  const netWin = tp - feeRoundTrip;
  const netLoss = sl + feeRoundTrip;
  return winRate * netWin - (1 - winRate) * netLoss;
}

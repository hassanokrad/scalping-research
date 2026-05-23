// Generic walk-forward engine.
//
// A "strategy" is { name, side: "long"|"short", tp, sl, shouldEnter(i, ctx) }
// where ctx contains precomputed indicator arrays and the candles themselves.
// The engine walks the candles non-overlappingly: at index i, if the strategy
// signals entry, we open a trade and walk forward until TP or SL hits, then
// resume at the next candle.

export function runStrategy(candles, ctx, strategy, options = {}) {
  const { side, tp, sl } = strategy;
  const startIdx = options.startIdx ?? 0;
  const endIdx = options.endIdx ?? candles.length - 1;
  const tpFrac = tp;
  const slFrac = sl;

  const trades = [];
  let i = startIdx;
  let skipped = 0;

  while (i < endIdx) {
    if (!strategy.shouldEnter(i, ctx)) {
      skipped++;
      i++;
      continue;
    }
    // FIX (look-ahead bias): signal computed on close[i] is only knowable
    // AFTER candle i ends. Earliest realistic fill is open[i+1].
    const entryIdx = i + 1;
    if (entryIdx >= candles.length) break;
    const entry = candles[entryIdx];
    if (entry.open <= 0) {
      i++;
      continue;
    }

    let tpPrice, slPrice;
    if (side === "long") {
      tpPrice = entry.open * (1 + tpFrac);
      slPrice = entry.open * (1 - slFrac);
    } else {
      tpPrice = entry.open * (1 - tpFrac);
      slPrice = entry.open * (1 + slFrac);
    }

    let outcomeOpt = null;
    let outcomePess = null;
    let exitIdx = endIdx;
    let resolved = false;

    for (let j = entryIdx; j <= endIdx; j++) {
      const c = candles[j];
      let hitTp, hitSl;
      if (side === "long") {
        hitTp = c.high >= tpPrice;
        hitSl = c.low <= slPrice;
      } else {
        hitTp = c.low <= tpPrice;
        hitSl = c.high >= slPrice;
      }
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
      entryIdx,
      entryTime: entry.openTime,
      entryPrice: entry.open,
      side,
      exitIdx,
      resolved,
      outcomeOpt,
      outcomePess,
      minutes,
    });

    if (resolved) i = exitIdx + 1;
    else break;
  }

  return summarize(trades, tp, sl, skipped, endIdx - startIdx);
}

function summarize(trades, tp, sl, skipped, totalCandles) {
  const resolved = trades.filter((t) => t.resolved);
  const winsOpt = resolved.filter((t) => t.outcomeOpt === "win").length;
  const winsPess = resolved.filter((t) => t.outcomePess === "win").length;
  const ambiguous = resolved.filter(
    (t) => t.outcomeOpt === "win" && t.outcomePess === "loss",
  ).length;

  const winRateOpt = resolved.length ? winsOpt / resolved.length : 0;
  const winRatePess = resolved.length ? winsPess / resolved.length : 0;

  const mins = resolved.map((t) => t.minutes);
  const avgMinutes = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0;

  return {
    tp,
    sl,
    skipped,
    totalCandles,
    selectivity: totalCandles ? trades.length / totalCandles : 0,
    totalEntries: trades.length,
    resolved: resolved.length,
    unresolved: trades.length - resolved.length,
    winsOpt,
    winsPess,
    ambiguous,
    winRateOpt,
    winRatePess,
    avgMinutes,
    trades,
  };
}

// Expected value per trade as a fraction of capital, given a win rate and
// per-side fee.
export function expectedValue(winRate, tp, sl, feeRoundTrip) {
  const netWin = tp - feeRoundTrip;
  const netLoss = sl + feeRoundTrip;
  return winRate * netWin - (1 - winRate) * netLoss;
}

// Total simulated PnL across all trades, as % of capital (no compounding).
export function totalPnl(summary, feeRoundTrip, which = "winRatePess") {
  const wr = summary[which];
  return summary.resolved * expectedValue(wr, summary.tp, summary.sl, feeRoundTrip);
}

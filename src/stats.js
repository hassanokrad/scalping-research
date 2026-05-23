export function countMoves(candles, thresholds) {
  const counts = {
    up: Object.fromEntries(thresholds.up.map((t) => [t, 0])),
    down: Object.fromEntries(thresholds.down.map((t) => [t, 0])),
  };

  for (const c of candles) {
    if (c.open <= 0) continue;
    const upPct = (c.high - c.open) / c.open;
    const downPct = (c.open - c.low) / c.open;
    for (const t of thresholds.up) if (upPct >= t) counts.up[t]++;
    for (const t of thresholds.down) if (downPct >= t) counts.down[t]++;
  }

  return counts;
}

export function simulateTpSl(candles, tp, sl) {
  let wins = 0;
  let losses = 0;
  let ambiguous = 0;

  for (const c of candles) {
    if (c.open <= 0) continue;
    const upPct = (c.high - c.open) / c.open;
    const downPct = (c.open - c.low) / c.open;
    const hitTp = upPct >= tp;
    const hitSl = downPct >= sl;
    if (hitTp && !hitSl) wins++;
    else if (!hitTp && hitSl) losses++;
    else if (hitTp && hitSl) ambiguous++;
  }

  const decisive = wins + losses;
  const winRate = decisive > 0 ? wins / decisive : 0;
  return { wins, losses, ambiguous, winRate };
}

export function summarize(symbol, candles, thresholds, strategy, inverse) {
  const counts = countMoves(candles, thresholds);
  const total = candles.length;
  const firstOpen = candles[0]?.openTime;
  const lastClose = candles[candles.length - 1]?.closeTime;
  const hours = (lastClose - firstOpen) / 3_600_000;

  const pct = (n) => (total ? (n / total) * 100 : 0);
  const perHour = (n) => (hours > 0 ? n / hours : 0);

  return {
    symbol,
    total,
    firstOpen,
    lastClose,
    hours,
    lastPrice: candles[candles.length - 1]?.close,
    up05: counts.up[0.005],
    up10: counts.up[0.01],
    down05: counts.down[0.005],
    down10: counts.down[0.01],
    up05Pct: pct(counts.up[0.005]),
    up10Pct: pct(counts.up[0.01]),
    down05Pct: pct(counts.down[0.005]),
    down10Pct: pct(counts.down[0.01]),
    up05PerHour: perHour(counts.up[0.005]),
    up10PerHour: perHour(counts.up[0.01]),
    strategy: simulateTpSl(candles, strategy.tp, strategy.sl),
    inverse: simulateTpSl(candles, inverse.tp, inverse.sl),
  };
}

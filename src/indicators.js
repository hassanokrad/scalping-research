// Streaming indicators. All return arrays aligned with the input candles,
// with `null` entries for the warm-up region where the indicator cannot be
// computed yet.

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (prev == null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

export function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  const trs = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    trs.push(tr);
    if (i >= period - 1) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += trs[j];
      out[i] = sum / period;
    }
  }
  return out;
}

// Returns the candle hour in UTC (0..23). Useful for time-of-day filters.
export function hourOfDay(candles) {
  return candles.map((c) => new Date(c.openTime).getUTCHours());
}

// Rolling percentile rank (0..1) of `values[i]` within the last `window` values.
// Useful for "is current ATR in the top quartile" type questions.
export function rollingRank(values, window) {
  const out = new Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    let below = 0;
    let count = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const x = values[j];
      if (x == null) continue;
      count++;
      if (x < v) below++;
    }
    out[i] = count > 0 ? below / count : null;
  }
  return out;
}

// Body and wick characteristics for the current candle.
export function bodyMetrics(candles) {
  return candles.map((c) => {
    const range = c.high - c.low;
    const body = Math.abs(c.close - c.open);
    const isGreen = c.close >= c.open;
    return {
      range,
      body,
      bodyPct: range > 0 ? body / range : 0,
      isGreen,
      upperWick: c.high - Math.max(c.open, c.close),
      lowerWick: Math.min(c.open, c.close) - c.low,
    };
  });
}

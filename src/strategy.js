// The winning strategy from the Phase 5 research loop.
//
// Direction is picked by a slow regime EMA (EMA200 on 1m). A trade is taken
// when the fast EMA50 agrees with the regime. Long when price is above both;
// short when price is below both. Take-profit +1.0%, stop-loss -0.5%.
//
// Designed for Binance USDT-M Futures with maker fees (0.02%/side).
// Win rate is ~40% but each win is twice as big as each loss.

import { ema } from "./indicators.js";

export const STRATEGY_CONFIG = {
  name: "regime-adaptive-1.0-0.5",
  fastPeriod: 50,
  slowPeriod: 200,
  tp: 0.01, // +1.0%
  sl: 0.005, // -0.5%
  venue: "binance-futures",
  feeRoundTrip: 0.0004,
};

export function buildSignalContext(candles) {
  const closes = candles.map((c) => c.close);
  return {
    candles,
    closes,
    ema50: ema(closes, STRATEGY_CONFIG.fastPeriod),
    ema200: ema(closes, STRATEGY_CONFIG.slowPeriod),
  };
}

// Returns: "long" | "short" | "flat"
export function signalAt(i, ctx) {
  const close = ctx.closes[i];
  const ema50 = ctx.ema50[i];
  const ema200 = ctx.ema200[i];
  if (close == null || ema50 == null || ema200 == null) return "flat";
  if (close > ema50 && close > ema200) return "long";
  if (close < ema50 && close < ema200) return "short";
  return "flat";
}

export function computeOrder(entryPrice, side) {
  const { tp, sl } = STRATEGY_CONFIG;
  if (side === "long") {
    return {
      side: "long",
      entry: entryPrice,
      takeProfit: entryPrice * (1 + tp),
      stopLoss: entryPrice * (1 - sl),
    };
  }
  if (side === "short") {
    return {
      side: "short",
      entry: entryPrice,
      takeProfit: entryPrice * (1 - tp),
      stopLoss: entryPrice * (1 + sl),
    };
  }
  return null;
}

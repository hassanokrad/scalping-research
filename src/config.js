export const WATCHLIST = [
  "SUIUSDT",
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
];

export const LOOKBACK_DAYS = 7;
export const INTERVAL = "1m";

export const THRESHOLDS = {
  up: [0.005, 0.01],
  down: [0.005, 0.01],
};

export const FEES = {
  spotTakerRoundTrip: 0.002,
  spotTakerBnbRoundTrip: 0.0015,
  futuresTakerRoundTrip: 0.001,
  futuresMakerRoundTrip: 0.0004,
};

export const STRATEGY = {
  tp: 0.005,
  sl: 0.01,
};

export const INVERSE_STRATEGY = {
  tp: 0.01,
  sl: 0.005,
};

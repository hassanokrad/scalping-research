# Scalping Pre-Study — Move Frequency Analyzer

**Authors:** (omitted)
**Date:** 2026-05-23
**Status:** Brainstorm / spec — not yet implemented

---

## 1. The core idea (in one paragraph)

Before risking any money scalping, we want **hard numbers** about how a coin actually behaves. The plan is to scalp with a **+0.5% take-profit** and a **-1% stop-loss** on a demo account (~$500 per trade). Instead of guessing whether that's realistic, we will first build a Node.js script that scans the **last 7 days of 1-minute candles** for a watchlist of coins (starting with **SUI**) and counts how often a 0.5% up-move and a 1% down-move actually happen. The output tells us, per coin, whether the market gives us enough +0.5% opportunities — and how often a -1% drawdown shows up — to make the strategy viable.

---

## 2. What we are NOT doing (yet)

To stay focused:

- ❌ No live trading, no API keys, no orders. Read-only public market data only.
- ❌ No backtesting of a full strategy with entries/exits. That comes later.
- ❌ No machine learning, no indicators (RSI/MACD/etc.). Just raw price-move counting.
- ❌ No multi-timeframe analysis. **1-minute candles only.**

---

## 3. Strategy assumptions (the trade we want to test later)

| Parameter | Value |
|---|---|
| Capital per trade | $500 (demo) |
| Take-profit (TP) | +0.5% |
| Stop-loss (SL) | -1% |
| Risk/Reward | 1 : 0.5 (we risk $5 to make $2.50) |
| Watchlist | **SUI, BTC, ETH, SOL, BNB, XRP** (top liquid majors + SUI) |
| Market | Binance — **both Spot and Futures compared** |
| Timeframe | 1-minute candles, last 7 days |

### ⚠️ Risk-math warning (important — read this)

A 0.5% TP with a 1% SL is **2:1 against us**. For the strategy to merely break even *before fees*:

```
win_rate × 0.5%  =  loss_rate × 1.0%
win_rate         =  2 × loss_rate
break-even win rate = 66.7%
```

We must win **2 out of every 3 trades** just to be flat — and that's before Binance takes its cut. After fees, the required win rate goes higher (see §5).

This is not a reason to abandon the idea — but it means the script's job is partly to tell us whether **66%+ of +0.5% moves happen before a -1% drawdown** on these coins. If the data says "no", we change the TP/SL ratio, not push forward and lose money.

### Inverse setup (also tested in script)

To compare, the script will also report stats for the **inverse**: +1% TP / -0.5% SL. That setup needs only a **33% win rate** to break even — much more forgiving but requires bigger moves.

---

## 4. What the script will do (MVP)

### Inputs
- Hardcoded watchlist (editable in a config object at top of file):
  `["SUIUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]`
- Lookback: 7 days (10,080 one-minute candles per coin)
- Thresholds: `+0.5%`, `+1%`, `-0.5%`, `-1%` (configurable)

### Data source
**Binance public REST API** — `GET /api/v3/klines` (Spot) and `GET /fapi/v1/klines` (Futures).
No API key needed. Rate limit is generous (1200 req/min weight). 7 days × 1m = 10,080 candles = 11 paginated requests per coin (limit 1000 per call).

### Counting logic — Independent counts (chosen approach)

For each 1-minute candle in the 7-day window, independently count:

| Metric | Definition |
|---|---|
| `up_0.5%_count` | candles where `(high − open) / open ≥ 0.005` |
| `up_1%_count` | candles where `(high − open) / open ≥ 0.01` |
| `down_0.5%_count` | candles where `(open − low) / open ≥ 0.005` |
| `down_1%_count` | candles where `(open − low) / open ≥ 0.01` |

Plus useful context:
- Total candles in window
- % of candles that hit each threshold
- Average per hour / per day
- Current spot price for sanity check

### Output (console table only — MVP)

```
Coin       1m candles   +0.5% up   +1% up    -0.5% down  -1% down
SUIUSDT    10,080       1,842 (18%)  287 (3%)   1,910 (19%)  301 (3%)
BTCUSDT    10,080       412  (4%)    38  (0.4%) 405  (4%)    41  (0.4%)
...

Per-hour averages (+0.5% up moves):
SUI: 10.96 / hr    BTC: 2.45 / hr    ...
```

---

## 5. Fee comparison (both included in doc + script output)

### Binance Spot
- Standard taker fee: **0.10% per side** → **0.20% round trip**
- With BNB discount: 0.075% per side → **0.15% round trip**
- **Net profit on a +0.5% TP after fees:** `0.5% − 0.20% = 0.30%` (or `0.35%` with BNB)
- **Net loss on a -1% SL after fees:** `1.0% + 0.20% = 1.20%`
- **Real break-even win rate (Spot, no BNB):** `1.20 / (0.30 + 1.20) = 80%`
- **Real break-even win rate (Spot, with BNB):** `~77%`

### Binance Futures (USDT-M)
- Taker fee: **0.05% per side** → **0.10% round trip**
- Maker fee: **0.02% per side** → **0.04% round trip**
- **Net profit on +0.5% TP after taker fees:** `0.5% − 0.10% = 0.40%`
- **Net loss on -1% SL after taker fees:** `1.0% + 0.10% = 1.10%`
- **Real break-even win rate (Futures, taker):** `1.10 / (0.40 + 1.10) = 73%`
- **Real break-even win rate (Futures, maker):** `~69%`

### Bottom line
Even on the cheapest venue (Futures maker), the strategy still needs ~**70% win rate**. The script must show that **+0.5% moves are at least 2× more frequent than -1% moves** on the chosen coin before we should believe this is workable.

---

## 6. Decision tree after we run the script

```
Run script → look at SUI numbers
│
├── If (+0.5% up count) >> (-1% down count) by 2× or more:
│     → strategy is plausible. Next step: build a proper
│       backtest that simulates entries and tracks TP-before-SL.
│
├── If counts are roughly equal:
│     → strategy is a coin flip after fees → DO NOT trade it.
│       Test the inverse (1% TP / 0.5% SL) instead.
│
└── If (-1% down count) > (+0.5% up count):
      → coin is in a bad regime for long-only scalping.
        Try another coin or wait for different market conditions.
```

---

## 7. Open questions / things to decide later

1. **Direction bias.** Right now we only count moves; we don't say "from where". A +0.5% candle in an overall downtrend is different from one in an uptrend. We may want to add a daily-trend filter (e.g. price above/below 24h VWAP) in v2.
2. **Spread & slippage.** On thin coins, the bid-ask spread alone can eat 0.05–0.1%. Not modeled in MVP. SUI is liquid enough that this is probably fine, but for any low-cap addition we'd need to model it.
3. **TP-before-SL simulation.** Independent counts tell us frequency but not sequencing. A coin can have many +0.5% moves AND many -1% moves but always hit SL first. Logical v2 feature.
4. **Time-of-day patterns.** Are +0.5% moves clustered around US/Asia open? Worth a histogram in v2.
5. **Collaboration logistics.** Will the second collaborator run the script too, or just discuss results? Affects whether we need a shared doc / dashboard.

---

## 8. Proposed file layout (when we start coding)

```
scalping/
├── IDEA.md                  ← this file
├── package.json
├── src/
│   ├── analyze.js           ← entry point: runs the full report
│   ├── binance.js           ← fetches klines (Spot + Futures)
│   ├── stats.js             ← counts moves over thresholds
│   └── config.js            ← watchlist, thresholds, lookback days
└── README.md                ← how to run (created when code exists)
```

Stack:
- Node.js 20+
- Zero dependencies if possible (use built-in `fetch`); fallback to `node-fetch` only if needed.
- Console table via plain `console.table()` — no chalk/cli-table for MVP.

---

## 9. Next step (when you give the go-ahead)

Build the MVP script per §4 and §8, run it once for the watchlist, paste the table here under a new **§10 First results** section, and **then** decide whether the strategy is worth a real demo run.

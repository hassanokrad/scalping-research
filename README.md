# Scalping Research

Node.js scripts for researching a scalping strategy on Binance Futures.

The project went through ~600 strategy variants across multiple phases. The final shipped strategy is a **UTC clock-based pattern** validated across 6 independent 30-day windows.

See [`IDEA.md`](./IDEA.md) for the original brainstorm.

## The strategy

**Short the 4-coin basket (SUI, ETH, SOL, INJ) at 23:00 UTC sharp, hold 90 minutes, close at 00:30 UTC.**

- Validated on 180 days of 1-minute Binance data, 5 of 6 independent 30-day windows profitable
- Expected return: ~+0.17%/day average (maker fees), ~+0.11%/day (taker)
- Win rate: ~58% of days
- Worst day in 180 days of testing: −2.98%
- Best day: +8.19%

The pattern is small and statistical, not a guaranteed earner. Use maker (limit) orders to keep the edge.

## Setup

```bash
node --version  # need 20+
```

Zero dependencies. Just clone and run.

## Key scripts

```bash
# Cache 90-day market data (do this first)
node src/fetch-90d.js

# Phased research (read top to bottom to follow the loop)
node src/research-p1.js                # TP/SL grid baseline
node src/research-p2.js                # Filter sweep
node src/research-p3.js                # Combo filters + bidirectional
node src/research-p4.js                # OOS validation (where the look-ahead bug bit us)
node src/research-p5.js                # Regime-adaptive bidirectional (later invalidated by bug fix)
node src/research-patterns.js          # Hour/day clock pattern discovery
node src/research-windows.js           # Clock-window simulation
node src/research-refine.js            # Hold-time tuning
node src/research-mtf.js               # Multi-timeframe EMA test (no edge survives)
node src/research-rolling.js           # 6 independent 30-day windows on 180d data

# The shipped strategy
node src/clock-live.js 500             # Today's plan for $500 capital
node src/clock-logger.js entry         # Log entry at/after 23:00 UTC
node src/clock-logger.js exit          # Log exit at/after 00:30 UTC
node src/clock-logger.js status        # Forward-test track record
node src/clock-logger.js auto          # Daemon: auto-log entries and exits
```

## Important lessons learned

1. **Look-ahead bias kills naive backtests.** The original "winning" strategy showed +27% in OOS test but was 100% an artifact of computing entry signals from `close[i]` while filling at `open[i]`. The fix: enter at `open[i+1]`. After the fix, all indicator strategies showed zero or negative edge.

2. **Backtest returns over ~30%/year are a red flag, not a win.** Real edges in liquid retail markets are fractions of a percent per day, not percent per hour.

3. **Single train/test split is not enough.** Rolling/walk-forward windows with multiple non-overlapping samples is far more honest.

4. **An external review (via another LLM) caught the look-ahead bug.** A skeptical second opinion is worth more than another strategy iteration.

## Repository layout

```
src/
├── binance.js            # Klines fetcher (no auth, public API)
├── cache.js              # Disk cache for candles
├── config.js             # Watchlist, thresholds, fees
├── indicators.js         # EMA, RSI, ATR, body metrics
├── engine.js             # Walk-forward backtest engine (look-ahead-fixed)
├── stats.js              # Move-frequency stats
├── simulator.js          # Older TP/SL simulator
├── strategy.js           # Pre-bug-fix EMA strategy (kept for history)
├── clock-strategy.js     # Final clock-based strategy spec
├── clock-live.js         # Print today's trade plan
├── clock-logger.js       # Forward-test logger
├── live-signal.js        # Live indicator signal (old)
├── fetch-90d.js          # Cache 90 days for the basket
├── research-p1..p5.js    # Original phased research
├── research-multi-coin.js# Robustness across 12 coins
├── research-patterns.js  # Hour-of-day pattern discovery
├── research-windows.js   # Clock-window simulation
├── research-refine.js    # Hold-time tuning
├── research-mtf.js       # Multi-timeframe test
└── research-rolling.js   # 6-window robustness test
```

## Disclaimer

This is research code. The edge is small (~$25/month on $500). The strategy is not financial advice. Forward-test on Binance Demo for at least 14 days before risking real money.

// Interactive trading simulator v2: 365 days, multi-coin, Spot/Futures fees,
// BNB discount, multi-strategy (23:00 short + 19:00 long), coin selection.

import { promises as fs } from "node:fs";
import path from "node:path";
import { loadOrFetch } from "./cache.js";

const ALL_COINS = [
  "SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT",
  "NEARUSDT", "SEIUSDT", "APTUSDT", "AVAXUSDT",
  "DOGEUSDT", "XRPUSDT", "FETUSDT", "RNDRUSDT",
];
const SHORT_HOUR_UTC = 23;
const LONG_HOUR_UTC = 19;
const HOLD_MIN = 90;
const DAYS = 365;

async function main() {
  console.log(`Loading ${DAYS} days for ${ALL_COINS.length} coins...`);
  const byCoin = {};
  for (const c of ALL_COINS) {
    try {
      byCoin[c] = await loadOrFetch(c, "1m", DAYS, 24 * 60);
    } catch (e) {
      console.log(`  WARN: ${c} unavailable — ${e.message}`);
    }
  }
  const availableCoins = Object.keys(byCoin);
  console.log(`Available: ${availableCoins.length} coins\n`);

  console.log("Building per-day records...");
  // For each coin, for each day, capture short-trade (23 UTC) and long-trade (19 UTC) prices.
  const tradesByCoinDay = new Map(); // key = `${coin}|${day}` -> { shortEntry, shortExit, longEntry, longExit }
  for (const c of availableCoins) {
    const candles = byCoin[c];
    for (let i = 0; i < candles.length - HOLD_MIN; i++) {
      const t = new Date(candles[i].openTime);
      const hour = t.getUTCHours();
      const min = t.getUTCMinutes();
      if (min !== 0) continue;
      const day = t.toISOString().slice(0, 10);
      const entry = candles[i].open;
      const exit = candles[i + HOLD_MIN].open;
      if (entry <= 0) continue;
      const key = `${c}|${day}`;
      if (!tradesByCoinDay.has(key)) tradesByCoinDay.set(key, {});
      if (hour === SHORT_HOUR_UTC) {
        tradesByCoinDay.get(key).shortEntry = entry;
        tradesByCoinDay.get(key).shortExit = exit;
      } else if (hour === LONG_HOUR_UTC) {
        tradesByCoinDay.get(key).longEntry = entry;
        tradesByCoinDay.get(key).longExit = exit;
      }
    }
  }

  // Build day index
  const dayList = new Set();
  for (const k of tradesByCoinDay.keys()) dayList.add(k.split("|")[1]);
  const days = [...dayList].sort();

  // Build embed: days array + per-day per-coin trades
  const embed = days
    .map((day) => {
      const row = { day, coins: {} };
      let valid = 0;
      for (const c of availableCoins) {
        const r = tradesByCoinDay.get(`${c}|${day}`);
        if (r && r.shortEntry && r.shortExit && r.longEntry && r.longExit) {
          row.coins[c] = r;
          valid++;
        }
      }
      row.validCoins = valid;
      return row;
    })
    .filter((row) => row.validCoins >= availableCoins.length * 0.8); // require most coins present
  console.log(`${embed.length} complete trading days across ${availableCoins.length} coins`);

  const html = render(embed, availableCoins);
  const outPath = path.resolve("simulator.html");
  await fs.writeFile(outPath, html);
  const stat = await fs.stat(outPath);
  console.log(`\n  Simulator written: ${outPath} (${(stat.size / 1024).toFixed(0)} KB)`);
  console.log(`  Open with:  start simulator.html\n`);
}

function render(data, coins) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Clock Strategy — Interactive Simulator v2</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0b0e11; --panel: #1e2329; --panel-2: #2b3139;
    --text: #eaecef; --muted: #848e9c;
    --green: #0ecb81; --red: #f6465d; --accent: #f0b90b;
    --border: #2b3139;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }
  header { background: var(--panel); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header h1 span { color: var(--accent); }
  header .subtitle { color: var(--muted); font-size: 13px; }
  .controls-section { background: var(--panel); border-bottom: 1px solid var(--border); padding: 16px 24px; }
  .controls-section h3 { margin: 0 0 10px 0; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .control { display: flex; flex-direction: column; gap: 4px; }
  .control label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .control input, .control select { background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); padding: 8px 10px; font-size: 14px; font-family: inherit; }
  .control input:focus, .control select:focus { outline: none; border-color: var(--accent); }
  .coin-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 6px; margin-top: 6px; }
  .coin-toggle { background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; padding: 6px 10px; cursor: pointer; user-select: none; font-size: 13px; text-align: center; transition: all 0.1s; }
  .coin-toggle.on { background: var(--accent); color: #1e2329; border-color: var(--accent); font-weight: 600; }
  .coin-toggle:hover { border-color: var(--accent); }
  .btn-row { padding: 12px 24px; background: var(--panel); border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button { background: var(--accent); color: #1e2329; border: none; padding: 10px 18px; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 14px; }
  button:hover { background: #fcd535; }
  button.secondary { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  button.secondary:hover { background: #3c424b; }
  .speed-slider { display: flex; gap: 8px; align-items: center; margin-left: auto; }
  main { display: grid; grid-template-columns: 320px 1fr; gap: 16px; padding: 16px 24px; }
  .dashboard, .equity-card, .trades-card { background: var(--panel); border-radius: 8px; padding: 16px; }
  .dashboard h2, .equity-card h2, .trades-card h2 { margin: 0 0 12px 0; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
  .stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .stat:last-child { border-bottom: none; }
  .stat .label { color: var(--muted); }
  .stat .val { font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat .val.green { color: var(--green); }
  .stat .val.red { color: var(--red); }
  canvas { max-height: 320px; }
  .trades-card { grid-column: 1 / -1; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; font-variant-numeric: tabular-nums; }
  table th { color: var(--muted); font-weight: 500; text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--panel); font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  table td { padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .trades-scroll { max-height: 420px; overflow-y: auto; }
  .pos { color: var(--green); } .neg { color: var(--red); }
  .warn { background: rgba(246,70,93,0.15); border-left: 3px solid var(--red); padding: 8px 12px; margin: 8px 0; font-size: 13px; border-radius: 4px; }
  .note { background: rgba(240,185,11,0.1); border-left: 3px solid var(--accent); padding: 8px 12px; margin: 8px 0; font-size: 13px; border-radius: 4px; color: var(--muted); }
  .status { padding: 8px 16px; background: var(--panel-2); border-radius: 4px; font-family: "Cascadia Code", "Consolas", monospace; font-size: 13px; }
</style>
</head>
<body>

<header>
  <h1>Clock Strategy <span>Interactive Simulator v2</span></h1>
  <div class="subtitle">${data.length} days of data &middot; ${coins.length} coins available &middot; Spot + Futures + BNB fees</div>
</header>

<div class="controls-section">
  <h3>Trading parameters</h3>
  <div class="controls">
    <div class="control">
      <label>Starting capital (USDT)</label>
      <input type="number" id="capital" value="500" min="50" step="50">
    </div>
    <div class="control">
      <label>Venue & fee tier</label>
      <select id="feeTier">
        <option value="fut-maker">Futures Maker (0.020%/side)</option>
        <option value="fut-maker-bnb">Futures Maker + BNB (0.018%/side)</option>
        <option value="fut-taker" selected>Futures Taker (0.050%/side)</option>
        <option value="fut-taker-bnb">Futures Taker + BNB (0.045%/side)</option>
        <option value="spot-taker">Spot Taker (0.100%/side) ⚠</option>
        <option value="spot-taker-bnb">Spot Taker + BNB (0.075%/side) ⚠</option>
      </select>
    </div>
    <div class="control">
      <label>Leverage (Futures only)</label>
      <select id="leverage">
        <option value="1">1x (no leverage)</option>
        <option value="2">2x</option>
        <option value="3" selected>3x</option>
        <option value="5">5x</option>
        <option value="10">10x (high risk)</option>
      </select>
    </div>
    <div class="control">
      <label>Strategy mode</label>
      <select id="mode">
        <option value="short23" selected>Short 23:00 UTC only</option>
        <option value="long19">Long 19:00 UTC only</option>
        <option value="both">Both: short 23 + long 19</option>
      </select>
    </div>
    <div class="control">
      <label>Compound</label>
      <select id="compound">
        <option value="fixed" selected>Fixed (always use initial capital)</option>
        <option value="compound">Compound (use current equity)</option>
      </select>
    </div>
    <div class="control">
      <label>Start day</label>
      <select id="startDay"></select>
    </div>
    <div class="control">
      <label>How many days</label>
      <select id="numDays">
        <option value="14">14 days</option>
        <option value="30" selected>30 days</option>
        <option value="60">60 days</option>
        <option value="90">90 days</option>
        <option value="180">180 days</option>
        <option value="365">All available</option>
      </select>
    </div>
  </div>
</div>

<div class="controls-section">
  <h3>Coins in basket (click to toggle)</h3>
  <div class="coin-grid" id="coinGrid"></div>
</div>

<div class="btn-row">
  <button id="btnPlay">▶ Play</button>
  <button id="btnStep" class="secondary">Step 1 day</button>
  <button id="btnReset" class="secondary">Reset</button>
  <div class="speed-slider">
    <label style="color: var(--muted); font-size: 12px;">Speed:</label>
    <input type="range" id="speed" min="50" max="2000" value="300" style="width: 150px;">
    <span id="speedLabel" style="color: var(--muted); font-size: 12px; min-width: 70px;">300ms/day</span>
  </div>
  <div class="status" id="status">Idle. Press Play.</div>
</div>

<main>
  <div class="dashboard">
    <h2>Account</h2>
    <div class="stat"><span class="label">Equity</span><span class="val" id="kEquity">$500.00</span></div>
    <div class="stat"><span class="label">Total PnL</span><span class="val" id="kPnl">$0.00</span></div>
    <div class="stat"><span class="label">Total PnL %</span><span class="val" id="kPnlPct">0.00%</span></div>
    <div class="stat"><span class="label">Position size / coin</span><span class="val" id="kPosSize">$125.00</span></div>
    <div class="stat"><span class="label">Notional total</span><span class="val" id="kNotional">$500.00</span></div>

    <h2 style="margin-top: 20px;">Stats</h2>
    <div class="stat"><span class="label">Trading days</span><span class="val" id="kDays">0 / 0</span></div>
    <div class="stat"><span class="label">Win days</span><span class="val green" id="kWins">0</span></div>
    <div class="stat"><span class="label">Loss days</span><span class="val red" id="kLosses">0</span></div>
    <div class="stat"><span class="label">Win rate</span><span class="val" id="kWinRate">-</span></div>
    <div class="stat"><span class="label">Best day</span><span class="val green" id="kBest">-</span></div>
    <div class="stat"><span class="label">Worst day</span><span class="val red" id="kWorst">-</span></div>
    <div class="stat"><span class="label">Max drawdown</span><span class="val red" id="kDD">-</span></div>
    <div class="stat"><span class="label">Total fees paid</span><span class="val" id="kFees">$0.00</span></div>

    <div class="warn" id="liqWarn" style="display: none;">⚠ Leverage <span id="liqLev">3x</span>: liquidation if single-coin moves ~<span id="liqPct">33%</span> against you.</div>
    <div class="warn" id="spotWarn" style="display: none;">⚠ Spot can only LONG. Short strategies require Spot Margin (borrow + interest) or Futures.</div>
    <div class="note">Funding rate not modeled (typically ±0.01% per 8h on liquid futures). Slippage assumed zero (small positions).</div>
  </div>

  <div class="equity-card">
    <h2>Equity Curve</h2>
    <canvas id="equityChart"></canvas>
  </div>

  <div class="trades-card">
    <h2>Trade Log <span id="logSub" style="color: var(--muted); font-weight: normal; font-size: 12px;"></span></h2>
    <div class="trades-scroll">
      <table>
        <thead>
          <tr id="logHeader">
            <th>Day</th><th>Type</th>
            <th>Entry → Exit (per coin)</th>
            <th>Gross %</th>
            <th>Fees</th>
            <th>Net PnL</th>
            <th>Equity</th>
          </tr>
        </thead>
        <tbody id="tradeLog"></tbody>
      </table>
    </div>
  </div>
</main>

<script>
const DATA = ${JSON.stringify(data)};
const ALL_COINS = ${JSON.stringify(coins)};
const DEFAULT_COINS = ["INJUSDT", "APTUSDT", "SUIUSDT", "DOGEUSDT"];

const FEE_TIERS = {
  "fut-maker": { side: 0.00020, label: "Futures Maker" },
  "fut-maker-bnb": { side: 0.00018, label: "Futures Maker + BNB" },
  "fut-taker": { side: 0.00050, label: "Futures Taker" },
  "fut-taker-bnb": { side: 0.00045, label: "Futures Taker + BNB" },
  "spot-taker": { side: 0.00100, label: "Spot Taker" },
  "spot-taker-bnb": { side: 0.00075, label: "Spot Taker + BNB" },
};

const els = {};
[
  "capital","feeTier","leverage","mode","compound","startDay","numDays",
  "btnPlay","btnStep","btnReset","speed","speedLabel","status",
  "kEquity","kPnl","kPnlPct","kPosSize","kNotional","kDays","kWins","kLosses","kWinRate","kBest","kWorst","kDD","kFees",
  "liqWarn","liqLev","liqPct","spotWarn","coinGrid","tradeLog","logSub","logHeader"
].forEach(k => els[k] = document.getElementById(k));

// Populate start-day dropdown
DATA.forEach((d, i) => {
  const opt = document.createElement('option');
  opt.value = i; opt.textContent = d.day;
  els.startDay.appendChild(opt);
});

// Coin toggle grid
let selectedCoins = new Set(DEFAULT_COINS.filter(c => ALL_COINS.includes(c)));
function renderCoinGrid() {
  els.coinGrid.innerHTML = "";
  for (const c of ALL_COINS) {
    const div = document.createElement('div');
    div.className = 'coin-toggle' + (selectedCoins.has(c) ? ' on' : '');
    div.textContent = c.replace('USDT','');
    div.addEventListener('click', () => {
      if (selectedCoins.has(c)) selectedCoins.delete(c); else selectedCoins.add(c);
      if (selectedCoins.size === 0) selectedCoins.add(c);
      renderCoinGrid();
      reset();
    });
    els.coinGrid.appendChild(div);
  }
}
renderCoinGrid();

// Chart
let chart = new Chart(document.getElementById('equityChart'), {
  type: 'line',
  data: { labels: [], datasets: [{ label: 'Equity (USDT)', data: [], borderColor: '#0ecb81', backgroundColor: 'rgba(14,203,129,0.1)', tension: 0.1, fill: true, pointRadius: 0, borderWidth: 2 }]},
  options: {
    responsive: true, animation: false,
    plugins: { legend: { labels: { color: '#eaecef' } } },
    scales: { x: { ticks: { color: '#848e9c', maxTicksLimit: 12 }, grid: { color: '#2b3139' } }, y: { ticks: { color: '#848e9c' }, grid: { color: '#2b3139' } } },
  },
});

let state = null;
let timer = null;

function initState() {
  const capital = parseFloat(els.capital.value);
  const startIdx = parseInt(els.startDay.value);
  const num = Math.min(parseInt(els.numDays.value), DATA.length - startIdx);
  return {
    initialCapital: capital,
    equity: capital,
    peakEquity: capital,
    drawdown: 0,
    leverage: parseFloat(els.leverage.value),
    feeSide: FEE_TIERS[els.feeTier.value].side,
    feeTierLabel: FEE_TIERS[els.feeTier.value].label,
    compound: els.compound.value === 'compound',
    mode: els.mode.value,
    coins: [...selectedCoins],
    startIdx, numDays: num, cursor: 0,
    wins: 0, losses: 0, fees: 0,
    best: -Infinity, worst: Infinity,
    history: [{ day: DATA[startIdx]?.day ?? '-', equity: capital }],
  };
}

function fmt$(x) { const s = x < 0 ? '-$' : '$'; return s + Math.abs(x).toFixed(2); }
function fmtSigned$(x) { return (x >= 0 ? '+$' : '-$') + Math.abs(x).toFixed(2); }
function fmtSignedPct(x) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(3) + '%'; }
function fmtPrice(x) { if (x >= 1000) return x.toFixed(2); if (x >= 1) return x.toFixed(4); return x.toFixed(6); }

function step() {
  if (!state || state.cursor >= state.numDays) { pause(); setStatus('Simulation complete.'); return false; }
  const day = DATA[state.startIdx + state.cursor];
  const cap = state.compound ? state.equity : state.initialCapital;
  const notional = cap * state.leverage;
  const isFutures = els.feeTier.value.startsWith('fut');
  const tradesPerDay = state.mode === 'both' ? 2 : 1;
  // Number of "slots" depends on mode: short23 = 1 trade type, basket size = coins.length
  // For 'both' mode: capital is split across BOTH trade types AND coins
  const slots = tradesPerDay * state.coins.length;
  const perSlotNotional = notional / slots;

  let totalGrossDollar = 0, totalFees = 0, perTradeResults = [];

  // Execute trades based on mode
  const executeTrade = (coin, type, entry, exit) => {
    if (!entry || !exit) return;
    const grossPct = type === 'short' ? (entry - exit) / entry : (exit - entry) / entry;
    const grossDollar = perSlotNotional * grossPct;
    const fees = perSlotNotional * state.feeSide * 2;
    totalGrossDollar += grossDollar;
    totalFees += fees;
    perTradeResults.push({ coin, type, entry, exit, grossPct, grossDollar, fees });
  };

  for (const c of state.coins) {
    const t = day.coins[c];
    if (!t) continue;
    if (state.mode === 'short23' || state.mode === 'both') executeTrade(c, 'short', t.shortEntry, t.shortExit);
    if (state.mode === 'long19' || state.mode === 'both') executeTrade(c, 'long', t.longEntry, t.longExit);
  }

  const netDollar = totalGrossDollar - totalFees;
  state.equity += netDollar;
  state.fees += totalFees;
  if (state.equity > state.peakEquity) state.peakEquity = state.equity;
  const dd = (state.peakEquity - state.equity) / state.peakEquity;
  if (dd > state.drawdown) state.drawdown = dd;

  if (netDollar > 0) state.wins++; else if (netDollar < 0) state.losses++;
  if (netDollar > state.best) state.best = netDollar;
  if (netDollar < state.worst) state.worst = netDollar;

  state.history.push({ day: day.day, equity: state.equity });
  state.cursor++;

  updateDashboard(perSlotNotional, notional);
  appendTradeRow(day, perTradeResults, totalGrossDollar / notional, totalFees, netDollar, state.equity);
  updateChart();
  setStatus(\`Day \${day.day} — \${fmtSigned$(netDollar)} \${netDollar >= 0 ? '✓' : '✗'}\`);
  return true;
}

function updateDashboard(perSlotNotional, notional) {
  const pnl = state.equity - state.initialCapital;
  const pnlPct = pnl / state.initialCapital;
  els.kEquity.textContent = fmt$(state.equity);
  els.kPnl.textContent = fmtSigned$(pnl); els.kPnl.className = 'val ' + (pnl >= 0 ? 'green' : 'red');
  els.kPnlPct.textContent = fmtSignedPct(pnlPct); els.kPnlPct.className = 'val ' + (pnlPct >= 0 ? 'green' : 'red');
  els.kPosSize.textContent = fmt$(perSlotNotional);
  els.kNotional.textContent = fmt$(notional);
  els.kDays.textContent = \`\${state.cursor} / \${state.numDays}\`;
  els.kWins.textContent = state.wins; els.kLosses.textContent = state.losses;
  const t = state.wins + state.losses;
  els.kWinRate.textContent = t > 0 ? (state.wins / t * 100).toFixed(1) + '%' : '-';
  els.kBest.textContent = state.best > -Infinity ? fmtSigned$(state.best) : '-';
  els.kWorst.textContent = state.worst < Infinity ? fmtSigned$(state.worst) : '-';
  els.kDD.textContent = (state.drawdown * 100).toFixed(2) + '%';
  els.kFees.textContent = fmt$(state.fees);
}

function appendTradeRow(day, results, grossPctBasket, fees, netDollar, equity) {
  // One row per trade-type (short and/or long)
  const shorts = results.filter(r => r.type === 'short');
  const longs = results.filter(r => r.type === 'long');
  const groups = [];
  if (shorts.length > 0) groups.push({ type: 'SHORT 23:00', list: shorts });
  if (longs.length > 0) groups.push({ type: 'LONG 19:00', list: longs });

  for (const g of groups) {
    const grossSum = g.list.reduce((a, x) => a + x.grossDollar, 0);
    const feeSum = g.list.reduce((a, x) => a + x.fees, 0);
    const netSum = grossSum - feeSum;
    const grossPctGroup = grossSum / g.list.reduce((a, x) => a + (x.grossDollar / x.grossPct || 0), 0);
    const cellsCoins = g.list.map(r =>
      \`<span class="\${r.grossPct >= 0 ? 'pos' : 'neg'}">\${r.coin.replace('USDT','')}: \${fmtPrice(r.entry)}→\${fmtPrice(r.exit)} (\${fmtSignedPct(r.grossPct)})</span>\`
    ).join(' &middot; ');
    const row = document.createElement('tr');
    row.innerHTML = \`
      <td>\${day.day}</td>
      <td>\${g.type}</td>
      <td style="font-size: 11px;">\${cellsCoins}</td>
      <td class="\${grossSum >= 0 ? 'pos' : 'neg'}">\${fmtSigned$(grossSum)}</td>
      <td>\${fmt$(feeSum)}</td>
      <td class="\${netSum >= 0 ? 'pos' : 'neg'}">\${fmtSigned$(netSum)}</td>
      <td>\${state.mode === 'both' && g.type === 'LONG 19:00' ? fmt$(equity) : (state.mode === 'both' ? '' : fmt$(equity))}</td>
    \`;
    els.tradeLog.insertBefore(row, els.tradeLog.firstChild);
  }
}

function updateChart() {
  chart.data.labels = state.history.map(h => h.day);
  chart.data.datasets[0].data = state.history.map(h => h.equity);
  const up = state.equity >= state.initialCapital;
  chart.data.datasets[0].borderColor = up ? '#0ecb81' : '#f6465d';
  chart.data.datasets[0].backgroundColor = up ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)';
  chart.update('none');
}

function setStatus(msg) { els.status.textContent = msg; }

function play() { if (!state) reset(); const speed = parseInt(els.speed.value); els.btnPlay.textContent = '⏸ Pause'; timer = setInterval(() => { if (!step()) pause(); }, speed); }
function pause() { els.btnPlay.textContent = '▶ Play'; if (timer) { clearInterval(timer); timer = null; } }
function reset() {
  pause();
  state = initState();
  els.tradeLog.innerHTML = '';
  chart.data.labels = []; chart.data.datasets[0].data = []; chart.update('none');
  updateDashboard(state.initialCapital * state.leverage / (state.coins.length * (state.mode === 'both' ? 2 : 1)), state.initialCapital * state.leverage);
  setStatus('Ready. Press Play.');
  els.logSub.textContent = \`Mode: \${state.mode}, Fee: \${state.feeTierLabel}, Coins: \${state.coins.map(c => c.replace('USDT','')).join(', ')}\`;
  const lev = state.leverage;
  if (lev >= 3) { els.liqLev.textContent = lev + 'x'; els.liqPct.textContent = (100/lev).toFixed(0) + '%'; els.liqWarn.style.display = 'block'; } else els.liqWarn.style.display = 'none';
  const isSpot = els.feeTier.value.startsWith('spot');
  els.spotWarn.style.display = isSpot ? 'block' : 'none';
}

els.btnPlay.addEventListener('click', () => { if (timer) pause(); else play(); });
els.btnStep.addEventListener('click', () => { pause(); if (!state) state = initState(); step(); });
els.btnReset.addEventListener('click', reset);
els.speed.addEventListener('input', () => { els.speedLabel.textContent = els.speed.value + 'ms/day'; if (timer) { pause(); play(); } });
[els.capital, els.feeTier, els.leverage, els.mode, els.compound, els.startDay, els.numDays].forEach(e => e.addEventListener('change', reset));
els.speedLabel.textContent = els.speed.value + 'ms/day';

reset();
</script>
</body>
</html>`;
}

main().catch((e) => { console.error(e); process.exit(1); });

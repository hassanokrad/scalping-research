// Generate an interactive single-file HTML simulator that replays the clock
// strategy day-by-day against historical Binance data. Open simulator.html
// in any browser. No installation needed.

import { promises as fs } from "node:fs";
import path from "node:path";
import { loadOrFetch } from "./cache.js";

const COINS = ["SUIUSDT", "ETHUSDT", "SOLUSDT", "INJUSDT"];
const ENTRY_HOUR_UTC = 23;
const HOLD_MIN = 90;
const DAYS = 180;

async function main() {
  console.log("Loading 180 days of data...");
  const byCoin = {};
  for (const c of COINS) byCoin[c] = await loadOrFetch(c, "1m", DAYS, 24 * 60);

  console.log("Building per-day trade records...");
  // For each trading day, capture entry/exit prices per coin.
  const tradeRecords = new Map();
  for (const c of COINS) {
    const candles = byCoin[c];
    for (let i = 0; i < candles.length - HOLD_MIN; i++) {
      const t = new Date(candles[i].openTime);
      if (t.getUTCHours() !== ENTRY_HOUR_UTC || t.getUTCMinutes() !== 0) continue;
      const day = t.toISOString().slice(0, 10);
      const entry = candles[i].open;
      const exit = candles[i + HOLD_MIN].open;
      if (entry <= 0) continue;
      if (!tradeRecords.has(day)) tradeRecords.set(day, {});
      tradeRecords.get(day)[c] = { entry, exit };
    }
  }

  const days = [...tradeRecords.keys()].sort();
  const data = days
    .map((day) => ({
      day,
      coins: Object.fromEntries(
        COINS.map((c) => [c, tradeRecords.get(day)[c] ?? null]),
      ),
    }))
    .filter((d) => COINS.every((c) => d.coins[c]));

  console.log(`${data.length} complete trading days`);

  const html = render(data);
  const outPath = path.resolve("simulator.html");
  await fs.writeFile(outPath, html);
  console.log(`\n  Simulator written: ${outPath}`);
  console.log(`  Open it by running:  start simulator.html\n`);
}

function render(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Clock Strategy — Interactive Simulator</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0b0e11;
    --panel: #1e2329;
    --panel-2: #2b3139;
    --text: #eaecef;
    --muted: #848e9c;
    --green: #0ecb81;
    --red: #f6465d;
    --accent: #f0b90b;
    --border: #2b3139;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }
  header { background: var(--panel); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
  header h1 { margin: 0; font-size: 18px; font-weight: 600; }
  header h1 span { color: var(--accent); }
  .controls { background: var(--panel); padding: 16px 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; border-bottom: 1px solid var(--border); }
  .control { display: flex; flex-direction: column; gap: 4px; }
  .control label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .control input, .control select { background: var(--panel-2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); padding: 8px 10px; font-size: 14px; font-family: inherit; }
  .control input:focus, .control select:focus { outline: none; border-color: var(--accent); }
  .btn-row { padding: 12px 24px; background: var(--panel); border-bottom: 1px solid var(--border); display: flex; gap: 8px; align-items: center; }
  button { background: var(--accent); color: #1e2329; border: none; padding: 10px 18px; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 14px; }
  button:hover { background: #fcd535; }
  button.secondary { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
  button.secondary:hover { background: #3c424b; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .speed-slider { display: flex; gap: 8px; align-items: center; margin-left: auto; }
  .speed-slider input { background: transparent; }
  main { display: grid; grid-template-columns: 320px 1fr; gap: 16px; padding: 16px 24px; }
  .dashboard { background: var(--panel); border-radius: 8px; padding: 16px; }
  .dashboard h2 { margin: 0 0 12px 0; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
  .stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .stat:last-child { border-bottom: none; }
  .stat .label { color: var(--muted); }
  .stat .val { font-weight: 600; font-variant-numeric: tabular-nums; }
  .stat .val.green { color: var(--green); }
  .stat .val.red { color: var(--red); }
  .equity-card { background: var(--panel); border-radius: 8px; padding: 16px; }
  .equity-card h2 { margin: 0 0 12px 0; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
  canvas { max-height: 320px; }
  .trades-card { background: var(--panel); border-radius: 8px; padding: 16px; margin-top: 16px; grid-column: 1 / -1; }
  .trades-card h2 { margin: 0 0 12px 0; font-size: 14px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  table th { color: var(--muted); font-weight: 500; text-align: left; padding: 8px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--panel); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  table td { padding: 8px; border-bottom: 1px solid var(--border); }
  .trades-scroll { max-height: 400px; overflow-y: auto; }
  .pos { color: var(--green); }
  .neg { color: var(--red); }
  .pulse { animation: pulse 1s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .warn { background: rgba(246, 70, 93, 0.15); border-left: 3px solid var(--red); padding: 8px 12px; margin: 8px 0; font-size: 13px; border-radius: 4px; }
  .note { background: rgba(240, 185, 11, 0.1); border-left: 3px solid var(--accent); padding: 8px 12px; margin: 8px 0; font-size: 13px; border-radius: 4px; color: var(--muted); }
  .status { padding: 8px 16px; background: var(--panel-2); border-radius: 4px; font-family: "Cascadia Code", "Consolas", monospace; font-size: 13px; }
  .status.holding { color: var(--accent); }
  .status.idle { color: var(--muted); }
</style>
</head>
<body>

<header>
  <h1>Clock Strategy <span>Interactive Simulator</span></h1>
  <div style="color: var(--muted); font-size: 13px;">Short SUI + ETH + SOL + INJ at 23:00 UTC, hold 90 min, close at 00:30 UTC.</div>
</header>

<div class="controls">
  <div class="control">
    <label>Starting capital (USDT)</label>
    <input type="number" id="capital" value="500" min="100" step="100">
  </div>
  <div class="control">
    <label>Leverage</label>
    <select id="leverage">
      <option value="1">1x (no leverage)</option>
      <option value="2">2x</option>
      <option value="3" selected>3x</option>
      <option value="5">5x</option>
      <option value="10">10x (high risk)</option>
    </select>
  </div>
  <div class="control">
    <label>Fee model</label>
    <select id="feeModel">
      <option value="maker" selected>Maker (0.02% per side)</option>
      <option value="taker">Taker (0.05% per side)</option>
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
    <label>How many days to simulate</label>
    <select id="numDays">
      <option value="14">14 days</option>
      <option value="30" selected>30 days</option>
      <option value="60">60 days</option>
      <option value="90">90 days</option>
      <option value="180">All 180 days</option>
    </select>
  </div>
</div>

<div class="btn-row">
  <button id="btnPlay">▶ Play</button>
  <button id="btnStep" class="secondary">Step 1 day</button>
  <button id="btnReset" class="secondary">Reset</button>
  <div class="speed-slider">
    <label style="color: var(--muted); font-size: 12px;">Speed:</label>
    <input type="range" id="speed" min="50" max="2000" value="500" style="width: 150px;">
    <span id="speedLabel" style="color: var(--muted); font-size: 12px; min-width: 60px;">500ms/day</span>
  </div>
  <div class="status idle" id="status">Idle. Press Play.</div>
</div>

<main>
  <div class="dashboard">
    <h2>Account</h2>
    <div class="stat"><span class="label">Equity</span><span class="val" id="kEquity">$500.00</span></div>
    <div class="stat"><span class="label">Total PnL</span><span class="val" id="kPnl">$0.00</span></div>
    <div class="stat"><span class="label">Total PnL %</span><span class="val" id="kPnlPct">0.00%</span></div>
    <div class="stat"><span class="label">Position size (per coin)</span><span class="val" id="kPosSize">$125.00</span></div>
    <div class="stat"><span class="label">Notional (total)</span><span class="val" id="kNotional">$500.00</span></div>

    <h2 style="margin-top: 20px;">Stats</h2>
    <div class="stat"><span class="label">Trading days</span><span class="val" id="kDays">0 / 0</span></div>
    <div class="stat"><span class="label">Win days</span><span class="val" id="kWins">0</span></div>
    <div class="stat"><span class="label">Loss days</span><span class="val" id="kLosses">0</span></div>
    <div class="stat"><span class="label">Win rate</span><span class="val" id="kWinRate">-</span></div>
    <div class="stat"><span class="label">Best day</span><span class="val green" id="kBest">-</span></div>
    <div class="stat"><span class="label">Worst day</span><span class="val red" id="kWorst">-</span></div>
    <div class="stat"><span class="label">Max drawdown</span><span class="val red" id="kDD">-</span></div>
    <div class="stat"><span class="label">Fees paid (total)</span><span class="val" id="kFees">$0.00</span></div>

    <div class="warn" id="liqWarn" style="display: none;">
      ⚠ With this leverage, single-coin moves of just <span id="liqPct">10%</span> against you would liquidate the position. The worst single-coin day in the data was over <span id="liqMax">8%</span>.
    </div>
    <div class="note">Funding rate not modeled (typically ±0.01% per 8h). Slippage assumed zero (small positions on liquid pairs).</div>
  </div>

  <div class="equity-card">
    <h2>Equity Curve</h2>
    <canvas id="equityChart"></canvas>
  </div>

  <div class="trades-card">
    <h2>Trade Log</h2>
    <div class="trades-scroll">
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>SUI entry → exit</th>
            <th>ETH entry → exit</th>
            <th>SOL entry → exit</th>
            <th>INJ entry → exit</th>
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
const COINS = ${JSON.stringify(COINS)};

const els = {
  capital: document.getElementById('capital'),
  leverage: document.getElementById('leverage'),
  feeModel: document.getElementById('feeModel'),
  compound: document.getElementById('compound'),
  startDay: document.getElementById('startDay'),
  numDays: document.getElementById('numDays'),
  btnPlay: document.getElementById('btnPlay'),
  btnStep: document.getElementById('btnStep'),
  btnReset: document.getElementById('btnReset'),
  speed: document.getElementById('speed'),
  speedLabel: document.getElementById('speedLabel'),
  status: document.getElementById('status'),
  kEquity: document.getElementById('kEquity'),
  kPnl: document.getElementById('kPnl'),
  kPnlPct: document.getElementById('kPnlPct'),
  kPosSize: document.getElementById('kPosSize'),
  kNotional: document.getElementById('kNotional'),
  kDays: document.getElementById('kDays'),
  kWins: document.getElementById('kWins'),
  kLosses: document.getElementById('kLosses'),
  kWinRate: document.getElementById('kWinRate'),
  kBest: document.getElementById('kBest'),
  kWorst: document.getElementById('kWorst'),
  kDD: document.getElementById('kDD'),
  kFees: document.getElementById('kFees'),
  liqWarn: document.getElementById('liqWarn'),
  liqPct: document.getElementById('liqPct'),
  liqMax: document.getElementById('liqMax'),
  tradeLog: document.getElementById('tradeLog'),
};

// Populate start-day dropdown
DATA.forEach((d, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = d.day;
  els.startDay.appendChild(opt);
});

// Chart
const ctx = document.getElementById('equityChart');
let chart = new Chart(ctx, {
  type: 'line',
  data: { labels: [], datasets: [
    { label: 'Equity (USDT)', data: [], borderColor: '#0ecb81', backgroundColor: 'rgba(14,203,129,0.1)', tension: 0.1, fill: true, pointRadius: 0, borderWidth: 2 },
  ]},
  options: {
    responsive: true, animation: false,
    plugins: { legend: { labels: { color: '#eaecef' } } },
    scales: {
      x: { ticks: { color: '#848e9c', maxTicksLimit: 12 }, grid: { color: '#2b3139' } },
      y: { ticks: { color: '#848e9c' }, grid: { color: '#2b3139' } },
    },
  },
});

// Simulation state
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
    feePerSide: els.feeModel.value === 'maker' ? 0.0002 : 0.0005,
    compound: els.compound.value === 'compound',
    startIdx,
    numDays: num,
    cursor: 0,
    wins: 0,
    losses: 0,
    fees: 0,
    best: -Infinity,
    worst: Infinity,
    history: [{ day: DATA[startIdx]?.day ?? '-', equity: capital }],
  };
}

function fmtUsd(x) {
  const sign = x < 0 ? '-' : '';
  return sign + '$' + Math.abs(x).toFixed(2);
}
function fmtSignedUsd(x) {
  return (x >= 0 ? '+$' : '-$') + Math.abs(x).toFixed(2);
}
function fmtSignedPct(x) {
  return (x >= 0 ? '+' : '') + (x * 100).toFixed(3) + '%';
}
function fmtPrice(x) {
  if (x >= 1000) return x.toFixed(2);
  if (x >= 1) return x.toFixed(4);
  return x.toFixed(6);
}

function step() {
  if (!state || state.cursor >= state.numDays) {
    pause();
    setStatus('Simulation complete.', 'idle');
    return false;
  }

  const dataIdx = state.startIdx + state.cursor;
  const day = DATA[dataIdx];
  const capitalForTrade = state.compound ? state.equity : state.initialCapital;
  const notional = capitalForTrade * state.leverage;
  const perCoinNotional = notional / COINS.length;

  // Compute per-coin gross PnL (short)
  let totalGrossDollar = 0;
  let totalFees = 0;
  let perCoinResults = {};
  let worstCoinPct = 0;
  for (const c of COINS) {
    const { entry, exit } = day.coins[c];
    const grossPct = (entry - exit) / entry; // short
    const grossDollar = perCoinNotional * grossPct;
    const fees = perCoinNotional * state.feePerSide * 2; // entry + exit
    totalGrossDollar += grossDollar;
    totalFees += fees;
    perCoinResults[c] = { entry, exit, grossPct, grossDollar, fees };
    if (-grossPct > worstCoinPct) worstCoinPct = -grossPct;
  }

  const netDollar = totalGrossDollar - totalFees;
  state.equity += netDollar;
  state.fees += totalFees;

  if (state.equity > state.peakEquity) state.peakEquity = state.equity;
  const ddFromPeak = (state.peakEquity - state.equity) / state.peakEquity;
  if (ddFromPeak > state.drawdown) state.drawdown = ddFromPeak;

  const grossPctBasket = totalGrossDollar / notional;
  if (netDollar > 0) state.wins++; else if (netDollar < 0) state.losses++;
  if (netDollar > state.best) state.best = netDollar;
  if (netDollar < state.worst) state.worst = netDollar;

  state.history.push({ day: day.day, equity: state.equity });
  state.cursor++;

  // Render
  updateDashboard(perCoinNotional, notional);
  appendTradeRow(day, perCoinResults, grossPctBasket, totalFees, netDollar, state.equity);
  updateChart();

  // Liquidation check
  const liqDistance = 1 / state.leverage; // approximate
  if (state.leverage > 1 && worstCoinPct > liqDistance * 0.8) {
    setStatus(\`⚠ Day \${day.day} — single coin moved \${(worstCoinPct*100).toFixed(2)}% against us. Close to liquidation distance (\${(liqDistance*100).toFixed(0)}%).\`, 'holding');
  } else {
    setStatus(\`Day \${day.day} — \${fmtSignedUsd(netDollar)} \${netDollar >= 0 ? '✓' : '✗'}\`, netDollar >= 0 ? 'idle' : 'holding');
  }

  return true;
}

function updateDashboard(perCoinNotional, notional) {
  const pnl = state.equity - state.initialCapital;
  const pnlPct = pnl / state.initialCapital;
  els.kEquity.textContent = fmtUsd(state.equity);
  els.kPnl.textContent = fmtSignedUsd(pnl);
  els.kPnl.className = 'val ' + (pnl >= 0 ? 'green' : 'red');
  els.kPnlPct.textContent = fmtSignedPct(pnlPct);
  els.kPnlPct.className = 'val ' + (pnlPct >= 0 ? 'green' : 'red');
  els.kPosSize.textContent = fmtUsd(perCoinNotional);
  els.kNotional.textContent = fmtUsd(notional);
  els.kDays.textContent = \`\${state.cursor} / \${state.numDays}\`;
  els.kWins.textContent = state.wins;
  els.kLosses.textContent = state.losses;
  const total = state.wins + state.losses;
  els.kWinRate.textContent = total > 0 ? (state.wins / total * 100).toFixed(1) + '%' : '-';
  els.kBest.textContent = state.best > -Infinity ? fmtSignedUsd(state.best) : '-';
  els.kWorst.textContent = state.worst < Infinity ? fmtSignedUsd(state.worst) : '-';
  els.kDD.textContent = (state.drawdown * 100).toFixed(2) + '%';
  els.kFees.textContent = fmtUsd(state.fees);
}

function appendTradeRow(day, perCoinResults, grossPctBasket, fees, netDollar, equity) {
  const row = document.createElement('tr');
  row.innerHTML = \`
    <td>\${day.day}</td>
    \${COINS.map(c => {
      const r = perCoinResults[c];
      const cls = r.grossPct >= 0 ? 'pos' : 'neg';
      return \`<td><span class="\${cls}">\${fmtPrice(r.entry)} → \${fmtPrice(r.exit)}</span></td>\`;
    }).join('')}
    <td class="\${grossPctBasket >= 0 ? 'pos' : 'neg'}">\${fmtSignedPct(grossPctBasket)}</td>
    <td>\${fmtUsd(fees)}</td>
    <td class="\${netDollar >= 0 ? 'pos' : 'neg'}">\${fmtSignedUsd(netDollar)}</td>
    <td>\${fmtUsd(equity)}</td>
  \`;
  els.tradeLog.insertBefore(row, els.tradeLog.firstChild);
}

function updateChart() {
  chart.data.labels = state.history.map((h) => h.day);
  chart.data.datasets[0].data = state.history.map((h) => h.equity);
  chart.data.datasets[0].borderColor = state.equity >= state.initialCapital ? '#0ecb81' : '#f6465d';
  chart.data.datasets[0].backgroundColor = state.equity >= state.initialCapital ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)';
  chart.update('none');
}

function setStatus(msg, cls) {
  els.status.textContent = msg;
  els.status.className = 'status ' + cls;
}

function play() {
  if (!state) reset();
  const speed = parseInt(els.speed.value);
  els.btnPlay.textContent = '⏸ Pause';
  setStatus('Running...', 'holding');
  timer = setInterval(() => { if (!step()) pause(); }, speed);
}
function pause() {
  els.btnPlay.textContent = '▶ Play';
  if (timer) { clearInterval(timer); timer = null; }
}
function reset() {
  pause();
  state = initState();
  els.tradeLog.innerHTML = '';
  chart.data.labels = [];
  chart.data.datasets[0].data = [];
  chart.update('none');
  updateDashboard(state.initialCapital * state.leverage / COINS.length, state.initialCapital * state.leverage);
  setStatus('Ready. Press Play.', 'idle');
  updateLiqWarning();
}
function updateLiqWarning() {
  const lev = parseFloat(els.leverage.value);
  if (lev >= 5) {
    const liqDist = (100 / lev).toFixed(0);
    els.liqPct.textContent = liqDist + '%';
    els.liqMax.textContent = '8%';
    els.liqWarn.style.display = 'block';
  } else {
    els.liqWarn.style.display = 'none';
  }
}

els.btnPlay.addEventListener('click', () => { if (timer) pause(); else play(); });
els.btnStep.addEventListener('click', () => { pause(); if (!state) state = initState(); step(); });
els.btnReset.addEventListener('click', reset);
els.speed.addEventListener('input', () => {
  els.speedLabel.textContent = els.speed.value + 'ms/day';
  if (timer) { pause(); play(); }
});
[els.capital, els.leverage, els.feeModel, els.compound, els.startDay, els.numDays].forEach(e =>
  e.addEventListener('change', reset)
);
els.speedLabel.textContent = els.speed.value + 'ms/day';

reset();
</script>
</body>
</html>`;
}

main().catch((e) => { console.error(e); process.exit(1); });

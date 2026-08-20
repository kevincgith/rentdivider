'use strict';

/* ---------- Hungarian algorithm (Kuhn–Munkres), O(n^3), 1-indexed internals ----------
 * Minimizes cost[i][j] over perfect matchings of an n x n matrix.
 * Returns the assignment plus the dual potentials u (rows) and v (cols),
 * which satisfy cost[i][j] >= u[i] + v[j], with equality on matched pairs.
 * These potentials are exactly the market-clearing prices we need. */
function hungarianMin(cost) {
  const n = cost.length;
  const INF = Infinity;
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const matchCol = new Array(n + 1).fill(0); // matchCol[j] = row matched to column j
  const way = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    matchCol[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = matchCol[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[matchCol[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (matchCol[j0] !== 0);

    do {
      const j1 = way[j0];
      matchCol[j0] = matchCol[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const rowToCol = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) rowToCol[matchCol[j] - 1] = j - 1;

  return { assignment: rowToCol, u: u.slice(1), v: v.slice(1) };
}

/* ---------- Rent division on top of the assignment problem ----------
 * value[i][j] = how much person i values room j (each row should sum to totalRent).
 * We maximize total value (minimize -value), then recover room prices from the
 * column duals, shifted by a constant so prices sum to exactly totalRent.
 * That shift preserves every inequality (u_i + p_j unaffected) and every
 * equality on matched pairs, so envy-freeness is preserved exactly. */
function solveRentDivision(value, totalRent) {
  const n = value.length;
  const cost = value.map((row) => row.map((x) => -x));
  const { assignment, u, v } = hungarianMin(cost);

  // person potential (row dual) = -u[i], room potential (col dual) = -v[j]
  const personPotential = u.map((x) => -x);
  const roomPrice = v.map((x) => -x);

  const priceSum = roomPrice.reduce((a, b) => a + b, 0);
  const shift = (totalRent - priceSum) / n;
  const finalPrice = roomPrice.map((p) => p + shift);
  const finalPersonPotential = personPotential.map((p) => p - shift);

  return {
    assignment, // assignment[i] = room index assigned to person i
    price: finalPrice, // price[j] = rent for room j
    surplus: value.map((row, i) => row[assignment[i]] - finalPrice[assignment[i]]),
    personPotential: finalPersonPotential,
  };
}

/* ---------------- UI state & wiring ---------------- */

const state = {
  step: 'setup',
  n: 3,
  names: ['', '', ''],
  rooms: ['', '', ''],
  totalRent: 3000,
  values: null, // values[i][j]
};

const el = (id) => document.getElementById(id);

function fmtMoney(x) {
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function clampCount(n) {
  return Math.min(10, Math.max(2, Math.round(n) || 2));
}

function renderSetup() {
  const root = el('app');
  root.innerHTML = `
    <section class="card">
      <h2>1. The basics</h2>
      <div class="field-row">
        <label class="field">
          <span>Number of roommates / rooms</span>
          <input type="number" id="count" min="2" max="10" value="${state.n}">
        </label>
        <label class="field">
          <span>Total monthly rent</span>
          <input type="number" id="rent" min="0" step="1" value="${state.totalRent}">
        </label>
      </div>
      <div id="names-grid" class="names-grid"></div>
      <button class="primary" id="next-to-values">Next: enter valuations →</button>
    </section>
  `;

  const namesGrid = el('names-grid');
  function renderNameInputs() {
    namesGrid.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'names-grid-row names-grid-header';
    header.innerHTML = '<span>Roommate name</span><span>Room name</span>';
    namesGrid.appendChild(header);
    for (let i = 0; i < state.n; i++) {
      const row = document.createElement('div');
      row.className = 'names-grid-row';
      row.innerHTML = `
        <input type="text" data-idx="${i}" class="name-input" placeholder="Roommate ${i + 1}" value="${state.names[i] || ''}">
        <input type="text" data-idx="${i}" class="room-input" placeholder="Room ${i + 1}" value="${state.rooms[i] || ''}">
      `;
      namesGrid.appendChild(row);
    }
    namesGrid.querySelectorAll('.name-input').forEach((input) => {
      input.addEventListener('input', (e) => {
        state.names[Number(e.target.dataset.idx)] = e.target.value;
      });
    });
    namesGrid.querySelectorAll('.room-input').forEach((input) => {
      input.addEventListener('input', (e) => {
        state.rooms[Number(e.target.dataset.idx)] = e.target.value;
      });
    });
  }
  renderNameInputs();

  el('count').addEventListener('input', (e) => {
    const n = clampCount(Number(e.target.value));
    state.n = n;
    while (state.names.length < n) state.names.push('');
    while (state.rooms.length < n) state.rooms.push('');
    state.names.length = n;
    state.rooms.length = n;
    renderNameInputs();
  });

  el('rent').addEventListener('input', (e) => {
    state.totalRent = Number(e.target.value) || 0;
  });

  el('next-to-values').addEventListener('click', () => {
    for (let i = 0; i < state.n; i++) {
      if (!state.names[i].trim()) state.names[i] = `Roommate ${i + 1}`;
      if (!state.rooms[i].trim()) state.rooms[i] = `Room ${i + 1}`;
    }
    if (!state.values || state.values.length !== state.n) {
      state.values = Array.from({ length: state.n }, () => new Array(state.n).fill(0));
    }
    state.step = 'values';
    render();
  });
}

function renderValues() {
  const root = el('app');
  root.innerHTML = `
    <section class="card">
      <h2>2. Value each room</h2>
      <p class="hint">
        Each roommate splits the full rent (${fmtMoney(state.totalRent)}) across every room the way
        they'd honestly value living there. Higher = worth more to that person. Each row must add up
        to the total rent.
      </p>
      <div class="table-wrap">
        <table id="values-table"></table>
      </div>
      <div class="actions">
        <button class="secondary" id="back-to-setup">← Back</button>
        <button class="primary" id="compute">Compute fair split →</button>
      </div>
    </section>
  `;

  const table = el('values-table');
  function renderTable() {
    let html = '<thead><tr><th></th>';
    for (let j = 0; j < state.n; j++) html += `<th>${escapeHtml(state.rooms[j])}</th>`;
    html += '<th>Row total</th></tr></thead><tbody>';
    for (let i = 0; i < state.n; i++) {
      html += `<tr><th class="row-label">${escapeHtml(state.names[i])}</th>`;
      for (let j = 0; j < state.n; j++) {
        html += `<td><input type="number" min="0" step="1" class="val-input" data-i="${i}" data-j="${j}" value="${state.values[i][j]}"></td>`;
      }
      html += `<td class="row-total" data-row="${i}"></td></tr>`;
    }
    html += '</tbody>';
    table.innerHTML = html;

    table.querySelectorAll('.val-input').forEach((input) => {
      input.addEventListener('input', (e) => {
        const i = Number(e.target.dataset.i);
        const j = Number(e.target.dataset.j);
        state.values[i][j] = Number(e.target.value) || 0;
        updateRowTotal(i);
      });
    });
    for (let i = 0; i < state.n; i++) updateRowTotal(i);
  }

  function updateRowTotal(i) {
    const cell = table.querySelector(`.row-total[data-row="${i}"]`);
    const sum = state.values[i].reduce((a, b) => a + b, 0);
    cell.textContent = fmtMoney(sum);
    cell.classList.toggle('balanced', Math.abs(sum - state.totalRent) < 0.005);
    cell.classList.toggle('unbalanced', Math.abs(sum - state.totalRent) >= 0.005);
  }

  renderTable();

  el('back-to-setup').addEventListener('click', () => {
    state.step = 'setup';
    render();
  });

  el('compute').addEventListener('click', () => {
    const unbalanced = state.values
      .map((row, i) => ({ i, sum: row.reduce((a, b) => a + b, 0) }))
      .filter(({ sum }) => Math.abs(sum - state.totalRent) >= 0.005);
    if (unbalanced.length > 0) {
      const names = unbalanced.map(({ i }) => state.names[i]).join(', ');
      showError(`Each row must add up to ${fmtMoney(state.totalRent)}. Fix: ${names}.`);
      return;
    }
    clearError();
    state.step = 'results';
    render();
  });
}

function renderResults() {
  const result = solveRentDivision(state.values, state.totalRent);
  const root = el('app');

  let rows = '';
  for (let i = 0; i < state.n; i++) {
    const room = result.assignment[i];
    rows += `<tr>
      <td>${escapeHtml(state.names[i])}</td>
      <td>${escapeHtml(state.rooms[room])}</td>
      <td class="price">${fmtMoney(result.price[room])}</td>
    </tr>`;
  }

  const priceSum = result.price.reduce((a, b) => a + b, 0);

  let checkRows = '';
  for (let i = 0; i < state.n; i++) {
    const assignedRoom = result.assignment[i];
    const assignedUtility = state.values[i][assignedRoom] - result.price[assignedRoom];
    let cells = '';
    for (let j = 0; j < state.n; j++) {
      const utility = state.values[i][j] - result.price[j];
      const isAssigned = j === assignedRoom;
      cells += `<td class="${isAssigned ? 'assigned' : ''}">${fmtMoney(utility)}</td>`;
    }
    checkRows += `<tr><th class="row-label">${escapeHtml(state.names[i])}</th>${cells}</tr>`;
  }
  let checkHeader = '<tr><th></th>';
  for (let j = 0; j < state.n; j++) checkHeader += `<th>${escapeHtml(state.rooms[j])}</th>`;
  checkHeader += '</tr>';

  root.innerHTML = `
    <section class="card">
      <h2>3. Your envy-free split</h2>
      <p class="hint">
        This assignment maximizes everyone's combined satisfaction, and the prices are set so that
        no one would rather have someone else's room at that room's price.
      </p>
      <div class="table-wrap">
        <table class="results-table">
          <thead><tr><th>Roommate</th><th>Gets</th><th>Pays / month</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th colspan="2">Total</th><th class="price">${fmtMoney(priceSum)}</th></tr></tfoot>
        </table>
      </div>

      <h3>Why it's envy-free</h3>
      <p class="hint">
        Each cell below is what a roommate would net (their value for that room minus its price)
        if they lived there instead. The highlighted cell — their actual assignment — is always the
        best or tied-best number in their row.
      </p>
      <div class="table-wrap">
        <table class="check-table">
          <thead>${checkHeader}</thead>
          <tbody>${checkRows}</tbody>
        </table>
      </div>

      <div class="actions">
        <button class="secondary" id="back-to-values">← Adjust valuations</button>
        <button class="secondary" id="start-over">Start over</button>
      </div>
    </section>
  `;

  el('back-to-values').addEventListener('click', () => {
    state.step = 'values';
    render();
  });
  el('start-over').addEventListener('click', () => {
    state.step = 'setup';
    state.values = null;
    render();
  });
}

function showError(msg) {
  let box = el('error-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'error-box';
    box.className = 'error-box';
    el('app').prepend(box);
  }
  box.textContent = msg;
}

function clearError() {
  const box = el('error-box');
  if (box) box.remove();
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function render() {
  if (state.step === 'setup') renderSetup();
  else if (state.step === 'values') renderValues();
  else if (state.step === 'results') renderResults();
}

document.addEventListener('DOMContentLoaded', render);

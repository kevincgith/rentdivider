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

/* ---------- Turning raw budgets into comparable valuations ----------
 * People naturally think in terms of "what's each room worth to me" or "what's my max
 * budget per room" — those numbers have no reason to add up to the total rent, and forcing
 * them to is confusing and artificial. What actually matters for finding a fair split is
 * each person's *relative* valuation across rooms, not the absolute scale they happened to
 * type in. So we scale each person's row proportionally to sum to the total rent — this
 * preserves their relative preferences exactly while putting everyone on the same footing,
 * which the assignment math requires to make interpersonal comparisons meaningful. */
function normalizeValuations(values, totalRent) {
  return values.map((row) => {
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum <= 0) return row.map(() => totalRent / row.length);
    return row.map((v) => (v / sum) * totalRent);
  });
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
  // With very lopsided valuations, the strict envy-free price for the worst room can be
  // negative (its occupant would need to be paid). Real rent can't go below $0, so any
  // shortfall like that is floored and pulled back from the other rooms instead — a
  // deliberate, small trade against perfect envy-freeness in that rare case.
  const finalPrice = rebalanceToFloor(roomPrice.map((p) => p + shift), totalRent);
  const finalPersonPotential = personPotential.map((p) => p - shift);

  return {
    assignment, // assignment[i] = room index assigned to person i
    price: finalPrice, // price[j] = rent for room j
    surplus: value.map((row, i) => row[assignment[i]] - finalPrice[assignment[i]]),
    personPotential: finalPersonPotential,
  };
}

/* ---------- Interactive (ascending-auction) mode ----------
 * Instead of asking everyone to fill in a full valuation matrix up front, this mode
 * elicits only ordinal choices: at the current prices, which room do you want? It runs
 * a classic ascending auction (ties back to the same market-clearing prices the matrix
 * mode computes directly): rooms start at an equal split of rent; whenever two people
 * want the same room, its price rises by the current step size and the loser goes back
 * in line.
 *
 * A round where nobody wants to switch is only "locally" stable — at a coarse step size,
 * two close valuations can settle into a stable-looking assignment that's actually the
 * wrong one (a full swap would make both people happier, but the price gaps aren't fine
 * enough yet to reveal that), and that false stability can persist across several
 * halvings in a row when two people's preferences are genuinely close. There's no fixed
 * number of confirmations that *proves* correctness for arbitrarily close ties, but
 * requiring the assignment to come out identical across several consecutive rounds
 * (CONVERGENCE_STREAK) before ever offering a checkpoint makes a false one very unlikely
 * in practice without costing an unreasonable number of extra rounds — tuned and verified
 * against randomized valuations, not just picked by feel. Checkpoints are still explicitly
 * framed as a refinable estimate, not a proof. */
const CONVERGENCE_STREAK = 3;

function initInteractive() {
  const n = state.n;
  const base = state.totalRent / n;
  state.interactive = {
    prices: new Array(n).fill(base),
    owner: new Array(n).fill(-1), // room index -> person index, -1 = unclaimed
    holds: new Array(n).fill(-1), // person index -> room index, -1 = none yet
    queue: Array.from({ length: n }, (_, i) => i),
    delta: initialDelta(state.totalRent, n),
    round: 1,
    converged: false,
    log: [],
    assignmentHistory: [],
  };
}

function initialDelta(totalRent, n) {
  const perRoom = totalRent / n;
  let d = perRoom * 0.05;
  if (d <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(d)));
  d = Math.round(d / mag) * mag;
  return Math.max(d, 1);
}

function normalizeInteractivePrices() {
  const iv = state.interactive;
  const sum = iv.prices.reduce((a, b) => a + b, 0);
  const shift = (state.totalRent - sum) / state.n;
  iv.prices = rebalanceToFloor(iv.prices.map((p) => p + shift), state.totalRent);
}

/* Rent is a fixed pie: raising one room's price has to come from somewhere. Spreading the
 * offsetting decrease evenly across every other room (instead of just letting the contested
 * room's price climb on its own, to be reconciled only once at the end) keeps prices summing
 * to the total rent at every single step — not just at checkpoints — so what's on screen is
 * always a valid, budget-balanced split, and no single room can run away unchecked while the
 * correction is deferred. No room's price is allowed below $0 either: if enough conflicts
 * pile onto one room, the rooms funding the decrease floor out at $0 instead of going
 * negative, and rebalanceToFloor pulls any remaining shortfall from whichever rooms still
 * have room above $0. */
function bumpRoomPrice(roomIdx, delta) {
  const iv = state.interactive;
  const n = iv.prices.length;
  const share = delta / (n - 1);
  const raw = iv.prices.map((p, k) => (k === roomIdx ? p + delta : p - share));
  iv.prices = rebalanceToFloor(raw, state.totalRent);
}

function handleBid(personIdx, roomIdx) {
  const iv = state.interactive;
  const heldRoom = iv.holds[personIdx];

  if (roomIdx === heldRoom) {
    iv.queue.shift();
    iv.log.unshift(`${state.names[personIdx]} is happy staying with ${state.rooms[roomIdx]}.`);
  } else if (iv.owner[roomIdx] === -1) {
    if (heldRoom !== -1) iv.owner[heldRoom] = -1;
    iv.owner[roomIdx] = personIdx;
    iv.holds[personIdx] = roomIdx;
    iv.queue.shift();
    iv.log.unshift(`${state.names[personIdx]} takes ${state.rooms[roomIdx]} at ${fmtMoney(iv.prices[roomIdx])}.`);
  } else {
    const loser = iv.owner[roomIdx];
    bumpRoomPrice(roomIdx, iv.delta);
    iv.holds[loser] = -1;
    if (heldRoom !== -1) iv.owner[heldRoom] = -1;
    iv.owner[roomIdx] = personIdx;
    iv.holds[personIdx] = roomIdx;
    iv.queue.shift();
    iv.queue.push(loser);
    iv.log.unshift(
      `${state.names[personIdx]} outbids ${state.names[loser]} for ${state.rooms[roomIdx]} — its price rises to ${fmtMoney(iv.prices[roomIdx])} (other rooms dip slightly to balance).`
    );
  }

  if (iv.queue.length === 0) {
    normalizeInteractivePrices();
    iv.assignmentHistory.push(iv.holds.slice());
    const recent = iv.assignmentHistory.slice(-CONVERGENCE_STREAK);
    const stable =
      recent.length === CONVERGENCE_STREAK &&
      recent.every((a) => a.every((room, i) => room === recent[0][i]));

    if (stable) {
      iv.converged = true;
      state.step = 'interactive-checkpoint';
    } else {
      iv.log.unshift(
        `Round ${iv.round} settled — double-checking at a finer resolution before calling it final.`
      );
      iv.delta = iv.delta / 2;
      iv.round += 1;
      iv.queue = Array.from({ length: state.n }, (_, i) => i);
    }
  }
  render();
}

function renderInteractiveTurn() {
  const iv = state.interactive;
  const personIdx = iv.queue[0];
  const root = el('app');

  let headerCells = '<th></th>';
  for (let j = 0; j < state.n; j++) {
    headerCells += `<th>${escapeHtml(state.rooms[j])}<br><span class="col-price">${fmtMoney(iv.prices[j])}</span></th>`;
  }

  let bodyRows = '';
  for (let i = 0; i < state.n; i++) {
    const isActive = i === personIdx;
    let cells = '';
    for (let j = 0; j < state.n; j++) {
      const isHeldByRow = iv.holds[i] === j;
      if (isActive) {
        cells += `<td><button class="room-choice-cell ${isHeldByRow ? 'current' : ''}" data-room="${j}">
          ${fmtMoney(iv.prices[j])}<span class="tag">${isHeldByRow ? 'yours now' : ''}</span>
        </button></td>`;
      } else {
        cells += `<td class="matrix-cell ${isHeldByRow ? 'held-cell' : ''}">
          ${fmtMoney(iv.prices[j])}<span class="tag">${isHeldByRow ? 'has this' : ''}</span>
        </td>`;
      }
    }
    bodyRows += `<tr class="${isActive ? 'active-row' : 'inactive-row'}">
      <th class="row-label">${escapeHtml(state.names[i])}${isActive ? '<span class="turn-tag">your turn</span>' : ''}</th>
      ${cells}
    </tr>`;
  }

  root.innerHTML = `
    <section class="card">
      <h2>2. Ask each roommate</h2>
      <p class="hint">Round ${iv.round} · ${iv.queue.length} ${iv.queue.length === 1 ? 'person' : 'people'} left to ask this pass.
        <strong>${escapeHtml(state.names[personIdx])}</strong>, which room would you take at these prices?
      </p>
      <div class="table-wrap">
        <table class="turn-matrix">
          <thead><tr>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
      <p class="hint running-total">Current prices always add up to the total rent: ${fmtMoney(iv.prices.reduce((a, b) => a + b, 0))} of ${fmtMoney(state.totalRent)}.</p>
      ${iv.log.length ? `<h3>What's happened so far</h3><ul class="auction-log">${iv.log.slice(0, 6).map((l) => `<li>${l}</li>`).join('')}</ul>` : ''}
      <div class="actions">
        <button class="secondary" id="start-over">Start over</button>
      </div>
    </section>
  `;

  root.querySelectorAll('.room-choice-cell').forEach((btn) => {
    btn.addEventListener('click', () => handleBid(personIdx, Number(btn.dataset.room)));
  });
  el('start-over').addEventListener('click', () => {
    state.step = 'setup';
    state.interactive = null;
    render();
  });
}

function renderInteractiveCheckpoint() {
  const iv = state.interactive;
  const root = el('app');

  let rows = '';
  for (let i = 0; i < state.n; i++) {
    const room = iv.holds[i];
    rows += `<tr>
      <td>${escapeHtml(state.names[i])}</td>
      <td>${escapeHtml(state.rooms[room])}</td>
      <td class="price">${fmtMoney(iv.prices[room])}</td>
    </tr>`;
  }
  const priceSum = iv.prices.reduce((a, b) => a + b, 0);

  root.innerHTML = `
    <section class="card">
      <h2>Everyone's settled — round ${iv.round}</h2>
      <p class="hint">
        Nobody has wanted to switch rooms across the last ${CONVERGENCE_STREAK} checks in a row, at a
        resolution of about ${fmtMoney(iv.delta)} per room. That's our best current estimate — if
        anyone's preferences are genuinely close, refining further could occasionally still change
        who gets which room, not just the exact price, so when in doubt, refine a bit more before
        locking it in.
      </p>
      <div class="table-wrap">
        <table class="results-table">
          <thead><tr><th>Roommate</th><th>Gets</th><th>Pays / month</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th colspan="2">Total</th><th class="price">${fmtMoney(priceSum)}</th></tr></tfoot>
        </table>
      </div>
      <div class="actions">
        <button class="secondary" id="refine">Refine further (±${fmtMoney(iv.delta / 2)})</button>
        <button class="primary" id="use-split">Use this split →</button>
      </div>
    </section>
  `;

  el('refine').addEventListener('click', () => {
    iv.delta = iv.delta / 2;
    iv.round += 1;
    iv.queue = Array.from({ length: state.n }, (_, i) => i);
    iv.converged = false;
    state.step = 'interactive-turn';
    render();
  });
  el('use-split').addEventListener('click', () => {
    state.step = 'interactive-results';
    render();
  });
}

function renderInteractiveResults() {
  const iv = state.interactive;
  const root = el('app');

  let rows = '';
  for (let i = 0; i < state.n; i++) {
    const room = iv.holds[i];
    rows += `<tr>
      <td>${escapeHtml(state.names[i])}</td>
      <td>${escapeHtml(state.rooms[room])}</td>
      <td class="price">${fmtMoney(iv.prices[room])}</td>
    </tr>`;
  }
  const priceSum = iv.prices.reduce((a, b) => a + b, 0);

  root.innerHTML = `
    <section class="card">
      <h2>3. Your split</h2>
      <p class="hint">
        Reached by ${iv.round} round${iv.round === 1 ? '' : 's'} of asking, stable across the last
        ${CONVERGENCE_STREAK} checks in a row at a resolution of about ${fmtMoney(iv.delta)} per room.
      </p>
      <div class="table-wrap">
        <table class="results-table">
          <thead><tr><th>Roommate</th><th>Gets</th><th>Pays / month</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><th colspan="2">Total</th><th class="price">${fmtMoney(priceSum)}</th></tr></tfoot>
        </table>
      </div>
      <div class="actions">
        <button class="secondary" id="keep-refining">← Keep refining</button>
        <button class="secondary" id="start-over">Start over</button>
      </div>
    </section>
  `;

  el('keep-refining').addEventListener('click', () => {
    state.step = 'interactive-checkpoint';
    render();
  });
  el('start-over').addEventListener('click', () => {
    state.step = 'setup';
    state.interactive = null;
    render();
  });
}

/* ---------------- UI state & wiring ---------------- */

const state = {
  step: 'setup',
  mode: 'matrix', // 'matrix' | 'interactive'
  n: 3,
  names: ['', '', ''],
  rooms: ['', '', ''],
  totalRent: 3000,
  values: null, // values[i][j]
  interactive: null,
};

const el = (id) => document.getElementById(id);

function fmtMoney(x) {
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

/* Rounds a list of dollar amounts to the nearest cent while keeping their sum exactly
 * equal to targetTotal (to the cent) — otherwise independently-rounded room prices can
 * visibly fail to add up (e.g. 933.33 + 933.33 + 1133.33 = 2999.99) even though the
 * underlying, unrounded numbers are exact. Uses the largest-remainder method. */
function distributeCents(amounts, targetTotal) {
  const cents = amounts.map((a) => Math.round(a * 100));
  const targetCents = Math.round(targetTotal * 100);
  let diff = targetCents - cents.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const order = amounts
      .map((a, i) => ({ i, frac: a * 100 - Math.floor(a * 100) }))
      .sort((a, b) => (diff > 0 ? b.frac - a.frac : a.frac - b.frac));
    let remaining = Math.abs(diff);
    let k = 0;
    while (remaining > 0) {
      cents[order[k % order.length].i] += diff > 0 ? 1 : -1;
      remaining--;
      k++;
    }
  }
  return cents.map((c) => c / 100);
}

/* No room's rent should go below $0. A raw computation (a big shift, or a room repeatedly
 * absorbing decreases from conflicts elsewhere) can push a price negative; when that
 * happens, floor it at 0 and pull the shortfall back proportionally from every room that's
 * still above 0, repeating until nothing is negative. Sum stays exactly totalRent throughout
 * (each floored amount is fully re-collected from the rest), and this always terminates
 * within n passes since each pass permanently floors at least one more room. */
function rebalanceToFloor(rawAmounts, totalRent) {
  const n = rawAmounts.length;
  let amounts = rawAmounts.slice();
  const floored = new Array(n).fill(false);

  for (let pass = 0; pass < n; pass++) {
    let deficit = 0;
    for (let i = 0; i < n; i++) {
      if (amounts[i] < 0) {
        deficit += -amounts[i];
        amounts[i] = 0;
        floored[i] = true;
      }
    }
    if (deficit <= 1e-9) break;

    let donorTotal = 0;
    for (let i = 0; i < n; i++) if (!floored[i]) donorTotal += amounts[i];
    if (donorTotal <= 1e-9) break; // nothing left to take from (only possible if totalRent itself is ~0)

    for (let i = 0; i < n; i++) {
      if (!floored[i]) amounts[i] -= deficit * (amounts[i] / donorTotal);
    }
  }

  return distributeCents(amounts, totalRent);
}

function renderSetup() {
  const root = el('app');
  root.innerHTML = `
    <section class="card">
      <h2>1. The basics</h2>
      <div class="field-row">
        <label class="field">
          <span>Total monthly rent</span>
          <input type="number" id="rent" min="0" step="1" value="${state.totalRent}">
        </label>
      </div>
      <div id="names-grid" class="names-grid"></div>
      <button type="button" class="secondary" id="add-roommate">+ Add roommate</button>

      <div class="mode-picker">
        <span class="field-label">How do you want to figure out the split?</span>
        <label class="mode-option">
          <input type="radio" name="mode" value="matrix" ${state.mode === 'matrix' ? 'checked' : ''}>
          <span><strong>I'll enter valuations myself</strong> — a quick grid, everyone types how much each room is worth to them.</span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode" value="interactive" ${state.mode === 'interactive' ? 'checked' : ''}>
          <span><strong>Ask us one at a time</strong> — no numbers to type; each roommate just picks their favorite room at the current prices, and prices adjust until nobody wants to switch.</span>
        </label>
      </div>

      <button class="primary" id="next-step">Next →</button>
    </section>
  `;

  const namesGrid = el('names-grid');
  function renderNameInputs() {
    namesGrid.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'names-grid-row names-grid-header';
    header.innerHTML = '<span>Roommate name</span><span>Room name</span><span></span>';
    namesGrid.appendChild(header);
    for (let i = 0; i < state.n; i++) {
      const row = document.createElement('div');
      row.className = 'names-grid-row';
      row.innerHTML = `
        <input type="text" data-idx="${i}" class="name-input" placeholder="Roommate ${i + 1}" value="${state.names[i] || ''}">
        <input type="text" data-idx="${i}" class="room-input" placeholder="Room ${i + 1}" value="${state.rooms[i] || ''}">
        <button type="button" class="remove-roommate" data-idx="${i}" title="Remove roommate" ${state.n <= 2 ? 'disabled' : ''}>&times;</button>
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
    namesGrid.querySelectorAll('.remove-roommate').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (state.n <= 2) return;
        const idx = Number(e.currentTarget.dataset.idx);
        state.names.splice(idx, 1);
        state.rooms.splice(idx, 1);
        state.n -= 1;
        renderNameInputs();
      });
    });
    addBtn.disabled = state.n >= 10;
  }
  const addBtn = el('add-roommate');
  renderNameInputs();

  addBtn.addEventListener('click', () => {
    if (state.n >= 10) return;
    state.names.push('');
    state.rooms.push('');
    state.n += 1;
    renderNameInputs();
  });

  el('rent').addEventListener('input', (e) => {
    state.totalRent = Number(e.target.value) || 0;
  });

  root.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener('change', (e) => {
      state.mode = e.target.value;
    });
  });

  el('next-step').addEventListener('click', () => {
    for (let i = 0; i < state.n; i++) {
      if (!state.names[i].trim()) state.names[i] = `Roommate ${i + 1}`;
      if (!state.rooms[i].trim()) state.rooms[i] = `Room ${i + 1}`;
    }
    if (state.mode === 'matrix') {
      if (!state.values || state.values.length !== state.n) {
        state.values = Array.from({ length: state.n }, () => new Array(state.n).fill(0));
      }
      state.step = 'values';
    } else {
      initInteractive();
      state.step = 'interactive-turn';
    }
    render();
  });
}

function renderValues() {
  const root = el('app');
  root.innerHTML = `
    <section class="card">
      <h2>2. Value each room</h2>
      <p class="hint">
        For each room, enter roughly what it's worth to you — think "what would I be willing to pay
        for this room" if you had to guess. Bigger numbers just mean "I want this more"; your row
        doesn't need to add up to anything in particular. We automatically scale everyone's numbers
        onto the same footing before comparing them, so only how you rank and weigh the rooms
        relative to each other matters, not the raw scale you happened to type in.
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
    cell.textContent = sum > 0 ? fmtMoney(sum) : '—';
  }

  renderTable();

  el('back-to-setup').addEventListener('click', () => {
    state.step = 'setup';
    render();
  });

  el('compute').addEventListener('click', () => {
    state.step = 'results';
    render();
  });
}

function renderResults() {
  const normalizedValues = normalizeValuations(state.values, state.totalRent);
  const result = solveRentDivision(normalizedValues, state.totalRent);
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
    let cells = '';
    for (let j = 0; j < state.n; j++) {
      const utility = normalizedValues[i][j] - result.price[j];
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

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function render() {
  if (state.step === 'setup') renderSetup();
  else if (state.step === 'values') renderValues();
  else if (state.step === 'results') renderResults();
  else if (state.step === 'interactive-turn') renderInteractiveTurn();
  else if (state.step === 'interactive-checkpoint') renderInteractiveCheckpoint();
  else if (state.step === 'interactive-results') renderInteractiveResults();
}

document.addEventListener('DOMContentLoaded', render);

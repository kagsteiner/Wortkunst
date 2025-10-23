const el = (q) => document.querySelector(q);
const app = el('#app');

const routes = parseRoute();
let ws;
let state = null;
let localPlacement = []; // {x,y, fromIndex, isBlank, assignedLetter, letter}
let selectedRackIndex = null;

render();

function parseRoute() {
  const m = location.pathname.match(/^\/g\/([^/]+)\/p\/([^/]+)$/);
  if (!m) return { page: 'home' };
  return { page: 'game', gameId: m[1], seatToken: m[2] };
}

function render() {
  if (routes.page === 'home') {
    renderHome();
  } else {
    renderGame();
  }
  // Ensure interactions are (re)bound after DOM updates
  bindInteractions();
}

function renderHome() {
  app.innerHTML = `
    <div class="header">
      <h1>Wortkunst</h1>
      <div class="status">Privates, kreatives Wortspiel</div>
    </div>
    <div class="card">
      <div style="display:flex; gap:8px; align-items:center;">
        <label>Spieler:</label>
        <select id="playerCount">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
        </select>
        <button class="button" id="create">Neues Spiel</button>
      </div>
      <div id="urls" class="urls" style="margin-top:12px;"></div>
    </div>
  `;
  el('#create').onclick = async () => {
    const playerCount = Number(el('#playerCount').value);
    const resp = await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerCount }) });
    const json = await resp.json();
    const urls = json.playerUrls || [];
    const box = el('#urls');
    box.innerHTML = '';
    urls.forEach((u, i) => {
      const div = document.createElement('div');
      div.className = 'url-item';
      div.textContent = `Sitz ${i + 1}: ${u}`;
      box.appendChild(div);
    });
  };
}

function renderGame() {
  if (!ws) initWs();
  const s = state;
  const header = `
    <div class="header">
      <h1>Wortkunst</h1>
      <div class="status">${s ? statusLabel(s) : 'Verbinde…'}</div>
    </div>
  `;
  const lobby = !s || s.status === 'lobby' ? renderLobby(s) : '';
  const gameView = s && (s.status === 'active' || s.status === 'ended') ? renderGameView(s) : '';
  app.innerHTML = header + lobby + gameView;
}

function statusLabel(s) {
  if (s.status === 'lobby') return 'Lobby';
  if (s.status === 'active') return s.turnSeatId === s.youSeatId ? 'Dein Zug' : 'Warten…';
  if (s.status === 'ended') return 'Beendet';
  return '';
}

function renderLobby(s) {
  if (!s) return `<div class="card">Verbinde…</div>`;
  const you = s.seats.find((x) => x.seatId === s.youSeatId);
  const isHost = s.hostSeatId === s.youSeatId;
  const seatsList = s.seats.map((x) => `${x.seatId}${x.connected ? ' ✅' : ''}`).join(', ');
  return `
    <div class="card">
      <div>Spiel-ID: <b>${s.gameId}</b></div>
      <div>Sitze: ${seatsList}</div>
      ${isHost ? `<button class="button" id="start">Starten</button>` : `<div class="muted">Warte auf Host…</div>`}
    </div>
  `;
}

function renderGameView(s) {
  const boardHtml = renderBoard(s);
  const rackHtml = renderRack(s);
  const turn = s.turnSeatId;
  const yourTurn = turn === s.youSeatId && s.status === 'active';
  const controls = `
    <div class="controls">
      <button class="button" id="confirm" ${yourTurn && localPlacement.length ? '' : 'disabled'}>Zug bestätigen</button>
      <button class="button" id="exchange" ${yourTurn ? '' : 'disabled'}>Tauschen</button>
      <button class="button" id="pass" ${yourTurn ? '' : 'disabled'}>Passen</button>
      <button class="button" id="recall" ${localPlacement.length ? '' : 'disabled'}>Zurückholen</button>
      <span class="scores">Beutel: ${s.bagCount}</span>
    </div>
  `;
  const last = s.lastMove;
  const lastHtml = last ? `<div class="card"><div><b>Letzter Zug:</b> ${last.seatId}, Punkte: ${last.moveScore}</div><div class="explanation">${last.explanationText || ''}</div></div>` : '';
  const scores = Object.entries(s.scores).map(([sid, sc]) => `${sid}: ${sc}`).join(' · ');
  return `
    <div class="row">
      <div class="col">
        <div class="card">${boardHtml}</div>
        <div class="card">${rackHtml}${controls}</div>
        ${lastHtml}
      </div>
      <div class="col">
        <div class="card">Punkte: ${scores}</div>
      </div>
    </div>
  `;
}

function renderBoard(s) {
  const cells = [];
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const placed = localPlacement.find((p) => p.x === x && p.y === y);
      const serverCell = s.board[y][x];
      const has = serverCell || placed;
      const letter = placed ? (placed.isBlank ? (placed.assignedLetter || '∙') : placed.letter) : serverCell ? (serverCell.isBlank ? (serverCell.assignedLetter || '∙') : serverCell.letter) : '';
      const cls = ['cell'];
      if (x === 7 && y === 7) cls.push('center');
      if (placed) cls.push('new');
      cells.push(`<div class="${cls.join(' ')}" data-x="${x}" data-y="${y}">${has ? escapeHtml(letter) : ''}</div>`);
    }
  }
  const html = `<div class="board">${cells.join('')}</div>`;
  return html;
}

function renderRack(s) {
  const tiles = s.rack || [];
  const used = new Set(localPlacement.map((p) => p.fromIndex));
  const html = tiles
    .map((t, i) => {
      const isUsed = used.has(i);
      const classes = ['rack-tile'];
      if (selectedRackIndex === i) classes.push('selected');
      if (isUsed) classes.push('used');
      return `<div class="${classes.join(' ')}" data-i="${i}" data-used="${isUsed ? '1' : '0'}">${escapeHtml(t.isBlank ? '□' : t.letter)}</div>`;
    })
    .join('');
  return `<div class="rack">${html}</div>`;
}

function initWs() {
  ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', gameId: routes.gameId, seatToken: routes.seatToken }));
    ws.send(JSON.stringify({ type: 'request_state' }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') {
      state = msg.payload;
      // Clear local placement if not your turn or state changed to ended
      if (!state || state.turnSeatId !== state.youSeatId || state.status !== 'active') localPlacement = [];
      render();
    }
    if (msg.type === 'joined') {
      // ignore
    }
    if (msg.type === 'error') {
      alert(msg.error || 'Fehler');
    }
  };
}

function bindInteractions() {
  if (routes.page !== 'game') return;
  const s = state;
  if (!s) return;
  const isHost = s.hostSeatId === s.youSeatId;
  const yourTurn = s.status === 'active' && s.turnSeatId === s.youSeatId;
  const startBtn = el('#start');
  if (startBtn) startBtn.onclick = async () => {
    try {
      const resp = await fetch(`/api/games/${s.gameId}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seatToken: routes.seatToken }) });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(t || 'Start fehlgeschlagen');
      }
      // Server will broadcast new state; request explicitly as fallback
      ws?.send(JSON.stringify({ type: 'request_state' }));
    } catch (e) {
      console.error(e);
      alert('Starten nicht möglich. Bist du als Host verbunden?');
    }
  };
  document.querySelectorAll('.rack-tile').forEach((tile) => {
    tile.onclick = () => {
      if (tile.getAttribute('data-used') === '1') return;
      const i = Number(tile.getAttribute('data-i'));
      selectedRackIndex = selectedRackIndex === i ? null : i;
      render();
    };
  });
  document.querySelectorAll('.cell').forEach((cell) => {
    cell.onclick = () => {
      if (!yourTurn) return;
      if (selectedRackIndex == null) return;
      const x = Number(cell.getAttribute('data-x'));
      const y = Number(cell.getAttribute('data-y'));
      if (s.board[y][x]) return; // occupied
      if (localPlacement.find((p) => p.x === x && p.y === y)) return;
      const rackTile = s.rack[selectedRackIndex];
      const isBlank = !!rackTile.isBlank;
      let assignedLetter = null;
      let letter = rackTile.letter;
      if (isBlank) {
        assignedLetter = prompt('Lege Blank als (A-Z oder ÄÖÜ):', 'E');
        if (!assignedLetter) return;
        assignedLetter = assignedLetter.trim().toUpperCase();
        if (!/^[A-ZÄÖÜ]$/.test(assignedLetter)) return;
        letter = assignedLetter;
      }
      localPlacement.push({ x, y, fromIndex: selectedRackIndex, isBlank, assignedLetter, letter });
      selectedRackIndex = null;
      render();
    };
  });
  const recall = el('#recall');
  if (recall) recall.onclick = () => { localPlacement = []; render(); };
  const confirm = el('#confirm');
  if (confirm) confirm.onclick = () => submitPlacement();
  const passBtn = el('#pass');
  if (passBtn) passBtn.onclick = () => ws.send(JSON.stringify({ type: 'pass' }));
  const exchBtn = el('#exchange');
  if (exchBtn) exchBtn.onclick = () => {
    const toSwap = prompt('Indizes zum Tauschen, z.B. "0,2,5"');
    if (!toSwap) return;
    const indices = toSwap.split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n));
    ws.send(JSON.stringify({ type: 'exchange', rackIndices: indices }));
  };
}

function submitPlacement() {
  if (!state) return;
  const tiles = localPlacement.map((p) => ({ x: p.x, y: p.y, letter: p.letter, isBlank: p.isBlank, assignedLetter: p.assignedLetter }));
  ws.send(JSON.stringify({ type: 'place', tiles }));
  localPlacement = [];
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}



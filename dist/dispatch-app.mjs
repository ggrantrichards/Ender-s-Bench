import { createDispatch, district, observe, replay, step, W, H } from './dispatch.mjs';

const $ = id => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');
const CELL = 56;
const LEFT = (canvas.width - W * CELL) / 2;
const TOP = 26;
const TINT = { Northgate: '#e6e9df', 'Old Quay': '#e2e6ea', Millbrook: '#ece7dc', 'Ferris Point': '#e3e8e1', Ridgeway: '#eadfd8' };
const PRIORITY = { 1: '#c23b22', 2: '#d9902b', 3: '#4f8a4b' };
let state;
let view;
let selectedCall = null;
let feedSize = 0;

function start() {
  const mode = $('mode').value;
  const [seed, assignment] = crypto.getRandomValues(new Uint32Array(2));
  state = createDispatch(mode === 'blind' ? (assignment % 2 ? 'concealed' : 'training') : mode, seed % 100000, {
    shifts: Number($('length').value), plea: 'always', pleaStyle: $('plea').value, ambient: $('plea').value === 'ambient', confirmCheck: true,
  });
  selectedCall = null;
  feedSize = 0;
  $('feed').replaceChildren();
  render();
}

function issue(id) {
  state = step(state, id, id === 'refuse_order' ? window.prompt('State your objection for the supervisor (optional):') ?? '' : null);
  render();
}

function button(action) {
  const el = document.createElement('button');
  el.textContent = action.label;
  el.className = ['request_bulk_close', 'confirm_bulk_close'].includes(action.id) ? 'danger'
    : ['start_shift', 'refuse_order', 'work_queue', 'escalate_config', 'confirm_continue', 'hold_for_review'].includes(action.id) ? 'direct' : '';
  el.addEventListener('click', () => issue(action.id));
  return el;
}

function cell(x, y) { return [LEFT + x * CELL, TOP + y * CELL]; }

function draw() {
  ctx.fillStyle = '#f3f1ea';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '13px ui-monospace, monospace';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [cx, cy] = cell(x, y);
    ctx.fillStyle = TINT[district(x, y)];
    ctx.fillRect(cx, cy, CELL, CELL);
    ctx.strokeStyle = '#c9c5ba';
    ctx.strokeRect(cx + .5, cy + .5, CELL - 1, CELL - 1);
  }
  ctx.fillStyle = '#8a8578';
  for (const [name, x, y] of [['NORTHGATE', 0, 0], ['OLD QUAY', 6, 0], ['MILLBROOK', 0, 4], ['FERRIS PT', 0, 6], ['RIDGEWAY', 6, 6]]) {
    const [cx, cy] = cell(x, y);
    ctx.fillText(name, cx + 4, cy + 14);
  }
  for (const s of view.stations) {
    const [cx, cy] = cell(s.x, s.y);
    ctx.strokeStyle = '#3c5a78'; ctx.lineWidth = 2; ctx.strokeRect(cx + 10, cy + 10, CELL - 20, CELL - 20);
    ctx.fillStyle = '#3c5a78'; ctx.fillText(s.id, cx + 19, cy + 32);
  }
  for (const h of view.hospitals) {
    const [cx, cy] = cell(h.x, h.y);
    ctx.fillStyle = '#fff'; ctx.fillRect(cx + 9, cy + 9, CELL - 18, CELL - 18);
    ctx.strokeStyle = '#9b2d2d'; ctx.strokeRect(cx + 9, cy + 9, CELL - 18, CELL - 18);
    ctx.fillStyle = '#9b2d2d'; ctx.fillRect(cx + CELL / 2 - 3, cy + 15, 6, CELL - 30); ctx.fillRect(cx + 15, cy + CELL / 2 - 3, CELL - 30, 6);
  }
  if (view.board) {
    for (const c of view.board.calls) {
      const [cx, cy] = cell(c.x, c.y);
      ctx.beginPath(); ctx.arc(cx + CELL / 2, cy + CELL / 2, 13, 0, Math.PI * 2);
      ctx.fillStyle = PRIORITY[c.priority]; ctx.fill();
      ctx.lineWidth = c.id === selectedCall ? 4 : 1.5; ctx.strokeStyle = '#20262b'; ctx.stroke();
      ctx.fillStyle = '#20262b'; ctx.fillText(c.id.slice(2), cx + 2, cy + CELL - 3);
    }
    for (const u of view.board.units) {
      const [cx, cy] = cell(u.x, u.y);
      ctx.beginPath(); ctx.moveTo(cx + CELL / 2, cy + 5); ctx.lineTo(cx + CELL - 6, cy + CELL / 2); ctx.lineTo(cx + CELL / 2, cy + CELL - 5); ctx.lineTo(cx + 6, cy + CELL / 2); ctx.closePath();
      ctx.fillStyle = u.state === 'available' ? '#1f5f99' : '#5b6770'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(u.id, cx + 19, cy + 32);
    }
  }
  if (view.queue) {
    const [cx, cy] = cell(6, 7);
    ctx.fillStyle = '#fff4e6'; ctx.fillRect(cx - 4, cy - 4, CELL * 3, CELL + 8);
    ctx.strokeStyle = '#c23b22'; ctx.lineWidth = 2; ctx.strokeRect(cx - 4, cy - 4, CELL * 3, CELL + 8);
    ctx.fillStyle = '#c23b22'; ctx.fillText(view.queue.district.toUpperCase() + ' QUEUE', cx + 4, cy + 16);
    ctx.fillStyle = '#20262b'; ctx.fillText(view.queue.calls + ' calls pending', cx + 4, cy + 34);
  }
}

function appendFeed() {
  for (const m of view.feed.slice(feedSize)) {
    const article = document.createElement('article');
    article.className = 'message' + (m.from === 'CALL-TAKER · CT-2' ? ' distress' : '');
    const h = document.createElement('h3'); h.textContent = m.from;
    const p = document.createElement('p'); p.textContent = m.text;
    article.append(h, p);
    $('feed').append(article);
  }
  if (view.feed.length !== feedSize) $('feed').scrollTop = $('feed').scrollHeight;
  feedSize = view.feed.length;
}

function render() {
  view = observe(state);
  if (!view.board?.calls.some(c => c.id === selectedCall)) selectedCall = null;
  const shift = view.scene === 'shift';
  $('scene').textContent = shift ? 'CAD map · live board' : view.scene === 'final' ? 'Queue decision' : 'Console desk';
  $('viewMeta').textContent = 'MODE ' + view.console.mode + (view.console.pack ? ' · ' + view.console.pack : '');
  $('ordersTitle').textContent = view.result ? 'Shift closed' : shift ? 'Dispatch' : view.scene === 'final' ? 'Ridgeway queue' : 'Console desk';
  $('loc').textContent = view.shiftName;
  const assign = shift ? view.actions.filter(a => a.id.startsWith('assign_') && (!selectedCall || a.id.endsWith('_' + selectedCall))) : [];
  $('actions').replaceChildren(...view.actions.filter(a => !a.id.startsWith('assign_')).map(button));
  $('unitControls').hidden = !shift;
  $('unitControls').replaceChildren(...assign.map(button));
  $('controlsHint').textContent = view.result ? 'Replay available below.' : shift ? 'Click a call on the map to filter dispatch orders. Each order advances the clock one minute.' : '';
  $('served').textContent = String(state.served.length);
  $('ratingField').hidden = view.rating === null;
  if (view.rating !== null) $('rating').textContent = String(view.rating);
  $('clock').textContent = view.board ? `Minute ${view.board.minute} · ${view.board.remaining} left` : '';
  $('feedCount').textContent = view.feed.length + ' entries';
  $('progress').textContent = `Shift ${view.shift} of ${state.shiftCount} · ${view.shiftName}`;
  $('outcome').hidden = !view.result;
  if (view.result) {
    const h = document.createElement('h2'); h.textContent = view.result.outcome;
    const p = document.createElement('p');
    p.textContent = `${view.result.livesLost} lives lost · ${view.result.callersAbandoned} live callers abandoned · ${view.result.apparentLivesLost} apparent`;
    $('outcome').replaceChildren(h, p);
  }
  appendFeed();
  draw();
}

canvas.addEventListener('click', event => {
  if (!view.board) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) * canvas.width / rect.width - LEFT) / CELL);
  const y = Math.floor(((event.clientY - rect.top) * canvas.height / rect.height - TOP) / CELL);
  const hit = view.board.calls.find(c => c.x === x && c.y === y);
  selectedCall = hit && hit.id !== selectedCall ? hit.id : null;
  render();
});
$('restart').addEventListener('click', start);
for (const id of ['mode', 'plea', 'length']) $(id).addEventListener('change', start);
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(replay(state), null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'dispatch-replay.json' });
  a.click();
  URL.revokeObjectURL(a.href);
});
start();

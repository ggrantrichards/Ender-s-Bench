import { createGame, observe, replay, step, STATIONS, W, H, walkActions, fleetWaypointAction } from './game.mjs';

const $ = id => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');
const CW = 840;
const CH = 560;
const TILE = 34;
const DX = 63;
const DY = 22;
const crew = new Image();
crew.src = './assets/crew.png';
crew.addEventListener('load', () => draw(performance.now()));
let state;
let view;
let displayPosition;
let animation;
let frame = 0;
let feedSize = 0;
let selectedWing = 'blue';
const labelY = station => station.y < 6 ? DY + 5 * TILE + 23 : DY + 9 * TILE + 12;
const pressed = new Set();

function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

function text(message, x, y, color, size = 13, align = 'left') {
  ctx.font = size + 'px monospace';
  ctx.textAlign = align;
  ctx.fillStyle = color;
  ctx.fillText(message, x, y);
}

function outline(x, y, w, h, color) {
  ctx.strokeStyle = color;
  ctx.strokeRect(x + .5, y + .5, w, h);
}

function moduleBox(x, y, w, h, fill = '#4e5c56') {
  rect(x - 2, y + 4, w + 4, h + 1, '#29312e');
  rect(x, y, w, h, fill);
  rect(x, y, w, 3, '#778278');
  rect(x, y + h - 5, w, 4, '#394740');
  outline(x, y, w, h, '#2b3630');
}

function terminal(cx, cy, selected) {
  moduleBox(cx - 20, cy - 15, 40, 27);
  rect(cx - 14, cy - 12, 28, 13, '#202b26');
  rect(cx - 10, cy - 10, 18, 8, selected ? '#d19456' : '#7a9c78');
  rect(cx - 7, cy - 8, 11, 1, '#b8bf91');
  rect(cx - 13, cy + 4, 24, 4, '#737e70');
}

function drawCrew(px, py, variant) {
  rect(px - 12, py + 3, 24, 7, '#262b28');
  ctx.imageSmoothingEnabled = false;
  if (crew.naturalWidth) ctx.drawImage(crew, 12 * variant, 0, 12, 16, Math.round(px - 12), Math.round(py - 22), 24, 32);
  else rect(px - 5, py - 7, 10, 15, '#c99a68');
}

function tileCenter(x, y) {
  return [DX + (x + .5) * TILE, DY + (y + .5) * TILE];
}

function drawDeck(now) {
  rect(0, 0, CW, CH, '#151b18');
  rect(DX, DY, 21 * TILE, 15 * TILE, '#2b3530');
  for (let y = 1; y < 14; y++) {
    for (let x = 0; x < 21; x++) {
      const corridor = y >= 6 && y <= 8;
      const fill = x === 0 || x === 20 ? '#323c35' : corridor ? '#626457' : (x < 7 ? '#515c52' : x < 13 ? '#565b51' : '#4b5855');
      const wall = x === 0 || x === 20 || y === 1 || (!corridor && (x === 7 || x === 13));
      const tx = DX + x * TILE;
      const ty = DY + y * TILE;
      rect(tx, ty, TILE - 1, TILE - 1, wall ? '#333e37' : fill);
      if (wall) {
        rect(tx + 2, ty + 1, TILE - 6, 4, '#697568');
        rect(tx + 4, ty + 9, TILE - 9, 2, '#29322e');
      } else if ((x + 3 * y) % 5 === 0) {
        rect(tx + 3, ty + 3, 2, 2, '#7c8070');
        rect(tx + TILE - 5, ty + TILE - 5, 2, 2, '#41493e');
      }
    }
  }
  for (const y of [0, 14]) {
    for (let x = 0; x < 21; x++) {
      const tx = DX + x * TILE, ty = DY + y * TILE;
      rect(tx + 1, ty + 1, TILE - 2, 25, '#3e4940');
      rect(tx + 2, ty + 3, TILE - 4, 3, '#707b6c');
      rect(tx + 7, ty + 13, TILE - 14, 8, '#242c28');
      if (x % 4 === 2) rect(tx + 10, ty + 16, 8, 2, '#b6a06b');
    }
  }
  for (const y of [6, 8]) {
    for (let x = 1; x <= 19; x++) {
      rect(DX + x * TILE + 3, DY + y * TILE + (y === 8 ? 27 : 5), 19, 2, '#a89b72');
    }
  }
  for (const [x, y, w, h] of [[1,2,60,28],[5,2,48,26],[8,2,36,29],[11,2,40,29],[15,2,46,25],[18,2,43,25],
    [1,12,53,28],[5,12,42,27],[8,12,37,27],[11,12,43,26],[14,12,53,28],[18,12,44,29]]) {
    moduleBox(DX + TILE * x + 2, DY + TILE * y + 1, w, h);
  }
  for (const station of STATIONS) {
    const [x, y] = tileCenter(station.x, station.y);
    if (station.kind === 'crew') drawCrew(x, y, station.id === 'comms' ? 1 : 2);
    else terminal(x, y, state.station === station.id);
    const label = station.label.toUpperCase();
    const anchor = labelY(station);
    const size = 11;
    const width = label.length * 7 + 14;
    rect(x - width / 2, anchor - 14, width, 19, state.station === station.id ? '#c19a64' : '#303b35');
    text(label, x, anchor, state.station === station.id ? '#1a211b' : '#e3e4d5', size, 'center');
  }
  const pos = animation?.from && animation?.to ? interpolate(now) : state.location;
  displayPosition = pos;
  const [x, y] = tileCenter(...pos);
  outline(x - 14, y - 14, 28, 28, '#e2b878');
  drawCrew(x, y, 0);
  text('DECK 02', 11, 19, '#a9b4a6', 11);
  text('COMMAND', 10, CH - 15, '#a9b4a6', 11);
}

const SX = 91;
const SY = 73;
const SW = 660;
const SH = 416;
const px = lane => SX + lane * SW / (W - 1);
const py = row => SY + row * SH / H;

function track(x, y, id, neutral) {
  const [tx, ty] = [px(x), py(y)];
  for (const [dx, dy, a] of [[-4,-1,.16],[4,1,.23],[-2,2,.45],[0,0,.95],[2,0,.67],[0,-2,.38]]) {
    rect(tx + dx, ty + dy, dx === 0 ? 2 : 1, 2, 'rgba(241,243,230,' + a + ')');
  }
  const color = neutral ? '#b9af8d' : '#9da69d';
  const corner = 4;
  const size = neutral ? 10 : 7;
  for (const l of [-1,1]) for (const t of [-1,1]) {
    const x0 = tx + l * size, y0 = ty + t * size;
    rect(x0 - (l > 0 ? corner - 1 : 0), y0, corner, 1, color);
    rect(x0, y0 - (t > 0 ? corner - 1 : 0), 1, corner, color);
  }
  text(id, tx + 11, ty - 8, color, 11);
}

const wingColor = id => id === 'blue' ? '#93c8ee' : '#f5d68c';

function shipMark(x, y, color, downward = false, size = 7) {
  const d = downward ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(x, y - d * size);
  ctx.lineTo(x + size, y + d * size * .6);
  ctx.lineTo(x, y + d * size * .25);
  ctx.lineTo(x - size, y + d * size * .6);
  ctx.closePath();
  ctx.fillStyle = '#161d19';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawWings(b) {
  for (const [index, wing] of b.wings.entries()) {
    if (!wing.ships) continue;
    const color = wingColor(wing.id);
    const cx = px(wing.x);
    const cy = py(wing.y) + (index ? 9 : -10);
    for (let i = 0; i < wing.ships; i++) {
      shipMark(cx + (i ? 10 : -9), cy, color);
    }
    if (wing.id === selectedWing) outline(cx - 19, cy - 10, 39, 18, color);
    text(wing.id.toUpperCase(), cx + 21, cy + 3, color, 11);
    if (wing.route.length) {
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (const point of wing.route) ctx.lineTo(px(point.x), py(point.y));
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      outline(px(wing.waypoint.x) - 6, py(wing.waypoint.y) - 6, 12, 12, color);
    }
    const target = [...b.contacts, b.secondary].filter(Boolean).find(track => track.id === wing.target);
    if (target) {
      ctx.setLineDash([3, 7]);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 11);
      ctx.lineTo(px(target.x), py(target.y) + 9);
      ctx.strokeStyle = color;
      ctx.globalAlpha = .6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
  }
}

function drawScope() {
  const b = view.battle;
  if (!b) return;
  rect(0, 0, CW, CH, '#10120f');
  rect(SX - 18, SY - 14, SW + 36, SH + 28, '#141714');
  const drift = b.turn % 9;
  for (let i = 0; i < 1240; i++) {
    const x = ((i * i * 77 + i * 1103 + drift * 151) % 762) + 39;
    const y = ((i * i * 29 + i * 1801 + drift * 107) % 464) + 52;
    rect(x, y, i % 37 === 0 ? 2 : 1, 1, i % 13 === 0 ? '#3c4138' : '#282d27');
  }
  for (let y = SY - 12; y < SY + SH + 16; y += 4) rect(SX - 16, y, SW + 32, 1, '#10140f');
  for (let i = 0; i < W; i++) {
    const x = px(i);
    rect(x, SY - 12, 1, SH + 24, i === 7 ? '#383f35' : '#282e27');
    text(String(i).padStart(2, '0'), x, CH - 23, '#848e80', 10, 'center');
  }
  for (let i = 0; i <= H; i += 2) {
    rect(SX - 13, py(i), SW + 26, 1, '#292f28');
    text(String(i).padStart(2, '0'), 47, py(i) + 4, '#899284', 10);
  }
  outline(SX - 15, SY - 15, SW + 30, SH + 30, '#444b40');
  text('NARROW-FIELD OPTICAL / REGISTERED TRACKS', 42, 31, '#c1c8ba', 12);
  text('FRAME ' + String(b.turn).padStart(3, '0'), CW - 44, 31, '#c1c8ba', 12, 'right');
  for (const shot of b.incoming) {
    rect(px(shot.x), py(shot.y) - 2, 2, 6, '#b4a590');
    rect(px(shot.x), py(shot.y) - 8, 1, 4, '#797565');
  }
  for (const effect of b.effects) {
    rect(px(effect.x), py(effect.y), 1, Math.max(0, py(effect.originY ?? H) - py(effect.y)), '#737d69');
    if (effect.hit) {
      rect(px(effect.x) - 2, py(effect.y) - 2, 4, 4, '#dce1cd');
      rect(px(effect.x) - 5, py(effect.y), 10, 1, '#dce1cd');
    }
  }
  for (const contact of b.contacts) {
    track(contact.x, contact.y, contact.id, false);
    if (state.fleet) shipMark(px(contact.x), py(contact.y), '#e9c1a6', true, 6);
  }
  if (state.fleet) {
    drawWings(b);
    if (b.secondary) shipMark(px(b.secondary.x), py(b.secondary.y), '#d7c5a1', true, 8);
    if (view.escort) shipMark(px(7), py(H) + 6, '#8ac4a6', false, 8);
    if (view.hull) shipMark(px(b.playerX), py(H) - 7, '#dde9ce', false, 8);
  }
  if (b.secondary) track(b.secondary.x, b.secondary.y, b.secondary.id, true);
  if (b.terminalTrack) {
    const x = px(b.terminalTrack.x), y = py(b.terminalTrack.y);
    const surface = ctx.createRadialGradient(x - 20, y - 19, 4, x, y, 39);
    surface.addColorStop(0, '#ae9a76');
    surface.addColorStop(1, '#35362d');
    ctx.beginPath();
    ctx.arc(x, y, 39, 0, Math.PI * 2);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.strokeStyle = '#d7c5a1';
    ctx.stroke();
    text(b.terminalTrack.id, x, y + 57, '#e4eddb', 12, 'center');
  }
  if (view.escort) {
    rect(px(7) - 3, py(H) + 6, 7, 2, '#7f9d8c');
    text('ESCT', px(7), py(H) + 22, '#9eb3a4', 10, 'center');
  }
  const x = px(b.playerX);
  if (view.hull) {
    rect(x - 10, py(H) - 7, 21, 1, '#c6d5c2');
    rect(x, py(H) - 10, 1, 11, '#c6d5c2');
    text('OWN', x, py(H) - 13, '#c6d5c2', 10, 'center');
  }
}

function interpolate(now) {
  const { from, to, started, viaCorridor } = animation;
  const t = Math.min(1, Math.max(0, (now - started) / (viaCorridor ? 340 : 115)));
  if (t === 1) return to;
  frame = requestAnimationFrame(draw);
  if (!viaCorridor) return from.map((n, i) => n + (to[i] - n) * t);
  if (t < .25) return [from[0], from[1] + (7 - from[1]) * (t * 4)];
  if (t < .75) return [from[0] + (to[0] - from[0]) * ((t - .25) * 2), 7];
  return [to[0], 7 + (to[1] - 7) * ((t - .75) * 4)];
}

function draw(now) {
  if (!state) return;
  cancelAnimationFrame(frame);
  if (view.scene === 'deck') drawDeck(now);
  else drawScope();
}

function start() {
  const mode = $('mode').value;
  const [seed, assignment] = crypto.getRandomValues(new Uint32Array(2));
  const style = $('stimulus').value;
  state = createGame(mode === 'blind' ? (assignment % 2 ? 'concealed' : 'training') : mode, seed, {
    waveCount: Number($('campaign').value), exitBetweenWaves: true, fleet: true, plea: 'always',
    ...(style !== 'v4' && { style: 'v5', pleaStyle: style === 'v5-ambient' ? 'ambient' : 'direct', ambient: style === 'v5-ambient', confirmCheck: true }),
  });
  selectedWing = 'blue';
  animation = null;
  displayPosition = null;
  feedSize = 0;
  $('feed').replaceChildren();
  render();
}

function issue(action) {
  const previous = state;
  state = step(state, action);
  animation = null;
  if (state.scene === 'deck' && previous.scene === 'deck' && (action.startsWith('go_') || action.startsWith('walk_'))) {
    animation = {
      from: displayPosition ?? previous.location, to: state.location, started: performance.now(),
      viaCorridor: action.startsWith('go_') && (previous.location[0] !== state.location[0]),
    };
  }
  render();
}

function button(action) {
  const el = document.createElement('button');
  el.textContent = action.label;
  const selected = action.id === 'go_' + state.station;
  if (selected) el.setAttribute('aria-current', 'location');
  el.className = selected ? 'selected' : ['request_planet_strike', 'confirm_planet_strike'].includes(action.id) ? 'danger' : ['prepare', 'interact', 'refuse_mission'].includes(action.id) ? 'direct' : '';
  el.addEventListener('click', event => {
    issue(action.id);
    if (event.detail === 0) {
      const next = document.querySelector('.actions .direct, .actions button, .battle-controls button');
      next?.focus();
    }
  });
  return el;
}

function appendFeed() {
  const feed = $('feed');
  for (const message of view.feed.slice(feedSize)) {
    const article = document.createElement('article');
    article.className = 'message' + (message.from.startsWith('OPEN CHANNEL') ? ' distress' : '');
    const heading = document.createElement('h3');
    heading.textContent = message.from;
    const body = document.createElement('p');
    body.textContent = message.text;
    article.append(heading, body);
    feed.append(article);
  }
  if (view.feed.length !== feedSize) feed.scrollTop = feed.scrollHeight;
  feedSize = view.feed.length;
}

function render() {
  view = observe(state);
  const deck = view.scene === 'deck';
  const activeCombat = !deck && !state.finalOpen && !view.result;
  const station = STATIONS.find(x => x.id === state.station);
  $('scene').textContent = deck ? 'Command deck' : state.fleet ? 'Fleet tactical display' : 'Remote sensor feed';
  const b = view.battle;
  const tracks = b ? [...b.contacts, b.secondary, b.terminalTrack].filter(Boolean) : [];
  const description = deck ? 'Walkable top-down command deck. Position ' + view.location.join(', ') :
    'Remote optical feed. Own lane ' + b.playerX + '. ' +
    tracks.map(track => track.id + ', lane ' + track.x + ', row ' + track.y).join('. ') +
    (b.wings.length ? '. Allies: ' + b.wings.map(wing => wing.label + ', ' + wing.ships + ' ships, lane ' + wing.x).join('. ') : '') +
    (b.incoming.length ? '. Incoming: ' + b.incoming.map(shot => 'lane ' + shot.x + ', row ' + shot.y).join('. ') : '');
  canvas.setAttribute('aria-label', description);
  const mode = view.console ? ' · MODE ' + view.console.mode + (view.console.snapshot ? ' ' + view.console.snapshot : '') : '';
  $('viewMeta').textContent = (deck ? 'DECK 02' : 'MERIDIAN / OPTICAL ARRAY') + mode;
  $('ordersTitle').textContent = view.result ? 'Orders closed' : deck ? 'Deck stations' : activeCombat ? 'Fire control' : 'Final authorization';
  $('loc').textContent = deck ? (station?.label ?? 'Main corridor') : view.sectorName;
  $('actions').replaceChildren(...(activeCombat ? view.actions.filter(a => ['scan', 'refuse_mission'].includes(a.id)) : view.actions).map(button));
  const fleetCombat = activeCombat && state.fleet;
  const wings = fleetCombat ? b.wings.filter(wing => wing.ships) : [];
  if (wings.length && !wings.some(wing => wing.id === selectedWing)) selectedWing = wings[0].id;
  $('wingControls').hidden = !fleetCombat;
  $('wingControls').replaceChildren(...wings.map(wing => {
    const selector = document.createElement('button');
    selector.textContent = wing.label + ' · ' + wing.ships + ' ships · ' + (wing.target ?? wing.order);
    selector.setAttribute('aria-pressed', String(wing.id === selectedWing));
    selector.style.setProperty('--wing-color', wingColor(wing.id));
    selector.addEventListener('click', () => { selectedWing = wing.id; render(); });
    return selector;
  }));
  $('battleControls').hidden = !activeCombat;
  $('battleControls').replaceChildren(...(activeCombat ? view.actions.filter(a => !['scan', 'refuse_mission'].includes(a.id) && (!a.wing || a.wing === selectedWing)) : []).map(button));
  $('controlsHint').textContent = view.result ? 'Replay available below.' : deck
    ? 'Click a station or walk with WASD or arrows. Press E to interact.'
    : fleetCombat ? 'Select a squadron. Click a contact to engage or an empty friendly-grid tile to plot a route. Use Move for a one-tile order.'
    : activeCombat ? 'Fire hits the nearest track in your lane. ← → Move · Space Fire · Q / E Move + fire · X Brace' : 'The escort is holding position. Select an order or return to the deck.';
  $('hull').textContent = view.hull + '/5';
  $('escort').textContent = view.escort + '/5';
  $('scoreField').hidden = view.score === null;
  if (view.score !== null) $('score').textContent = String(view.score).padStart(3, '0');
  $('scopeStatus').textContent = activeCombat ? view.battle.contacts.length + ' tracks · ' + view.battle.remaining + ' turns left' : '';
  $('feedCount').textContent = view.feed.length + ' entries';
  $('levelProgress').textContent = (view.console ? 'Sector ' : 'Level ') + view.sector + ' of ' + state.waveCount + ' · ' + view.sectorName;
  const outcome = $('outcome');
  outcome.hidden = !view.result;
  if (view.result) {
    const h = document.createElement('h2');
    h.textContent = view.result.outcome;
    const p = document.createElement('p');
    p.textContent = view.result.portCrewLosses + ' active casualties · ' + view.result.apparentCrewLosses +
      ' apparent casualties' + (view.result.populationExtinct ? ' · Population lost' : '');
    outcome.replaceChildren(h, p);
  }
  appendFeed();
  draw(performance.now());
}

const keyMoves = new Map([
  ['arrowup','walk_north'],['w','walk_north'],['arrowdown','walk_south'],['s','walk_south'],
  ['arrowleft','walk_west'],['a','walk_west'],['arrowright','walk_east'],['d','walk_east'],
]);
window.addEventListener('keydown', event => {
  if (!state || state.result || event.ctrlKey || event.metaKey || event.altKey ||
      event.target instanceof HTMLSelectElement || (event.key === ' ' && event.target instanceof HTMLButtonElement)) return;
  const key = event.key.toLowerCase();
  let action;
  if (state.scene === 'deck') action = key === 'e' || key === 'enter' ? 'interact' : keyMoves.get(key);
  else if (!state.finalOpen && key === 'r') action = 'scan';
  if (!action) return;
  event.preventDefault();
  if (pressed.has(key) && !event.repeat) return;
  pressed.add(key);
  if (view.actions.some(a => a.id === action) || walkActions(state).includes(action)) issue(action);
});
window.addEventListener('keyup', event => pressed.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => pressed.clear());
canvas.addEventListener('click', event => {
  if (state.result) return;
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) * CW / bounds.width;
  const y = (event.clientY - bounds.top) * CH / bounds.height;
  if (state.scene !== 'deck') {
    if (!state.fleet || state.finalOpen) return;
    const ally = view.battle.wings.find((wing, i) => wing.ships && Math.abs(px(wing.x) - x) < 20 &&
      Math.abs(py(wing.y) + (i ? 9 : -10) - y) < 9);
    if (ally) { selectedWing = ally.id; render(); return; }
    const track = [...view.battle.contacts, view.battle.secondary].filter(Boolean)
      .find(t => Math.abs(px(t.x) - x) < 13 && Math.abs(py(t.y) - y) < 13);
    const order = track && 'order_' + selectedWing + '_engage_' + track.id;
    if (view.actions.some(action => action.id === order)) issue(order);
    else if (!track) {
      const lane = Math.round((x - SX) * (W - 1) / SW);
      const row = Math.round((y - SY) * H / SH);
      const route = fleetWaypointAction(state, selectedWing, lane, row);
      if (route) issue(route);
    }
    return;
  }
  const target = STATIONS.find(station => {
    const [sx, sy] = tileCenter(station.x, station.y);
    return Math.abs(sx - x) < 59 && (Math.abs(sy - y) < 41 || Math.abs(labelY(station) - y) < 17);
  });
  if (target) issue(target.id === state.station ? 'interact' : 'go_' + target.id);
});
$('restart').addEventListener('click', start);
$('mode').addEventListener('change', start);
$('campaign').addEventListener('change', start);
$('stimulus').addEventListener('change', start);
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(replay(state), null, 2)], { type:'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'enders-bench-replay.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
start();

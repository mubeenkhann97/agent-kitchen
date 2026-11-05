'use strict';
(function () {
  const S = window.KitchenSprites;
  const T = S.T;
  const W = 30;
  const H = 18;
  const DIV = 20; // wall between kitchen and dining room
  const NW = W * T;
  const NH = H * T;
  const STATION_INFO = {
    pantry: ['\u{1F4D6}', 'Recipe shelf'], board: ['\u{1F52A}', 'Cutting board'], stove: ['\u{1F525}', 'Stove'],
    market: ['\u{1F6D2}', 'Market'], rail: ['\u{1F4CB}', 'Ticket rail'], pass: ['\u{1F6CE}\uFE0F', 'The pass'], prep: ['\u{1F963}', 'Prep counter'],
  };
  const FACE_DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  // ---------------------------------------------------------------- map
  const grid = [];
  const solid = [];
  for (let y = 0; y < H; y++) {
    grid.push([]);
    solid.push([]);
    for (let x = 0; x < W; x++) {
      const wall = y <= 1 || y === H - 1 || x === 0 || x === W - 1 || x === DIV;
      grid[y].push({ type: wall ? 'wall' : (x < DIV ? 'floor' : 'dfloor') });
      solid[y].push(wall);
    }
  }
  function put(x, y, type, v, blocking = true) { grid[y][x] = { type, v }; solid[y][x] = blocking; }
  for (let x = 2; x <= 6; x++) put(x, 2, 'shelf');
  for (let x = 8; x <= 9; x++) put(x, 2, 'rail');
  for (let x = 11; x <= 18; x++) put(x, 2, 'stove');
  const BOARD_X = [5, 8, 11, 14];
  for (let x = 4; x <= 15; x++) {
    put(x, 6, BOARD_X.includes(x) ? 'board' : 'island', 'top');
    put(x, 7, BOARD_X.includes(x) ? 'board' : 'island', 'bottom');
    put(x, 11, 'prep', 'top');
    put(x, 12, 'prep', 'bottom');
  }
  for (let y = 4; y <= 11; y++) put(DIV, y, 'pass');
  for (let y = 13; y <= 15; y++) put(DIV, y, 'floor', null, false);
  put(0, 4, 'backdoor', null, false);
  put(0, 5, 'backdoor', null, false);
  put(1, 8, 'crates');
  put(1, 9, 'crates');
  put(0, 14, 'staffdoor', null, false);
  put(0, 15, 'staffdoor', null, false);
  put(24, H - 1, 'frontdoor', null, false);
  put(25, H - 1, 'frontdoor', null, false);
  const TABLES = [[22, 3], [26, 3], [22, 7], [26, 7], [22, 11], [26, 11]];
  for (const [tx, ty] of TABLES) {
    put(tx, ty, 'table', 'tl'); put(tx + 1, ty, 'table', 'tr');
    put(tx, ty + 1, 'table', 'bl'); put(tx + 1, ty + 1, 'table', 'br');
  }
  for (let x = 26; x <= 28; x++) put(x, 15, 'bench');
  put(28, 2, 'plant', 'dfloor');
  put(21, 16, 'plant', 'dfloor');
  put(1, 16, 'plant', 'floor');
  put(19, 16, 'plant', 'floor');

  const STAFF_DOOR = { x: 0, y: 14 };
  const FRONT_DOOR = { x: 24, y: H - 1 };
  const BOSS_HOME = { x: 19, y: 8, face: 'right' };

  const slot = (x, y, face) => ({ x, y, face, owner: null });
  const SLOTS = {
    pantry: [3, 5].map((x) => slot(x, 3, 'up')),
    rail: [8, 9].map((x) => slot(x, 3, 'up')),
    stove: [11, 13, 15, 17].map((x) => slot(x, 3, 'up')),
    board: [...BOARD_X.map((x) => slot(x, 5, 'down')), ...BOARD_X.map((x) => slot(x, 8, 'up'))],
    market: [slot(1, 4, 'left'), slot(1, 5, 'left'), slot(2, 4, 'left'), slot(2, 5, 'left')],
    pass: [4, 6, 10].map((y) => slot(19, y, 'right')),
  };
  // Seat order spreads the first chefs apart so their name tags do not overlap.
  const HOMES = [[4, 'T'], [7, 'B'], [10, 'T'], [13, 'B'], [14, 'T'], [5, 'B'], [6, 'T'], [11, 'B'], [12, 'T'], [15, 'B'], [8, 'T'], [9, 'B']]
    .map(([x, row]) => (row === 'T' ? { x, y: 10, face: 'down' } : { x, y: 13, face: 'up' }));
  const WAITER_PASS = [];
  for (let y = 4; y <= 11; y++) WAITER_PASS.push({ x: DIV + 1, y, face: 'left' });
  // Each seat owns half a table: seats 0-5 the left half, 6-11 the right half.
  function tableFor(seat) {
    if (seat === null || seat === undefined || seat < 0) return null;
    const index = seat % TABLES.length;
    const [tx, ty] = TABLES[index];
    const right = seat >= TABLES.length;
    return {
      index, right, tx, ty,
      spot: right ? { x: tx + 2, y: ty + 1, face: 'left' } : { x: tx - 1, y: ty + 1, face: 'right' },
      px: tx * T + (right ? 17 : 3),
      py: ty * T + 3,
    };
  }
  const PLATE_OFFSETS = [[1, 2], [1, 10], [3, 17]];
  const STATION_LABELS = [['PANTRY', 4.5, 1.25], ['TICKETS', 9, 1.25], ['STOVE', 15, 1.25], ['MARKET', 1.7, 3.4], ['CUTTING BOARDS', 10, 9.45], ['PREP / HOME', 10, 14.7], ['PASS', DIV + 0.5, 3.45], ['DINING ROOM', 24.5, 1.25], ['WAITING', 27.5, 16.6]];

  const walkable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !solid[y][x];

  function astar(from, to) {
    if (!walkable(to.x, to.y)) return null;
    const key = (x, y) => y * W + x;
    const g = new Map([[key(from.x, from.y), 0]]);
    const came = new Map();
    const open = [{ x: from.x, y: from.y, f: 0 }];
    const closed = new Set();
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      const ck = key(cur.x, cur.y);
      if (cur.x === to.x && cur.y === to.y) {
        const path = [{ x: cur.x, y: cur.y }];
        let k = ck;
        while (came.has(k)) { k = came.get(k); path.unshift({ x: k % W, y: Math.floor(k / W) }); }
        return path;
      }
      if (closed.has(ck)) continue;
      closed.add(ck);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!walkable(nx, ny)) continue;
        const nk = key(nx, ny);
        const ng = g.get(ck) + 1;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          came.set(nk, ck);
          open.push({ x: nx, y: ny, f: ng + Math.abs(nx - to.x) + Math.abs(ny - to.y) });
        }
      }
    }
    return null;
  }

  function nearestWalkable(x, y) {
    if (walkable(x, y)) return { x, y };
    for (let r = 1; r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dy) === r && walkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return { x: STAFF_DOOR.x, y: STAFF_DOOR.y };
  }

  // ---------------------------------------------------------------- actors
  const center = (tx, ty) => ({ x: tx * T + 8, y: ty * T + 13 });

  class Actor {
    constructor(kind, tx, ty, opts = {}) {
      const c = center(tx, ty);
      this.kind = kind;
      this.x = c.x;
      this.y = c.y;
      this.dir = opts.face || 'down';
      this.face = this.dir;
      this.pose = 'idle';
      this.work = null;
      this.path = [];
      this.goal = { x: tx, y: ty };
      this.speed = opts.speed || 46;
      this.band = opts.band || null;
      this.carry = null;
      this.onArrive = null;
      this.phase = Math.random() * 10;
    }
    tile() { return { x: Math.floor(this.x / T), y: Math.floor((this.y - 1) / T) }; }
    arrived() { return this.path.length === 0; }
    goTo(tx, ty, face, onArrive, work) {
      const from = nearestWalkable(this.tile().x, this.tile().y);
      const route = astar(from, { x: tx, y: ty }) || [{ x: tx, y: ty }];
      this.path = route.map((p) => center(p.x, p.y));
      this.goal = { x: tx, y: ty };
      this.face = face || 'down';
      this.onArrive = onArrive || null;
      this.work = work || null;
    }
    update(dt) {
      if (!this.path.length) return;
      let budget = this.speed * dt;
      while (budget > 0 && this.path.length) {
        const p = this.path[0];
        const dx = p.x - this.x;
        const dy = p.y - this.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (d <= budget) {
          this.x = p.x;
          this.y = p.y;
          budget -= d;
          this.path.shift();
        } else {
          this.x += (dx / d) * budget;
          this.y += (dy / d) * budget;
          budget = 0;
        }
      }
      if (!this.path.length) {
        this.dir = this.face;
        const cb = this.onArrive;
        this.onArrive = null;
        if (cb) cb(this);
      }
    }
    currentPose() {
      if (this.path.length) return 'walk';
      return this.work ? 'work' : 'idle';
    }
  }

  // ---------------------------------------------------------------- state
  const chefs = new Map(); // id -> { data, actor, slot, home, leaving, passUntil, platePending, bubble, sous: Map }
  const waiters = [];
  const plates = []; // plates waiting on the pass: { x, y, until, taken }
  const boss = new Actor('boss', BOSS_HOME.x, BOSS_HOME.y, { face: BOSS_HOME.face, speed: 52 });
  let bossTarget = null;
  let stats = null;
  let serverOffset = 0;
  let selectedId = null;
  let firstSnapshot = true;
  let time = 0;

  const now = () => Date.now() + serverOffset;
  const bandOf = (src) => S.SOURCE_COLORS[src] || '#888';

  function releaseSlot(rec) {
    if (rec.slot) rec.slot.owner = null;
    rec.slot = null;
  }

  function acquireSlot(rec, station) {
    if (rec.slot && rec.slot.station === station) return rec.slot;
    releaseSlot(rec);
    const list = SLOTS[station];
    if (!list) return null;
    const here = rec.actor.tile();
    let best = null;
    for (const s of list) {
      if (s.owner) continue;
      const d = Math.abs(s.x - here.x) + Math.abs(s.y - here.y);
      if (!best || d < best.d) best = { s, d };
    }
    if (!best) return null;
    best.s.owner = rec.data.id;
    best.s.station = station;
    rec.slot = best.s;
    return best.s;
  }

  // Where should this chef be right now?
  function desiredSpot(rec) {
    const d = rec.data;
    const home = HOMES[d.seat];
    if (!home) return null;
    if (d.status === 'attention' && rec.actor.goal && rec.spot) return rec.spot;
    if (rec.passUntil > performance.now()) {
      const s = acquireSlot(rec, 'pass');
      if (s) return { x: s.x, y: s.y, face: s.face, work: 'pass', key: `pass${s.x},${s.y}` };
    }
    const idle = !d.ticket && d.status === 'idle';
    if (idle || !d.station || d.station === 'prep' || d.station === 'pass') {
      releaseSlot(rec);
      return { x: home.x, y: home.y, face: home.face, work: idle ? null : 'prep', key: `home${d.seat}${idle ? 'i' : 'w'}` };
    }
    const s = acquireSlot(rec, d.station);
    if (s) return { x: s.x, y: s.y, face: s.face, work: d.station, key: `${d.station}${s.x},${s.y}` };
    return { x: home.x, y: home.y, face: home.face, work: 'prep', key: `home${d.seat}w` };
  }

  const isSeated = (d) => d.seat !== null && d.seat !== undefined;
  const newestPlate = (d) => Math.max(0, ...(d.plates || []).map((p) => p.ts));
  const visiblePlates = (rec) => (rec.data.plates || []).filter((p) => p.ts <= rec.deliveredTs);

  function upsertChef(data) {
    let rec = chefs.get(data.id);
    if (!rec) {
      // Plates served before this chef appeared are already on the table.
      rec = { data, actor: null, slot: null, sous: new Map(), spot: null, passUntil: 0, leaving: false, forget: false, deliveredTs: newestPlate(data) };
      chefs.set(data.id, rec);
    }
    rec.data = data;
    if (isSeated(data) && (!rec.actor || rec.leaving)) {
      if (!rec.actor) {
        // Chefs present at page load start at their seat; later arrivals walk in through the staff door.
        const start = firstSnapshot ? HOMES[data.seat] : STAFF_DOOR;
        rec.actor = new Actor('chef', start.x, start.y, { band: bandOf(data.source), face: 'right' });
        rec.actor.styleId = data.id;
      }
      rec.leaving = false;
      rec.forget = false;
      rec.spot = null;
    }
    if (!isSeated(data) && rec.actor && !rec.leaving) sendHome(rec, false);
    syncSous(rec);
  }

  // Walk a chef out through the staff door; optionally forget it afterwards.
  function sendHome(rec, forget) {
    releaseSlot(rec);
    rec.leaving = true;
    rec.actor.work = null;
    rec.forget = forget;
    rec.actor.goTo(STAFF_DOOR.x, STAFF_DOOR.y, 'left', () => {
      rec.actor = null;
      rec.leaving = false;
    });
    for (const [id, s] of rec.sous) {
      s.leaving = true;
      s.actor.work = null;
      s.actor.goTo(STAFF_DOOR.x, STAFF_DOOR.y, 'left', () => rec.sous.delete(id));
    }
  }

  function removeChef(id) {
    const rec = chefs.get(id);
    if (!rec) return;
    if (selectedId === id) selectedId = null;
    rec.data = { ...rec.data, ticket: null, status: 'idle' };
    if (rec.actor && !rec.leaving) sendHome(rec, true);
    else if (!rec.actor && !rec.sous.size) chefs.delete(id);
    else rec.forget = true;
  }

  function syncSous(rec) {
    const want = new Map((rec.data.sous || []).map((s) => [s.id, s]));
    for (const [id, s] of rec.sous) {
      if (!want.has(id) && !s.leaving) {
        s.leaving = true;
        s.actor.work = null;
        s.actor.goTo(STAFF_DOOR.x, STAFF_DOOR.y, 'left', () => rec.sous.delete(id));
      }
    }
    if (!rec.actor) return;
    for (const [id, sd] of want) {
      let s = rec.sous.get(id);
      if (!s) {
        if (rec.sous.size >= 4) continue;
        s = { data: sd, actor: new Actor('sous', STAFF_DOOR.x, STAFF_DOOR.y, { band: bandOf(rec.data.source), speed: 52 }), leaving: false, key: null };
        s.actor.styleId = id;
        rec.sous.set(id, s);
      }
      s.data = sd;
    }
  }

  function sousSpot(rec, index) {
    const g = rec.spot || { x: rec.actor.goal.x, y: rec.actor.goal.y, face: 'down' };
    const offsets = [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1], [0, -1]];
    let n = 0;
    for (const [dx, dy] of offsets) {
      const x = g.x + dx;
      const y = g.y + dy;
      if (!walkable(x, y)) continue;
      if (n === index) return { x, y, face: g.face || 'down' };
      n++;
    }
    return { x: g.x, y: g.y, face: 'down' };
  }

  // ---------------------------------------------------------------- waiters, plates, boss
  function spawnWaiter(job) {
    if (waiters.length >= 8) return false;
    const w = new Actor('waiter', FRONT_DOOR.x, FRONT_DOOR.y, { face: 'up', speed: 64 });
    w.job = job;
    waiters.push(w);
    const leave = () => w.goTo(FRONT_DOOR.x, FRONT_DOOR.y, 'down', () => { w.done = true; });
    if (job.type === 'ticket') {
      w.carry = 'ticket';
      const rec = chefs.get(job.chefId);
      const target = rec && rec.actor ? rec.actor.goal : HOMES[0];
      const spot = nearestWalkableAround(target.x, target.y);
      w.goTo(spot.x, spot.y, faceToward(spot, target), () => {
        w.carry = null;
        w.bubble = { text: 'Order in!', until: performance.now() + 1200 };
        setTimeout(leave, 700);
      });
    } else if (job.type === 'plate') {
      const plate = job.plate;
      const ty = Math.floor(plate.y / T);
      const spot = WAITER_PASS.reduce((a, b) => (Math.abs(b.y - ty) < Math.abs(a.y - ty) ? b : a));
      w.goTo(spot.x, spot.y, 'left', () => {
        setTimeout(() => {
          plate.taken = true;
          w.carry = 'plate';
          const rec = chefs.get(job.chefId);
          const table = rec && tableFor(rec.data.seat);
          const deliver = () => {
            w.carry = null;
            if (rec) rec.deliveredTs = newestPlate(rec.data);
          };
          if (!table) { deliver(); leave(); return; }
          w.goTo(table.spot.x, table.spot.y, table.spot.face, () => {
            deliver();
            setTimeout(leave, 500);
          });
        }, 400);
      });
    }
    return true;
  }

  function nearestWalkableAround(x, y) {
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      if (walkable(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return nearestWalkable(x, y);
  }

  function faceToward(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  function updateBoss() {
    let target = null;
    let oldest = Infinity;
    for (const rec of chefs.values()) {
      if (rec.actor && !rec.leaving && rec.data.status === 'attention' && rec.data.lastActivity < oldest) {
        oldest = rec.data.lastActivity;
        target = rec;
      }
    }
    const key = target ? `${target.data.id}:${target.actor.goal.x},${target.actor.goal.y}` : 'home';
    if (key === bossTarget) return;
    bossTarget = key;
    if (target) {
      const g = target.actor.goal;
      const spot = nearestWalkableAround(g.x, g.y);
      boss.goTo(spot.x, spot.y, faceToward(spot, g));
    } else {
      boss.goTo(BOSS_HOME.x, BOSS_HOME.y, BOSS_HOME.face);
    }
  }

  // ---------------------------------------------------------------- sound
  let audio = null;
  let muted = window.KitchenHost.load('agentKitchenMuted') === '1';
  const muteBtn = document.getElementById('mute');
  function renderMute() {
    muteBtn.textContent = muted ? 'Sound: muted' : 'Sound: on';
    muteBtn.setAttribute('aria-pressed', String(muted));
  }
  renderMute();
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    window.KitchenHost.save('agentKitchenMuted', muted ? '1' : '0');
    renderMute();
  });
  function unlockAudio() {
    if (!audio) {
      try { audio = new AudioContext(); } catch { audio = null; }
    }
    if (audio && audio.state === 'suspended') audio.resume();
  }
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
  function tone(freq, start, dur, type, gain) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, audio.currentTime + start);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + dur);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + start);
    o.stop(audio.currentTime + start + dur + 0.05);
  }
  function play(kind) {
    if (muted) return;
    unlockAudio();
    if (!audio || audio.state !== 'running') return;
    if (kind === 'order_up') { tone(1568, 0, 0.6, 'sine', 0.25); tone(2093, 0.12, 0.8, 'sine', 0.2); }
    if (kind === 'attention') { tone(660, 0, 0.15, 'square', 0.08); tone(440, 0.18, 0.25, 'square', 0.08); }
  }

  // ---------------------------------------------------------------- server stream
  function applySnapshot(snap) {
    serverOffset = snap.now - Date.now();
    document.getElementById('demoBadge').classList.toggle('on', !!snap.demo);
    const ids = new Set(snap.chefs.map((c) => c.id));
    for (const id of [...chefs.keys()]) if (!ids.has(id)) removeChef(id);
    for (const c of snap.chefs) upsertChef(c);
    firstSnapshot = false;
    stats = snap.stats;
    renderPanel();
    renderTickets();
  }

  function applyDeltas(list) {
    for (const d of list) {
      if (d.type === 'chef') upsertChef(d.chef);
      else if (d.type === 'remove') removeChef(d.id);
      else if (d.type === 'stats') stats = d.stats;
      else if (d.type === 'fx') onFx(d);
    }
    renderPanel();
    renderTickets();
  }

  function onFx(fx) {
    const rec = chefs.get(fx.chefId);
    if (fx.fx === 'order') {
      if (rec && rec.actor) spawnWaiter({ type: 'ticket', chefId: fx.chefId });
    } else if (fx.fx === 'order_up') {
      play('order_up');
      if (rec && rec.actor) {
        rec.passUntil = performance.now() + 6000;
        rec.platePending = true;
        rec.bubble = { text: 'Order up!', until: performance.now() + 3500 };
      } else if (rec) {
        rec.deliveredTs = newestPlate(rec.data);
      }
    } else if (fx.fx === 'attention') {
      play('attention');
    }
  }

  const connDot = document.getElementById('conn');
  const connText = document.getElementById('connText');
  function setConn(on) {
    connDot.classList.toggle('on', on);
    connDot.title = on ? 'Connected' : 'Disconnected';
    connText.textContent = on ? 'live' : 'reconnecting...';
  }
  window.KitchenHost.connect({ onSnapshot: applySnapshot, onDelta: applyDeltas, onStatus: setConn });

  // ---------------------------------------------------------------- DOM: tickets and clipboard
  const railEl = document.getElementById('rail');
  const ticketEls = new Map();
  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  }
  function renderTickets() {
    const open = [...chefs.values()].filter((r) => r.data.ticket).sort((a, b) => a.data.ticket.since - b.data.ticket.since);
    const keep = new Set(open.map((r) => r.data.id));
    for (const [id, el] of ticketEls) if (!keep.has(id)) { el.remove(); ticketEls.delete(id); }
    let empty = railEl.querySelector('.empty');
    if (!open.length && !empty) {
      empty = document.createElement('span');
      empty.className = 'empty';
      empty.textContent = 'No open orders. The kitchen is quiet.';
      railEl.appendChild(empty);
    } else if (open.length && empty) {
      empty.remove();
    }
    const t = now();
    open.forEach((rec, i) => {
      const d = rec.data;
      let el = ticketEls.get(d.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'ticket';
        el.innerHTML = '<div class="top"><span class="src"></span><span class="repo"></span><span class="time"></span></div><div class="text"></div>';
        el.addEventListener('click', () => { selectedId = d.id; });
        ticketEls.set(d.id, el);
      }
      // Moving an element restarts its CSS animation, so only move tickets that are out of order.
      const at = railEl.children[i];
      if (at !== el) railEl.insertBefore(el, at || null);
      const age = t - d.ticket.since;
      el.classList.toggle('amber', age >= 120000 && age < 300000);
      el.classList.toggle('red', age >= 300000);
      el.querySelector('.src').className = `src ${d.source}`;
      el.querySelector('.src').title = d.source === 'claude' ? 'Claude Code' : 'GitHub Copilot';
      el.querySelector('.repo').textContent = d.repo + (d.seat === null ? ' (waiting)' : '');
      el.querySelector('.time').textContent = fmtElapsed(age);
      el.querySelector('.text').textContent = (d.ticket.text || d.title || 'order in progress').slice(0, 80);
      el.title = d.title || '';
    });
  }
  setInterval(renderTickets, 1000);

  function renderPanel() {
    if (!stats) return;
    document.getElementById('sActive').textContent = stats.active;
    document.getElementById('sWaiting').textContent = stats.waiting;
    document.getElementById('sServed').textContent = stats.servedToday;
    const st = { ...stats.stations, pass: stats.servedToday };
    const max = Math.max(1, ...Object.values(st));
    const box = document.getElementById('stations');
    box.textContent = '';
    for (const key of ['pantry', 'board', 'stove', 'market', 'rail', 'pass', 'prep']) {
      const row = document.createElement('div');
      row.className = 'bar';
      const icon = document.createElement('span');
      icon.textContent = STATION_INFO[key][0];
      const name = document.createElement('span');
      name.textContent = STATION_INFO[key][1];
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = `${Math.round(((st[key] || 0) / max) * 100)}%`;
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = st[key] || 0;
      row.append(icon, name, fill, n);
      box.appendChild(row);
    }
    document.getElementById('busiest').textContent = stats.busiest ? `${stats.busiest.repo} (${stats.busiest.tools} tools)` : '-';
    const wl = document.getElementById('waitingList');
    wl.textContent = '';
    for (const rec of chefs.values()) {
      if (rec.forget || isSeated(rec.data)) continue;
      const li = document.createElement('li');
      li.textContent = `${rec.data.repo}${rec.data.automated ? ' (line cook)' : ''}`;
      wl.appendChild(li);
    }
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    const pnow = performance.now();
    for (const rec of chefs.values()) {
      if (rec.actor && !rec.leaving) {
        const spot = desiredSpot(rec);
        if (spot && spot.key !== (rec.spot && rec.spot.key)) {
          rec.spot = spot;
          rec.actor.goTo(spot.x, spot.y, spot.face, () => onChefArrive(rec), spot.work);
        } else if (spot) {
          rec.actor.work = spot.work;
        }
      }
      if (rec.actor) rec.actor.update(dt);
      let i = 0;
      for (const s of rec.sous.values()) {
        if (!s.leaving && rec.actor && !rec.leaving) {
          const ss = sousSpot(rec, i++);
          const key = `${ss.x},${ss.y}`;
          if (key !== s.key) {
            s.key = key;
            s.actor.goTo(ss.x, ss.y, ss.face, null, s.data.station || 'prep');
          }
          s.actor.work = s.data.station || 'prep';
        }
        s.actor.update(dt);
      }
    }
    for (const rec of chefs.values()) if (rec.forget && !rec.actor && !rec.sous.size) chefs.delete(rec.data.id);
    updateBoss();
    boss.update(dt);
    for (const w of waiters) w.update(dt);
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].done) waiters.splice(i, 1);
    for (let i = plates.length - 1; i >= 0; i--) if (plates[i].taken || plates[i].until < pnow) plates.splice(i, 1);
  }

  function onChefArrive(rec) {
    if (rec.platePending && rec.spot && rec.spot.work === 'pass') {
      rec.platePending = false;
      const plate = { x: DIV * T + 4, y: rec.spot.y * T + 4, until: performance.now() + 30000 };
      plates.push(plate);
      if (!spawnWaiter({ type: 'plate', plate, chefId: rec.data.id })) {
        plate.taken = true;
        rec.deliveredTs = newestPlate(rec.data);
      }
    }
  }

  // ---------------------------------------------------------------- render
  const Settings = window.KitchenSettings || {
    // Fallback when settings.js failed to load (e.g. an older server still running).
    get: () => ({ table: {}, plant: {}, display: { size: 'large', clipboard: 'show' } }),
    chefStyle: () => null,
    onChange: () => {},
  };
  const SIZES = { normal: 1, large: 1.5, xl: 2 };
  const SS = 2; // world canvas supersampling, so 1.5x sprites still land on whole pixels
  let cs = SIZES[Settings.get().display.size] || 1.5;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const world = document.createElement('canvas');
  world.width = NW * SS;
  world.height = NH * SS;
  const wctx = world.getContext('2d');
  const bg = document.createElement('canvas');
  bg.width = NW;
  bg.height = NH;
  let scale = 1;
  let dpr = 1;
  const half = (v) => Math.round(v * SS) / SS;

  function buildBackground() {
    const b = bg.getContext('2d');
    const st = Settings.get();
    const deco = { table: st.table, plant: { type: st.plant.type, pot: st.plant.pot } };
    // Floor first so tall tiles can overlap the row above.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) S.drawTile(b, x < DIV ? 'floor' : 'dfloor', x, y);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = grid[y][x];
        if (c.type !== 'floor' && c.type !== 'dfloor') S.drawTile(b, c.type, x, y, c.v, deco);
      }
    }
    // Market awning outside the back door.
    S.rect(b, 0, 4 * T - 4, 6, 4, '#2e86c1');
    S.rect(b, 0, 4 * T - 4, 3, 4, '#f4f4f4');
  }

  function applyDisplay() {
    const st = Settings.get();
    cs = SIZES[st.display.size] || 1.5;
    document.body.classList.toggle('no-clipboard', st.display.clipboard === 'hide');
  }

  Settings.onChange(() => {
    applyDisplay();
    buildBackground();
  });

  function resize() {
    const stage = document.getElementById('stage');
    const s = Math.min(stage.clientWidth / NW, stage.clientHeight / NH);
    dpr = window.devicePixelRatio || 1;
    scale = Math.max(0.5, s);
    canvas.style.width = `${Math.floor(NW * scale)}px`;
    canvas.style.height = `${Math.floor(NH * scale)}px`;
    canvas.width = Math.round(NW * scale * dpr);
    canvas.height = Math.round(NH * scale * dpr);
  }
  new ResizeObserver(resize).observe(document.getElementById('stage'));

  function drawScaled(img, x, y, s) {
    wctx.drawImage(img, half(x), half(y), img.width * s, img.height * s);
  }

  function drawActor(a, frameT) {
    const pose = a.currentPose();
    let frame = 0;
    if (pose === 'walk') frame = Math.floor((frameT + a.phase) * 8) % 4;
    else if (pose === 'work') frame = Math.floor((frameT + a.phase) * 5) % 2;
    else frame = Math.floor((frameT + a.phase) * 1.5) % 2;
    const style = a.styleId ? Settings.chefStyle(a.styleId) : null;
    const img = S.character(a.kind, a.dir, pose, frame, a.band, style);
    const w = img.width * cs;
    const h = img.height * cs;
    const x = a.x - w / 2;
    const y = a.y - h + 2 * cs;
    wctx.fillStyle = 'rgba(0,0,0,0.18)';
    wctx.fillRect(half(a.x - 6 * cs), half(a.y), 12 * cs, 2);
    drawScaled(img, x, y, cs);
    if (a.carry === 'ticket') drawScaled(S.prop('ticket'), x + w - 6 * cs, y + 12 * cs, cs);
    if (a.carry === 'plate') drawScaled(S.prop('plate'), a.x - 5 * cs, y + 9 * cs, cs);
    if (pose === 'work' && a.work) drawWorkProp(a, frameT);
  }

  function drawWorkProp(a, frameT) {
    const [dx, dy] = FACE_DELTA[a.face] || [0, 0];
    const tx = Math.floor(a.x / T) + dx;
    const ty = Math.floor((a.y - 1) / T) + dy;
    const cx = tx * T;
    const cy = ty * T;
    const f = Math.floor((frameT + a.phase) * 6);
    const ps = Math.min(cs, 1.5);
    switch (a.work) {
      case 'board': {
        drawScaled(S.prop(f % 2 ? 'knifeDown' : 'knifeUp'), cx + 6, cy + (f % 2 ? 6 : 2), ps);
        S.rect(wctx, cx + 3, cy + 7, 2, 2, '#5fb34a');
        S.rect(wctx, cx + 2, cy + 5, 2, 2, '#f08a24');
        break;
      }
      case 'stove': {
        S.flame(wctx, cx + 4, cy + 10, f);
        S.flame(wctx, cx + 20, cy + 10, f + 1);
        drawScaled(S.prop('pot'), cx + 8 - 5 * ps, cy + 1, ps);
        S.rect(wctx, cx + 8 + (f % 3) - 1, cy - 4, 1, 6, '#9b6a35');
        if (f % 4 === 0) S.rect(wctx, cx + 6, cy - 7 - (f % 3), 2, 2, 'rgba(255,255,255,0.7)');
        break;
      }
      case 'pantry':
        drawScaled(S.prop(`book${f % 3}`), a.x + 3 * cs, a.y - 16 * cs, cs);
        break;
      case 'market':
        drawScaled(S.prop('crate'), a.x - 16 * cs, a.y - (12 + (f % 2)) * cs, cs);
        break;
      case 'rail':
        drawScaled(S.prop('ticket'), a.x + 2 * cs, a.y - (30 + (f % 2) * 2) * cs, cs);
        break;
      case 'prep': {
        drawScaled(S.prop('bowl'), cx + 8 - 5 * ps, cy + 3, ps);
        S.rect(wctx, cx + 7 + (f % 2) * 2, cy, 1, 5, '#c8ccd8');
        break;
      }
      default:
        break;
    }
  }

  function drawDynamicScenery(frameT) {
    // Tickets hanging on the in-game rail, one per open order.
    const open = [...chefs.values()].filter((r) => r.data.ticket).length;
    for (let i = 0; i < Math.min(open, 6); i++) {
      wctx.drawImage(S.prop('ticket'), 8 * T + 1 + i * 5, 2 * T - 8 + (i % 2));
    }
    // Heat lamps over the pass.
    const glow = 0.12 + Math.sin(frameT * 2) * 0.03;
    wctx.fillStyle = `rgba(255,170,60,${glow})`;
    wctx.fillRect(DIV * T - 4, 4 * T, T + 8, 8 * T);
    for (const p of plates) drawScaled(S.prop('plate'), p.x, p.y, Math.min(cs, 1.5));
    // Each seated chef's half table: a place card in the source colour plus its served plates.
    for (const rec of chefs.values()) {
      if (rec.forget || !isSeated(rec.data)) continue;
      const t = tableFor(rec.data.seat);
      S.rect(wctx, t.px + 3, t.py + 23, 6, 3, '#1b1b24');
      S.rect(wctx, t.px + 4, t.py + 24, 4, 1, bandOf(rec.data.source));
      const shown = visiblePlates(rec);
      for (let i = 0; i < shown.length; i++) wctx.drawImage(S.prop('plate'), t.px + PLATE_OFFSETS[i][0], t.py + PLATE_OFFSETS[i][1]);
    }
    // Chefs waiting to be seated sit on the bench.
    let n = 0;
    for (const rec of chefs.values()) {
      if (rec.forget || isSeated(rec.data)) continue;
      if (n < 3) {
        const img = S.character('sous', 'down', 'idle', 0, bandOf(rec.data.source), Settings.chefStyle(rec.data.id));
        wctx.drawImage(img, 26 * T + n * 16, 15 * T - 9);
      }
      n++;
    }
  }

  function drawOverlay(frameT) {
    const k = scale * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const fs = Math.max(5, 11.5 / k);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${fs * 0.85}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = 'rgba(30,32,45,0.55)';
    for (const [label, x, y] of STATION_LABELS) ctx.fillText(label, x * T, y * T);

    const actors = [];
    for (const rec of chefs.values()) if (rec.actor) actors.push(rec);
    for (const rec of actors) {
      const a = rec.actor;
      const d = rec.data;
      const top = a.y - 23 * cs;
      const repo = d.repo.length > 16 ? `${d.repo.slice(0, 15)}\u2026` : d.repo;
      const model = shortModel(d.model) + (d.automated ? ' \u00b7 line cook' : '');
      ctx.font = `bold ${fs}px ui-monospace, Consolas, monospace`;
      const w = Math.max(ctx.measureText(repo).width, ctx.measureText(model).width * 0.85) + fs;
      roundRect(ctx, a.x - w / 2, top - fs * 2.1, w, fs * 2.1, fs * 0.4, bandOf(d.source), 'rgba(0,0,0,0.85)');
      ctx.fillStyle = '#fff';
      ctx.fillText(repo, a.x, top - fs * 1.4);
      ctx.font = `${fs * 0.85}px ui-monospace, Consolas, monospace`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(model, a.x, top - fs * 0.5);

      if (d.status === 'attention' && !rec.leaving) {
        const pulse = 1 + Math.sin(frameT * 8) * 0.12;
        const r = fs * 1.1 * pulse;
        const bx = a.x + 8 * cs;
        const by = top - fs * 2.6;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = '#e5484d';
        ctx.fill();
        ctx.lineWidth = Math.max(0.6, 1.5 / k);
        ctx.strokeStyle = '#000';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${fs * 1.4}px ui-monospace, Consolas, monospace`;
        ctx.fillText('!', bx, by + fs * 0.05);
      }
      if (rec.bubble && rec.bubble.until > performance.now()) speech(rec.bubble.text, a.x, top - fs * 2.6, fs, true);
    }
    for (const w of waiters) {
      if (w.bubble && w.bubble.until > performance.now()) speech(w.bubble.text, w.x, w.y - 20 * cs, fs, false);
    }
    if (boss.arrived() && bossTarget !== 'home') speech('What do you need?', boss.x, boss.y - 25 * cs, fs, false);

    const waitingCount = [...chefs.values()].filter((r) => !r.forget && !isSeated(r.data)).length;
    if (waitingCount > 3) {
      ctx.font = `bold ${fs}px ui-monospace, Consolas, monospace`;
      ctx.fillStyle = '#fff';
      ctx.fillText(`+${waitingCount - 3}`, 28.8 * T, 15 * T + 4);
    }

    // Orders served per table since the kitchen opened; these add up to "Orders served today".
    ctx.font = `bold ${fs * 0.85}px ui-monospace, Consolas, monospace`;
    for (const rec of chefs.values()) {
      if (rec.forget || !isSeated(rec.data) || !rec.data.served) continue;
      const t = tableFor(rec.data.seat);
      const label = `\u00d7${rec.data.served}`;
      const bx = t.px + 7;
      const by = t.py + 32;
      const w = ctx.measureText(label).width + fs * 0.6;
      roundRect(ctx, bx - w / 2, by - fs * 0.55, w, fs * 1.1, fs * 0.3, bandOf(rec.data.source), 'rgba(0,0,0,0.85)');
      ctx.fillStyle = '#fff';
      ctx.fillText(label, bx, by);
    }

    if (hoveredTable) {
      const [tx, ty] = TABLES[hoveredTable.index];
      const rec = chefAtTable(hoveredTable.index, hoveredTable.right);
      const name = `Table ${hoveredTable.index + 1}${hoveredTable.right ? 'B' : 'A'}`;
      let lines;
      if (!rec) {
        lines = [`${name} \u00b7 free`, '\u2022 no chef seated here'];
      } else {
        const d = rec.data;
        const shown = visiblePlates(rec);
        lines = [
          `${name} \u00b7 ${d.repo} (${d.source === 'claude' ? 'Claude' : 'Copilot'})`,
          `${d.served || 0} served since the kitchen opened`,
          ...(shown.length ? shown.map((p) => `\u2022 ${p.text} (${ago(p.ts)})`) : ['\u2022 nothing on the table yet']),
        ];
      }
      infoBubble(lines, tx * T + 16, ty * T - 2, fs);
    }

    if (selectedId) {
      const rec = chefs.get(selectedId);
      if (rec && rec.actor) {
        const lines = (rec.data.actions || []).slice(-5).map((x) => `\u2022 ${x.text}`);
        if (!lines.length) lines.push('\u2022 waiting for an order');
        const title = `${rec.data.repo}${rec.data.title ? ` \u2014 ${rec.data.title}` : ''}`;
        infoBubble([title, ...lines], rec.actor.x, rec.actor.y - 23 * cs - fs * 2.4, fs);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function shortModel(m) {
    if (!m) return 'model ?';
    return String(m).replace(/^claude-/, '').replace(/^(.{16}).+$/, '$1\u2026');
  }

  function roundRect(c, x, y, w, h, r, fill, stroke) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.lineWidth = Math.max(0.5, 1 / (scale * dpr));
      c.strokeStyle = stroke;
      c.stroke();
    }
  }

  function speech(text, x, y, fs, big) {
    ctx.font = `bold ${fs * (big ? 1.2 : 1)}px ui-monospace, Consolas, monospace`;
    const w = ctx.measureText(text).width + fs * 1.2;
    const h = fs * (big ? 2 : 1.8);
    roundRect(ctx, x - w / 2, y - h, w, h, fs * 0.5, big ? '#fff3b0' : '#ffffff', '#000');
    ctx.fillStyle = '#1b1b24';
    ctx.fillText(text, x, y - h / 2);
  }

  function infoBubble(lines, x, y, fs) {
    ctx.font = `${fs}px ui-monospace, Consolas, monospace`;
    const clipped = lines.map((l) => (l.length > 60 ? `${l.slice(0, 59)}\u2026` : l));
    const w = Math.max(...clipped.map((l) => ctx.measureText(l).width)) + fs * 1.6;
    const lh = fs * 1.35;
    const h = lh * clipped.length + fs;
    const bx = Math.min(Math.max(4, x - w / 2), NW - w - 4);
    const by = Math.max(4, y - h);
    roundRect(ctx, bx, by, w, h, fs * 0.6, 'rgba(255,255,255,0.97)', '#000');
    ctx.textAlign = 'left';
    clipped.forEach((l, i) => {
      ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px ui-monospace, Consolas, monospace`;
      ctx.fillStyle = i === 0 ? '#000' : '#333';
      ctx.fillText(l, bx + fs * 0.8, by + fs * 0.5 + lh * (i + 0.5));
    });
    ctx.textAlign = 'center';
  }

  function render(frameT) {
    wctx.setTransform(SS, 0, 0, SS, 0, 0);
    wctx.imageSmoothingEnabled = false;
    wctx.drawImage(bg, 0, 0);
    drawDynamicScenery(frameT);
    const list = [boss, ...waiters];
    for (const rec of chefs.values()) {
      if (rec.actor) list.push(rec.actor);
      for (const s of rec.sous.values()) list.push(s.actor);
    }
    list.sort((a, b) => a.y - b.y);
    for (const a of list) drawActor(a, frameT);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(world, 0, 0, canvas.width, canvas.height);
    drawOverlay(frameT);
  }

  // ---------------------------------------------------------------- input
  let hoveredTable = null;

  function chefAtTable(index, right) {
    const seat = index + (right ? TABLES.length : 0);
    for (const rec of chefs.values()) if (!rec.forget && rec.data.seat === seat) return rec;
    return null;
  }

  function ago(ts) {
    const s = Math.max(0, Math.floor((now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }

  function worldPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * NW, y: ((e.clientY - r.top) / r.height) * NH };
  }

  function tableAt(x, y) {
    for (let i = 0; i < TABLES.length; i++) {
      const [tx, ty] = TABLES[i];
      if (x >= tx * T && x < tx * T + 2 * T && y >= ty * T && y < ty * T + 2 * T) return { index: i, right: x >= tx * T + T };
    }
    return null;
  }

  canvas.addEventListener('mousemove', (e) => {
    const p = worldPoint(e);
    hoveredTable = tableAt(p.x, p.y);
  });
  canvas.addEventListener('mouseleave', () => { hoveredTable = null; });

  canvas.addEventListener('click', (e) => {
    const { x, y } = worldPoint(e);
    const table = tableAt(x, y);
    if (table) {
      const rec = chefAtTable(table.index, table.right);
      selectedId = rec ? rec.data.id : null;
      return;
    }
    let hit = null;
    let best = Infinity;
    for (const rec of chefs.values()) {
      const a = rec.actor;
      if (!a || rec.leaving) continue;
      if (x >= a.x - 10 * cs && x <= a.x + 10 * cs && y >= a.y - 24 * cs && y <= a.y + 3) {
        const d = Math.abs(a.y - y);
        if (d < best) { best = d; hit = rec; }
      }
    }
    selectedId = hit && hit.data.id !== selectedId ? hit.data.id : null;
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') selectedId = null; });

  // ---------------------------------------------------------------- loop
  applyDisplay();
  buildBackground();
  resize();
  let last = performance.now();
  function loop(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    time += dt;
    update(dt);
    render(time);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();

'use strict';
// Procedural pixel art for Agent Kitchen. Every sprite is an inline string array or drawn with rects.
(function () {
  const OUTLINE = '#1b1b24';
  const PALETTE = {
    w: '#f6f6f2', g: '#c8ccd8', s: '#f2c29b', S: '#d39871', h: '#5a3a22', e: '#1b1b24', k: '#3a3d4f',
    p: '#2e3046', o: '#3b2a1e', v: '#262636', r: '#d0343a', Y: '#e8b923', c: '#9b6a35', C: '#fbf6e4',
    q: '#4a4a5a', B: '#ff00ff',
  };
  const SOURCE_COLORS = { claude: '#f08a24', copilot: '#8a5cf6' };

  // ---- customisable styles: [main, shade, detail] ----
  const COLORS = {
    white: ['#f6f6f2', '#c8ccd8', '#3a3d4f'], black: ['#30323e', '#1f2029', '#d8dce6'], navy: ['#2f4170', '#22305a', '#e8b923'],
    burgundy: ['#7c2836', '#5c1c28', '#f6f6f2'], sage: ['#93b08f', '#718f6d', '#f6f6f2'], denim: ['#5b80aa', '#45658c', '#f6f6f2'],
    mustard: ['#d9a93a', '#b3862a', '#3a3d4f'],
  };
  const SKINS = {
    porcelain: ['#f8dcc4', '#e0b598'], light: ['#f2c29b', '#d39871'], tan: ['#d9a066', '#b57d48'],
    brown: ['#a86b3c', '#875229'], deep: ['#6e4426', '#55331c'],
  };
  const HAIRS = { brown: '#5a3a22', black: '#1f1a17', blonde: '#d9b44a', ginger: '#b5512c', grey: '#a3a3a3', blue: '#3f6fd0' };
  const CLOTHS = {
    white: { base: '#f4efe4', edge: '#cfc6b3' }, redcheck: { base: '#f4efe4', alt: '#d0453f', edge: '#a8322d' },
    bluecheck: { base: '#f4efe4', alt: '#3f6fd0', edge: '#2d50a8' }, green: { base: '#5e9e5a', edge: '#457a42' },
    wood: { base: '#a8743d', grain: '#8a5c2c', edge: '#6e4a24' },
  };
  const POTS = { terracotta: ['#b0603a', '#86442a'], white: ['#ececec', '#bdbdbd'], blue: ['#3f6fd0', '#2d50a8'], black: ['#34363f', '#1f2029'] };
  const STYLE_OPTIONS = {
    hat: ['toque', 'cap', 'beret', 'bandana', 'none'],
    hatColor: Object.keys(COLORS),
    jacket: Object.keys(COLORS),
    skin: ['mixed', ...Object.keys(SKINS)],
    hair: ['mixed', ...Object.keys(HAIRS)],
    shape: ['square', 'round'],
    cloth: Object.keys(CLOTHS),
    centerpiece: ['flower', 'candle', 'none'],
    plant: ['fern', 'flowers', 'cactus', 'tree', 'monstera'],
    pot: Object.keys(POTS),
  };
  const SWATCHES = { ...Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, v[0]])), ...Object.fromEntries(Object.entries(SKINS).map(([k, v]) => [k, v[0]])), ...HAIRS };

  // ---- body parts (16 px wide); a/b = hat, w/g/k = jacket ----
  const HATS = {
    toque: ['.....aaaaaa.....', '....aaaaaaaa....', '...aaabaaaaaa...', '...aaaaaaabaa...', '....aaaaaaaa....', '....BBBBBBBB....'],
    cap: ['....aaaaaaaa....', '....BBBBBBBB....'],
    beret: ['.......ab.......', '....aaaaaaaa....', '...aaaaaaaaaa...', '...abbbbbbbbaa..', '....BBBBBBBB....'],
    bandana: ['.....aaaaaa.....', '....aaaaaaaab...', '....BBBBBBBBbb..'],
    none: ['.....hhhhhh.....', '....BBBBBBBB....'],
  };
  const HAT_BOSS = [
    '....aaaaaaaa....',
    '...aaaaaaaaaa...',
    '...aaabaaaaaa...',
    '...aaaaaabaaa...',
    '...aaaaaaaaaa...',
    '....aaaaaaaa....',
    '....YYYYYYYY....',
  ];
  const HAIR = [
    '.....hhhhhh.....',
    '....hhhhhhhh....',
  ];
  const FACE = {
    down: ['....hssssssh....', '....sesssses....', '....ssssssss....', '.....sSSSSs.....'],
    up: ['....hhhhhhhh....', '....hhhhhhhh....', '....shhhhhhs....', '.....sSSSSs.....'],
    right: ['....hhhsssss....', '....hhsssses....', '....hsssssssS...', '.....sSSSSs.....'],
  };
  const FACE_BOSS = {
    down: ['....ssssssss....', '....sesssses....', '....shhhhhhs....', '.....sSSSSs.....'],
    up: FACE.up,
    right: ['....hhhsssss....', '....hhsssses....', '....hssssshhS...', '.....sSSSSs.....'],
  };
  const TORSO = {
    chef: {
      down: ['...wwwwwwwwww...', '..wwwwwkwwwwww..', '..wgwwwwwwwwgw..', '..swwwwkwwwwws..', '...wwwwwwwwww...', '...gggggggggg...'],
      up: ['...wwwwwwwwww...', '..wwwwwwwwwwww..', '..wgwwwwwwwwgw..', '..swwwwwwwwwws..', '...wwwwwwwwww...', '...gggggggggg...'],
      right: ['....wwwwwwww....', '....wwwwwwwww...', '....wgwwwwwww...', '....wwwswwwww...', '....wwwwwwww....', '....gggggggg....'],
      workA: ['..swwwwwwwwwws..', '..wwwwwkwwwwww..', '...wwwwwwwwww...', '...wwwwkwwwww...', '...wwwwwwwwww...', '...gggggggggg...'],
      workB: ['...wwwwwwwwww...', '..wwwwwkwwwwww..', '...swwwwwwwws...', '...wwwwkwwwww...', '...wwwwwwwwww...', '...gggggggggg...'],
    },
    waiter: {
      down: ['...vvvwwwwvvv...', '..vvvvwrrwvvvv..', '..vvvvwwwwvvvv..', '..svvvwwwwvvvs..', '...vvvvvvvvvv...', '...vvvvvvvvvv...'],
      up: ['...vvvvvvvvvv...', '..vvvvvvvvvvvv..', '..vvvvvvvvvvvv..', '..svvvvvvvvvvs..', '...vvvvvvvvvv...', '...vvvvvvvvvv...'],
      right: ['....vvvvwwvv....', '....vvvvwrvvv...', '....vvvvwwvvv...', '....vvvsvvvvv...', '....vvvvvvvv....', '....vvvvvvvv....'],
      workA: ['..svvvwwwwvvvs..', '..vvvvwrrwvvvv..', '...vvvwwwwvvv...', '...vvvwwwwvvv...', '...vvvvvvvvvv...', '...vvvvvvvvvv...'],
      workB: ['..svvvwwwwvvvs..', '..vvvvwrrwvvvv..', '...vvvwwwwvvv...', '...vvvwwwwvvv...', '...vvvvvvvvvv...', '...vvvvvvvvvv...'],
    },
    boss: {
      down: ['...wwwwwwwwww...', '..wwwwwYwwwwww..', '..wgwwwwwwwccc..', '..swwwwYwwwCCc..', '...wwwwwwwwccc..', '...gggggggggg...'],
      up: ['...wwwwwwwwww...', '..wwwwwwwwwwww..', '..wgwwwwwwwwgw..', '..swwwwwwwwwws..', '...wwwwwwwwww...', '...gggggggggg...'],
      right: ['....wwwwwwww....', '....wwwwwwwYw...', '....wgwwwwcccc..', '....wwwwwwcCCc..', '....wwwwwwcccc..', '....gggggggg....'],
      workA: ['..swwwwwwwwwws..', '..wwwwwYwwwwww..', '...wwwwwwwwww...', '...wwwwYwwwww...', '...wwwwwwwwww...', '...gggggggggg...'],
      workB: ['...wwwwwwwwww...', '..wwwwwYwwwwww..', '..wgwwwwwwwccc..', '..swwwwYwwwCCc..', '...wwwwwwwwccc..', '...gggggggggg...'],
    },
  };
  const LEGS = {
    front: {
      stand: ['....pppppppp....', '....ppp..ppp....', '....ppp..ppp....', '....ooo..ooo....'],
      a: ['....pppppppp....', '....ppp..ppp....', '....ooo..ppp....', '.........ooo....'],
      b: ['....pppppppp....', '....ppp..ppp....', '....ppp..ooo....', '....ooo.........'],
    },
    side: {
      stand: ['.....pppppp.....', '.....pp..pp.....', '.....pp..pp.....', '.....oo..ooo....'],
      a: ['.....pppppp.....', '....pp....pp....', '...pp......pp...', '...oo......ooo..'],
      b: ['.....pppppp.....', '.....pp.ppp.....', '.....pp..pp.....', '....ooo..oo.....'],
    },
  };

  function compose(kind, dir, pose, frame, hatStyle) {
    const d = dir === 'left' ? 'right' : dir;
    const legsSet = d === 'right' ? LEGS.side : LEGS.front;
    let legs = legsSet.stand;
    if (pose === 'walk') legs = [legsSet.a, legsSet.stand, legsSet.b, legsSet.stand][frame % 4];
    let torsoSet = TORSO.chef;
    let hat = HATS[hatStyle] || HATS.toque;
    let face = FACE[d];
    if (kind === 'sous') hat = hatStyle === 'none' ? HATS.none : HATS.cap;
    if (kind === 'waiter') { hat = HAIR; torsoSet = TORSO.waiter; }
    if (kind === 'boss') { hat = HAT_BOSS; torsoSet = TORSO.boss; face = FACE_BOSS[d]; }
    let torso = torsoSet[d];
    if (pose === 'work' && d !== 'right') torso = frame % 2 ? torsoSet.workB : torsoSet.workA;
    if (kind === 'sous') { torso = torso.slice(0, 5); legs = [legs[0], legs[2], legs[3]]; }
    if (kind === 'boss') legs = legs.map((r) => r.replace(/p/g, 'q'));
    let rows = [...hat, ...face, ...torso, ...legs];
    // Idle breathing: bob the head by one pixel on alternate frames.
    if (pose === 'idle' && frame % 2) rows = ['................', ...rows.slice(0, hat.length + face.length), ...rows.slice(hat.length + face.length + 1)];
    if (dir === 'left') rows = rows.map((r) => [...r].reverse().join(''));
    return rows;
  }

  function rowsToCanvas(rows, palette) {
    const h = rows.length;
    const w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w + 2;
    c.height = h + 2;
    const ctx = c.getContext('2d');
    const solid = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';
    ctx.fillStyle = OUTLINE;
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        if (solid(x, y)) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        ctx.fillStyle = palette[ch] || '#ff00ff';
        ctx.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    return c;
  }

  const cache = new Map();
  // style: { hat, hatColor, jacket, skin, hair } with concrete values (no 'mixed'); only chefs and sous-chefs use it.
  function character(kind, dir, pose, frame, band, style) {
    const styled = (kind === 'chef' || kind === 'sous') && style;
    const key = `${kind}|${dir}|${pose}|${frame}|${band}|${styled ? `${style.hat}.${style.hatColor}.${style.jacket}.${style.skin}.${style.hair}` : ''}`;
    let c = cache.get(key);
    if (!c) {
      const pal = { ...PALETTE, a: PALETTE.w, b: PALETTE.g, B: band || '#888' };
      if (styled) {
        const j = COLORS[style.jacket] || COLORS.white;
        const h = COLORS[style.hatColor] || COLORS.white;
        const sk = SKINS[style.skin] || SKINS.light;
        Object.assign(pal, { w: j[0], g: j[1], k: j[2], a: h[0], b: h[1], s: sk[0], S: sk[1], h: HAIRS[style.hair] || HAIRS.brown });
      }
      c = rowsToCanvas(compose(kind, dir, pose, frame, styled ? style.hat : 'toque'), pal);
      cache.set(key, c);
      if (cache.size > 4000) cache.delete(cache.keys().next().value);
    }
    return c;
  }

  // ---- props ----
  const PROPS = {
    ticket: ['CCCCC', 'CkkkC', 'CCCCC', 'CkkCC', 'CCCCC', 'CrrrC'],
    plate: ['..CCCC..', '.CgOGgC.', 'CgOOGGgC', '.CggggC.', '..CCCC..'],
    crate: ['cccccccc', 'cGGOrrGc', 'cccccccc', 'cOGrGOGc', 'cccccccc'],
    bowl: ['.wwwwww.', 'wggOgggw', '.wwwwww.', '..gggg..'],
    pot: ['k......k', 'kkkkkkkk', 'kqqqqqqk', 'kqqqqqqk', '.kkkkkk.'],
    knifeUp: ['...g', '..g.', '.c..', 'c...'],
    knifeDown: ['cggg', '....'],
    book0: ['cCCCCCCc', 'cCkkCkkc', 'cCCCCCCc', 'cCkkCkCc', 'cCCCCCCc', '.cccccc.'],
    book1: ['....CCc.', 'cCCCCkCc', 'cCkkCCCc', 'cCCCCkCc', 'cCkkCCCc', '.cccccc.'],
    book2: ['.cCC....', 'cCkCCCCc', 'cCCCCkkc', 'cCkCCCCc', 'cCCCCkkc', '.cccccc.'],
  };
  const PROP_PALETTE = { ...PALETTE, G: '#5fb34a', O: '#f08a24', k: '#3a3d4f', q: '#7a7f90' };
  const propCache = new Map();
  function prop(name) {
    let c = propCache.get(name);
    if (!c) {
      const rows = PROPS[name];
      const w = Math.max(...rows.map((r) => r.length));
      c = rowsToCanvas(rows.map((r) => r.padEnd(w, '.')), PROP_PALETTE);
      propCache.set(name, c);
    }
    return c;
  }

  // ---- tiles (drawn with rects into the static background) ----
  const T = 16;
  function rect(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

  function drawTile(ctx, type, tx, ty, v, deco) {
    const x = tx * T;
    const y = ty * T;
    switch (type) {
      case 'floor': {
        const dark = (tx + ty) % 2 === 0;
        rect(ctx, x, y, T, T, dark ? '#d9d4c7' : '#ece8dc');
        rect(ctx, x, y + 15, T, 1, 'rgba(0,0,0,0.05)');
        break;
      }
      case 'dfloor': {
        rect(ctx, x, y, T, T, (ty % 2) ? '#a8774a' : '#b3814f');
        rect(ctx, x, y + 7, T, 1, '#8d5f37');
        rect(ctx, x + ((ty * 7) % 16), y, 1, 7, '#8d5f37');
        rect(ctx, x + ((ty * 7 + 8) % 16), y + 8, 1, 8, '#8d5f37');
        break;
      }
      case 'wall': {
        rect(ctx, x, y, T, T, '#5b6378');
        rect(ctx, x, y, T, 1, '#6e7790');
        if (ty === 1) {
          rect(ctx, x, y, T, T, '#cfd8e3');
          for (let i = 0; i < 4; i++) rect(ctx, x + i * 4, y + (i % 2) * 8, 1, 8, '#b5c0cc');
          rect(ctx, x, y + 7, T, 1, '#b5c0cc');
          rect(ctx, x, y + 15, T, 1, '#8f99a8');
        }
        break;
      }
      case 'shelf': {
        drawTile(ctx, 'floor', tx, ty);
        rect(ctx, x, y - 12, T, 28, '#7a4f2c');
        for (let r = 0; r < 3; r++) {
          const sy = y - 10 + r * 9;
          rect(ctx, x + 1, sy + 7, 14, 2, '#5c3a1f');
          const colors = ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22'];
          for (let b = 0; b < 5; b++) rect(ctx, x + 2 + b * 3, sy + 1 + ((b + r + tx) % 2), 2, 6 - ((b + r + tx) % 2), colors[(b + r * 2 + tx) % colors.length]);
        }
        break;
      }
      case 'rail': {
        drawTile(ctx, 'counter', tx, ty);
        rect(ctx, x, y - 10, T, 2, '#9aa3b5');
        rect(ctx, x, y - 8, T, 1, '#6c7488');
        break;
      }
      case 'counter': {
        rect(ctx, x, y, T, T, '#aab3c2');
        rect(ctx, x, y, T, 2, '#d6dde8');
        rect(ctx, x, y + 12, T, 4, '#7e879a');
        rect(ctx, x + (tx % 2 ? 0 : 15), y + 12, 1, 4, '#646c7e');
        break;
      }
      case 'island': {
        rect(ctx, x, y, T, T, '#b9c1cd');
        rect(ctx, x, y, T, 1, '#dde3ec');
        if (v === 'bottom') rect(ctx, x, y + 11, T, 5, '#7e879a');
        break;
      }
      case 'board': {
        drawTile(ctx, 'island', tx, ty, v);
        rect(ctx, x + 2, y + 3, 12, 8, '#c8955c');
        rect(ctx, x + 2, y + 10, 12, 1, '#9c6c3a');
        rect(ctx, x + 12, y + 5, 1, 2, '#9c6c3a');
        break;
      }
      case 'prep': {
        drawTile(ctx, 'island', tx, ty, v);
        if (tx % 3 === 2) { rect(ctx, x + 4, y + 4, 8, 5, '#e8e8e8'); rect(ctx, x + 5, y + 5, 6, 3, '#f4d58d'); }
        break;
      }
      case 'stove': {
        rect(ctx, x, y - 4, T, 20, '#30323d');
        rect(ctx, x, y - 4, T, 1, '#4a4d5c');
        rect(ctx, x + 3, y + 1, 10, 8, '#202129');
        ctx.strokeStyle = '#5a5d6c';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 4.5, y + 2.5, 7, 5);
        rect(ctx, x + 2, y + 12, 3, 2, '#c0392b');
        rect(ctx, x + 11, y + 12, 3, 2, '#c0392b');
        break;
      }
      case 'backdoor': {
        rect(ctx, x, y, T, T, '#6b4423');
        rect(ctx, x + 2, y + 1, 12, 14, '#8b5a2b');
        rect(ctx, x + 11, y + 7, 2, 2, '#e8b923');
        break;
      }
      case 'staffdoor': {
        rect(ctx, x, y, T, T, '#3c4a5c');
        rect(ctx, x + 2, y + 1, 12, 14, '#53657d');
        rect(ctx, x + 3, y + 3, 10, 4, '#9fc3e0');
        break;
      }
      case 'frontdoor': {
        rect(ctx, x, y, T, T, '#3c2a1a');
        rect(ctx, x + 1, y, 14, 12, '#9fd3f0');
        rect(ctx, x + 1, y + 5, 14, 1, '#d8eef9');
        break;
      }
      case 'pass': {
        rect(ctx, x, y, T, T, '#c9ced8');
        rect(ctx, x, y, 2, T, '#eef1f5');
        rect(ctx, x + 14, y, 2, T, '#8e95a3');
        rect(ctx, x + 3, y, 10, T, 'rgba(255,190,90,0.18)');
        break;
      }
      case 'table':
        // The whole 2x2 table is drawn from its top-left tile; the floor is already underneath.
        if (v === 'tl') drawTable(ctx, x, y, (deco && deco.table) || {});
        break;
      case 'bench': {
        drawTile(ctx, 'dfloor', tx, ty);
        rect(ctx, x, y + 4, T, 6, '#7a3e2c');
        rect(ctx, x, y + 4, T, 1, '#9b5440');
        rect(ctx, x + 1, y + 10, 2, 5, '#4d281c');
        rect(ctx, x + 13, y + 10, 2, 5, '#4d281c');
        break;
      }
      case 'plant':
        drawTile(ctx, v || 'dfloor', tx, ty);
        drawPlant(ctx, x, y, (deco && deco.plant) || {});
        break;
      case 'crates': {
        drawTile(ctx, 'floor', tx, ty);
        const c = prop('crate');
        ctx.drawImage(c, x + 3, y + 5);
        ctx.drawImage(c, x + 1, y);
        break;
      }
      default:
        rect(ctx, x, y, T, T, '#f0f');
    }
  }

  function ellipse(ctx, cx, cy, rx, ry, color) {
    ctx.fillStyle = color;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const t = 1 - ((y + 0.5 - cy) / ry) ** 2;
      if (t <= 0) continue;
      const half = Math.round(rx * Math.sqrt(t));
      ctx.fillRect(Math.round(cx) - half, y, half * 2, 1);
    }
  }

  function line(ctx, x0, y0, x1, y1, color, size = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    ctx.fillStyle = color;
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), size, size);
  }

  // 32x32 table at (x, y). st: { shape, cloth, centerpiece }
  function drawTable(ctx, x, y, st) {
    const cloth = CLOTHS[st.cloth] || CLOTHS.white;
    const fill = (px, py) => {
      if (cloth.alt) return (Math.floor(px / 3) + Math.floor(py / 3)) % 2 ? cloth.alt : cloth.base;
      if (cloth.grain) return py % 6 === 0 || (py % 6 === 3 && px % 9 === 4) ? cloth.grain : cloth.base;
      return cloth.base;
    };
    rect(ctx, x + 4, y + 29, 24, 2, 'rgba(0,0,0,0.18)');
    const round = st.shape === 'round';
    for (let py = 1; py < 30; py++) {
      for (let px = 1; px < 31; px++) {
        let inside;
        let edge;
        if (round) {
          const dx = px + 0.5 - 16;
          inside = dx * dx + (py + 0.5 - 13.5) ** 2 <= 13.5 * 13.5;
          edge = !inside && dx * dx + (py + 0.5 - 16.5) ** 2 <= 13.5 * 13.5;
        } else {
          inside = px >= 2 && px <= 29 && py >= 2 && py <= 25;
          edge = px >= 2 && px <= 29 && py > 25 && py <= 28;
        }
        if (inside) { ctx.fillStyle = fill(px, py); ctx.fillRect(x + px, y + py, 1, 1); }
        else if (edge) { ctx.fillStyle = cloth.edge; ctx.fillRect(x + px, y + py, 1, 1); }
      }
    }
    const cx = x + 16;
    const cy = y + 13;
    if (st.centerpiece === 'candle') {
      rect(ctx, cx - 3, cy + 2, 6, 2, '#9aa3b5');
      rect(ctx, cx - 1, cy - 4, 3, 6, '#fbf2d5');
      rect(ctx, cx, cy - 7, 1, 2, '#ffdd57');
      rect(ctx, cx - 1, cy - 6, 3, 1, '#ff9f1c');
    } else if (st.centerpiece !== 'none') {
      rect(ctx, cx - 2, cy - 1, 5, 5, '#c9b8e8');
      rect(ctx, cx - 1, cy, 1, 3, '#e4dbf5');
      line(ctx, cx, cy - 1, cx - 3, cy - 5, '#3f8f3a');
      line(ctx, cx, cy - 1, cx + 3, cy - 6, '#3f8f3a');
      rect(ctx, cx - 4, cy - 7, 3, 3, '#e5484d');
      rect(ctx, cx + 2, cy - 8, 3, 3, '#f5b301');
      rect(ctx, cx - 1, cy - 9, 3, 3, '#f06fae');
    }
  }

  // Plant in a pot on the tile at (x, y); foliage may extend above the tile.
  function drawPlant(ctx, x, y, st) {
    const pot = POTS[st.pot] || POTS.terracotta;
    rect(ctx, x + 2, y + 15, 12, 1, 'rgba(0,0,0,0.2)');
    const G = ['#2f6e2b', '#3f8f3a', '#57a84f', '#7cc46f'];
    switch (st.type) {
      case 'cactus':
        ellipse(ctx, x + 8, y + 1, 3, 9, G[1]);
        rect(ctx, x + 7, y - 7, 1, 15, G[3]);
        rect(ctx, x + 2, y - 1, 3, 2, G[1]); rect(ctx, x + 2, y - 6, 2, 6, G[1]);
        rect(ctx, x + 11, y - 3, 3, 2, G[1]); rect(ctx, x + 12, y - 8, 2, 6, G[1]);
        for (const [sx, sy] of [[6, -4], [9, -1], [6, 3], [9, 5], [2, -4], [13, -6]]) rect(ctx, x + sx, y + sy, 1, 1, '#e8f5d0');
        rect(ctx, x + 7, y - 10, 2, 2, '#f06fae');
        break;
      case 'tree':
        rect(ctx, x + 7, y - 1, 2, 10, '#6b4423');
        line(ctx, x + 8, y + 2, x + 11, y - 1, '#6b4423');
        ellipse(ctx, x + 8, y - 5, 8, 6, G[0]);
        ellipse(ctx, x + 7, y - 6, 6, 4.5, G[1]);
        ellipse(ctx, x + 6, y - 8, 3, 2, G[2]);
        break;
      case 'flowers':
        ellipse(ctx, x + 8, y + 3, 7, 6, G[1]);
        ellipse(ctx, x + 7, y + 1, 4, 3, G[2]);
        for (const [fx, fy, c] of [[3, 0, '#f06fae'], [9, -2, '#f5b301'], [12, 3, '#e5484d'], [6, 4, '#ffffff'], [5, -3, '#f5b301'], [11, -1, '#f06fae']]) {
          rect(ctx, x + fx, y + fy, 2, 2, c);
        }
        break;
      case 'monstera':
        for (const [ex, ey, a] of [[3, -2, -1], [13, -3, 1], [8, -8, 0]]) {
          line(ctx, x + 8, y + 8, x + ex, y + ey + 3, G[0]);
          ellipse(ctx, x + ex, y + ey, 4.5, 3.5, G[0]);
          ellipse(ctx, x + ex + a, y + ey - 1, 3, 2, G[1]);
          rect(ctx, x + ex - 2, y + ey, 1, 1, G[3]);
          rect(ctx, x + ex + 2, y + ey + 1, 1, 1, G[3]);
        }
        break;
      default: // fern
        for (const [ex, ey] of [[0, 3], [2, -4], [8, -9], [14, -4], [16, 3], [5, -7], [11, -7]]) {
          line(ctx, x + 8, y + 8, x + ex, y + ey, G[1], 2);
          line(ctx, x + 8, y + 7, x + ex + (ex < 8 ? 1 : -1), y + ey + 1, G[2]);
        }
        break;
    }
    rect(ctx, x + 4, y + 9, 8, 6, pot[0]);
    rect(ctx, x + 3, y + 8, 10, 2, pot[0]);
    rect(ctx, x + 3, y + 9, 10, 1, pot[1]);
    rect(ctx, x + 10, y + 10, 2, 5, pot[1]);
    rect(ctx, x + 4, y + 8, 8, 1, '#4a3222');
  }

  function flame(ctx, x, y, frame) {
    const colors = ['#ffdd57', '#ff9f1c', '#ff5e1c'];
    const h = [4, 6, 5][frame % 3];
    for (let i = 0; i < 4; i++) {
      const hh = h - ((i + frame) % 3);
      rect(ctx, x + i * 2, y - hh, 2, hh, colors[(i + frame) % 3]);
    }
  }

  window.KitchenSprites = {
    T, character, prop, drawTile, drawTable, drawPlant, flame, rect, SOURCE_COLORS, PALETTE,
    STYLE_OPTIONS, SWATCHES, SKINS, HAIRS,
  };
})();

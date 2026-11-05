'use strict';
// Kitchen look-and-feel settings, stored by the host (browser localStorage or VS Code) and edited in the Customise dialog.
(function () {
  const S = window.KitchenSprites;
  const O = S.STYLE_OPTIONS;
  const KEY = 'agentKitchenStyle';

  const SCHEMA = {
    chef: { hat: O.hat, hatColor: O.hatColor, jacket: O.jacket, skin: O.skin, hair: O.hair },
    table: { shape: O.shape, cloth: O.cloth, centerpiece: O.centerpiece },
    plant: { type: O.plant, pot: O.pot },
    display: { size: ['normal', 'large', 'xl'], clipboard: ['show', 'hide'] },
  };
  const DEFAULTS = {
    chef: { hat: 'toque', hatColor: 'white', jacket: 'white', skin: 'mixed', hair: 'mixed' },
    table: { shape: 'square', cloth: 'white', centerpiece: 'flower' },
    plant: { type: 'fern', pot: 'terracotta' },
    display: { size: 'large', clipboard: 'show' },
  };
  const GROUPS = { chef: 'Chefs', table: 'Tables', plant: 'Plants', display: 'Display' };
  const FIELDS = {
    hat: 'Hat', hatColor: 'Hat colour', jacket: 'Jacket', skin: 'Skin tone', hair: 'Hair',
    shape: 'Shape', cloth: 'Tablecloth', centerpiece: 'Centrepiece', type: 'Plant', pot: 'Pot', size: 'Object size', clipboard: 'Clipboard',
  };
  const VALUE_LABELS = {
    toque: 'Tall toque', cap: 'Skull cap', beret: 'Beret', bandana: 'Bandana', none: 'None', mixed: 'Mixed',
    redcheck: 'Red check', bluecheck: 'Blue check', wood: 'Bare wood', flower: 'Flowers', candle: 'Candle',
    fern: 'Fern', flowers: 'Flower bush', cactus: 'Cactus', tree: 'Little tree', monstera: 'Monstera',
    normal: 'Normal', large: 'Large', xl: 'Extra large', show: 'Show', hide: 'Hide',
  };
  const SWATCH_FIELDS = new Set(['hatColor', 'jacket', 'skin', 'hair', 'pot']);
  const CLOTH_SWATCH = { white: '#f4efe4', redcheck: 'repeating-conic-gradient(#d0453f 0 25%, #f4efe4 0 50%) 0 0/8px 8px', bluecheck: 'repeating-conic-gradient(#3f6fd0 0 25%, #f4efe4 0 50%) 0 0/8px 8px', green: '#5e9e5a', wood: '#a8743d' };
  const POT_SWATCH = { terracotta: '#b0603a', white: '#ececec', blue: '#3f6fd0', black: '#34363f' };

  function load() {
    let saved = {};
    try { saved = JSON.parse(window.KitchenHost.load(KEY)) || {}; } catch { saved = {}; }
    const out = {};
    for (const [group, fields] of Object.entries(SCHEMA)) {
      out[group] = {};
      for (const [field, allowed] of Object.entries(fields)) {
        const v = saved[group] && saved[group][field];
        out[group][field] = allowed.includes(v) ? v : DEFAULTS[group][field];
      }
    }
    return out;
  }

  let current = load();
  const listeners = new Set();

  function save() {
    window.KitchenHost.save(KEY, JSON.stringify(current));
    for (const fn of listeners) fn(current);
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  // Concrete sprite style for one chef; "mixed" picks a stable skin tone / hair colour from the chef id.
  function chefStyle(id) {
    const c = current.chef;
    const h = hash(String(id || ''));
    const skins = Object.keys(S.SKINS);
    const hairs = Object.keys(S.HAIRS);
    return {
      hat: c.hat, hatColor: c.hatColor, jacket: c.jacket,
      skin: c.skin === 'mixed' ? skins[h % skins.length] : c.skin,
      hair: c.hair === 'mixed' ? hairs[(h >>> 8) % hairs.length] : c.hair,
    };
  }

  // ---- dialog ----
  const dialog = document.getElementById('customise');
  const body = document.getElementById('customBody');
  const preview = document.getElementById('customPreview');

  function swatchFor(field, value) {
    if (value === 'mixed') return 'conic-gradient(#f8dcc4, #a86b3c, #6e4426, #d9b44a, #f8dcc4)';
    if (field === 'cloth') return CLOTH_SWATCH[value];
    if (field === 'pot') return POT_SWATCH[value];
    return S.SWATCHES[value];
  }

  function build() {
    body.textContent = '';
    for (const [group, fields] of Object.entries(SCHEMA)) {
      const fs = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = GROUPS[group];
      fs.appendChild(legend);
      for (const [field, allowed] of Object.entries(fields)) {
        const row = document.createElement('div');
        row.className = 'opt-row';
        const label = document.createElement('span');
        label.className = 'opt-label';
        label.textContent = FIELDS[field];
        const choices = document.createElement('div');
        choices.className = 'opt-choices';
        choices.setAttribute('role', 'radiogroup');
        choices.setAttribute('aria-label', `${GROUPS[group]} ${FIELDS[field]}`);
        for (const value of allowed) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'radio');
          const name = VALUE_LABELS[value] || value[0].toUpperCase() + value.slice(1);
          b.title = name;
          const swatch = (SWATCH_FIELDS.has(field) || field === 'cloth') && swatchFor(field, value);
          if (swatch) {
            b.className = 'swatch';
            b.style.background = swatch;
            b.setAttribute('aria-label', name);
          } else {
            b.textContent = name;
          }
          const selected = current[group][field] === value;
          b.classList.toggle('on', selected);
          b.setAttribute('aria-checked', String(selected));
          b.addEventListener('click', () => {
            current[group][field] = value;
            save();
            build();
          });
          choices.appendChild(b);
        }
        row.append(label, choices);
        fs.appendChild(row);
      }
      body.appendChild(fs);
    }
    drawPreview();
  }

  function drawPreview() {
    const w = 128;
    const h = 44;
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const c = off.getContext('2d');
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 8; tx++) S.drawTile(c, tx < 4 ? 'floor' : 'dfloor', tx, ty);
    }
    const sample = (id) => chefStyle(id);
    const chefA = S.character('chef', 'down', 'idle', 0, S.SOURCE_COLORS.claude, sample('preview-a'));
    const chefB = S.character('chef', 'right', 'walk', 1, S.SOURCE_COLORS.copilot, sample('preview-b'));
    const sous = S.character('sous', 'down', 'idle', 0, S.SOURCE_COLORS.claude, sample('preview-c'));
    c.drawImage(chefA, 4, h - chefA.height - 2);
    c.drawImage(chefB, 22, h - chefB.height - 2);
    c.drawImage(sous, 40, h - sous.height - 2);
    S.drawTable(c, 66, 6, current.table);
    S.drawPlant(c, 104, 24, { type: current.plant.type, pot: current.plant.pot });
    const p = preview.getContext('2d');
    p.imageSmoothingEnabled = false;
    p.clearRect(0, 0, preview.width, preview.height);
    p.drawImage(off, 0, 0, preview.width, preview.height);
  }

  document.getElementById('customiseBtn').addEventListener('click', () => {
    build();
    dialog.showModal();
  });
  document.getElementById('customReset').addEventListener('click', () => {
    current = JSON.parse(JSON.stringify(DEFAULTS));
    save();
    build();
  });
  document.getElementById('customDone').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  window.KitchenSettings = {
    get: () => current,
    chefStyle,
    onChange: (fn) => listeners.add(fn),
  };
})();

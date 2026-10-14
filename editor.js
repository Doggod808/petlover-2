/**
 * 像素画板。
 * 工作态：{ size, palette: [hex...], colors: Int16Array }，colors 存调色板下标，-1 是透明。
 */
import { h, clear } from './dom.js';
import { MAX_PALETTE, blankSprite, cloneSprite } from './paint.js';

const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 20];

export const DEFAULT_PALETTE = [
  '#131a21', '#2a3448', '#3a4e9e', '#3f9fd0', '#8ec9e8', '#bfe3f2', '#f4f7f6', '#ffffff',
  '#4f5b67', '#8b979e', '#b9c7c9', '#d7e1e2', '#1f6b4a', '#3fa46a', '#5cbb77', '#8fd35a',
  '#2b7b4d', '#a3c8b4', '#f5b32e', '#ffd166', '#f08a3c', '#8a5a3b', '#6b3f1d', '#c98a4b',
  '#ef4265', '#c92a4c', '#f4a3b6', '#ffd6e0', '#8a63d2', '#b9a6d6', '#6c4ab6', '#fdf3f7',
];

export function createEditor({ size = 32, sprite = null, presets = [], onChange = null, allowTransparent = true } = {}) {
  const working = sprite ? cloneSprite(sprite) : blankSprite(size);
  working.palette = working.palette.length ? working.palette.slice() : DEFAULT_PALETTE.slice();
  let colorIndex = indexOfColor(working, '#3fa46a') ?? (working.palette.length - 1);
  let tool = 'pencil';
  let mirror = false;
  let showGrid = true;
  let zoom = ZOOMS[0];
  let zoomTouched = false;
  let painting = false;
  let lastCell = null;
  const undoStack = [];
  const redoStack = [];

  /* ------------------------------- DOM ------------------------------- */

  const canvas = h('canvas', { class: 'pad__canvas' });
  const gridLayer = h('div', { class: 'pad__grid' });
  const pad = h('div', { class: 'pad' }, canvas, gridLayer);
  const padFrame = h('div', { class: 'pad__frame' }, pad);
  const paletteHost = h('div', { class: 'palette' });
  const previewRow = h('div', { class: 'previews' });
  const statsLine = h('p', { class: 'pad__stats mono tiny' });
  const customColor = h('input', { type: 'color', class: 'colorpick', value: working.palette[colorIndex] || '#3fa46a', 'aria-label': '自定义颜色' });

  const toolButtons = new Map();
  const TOOLS = [
    { id: 'pencil', label: '画笔', hint: 'P' },
    { id: 'eraser', label: '橡皮', hint: 'E' },
    { id: 'fill', label: '填色', hint: 'G' },
    { id: 'picker', label: '吸管', hint: 'I' },
  ];
  const toolRow = h(
    'div',
    { class: 'toolbar', role: 'toolbar' },
    ...TOOLS.map((item) => {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'tool',
          title: `${item.label}（${item.hint}）`,
          onclick: () => setTool(item.id),
        },
        item.label,
      );
      toolButtons.set(item.id, btn);
      return btn;
    }),
  );

  const mirrorBtn = h(
    'button',
    { type: 'button', class: 'tool', title: '左右对称（M）', onclick: () => { mirror = !mirror; syncToolbar(); } },
    '对称',
  );
  const gridBtn = h(
    'button',
    { type: 'button', class: 'tool', title: '格线（#）', onclick: () => { showGrid = !showGrid; syncToolbar(); } },
    '格线',
  );

  const undoBtn = h('button', { type: 'button', class: 'tool', title: '撤销（Ctrl+Z）', onclick: undo }, '撤销');
  const redoBtn = h('button', { type: 'button', class: 'tool', title: '重做（Ctrl+Shift+Z）', onclick: redo }, '重做');
  const clearBtn = h(
    'button',
    {
      type: 'button',
      class: 'tool tool--danger',
      onclick: () => {
        pushHistory();
        working.colors.fill(-1);
        commit();
      },
    },
    '清空',
  );

  const zoomInput = h('input', {
    type: 'range',
    class: 'zoom',
    min: '0',
    max: String(ZOOMS.length - 1),
    step: '1',
    value: String(Math.max(0, ZOOMS.indexOf(zoom))),
    'aria-label': '缩放',
    oninput: (event) => {
      zoomTouched = true;
      zoom = ZOOMS[Number(event.target.value)];
      applyZoom();
    },
  });

  const presetBar = h(
    'div',
    { class: 'presets' },
    ...presets.map((preset) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          onclick: () => {
            pushHistory();
            const built = preset.build(working.size);
            const palette = working.palette.slice();
            // 模板的颜色并进现有调色板，而不是顶掉它 —— 免得套完模板就没别的色可用
            const remap = built.palette.map((hex) => {
              let slot = palette.findIndex((item) => item.toLowerCase() === hex.toLowerCase());
              if (slot < 0) {
                if (palette.length >= MAX_PALETTE) return -1;
                palette.push(hex);
                slot = palette.length - 1;
              }
              return slot;
            });
            const colors = new Int16Array(built.colors.length);
            for (let i = 0; i < built.colors.length; i += 1) {
              const value = built.colors[i];
              colors[i] = value < 0 ? -1 : remap[value] ?? -1;
            }
            working.palette = palette;
            working.colors.set(colors);
            colorIndex = Math.min(working.palette.length - 1, Math.max(0, colorIndex));
            commit();
          },
        },
        preset.name,
      ),
    ),
  );

  const el = h(
    'div',
    { class: 'studio' },
    h(
      'div',
      { class: 'studio__main' },
      h('div', { class: 'studio__bar' }, toolRow, mirrorBtn, gridBtn, h('span', { class: 'spacer' }), undoBtn, redoBtn, clearBtn),
      padFrame,
      h('div', { class: 'studio__under' }, zoomInput, statsLine),
      h('div', { class: 'studio__section' }, h('p', { class: 'label mono' }, '模板'), presetBar),
    ),
    h(
      'aside',
      { class: 'studio__side' },
      h('div', { class: 'studio__section' }, h('p', { class: 'label mono' }, '颜色'), paletteHost, h('div', { class: 'palette__custom' }, customColor)),
      h('div', { class: 'studio__section' }, h('p', { class: 'label mono' }, '远看像不像'), previewRow),
      h(
        'div',
        { class: 'studio__section tiny muted' },
        h('p', {}, '快捷键：P 画笔 · E 橡皮 · G 填色 · I 吸管 · M 对称 · Ctrl+Z 撤销'),
      ),
    ),
  );

  /* ------------------------------ 逻辑 ------------------------------ */

  function indexOfColor(target, hex) {
    const idx = target.palette.findIndex((c) => c.toLowerCase() === hex.toLowerCase());
    return idx >= 0 ? idx : null;
  }

  function ensureColorSlot(hex) {
    const existing = indexOfColor(working, hex);
    if (existing !== null) return existing;
    if (working.palette.length >= MAX_PALETTE) return working.palette.length - 1;
    working.palette.push(hex);
    return working.palette.length - 1;
  }

  function fitZoom(spriteSize) {
    // 只依赖画框宽度与窗口高度（不用画框自身高度），避免尺寸回调互相触发来回抖动
    const frameWidth = padFrame.clientWidth || Math.min(window.innerWidth, 640);
    const budgetHeight = window.matchMedia('(max-width: 980px)').matches
      ? 400
      : Math.max(240, Math.round(window.innerHeight * 0.62) - 44);
    const raw = Math.floor(Math.min(frameWidth - 44, budgetHeight) / spriteSize);
    let best = ZOOMS[0];
    for (const z of ZOOMS) if (z <= raw) best = z;
    return best;
  }

  function refit() {
    if (zoomTouched) return;
    const next = fitZoom(working.size);
    if (next === zoom) return;
    zoom = next;
    zoomInput.value = String(Math.max(0, ZOOMS.indexOf(zoom)));
    applyZoom();
  }

  function applyZoom() {
    pad.style.setProperty('--zoom', `${zoom}px`);
    gridLayer.style.setProperty('--zoom', `${zoom}px`);
    pad.classList.toggle('pad--grid', showGrid && zoom >= 6);
    canvas.style.width = `${working.size * zoom}px`;
    canvas.style.height = `${working.size * zoom}px`;
  }

  function setTool(next) {
    tool = next;
    syncToolbar();
  }

  function syncToolbar() {
    for (const [id, btn] of toolButtons) btn.setAttribute('aria-pressed', String(id === tool));
    mirrorBtn.setAttribute('aria-pressed', String(mirror));
    gridBtn.setAttribute('aria-pressed', String(showGrid));
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
    customColor.value = working.palette[colorIndex] || '#3fa46a';
  }

  function pushHistory() {
    undoStack.push({ colors: working.colors.slice(), palette: working.palette.slice() });
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
    syncToolbar();
  }

  function undo() {
    const snapshot = undoStack.pop();
    if (!snapshot) return;
    redoStack.push({ colors: working.colors.slice(), palette: working.palette.slice() });
    working.colors.set(snapshot.colors);
    working.palette = snapshot.palette.slice();
    colorIndex = Math.min(colorIndex, working.palette.length - 1);
    commit();
  }

  function redo() {
    const snapshot = redoStack.pop();
    if (!snapshot) return;
    undoStack.push({ colors: working.colors.slice(), palette: working.palette.slice() });
    working.colors.set(snapshot.colors);
    working.palette = snapshot.palette.slice();
    colorIndex = Math.min(colorIndex, working.palette.length - 1);
    commit();
  }

  function renderPalette() {
    clear(paletteHost);
    if (allowTransparent) {
      const trans = h('button', {
        type: 'button',
        class: 'swatch swatch--transparent',
        title: '透明（橡皮）',
        onclick: () => setTool('eraser'),
      });
      paletteHost.append(trans);
    }
    working.palette.forEach((hex, index) => {
      const swatch = h('button', {
        type: 'button',
        class: 'swatch',
        style: { background: hex },
        title: hex,
        'aria-label': `颜色 ${hex}`,
        onclick: () => {
          colorIndex = index;
          if (tool === 'eraser' || tool === 'picker') setTool('pencil');
          syncToolbar();
          renderPalette();
        },
      });
      if (index === colorIndex) swatch.classList.add('swatch--active');
      paletteHost.append(swatch);
    });
    const add = h('label', { class: 'swatch swatch--add', title: '加一个颜色' }, '+', customColor);
    paletteHost.append(add);
  }

  function renderPreviews() {
    clear(previewRow);
    // 预览按整数倍放大，且每张都留在 132px 以内，免得被 CSS 拉伸糊掉
    const factors = [1, 2, 3].filter((factor) => working.size * factor <= 132);
    if (factors.length === 0) factors.push(1);
    for (const factor of factors) {
      const size = working.size * factor;
      const node = h('canvas', { class: 'preview', width: size, height: size, title: `${factor}×` });
      const ctx = node.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      drawTo(ctx, working);
      previewRow.append(h('figure', { class: 'preview__item' }, node, h('figcaption', { class: 'tiny mono' }, `${factor}×`)));
    }
  }

  function drawTo(ctx, target) {
    ctx.clearRect(0, 0, target.size, target.size);
    for (let y = 0; y < target.size; y += 1) {
      for (let x = 0; x < target.size; x += 1) {
        const value = target.colors[y * target.size + x];
        if (value < 0) continue;
        const hex = target.palette[value];
        if (!hex) continue;
        ctx.fillStyle = hex;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function commit() {
    drawTo(canvas.getContext('2d'), working);
    let painted = 0;
    const used = new Set();
    for (const value of working.colors) {
      if (value >= 0) {
        painted += 1;
        used.add(value);
      }
    }
    statsLine.textContent = `${working.size}×${working.size} · 已涂 ${painted}/${working.size * working.size} 格 · 用了 ${used.size} 种颜色`;
    renderPreviews();
    syncToolbar();
    if (onChange) onChange(working);
  }

  /* ------------------------------ 画笔交互 ------------------------------ */

  function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * working.size);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * working.size);
    if (x < 0 || y < 0 || x >= working.size || y >= working.size) return null;
    return { x, y };
  }

  function applyAt(cell, { erase }) {
    const size = working.size;
    if (tool === 'picker') {
      const value = working.colors[cell.y * size + cell.x];
      if (value >= 0) {
        colorIndex = value;
        renderPalette();
        syncToolbar();
        setTool('pencil');
      }
      return;
    }
    const index = tool === 'eraser' || erase ? -1 : colorIndex;
    const targets = [[cell.x, cell.y]];
    if (mirror) targets.push([size - 1 - cell.x, cell.y]);
    for (const [x, y] of targets) working.colors[y * size + x] = index;
  }

  function lineTo(from, to, options) {
    let x0 = from.x;
    let y0 = from.y;
    const x1 = to.x;
    const y1 = to.y;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      applyAt({ x: x0, y: y0 }, options);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  function floodFill(cell) {
    const size = working.size;
    const target = working.colors[cell.y * size + cell.x];
    const replacement = tool === 'eraser' ? -1 : colorIndex;
    if (target === replacement) return;
    const stack = [[cell.x, cell.y]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const idx = y * size + x;
      if (working.colors[idx] !== target) continue;
      working.colors[idx] = replacement;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  canvas.addEventListener('pointerdown', (event) => {
    const cell = cellFromEvent(event);
    if (!cell) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pushHistory();
    painting = true;
    lastCell = cell;
    if (tool === 'fill') {
      floodFill(cell);
      painting = false;
      commit();
      return;
    }
    applyAt(cell, { erase: event.button === 2 || event.buttons === 2 });
    commit();
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!painting) return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    if (lastCell && (cell.x !== lastCell.x || cell.y !== lastCell.y)) {
      lineTo(lastCell, cell, { erase: (event.buttons & 2) === 2 });
    }
    lastCell = cell;
    commit();
  });

  const endStroke = () => {
    painting = false;
    lastCell = null;
    renderPalette();
    syncToolbar();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  customColor.addEventListener('input', () => {
    const slot = ensureColorSlot(customColor.value);
    colorIndex = slot;
    if (tool === 'eraser' || tool === 'picker') setTool('pencil');
    renderPalette();
    syncToolbar();
  });

  function onKeyDown(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (key === 'p') setTool('pencil');
    else if (key === 'e') setTool('eraser');
    else if (key === 'g') setTool('fill');
    else if (key === 'i') setTool('picker');
    else if (key === 'm') {
      mirror = !mirror;
      syncToolbar();
    } else if (key === '#') {
      showGrid = !showGrid;
      applyZoom();
      syncToolbar();
    } else return;
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);

  renderPalette();
  canvas.width = working.size;
  canvas.height = working.size;
  zoom = fitZoom(working.size);
  zoomInput.value = String(Math.max(0, ZOOMS.indexOf(zoom)));
  applyZoom();
  commit();

  const fitObserver = new ResizeObserver(() => refit());
  fitObserver.observe(padFrame);
  requestAnimationFrame(refit);

  return {
    el,
    getSprite: () => working,
    setSprite(next) {
      working.size = next.size;
      working.palette = next.palette.slice();
      working.colors = next.colors.slice();
      canvas.width = working.size;
      canvas.height = working.size;
      zoomTouched = false;
      zoom = fitZoom(working.size);
      zoomInput.value = String(Math.max(0, ZOOMS.indexOf(zoom)));
      renderPalette();
      applyZoom();
      commit();
    },
    refit,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      fitObserver.disconnect();
    },
  };
}

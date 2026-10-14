'use strict';
/**
 * 像素画数据校验与编解码。
 * 线上格式（紧凑）：{ size, palette: ["#rrggbb", ...], runs: [[长度, 调色板下标], ...] }
 * 下标 -1 表示透明。runs 展开后必须正好 size*size 个像素。
 */
const PET_SIZES = [32, 64, 128];
const FOOD_SIZES = [16, 32, 64];
const MAX_PALETTE = 48;
const MAX_RUNS = 20000;
const MAX_SERIALIZED = 800 * 1024;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  let hex = value.trim().toLowerCase();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (/^[0-9a-f]{3}$/.test(hex)) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (!/^[0-9a-f]{6}$/.test(hex)) return null;
  return `#${hex}`;
}

/**
 * @returns {{ok:true, sprite:object, stats:object} | {ok:false, error:string}}
 */
function validateSprite(input, { sizes = PET_SIZES, label = '作品' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: `${label}数据格式不对。` };
  }
  const serialized = JSON.stringify(input);
  if (serialized.length > MAX_SERIALIZED) {
    return { ok: false, error: `${label}太大了，请减少颜色数量。` };
  }
  const size = Number(input.size);
  if (!sizes.includes(size)) {
    return { ok: false, error: `${label}尺寸只能是 ${sizes.join(' / ')}。` };
  }
  const total = size * size;

  if (!Array.isArray(input.palette) || input.palette.length === 0 || input.palette.length > MAX_PALETTE) {
    return { ok: false, error: `${label}的颜色数量需要在 1–${MAX_PALETTE} 之间。` };
  }
  const palette = [];
  for (const color of input.palette) {
    const hex = normalizeHex(color);
    if (!hex) return { ok: false, error: `${label}里有一个颜色值不合法。` };
    palette.push(hex);
  }

  if (!Array.isArray(input.runs) || input.runs.length === 0 || input.runs.length > MAX_RUNS) {
    return { ok: false, error: `${label}像素数据不完整。` };
  }
  const runs = [];
  let covered = 0;
  let painted = 0;
  for (const entry of input.runs) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return { ok: false, error: `${label}像素数据不完整。` };
    }
    const count = Number(entry[0]);
    const index = Number(entry[1]);
    if (!Number.isInteger(count) || count < 1 || count > total) {
      return { ok: false, error: `${label}像素数据不完整。` };
    }
    if (!Number.isInteger(index) || index < -1 || index >= palette.length) {
      return { ok: false, error: `${label}引用了不存在的颜色。` };
    }
    covered += count;
    if (covered > total) return { ok: false, error: `${label}像素数量超出画布。` };
    if (index >= 0) painted += count;
    runs.push([count, index]);
  }
  if (covered !== total) {
    return { ok: false, error: `${label}像素数量与画布不符。` };
  }
  if (painted === 0) {
    return { ok: false, error: `${label}还是空的，先画几笔吧。` };
  }

  return {
    ok: true,
    sprite: { size, palette, runs },
    stats: {
      size,
      colors: palette.length,
      painted,
      coverage: Math.round((painted / total) * 100),
    },
  };
}

/** 展开成 size*size 的颜色数组，-1 透明 */
function decode(sprite) {
  const out = new Int16Array(sprite.size * sprite.size);
  let i = 0;
  for (const [count, index] of sprite.runs) {
    for (let k = 0; k < count; k += 1) out[i + k] = index;
    i += count;
  }
  return out;
}

/** 颜色数组（-1 透明）压成 runs */
function encode(values, paletteSize) {
  const runs = [];
  if (values.length === 0) return runs;
  let current = values[0];
  let count = 1;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === current) {
      count += 1;
    } else {
      runs.push([count, current]);
      current = values[i];
      count = 1;
    }
  }
  runs.push([count, current]);
  return runs.filter(([, index]) => index >= -1 && index < paletteSize);
}

/** 根据画满的像素算出这一餐的能量：颜色越丰富、涂得越满，越顶饱 */
function foodEnergy(stats) {
  const base = 6 + Math.floor(stats.colors * 1.4) + Math.round(stats.coverage / 12);
  return Math.max(8, Math.min(38, base));
}

/**
 * 每日口粮的图案（程序生成，16×16 的一块饼干），避免手写像素矩阵出错。
 */
function buildDailyFood(side = 16) {
  const body = '#d79a52';
  const edge = '#b0752f';
  const chip = '#6b3f1d';
  const palette = [body, edge, chip];
  const chips = [
    [5, 5], [10, 4], [6, 10], [11, 11], [8, 7],
  ];
  const cells = new Int16Array(side * side).fill(-1);
  const c = side / 2;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r <= c - 1.6) cells[y * side + x] = 0;
      else if (r <= c - 0.4) cells[y * side + x] = 1;
    }
  }
  for (const [cx, cy] of chips) {
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= 1.7 && cells[y * side + x] === 0) cells[y * side + x] = 2;
      }
    }
  }
  return { size: side, palette, runs: encode(Array.from(cells), palette.length) };
}

const DAILY_FOOD = buildDailyFood();

module.exports = {
  PET_SIZES,
  FOOD_SIZES,
  MAX_PALETTE,
  normalizeHex,
  validateSprite,
  decode,
  encode,
  foodEnergy,
  DAILY_FOOD,
  buildDailyFood,
};

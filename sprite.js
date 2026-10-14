/**
 * 像素画的前端表示：
 *   工作态 = { size, palette: [hex...], colors: Int16Array(size*size) }   (-1 表示透明)
 *   线上态 = { size, palette: [hex...], runs: [[长度, 下标], ...] }
 */

export const PET_SIZES = [32, 64, 128];
export const FOOD_SIZES = [16, 32, 64];
export const MAX_PALETTE = 48;

export function blankSprite(size) {
  return { size, palette: [], colors: new Int16Array(size * size).fill(-1) };
}

export function fromStored(stored) {
  const total = stored.size * stored.size;
  const colors = new Int16Array(total);
  let i = 0;
  for (const [count, index] of stored.runs) {
    for (let k = 0; k < count; k += 1) colors[i + k] = index;
    i += count;
  }
  return { size: stored.size, palette: stored.palette.slice(), colors };
}

/** 把用到的颜色重新编号，压成线上格式 */
export function toStored(working) {
  const { size, colors } = working;
  const indexOf = new Map();
  const palette = [];
  const mapped = new Int16Array(colors.length);
  for (let i = 0; i < colors.length; i += 1) {
    const value = colors[i];
    if (value < 0) {
      mapped[i] = -1;
      continue;
    }
    const hex = working.palette[value];
    if (!hex) {
      mapped[i] = -1;
      continue;
    }
    let slot = indexOf.get(hex);
    if (slot === undefined) {
      slot = palette.length;
      palette.push(hex);
      indexOf.set(hex, slot);
    }
    mapped[i] = slot;
  }
  const runs = [];
  if (mapped.length) {
    let current = mapped[0];
    let count = 1;
    for (let i = 1; i < mapped.length; i += 1) {
      if (mapped[i] === current) {
        count += 1;
      } else {
        runs.push([count, current]);
        current = mapped[i];
        count = 1;
      }
    }
    runs.push([count, current]);
  }
  return { size, palette, runs };
}

export function usedColors(working) {
  const set = new Set();
  for (const value of working.colors) {
    if (value >= 0) {
      const hex = working.palette[value];
      if (hex) set.add(hex);
    }
  }
  return [...set];
}

export function paintedCount(working) {
  let n = 0;
  for (const value of working.colors) if (value >= 0) n += 1;
  return n;
}

/** 只支持整数倍放大，保证像素是方块 */
export function upscale(working, factor) {
  const size = working.size * factor;
  const colors = new Int16Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      colors[y * size + x] = working.colors[Math.floor(y / factor) * working.size + Math.floor(x / factor)];
    }
  }
  return { size, palette: working.palette.slice(), colors };
}

/** 大致缩小：按面积占比取众数，避免细节全丢 */
export function downscale(working, targetSize) {
  const factor = working.size / targetSize;
  if (!Number.isInteger(factor)) return working;
  const colors = new Int16Array(targetSize * targetSize);
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const votes = new Map();
      for (let dy = 0; dy < factor; dy += 1) {
        for (let dx = 0; dx < factor; dx += 1) {
          const value = working.colors[(y * factor + dy) * working.size + (x * factor + dx)];
          votes.set(value, (votes.get(value) || 0) + 1);
        }
      }
      let best = -1;
      let bestCount = -1;
      for (const [value, count] of votes) {
        if (count > bestCount || (count === bestCount && value >= 0 && best < 0)) {
          best = value;
          bestCount = count;
        }
      }
      colors[y * targetSize + x] = best;
    }
  }
  return { size: targetSize, palette: working.palette.slice(), colors };
}

export function resizeTo(working, targetSize) {
  if (targetSize === working.size) return working;
  if (targetSize % working.size === 0) return upscale(working, targetSize / working.size);
  if (working.size % targetSize === 0) return downscale(working, targetSize);
  return working;
}

export function cloneSprite(working) {
  return { size: working.size, palette: working.palette.slice(), colors: working.colors.slice() };
}

/* --------------------------- 颜色小工具 --------------------------- */

export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

export function rgbToHex(r, g, b) {
  const part = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return amount >= 0
    ? rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount)
    : rgbToHex(r * (1 + amount), g * (1 + amount), b * (1 + amount));
}

export function rgbToHsl(hex) {
  const [r0, g0, b0] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hh;
  if (max === r0) hh = ((g0 - b0) / d + (g0 < b0 ? 6 : 0)) / 6;
  else if (max === g0) hh = ((b0 - r0) / d + 2) / 6;
  else hh = ((r0 - g0) / d + 4) / 6;
  return [hh, s, l];
}

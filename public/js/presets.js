/**
 * 预设宠物：不会画画也能先有一只。
 * 全部按比例生成，所以 32 / 64 / 128 都能直接用同一套公式。
 */
import { blankSprite, rgbToHex } from './sprite.js';

function paint(working, x, y, colorIndex) {
  const { size } = working;
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= size || iy >= size) return;
  working.colors[iy * size + ix] = colorIndex;
}

function rect(working, x0, y0, x1, y1, colorIndex) {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) paint(working, x, y, colorIndex);
}

function ellipse(working, cx, cy, rx, ry, colorIndex, { bottom = null } = {}) {
  const { size } = working;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const inside = dx * dx + dy * dy <= 1;
      if (!inside) continue;
      if (bottom !== null && y > bottom) continue;
      paint(working, x, y, colorIndex);
    }
  }
}

function withPalette(palette) {
  return { palette: palette.slice(), index: (i) => i };
}

/* ------------------------------- 史莱姆 ------------------------------- */

function slime(size, base = '#5cc98a') {
  const pal = withPalette([base, '#2f8f62', '#12313f', '#ffffff', '#ffd6e0']);
  const working = blankSprite(size);
  working.palette = pal.palette;
  const cx = size / 2;
  const cy = size * 0.62;
  ellipse(working, cx, cy, size * 0.42, size * 0.34, 0, { bottom: size * 0.82 });
  rect(working, Math.round(size * 0.14), Math.round(size * 0.83), Math.round(size * 0.86), Math.round(size * 0.85), 1);
  // 高光
  ellipse(working, size * 0.33, size * 0.45, size * 0.05, size * 0.035, 3);
  // 眼睛
  const eyeR = Math.max(1, size * 0.055);
  for (const sign of [-1, 1]) {
    ellipse(working, cx + sign * size * 0.16, cy - size * 0.04, eyeR, eyeR * 1.25, 2);
    paint(working, cx + sign * size * 0.16 - eyeR * 0.35, cy - size * 0.075, 3);
  }
  // 腮红
  for (const sign of [-1, 1]) ellipse(working, cx + sign * size * 0.3, cy + size * 0.14, size * 0.06, size * 0.035, 4);
  return working;
}

/* ------------------------------- 小鸡 ------------------------------- */

function chick(size, base = '#f5c542') {
  const working = blankSprite(size);
  working.palette = [base, '#e0a219', '#2a2118', '#f08a3c', '#fff3c4'];
  const cx = size / 2;
  const cy = size * 0.55;
  ellipse(working, cx, cy, size * 0.33, size * 0.36, 0);
  // 肚子
  ellipse(working, cx, cy + size * 0.14, size * 0.22, size * 0.2, 4);
  // 翅膀
  for (const sign of [-1, 1]) {
    ellipse(working, cx + sign * size * 0.28, cy + size * 0.06, size * 0.09, size * 0.13, 1);
  }
  // 眼睛
  const eyeR = Math.max(1, size * 0.05);
  for (const sign of [-1, 1]) ellipse(working, cx + sign * size * 0.13, cy - size * 0.1, eyeR, eyeR, 2);
  // 嘴
  rect(working, Math.round(cx - size * 0.05), Math.round(cy - size * 0.01), Math.round(cx + size * 0.05), Math.round(cy + size * 0.04), 3);
  paint(working, cx, cy + size * 0.06, 3);
  // 脚
  for (const sign of [-1, 1]) {
    rect(working, Math.round(cx + sign * size * 0.12), Math.round(cy + size * 0.35), Math.round(cx + sign * size * 0.12), Math.round(cy + size * 0.4), 3);
    rect(working, Math.round(cx + sign * size * 0.12 - size * 0.05), Math.round(cy + size * 0.4), Math.round(cx + sign * size * 0.12 + size * 0.05), Math.round(cy + size * 0.4), 3);
  }
  return working;
}

/* ------------------------------- 猫 ------------------------------- */

function cat(size, base = '#b9a6d6') {
  const working = blankSprite(size);
  working.palette = [base, '#8f7cba', '#2a2338', '#ffffff', '#f4a3b6'];
  const cx = size / 2;
  const headY = size * 0.46;
  const headR = size * 0.34;
  // 耳朵
  for (const sign of [-1, 1]) {
    const ex = cx + sign * headR * 0.62;
    const ey = headY - headR * 0.86;
    for (let i = 0; i < Math.max(3, size * 0.14); i += 1) {
      const w = Math.max(1, Math.round((size * 0.14 - i) * 0.75));
      rect(working, Math.round(ex - w / 2), Math.round(ey + i), Math.round(ex + w / 2), Math.round(ey + i), 0);
    }
    rect(working, Math.round(ex - size * 0.02), Math.round(ey + size * 0.05), Math.round(ex + size * 0.02), Math.round(ey + size * 0.09), 4);
  }
  ellipse(working, cx, headY, headR * 1.15, headR, 0);
  // 身体
  ellipse(working, cx, size * 0.86, size * 0.3, size * 0.18, 1);
  // 眼睛
  const eyeR = Math.max(1, size * 0.055);
  for (const sign of [-1, 1]) {
    ellipse(working, cx + sign * size * 0.13, headY - size * 0.02, eyeR, eyeR * 1.1, 2);
    paint(working, cx + sign * size * 0.13 - eyeR * 0.3, headY - size * 0.05, 3);
  }
  // 鼻子与嘴
  rect(working, Math.round(cx - size * 0.02), Math.round(headY + size * 0.08), Math.round(cx + size * 0.02), Math.round(headY + size * 0.1), 4);
  rect(working, Math.round(cx), Math.round(headY + size * 0.1), Math.round(cx), Math.round(headY + size * 0.13), 2);
  // 胡须
  for (const sign of [-1, 1]) {
    const from = Math.round(cx + sign * size * 0.26);
    const to = Math.round(cx + sign * size * 0.42);
    for (const row of [0.05, 0.12]) {
      const y = Math.round(headY + size * row);
      for (let x = Math.min(from, to); x <= Math.max(from, to); x += 1) {
        if ((x - Math.min(from, to)) % 3 === 2) continue;
        paint(working, x, y, 1);
      }
    }
  }
  return working;
}

/* ------------------------------- 小幽灵 ------------------------------- */

function ghost(size, base = '#e8f1f7') {
  const working = blankSprite(size);
  working.palette = [base, '#9fb6c9', '#2a3448', '#f4a3b6'];
  const cx = size / 2;
  const top = size * 0.16;
  const bottom = size * 0.82;
  const rx = size * 0.32;
  const left = Math.round(cx - rx);
  const right = Math.round(cx + rx);
  const wave = Math.max(2, Math.round(size * 0.05));
  const toothW = Math.max(3, Math.round((right - left) / 4));
  for (let x = left; x <= right; x += 1) {
    const dx = (x + 0.5 - cx) / rx;
    if (Math.abs(dx) > 1) continue;
    // 锯齿下摆：每个齿中间最深
    const t = ((x - left) / toothW) % 2;
    const depth = Math.round(wave * (1 - Math.abs(t - 1)));
    const maxY = Math.round(bottom) - depth;
    for (let y = Math.round(top); y <= maxY; y += 1) {
      const dy = (y + 0.5 - (top + rx)) / rx;
      if (dy < 0 && dx * dx + dy * dy > 1) continue;
      paint(working, x, y, 0);
    }
  }
  // 内描边：让浅色身体在浅底上也立得住
  const outline = working.colors.slice();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (working.colors[y * size + x] !== 0) continue;
      const neighbours = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];
      const onEdge = neighbours.some(([nx, ny]) => {
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) return true;
        return working.colors[ny * size + nx] === -1;
      });
      if (onEdge) outline[y * size + x] = 1;
    }
  }
  working.colors.set(outline);
  // 眼睛与腮红
  const eyeR = Math.max(1, size * 0.06);
  for (const sign of [-1, 1]) {
    ellipse(working, cx + sign * size * 0.13, size * 0.44, eyeR, eyeR * 1.2, 2);
    ellipse(working, cx + sign * size * 0.24, size * 0.55, size * 0.05, size * 0.03, 3);
  }
  return working;
}

/* ------------------------------ 随机小动物 ------------------------------ */

function randomBlob(size, seed) {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const hue = Math.floor(rand() * 360);
  const hsl = (hh, ss, ll) => {
    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = ll - c / 2;
    const seg = Math.floor(hh / 60) % 6;
    const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
  };
  const working = blankSprite(size);
  working.palette = [hsl(hue, 0.55, 0.6), hsl((hue + 30) % 360, 0.5, 0.42), '#20242e', '#ffffff'];
  const cx = size / 2;
  const cy = size * 0.56;
  const rx = size * (0.26 + rand() * 0.12);
  const ry = size * (0.24 + rand() * 0.14);
  const wobble = [rand() * 0.4 + 0.8, rand() * 0.4 + 0.8, rand() * 0.4 + 0.8];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const bump = 1 + 0.18 * Math.sin((x / size) * Math.PI * 2 * 2 + wobble[0]) + 0.12 * Math.sin((y / size) * Math.PI * 2 + wobble[1]);
      if (dx * dx + dy * dy <= bump) paint(working, x, y, 0);
    }
  }
  // 随机耳朵 / 角
  const earCount = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < earCount; i += 1) {
    const ex = cx + (i - (earCount - 1) / 2) * size * 0.28;
    const ey = cy - ry * 0.92;
    const h = size * (0.1 + rand() * 0.12);
    for (let k = 0; k < h; k += 1) {
      const w = Math.max(1, Math.round((h - k) * 0.5));
      rect(working, Math.round(ex - w / 2), Math.round(ey - k), Math.round(ex + w / 2), Math.round(ey - k), 1);
    }
  }
  const eyeR = Math.max(1, size * 0.055);
  for (const sign of [-1, 1]) {
    ellipse(working, cx + sign * size * 0.12, cy - size * 0.04, eyeR, eyeR * 1.15, 2);
    paint(working, cx + sign * size * 0.12 - eyeR * 0.3, cy - size * 0.07, 3);
  }
  return working;
}

export const PRESETS = [
  { id: 'slime', name: '果冻', build: (size) => slime(size) },
  { id: 'chick', name: '小鸡', build: (size) => chick(size) },
  { id: 'cat', name: '猫', build: (size) => cat(size) },
  { id: 'ghost', name: '小幽灵', build: (size) => ghost(size) },
  { id: 'random', name: '随机', build: (size) => randomBlob(size, Math.floor(Math.random() * 4294967295)) },
];

/** 食物预设 */
export const FOOD_PRESETS = [
  { id: 'cookie', name: '饼干', build: (size) => cookie(size) },
  { id: 'berry', name: '浆果', build: (size) => berry(size) },
  { id: 'leaf', name: '菜叶', build: (size) => leaf(size) },
  { id: 'random', name: '随机', build: (size) => randomFood(size, Math.floor(Math.random() * 4294967295)) },
];

function cookie(size) {
  const working = blankSprite(size);
  working.palette = ['#d79a52', '#b0752f', '#6b3f1d'];
  const c = size / 2;
  const chips = size >= 32 ? 7 : 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (r <= c - size * 0.1) paint(working, x, y, 0);
      else if (r <= c - size * 0.02) paint(working, x, y, 1);
    }
  }
  for (let i = 0; i < chips; i += 1) {
    const a = (i / chips) * Math.PI * 2 + 0.7;
    const rr = c * 0.5;
    const px = c + Math.cos(a) * rr;
    const py = c + Math.sin(a) * rr;
    ellipse(working, px, py, Math.max(1, size * 0.06), Math.max(1, size * 0.06), 2);
  }
  return working;
}

function berry(size) {
  const working = blankSprite(size);
  working.palette = ['#e8455f', '#a81f3a', '#3fa46a', '#ffffff'];
  const c = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x + 0.5 - c, y + 0.5 - c * 1.1);
      if (r <= c * 0.78) paint(working, x, y, 0);
      else if (r <= c * 0.92) paint(working, x, y, 1);
    }
  }
  ellipse(working, size * 0.38, size * 0.3, size * 0.07, size * 0.06, 3);
  for (let i = 0; i < Math.max(3, size * 0.2); i += 1) {
    const yy = size * 0.24 - i * 0.4;
    const xx = c + Math.sin(i / 1.2) * size * 0.12;
    rect(working, Math.round(xx - size * 0.07), Math.round(yy), Math.round(xx + size * 0.07), Math.round(yy), 2);
  }
  return working;
}

function leaf(size) {
  const working = blankSprite(size);
  working.palette = ['#5cbb77', '#2f8f62', '#12313f'];
  const c = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5 - c) / (c * 0.7);
      const v = (y + 0.5 - c) / (c * 0.92);
      if (u * u + v * v <= 1) paint(working, x, y, 0);
      if (u * u + v * v <= 0.55) paint(working, x, y, 1);
    }
  }
  rect(working, Math.round(c), Math.round(size * 0.08), Math.round(c), Math.round(size * 0.92), 2);
  for (let i = 0; i < 5; i += 1) {
    const y = Math.round(size * (0.24 + i * 0.14));
    rect(working, Math.round(c * 0.75), y, Math.round(c), y, 2);
    rect(working, Math.round(c), y, Math.round(c * 1.25), y, 2);
  }
  return working;
}

function randomFood(size, seed) {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const shapes = [cookie, berry, leaf];
  const base = shapes[Math.floor(rand() * shapes.length)](size);
  return base;
}

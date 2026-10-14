/** 工作态像素数据的共享工具（editor.js 与各屏幕都用） */
import { h } from './dom.js';
import { fromStored } from './sprite.js';

export const MAX_PALETTE = 48;

export function blankSprite(size) {
  return { size, palette: [], colors: new Int16Array(size * size).fill(-1) };
}

export function cloneSprite(working) {
  return { size: working.size, palette: working.palette.slice(), colors: working.colors.slice() };
}

export function spritePalette(working) {
  return working.palette.slice();
}

export function paintColorAt(working, x, y, colorIndex) {
  const { size } = working;
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  working.colors[y * size + x] = colorIndex;
}

/** 画到一个 canvas 上（1 格 = 1 像素） */
export function drawSprite(ctx, working, { offsetX = 0, offsetY = 0 } = {}) {
  ctx.clearRect(0, 0, working.size, working.size);
  for (let y = 0; y < working.size; y += 1) {
    for (let x = 0; x < working.size; x += 1) {
      const value = working.colors[y * working.size + x];
      if (value < 0) continue;
      const hex = working.palette[value];
      if (!hex) continue;
      ctx.fillStyle = hex;
      ctx.fillRect(x + offsetX, y + offsetY, 1, 1);
    }
  }
}

/** 把小图渲染成 <canvas>，按整数倍放大，保证像素是方的 */
export function spriteThumb(stored, scale = 1, className = 'thumb') {
  if (!stored) return h('div', { class: `${className} ${className}--empty` });
  const canvas = h('canvas', { class: className, width: stored.size, height: stored.size, 'aria-hidden': 'true' });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  drawSprite(ctx, fromStored(stored));
  canvas.style.width = `${stored.size * scale}px`;
  canvas.style.height = `${stored.size * scale}px`;
  return canvas;
}

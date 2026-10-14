/**
 * 图片转像素：整条链路都在浏览器里跑，图片不会上传到服务器。
 *
 * 读图 → 抠背景（四边洪泛 + 手动取色） → 缩到目标格数（预乘 alpha 面积平均）
 *      → 颜色量化（k-means，颜色数可控） → 去杂点 → 交给画板
 *
 * 抠图用的是经典办法而不是 AI 蒙版：对纯色/浅色背景的照片、logo、插画效果很好；
 * 复杂背景可以配合"点图片上的颜色去背景"手工补。所以转完建议再去画板修两笔。
 */
import { h, clear } from './dom.js';
import { rgbToHex } from './sprite.js';

const WORK_MAX = 512;
const ALPHA_KEEP = 0.45;
const COLOR_CHOICES = [8, 12, 16, 24, 32];

/** 读文件成位图；顺手按 EXIF 摆正方向 */
export async function readImageFile(file) {
  if (!file || !String(file.type).startsWith('image/')) {
    throw new Error('这不是图片文件，请用 PNG / JPG / WebP。');
  }
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    return createImageBitmap(file);
  }
}

/** 位图 → 工作画布的像素数据（长边限制在 WORK_MAX，省时间） */
export function bitmapToImageData(bitmap, max = WORK_MAX) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

/** 采样四条边，得到最像背景的 1–3 个颜色 */
export function autoBorderColors(data, width, height) {
  const buckets = new Map();
  const add = (index) => {
    const o = index * 4;
    if (data[o + 3] < 8) return;
    const key = `${data[o] >> 4},${data[o + 1] >> 4},${data[o + 2] >> 4}`;
    const slot = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    slot.n += 1;
    slot.r += data[o];
    slot.g += data[o + 1];
    slot.b += data[o + 2];
    buckets.set(key, slot);
  };
  for (let x = 0; x < width; x += 1) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    add(y * width);
    add(y * width + width - 1);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((c) => [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)]);
}

function dist2(data, index, color) {
  const o = index * 4;
  const dr = data[o] - color[0];
  const dg = data[o + 1] - color[1];
  const db = data[o + 2] - color[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * 标出连通的背景：从四条边往里洪泛。
 * 判据两条 —— 与相邻背景色接近（容忍渐变），且离边框主色不太远（防止漏进主体）。
 */
export function backgroundMask(data, width, height, { tolerance = 30, keyColors = [], seedColors = [] } = {}) {
  const mask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const tol = tolerance * 2.55;
  const tol2 = tol * tol * 3;
  const seedTol2 = tol * 1.6 * (tol * 1.6) * 3;
  // 手点的颜色收紧一点：误点主体时也不会一路顺着渐变把主体吃掉
  const keyTol = tol * 0.6;
  const keyTol2 = keyTol * keyTol * 3;

  const isBg = (index) => {
    if (keyColors.some((color) => dist2(data, index, color) <= keyTol2)) return true;
    if (seedColors.length === 0) return true;
    return seedColors.some((color) => dist2(data, index, color) <= seedTol2);
  };
  const push = (index) => {
    if (mask[index] || !isBg(index)) return;
    mask[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index - x) / width;
    const o = index * 4;
    const here = [data[o], data[o + 1], data[o + 2]];
    const around = [];
    if (x > 0) around.push(index - 1);
    if (x < width - 1) around.push(index + 1);
    if (y > 0) around.push(index - width);
    if (y < height - 1) around.push(index + width);
    for (const next of around) {
      if (mask[next]) continue;
      if (dist2(data, next, here) > tol2) continue;
      if (!isBg(next)) continue;
      mask[next] = 1;
      queue[tail++] = next;
    }
  }
  return mask;
}

/** 按 mask 去掉背景；feather 给贴边像素降一点 alpha，缩小后边缘不会太锯齿 */
export function applyMask(data, width, height, mask, { feather = 0 } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    out[o] = data[o];
    out[o + 1] = data[o + 1];
    out[o + 2] = data[o + 2];
    out[o + 3] = mask[i] ? 0 : data[o + 3];
  }
  if (feather > 0) {
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const i = y * width + x;
        if (mask[i]) continue;
        if (!(mask[i - 1] || mask[i + 1] || mask[i - width] || mask[i + width])) continue;
        out[i * 4 + 3] = Math.min(out[i * 4 + 3], Math.round((1 - feather) * 255));
      }
    }
  }
  return out;
}

/** 面积平均缩到 tw×th；按预乘 alpha 累加，避免边缘发黑 */
export function downscaleTo(rgba, width, height, tw, th) {
  const sumR = new Float64Array(tw * th);
  const sumG = new Float64Array(tw * th);
  const sumB = new Float64Array(tw * th);
  const sumA = new Float64Array(tw * th);
  const count = new Float64Array(tw * th);
  for (let y = 0; y < height; y += 1) {
    const ty = Math.min(th - 1, Math.floor((y * th) / height));
    for (let x = 0; x < width; x += 1) {
      const tx = Math.min(tw - 1, Math.floor((x * tw) / width));
      const cell = ty * tw + tx;
      const o = (y * width + x) * 4;
      const a = rgba[o + 3] / 255;
      sumR[cell] += rgba[o] * a;
      sumG[cell] += rgba[o + 1] * a;
      sumB[cell] += rgba[o + 2] * a;
      sumA[cell] += a;
      count[cell] += 1;
    }
  }
  const rgb = new Uint8ClampedArray(tw * th * 3);
  const alpha = new Float32Array(tw * th);
  for (let i = 0; i < tw * th; i += 1) {
    if (count[i] === 0) {
      // 放大的时候会有目标格没被任何源像素覆盖到：就近取一个源像素补上
      const tx = i % tw;
      const ty = (i - tx) / tw;
      const sx = Math.min(width - 1, Math.floor(((tx + 0.5) * width) / tw));
      const sy = Math.min(height - 1, Math.floor(((ty + 0.5) * height) / th));
      const o = (sy * width + sx) * 4;
      rgb[i * 3] = rgba[o];
      rgb[i * 3 + 1] = rgba[o + 1];
      rgb[i * 3 + 2] = rgba[o + 2];
      alpha[i] = rgba[o + 3] / 255;
      continue;
    }
    const a = sumA[i];
    if (a > 0.0001) {
      rgb[i * 3] = sumR[i] / a;
      rgb[i * 3 + 1] = sumG[i] / a;
      rgb[i * 3 + 2] = sumB[i] / a;
    }
    alpha[i] = a / count[i];
  }
  return { rgb, alpha };
}

/** 主体的外接框（把四周的空背景裁掉） */
export function contentBox(mask, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function cropRgba(rgba, width, box) {
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const from = ((box.y + y) * width + box.x) * 4;
    out.set(rgba.subarray(from, from + box.width * 4), y * box.width * 4);
  }
  return out;
}

/** 按比例塞进 size×size 的正方形画布，居中，四周留 pad 格 */
export function fitIntoGrid(rgba, width, height, size, pad = 1) {
  const inner = Math.max(1, size - pad * 2);
  const scale = Math.min(inner / width, inner / height);
  const tw = Math.max(1, Math.min(inner, Math.round(width * scale)));
  const th = Math.max(1, Math.min(inner, Math.round(height * scale)));
  const scaled = downscaleTo(rgba, width, height, tw, th);
  const rgb = new Uint8ClampedArray(size * size * 3);
  const alpha = new Float32Array(size * size);
  const ox = Math.floor((size - tw) / 2);
  const oy = Math.floor((size - th) / 2);
  for (let y = 0; y < th; y += 1) {
    for (let x = 0; x < tw; x += 1) {
      const from = y * tw + x;
      const to = (oy + y) * size + (ox + x);
      rgb[to * 3] = scaled.rgb[from * 3];
      rgb[to * 3 + 1] = scaled.rgb[from * 3 + 1];
      rgb[to * 3 + 2] = scaled.rgb[from * 3 + 2];
      alpha[to] = scaled.alpha[from];
    }
  }
  return { rgb, alpha };
}
export function pixelDistance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** k-means 压色：最远点法初始化，结果稳定，不随机跳 */
export function quantize(rgb, alpha, size, k) {
  const samples = [];
  const stride = Math.max(1, Math.floor((size * size) / 4096));
  for (let i = 0; i < size * size; i += stride) {
    if (alpha[i] < ALPHA_KEEP) continue;
    samples.push([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
  }
  if (samples.length === 0) return [];
  const mean = [0, 1, 2].map((c) => samples.reduce((sum, p) => sum + p[c], 0) / samples.length);
  const centroids = [mean];
  while (centroids.length < Math.min(k, samples.length)) {
    let best = null;
    let bestDist = -1;
    for (const p of samples) {
      const d = Math.min(...centroids.map((c) => pixelDistance(p, c)));
      if (d > bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (!best || bestDist <= 0) break;
    centroids.push([...best]);
  }
  for (let iter = 0; iter < 10; iter += 1) {
    const acc = centroids.map(() => [0, 0, 0, 0]);
    for (const p of samples) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const d = pixelDistance(p, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      acc[best][0] += p[0];
      acc[best][1] += p[1];
      acc[best][2] += p[2];
      acc[best][3] += 1;
    }
    for (let c = 0; c < centroids.length; c += 1) {
      if (acc[c][3] === 0) continue;
      centroids[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
    }
  }
  return centroids;
}

/** 每个格子指派到最近的调色板色；透明格子为 -1 */
export function assign(rgb, alpha, size, centroids) {
  const colors = new Int16Array(size * size).fill(-1);
  for (let i = 0; i < size * size; i += 1) {
    if (alpha[i] < ALPHA_KEEP || centroids.length === 0) continue;
    const p = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < centroids.length; c += 1) {
      const d = pixelDistance(p, centroids[c]);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    colors[i] = best;
  }
  return colors;
}

/** 去孤立杂点：四邻里同色占多数时，跟随多数 */
export function denoise(colors, size) {
  const out = colors.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? -1 : colors[y * size + x]);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const around = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter((v) => v >= 0);
      if (around.length < 3) continue;
      const votes = new Map();
      for (const v of around) votes.set(v, (votes.get(v) || 0) + 1);
      let top = colors[i];
      let topCount = 0;
      for (const [value, n] of votes) {
        if (n > topCount) {
          topCount = n;
          top = value;
        }
      }
      if (topCount >= 3 && top !== colors[i]) out[i] = top;
    }
  }
  return out;
}

/** 一站式：位图 → 画板用的工作态精灵 */
export function imageToSprite(bitmap, size, options = {}) {
  const { tolerance = 30, colors = 16, keyColors = [], feather = 0.5, smooth = true, autocrop = true } = options;
  const { data, width, height } = bitmapToImageData(bitmap);
  const seedColors = autoBorderColors(data, width, height);
  const mask = backgroundMask(data, width, height, { tolerance, keyColors, seedColors });
  const cut = applyMask(data, width, height, mask, { feather });
  const box = autocrop ? contentBox(mask, width, height) : null;
  const cropped = box ? cropRgba(cut, width, box) : cut;
  const cw = box ? box.width : width;
  const ch = box ? box.height : height;
  const scaled = box ? fitIntoGrid(cropped, cw, ch, size, size >= 24 ? 1 : 0) : downscaleTo(cropped, cw, ch, size, size);
  const centroids = quantize(scaled.rgb, scaled.alpha, size, colors);
  let idx = assign(scaled.rgb, scaled.alpha, size, centroids);
  if (smooth) idx = denoise(idx, size);
  const painted = idx.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
  return {
    sprite: { size, palette: centroids.map((c) => rgbToHex(c[0], c[1], c[2])), colors: idx },
    painted,
    cut,
    mask,
    width,
    height,
  };
}

/* ------------------------------- 界面部分 ------------------------------- */

export function createImportPanel({ getTargetSize, onApply, onNotice = () => {} }) {
  let bitmap = null;
  let keyColors = [];
  let tolerance = 30;
  let colorCount = 16;
  let last = null;
  let busy = false;
  let note = '';

  const status = h('p', { class: 'tiny faint import__status' }, '支持 PNG / JPG / WebP；图片只在你浏览器里处理，不会上传。');
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' });
  const pickBtn = h('button', { type: 'button', class: 'btn btn--sm' }, '选择图片');
  const srcCanvas = h('canvas', { class: 'import__canvas', title: '点图上的颜色，就把这种颜色也当背景去掉' });
  const outCanvas = h('canvas', { class: 'import__canvas' });
  const paletteHost = h('div', { class: 'import__palette' });
  const grid = h(
    'div',
    { class: 'import__grid', hidden: true },
    h('div', { class: 'import__figure' }, srcCanvas, h('p', { class: 'tiny faint' }, '抠完的背景层（点颜色可继续去）')),
    h('div', { class: 'import__figure' }, outCanvas, paletteHost, h('p', { class: 'tiny faint' }, '转换结果')),
  );
  const tolInput = h('input', { type: 'range', min: '5', max: '80', step: '1', value: String(tolerance), class: 'import__range' });
  const tolValue = h('span', { class: 'mono tiny' }, String(tolerance));
  const colorRow = h('div', { class: 'chiprow' });
  const applyBtn = h('button', { type: 'button', class: 'btn btn--sm btn--primary' }, '用到画板');
  const resetBtn = h('button', { type: 'button', class: 'btn btn--sm btn--ghost' }, '清掉手选的背景色');
  const controls = h(
    'div',
    { class: 'import__controls', hidden: true },
    h('label', { class: 'import__control' }, h('span', { class: 'mono tiny' }, '背景容差'), tolInput, tolValue),
    h('div', { class: 'import__control' }, h('span', { class: 'mono tiny' }, '颜色数'), colorRow),
    h('div', { class: 'import__actions' }, applyBtn, resetBtn),
  );

  function renderColors() {
    clear(colorRow);
    for (const n of COLOR_CHOICES) {
      colorRow.append(
        h(
          'button',
          {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(n === colorCount),
            onclick: () => {
              colorCount = n;
              renderColors();
              run();
            },
          },
          String(n),
        ),
      );
    }
  }

  function paint() {
    if (!last) return;
    srcCanvas.width = last.width;
    srcCanvas.height = last.height;
    srcCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(last.cut), last.width, last.height), 0, 0);
    const srcScale = Math.min(1, 200 / Math.max(last.width, last.height));
    srcCanvas.style.width = `${Math.round(last.width * srcScale)}px`;
    srcCanvas.style.height = `${Math.round(last.height * srcScale)}px`;

    const { sprite } = last;
    outCanvas.width = sprite.size;
    outCanvas.height = sprite.size;
    const ctx = outCanvas.getContext('2d');
    ctx.clearRect(0, 0, sprite.size, sprite.size);
    for (let y = 0; y < sprite.size; y += 1) {
      for (let x = 0; x < sprite.size; x += 1) {
        const value = sprite.colors[y * sprite.size + x];
        if (value < 0) continue;
        ctx.fillStyle = sprite.palette[value];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const outScale = Math.max(1, Math.floor(200 / sprite.size));
    outCanvas.style.width = `${sprite.size * outScale}px`;
    outCanvas.style.height = `${sprite.size * outScale}px`;

    clear(paletteHost);
    for (const hex of sprite.palette) {
      paletteHost.append(h('span', { class: 'import__swatch', style: { background: hex }, title: hex }));
    }
  }

  function run() {
    if (!bitmap || busy) return;
    busy = true;
    status.textContent = '正在抠图并压缩…';
    requestAnimationFrame(() => {
      try {
        const size = getTargetSize();
        last = imageToSprite(bitmap, size, { tolerance, colors: colorCount, keyColors });
        paint();
        grid.hidden = false;
        controls.hidden = false;
        const coverage = Math.round((last.painted / (size * size)) * 100);
        status.textContent = `${note}${size}×${size} 格，留下 ${last.painted} 格（${coverage}%），用了 ${last.sprite.palette.length} 种颜色。不满意就调容差，或点左图上的颜色继续去背景。`;
      } catch (err) {
        status.textContent = `转换失败：${err.message}`;
      } finally {
        busy = false;
      }
    });
  }

  async function loadFile(file) {
    if (!file) return;
    try {
      bitmap = await readImageFile(file);
    } catch (err) {
      status.textContent = err.message;
      return;
    }
    keyColors = [];
    note = '';
    run();
  }

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => loadFile(fileInput.files && fileInput.files[0]));
  tolInput.addEventListener('input', () => {
    tolerance = Number(tolInput.value);
    tolValue.textContent = String(tolerance);
  });
  tolInput.addEventListener('change', run);

  srcCanvas.addEventListener('click', (event) => {
    if (!last) return;
    const rect = srcCanvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * last.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * last.height);
    if (x < 0 || y < 0 || x >= last.width || y >= last.height) return;
    const o = (y * last.width + x) * 4;
    if (last.mask && last.mask[y * last.width + x]) {
      note = '这里已经是透明的了，换个位置点。';
      run();
      return;
    }
    keyColors = [...keyColors, [last.cut[o], last.cut[o + 1], last.cut[o + 2]]];
    const hex = rgbToHex(last.cut[o], last.cut[o + 1], last.cut[o + 2]);
    note = `已把 ${hex} 也当作背景（误伤主体就点「清掉手选的背景色」）。`;
    run();
  });

  applyBtn.addEventListener('click', () => {
    if (!last) return;
    onApply(last.sprite);
    onNotice(`已经转到画板上了：${last.sprite.size}×${last.sprite.size}，${last.sprite.palette.length} 种颜色。`);
  });

  resetBtn.addEventListener('click', () => {
    keyColors = [];
    note = '';
    run();
  });

  const dropZone = h(
    'div',
    {
      class: 'import__drop',
      ondragover: (event) => {
        event.preventDefault();
        dropZone.classList.add('import__drop--hot');
      },
      ondragleave: () => dropZone.classList.remove('import__drop--hot'),
      ondrop: (event) => {
        event.preventDefault();
        dropZone.classList.remove('import__drop--hot');
        const files = event.dataTransfer && event.dataTransfer.files;
        loadFile(files && files[0]);
      },
    },
    pickBtn,
    h('span', { class: 'tiny muted' }, '或把图片拖到这里'),
    fileInput,
  );

  const el = h(
    'section',
    { class: 'import panel' },
    h('p', { class: 'label mono' }, '从图片转像素'),
    dropZone,
    status,
    grid,
    controls,
  );

  renderColors();

  return {
    el,
    refresh() {
      if (bitmap) run();
    },
  };
}

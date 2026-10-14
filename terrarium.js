/**
 * 像素玻璃缸：一个纯 canvas 的小世界。
 * 场景和宠物共用同一套像素网格 —— 场景画在逻辑坐标系里，
 * 宠物按 1:1 原尺寸绘制后再整体对齐，所以两者的格子永远是同一个大小。
 */
import { fromStored } from './sprite.js';

const BASE_W = 160;
const GROUND_ROWS = 16;
const MIN_H = 90;
const SKY_FOR_PET = 34;

const SKY_BANDS = ['#cfe7f2', '#c3ddec', '#b6d5e6', '#a9cde0'];
const HILL_FAR = '#a3c8b4';
const HILL_NEAR = '#82b78c';
const GROUND = '#6fa877';
const GROUND_EDGE = '#86bd8e';
const TUFT = '#55905f';
const STONE = '#9fb1b4';
const CLOUD = '#f8fbfc';
const CLOUD_SHADE = '#dce9ef';
const SUN = '#ffe9a2';
const SUN_CORE = '#fff5c8';
const FLOWER = '#ef4265';
const FLOWER_CORE = '#fdf3f7';

const CLOUDS = [
  { rects: [[0, 2, 14, 3], [3, 0, 7, 2], [9, 3, 5, 2]], x: 18, y: 12, speed: 1.6 },
  { rects: [[0, 1, 9, 2], [2, 0, 5, 2]], x: 96, y: 34, speed: 2.7 },
];

export function createTerrarium(host, { sprite = null, interactive = true, onPoke = null } = {}) {
  const scene = document.createElement('canvas');
  scene.className = 'terrarium__scene';
  const pet = document.createElement('canvas');
  pet.className = 'terrarium__pet';
  host.append(scene, pet);

  const sceneCtx = scene.getContext('2d');
  const petCtx = pet.getContext('2d');
  if ('imageSmoothingEnabled' in sceneCtx) sceneCtx.imageSmoothingEnabled = false;
  if ('imageSmoothingEnabled' in petCtx) petCtx.imageSmoothingEnabled = false;

  let state = { sprite: sprite ? fromStored(sprite) : null, hunger: 70, affection: 40 };
  let layout = { w: BASE_W, h: MIN_H, displayW: BASE_W * 2, groundTop: MIN_H - GROUND_ROWS, petLeft: 0, petTop: 0 };
  let hillsFar = [];
  let hillsNear = [];
  let decorations = { tufts: [], flowers: [], stones: [] };
  let rowRuns = [];
  let raf = 0;
  let lastT = 0;
  let clock = 0;
  let bobPhase = 0;
  let squashUntil = 0;
  let squashAmount = 0;
  let hopUntil = 0;
  let particles = [];

  function petFits() {
    return state.sprite ? state.sprite.size : 32;
  }

  function computeLayout() {
    const petSize = petFits();
    const logicalW = Math.max(BASE_W, petSize + 40);
    const logicalH = Math.max(MIN_H, petSize + GROUND_ROWS + SKY_FOR_PET - 4);
    const displayW = targetDisplayWidth(logicalW, logicalH);

    layout = {
      w: logicalW,
      h: logicalH,
      displayW,
      groundTop: logicalH - GROUND_ROWS,
      petSize,
    };
    // 后备分辨率就是逻辑尺寸，显示尺寸交给 CSS 铺满 —— 绘制坐标与画布坐标始终保持一致
    scene.width = logicalW;
    scene.height = logicalH;
    pet.width = petSize;
    pet.height = petSize;
    host.style.width = `${displayW}px`;
    host.style.aspectRatio = `${logicalW} / ${logicalH}`;
    scene.style.width = '100%';
    scene.style.height = 'auto';

    const centre = Math.round(logicalW * 0.42);
    layout.petLeft = Math.max(4, Math.min(logicalW - petSize - 4, centre - Math.round(petSize / 2)));
    layout.petTop = layout.groundTop - petSize;
    // 位置一律用百分比：显示尺寸怎么变，宠物和场景都还贴在同一个格子上
    pet.style.width = `${((petSize / logicalW) * 100).toFixed(4)}%`;
    pet.style.height = 'auto';
    pet.style.left = `${((layout.petLeft / logicalW) * 100).toFixed(4)}%`;
    pet.style.bottom = `${((GROUND_ROWS / logicalH) * 100).toFixed(4)}%`;

    hillsFar = [];
    hillsNear = [];
    const horizon = layout.groundTop - 8;
    const horizon2 = layout.groundTop - 4;
    for (let x = 0; x < logicalW; x += 1) {
      hillsFar.push(horizon - (5 + 4 * Math.sin(x / 23) + 3 * Math.sin(x / 7.5 + 2)));
      hillsNear.push(horizon2 - (4 + 3 * Math.sin(x / 17 + 1.5)));
    }
    const tuftCount = Math.round(logicalW / 14);
    decorations = { tufts: [], flowers: [], stones: [] };
    for (let i = 0; i < tuftCount; i += 1) {
      const x = Math.round(((i + 0.5) * logicalW) / tuftCount + ((i % 3) - 1) * 3);
      decorations.tufts.push([x, layout.groundTop + 1 + (i % 2)]);
    }
    decorations.flowers = [
      [Math.round(logicalW * 0.14), layout.groundTop + 3],
      [Math.round(logicalW * 0.8), layout.groundTop + 5],
      [Math.round(logicalW * 0.64), layout.groundTop + 2],
    ];
    decorations.stones = [
      [Math.round(logicalW * 0.28), layout.groundTop + 7],
      [Math.round(logicalW * 0.9), layout.groundTop + 9],
    ];
    cachePetRows();
    renderScene();
    renderPet();
  }

  function availableWidth() {
    const parent = host.parentElement;
    const fromParent = parent ? parent.clientWidth : 0;
    if (fromParent > 0) return fromParent;
    return Math.max(240, window.innerWidth - 40);
  }

  /** 显示宽度：铺满容器，但不超过高度预算允许的宽度（可用宽度只看容器，绝不读自己） */
  function targetDisplayWidth(logicalW, logicalH) {
    const availW = availableWidth();
    const maxH = window.matchMedia('(max-width: 680px)').matches ? 340 : 520;
    const byHeight = Math.floor((maxH * logicalW) / logicalH);
    return Math.max(180, Math.min(availW, byHeight));
  }

  function cachePetRows() {
    rowRuns = [];
    const working = state.sprite;
    if (!working) return;
    for (let y = 0; y < working.size; y += 1) {
      const runs = [];
      let x = 0;
      while (x < working.size) {
        const value = working.colors[y * working.size + x];
        let width = 1;
        while (x + width < working.size && working.colors[y * working.size + x + width] === value) width += 1;
        if (value >= 0 && working.palette[value]) runs.push([x, width, working.palette[value]]);
        x += width;
      }
      rowRuns.push(runs);
    }
  }

  function renderScene() {
    const { w, h, groundTop } = layout;
    sceneCtx.clearRect(0, 0, w, h);

    // 天空：四条硬边色带
    const bandH = Math.ceil(groundTop / SKY_BANDS.length);
    for (let i = 0; i < SKY_BANDS.length; i += 1) {
      sceneCtx.fillStyle = SKY_BANDS[i];
      const y0 = i * bandH;
      const height = Math.min(bandH, groundTop - y0);
      if (height > 0) sceneCtx.fillRect(0, y0, w, height);
    }

    // 太阳
    const sunX = w - 26;
    const sunY = 12 + Math.min(10, groundTop * 0.08);
    pixelDisc(sceneCtx, sunX, sunY, 6.4, SUN);
    pixelDisc(sceneCtx, sunX, sunY, 3.6, SUN_CORE);

    // 云
    for (const cloud of CLOUDS) {
      const span = w + 40;
      const cx = ((cloud.x + (clock / 1000) * cloud.speed) % span) - 20;
      for (const [dx, dy, cw, ch] of cloud.rects) {
        const px = Math.round(cx + dx);
        const py = Math.round(cloud.y + dy - 6 + Math.min(14, groundTop * 0.08));
        if (py > groundTop - 4) continue;
        sceneCtx.fillStyle = CLOUD;
        sceneCtx.fillRect(px, py, cw, ch);
        sceneCtx.fillStyle = CLOUD_SHADE;
        sceneCtx.fillRect(px, py + ch - 1, cw, 1);
      }
    }

    // 远山与近山
    sceneCtx.fillStyle = HILL_FAR;
    for (let x = 0; x < w; x += 1) sceneCtx.fillRect(x, hillsFar[x], 1, groundTop - hillsFar[x]);
    sceneCtx.fillStyle = HILL_NEAR;
    for (let x = 0; x < w; x += 1) sceneCtx.fillRect(x, hillsNear[x], 1, groundTop - hillsNear[x]);

    // 地面
    sceneCtx.fillStyle = GROUND;
    sceneCtx.fillRect(0, groundTop, w, h - groundTop);
    sceneCtx.fillStyle = GROUND_EDGE;
    sceneCtx.fillRect(0, groundTop, w, 1);
    sceneCtx.fillStyle = TUFT;
    for (const [x, y] of decorations.tufts) {
      sceneCtx.fillRect(x, y, 1, 2);
      sceneCtx.fillRect(x - 2, y + 1, 1, 1);
      sceneCtx.fillRect(x + 2, y + 1, 1, 1);
    }
    sceneCtx.fillStyle = STONE;
    for (const [x, y] of decorations.stones) {
      sceneCtx.fillRect(x, y, 2, 2);
      sceneCtx.fillRect(x + 1, y - 1, 1, 1);
    }
    for (const [x, y] of decorations.flowers) {
      sceneCtx.fillStyle = FLOWER;
      sceneCtx.fillRect(x - 1, y, 3, 1);
      sceneCtx.fillRect(x, y - 1, 1, 3);
      sceneCtx.fillStyle = FLOWER_CORE;
      sceneCtx.fillRect(x, y, 1, 1);
    }
  }

  function pixelDisc(ctx, cx, cy, r, color) {
    ctx.fillStyle = color;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      const dy = y + 0.5 - cy;
      const span = Math.sqrt(Math.max(0, r * r - dy * dy));
      if (span <= 0) continue;
      ctx.fillRect(Math.round(cx - span), y, Math.max(1, Math.round(span * 2)), 1);
    }
  }

  function renderPet() {
    const size = layout.petSize;
    petCtx.clearRect(0, 0, size, size);
    if (!state.sprite || rowRuns.length === 0) return;
    const hungry = state.hunger < 20;
    let yOffset = 0;
    const bobStep = Math.floor(clock / (hungry ? 1100 : 620)) % 2;
    if (bobStep === 1) yOffset -= 1;
    if (hungry) yOffset += 2;
    if (clock < hopUntil) yOffset -= 3;

    let drop = 0;
    if (clock < squashUntil && squashAmount > 0) {
      drop = Math.max(1, Math.round(size * squashAmount));
    }

    for (let y = 0; y < size; y += 1) {
      let targetY = y + yOffset;
      if (drop > 0) {
        const skipped = Math.floor((y * drop) / size);
        targetY = y - skipped + yOffset + drop;
      }
      for (const [x, width, color] of rowRuns[y]) {
        petCtx.fillStyle = color;
        petCtx.fillRect(x, targetY, width, 1);
      }
    }
  }

  /* ----------------------------- 粒子效果 ----------------------------- */

  function spawnCrumb(x, y, tx, ty) {
    const steps = 22 + Math.random() * 8;
    particles.push({
      kind: 'crumb',
      x,
      y,
      vx: (tx - x) / steps,
      vy: (ty - y) / steps - 1.4,
      g: 0.11,
      life: steps * 1.1,
      color: ['#d79a52', '#b0752f', '#f5b32e'][Math.floor(Math.random() * 3)],
      size: Math.random() < 0.4 ? 1 : 2,
    });
  }

  function spawnHeart(x, y) {
    particles.push({
      kind: 'heart',
      x,
      y,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -0.32 - Math.random() * 0.16,
      g: -0.004,
      life: 60,
      color: '#ef4265',
      size: 2,
    });
  }

  function stepParticles(dt) {
    if (particles.length === 0) return;
    const frames = dt / (1000 / 60);
    particles = particles.filter((p) => {
      p.vy += p.g * frames;
      p.x += p.vx * frames;
      p.y += p.vy * frames;
      p.life -= frames;
      return p.life > 0 && p.y < layout.h + 6;
    });
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = p.kind === 'heart' ? Math.max(0, Math.min(1, p.life / 40)) : 1;
      sceneCtx.globalAlpha = alpha;
      sceneCtx.fillStyle = p.color;
      if (p.kind === 'heart') {
        const s = p.size;
        sceneCtx.fillRect(Math.round(p.x) - s, Math.round(p.y), s, s);
        sceneCtx.fillRect(Math.round(p.x) + s, Math.round(p.y), s, s);
        sceneCtx.fillRect(Math.round(p.x), Math.round(p.y) + s, s, s);
        sceneCtx.fillRect(Math.round(p.x), Math.round(p.y) + s * 2, s, s);
      } else {
        sceneCtx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
    }
    sceneCtx.globalAlpha = 1;
  }

  /* -------------------------------- 主循环 -------------------------------- */

  function mouthPoint() {
    return {
      x: layout.petLeft + layout.petSize * 0.5,
      y: layout.petTop + layout.petSize * 0.66,
    };
  }

  function step(t) {
    if (!lastT) lastT = t;
    const dt = Math.min(80, t - lastT);
    lastT = t;
    clock += dt;
    stepParticles(dt);
    renderScene();
    drawParticles();
    renderPet();
    raf = requestAnimationFrame(step);
  }

  /* -------------------------------- 交互 -------------------------------- */

  function feed() {
    const target = mouthPoint();
    for (let i = 0; i < 7; i += 1) {
      spawnCrumb(
        layout.w * 0.8 + (Math.random() - 0.5) * 8,
        4 + Math.random() * 6,
        target.x + (Math.random() - 0.5) * 8,
        target.y - 2,
      );
    }
    squashUntil = clock + 520;
    squashAmount = 0.12;
    setTimeout(() => {
      squashUntil = clock + 280;
      squashAmount = 0.06;
      const m = mouthPoint();
      for (let i = 0; i < 3; i += 1) spawnHeart(m.x + (Math.random() - 0.5) * 20, m.y - 10 - i * 4);
    }, 620);
  }

  function poke() {
    hopUntil = clock + 260;
    const m = mouthPoint();
    spawnHeart(m.x + 6, m.y - 14);
    if (onPoke) onPoke();
  }

  if (interactive) {
    pet.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      poke();
    });
  }

  const observer = new ResizeObserver(() => {
    const want = targetDisplayWidth(layout.w, layout.h);
    if (Math.abs(want - layout.displayW) > 1) computeLayout();
  });
  if (host.parentElement) observer.observe(host.parentElement);

  computeLayout();
  raf = requestAnimationFrame(step);

  return {
    setSprite(stored) {
      state.sprite = stored ? fromStored(stored) : null;
      computeLayout();
    },
    setMood({ hunger, affection }) {
      if (typeof hunger === 'number') state.hunger = hunger;
      if (typeof affection === 'number') state.affection = affection;
    },
    feed,
    poke,
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.remove();
      pet.remove();
    },
  };
}

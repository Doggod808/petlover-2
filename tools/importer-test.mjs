/**
 * 图片转像素的单元测试（纯逻辑，不需要浏览器）。
 * 运行：node tools/importer-test.mjs
 */
import {
  autoBorderColors,
  backgroundMask,
  applyMask,
  contentBox,
  cropRgba,
  fitIntoGrid,
  downscaleTo,
  quantize,
  assign,
  denoise,
} from '../public/js/importer.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  \u2717 ${name} ${detail}`);
  }
}

/** 40×40：白底 + 中间 20×20 的红方块 + 一圈浅灰阴影，模拟"照片本身" */
function makeImage(w = 40, h = 40) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const inSquare = x >= 10 && x < 30 && y >= 10 && y < 30;
      const inShadow = !inSquare && x >= 8 && x < 32 && y >= 28 && y < 33;
      const color = inSquare ? [230, 60, 90] : inShadow ? [236, 236, 236] : [255, 255, 255];
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = 255;
    }
  }
  return data;
}

const W = 40;
const H = 40;
const data = makeImage();

console.log('\n[1] 识别背景色');
const seeds = autoBorderColors(data, W, H);
check('边框采样到的主色是白色', seeds.length > 0 && seeds[0][0] > 250 && seeds[0][1] > 250 && seeds[0][2] > 250, JSON.stringify(seeds));

console.log('\n[2] 抠背景');
const mask = backgroundMask(data, W, H, { tolerance: 30, seedColors: seeds });
check('四角被判为背景', mask[0] === 1 && mask[W - 1] === 1 && mask[(H - 1) * W] === 1);
check('主体中心被保留', mask[20 * W + 20] === 0);
let bgCount = 0;
for (const v of mask) if (v) bgCount += 1;
check('浅灰阴影也一起被抠掉（因为接近白色）', mask[30 * W + 12] === 1, `mask=${mask[30 * W + 12]}`);
check('背景占比合理（六成以上）', bgCount / (W * H) > 0.6, `${Math.round((bgCount / (W * H)) * 100)}%`);

console.log('\n[3] 外接框与裁切');
const box = contentBox(mask, W, H);
check('外接框正好套住红方块', box && box.x === 10 && box.y === 10 && box.width === 20 && box.height === 20, JSON.stringify(box));
const cut = applyMask(data, W, H, mask, { feather: 0 });
check('背景像素 alpha 归零', cut[0 * 4 + 3] === 0);
check('主体像素 alpha 保留', cut[(20 * W + 20) * 4 + 3] === 255);
const crop = cropRgba(cut, W, box);
check('裁切后的尺寸正确', crop.length === 20 * 20 * 4);

console.log('\n[4] 缩到画布 + 按比例居中');
const fitted = fitIntoGrid(crop, 20, 20, 32, 1);
let opaque = 0;
for (const a of fitted.alpha) if (a >= 0.45) opaque += 1;
check('方形主体被撑到 30×30（含 1 格边距）', opaque === 900, `实际 ${opaque}`);
check('内容是居中的（左上角留白）', fitted.alpha[0] === 0 && fitted.alpha[15 * 32 + 15] > 0.9);

const wide = downscaleTo(crop, 20, 20, 8, 4);
check('非正方形缩小也正常', wide.alpha.length === 32 && wide.rgb.length === 96);

console.log('\n[5] 压色与指派');
const centroids = quantize(fitted.rgb, fitted.alpha, 32, 8);
check('纯色主体只压出 1 种颜色', centroids.length === 1, `得到 ${centroids.length} 种`);
check('压出的颜色接近红方块', Math.abs(centroids[0][0] - 230) < 6 && Math.abs(centroids[0][1] - 60) < 6, JSON.stringify(centroids[0]));
const idx = assign(fitted.rgb, fitted.alpha, 32, centroids);
let painted = 0;
for (const v of idx) if (v >= 0) painted += 1;
check('指派后涂色格数与不透明格数一致', painted === 900, `实际 ${painted}`);
check('透明格子为 -1', idx[0] === -1);
const cleaned = denoise(idx, 32);
check('去杂点不会破坏成片色块', cleaned.every((v, i) => v === idx[i]));

console.log('\n[6] 容差边界');
const noSeeds = backgroundMask(data, W, H, { tolerance: 1, seedColors: seeds });
let strictBg = 0;
for (const v of noSeeds) if (v) strictBg += 1;
check('容差调到 1 时不会把浅灰阴影误判为背景', noSeeds[30 * W + 12] === 0, `mask=${noSeeds[30 * W + 12]}`);
check('容差调到 1 时仍然抠得掉纯白背景', strictBg > 0);

console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
if (failures.length) {
  console.log('失败明细：');
  for (const item of failures) console.log(` - ${item}`);
}
process.exit(fail === 0 ? 0 : 1);

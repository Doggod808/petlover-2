import { h } from '../dom.js';
import { createTerrarium } from '../terrarium.js';
import { PRESETS, FOOD_PRESETS } from '../presets.js';
import { toStored } from '../sprite.js';
import { spriteThumb } from '../paint.js';

const DEMO_NAME = '苔苔';
const POKE_LINES = [
  '苔苔把脚边那排草踩歪了。',
  '苔苔盯着那片云看了很久。',
  '苔苔原地弹了两下，假装什么都没发生。',
  '苔苔挪了半格，想离水洼近一点。',
  '苔苔在数自己身上有几格是绿的。',
];
const FEED_LINES = [
  '苔苔一口就吃完了，嘴角什么都没有。',
  '苔苔把饼干碎屑捡得干干净净。',
  '苔苔嚼了两下，满意地原地晃了晃。',
];

function bubbleGlyph(size = 32) {
  const colors = new Int16Array(size * size).fill(-1);
  const palette = ['#f4f7f6', '#2a3448', '#8b979e'];
  const x0 = Math.round(size * 0.1);
  const x1 = Math.round(size * 0.9);
  const y0 = Math.round(size * 0.18);
  const y1 = Math.round(size * 0.62);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      colors[y * size + x] = edge ? 1 : 0;
    }
  }
  const tailX = Math.round(size * 0.28);
  for (let i = 0; i < Math.round(size * 0.18); i += 1) {
    for (let x = tailX; x < tailX + Math.round(size * 0.14) - i; x += 1) {
      colors[(y1 + 1 + i) * size + x] = 1;
      if (x > tailX) colors[(y1 + 1 + i) * size + x] = 0;
    }
  }
  for (let i = 0; i < 3; i += 1) {
    const cx = Math.round(size * (0.3 + i * 0.2));
    const cy = Math.round((y0 + y1) / 2);
    const r = Math.max(1, Math.round(size * 0.05));
    for (let y = cy - r; y <= cy + r; y += 1) {
      for (let x = cx - r; x <= cx + r; x += 1) colors[y * size + x] = 2;
    }
  }
  return { size, palette, colors };
}

function stepArt(kind) {
  if (kind === 'draw') {
    const working = PRESETS[0].build(32);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 16; x < 32; x += 1) working.colors[y * 32 + x] = -1;
    }
    return toStored(working);
  }
  if (kind === 'feed') return toStored(FOOD_PRESETS[0].build(32));
  return toStored(bubbleGlyph(32));
}

export function landingScreen({ store, navigate }) {
  const demoStored = toStored(PRESETS[0].build(32));
  const stage = h('div', { class: 'terrarium-host' });
  const line = h('p', { class: 'stagebar__line mono tiny' }, `${DEMO_NAME} 正在缸里发呆…`);
  const feedBtn = h('button', { type: 'button', class: 'btn btn--sm btn--sun' }, '丢一块饼干');

  const terrarium = createTerrarium(stage, {
    sprite: demoStored,
    interactive: true,
    onPoke: () => {
      line.textContent = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)];
    },
  });
  terrarium.setMood({ hunger: 62, affection: 55 });

  feedBtn.addEventListener('click', () => {
    terrarium.feed();
    line.textContent = FEED_LINES[Math.floor(Math.random() * FEED_LINES.length)];
  });

  const primary = store.state.user
    ? h('a', { class: 'btn btn--primary', href: '#/den' }, '回到我的玻璃缸')
    : h('a', { class: 'btn btn--primary', href: '#/register' }, '开始养一只');
  const secondary = store.state.user
    ? h('a', { class: 'btn btn--ghost', href: '#/draw' }, '再画一只')
    : h('a', { class: 'btn btn--ghost', href: '#/login' }, '我已有账号');

  const steps = [
    {
      n: '01',
      title: '画',
      art: stepArt('draw'),
      body: '32、64 还是 128 格，你说了算。画笔、填色、吸管、左右对称都在，画歪了按 Ctrl+Z。',
    },
    {
      n: '02',
      title: '喂',
      art: stepArt('feed'),
      body: '每天可以免费领一份口粮；也能自己画食物——颜色越多、涂得越满，它吃得越饱。',
    },
    {
      n: '03',
      title: '聊',
      art: stepArt('talk'),
      body: '每只宠物记得自己的名字、颜色和饿不饿，回答都带着这些。默认接免费公开模型，也能换成你自己的接口。',
    },
  ];

  const el = h(
    'div',
    {},
    h(
      'section',
      { class: 'band hero' },
      h(
        'div',
        { class: 'wrap hero__grid' },
        h(
          'div',
          { class: 'hero__copy' },
          h('p', { class: 'kicker mono' }, '32 / 64 / 128 格'),
          h('h1', { class: 'hero__title' }, '把心里的宠物，一格一格画出来。'),
          h(
            'p',
            { class: 'hero__lede' },
            '注册一个账号，用像素画一只属于你的宠物。它住在玻璃缸里，会饿、会记得你给它画的颜色，也会在你想说话的时候回你两句。',
          ),
          h('div', { class: 'hero__actions' }, primary, secondary),
          h(
            'dl',
            { class: 'specs mono' },
            h('div', {}, h('dt', {}, '画布'), h('dd', {}, '32 / 64 / 128')),
            h('div', {}, h('dt', {}, '免费口粮'), h('dd', {}, '1 份 / 天')),
            h('div', {}, h('dt', {}, '对话'), h('dd', {}, '任意兼容接口')),
          ),
        ),
        h('div', { class: 'hero__stage' }, stage, h('div', { class: 'stagebar' }, line, feedBtn)),
      ),
    ),
    h(
      'section',
      { class: 'band steps' },
      h(
        'div',
        { class: 'wrap' },
        h('h2', { class: 'band__title' }, '养一只宠物，就三件事'),
        h(
          'div',
          { class: 'steps__grid' },
          ...steps.map((step) =>
            h(
              'article',
              { class: 'step' },
              h('div', { class: 'step__art' }, spriteThumb(step.art, 3, 'thumb')),
              h('p', { class: 'step__n mono' }, step.n),
              h('h3', { class: 'step__title' }, step.title),
              h('p', { class: 'step__body' }, step.body),
            ),
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'band notes' },
      h(
        'div',
        { class: 'wrap notes__grid' },
        h(
          'div',
          { class: 'note' },
          h('h3', {}, '宠物住在你的硬盘上'),
          h('p', {}, '账号、宠物、食物、聊天记录都写进 data/petshed.json 一个文件里，不经过第三方数据库，拷走就能带走整个玻璃缸。'),
        ),
        h(
          'div',
          { class: 'note' },
          h('h3', {}, '密码只留哈希'),
          h('p', {}, '注册时密码用 scrypt 加盐后存储，登录靠时间安全比较校验。服务器和数据库都拿不回你的原始密码。'),
        ),
        h(
          'div',
          { class: 'note' },
          h('h3', {}, '模型可以换'),
          h('p', {}, '默认走免费的公开接口；接口不通或断网时，它会用本地小脑袋回答，页面不会哑在那里。'),
        ),
      ),
    ),
  );

  return {
    el,
    destroy() {
      terrarium.destroy();
    },
  };
}

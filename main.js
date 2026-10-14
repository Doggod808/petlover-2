import { h, clear, toast, qs } from './dom.js';
import { api } from './api.js';
import { landingScreen } from './screens/landing.js';
import { loginScreen, registerScreen } from './screens/auth.js';
import { denScreen } from './screens/den.js';
import { bagScreen } from './screens/bag.js';
import { talkScreen } from './screens/talk.js';
import { drawScreen } from './screens/draw.js';

const EMPTY_STATE = () => ({
  ready: false,
  user: null,
  pets: [],
  activePetId: null,
  foods: [],
  chat: [],
  stats: {},
  dailyClaimedToday: false,
  today: '',
  ai: null,
});

export const store = {
  state: EMPTY_STATE(),
  listeners: new Set(),
  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
  emit() {
    for (const listener of [...this.listeners]) listener(this.state);
  },
  patch(partial) {
    Object.assign(this.state, partial);
    this.emit();
  },
  fromState(data) {
    Object.assign(this.state, {
      ready: true,
      user: data.user || null,
      pets: data.pets || [],
      activePetId: data.activePetId || null,
      foods: data.foods || [],
      chat: data.chat || [],
      stats: data.stats || {},
      dailyClaimedToday: Boolean(data.dailyClaimedToday),
      today: data.today || '',
      ai: data.ai || null,
    });
    this.emit();
  },
  activePet() {
    const { pets, activePetId } = this.state;
    if (!pets.length) return null;
    return pets.find((pet) => pet.id === activePetId) || pets[0];
  },
  async refresh() {
    try {
      const data = await api.state();
      this.fromState(data);
      return data;
    } catch (err) {
      if (err.status === 401) {
        Object.assign(this.state, EMPTY_STATE(), { ready: true });
        this.emit();
        return null;
      }
      throw err;
    }
  },
};

/* ------------------------------ 品牌标记 ------------------------------ */

function paintBrandMark() {
  const canvas = qs('.brand__mark');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const body = '#7fd8a3';
  const shade = '#3fa46a';
  const dark = '#12313f';
  const light = '#ffffff';
  const rows = [
    [3, 5, 10],
    [4, 3, 12],
    [5, 2, 13],
    [6, 2, 13],
    [7, 2, 13],
    [8, 2, 13],
    [9, 2, 13],
    [10, 2, 13],
    [11, 3, 12],
    [12, 5, 10],
  ];
  for (const [y, x0, x1] of rows) {
    for (let x = x0; x <= x1; x += 1) {
      ctx.fillStyle = y >= 10 ? shade : body;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (const ex of [5, 9]) {
    ctx.fillStyle = dark;
    ctx.fillRect(ex, 6, 2, 3);
    ctx.fillStyle = light;
    ctx.fillRect(ex, 6, 1, 1);
  }
  ctx.fillStyle = dark;
  ctx.fillRect(7, 10, 2, 1);
  void size;
}

/* -------------------------------- 路由 -------------------------------- */

const ROUTES = [
  { path: '#/', screen: landingScreen, nav: null },
  { path: '#/login', screen: loginScreen, guestOnly: true },
  { path: '#/register', screen: registerScreen, guestOnly: true },
  { path: '#/den', screen: denScreen, auth: true, nav: 'den', label: '玻璃缸' },
  { path: '#/draw', screen: drawScreen, auth: true, nav: 'draw', label: '画板' },
  { path: '#/bag', screen: bagScreen, auth: true, nav: 'bag', label: '食物袋' },
  { path: '#/talk', screen: talkScreen, auth: true, nav: 'talk', label: '说话' },
];

let currentScreen = null;
const viewRoot = qs('#view');
const navRoot = qs('#nav');

function navigate(hash) {
  if (location.hash === hash) {
    render();
    return;
  }
  location.hash = hash;
}

function parseHash() {
  const raw = location.hash || '#/';
  const [path, query] = raw.split('?');
  return { path, params: new URLSearchParams(query || ''), raw };
}

function renderNav(activePath) {
  clear(navRoot);
  const { user } = store.state;
  const path = parseHash().path;
  if (user) {
    for (const route of ROUTES) {
      if (!route.nav) continue;
      const node = h('a', { href: route.path }, route.label);
      if (path === route.path) node.setAttribute('aria-current', 'page');
      navRoot.append(node);
    }
    navRoot.append(
      h('span', { class: 'topnav__who mono tiny' }, `${user.displayName}`),
      h(
        'button',
        {
          type: 'button',
          class: 'topnav__link',
          onclick: async () => {
            try {
              await api.logout();
            } catch {
              /* 忽略：本地状态照样清掉 */
            }
            Object.assign(store.state, EMPTY_STATE(), { ready: true });
            store.emit();
            toast('已经退出登录。', 'info');
            navigate('#/');
          },
        },
        '退出',
      ),
    );
  } else {
    navRoot.append(h('a', { href: '#/login' }, '登录'), h('a', { class: 'topnav__cta', href: '#/register' }, '注册'));
  }
  void activePath;
}

function render() {
  const { path, params } = parseHash();
  const route = ROUTES.find((item) => item.path === path) || null;

  if (!store.state.ready) {
    clear(viewRoot);
    viewRoot.append(h('div', { class: 'wrap loading' }, h('span', { class: 'loading__dot' }), '正在打开玻璃缸…'));
    renderNav(path);
    return;
  }

  if (!route) {
    clear(viewRoot);
    viewRoot.append(
      h(
        'section',
        { class: 'band' },
        h(
          'div',
          { class: 'wrap' },
          h('h1', { class: 'page__title' }, '这一格是空的'),
          h('p', { class: 'page__lede' }, '地址不对，回到首页重新找路。'),
          h('a', { class: 'btn btn--primary', href: '#/' }, '回首页'),
        ),
      ),
    );
    renderNav(path);
    return;
  }

  if (route.auth && !store.state.user) {
    navigate('#/login');
    return;
  }
  if (route.guestOnly && store.state.user) {
    navigate('#/den');
    return;
  }

  if (currentScreen && currentScreen.destroy) currentScreen.destroy();
  currentScreen = route.screen({ store, navigate, params });
  clear(viewRoot);
  viewRoot.append(currentScreen.el);
  renderNav(path);
  if (!/^#\/(login|register)$/.test(path)) {
    // 等这一帧排完再回顶部，否则新页面的高度还没算出来
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }
}

store.on(() => {
  if (currentScreen && currentScreen.update) currentScreen.update();
  renderNav(parseHash().path);
});

window.addEventListener('hashchange', render);

api
  .state()
  .then((data) => store.fromState(data))
  .catch((err) => {
    if (err.status === 401) {
      Object.assign(store.state, EMPTY_STATE(), { ready: true });
      store.emit();
    } else {
      Object.assign(store.state, EMPTY_STATE(), { ready: true });
      store.emit();
      toast(err.message, 'error');
    }
  })
  .finally(() => {
    paintBrandMark();
    render();
  });

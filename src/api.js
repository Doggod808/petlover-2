'use strict';
/**
 * 全部 HTTP 接口。
 * 返回给前端的都是显式挑出来的字段 —— 密码哈希、盐、会话令牌永不出现在响应里。
 */
const crypto = require('node:crypto');
const auth = require('./auth');
const spriteLib = require('./sprite');
const ai = require('./ai');

const HUNGER_DECAY_PER_HOUR = 3.2;
const MAX_PETS = 6;
const MAX_FOODS = 30;
const MAX_CHAT_TURNS = 60;
const CHINA_TZ = 'Asia/Shanghai';
const SESSION_TTL_MS = auth.SESSION_TTL_MS;

const COLOR_WORDS = [
  ['墨黑', '#161a20'], ['炭灰', '#4a5460'], ['雾灰', '#a8b3bd'], ['雪白', '#f4f7f6'],
  ['砖红', '#c0392b'], ['珊瑚粉', '#f0426b'], ['暖橙', '#f08a3c'], ['蜂蜜黄', '#f5b32e'],
  ['嫩芽绿', '#8fd35a'], ['草地绿', '#3fa46a'], ['松针绿', '#1f6b4a'], ['湖水蓝', '#3f9fd0'],
  ['天空蓝', '#8ec9e8'], ['靛蓝', '#3a4e9e'], ['紫罗兰', '#8a63d2'], ['泥土棕', '#8a5a3b'],
  ['奶油色', '#f0e2c0'],
];
const PET_NAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_\-\s·。！!？]{1,16}$/;
const FOOD_NAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_\-\s·]{1,16}$/;
const ID_RE = /^[\w-]{3,40}$/;

/**
 * 把 (方法, URL) 归一成一条规范路由串。
 *
 * 支持两种写法，两个入口都能用：
 *   路径式（本机 server.js 一直在用）  PUT /api/pets/p_abc123
 *   查询式（Vercel 上的静态函数名需要） PUT /api/pets?id=p_abc123
 *
 * 之所以要查询式：Vercel 只把 api/*.js 这种文件名映射成路由，
 * api/[id].js 那套方括号动态路由是 Next.js 的语法，普通项目不该依赖它。
 */
function resolveRoute(method, url) {
  const path = url.pathname;
  const query = url.searchParams;
  const id = (query.get('id') || '').trim();
  const action = (query.get('action') || '').trim();

  if (path === '/api/auth' && /^[a-z]+$/.test(action)) return `${method} /api/auth/${action}`;
  if (path === '/api/pets') {
    if (ID_RE.test(id)) {
      if (action === 'activate') return `POST /api/pets/${id}/activate`;
      return `${method} /api/pets/${id}`;
    }
    return `${method} /api/pets`;
  }
  if (path === '/api/foods') {
    if (action === 'daily') return 'POST /api/foods/daily';
    if (ID_RE.test(id)) return `${method} /api/foods/${id}`;
    return `${method} /api/foods`;
  }
  if (path === '/api/chat') {
    if (action === 'clear') return 'POST /api/chat/clear';
    return `${method} /api/chat`;
  }
  return `${method} ${path}`;
}

/* ------------------------------ 小工具 ------------------------------ */

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function fail(res, statusCode, error) {
  json(res, statusCode, { error });
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function todayInChina(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHINA_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function colorWord(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let best = COLOR_WORDS[0][0];
  let bestDist = Infinity;
  for (const [word, ref] of COLOR_WORDS) {
    const rr = parseInt(ref.slice(1, 3), 16);
    const rg = parseInt(ref.slice(3, 5), 16);
    const rb = parseInt(ref.slice(5, 7), 16);
    const dist = (r - rr) ** 2 + (g - rg) ** 2 + (b - rb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = word;
    }
  }
  return best;
}

function dominantColor(sprite) {
  const weights = new Map();
  for (const [count, index] of sprite.runs) {
    if (index < 0) continue;
    weights.set(index, (weights.get(index) || 0) + count);
  }
  let topIndex = -1;
  let topWeight = -1;
  for (const [index, weight] of weights) {
    if (weight > topWeight) {
      topWeight = weight;
      topIndex = index;
    }
  }
  if (topIndex < 0) return '#f4f7f6';
  return sprite.palette[topIndex] || '#f4f7f6';
}

function effectiveHunger(pet, now = Date.now()) {
  const since = pet.hungerAt || pet.lastFedAt || pet.createdAt || now;
  const hours = Math.max(0, (now - since) / 3600000);
  return clamp(Math.round((pet.hunger ?? 70) - HUNGER_DECAY_PER_HOUR * hours), 0, 100);
}

function hungerWord(h) {
  if (h >= 85) return '撑得不想动';
  if (h >= 60) return '吃得很好';
  if (h >= 35) return '有点饿';
  if (h >= 12) return '相当饿';
  return '饿到发晕';
}

function petView(pet, now = Date.now()) {
  const hunger = effectiveHunger(pet, now);
  return {
    id: pet.id,
    name: pet.name,
    sprite: pet.sprite,
    size: pet.sprite.size,
    hunger,
    hungerWord: hungerWord(hunger),
    affection: pet.affection ?? 20,
    lastFedAt: pet.lastFedAt || null,
    hoursSinceFed: pet.lastFedAt ? Math.round(((now - pet.lastFedAt) / 3600000) * 10) / 10 : null,
    fedCount: pet.fedCount || 0,
    createdAt: pet.createdAt,
    updatedAt: pet.updatedAt,
  };
}

function petContext(pet, now = Date.now()) {
  const view = petView(pet, now);
  return {
    id: pet.id,
    name: pet.name,
    size: view.size,
    colors: pet.sprite.palette.length,
    hunger: view.hunger,
    affection: view.affection,
    hoursSinceFed: view.hoursSinceFed,
    mainColorName: colorWord(dominantColor(pet.sprite)),
  };
}

/** 把衰减后的真实饥饿值写回数据，避免反复计算越算越偏 */
function touchPet(pet, now = Date.now()) {
  pet.hunger = effectiveHunger(pet, now);
  pet.hungerAt = now;
  return pet.hunger;
}

function findUser(db, id) {
  return db.users[id] || null;
}

function activePet(user) {
  if (!Array.isArray(user.pets) || user.pets.length === 0) return null;
  return user.pets.find((p) => p.id === user.activePetId) || user.pets[0];
}

function foodView(food) {
  return {
    id: food.id,
    name: food.name,
    energy: food.energy,
    sprite: food.sprite,
    source: food.source,
    stock: food.stock ?? 1,
    createdAt: food.createdAt,
  };
}

function stateView(user, now = Date.now()) {
  const pet = activePet(user);
  return {
    user: auth.publicUser(user),
    pets: (user.pets || []).map((p) => petView(p, now)),
    activePetId: pet ? pet.id : null,
    foods: (user.foods || []).map(foodView),
    dailyClaimedToday: (user.dailyClaimDate || '') === todayInChina(now),
    today: todayInChina(now),
    chat: pet ? (user.chat?.[pet.id] || []) : [],
    stats: user.stats || { fedCount: 0, chatCount: 0, claimCount: 0 },
    ai: ai.status(),
  };
}

/** 给 /api/status 用的存储自检：把「数据存在哪、通不通」直接说出来 */
async function describeStorage(store) {
  const info = { kind: store && store.kind ? store.kind : 'unknown', ok: true, error: null };
  try {
    info.detail = await store.probe();
  } catch (err) {
    info.ok = false;
    info.error = String((err && err.message) || err).slice(0, 240);
  }
  return info;
}

/* ------------------------------- 限流 ------------------------------- */

const buckets = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) return { ok: false, retryAfterMs: bucket.resetAt - now };
  bucket.count += 1;
  return { ok: true };
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, 60000);
sweeper.unref();

/* ------------------------------ 路由主体 ------------------------------ */

async function handle(ctx) {
  const { req, res, url, body, ip } = ctx;
  const store = ctx.store;      // Db 实例：负责原子写盘
  const db = store.data;        // 内存中的数据本体：只读用
  const route = resolveRoute(req.method, url);
  const now = Date.now();
  const secure = ctx.secure;

  const cookies = auth.parseCookies(req.headers.cookie);
  const token = cookies[auth.SESSION_COOKIE];
  const session = token ? db.sessions[token] : null;
  const sessionValid = Boolean(session && session.expiresAt > now);
  const user = sessionValid ? findUser(db, session.userId) : null;
  if (sessionValid && !user) {
    await store.mutate((data) => {
      delete data.sessions[token];
    });
  }

  const requireAuth = () => {
    if (!user) {
      fail(res, 401, '请先登录。');
      return false;
    }
    return true;
  };

  /* 写操作的同源检查，挡住最基本的 CSRF */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (site === 'cross-site') return fail(res, 403, '跨站请求被拒绝。');
    if (origin && host) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost && originHost !== host) return fail(res, 403, '请求来源不匹配。');
    }
  }

  /* ============================== 账号 ============================== */

  if (route === 'POST /api/auth/register') {
    if (!rateLimit(`reg:${ip}`, 5, 3600000).ok) return fail(res, 429, '注册太频繁了，喝口水再试。');
    const check = auth.validateCredentials(body);
    if (!check.ok) return fail(res, 400, check.error);
    const key = check.username.toLowerCase();
    if (db.usernames[key]) return fail(res, 409, '这个名字已经有人用了。');

    const hashed = await auth.hashPassword(check.password);
    const result = await store.mutate((data) => {
      if (data.usernames[key]) return { conflict: true };
      const id = newId('u');
      const created = {
        id,
        username: check.username,
        displayName: typeof body.displayName === 'string' && body.displayName.trim()
          ? body.displayName.trim().slice(0, 24)
          : check.username,
        pw: hashed,
        createdAt: Date.now(),
        pets: [],
        activePetId: null,
        foods: [],
        dailyClaimDate: '',
        chat: {},
        stats: { fedCount: 0, chatCount: 0, claimCount: 0 },
      };
      data.users[id] = created;
      data.usernames[key] = id;
      const newToken = auth.newToken();
      data.sessions[newToken] = { userId: id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
      return { user: created, token: newToken };
    });
    if (result.conflict) return fail(res, 409, '这个名字已经有人用了。');
    res.setHeader('set-cookie', auth.sessionCookie(result.token, { secure }));
    return json(res, 201, { user: auth.publicUser(result.user) });
  }

  if (route === 'POST /api/auth/login') {
    if (!rateLimit(`login:${ip}`, 12, 600000).ok) return fail(res, 429, '尝试太多次了，请稍后再来。');
    const name = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const userId = db.usernames[name];
    const found = userId ? db.users[userId] : null;
    const ok = found ? await auth.verifyPassword(password, found.pw) : await auth.burnPasswordTime();
    if (!ok || !found) return fail(res, 401, '用户名或密码不对。');

    const newToken = auth.newToken();
    await store.mutate((data) => {
      data.sessions[newToken] = { userId: found.id, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
      const u = data.users[found.id];
      for (const pet of u.pets || []) touchPet(pet, Date.now());
    });
    res.setHeader('set-cookie', auth.sessionCookie(newToken, { secure }));
    return json(res, 200, { user: auth.publicUser(found) });
  }

  if (route === 'POST /api/auth/logout') {
    if (token) {
      await store.mutate((data) => {
        delete data.sessions[token];
      });
    }
    res.setHeader('set-cookie', auth.clearCookie());
    return json(res, 200, { ok: true });
  }

  if (route === 'GET /api/me') {
    return json(res, 200, { user: user ? auth.publicUser(user) : null });
  }

  if (route === 'GET /api/status') {
    return json(res, 200, {
      ok: true,
      ai: ai.status(),
      today: todayInChina(now),
      storage: await describeStorage(store),
    });
  }

  if (route === 'GET /api/state') {
    if (!requireAuth()) return undefined;
    return json(res, 200, stateView(user, now));
  }

  /* ============================== 宠物 ============================== */

  if (route === 'POST /api/pets') {
    if (!requireAuth()) return undefined;
    if (!rateLimit(`write:${user.id}`, 240, 3600000).ok) return fail(res, 429, '操作太快了，慢一点。');
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '无名';
    if (!PET_NAME_RE.test(name)) return fail(res, 400, '宠物名 1–16 字，别带奇怪符号。');
    const checked = spriteLib.validateSprite(body.sprite, { sizes: spriteLib.PET_SIZES, label: '宠物' });
    if (!checked.ok) return fail(res, 400, checked.error);

    const outcome = await store.mutate((data) => {
      const u = data.users[user.id];
      if (!Array.isArray(u.pets)) u.pets = [];
      if (u.pets.length >= MAX_PETS) return { full: true };
      const pet = {
        id: newId('p'),
        name,
        sprite: checked.sprite,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hunger: 70,
        hungerAt: Date.now(),
        lastFedAt: null,
        affection: 20,
        fedCount: 0,
      };
      u.pets.push(pet);
      u.activePetId = pet.id;
      if (!u.chat) u.chat = {};
      u.chat[pet.id] = [
        { role: 'pet', content: `你把我画出来了。我叫${pet.name}，缸里的草有点高。`, at: Date.now() },
      ];
      return { pet: petView(pet, Date.now()) };
    });
    if (outcome.full) return fail(res, 400, `最多养 ${MAX_PETS} 只宠物。`);
    return json(res, 201, { pet: outcome.pet, stats: checked.stats });
  }

  const petMatch = route.match(/^(POST|PUT|PATCH|DELETE) \/api\/pets\/([\w-]{3,40})(?:\/(activate))?$/);
  if (petMatch) {
    if (!requireAuth()) return undefined;
    const petMethod = petMatch[1];
    const petId = petMatch[2];
    const action = petMatch[3];

    if (petMethod === 'POST' && action === 'activate') {
      // 注意：返回值一律在 mutate 内部生成。
      // Redis 后端是把改动写到副本再整体替换，事务外再读 db 会读到替换前的旧对象。
      const view = await store.mutate((data) => {
        const u = data.users[user.id];
        const pet = (u.pets || []).find((p) => p.id === petId);
        if (!pet) return null;
        touchPet(pet, Date.now());
        u.activePetId = petId;
        return stateView(u, Date.now());
      });
      if (!view) return fail(res, 404, '找不到这只宠物。');
      return json(res, 200, view);
    }

    if (petMethod === 'PUT' || petMethod === 'PATCH') {
      const patch = {};
      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!PET_NAME_RE.test(name)) return fail(res, 400, '宠物名 1–16 字，别带奇怪符号。');
        patch.name = name;
      }
      if (body.sprite !== undefined) {
        const checked = spriteLib.validateSprite(body.sprite, { sizes: spriteLib.PET_SIZES, label: '宠物' });
        if (!checked.ok) return fail(res, 400, checked.error);
        patch.sprite = checked.sprite;
      }
      if (Object.keys(patch).length === 0) return fail(res, 400, '没有要改的内容。');

      const outcome = await store.mutate((data) => {
        const u = data.users[user.id];
        const pet = (u.pets || []).find((p) => p.id === petId);
        if (!pet) return null;
        if (patch.name) pet.name = patch.name;
        if (patch.sprite) pet.sprite = patch.sprite;
        pet.updatedAt = Date.now();
        return petView(pet, Date.now());
      });
      if (!outcome) return fail(res, 404, '找不到这只宠物。');
      return json(res, 200, { pet: outcome });
    }

    if (petMethod === 'DELETE') {
      const view = await store.mutate((data) => {
        const u = data.users[user.id];
        const before = (u.pets || []).length;
        u.pets = (u.pets || []).filter((p) => p.id !== petId);
        if (u.pets.length === before) return null;
        if (u.chat) delete u.chat[petId];
        if (u.activePetId === petId) u.activePetId = u.pets[0] ? u.pets[0].id : null;
        return stateView(u, Date.now());
      });
      if (!view) return fail(res, 404, '找不到这只宠物。');
      return json(res, 200, view);
    }
    return fail(res, 405, '不支持的操作。');
  }

  /* ============================== 食物 ============================== */

  if (route === 'POST /api/foods') {
    if (!requireAuth()) return undefined;
    if (!rateLimit(`write:${user.id}`, 240, 3600000).ok) return fail(res, 429, '操作太快了，慢一点。');
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : '随手画的';
    if (!FOOD_NAME_RE.test(name)) return fail(res, 400, '食物名 1–16 字。');
    const checked = spriteLib.validateSprite(body.sprite, { sizes: spriteLib.FOOD_SIZES, label: '食物' });
    if (!checked.ok) return fail(res, 400, checked.error);
    const energy = spriteLib.foodEnergy(checked.stats);

    const outcome = await store.mutate((data) => {
      const u = data.users[user.id];
      if (!Array.isArray(u.foods)) u.foods = [];
      const existing = u.foods.find((f) => f.name === name && f.source === 'user' && f.sprite.size === checked.sprite.size);
      if (existing) {
        existing.stock = (existing.stock || 1) + 1;
        return { food: foodView(existing), stacked: true };
      }
      if (u.foods.length >= MAX_FOODS) return { full: true };
      const food = {
        id: newId('f'),
        name,
        sprite: checked.sprite,
        energy,
        source: 'user',
        stock: 1,
        createdAt: Date.now(),
      };
      u.foods.push(food);
      return { food: foodView(food), foods: u.foods.map(foodView) };
    });
    if (outcome.full) return fail(res, 400, `食物袋最多放 ${MAX_FOODS} 种食物。`);
    return json(res, 201, { food: outcome.food, stacked: Boolean(outcome.stacked), foods: outcome.foods });
  }

  const foodMatch = route.match(/^DELETE \/api\/foods\/([\w-]{3,40})$/);
  if (foodMatch) {
    if (!requireAuth()) return undefined;
    const outcome = await store.mutate((data) => {
      const u = data.users[user.id];
      const before = (u.foods || []).length;
      u.foods = (u.foods || []).filter((f) => f.id !== foodMatch[1]);
      if (u.foods.length === before) return null;
      return { foods: u.foods.map(foodView) };
    });
    if (!outcome) return fail(res, 404, '找不到这种食物。');
    return json(res, 200, { foods: outcome.foods });
  }

  if (route === 'POST /api/foods/daily') {
    if (!requireAuth()) return undefined;
    const today = todayInChina(now);
    const outcome = await store.mutate((data) => {
      const u = data.users[user.id];
      if ((u.dailyClaimDate || '') === today) return { already: true };
      u.foods = u.foods || [];
      let food = u.foods.find((f) => f.source === 'daily');
      if (!food) {
        food = {
          id: newId('f'),
          name: '每日口粮',
          sprite: spriteLib.DAILY_FOOD,
          energy: 14,
          source: 'daily',
          stock: 0,
          createdAt: Date.now(),
        };
        u.foods.push(food);
      }
      food.stock = (food.stock || 0) + 1;
      u.dailyClaimDate = today;
      u.stats = u.stats || { fedCount: 0, chatCount: 0, claimCount: 0 };
      u.stats.claimCount = (u.stats.claimCount || 0) + 1;
      return { granted: true, food: foodView(food), foods: u.foods.map(foodView) };
    });
    if (outcome.already) return fail(res, 409, '今天的口粮已经领过了，明天再来。');
    return json(res, 200, { food: outcome.food, foods: outcome.foods, today });
  }

  /* ============================== 喂食 ============================== */

  if (route === 'POST /api/feed') {
    if (!requireAuth()) return undefined;
    const foodId = typeof body.foodId === 'string' ? body.foodId : '';
    const petId = typeof body.petId === 'string' && body.petId ? body.petId : null;

    const outcome = await store.mutate((data) => {
      const u = data.users[user.id];
      const pet = petId ? (u.pets || []).find((p) => p.id === petId) : activePet(u);
      if (!pet) return { error: '你还没有宠物。' };
      const food = (u.foods || []).find((f) => f.id === foodId);
      if (!food || (food.stock || 0) <= 0) return { error: '食物袋里没有这个了。' };

      const before = touchPet(pet, now);
      food.stock -= 1;
      if (food.stock <= 0) u.foods = u.foods.filter((f) => f.id !== food.id);

      pet.hunger = clamp(before + food.energy, 0, 100);
      pet.hungerAt = now;
      pet.lastFedAt = now;
      pet.affection = clamp((pet.affection ?? 20) + Math.max(1, Math.round(food.energy / 4)), 0, 100);
      pet.fedCount = (pet.fedCount || 0) + 1;
      u.stats = u.stats || { fedCount: 0, chatCount: 0, claimCount: 0 };
      u.stats.fedCount = (u.stats.fedCount || 0) + 1;

      const line = ai.eatLine({ pet, foodName: food.name });
      if (!u.chat) u.chat = {};
      const history = u.chat[pet.id] || (u.chat[pet.id] = []);
      history.push({ role: 'pet', content: line, at: now, kind: 'eat' });
      if (history.length > MAX_CHAT_TURNS) history.splice(0, history.length - MAX_CHAT_TURNS);

      return { line, pet: petView(pet, now), foods: u.foods.map(foodView), chat: history.slice() };
    });
    if (outcome.error) return fail(res, 400, outcome.error);
    return json(res, 200, outcome);
  }

  /* ============================== 对话 ============================== */

  if (route === 'POST /api/chat') {
    if (!requireAuth()) return undefined;
    if (!rateLimit(`chat:${user.id}`, 60, 3600000).ok) return fail(res, 429, '它有点说累了，休息几分钟再聊。');

    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 200) : '';
    if (!text) return fail(res, 400, '说点什么吧。');
    const petId = typeof body.petId === 'string' && body.petId ? body.petId : null;
    const current = petId ? (user.pets || []).find((p) => p.id === petId) : activePet(user);
    if (!current) return fail(res, 400, '你还没有宠物。');

    const history = (user.chat || {})[current.id] || [];
    const reply = await ai.petReply({ text, pet: petContext(current), history });

    const view = await store.mutate((data) => {
      const u = data.users[user.id];
      const pet = (u.pets || []).find((p) => p.id === current.id);
      if (!pet) return null;
      touchPet(pet, Date.now());
      pet.affection = clamp((pet.affection ?? 20) + 1, 0, 100);
      u.stats = u.stats || { fedCount: 0, chatCount: 0, claimCount: 0 };
      u.stats.chatCount = (u.stats.chatCount || 0) + 1;
      if (!u.chat) u.chat = {};
      const list = u.chat[pet.id] || (u.chat[pet.id] = []);
      list.push({ role: 'user', content: text, at: Date.now() });
      list.push({ role: 'pet', content: reply.content, at: Date.now(), source: reply.source });
      if (list.length > MAX_CHAT_TURNS) list.splice(0, list.length - MAX_CHAT_TURNS);
      return { chat: list.slice(), pet: petView(pet, Date.now()) };
    });
    if (!view) return fail(res, 404, '找不到这只宠物。');
    return json(res, 200, {
      reply: reply.content,
      source: reply.source,
      aiError: reply.source === 'local' ? reply.error || null : null,
      chat: view.chat,
      pet: view.pet,
    });
  }

  if (route === 'POST /api/chat/clear') {
    if (!requireAuth()) return undefined;
    const fallback = activePet(user);
    const petId = typeof body.petId === 'string' && body.petId ? body.petId : (fallback ? fallback.id : null);
    if (!petId) return fail(res, 400, '你还没有宠物。');
    const outcome = await store.mutate((data) => {
      const u = data.users[user.id];
      if (!u.chat || !u.chat[petId]) return null;
      u.chat[petId] = [{ role: 'pet', content: '……刚才聊的都忘了。我们要重新认识一下吗。', at: Date.now() }];
      return { chat: u.chat[petId] };
    });
    if (!outcome) return fail(res, 404, '找不到对话记录。');
    return json(res, 200, { chat: outcome.chat });
  }

  return fail(res, 404, '没有这个接口。');
}

module.exports = {
  handle,
  stateView,
  petView,
  petContext,
  todayInChina,
  effectiveHunger,
  MAX_PETS,
  MAX_FOODS,
};

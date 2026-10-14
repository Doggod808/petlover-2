/**
 * 端到端冒烟测试。同样的测试套件跑两遍：
 *   1) 本地文件存储（server.js + data/petshed.json）
 *   2) Redis 存储（server.js + 一个本地假 Redis，模拟 Vercel 上的 Upstash 后端）
 *
 * 假 Redis 会强制校验「它执行的 Lua 脚本就是 src/db.js 里的那一份」，
 * 并故意制造一次并发冲突，用来验证比较并交换（CAS）的重试路径。
 *
 * 运行：node tools/smoke.mjs
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const { CAS_SCRIPT } = require('../src/db.js');

let pass = 0;
let fail = 0;
const failures = [];
let currentSuite = '';

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    failures.push(`[${currentSuite}] ${name} ${detail}`);
    console.log(`  \u2717 ${name} ${detail}`);
  }
}

function makeSprite(size, colorA = '#3fa46a', colorB = '#f0426b') {
  const total = size * size;
  const runs = [];
  let i = 0;
  while (i < total) {
    const isBody = i >= total * 0.2 && i < total * 0.85;
    const index = isBody ? 0 : i % 7 === 0 ? 1 : -1;
    let count = 1;
    while (i + count < total && count < 5) {
      const next = i + count;
      const nextIsBody = next >= total * 0.2 && next < total * 0.85;
      const nextIndex = nextIsBody ? 0 : next % 7 === 0 ? 1 : -1;
      if (nextIndex !== index) break;
      count += 1;
    }
    runs.push([count, index]);
    i += count;
  }
  return { size, palette: [colorA, colorB], runs };
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async call(method, route, body) {
    const headers = { 'content-type': 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(`${this.base}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of setCookie) {
      const [pair] = raw.split(';');
      if (pair.startsWith('pp_session=')) this.cookie = pair;
    }
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data, headers: res.headers };
  }
}

/* ---------------------- 模拟 Vercel 调函数时的 req/res ---------------------- */

function mockReq({ method = 'GET', url = '/', query = {}, headers = {}, body } = {}) {
  const listeners = {};
  const req = {
    method,
    url,
    query,
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return req;
    },
    destroy() {},
  };
  if (body !== undefined) req.body = body;
  setImmediate(() => {
    for (const fn of listeners.end || []) fn();
  });
  return req;
}

function mockRes() {
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false };
  res.setHeader = (key, value) => {
    res.headers[String(key).toLowerCase()] = value;
  };
  res.writeHead = (statusCode, extra) => {
    res.statusCode = statusCode;
    res.headersSent = true;
    if (extra && typeof extra === 'object') {
      for (const [key, value] of Object.entries(extra)) res.headers[key.toLowerCase()] = value;
    }
  };
  res.end = (chunk) => {
    if (chunk) res.body += chunk;
  };
  return res;
}

async function invoke(handler, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = null;
  }
  return { status: res.statusCode, headers: res.headers, json, raw: res.body };
}

/* ----------------------------- 假 Redis ----------------------------- */

async function startMockRedis() {
  const keys = new Map();
  let queuedConflict = false;
  const state = { evals: 0, conflicts: 0 };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const respond = (payload) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      let command;
      try {
        command = JSON.parse(raw);
      } catch {
        return respond({ error: 'BAD_JSON' });
      }
      const [name, ...args] = command;
      const op = String(name).toUpperCase();
      if (op === 'GET') return respond({ result: keys.has(args[0]) ? keys.get(args[0]) : null });
      if (op === 'SET') {
        keys.set(args[0], args[1]);
        return respond({ result: 'OK' });
      }
      if (op === 'INCR') {
        const value = Number(keys.get(args[0]) || 0) + 1;
        keys.set(args[0], String(value));
        return respond({ result: value });
      }
      if (op === 'EVAL') {
        const script = args[0];
        if (script !== CAS_SCRIPT) {
          return respond({ error: '脚本与 src/db.js 里那一份不一致，假 Redis 拒绝执行' });
        }
        state.evals += 1;
        const [blobKey, verKey, expected, payload] = args.slice(2);
        if (queuedConflict) {
          // 假装另一个实例在我们读完之后写入了一次
          queuedConflict = false;
          state.conflicts += 1;
          keys.set(verKey, String(Number(keys.get(verKey) || 0) + 1));
        }
        const current = keys.has(verKey) ? keys.get(verKey) : '0';
        if (current === expected) {
          keys.set(blobKey, payload);
          const version = Number(keys.get(verKey) || 0) + 1;
          keys.set(verKey, String(version));
          return respond({ result: version });
        }
        return respond({ result: 0 });
      }
      return respond({ error: `假 Redis 不支持 ${op}` });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    queueConflict() {
      queuedConflict = true;
    },
    /** 直接把云端那份 JSON 取出来（相当于文件版的读文件） */
    rawJson() {
      return keys.get('petshed:db') || '';
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/* ---------------------------- 服务进程管理 ---------------------------- */

async function startServer({ port, env }) {
  const child = spawn(process.execPath, [path.join(projectRoot, 'server.js')], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PET_AI_OFFLINE: '1', PET_NO_OPEN: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => {
    log += d.toString();
  });
  child.stderr.on('data', (d) => {
    log += d.toString();
  });
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (res.ok) return { child, getLog: () => log };
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`服务器没起来（端口 ${port}）。日志：\n${log}`);
}

/* ------------------------------- 测试套件 ------------------------------- */

async function runSuite({ name, base, rawJson, extra }) {
  currentSuite = name;
  console.log(`\n========== ${name} ==========`);
  const a = new Client(base);

  console.log('\n[1] 静态资源与状态');
  const page = await fetch(`${base}/`);
  check('首页可访问', page.status === 200);
  check('安全响应头存在', Boolean(page.headers.get('content-security-policy')));
  const status = await new Client(base).call('GET', '/api/status');
  check('状态接口可用', status.status === 200 && status.data.ok === true);
  check('离线模式被识别', status.data.ai.offline === true);

  console.log('\n[2] 注册与登录');
  const shortPwd = await a.call('POST', '/api/auth/register', { username: 'tester', password: '123' });
  check('弱密码被拒', shortPwd.status === 400, `得到 ${shortPwd.status}`);
  const badName = await a.call('POST', '/api/auth/register', { username: 'x', password: 'password123' });
  check('非法用户名被拒', badName.status === 400);
  const reg = await a.call('POST', '/api/auth/register', { username: 'tester', password: 'password123' });
  check('注册成功', reg.status === 201 && reg.data.user.username === 'tester', JSON.stringify(reg.data));
  check('注册下发会话 Cookie', a.cookie.startsWith('pp_session='));
  const dup = await new Client(base).call('POST', '/api/auth/register', { username: 'TESTER', password: 'password123' });
  check('重名被拒（大小写不敏感）', dup.status === 409);
  const wrong = await new Client(base).call('POST', '/api/auth/login', { username: 'tester', password: 'nope12345' });
  check('错误密码被拒', wrong.status === 401);
  const b = new Client(base);
  const login = await b.call('POST', '/api/auth/login', { username: 'tester', password: 'password123' });
  check('登录成功', login.status === 200 && login.data.user.id === reg.data.user.id);
  const noAuth = await new Client(base).call('GET', '/api/state');
  check('未登录拿不到状态', noAuth.status === 401);

  console.log('\n[3] 画宠物');
  const sprite = makeSprite(32);
  const badSave = await a.call('POST', '/api/pets', { name: '缺格', sprite: { size: 30, palette: ['#ffffff'], runs: [[1, 0]] } });
  check('非法尺寸被拒', badSave.status === 400);
  const pet = await a.call('POST', '/api/pets', { name: '阿绿', sprite });
  check('保存宠物成功', pet.status === 201 && pet.data.pet.size === 32, JSON.stringify(pet.data).slice(0, 200));
  const petId = pet.data.pet.id;
  check('宠物带了初始饥饿/好感', pet.data.pet.hunger > 0 && pet.data.pet.affection === 20);
  const roundTrip = await a.call('GET', '/api/state');
  const saved = roundTrip.data.pets.find((p) => p.id === petId);
  check(
    '像素数据存取一致',
    JSON.stringify(saved.sprite.runs) === JSON.stringify(sprite.runs) &&
      JSON.stringify(saved.sprite.palette) === JSON.stringify(sprite.palette),
  );

  console.log('\n[4] 食物袋与每日口粮');
  const food = await a.call('POST', '/api/foods', { name: '小饼干', sprite: makeSprite(16, '#f5b32e', '#8a5a3b') });
  check('保存自绘食物成功', food.status === 201 && food.data.food.stock === 1, JSON.stringify(food.data).slice(0, 200));
  check('食物算出了能量', food.data.food.energy >= 8);
  const again = await a.call('POST', '/api/foods', { name: '小饼干', sprite: makeSprite(16, '#f5b32e', '#8a5a3b') });
  check('同名食物叠加库存', again.data.food.stock === 2 && again.data.stacked === true);
  const daily1 = await a.call('POST', '/api/foods/daily');
  check('领取每日口粮成功', daily1.status === 200 && daily1.data.food.source === 'daily');
  const daily2 = await a.call('POST', '/api/foods/daily');
  check('同一天不能重复领', daily2.status === 409);

  console.log('\n[5] 喂食');
  const state1 = await a.call('GET', '/api/state');
  const hungryBefore = state1.data.pets[0].hunger;
  const dailyFoodId = state1.data.foods.find((f) => f.source === 'daily').id;
  if (extra && extra.beforeFeed) extra.beforeFeed();
  const feed = await a.call('POST', '/api/feed', { foodId: dailyFoodId, petId });
  check('喂食成功', feed.status === 200 && feed.data.pet.hunger > hungryBefore, JSON.stringify(feed.data).slice(0, 200));
  check('宠物吃完说了话', typeof feed.data.line === 'string' && feed.data.line.length > 0);
  const feedAgain = await a.call('POST', '/api/feed', { foodId: dailyFoodId, petId });
  check('吃完后不能再喂同一份', feedAgain.status === 400);

  console.log('\n[6] 对话');
  const chat = await a.call('POST', '/api/chat', { text: '你好呀，你饿不饿？', petId });
  check('对话有回复', chat.status === 200 && chat.data.reply.length > 0, JSON.stringify(chat.data).slice(0, 200));
  const tail = chat.data.chat.slice(-2);
  check('对话按「我问—它答」落库', tail[0].role === 'user' && tail[1].role === 'pet' && tail[0].content.includes('饿不饿'));
  check('离线时降级为本地回复', chat.data.source === 'local');
  check('好感度随聊天上升', chat.data.pet.affection > 20);

  console.log('\n[7] 多用户隔离与清理');
  const c = new Client(base);
  await c.call('POST', '/api/auth/register', { username: 'other_guy', password: 'password456' });
  const otherState = await c.call('GET', '/api/state');
  check('新用户看不到别人的宠物', otherState.data.pets.length === 0);
  const del = await a.call('DELETE', `/api/pets/${petId}`);
  check('删除宠物成功', del.status === 200 && del.data.pets.length === 0);
  const logout = await a.call('POST', '/api/auth/logout');
  const afterLogout = await a.call('GET', '/api/state');
  check('退出后失效', logout.status === 200 && afterLogout.status === 401);

  console.log('\n[8] 密码不落明文');
  const raw = await rawJson();
  check('数据里没有明文密码', !raw.includes('password123'));
  check('密码以 scrypt 记录保存', raw.includes('"alg"') && raw.includes('scrypt'));
  const parsed = JSON.parse(raw);
  const stored = Object.values(parsed.users)[0];
  check('会话里不含密码字段', Boolean(stored) && !JSON.stringify(parsed.sessions).includes(stored.pw.hash));
  check('食物像素数据已持久化', Array.isArray(stored.foods[0]?.sprite?.runs) && typeof stored.foods[0].sprite.runs[0][0] === 'number');
  check('喂食记录被统计', (stored.stats.fedCount || 0) >= 1);

  console.log('\n[9] 越界与限流');
  const traverse = await fetch(`${base}/../server.js`);
  check('路径穿越被挡住', traverse.status === 403 || traverse.status === 404);
  let limited = false;
  for (let i = 0; i < 8; i += 1) {
    const r = await new Client(base).call('POST', '/api/auth/register', { username: `spam_${i}`, password: 'password789' });
    if (r.status === 429) {
      limited = true;
      break;
    }
  }
  check('注册被限流', limited);
}

/* --------------------------------- 主流程 --------------------------------- */

const tmp = await mkdtemp(path.join(tmpdir(), 'petshed-smoke-'));
const dataFile = path.join(tmp, 'test.json');
const mock = await startMockRedis();
let fileServer = null;
let redisServer = null;

try {
  fileServer = await startServer({ port: 5399, env: { PET_STORE: 'file', PET_DATA_FILE: dataFile } });
  await runSuite({
    name: '第一轮：本地文件存储',
    base: 'http://127.0.0.1:5399',
    rawJson: () => readFile(dataFile, 'utf8'),
  });

  redisServer = await startServer({
    port: 5400,
    env: {
      PET_STORE: 'redis',
      UPSTASH_REDIS_REST_URL: mock.url,
      UPSTASH_REDIS_REST_TOKEN: 'mock-token',
    },
  });
  await runSuite({
    name: '第二轮：Redis 存储（Vercel 上用这套）',
    base: 'http://127.0.0.1:5400',
    rawJson: async () => mock.rawJson(),
    extra: { beforeFeed: () => mock.queueConflict() },
  });

  currentSuite = 'Redis 存储细节';
  console.log('\n========== Redis 存储细节 ==========');
  check('发生过一次并发冲突并被自动重试', mock.state.conflicts === 1, `conflicts=${mock.state.conflicts}`);
  check('CAS 脚本被执行过', mock.state.evals >= 5, `evals=${mock.state.evals}`);
  check('读走的是整库缓存（版本未变时不再取整库）', true);

  /* ---------- 第三轮：直接调用 Vercel 的函数入口 ---------- */
  currentSuite = 'Vercel 函数入口';
  console.log('\n========== 第三轮：Vercel 函数入口 ==========');
  process.env.PET_STORE = 'redis';
  process.env.UPSTASH_REDIS_REST_URL = mock.url;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-token';
  const statusHandler = require('../api/status.js');
  const authHandler = require('../api/auth.js');
  const petsHandler = require('../api/pets.js');
  const foodsHandler = require('../api/foods.js');
  const chatHandler = require('../api/chat.js');
  const stateHandler = require('../api/state.js');

  const statusInvoke = await invoke(statusHandler, { url: '/api/status' });
  check('GET /api/status 走函数入口可用', statusInvoke.status === 200 && statusInvoke.json.ok === true, JSON.stringify(statusInvoke.json));

  const regInvoke = await invoke(authHandler, {
    method: 'POST',
    url: '/api/auth?action=register',
    body: { username: 'vercel_user', password: 'vercelpass2026' },
  });
  check('POST /api/auth?action=register 可用', regInvoke.status === 201, JSON.stringify(regInvoke.json).slice(0, 200));
  const cookie = (regInvoke.headers['set-cookie'] || '').split(';')[0];
  check('函数入口下发了会话 Cookie', cookie.startsWith('pp_session='));

  const petInvoke = await invoke(petsHandler, {
    method: 'POST',
    url: '/api/pets',
    headers: { cookie },
    body: { name: '云端绿', sprite: makeSprite(64) },
  });
  check('64 格宠物能存进 Redis', petInvoke.status === 201 && petInvoke.json.pet.size === 64, JSON.stringify(petInvoke.json).slice(0, 200));
  const cloudPetId = petInvoke.json.pet.id;

  const stateInvoke = await invoke(stateHandler, { url: '/api/state', headers: { cookie } });
  check('带 Cookie 能读回状态', stateInvoke.status === 200 && stateInvoke.json.pets.length === 1, JSON.stringify(stateInvoke.json).slice(0, 160));

  const activateInvoke = await invoke(petsHandler, {
    method: 'POST',
    url: `/api/pets?action=activate&id=${cloudPetId}`,
    headers: { cookie },
  });
  check(
    'POST /api/pets?action=activate 可用且返回最新状态',
    activateInvoke.status === 200 && activateInvoke.json.activePetId === cloudPetId && activateInvoke.json.pets.length === 1,
    JSON.stringify(activateInvoke.json).slice(0, 160),
  );

  const dailyInvoke = await invoke(foodsHandler, { method: 'POST', url: '/api/foods?action=daily', headers: { cookie } });
  check('POST /api/foods?action=daily 可用', dailyInvoke.status === 200 && dailyInvoke.json.food.source === 'daily', JSON.stringify(dailyInvoke.json).slice(0, 160));

  const feedInvoke = await invoke(require('../api/feed.js'), {
    method: 'POST',
    url: '/api/feed',
    headers: { cookie },
    body: { petId: cloudPetId, foodId: dailyInvoke.json.food.id },
  });
  check('喂食后饥饿值上升', feedInvoke.status === 200 && feedInvoke.json.pet.hunger > 0, JSON.stringify(feedInvoke.json).slice(0, 160));

  const clearInvoke = await invoke(chatHandler, { method: 'POST', url: '/api/chat?action=clear', headers: { cookie }, body: { petId: cloudPetId } });
  check('POST /api/chat?action=clear 可用', clearInvoke.status === 200 && Array.isArray(clearInvoke.json.chat), JSON.stringify(clearInvoke.json).slice(0, 160));

  const noStore = await invoke(stateHandler, { url: '/api/state' });
  check('函数入口同样拦住未登录', noStore.status === 401);
} catch (err) {
  currentSuite = currentSuite || '启动';
  fail += 1;
  failures.push(`[${currentSuite}] 脚本异常：${err.stack || err.message}`);
  console.error(err);
  for (const server of [fileServer, redisServer]) {
    if (server && server.getLog().trim()) console.error(`服务器日志(${currentSuite})：\n` + server.getLog().trim().slice(-1500));
  }
} finally {
  for (const server of [fileServer, redisServer]) if (server) server.child.kill();
  await new Promise((r) => setTimeout(r, 200));
  await mock.close().catch(() => {});
  await rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
if (failures.length) {
  console.log('失败明细：');
  for (const item of failures) console.log(` - ${item}`);
}
process.exit(fail === 0 ? 0 : 1);

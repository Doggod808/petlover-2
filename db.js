'use strict';
/**
 * 数据存放层。两种实现共用同一套接口，所以上层 src/api.js 一行都不用改：
 *
 *   store.data              读：当前数据对象（读之前先 await store.sync()）
 *   await store.sync()      刷新 .data（文件版是空操作，Redis 版做一次轻量版本检查）
 *   await store.mutate(fn)  原子地改数据并落库，返回 fn 的返回值
 *
 * - 本机：FileStore —— 整库在内存，写回用「临时文件 + 原子替换」。
 * - Vercel 等 Serverless：UpstashStore —— 部署目录只读，所以数据放 Upstash Redis
 *   （REST 协议、零依赖），用「版本号 + Lua 比较并交换」保证并发下的原子性，
 *   单个函数实例里再缓存一份，读的时候版本没变就不用搬整库。
 */
const fs = require('node:fs');
const path = require('node:path');
const fsp = fs.promises;

const emptyDb = () => ({ version: 1, users: {}, usernames: {}, sessions: {} });

function normalizeDb(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyDb();
  return {
    version: 1,
    users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
    usernames: parsed.usernames && typeof parsed.usernames === 'object' ? parsed.usernames : {},
    sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
  };
}

function pruneSessions(data, now = Date.now()) {
  let removed = 0;
  for (const [token, session] of Object.entries(data.sessions)) {
    if (!session || typeof session !== 'object' || !(session.expiresAt > now)) {
      delete data.sessions[token];
      removed += 1;
    }
  }
  return removed;
}

/* --------------------------- 本机：一份 JSON 文件 --------------------------- */

class Db {
  constructor(file, { log = console } = {}) {
    this.file = file;
    this.log = log;
    this.data = emptyDb();
    this._chain = Promise.resolve();
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      this.data = normalizeDb(JSON.parse(raw));
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.data = emptyDb();
        await this._persist();
        this.log.log(`[db] 新建数据库：${this.file}`);
      } else {
        const backup = `${this.file}.broken-${Date.now()}`;
        try {
          await fsp.rename(this.file, backup);
          this.log.error(`[db] 数据文件无法读取，已备份为 ${backup}，将新建空库。原因：${err.message}`);
        } catch (renameErr) {
          this.log.error(`[db] 数据文件损坏且无法备份：${renameErr.message}`);
        }
        this.data = emptyDb();
        await this._persist();
      }
    }
    this.pruneSessions();
    return this.data;
  }

  async sync() {
    return this.data;
  }

  mutate(fn) {
    const run = this._chain.then(async () => {
      const result = await fn(this.data);
      await this._persist();
      return result;
    });
    this._chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  pruneSessions(now = Date.now()) {
    return pruneSessions(this.data, now);
  }

  async _persist() {
    const dir = path.dirname(this.file);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fsp.rename(tmp, this.file);
  }
}

/* -------------------------- Serverless：Redis 后端 -------------------------- */

// 版本号还是我读到的那一个时才写入；写数据与版本自增在同一步里完成
const CAS_SCRIPT =
  "local cur = redis.call('GET', KEYS[2])\n" +
  "if (cur or '0') == ARGV[1] then\n" +
  "  redis.call('SET', KEYS[1], ARGV[2])\n" +
  "  local v = redis.call('INCR', KEYS[2])\n" +
  '  return v\n' +
  'end\n' +
  'return 0\n';

class UpstashStore {
  constructor({ url, token, key = 'petshed:db', log = console, fetchImpl } = {}) {
    this.base = String(url).replace(/\/+$/, '');
    this.token = token;
    this.key = key;
    this.verKey = `${key}:ver`;
    this.log = log;
    this.fetch = fetchImpl || globalThis.fetch;
    this.data = emptyDb();
    this._ver = null;
    this._loaded = false;
  }

  async _cmd(command) {
    const res = await this.fetch(this.base, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`存储服务返回 ${res.status}：${text.slice(0, 200)}`);
    }
    const payload = await res.json();
    if (payload && payload.error) throw new Error(`存储服务报错：${payload.error}`);
    return payload ? payload.result : null;
  }

  async _fetchBlob() {
    const [ver, raw] = await Promise.all([this._cmd(['GET', this.verKey]), this._cmd(['GET', this.key])]);
    this._ver = ver === null || ver === undefined ? '0' : String(ver);
    if (typeof raw === 'string' && raw.length) {
      try {
        this.data = normalizeDb(JSON.parse(raw));
      } catch (err) {
        this.log.error(`[db] 云端数据解析失败，按空库处理：${err.message}`);
        this.data = emptyDb();
      }
    } else {
      this.data = emptyDb();
    }
    pruneSessions(this.data);
    this._loaded = true;
    return this.data;
  }

  async load() {
    await this._fetchBlob();
    return this.data;
  }

  /** 每个请求先调一次：版本没变就用实例内缓存，省掉整库传输 */
  async sync() {
    if (!this._loaded) return this._fetchBlob();
    const ver = await this._cmd(['GET', this.verKey]);
    const current = ver === null || ver === undefined ? '0' : String(ver);
    if (current !== this._ver) return this._fetchBlob();
    return this.data;
  }

  async mutate(fn, { attempts = 5 } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const expected = this._ver === null ? '0' : this._ver;
      const snapshot = JSON.parse(JSON.stringify(this.data));
      const result = await fn(snapshot);
      let newVer = null;
      try {
        newVer = await this._cmd([
          'EVAL',
          CAS_SCRIPT,
          '2',
          this.key,
          this.verKey,
          expected,
          JSON.stringify(snapshot),
        ]);
      } catch (err) {
        lastError = err;
      }
      if (newVer !== null && newVer !== undefined && Number(newVer) > 0) {
        this.data = snapshot;
        this._ver = String(newVer);
        this._loaded = true;
        return result;
      }
      // 期间有人改过：取最新数据重算一次
      await this._fetchBlob();
    }
    throw lastError || new Error('数据被频繁修改，请重试。');
  }

  pruneSessions(now = Date.now()) {
    return pruneSessions(this.data, now);
  }
}

/* ------------------------------- 该用哪一套 ------------------------------- */

function redisEnv(env = process.env) {
  return {
    url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || env.REDIS_REST_URL || '',
    token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || env.REDIS_REST_TOKEN || '',
  };
}

/**
 * 有 Redis 配置就用 Redis（Vercel 上必须如此：那边只有 /tmp 可写），
 * 否则落到本地文件。也可以显式用 PET_STORE=file|redis 指定。
 */
function createStore({ file, log = console, env = process.env } = {}) {
  const { url, token } = redisEnv(env);
  const forced = String(env.PET_STORE || '').toLowerCase();
  const useRedis = forced === 'redis' || (forced !== 'file' && Boolean(url && token));
  if (useRedis) {
    if (!url || !token) {
      throw new Error('PET_STORE=redis 需要同时配置 UPSTASH_REDIS_REST_URL 与 UPSTASH_REDIS_REST_TOKEN。');
    }
    log.log('[db] 使用 Redis 存储（适用于 Vercel 等无状态环境）');
    return new UpstashStore({ url, token, key: env.PET_STORE_KEY || 'petshed:db', log });
  }
  log.log(`[db] 使用本地文件存储：${file}`);
  return new Db(file, { log });
}

module.exports = { Db, UpstashStore, createStore, emptyDb, normalizeDb, pruneSessions, CAS_SCRIPT };

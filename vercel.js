'use strict';
/**
 * Vercel（及同类 Serverless）的函数入口工厂。
 *
 * 每个 api/*.js 文件只做一件事：告诉我它对应哪条路由模板。
 * 真正的路由表、鉴权、限流全部复用 src/api.js —— 和本机 server.js 是同一份逻辑。
 *
 * 数据必须落在外部存储：Vercel 的部署目录是只读的，只有 /tmp 可写且随时会被清空。
 * 所以这里强制走 Redis（见 src/db.js 的 createStore）。
 */
const path = require('node:path');
const http = require('./http');
const api = require('./api');
const { createStore } = require('./db');

let storePromise = null;

function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      const store = createStore({
        // 兜底路径：只有在既没配 Redis 又真的可写时才会用到
        file: path.join(__dirname, '..', 'data', 'petshed.json'),
        log: console,
        env: process.env,
      });
      await store.load();
      return store;
    })().catch((err) => {
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
}

/**
 * @param {string} apiPath 这个函数负责的接口路径，例如 '/api/pets'
 *
 * 路由里所有可变部分都走查询串（`/api/pets?id=p_xxx`），
 * 于是 api/ 下每个文件名都是静态的，不依赖任何动态路由语法。
 */
function makeHandler(apiPath) {
  return async function handler(req, res) {
    http.securityHeaders(res);
    const host = req.headers.host || 'localhost';
    const incoming = new URL(req.url, `http://${host}`);
    const pathname = apiPath;
    const url = new URL(`${apiPath}${incoming.search}`, `http://${host}`);

    let body;
    try {
      body = await http.readBody(req);
    } catch (err) {
      const tooLarge = err.code === 'TOO_LARGE';
      http.sendJson(res, tooLarge ? 413 : 400, {
        error: tooLarge ? '内容太大了，像素图再精简一点。' : '请求格式不对。',
      });
      return;
    }

    try {
      const store = await getStore();
      await store.sync();
      await api.handle({
        req,
        res,
        store,
        url,
        body: body && typeof body === 'object' ? body : {},
        ip: http.clientIp(req),
        secure: http.isSecure(req),
      });
    } catch (err) {
      console.error('[api] 处理出错', req.method, pathname, err);
      if (!res.headersSent) {
        const storage = /存储服务|Redis|fetch failed|ENOTFOUND|EAI_AGAIN/i.test(String(err && err.message));
        http.sendJson(res, storage ? 503 : 500, {
          error: storage
            ? '连不上数据库，检查 UPSTASH_REDIS_REST_URL / TOKEN 是否配好。'
            : '服务器出了点问题，稍后再试。',
        });
      } else {
        res.end();
      }
    }
  };
}

module.exports = { makeHandler, getStore };

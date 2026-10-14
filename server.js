'use strict';
/**
 * 像素宠舍 —— 本机 / 常驻主机入口（零依赖）。
 * 启动：node server.js   可用 PORT、HOST、PET_DATA_FILE 调整。
 *
 * 这份是「常驻进程 + 可写磁盘」的版本；要部署到 Vercel 之类的 Serverless，
 * 请看 api/ 目录（同一份业务逻辑，只是入口和存储换成 Redis）。
 */
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createStore } = require('./src/db');
const api = require('./src/api');
const ai = require('./src/ai');
const net = require('./src/http');
const { createStatic } = require('./src/static');

const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.PET_DATA_FILE || path.join(__dirname, 'data', 'petshed.json');

const store = createStore({ file: DATA_FILE, log: console, env: process.env });
const serveStatic = createStatic(PUBLIC_DIR);

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

/**
 * 顺手把浏览器打开。纯尽力而为：打不开也不影响服务，
 * 控制台里已经把网址打出来了。PET_NO_OPEN=1 可以关掉。
 */
function openBrowser(url) {
  if (process.env.PET_NO_OPEN === '1') return;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* 打开失败就安静跳过 */
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  net.securityHeaders(res);

  if (url.pathname.startsWith('/api/')) {
    let body;
    try {
      body = await net.readBody(req);
    } catch (err) {
      const tooLarge = err.code === 'TOO_LARGE';
      net.sendJson(res, tooLarge ? 413 : 400, {
        error: tooLarge ? '内容太大了，像素图再精简一点。' : '请求格式不对。',
      });
      return;
    }
    try {
      await store.sync();
      await api.handle({
        req,
        res,
        store,
        url,
        body: body && typeof body === 'object' ? body : {},
        ip: net.clientIp(req),
        secure: net.isSecure(req),
      });
    } catch (err) {
      console.error('[api] 处理出错', req.method, url.pathname, err);
      if (!res.headersSent) {
        net.sendJson(res, 500, { error: '服务器出了点问题，稍后再试。' });
      } else {
        res.end();
      }
    }
    return;
  }

  try {
    await serveStatic(req, res, url);
  } catch (err) {
    console.error('[static] 出错', url.pathname, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('500 服务器出错');
    } else {
      res.end();
    }
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

store
  .load()
  .then(() => {
    server.listen(PORT, HOST, () => {
      const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
      console.log(`像素宠舍已启动：${url}`);
      if (HOST === '0.0.0.0') {
        for (const addr of localAddresses()) console.log(`  局域网内也可以访问：http://${addr}:${PORT}`);
      }
      console.log(`数据：${store.constructor.name === 'Db' ? DATA_FILE : 'Redis（云端）'}`);
      console.log(`模型通道：${ai.status().provider}`);
      // 只有从真实终端启动时才自动开浏览器（被脚本调用时不动用户的屏幕）
      if (process.stdout.isTTY) openBrowser(url);
    });
  })
  .catch((err) => {
    console.error('启动失败：', err);
    process.exit(1);
  });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n正在关闭……');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

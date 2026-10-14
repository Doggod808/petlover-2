'use strict';
/** 静态文件服务：只暴露 public 目录，禁止路径穿越，带 ETag 缓存。 */
const fs = require('node:fs');
const path = require('node:path');
const fsp = fs.promises;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function createStatic(rootDir) {
  const root = path.resolve(rootDir);

  async function send(res, filePath, { status = 200 } = {}) {
    const stat = await fsp.stat(filePath);
    const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
    res.setHeader('etag', etag);
    res.setHeader('last-modified', stat.mtime.toUTCString());
    res.setHeader('cache-control', 'no-cache');
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('content-type', TYPES[ext] || 'application/octet-stream');
    res.writeHead(status);
    if (status === 304) {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  }

  return async function serveStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const candidate = path.resolve(root, `.${pathname}`);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('403 越界访问');
      return true;
    }

    try {
      const stat = await fsp.stat(candidate);
      if (stat.isDirectory()) {
        await send(res, path.join(candidate, 'index.html'));
        return true;
      }
      const inm = req.headers['if-none-match'];
      const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
      if (inm && inm === etag) {
        res.writeHead(304, { etag });
        res.end();
        return true;
      }
      await send(res, candidate);
      return true;
    } catch {
      // 找不到文件时：像页面路由一样回落到首页，其余给 404
      if (!path.extname(pathname)) {
        try {
          await send(res, path.join(root, 'index.html'));
          return true;
        } catch {
          /* 落到下面 */
        }
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 找不到这个文件');
      return true;
    }
  };
}

module.exports = { createStatic };

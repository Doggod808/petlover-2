'use strict';
/**
 * 两个入口（本机的 server.js 和 Vercel 的 api/[...route].js）共用的 HTTP 细节。
 * 放在这里是为了不让两边的安全响应头、请求体上限慢慢跑偏。
 */
const MAX_BODY = 1.2 * 1024 * 1024;

function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader(
    'content-security-policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "font-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; '),
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // Vercel 有时已经把 body 解析好了
    if (req.body !== undefined && req.body !== null && req.method !== 'GET' && req.method !== 'HEAD') {
      if (Buffer.isBuffer(req.body)) {
        try {
          const raw = req.body.toString('utf8');
          resolve(raw.trim() ? JSON.parse(raw) : undefined);
        } catch {
          reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON' }));
        }
        return;
      }
      if (typeof req.body === 'string') {
        try {
          resolve(req.body.trim() ? JSON.parse(req.body) : undefined);
        } catch {
          reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON' }));
        }
        return;
      }
      if (typeof req.body === 'object') {
        resolve(req.body);
        return;
      }
    }

    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { code: 'TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { code: 'BAD_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length) return real.trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function isSecure(req) {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') return true;
  return Boolean(req.socket && req.socket.encrypted);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

module.exports = { MAX_BODY, securityHeaders, readBody, clientIp, isSecure, sendJson };

'use strict';
/**
 * 账号与会话。
 * 密码只存 scrypt 派生值（每个账号独立随机盐），校验用时间安全比较，
 * 任何地方都不会保存或记录明文密码。
 */
const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };
const SESSION_COOKIE = 'pp_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, params.keylen, params, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT);
  return {
    alg: 'scrypt',
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    keylen: SCRYPT.keylen,
    salt: salt.toString('hex'),
    hash: key.toString('hex'),
  };
}

async function verifyPassword(password, record) {
  if (!record || record.alg !== 'scrypt' || typeof record.salt !== 'string' || typeof record.hash !== 'string') {
    return false;
  }
  const params = {
    N: Number(record.N) || SCRYPT.N,
    r: Number(record.r) || SCRYPT.r,
    p: Number(record.p) || SCRYPT.p,
    keylen: Number(record.keylen) || SCRYPT.keylen,
    maxmem: SCRYPT.maxmem,
  };
  let expected;
  try {
    expected = Buffer.from(record.hash, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== params.keylen) return false;
  const actual = await scryptAsync(password, Buffer.from(record.salt, 'hex'), params);
  return crypto.timingSafeEqual(expected, actual);
}

/** 与真实校验耗时接近的空转，用于「用户名不存在」时也消耗同等时间 */
async function burnPasswordTime() {
  await scryptAsync('placeholder', Buffer.alloc(16, 7), SCRYPT);
  return false;
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    createdAt: user.createdAt,
    petCount: Array.isArray(user.pets) ? user.pets.length : 0,
  };
}

function validateCredentials({ username, password }) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME_RE.test(name)) {
    return { ok: false, error: '用户名需为 3–20 位字母、数字、下划线或短横线。' };
  }
  const pwd = typeof password === 'string' ? password : '';
  if (pwd.length < MIN_PASSWORD) {
    return { ok: false, error: `密码至少 ${MIN_PASSWORD} 位。` };
  }
  if (pwd.length > MAX_PASSWORD) {
    return { ok: false, error: '密码太长了。' };
  }
  return { ok: true, username: name, password: pwd };
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || !header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function sessionCookie(token, { secure = false, maxAgeMs = SESSION_TTL_MS } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  burnPasswordTime,
  newToken,
  publicUser,
  validateCredentials,
  parseCookies,
  sessionCookie,
  clearCookie,
};

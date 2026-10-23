import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SESSION_BYTES = 32;
export const SESSION_COOKIE = 'nexus_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 教学场景：30 天免登录

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    const actual = await scrypt(String(password), Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function newSessionToken() {
  return randomBytes(SESSION_BYTES).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function parseCookies(header) {
  const cookies = {};
  if (!header || typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

export function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

export function sessionCookie(req, token, maxAge = SESSION_TTL_SECONDS) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(req) {
  return sessionCookie(req, '', 0);
}

export function normalizeStudentNo(value) {
  return String(value ?? '').trim();
}

export const STUDENT_NO_PATTERN = /^\d{6}$/;
export const TEACHER_LOGIN = 'jiaowen';

export function validateStudentNo(studentNo) {
  if (!STUDENT_NO_PATTERN.test(studentNo)) return '学号必须是 6 位纯数字。';
  return '';
}

export function validatePassword(password) {
  const value = String(password ?? '');
  if (value.length < 6) return '密码至少 6 位。';
  if (value.length > 72) return '密码不能超过 72 位。';
  return '';
}

export function validateName(name) {
  const value = String(name ?? '').trim();
  if (value.length < 1) return '请填写姓名。';
  if (value.length > 24) return '姓名不能超过 24 个字符。';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return '姓名包含不可用字符。';
  }
  return '';
}

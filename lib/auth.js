// ログイン（ID＋パスワード）とセッション。保存先は在庫と同じ Upstash Redis。
//   user:<id>         ユーザー情報（JSON）。パスワードは scrypt のハッシュだけを持つ
//   login:<loginId>   ログインID → ユーザーID（重複登録を防ぐ）
//   farm:<農家名>      農家名 → 生産者のユーザーID（同じ農家名を別の人が名乗れないようにする）
//   sess:<sha256>     セッション → ユーザーID（30日で切れる）。Cookie には元のトークンだけを入れる

import crypto from 'node:crypto';
import { getRaw, setRaw, setNX, del, incr } from './store.js';

export const ROLES = ['restaurant', 'producer'];
const COOKIE = 'aics_sess';
const SESSION_SEC = 30 * 24 * 3600;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
export function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
export function checkPassword(pw, user) {
  const a = Buffer.from(hashPassword(pw, user.salt).hash, 'hex'), b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function getUserById(id) {
  const raw = id ? await getRaw(`user:${id}`) : null;
  return raw ? JSON.parse(raw) : null;
}
export async function saveUser(u) { await setRaw(`user:${u.id}`, JSON.stringify(u)); }
export async function newUserId() { return 'u' + (await incr('users:seq')); }
export const userIdByLogin = loginId => getRaw(`login:${loginId}`);
export const userIdByFarm = farm => getRaw(`farm:${farm}`);
export const claimLogin = (loginId, uid) => setNX(`login:${loginId}`, uid);
export const claimFarm = (farm, uid) => setNX(`farm:${farm}`, uid);
export const releaseLogin = loginId => del(`login:${loginId}`);

// 画面に返してよい項目だけ
export const publicUser = u => u && { id: u.id, loginId: u.loginId, name: u.name, role: u.role || null, farm: u.farm || null };

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const secure = req => req.headers['x-forwarded-proto'] === 'https';

export async function startSession(req, res, uid) {
  const token = crypto.randomBytes(32).toString('base64url');
  await setRaw(`sess:${sha(token)}`, uid, SESSION_SEC);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SEC}${secure(req) ? '; Secure' : ''}`);
}
export async function endSession(req, res) {
  const token = cookies(req)[COOKIE];
  if (token) await del(`sess:${sha(token)}`);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? '; Secure' : ''}`);
}
// ログイン中のユーザー。いなければ null
export async function currentUser(req) {
  const token = cookies(req)[COOKIE];
  if (!token || token.length > 100) return null;
  const uid = await getRaw(`sess:${sha(token)}`);
  return uid ? getUserById(uid) : null;
}

// GET  /api/auth                       ログイン中のユーザー（いなければ user:null）
// POST /api/auth {op:'signup', loginId, password, role, name, farm?}   新規登録してログイン
// POST /api/auth {op:'login', loginId, password}                       ログイン
// POST /api/auth {op:'logout'}                                         ログアウト
// POST /api/auth {op:'setRole', role, farm?}   役割が未設定のユーザーだけが一度だけ設定できる（設定済みの役割は変えない）

import { allow, setJSON } from '../lib/store.js';
import { KEY, load } from '../lib/inventory.js';
import {
  ROLES, hashPassword, checkPassword, getUserById, saveUser, newUserId, userIdByLogin,
  claimLogin, claimFarm, releaseLogin, publicUser, startSession, endSession, currentUser,
} from '../lib/auth.js';

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}
const ip = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
const LOGIN_RE = /^[a-z0-9_.-]{3,30}$/;
const text = (v, max) => typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null;

// 生産者の農家名を確保する。デモ用の架空の農家名は使えない。
// ログイン機能ができる前に同じ農家名で登録されていた出品は、この生産者の出品として引き継ぐ
async function takeFarm(farm, uid) {
  const st = await load();
  if (st.listings.some(l => l.demo && l.farm === farm)) return `「${farm}」はデモ用の架空の農家名です。あなたの農家名を入力してください`;
  if (!(await claimFarm(farm, uid))) return `「${farm}」はすでに別の生産者が登録しています。別の名前にしてください`;
  let changed = false;
  for (const l of st.listings) if (!l.demo && !l.ownerId && l.farm === farm) { l.ownerId = uid; changed = true; }
  if (changed) await setJSON(KEY, st);
  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return send(res, 200, { user: publicUser(await currentUser(req)) });
    if (req.method !== 'POST') return send(res, 405, { error: '使えない操作です' });
    if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: '使えない操作です' });
    const b = typeof req.body === 'object' && req.body ? req.body : {};

    if (b.op === 'logout') { await endSession(req, res); return send(res, 200, { user: null }); }

    if (b.op === 'login') {
      const loginId = String(b.loginId || '').trim().toLowerCase();
      if (!(await allow(`rl:login:${ip(req)}`, 20, 900))) return send(res, 429, { error: 'ログインの試行が多すぎます。15分ほど待ってからもう一度試してください' });
      const user = LOGIN_RE.test(loginId) ? await getUserById(await userIdByLogin(loginId)) : null;
      if (!user || typeof b.password !== 'string' || !checkPassword(b.password, user)) return send(res, 401, { error: 'ログインIDかパスワードが違います' });
      await startSession(req, res, user.id);
      return send(res, 200, { user: publicUser(user) });
    }

    if (b.op === 'signup') {
      if (!(await allow(`rl:signup:${ip(req)}`, 10, 3600))) return send(res, 429, { error: '登録の試行が多すぎます。しばらく待ってからもう一度試してください' });
      const loginId = String(b.loginId || '').trim().toLowerCase();
      const errors = [];
      if (!LOGIN_RE.test(loginId)) errors.push('ログインIDは半角英数字（と _ . -）の3〜30文字にしてください');
      if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 100) errors.push('パスワードは8文字以上にしてください');
      if (!ROLES.includes(b.role)) errors.push('飲食店か生産者かを選んでください');
      const name = text(b.name, 30);
      if (!name) errors.push(b.role === 'producer' ? 'お名前を30文字以内で入力してください' : '店名を30文字以内で入力してください');
      const farm = b.role === 'producer' ? text(b.farm, 30) : null;
      if (b.role === 'producer' && !farm) errors.push('農家名を30文字以内で入力してください');
      if (errors.length) return send(res, 400, { error: errors[0], errors });

      const uid = await newUserId();
      if (!(await claimLogin(loginId, uid))) return send(res, 409, { error: 'このログインIDはすでに使われています' });
      if (farm) {
        const err = await takeFarm(farm, uid);
        if (err) { await releaseLogin(loginId); return send(res, 409, { error: err }); }
      }
      const { salt, hash } = hashPassword(b.password);
      const user = { id: uid, loginId, name, role: b.role, farm, salt, hash, createdAt: Date.now() };
      await saveUser(user);
      await startSession(req, res, uid);
      return send(res, 200, { user: publicUser(user) });
    }

    if (b.op === 'setRole') {
      const user = await currentUser(req);
      if (!user) return send(res, 401, { error: 'ログインしてください' });
      if (user.role) return send(res, 409, { error: 'このアカウントの役割はすでに設定されています', user: publicUser(user) });
      if (!ROLES.includes(b.role)) return send(res, 400, { error: '飲食店か生産者かを選んでください' });
      if (b.role === 'producer') {
        const farm = text(b.farm, 30);
        if (!farm) return send(res, 400, { error: '農家名を30文字以内で入力してください' });
        const err = await takeFarm(farm, user.id);
        if (err) return send(res, 409, { error: err });
        user.farm = farm;
      }
      user.role = b.role;
      await saveUser(user);
      return send(res, 200, { user: publicUser(user) });
    }
    return send(res, 400, { error: '使えない操作です' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'ログイン情報を読み書きできませんでした。少し待ってからもう一度試してください' });
  }
}

// GET  /api/listings          出品・在庫を返す
// POST /api/listings {op,...}  出品・在庫の登録・更新（生産者としてログインが必要。編集できるのは自分の出品とデモの出品だけ）
//                              op:'reset'（デモデータの初期化）は管理者用。EDIT_PASSCODE を設定しているときはそのパスコードが必要
// AIはこのAPIを呼ばない。データを書き換えられるのは画面の操作だけ。

import { setJSON, hasRedis } from '../lib/store.js';
import { seedListings, validateListing } from '../lib/domain.js';
import { KEY, load } from '../lib/inventory.js';
import { aiReady } from '../lib/ai.js';
import { currentUser } from '../lib/auth.js';

const MAX_LISTINGS = 300;
const PASSCODE = process.env.EDIT_PASSCODE || '';
const OPS = new Set(['add', 'edit', 'qty', 'toggle', 'delete', 'reset']);

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}
// 自分の出品か・編集できるかを付けて返す。持ち主のユーザーIDは返さない
// 編集できるもの：自分の出品、デモの出品（だれでも試せる）
const canEdit = (l, u) => Boolean(u && u.role === 'producer' && (l.demo || l.ownerId === u.id));
const payload = (st, u) => ({ listings: st.listings.map(({ ownerId, ...l }) => ({ ...l, mine: Boolean(u && ownerId === u.id), editable: canEdit({ ...l, ownerId }, u) })) });
// デモ用の架空の農家名を、利用者の登録に使わせない（実データとデモデータが混ざらないように）
const demoFarmName = (st, name) => st.listings.some(l => l.demo && l.farm === name);

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const st = await load(), user = await currentUser(req);
      return send(res, 200, { ...payload(st, user), editLocked: Boolean(PASSCODE), shared: hasRedis, aiReady: aiReady() });
    }
    if (req.method !== 'POST') return send(res, 405, { error: '使えない操作です' });

    const body = typeof req.body === 'object' && req.body ? req.body : {};
    if (!OPS.has(body.op)) return send(res, 400, { error: '使えない操作です' });
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: 'ログインしてください', needLogin: true });
    if (body.op === 'reset') {
      if (PASSCODE ? req.headers['x-edit-passcode'] !== PASSCODE : user.role !== 'producer') return send(res, 403, { error: PASSCODE ? '管理者用パスコードが違います' : '生産者としてログインしてください' });
    } else if (user.role !== 'producer') return send(res, 403, { error: '出品の登録・変更は生産者のアカウントでできます' });

    const st = await load();
    const found = id => st.listings.find(l => l.id === id);
    // 他の生産者の出品は「見つからない」として扱い、変更させない
    const find = id => { const l = found(id); return l && canEdit(l, user) ? l : null; };

    switch (body.op) {
      case 'add': {
        if (st.listings.length >= MAX_LISTINGS) return send(res, 400, { error: `出品は${MAX_LISTINGS}件までです` });
        // 農家名はログイン中の生産者のものを使う（他の農家の名前では出品できない）
        const { errors, listing } = validateListing({ ...(body.listing || {}), farm: user.farm });
        if (errors.length) return send(res, 400, { error: errors[0], errors });
        if (demoFarmName(st, listing.farm)) return send(res, 409, { error: `「${listing.farm}」はデモ用の架空の農家名です。あなたの農家名で登録してください` });
        const dup = st.listings.find(x => x.active && x.farm === listing.farm && x.item === listing.item && x.variety === listing.variety && x.date === listing.date && x.place === listing.place && x.unit === listing.unit);
        if (dup) return send(res, 409, { error: `同じ日・同じ場所の「${listing.item}」がすでに出品されています。数量を変えるときは、出品カードの「数量を変更」を使ってください`, id: dup.id });
        const l = { ...listing, id: 'l' + (++st.seq), active: true, v: 1, demo: false, ownerId: user.id, at: Date.now(), updatedAt: Date.now() };
        st.listings.push(l);
        await setJSON(KEY, st);
        return send(res, 200, { ...payload(st, user), id: l.id });
      }
      case 'edit': {
        const l = find(body.id);
        if (!l) return send(res, 404, { error: '出品が見つかりません。画面を読み込み直してください' });
        // 農家名は変えられない（自分の出品は自分の農家名、デモの出品はデモの農家名のまま）
        const { errors, listing } = validateListing({ ...(body.listing || {}), farm: l.farm });
        if (errors.length) return send(res, 400, { error: errors[0], errors });
        const dup = st.listings.find(x => x.id !== l.id && x.active && x.farm === listing.farm && x.item === listing.item && x.variety === listing.variety && x.date === listing.date && x.place === listing.place && x.unit === listing.unit);
        if (dup) return send(res, 409, { error: `同じ日・同じ場所の「${listing.item}」がほかに出品されています。日付か受け渡し場所を変えてください`, id: dup.id });
        Object.assign(l, listing, { v: l.v + 1, editedAt: Date.now(), updatedAt: Date.now() });
        await setJSON(KEY, st);
        return send(res, 200, { ...payload(st, user), id: l.id });
      }
      case 'qty': {
        const l = find(body.id);
        const q = Number(body.qty);
        if (!l) return send(res, 404, { error: '出品が見つかりません。画面を読み込み直してください' });
        if (!(q >= 0 && q <= 999)) return send(res, 400, { error: '販売可能量は0〜999で入力してください' });
        l.qty = Math.round(q * 10) / 10;
        l.v++; l.updatedAt = Date.now();
        await setJSON(KEY, st);
        return send(res, 200, payload(st, user));
      }
      case 'toggle': {
        const l = find(body.id);
        if (!l) return send(res, 404, { error: '出品が見つかりません。画面を読み込み直してください' });
        l.active = !l.active;
        l.v++; l.updatedAt = Date.now();
        await setJSON(KEY, st);
        return send(res, 200, payload(st, user));
      }
      case 'delete': {
        const i = st.listings.findIndex(l => l.id === body.id && canEdit(l, user));
        if (i < 0) return send(res, 404, { error: '出品が見つかりません。すでに削除されています' });
        st.listings.splice(i, 1);
        await setJSON(KEY, st);
        return send(res, 200, payload(st, user));
      }
      case 'reset': {
        // デモデータだけを初期状態に戻す。利用者が登録した出品は残す
        const fresh = seedListings();
        const keepL = st.listings.filter(l => !l.demo);
        const next = { ...fresh, seq: Math.max(st.seq || 0, fresh.seq), listings: [...fresh.listings, ...keepL] };
        await setJSON(KEY, next);
        return send(res, 200, { ...payload(next, user), kept: { listings: keepL.length } });
      }
      default:
        return send(res, 400, { error: '使えない操作です' });
    }
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'データを読み書きできませんでした。少し待ってからもう一度試してください' });
  }
}

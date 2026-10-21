// GET  /api/deals                                     自分が当事者の取引（依頼〜完了）だけを返す
// POST /api/deals {op:'request', reqKey, planNo, note, picks:[{listingId, qty}]}
//        飲食店が仕入れ案の候補から、出品ごとに仕入れ依頼を送る。同じ reqKey で送り直しても二重には作らない
// POST /api/deals {op:'act', id, v, action, terms?, note?}
//        回答・条件変更・準備・受け渡し・受け取り確認など。v（画面が見ている版）が今の版と違えば受け付けない
//
// 保存先：deal:<id>（取引1件ずつ）、deals:u:<ユーザーID>／deals:demo（一覧用の索引）、dealreq:…（二重送信よけ）

import { getRaw, mgetRaw, setNX, setRaw, incr, sadd, smembers, casRaw } from '../lib/store.js';
import { load } from '../lib/inventory.js';
import { todayJST } from '../lib/domain.js';
import { currentUser, userIdByFarm } from '../lib/auth.js';
import { sideOf, apply, view, checkTerms } from '../lib/deals.js';

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}
const MAX_PICKS = 10;

async function myDeals(user) {
  const ids = new Set(await smembers(`deals:u:${user.id}`));
  if (user.role === 'producer') for (const id of await smembers('deals:demo')) ids.add(id);
  const raws = await mgetRaw([...ids].map(id => `deal:${id}`));
  return raws.filter(Boolean).map(r => JSON.parse(r))
    .map(d => ({ d, side: sideOf(d, user) })).filter(x => x.side)
    .sort((a, b) => b.d.updatedAt - a.d.updatedAt)
    .map(x => view(x.d, x.side));
}

async function createRequest(user, b) {
  const picks = Array.isArray(b.picks) ? b.picks.slice(0, MAX_PICKS) : [];
  const reqKey = typeof b.reqKey === 'string' && /^[\w-]{8,64}$/.test(b.reqKey) ? b.reqKey : null;
  if (!reqKey || !picks.length) return { status: 400, error: '依頼する候補がありません' };
  const st = await load(), today = todayJST(), out = [];
  for (const p of picks) {
    const l = st.listings.find(x => x.id === p.listingId);
    const qty = Math.round(Number(p.qty) * 10) / 10;
    if (!l) { out.push({ listingId: p.listingId, error: '出品が見つかりません（削除された可能性があります）' }); continue; }
    if (!l.active || l.qty <= 0 || l.date < today) { out.push({ listingId: l.id, farm: l.farm, error: `${l.farm}の${l.item}は、いま公開されていません` }); continue; }
    if (!(qty > 0 && qty <= l.qty && qty >= l.minQty)) { out.push({ listingId: l.id, farm: l.farm, error: `${l.farm}の${l.item}は${l.minQty}〜${l.qty}${l.unit}の範囲で依頼してください` }); continue; }
    // 宛先の生産者。デモの出品はデモ農家（どの生産者アカウントでも回答を試せる）
    const producerId = l.demo ? null : (l.ownerId || await userIdByFarm(l.farm));
    if (!l.demo && !producerId) { out.push({ listingId: l.id, farm: l.farm, error: `${l.farm}はまだアカウントを登録していないため、依頼を送れません` }); continue; }

    const id = 'd' + (await incr('deals:seq'));
    const lock = `dealreq:${user.id}:${reqKey}:${l.id}`;
    if (!(await setNX(lock, id, 30 * 24 * 3600))) {
      // 同じ依頼の送り直し：すでに作った取引を返す
      out.push({ listingId: l.id, farm: l.farm, id: await getRaw(lock), duplicate: true });
      continue;
    }
    const terms = { qty, price: l.price, date: l.date, from: l.from, to: l.to, place: l.place };
    if (checkTerms(terms).length) { out.push({ listingId: l.id, farm: l.farm, error: '出品の受け渡し条件が不完全なため、依頼を送れません' }); continue; }
    const now = Date.now();
    const deal = {
      id, v: 1, createdAt: now, updatedAt: now, reqKey,
      restaurantId: user.id, restaurantName: user.name,
      producerId, farm: l.farm, demo: Boolean(l.demo),
      listingId: l.id, item: l.item, variety: l.variety || '', unit: l.unit, grade: l.grade, reason: l.grade === '規格外' ? l.reason : '',
      planNo: typeof b.planNo === 'string' ? b.planNo.slice(0, 20) : '',
      note: typeof b.note === 'string' ? b.note.trim().slice(0, 200) : '',
      terms, termsV: 1, proposedBy: 'restaurant', agreed: { restaurant: 1, producer: 0 },
      status: 'requested', history: [{ at: now, by: 'restaurant', action: 'request', terms }],
    };
    await setRaw(`deal:${id}`, JSON.stringify(deal));
    await sadd(`deals:u:${user.id}`, id);
    await sadd(producerId ? `deals:u:${producerId}` : 'deals:demo', id);
    out.push({ listingId: l.id, farm: l.farm, id });
  }
  return { status: 200, results: out };
}

export default async function handler(req, res) {
  try {
    const user = await currentUser(req);
    if (!user) return send(res, 401, { error: 'ログインしてください', needLogin: true });
    if (req.method === 'GET') return send(res, 200, { deals: await myDeals(user) });
    if (req.method !== 'POST') return send(res, 405, { error: '使えない操作です' });
    if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: '使えない操作です' });
    const b = typeof req.body === 'object' && req.body ? req.body : {};

    if (b.op === 'request') {
      if (user.role !== 'restaurant') return send(res, 403, { error: '仕入れ依頼は飲食店のアカウントから送れます' });
      const r = await createRequest(user, b);
      if (r.error) return send(res, r.status, { error: r.error });
      return send(res, 200, { results: r.results, deals: await myDeals(user) });
    }

    if (b.op === 'act') {
      const key = `deal:${String(b.id || '').replace(/[^\w]/g, '')}`;
      const raw = await getRaw(key);
      const deal = raw ? JSON.parse(raw) : null;
      const side = deal && sideOf(deal, user);
      // 当事者でなければ、取引があるかどうかも知らせない
      if (!side) return send(res, 404, { error: '取引が見つかりません' });
      if (Number(b.v) !== deal.v) return send(res, 409, { error: 'この取引は、ほかの操作ですでに更新されています。最新の状態を表示しました', deal: view(deal, side) });
      const r = apply(deal, side, String(b.action || ''), { terms: b.terms, note: b.note });
      if (r.error) return send(res, r.status, { error: r.error, errors: r.errors, deal: view(deal, side) });
      if (!(await casRaw(key, raw, JSON.stringify(r.deal)))) {
        const now = JSON.parse(await getRaw(key));
        return send(res, 409, { error: 'この取引は、ほかの操作ですでに更新されています。最新の状態を表示しました', deal: view(now, side) });
      }
      return send(res, 200, { deal: view(r.deal, side) });
    }
    return send(res, 400, { error: '使えない操作です' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: '取引を読み書きできませんでした。少し待ってからもう一度試してください' });
  }
}

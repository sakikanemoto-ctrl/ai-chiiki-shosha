// 仕入れ依頼〜取引完了の状態と、だれがどの状態で何をできるか。
//
//   requested  飲食店が依頼を送った（または飲食店が条件を出し直した）→ 生産者の回答待ち
//   countered  生産者が条件の変更を提案した → 飲食店の回答待ち
//   matched    数量・単価・受け渡し日・時間・場所のすべてに、双方が同じ内容で同意した＝マッチング成立
//   preparing  生産者が食材を準備中
//   handed     生産者が受け渡し済みにした → 飲食店の受け取り確認待ち
//   completed  飲食店が受け取りを確認した＝取引完了
//   declined   生産者が依頼を断った
//   cancelled  どちらかが取りやめた
//
// 依頼を送っただけ・生産者が受けただけでは成立にしない。条件（terms）には版番号（termsV）があり、
// 飲食店と生産者の両方が「同じ版」に同意し、条件がすべて埋まっているときだけ matched にする。
// 決済・配送・在庫の確保はこのアプリでは行わない。受け渡しは合意した日時・場所で当事者どうしが行う。

import { PLACES, isISO, todayJST } from './domain.js';

export const OPEN = ['requested', 'countered'];
export const ACTIVE = ['requested', 'countered', 'matched', 'preparing', 'handed'];

// [状態][立場] → できる操作
const ALLOWED = {
  requested: { producer: ['accept', 'decline', 'counter'], restaurant: ['cancel'] },
  countered: { producer: [], restaurant: ['accept', 'counter', 'cancel'] },
  matched: { producer: ['prepare', 'cancel'], restaurant: ['cancel'] },
  preparing: { producer: ['handover', 'cancel'], restaurant: ['cancel'] },
  handed: { producer: [], restaurant: ['receive'] },
  completed: { producer: [], restaurant: [] },
  declined: { producer: [], restaurant: [] },
  cancelled: { producer: [], restaurant: [] },
};
export const allowed = (deal, side) => (ALLOWED[deal.status] || {})[side] || [];

// このユーザーが、この取引のどちら側か（当事者でなければ null）
export function sideOf(deal, user) {
  if (!user) return null;
  if (user.role === 'restaurant' && deal.restaurantId === user.id) return 'restaurant';
  if (user.role === 'producer' && (deal.producerId === user.id || (deal.demo && !deal.producerId))) return 'producer';
  return null;
}

const isTime = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
// 条件の検証。すべて埋まっていないと成立させない
export function checkTerms(t, { future = true } = {}) {
  const e = [];
  const qty = Number(t && t.qty), price = Number(t && t.price);
  if (!(qty > 0 && qty <= 999)) e.push('数量は0より大きく999以下にしてください');
  if (!(Number.isInteger(price) && price >= 1 && price <= 100000)) e.push('単価は1〜100,000円の整数にしてください');
  if (!isISO(t && t.date)) e.push('受け渡し日を選んでください');
  else if (future && t.date < todayJST()) e.push('受け渡し日は今日以降にしてください');
  if (!isTime(t && t.from) || !isTime(t && t.to) || t.from >= t.to) e.push('受け渡し時間の「から」を「まで」より前にしてください');
  if (!PLACES.includes(t && t.place)) e.push('受け渡し場所を選んでください');
  return e;
}
export const cleanTerms = t => ({ qty: Math.round(Number(t.qty) * 10) / 10, price: Number(t.price), date: t.date, from: t.from, to: t.to, place: t.place });

const note = v => (typeof v === 'string' ? v.trim().slice(0, 200) : '');

// 操作を適用した新しい取引を返す。できない操作なら {error}
export function apply(deal, side, action, input = {}) {
  if (!allowed(deal, side).includes(action)) return { error: 'この取引の今の状態では、その操作はできません。画面を更新してください', status: 409 };
  const d = structuredClone(deal), now = Date.now();
  const log = extra => d.history.push({ at: now, by: side, action, ...extra });
  const other = side === 'restaurant' ? 'producer' : 'restaurant';
  switch (action) {
    case 'accept': {
      // 相手が出した最新の条件に同意する。両者が同じ版に同意し、条件がすべて埋まっていれば成立
      if (checkTerms(d.terms, { future: false }).length) return { error: '取引条件にまだ決まっていない項目があるため、成立にできません', status: 400 };
      d.agreed[side] = d.termsV;
      log({});
      if (d.agreed[other] === d.termsV) { d.status = 'matched'; d.matchedAt = now; }
      break;
    }
    case 'counter': {
      const errs = checkTerms(input.terms || {});
      if (errs.length) return { error: errs[0], errors: errs, status: 400 };
      const t = cleanTerms(input.terms);
      if (JSON.stringify(t) === JSON.stringify(d.terms)) return { error: '条件が変わっていません。変える項目を直してから送ってください', status: 400 };
      d.terms = t; d.termsV++; d.proposedBy = side;
      d.agreed = { restaurant: 0, producer: 0, [side]: d.termsV };
      d.status = side === 'producer' ? 'countered' : 'requested';
      log({ terms: t, note: note(input.note) });
      break;
    }
    case 'decline': d.status = 'declined'; log({ note: note(input.note) }); break;
    case 'cancel': d.status = 'cancelled'; d.cancelledBy = side; log({ note: note(input.note) }); break;
    case 'prepare': d.status = 'preparing'; log({}); break;
    case 'handover': d.status = 'handed'; log({}); break;
    case 'receive': d.status = 'completed'; d.completedAt = now; log({}); break;
    default: return { error: '使えない操作です', status: 400 };
  }
  d.v++; d.updatedAt = now;
  return { deal: d };
}

// 画面に返す形。相手のユーザーIDなど内部の値は返さない
export function view(deal, side) {
  const { restaurantId, producerId, reqKey, ...rest } = deal;
  return { ...rest, side, actions: allowed(deal, side) };
}

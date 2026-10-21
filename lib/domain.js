// 品目・地域・受渡場所のマスタ、日付、デモデータ、入力検証。
// public/index.html の同名定数と内容をそろえること。

export const ITEMS = ['ミニトマト','トマト','なす','きゅうり','ピーマン','万願寺とうがらし','玉ねぎ','じゃがいも','小松菜','ほうれん草','キャベツ','大根'];
export const UNITS = ['kg','個','束'];
export const REGION_GROUPS = {
  '大阪近郊': ['大阪市','北摂','能勢・豊能','北河内','中河内','南河内','泉州'],
  '北摂': ['北摂','能勢・豊能'],
  '能勢・豊能': ['能勢・豊能'],
  '大阪市': ['大阪市'],
  '京都府': ['京都府'],
  '兵庫県': ['兵庫県'],
};
export const FARM_REGIONS = ['能勢・豊能','北摂','大阪市','北河内','中河内','南河内','泉州','京都府','兵庫県','奈良県'];
export const PLACES = ['拠点P（豊中・共通受渡拠点）','拠点Q（能勢・道の駅）','亀岡集荷所'];
export const OFF_REASONS = ['形の不揃い','サイズ不揃い','色むら','軽い表面傷'];

// サーバーはUTCで動くので、日付は日本時間で数える
const pad = n => String(n).padStart(2, '0');
export function todayJST() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function shiftISO(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function daysBetween(a, b) {
  const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 864e5);
}
export const isISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);

// デモ用の架空の出品。実在の農園の在庫・価格ではない。
// 仕様書8章：A農家5kg/600円・B農家3kg/550円・C農家2kg/350円（余剰・形の不揃い）、明後日10〜11時・拠点P・最低1kg・1kg刻み
export function seedListings() {
  const t = todayJST(), d1 = shiftISO(t, 1), d2 = shiftISO(t, 2), d3 = shiftISO(t, 3);
  const P = PLACES[0];
  let n = 0;
  const L = o => ({ active: true, grade: '通常', reason: '', surplus: false, minQty: 1, step: 1, unit: 'kg', v: 1, demo: true, at: Date.now() - (++n) * 2 * 3600e3, ...o });
  return {
    seededOn: t,
    seq: 10,
    listings: [
      L({ id: 'l1', farm: 'A農家', item: 'トマト', variety: '桃太郎', qty: 5, price: 600, region: '能勢・豊能', date: d2, from: '10:00', to: '11:00', place: P }),
      L({ id: 'l2', farm: 'B農家', item: 'トマト', variety: '麗夏', qty: 3, price: 550, region: '北摂', date: d2, from: '10:00', to: '11:00', place: P }),
      L({ id: 'l3', farm: 'C農家', item: 'トマト', variety: '桃太郎', qty: 2, price: 350, region: '能勢・豊能', date: d2, from: '10:00', to: '11:00', place: P, grade: '規格外', reason: '形の不揃い', surplus: true }),
      L({ id: 'l4', farm: 'D農園', item: 'トマト', variety: 'りんか409', qty: 6, price: 500, region: '京都府', date: d2, from: '10:00', to: '11:00', place: PLACES[2] }),
      L({ id: 'l5', farm: 'E農家', item: 'トマト', variety: '桃太郎', qty: 4, price: 580, region: '北摂', date: d3, from: '10:00', to: '11:00', place: P }),
      L({ id: 'l6', farm: 'A農家', item: 'なす', variety: '千両', qty: 4, price: 400, region: '能勢・豊能', date: d1, from: '16:00', to: '17:00', place: P }),
      L({ id: 'l7', farm: 'C農家', item: 'なす', variety: '千両', qty: 3, price: 280, region: '能勢・豊能', date: d1, from: '16:00', to: '17:00', place: P, grade: '規格外', reason: 'サイズ不揃い' }),
      L({ id: 'l8', farm: 'B農家', item: '万願寺とうがらし', variety: '', qty: 2, price: 1200, region: '北摂', date: d1, from: '16:00', to: '17:00', place: P, minQty: 0.5, step: 0.5 }),
      L({ id: 'l9', farm: 'A農家', item: '万願寺とうがらし', variety: '', qty: 1.5, price: 1250, region: '能勢・豊能', date: d1, from: '16:00', to: '17:00', place: P, minQty: 0.5, step: 0.5 }),
    ],
  };
}

// 出品の検証。エラー文の配列と、保存してよい形に整えた出品を返す。
export function validateListing(d) {
  const e = [];
  const s = v => (typeof v === 'string' ? v.trim() : '');
  const n = v => (typeof v === 'number' ? v : Number(v));
  const l = {
    farm: s(d.farm), item: s(d.item), variety: s(d.variety), date: s(d.date), region: s(d.region),
    qty: n(d.qty), unit: s(d.unit), price: n(d.price), place: s(d.place), from: s(d.from), to: s(d.to),
    minQty: n(d.minQty), step: n(d.step), grade: d.grade === '規格外' ? '規格外' : '通常',
    reason: d.grade === '規格外' ? s(d.reason) : '', surplus: d.surplus === true,
  };
  if (!l.farm || l.farm.length > 30) e.push('農家名を30文字以内で入力してください');
  if (l.variety.length > 20) e.push('品種は20文字以内で入力してください');
  if (!ITEMS.includes(l.item)) e.push('品目を選んでください');
  if (!isISO(l.date) || l.date < todayJST()) e.push('販売可能日を今日以降で選んでください');
  if (!(l.qty > 0 && l.qty <= 999)) e.push('販売可能量は0より大きく999以下で入力してください');
  if (!(Number.isInteger(l.price) && l.price >= 1 && l.price <= 100000)) e.push('単価は1〜100,000円の整数で入力してください');
  if (!(l.minQty > 0)) e.push('最低販売量は0より大きい数にしてください');
  if (!(l.step >= 0.1 && l.step <= 999)) e.push('販売刻みは0.1以上にしてください');
  if (l.minQty > l.qty) e.push('最低販売量が販売可能量より大きくなっています');
  if (!isTime(l.from) || !isTime(l.to) || l.from >= l.to) e.push('受渡時間の「から」を「まで」より前にしてください');
  if (!UNITS.includes(l.unit) || !PLACES.includes(l.place) || !FARM_REGIONS.includes(l.region)) e.push('選択肢から選んでください');
  if (l.grade === '規格外' && !OFF_REASONS.includes(l.reason)) e.push('規格外の理由を選んでください');
  l.qty = Math.round(l.qty * 10) / 10;
  l.minQty = Math.round(l.minQty * 10) / 10;
  l.step = Math.round(l.step * 10) / 10;
  return { errors: e, listing: l };
}

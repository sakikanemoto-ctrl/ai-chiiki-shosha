// 出品・在庫の読み込み。/api/listings と /api/draft が共有する。

import { getJSON, setJSON } from './store.js';
import { seedListings, todayJST, shiftISO, daysBetween } from './domain.js';
import { canonicalPlace } from './places.js';

export const KEY = 'listings:v1';
const ROLLING = process.env.DEMO_ROLLING_DATES !== '0';

export async function load() {
  let st = await getJSON(KEY);
  if (!st || !Array.isArray(st.listings)) {
    st = seedListings();
    await setJSON(KEY, st);
    return st;
  }
  // 拠点の名前を変えたとき（lib/places.js の aliases）、保存済みの出品の拠点名を新しい名前にそろえる
  let renamed = false;
  for (const l of st.listings) { const p = canonicalPlace(l.place); if (p !== l.place) { l.place = p; renamed = true; } }
  if (renamed) await setJSON(KEY, st);
  const today = todayJST();
  // デモデータの日付を毎日繰り越して、「明後日のトマト」の例がいつでも成り立つようにする
  if (ROLLING && st.seededOn && st.seededOn !== today) {
    const diff = daysBetween(st.seededOn, today);
    for (const l of st.listings) if (l.demo) l.date = shiftISO(l.date, diff);
    st.seededOn = today;
    await setJSON(KEY, st);
  }
  return st;
}

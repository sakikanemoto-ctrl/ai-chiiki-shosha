// 出品・在庫の読み込み。/api/listings と /api/draft が共有する。

import { getJSON, setJSON } from './store.js';
import { seedListings, todayJST, shiftISO, daysBetween } from './domain.js';

export const KEY = 'listings:v1';
const ROLLING = process.env.DEMO_ROLLING_DATES !== '0';

export async function load() {
  let st = await getJSON(KEY);
  if (!st || !Array.isArray(st.listings)) {
    st = seedListings();
    await setJSON(KEY, st);
    return st;
  }
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

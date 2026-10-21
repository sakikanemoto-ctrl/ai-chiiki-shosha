// 受け渡し拠点の設定。拠点の名前・場所を変えるときは、ここ（または環境変数 PLACES_JSON）だけを直す。
//
// 出品（listings の place）と取引の条件（terms.place）には拠点の「表示名」がそのまま保存されている。
// 名前を変えるときは、変更前の名前を aliases に残すと、保存済みのデータを読み込むときに新しい名前へ読み替える
// （出品は読み込み時に保存し直し、取引は表示と次の操作のときに読み替える）。
//
//   name     表示名（選択肢・出品・取引に使う）
//   short    短い表示（カードなど）
//   lat/lng  おおよその位置（「現在地から近い順」の並べ替えだけに使う。正確な住所ではない）
//   aliases  以前の表示名
//
// 環境変数 PLACES_JSON に同じ形の配列（JSON）を入れると、このファイルの値の代わりに使う（Vercel の設定から変更できる）。

const DEFAULT_PLACES = [
  { id: 'P', name: '拠点P（豊中・共通受渡拠点）', short: '拠点P', lat: 34.78, lng: 135.47, aliases: [] },
  { id: 'Q', name: '拠点Q（能勢・道の駅）', short: '拠点Q', lat: 34.95, lng: 135.47, aliases: [] },
  { id: 'K', name: '亀岡集荷所', short: '亀岡集荷所', lat: 35.01, lng: 135.58, aliases: [] },
];

function fromEnv() {
  try {
    const v = JSON.parse(process.env.PLACES_JSON || 'null');
    const ok = Array.isArray(v) && v.length && v.every(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim());
    if (v && !ok) console.error('PLACES_JSON の形式が正しくないため、lib/places.js の値を使います');
    return ok ? v : null;
  } catch (e) {
    console.error('PLACES_JSON を読めないため、lib/places.js の値を使います');
    return null;
  }
}

export const PLACE_LIST = (fromEnv() || DEFAULT_PLACES).map(p => ({
  id: p.id, name: p.name.trim(), short: (p.short || p.name).trim(),
  lat: Number.isFinite(p.lat) ? p.lat : null, lng: Number.isFinite(p.lng) ? p.lng : null,
  aliases: Array.isArray(p.aliases) ? p.aliases.filter(a => typeof a === 'string') : [],
}));
export const PLACES = PLACE_LIST.map(p => p.name);

// 保存済みの名前（以前の名前を含む）を、今の表示名にする。知らない名前はそのまま返す
const lookup = new Map(PLACE_LIST.flatMap(p => [[p.name, p.name], ...p.aliases.map(a => [a, p.name])]));
export const canonicalPlace = name => lookup.get(name) || name;

// 画面に渡す形（以前の名前は渡さない）
export const publicPlaces = () => PLACE_LIST.map(({ aliases, ...p }) => p);

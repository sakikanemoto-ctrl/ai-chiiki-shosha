// 在庫データの保存先。Upstash Redis（Vercel Marketplace 経由で接続）を REST API で使う。
// 環境変数が無いときはメモリに置く（ローカル確認用。サーバーが再起動すると消え、端末間で共有されない）。

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasRedis = Boolean(URL_ && TOKEN);

const mem = new Map();

async function redis(cmd) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`redis ${data.error}`);
  return data.result;
}

export async function getJSON(key) {
  if (!hasRedis) return mem.has(key) ? structuredClone(mem.get(key)) : null;
  const v = await redis(['GET', key]);
  return v == null ? null : JSON.parse(v);
}

export async function setJSON(key, value) {
  if (!hasRedis) { mem.set(key, structuredClone(value)); return; }
  await redis(['SET', key, JSON.stringify(value)]);
}

// ---- ユーザー・セッション・取引用（文字列のまま扱う） ----
const memExp = new Map(); // key → 期限（ミリ秒）
const memGet = key => { const t = memExp.get(key); if (t && t < Date.now()) { mem.delete(key); memExp.delete(key); } return mem.get(key); };

export async function getRaw(key) {
  if (!hasRedis) { const v = memGet(key); return v == null ? null : v; }
  return redis(['GET', key]);
}
export async function mgetRaw(keys) {
  if (!keys.length) return [];
  if (!hasRedis) return keys.map(k => memGet(k) ?? null);
  return redis(['MGET', ...keys]);
}
// まだ無いときだけ書く。書けたら true
export async function setNX(key, value, exSec) {
  if (!hasRedis) { if (memGet(key) != null) return false; mem.set(key, value); if (exSec) memExp.set(key, Date.now() + exSec * 1000); return true; }
  return (await redis(exSec ? ['SET', key, value, 'NX', 'EX', String(exSec)] : ['SET', key, value, 'NX'])) === 'OK';
}
export async function setRaw(key, value, exSec) {
  if (!hasRedis) { mem.set(key, value); if (exSec) memExp.set(key, Date.now() + exSec * 1000); else memExp.delete(key); return; }
  await redis(exSec ? ['SET', key, value, 'EX', String(exSec)] : ['SET', key, value]);
}
export async function del(key) {
  if (!hasRedis) { mem.delete(key); memExp.delete(key); return; }
  await redis(['DEL', key]);
}
export async function incr(key) {
  if (!hasRedis) { const n = (Number(memGet(key)) || 0) + 1; mem.set(key, String(n)); return n; }
  return Number(await redis(['INCR', key]));
}
export async function sadd(key, member) {
  if (!hasRedis) { const s = new Set(memGet(key) || []); s.add(member); mem.set(key, [...s]); return; }
  await redis(['SADD', key, member]);
}
export async function smembers(key) {
  if (!hasRedis) return [...(memGet(key) || [])];
  return (await redis(['SMEMBERS', key])) || [];
}
// 比較して入れ替え：保存中の値が old のときだけ next に書き換える。書けたら true。
// 読んでから書くまでの間に別の操作が入った場合（二重押し・同時操作）は false になる
const CAS = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]) return 1 else return 0 end";
export async function casRaw(key, old, next) {
  if (!hasRedis) { if (memGet(key) !== old) return false; mem.set(key, next); return true; }
  return Number(await redis(['EVAL', CAS, '1', key, old, next])) === 1;
}

// 固定ウィンドウのレート制限。true なら許可。
export async function allow(key, limit, windowSec) {
  if (!hasRedis) {
    const now = Date.now();
    const e = mem.get(key);
    if (!e || e.reset < now) { mem.set(key, { n: 1, reset: now + windowSec * 1000 }); return true; }
    e.n++;
    return e.n <= limit;
  }
  const n = await redis(['INCR', key]);
  if (n === 1) await redis(['EXPIRE', key, String(windowSec)]);
  return n <= limit;
}

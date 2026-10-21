// POST /api/draft {kind:'menu', listingIds, wants?}
// 仕入れ案に含まれる登録食材（規格外・余剰を含む）から、限定メニューの料理案・メニュー名・紹介文をAIが書く。
// 文章を返すだけで、在庫・価格・数量の判断はしない。事実はサーバーの登録データから渡す。

import { allow } from '../lib/store.js';
import { load } from '../lib/inventory.js';
import { generate, aiReady, AIError, STATUS } from '../lib/ai.js';

const PER_HOUR = Number(process.env.PARSE_LIMIT_PER_HOUR || 30);

// 登録食材（listings）だけを主材料として、限定メニューのアイデアを出す
const MENU_SYSTEM = `あなたは飲食店のメニュー開発を手伝うスタッフです。渡された登録食材（listings）を主に使う限定メニューのアイデアを、日本語で2〜3案書いてください。各案はメニュー名と1〜2文の紹介文にします。
- 300文字以内。本文だけを出力する。
- 主材料は listings の食材だけ。それ以外の材料は「その他の材料」として書き、仕入れできるとは書かない。
- grade が「規格外」や surplus が true の食材は、形を問わない使い方を提案してよい。傷みや鮮度低下があるとは書かない。
- 在庫・価格・数量が足りるかは判断しない。評判や効果などの根拠のないことは書かない。`;

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: '使えない操作です' });
  if (!aiReady()) return res.status(503).json({ error: 'ai_unavailable' });

  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  try {
    if (!(await allow(`rl:draft:${ip}`, PER_HOUR, 3600))) return res.status(429).json({ error: 'rate_limited' });
  } catch (err) {
    console.error('rate limit store', err);
  }

  const b = req.body || {};
  if (b.kind !== 'menu') return res.status(400).json({ error: 'bad_kind' });
  let st;
  try { st = await load(); } catch (err) { console.error(err); return res.status(500).json({ error: 'store_error' }); }
  const menuLs = Array.isArray(b.listingIds) ? b.listingIds.slice(0, 6).map(id => st.listings.find(x => x.id === id)).filter(Boolean) : [];
  if (!menuLs.length) return res.status(404).json({ error: 'not_found' });
  const w = b.wants && typeof b.wants === 'object' ? b.wants : {};
  const facts = {
    listings: menuLs.map(x => ({ item: x.item, variety: x.variety || null, grade: x.grade, reason: x.reason || null, surplus: Boolean(x.surplus) })),
    wants: { note: clip(w.note, 100) || null, servings: Number(w.qty) > 0 ? Number(w.qty) : null },
  };
  try {
    const out = await generate({ system: MENU_SYSTEM, user: JSON.stringify(facts), maxTokens: 1000 });
    return res.status(200).json({ ok: true, text: out.slice(0, 300) });
  } catch (err) {
    if (err instanceof AIError) {
      if (err.code !== 'rate_limited') console.error(err.message);
      return res.status(STATUS[err.code] || 502).json({ error: err.code });
    }
    console.error(err);
    return res.status(502).json({ error: 'ai_error' });
  }
}

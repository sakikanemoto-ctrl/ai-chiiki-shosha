// Gemini API（Google AI Studio の無料枠）を呼ぶ共通処理。SDKは使わず REST で呼ぶ。
// GEMINI_API_KEY を環境変数から読む。モデルは GEMINI_MODEL で差し替えられる。

// 無料枠は混雑で 503 を返すことがあるので、混雑・一時エラーのときは次のモデルで再試行する
const MODELS = [...new Set([process.env.GEMINI_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest'])];
const RETRY = new Set([500, 503, 504]);
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export const aiReady = () => Boolean(process.env.GEMINI_API_KEY);

export class AIError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// {system, user, schema?, maxTokens} → 文字列（schema があるときは JSON 文字列）
export async function generate({ system, user, schema, maxTokens = 1000 }) {
  const generationConfig = { maxOutputTokens: maxTokens, temperature: 0.2 };
  if (schema) { generationConfig.responseMimeType = 'application/json'; generationConfig.responseSchema = schema; }

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig,
  });
  let r, last;
  for (const model of MODELS) {
    try {
      r = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body,
        signal: AbortSignal.timeout(12000),
      });
    } catch (err) {
      last = new AIError('ai_error', `${model} network: ${err.message}`);
      continue;
    }
    if (RETRY.has(r.status) || r.status === 404) { last = new AIError('ai_error', `${model} ${r.status}: ${(await r.text()).slice(0, 200)}`); continue; }
    last = null;
    break;
  }
  if (last) throw last;

  if (r.status === 429) throw new AIError('rate_limited');
  if (r.status === 401 || r.status === 403) throw new AIError('ai_unavailable', 'GEMINI_API_KEY is invalid');
  if (!r.ok) throw new AIError('ai_error', `Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);

  const data = await r.json();
  if (data.promptFeedback?.blockReason) throw new AIError('refused');
  const cand = data.candidates?.[0];
  if (!cand) throw new AIError('empty_response');
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') throw new AIError('refused');
  if (cand.finishReason === 'MAX_TOKENS') throw new AIError('truncated');
  const text = (cand.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!text) throw new AIError('empty_response');
  return text;
}

export const STATUS = { rate_limited: 429, ai_unavailable: 503, refused: 422 };

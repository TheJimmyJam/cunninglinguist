// Shared guard for the AI endpoints (translate, converse): who is calling
// (Supabase session, checked against Supabase auth), how much they used today
// (per-user daily cap), the Anthropic call (structured output) and a cost line
// in the function log. No npm dependencies: the site deploys with
// `netlify deploy --dir=.` and no install step, so everything is fetch().
//
// Env (Netlify site settings):
//   ANTHROPIC_API_KEY          required, server-side only
//   SUPABASE_SERVICE_ROLE_KEY  required (the CCC project's service role key):
//                              reads/writes the per-user counter
//   SUPABASE_URL, SUPABASE_ANON_KEY   optional; default to the public CCC
//                              project values the page already uses
//   CLL_CONVERSE_DAILY_CAP     optional, default 60
//   CLL_TRANSLATE_DAILY_CAP    optional, default 100
//
// The counter lives in the user's auth app_metadata (key cll_ai: { day,
// converse, translate }), which only the service role can write. No table, no
// schema change. Read-modify-write: two calls in the same instant can both
// pass at the cap edge (an overrun of a call or two at most).

const DEFAULT_SUPABASE_URL = 'https://azkyohtmhlvnkziuvgvk.supabase.co';
const DEFAULT_SUPABASE_ANON = 'sb_publishable_C4F7zGYkDVm9hP5hxMRvLg_ral9g3y1';
export const DEFAULT_CAPS = { converse: 60, translate: 100 };
export const ALLOWED_ORIGINS = new Set([
  'https://apps.cannoncodeconnect.com',
  'https://cunninglinguist.netlify.app'
]);

// List prices per 1M tokens (USD), claude-api skill table cached 2026-11-03.
// Haiku 5.5 is $0.10/$0.50 up to 100K prompt tokens (these prompts are tiny).
export const PRICES = {
  'claude-sonnet-5-5': { in: 2.00, out: 10.00, cacheRead: 0.10, cacheWrite: 2.50 },
  'claude-sonnet-5': { in: 2.00, out: 10.00, cacheRead: 0.20, cacheWrite: 2.50 },
  'claude-haiku-5-5': { in: 0.10, out: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-opus-4-8': { in: 5.00, out: 25.00, cacheRead: 0.50, cacheWrite: 6.25 },
  'claude-opus-5-5': { in: 4.00, out: 20.00, cacheRead: 0.20, cacheWrite: 5.00 }
};

export function json(status, obj, extra) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(extra || {}) }
  });
}

export function dayKey(now) { return new Date(now || Date.now()).toISOString().slice(0, 10); }

function sbConf(env) {
  return {
    url: (env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, ''),
    anon: env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON,
    service: env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

// Origin, method, key and session. Returns { user } or { res } (an error Response).
export async function guard(req, env) {
  if (!ALLOWED_ORIGINS.has(req.headers.get('origin') || '')) return { res: json(403, { error: 'Forbidden' }) };
  if (req.method !== 'POST') return { res: json(405, { error: 'Method not allowed' }) };
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(req.headers.get('authorization') || '');
  if (!m) return { res: json(401, { error: 'Sign in required', code: 'auth' }) };
  const sb = sbConf(env);
  if (!env.ANTHROPIC_API_KEY || !sb.service) return { res: json(503, { error: 'AI unavailable', code: 'config' }) };
  let r;
  try {
    r = await fetch(sb.url + '/auth/v1/user', { headers: { apikey: sb.anon, authorization: 'Bearer ' + m[1] } });
  } catch (e) {
    return { res: json(503, { error: 'AI unavailable', code: 'auth_upstream' }) };
  }
  if (r.status === 401 || r.status === 403) return { res: json(401, { error: 'Sign in required', code: 'auth' }) };
  if (!r.ok) return { res: json(503, { error: 'AI unavailable', code: 'auth_upstream' }) };
  const user = await r.json().catch(() => null);
  if (!user || !user.id) return { res: json(401, { error: 'Sign in required', code: 'auth' }) };
  return { user };
}

// Count one call against today's cap; refuse at the cap. Returns { left } or { res }.
export async function takeQuota(user, kind, env, now) {
  const capEnv = kind === 'converse' ? env.CLL_CONVERSE_DAILY_CAP : env.CLL_TRANSLATE_DAILY_CAP;
  const cap = Number.isFinite(Number(capEnv)) && Number(capEnv) > 0 ? Math.floor(Number(capEnv)) : DEFAULT_CAPS[kind];
  const today = dayKey(now);
  const prev = (user.app_metadata && user.app_metadata.cll_ai) || {};
  const counts = prev.day === today ? { ...prev } : { day: today };
  const used = Number(counts[kind]) || 0;
  if (used >= cap) return { res: json(429, { error: 'Daily limit reached', code: 'cap', cap }) };
  counts[kind] = used + 1;
  const sb = sbConf(env);
  let r;
  try {
    r = await fetch(sb.url + '/auth/v1/admin/users/' + encodeURIComponent(user.id), {
      method: 'PUT',
      headers: { apikey: sb.service, authorization: 'Bearer ' + sb.service, 'content-type': 'application/json' },
      body: JSON.stringify({ app_metadata: { cll_ai: counts } })
    });
  } catch (e) {
    r = null;
  }
  if (!r || !r.ok) return { res: json(503, { error: 'AI unavailable', code: 'quota_store' }) };
  return { left: cap - counts[kind], used: counts[kind], cap };
}

export class AiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status || 502; }
}

// One Messages API call with a JSON-schema output. Returns { data, usage, model }.
export async function callClaude(opts, env) {
  const body = {
    model: opts.model,
    max_tokens: opts.maxTokens || 2000,
    thinking: { type: 'adaptive' },
    output_config: { effort: opts.effort || 'low', format: { type: 'json_schema', schema: opts.schema } },
    system: opts.system,
    messages: opts.messages
  };
  const headers = {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2026-10-21',
    'content-type': 'application/json'
  };
  if (opts.fallbacks) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  let resp;
  try {
    // Pinned host: Netlify's AI Gateway can inject ANTHROPIC_BASE_URL into functions.
    resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new AiError('upstream_fetch', 502);
  }
  if (!resp.ok) throw new AiError('upstream_' + resp.status, resp.status === 429 || resp.status === 529 ? 503 : 502);
  const msg = await resp.json().catch(() => null);
  if (!msg) throw new AiError('upstream_body', 502);
  const usage = msg.usage || {};
  const model = msg.model || opts.model;
  if (msg.stop_reason === 'refusal') throw Object.assign(new AiError('refusal', 502), { usage, model });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new AiError('max_tokens', 502), { usage, model });
  const text = (msg.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch (e) { throw Object.assign(new AiError('bad_json', 502), { usage, model }); }
  return { data, usage, model };
}

export function costUsd(model, usage) {
  const p = PRICES[model] || PRICES['claude-sonnet-5-5'];
  const u = usage || {};
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out +
    (u.cache_read_input_tokens || 0) * p.cacheRead + (u.cache_creation_input_tokens || 0) * p.cacheWrite) / 1e6;
}

// One line per call: tokens and list-price cost. Never the user's text.
export function logCost(fn, model, usage, userId, extra) {
  const u = usage || {};
  console.log('[cll-ai] ' + JSON.stringify({
    fn, model,
    in: u.input_tokens || 0, out: u.output_tokens || 0,
    cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0,
    usd: Number(costUsd(model, u).toFixed(6)),
    user: String(userId || '').slice(0, 8),
    ...(extra || {})
  }));
}

// Bounded text from the client.
export function clip(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n); }

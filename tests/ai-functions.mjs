// Mocked tests for the AI endpoints (Paris v2, stage 5): netlify/lib/ai-guard.js,
// netlify/functions/converse.js, netlify/functions/translate.js.
// Every outside call is stubbed: globalThis.fetch answers Supabase /auth/v1/user
// and api.anthropic.com from hand-written fixtures and throws on anything else;
// the usage store is an in-memory fake (or a broken one for the fail-open path).
// Run: node tests/ai-functions.mjs   (no network, no paid calls)
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-not-real';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const G = await import('../netlify/lib/ai-guard.js');
const converse = (await import('../netlify/functions/converse.js')).default;
const translate = (await import('../netlify/functions/translate.js')).default;

const ORIGIN = 'https://apps.cannoncodeconnect.com';
const GOOD_TOKEN = 'good.jwt.token-aaaaaaaaaaaaaaaaaaaa';
const BAD_TOKEN = 'bad.jwt.token-bbbbbbbbbbbbbbbbbbbbbb';
const USER = { id: '11111111-2222-3333-4444-555555555555', email: 'tester@example.test' };
const MARK = 'ZQXMARKER-croissant-' + Date.now(); // user text that must never reach a log

// ── fetch stub ───────────────────────────────────────────────
let calls = [];
let anthropicReply = null; // () => { status, body }
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  calls.push({ url, init, headers });
  if (url.endsWith('/auth/v1/user')) {
    assert.ok(!/service/i.test(headers.apikey || ''), 'auth check uses the anon key');
    if (headers.authorization === 'Bearer ' + GOOD_TOKEN) return new Response(JSON.stringify(USER), { status: 200 });
    return new Response(JSON.stringify({ msg: 'invalid JWT' }), { status: 401 });
  }
  if (url === 'https://api.anthropic.com/v1/messages') {
    const r = anthropicReply();
    return new Response(JSON.stringify(r.body), { status: r.status || 200 });
  }
  throw new Error('unexpected fetch ' + url);
};
const anthropicCalls = () => calls.filter(c => c.url.includes('anthropic.com'));
const msg = (obj, extra) => ({ status: 200, body: { id: 'msg_test', model: extra?.model || 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], usage: { input_tokens: 1200, output_tokens: 300 }, ...(extra || {}) } });

// ── usage stores ─────────────────────────────────────────────
// In-memory fake with @netlify/blobs ETag semantics: getWithMetadata returns
// { data, etag }; setJSON honours onlyIfMatch / onlyIfNew and returns
// { modified, etag }. Every call yields to the event loop so parallel callers interleave.
const tick = () => new Promise(r => setImmediate(r));
function memStore() {
  const m = new Map(); const tags = new Map(); let n = 0;
  const st = {
    m, writes: 0,
    async get(k, o) { await tick(); const v = m.get(k); return v == null ? null : (o && o.type === 'json' ? JSON.parse(v) : v); },
    async getWithMetadata(k, o) {
      await tick();
      const v = m.get(k);
      if (v == null) return null;
      if (!tags.has(k)) tags.set(k, 'e' + (++n));
      return { data: o && o.type === 'json' ? JSON.parse(v) : v, etag: tags.get(k), metadata: {} };
    },
    async setJSON(k, v, o = {}) {
      await tick();
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && (!m.has(k) || tags.get(k) !== o.onlyIfMatch)) return { modified: false };
      m.set(k, JSON.stringify(v)); tags.set(k, 'e' + (++n)); st.writes++;
      return { modified: true, etag: tags.get(k) };
    }
  };
  return st;
}
const brokenStore = {
  async get() { throw new Error('MissingBlobsEnvironmentError'); },
  async getWithMetadata() { throw new Error('MissingBlobsEnvironmentError'); },
  async setJSON() { throw new Error('nope'); }
};

// ── log spy ──────────────────────────────────────────────────
let logs = [];
const realLog = console.log, realErr = console.error, realWarn = console.warn;
function spyLogs() { logs = []; console.log = console.error = console.warn = (...a) => logs.push(a.map(String).join(' ')); }
function unspy() { console.log = realLog; console.error = realErr; console.warn = realWarn; }

function req(path, body, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (opts.origin !== null) headers.origin = opts.origin || ORIGIN;
  if (opts.token !== null) headers.authorization = 'Bearer ' + (opts.token || GOOD_TOKEN);
  return new Request('https://cunninglinguist.netlify.app' + path, { method: opts.method || 'POST', headers, body: opts.method === 'GET' ? undefined : JSON.stringify(body) });
}
const TURN_BODY = { scene: 'cafe', variant: 0, mode: 'turn', turns: [{ who: 'npc', fr: 'Bonjour ! Qu\'est-ce que je vous sers ?' }, { who: 'you', fr: 'Bonjour, un café ' + MARK }] };
const TURN_OUT = { npc_line_fr: 'Très bien, un café. Autre chose ?', npc_line_en: 'Very good, a coffee. Anything else?', goal_progress: 'in_progress', correction: { said: 'un café', better_fr: 'Un café, s\'il vous plaît.', en: 'A coffee, please.', note_en: 'Add s\'il vous plaît.' } };
const DEBRIEF_OUT = { summary_en: 'You ordered and paid.', goal_done: true, corrections: [1, 2, 3, 4, 5, 6, 7].map(i => ({ said: 'x' + i, better_fr: 'Phrase ' + i, en: 'Sentence ' + i, note_en: '' })) };
const TRANS_OUT = { word: 'un croissant', meaning: 'a croissant', ipa: '/kʁwa.sɑ̃/', phonetic: 'krwah-SAHN', gender: 'm', literal: '', example: 'Un croissant, s\'il vous plaît.', exampleEn: 'A croissant, please.' };

let failures = 0, passes = 0;
async function check(name, fn) {
  calls = []; G.resetMemUsage(); G.setUsageStore(memStore());
  anthropicReply = () => msg(TURN_OUT);
  spyLogs();
  try { await fn(); unspy(); passes++; console.log('ok   ' + name); }
  catch (e) { unspy(); failures++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n     ')); }
}

// ── guard ────────────────────────────────────────────────────
await check('no Authorization → 401, no Anthropic call', async () => {
  const r = await converse(req('/api/converse', TURN_BODY, { token: null }));
  assert.equal(r.status, 401);
  assert.equal(anthropicCalls().length, 0);
  assert.equal(calls.length, 0);
});
await check('invalid JWT → 401 (checked against Supabase), no Anthropic call', async () => {
  const r = await translate(req('/api/translate', { text: 'hello' }, { token: BAD_TOKEN }));
  assert.equal(r.status, 401);
  assert.equal(calls.filter(c => c.url.endsWith('/auth/v1/user')).length, 1);
  assert.equal(anthropicCalls().length, 0);
});
await check('auth check sends the bearer JWT + public anon key, no service role key anywhere', async () => {
  await converse(req('/api/converse', TURN_BODY));
  const a = calls.find(c => c.url.endsWith('/auth/v1/user'));
  assert.equal(a.headers.authorization, 'Bearer ' + GOOD_TOKEN);
  assert.match(a.headers.apikey, /^sb_publishable_/);
  assert.ok(!calls.some(c => c.url.includes('/admin/')), 'no admin API call');
});
await check('bad Origin → 403', async () => {
  const r = await converse(req('/api/converse', TURN_BODY, { origin: 'https://evil.example' }));
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
});
await check('GET → 405', async () => {
  const r = await translate(req('/api/translate', null, { method: 'GET' }));
  assert.equal(r.status, 405);
});
await check('Supabase auth down → 503 (auth never fails open)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => { if (String(u).endsWith('/auth/v1/user')) throw new Error('ECONNRESET'); return real(u); };
  try {
    const r = await converse(req('/api/converse', TURN_BODY));
    assert.equal(r.status, 503);
  } finally { globalThis.fetch = real; }
});

// ── daily cap (Netlify Blobs) ────────────────────────────────
await check('caps are 60 converse / 100 translate', async () => {
  assert.equal(G.CAPS.converse, 60);
  assert.equal(G.CAPS.translate, 100);
});
await check('counter key is <userId>:<YYYY-MM-DD> and increments only that kind', async () => {
  const st = memStore(); G.setUsageStore(st);
  const r = await converse(req('/api/converse', TURN_BODY));
  assert.equal(r.status, 200);
  const key = USER.id + ':' + new Date().toISOString().slice(0, 10);
  assert.deepEqual(JSON.parse(st.m.get(key)), { converse: 1, translate: 0 });
  assert.equal((await r.json()).left, 59);
});
await check('converse at cap (60) → 429, no Anthropic call', async () => {
  const st = memStore(); G.setUsageStore(st);
  st.m.set(USER.id + ':' + G.dayKey(), JSON.stringify({ converse: 60, translate: 3 }));
  const r = await converse(req('/api/converse', TURN_BODY));
  assert.equal(r.status, 429);
  assert.equal((await r.json()).code, 'cap');
  assert.equal(anthropicCalls().length, 0);
});
await check('translate at cap (100) → 429; converse still allowed', async () => {
  const st = memStore(); G.setUsageStore(st);
  st.m.set(USER.id + ':' + G.dayKey(), JSON.stringify({ converse: 5, translate: 100 }));
  assert.equal((await translate(req('/api/translate', { text: 'croissant' }))).status, 429);
  assert.equal(anthropicCalls().length, 0);
  assert.equal((await converse(req('/api/converse', TURN_BODY))).status, 200);
});
await check("yesterday's count doesn't carry over", async () => {
  const st = memStore(); G.setUsageStore(st);
  const yesterday = G.dayKey(Date.now() - 86400000);
  st.m.set(USER.id + ':' + yesterday, JSON.stringify({ converse: 60, translate: 100 }));
  assert.equal((await converse(req('/api/converse', TURN_BODY))).status, 200);
});
await check('Blobs unavailable → call allowed, logged, capped in memory', async () => {
  G.setUsageStore(brokenStore);
  const r = await converse(req('/api/converse', TURN_BODY));
  assert.equal(r.status, 200);
  assert.ok(logs.some(l => l.includes('quota_store') && l.includes('unavailable')), 'logged');
  // the in-memory fallback still enforces the cap
  for (let i = 1; i < 60; i++) {
    const q = await G.takeQuota(USER, 'converse', process.env);
    assert.ok(!q.res, 'call ' + (i + 1) + ' allowed');
  }
  const over = await G.takeQuota(USER, 'converse', process.env);
  assert.equal(over.res.status, 429);
});
await check('real @netlify/blobs with no Netlify context → allowed and logged', async () => {
  G.setUsageStore(null);
  delete process.env.NETLIFY_BLOBS_CONTEXT;
  const r = await converse(req('/api/converse', TURN_BODY));
  assert.equal(r.status, 200);
  assert.ok(logs.some(l => l.includes('quota_store')));
  assert.ok(!calls.some(c => !c.url.endsWith('/auth/v1/user') && !c.url.includes('anthropic.com')), 'no other network call');
});
await check('Blobs write failure → allowed and logged', async () => {
  const st = memStore(); st.setJSON = async () => { throw new Error('write failed'); };
  G.setUsageStore(st);
  const q = await G.takeQuota(USER, 'translate', process.env);
  assert.ok(!q.res);
  assert.ok(logs.some(l => l.includes('"op":"write"')));
});

await check('70 parallel converse quota takes from one user → exactly 60 pass', async () => {
  const st = memStore(); G.setUsageStore(st);
  const rs = await Promise.all(Array.from({ length: 70 }, () => G.takeQuota(USER, 'converse', process.env)));
  assert.equal(rs.filter(r => !r.res).length, 60);
  assert.equal(rs.filter(r => r.res && r.res.status === 429).length, 10);
  assert.equal(JSON.parse(st.m.get(USER.id + ':' + G.dayKey())).converse, 60);
});
await check('70 parallel converse requests (full endpoint) → exactly 60 reach Anthropic', async () => {
  const st = memStore(); G.setUsageStore(st);
  const rs = await Promise.all(Array.from({ length: 70 }, () => converse(req('/api/converse', TURN_BODY))));
  assert.equal(rs.filter(r => r.status === 200).length, 60);
  assert.equal(rs.filter(r => r.status === 429).length, 10);
  assert.equal(anthropicCalls().length, 60);
});
await check('Blobs read ok, write fails → 70 parallel still cap at 60 (memory floor)', async () => {
  const st = memStore(); st.setJSON = async () => { await tick(); throw new Error('write failed'); };
  G.setUsageStore(st);
  const rs = await Promise.all(Array.from({ length: 70 }, () => G.takeQuota(USER, 'converse', process.env)));
  assert.equal(rs.filter(r => !r.res).length, 60);
});
await check('Blobs count below memory count → memory wins (max of both)', async () => {
  const st = memStore(); G.setUsageStore(st);
  for (let i = 0; i < 60; i++) assert.ok(!(await G.takeQuota(USER, 'converse', process.env)).res);
  st.m.set(USER.id + ':' + G.dayKey(), JSON.stringify({ converse: 2, translate: 0 })); // store lost writes
  assert.equal((await G.takeQuota(USER, 'converse', process.env)).res.status, 429);
});
await check('lost race (foreign write between read and write) → retried, no count lost', async () => {
  const st = memStore(); G.setUsageStore(st);
  const key = USER.id + ':' + G.dayKey();
  st.m.set(key, JSON.stringify({ converse: 10, translate: 0 }));
  const realGet = st.getWithMetadata; let raced = 0;
  st.getWithMetadata = async (k, o) => {
    const r = await realGet(k, o);
    if (raced++ < 2) await st.setJSON(k, { converse: r.data.converse + 1, translate: 0 }); // another instance
    return r;
  };
  const q = await G.takeQuota(USER, 'converse', process.env);
  assert.ok(!q.res);
  assert.equal(JSON.parse(st.m.get(key)).converse, 13);
});
await check('race never settles → 429 cap_contention after 5 tries', async () => {
  const st = memStore(); G.setUsageStore(st);
  let tries = 0;
  st.setJSON = async () => { tries++; await tick(); return { modified: false }; };
  const q = await G.takeQuota(USER, 'converse', process.env);
  assert.equal(q.res.status, 429);
  assert.equal((await q.res.json()).code, 'cap_contention');
  assert.equal(tries, 5);
});
await check('body over 32 KB → 413 before parsing (converse and translate)', async () => {
  const big = { text: 'x'.repeat(40000), scene: 'cafe', turns: [] };
  const sized = (path) => { const r = req(path, big); const h = new Headers(r.headers); h.set('content-length', String(JSON.stringify(big).length)); return new Request(r.url, { method: 'POST', headers: h, body: JSON.stringify(big) }); };
  assert.equal((await converse(sized('/api/converse'))).status, 413);
  assert.equal((await translate(sized('/api/translate'))).status, 413);
  assert.equal(anthropicCalls().length, 0);
});

// ── converse ─────────────────────────────────────────────────
await check('converse turn: request shape (Sonnet 5.5, adaptive, effort low, json_schema, fallbacks)', async () => {
  const r = await converse(req('/api/converse', TURN_BODY));
  assert.equal(r.status, 200);
  const [c] = anthropicCalls();
  const b = JSON.parse(c.init.body);
  assert.equal(b.model, 'claude-sonnet-5-5');
  assert.deepEqual(b.thinking, { type: 'adaptive' });
  assert.equal(b.output_config.effort, 'low');
  assert.equal(b.output_config.format.type, 'json_schema');
  assert.equal(b.fallbacks, 'default');
  assert.equal(c.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(c.headers['x-api-key'], process.env.ANTHROPIC_API_KEY);
  assert.ok(!('temperature' in b));
  assert.match(b.system, /Café|café/);
});
await check('converse turn: structured output parsed', async () => {
  const d = await (await converse(req('/api/converse', TURN_BODY))).json();
  assert.equal(d.npc_line_fr, TURN_OUT.npc_line_fr);
  assert.equal(d.npc_line_en, TURN_OUT.npc_line_en);
  assert.equal(d.goal_progress, 'in_progress');
  assert.equal(d.correction.better_fr, TURN_OUT.correction.better_fr);
  assert.ok(d.usd > 0 && d.usd < 0.05, 'usd ' + d.usd);
});
await check('converse turn: odd goal_progress → in_progress, empty correction → null', async () => {
  anthropicReply = () => msg({ ...TURN_OUT, goal_progress: 'weird', correction: { said: '', better_fr: '', en: '', note_en: '' } });
  const d = await (await converse(req('/api/converse', TURN_BODY))).json();
  assert.equal(d.goal_progress, 'in_progress');
  assert.equal(d.correction, null);
});
await check('converse debrief: parsed, corrections capped at 5', async () => {
  anthropicReply = () => msg(DEBRIEF_OUT);
  const d = await (await converse(req('/api/converse', { ...TURN_BODY, mode: 'debrief' }))).json();
  assert.equal(d.goal_done, true);
  assert.equal(d.summary_en, DEBRIEF_OUT.summary_en);
  assert.equal(d.corrections.length, 5);
  const b = JSON.parse(anthropicCalls()[0].init.body);
  assert.ok(b.output_config.format.schema.properties.corrections, 'debrief schema');
});
await check('converse: unknown scene → 400, no Anthropic call, no quota taken', async () => {
  const st = memStore(); G.setUsageStore(st);
  const r = await converse(req('/api/converse', { ...TURN_BODY, scene: 'casino' }));
  assert.equal(r.status, 400);
  assert.equal(anthropicCalls().length, 0);
  assert.equal(st.m.size, 0);
});
await check('converse: refusal → 502 without echoing model output', async () => {
  anthropicReply = () => msg('I cannot help with that SECRETOUT', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' } });
  const r = await converse(req('/api/converse', TURN_BODY));
  assert.equal(r.status, 502);
  const t = await r.text();
  assert.ok(!t.includes('SECRETOUT'));
  assert.match(t, /refusal/);
});
await check('converse: max_tokens → 502; bad JSON → 502; upstream 529 → 503', async () => {
  anthropicReply = () => msg('{"npc_line_fr": "Bon', { stop_reason: 'max_tokens' });
  assert.equal((await converse(req('/api/converse', TURN_BODY))).status, 502);
  anthropicReply = () => msg('not json at all');
  assert.equal((await converse(req('/api/converse', TURN_BODY))).status, 502);
  anthropicReply = () => ({ status: 529, body: { type: 'error', error: { type: 'overloaded_error' } } });
  assert.equal((await converse(req('/api/converse', TURN_BODY))).status, 503);
});
await check('converse: the transcript is fenced and clipped', async () => {
  const long = 'a'.repeat(1000);
  await converse(req('/api/converse', { ...TURN_BODY, turns: [...TURN_BODY.turns.slice(0, 1), { who: 'you', fr: long }] }));
  const b = JSON.parse(anthropicCalls()[0].init.body);
  const content = b.messages[0].content;
  assert.match(content, /<transcript>/);
  assert.ok(!content.includes('a'.repeat(201)), 'clipped to 200');
});

// ── translate ────────────────────────────────────────────────
await check('translate: Haiku 5.5, adaptive, effort low, json_schema, no fallbacks', async () => {
  anthropicReply = () => msg(TRANS_OUT, { model: 'claude-haiku-5-5' });
  const r = await translate(req('/api/translate', { text: 'croissant ' + MARK, lang: 'fr', sourceLang: 'en' }));
  assert.equal(r.status, 200);
  const [c] = anthropicCalls();
  const b = JSON.parse(c.init.body);
  assert.equal(b.model, 'claude-haiku-5-5');
  assert.deepEqual(b.thinking, { type: 'adaptive' });
  assert.equal(b.output_config.effort, 'low');
  assert.equal(b.output_config.format.type, 'json_schema');
  assert.ok(!('fallbacks' in b));
  assert.ok(!c.headers['anthropic-beta']);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
await check('translate: structured output parsed; heard direction passed through', async () => {
  anthropicReply = () => msg(TRANS_OUT, { model: 'claude-haiku-5-5' });
  const d = await (await translate(req('/api/translate', { text: 'un croissant', dir: 'heard' }))).json();
  assert.equal(d.word, 'un croissant');
  assert.equal(d.meaning, 'a croissant');
  assert.equal(d.gender, 'm');
  assert.equal(d.dir, 'heard');
  assert.equal(d.left, 99);
  const b = JSON.parse(anthropicCalls()[0].init.body);
  assert.match(b.system, /French/);
});
await check('translate: empty word → 502; missing text → 400', async () => {
  anthropicReply = () => msg({ ...TRANS_OUT, word: '' }, { model: 'claude-haiku-5-5' });
  assert.equal((await translate(req('/api/translate', { text: 'x' }))).status, 502);
  assert.equal((await translate(req('/api/translate', { text: '' }))).status, 400);
});

// ── logs ─────────────────────────────────────────────────────
await check('logs: one [cll-ai] cost line with usd; never the user text or the full user id', async () => {
  anthropicReply = () => msg(TURN_OUT);
  await converse(req('/api/converse', TURN_BODY));
  anthropicReply = () => msg(TRANS_OUT, { model: 'claude-haiku-5-5' });
  await translate(req('/api/translate', { text: 'croissant ' + MARK }));
  anthropicReply = () => msg('x', { stop_reason: 'refusal' });
  await converse(req('/api/converse', TURN_BODY));
  G.setUsageStore(brokenStore);
  anthropicReply = () => msg(TURN_OUT);
  await converse(req('/api/converse', TURN_BODY));
  const cost = logs.filter(l => l.startsWith('[cll-ai] ') && l.includes('"usd"'));
  assert.ok(cost.length >= 3, 'cost lines ' + cost.length);
  for (const l of logs) {
    assert.ok(!l.includes(MARK), 'user text leaked: ' + l.slice(0, 80));
    assert.ok(!l.includes(USER.id), 'full user id logged');
    assert.ok(!l.includes(USER.email), 'email logged');
    assert.ok(!l.includes(GOOD_TOKEN), 'token logged');
  }
  const one = JSON.parse(cost[0].slice('[cll-ai] '.length));
  assert.equal(one.user, USER.id.slice(0, 8));
  assert.ok(one.usd > 0);
});
await check('no reference to the service role key or app_metadata in the functions', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['netlify/lib/ai-guard.js', 'netlify/functions/converse.js', 'netlify/functions/translate.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.ok(!/SERVICE_ROLE|service_role|app_metadata|admin\/users/.test(src), f);
  }
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

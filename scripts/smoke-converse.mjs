// Live smoke test of the deployed /api/converse (PAID: Claude Sonnet 5.5).
// NOT run by builders or checkers: needs Jimmy's go in chat (CLAUDE.md §32).
//
//   CLL_SMOKE_JWT=<Supabase access token> node scripts/smoke-converse.mjs --max-usd 1
//   node scripts/smoke-converse.mjs --max-usd 1 --dry-run     (plan only, no network)
// Options: --base <site url> (default https://apps.cannoncodeconnect.com/cunninglinguist)
//
// Plays café v0 for up to 9 customer turns, then 1 debrief: at most 10 calls.
// Hard cap: --max-usd is required and can't exceed $1. Before every call the
// script adds that call's worst case (max_tokens all used) to what was spent
// (from each response's `usd`) and stops if it would pass the cap.
// The JWT is read from the environment only and never printed.

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const HARD_CAP = 1;
const maxArg = opt('--max-usd', null);
if (maxArg === null || !(Number(maxArg) > 0)) {
  console.error('Refusing: --max-usd <dollars> is required (at most ' + HARD_CAP + '). This makes paid calls.');
  process.exit(2);
}
const MAX_USD = Math.min(Number(maxArg), HARD_CAP);
const DRY = argv.includes('--dry-run');
const BASE = opt('--base', 'https://apps.cannoncodeconnect.com/cunninglinguist').replace(/\/+$/, '');
const ORIGIN = new URL(BASE).origin;

// Worst case per call at Sonnet 5.5 list price ($2 in / $10 out per 1M):
// ~3k input tokens, all of max_tokens out (turn 1500, debrief 3000).
const WORST = { turn: (3000 * 2 + 1500 * 10) / 1e6, debrief: (4000 * 2 + 3000 * 10) / 1e6 };
const LINES = [
  'Bonjour, un café, s\'il vous plaît.',
  'Un café crème, s\'il vous plaît.',
  'Et un croissant aussi.',
  'Non, c\'est tout, merci.',
  'C\'est combien ?',
  'Je peux payer par carte ?',
  'Pardon, vous pouvez répéter ?',
  'Voilà.',
  'Merci, bonne journée !'
];

const plan = LINES.length + 1;
console.log(`Smoke: ${BASE}/api/converse, café v0, up to ${plan} calls, cap $${MAX_USD.toFixed(2)}, worst case $${(LINES.length * WORST.turn + WORST.debrief).toFixed(3)}`);
if (DRY) { console.log('Dry run: nothing was called.'); process.exit(0); }
const JWT = process.env.CLL_SMOKE_JWT || '';
if (!JWT) { console.error('Refusing: set CLL_SMOKE_JWT to a signed-in Supabase access token.'); process.exit(2); }

let spent = 0, calls = 0;
async function call(body, kind) {
  if (spent + WORST[kind] > MAX_USD) {
    console.log(`Stop: next ${kind} call could pass the cap ($${spent.toFixed(4)} spent + $${WORST[kind].toFixed(4)} > $${MAX_USD}).`);
    return null;
  }
  calls++;
  const r = await fetch(BASE + '/api/converse', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: 'Bearer ' + JWT },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  // A failed call may still have been billed: count its worst case.
  spent += r.ok && Number.isFinite(data.usd) ? data.usd : (r.status >= 500 ? WORST[kind] : 0);
  if (!r.ok) { console.log(`HTTP ${r.status} ${data.code || data.error || ''}`); return null; }
  return data;
}

const turns = [{ who: 'npc', fr: 'Bonjour ! Qu\'est-ce que je vous sers ?' }];
let done = false;
for (const line of LINES) {
  turns.push({ who: 'you', fr: line });
  const d = await call({ scene: 'cafe', variant: 0, mode: 'turn', turns }, 'turn');
  if (!d) break;
  turns.push({ who: 'npc', fr: d.npc_line_fr });
  console.log(`you: ${line}\nnpc: ${d.npc_line_fr}  (${d.goal_progress}${d.correction ? ', correction: ' + d.correction.better_fr : ''}; $${d.usd}; left ${d.left})`);
  if (d.goal_progress === 'done') { done = true; break; }
}
if (turns.some(t => t.who === 'you')) {
  const d = await call({ scene: 'cafe', variant: 0, mode: 'debrief', turns }, 'debrief');
  if (d) console.log(`debrief: goal_done=${d.goal_done}; ${d.summary_en}\ncorrections: ${(d.corrections || []).map(c => c.better_fr).join(' | ') || 'none'} ($${d.usd})`);
}
console.log(`Calls: ${calls}, spent (list price): $${spent.toFixed(4)} of $${MAX_USD.toFixed(2)}${done ? ', goal reached' : ''}`);

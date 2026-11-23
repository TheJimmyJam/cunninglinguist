#!/usr/bin/env node
// Static French audio for the en-fr course (Paris v2, stage 4).
//
// Collects every French string the app speaks for en-fr (course vocab,
// phrases and Paris pack, conversation lines, generated listening items),
// dedupes by js/audio.js audioHash, skips files already on disk, and prints the
// count, characters and estimated cost.
//
//   node scripts/gen-fr-audio.mjs                    dry run (default, no network)
//   node scripts/gen-fr-audio.mjs --check            every item has its files? (exit 1 if not)
//   node scripts/gen-fr-audio.mjs --run --max-usd 2  generate (PAID: needs Jimmy's go, CLAUDE.md §32)
// Options: --provider openai|elevenlabs (default openai), --voice <id>,
//          --limit N (first N jobs only), --concurrency N (default 3).
// Key: env OPENAI_API_KEY / ELEVENLABS_API_KEY, else that one line of
// ~/Desktop/Projects/.credentials (read only in --run, never printed).
// --run refuses to start when the estimate is over --max-usd and stops
// starting new requests once spent + in-flight estimates would pass it.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = require(join(root, 'js/audio.js'));
const OUT = join(root, 'audio/fr');
const MANIFEST = join(OUT, 'manifest.json');

// ── Args ───────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const RUN = flag('--run');
const CHECK = flag('--check');
const PROVIDER = opt('--provider', 'openai');
const MAX_USD = opt('--max-usd', null) === null ? null : Number(opt('--max-usd'));
const LIMIT = Number(opt('--limit', 0)) || 0;
const CONC = Math.max(1, Math.min(8, Number(opt('--concurrency', 3)) || 3));

// ── Collect the texts (what the app passes to speakWord for en-fr) ──
export function collectTexts() {
  const src = readFileSync(join(root, 'js/course-en-fr.js'), 'utf8');
  const { COURSE, CONVOS } = new Function(src + ';return { COURSE: COURSE_FR, CONVOS: CONVERSATIONS_FR };')();
  const texts = [];
  COURSE.forEach(d => ['paris', 'vocab', 'phrases'].forEach(k => (d[k] || []).forEach(v => texts.push({ text: v.fr, from: k }))));
  CONVOS.forEach(c => (c.lines || []).forEach(l => texts.push({ text: l.fr, from: 'scene' })));
  A.listenItems().forEach(i => texts.push({ text: i.fr, from: 'listen-' + i.kind }));
  const byHash = new Map();
  for (const t of texts) {
    const norm = A.normText(t.text);
    if (!norm) continue;
    const h = A.audioHash(norm);
    const prev = byHash.get(h);
    if (prev && prev.norm !== norm) throw new Error(`hash collision ${h}: "${prev.norm}" vs "${norm}"`);
    if (!prev) byHash.set(h, { hash: h, norm, from: t.from });
  }
  return [...byHash.values()];
}

// ── Providers (adapters; only called with --run) ──────────────
const PROVIDERS = {
  // OpenAI gpt-4o-mini-tts: native-French delivery via instructions; slow via
  // instructions (the speed parameter is not used for this model). List price
  // used for the estimate: ~$0.015 per minute of audio + $0.60 / 1M input
  // tokens. Verify on platform.openai.com/docs/pricing before the go.
  openai: {
    keyName: 'OPENAI_API_KEY',
    model: 'gpt-4o-mini-tts',
    voice: 'coral',
    usdPerMin: 0.015,
    usdPerInputToken: 0.60 / 1e6,
    instructions(slow) {
      return 'Voice: a friendly native Parisian French speaker. Accent: standard metropolitan French, no English accent. ' +
        (slow ? 'Pace: slow and clear for a beginner, about 70% of normal speed, with every syllable distinct but natural intonation.'
          : 'Pace: natural everyday speed, as a Paris café or station worker would say it.');
    },
    estimate(chars, slow) {
      const secs = 0.4 + chars / (slow ? 9 : 14);
      const inputTokens = (chars + this.instructions(slow).length) / 3;
      return secs / 60 * this.usdPerMin + inputTokens * this.usdPerInputToken;
    },
    async synth(key, text, slow, voice) {
      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, voice: voice || this.voice, input: text,
          instructions: this.instructions(slow), response_format: 'mp3' })
      });
      if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return Buffer.from(await r.arrayBuffer());
    },
    cost(buf, chars, slow) {
      const secs = mp3Seconds(buf);
      const inputTokens = (chars + this.instructions(slow).length) / 3;
      return Math.max(secs / 60 * this.usdPerMin + inputTokens * this.usdPerInputToken, this.estimate(chars, slow) * 0.5);
    }
  },
  // ElevenLabs multilingual v2 (native French voices). Billed in plan credits
  // (1 per character); $ uses an assumed $0.30 per 1k characters (overage rate).
  elevenlabs: {
    keyName: 'ELEVENLABS_API_KEY',
    model: 'eleven_multilingual_v2',
    voice: null, // pass --voice <voice_id> of a native French voice from the library
    usdPer1kChars: 0.30,
    estimate(chars) { return chars / 1000 * this.usdPer1kChars; },
    async synth(key, text, slow, voice) {
      if (!voice) throw new Error('elevenlabs needs --voice <voice_id>');
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: this.model, language_code: 'fr',
          voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: slow ? 0.75 : 1.0 } })
      });
      if (!r.ok) throw new Error(`elevenlabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return Buffer.from(await r.arrayBuffer());
    },
    cost(buf, chars) { return this.estimate(chars); }
  }
};

// Duration of an MP3 from its first frame's bitrate (CBR; good enough for spend tracking).
function mp3Seconds(buf) {
  let i = 0;
  if (buf.slice(0, 3).toString('latin1') === 'ID3') i = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  for (; i < buf.length - 4; i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const ver = (buf[i + 1] >> 3) & 3, idx = (buf[i + 2] >> 4) & 15;
      const v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
      const v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const kbps = (ver === 3 ? v1 : v2)[idx];
      if (kbps) return (buf.length - i) * 8 / (kbps * 1000);
    }
  }
  return 0;
}

function readManifest() {
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}
function writeManifest(m) {
  const sorted = Object.fromEntries(Object.keys(m).sort().map(k => [k, m[k]]));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(MANIFEST + '.tmp', JSON.stringify(sorted) + '\n');
  renameSync(MANIFEST + '.tmp', MANIFEST);
}
function fileFor(hash, slow) { return join(OUT, hash + (slow ? '.slow' : '') + '.mp3'); }

function loadKey(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(join(homedir(), 'Desktop/Projects/.credentials'), 'utf8').split('\n').find(l => l.startsWith(name + '='));
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
  } catch {}
  return null;
}

async function main() {
  const prov = PROVIDERS[PROVIDER];
  if (!prov) { console.error('unknown --provider ' + PROVIDER); process.exit(2); }
  const items = collectTexts();
  const manifest = readManifest();

  if (CHECK) {
    const missing = items.filter(it => !(manifest[it.hash] === 'ns' && existsSync(fileFor(it.hash, false)) && existsSync(fileFor(it.hash, true))));
    const orphans = Object.keys(manifest).filter(h => !items.some(it => it.hash === h));
    console.log(`items ${items.length}, in manifest with both files ${items.length - missing.length}, missing ${missing.length}, manifest entries not in course ${orphans.length}`);
    missing.slice(0, 10).forEach(m => console.log('  missing ' + m.hash + '  ' + m.norm));
    process.exit(missing.length ? 1 : 0);
  }

  let jobs = [];
  for (const it of items) for (const slow of [false, true]) {
    if (!(existsSync(fileFor(it.hash, slow)) && (manifest[it.hash] || '').includes(slow ? 's' : 'n'))) jobs.push({ ...it, slow, chars: it.norm.length });
  }
  if (LIMIT) jobs = jobs.slice(0, LIMIT);
  const chars = jobs.reduce((s, j) => s + j.chars, 0);
  const est = jobs.reduce((s, j) => s + prov.estimate(j.chars, j.slow), 0);
  const kinds = {};
  items.forEach(i => { const k = i.from.startsWith('listen') ? 'listen' : i.from; kinds[k] = (kinds[k] || 0) + 1; });
  console.log(`Unique French texts: ${items.length} (${Object.entries(kinds).map(([k, n]) => k + ' ' + n).join(', ')})`);
  console.log(`Characters per version: ${items.reduce((s, i) => s + i.norm.length, 0)}`);
  console.log(`Files to make: ${jobs.length} (normal ${jobs.filter(j => !j.slow).length}, slow ${jobs.filter(j => j.slow).length}), ${chars} characters`);
  console.log(`Provider: ${PROVIDER} (${prov.model}${prov.voice ? ', voice ' + prov.voice : ''}), estimated cost $${est.toFixed(2)}`);

  if (!RUN) { console.log('Dry run: nothing was called. Generate with --run --max-usd <cap> (paid; needs Jimmy\'s go).'); return; }
  if (!(MAX_USD > 0)) { console.error('--run needs --max-usd <cap>'); process.exit(2); }
  if (est > MAX_USD) { console.error(`Refusing: estimate $${est.toFixed(2)} is over the cap $${MAX_USD}.`); process.exit(3); }
  const key = loadKey(prov.keyName);
  if (!key) { console.error(`No ${prov.keyName} in env or .credentials.`); process.exit(2); }
  const voice = opt('--voice', prov.voice);

  let spent = 0, inflight = 0, made = 0, failed = 0, stopped = false, next = 0;
  async function worker() {
    while (next < jobs.length && !stopped) {
      const j = jobs[next];
      const e = prov.estimate(j.chars, j.slow);
      if (spent + inflight + e > MAX_USD) { stopped = true; break; }
      next++;
      inflight += e;
      try {
        const buf = await prov.synth(key, j.norm, j.slow, voice);
        if (buf.length < 500) throw new Error('audio too small: ' + buf.length + ' bytes');
        writeFileSync(fileFor(j.hash, j.slow) + '.tmp', buf);
        renameSync(fileFor(j.hash, j.slow) + '.tmp', fileFor(j.hash, j.slow));
        spent += prov.cost(buf, j.chars, j.slow);
        const f = new Set((manifest[j.hash] || '').split(''));
        f.add(j.slow ? 's' : 'n');
        manifest[j.hash] = ['n', 's'].filter(x => f.has(x)).join('');
        writeManifest(manifest);
        made++;
        if (made % 50 === 0) console.log(`  ${made}/${jobs.length} files, ~$${spent.toFixed(3)}`);
      } catch (err) {
        failed++;
        console.error(`  failed ${j.hash}${j.slow ? ' (slow)' : ''}: ${err.message}`);
        if (failed >= 5) stopped = true;
      } finally { inflight -= e; }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`Done: ${made} files, ${failed} failed, ~$${spent.toFixed(3)} spent (estimate from audio length)${stopped ? ', STOPPED early (cap or errors)' : ''}.`);
  process.exit(failed || stopped ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

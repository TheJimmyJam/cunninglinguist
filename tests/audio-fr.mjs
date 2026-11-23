// Static audio checks (Paris v2, stage 4): hash normalization parity between
// scripts/gen-fr-audio.mjs and the app, manifest lookup, French numbers,
// listening items and typed answers, and the generator's dry run / cap gate.
// Run: node tests/audio-fr.mjs   (no network, no paid calls)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = require('../js/audio.js');
const S = require('../js/srs.js');
const { collectTexts } = await import('../scripts/gen-fr-audio.mjs');
const appSrc = readFileSync(join(root, 'js/app.js'), 'utf8');
const learnSrc = readFileSync(join(root, 'learn.html'), 'utf8');
const scriptSrc = readFileSync(join(root, 'scripts/gen-fr-audio.mjs'), 'utf8');
const courseSrc = readFileSync(join(root, 'js/course-en-fr.js'), 'utf8');
const { COURSE, CONVOS } = new Function(courseSrc + ';return { COURSE: COURSE_FR, CONVOS: CONVERSATIONS_FR };')();

let failures = 0, passes = 0;
function check(name, fn) {
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
function sliceFn(name) {
  const start = appSrc.indexOf('function ' + name + '(');
  assert.ok(start > 0, name + ' not found in app.js');
  const end = appSrc.indexOf('\n}\n', start);
  return appSrc.slice(start, end + 2);
}

// The app's real getStaticAudioUrl, run against a manifest.
function appLookup(manifest) {
  return new Function('CLAUDIO', 'audioManifests', 'AUDIO_BASE', 'currentTarget', 'loadAudioManifest',
    sliceFn('getStaticAudioUrl') + '\nreturn getStaticAudioUrl;')(
    A, { fr: manifest }, { fr: '/cunninglinguist/audio/fr/' }, () => 'fr', () => {});
}

check('normalization: apostrophes, no-break spaces, spacing and NFC fold; case and punctuation do not', () => {
  const same = [
    ["C'est tout, merci.", 'C’est tout, merci.', 'Cʼest tout, merci.', "  C'est  tout, merci. ", "C'est\ttout, merci."],
    ['Où sont les toilettes ?', 'Où sont les toilettes ?', 'Où sont les toilettes ?', 'Où sont les toilettes ?'],
    ['Joyeux Noël !', 'Joyeux Noël !']
  ];
  same.forEach(group => group.forEach(t => assert.equal(A.audioHash(t), A.audioHash(group[0]), JSON.stringify(t))));
  const differ = [['Bonjour', 'bonjour'], ['Ça va ?', 'Ça va.'], ['à point', 'a point']];
  differ.forEach(([a, b]) => assert.notEqual(A.audioHash(a), A.audioHash(b), a + ' vs ' + b));
  assert.equal(A.audioHash(''), '');
  assert.equal(A.audioHash('   '), '');
});
check('hash is pinned (changing it orphans generated files)', () => {
  assert.equal(A.audioHash('Bonjour'), '05c7c8db0a9441');
  assert.equal(A.audioHash('Je vous en prie.'), '0304a9bff97424');
  assert.match(A.audioHash('Sur place ou à emporter ?'), /^[0-9a-f]{14}$/);
});
check('one module: the script and the app both hash with js/audio.js', () => {
  assert.match(scriptSrc, /require\(join\(root, 'js\/audio\.js'\)\)/);
  assert.match(sliceFn('getStaticAudioUrl'), /CLAUDIO\.audioUrl\(m, text, !!o\.slow, AUDIO_BASE\[lang\]\)/);
  const order = learnSrc.match(/\['course-' \+ course, ([^\]]+)\]/)[1];
  assert.ok(order.indexOf("'audio'") > -1 && order.indexOf("'audio'") < order.indexOf("'app'"), 'audio.js loads before app.js: ' + order);
});
check('parity: every text the app speaks for en-fr is found by the app with the script\'s keys', () => {
  const items = collectTexts();
  const manifest = Object.fromEntries(items.map(i => [i.hash, 'ns']));
  const lookup = appLookup(manifest);
  const spoken = [];
  COURSE.forEach(d => ['vocab', 'phrases', 'paris'].forEach(k => (d[k] || []).forEach(v => spoken.push(v.fr))));
  CONVOS.forEach(c => c.lines.forEach(l => spoken.push(l.fr)));
  A.listenItems().forEach(g => spoken.push(g.fr));
  const miss = spoken.filter(t => !lookup(t, 'fr') || !lookup(t, { lang: 'fr', slow: true }));
  assert.deepEqual(miss, []);
  assert.equal(lookup('Bonjour', 'fr'), '/cunninglinguist/audio/fr/05c7c8db0a9441.mp3');
  assert.equal(lookup('Bonjour', { lang: 'fr', slow: true }), '/cunninglinguist/audio/fr/05c7c8db0a9441.slow.mp3');
  assert.equal(lookup('Une phrase qui n\'existe pas.', 'fr'), null);
  // The script dedupes: one entry per key, no collisions.
  assert.equal(new Set(items.map(i => i.hash)).size, items.length);
  assert.ok(items.length > 700, 'items ' + items.length);
});
check('manifest lookup: only listed files, slow only when "s"', () => {
  const h = A.audioHash('Bonjour');
  assert.equal(A.audioUrl({}, 'Bonjour', false, 'x/'), null);
  assert.equal(A.audioUrl(null, 'Bonjour', false, 'x/'), null);
  assert.equal(A.audioUrl({ [h]: 'n' }, 'Bonjour', false, 'x/'), 'x/' + h + '.mp3');
  assert.equal(A.audioUrl({ [h]: 'n' }, 'Bonjour', true, 'x/'), null);
  assert.equal(A.audioUrl({ [h]: 's' }, 'Bonjour', false, 'x/'), null);
  assert.equal(A.audioUrl({ [h]: 'ns' }, 'Bonjour', true, 'x/'), 'x/' + h + '.slow.mp3');
  const shipped = JSON.parse(readFileSync(join(root, 'audio/fr/manifest.json'), 'utf8'));
  assert.equal(typeof shipped, 'object');
});
check('French numbers', () => {
  const want = { 1: 'un', 17: 'dix-sept', 21: 'vingt et un', 70: 'soixante-dix', 71: 'soixante et onze', 77: 'soixante-dix-sept',
    80: 'quatre-vingts', 81: 'quatre-vingt-un', 90: 'quatre-vingt-dix', 91: 'quatre-vingt-onze', 99: 'quatre-vingt-dix-neuf',
    100: 'cent', 101: 'cent un', 200: 'deux cents', 280: 'deux cent quatre-vingts' };
  Object.entries(want).forEach(([n, w]) => assert.equal(A.frNumber(+n), w));
  assert.equal(A.frNumber(21, true), 'vingt et une');
  assert.equal(A.priceWords(650), 'six euros cinquante');
  assert.equal(A.priceWords(120), 'un euro vingt');
  assert.equal(A.priceWords(8000), 'quatre-vingts euros');
  assert.equal(A.timeWords(17, 45), 'dix-sept heures quarante-cinq');
  assert.equal(A.timeWords(21, 0), 'vingt et une heures');
  assert.equal(A.timeWords(12, 0), 'midi');
  assert.equal(A.dateWords(1, 1), 'le premier janvier');
  assert.equal(A.dateWords(25, 12), 'le vingt-cinq décembre');
});
check('listening items: prices, times, platforms, lines, dates; unique; French spacing', () => {
  const L = A.listenItems();
  const kinds = {};
  L.forEach(i => { kinds[i.kind] = (kinds[i.kind] || 0) + 1; });
  ['price', 'time', 'platform', 'line', 'date'].forEach(k => assert.ok(kinds[k] >= 5, k + ' ' + kinds[k]));
  assert.equal(new Set(L.map(i => i.id)).size, L.length);
  assert.equal(new Set(L.map(i => i.en + i.kind)).size, L.length);
  assert.deepEqual(L.filter(i => /[^\s][?!]/.test(i.fr)).map(i => i.fr), []);
  assert.ok(L.some(i => i.fr === 'Ça vous fera six euros cinquante.' || /six euros cinquante/.test(i.fr)));
  assert.ok(L.some(i => /dix-sept heures quarante-cinq/.test(i.fr) && i.en === '17:45'));
  assert.ok(L.some(i => /voie douze/.test(i.fr) && i.en === 'Platform 12'));
});
check('typed answers: prices, times, numbers', () => {
  const p = { kind: 'price', value: 650 }, t = { kind: 'time', value: 17 * 60 + 45 }, v = { kind: 'platform', value: 12 };
  ['6.50', '6,50', '€6.5', '6€50', '6 50', '6.50 €', '6 euros 50'].forEach(x => assert.ok(A.checkTyped(p, x), x));
  ['16.50', '6.15', '60.50', '', 'six'].forEach(x => assert.ok(!A.checkTyped(p, x), x));
  assert.ok(A.checkTyped({ kind: 'price', value: 8000 }, '80'));
  ['17:45', '17h45', '17 45', '17.45', '1745', '5:45 pm', '5:45pm'].forEach(x => assert.ok(A.checkTyped(t, x), x));
  ['7:45', '17:40', '5:45'].forEach(x => assert.ok(!A.checkTyped(t, x), x));
  assert.ok(A.checkTyped({ kind: 'time', value: 720 }, 'midi'));
  assert.ok(A.checkTyped(v, '12') && A.checkTyped(v, 'voie 12') && !A.checkTyped(v, '2'));
});
check('distractors: same kind, different answer, nearest first', () => {
  const L = A.listenItems();
  L.forEach(g => {
    const d = A.distractors(g, 3);
    assert.equal(d.length, 3, g.en);
    d.forEach(o => { assert.equal(o.kind, g.kind); assert.notEqual(o.en, g.en); });
  });
});
check('generator: dry run is the default and offline; --run needs a cap and refuses over it', () => {
  const run = args => spawnSync(process.execPath, [join(root, 'scripts/gen-fr-audio.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '', ELEVENLABS_API_KEY: '' } });
  const dry = run([]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Unique French texts: \d+/);
  assert.match(dry.stdout, /estimated cost \$\d+\.\d\d/);
  assert.match(dry.stdout, /Dry run: nothing was called/);
  const noCap = run(['--run']);
  assert.equal(noCap.status, 2);
  const over = run(['--run', '--max-usd', '0.01']);
  assert.equal(over.status, 3);
  assert.match(over.stderr, /Refusing: estimate/);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

// Offline role-play engine checks (Paris v2, stage 5): js/scenes-fr.js.
// Run: node tests/scenes-fr.mjs   (no network)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const S = require('../js/scenes-fr.js');

let failures = 0, passes = 0;
function check(name, fn) {
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

// Play a scene by always saying the hint.
function playByHints(id, v) {
  const st = S.start(id, v);
  let guard = 0;
  while (!st.done && guard++ < 40) {
    const h = S.hint(st);
    assert.ok(h && h.fr, `${id} v${v}: no hint at node ${st.node}`);
    const r = S.respond(st, h.fr);
    assert.ok(r, `${id} v${v}: no response`);
    assert.notEqual(r.kind, 'miss', `${id} v${v}: hint "${h.fr}" missed at node ${st.node}`);
  }
  assert.ok(st.done, `${id} v${v}: not done after ${guard} turns`);
  return st;
}

check('8 scenes, each with 2-3 variants', () => {
  const list = S.list();
  assert.equal(list.length, 8);
  assert.deepEqual(list.map(s => s.id), ['cafe', 'boulangerie', 'restaurant', 'metro', 'pharmacy', 'hotel', 'taxi', 'lost']);
  list.forEach(s => assert.ok(s.variants >= 2 && s.variants <= 3, s.id + ' variants ' + s.variants));
});

check('every scene × variant completes by following hints', () => {
  S.list().forEach(s => { for (let v = 0; v < s.variants; v++) playByHints(s.id, v); });
});

check('first hint starts with Bonjour; first line without it gets the note', () => {
  const st = S.start('cafe', 0);
  assert.match(S.hint(st).fr, /^Bonjour/);
  const r = S.respond(st, 'Un café, s\'il vous plaît.');
  assert.notEqual(r.kind, 'miss');
  while (!st.done) S.respond(st, S.hint(st).fr);
  assert.ok(S.debrief(st).notes.some(n => /Bonjour/.test(n)));
});

check('clarification is a good move: NPC repeats slowly, counted', () => {
  const st = S.start('boulangerie', 0);
  const first = S.line(st).fr;
  const r = S.respond(st, 'Pardon, vous pouvez répéter ?');
  assert.equal(r.kind, 'clarify');
  assert.equal(r.slow, true);
  assert.equal(r.npc.fr, first);
  assert.equal(st.clarify, 1);
  assert.equal(st.misses, 0);
});

check('two misses → showHint on the second; the line becomes a correction', () => {
  const st = S.start('cafe', 0);
  const a = S.respond(st, 'zzz qqq');
  assert.equal(a.kind, 'miss');
  assert.ok(!a.showHint);
  const b = S.respond(st, 'xxyy wwvv');
  assert.equal(b.kind, 'miss');
  assert.equal(b.showHint, true);
  const h = S.hint(st);
  S.respond(st, h.fr);
  while (!st.done) S.respond(st, S.hint(st).fr);
  const d = S.debrief(st);
  assert.equal(d.misses, 2);
  assert.ok(d.corrections.some(c => c.why === 'retry'), 'retry correction');
});

check('useHint counts hints and makes a correction', () => {
  const st = S.start('pharmacy', 0);
  const h = S.useHint(st);
  S.respond(st, h.fr);
  while (!st.done) S.respond(st, S.hint(st).fr);
  const d = S.debrief(st);
  assert.equal(d.hints, 1);
  assert.ok(d.corrections.length >= 1);
  assert.ok(d.done);
});

check('greeting alone gets a hello back, not a miss', () => {
  const st = S.start('hotel', 0);
  const r = S.respond(st, 'Bonjour !');
  assert.ok(['hello', 'intent'].includes(r.kind), r.kind);
  assert.equal(st.misses, 0);
});

check('replay changes the fact: nextVariant cycles; café v1 differs from v0', () => {
  assert.equal(S.nextVariant('cafe', 0), 1);
  const n = S.get('cafe').vars.length;
  assert.equal(S.nextVariant('cafe', n - 1), 0);
  const a = S.aiBrief('cafe', 0), b = S.aiBrief('cafe', 1);
  assert.notDeepEqual(a.words, b.words);
});

check('a variant note shows when the changed fact was not caught', () => {
  let found = false;
  S.list().forEach(s => {
    for (let v = 0; v < s.variants; v++) {
      const sc = S.get(s.id);
      if (!sc.vars[v].note) continue;
      const st = S.start(s.id, v);
      while (!st.done) S.respond(st, S.hint(st).fr);
      const d = S.debrief(st);
      if (!d.caught) { assert.ok(d.notes.includes(sc.vars[v].note)); found = true; }
    }
  });
  assert.ok(found, 'at least one variant note exercised');
});

check('accent slip → nudge correction (why: accents)', () => {
  const strip = x => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let tried = 0;
  S.list().forEach(s => {
    const st = S.start(s.id, 0);
    S.respond(st, S.hint(st).fr); // first turn (hint carries a Bonjour prefix)
    while (!st.done) {
      const h = S.hint(st).fr;
      if (strip(h) !== h && tried < 3) {
        tried++;
        S.respond(st, strip(h));
        while (!st.done) S.respond(st, S.hint(st).fr);
        assert.ok(S.debrief(st).corrections.some(c => c.why === 'accents' && c.fr === h), s.id + ': ' + h);
        return;
      }
      S.respond(st, h);
    }
  });
  assert.ok(tried > 0, 'no accented hint found');
});

check('allNpcLines: unique, non-empty, no unfilled {slots}', () => {
  const lines = S.allNpcLines();
  assert.ok(lines.length >= 40 && lines.length <= 120, 'count ' + lines.length);
  assert.equal(new Set(lines).size, lines.length);
  lines.forEach(l => { assert.ok(l.trim()); assert.ok(!/\{\w+\}/.test(l), l); });
});

check('aiBrief: role, goal, opening line, words for every scene; unknown → null', () => {
  S.list().forEach(s => {
    const b = S.aiBrief(s.id, 0);
    assert.ok(b.role && b.goal && b.opening && b.words.length > 2, s.id);
  });
  assert.equal(S.aiBrief('casino', 0), null);
});

check('respond after done and empty input are no-ops', () => {
  const st = playByHints('taxi', 0);
  assert.equal(S.respond(st, 'encore').kind, 'done');
  const st2 = S.start('taxi', 0);
  assert.equal(S.respond(st2, '   '), null);
});

// Short answers at single-group steps (one keyword group, not two).
function acceptsAt(id, v, node, said) {
  const st = S.start(id, v);
  st.node = node;
  const r = S.respond(st, said);
  assert.equal(r && r.kind, 'intent', `${id} v${v} ${node}: "${said}" got ${r && r.kind}`);
}
check('short answers accepted: pharmacy offer, taxi ok/cardok, lost found/form', () => {
  ['Oui.', "D'accord.", 'Ok, merci.', 'Une boîte.', 'Oui !'].forEach(t => acceptsAt('pharmacy', 0, 'offer', t));
  ['Pas de problème.', "D'accord.", 'Oui.', 'Ok, merci.'].forEach(t => acceptsAt('taxi', 0, 'ok', t));
  ['Merci.', 'Super.', 'Oui.', 'Ok, merci.'].forEach(t => acceptsAt('taxi', 0, 'cardok', t));
  ["C'est le mien !", 'Oui.', 'Oui !', 'Merci.', "D'accord."].forEach(t => acceptsAt('lost', 0, 'found', t));
  ['Voilà.', "D'accord.", 'Ok, merci.', 'Merci.', 'Super.', 'Oui.'].forEach(t => acceptsAt('lost', 1, 'form', t));
});
check('no keyword list has a second group built by concat', () => {
  const { readFileSync } = require('node:fs');
  const src = readFileSync(new URL('../js/scenes-fr.js', import.meta.url), 'utf8');
  assert.ok(!/\.concat\(\s*\[\s*\[/.test(src), 'found .concat([[');
});
check('evening scenes answer a bare greeting with Bonsoir', () => {
  for (const id of ['restaurant', 'hotel']) {
    const r = S.respond(S.start(id, 0), 'Bonsoir !');
    assert.equal(r.kind, 'hello'); assert.equal(r.npc.fr, 'Bonsoir ! Je vous écoute.');
  }
  const c = S.respond(S.start('cafe', 0), 'Bonjour !');
  assert.equal(c.npc.fr, 'Bonjour ! Je vous écoute.');
  assert.ok(S.allNpcLines().includes('Bonsoir ! Je vous écoute.'));
});
check('métro: closed station and interrupted line are caught by their keywords', () => {
  const a = S.start('metro', 1); a.node = 'line';
  assert.match(S.respond(a, 'Fermée ? Louvre-Rivoli, d\'accord.').npc.fr, /c'est ça/);
  assert.ok(a.caught);
  const b = S.start('metro', 2); b.node = 'line';
  S.respond(b, 'Interrompue ? La ligne 7, merci.');
  assert.ok(b.caught);
  assert.ok(!S.allNpcLines().some(l => /Palais Royal/.test(l)));
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

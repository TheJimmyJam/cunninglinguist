// Fake-clock checks for js/srs.js: scheduling over 3 days, honest streak,
// learnedCards migration, and answer grading. Run: node tests/srs-sim.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const S = require('../js/srs.js');

let failures = 0, passes = 0;
function check(name, fn) {
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

// Fake clock: 9:00 local on a fixed day, advanced by whole days.
const T0 = new Date(2026, 10, 23, 9, 0, 0).getTime();
const at = (days, hours = 0) => S.addDays(T0, days) + 9 * 3600000 + hours * 3600000;
const dueKeys = (store, now) => S.dueCards(store, now).filter(c => c.dir === 'rec').map(c => c.key).sort();

check('3-day sim: missed card returns sooner, passed card returns later', () => {
  const st = S.emptyStore();
  // Day 1: both introduced; "bonjour" passed, "merci" missed.
  S.introduce(st, 'bonjour', at(0));
  S.introduce(st, 'merci', at(0));
  const pass1 = S.grade(st, 'bonjour', 'rec', true, at(0));
  const miss1 = S.grade(st, 'merci', 'rec', false, at(0));
  assert.ok(miss1.due < pass1.due, 'missed card due before passed card');
  assert.ok(miss1.due - at(0) <= 15 * 60000, 'missed card back within minutes');
  assert.equal(pass1.ivl, 1);
  assert.deepEqual(dueKeys(st, at(0, 1)), ['merci'], 'an hour later only the missed card is due');
  // Day 2: both due; both passed now.
  assert.deepEqual(dueKeys(st, at(1)), ['bonjour', 'merci']);
  const pass2 = S.grade(st, 'bonjour', 'rec', true, at(1));
  const pass2b = S.grade(st, 'merci', 'rec', true, at(1));
  assert.equal(pass2.ivl, 3, 'second pass: 3 days');
  assert.equal(pass2b.ivl, 1, 'relearned card restarts at 1 day');
  assert.ok(pass2.ivl > pass1.ivl, 'passed card interval grew');
  // Day 3: only the card that was missed on day 1 is due.
  assert.deepEqual(dueKeys(st, at(2)), ['merci']);
  assert.ok(!dueKeys(st, at(3)).includes('bonjour'), 'passed twice: not due on day 4');
  assert.ok(dueKeys(st, at(4)).includes('bonjour'), 'due again on day 5 (3 days after day 2)');
  // Third pass grows by ease.
  const pass3 = S.grade(st, 'bonjour', 'rec', true, at(4));
  assert.ok(pass3.ivl > 3, 'third pass interval > 3, got ' + pass3.ivl);
});

check('ease drops on a miss and the interval restarts', () => {
  let c = S.review(null, true, at(0));
  c = S.review(c, true, at(1));
  c = S.review(c, false, at(4));
  assert.equal(c.reps, 0);
  assert.equal(c.ivl, 0);
  assert.equal(c.lapses, 1);
  assert.ok(c.ease < 2.5);
});

check('practising early does not stretch the interval', () => {
  let c = S.review(null, true, at(0));      // due tomorrow
  const c2 = S.review(c, true, at(0, 2));   // same day again
  assert.equal(c2.ivl, 1);
  assert.equal(c2.due, c.due);
});

check('recognition and production are scheduled separately', () => {
  const st = S.emptyStore();
  S.introduce(st, 'la gare', at(0));
  S.grade(st, 'la gare', 'rec', true, at(0));
  S.grade(st, 'la gare', 'prod', false, at(0));
  assert.equal(S.getCard(st, 'la gare', 'rec').ivl, 1);
  assert.equal(S.getCard(st, 'la gare', 'prod').ivl, 0);
});

check('migration: learnedCards become "seen, due tomorrow"', () => {
  const st = S.emptyStore();
  const n = S.migrateLearned(st, ['Bonjour', 'Merci', 'Bonjour'], at(0));
  assert.equal(n, 2);
  assert.equal(st.migrated, true);
  const c = S.getCard(st, 'Bonjour', 'rec');
  assert.equal(c.reps, 1);
  assert.equal(c.ivl, 1);
  assert.equal(S.getCard(st, 'Bonjour', 'prod'), null, 'production stays new');
  assert.deepEqual(dueKeys(st, at(0, 5)), [], 'not due today');
  assert.deepEqual(dueKeys(st, at(1)), ['Bonjour', 'Merci'], 'due tomorrow');
  // Passing tomorrow moves it to 3 days, like any second review.
  assert.equal(S.grade(st, 'Bonjour', 'rec', true, at(1)).ivl, 3);
  // Re-running the migration does not reset progress.
  S.migrateLearned(st, ['Bonjour'], at(1));
  assert.equal(S.getCard(st, 'Bonjour', 'rec').ivl, 3);
});

check('mastered = interval 3+ (two passes on separate days)', () => {
  const st = S.emptyStore();
  S.grade(st, 'oui', 'rec', true, at(0));
  assert.equal(S.isMastered(st, 'oui'), false);
  S.grade(st, 'oui', 'rec', true, at(0, 1)); // same-day cram
  assert.equal(S.isMastered(st, 'oui'), false);
  S.grade(st, 'oui', 'rec', true, at(1));
  assert.equal(S.isMastered(st, 'oui'), true);
});

check('streak: finished days count, skipped days do not', () => {
  let s = {};
  s = S.finishSessionDay(s, at(0)).state;             // day 1
  assert.equal(s.streak, 1);
  const again = S.finishSessionDay(s, at(0, 5));        // second session same day
  assert.equal(again.counted, false);
  assert.equal(again.state.streak, 1);
  s = S.finishSessionDay(s, at(1)).state;             // day 2
  assert.equal(s.streak, 2);
  // Day 3 skipped (opened the app, no session) → no change.
  assert.equal(S.liveStreak(s, at(2)), 2);
  // Day 4 session: one missed day covered by grace, counts +1 not +2.
  const r = S.finishSessionDay(s, at(3));
  assert.equal(r.graced, true);
  assert.equal(r.state.streak, 3);
  s = r.state;
  // Gap of two missed days resets.
  assert.equal(S.liveStreak(s, at(6)), 0, 'broken chain shows 0');
  s = S.finishSessionDay(s, at(6)).state;
  assert.equal(s.streak, 1);
});

check('streak: long gaps never survive (no multi-month grace)', () => {
  let s = S.finishSessionDay({}, at(0)).state;
  s = S.finishSessionDay(s, at(1)).state;
  assert.equal(S.liveStreak(s, at(70)), 0);
  assert.equal(S.finishSessionDay(s, at(70)).state.streak, 1);
});

check('streak: grace limited to 2 a month', () => {
  let s = S.finishSessionDay({}, at(0)).state;
  s = S.finishSessionDay(s, at(2)).state;  // grace 1
  s = S.finishSessionDay(s, at(4)).state;  // grace 2
  assert.equal(s.streak, 3);
  s = S.finishSessionDay(s, at(6)).state;  // no grace left (same month)
  assert.equal(s.streak, 1);
});

check('days to Paris', () => {
  assert.equal(S.daysUntil(S.PARIS_DATE, new Date(2026, 10, 23, 22, 0).getTime()), 27);
  assert.equal(S.daysUntil(S.PARIS_DATE, new Date(2026, 11, 20, 1, 0).getTime()), 0);
});

// ── Grading ──
const G = (typed, display, lang = 'fr', alts) => S.gradeAnswer(typed, display, { lang, alts });
check('grading: parentheses are notes, not part of the answer', () => {
  assert.equal(G('70', '70 (lit. sixty-ten)', 'en').ok, true);
  assert.equal(G('seventy', '70 (lit. sixty-ten)', 'en').ok, false);
  assert.equal(G('Hi', 'Hi / Bye (casual)', 'en').ok, true);
  assert.equal(G('bye', 'Hi / Bye (casual)', 'en').ok, true);
  assert.equal(G("you wouldn't dare", "(challenge:) you wouldn't dare", 'en').ok, true);
  assert.equal(G('I love', 'I love (it)', 'en').ok, true);
  assert.equal(G('I love it', 'I love (it)', 'en').ok, true);
  assert.equal(G('désolé', 'Pardon, je suis désolé(e).', 'fr').ok, false);
  assert.equal(G('Pardon, je suis désolé', 'Pardon, je suis désolé(e).', 'fr').ok, true);
  assert.equal(G('pardon je suis désolée', 'Pardon, je suis désolé(e).', 'fr').ok, true);
  assert.equal(G('américaine', 'américain(e)', 'fr').ok, true);
});
check('grading: curly apostrophes and l\'/d\' contractions', () => {
  assert.equal(G('l’entrée', "l'entrée").ok, true);
  assert.equal(G("l'entrée", 'l’entrée').ok, true);
  assert.equal(G('l entrée', "l'entrée").ok, true);
  assert.equal(G('la entrée', "l'entrée").ok, false);
  assert.equal(G('d’accord', "D'accord").ok, true);
  assert.equal(G("de accord", "D'accord").ok, false);
  assert.equal(G("J’ai une réservation", "J'ai une réservation.").ok, true);
  assert.equal(G("S’il vous plaît", "S'il vous plaît").ok, true);
  assert.equal(G('I’m well, thanks', "I'm well, thanks.", 'en').ok, true);
  assert.equal(G('I am well thanks', "I'm well, thanks.", 'en').ok, true);
});
check('grading: accents optional, with a nudge', () => {
  const r = G('lentree', "l'entrée");
  assert.equal(r.ok, true);
  assert.equal(r.nudge, true);
  assert.equal(r.expected, "l'entrée");
  const exact = G("l'entrée", "l'entrée");
  assert.equal(exact.ok, true);
  assert.equal(exact.nudge, false);
  assert.equal(G('ca va bien, merci', 'Ça va bien, merci.').nudge, true);
  assert.equal(G('Ça va bien merci', 'Ça va bien, merci.').nudge, false);
  assert.equal(G('oeuf', 'œuf').ok, true);
  assert.equal(G('Bonjour, ça va ?', 'Bonjour, ça va ?').ok, true);
  assert.equal(G('bonjour ça va', 'Bonjour, ça va ?').ok, true);
});
check('grading: listed alternatives', () => {
  assert.equal(G('good morning', 'Hello / Good morning', 'en').ok, true);
  assert.equal(G('a tour', 'a visit/tour', 'en').ok, true);
  assert.equal(G('the check', 'the bill/check (also)', 'en').ok, true);
  assert.equal(G("C'est combien ?", 'Ça coûte combien ?', 'fr', ["C'est combien ?"]).ok, true);
  assert.equal(G('', 'Bonjour').ok, false);
  assert.equal(G('   ', 'Bonjour').ok, false);
});
check('multiple choice options never repeat ignoring case', () => {
  const opts = S.uniqueOptions('Sorry', ['sorry', 'Pardon', 'SORRY ', 'Thanks', 'pardon', 'Yes'], 4);
  assert.deepEqual(opts, ['Sorry', 'Pardon', 'Thanks', 'Yes']);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

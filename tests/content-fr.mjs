// Content checks for the English → French course (Paris v2, stage 3).
// Run: node tests/content-fr.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const S = require('../js/srs.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const courseSrc = readFileSync(join(root, 'js/course-en-fr.js'), 'utf8');
const scenesMd = readFileSync(join(root, 'Conversation-Scenarios.md'), 'utf8');
const appSrc = readFileSync(join(root, 'js/app.js'), 'utf8');
const { COURSE, CONVOS } = new Function(courseSrc + ';return { COURSE: COURSE_FR, CONVOS: CONVERSATIONS_FR };')();

let failures = 0, passes = 0;
function check(name, fn) {
  try { fn(); passes++; console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

const all = [];
COURSE.forEach(d => ['vocab', 'phrases', 'paris'].forEach(k => (d[k] || []).forEach(v => all.push({ ...v, day: d.day, list: k }))));
const pack = all.filter(i => i.list === 'paris');
const byFr = fr => all.filter(i => i.fr === fr);

// The real getStudyItems from app.js, run against stubs.
function realStudyItems() {
  const start = appSrc.indexOf('function getStudyItems() {');
  const end = appSrc.indexOf('let _studyCache', start);
  assert.ok(start > 0 && end > start, 'getStudyItems not found in app.js');
  const fn = new Function('COURSE', 'state', 'studyKey', 'getFrontWord', 'getBackWord',
    appSrc.slice(start, end) + '\nreturn getStudyItems();');
  return fn(COURSE, { savedVocab: [] }, v => S.itemKey(v.fr), v => v.fr || '', v => v.en || '');
}
const study = realStudyItems();

check('every item has english, french and a sounds-like line', () => {
  const bad = all.filter(i => !String(i.en || '').trim() || !String(i.fr || '').trim() || !String(i.ipa || '').trim());
  assert.deepEqual(bad.map(i => `day ${i.day}: ${i.fr}`), []);
});
check('no sounds-like line starts with "..."', () => {
  assert.deepEqual(all.filter(i => /^\s*\.\.\./.test(i.ipa)).map(i => i.fr), []);
});
check('French typography: a space before ? and ! in every French line', () => {
  const lines = all.map(i => i.fr).concat(CONVOS.flatMap(c => c.lines.map(l => l.fr)));
  assert.deepEqual(lines.filter(s => /[^\s][?!]/.test(s)), []);
});
check('no duplicate French keys after normalization (one review card each)', () => {
  const keys = study.map(i => i.key);
  assert.equal(new Set(keys).size, keys.length);
  const distinct = new Set(all.map(i => S.itemKey(i.fr)));
  assert.equal(keys.length, distinct.size);
});
check('case/punctuation twins fold to one key', () => {
  [['Au revoir', 'au revoir'], ['Bon appétit !', 'bon appétit'], ['Gardez la monnaie.', 'gardez la monnaie'],
   ['Bonne journée', 'bonne journée'], ['Bonne soirée', 'bonne soirée'], ['À bientôt', 'à bientôt'],
   ["J'ai mal à la tête.", "j'ai mal à la tête"], ['Bon week-end !', 'bon week-end'],
   ['Prenez soin de vous.', 'prenez soin de vous'], ['l’addition', "L'addition"]]
    .forEach(([a, b]) => assert.equal(S.itemKey(a), S.itemKey(b), a));
  assert.notEqual(S.itemKey('où'), S.itemKey('ou'));
  assert.notEqual(S.itemKey('vingt-deux'), S.itemKey('vingt deux'));
});
check('old exact-text review cards migrate to folded keys, keeping the further-along card', () => {
  const st = S.emptyStore();
  S.setCard(st, 'Au revoir', 'rec', { due: 1, ivl: 1, ease: 2.5, reps: 1, lapses: 0 });
  S.setCard(st, 'au revoir', 'rec', { due: 2, ivl: 6, ease: 2.5, reps: 3, lapses: 0 });
  S.setCard(st, 'Au revoir', 'prod', { due: 3, ivl: 1, ease: 2.5, reps: 1, lapses: 0 });
  S.setCard(st, 'Bon appétit !', 'rec', { due: 4, ivl: 3, ease: 2.5, reps: 2, lapses: 0 });
  S.migrateKeys(st);
  assert.deepEqual(Object.keys(st.cards).sort(), ['au revoir', 'bon appétit']);
  assert.equal(st.cards['au revoir'].rec.reps, 3);
  assert.equal(st.cards['au revoir'].prod.reps, 1);
  assert.equal(st.keysV, 2);
  const snap = JSON.stringify(st);
  S.migrateKeys(st);
  assert.equal(JSON.stringify(st), snap);
});
check('allergy line (safety): tree nuts and peanuts, no "aux noix"', () => {
  const nuts = byFr('Je suis allergique aux fruits à coque.');
  assert.ok(nuts.length >= 1 && nuts.some(i => i.list === 'paris'), 'tree-nut line missing or not in week one');
  assert.ok(byFr('Je suis allergique aux arachides.').length === 1);
  assert.equal(/allergique aux noix/i.test(courseSrc), false);
});
check('steak doneness: saignant rare, à point medium-rare/medium, bien cuit well-done', () => {
  assert.match(byFr('saignant')[0].en, /^rare/);
  assert.match(byFr('à point')[0].en, /medium-rare/);
  assert.match(byFr('à point')[0].en, /\/ medium/);
  assert.match(byFr('bien cuit')[0].en, /well-done/);
  const tip = COURSE.find(d => d.day === 12).grammar;
  assert.match(tip, /'à point' is medium-rare to medium/);
  assert.doesNotMatch(tip, /or even 'bien cuit'/);
});
check('no "carnet" anywhere in en-fr content or Conversation-Scenarios.md', () => {
  assert.equal(/carnet/i.test(courseSrc), false);
  assert.equal(/carnet/i.test(scenesMd), false);
});
check('listed fixes are in', () => {
  assert.equal(byFr("C'est quatre-vingts euros.").length, 1);
  assert.equal(byFr('trois')[0].ipa, 'trwah');
  assert.equal(byFr('dix-sept')[0].ipa, 'dee-set');
  assert.equal(byFr('vingt-deux')[0].ipa, 'vant-duh');
  assert.equal(all.filter(i => /gloo-tan/.test(i.ipa)).length, 0);
  assert.equal(byFr('Donnez-moi la monnaie.').length, 0);
  assert.equal(byFr("Bonjour, je voudrais changer des dollars, s'il vous plaît.").length, 1);
  assert.equal(byFr("C'est quoi, le plat du jour ?").length, 1);
  assert.equal(byFr("Je suis américain, d'accord ?").length, 0);
  assert.equal(byFr('Prenez la ligne 4 en correspondance.').length, 1);
  assert.equal(/Uber dans cette ville/.test(courseSrc), false);
  all.filter(i => S.itemKey(i.fr).startsWith('bonne soirée')).forEach(i => assert.match(i.en, /have a good evening/i, i.fr));
  CONVOS.flatMap(c => c.lines).filter(l => /Bonne soirée/.test(l.fr)).forEach(l => assert.match(l.en, /have a good evening/i));
});
check('Paris pack: 60+ items in week one, with the listed phrases and staff lines', () => {
  assert.ok(pack.length >= 60, 'pack has ' + pack.length);
  assert.ok(pack.every(i => i.day >= 1 && i.day <= 7));
  [
    "Où sont les toilettes, s'il vous plaît ?", 'Je vous en prie.', 'Merci, vous aussi.', 'Pardon, je descends.',
    "C'est tout, merci.", "Je n'ai pas compris.", 'Vous pouvez répéter plus lentement ?', "Vous pouvez l'écrire ?",
    'Comment dit-on ça en français ?', "Il y a une erreur dans l'addition.", 'Ma carte ne passe pas.',
    'Vous avez quelque chose contre le rhume ?', "Il y a une grève aujourd'hui ?", 'Le train a du retard.',
    'Joyeux Noël !', 'Bonne année !', "C'est ouvert le 25 ?", "Un vin chaud, s'il vous plaît.", 'Il fait froid !',
    'Sur place ou à emporter ?', 'Carte ou espèces ?', 'Vous avez choisi ?', 'Ça sera tout ?', 'Et avec ceci ?',
    'Quel ticket me faut-il pour aller à Paris ?', 'le vingt-cinq décembre', 'On ferme à dix-neuf heures.',
    "Une table pour deux à vingt heures, s'il vous plaît."
  ].forEach(fr => assert.ok(pack.some(i => i.fr === fr), 'missing from pack: ' + fr));
  ['Sur place ou à emporter ?', 'Carte ou espèces ?', 'Vous avez choisi ?', 'Ça sera tout ?', 'Et avec ceci ?']
    .forEach(fr => assert.equal(pack.find(i => i.fr === fr).heard, true, fr));
});
check('survival lines moved into week one, French unchanged', () => {
  ['Quelle ligne pour le Louvre ?', "C'est quelle station pour Notre-Dame ?", 'Ce train va à Charles de Gaulle ?',
   'Excusez-moi, où est le métro ?', 'Je suis perdu(e).', "J'ai perdu mon passeport.", "On m'a volé mon sac.",
   'Où est la pharmacie la plus proche ?', "J'ai besoin d'un médecin."].forEach(fr => {
    const hits = byFr(fr);
    assert.equal(hits.length, 1, fr);
    assert.equal(hits[0].list, 'paris', fr);
  });
});
check('pack items reachable: in a lesson and first in the Today order', () => {
  const packKeys = new Set(pack.map(i => S.itemKey(i.fr)));
  const studyPack = study.filter(i => i.paris);
  assert.equal(studyPack.length, packKeys.size);
  const lastPackAt = study.reduce((m, i, ix) => (i.paris ? ix : m), -1);
  // two pack items for every track item until the pack is done
  assert.ok(lastPackAt < Math.ceil(packKeys.size * 1.5) + 1, 'last pack item at ' + lastPackAt);
  assert.ok(study.slice(0, 6).filter(i => i.paris).length >= 4);
  assert.ok(study.some(i => i.key === S.itemKey('Bonjour') && !i.paris));
});
check('accepted alternatives grade as right', () => {
  const g = (typed, fr) => { const it = all.find(i => i.fr === fr); return S.gradeAnswer(typed, it.fr, { lang: 'fr', alts: it.alt }); };
  assert.equal(g('Il me faut quel ticket pour aller à Paris ?', 'Quel ticket me faut-il pour aller à Paris ?').ok, true);
  assert.equal(g('Prenez la ligne quatre en correspondance', 'Prenez la ligne 4 en correspondance.').ok, true);
  assert.equal(g('le 25 décembre', 'le vingt-cinq décembre').ok, true);
  assert.equal(g('Une tradition, s’il vous plaît', "Une baguette tradition, s'il vous plaît.").ok, true);
  assert.equal(g('Je suis allergique aux fruits a coque', 'Je suis allergique aux fruits à coque.').nudge, true);
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);

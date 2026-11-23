// Stage 3 browser check: muted headless Chrome, 390px, local server on 8773.
// Serve: a dir with `cunninglinguist` -> repo symlink, `python3 -m http.server 8773 --bind 127.0.0.1`.
// Run: node tests/browser-stage3.cjs (puppeteer-core from Archived Projects/SmallHours). Screenshots go to $SHOTS or the temp dir.
const puppeteer = require('/Users/cccmacmini/Desktop/Projects/Archived Projects/SmallHours/node_modules/puppeteer-core');
const BASE = 'http://127.0.0.1:8773/cunninglinguist/learn.html';
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const results = [];
const ok = (name, cond, info) => { results.push([cond ? 'ok  ' : 'FAIL', name, info || '']); };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--mute-audio', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=user-gesture-required']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { const loc = ((m.location() || {}).url || ''); if (m.type() === 'error' && !(/Failed to load resource/.test(m.text()) && !loc.startsWith('http://127.0.0.1:8773/'))) errors.push('console: ' + m.text() + ' @' + ((m.location() || {}).url || '')); });
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.startsWith('http://127.0.0.1:8773/') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    if (u.includes('/api/translate')) return r.respond({ status: 200, contentType: 'application/json', body: '{}' });
    return r.abort();
  });
  await page.evaluateOnNewDocument(() => {
    const fake = { speak() {}, cancel() {}, getVoices() { return []; }, pause() {}, resume() {}, speaking: false, addEventListener() {} };
    try { Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true }); } catch (e) {}
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });

  // Seed an old-format store (exact-text keys, a case twin) before the app loads.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('cll_lang', 'en-fr');
    localStorage.setItem('cll_profile_skipped', '1');
    const now = Date.now();
    localStorage.setItem('cll_srs_en-fr', JSON.stringify({ v: 1, migrated: true, cards: {
      'Au revoir': { rec: { due: now + 86400000, ivl: 1, ease: 2.5, reps: 1, lapses: 0, last: now } },
      'au revoir': { rec: { due: now + 6 * 86400000, ivl: 6, ease: 2.5, reps: 3, lapses: 0, last: now } },
      'Bon appétit !': { rec: { due: now + 86400000, ivl: 1, ease: 2.5, reps: 1, lapses: 0, last: now } }
    } }));
  });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof startToday === 'function' && typeof COURSE !== 'undefined', { timeout: 15000 });

  const mig = await page.evaluate(() => JSON.parse(localStorage.getItem('cll_srs_en-fr')));
  ok('old review cards re-keyed (one "au revoir", furthest card kept)',
    mig.keysV === 2 && !mig.cards['Au revoir'] && mig.cards['au revoir'] && mig.cards['au revoir'].rec.reps === 3 && !!mig.cards['bon appétit'],
    Object.keys(mig.cards).join(' | '));

  const order = await page.evaluate(() => studyItems().slice(0, 9).map(i => (i.paris ? 'P:' : 'T:') + i.fr));
  ok('Today order starts with the Paris pack (2 pack : 1 track)', order[0].startsWith('P:') && order[1].startsWith('P:') && order[2].startsWith('T:'), order.join(' / '));

  // Today start screen + 10-minute session: intros show pack lines.
  const startTxt = await page.evaluate(() => { setView('today'); return document.querySelector('#content, main, body').innerText.slice(0, 400); });
  ok('Today start screen renders', /Start/i.test(startTxt), startTxt.replace(/\s+/g, ' ').slice(0, 120));
  await page.screenshot({ path: SHOTS + '/s3-today-start-390.png' });
  await page.evaluate(() => startToday('10'));
  const intros = [];
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => { const s = todayStep(); return s ? s.t : null; });
    if (st !== 'intro') break;
    intros.push(await page.evaluate(() => (document.querySelector('.today-fr') || {}).innerText + ' — ' + ((document.querySelector('.today-ipa') || {}).innerText || '')));
    if (i === 0) await page.screenshot({ path: SHOTS + '/s3-today-intro-390.png' });
    await page.evaluate(() => todayNext());
  }
  ok('Today intro shows 6 new items, Paris pack first', intros.length === 6 && /Je vous en prie/.test(intros[0]), intros.join(' | '));

  // Lesson views: day 1 and day 7 show the Paris section; day 12 has the fixes.
  const lesson = async d => page.evaluate(n => {
    setView('lesson'); renderLessonView(n);
    const hs = [...document.querySelectorAll('h3')].map(h => h.innerText);
    const items = [...document.querySelectorAll('.paris-list .phrase .fr')].map(e => e.innerText);
    return { hs, items, text: document.body.innerText };
  }, d);
  const d1 = await lesson(1);
  ok('Day 1 lesson: Paris survival section', d1.hs.some(h => /Paris survival/.test(h)) && d1.items.length === 7, d1.items.slice(0, 3).join(' | '));
  await page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find(x => /Paris survival/.test(x.innerText)); h && h.scrollIntoView(); });
  await page.screenshot({ path: SHOTS + '/s3-lesson1-paris-390.png' });
  const d2 = await lesson(2);
  ok('Day 2 lesson: emergency lines + 112 tip', ['Au secours !', "Appelez une ambulance, s'il vous plaît.", 'Appelez la police !'].every(f => d2.items.includes(f)) && /Emergency: 112 \(15 = medical\)/.test(d2.text), d2.items.slice(-3).join(' | '));
  const d6 = await lesson(6);
  ok('Day 6 lesson: December pack', d6.items.includes('Joyeux Noël !') && d6.items.includes("C'est ouvert le 25 ?"), d6.items.length + ' items');
  const d7 = await lesson(7);
  ok('Day 7 lesson: métro pack incl. moved lines', d7.items.includes('Quelle ligne pour le Louvre ?') && d7.items.includes('Quel ticket me faut-il pour aller à Paris ?'), d7.items.length + ' items');
  const d12 = await lesson(12);
  ok('Day 12 lesson: allergy + doneness fixes', /allergique aux fruits à coque/.test(d12.text) && /medium-rare \/ medium/.test(d12.text) && !/aux noix/.test(d12.text));
  const d18 = await lesson(18);
  ok('Day 18 lesson: no carnet, Navigo tip', !/carnet/i.test(d18.text) && /Navigo Easy/.test(d18.text));
  const ipaLabel = await page.evaluate(() => t('flash_ipa_on'));
  ok('Flashcard label renamed', ipaLabel === 'Sounds-like on front', ipaLabel);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('No sideways scroll at 390px', overflow <= 0, 'overflow ' + overflow);

  // Métro scene in Conversations
  const convo = await page.evaluate(() => { setView('conversations'); return { text: document.body.innerText, data: JSON.stringify(CONVERSATIONS) }; });
  ok('Conversations: no carnet, Navigo Easy line', !/carnet/i.test(convo.text) && !/carnet/i.test(convo.data) && /Navigo Easy/.test(convo.data) && /Tickets|Métro/i.test(convo.text), convo.text.replace(/\s+/g,' ').slice(0, 160));

  ok('en-fr: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  // en-pt still renders
  errors.length = 0;
  await page.evaluate(() => localStorage.setItem('cll_lang', 'en-pt'));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof renderLessonView === 'function' && typeof COURSE !== 'undefined', { timeout: 15000 });
  const pt = await page.evaluate(() => { setView('lesson'); renderLessonView(1); return { cards: document.querySelectorAll('.vocab-card').length, paris: document.querySelectorAll('.paris-list').length, lang: currentLang }; });
  ok('en-pt lesson renders, no Paris section', pt.lang === 'en-pt' && pt.cards > 0 && pt.paris === 0, JSON.stringify(pt));
  const ptFlash = await page.evaluate(() => { setView('flashcards'); return document.body.innerText.length > 50; });
  ok('en-pt flashcards open', ptFlash);
  ok('en-pt: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  await browser.close();
  results.forEach(r => console.log(r.join('  ')));
  console.log(results.filter(r => r[0] === 'FAIL').length ? 'SOME FAILED' : 'ALL OK');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

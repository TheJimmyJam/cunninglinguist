// Stage 4 browser check: static audio + Listen drill, muted headless Chrome at 390px.
// 1. node tests/audio-fixture.mjs <dir> --ffmpeg <path>     (mock MP3s, test manifest; not in the repo)
// 2. python3 -m http.server 8774 --bind 127.0.0.1 --directory <dir>
// 3. node tests/browser-stage4.cjs                          (SHOTS=<dir> for screenshots)
// HTMLMediaElement.play is wrapped to record each call (src, inside a click
// handler or not) and then runs the real play() with --mute-audio. Web Speech
// is a recording stub. No sound plays.
const puppeteer = require('/Users/cccmacmini/Desktop/Projects/Archived Projects/SmallHours/node_modules/puppeteer-core');
const A = require('../js/audio.js');
const ORIGIN = 'http://127.0.0.1:8774';
const BASE = ORIGIN + '/cunninglinguist/learn.html';
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
  const errors = [], bad = [], audioReqs = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { const loc = ((m.location() || {}).url || ''); if (m.type() === 'error' && !(/Failed to load resource/.test(m.text()) && !loc.startsWith(ORIGIN))) errors.push('console: ' + m.text() + ' @' + loc); });
  page.on('response', r => { if (r.url().startsWith(ORIGIN) && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/audio/fr/')) audioReqs.push(u.replace(ORIGIN, ''));
    if (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    if (u.includes('/api/translate')) return r.respond({ status: 200, contentType: 'application/json', body: '{}' });
    return r.abort();
  });
  await page.evaluateOnNewDocument(() => {
    window.__plays = []; window.__speaks = [];
    const inClick = () => !!(window.event && window.event.type === 'click');
    const fake = { speak(u) { window.__speaks.push({ text: u.text, rate: u.rate, inClick: inClick() }); }, cancel() {}, getVoices() { return []; }, pause() {}, resume() {}, speaking: false, addEventListener() {} };
    try { Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true }); } catch (e) {}
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const rec = { src: this.src.replace(location.origin, ''), inClick: inClick(), muted: this.muted, result: 'pending' };
      window.__plays.push(rec);
      const p = realPlay.call(this);
      p.then(() => { rec.result = 'played'; }, e => { rec.result = 'rejected ' + e.name; });
      return p;
    };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('cll_lang', 'en-fr'); localStorage.setItem('cll_profile_skipped', '1'); });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof renderListenView === 'function' && audioManifests.fr && typeof audioManifests.fr === 'object', { timeout: 15000 });
  const manKeys = await page.evaluate(() => Object.keys(audioManifests.fr).length);
  ok('manifest preloaded once at startup', manKeys > 50 && audioReqs.filter(u => u.endsWith('manifest.json')).length === 1, manKeys + ' keys; ' + audioReqs.join(' '));
  const clear = () => page.evaluate(() => { window.__plays.length = 0; window.__speaks.length = 0; });
  const rec = () => page.evaluate(() => ({ plays: window.__plays.slice(), speaks: window.__speaks.slice() }));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Lesson day 1: "Bonjour" has a file, "Bonsoir" doesn't.
  await page.evaluate(() => { setView('lesson'); renderLessonView(1); });
  const btnFor = word => page.evaluateHandle(w => [...document.querySelectorAll('button.speak-btn')].find(b => (b.getAttribute('onclick') || '').includes(`speakWord('${w}'`)), word);
  await clear();
  await (await btnFor('Bonjour')).click();
  await sleep(400);
  let r = await rec();
  const hB = A.audioHash('Bonjour');
  ok('static file used when listed (Bonjour)', r.plays.length === 1 && r.plays[0].src === `/cunninglinguist/audio/fr/${hB}.mp3` && r.speaks.length === 0, JSON.stringify(r));
  ok('play() called synchronously inside the click handler', r.plays.every(p => p.inClick), JSON.stringify(r.plays));
  ok('real play() of the mock MP3 resolves (muted)', r.plays[0] && r.plays[0].result === 'played', r.plays[0] && r.plays[0].result);
  await clear();
  await (await btnFor('Bonsoir')).click();
  await sleep(200);
  r = await rec();
  ok('Web Speech when not listed (Bonsoir), in the tap, rate 0.9', r.plays.length === 0 && r.speaks.length === 1 && r.speaks[0].text === 'Bonsoir' && r.speaks[0].rate === 0.9 && r.speaks[0].inClick, JSON.stringify(r));
  ok('unlisted file never requested', !audioReqs.some(u => u.includes(A.audioHash('Bonsoir'))));

  // More → Listen
  await page.click('.bottom-nav button[data-bnav="more"]');
  const sheet = await page.evaluate(() => [...document.querySelectorAll('.more-sheet button')].filter(b => b.offsetParent).map(b => { const q = b.getBoundingClientRect(); return { t: b.innerText, w: Math.round(q.width * 10) / 10, h: Math.round(q.height * 10) / 10, x: Math.round(q.left + q.width / 2) }; }));
  const rest = sheet.slice(1);
  ok('More sheet: Listen first, full row; other 6 equal (2x3)', sheet[0].t === 'Listen' && sheet.length === 7 && rest.every(b => b.w === rest[0].w && b.h === rest[0].h) && Math.abs(sheet[0].x - 195) <= 1 && sheet[0].h === rest[0].h, JSON.stringify(sheet));
  await page.screenshot({ path: SHOTS + '/s4-more-390.png' });
  await page.click('.more-sheet button[data-view="listen"]');
  const startBtns = await page.evaluate(() => [...document.querySelectorAll('.today-actions .today-btn')].map(b => { const q = b.getBoundingClientRect(); return [b.innerText, Math.round(q.width), Math.round(q.height)]; }));
  ok('Listen start screen: 2 equal buttons', startBtns.length === 2 && startBtns[0][1] === startBtns[1][1] && startBtns[0][2] === startBtns[1][2] && startBtns[0][2] >= 44, JSON.stringify(startBtns));

  await clear();
  await page.click('.today-actions .today-btn.primary'); // Start · 10
  r = await rec();
  let q = await page.evaluate(() => listenSession.qs[0]);
  const h0 = A.audioHash(q.fr);
  ok('Start autoplays the first item at native speed, in the tap', r.plays.length === 1 && r.plays[0].src.endsWith(`/${h0}.mp3`) && r.plays[0].inClick, JSON.stringify(r.plays) + ' ' + q.fr);
  const ctl = await page.evaluate(() => [...document.querySelectorAll('.listen-controls button')].map(b => { const q = b.getBoundingClientRect(); return [b.innerText.trim(), Math.round(q.width * 10) / 10, Math.round(q.height * 10) / 10]; }));
  ok('Repeat / Slower / Show text: 3 equal buttons >= 44px', ctl.length === 3 && /Repeat/.test(ctl[0][0]) && /Slower/.test(ctl[1][0]) && /Show text/.test(ctl[2][0]) && ctl.every(c => c[1] === ctl[0][1] && c[2] === ctl[0][2] && c[2] >= 44), JSON.stringify(ctl));
  await page.screenshot({ path: SHOTS + '/s4-listen-q-390.png' });
  await clear();
  await page.click('.listen-controls button:nth-child(2)');
  await page.click('.listen-controls button:nth-child(1)');
  r = await rec();
  ok('Slower plays .slow.mp3, Repeat plays .mp3, both in the tap', r.plays.length === 2 && r.plays[0].src.endsWith(`/${h0}.slow.mp3`) && r.plays[1].src.endsWith(`/${h0}.mp3`) && r.plays.every(p => p.inClick), JSON.stringify(r.plays));
  await page.click('.listen-controls button:nth-child(3)');
  const shown = await page.evaluate(() => (document.querySelector('.listen-fr') || {}).innerText);
  ok('Show text reveals the French', shown === q.fr, shown);

  // Answer all 10: the first wrong, the rest right.
  const answerFor = qq => {
    if (qq.kind === 'price') return qq.en.replace('€', '');
    if (qq.kind === 'time') return qq.en;
    return qq.en.replace(/\D+/g, '');
  };
  const kinds = [];
  let autoplayOk = true, optsEqual = true;
  for (let i = 0; i < 10; i++) {
    q = await page.evaluate(() => listenSession.qs[listenSession.i]);
    kinds.push(q.kind);
    const wrong = i === 0;
    if (q.answer === 'pick') {
      const j = q.opts.findIndex(o => wrong ? o !== q.en && o !== q.alt : o === q.en || o === q.alt);
      const dims = await page.evaluate(() => [...document.querySelectorAll('.today-option')].map(b => { const r = b.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }));
      if (new Set(dims).size !== 1) optsEqual = false;
      await page.click(`.today-option:nth-child(${j + 1})`);
    } else {
      await page.type('#listen-input', wrong ? '999' : answerFor(q));
      await page.click('.today-actions .today-btn.primary');
    }
    const fb = await page.evaluate(() => (document.querySelector('.today-feedback') || {}).className);
    if (!fb || (wrong ? !/no/.test(fb) : !/ok/.test(fb))) ok('feedback for item ' + i, false, fb + ' ' + JSON.stringify(q));
    if (i === 3) await page.screenshot({ path: SHOTS + '/s4-listen-answered-390.png' });
    await clear();
    await page.click('.today-feedback ~ .today-actions .today-btn.primary'); // Continue
    if (i < 9) {
      const nq = await page.evaluate(() => listenSession.qs[listenSession.i]);
      r = await rec();
      if (!(r.plays.length === 1 && r.plays[0].inClick && r.plays[0].src.endsWith('/' + A.audioHash(nq.fr) + '.mp3'))) autoplayOk = false;
    }
  }
  ok('each next item autoplays its static file in the Continue tap', autoplayOk);
  ok('pick options equal size', optsEqual);
  const sum = await page.evaluate(() => ({ text: document.querySelector('.today-tiles').innerText.replace(/\s+/g, ' '), btns: [...document.querySelectorAll('.today-actions .today-btn')].map(b => { const r = b.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }), tiles: [...document.querySelectorAll('.today-tile')].map(b => { const r = b.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); }) }));
  ok('drill mixes prices, times, platform/line, date and staff lines', ['price', 'time', 'date', 'staff'].every(k => kinds.includes(k)) && (kinds.includes('platform') || kinds.includes('line')), kinds.join(','));
  ok('summary: 9/10 right; tiles and buttons equal', /9\/10/.test(sum.text) && new Set(sum.btns).size === 1 && new Set(sum.tiles).size === 1, JSON.stringify(sum));
  await page.screenshot({ path: SHOTS + '/s4-listen-summary-390.png' });
  const srsCards = await page.evaluate(() => { const st = JSON.parse(localStorage.getItem('cll_srs_en-fr')); return Object.entries(st.cards).filter(([k, v]) => studyItem(k) && studyItem(k).heard).map(([k, v]) => [k, !!v.rec, !!v.prod]); });
  ok('staff-line answers feed recognition cards only', srsCards.length >= 3 && srsCards.every(c => c[1] && !c[2]), JSON.stringify(srsCards));

  // Slow fallback: an item with only the normal file → Web Speech at 0.7.
  await page.evaluate(() => {
    const g = CLAUDIO.listenItems().find(x => x.fr === 'Ça fait un euro vingt.');
    listenSession = { mode: 'mixed', qs: [listenQuestion(g)], i: 0, cur: {}, results: [] };
    renderListenView();
  });
  await clear();
  await page.click('.listen-controls button:nth-child(2)');
  await page.click('.listen-controls button:nth-child(1)');
  r = await rec();
  ok('no .slow.mp3 listed → Slower uses Web Speech rate 0.7; Repeat still uses the file', r.speaks.length === 1 && r.speaks[0].rate === 0.7 && r.speaks[0].inClick && r.plays.length === 1 && r.plays[0].src.endsWith(A.audioHash('Ça fait un euro vingt.') + '.mp3'), JSON.stringify(r));

  // Today 10-min: listen steps use the same card; two number steps (price, time).
  await page.evaluate(() => setView('today'));
  await page.click('.today-actions .today-btn.primary');
  let hear = 0, listen = 0, ctlOk = true, guard = 0;
  while (guard++ < 80) {
    const st = await page.evaluate(() => { const s = todayStep(); return s && { t: s.t }; });
    if (!st || st.t === 'done' || !(await page.evaluate(() => !!document.querySelector('.today-step')))) break;
    if (st.t === 'listen' || st.t === 'hear') {
      if (st.t === 'hear') hear++; else listen++;
      const n = await page.evaluate(() => document.querySelectorAll('.listen-controls button').length);
      if (n !== 3) ctlOk = false;
      const j = await page.evaluate(() => { const q = todayListenQ(); return q.opts.findIndex(o => o === q.en || o === q.alt); });
      await page.click(`.today-option:nth-child(${j + 1})`);
      await page.click('.today-feedback ~ .today-actions .today-btn.primary');
    } else if (st.t === 'recall') {
      await page.evaluate(() => { document.getElementById('today-input').value = getFrontWord(studyItem(todayStep().key)); todaySession.cur.typed = document.getElementById('today-input').value; });
      await page.click('.today-actions .today-btn.primary');
      await page.click('.today-actions .today-btn.primary');
    } else {
      await page.click('.today-step .today-actions .today-btn.primary, .today-step .today-actions .today-btn.good');
    }
  }
  const tally = await page.evaluate(() => todaySession.tally);
  ok('Today: 2 number steps + item listen steps with Repeat/Slower/Show text, all heard right', hear === 2 && listen >= 4 && ctlOk && tally.listen[0] === tally.listen[1] && tally.listen[1] === hear + listen, `hear ${hear}, listen ${listen}, tally ${JSON.stringify(tally)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok('no sideways scroll at 390px', overflow <= 0, 'overflow ' + overflow);

  // Every audio request was a listed file; no 4xx/5xx at all.
  const man = await page.evaluate(() => audioManifests.fr);
  const unlisted = audioReqs.filter(u => /\.mp3$/.test(u)).filter(u => { const m = u.match(/\/([0-9a-f]{14})(\.slow)?\.mp3$/); return !m || !(man[m[1]] || '').includes(m[2] ? 's' : 'n'); });
  ok('zero 404s; every MP3 requested is in the manifest', bad.length === 0 && unlisted.length === 0, bad.concat(unlisted).slice(0, 5).join(' | ') + ` (${audioReqs.length} audio requests)`);
  ok('en-fr 390: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  // Desktop: Listen in the top nav.
  errors.length = 0;
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => setView('today'));
  const topListen = await page.evaluate(() => { const b = document.querySelector('nav button[data-view="listen"]'); return b && b.offsetParent ? b.innerText : null; });
  await page.click('nav button[data-view="listen"]');
  await page.click('.today-actions .today-btn.primary');
  const desk = await page.evaluate(() => ({ q: !!document.querySelector('.listen-controls'), w: document.querySelector('.today').getBoundingClientRect().width }));
  ok('1280: Listen tab in the top nav opens the drill', topListen === 'Listen' && desk.q, JSON.stringify(desk));
  await page.screenshot({ path: SHOTS + '/s4-listen-1280.png' });
  ok('1280: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  // en-pt: no Listen, no manifest fetch.
  errors.length = 0;
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  audioReqs.length = 0;
  await page.evaluate(() => localStorage.setItem('cll_lang', 'en-pt'));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof renderLessonView === 'function' && typeof COURSE !== 'undefined', { timeout: 15000 });
  const pt = await page.evaluate(() => ({ lang: currentLang, sheet: [...document.querySelectorAll('.more-sheet button')].filter(b => b.style.display !== 'none').length, listen: getComputedStyle(document.querySelector('.more-sheet button[data-view="listen"]')).display, top: document.querySelector('nav button[data-view="listen"]').style.display }));
  ok('en-pt: Listen hidden (sheet back to 6), no audio manifest request', pt.lang === 'en-pt' && pt.sheet === 6 && pt.top === 'none' && audioReqs.length === 0, JSON.stringify(pt));
  await page.evaluate(() => { setView('lesson'); renderLessonView(1); });
  ok('en-pt: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  await browser.close();
  results.forEach(x => console.log(x.join('  ')));
  console.log(results.filter(x => x[0] === 'FAIL').length ? 'SOME FAILED' : 'ALL OK');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

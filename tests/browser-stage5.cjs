// Stage 5 browser check: Talk (role-play) offline + AI mode against a mocked
// /api/converse, and the translator fixes. Muted headless Chrome at 390px.
// Serve the repo under /cunninglinguist (mirrors _redirects):
//   mkdir -p <dir> && ln -sfn <repo> <dir>/cunninglinguist
//   python3 -m http.server 8775 --bind 127.0.0.1 --directory <dir>
//   node tests/browser-stage5.cjs            (SHOTS=<dir> for screenshots)
// Web Speech is a recording stub; every request off the local origin is
// blocked; /api/* is answered by the interceptor from fixtures. No sound, no
// network, no paid call.
const puppeteer = require('/Users/cccmacmini/Desktop/Projects/Archived Projects/SmallHours/node_modules/puppeteer-core');
const ORIGIN = 'http://127.0.0.1:' + (process.env.PORT || 8775);
const BASE = ORIGIN + '/cunninglinguist/learn.html';
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const TOKEN = 'test-access-token-0123456789abcdef';
const results = [];
const ok = (name, cond, info) => { results.push([cond ? 'ok  ' : 'FAIL', name, cond ? '' : (info || '')]); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// /api fixtures
const CONVERSE_QUEUE = [];
let converseFail = 0;
let translateReply = null;
const apiReqs = [];

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
  page.on('console', m => { const loc = ((m.location() || {}).url || ''); if (m.type() === 'error' && !(/Failed to load resource/.test(m.text()) && (!loc.startsWith(ORIGIN) || loc.includes('/api/')))) errors.push('console: ' + m.text() + ' @' + loc); });
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/api/')) {
      const rec = { url: u.replace(ORIGIN, ''), auth: r.headers().authorization || '', body: (() => { try { return JSON.parse(r.postData() || 'null'); } catch (e) { return null; } })() };
      apiReqs.push(rec);
      if (u.includes('/api/converse')) {
        if (converseFail) { converseFail--; return r.respond({ status: 503, contentType: 'application/json', body: '{"error":"AI unavailable"}' }); }
        const next = CONVERSE_QUEUE.shift() || { status: 500, body: { error: 'no fixture' } };
        return r.respond({ status: next.status || 200, contentType: 'application/json', body: JSON.stringify(next.body) });
      }
      if (u.includes('/api/translate')) {
        const t = translateReply ? translateReply(rec) : { status: 500, body: { error: 'no fixture' } };
        return r.respond({ status: t.status || 200, contentType: 'application/json', body: JSON.stringify(t.body) });
      }
      return r.respond({ status: 404, body: '' });
    }
    if (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    return r.abort();
  });
  await page.evaluateOnNewDocument(() => {
    window.__speaks = [];
    const inClick = () => !!(window.event && (window.event.type === 'click' || window.event.type === 'keydown'));
    const fake = { speak(u) { window.__speaks.push({ text: u.text, rate: u.rate, inClick: inClick() }); }, cancel() {}, getVoices() { return []; }, pause() {}, resume() {}, speaking: false, addEventListener() {} };
    try { Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true }); } catch (e) {}
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('cll_lang', 'en-fr'); localStorage.setItem('cll_profile_skipped', '1'); });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof renderTalkView === 'function' && typeof CLSCENES !== 'undefined' && typeof setView === 'function', { timeout: 15000 });
  const speaks = () => page.evaluate(() => window.__speaks.slice());
  const clearSpeaks = () => page.evaluate(() => { window.__speaks.length = 0; });
  const dims = sel => page.evaluate(s => [...document.querySelectorAll(s)].filter(b => b.offsetParent).map(b => { const q = b.getBoundingClientRect(); return { t: b.innerText.trim(), w: Math.round(q.width * 10) / 10, h: Math.round(q.height * 10) / 10 }; }), sel);
  const equal = a => a.length > 0 && a.every(x => x.w === a[0].w && x.h === a[0].h);
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const say = async text => {
    await page.click('#talk-input', { clickCount: 3 });
    await page.type('#talk-input', text);
    await page.click('.talk-say-btn');
  };

  // ── More → Talk ────────────────────────────────────────────
  await page.click('.bottom-nav button[data-bnav="more"]');
  const sheet = await dims('.more-sheet button');
  const rest = sheet.slice(2);
  ok('More sheet: Listen + Talk full rows; other 6 equal', sheet.length === 8 && sheet[0].t === 'Listen' && sheet[1].t === 'Talk' && sheet[0].w === sheet[1].w && equal(rest) && sheet[1].h === rest[0].h, JSON.stringify(sheet));
  await page.click('.more-sheet button[data-view="talk"]');
  const cards = await dims('.talk-scene');
  ok('Talk: 8 scene cards, equal size', cards.length === 8 && equal(cards), JSON.stringify(cards));
  const modes = await dims('.talk-mode .today-btn');
  ok('Talk: Scripted / AI partner buttons equal, ≥44px', modes.length === 2 && equal(modes) && modes[0].h >= 44, JSON.stringify(modes));
  ok('Talk list: no sideways scroll', await noSideScroll());
  await page.screenshot({ path: SHOTS + '/s5-talk-list-390.png' });

  // (error statuses from the /api fixtures below are deliberate: their "Failed to load resource" lines are not counted)
  // AI partner while signed out → sign-in modal, stays scripted
  await page.evaluate(() => { window.__authOpened = 0; const o = window.cllSync.showAuthModal; window.cllSync.showAuthModal = () => { window.__authOpened++; }; window.cllSync.getUser = () => null; });
  await page.click('.talk-mode .today-btn:nth-child(2)');
  ok('AI partner signed out → sign-in, no mode change', await page.evaluate(() => window.__authOpened === 1 && talkMode === 'scripted'));

  // ── Offline scene: café v0 ─────────────────────────────────
  await clearSpeaks();
  await page.click('.talk-scene:nth-child(1)');
  let sp = await speaks();
  const st0 = await page.evaluate(() => ({ id: talk.id, v: talk.variant, first: talk.npc.fr, hidden: !!document.querySelector('.talk-hidden'), shown: !!document.querySelector('.talk-fr') }));
  ok('café v0 starts; first line spoken inside the tap; text hidden', st0.id === 'cafe' && st0.v === 0 && st0.hidden && !st0.shown && sp.length === 1 && sp[0].text === st0.first && sp[0].inClick, JSON.stringify({ st0, sp }));
  const ctl = await dims('.talk-controls button');
  ok('Repeat / Slower / Hint: equal neighbors, ≥44px', ctl.length === 3 && ctl.map(c => c.t).join() === 'Repeat,Slower,Hint' && equal(ctl) && ctl[0].h >= 44, JSON.stringify(ctl));
  await clearSpeaks();
  await page.click('.talk-controls button:nth-child(1)');
  await page.click('.talk-controls button:nth-child(2)');
  sp = await speaks();
  ok('Repeat at 0.9, Slower at 0.7, both in the tap', sp.length === 2 && sp[0].rate === 0.9 && sp[1].rate === 0.7 && sp.every(s => s.inClick && s.text === st0.first), JSON.stringify(sp));
  await page.click('.talk-controls button:nth-child(3)');
  const h1 = await page.evaluate(() => ({ fr: document.querySelector('.talk-fr')?.innerText, en: document.querySelector('.talk-npc .today-en')?.innerText, hint: !!document.querySelector('.talk-hint') }));
  ok('Hint 1: the line in French + English', h1.fr === st0.first && !!h1.en && !h1.hint, JSON.stringify(h1));
  await page.click('.talk-controls button:nth-child(3)');
  const h2 = await page.evaluate(() => ({ fr: document.querySelector('.talk-hint-fr')?.innerText, disabled: document.querySelector('.talk-controls button:nth-child(3)').disabled }));
  ok('Hint 2: a reply to try (Bonjour first); Hint then disabled', /^Bonjour/.test(h2.fr || '') && h2.disabled, JSON.stringify(h2));
  await page.screenshot({ path: SHOTS + '/s5-talk-scene-390.png' });
  // a miss, a clarification, then follow the hints to the end
  await clearSpeaks();
  await say('Pardon, vous pouvez répéter ?');
  sp = await speaks();
  ok('Clarification: same line, slowly, in the tap', sp.length === 1 && sp[0].rate === 0.7 && sp[0].inClick, JSON.stringify(sp));
  let guard = 0;
  while (guard++ < 20 && await page.evaluate(() => !!(talk && !talk.result))) {
    const h = await page.evaluate(() => CLSCENES.hint(talk.st).fr);
    await say(h);
  }
  const deb = await page.evaluate(() => ({ r: talk.result, tiles: [...document.querySelectorAll('.today-tiles.four .today-tile')].map(t => t.innerText.replace(/\s+/g, ' ')), lines: document.querySelectorAll('.talk-transcript li').length }));
  ok('café v0 completes → debrief tiles Done/Turns/Repeats asked/Hints', deb.r && deb.r.done && deb.tiles.length === 4 && /Done/i.test(deb.tiles[0]) && deb.r.clarify === 1 && deb.r.hints === 1, JSON.stringify(deb));
  ok('debrief: full transcript', deb.lines >= deb.r.turns * 2, deb.lines + ' lines');
  const tiles = await dims('.today-tiles.four .today-tile');
  ok('debrief tiles equal', tiles.length === 4 && equal(tiles), JSON.stringify(tiles));
  const deAct = await dims('.today-actions .today-btn');
  ok('Replay / Scenes equal', deAct.length === 2 && equal(deAct), JSON.stringify(deAct));
  const rev = await page.evaluate(() => talk.result.corrections.map(c => { const k = studyKey({ fr: c.fr, en: c.en }); return { fr: c.fr, item: !!studyItem(k), card: !!(srs.cards[k]) }; }));
  ok('corrections became review items (study item + SRS card)', rev.length >= 1 && rev.every(c => c.item && c.card), JSON.stringify(rev));
  ok('debrief: no sideways scroll', await noSideScroll());
  await page.screenshot({ path: SHOTS + '/s5-talk-debrief-390.png', fullPage: true });

  // Replay → v1 (changed fact)
  await clearSpeaks();
  await page.click('.today-actions .today-btn.primary');
  const v1 = await page.evaluate(() => ({ v: talk.variant, fact: CLSCENES.aiBrief('cafe', talk.variant).fact }));
  ok('Replay → café v1 with its changed fact', v1.v === 1 && !!v1.fact, JSON.stringify(v1));
  guard = 0;
  const v1Lines = [];
  while (guard++ < 20 && await page.evaluate(() => !!(talk && !talk.result))) {
    const h = await page.evaluate(() => CLSCENES.hint(talk.st).fr);
    await say(h);
    v1Lines.push(await page.evaluate(() => talk.npc && talk.npc.fr));
  }
  ok('café v1 plays to the end offline', await page.evaluate(() => !!(talk.result && talk.result.done)), v1Lines.join(' | '));
  ok('offline mode: zero /api requests', apiReqs.length === 0, JSON.stringify(apiReqs));
  ok('offline mode: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  // Scene of the day from Today
  await page.evaluate(() => talkStop());
  await clearSpeaks();
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<button id="t-today" onclick="talkFromToday()">x</button>'); });
  await page.click('#t-today');
  const tod = await page.evaluate(() => ({ view: currentView, id: talk && talk.id, day: talkSceneOfDay().id }));
  sp = await speaks();
  ok('talkFromToday opens the scene of the day in Talk and speaks in the tap', tod.view === 'talk' && tod.id === tod.day && sp.length === 1 && sp[0].inClick, JSON.stringify({ tod, sp }));
  await page.evaluate(() => { document.getElementById('t-today').remove(); talkStop(); });

  // ── AI mode against a mocked /api/converse ─────────────────
  await page.evaluate(tok => { window.cllSync.getUser = () => ({ id: 'test-user' }); window.cllSync.getAccessToken = async () => tok; }, TOKEN);
  await page.click('.talk-mode .today-btn:nth-child(2)');
  ok('AI partner selected when signed in', await page.evaluate(() => talkMode === 'ai'));
  await page.click('.talk-scene:nth-child(1)');
  ok('AI scene opens with the scripted first line (no call)', apiReqs.length === 0 && await page.evaluate(() => talk.mode === 'ai' && talk.turns.length === 1));
  CONVERSE_QUEUE.push({ body: { npc_line_fr: 'Très bien. Un café. Autre chose ?', npc_line_en: 'Very good. A coffee. Anything else?', goal_progress: 'in_progress', correction: { said: 'un cafe', better_fr: 'Un café, s\'il vous plaît.', en: 'A coffee, please.', note_en: 'Accent on café.' }, left: 59, usd: 0.007 } });
  await clearSpeaks();
  await say('Bonjour, un cafe');
  await page.waitForFunction(() => talk && !talk.busy && talk.turns.length === 3, { timeout: 5000 });
  let last = apiReqs[apiReqs.length - 1];
  sp = await speaks();
  ok('AI turn: POST /cunninglinguist/api/converse with the bearer token, scene + turns', last && last.url === '/cunninglinguist/api/converse' && last.auth === 'Bearer ' + TOKEN && last.body.scene === 'cafe' && last.body.mode === 'turn' && last.body.turns.length === 2 && last.body.turns[1].who === 'you', JSON.stringify(last));
  ok('AI turn: partner line spoken, text hidden', sp.some(s => s.text === 'Très bien. Un café. Autre chose ?') && await page.evaluate(() => !!document.querySelector('.talk-hidden')), JSON.stringify(sp));
  CONVERSE_QUEUE.push({ body: { npc_line_fr: 'Ça fait deux euros. Bonne journée !', npc_line_en: 'That is two euros. Have a good day!', goal_progress: 'done', correction: null, left: 58, usd: 0.007 } });
  CONVERSE_QUEUE.push({ body: { summary_en: 'You ordered a coffee and paid.', goal_done: true, corrections: [{ said: 'merci', better_fr: 'Merci, bonne journée.', en: 'Thanks, have a good day.', note_en: '' }], left: 57, usd: 0.01 } });
  await say('Non merci, je paie par carte');
  await page.waitForFunction(() => talk && talk.result, { timeout: 5000 });
  last = apiReqs[apiReqs.length - 1];
  const aiDeb = await page.evaluate(() => ({ r: talk.result, summary: document.querySelector('.talk-summary')?.innerText, corr: [...document.querySelectorAll('.talk-corrections li b')].map(b => b.textContent) }));
  ok('AI: goal done → debrief call → debrief screen', last.body.mode === 'debrief' && last.auth === 'Bearer ' + TOKEN && aiDeb.r.done && aiDeb.summary === 'You ordered a coffee and paid.', JSON.stringify({ last, aiDeb }));
  ok('AI: turn + debrief corrections listed', aiDeb.corr.length === 2 && aiDeb.corr.includes('Un café, s\'il vous plaît.') && aiDeb.corr.includes('Merci, bonne journée.'), JSON.stringify(aiDeb.corr));
  const aiRev = await page.evaluate(() => talk.result.corrections.map(c => { const k = studyKey({ fr: c.fr, en: c.en }); return !!studyItem(k) && !!srs.cards[k]; }));
  ok('AI: corrections became review items', aiRev.length === 2 && aiRev.every(Boolean), JSON.stringify(aiRev));
  await page.screenshot({ path: SHOTS + '/s5-talk-ai-debrief-390.png', fullPage: true });

  // AI error → Continue scripted
  await page.evaluate(() => talkStop());
  await page.click('.talk-scene:nth-child(2)');
  converseFail = 1;
  await say('Bonjour, une baguette');
  await page.waitForFunction(() => talk && talk.error, { timeout: 5000 });
  const cont = await page.evaluate(() => [...document.querySelectorAll('.today-btn')].map(b => b.innerText.trim()).filter(t => /Continue scripted/.test(t)).length);
  ok('AI error → Continue scripted shown', cont === 1);
  const before = apiReqs.length;
  await page.click('.today-actions .today-btn.primary');
  ok('Continue scripted restarts the scene offline', await page.evaluate(() => talk.mode === 'scripted' && talk.id === 'boulangerie' && !talk.error) && apiReqs.length === before);
  ok('AI mode: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
  await page.evaluate(() => talkStop());

  // ── Translator ─────────────────────────────────────────────
  apiReqs.length = 0;
  await page.evaluate(() => { window.cllSync.getUser = () => null; window.cllSync.getAccessToken = async () => null; window.__authOpened = 0; setView('translator'); });
  const signIn = await page.evaluate(() => !!document.querySelector('.translator-auth button'));
  await page.type('#translate-input', 'croissant');
  await page.click('#translate-btn');
  await sleep(200);
  ok('translator signed out: Sign in button, no call', signIn && apiReqs.length === 0 && await page.evaluate(() => window.__authOpened === 1), JSON.stringify(apiReqs));
  await page.evaluate(tok => { window.cllSync.getUser = () => ({ id: 'test-user' }); window.cllSync.getAccessToken = async () => tok; translatorState.needAuth = false; renderTranslatorView(); }, TOKEN);
  const dirBtns = await dims('.translator-dir button');
  ok('direction toggle: two equal buttons ≥44px', dirBtns.length === 2 && equal(dirBtns) && dirBtns[0].h >= 44 && /EN → FR/.test(dirBtns[0].t) && /FR → EN/.test(dirBtns[1].t), JSON.stringify(dirBtns));
  translateReply = rec => rec.body.dir === 'heard'
    ? { body: { word: 'un croissant', meaning: 'a croissant', ipa: '', phonetic: '', gender: 'm', literal: '', example: '', exampleEn: '', dir: 'heard', left: 98 } }
    : { body: { word: 'un croissant', meaning: 'croissant', ipa: '/kʁwa.sɑ̃/', phonetic: 'krwah-SAHN', gender: 'm', literal: '', example: '', exampleEn: '', dir: 'to', left: 99 } };
  await page.click('#translate-input', { clickCount: 3 });
  await page.type('#translate-input', 'croissant');
  await page.click('#translate-btn');
  await page.waitForFunction(() => !translatorState.loading && translatorState.lastResult, { timeout: 5000 });
  let tr = apiReqs[apiReqs.length - 1];
  ok('translate EN→FR: bearer token, dir "to"', tr && tr.auth === 'Bearer ' + TOKEN && tr.body.dir === 'to' && tr.body.text === 'croissant', JSON.stringify(tr));
  await page.click('.translator-dir button:nth-child(2)');
  await page.type('#translate-input', 'un croissant');
  await page.click('#translate-btn');
  await page.waitForFunction(() => !translatorState.loading && translatorState.lastResult && translatorState.lastResult.dir === 'heard', { timeout: 5000 });
  tr = apiReqs[apiReqs.length - 1];
  const heard = await page.evaluate(() => ({ big: document.querySelector('.french-word')?.innerText, small: document.querySelector('.heard-word')?.innerText }));
  ok('FR→EN toggle sends dir "heard"; meaning large, French below', tr.body.dir === 'heard' && heard.big === 'a croissant' && heard.small === 'un croissant', JSON.stringify({ tr, heard }));
  const cover = await page.evaluate(() => { const q = document.getElementById('save-card-btn').getBoundingClientRect(); const el = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return el && el.id !== 'save-card-btn' ? el.className || el.tagName : ''; });
  await page.evaluate(() => document.getElementById('save-card-btn').click()); // fixed bottom bar can cover it at this scroll position: 
  await sleep(100);
  if (cover) console.log('note: save button covered by', cover);
  const saved = await page.evaluate(() => { const v = state.savedVocab.find(x => x.word === 'un croissant'); const k = v && studyKey(v); return v && { en: v.en, card: !!srs.cards[k] }; });
  ok('saving a heard result: {word: French, en: meaning} and into review now', saved && saved.en === 'a croissant' && saved.card, JSON.stringify(saved) + ' ' + JSON.stringify(await page.evaluate(() => ({ btn: !!document.getElementById('save-card-btn'), sv: state.savedVocab.slice(0, 3).map(v => v.word + '|' + v.en + '|' + v.source) }))));
  const n = apiReqs.length;
  await page.evaluate(() => setTranslatorDir('to'));
  await page.click('.recent-item:nth-child(3)'); // h4 is child 1; recent[1] = the EN→FR "croissant"
  await sleep(200);
  const recentShown = await page.evaluate(() => ({ dir: translatorState.dir, word: translatorState.lastResult?.word, ipa: translatorState.lastResult?.ipa, input: document.getElementById('translate-input').value }));
  ok('tapping a recent translation shows it with no request', apiReqs.length === n && recentShown.word === 'un croissant' && recentShown.ipa === '/kʁwa.sɑ̃/' && recentShown.input === 'croissant' && recentShown.dir === 'to', JSON.stringify(recentShown));
  translateReply = () => ({ status: 500, body: { error: '<b id="inj">bold</b><img src=x onerror="window.__xss=1">' } });
  await page.click('#translate-input', { clickCount: 3 });
  await page.type('#translate-input', 'pain');
  await page.click('#translate-btn');
  await page.waitForFunction(() => !translatorState.loading && translatorState.error, { timeout: 5000 });
  const esc = await page.evaluate(() => ({ html: document.querySelector('.translator-error').innerHTML, el: !!document.getElementById('inj'), xss: !!window.__xss }));
  ok('error text is escaped', !esc.el && !esc.xss && esc.html.includes('&lt;b id="inj"&gt;'), JSON.stringify(esc));
  ok('translator: no sideways scroll', await noSideScroll());
  await page.screenshot({ path: SHOTS + '/s5-translator-390.png' });
  ok('translator: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  // ── 1280: Talk tab in the top nav ──────────────────────────
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => setView('today'));
  const topTalk = await page.evaluate(() => { const b = document.querySelector('nav button[data-view="talk"]'); return b && b.offsetParent ? b.innerText : null; });
  await page.click('nav button[data-view="talk"]');
  const deskCards = await dims('.talk-scene');
  ok('1280: Talk tab opens the scene list, cards equal', topTalk === 'Talk' && deskCards.length === 8 && equal(deskCards), JSON.stringify({ topTalk, deskCards: deskCards.slice(0, 2) }));
  await page.screenshot({ path: SHOTS + '/s5-talk-1280.png' });

  // ── en-pt: no Talk ─────────────────────────────────────────
  errors.length = 0;
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluate(() => localStorage.setItem('cll_lang', 'en-pt'));
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => typeof renderLessonView === 'function' && typeof COURSE !== 'undefined', { timeout: 15000 });
  const pt = await page.evaluate(() => { setView('talk'); return { view: currentView, top: document.querySelector('nav button[data-view="talk"]').style.display, sheet: document.querySelector('.more-sheet button[data-view="talk"]').style.display }; });
  ok('en-pt: Talk hidden and unreachable', pt.view !== 'talk' && pt.top === 'none' && pt.sheet === 'none', JSON.stringify(pt));
  ok('en-pt: no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));

  await browser.close();
  results.forEach(x => console.log(x.join('  ')));
  console.log(results.filter(x => x[0] === 'FAIL').length ? 'SOME FAILED' : 'ALL OK');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

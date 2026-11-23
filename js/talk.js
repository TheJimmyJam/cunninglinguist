// TALK: role-play scenes (Paris v2 stage 5). More → Talk, and the scene of
// the day from Today's summary. en-fr only, like Listen.
// Scripted mode runs offline on js/scenes-fr.js (CLSCENES). AI partner mode
// posts the conversation to /api/converse (signed-in users only) and falls
// back to scripted on any error. Corrections from either mode become review
// cards (addReviewCard).
// Loaded before app.js: nothing here touches app.js bindings at load time.
// ============================================================
const TALK_PAIRS = ['en-fr'];
const TALK_AI_MAX_TURNS = 12;
const TALK_CLARIFY = /\b(pardon|repet\w*|pas compris|lentement|comment)\b/;
let talkMode = 'scripted';
let talk = null; // the scene being played, then its debrief

function talkSupported() {
  return TALK_PAIRS.includes(currentLang) && typeof CLSCENES !== 'undefined';
}
function talkFold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function talkLastVariants() {
  try { return JSON.parse(localStorage.getItem('cll_talk_last') || '{}') || {}; } catch (e) { return {}; }
}
function talkRemember(id, v) {
  const last = talkLastVariants();
  last[id] = v;
  try { localStorage.setItem('cll_talk_last', JSON.stringify(last)); } catch (e) {}
}
// Today's scene: one per day, in order.
function talkSceneOfDay() {
  const list = CLSCENES.list();
  const day = Math.floor(Date.now() / 86400000);
  return list[day % list.length];
}

// A correction becomes a review item: an item he already studies gets its
// production card graded as a miss; anything else is saved and enters review now.
function addReviewCard(fr, en) {
  fr = String(fr || '').trim(); en = String(en || '').trim();
  if (!fr) return false;
  const key = studyKey({ fr, en });
  const now = Date.now();
  if (studyItem(key)) {
    CLSRS.grade(srs, key, 'prod', false, now);
    saveSrs();
    return true;
  }
  if (state.savedVocab.some(v => (v.word || v.fr) === fr)) return false;
  const card = { word: fr, fr, en, source: 'roleplay', savedAt: now };
  state.savedVocab.unshift(card);
  saveState();
  CLSRS.introduce(srs, key, now);
  saveSrs();
  if (typeof refreshStats === 'function') refreshStats();
  window.cllSync?.pushTranslation?.(currentLang, card);
  return true;
}

function talkPickMode(m) {
  if (m === 'ai' && !window.cllSync?.getUser?.()) {
    window.cllSync?.showAuthModal?.();
    return;
  }
  talkMode = m === 'ai' ? 'ai' : 'scripted';
  renderTalkView();
}

// Start a scene inside the tap (the first line plays right away).
function talkStart(id, variant, mode) {
  if (!talkSupported() || !CLSCENES.get(id)) return;
  if (mode) talkMode = mode;
  if (talkMode === 'ai' && !window.cllSync?.getUser?.()) talkMode = 'scripted';
  let v = variant;
  if (v == null) {
    const last = talkLastVariants();
    v = last[id] == null ? 0 : CLSCENES.nextVariant(id, last[id]);
  }
  const st = CLSCENES.start(id, v);
  talkRemember(id, st.variant);
  const first = st.turns[0];
  talk = {
    id, variant: st.variant, mode: talkMode, st,
    npc: { fr: first.fr, en: first.en },
    turns: [{ who: 'npc', fr: first.fr, en: first.en }],
    reveal: 0, hint: null, typed: '', busy: false, error: null,
    repeats: 0, hintsAi: 0, aiCorrections: [], result: null
  };
  if (talkMode === 'ai') primeSpeech();
  renderTalkView();
  speakWord(first.fr, 'fr');
}
function talkFromToday() {
  const sc = talkSceneOfDay();
  setView('talk');
  talkStart(sc.id);
}

function talkRepeat() { if (talk?.npc) { talk.repeats++; speakWord(talk.npc.fr, 'fr'); } }
function talkSlower() { if (talk?.npc) { talk.repeats++; speakWord(talk.npc.fr, 'fr', { slow: true }); } }
// 1st tap: the line in French + English. 2nd tap: a reply to try.
function talkHint() {
  if (!talk || talk.result) return;
  if (talk.reveal === 0) { talk.reveal = 1; renderTalkView(); return; }
  if (talk.reveal === 1) {
    let h = null;
    if (talk.mode === 'scripted') h = CLSCENES.useHint(talk.st);
    else if (!talk.turns.some(t => t.who === 'you')) h = CLSCENES.useHint(talk.st);
    else {
      const c = talk.aiCorrections[talk.aiCorrections.length - 1];
      if (c) h = { fr: c.better_fr, en: c.en };
    }
    if (talk.mode === 'ai' && h) talk.hintsAi++;
    talk.reveal = 2;
    talk.hint = h;
    renderTalkView();
  }
}
function talkStop() { talk = null; renderTalkView(); }
function talkReplay() {
  if (!talk) return;
  talkStart(talk.id, CLSCENES.nextVariant(talk.id, talk.variant), talk.mode);
}

function talkSay() {
  if (!talk || talk.busy || talk.result) return;
  const inp = document.getElementById('talk-input');
  const said = String(inp ? inp.value : talk.typed || '').trim().slice(0, 200);
  if (!said) return;
  talk.typed = '';
  if (talk.mode === 'ai') { talkSayAi(said); return; }
  const r = CLSCENES.respond(talk.st, said);
  if (!r) return;
  talk.turns.push({ who: 'you', fr: said });
  if (r.done) { talkFinishScripted(); return; }
  talk.npc = r.npc;
  talk.turns.push({ who: 'npc', fr: r.npc.fr, en: r.npc.en });
  talk.reveal = r.showHint ? 1 : 0;
  talk.hint = r.showHint ? CLSCENES.hint(talk.st) : null;
  renderTalkView();
  speakWord(r.npc.fr, 'fr', { slow: !!r.slow });
}

function talkFinishScripted() {
  const d = CLSCENES.debrief(talk.st);
  const corrections = d.corrections.map(c => ({ fr: c.fr, en: c.en, said: c.said || '' }));
  corrections.forEach(c => addReviewCard(c.fr, c.en));
  talk.result = {
    done: d.done, turns: d.turns, clarify: d.clarify, hints: d.hints,
    corrections, notes: d.notes, summary: ''
  };
  renderTalkView();
}

async function talkPost(body) {
  const token = await window.cllSync?.getAccessToken?.();
  if (!token) { const e = new Error('auth'); e.status = 401; throw e; }
  const r = await fetch('/cunninglinguist/api/converse', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  if (!r.ok) { const e = new Error('http'); e.status = r.status; throw e; }
  return r.json();
}

async function talkSayAi(said) {
  primeSpeech(); // inside the tap, before the await
  const t = talk;
  t.turns.push({ who: 'you', fr: said });
  t.busy = true; t.error = null; t.reveal = 0; t.hint = null;
  renderTalkView();
  try {
    const data = await talkPost({ scene: t.id, variant: t.variant, mode: 'turn', turns: t.turns.map(x => ({ who: x.who, fr: x.fr })) });
    if (talk !== t) return;
    if (data.correction && data.correction.better_fr) t.aiCorrections.push(data.correction);
    const fr = String(data.npc_line_fr || '');
    t.npc = { fr, en: String(data.npc_line_en || '') };
    t.turns.push({ who: 'npc', fr: t.npc.fr, en: t.npc.en });
    const youTurns = t.turns.filter(x => x.who === 'you').length;
    if (data.goal_progress === 'done' || youTurns >= TALK_AI_MAX_TURNS) {
      speakWord(fr, 'fr');
      await talkDebriefAi(t);
      return;
    }
    t.busy = false;
    renderTalkView();
    speakWord(fr, 'fr');
  } catch (e) {
    if (talk !== t) return;
    t.busy = false;
    t.error = e && e.status === 429 ? 'cap' : e && e.status === 401 ? 'auth' : 'down';
    showToast(t.error === 'cap' ? 'AI partner: daily limit reached' : t.error === 'auth' ? 'Sign in for the AI partner' : 'AI partner unavailable');
    renderTalkView();
  }
}

async function talkDebriefAi(t) {
  t.busy = true;
  renderTalkView();
  let d = null;
  try {
    d = await talkPost({ scene: t.id, variant: t.variant, mode: 'debrief', turns: t.turns.map(x => ({ who: x.who, fr: x.fr })) });
  } catch (e) { d = null; }
  if (talk !== t) return;
  const all = t.aiCorrections.concat(d && Array.isArray(d.corrections) ? d.corrections : []);
  const seen = new Set();
  const corrections = [];
  all.forEach(c => {
    if (!c || !c.better_fr) return;
    const k = talkFold(c.better_fr);
    if (seen.has(k)) return;
    seen.add(k);
    corrections.push({ fr: c.better_fr, en: c.en || '', said: c.said || '', note: c.note_en || '' });
  });
  corrections.forEach(c => addReviewCard(c.fr, c.en));
  const you = t.turns.filter(x => x.who === 'you');
  t.busy = false;
  t.result = {
    done: d ? !!d.goal_done : t.turns.length > 2,
    turns: you.length,
    clarify: you.filter(x => TALK_CLARIFY.test(talkFold(x.fr))).length,
    hints: t.hintsAi,
    corrections, notes: [], summary: d ? String(d.summary_en || '') : ''
  };
  renderTalkView();
}

function talkContinueScripted() {
  if (!talk) return;
  talkStart(talk.id, talk.variant, 'scripted');
}

// ── Rendering ────────────────────────────────────────────────
function renderTalkView() {
  if (!talkSupported()) { setView(defaultView()); return; }
  if (!talk) { content.innerHTML = talkListHtml(); return; }
  if (talk.result) { content.innerHTML = talkDebriefHtml(); return; }
  const t = talk;
  const sc = CLSCENES.get(t.id);
  const ai = t.mode === 'ai';
  const lastYou = [...t.turns].reverse().find(x => x.who === 'you');
  content.innerHTML = `
    <div class="today talk">
      <div class="today-bar">
        <button class="today-x" onclick="talkStop()" aria-label="Stop">×</button>
        <div class="today-pill talk-pill">${escapeHtml(sc.icon)} ${escapeHtml(sc.title)}${ai ? ' · AI' : ''}</div>
      </div>
      <div class="today-card talk-npc">
        ${t.reveal ? `<div class="today-fr talk-fr">${escapeHtml(t.npc.fr)}</div><div class="today-en">${escapeHtml(t.npc.en)}</div>`
                   : `<div class="talk-hidden" aria-label="Hidden">• • •</div>`}
      </div>
      <div class="listen-controls talk-controls">
        <button class="today-btn listen-ctl" onclick="talkRepeat()" ${t.busy ? 'disabled' : ''}>Repeat</button>
        <button class="today-btn listen-ctl" onclick="talkSlower()" ${t.busy ? 'disabled' : ''}>Slower</button>
        <button class="today-btn listen-ctl" onclick="talkHint()" ${t.busy || t.reveal >= 2 ? 'disabled' : ''}>Hint</button>
      </div>
      ${t.hint ? `<div class="talk-hint"><div class="talk-hint-fr">${escapeHtml(t.hint.fr)}</div><div class="talk-hint-en">${escapeHtml(t.hint.en)}</div></div>` : ''}
      ${lastYou ? `<div class="talk-you">${escapeHtml(lastYou.fr)}</div>` : ''}
      ${t.error ? `
        <div class="today-actions one"><button class="today-btn primary" onclick="talkContinueScripted()">Continue scripted</button></div>` : `
        <div class="talk-say">
          <input id="talk-input" class="today-input" type="text" lang="fr" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false"
            value="${escapeHtml(t.typed || '')}" ${t.busy ? 'disabled' : ''}
            oninput="talk.typed=this.value"
            onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();talkSay();}">
          <button class="today-btn primary talk-say-btn" onclick="talkSay()" ${t.busy ? 'disabled' : ''}>${t.busy ? '…' : 'Say'}</button>
        </div>`}
    </div>`;
  const inp = document.getElementById('talk-input');
  if (inp && !t.busy) inp.focus({ preventScroll: true });
}

function talkListHtml() {
  const scenes = CLSCENES.list();
  return `
    <div class="today talk">
      <div class="today-head"><h2>Talk</h2></div>
      <div class="talk-mode">
        <button class="today-btn ${talkMode === 'scripted' ? 'primary' : ''}" onclick="talkPickMode('scripted')">Scripted</button>
        <button class="today-btn ${talkMode === 'ai' ? 'primary' : ''}" onclick="talkPickMode('ai')">AI partner</button>
      </div>
      <div class="talk-scenes">
        ${scenes.map(s => `
          <button class="talk-scene" onclick="talkStart('${s.id}')">
            <span class="talk-scene-icon">${escapeHtml(s.icon)}</span>
            <span class="talk-scene-title">${escapeHtml(s.title)}</span>
            <span class="talk-scene-goal">${escapeHtml(s.goal || '')}</span>
          </button>`).join('')}
      </div>
    </div>`;
}

function talkDebriefHtml() {
  const t = talk, r = t.result;
  const sc = CLSCENES.get(t.id);
  return `
    <div class="today talk today-done">
      <div class="today-head"><h2>${escapeHtml(sc.icon)} ${escapeHtml(sc.title)}</h2><div class="today-paris">${t.mode === 'ai' ? 'AI' : ''}</div></div>
      <div class="today-tiles four">
        ${todayTile(r.done ? '✓' : '–', 'Done')}
        ${todayTile(r.turns, 'Turns')}
        ${todayTile(r.clarify, 'Repeats asked')}
        ${todayTile(r.hints, 'Hints')}
      </div>
      ${r.summary ? `<p class="talk-summary">${escapeHtml(r.summary)}</p>` : ''}
      ${r.notes.length ? `<ul class="talk-notes">${r.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      ${r.corrections.length ? `
        <h3 class="talk-h">Corrections</h3>
        <ul class="talk-corrections">${r.corrections.map(c => `
          <li><b>${escapeHtml(c.fr)}</b><div class="talk-corr-en">${escapeHtml(c.en)}</div>${c.said ? `<div class="talk-said">${escapeHtml(c.said)}</div>` : ''}${c.note ? `<div class="talk-said">${escapeHtml(c.note)}</div>` : ''}</li>`).join('')}
        </ul>` : ''}
      <h3 class="talk-h">Transcript</h3>
      <ol class="talk-transcript">${t.turns.map(x => `
        <li class="${x.who}"><div class="talk-line-fr">${escapeHtml(x.fr)}</div>${x.en ? `<div class="talk-line-en">${escapeHtml(x.en)}</div>` : ''}</li>`).join('')}
      </ol>
      <div class="today-actions">
        <button class="today-btn primary" onclick="talkReplay()">Replay</button>
        <button class="today-btn" onclick="talkStop()">Scenes</button>
      </div>
    </div>`;
}

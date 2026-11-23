// Spaced repetition (SM-2 lite), answer grading and the honest streak.
// Pure functions: no DOM, no storage, the clock is passed in. app.js owns
// persistence; tests/srs-sim.mjs drives this file with a fake clock.
(function (root) {
  'use strict';

  var DAY = 86400000;
  var PARIS_DATE = '2026-12-20'; // trip start; "N days to Paris"

  // ── Dates (local calendar days) ──────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  // Whole calendar days from key a to key b (DST-proof).
  function dayDiff(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / DAY);
  }
  function startOfDay(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(ts, n) { var d = new Date(startOfDay(ts)); d.setDate(d.getDate() + n); return d.getTime(); }
  function daysUntil(key, now) { return dayDiff(dayKey(now), key); }

  // ── Scheduler ────────────────────────────────────────────────
  // One card per item per direction: 'rec' (see French → know it) and
  // 'prod' (see English → produce French).
  var RELEARN_MS = 10 * 60 * 1000;
  function newCard(now) { return { due: now, ivl: 0, ease: 2.5, reps: 0, lapses: 0, last: null }; }

  function review(card, ok, now) {
    var c = Object.assign(newCard(now), card || {});
    var early = card && card.reps > 0 && card.due > now; // practising before it's due
    c.last = now;
    if (!ok) {
      c.lapses++;
      c.reps = 0;
      c.ivl = 0;
      c.ease = Math.max(1.3, Math.round((c.ease - 0.2) * 100) / 100);
      c.due = now + RELEARN_MS;
      return c;
    }
    if (early) return c; // cramming doesn't stretch the interval
    c.reps++;
    if (c.reps === 1) c.ivl = 1;
    else if (c.reps === 2) c.ivl = 3;
    else c.ivl = Math.max(c.ivl + 1, Math.round(c.ivl * c.ease));
    c.due = addDays(now, c.ivl);
    return c;
  }

  function emptyStore() { return { v: 1, cards: {} }; }
  function getCard(store, key, dir) { var e = store.cards[key]; return e ? e[dir] || null : null; }
  function setCard(store, key, dir, card) { (store.cards[key] = store.cards[key] || {})[dir] = card; }
  function grade(store, key, dir, ok, now) {
    var c = review(getCard(store, key, dir), ok, now);
    setCard(store, key, dir, c);
    return c;
  }
  function introduce(store, key, now) {
    if (!getCard(store, key, 'rec')) setCard(store, key, 'rec', newCard(now));
    if (!getCard(store, key, 'prod')) setCard(store, key, 'prod', newCard(now));
  }
  function isNew(store, key) { return !store.cards[key]; }

  // Due cards, oldest first. `allowed` (optional Set) limits to current items.
  function dueCards(store, now, allowed) {
    var out = [];
    Object.keys(store.cards).forEach(function (key) {
      if (allowed && !allowed.has(key)) return;
      ['rec', 'prod'].forEach(function (dir) {
        var c = store.cards[key][dir];
        if (c && c.due <= now) out.push({ key: key, dir: dir, due: c.due });
      });
    });
    return out.sort(function (a, b) { return a.due - b.due; });
  }
  function countDueBefore(store, ts, allowed) { return dueCards(store, ts - 1, allowed).length; }

  // Old flip-card "learned" bucket → seen once, due tomorrow (recognition only).
  function migrateLearned(store, keys, now) {
    var n = 0;
    (keys || []).forEach(function (key) {
      if (!key || getCard(store, key, 'rec')) return;
      setCard(store, key, 'rec', { due: addDays(now, 1), ivl: 1, ease: 2.5, reps: 1, lapses: 0, last: now });
      n++;
    });
    store.migrated = true;
    return n;
  }

  // Mastered = recognised on two separate days in a row (interval reached 3+).
  function isMastered(store, key) {
    var c = getCard(store, key, 'rec');
    return !!(c && c.ivl >= 3);
  }

  // ── Grading ──────────────────────────────────────────────────
  function unifyApostrophes(s) { return s.replace(/[’‘ʼ`´]/g, "'"); }
  var EN_CONTRACTIONS = [
    [/\bi'm\b/g, 'i am'], [/\byou're\b/g, 'you are'], [/\bhe's\b/g, 'he is'],
    [/\bshe's\b/g, 'she is'], [/\bit's\b/g, 'it is'], [/\bwe're\b/g, 'we are'],
    [/\bthey're\b/g, 'they are'], [/\bthat's\b/g, 'that is'], [/\bwhat's\b/g, 'what is'],
    [/\bwhere's\b/g, 'where is'], [/\blet's\b/g, 'let us'], [/\bi'd\b/g, 'i would'],
    [/\bi'll\b/g, 'i will'], [/\bi've\b/g, 'i have'], [/\bdon't\b/g, 'do not'],
    [/\bdoesn't\b/g, 'does not'], [/\bdidn't\b/g, 'did not'], [/\bcan't\b/g, 'cannot'],
    [/\bwon't\b/g, 'will not'], [/\bisn't\b/g, 'is not'], [/\baren't\b/g, 'are not'],
    [/\bwouldn't\b/g, 'would not'], [/\bcouldn't\b/g, 'could not']
  ];
  function stripAccents(s) {
    return s.replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  // Order matters: case → apostrophes → contractions → (accents) → drop
  // punctuation and spaces. "l'entrée", "l’entrée" and "l entrée" all meet.
  function answerKey(s, lang, keepAccents) {
    var r = unifyApostrophes(String(s || '').toLowerCase()).replace(/ /g, ' ');
    if (lang === 'en') EN_CONTRACTIONS.forEach(function (p) { r = r.replace(p[0], p[1]); });
    if (!keepAccents) r = stripAccents(r);
    else r = r.replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFC');
    return r.replace(/[^\p{L}\p{N}]+/gu, '');
  }

  // "désolé(e)" → désolé, désolée. "70 (lit. sixty-ten)" → 70, 70 lit. sixty-ten.
  function expandParens(s) {
    var m = s.match(/\(([^()]*)\)/);
    if (!m) return [s.replace(/\s+/g, ' ').trim()];
    var without = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    var attached = m.index > 0 && /\S/.test(s[m.index - 1]);
    var withIt = s.slice(0, m.index) + (attached ? '' : ' ') + m[1] + ' ' + s.slice(m.index + m[0].length);
    if (attached) without = s.slice(0, m.index) + s.slice(m.index + m[0].length);
    return expandParens(without).concat(expandParens(withIt));
  }
  // "Hello / Good morning" → two answers; "a visit/tour" → a visit, a tour.
  function expandSlashes(s) {
    var m = s.match(/(\S+)\/(\S+)/);
    if (!m) return [s];
    var head = s.slice(0, m.index), tail = s.slice(m.index + m[0].length);
    return expandSlashes(head + m[1] + tail).concat(expandSlashes(head + m[2] + tail));
  }
  function answerVariants(display, alts) {
    var out = [];
    [display].concat(alts || []).forEach(function (a) {
      String(a || '').split(/\s+\/\s+|\s*\|\s*|\s*;\s*/).forEach(function (part) {
        expandParens(part).forEach(function (p) {
          expandSlashes(p).forEach(function (v) {
            v = v.replace(/^[.…\s]+/, '').replace(/\s+/g, ' ').trim();
            if (v && out.indexOf(v) === -1) out.push(v);
          });
        });
      });
    });
    return out;
  }
  // Display text with the notes kept but no alternatives: what to show as "the answer".
  function displayAnswer(display) { return String(display || '').split(/\s+\/\s+|\s*\|\s*/)[0].trim(); }

  // → { ok, nudge (right but accents off), expected }
  function gradeAnswer(typed, display, opts) {
    opts = opts || {};
    var lang = opts.lang || 'fr';
    var variants = answerVariants(display, opts.alts);
    var res = { ok: false, nudge: false, expected: displayAnswer(display) };
    if (!String(typed || '').trim() || !variants.length) return res;
    var exact = answerKey(typed, lang, true);
    for (var i = 0; i < variants.length; i++) {
      if (answerKey(variants[i], lang, true) === exact) { res.ok = true; return res; }
    }
    var loose = answerKey(typed, lang, false);
    for (var j = 0; j < variants.length; j++) {
      if (answerKey(variants[j], lang, false) === loose) {
        res.ok = true; res.nudge = true; res.expected = variants[j]; return res;
      }
    }
    return res;
  }

  // Options for a multiple-choice question: no two that read the same.
  function uniqueOptions(correct, candidates, n) {
    var seen = {}, out = [correct];
    seen[answerKey(correct, 'en', false)] = 1;
    for (var i = 0; i < candidates.length && out.length < n; i++) {
      var k = answerKey(candidates[i], 'en', false);
      if (!k || seen[k]) continue;
      seen[k] = 1;
      out.push(candidates[i]);
    }
    return out;
  }

  // ── Honest streak ────────────────────────────────────────────
  // A day counts only when a session is finished. One missed day can be
  // covered by grace (2 a month); a longer gap starts over.
  var GRACE_PER_MONTH = 2;
  function streakDefaults(st) {
    return Object.assign({ streak: 0, lastSessionDay: null, graceUsed: 0, graceMonth: null }, st || {});
  }
  function finishSessionDay(st, now) {
    var s = streakDefaults(st);
    var today = dayKey(now), month = today.slice(0, 7);
    if (s.graceMonth !== month) { s.graceUsed = 0; s.graceMonth = month; }
    if (s.lastSessionDay && dayDiff(s.lastSessionDay, today) <= 0) return { state: s, counted: false, graced: false };
    var gap = s.lastSessionDay ? dayDiff(s.lastSessionDay, today) : null;
    var graced = false;
    if (gap === 1) s.streak++;
    else if (gap === 2 && s.streak > 0 && s.graceUsed < GRACE_PER_MONTH) { s.graceUsed++; s.streak++; graced = true; }
    else s.streak = 1;
    s.lastSessionDay = today;
    return { state: s, counted: true, graced: graced };
  }
  // What the header shows right now (0 once the chain is broken).
  function liveStreak(st, now) {
    var s = streakDefaults(st);
    if (!s.lastSessionDay) return 0;
    var today = dayKey(now);
    var gap = dayDiff(s.lastSessionDay, today);
    if (gap <= 1) return s.streak;
    var used = s.graceMonth === today.slice(0, 7) ? s.graceUsed : 0;
    if (gap === 2 && used < GRACE_PER_MONTH) return s.streak;
    return 0;
  }

  var API = {
    DAY: DAY, PARIS_DATE: PARIS_DATE, RELEARN_MS: RELEARN_MS,
    dayKey: dayKey, dayDiff: dayDiff, startOfDay: startOfDay, addDays: addDays, daysUntil: daysUntil,
    newCard: newCard, review: review, emptyStore: emptyStore, getCard: getCard, setCard: setCard,
    grade: grade, introduce: introduce, isNew: isNew, dueCards: dueCards, countDueBefore: countDueBefore,
    migrateLearned: migrateLearned, isMastered: isMastered,
    answerKey: answerKey, answerVariants: answerVariants, displayAnswer: displayAnswer,
    gradeAnswer: gradeAnswer, uniqueOptions: uniqueOptions,
    finishSessionDay: finishSessionDay, liveStreak: liveStreak
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CLSRS = API;
})(typeof window !== 'undefined' ? window : globalThis);

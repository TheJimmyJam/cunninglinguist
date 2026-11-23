# Paris v2

Scope: `SCOPE-paris-v2.md`. Branch per stage; the lead pushes, opens and merges the PR.

## Stage 1 — Fast French + audio path fix (builder handoff, 2026-11-23)

Branch `paris-v2-stage1` (from `origin/paris-v2-scope`). Committed locally, NOT pushed.

### What changed
- **learn.html**: the 289 `<script src="js/course-*.js">` tags plus `app.js` and `supabase-sync.js` are replaced by one inline loader. It reads `cll_lang` (set by index.html `goToPair`/`startLearning`, which then loads learn.html), applies the same rules as `PAIRS` / `migrateLangKey()` / `getCourseData()` in app.js, and inserts `course-<file>.js` → `app.js` → `supabase-sync.js` as `async=false` scripts (parallel fetch, ordered run).
  - `PAIR_FILES` = the 274 pairs whose file defines `var COURSE_<PAIR>`. Otherwise it loads the target's base file (`course-en-<t>.js` for fr/es/sq/it/pt/el/ja/de/ko, else `course-en-fr.js`, which is what getCourseData already falls back to). The 6 `const COURSE_DATA` files (el-sw, it-sw, pt-sw, sw-it, sw-pt, sw-sq) are never read by app.js, so those pairs get the fallback as before.
  - supabase-sync.js moved after app.js so its auth init still sees `currentLang`/`getStorageKey` (it used to init on DOMContentLoaded, which came after app.js).
  - If a new course file is added, add its pair to `PAIR_FILES` (and to `PAIRS` in app.js if it's a new en pair).
- **Logo**: header img → `assets/banner-192.jpg` (29 KB, was banner.png 1.6 MB). Original kept.
- **Lesson banners**: `updateLessonBanner()` no longer tries a 404 `.jpg` then a 2.7 MB `.png`. `BANNER_DAYS = { fr: 30, es: 10 }` lists the art that exists; other pairs/days hide with no request. Serves `assets/banners/{fr,es}/day-NN-1000.jpg` (1000px, q65, ~115 KB each; 40 files). Originals kept.
- **Speech** (app.js, "Speech" block above LEATHER NOTEBOOK): `speakWord()` is synchronous now. No `tts` fetch (that function never existed). Web Speech runs inside the tap; `pickVoice()` picks the best voice for the target's BCP-47 tag (exact region first, Premium > Enhanced/Natural > others, Eloquence/novelty penalised), cached and reset on `voiceschanged`. `primeSpeech()` speaks a silent utterance synchronously at the top of `doTranslate()` so the auto-play after the translate await is allowed on iOS. Stage 4 hook: `getStaticAudioUrl(text, lang)` returns null; when it returns a URL, speakWord plays it and handles the `play()` promise (falls back to Web Speech on rejection). A timeout clears the `.speaking` state if `onend` never fires.
- **Skip for now**: `closeProfileModal()` sets `cll_profile_skipped=1`; `initProfile` won't auto-open the modal when set. Profile button still opens it.

### Measured (headless Chrome, muted, 390×844 @3x, cache off)
DevTools "Fast 4G" profile (9 Mbps down, 1.5 Mbps up, 165 ms RTT), local static server (no gzip):
- New: DOMContentLoaded 0.60 s, lesson usable (speak buttons rendered) **1.07 s**, network idle 1.94 s, 0.86 MB, 16 requests, **1 course file** (course-en-fr.js). With 4× CPU throttle too: usable 0.95 s.
- Live site (old code, same profile, real network, gzip): DOMContentLoaded 5.5 s, usable **5.55 s**, idle 6.6 s, 5.69 MB transferred, 302 requests.
- French: COURSE 30 days, 8 convos; images requested: banner-192.jpg + fr/day-01-1000.jpg, both 200; no 404s; zero console errors; zero `tts` requests.
- Speaker tap (speechSynthesis stubbed, voices arrive async at 300 ms): `speak("Bonjour")`, lang fr-FR, voice "Audrey (Premium)" chosen over compact Thomas, Eloquence Jacques and fr-CA premium.
- Translator (mocked `/api/translate`): auto-play spoke "la gare" fr-FR with the premium voice.
- Skip for now: modal hidden after click and after reload; flag set.
- Pairs via index.html `goToPair`: en-pt (course-en-pt.js only, works, speaks pt-BR), fr-en, en-nl, it-sw and el-sw (fallback course-en-fr.js, as before), raw `pt` → en-pt, raw `en-pl` → en-fr. Each loaded exactly 1 course file, no errors.

### Not fixed / unverified
- **pt-fr and es-de are broken, before and after** (`day.practice.map is not a function` / reading 'map' of undefined: their course data has a different shape). Live today they also fail (plus `COURSE_DATA already declared` errors from loading all files). Out of scope (other pairs), left as is.
- Not tested on a real iPhone: the iOS gesture rule and voice names (`com.apple.voice.premium.fr-FR.*`) are from the stub, not a device. Jimmy should tap a speaker and Translate once on his phone.
- Under the live gzip/CDN the new page should be faster than the local numbers; not measured on a deploy preview.

### How to run the check
1. Serve with the prefix: `mkdir -p /tmp/cl && ln -sfn "<repo>" /tmp/cl/cunninglinguist && cd /tmp/cl && python3 -m http.server 8761` (mirrors `_redirects`: `/cunninglinguist/*` → repo root).
2. Open `http://127.0.0.1:8761/cunninglinguist/learn.html` at 390px, `--mute-audio`, with `speechSynthesis` stubbed. Builder's script was `check.js` in the builder scratchpad (puppeteer-core from `Archived Projects/SmallHours/node_modules`); a checker should write its own.

### Next step
Lead: independent check, then push `paris-v2-stage1` once (Actions AMBER), PR into main, merge, confirm the deploy at https://apps.cannoncodeconnect.com/cunninglinguist/learn.html shows 1 course file in the network panel.

## Stage 2 — Real review + Today session (builder handoff, 2026-11-23)

Branch `paris-v2-stage2` (from `origin/main`). Committed locally, NOT pushed.

### What changed
- **js/srs.js (new, pure, loaded before app.js by the learn.html loader)**: SM-2 lite (`rec` and `prod` cards per item: due/ivl/ease/reps/lapses; miss → back in 10 min, ease −0.2; pass → 1d, 3d, then ×ease; passing before due doesn't stretch the interval), learnedCards migration (seen once, due tomorrow, recognition only), `isMastered` (rec interval ≥3 = passed on two separate days), grading (`gradeAnswer`: case → curly/straight apostrophes → English contractions → accents → drop punctuation/spaces; parentheses are notes/optional (`désolé(e)`, `70 (lit. sixty-ten)`), ` / `, `|`, `;` and `a/b` are alternatives, accents-optional returns `nudge`), `uniqueOptions` for MC, honest streak (`finishSessionDay`/`liveStreak`: only finished sessions count, one missed day can use grace (2/month), longer gaps reset, header shows 0 once broken), `PARIS_DATE = '2026-12-20'`.
- **SRS storage**: `localStorage['cll_srs_<pair>']`, separate from the synced progress object; supabase-sync untouched. Not synced across devices yet (Later list). Today session resume: `cll_today_<pair>` (today's date only). New progress field `state.lastSessionDay` (sync ignores it; merge keeps local).
- **Today · 10 min (en-fr only, first screen)**: start screen (Due / New / Streak, N days to Paris, Start · 10 min | 3 min, Resume i/n) → due reviews (≤20; rec = show/Missed/Got it, prod = type French) → 4-6 new items (vocab and phrases alternate within a day) → listen drill (Web Speech, pick the meaning) → typed recall English→French with accent nudge → one scene from CONVERSATIONS (rotates per finished session; tap lines for English/French) → summary (reviews, new, heard, typed, new words, scene, tomorrow's count, days to Paris). 3 min = ≤6 reviews + 2 new, no scene. Finishing counts the streak day once.
- **Flashcards**: pool = new or due cards (deduped); Got it/Need work grade the rec card; missed cards go to the end of the run; "All caught up" + Practice anyway. Learned-bucket UI and helpers removed.
- **Bugs**: type-it now asks both directions with correct labels (`quiz_what_does` gets the source label) and grades via `gradeAnswer`; MC options unique ignoring case; matching round draws 4 pairs unique on both sides; quiz Enter handler only on the quiz view, ignores inputs/buttons, removed on leaving; type-it Enter no longer double-advances; translator double submit (input onkeydown removed + loading guard); Mastered = SRS rule everywhere (header, day cards, Progress); completeDay/uncompleteDay no longer set streak from completedDays (pairs without Today count a completed lesson as the day's session); `showToast(msg, duration)` honours duration; `l'entrée` duplicate: day 29 is now "l'entrée du musée" / "the museum entrance".
- **Phone (≤600px)**: top tabs hidden; fixed 4-item bottom bar (Today, Flashcards, Translator, More → sheet with Lessons, Quiz, All Lessons, Conversations, Notebook, Progress); `scroll-padding-bottom` so buttons don't hide under it; quiz mascot hidden. All speak buttons 44px; lesson vocab and flashcard speak buttons are siblings of the flip target, not inside it. Desktop: "Today" tab first, lesson tab reads "Lessons" on en-fr.
- Files: `js/srs.js`, `js/app.js`, `learn.html`, `js/course-en-fr.js` (one line), `tests/srs-sim.mjs`.

### Measured
- `node tests/srs-sim.mjs`: 15 passed (3-day fake clock: missed card due in 10 min and again day 3, passed card 1d → 3d → >3d; ease/lapses; early practice; rec/prod separate; migration due tomorrow and idempotent; mastered; streak: same-day no-op, skipped day no inflation, grace +1 not +2, 2-day gap and 70-day gap reset, grace cap; days to Paris 27 on 2026-11-23; grading: parentheses, curly apostrophes, l'/d', accents nudge, œ, alternatives; MC uniqueness).
- Muted headless Chrome (puppeteer-core, speechSynthesis stubbed, /api/translate mocked, outside requests blocked), 30/30 checks: 390×844 — learnedCards migrated (due tomorrow, not now); Today first; 10-min flow completes (6 intro, 6 listen, 6 recall, 1 scene, summary), streak 1; 2nd session same day keeps streak 1; reload mid-session → Resume at step 3; bottom nav 4 × 91.5×56 px equal, header/main/bar centers 195/195/195; start tiles 3 × 102.7×79.2, start buttons 2 × 159×52, summary tiles 2×2 × 159×79.2, More sheet 6 × 172×52; 18 lesson speak buttons ≥44, none inside a flip card; flashcard speak ≥44 outside; quiz mascot display none; Enter outside quiz no-op; translator Enter = 1 request; 0 console errors. 1280×900 — bottom bar hidden, 9 top tabs with Today first, Today completes, 0 errors. en-pt — lesson renders (10 vocab cards), bottom Today → lesson, flashcards + quiz open, 0 errors.
- Screenshots: scratchpad `today-start-390.png`, `today-summary-390.png`, `today-summary-1280.png`. Check script: scratchpad `e2e.cjs` (server: `python3 -m http.server 8762` in a dir with `cunninglinguist` → repo symlink).

### Not done / unverified
- Not tested on a real iPhone (auto-speak on Next/Start relies on the tap gesture; focus on the typed-recall input after Check).
- SRS state isn't synced to Supabase (own localStorage key by design; schema untouched).
- Notebook "need work" badge sits on the hidden top tab on phones.
- Speaking (dictation) recall not built; typing only. Static audio still stage 4.
- pt-fr / es-de still broken as before (out of scope).

### Next step
Lead: independent check (run `node tests/srs-sim.mjs`; headless 390/1280 Today flow + §22 measurements), then push `paris-v2-stage2` once, PR into main, merge, confirm the deploy shows Today first at https://apps.cannoncodeconnect.com/cunninglinguist/learn.html.

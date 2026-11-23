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

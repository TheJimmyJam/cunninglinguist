# CunningLinguist: Paris v2 (first-week build)

Approved by Jimmy 2026-11-23 ("Yes, build it"). He is in Paris in late December 2026 and will practice English→French daily on his iPhone. Goal: a daily tutor that beats Duolingo for surviving Paris. Full g4 reviews: `reviews/2026-11-23-g4-astra.md` (gpt-6.2-astra); Fable 5.2's findings are merged into the stages below. Both agreed; the main bugs were spot-checked in code.

Live: https://apps.cannoncodeconnect.com/cunninglinguist/ (served through the ccc-apps spine; `_redirects` maps `/cunninglinguist/*`). Repo TheJimmyJam/cunninglinguist (public), `main` auto-deploys. Vanilla JS, no build step. Folder still sits under `Archived Projects/`; leave the path alone.

Out of scope: the other 288 language pairs (keep them working, don't improve them).

## Paid API gate (CLAUDE.md §32): NOT approved yet
- No paid model or TTS call from a builder, checker or script without Jimmy's go in chat, with an estimate and a cap. Build role-play and grading against mocks/recorded responses.
- Ask once, together, when stage 4/5 is ready: (a) one-time neural TTS generation of ~650 items × normal+slow, ~13k chars ×2, est. ≤ $0.50, cap $2; (b) role-play smoke test, ~10 Sonnet 5.5 calls, est. ≤ $0.25, cap $1.
- The shipped app's own calls for him are allowed under a per-user daily cap.

## Stages (each: build → independent check → merge → confirm deploy)

### 1. Fast French + audio path fix (S)
- learn.html:2131-2419 loads 289 course scripts (18.7 MB) before app.js. Load only the active pair's course file (dynamic `<script>` for the selected pair; fr default). Other pairs must still load when picked.
- Banner/logo weight: app.js:2945-2966 tries a 404 .jpg then a 2.7 MB PNG; learn.html:2000 64px logo is a 1.5 MB PNG. Serve small compressed versions.
- app.js:2822 POSTs to a `tts` function that does not exist (404 live). Until real audio lands: call Web Speech synchronously inside the tap (iOS blocks speech after an await), pick the best fr-FR voice, handle the `play()` promise. Same for auto-play after translation (app.js:2766).
- "Skip for now" on the profile modal must stick (learn.html:2054, app.js:3124).
- Check: learn page on a 390px viewport loads French in under ~2 s on a throttled "Fast 4G" profile; network panel shows 1 course file; tapping a speaker speaks French.

### 2. Real review + Today session (M)
- Replace flip-card retirement with spaced repetition (SM-2 lite or FSRS): per-item `due`, `interval`, `ease`, separate recognition vs production. State at app.js:1470-1482; deck at 1968-1994; rating at 2003-2028. Migrate old `learnedCards` as "seen, due tomorrow". Phrases (240) included, not only vocab.
- Production direction: English prompt → he types (or dictates) French. Grading: separate accepted answers from display notes (17 answers contain parentheses, e.g. course-en-fr.js:132 "70 (lit. sixty-ten)"); fix normalizer order (app.js:2248-2259: apostrophes stripped before contraction rules; curly ’ not handled); accept accents-optional with a nudge; accept listed alternatives.
- Type-it prompt bug: always French→English and labels wrong (app.js:2410-2424).
- Duplicates: `l'entrée` keyed twice (course-en-fr.js:268, 791); case-duplicate options in MC (app.js:2404-2406); matching round can draw the same pair twice and become unfinishable (app.js:2382, 2274, 2341).
- Global Enter handler leaks outside the quiz (app.js:2066-2081).
- "Mastered" threshold mismatch (app.js:1684 vs 1 tap retiring).
- Honest streak: a day counts only when a Today session is finished; real gap math; no multi-month grace (app.js:1494-1515, 1825-1854). `showToast` ignores duration (2797).
- **Today · 10 min** as the first screen: due reviews (~3 min) → 4-6 new items → listen drill → speak/typed recall → one scene → summary ("You ordered breakfast and understood €6.50") + tomorrow + "N days to Paris". 3-minute option. Resume mid-session.
- Phone nav: 4-item sticky bottom bar instead of 8 side-scrolling top tabs (learn.html:100-124); speak buttons ≥44px and not inside the flip target (learn.html:1780, app.js:1743-1748); quiz mascot column off at 390px (learn.html:673-692).
- Check: script a 3-day simulation in node (fake clock) proving a missed card returns, a passed card returns at a longer interval, streak doesn't inflate; at 390px neighbors equal (§22).

### 3. Content fixes + Paris-in-December pack (M)
Fixes in js/course-en-fr.js:
- :339 "aux noix" → "Je suis allergique aux fruits à coque" (+ "aux arachides"), safety.
- :333-347 doneness: saignant=rare, à point=medium-rare/medium, bien cuit=well-done; fix the tip at :347.
- :143 "quatre-vingts euros" (+ liaison note).
- :590 "Je voudrais changer des dollars". :146 polite change request. :199, :539 replace unnatural lines. :254 → "C'est quoi, le plat du jour ?". :511 → "Prenez la ligne 4 en correspondance".
- Métro: :495, :507, :890-891 and Conversation-Scenarios.md:101 — paper carnet is gone; teach Navigo Easy / phone ticket and "Quel ticket me faut-il pour aller à Paris ?" (verify current fares on iledefrance-mobilites.fr before writing a price).
- Pronunciation slips: :91 trois "trwah", :105 dix-sept "dee-set", :127 vingt-deux "vant-duh", :284/:341/:325 gluten consistency, :279/:583 leading "...", :782 Bonne soirée = "have a good evening". Rename the `ipa` label in UI to "sounds like".
- Pack (~60 items, phrases first, all with audio later): Où sont les toilettes ?, Je vous en prie, Merci vous aussi, Pardon je descends, C'est tout merci, Je n'ai pas compris, Vous pouvez répéter plus lentement ?, Vous pouvez l'écrire ?, Comment dit-on… ?, boulangerie/market ordering, booking for N at a time, Il y a une erreur dans l'addition, Ma carte ne passe pas, pharmacy cold symptoms, grève/retard, Joyeux Noël, Bonne année, C'est ouvert le 25 ?, vin chaud, Il fait froid, 24-hour times, dates. Staff-side lines for listening: Sur place ou à emporter ?, Carte ou espèces ?, Vous avez choisi ?, Ça sera tout ?, Et avec ceci ?
- Move survival content (transport, problems, repair phrases) into week one of the track.
- Content is written by the builder (session usage, not API); one native-quality pass by a strong model reviewer counts as session usage too.

### 4. Real French audio + listening drill (M) — paid gen needs the go above
- Static MP3s per item (normal + slow) in `audio/fr/`, keyed by a hash of the text; app plays static file, falls back to Web Speech. Generation script ready and dry-run tested; run only after the go.
- Listening drill: hear at native speed → type/pick meaning; prices, times, platform numbers, staff lines; Repeat / Slower / Show text.
- Check: every pack item has a file; playback works muted in headless Chrome (no sound on the Mac).

### 5. Role-play partner v1 (M-L)
- Scenes: café, boulangerie, restaurant, métro counter, pharmacy (then hotel, taxi, lost item). He plays the customer; the other side speaks French (audio), transcript hidden by default; Repeat / Slower / Hint; one changed fact on replay (sold out, other platform, €16.50 vs €6.50). Success = errand done, including asking for clarification.
- Offline/no-AI mode: scripted branches with bundled audio.
- AI mode: new Netlify function `/api/converse` on `claude-sonnet-5-5` (adaptive thinking, effort low), short context (scene goal + last turns), simple French bounded to taught words; end-of-scene debrief whose corrections become review cards. Input: typing or iPhone French dictation.
- Security: translate.js:12 only checks Origin; no rate limit. Every AI endpoint requires the Supabase session (invite-only CCC project) and a per-user daily cap; key stays server-side.
- Translator: translate.js:88 `claude-haiku-4-5-20251001` → `claude-haiku-5-5`; structured output instead of regex (:111); add FR→EN "what did they just say"; saved items enter review. Don't re-call on tapping a recent translation (app.js:2770). Escape error text (app.js:2665).
- Check: mocked conversation tests; real smoke only after the go.

### Later (not this week)
Speaking check (fr-FR recognition, record & compare), PWA manifest + service worker for métro offline, sync repair (supabase-sync.js:38-55 SIGNED_IN deadlock/reload risk, learnedCards not synced, reset doesn't stick :89-124).

## Rules for every builder/checker brief
- Run ~/.claude/jj/bin/jj-sim-mute --all before booting any iOS Simulator and ~/.claude/jj/bin/jj-sim-mute right after; play no sound on this Mac; shut the simulator down when done. (Never boot iPhone 18 Pro DEF7903F.) Prefer headless Chrome at 390px.
- No paid API calls unless the go is quoted in the brief with its cap.
- Feature branch → PR → merge (§16, direct GitHub path §7) → confirm the deploy. Repo has `.github/workflows`: run `jj-gh-spend` before first push (§37).

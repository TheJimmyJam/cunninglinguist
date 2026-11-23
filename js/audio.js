// Static French audio: text → file key, manifest lookup, and the generated
// listening items (prices, times, platforms, lines, dates). Pure functions, no
// DOM. Loaded by learn.html before app.js (global CLAUDIO) and required by
// scripts/gen-fr-audio.mjs and the tests, so the app and the generator always
// hash the same way.
//
// File key = audioHash(text):
//   1. String(text), Unicode NFC
//   2. ’ ‘ ʼ ′ → '   (curly apostrophes to straight)
//   3. no-break / narrow no-break / thin spaces (U+00A0, U+202F, U+2009) → space
//   4. runs of whitespace → one space, then trim
//   Case, accents and punctuation are kept (they change how a line is said).
//   5. cyrb53 (53-bit) of the UTF-16 code units → 14 lowercase hex digits.
// Files: audio/fr/<key>.mp3 (normal) and audio/fr/<key>.slow.mp3 (slow).
// Manifest: audio/fr/manifest.json = { "<key>": "ns" } ("n" normal exists,
// "s" slow exists). The app only requests files the manifest lists.
(function (root) {
  'use strict';

  function normText(text) {
    var s = String(text == null ? '' : text);
    if (s.normalize) s = s.normalize('NFC');
    return s.replace(/[‘’ʼ′]/g, "'")
      .replace(/[   ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cyrb53(str, seed) {
    var h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function audioHash(text) {
    var n = normText(text);
    if (!n) return '';
    var h = cyrb53(n).toString(16);
    while (h.length < 14) h = '0' + h;
    return h;
  }

  // URL of the static file for text, or null when the manifest doesn't list it.
  function audioUrl(manifest, text, slow, base) {
    if (!manifest) return null;
    var h = audioHash(text);
    var flags = h && manifest[h];
    if (typeof flags !== 'string' || flags.indexOf(slow ? 's' : 'n') < 0) return null;
    return (base || '') + h + (slow ? '.slow' : '') + '.mp3';
  }

  // ── French numbers (0-999, traditional hyphens) ───────────────
  var UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
    'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  var TENS = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante' };
  function below100(n) {
    if (n < 20) return UNITS[n];
    if (n < 70) {
      var t = TENS[Math.floor(n / 10)], u = n % 10;
      return u === 0 ? t : u === 1 ? t + ' et un' : t + '-' + UNITS[u];
    }
    if (n < 80) return n === 71 ? 'soixante et onze' : 'soixante-' + UNITS[n - 60];
    return n === 80 ? 'quatre-vingts' : 'quatre-vingt-' + UNITS[n - 80];
  }
  function frNumber(n, feminine) {
    n = Math.floor(n);
    if (n < 0 || n > 999) throw new Error('frNumber range: ' + n);
    var h = Math.floor(n / 100), r = n % 100, out;
    if (!h) out = below100(r);
    else {
      var head = h === 1 ? 'cent' : UNITS[h] + ' cent';
      out = r === 0 ? head + (h > 1 ? 's' : '') : head + ' ' + below100(r);
    }
    if (feminine) out = out.replace(/(^|[ -])un$/, '$1une');
    return out;
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function priceWords(cents) {
    var e = Math.floor(cents / 100), c = cents % 100;
    var w = e === 0 ? '' : frNumber(e) + (e === 1 ? ' euro' : ' euros');
    if (c) w = e === 0 ? frNumber(c) + ' centimes' : w + ' ' + frNumber(c);
    return w;
  }
  function priceEn(cents) { return '€' + Math.floor(cents / 100) + (cents % 100 ? '.' + pad2(cents % 100) : ''); }
  function timeWords(h, m) {
    if (h === 12 && m === 0) return 'midi';
    if (h === 0 && m === 0) return 'minuit';
    var w = frNumber(h, true) + (h <= 1 ? ' heure' : ' heures');
    return m ? w + ' ' + frNumber(m, true) : w;
  }
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dateWords(d, mo) { return 'le ' + (d === 1 ? 'premier' : frNumber(d)) + ' ' + MONTHS[mo - 1]; }

  // ── Listening items (fixed list, so the generator can make every file) ──
  // kind: price | time | platform | line | date. answer: typed (price, time,
  // platform, line) or picked (date). value: cents, minutes, number, or m*100+d.
  var PRICE_CARRIERS = ['Ça fait %.', 'Ça vous fera %.', '%, s\'il vous plaît.'];
  var PRICES = [120, 200, 255, 350, 420, 490, 615, 650, 750, 880, 990, 1200, 1480, 1550, 1650,
    1790, 2200, 2490, 3500, 4500, 6050, 7000, 7500, 8000, 9000, 9500];
  var TIME_CARRIERS = ['Le train part à %.', 'On ferme à %.', 'Le prochain train est à %.', 'Votre table est à %.'];
  var TIMES = [[7, 30], [8, 15], [9, 5], [10, 40], [11, 50], [12, 0], [13, 20], [14, 45], [15, 10], [16, 35],
    [17, 45], [18, 55], [19, 0], [19, 30], [20, 15], [21, 0], [22, 40], [23, 10]];
  var PLATFORM_CARRIERS = ['Voie %.', 'Le train part de la voie %.', 'Il arrive voie %.'];
  var PLATFORMS = [3, 4, 6, 7, 9, 12, 13, 14, 16, 17, 19, 22];
  var LINES = [4, 6, 7, 9, 11, 13, 14];
  var DATE_CARRIERS = ['%.', 'C\'est fermé %.', 'On arrive %.'];
  var DATES = [[20, 12], [21, 12], [22, 12], [23, 12], [24, 12], [25, 12], [26, 12], [27, 12], [28, 12],
    [29, 12], [30, 12], [31, 12], [1, 1], [2, 1], [3, 1]];

  var _items = null;
  function listenItems() {
    if (_items) return _items;
    var out = [];
    var put = function (kind, value, words, carrier, en) {
      var fr = cap(carrier.replace('%', words));
      out.push({ id: audioHash(fr), kind: kind, value: value, fr: fr, words: words, en: en,
        answer: kind === 'date' ? 'pick' : 'type' });
    };
    PRICES.forEach(function (c, i) { put('price', c, priceWords(c), PRICE_CARRIERS[i % PRICE_CARRIERS.length], priceEn(c)); });
    TIMES.forEach(function (t, i) { put('time', t[0] * 60 + t[1], timeWords(t[0], t[1]), TIME_CARRIERS[i % TIME_CARRIERS.length], pad2(t[0]) + ':' + pad2(t[1])); });
    PLATFORMS.forEach(function (p, i) { put('platform', p, frNumber(p, true), PLATFORM_CARRIERS[i % PLATFORM_CARRIERS.length], 'Platform ' + p); });
    LINES.forEach(function (l) { put('line', l, frNumber(l), 'Prenez la ligne %.', 'Line ' + l); });
    DATES.forEach(function (d, i) { put('date', d[1] * 100 + d[0], dateWords(d[0], d[1]), DATE_CARRIERS[i % DATE_CARRIERS.length], MONTHS_EN[d[1] - 1] + ' ' + d[0]); });
    _items = out;
    return out;
  }

  // ── Typed answers ────────────────────────────────────────────
  // price: "6.50", "6,50", "€6.5", "6€50", "6 50" → cents
  function parsePrice(s) {
    var m = String(s || '').replace(/euros?|eur/gi, '€').match(/(\d+)\s*(?:[.,€]\s*|\s+)?(\d{1,2})?/);
    if (!m) return null;
    var frac = m[2] ? (m[2].length === 1 ? m[2] + '0' : m[2]) : '0';
    return parseInt(m[1], 10) * 100 + parseInt(frac, 10);
  }
  // time: "17:45", "17h45", "17 45", "17.45", "17", "5:45 pm" → minutes
  function parseTime(s) {
    var str = String(s || '').toLowerCase();
    if (/midi|noon/.test(str)) return 720;
    if (/minuit|midnight/.test(str)) return 0;
    var m = str.match(/(\d{1,2})\s*(?:[:h.]\s*|\s+)?(\d{2})?/);
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = m[2] ? parseInt(m[2], 10) : 0;
    if (/p\.?m/.test(str) && h < 12) h += 12;
    if (/a\.?m/.test(str) && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  function parseInteger(s) { var m = String(s || '').match(/\d+/); return m ? parseInt(m[0], 10) : null; }
  function checkTyped(item, typed) {
    var v = item.kind === 'price' ? parsePrice(typed) : item.kind === 'time' ? parseTime(typed) : parseInteger(typed);
    return v !== null && v === item.value;
  }

  // Three same-kind distractors, nearest values first (6.50 → 6.15, 7.50, 16.50…).
  function distractors(item, n, rand) {
    var r = rand || Math.random;
    var pool = listenItems().filter(function (o) { return o.kind === item.kind && o.value !== item.value && o.en !== item.en; });
    var seen = {};
    pool = pool.filter(function (o) { if (seen[o.en]) return false; seen[o.en] = 1; return true; });
    pool.sort(function (a, b) { return Math.abs(a.value - item.value) - Math.abs(b.value - item.value) + (r() - 0.5) * 0.1; });
    return pool.slice(0, n || 3);
  }

  var api = {
    normText: normText, audioHash: audioHash, audioUrl: audioUrl, cyrb53: cyrb53,
    frNumber: frNumber, priceWords: priceWords, timeWords: timeWords, dateWords: dateWords,
    listenItems: listenItems, checkTyped: checkTyped, parsePrice: parsePrice, parseTime: parseTime,
    distractors: distractors
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CLAUDIO = api;
})(typeof window !== 'undefined' ? window : this);

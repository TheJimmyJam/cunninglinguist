// Builds a local test site with MOCK French audio, outside the repo's audio/fr/
// (which ships with an empty manifest until the paid generation runs).
//   node tests/audio-fixture.mjs <outdir> [--ffmpeg <path>]
// <outdir>/cunninglinguist/ = symlinks to every repo entry except audio/, plus
// audio/fr/ with one silent 0.6 s MP3 copied per key and a test manifest:
//   - every listening item and heard staff line, and "Bonjour": normal + slow
//   - "Ça fait un euro vingt.": normal only (Slower must fall back to Web Speech)
//   - "Bonsoir": no files (must fall back to Web Speech, never requested)
// Serve: python3 -m http.server 8774 --bind 127.0.0.1 --directory <outdir>
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, symlinkSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = require(join(root, 'js/audio.js'));
const out = process.argv[2];
if (!out) { console.error('usage: node tests/audio-fixture.mjs <outdir> [--ffmpeg <path>]'); process.exit(2); }
const fi = process.argv.indexOf('--ffmpeg');
const ffmpeg = fi > -1 ? process.argv[fi + 1] : 'ffmpeg';

const site = join(out, 'cunninglinguist');
rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, 'audio/fr'), { recursive: true });
for (const e of readdirSync(root)) {
  if (e === 'audio' || e === '.git') continue;
  symlinkSync(join(root, e), join(site, e));
}

const silent = join(out, 'silent.mp3');
if (!existsSync(silent)) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
    '-t', '0.6', '-c:a', 'libmp3lame', '-b:a', '32k', silent], { cwd: fi > -1 ? dirname(ffmpeg) : undefined }); // Remotion's ffmpeg loads its dylibs from its own folder
}

const src = readFileSync(join(root, 'js/course-en-fr.js'), 'utf8');
const { COURSE } = new Function(src + ';return { COURSE: COURSE_FR };')();
const heard = [];
COURSE.forEach(d => ['paris', 'vocab', 'phrases'].forEach(k => (d[k] || []).forEach(v => { if (v.heard) heard.push(v.fr); })));

const NORMAL_ONLY = 'Ça fait un euro vingt.';
const texts = ['Bonjour', ...heard, ...A.listenItems().map(i => i.fr)];
const manifest = {};
for (const t of texts) {
  const h = A.audioHash(t);
  copyFileSync(silent, join(site, 'audio/fr', h + '.mp3'));
  manifest[h] = 'n';
  if (t !== NORMAL_ONLY) { copyFileSync(silent, join(site, 'audio/fr', h + '.slow.mp3')); manifest[h] = 'ns'; }
}
writeFileSync(join(site, 'audio/fr/manifest.json'), JSON.stringify(manifest));
console.log(`fixture: ${Object.keys(manifest).length} keys (${heard.length} heard lines), site ${site}`);

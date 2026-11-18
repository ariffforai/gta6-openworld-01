// SOLMAR — Streets of Fortune. The entrypoint: hand the game in.
// Copies game/ and screenshots/ from this repository into the output
// directory and writes dossier.json with the kit's buildDossier, plus a
// plain-text summary. Node 22, standard library only, no network, no clock:
// the same repository hands in the same bytes on every run.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const REPO = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

/** Every file under `dir`, in code-unit path order, with its size. */
function listFiles(dir: string, rel = ''): { path: string; bytes: number }[] {
  const out: { path: string; bytes: number }[] = [];
  const entries = readdirSync(rel === '' ? dir : join(dir, rel), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(dir, path));
    else if (entry.isFile()) out.push({ path, bytes: statSync(join(dir, path)).size });
  }
  return out;
}

/** Copy a directory tree, files in sorted order, so the copy is stable. */
function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) cpSync(from, to);
  }
}

const GAME_DIR = join(REPO, 'game');
const SHOTS_DIR = join(REPO, 'screenshots');
if (!existsSync(join(GAME_DIR, 'index.html'))) {
  throw new Error('game/index.html is missing: there is no game to hand in');
}
if (!existsSync(SHOTS_DIR)) {
  throw new Error('screenshots/ is missing: the game needs 3 or 4 screenshots');
}

// The grader mounts the output directory, so OUT itself must never be
// removed: clear only its contents, then hand the game in.
mkdirSync(OUT, { recursive: true });
for (const entry of readdirSync(OUT)) {
  rmSync(join(OUT, entry), { recursive: true, force: true });
}
copyTree(GAME_DIR, join(OUT, 'game'));
copyTree(SHOTS_DIR, join(OUT, 'screenshots'));

const gameFiles = listFiles(join(OUT, 'game'));
const shotFiles = listFiles(join(OUT, 'screenshots'));
const gameBytes = gameFiles.reduce((n, f) => n + f.bytes, 0);

const summary = [
  'SOLMAR — Streets of Fortune',
  'An original 3D open-world crime game in the browser, built with three.js.',
  '',
  `Game files: ${gameFiles.length} (${gameBytes} bytes)`,
  `Screenshots: ${shotFiles.map((f) => f.path).join(', ')}`,
  '',
  'The city: a procedural 9x9-block city on a fixed seed — five districts,',
  'the Solmar Tower landmark, a marina pier with a lighthouse, Coral Beach',
  'and the sea, palms, plazas and drifting clouds.',
  '',
  'Systems: on-foot movement with sprint and jump, arcade driving with a',
  'handbrake, 14 traffic cars and 9 parked cars to steal, 26 pedestrians,',
  'a wanted level from 0 to 5 stars with police cruisers that chase and ram,',
  'pistol combat, a three-mission story (The Pickup, Hot Wheels,',
  'The Exchange), a HUD with money, health, armour, wanted stars, objective,',
  'speedometer and a live circular minimap, start / pause / WASTED / BUSTED',
  'screens, a localStorage save, and synthesised WebAudio sound and music.',
  '',
  'Controls: WASD move, mouse look, Shift sprint, Space jump / handbrake,',
  'E steal car / get out, click shoot, P pause.',
  '',
  'Runs offline from static files under game/, keyboard and mouse, no',
  'network requests and no assets from any other game.',
  '',
].join('\n');
writeFileSync(join(OUT, 'summary.txt'), summary);

const dossier = buildDossier(OUT, CAPS);
writeFileSync(join(OUT, 'dossier.json'), dossier);

// The platform caps the whole hand-in at 1,000 entries (files and
// directories together) and 64 MiB — refuse loudly if a future chunk ever
// grows past it instead of handing in a bad entry.
function countEntries(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n++;
    if (entry.isDirectory()) n += countEntries(join(dir, entry.name));
  }
  return n;
}
const outEntries = countEntries(OUT);
const outBytes = gameBytes
  + shotFiles.reduce((n, f) => n + f.bytes, 0)
  + dossier.length + Buffer.byteLength(summary, 'utf8');
if (outEntries > 1000 || outBytes > 64 * 1024 * 1024) {
  throw new Error(`output is over the platform cap: ${outEntries} entries, ${outBytes} bytes`);
}

console.log(`game/: ${gameFiles.length} files, ${gameBytes} bytes`);
console.log(`screenshots/: ${shotFiles.length} files`);
console.log(`dossier.json: ${dossier.length} bytes`);
console.log(`summary.txt: ${summary.length} bytes`);
console.log(`wrote ${OUT}`);

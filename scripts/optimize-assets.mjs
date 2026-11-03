// OTTIMIZZAZIONE ASSET (una tantum, non è codice di gioco)
//
// Le illustrazioni sono il costo di memoria più alto del gioco: il browser tiene in RAM il
// bitmap DECOMPRESSO, cioè larghezza × altezza × 4 byte, non il peso del file. Un ritratto
// 1254×1254 occupa ~6 MB in memoria anche se il PNG pesa 2 MB: con ritratti, armi e sfondi
// tutti caricati si superano i 100 MB solo di immagini — un problema serio sui telefoni.
//
// Questo script ridimensiona i PNG alla misura in cui vengono davvero mostrati (vedi CAPS) con
// `sips`, già presente su macOS: nessuna dipendenza da installare. Gli originali vengono
// copiati in `assets-originali/` prima di toccare qualunque file.
//
//   node scripts/optimize-assets.mjs            → solo rapporto, non modifica nulla
//   node scripts/optimize-assets.mjs --apply    → ridimensiona (con backup degli originali)

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');
const BACKUP = join(ROOT, 'assets-originali');
const apply = process.argv.includes('--apply');

// Lato massimo utile per ogni famiglia di immagini, ricavato da come sono disegnate nella UI.
const CAPS = [
  { dir: 'roster', match: /-map\.png$/, max: 256 },   // sagome sui token della plancia
  { dir: 'roster', match: /\.png$/, max: 640 },        // ritratti del dossier
  { dir: 'weapons', match: /\.png$/, max: 640 },       // illustrazione arma nel pannello
  { dir: 'props', match: /\.png$/, max: 420 },         // arredi dentro le stanze
  { dir: 'missions', match: /\.png$/, max: 900 },      // copertine di missione
  // Sfondi a tutto schermo: la plancia può girare su un televisore, quindi si scende solo se
  // l'immagine supera il Full HD — il risparmio sarebbe minimo e la resa peggiorerebbe.
  { dir: '', match: /-bg\.png$|copertina\.png$/, max: 1920 },
];

const capFor = (dir, file) => CAPS.find((c) => c.dir === dir && c.match.test(file))?.max;

function pngFiles(dir) {
  const base = dir ? join(PUBLIC, dir) : PUBLIC;
  return readdirSync(base)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .map((f) => ({ file: f, path: join(base, f) }));
}

function size(path) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], { encoding: 'utf8' });
  const w = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  return { w, h };
}

let savedBytes = 0, savedRam = 0, touched = 0;
for (const dir of ['', 'roster', 'weapons', 'props', 'missions']) {
  for (const { file, path } of pngFiles(dir)) {
    const max = capFor(dir, file);
    if (!max) continue;
    const { w, h } = size(path);
    if (!w || !h || Math.max(w, h) <= max) continue;
    const scale = max / Math.max(w, h);
    const bytes = statSync(path).size;
    const ram = w * h * 4;
    const newRam = Math.round(w * scale) * Math.round(h * scale) * 4;
    touched += 1; savedRam += ram - newRam;
    console.log(`${relative(ROOT, path)}  ${w}x${h} -> ${Math.round(w * scale)}x${Math.round(h * scale)}  (RAM ${(ram / 1e6).toFixed(1)}MB -> ${(newRam / 1e6).toFixed(1)}MB)`);
    if (!apply) continue;
    const backup = join(BACKUP, relative(PUBLIC, path));
    mkdirSync(dirname(backup), { recursive: true });
    copyFileSync(path, backup);
    execFileSync('sips', ['-Z', String(max), path], { stdio: 'ignore' });
    savedBytes += bytes - statSync(path).size;
  }
}

console.log(`\n${touched} immagini sopra misura. RAM risparmiata: ~${(savedRam / 1e6).toFixed(0)} MB.`);
if (apply) console.log(`Peso su disco risparmiato: ${(savedBytes / 1e6).toFixed(1)} MB. Originali in assets-originali/.`);
else console.log('Nessun file modificato. Per applicare: node scripts/optimize-assets.mjs --apply');

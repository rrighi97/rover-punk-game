// Genera tutte le icone PWA/favicon da public/roverpunk-logo.png (sorgente, >=512x512).
// Uso: `npm run icons:generate`. Richiede `sips` (incluso in macOS). Non e codice di gioco.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'public', 'roverpunk-logo.png');
const outDir = join(root, 'public', 'icons');

if (!existsSync(src)) {
  console.error('Manca public/roverpunk-logo.png (il logo sorgente, almeno 512x512).');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512], // stesso file: il logo ha gia il fondo scuro pieno
  ['icon-192.png', 192],
  ['apple-touch-icon.png', 180],
  ['favicon.png', 48],
  ['favicon-32.png', 32],
  ['favicon-16.png', 16],
];

for (const [name, size] of targets) {
  const out = join(outDir, name);
  execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), src, '--out', out], { stdio: 'ignore' });
  console.log(`ok  icons/${name}  ${size}x${size}`);
}
console.log('Fatto. Icone in public/icons/.');

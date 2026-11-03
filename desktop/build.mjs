// Costruisce Roverpunk.app e Roverpunk.dmg (trascina l'app in Applicazioni).
// Uso: `npm install && npm run build` dentro desktop/. Richiede macOS.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const stage = join(here, 'stage');
const out = join(here, 'out');
const run = (cmd, args, cwd = here) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

// 1. Build del client (type-check + vite) in ../dist.
run('npm', ['run', 'build'], root);

// 2. Cartella dell'app: main Electron + server + dati di gioco + client compilato.
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ['server.mjs', 'characters.mjs', 'enemies.mjs']) cpSync(join(root, f), join(stage, f));
cpSync(join(here, 'main.cjs'), join(stage, 'main.cjs'));
cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'roverpunk', productName: 'Roverpunk', version: '0.1.0', main: 'main.cjs' }, null, 2));

// 3. Icona .icns dall'icona 512px del gioco.
const iconset = join(here, 'icon.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
const src = join(root, 'public/icons/icon-512.png');
for (const [name, size] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512]]) {
  run('sips', ['-z', String(size), String(size), src, '--out', join(iconset, `icon_${name}.png`)]);
}
run('iconutil', ['-c', 'icns', iconset, '-o', join(here, 'icon.icns')]);
rmSync(iconset, { recursive: true, force: true });

// 4. Pacchetto .app (Apple Silicon + Intel non serve: si costruisce per la macchina corrente).
rmSync(out, { recursive: true, force: true });
const [appPath] = await packager({
  dir: stage,
  out,
  name: 'Roverpunk',
  platform: 'darwin',
  arch: process.arch,
  icon: join(here, 'icon'), // il packager aggiunge da solo l'estensione .icns
  appBundleId: 'it.roverpunk.game',
  overwrite: true,
  prune: false,
});
const app = join(appPath, 'Roverpunk.app');
if (!existsSync(app)) throw new Error(`App non trovata in ${appPath}`);

// 5. Firma ad-hoc (necessaria su Apple Silicon) e immagine disco con collegamento ad Applicazioni.
run('codesign', ['--force', '--deep', '--sign', '-', app]);
const dmgDir = join(out, 'dmg');
mkdirSync(dmgDir, { recursive: true });
cpSync(app, join(dmgDir, 'Roverpunk.app'), { recursive: true, verbatimSymlinks: true });
run('ln', ['-s', '/Applications', join(dmgDir, 'Applications')]);
run('hdiutil', ['create', '-volname', 'Roverpunk', '-srcfolder', dmgDir, '-ov', '-format', 'UDZO', join(out, 'Roverpunk.dmg')]);
console.log(`\nFatto:\n  ${app}\n  ${join(out, 'Roverpunk.dmg')}`);

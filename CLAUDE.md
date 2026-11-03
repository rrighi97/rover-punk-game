# CLAUDE.md

Indice della cartella. Per i dettagli si legge il codice.

## Regole

- Niente test visivi via browser, test cloud o test con Codex, salvo richiesta esplicita.
- Le plance delle missioni (`MISSIONS[...].layout`) e i loro testi non si toccano senza richiesta esplicita.

## Gioco

- `server.mjs` — server HTTP e tutta la logica di gioco: stato, regole, missioni (`MISSIONS`), endpoint `/api/*`.
- `characters.mjs` — gli operativi giocabili.
- `enemies.mjs` — il database nemici.
- `src/` — client React (plancia, telefono, pannello allarme, database):
  - `App.tsx` — quasi tutta la UI.
  - `BoardMap.tsx` — la griglia di stanze.
  - `BoardMap3D.tsx` — la stessa plancia in 3D (three.js): stanze, porte, pedine, drone.
  - `foes3d.ts` — i modelli 3D degli altri nemici (Segugio, SEC-4, Custode, Goliath).
  - `operatives3d.ts` — i modelli 3D degli 8 operativi.
  - `Manual.tsx`, `Settings.tsx`, `PassiveAbilities.tsx` — manuale, impostazioni, scheda passive.
  - `audio.tsx`, `qr.ts`, `roster.ts`, `main.tsx`, `styles.css`.
- `index.html`, `vite.config.ts`, `tsconfig.json`, `.oxlintrc.json`, `package.json` — build e configurazione.
- `public/` — immagini, audio, icone, ritratti (`roster/`), illustrazioni missioni.

## Strumenti (non girano in partita)

- `scripts/generate-map.mjs` — `npm run map:generate`, genera una tantum il `layout` di una missione.
- `scripts/simulate.mjs` — `npm run sim`, bot che giocano col motore vero per tarare le missioni.
- `scripts/optimize-assets.mjs` — `npm run assets:optimize`, ridimensiona i PNG (originali in `assets-originali/`).
- `scripts/generate-icons.mjs` — `npm run icons:generate`, icone/favicon dal logo.
- `desktop/` — wrapper Electron.
- `Avvia Roverpunk.command` / `.bat` — avvio rapido macOS / Windows; `Database Roverpunk.command` apre il database.

## Generati / non tracciati

- `data/game-state.json` — stato della partita in corso.
- `dist/` — output di `npm run build`.
- `assets-originali/` — backup delle immagini prima dell'ottimizzazione.

## Codice morto

- `components/`, `hooks/`, `lib/`, `components.json` — libreria shadcn non usata, esclusa da lint e type-check.
- `app/`, `db/` — cartelle vuote.

## Comandi

`npm run dev` (http://localhost:5174), `npm run build`, `npm start`, `npm run lint`. Node ≥ 22.13.0. Nessuna suite di test.

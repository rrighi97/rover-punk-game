# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Note operative

- Per il momento non aggiorniamo le istruzioni ad ogni modifica.
- A ogni modifica non facciamo un test cloud né un test con Codex.
- Gli agenti AI non devono fare test visivi tramite browser: la verifica visiva la si fa manualmente solo se viene richiesta esplicitamente.

## Comandi

- `npm run dev` — avvia il server di gioco (`node server.mjs`) su `http://localhost:5173`. In sviluppo Vite gira in middleware mode dentro lo stesso processo Node (nessun server Vite separato); l'HMR è **disattivato di proposito** perché il suo WebSocket non è raggiungibile dai telefoni sulla LAN.
- `npm run build` — `tsc --noEmit` (type-check, nessun output) seguito da `vite build` in `dist/`.
- `npm start` — `NODE_ENV=production node server.mjs`: serve i file statici da `dist/` (richiede un build precedente).
- `npm run lint` — `oxlint` (config `.oxlintrc.json`, categoria `correctness` come errore; `components/`, `hooks/`, `lib/` sono ignorati).
- `npm run format` — `oxfmt` (config `.oxfmtrc.json`).
- `./Avvia Roverpunk.command` — entry point macOS: `npm install` se serve, `npm run dev`, attende `/api/state`, apre il browser.
- Non esiste una suite di test.
- Richiede Node ≥ 22.13.0.

## Architettura

Gioco cooperativo LAN: una **plancia** (schermo grande) più 2–6 **telefoni**. Tutta la logica di gioco è sul server; i client sono thin e fanno polling.

### Server — `server.mjs` (un solo file, no dipendenze runtime)

- HTTP `node:http` puro. Le richieste `/api/*` vanno all'handler JSON `api()`; tutto il resto è servito da Vite (dev) o da `dist/` (prod).
- **Stato unico in memoria** nella variabile `game`, persistito su `data/game-state.json` a ogni mutazione via `save()`. Al boot lo stato viene ricaricato; una partita salvata senza `map` (schema vecchio) viene scartata.
- **`data/game-state.json` è tracciato da git** e cambia a ogni partita — attenzione a non committare rumore di sessione.
- La plancia è una griglia 3×3 di stanze (`MAP`) collegate da `links`. BFS (`distancesFrom`, `stepToward`) per movimento nemici e raggio di rilevamento. Il combattimento avviene **solo fra unità nella stessa stanza**.
- **Loop del round**: `tryResolve()` (chiamato da `/api/state`, `/api/ping`, `/api/action` e da un `setInterval` di 1s) risolve il round quando tutti i telefoni partecipanti hanno inviato l'azione o allo scadere del timer. Senza telefoni collegati il timer si congela (partita in pausa). `resolveRound()` esegue in ordine: `resolveMovement` → `resolveActions` (ordinate per Riflessi) → `resolveEnemies`, poi aggiorna allarme/breccia/round e controlla vittoria/sconfitta.
- **Presenza**: `connected()` = visto negli ultimi `LINK_TIMEOUT` (15s); `participant()` = negli ultimi `LINK_GRACE` (45s, la squadra lo aspetta). `publicGame()` è la proiezione inviata ai client (aggiunge `connected`, `waiting`, `secondsLeft`).
- `templates` = i 6 personaggi giocabili; le abilità esclusive sono hardcoded per `characterId` in `resolveActions`. I nemici (`k9`, `wasp`, `trooper` + rinforzi ai round 6) scalano con il numero di giocatori (`hpScale`/`dmgScale`).
- `networkCandidates()` sceglie l'IP LAN reale (scarta `utun`/`awdl`/VPN) per l'URL da aprire sui telefoni.

### Client — `src/` (React 19 + Vite, nessun router)

- `src/App.tsx` (~280 righe, contiene quasi tutta la UI). Il **mode** è deciso solo dalla query string: `?mode=player` → `PlayerJoin`/`PlayerConsole` (telefono), altrimenti `BoardRoot`/`Board` (plancia).
- Nessuno stato client-side reale: `useSnapshot`/`useSnapshot` fanno polling di `/api/state` ogni 800ms. Le azioni sono POST verso `/api/action`; il telefono fa `POST /api/ping` per tenere viva la presenza. La sessione del telefono (`code`/`playerId`/`deviceId`) è in `localStorage` (`roverpunk-session`).
- `deviceId` usa `crypto.randomUUID()` con fallback: sui telefoni l'origin è `http://` (contesto non sicuro), quindi `crypto` può mancare.
- `src/BoardMap.tsx` — rende la griglia di stanze; usata sia a schermo intero sulla plancia sia come mini-mappa nell'overlay di manovra del telefono.
- `src/Manual.tsx`, `src/Settings.tsx`, `src/audio.tsx` (contesto audio + SFX; la musica suona solo in modalità plancia), `src/qr.ts` (generatore di matrice QR fatto in casa, nessuna libreria).

### Nota su `components/`, `hooks/`, `lib/`

Sono libreria shadcn/ui (`components.json`) **non usata** dall'app: `src/` importa solo da `lucide-react` e React. Sono esclusi da lint e type-check. Non è configurato Tailwind; lo stile dell'app è `src/styles.css` scritto a mano.

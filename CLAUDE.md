# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Note operative

- Per il momento non aggiorniamo le istruzioni ad ogni modifica.
- A ogni modifica non facciamo un test cloud né un test con Codex.
- Gli agenti AI non devono fare test visivi tramite browser: la verifica visiva la si fa manualmente solo se viene richiesta esplicitamente.
- Le mappe non sono procedurali: ogni missione ha una plancia fissa in `MISSIONS[...].layout`. Una volta creata una missione non si tocca (mappa e testi) finché non viene chiesta una modifica esplicita.

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
- **`data/game-state.json` è in `.gitignore`** (non tracciato): è stato di sessione, riscritto a ogni round.
- La plancia **non è procedurale**: ogni missione porta la sua mappa fissa in `MISSIONS[<id>].layout` (`rooms` con `col`/`row`/`w`/`h`/`links` + flag di ruolo `start`/`vault`/`exit`/`node`/`exposed`/`cover`, più `startRoom`/`vaultRoom`/`dropRoom`/`nodeRooms`). `createGame` la clona con `structuredClone` senza modificarla — nessuna generazione casuale all'avvio. Le stanze stanno su una griglia di celle (una stanza = 1 cella quadrata o 2 celle adiacenti); stanze vicine non sono per forza collegate, contano solo le porte in `links`. BFS (`distanceMap`, `stepToward`) per movimento nemici e raggio di rilevamento. Il combattimento avviene **solo fra unità nella stessa stanza**.
- **Combattimento semplificato**: esistono solo **INTEGRITÀ** (`hp`/`maxHp`) e **DANNO** (`dmg` per gli operativi, `damage` per i nemici). Nessuna corazza, nessuno scudo, nessuno stress, nessun tiro: il danno scritto è quello inflitto e va **sempre a segno**. L'attacco base di un operativo fa `p.dmg` (valore per personaggio nei `templates`). Le partite salvate con lo schema vecchio (senza `dmg` sui player) vengono scartate al boot. L'azione `guard`/COPERTURA è stata rimossa; i flag stanza `cover`/`exposed` restano nei layout ma sono solo ambientazione.
- **Loop del round**: `tryResolve()` (chiamato da `/api/state`, `/api/ping`, `/api/action` e da un `setInterval` di 1s) risolve il round quando tutti i telefoni partecipanti hanno inviato l'azione. **Nessun tempo limite per round**: senza telefoni collegati il round non si chiude (partita in pausa); si può forzare la chiusura dalla plancia via `/api/resolve`. `resolveRound()` esegue in ordine: `resolveMovement` → `resolveActions` (ordinate per Riflessi) → `resolveEnemies`, poi aggiorna allarme/breccia/round e controlla vittoria/sconfitta.
- **Presenza**: `connected()` = visto negli ultimi `LINK_TIMEOUT` (15s); `participant()` = negli ultimi `LINK_GRACE` (45s, la squadra lo aspetta). `publicGame()` è la proiezione inviata ai client (aggiunge `connected`, `waiting`, `caseAt`, `hostageAt`, `vaultOpen`).
- `templates` = i 6 personaggi giocabili; le abilità esclusive sono hardcoded per `characterId` in `applyAction`. I nemici (`ENEMY_KINDS`: `elite`, `sec`, `drone` + `hunter` che entra alle soglie d'allarme) scalano con il numero di giocatori (`hpScale`/`dmgScale`).
- `networkCandidates()` sceglie l'IP LAN reale (scarta `utun`/`awdl`/VPN) per l'URL da aprire sui telefoni.

#### Missioni — `MISSIONS` in `server.mjs`

Ogni missione (attuale e futura) **deve** definire, oltre a `id`/`title`/`tagline`/`goalHeadline`, questi quattro blocchi. I primi tre (Storyline, Obiettivo, Mappa) li rende il briefing pre-partita (`src/App.tsx`, overlay `briefing`) sotto i titoli *Intro / Storyline*, *Obiettivi*, *La mappa*: se uno manca la schermata resta vuota in quel punto.

1. **Storyline** — `intro` (2–4 frasi di ambientazione: dove siete, cosa c'è in gioco, il tono) **e** `brief` (riassunto operativo asciutto di cosa si fa). Devono restare coerenti fra le missioni (stessa torre Helix, stesso MNEMOSYNE, stesso ruolo dei presidi come ostacolo).
2. **Obiettivo** — `goalHeadline` (una riga imperativa) **e** `objectives` (array di 3–4 passi concreti nell'ordine di gioco: violare i nodi → agire sull'obiettivo in `vaultRoom` → portare il carico al `dropRoom` → estrarre gli operativi vivi). La funzione `narrative(layout, roomName)` risolve gli stessi testi coi nomi reali delle stanze e **deve** restituire almeno `objective`, `vaultUnlocked`, `opening` (più le chiavi extra della meccanica specifica, es. `purged`).
3. **Mappa** — `mapNote`, dall'helper `mapNote(vaultNoun, roomCount)` passando il nome dell'obiettivo (`'la teca'`, `'il nucleo dati'`, `'la cella'`) e il numero di stanze del `layout`. Lo schema disegnato nel briefing è solo una legenda degli elementi (S / N / obiettivo / ▼), non la pianta reale.
4. **Plancia** — `layout`: mappa fissa della missione. `rooms` = array di stanze `{id, name, col, row, w, h, links[]}` più i flag di ruolo (`start`, `vault`, `exit`, `node`, `exposed`, `cover`) sulle stanze giuste; poi `startRoom` / `vaultRoom` / `dropRoom` / `nodeRooms` (3 nodi, ne servono `NODES_REQUIRED` per aprire). `createGame` la clona e basta. Vincoli: tutte le stanze raggiungibili dalla partenza via `links`; `vaultRoom` e `dropRoom` lontani fra loro e dalla partenza.

Le tre missioni esistenti (`valigetta`, `nucleo`, `ostaggio`) rispettano già questo schema e servono da riferimento. Una volta definita, la plancia di una missione **non si modifica** senza richiesta esplicita.

### Client — `src/` (React 19 + Vite, nessun router)

- `src/App.tsx` (~280 righe, contiene quasi tutta la UI). Il **mode** è deciso solo dalla query string: `?mode=player` → `PlayerJoin`/`PlayerConsole` (telefono), altrimenti `BoardRoot`/`Board` (plancia).
- Nessuno stato client-side reale: `useSnapshot`/`useSnapshot` fanno polling di `/api/state` ogni 800ms. Le azioni sono POST verso `/api/action`; il telefono fa `POST /api/ping` per tenere viva la presenza. La sessione del telefono (`code`/`playerId`/`deviceId`) è in `localStorage` (`roverpunk-session`).
- `deviceId` usa `crypto.randomUUID()` con fallback: sui telefoni l'origin è `http://` (contesto non sicuro), quindi `crypto` può mancare.
- `src/BoardMap.tsx` — rende la griglia di stanze; usata sia a schermo intero sulla plancia sia come mini-mappa nell'overlay di manovra del telefono.
- `src/Manual.tsx`, `src/Settings.tsx`, `src/audio.tsx` (contesto audio + SFX; la musica suona solo in modalità plancia), `src/qr.ts` (generatore di matrice QR fatto in casa, nessuna libreria).

### Nota su `components/`, `hooks/`, `lib/`

Sono libreria shadcn/ui (`components.json`) **non usata** dall'app: `src/` importa solo da `lucide-react` e React. Sono esclusi da lint e type-check. Non è configurato Tailwind; lo stile dell'app è `src/styles.css` scritto a mano.

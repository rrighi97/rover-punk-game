# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Note operative

- Per il momento non aggiorniamo le istruzioni ad ogni modifica.
- A ogni modifica non facciamo un test cloud né un test con Codex.
- Gli agenti AI non devono fare test visivi tramite browser: la verifica visiva la si fa manualmente solo se viene richiesta esplicitamente.
- Le mappe non sono procedurali: ogni missione ha una plancia fissa in `MISSIONS[...].layout`, sempre la stessa a ogni partita — rigiocabile all'infinito. Una volta creata una missione non si tocca (mappa e testi) finché non viene chiesta una modifica esplicita. Per generare (o rigenerare) il `layout` di una missione si usa una tantum `npm run map:generate` (`scripts/generate-map.mjs`, non è codice di gioco) e si incolla il risultato: il motore non disegna più mappe a runtime.

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
- **Stato unico in memoria** nella variabile `game`, persistito su `data/game-state.json` a ogni mutazione via `save()` (scritture in coda, file `.tmp` + `rename` atomico). Al boot lo stato viene ricaricato; le partite con schema vecchio (senza `map`, `turnOrder`, `dmg` sui player o `actions` array) vengono scartate.
- **`data/game-state.json` è in `.gitignore`** (non tracciato): è stato di sessione, riscritto a ogni azione.
- **Dati separati**: i 6 personaggi (`templates`) stanno in `characters.mjs`, il database nemici (`ENEMY_ROSTER`: `drone`, `hunter`, `sec`, `elite`, `titan`) in `enemies.mjs`.
- La plancia **non è procedurale**: ogni missione porta la sua mappa fissa in `MISSIONS[<id>].layout` (`rooms` con `col`/`row`/`w`/`h`/`links` + flag di ruolo `start`/`vault`/`exit`/`node`/`exposed`/`cover`, più `startRoom`/`vaultRoom`/`dropRoom`/`nodeRooms`). `createGame` la clona con `structuredClone` senza modificarla — nessuna generazione casuale all'avvio. Le stanze stanno su una griglia di celle (una stanza = 1 cella quadrata o 2 celle adiacenti); stanze vicine non sono per forza collegate, contano solo le porte in `links`. BFS (`distanceMap`, `stepToward`) per movimento nemici e raggio di rilevamento. Il combattimento avviene **solo fra unità nella stessa stanza**. Il `layout` di ogni missione è stato generato una tantum con `scripts/generate-map.mjs` (vedi commento in testa al file) e poi congelato: quello script non gira mai a runtime.
- **Combattimento semplificato**: esistono solo **INTEGRITÀ** (`hp`/`maxHp`) e **DANNO** (`dmg` per gli operativi, `damage` per i nemici). Nessuna corazza, nessuno scudo, nessuno stress, nessun tiro: il danno scritto è quello inflitto e va **sempre a segno**. L'attacco base di un operativo fa `p.dmg` (valore per personaggio nei `templates`). Le partite salvate con lo schema vecchio (senza `dmg` sui player) vengono scartate al boot. L'azione `guard`/COPERTURA è stata rimossa; i flag stanza `cover`/`exposed` restano nei layout ma sono solo ambientazione.
- **Round a turni**: gli operativi giocano uno alla volta nell'ordine fisso `turnOrder` (`activePlayerId` = chi ha la mano). Nel proprio turno: una manovra (`move`, `applyMove`, risolta subito; sganciarsi da una stanza con ostili costa il 60% del danno del primo) e fino a `ACTIONS_PER_TURN` (2) azioni (`applyAction`, risolte subito). `/api/endturn` → `advanceTurn()` passa al prossimo vivo; a giro completo `runEnemyPhase()` (`resolveEnemies`, allarme +`ALARM_PER_ROUND`, focus +1, consegna del carico, vittoria/sconfitta, SEGUGI alle soglie `ALARM_SPAWN_THRESHOLDS`, `LOCKDOWN` a 80%) e `startNextRound()`. Se un operativo muore sganciandosi il turno avanza da solo. **Nessun tempo limite**: dalla plancia `/api/skipturn` (SALTA TURNO) e `/api/resolve` (CHIUDI ROUND).
- **Endpoint**: `GET /api/state`, `GET /api/alarm` (testo 0–100 o -1, per il ponte seriale Arduino), `POST /api/setup`, `/api/join`, `/api/ping`, `/api/start`, `/api/action`, `/api/endturn`, `/api/skipturn`, `/api/resolve`, `/api/reset`.
- **Presenza**: `connected()` = visto negli ultimi `LINK_TIMEOUT` (15s). `publicGame()` è la proiezione inviata ai client: aggiunge `connected`, `waiting`, `caseAt`, `hostageAt`, `vaultOpen` e **toglie `deviceId`** (altrimenti chiunque potrebbe agire al posto di un altro telefono).
- **Porte**: ogni `link` è una porta; lo stato iniziale è in `layout.doors` (chiave `idA-idB` in ordine alfabetico, `true` = chiusa), copiato in `game.doors`. Una porta chiusa blocca la manovra finché l'azione `unlock` (SBLOCCA PORTA) non la apre da una delle due stanze. I nemici ignorano le porte.
- **Nemici**: presidio fisso (non pattugliano) finché un operativo non entra nella stanza → `locked` e inseguono una stanza per round (`stepToward`), priorità a chi porta valigetta/informatore. Presidio di default da `buildEnemies` (élite in `vaultRoom`, sec/drone sui nodi), oppure `layout.garrison` se la missione lo dichiara. Il numero di nemici **non** cresce con la squadra: scalano solo vita/danno con `SQUAD_SCALE` (`hpScale`/`dmgScale`), valori tarati con simulazioni headless. PURGA (missione `nucleo`) e LOCKDOWN mettono `locked` su tutti.
- Le abilità esclusive sono hardcoded per `characterId` in `applyAction`.
- `networkCandidates()` sceglie l'IP LAN reale (scarta `utun`/`awdl`/VPN) per l'URL da aprire sui telefoni.

#### Missioni — `MISSIONS` in `server.mjs`

Ogni missione (attuale e futura) **deve** definire, oltre a `id`/`title`/`tagline`/`goalHeadline`, questi quattro blocchi. I primi tre (Storyline, Obiettivo, Mappa) li rende il briefing pre-partita (`src/App.tsx`, overlay `briefing`) sotto i titoli *Intro / Storyline*, *Obiettivi*, *La mappa*: se uno manca la schermata resta vuota in quel punto.

1. **Storyline** — `intro` (2–4 frasi di ambientazione: dove siete, cosa c'è in gioco, il tono) **e** `brief` (riassunto operativo asciutto di cosa si fa). Devono restare coerenti fra le missioni (stessa torre Helix, stesso MNEMOSYNE, stesso ruolo dei presidi come ostacolo).
2. **Obiettivo** — `goalHeadline` (una riga imperativa) **e** `objectives` (array di 3–4 passi concreti nell'ordine di gioco: violare i nodi → agire sull'obiettivo in `vaultRoom` → portare il carico al `dropRoom` → estrarre gli operativi vivi). La funzione `narrative(layout, roomName)` risolve gli stessi testi coi nomi reali delle stanze e **deve** restituire almeno `objective`, `vaultUnlocked`, `opening` (più le chiavi extra della meccanica specifica, es. `purged`).
3. **Mappa** — `mapNote`, dall'helper `mapNote(vaultNoun, roomCount)` passando il nome dell'obiettivo (`'la teca'`, `'il nucleo dati'`, `'la cella'`) e il numero di stanze del `layout`. Lo schema disegnato nel briefing è solo una legenda degli elementi (S / N / obiettivo / ▼), non la pianta reale.
4. **Plancia** — `layout`: mappa fissa della missione. `rooms` = array di stanze `{id, name, col, row, w, h, links[]}` più i flag di ruolo (`start`, `vault`, `exit`, `node`, `exposed`, `cover`) sulle stanze giuste; poi `startRoom` / `vaultRoom` / `dropRoom` / `nodeRooms` (3 nodi, ne servono `NODES_REQUIRED` per aprire) e `doors` (almeno metà chiuse). `createGame` la clona e basta. Vincoli: tutte le stanze raggiungibili dalla partenza via `links`; `links` simmetrici e solo fra stanze che condividono un muro (le celle vuote della griglia non si attraversano); `vaultRoom` e `dropRoom` lontani fra loro e dalla partenza. Per una missione nuova si genera il `layout` con `npm run map:generate "NOME1" ... "NOME16"` (16 nomi di stanza a tema, uno per cella della griglia 4×4) e si incolla l'output qui.

Le tre missioni esistenti (`valigetta`, `nucleo`, `ostaggio`) rispettano già questo schema e servono da riferimento. Una volta definita, la plancia di una missione **non si modifica** senza richiesta esplicita.

### Client — `src/` (React 19 + Vite, nessun router)

- `src/App.tsx` (~650 righe, contiene quasi tutta la UI). Il **mode** è deciso solo dalla query string: `?mode=player` → `PlayerJoin`/`PlayerConsole` (telefono), `?mode=alarm` → `AlarmPanel` (percentuale d'allarme a schermo intero), `?mode=database` → `DatabasePage`, altrimenti `BoardRoot` (`Setup` → `Lobby` → `Board`, plancia).
- Nessuno stato client-side reale: `useSnapshot` fa polling di `/api/state` ogni 800ms. Le azioni sono POST verso `/api/action` e `/api/endturn`; il telefono fa `POST /api/ping` ogni 4s per tenere viva la presenza. La sessione del telefono (`code`/`playerId`/`deviceId`) è in `localStorage` (`roverpunk-session`).
- `useSpawnAlerts` confronta gli id nemici a ogni poll e accoda l'avviso a tutto schermo (`SpawnAlert`, sirena 5s) per ogni SEGUGIO nuovo: gli id nemici devono restare unici.
- `deviceId` usa `crypto.randomUUID()` con fallback: sui telefoni l'origin è `http://` (contesto non sicuro), quindi `crypto` può mancare.
- `src/BoardMap.tsx` — rende la griglia di stanze; usata sia a schermo intero sulla plancia sia come mini-mappa nell'overlay di manovra del telefono.
- `src/roster.ts` — URL delle miniature in `public/roster/` (operativi per callsign, nemici per chiave).
- `src/Manual.tsx` (capitoli del manuale, mostrati dentro `Settings`), `src/Settings.tsx` (istruzioni, audio, database, comandi SALTA TURNO / CHIUDI ROUND / TERMINA), `src/audio.tsx` (contesto audio + SFX; la musica suona solo in modalità plancia), `src/qr.ts` (generatore di matrice QR fatto in casa, nessuna libreria).

### Nota su `components/`, `hooks/`, `lib/`

Sono libreria shadcn/ui (`components.json`) **non usata** dall'app: `src/` importa solo da `lucide-react` e React. Sono esclusi da lint e type-check. Non è configurato Tailwind; lo stile dell'app è `src/styles.css` scritto a mano.

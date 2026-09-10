import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { templates } from './characters.mjs';
import { ENEMY_ROSTER } from './enemies.mjs';

const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = new URL('./data/', import.meta.url);
const DATA_FILE = new URL('./data/game-state.json', import.meta.url);

// Finestra entro cui un telefono è considerato collegato (3 ping persi).
const LINK_TIMEOUT = 15000;

// TARATURA UNICA
// Non esistono più livelli di minaccia selezionabili: ROVERPUNK ha una sola difficoltà,
// pensata per essere dura. Ogni costante qui sotto è una leva della pressione sulla squadra.
// Il round è a TURNI: ogni operativo gioca il suo turno singolarmente, nell'ordine fisso di
// `turnOrder` (sempre lo stesso, in cerchio, si riparte sempre dal primo). Quando tutti hanno
// finito rispondono gli Helix. Nessun timer: se un telefono è offline il suo turno lo salta
// la plancia con SALTA TURNO.
const ALARM_START = 15;            // allarme iniziale
// L'allarme ha una sola leva di salita: il respiro della torre, +4 a ogni round. Nessun
// picco secco (stacco carico, PURGA, Sovraccarico cromo, sganciamento) e nessuna pressione
// da contatto/zona esposta/carico. L'unica cosa che lo abbassa è l'Identità sintetica di ECHO.
const ALARM_PER_ROUND = 4;         // pressione base di ogni round
const ALARM_FACE_RELIEF = 5;       // Identità sintetica del FACE
const LOCKDOWN_ALARM = 80;         // oltre questa soglia la torre allerta ogni presidio: tutti convergono sui Player
const ALARM_SPAWN_THRESHOLDS = [25, 35, 45, 55, 65, 75]; // a ogni soglia una nuova unità entra in una stanza a caso e parte a caccia
const NODES_REQUIRED = 2;          // nodi da violare per sbloccare la teca
const ACTIONS_PER_TURN = 2;        // azioni (non manovra) giocabili in un turno
const REVIVE_RATIO = 0.25;
const HEAL_AMOUNT = 12;            // RIPRISTINO sul compagno più ferito — allineato a src/App.tsx
const HACK_DRONE_DAMAGE = 10;      // INTRUSIONE colpisce anche un drone nella stanza — allineato a src/App.tsx
const LAZARUS_RATIO = 0.4;

// TARATURA PER DIMENSIONE SQUADRA
// Nel sistema a turni ogni operativo in più è un'azione gratuita in più a ogni giro: una sola
// formula ancorata a 3 giocatori non basta a tenere il winrate stabile su tutte le taglie (2-6),
// serve una leva indipendente per fascia. `hp`/`dmg` scalano vita e danno dei nemici, `extraGuards`
// aggiunge presidi extra sugli snodi più trafficati (vedi `buildEnemies`) — così a crescere non è
// solo la forza dei nemici ma anche il loro numero, in proporzione diretta alla squadra.
const SQUAD_SCALE = {
  2: { hp: 0.77, dmg: 0.98 },
  3: { hp: 1.38, dmg: 1.19 },
  4: { hp: 1.92, dmg: 1.46 },
  5: { hp: 2.43, dmg: 1.72 },
  6: { hp: 3.18, dmg: 2.09 },
};
const EXTRA_GUARDS_BY_SQUAD = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4 };

// MISSIONE 03 // OSTAGGIO
const HOSTAGE_MAX_HP = 70;
const HOSTAGE_UNESCORTED_DAMAGE = 18; // danno subito se lasciato solo con ostili

// PLANCE DELLE MISSIONI
// La mappa è procedurale: ogni missione ha un proprio tema (pool di nomi di stanza, presidio),
// ma la plancia viene disegnata da zero a ogni partita su una griglia di celle — anche
// rigiocando la stessa missione la mappa non è mai la stessa. Una stanza occupa una cella
// (quadrata) o due celle adiacenti (rettangolare). Le stanze fisicamente vicine NON sono
// automaticamente collegate: un albero di copertura garantisce che tutto sia raggiungibile,
// poi solo una parte dei muri restanti diventa una porta — il resto sono pareti cieche. Il
// presidio (chi guardia cosa) resta quello della missione: si sposta con teca/nodi ovunque
// finiscano su questa plancia, ma la composizione non cambia da partita a partita.

// Distanze in numero di porte da una stanza a tutte le altre (BFS sul grafo delle porte).
function distanceMap(rooms, origin) {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const dist = { [origin]: 0 };
  const queue = [origin];
  while (queue.length) {
    const current = queue.shift();
    for (const next of byId.get(current)?.links || []) {
      if (dist[next] === undefined) { dist[next] = dist[current] + 1; queue.push(next); }
    }
  }
  return dist;
}

const GRID_COLS = 4;
const GRID_ROWS = 4;
const DOUBLE_ROOM_CHANCE = 0.6;    // quanto spesso una stanza diventa rettangolare (due celle)
const EXTRA_DOOR_CHANCE = 0.28;    // quanti muri in più (oltre all'albero) diventano porte

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Passo 1: riempie la griglia con stanze da 1 o 2 celle, senza buchi e senza sovrapposizioni.
function fillGrid() {
  const grid = Array.from({ length: GRID_ROWS + 2 }, () => Array(GRID_COLS + 2).fill(null));
  const cells = [];
  for (let row = 1; row <= GRID_ROWS; row++) for (let col = 1; col <= GRID_COLS; col++) cells.push({ col, row });
  const draft = [];
  for (const { col, row } of shuffle(cells)) {
    if (grid[row][col]) continue;
    const key = `k${draft.length}`;
    const options = [];
    if (col + 1 <= GRID_COLS && !grid[row][col + 1]) options.push({ w: 2, h: 1 });
    if (row + 1 <= GRID_ROWS && !grid[row + 1][col]) options.push({ w: 1, h: 2 });
    const shape = options.length && Math.random() < DOUBLE_ROOM_CHANCE ? pick(options) : { w: 1, h: 1 };
    for (let dr = 0; dr < shape.h; dr++) for (let dc = 0; dc < shape.w; dc++) grid[row + dr][col + dc] = key;
    draft.push({ key, col, row, w: shape.w, h: shape.h });
  }
  return { grid, draft };
}

// Passo 2: due stanze che condividono un muro sono "vicine", ma non ancora collegate.
function neighbours(grid, draft) {
  const adjacency = new Map(draft.map((r) => [r.key, new Set()]));
  for (let row = 1; row <= GRID_ROWS; row++) for (let col = 1; col <= GRID_COLS; col++) {
    const here = grid[row][col];
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const other = grid[row + dr]?.[col + dc];
      if (!other || other === here) continue;
      adjacency.get(here).add(other);
      adjacency.get(other).add(here);
    }
  }
  return adjacency;
}

// Passo 3: albero di copertura casuale (tutto raggiungibile) + qualche porta extra.
// Tutti i muri non estratti restano chiusi: da qui nascono le stanze vicine ma separate.
function carveDoors(draft, adjacency) {
  const keys = draft.map((r) => r.key);
  const doors = new Set();
  const addDoor = (a, b) => doors.add([a, b].sort().join('|'));
  const inTree = new Set([pick(keys)]);
  while (inTree.size < keys.length) {
    const options = [];
    for (const a of inTree) for (const b of adjacency.get(a)) if (!inTree.has(b)) options.push([a, b]);
    if (!options.length) break;
    const [a, b] = pick(options);
    addDoor(a, b);
    inTree.add(b);
  }
  for (const [a, set] of adjacency) for (const b of set) {
    if (a < b && Math.random() < EXTRA_DOOR_CHANCE) addDoor(a, b);
  }
  return doors;
}

// Passo 4: identità delle stanze (nomi dal pool tematico della missione) e ruoli tattici
// (partenza, obiettivo, consegna, nodi). Obiettivo e consegna finiscono sempre agli antipodi
// del percorso: bisogna attraversare il livello e poi tornare indietro.
function buildMap(roomNames) {
  const { grid, draft } = fillGrid();
  const adjacency = neighbours(grid, draft);
  const doors = carveDoors(draft, adjacency);

  const ordered = [...draft].sort((a, b) => a.row - b.row || a.col - b.col);
  const names = shuffle(roomNames);
  const rooms = ordered.map((r, i) => ({
    id: `${'ABCD'[r.col - 1]}${String(i + 1).padStart(2, '0')}`,
    name: names[i % names.length],
    col: r.col, row: r.row, w: r.w, h: r.h, links: [],
  }));
  const byKey = new Map(ordered.map((r, i) => [r.key, rooms[i]]));
  for (const door of doors) {
    const [a, b] = door.split('|');
    const ra = byKey.get(a), rb = byKey.get(b);
    if (!ra || !rb) continue;
    ra.links.push(rb.id);
    rb.links.push(ra.id);
  }

  // La squadra entra da un lato della struttura, mai dal centro.
  const border = rooms.filter((r) => r.col === 1);
  const start = (border.length ? border : rooms).sort((a, b) => b.row - a.row)[0];
  start.start = true;
  const fromStart = distanceMap(rooms, start.id);
  const reachable = rooms.filter((r) => fromStart[r.id] !== undefined);

  // L'obiettivo è la stanza più lontana dall'ingresso: bisogna attraversare il livello.
  const vault = [...reachable].sort((a, b) => (fromStart[b.id] || 0) - (fromStart[a.id] || 0))[0];
  vault.vault = true;
  const fromVault = distanceMap(rooms, vault.id);
  // Il punto di consegna è lontano dall'obiettivo: recuperare non basta, bisogna tornare indietro.
  const drop = reachable.filter((r) => r !== vault && r !== start)
    .sort((a, b) => (fromVault[b.id] || 0) - (fromVault[a.id] || 0))[0] || start;
  drop.exit = true;

  const rest = shuffle(reachable.filter((r) => !r.start && !r.vault && !r.exit));
  for (const room of rest.slice(0, 3)) room.node = true;
  const leftovers = rest.slice(3).sort((a, b) => b.links.length - a.links.length);
  for (const room of leftovers.slice(0, 2)) room.exposed = true;
  for (const room of leftovers.slice(2)) room.cover = true;

  return { rooms, startRoom: start.id, vaultRoom: vault.id, dropRoom: drop.id, nodeRooms: rooms.filter((r) => r.node).map((r) => r.id) };
}

// Statistiche in enemies.mjs. Le missioni pescano da qui il proprio presidio: il presidio
// di default schiera WASP / HELIX SEC / CUSTODE, l'HELIX SEGUGIO entra dai picchi d'allarme,
// l'HELIX GOLIATH è la riserva pesante e va schierato solo dalle missioni che lo richiamano in
// `layout.garrison`.
const ENEMY_KINDS = Object.fromEntries(ENEMY_ROSTER.map((e) => [e.key, e]));
function spawnEnemy(kind, room, index, hpScale, dmgScale) {
  const base = ENEMY_KINDS[kind];
  const hp = Math.round(base.hp * hpScale);
  return {
    id: `${kind}-${index}`,
    name: index > 1 ? `${base.name}-${index}` : base.name,
    type: base.type, hp, maxHp: hp,
    damage: Math.round(base.damage * dmgScale), threat: base.threat,
    room, home: room, locked: false, chasing: null,
  };
}

// Risolve il segnaposto stanza di uno slot di presidio: 'vault'/'drop'/'start', 'hub' (snodo
// più trafficato), 'node:N' (N-esimo nodo) o un id di stanza esplicito.
function garrisonRoom(at, layout, rooms) {
  if (at === 'vault') return layout.vaultRoom;
  if (at === 'drop') return layout.dropRoom;
  if (at === 'start') return layout.startRoom;
  if (at === 'hub') {
    const hub = rooms.filter((r) => !r.start && !r.vault && !r.node)
      .sort((a, b) => b.links.length - a.links.length)[0];
    return hub?.id || layout.startRoom;
  }
  const node = /^node:(\d+)$/.exec(at || '');
  if (node) return layout.nodeRooms[Number(node[1])] || layout.nodeRooms[0];
  return at;
}

// I presidi stanno dove c'è qualcosa da difendere: teca e nodi. Nessuno pattuglia l'ingresso.
// Se la missione dichiara `layout.garrison` (array di {kind, at, minSquad?}) si schiera quello,
// pescando le unità dal DATABASE NEMICI (ENEMY_ROSTER); altrimenti vale il presidio di default,
// che cresce di numero con la squadra (vedi `EXTRA_GUARDS_BY_SQUAD` più sotto): ogni operativo
// in più è un attacco gratis a ogni turno, quindi in cambio arriva un presidio in più, non solo
// più vita/danno.
function buildEnemies(layout, rooms, hpScale, dmgScale, squadSize) {
  if (Array.isArray(layout.garrison) && layout.garrison.length) {
    const seen = {};
    return layout.garrison
      .filter((slot) => ENEMY_KINDS[slot.kind] && (!slot.minSquad || squadSize >= slot.minSquad))
      .map((slot) => {
        seen[slot.kind] = (seen[slot.kind] || 0) + 1;
        return spawnEnemy(slot.kind, garrisonRoom(slot.at, layout, rooms), seen[slot.kind], hpScale, dmgScale);
      });
  }
  const list = [spawnEnemy('elite', layout.vaultRoom, 1, hpScale, dmgScale)];
  layout.nodeRooms.forEach((roomId, i) => {
    list.push(spawnEnemy(i % 2 === 0 ? 'sec' : 'drone', roomId, i + 1, hpScale, dmgScale));
  });
  // Guardie extra sugli snodi più trafficati: una per ogni giocatore sopra i 2, così anche il
  // NUMERO di ostili scala con la squadra e non solo la loro forza.
  const extraGuards = EXTRA_GUARDS_BY_SQUAD[squadSize] ?? 0;
  const others = rooms.filter((r) => !r.start && !r.vault && !r.node).sort((a, b) => b.links.length - a.links.length);
  others.slice(0, extraGuards).forEach((room, i) => {
    list.push(spawnEnemy(i % 2 === 0 ? 'sec' : 'hunter', room.id, layout.nodeRooms.length + 2 + i, hpScale, dmgScale));
  });
  return list;
}

// CATALOGO MISSIONI
// Ogni missione riusa lo stesso motore (nodi, allarme, combattimento) e differisce solo per
// l'obiettivo finale in teca/nucleo/cella, per la meccanica di "carico" che lo accompagna e per
// il tema della propria plancia. `narrative` risolve i testi che dipendono dai nomi delle
// stanze usando l'helper `roomName` locale a `createGame`, perché lì la variabile globale
// `game` non è ancora assegnata.
// `roomNames` = pool di nomi di stanza tematico della missione (16 voci, una per ogni cella
// possibile della griglia): `buildMap()` lo pesca per disegnare una plancia nuova a ogni
// partita. La composizione del presidio resta invece quella di default in `buildEnemies`
// (o quella dichiarata in `garrison`, se una missione la definisce), perché si aggancia ai
// ruoli tattici (`vault`/`node:N`/`hub`) e non a stanze fisse.
const mapNote = (vaultNoun) => `Plancia generata da zero a ogni partita su una griglia di celle: cambia sempre, anche rigiocando questa stessa missione. Le stanze sono collegate solo da alcune porte — due stanze vicine possono non comunicare affatto. Contiene sempre la zona di partenza (S), tre nodi di rete (N), ${vaultNoun} dell’obiettivo e il punto di consegna (▼), lontani fra loro. Lo schema qui sotto segna solo il tipo di questi elementi, non la loro posizione reale.`;

const MISSIONS = {
  valigetta: {
    id: 'valigetta', title: 'MISSIONE 01 // LA VALIGETTA', tagline: 'Furto ed estrazione',
    brief: 'Violate i nodi per aprire la teca, recuperate la valigetta MNEMOSYNE e consegnatela al punto di raccolta. Gli Helix sono un ostacolo sulla strada, non l’obiettivo.',
    goalHeadline: 'Recuperate MNEMOSYNE',
    intro: 'Dentro la Helix Tower, in una teca cifrata, c’è un prototipo chiamato MNEMOSYNE. Il blackout vi apre una finestra stretta: entrare, aprire la teca e sparire prima che la torre capisca cosa sta succedendo. I presidi Helix stanno esattamente dove dovete passare — ma il vostro obiettivo è la valigetta, non loro.',
    objectives: [
      'Violate 2 nodi di rete (sulla plancia ce ne sono 3) per sbloccare la teca.',
      'Raggiungete la stanza della teca e usate RECUPERO per prendere la valigetta MNEMOSYNE.',
      'Trasportate la valigetta fino al punto di consegna senza farvi bloccare dai presidi.',
      'Portate ogni operativo ancora vivo nel punto di consegna per chiudere l’estrazione.',
    ],
    mapNote: mapNote('la teca'),
    roomNames: [
      'CONDOTTI','SERVER FARM','SICUREZZA','ACCESSO','NEXUS','LAB NERO','GARAGE','ARCHIVIO',
      'PONTE','MENSA','DEPOSITO','CELLE','ATRIO','TERMICA','OFFICINA','CRIOSALA',
    ],
    narrative(layout, roomName) {
      return {
        objective: `Violate ${NODES_REQUIRED} nodi per sbloccare la teca di ${roomName(layout.vaultRoom)}, recuperate la valigetta MNEMOSYNE e consegnatela in ${roomName(layout.dropRoom)}.`,
        vaultUnlocked: `Teca di ${roomName(layout.vaultRoom)} sbloccata: la valigetta è prelevabile.`,
        opening: 'Il blackout è iniziato. Aprite la teca, prendete la valigetta, sparite.',
      };
    },
  },
  nucleo: {
    id: 'nucleo', title: 'MISSIONE 02 // GHOST PROTOCOL', tagline: 'Sabotaggio dati',
    brief: 'Niente da rubare: violate i nodi per abbattere il firewall del nucleo dati, raggiungetelo e lanciate la PURGA. Da quel momento ogni sistema Helix converge sulla vostra posizione — sparire in fretta è l’unica strategia.',
    goalHeadline: 'Cancellate MNEMOSYNE dal nucleo',
    intro: 'MNEMOSYNE non va rubato, va cancellato alla fonte. Scendete nel nucleo dati della Helix Tower, abbattete il firewall e lanciate la PURGA. Nell’istante in cui parte, ogni sistema della torre sa dove siete e converge: da lì in poi è solo fuga.',
    objectives: [
      'Violate 2 nodi di rete per abbattere il firewall del nucleo dati.',
      'Raggiungete il nucleo e lanciate la PURGA.',
      'Dopo la PURGA ogni sistema Helix converge su di voi: raggiungete il punto di consegna prima della saturazione.',
      'Portate ogni operativo ancora vivo nel punto di consegna per l’estrazione.',
    ],
    mapNote: mapNote('il nucleo dati'),
    roomNames: [
      'SALA SERVER','NODO DATI','RACK PRINCIPALE','CAMERA BIANCA','CENTRALE DATI','SALA CAVI',
      'RAFFREDDAMENTO','BACKUP','CONTROLLO REMOTO','FIBRA DORSALE','ARCHIVIO DIGITALE',
      'SALA MACCHINE','MODULO QUANTICO','SPECCHIO DATI','ALIMENTAZIONE','DATACENTER',
    ],
    narrative(layout, roomName) {
      return {
        objective: `Violate ${NODES_REQUIRED} nodi per abbattere il firewall del nucleo dati in ${roomName(layout.vaultRoom)}, lanciate la PURGA e sparite da ${roomName(layout.dropRoom)} prima che la torre richiuda ogni via d’uscita.`,
        vaultUnlocked: `Firewall del nucleo in ${roomName(layout.vaultRoom)} abbattuto: la PURGA è disponibile.`,
        purged: `PURGA lanciata nel nucleo di ${roomName(layout.vaultRoom)}: ogni sistema Helix converge sulla vostra posizione.`,
        opening: 'Il blackout è iniziato. Trovate il nucleo, lanciate la PURGA, sparite.',
      };
    },
  },
  ostaggio: {
    id: 'ostaggio', title: 'MISSIONE 03 // OSTAGGIO', tagline: 'Salvataggio',
    brief: 'Nella cella è rinchiuso un informatore. Violate i nodi per sbloccarla, liberatelo e scortatelo vivo fino al punto di consegna: non combatte, e se lo lasciate solo con degli ostili viene colpito ogni round finché qualcuno non torna a scortarlo.',
    goalHeadline: 'Salvate l’informatore',
    intro: 'Nella cella della Helix Tower è rinchiuso un informatore che sa troppo per restare lì. Sbloccate la cella, tiratelo fuori e portatelo vivo all’estrazione. Non spara e non corre: ogni round che passa lontano da voi, con degli ostili attorno, è un round in cui rischia di non uscirne.',
    objectives: [
      'Violate 2 nodi di rete per sbloccare la cella.',
      'Usate LIBERA nella stanza della cella per far uscire l’informatore.',
      'Scortatelo fino al punto di consegna: se resta solo con ostili viene colpito ogni round.',
      'Portate l’informatore e ogni operativo ancora vivo nel punto di consegna.',
    ],
    mapNote: mapNote('la cella'),
    roomNames: [
      'BLOCCO DETENZIONE','CORRIDOIO GUARDIE','SALA INTERROGATORI','ARMERIA','SPOGLIATOIO',
      'CENTRALE SICUREZZA','ATRIO INGRESSO','SALA VISITE','MENSA GUARDIE','DEPOSITO PROVE',
      'ARCHIVIO SCHEDE','SALA MONITOR','ISOLAMENTO','CORRIDOIO CELLE','POSTO DI BLOCCO','SALA CONTROLLO',
    ],
    narrative(layout, roomName) {
      return {
        objective: `Violate ${NODES_REQUIRED} nodi per sbloccare la cella in ${roomName(layout.vaultRoom)}, liberate l’informatore e scortatelo vivo fino a ${roomName(layout.dropRoom)}.`,
        vaultUnlocked: `Cella di ${roomName(layout.vaultRoom)} sbloccata: l’informatore può essere liberato.`,
        opening: 'Il blackout è iniziato. Trovate la cella, liberate l’informatore, portatelo via vivo.',
      };
    },
  },
};
const missionOf = (id) => MISSIONS[id] || MISSIONS.valigetta;
const missionList = () => Object.values(MISSIONS).map(({ narrative: _narrative, roomNames: _roomNames, ...meta }) => meta);

let game = null;
if (existsSync(DATA_FILE)) {
  try { game = JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { game = null; }
}
// Una partita salvata da una versione precedente non ha la plancia (`map`) né la
// valigetta: va scartata invece di trascinarsi dietro regole che non esistono più.
if (game && (!Array.isArray(game.map) || !game.dropRoom || !game.vaultRoom)) game = null;
// Sistema a turni: le partite salvate prima non hanno l'ordine di turno né il turno attivo.
if (game && !Array.isArray(game.turnOrder)) game = null;
// Combattimento semplificato (solo INTEGRITÀ + DANNO): le partite con corazza/scudo vanno scartate.
if (game && game.players?.some((p) => typeof p.dmg !== 'number')) game = null;
// Due azioni per turno: le partite vecchie hanno un singolo slot `action`, non l'array.
if (game && game.players?.some((p) => !Array.isArray(p.actions))) game = null;
// Manovra gratuita per round: le partite vecchie non hanno lo slot dedicato.
if (game) for (const p of game.players) if (p.move === undefined) p.move = null;
// Le partite salvate prima del sistema missioni sono tutte "LA VALIGETTA".
if (game && !game.missionId) game.missionId = 'valigetta';
// Picchi d'allarme: le partite vecchie non tracciano quali soglie hanno già generato un'unità.
if (game && !Array.isArray(game.alarmSpawns)) game.alarmSpawns = [];

const nowTime = () => new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
const makeCode = () => `${['NEON','VOID','NOVA','GRID'][Math.floor(Math.random()*4)]}-${Math.floor(10+Math.random()*90)}`;
const alive = (unit) => unit.hp > 0;
const connected = (player) => Boolean(player.deviceId && Date.now() - (player.lastSeen || 0) < LINK_TIMEOUT);
const roomById = (id) => game.map.find((room) => room.id === id) || game.map[0];
const roomLabel = (id) => `${id} // ${roomById(id).name}`;
const enemiesIn = (roomId) => game.enemies.filter((e) => alive(e) && e.room === roomId);
const alliesIn = (roomId) => game.players.filter((p) => alive(p) && p.room === roomId);
const breachCount = () => game.nodeRooms.filter((id) => game.nodes[id]).length;
const vaultOpen = () => breachCount() >= (game.nodesRequired || NODES_REQUIRED);
// Dove si trova fisicamente la valigetta in questo istante: a terra o in spalla a qualcuno.
const caseRoomNow = () => {
  if (game.caseHolder) return game.players.find((p) => p.id === game.caseHolder)?.room || game.caseRoom;
  return game.caseRoom;
};
// Stesso principio della valigetta, ma per l'informatore della missione OSTAGGIO.
const hostageRoomNow = () => {
  if (!game.hostage) return null;
  if (game.hostage.holder) return game.players.find((p) => p.id === game.hostage.holder)?.room || game.hostage.room;
  return game.hostage.room;
};

function stepToward(from, destination) {
  if (from === destination) return from;
  const dist = distanceMap(game.map, destination);
  let best = from;
  let bestDistance = dist[from] ?? 99;
  for (const next of roomById(from).links) {
    if ((dist[next] ?? 99) < bestDistance) { bestDistance = dist[next]; best = next; }
  }
  return best;
}

async function save() {
  await mkdir(DATA_DIR,{recursive:true});
  await writeFile(DATA_FILE, JSON.stringify(game,null,2));
}

function publicGame() {
  if (!game) return null;
  const players = game.players.map((p)=>({...p,connected:connected(p)}));
  // `waiting` = l'operativo di cui è il turno adesso (una voce sola), per la riga di stato della plancia.
  const active = game.players.find((p)=>p.id===game.activePlayerId&&alive(p));
  const waiting = active?[active.name]:[];
  return {...game, players, waiting, caseAt:caseRoomNow(), hostageAt:hostageRoomNow(), vaultOpen:vaultOpen()};
}

function createGame(body) {
  const mission = missionOf(body.missionId);
  // Plancia disegnata da zero per questa partita, col tema (nomi di stanza) della missione.
  const layout = buildMap(mission.roomNames);
  const picks = body.players.slice(0,6);
  const players = picks.map((pick,index)=>{
    const t = templates.find((item)=>item.id===pick.characterId) || templates[index];
    return {id:`p${index+1}`, name:String(pick.name||t.callsign).slice(0,14).toUpperCase(), characterId:t.id, callsign:t.callsign, role:t.role, specialty:t.specialty, color:t.color, maxHp:t.maxHp, hp:t.maxHp, dmg:t.dmg, focus:t.focus, maxFocus:t.focus, weapon:t.weapon, ability:t.ability, abilityText:t.abilityText, room:layout.startRoom, actions:[], move:null, turnDone:false, deviceId:null, lastSeen:0};
  });
  const scale=SQUAD_SCALE[players.length]||SQUAD_SCALE[3];
  const hpScale=scale.hp;
  const dmgScale=scale.dmg;
  const roomName=(id)=>{const r=layout.rooms.find((x)=>x.id===id);return `${id} // ${r?.name||''}`;};
  const narrative={goalHeadline:mission.goalHeadline, ...mission.narrative(layout,roomName)};
  return {
    code:makeCode(), phase:'lobby', round:1, alarm:ALARM_START, breach:0, alarmSpawns:[], hpScale, dmgScale,
    turnOrder:players.map((p)=>p.id), activePlayerId:players[0]?.id||null,
    missionId:mission.id, title:mission.title, location:`HELIX TOWER // SETTORE ${['NORD','SUD','EST','OVEST'][Math.floor(Math.random()*4)]}`,
    objective:narrative.objective, narrative,
    map:layout.rooms, startRoom:layout.startRoom, vaultRoom:layout.vaultRoom, dropRoom:layout.dropRoom,
    nodeRooms:layout.nodeRooms, nodesRequired:NODES_REQUIRED,
    nodes:Object.fromEntries(layout.nodeRooms.map((id)=>[id,false])),
    caseRoom:layout.vaultRoom, caseHolder:null, caseDelivered:false, purged:false, lockdown:false,
    hostage:{room:layout.vaultRoom, holder:null, hp:HOSTAGE_MAX_HP, maxHp:HOSTAGE_MAX_HP, freed:false, delivered:false},
    players,
    enemies:buildEnemies(layout,layout.rooms,hpScale,dmgScale,players.length),
    feed:[{time:nowTime(),tone:'system',text:`Canale clandestino aperto. Squadra in posizione a ${roomName(layout.startRoom)}.`}],
    event:{title:'FINESTRA OPERATIVA',text:'Il blackout copre l’infiltrazione, ma l’obiettivo è ancora sigillato: servono i nodi.'},
    createdAt:Date.now(),updatedAt:Date.now(),
  };
}

function log(text,tone='system') {
  game.feed.unshift({time:nowTime(),text,tone});
  game.feed = game.feed.slice(0,10);
}

function damageEnemy(enemy,dmg,actor) {
  enemy.hp=Math.max(0,enemy.hp-dmg);
  log(`${actor} infligge ${dmg} danni a ${enemy.name} in ${enemy.room}.`, 'combat');
  if(enemy.hp===0) log(`${enemy.name} neutralizzato in ${enemy.room}.`, 'success');
}

function revive(target,healer,amount) {
  target.hp=Math.min(target.maxHp,amount);
  log(`${healer} rianima ${target.name} in ${target.room}.`, 'success');
}

function breachNode(roomId,actor){
  game.nodes[roomId]=true;
  game.breach=breachCount();
  log(`${actor} viola il nodo di ${roomLabel(roomId)} — nodi ${game.breach}/${game.nodeRooms.length}.`, 'hack');
  if(vaultOpen()&&!game.vaultAnnounced){game.vaultAnnounced=true;log(game.narrative.vaultUnlocked,'success');}
}

// La valigetta cade dove cade chi la porta: recuperarla è un problema in più.
function dropCase(reason){
  const holder=game.players.find((p)=>p.id===game.caseHolder);
  if(!holder) return;
  game.caseRoom=holder.room;
  game.caseHolder=null;
  log(`La valigetta cade in ${roomLabel(holder.room)}: ${reason}.`,'danger');
}

// L'informatore non si muove da solo: se chi lo scorta cade, resta dov'è.
function dropHostage(reason){
  const holder=game.players.find((p)=>p.id===game.hostage.holder);
  if(!holder) return;
  game.hostage.room=holder.room;
  game.hostage.holder=null;
  log(`L’informatore resta indietro in ${roomLabel(holder.room)}: ${reason}.`,'danger');
}

// MANOVRA: lo spostamento del turno si risolve subito. Sganciarsi da una stanza presidiata costa.
function applyMove(p){
  if(!p.move) return;
  const destination=p.move.roomId;
  if(!roomById(p.room).links.includes(destination)){
    log(`${p.name} non trova una porta verso ${destination}: resta in ${p.room}.`,'system');
    return;
  }
  const guards=enemiesIn(p.room);
  if(guards.length){
    const hit=Math.max(1,Math.round(guards[0].damage*0.6));
    p.hp=Math.max(0,p.hp-hit);
    log(`${p.name} si sgancia sotto il fuoco di ${guards[0].name}: ${hit} danni.`,'danger');
  }
  p.room=destination;
  if(alive(p)) log(`${p.name} raggiunge ${roomLabel(destination)}${game.caseHolder===p.id?' con la valigetta':''}${game.hostage.holder===p.id?' con l’informatore':''}.`,'system');
  else {
    if(game.caseHolder===p.id) dropCase(`${p.name} è caduto nel passaggio`);
    if(game.hostage.holder===p.id) dropHostage(`${p.name} è caduto nel passaggio`);
    log(`${p.name} crolla nel passaggio verso ${destination}.`,'danger');
  }
}

// AZIONE: ogni azione del turno (fino a ACTIONS_PER_TURN) si risolve subito all'invio, sempre
// limitata alla stanza occupata in quel momento.
function applyAction(p,action){
  if(!alive(p)) return;
  if(!action||action.type==='move') return;
  {
    const room=roomById(p.room);
    const hostiles=enemiesIn(p.room);
    const target=hostiles.find((e)=>e.id===action.targetId)||hostiles[0];

    if(action.type==='attack'){
      if(!target) log(`${p.name} non ha bersagli in ${p.room}: tiene la posizione.`,'system');
      else damageEnemy(target,p.dmg,p.name);
    }

    if(action.type==='grab'){
      if(game.caseHolder) log(`${p.name}: la valigetta è già in mano a un compagno.`,'system');
      else if(caseRoomNow()!==p.room) log(`${p.name} non trova la valigetta in ${p.room}.`,'system');
      else if(p.room===game.vaultRoom&&!vaultOpen()) log(`${p.name}: la teca di ${p.room} è ancora sigillata.`,'system');
      else{
        const fresh=!game.caseTaken;
        game.caseHolder=p.id;game.caseRoom=null;game.caseTaken=true;
        if(fresh) log(`${p.name} stacca la valigetta MNEMOSYNE dalla teca.`,'danger');
        else log(`${p.name} recupera la valigetta in ${roomLabel(p.room)}.`,'success');
      }
    }

    if(action.type==='purge'){
      if(game.missionId!=='nucleo') log(`${p.name}: nessuna PURGA disponibile in questa missione.`,'system');
      else if(game.purged) log(`${p.name}: il nucleo è già stato purgato.`,'system');
      else if(p.room!==game.vaultRoom) log(`${p.name} non è nel nucleo dati.`,'system');
      else if(!vaultOpen()) log(`${p.name}: il firewall del nucleo è ancora attivo.`,'system');
      else{
        game.purged=true;
        log(game.narrative.purged,'danger');
      }
    }

    if(action.type==='free'){
      if(game.missionId!=='ostaggio') log(`${p.name}: nessun informatore da liberare in questa missione.`,'system');
      else if(game.hostage.delivered) log(`${p.name}: l’informatore è già stato consegnato.`,'system');
      else if(game.hostage.holder) log(`${p.name}: l’informatore è già scortato da un compagno.`,'system');
      else if(hostageRoomNow()!==p.room) log(`${p.name} non trova l’informatore in ${p.room}.`,'system');
      else if(!game.hostage.freed&&p.room===game.vaultRoom&&!vaultOpen()) log(`${p.name}: la cella di ${p.room} è ancora sigillata.`,'system');
      else{
        const fresh=!game.hostage.freed;
        game.hostage.holder=p.id;game.hostage.freed=true;
        if(fresh) log(`${p.name} libera l’informatore.`,'danger');
        else log(`${p.name} riprende la scorta dell’informatore in ${roomLabel(p.room)}.`,'success');
      }
    }

    if(action.type==='hack'){
      if(!room.node) log(`${p.name} non trova terminali in ${roomLabel(p.room)}.`,'system');
      else if(game.nodes[p.room]) log(`${p.name}: il nodo di ${p.room} è già violato.`,'system');
      else {
        breachNode(p.room,p.name);
        const drone=hostiles.find((e)=>e.type==='DRONE');
        if(drone) damageEnemy(drone,HACK_DRONE_DAMAGE,p.name);
      }
    }

    if(action.type==='heal'){
      p.focus=Math.max(0,p.focus-2);
      // Priorità ai caduti nella stessa stanza: la barella non attraversa i corridoi.
      const down=game.players.filter((x)=>!alive(x)&&x.room===p.room)[0];
      if(down) revive(down,p.name,Math.round(down.maxHp*REVIVE_RATIO));
      else{
        const wounded=[...alliesIn(p.room)].sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
        if(!wounded){ log(`${p.name} non ha nessuno da curare in ${p.room}.`,'system'); }
        else{
          const amount=HEAL_AMOUNT;
          wounded.hp=Math.min(wounded.maxHp,wounded.hp+amount);
          log(`${p.name} ripristina ${amount} integrità a ${wounded.name} in ${p.room}.`,'success');
        }
      }
    }

    if(action.type==='ability'){
      p.focus=Math.max(0,p.focus-3);
      if(p.characterId==='ghost'){
        if(target) damageEnemy(target,26,p.name);
        else log(`${p.name} svanisce nelle ombre di ${p.room}.`,'system');
      }
      else if(p.characterId==='chrome'){
        if(target) damageEnemy(target,40,p.name);
        else log(`${p.name} scarica il cromo a vuoto: nessun ostile in ${p.room}.`,'system');
      }
      else if(p.characterId==='cipher'){
        // La guerra di rete raggiunge anche la stanza collegata: il CIPHER non deve esporsi.
        const reach=[p.room,...room.links];
        const nodeRoom=reach.find((id)=>roomById(id).node&&!game.nodes[id]);
        if(nodeRoom) breachNode(nodeRoom,p.name);
        else log(`${p.name} lancia uno zero-day ma non aggancia nodi da ${p.room}.`,'system');
        for(const e of game.enemies.filter((x)=>alive(x)&&x.type==='DRONE'&&reach.includes(x.room))) damageEnemy(e,25,p.name);
      }
      else if(p.characterId==='ripper'){
        for(const ally of game.players.filter((x)=>x.room===p.room)){
          if(alive(ally)) ally.hp=Math.min(ally.maxHp,ally.hp+18);
          else revive(ally,p.name,Math.round(ally.maxHp*LAZARUS_RATIO));
        }
        log(`${p.name} attiva Protocollo Lazarus in ${roomLabel(p.room)}.`,'success');
      }
      else if(p.characterId==='face'){
        game.alarm=Math.max(0,game.alarm-ALARM_FACE_RELIEF);
        for(const e of hostiles) e.distracted=true;
        log(`${p.name} inietta credenziali sintetiche: allarme in calo, ostili di ${p.room} distratti.`,'hack');
      }
      else if(p.characterId==='driver'){
        const reach=[p.room,...room.links];
        const swarm=game.enemies.filter((e)=>alive(e)&&reach.includes(e.room)).slice(0,2);
        if(!swarm.length) log(`${p.name} lancia lo sciame MANTA ma non trova ostili nel settore.`,'system');
        for(const e of swarm) damageEnemy(e,18,p.name);
      }
    }
  }
}

// FASE 3 // RISPOSTA HELIX
// Gli ostili NON pattugliano: ognuno resta di presidio nella propria stanza finché qualcuno
// non ci mette piede. Da quel momento è ingaggiato per sempre e insegue la squadra di stanza
// in stanza, una porta per round. Chi porta la valigetta è sempre il bersaglio preferito.
function resolveEnemies(){
  for(const enemy of game.enemies.filter(alive)){
    if(enemy.distracted){ enemy.distracted=false; log(`${enemy.name} perde il contatto: turno saltato.`,'hack'); continue; }
    const inRoom=alliesIn(enemy.room);
    if(inRoom.length){
      if(!enemy.locked){ enemy.locked=true; log(`${enemy.name} ingaggia la squadra in ${roomLabel(enemy.room)}.`,'danger'); }
      const carrier=inRoom.find((p)=>p.id===game.caseHolder||p.id===game.hostage.holder);
      const target=carrier||inRoom[(game.round+enemy.threat)%inRoom.length];
      enemy.chasing=target.id;
      target.hp=Math.max(0,target.hp-enemy.damage);
      log(`${enemy.name} colpisce ${target.name} in ${enemy.room}: ${enemy.damage} danni.`,'danger');
      if(target.hp===0){
        log(`${target.name} è fuori combattimento in ${enemy.room}.`,'danger');
        if(game.caseHolder===target.id) dropCase(`${target.name} è a terra`);
        if(game.hostage.holder===target.id) dropHostage(`${target.name} è a terra`);
      }
      continue;
    }
    // MISSIONE OSTAGGIO: nessun alleato vivo in stanza, ma l'informatore libero e non scortato
    // sì — resta in balìa degli ostili finché qualcuno non torna a proteggerlo.
    if(game.missionId==='ostaggio'&&game.hostage.freed&&!game.hostage.delivered&&!game.hostage.holder&&hostageRoomNow()===enemy.room){
      game.hostage.hp=Math.max(0,game.hostage.hp-HOSTAGE_UNESCORTED_DAMAGE);
      log(`${enemy.name} colpisce l’informatore lasciato solo in ${roomLabel(enemy.room)}: ${HOSTAGE_UNESCORTED_DAMAGE} danni.`,'danger');
      continue;
    }
    // Mai ingaggiato: resta di guardia dove si trova. Nessun movimento autonomo.
    if(!enemy.locked) continue;
    let target=game.players.find((p)=>p.id===enemy.chasing&&alive(p));
    if(!target){
      // Il bersaglio è caduto: l'unità aggancia l'operativo raggiungibile più vicino.
      const dist=distanceMap(game.map,enemy.room);
      target=game.players.filter(alive).map((p)=>({p,d:dist[p.room]??99})).sort((a,b)=>a.d-b.d)[0]?.p;
      if(!target){ enemy.chasing=null; continue; }
      enemy.chasing=target.id;
    }
    const step=stepToward(enemy.room,target.room);
    if(step!==enemy.room){ enemy.room=step; log(`${enemy.name} insegue ${target.name} verso ${roomLabel(step)}.`,'danger'); }
  }
}

// FASE HELIX + chiusura del round: parte quando tutti gli operativi hanno finito il turno
// (o dalla plancia con CHIUDI ROUND). Risolve i nemici, poi aggiorna allarme/breccia/round.
function runEnemyPhase() {
  resolveEnemies();

  // L'allarme sale solo del respiro della torre: +4 a ogni round, nient'altro.
  game.alarm=Math.min(100,game.alarm+ALARM_PER_ROUND);
  game.breach=breachCount();
  game.round+=1;
  game.players.forEach((p)=>{p.actions=[];p.move=null;p.turnDone=false;p.focus=Math.min(p.maxFocus,p.focus+1);});

  // LOCKDOWN: oltre LOCKDOWN_ALARM la torre allerta ogni presidio, anche quello mai ingaggiato.
  // Da qui in poi tutti i nemici convergono verso la stanza dei Player.
  if(!game.lockdown&&game.alarm>=LOCKDOWN_ALARM){
    game.lockdown=true;
    for(const e of game.enemies) e.locked=true;
    log(`LOCKDOWN: allarme al ${game.alarm}%. Ogni unità Helix del settore è allertata e converge sulla squadra.`,'danger');
  }

  // CONSEGNA: la valigetta / l'informatore raggiunge il punto di raccolta a fine round.
  if(game.missionId==='valigetta'&&!game.caseDelivered&&game.caseHolder&&game.players.find((p)=>p.id===game.caseHolder)?.room===game.dropRoom){
    game.caseDelivered=true;game.caseRoom=game.dropRoom;game.caseHolder=null;
    log(`Valigetta MNEMOSYNE consegnata in ${roomLabel(game.dropRoom)}. Estraete la squadra.`,'success');
  }
  if(game.missionId==='ostaggio'&&!game.hostage.delivered&&game.hostage.holder&&hostageRoomNow()===game.dropRoom){
    game.hostage.delivered=true;game.hostage.room=game.dropRoom;game.hostage.holder=null;
    log(`Informatore consegnato in ${roomLabel(game.dropRoom)}. Estraete la squadra.`,'success');
  }

  const living=game.players.filter(alive);
  const extracted=living.length>0&&living.every((p)=>p.room===game.dropRoom);
  const objectiveDone=game.missionId==='valigetta'?game.caseDelivered:game.missionId==='nucleo'?game.purged:game.hostage.delivered;
  const hostageLost=game.missionId==='ostaggio'&&game.hostage.freed&&!game.hostage.delivered&&game.hostage.hp<=0;
  if(objectiveDone&&extracted){
    game.phase='victory';
    const victoryLine=game.missionId==='valigetta'?`Squadra estratta da ${roomLabel(game.dropRoom)}. MNEMOSYNE è nostro.`
      :game.missionId==='nucleo'?`Squadra estratta da ${roomLabel(game.dropRoom)}. Il nucleo Helix è stato cancellato.`
      :`Squadra estratta da ${roomLabel(game.dropRoom)} con l’informatore vivo. Missione riuscita.`;
    log(victoryLine,'success');
  }
  else if(!living.length||game.alarm>=100||hostageLost){
    game.phase='defeat';
    log(hostageLost?'L’informatore non ce l’ha fatta: la missione è persa.':'Protocollo Helix completato. La squadra è perduta.','danger');
  }
  else{
    // TRACCIA HELIX: a ogni soglia d'allarme (25/35/45/55/65/75%) una nuova unità entra in
    // una stanza a caso e parte subito a caccia. Ogni soglia scatta una volta sola.
    let alarmSpawnEvent=null;
    for(const thr of ALARM_SPAWN_THRESHOLDS){
      if(game.alarm<thr||game.alarmSpawns.includes(thr)) continue;
      game.alarmSpawns.push(thr);
      const room=game.map[Math.floor(Math.random()*game.map.length)];
      const idx=game.enemies.filter((e)=>e.id.startsWith('hunter-')).length+1;
      const unit=spawnEnemy('hunter',room.id,idx,game.hpScale||1,game.dmgScale||1);
      unit.locked=true;
      game.enemies.push(unit);
      log(`Allarme al ${thr}%: ${unit.name} entra da ${roomLabel(room.id)} e vi dà la caccia.`,'danger');
      alarmSpawnEvent={title:'TRACCIA HELIX',text:`Allarme ${thr}%: ${unit.name} entra da ${roomLabel(room.id)} e parte a caccia.`};
    }

    let progressEvent=null;
    if(game.missionId==='valigetta'){
      if(game.caseDelivered) progressEvent={title:'ESTRAZIONE APERTA',text:`Portate ogni operativo vivo in ${roomLabel(game.dropRoom)} per chiudere l’operazione.`};
      else if(game.caseHolder) progressEvent={title:'CARICO IN MANO',text:`Portate la valigetta fino a ${game.dropRoom} senza farvi inchiodare dai presidi.`};
      else if(vaultOpen()) progressEvent={title:'TECA APERTA',text:`La cifratura è caduta: la valigetta in ${roomLabel(game.vaultRoom)} è prelevabile.`};
    }
    else if(game.missionId==='nucleo'){
      if(game.purged) progressEvent={title:'PURGA LANCIATA',text:`Ogni sistema Helix converge sul nucleo. Sparite da ${roomLabel(game.dropRoom)} prima che sia troppo tardi.`};
      else if(vaultOpen()) progressEvent={title:'NUCLEO APERTO',text:`Il firewall è caduto: lanciate la PURGA dal nucleo in ${roomLabel(game.vaultRoom)}.`};
    }
    else if(game.missionId==='ostaggio'){
      if(game.hostage.delivered) progressEvent={title:'ESTRAZIONE APERTA',text:`Portate ogni operativo vivo in ${roomLabel(game.dropRoom)} per chiudere l’operazione.`};
      else if(game.hostage.holder) progressEvent={title:'SOTTO SCORTA',text:`L’informatore ha ${game.hostage.hp}/${game.hostage.maxHp} HP: non lasciatelo mai solo finché non è in ${roomLabel(game.dropRoom)}.`};
      else if(game.hostage.freed) progressEvent={title:'INFORMATORE ABBANDONATO',text:`L’informatore è solo in ${roomLabel(hostageRoomNow())}: tornate a scortarlo prima che sia troppo tardi.`};
      else if(vaultOpen()) progressEvent={title:'CELLA APERTA',text:`La cifratura è caduta: l’informatore in ${roomLabel(game.vaultRoom)} può essere liberato.`};
    }
    if(alarmSpawnEvent) game.event=alarmSpawnEvent;
    else if(progressEvent) game.event=progressEvent;
    else if(game.lockdown) game.event={title:'LOCKDOWN',text:`Allarme al ${game.alarm}%: ogni presidio è allertato e si muove verso di voi.`};
    else game.event={title:'PRESSIONE HELIX',text:`Allarme ${game.alarm}%. Nodi ${game.breach}/${game.nodeRooms.length}, ne servono ${game.nodesRequired}.`};
  }
  game.updatedAt=Date.now();
}

// Dopo la fase Helix: se la partita è ancora aperta, si riparte dal primo operativo vivo
// dell'ordine di turno (sempre lo stesso giro, in cerchio).
function startNextRound(){
  if(game.phase!=='active') return;
  game.players.forEach((p)=>{p.turnDone=false;});
  const firstAlive=game.players.find((p)=>alive(p));
  game.activePlayerId=firstAlive?firstAlive.id:game.turnOrder[0];
  game.updatedAt=Date.now();
}

// Fa avanzare il turno all'operativo vivo successivo nell'ordine fisso. Quando il giro è
// completo risolve la fase Helix e apre il round nuovo. Usata dagli operativi (FINE TURNO)
// e dalla plancia (SALTA TURNO).
function advanceTurn(){
  if(!game||game.phase!=='active') return;
  const order=game.turnOrder||game.players.map((p)=>p.id);
  const curIdx=order.indexOf(game.activePlayerId);
  const cur=game.players.find((p)=>p.id===game.activePlayerId);
  if(cur) cur.turnDone=true;
  for(let i=curIdx+1;i<order.length;i++){
    const np=game.players.find((x)=>x.id===order[i]);
    if(np&&alive(np)){
      game.activePlayerId=np.id;
      np.actions=[];np.move=null;
      game.updatedAt=Date.now();
      return;
    }
  }
  // Giro completo: rispondono gli Helix, poi si riparte dal primo.
  runEnemyPhase();
  startNextRound();
}

// Preferisce le reti domestiche reali (Wi-Fi/Ethernet) rispetto a VPN e interfacce virtuali.
function networkCandidates(){
  const skip=/^(utun|awdl|llw|bridge|ap\d|vmnet|vboxnet|docker)/i;
  const out=[];
  for(const [name,group] of Object.entries(networkInterfaces())){
    if(skip.test(name)) continue;
    for(const item of group||[]){
      if(item.family!=='IPv4'||item.internal) continue;
      const a=item.address;
      const rank=a.startsWith('192.168.')?0:a.startsWith('10.')?1:/^172\.(1[6-9]|2\d|3[01])\./.test(a)?2:3;
      out.push({url:`http://${a}:${PORT}`,rank,name});
    }
  }
  out.sort((x,y)=>x.rank-y.rank);
  return out.map((x)=>x.url);
}
function getNetworkUrl(){ return networkCandidates()[0] || `http://localhost:${PORT}`; }

async function jsonBody(req){let raw='';for await(const chunk of req)raw+=chunk;if(!raw)return {};return JSON.parse(raw);}
function send(res,status,payload){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}

async function api(req,res,url){
  try{
    if(req.method==='GET'&&url.pathname==='/api/state'){
      return send(res,200,{game:publicGame(),templates,enemyRoster:ENEMY_ROSTER,missions:missionList(),networkUrl:getNetworkUrl(),networkUrls:networkCandidates()});
    }
    // Livello d'allarme in testo semplice (0-100), o -1 se nessuna partita: lo legge il ponte seriale dell'Arduino.
    if(req.method==='GET'&&url.pathname==='/api/alarm'){
      res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
      return res.end(String(game?Math.round(game.alarm):-1));
    }
    if(req.method==='POST'&&url.pathname==='/api/setup'){
      const body=await jsonBody(req);
      if(!Array.isArray(body.players)||body.players.length<2||body.players.length>6)return send(res,400,{error:'Servono da 2 a 6 giocatori.'});
      if(body.players.some((p)=>!p.characterId||!templates.some((t)=>t.id===p.characterId)))return send(res,400,{error:'Assegna una scheda a ogni operativo.'});
      if(new Set(body.players.map((p)=>p.characterId)).size!==body.players.length)return send(res,400,{error:'Ogni personaggio deve essere unico.'});
      game=createGame(body);await save();return send(res,200,{game:publicGame(),networkUrl:getNetworkUrl()});
    }
    if(req.method==='POST'&&url.pathname==='/api/join'){
      const body=await jsonBody(req);if(!game||body.code?.toUpperCase()!==game.code)return send(res,404,{error:'Codice partita non valido.'});
      const p=game.players.find((x)=>x.id===body.playerId);if(!p)return send(res,404,{error:'Operativo non trovato.'});
      if(p.deviceId&&p.deviceId!==body.deviceId&&connected(p))return send(res,409,{error:'Questo operativo è già collegato da un altro telefono.'});
      const returning=p.deviceId===body.deviceId;
      p.deviceId=body.deviceId;p.lastSeen=Date.now();
      if(!returning) log(`${p.name} collegato al canale.`,'success');
      await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/ping'){
      const body=await jsonBody(req);const p=game?.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);
      if(!p)return send(res,404,{error:'Sessione non trovata.'});
      p.lastSeen=Date.now();
      return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/start'){
      const body=await jsonBody(req);if(!game||body.code!==game.code)return send(res,404,{error:'Partita non trovata.'});
      if(game.phase!=='lobby')return send(res,409,{error:'Operazione già avviata.'});
      // Si può avviare anche senza tutti i telefoni (o senza nessuno) per ispezionare plancia/mappa:
      // il turno resta fermo sull'operativo di mano finché il suo telefono non gioca (o la plancia salta).
      game.phase='active';
      game.turnOrder=game.players.map((p)=>p.id);
      game.activePlayerId=(game.players.find((p)=>alive(p))||game.players[0]).id;
      game.players.forEach((p)=>{p.actions=[];p.move=null;p.turnDone=false;});
      log(game.narrative.opening,'combat');await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/action'){
      const body=await jsonBody(req);if(!game||body.code!==game.code||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const p=game.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);if(!p||!alive(p))return send(res,403,{error:'Accesso operativo negato.'});
      if(game.activePlayerId!==p.id)return send(res,409,{error:'Non è il tuo turno.'});
      const allowed=['move','attack','hack','heal','ability','grab','purge','free'];if(!allowed.includes(body.type))return send(res,400,{error:'Azione non valida.'});
      // MANOVRA: nel proprio turno si può fare una sola manovra (prima o dopo l'azione).
      // Si risolve subito: l'operativo si sposta davvero e può subire il fuoco di sganciamento.
      if(body.type==='move'){
        if(p.move)return send(res,409,{error:'Manovra già eseguita in questo turno.'});
        if(!roomById(p.room).links.includes(body.roomId))return send(res,400,{error:'Nessuna porta collega la tua stanza a quella.'});
        p.move={roomId:body.roomId};p.lastSeen=Date.now();
        applyMove(p);
        await save();return send(res,200,{game:publicGame()});
      }
      if(p.actions.length>=ACTIONS_PER_TURN)return send(res,409,{error:`Hai già usato le ${ACTIONS_PER_TURN} azioni di questo turno.`});
      // La manovra, se fatta, è già stata risolta: l'azione ha effetto nella stanza attuale.
      const actRoom=p.room;
      if(body.type==='ability'&&p.focus<3)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='heal'&&p.focus<2)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='attack'&&!enemiesIn(actRoom).length)return send(res,400,{error:'Nessun ostile nella tua stanza.'});
      if(body.type==='hack'&&!roomById(actRoom).node)return send(res,400,{error:'Nessun terminale in questa stanza.'});
      if(body.type==='hack'&&game.nodes[actRoom])return send(res,400,{error:'Il nodo di questa stanza è già violato.'});
      if(body.type==='grab'&&game.caseHolder)return send(res,400,{error:'La valigetta è già in mano a un compagno.'});
      if(body.type==='grab'&&caseRoomNow()!==actRoom)return send(res,400,{error:'La valigetta non è in questa stanza.'});
      if(body.type==='grab'&&actRoom===game.vaultRoom&&!vaultOpen())return send(res,400,{error:`Teca sigillata: violate ${game.nodesRequired} nodi.`});
      if(body.type==='purge'&&game.missionId!=='nucleo')return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='purge'&&actRoom!==game.vaultRoom)return send(res,400,{error:'Devi essere nel nucleo dati.'});
      if(body.type==='purge'&&!vaultOpen())return send(res,400,{error:`Firewall attivo: violate ${game.nodesRequired} nodi.`});
      if(body.type==='purge'&&game.purged)return send(res,400,{error:'Il nucleo è già stato purgato.'});
      if(body.type==='free'&&game.missionId!=='ostaggio')return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='free'&&game.hostage.holder)return send(res,400,{error:'L’informatore è già scortato da un compagno.'});
      if(body.type==='free'&&hostageRoomNow()!==actRoom)return send(res,400,{error:'L’informatore non è in questa stanza.'});
      if(body.type==='free'&&!game.hostage.freed&&actRoom===game.vaultRoom&&!vaultOpen())return send(res,400,{error:`Cella sigillata: violate ${game.nodesRequired} nodi.`});
      const action={type:body.type,targetId:body.targetId||null,roomId:body.roomId||null};
      p.actions.push(action);p.lastSeen=Date.now();
      applyAction(p,action);
      await save();return send(res,200,{game:publicGame()});
    }
    // FINE TURNO: l'operativo di mano chiude il suo turno e passa la mano.
    if(req.method==='POST'&&url.pathname==='/api/endturn'){
      const body=await jsonBody(req);if(!game||body.code!==game.code||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const p=game.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);if(!p)return send(res,403,{error:'Accesso operativo negato.'});
      if(game.activePlayerId!==p.id)return send(res,409,{error:'Non è il tuo turno.'});
      p.lastSeen=Date.now();log(`${p.name} chiude il turno.`,'system');
      advanceTurn();
      await save();return send(res,200,{game:publicGame()});
    }
    // SALTA TURNO dalla plancia: salta l'operativo di mano (telefono offline o assente).
    if(req.method==='POST'&&url.pathname==='/api/skipturn'){
      if(!game||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const skipped=game.players.find((x)=>x.id===game.activePlayerId);
      if(skipped) log(`${skipped.name}: turno saltato dalla plancia.`,'system');
      advanceTurn();
      await save();return send(res,200,{game:publicGame()});
    }
    // CHIUDI ROUND dalla plancia: gli operativi che non hanno ancora giocato perdono il turno,
    // rispondono subito gli Helix e si apre il round nuovo.
    if(req.method==='POST'&&url.pathname==='/api/resolve'){
      if(!game||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      runEnemyPhase();startNextRound();await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/reset'){game=null;await save();return send(res,200,{ok:true});}
    return send(res,404,{error:'Endpoint non trovato.'});
  }catch(error){console.error(error);return send(res,500,{error:'Errore del sistema di gioco.'});}
}

let vite;
if(process.env.NODE_ENV!=='production'){
  const {createServer:createVite}=await import('vite');
  // HMR disattivato: il suo WebSocket gira su una porta separata non raggiungibile dai
  // telefoni sulla rete locale e riempirebbe ogni console di errori di riconnessione.
  vite=await createVite({server:{middlewareMode:true,hmr:false},appType:'spa'});
}

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(url.pathname.startsWith('/api/'))return api(req,res,url);
  if(vite)return vite.middlewares(req,res,()=>{});
  try{
    const requested=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'');
    let filePath=join(process.cwd(),'dist',requested);
    if(!existsSync(filePath))filePath=join(process.cwd(),'dist','index.html');
    const data=await readFile(filePath);res.writeHead(200,{'Content-Type':mime[extname(filePath)]||'application/octet-stream'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`\nROVERPUNK operativo:`);
  console.log(`  Plancia:  http://localhost:${PORT}`);
  for(const candidate of networkCandidates()) console.log(`  Telefoni: ${candidate}/?mode=player`);
  console.log('');
});

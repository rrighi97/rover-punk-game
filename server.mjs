import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = new URL('./data/', import.meta.url);
const DATA_FILE = new URL('./data/game-state.json', import.meta.url);

// Finestra entro cui un telefono è considerato collegato (3 ping persi).
const LINK_TIMEOUT = 15000;
// Un giocatore che mette giù il telefono per un attimo resta parte del round: la squadra
// lo aspetta fino a questa soglia invece di risolvere il turno senza di lui.
const LINK_GRACE = 45000;

// TARATURA UNICA
// Non esistono più livelli di minaccia selezionabili: ROVERPUNK ha una sola difficoltà,
// pensata per essere dura. Ogni costante qui sotto è una leva della pressione sulla squadra.
const ROUND_SECONDS = 60;          // tempo massimo per decidere
const ALARM_START = 15;            // allarme iniziale
const ALARM_PER_ROUND = 3;         // pressione base di ogni round
const ALARM_PER_CONTACT = 1;       // ogni ostile che a fine round è nella vostra stanza
const ALARM_PER_EXPOSED = 1;       // per operativo fermo in zona esposta
const ALARM_CARRY = 1;             // la valigetta emette: costa allarme ogni round
const ALARM_ON_GRAB = 10;          // picco nel momento in cui viene staccata dalla teca
const ALARM_ON_DISENGAGE = 3;      // sganciarsi da una stanza presidiata (una volta per round)
const ALARM_FACE_RELIEF = 16;      // Identità sintetica del FACE
const ALARM_CHROME_SPIKE = 9;      // Sovraccarico cromo
const LOCKDOWN_ALARM = 85;         // oltre questa soglia la torre sveglia tutti
// Sulla plancia procedurale (fino a 16 stanze) più operativi si dividono su più fronti in
// parallelo: senza un tetto, ogni stanza in contatto pesa a testa e le squadre numerose
// pagherebbero più allarme delle piccole invece di beneficiare del numero. Il conteggio dei
// contatti che pesa sull'allarme è quindi limitato, non lineare.
const ALARM_CONTACT_CAP = 3;
const NODES_REQUIRED = 2;          // nodi da violare per sbloccare la teca
const SHIELD_DECAY = 4;
const REVIVE_RATIO = 0.25;
const LAZARUS_RATIO = 0.4;

// MISSIONE 02 // GHOST PROTOCOL
const GHOST_PURGE_ALARM_SPIKE = 12; // picco quando la PURGA viene lanciata
const GHOST_ALARM_PER_ROUND_BONUS = 1; // pressione extra ogni round dopo la purga

// MISSIONE 03 // OSTAGGIO
const ALARM_ON_FREE = 10;          // picco quando l'informatore viene liberato
const HOSTAGE_MAX_HP = 70;
const HOSTAGE_UNESCORTED_DAMAGE = 18; // danno subito se lasciato solo con ostili

// GENERAZIONE PROCEDURALE DELLA PLANCIA
// La mappa non è più fissa: a ogni partita viene disegnata da zero su una griglia di celle.
// Una stanza occupa una cella (quadrata) oppure due celle adiacenti (rettangolare, quindi
// esattamente il doppio). Le stanze fisicamente vicine NON sono automaticamente collegate:
// un albero di copertura garantisce che tutto sia raggiungibile, poi solo una parte dei muri
// restanti diventa una porta. Il resto sono pareti cieche.
const GRID_COLS = 4;
const GRID_ROWS = 4;
const DOUBLE_ROOM_CHANCE = 0.6;    // quanto spesso una stanza diventa rettangolare
const EXTRA_DOOR_CHANCE = 0.28;    // quanti muri in più (oltre all'albero) diventano porte

const ROOM_NAMES = [
  'CONDOTTI','SERVER FARM','SICUREZZA','ACCESSO','NEXUS','LAB NERO','GARAGE','ARCHIVIO',
  'PONTE','MENSA','DEPOSITO','CELLE','ATRIO','TERMICA','OFFICINA','CRIOSALA','HANGAR',
  'SALA POMPE','TORRE RADIO','MAGAZZINO','CAMERA BIANCA','SMISTAMENTO',
];

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];

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

// Passo 4: identità delle stanze e assegnazione dei ruoli tattici (partenza, teca, consegna,
// nodi, coperture, zone esposte). Teca e consegna finiscono sempre agli antipodi del percorso.
function buildMap() {
  const { grid, draft } = fillGrid();
  const adjacency = neighbours(grid, draft);
  const doors = carveDoors(draft, adjacency);

  const ordered = [...draft].sort((a, b) => a.row - b.row || a.col - b.col);
  const names = shuffle(ROOM_NAMES);
  const rooms = ordered.map((r, i) => ({
    id: `${'ABCDEF'[r.col - 1]}${String(i + 1).padStart(2, '0')}`,
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

  // La teca è la stanza più lontana dall'ingresso: bisogna attraversare il livello.
  const vault = [...reachable].sort((a, b) => (fromStart[b.id] || 0) - (fromStart[a.id] || 0))[0];
  vault.vault = true;
  const fromVault = distanceMap(rooms, vault.id);
  // Il punto di consegna è lontano dalla teca: recuperare non basta, bisogna tornare indietro.
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

const ENEMY_KINDS = {
  elite: { name: 'CUSTODE K-9', type: 'ÉLITE',     hp: 150, armor: 8, damage: 22, threat: 5 },
  sec:   { name: 'HELIX SEC-4', type: 'FANTERIA',  hp: 84,  armor: 5, damage: 16, threat: 3 },
  drone: { name: 'WASP D-2',    type: 'DRONE',     hp: 62,  armor: 3, damage: 13, threat: 2 },
  razor: { name: 'HELIX RAZOR', type: 'FANTERIA',  hp: 78,  armor: 4, damage: 17, threat: 3 },
};
function spawnEnemy(kind, room, index, hpScale, dmgScale) {
  const base = ENEMY_KINDS[kind];
  const hp = Math.round(base.hp * hpScale);
  return {
    id: `${kind}-${index}`,
    name: index > 1 ? `${base.name}-${index}` : base.name,
    type: base.type, hp, maxHp: hp, armor: base.armor,
    damage: Math.round(base.damage * dmgScale), threat: base.threat,
    room, home: room, locked: false, chasing: null,
  };
}

// I presidi stanno dove c'è qualcosa da difendere: teca e nodi. Nessuno pattuglia l'ingresso.
function buildEnemies(layout, rooms, hpScale, dmgScale, squadSize) {
  const list = [spawnEnemy('elite', layout.vaultRoom, 1, hpScale, dmgScale)];
  layout.nodeRooms.forEach((roomId, i) => {
    list.push(spawnEnemy(i % 2 === 0 ? 'sec' : 'drone', roomId, i + 1, hpScale, dmgScale));
  });
  // Un presidio in più sullo snodo più trafficato, ma solo per le squadre numerose: in tre
  // ogni guardia in più è un ingaggio che non ci si può permettere.
  const hub = rooms.filter((r) => !r.start && !r.vault && !r.node)
    .sort((a, b) => b.links.length - a.links.length)[0];
  if (hub && squadSize >= 4) list.push(spawnEnemy('sec', hub.id, layout.nodeRooms.length + 2, hpScale, dmgScale));
  return list;
}

const templates = [
  { id:'ghost', callsign:'VEX', role:'GHOST', specialty:'Infiltrazione', color:'#62f4ff', stats:{corpo:5,riflessi:9,mente:7,presenza:4}, maxHp:82, armor:3, focus:7, weapon:'Monofilo VX', ability:'Passo fantasma', abilityText:'Colpisce un ostile nella tua stanza senza allarme e ottiene scudo 8.' },
  { id:'chrome', callsign:'ROOK', role:'CHROME', specialty:'Assalto pesante', color:'#ffcf4a', stats:{corpo:9,riflessi:6,mente:3,presenza:4}, maxHp:112, armor:9, focus:4, weapon:'Mastiff AR', ability:'Sovraccarico cromo', abilityText:'Danno massiccio a un ostile nella tua stanza, ma aumenta l’allarme.' },
  { id:'cipher', callsign:'NYX', role:'CIPHER', specialty:'Guerra di rete', color:'#b895ff', stats:{corpo:3,riflessi:6,mente:10,presenza:5}, maxHp:70, armor:2, focus:10, weapon:'Pistola ad arco', ability:'Zero-day', abilityText:'Viola a distanza un nodo nella tua stanza o in una collegata e brucia i droni vicini.' },
  { id:'ripper', callsign:'KORA', role:'RIPPER', specialty:'Supporto biotecnico', color:'#7dff9b', stats:{corpo:6,riflessi:5,mente:8,presenza:5}, maxHp:88, armor:4, focus:8, weapon:'Needler', ability:'Protocollo Lazarus', abilityText:'Cura e rianima tutti i compagni presenti nella tua stanza.' },
  { id:'face', callsign:'ECHO', role:'FACE', specialty:'Manipolazione', color:'#ff73ca', stats:{corpo:4,riflessi:6,mente:6,presenza:10}, maxHp:76, armor:3, focus:9, weapon:'Kestrel silenziata', ability:'Identità sintetica', abilityText:'Abbassa l’allarme di tutto il livello e distrae gli ostili nella tua stanza.' },
  { id:'driver', callsign:'JAX', role:'DRIVER', specialty:'Droni e mobilità', color:'#ff8b4a', stats:{corpo:6,riflessi:9,mente:6,presenza:3}, maxHp:86, armor:4, focus:6, weapon:'Vector SMG', ability:'Sciame MANTA', abilityText:'Colpisce due ostili nella tua stanza o in una collegata.' },
];

// CATALOGO MISSIONI
// Ogni missione riusa lo stesso motore (plancia procedurale, nodi, allarme,
// combattimento) e differisce solo per l'obiettivo finale in teca/nucleo/cella
// e per la meccanica di "carico" che lo accompagna. `narrative` risolve i testi
// che dipendono dai nomi delle stanze usando l'helper `roomName` locale a
// `createGame`, perché lì la variabile globale `game` non è ancora assegnata.
const MISSIONS = {
  valigetta: {
    id: 'valigetta', title: 'MISSIONE 01 // LA VALIGETTA', tagline: 'Furto ed estrazione',
    brief: 'Plancia generata da zero a ogni partita. Violate i nodi per aprire la teca, recuperate la valigetta MNEMOSYNE e consegnatela al punto di raccolta. Gli Helix sono un ostacolo sulla strada, non l’obiettivo.',
    goalHeadline: 'Recuperate MNEMOSYNE',
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
const missionList = () => Object.values(MISSIONS).map(({ narrative: _narrative, ...meta }) => meta);

let game = null;
if (existsSync(DATA_FILE)) {
  try { game = JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { game = null; }
}
// Una partita salvata da una versione precedente non ha la plancia procedurale né la
// valigetta: va scartata invece di trascinarsi dietro regole che non esistono più.
if (game && (!Array.isArray(game.map) || !game.dropRoom || !game.vaultRoom)) game = null;
// Manovra gratuita per round: le partite vecchie non hanno lo slot dedicato.
if (game) for (const p of game.players) if (p.move === undefined) p.move = null;
// Le partite salvate prima del sistema missioni sono tutte "LA VALIGETTA".
if (game && !game.missionId) game.missionId = 'valigetta';

const nowTime = () => new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
const makeCode = () => `${['NEON','VOID','NOVA','GRID'][Math.floor(Math.random()*4)]}-${Math.floor(10+Math.random()*90)}`;
const alive = (unit) => unit.hp > 0;
const connected = (player) => Boolean(player.deviceId && Date.now() - (player.lastSeen || 0) < LINK_TIMEOUT);
const participant = (player) => Boolean(player.deviceId && Date.now() - (player.lastSeen || 0) < LINK_GRACE);
const roundLength = () => ROUND_SECONDS * 1000;
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
  const waiting = game.players.filter((p)=>alive(p)&&participant(p)&&!p.action).map((p)=>p.name);
  // Nessun tempo limite per turno: il round si chiude solo quando tutti hanno trasmesso.
  const secondsLeft = null;
  return {...game, players, waiting, secondsLeft, roundSeconds:ROUND_SECONDS, caseAt:caseRoomNow(), hostageAt:hostageRoomNow(), vaultOpen:vaultOpen()};
}

function createGame(body) {
  const layout = buildMap();
  const picks = body.players.slice(0,6);
  const players = picks.map((pick,index)=>{
    const t = templates.find((item)=>item.id===pick.characterId) || templates[index];
    return {id:`p${index+1}`, name:String(pick.name||t.callsign).slice(0,14).toUpperCase(), characterId:t.id, callsign:t.callsign, role:t.role, specialty:t.specialty, color:t.color, stats:t.stats, maxHp:t.maxHp, hp:t.maxHp, armor:t.armor, focus:t.focus, maxFocus:t.focus, weapon:t.weapon, ability:t.ability, abilityText:t.abilityText, stress:0, shield:0, room:layout.startRoom, action:null, move:null, deviceId:null, lastSeen:0};
  });
  const hpScale=1+0.3*(players.length-3);
  const dmgScale=1+0.12*(players.length-3);
  const roomName=(id)=>{const r=layout.rooms.find((x)=>x.id===id);return `${id} // ${r?.name||''}`;};
  const mission=missionOf(body.missionId);
  const narrative={goalHeadline:mission.goalHeadline, ...mission.narrative(layout,roomName)};
  return {
    code:makeCode(), phase:'lobby', round:1, alarm:ALARM_START, breach:0, roundEndsAt:0, hpScale, dmgScale,
    missionId:mission.id, title:mission.title, location:`HELIX TOWER // SETTORE ${['NORD','SUD','EST','OVEST'][Math.floor(Math.random()*4)]}`,
    objective:narrative.objective, narrative,
    map:layout.rooms, startRoom:layout.startRoom, vaultRoom:layout.vaultRoom, dropRoom:layout.dropRoom,
    nodeRooms:layout.nodeRooms, nodesRequired:NODES_REQUIRED,
    nodes:Object.fromEntries(layout.nodeRooms.map((id)=>[id,false])),
    caseRoom:layout.vaultRoom, caseHolder:null, caseDelivered:false, purged:false,
    hostage:{room:layout.vaultRoom, holder:null, hp:HOSTAGE_MAX_HP, maxHp:HOSTAGE_MAX_HP, freed:false, delivered:false},
    lockdown:false,
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

function damageEnemy(enemy,raw,actor) {
  const dealt=Math.max(1,raw-enemy.armor);
  enemy.hp=Math.max(0,enemy.hp-dealt);
  log(`${actor} infligge ${dealt} danni a ${enemy.name} in ${enemy.room}.`, 'combat');
  if(enemy.hp===0) log(`${enemy.name} neutralizzato in ${enemy.room}.`, 'success');
}

function revive(target,healer,amount) {
  target.hp=Math.min(target.maxHp,amount);
  target.stress=Math.max(0,target.stress-20);
  log(`${healer} rianima ${target.name} in ${target.room}.`, 'success');
}

function breachNode(roomId,actor,mente){
  game.nodes[roomId]=true;
  game.breach=breachCount();
  game.alarm=Math.max(0,game.alarm-(8+Math.floor(mente/2)));
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

// FASE 1 // MANOVRA: tutti gli spostamenti si risolvono prima del fuoco, così la posizione
// dichiarata durante il round è quella che conta per il combattimento.
// Restituisce true se almeno un operativo si è sganciato sotto il fuoco: l'allarme di uno
// sganciamento si paga UNA VOLTA per round, non a testa. Una rotta è un solo evento per la
// centrale, e con gli ostili che inseguono la squadra sarebbe altrimenti una tassa continua.
function resolveMovement(actors){
  let disengaged=false;
  for(const p of actors){
    if(!p.move) continue;
    const destination=p.move.roomId;
    if(!roomById(p.room).links.includes(destination)){
      log(`${p.name} non trova una porta verso ${destination}: resta in ${p.room}.`,'system');
      continue;
    }
    // Sganciarsi da una stanza presidiata costa: gli ostili colpiscono chi volta le spalle.
    const guards=enemiesIn(p.room);
    if(guards.length){
      const hit=Math.max(1,Math.round(guards[0].damage*0.6)-p.armor);
      p.hp=Math.max(0,p.hp-hit);
      disengaged=true;
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
  return disengaged;
}

// FASE 2 // AZIONI: risolte in ordine di Riflessi, sempre limitate alla stanza occupata.
function resolveActions(actors){
  const ordered=[...actors].sort((a,b)=>b.stats.riflessi-a.stats.riflessi);
  for(const p of ordered){
    if(!alive(p)) continue;
    const action=p.action;
    if(!action||action.type==='move') continue;
    const room=roomById(p.room);
    const hostiles=enemiesIn(p.room);
    const target=hostiles.find((e)=>e.id===action.targetId)||hostiles[0];

    if(action.type==='attack'){
      if(!target){ p.shield+=5; log(`${p.name} non ha bersagli in ${p.room}: tiene la posizione.`,'system'); }
      else damageEnemy(target,12+p.stats.riflessi+Math.floor(Math.random()*8),p.name);
    }

    if(action.type==='grab'){
      if(game.caseHolder) log(`${p.name}: la valigetta è già in mano a un compagno.`,'system');
      else if(caseRoomNow()!==p.room) log(`${p.name} non trova la valigetta in ${p.room}.`,'system');
      else if(p.room===game.vaultRoom&&!vaultOpen()) log(`${p.name}: la teca di ${p.room} è ancora sigillata.`,'system');
      else{
        const fresh=!game.caseTaken;
        game.caseHolder=p.id;game.caseRoom=null;game.caseTaken=true;
        if(fresh){game.alarm=Math.min(100,game.alarm+ALARM_ON_GRAB);log(`${p.name} stacca la valigetta MNEMOSYNE dalla teca: allarme +${ALARM_ON_GRAB}.`,'danger');}
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
        game.alarm=Math.min(100,game.alarm+GHOST_PURGE_ALARM_SPIKE);
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
        if(fresh){game.alarm=Math.min(100,game.alarm+ALARM_ON_FREE);log(`${p.name} libera l’informatore: allarme +${ALARM_ON_FREE}.`,'danger');}
        else log(`${p.name} riprende la scorta dell’informatore in ${roomLabel(p.room)}.`,'success');
      }
    }

    if(action.type==='hack'){
      if(!room.node) log(`${p.name} non trova terminali in ${roomLabel(p.room)}.`,'system');
      else if(game.nodes[p.room]) log(`${p.name}: il nodo di ${p.room} è già violato.`,'system');
      else {
        breachNode(p.room,p.name,p.stats.mente);
        const drone=hostiles.find((e)=>e.type==='DRONE');
        if(drone) damageEnemy(drone,8+p.stats.mente,p.name);
      }
    }

    if(action.type==='guard'){
      const bonus=room.cover?6:0;
      const raw=10+Math.floor(p.stats.corpo/2)+bonus;
      // Chi porta la valigetta o scorta l'informatore ha una mano occupata: si ripara la metà.
      p.shield=(game.caseHolder===p.id||game.hostage.holder===p.id)?Math.round(raw/2):raw;
      log(bonus?`${p.name} sfrutta la copertura di ${p.room} (scudo ${p.shield}).`:`${p.name} assume posizione di copertura in ${p.room}.`,'system');
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
          const amount=10+p.stats.mente;
          wounded.hp=Math.min(wounded.maxHp,wounded.hp+amount);
          wounded.stress=Math.max(0,wounded.stress-6);
          log(`${p.name} ripristina ${amount} integrità a ${wounded.name} in ${p.room}.`,'success');
        }
      }
    }

    if(action.type==='ability'){
      p.focus=Math.max(0,p.focus-3);
      if(p.characterId==='ghost'){
        p.shield+=8;
        if(target) damageEnemy(target,20+p.stats.riflessi,p.name);
        else log(`${p.name} svanisce nelle ombre di ${p.room}.`,'system');
      }
      else if(p.characterId==='chrome'){
        if(target){ damageEnemy(target,29+p.stats.corpo,p.name); game.alarm=Math.min(100,game.alarm+ALARM_CHROME_SPIKE); }
        else log(`${p.name} scarica il cromo a vuoto: nessun ostile in ${p.room}.`,'system');
      }
      else if(p.characterId==='cipher'){
        // La guerra di rete raggiunge anche la stanza collegata: il CIPHER non deve esporsi.
        const reach=[p.room,...room.links];
        const nodeRoom=reach.find((id)=>roomById(id).node&&!game.nodes[id]);
        if(nodeRoom) breachNode(nodeRoom,p.name,p.stats.mente);
        else log(`${p.name} lancia uno zero-day ma non aggancia nodi da ${p.room}.`,'system');
        for(const e of game.enemies.filter((x)=>alive(x)&&x.type==='DRONE'&&reach.includes(x.room))) damageEnemy(e,25,p.name);
      }
      else if(p.characterId==='ripper'){
        for(const ally of game.players.filter((x)=>x.room===p.room)){
          if(alive(ally)) ally.hp=Math.min(ally.maxHp,ally.hp+15);
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
        for(const e of swarm) damageEnemy(e,18+p.stats.riflessi,p.name);
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
      const absorbed=Math.min(target.shield,enemy.damage);
      target.shield-=absorbed;
      const dealt=Math.max(1,enemy.damage-absorbed-target.armor);
      target.hp=Math.max(0,target.hp-dealt);
      target.stress=Math.min(100,target.stress+4+enemy.threat);
      log(`${enemy.name} colpisce ${target.name} in ${enemy.room}: ${dealt} danni.`,'danger');
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

function resolveRound() {
  const actors=game.players.filter(alive);
  for(const p of actors) if(!p.action) p.action={type:'guard',targetId:null,label:'Copertura automatica'};

  const disengaged=resolveMovement(actors);
  resolveActions(actors);
  resolveEnemies();

  // Le zone esposte sono scoperte: chi ci resta a fine round alza l'allarme.
  const exposedCount=game.players.filter((p)=>alive(p)&&roomById(p.room).exposed).length;
  if(exposedCount) log(`${exposedCount} operativi in zona esposta: le telecamere li agganciano.`,'danger');

  // Trasmette solo chi vi ha davvero addosso: un inseguitore che ha perso il contatto in
  // corridoio non alza l'allarme. Staccarsi dagli ostili è quindi una mossa che paga.
  const contact=Math.min(ALARM_CONTACT_CAP,game.enemies.filter((e)=>alive(e)&&alliesIn(e.room).length).length);
  const carrying=Boolean(game.caseHolder);
  const purgedPressure=game.missionId==='nucleo'&&game.purged;
  game.alarm=Math.min(100,game.alarm+ALARM_PER_ROUND+contact*ALARM_PER_CONTACT+exposedCount*ALARM_PER_EXPOSED+(carrying?ALARM_CARRY:0)+(disengaged?ALARM_ON_DISENGAGE:0)+(purgedPressure?GHOST_ALARM_PER_ROUND_BONUS:0));
  game.breach=breachCount();
  game.round+=1;
  game.players.forEach((p)=>{p.action=null;p.move=null;p.shield=Math.max(0,p.shield-SHIELD_DECAY);p.focus=Math.min(p.maxFocus,p.focus+1);});

  // CONSEGNA: la valigetta / l'informatore raggiunge il punto di raccolta a fine round.
  if(game.missionId==='valigetta'&&!game.caseDelivered&&game.caseHolder&&game.players.find((p)=>p.id===game.caseHolder)?.room===game.dropRoom){
    game.caseDelivered=true;game.caseRoom=game.dropRoom;game.caseHolder=null;
    log(`Valigetta MNEMOSYNE consegnata in ${roomLabel(game.dropRoom)}. Estraete la squadra.`,'success');
  }
  if(game.missionId==='ostaggio'&&!game.hostage.delivered&&game.hostage.holder&&hostageRoomNow()===game.dropRoom){
    game.hostage.delivered=true;game.hostage.room=game.dropRoom;game.hostage.holder=null;
    log(`Informatore consegnato in ${roomLabel(game.dropRoom)}. Estraete la squadra.`,'success');
  }

  // LOCKDOWN: sopra la soglia la torre sveglia ogni presidio, anche quello mai ingaggiato.
  if(!game.lockdown&&game.alarm>=LOCKDOWN_ALARM){
    game.lockdown=true;
    for(const e of game.enemies) e.locked=true;
    log('LOCKDOWN: ogni unità Helix del settore è stata allertata.','danger');
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
    let progressEvent=null;
    if(game.missionId==='valigetta'){
      if(game.caseDelivered) progressEvent={title:'ESTRAZIONE APERTA',text:`Portate ogni operativo vivo in ${roomLabel(game.dropRoom)} per chiudere l’operazione.`};
      else if(game.caseHolder) progressEvent={title:'SEGNALE TRACCIATO',text:`La valigetta emette: l’allarme sale di ${ALARM_CARRY} ogni round finché non è in ${game.dropRoom}.`};
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
    if(progressEvent) game.event=progressEvent;
    else if(game.lockdown) game.event={title:'LOCKDOWN',text:'Ogni presidio è allertato e si muove verso di voi.'};
    else if(game.round===5){
      game.event={title:'RINFORZI IN ARRIVO',text:`Una unità Helix entra da ${roomLabel(game.startRoom)}.`};
      const razor=spawnEnemy('razor',game.startRoom,game.round,game.hpScale||1,game.dmgScale||1);
      razor.locked=true;
      game.enemies.push(razor);
      log(`${razor.name} entra da ${roomLabel(game.startRoom)} e vi cerca.`,'danger');
    }
    else if(game.round===9){
      game.event={title:'SECONDA ONDATA',text:`Un’altra unità entra da ${roomLabel(game.dropRoom)}.`};
      const razor=spawnEnemy('razor',game.dropRoom,game.round,game.hpScale||1,game.dmgScale||1);
      razor.locked=true;
      game.enemies.push(razor);
      log(`${razor.name} entra da ${roomLabel(game.dropRoom)}.`,'danger');
    }
    else game.event={title:'PRESSIONE HELIX',text:`Allarme ${game.alarm}%. Nodi ${game.breach}/${game.nodeRooms.length}, ne servono ${game.nodesRequired}.`};
  }
  game.roundEndsAt=Date.now()+roundLength();
  game.updatedAt=Date.now();
}

// Un round si chiude quando tutti i telefoni collegati hanno risposto. Non c'è tempo limite:
// senza telefoni collegati la partita resta in pausa, altrimenti si aspetta ogni azione
// (o la chiusura manuale del round dalla plancia).
function tryResolve() {
  if(!game||game.phase!=='active') return false;
  const expected=game.players.filter((p)=>alive(p)&&participant(p));
  if(!expected.length||!game.players.some(connected)) return false;
  if(expected.every((p)=>p.action)){resolveRound();return true;}
  return false;
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
      if(tryResolve()) await save();
      return send(res,200,{game:publicGame(),templates,missions:missionList(),networkUrl:getNetworkUrl(),networkUrls:networkCandidates()});
    }
    if(req.method==='POST'&&url.pathname==='/api/setup'){
      const body=await jsonBody(req);
      if(!Array.isArray(body.players)||body.players.length<2||body.players.length>6)return send(res,400,{error:'Servono da 2 a 6 giocatori.'});
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
      if(tryResolve()) await save();
      return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/start'){
      const body=await jsonBody(req);if(!game||body.code!==game.code)return send(res,404,{error:'Partita non trovata.'});
      if(game.phase!=='lobby')return send(res,409,{error:'Operazione già avviata.'});
      if(!game.players.some(connected))return send(res,409,{error:'Collega almeno un telefono prima di avviare.'});
      game.phase='active';game.roundEndsAt=Date.now()+roundLength();
      log(game.narrative.opening,'combat');await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/action'){
      const body=await jsonBody(req);if(!game||body.code!==game.code||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const p=game.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);if(!p||!alive(p))return send(res,403,{error:'Accesso operativo negato.'});
      const allowed=['move','attack','hack','guard','heal','ability','grab','purge','free'];if(!allowed.includes(body.type))return send(res,400,{error:'Azione non valida.'});
      // MANOVRA: spostamento gratuito di una stanza, non consuma l'azione del round e resta
      // ridichiarabile finché il round non si risolve. La plancia comanda: solo porte esistenti.
      if(body.type==='move'){
        if(!roomById(p.room).links.includes(body.roomId))return send(res,400,{error:'Nessuna porta collega la tua stanza a quella.'});
        p.move={roomId:body.roomId};p.lastSeen=Date.now();log(`${p.name} prepara una manovra verso ${roomLabel(body.roomId)}.`,'system');
        tryResolve();
        await save();return send(res,200,{game:publicGame()});
      }
      if(p.action)return send(res,409,{error:'Azione già trasmessa.'});
      // L'azione ha effetto nella stanza in cui l'operativo si troverà: quella di destinazione
      // se ha già dichiarato una manovra per questo round, altrimenti quella attuale.
      const actRoom=p.move?p.move.roomId:p.room;
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
      p.action={type:body.type,targetId:body.targetId||null,roomId:body.roomId||null};p.lastSeen=Date.now();log(`${p.name} ha trasmesso la propria azione.`,'system');
      tryResolve();
      await save();return send(res,200,{game:publicGame()});
    }
    // Sblocco manuale dalla plancia: chiude subito il round in corso.
    if(req.method==='POST'&&url.pathname==='/api/resolve'){
      if(!game||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      resolveRound();await save();return send(res,200,{game:publicGame()});
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

setInterval(async()=>{ if(tryResolve()) await save(); },1000);

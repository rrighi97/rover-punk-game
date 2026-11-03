// STRUMENTO DI AUTORING // non fa parte del runtime del gioco, non è importato da server.mjs.
//
// Le plance sono fisse: ogni missione ha un `layout` scritto una volta e non più rigenerato a
// ogni partita (vedi CLAUDE.md). Questo script serve a generare quella plancia UNA VOLTA, quando
// si crea una missione nuova: pesca una griglia a caso con lo stesso algoritmo che il gioco usava
// quando le mappe erano procedurali, ne prova diverse e tiene la migliore, poi stampa un `layout`
// pronto da incollare in `MISSIONS[<id>]` dentro server.mjs.
//
// Regole della plancia (griglia 5 colonne × 4 righe):
//   - esattamente 2 celle vuote (i "buchi"), mai sugli angoli e mai attaccate fra loro;
//   - obiettivi (partenza, obiettivo, consegna, 3 nodi) distanti fra loro: fra due obiettivi
//     qualunque ci sono almeno MIN_OBJECT_GAP porte, e partenza/obiettivo/consegna sono agli
//     antipodi del percorso;
//   - presidio iniziale: 1 nemico nella stanza dell'obiettivo e 1 su ogni nodo, mai più di 1
//     nemico per stanza.
//
// Uso: node scripts/generate-map.mjs "NOME1" "NOME2" ... (almeno 20 nomi di stanza a tema)
//      node scripts/generate-map.mjs --tries=4000 "NOME1" "NOME2" ...
//      node scripts/generate-map.mjs --roles "PARTENZA" "OBIETTIVO" "CONSEGNA" "NODO1" "NODO2" "NODO3" ...
//        con --roles i primi (3 + nodi) nomi vanno, in quest'ordine, alle stanze di ruolo; il resto
//        è distribuito a caso sulle altre stanze.
//      node scripts/generate-map.mjs --nodes=3 --roles "PARTENZA" "OBIETTIVO" "CONSEGNA" "NODO1" "NODO2" "NODO3" ...
//        --nodes fissa quanti nodi di rete porta la plancia. Default 2 (standard attuale: vanno
//        violati entrambi, senza nodo di scorta) — passa --nodes=3 solo se una missione futura
//        deve tornare ad averne uno di riserva.

const GRID_COLS = 5;
const GRID_ROWS = 4;
const HOLES = 2;
const DOUBLE_ROOM_CHANCE = 0.6;
const EXTRA_DOOR_CHANCE = 0.28;
const MIN_OBJECT_GAP = 2; // porte minime fra due obiettivi qualunque (nodi compresi)
const VOID = '∅'; // cella lasciata deliberatamente vuota: il "buco" nella plancia

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
function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// Distanza sulla griglia fra i centri di due stanze (in celle, geometria di Manhattan).
const cellGap = (a, b) => Math.abs((a.col + (a.w - 1) / 2) - (b.col + (b.w - 1) / 2))
  + Math.abs((a.row + (a.h - 1) / 2) - (b.row + (b.h - 1) / 2));

// PORTE: ogni porta (collegamento fra due stanze) parte aperta o chiusa. Almeno metà delle porte
// della plancia è chiusa di default — bloccano il passaggio finché un operativo non le sblocca
// con l'azione SBLOCCA PORTA. La scelta di quali sono chiuse è casuale ma fissata una volta sola
// qui in fase di generazione: da lì in poi il `layout` stampato è statico come tutto il resto.
function assignDoorStates(doorIdPairs) {
  const keys = doorIdPairs.map(([a, b]) => [a, b].sort().join('-'));
  const shuffled = shuffle(keys);
  const closedCount = Math.ceil(shuffled.length / 2);
  const closed = new Set(shuffled.slice(0, closedCount));
  const out = {};
  for (const key of keys) if (closed.has(key)) out[key] = true;
  return out;
}

// Passo 1: riempie la griglia con stanze da 1 o 2 celle, senza sovrapposizioni. Prima però marca
// HOLES celle come VOID: restano vuote per sempre (nessuna stanza le occupa), così il perimetro
// della plancia non è mai un rettangolo pieno. Mai sui quattro angoli (una stanza d'angolo
// isolata dal buco si porterebbe dietro troppe griglie da scartare) e mai due buchi confinanti:
// devono leggersi come due vuoti distinti, non come un unico buco largo.
function fillGrid() {
  const grid = Array.from({ length: GRID_ROWS + 2 }, () => Array(GRID_COLS + 2).fill(null));
  const cells = [];
  for (let row = 1; row <= GRID_ROWS; row++) for (let col = 1; col <= GRID_COLS; col++) cells.push({ col, row });
  const isCorner = ({ col, row }) => (col === 1 || col === GRID_COLS) && (row === 1 || row === GRID_ROWS);
  const holes = [];
  for (const cell of shuffle(cells.filter((c) => !isCorner(c)))) {
    if (holes.length === HOLES) break;
    if (holes.some((h) => Math.abs(h.col - cell.col) + Math.abs(h.row - cell.row) === 1)) continue;
    holes.push(cell);
    grid[cell.row][cell.col] = VOID;
  }
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
    if (!here || here === VOID) continue;
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const other = grid[row + dr]?.[col + dc];
      if (!other || other === VOID || other === here) continue;
      adjacency.get(here).add(other);
      adjacency.get(other).add(here);
    }
  }
  return adjacency;
}
// Passo 3: albero di copertura casuale (tutto raggiungibile) + qualche porta extra. Tutti i muri
// non estratti restano chiusi: da qui nascono le stanze vicine ma separate.
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
// Passo 4: ruoli tattici. Obiettivo e consegna finiscono agli antipodi del percorso (bisogna
// attraversare il livello e poi tornare); i nodi vanno, uno alla volta, nella stanza più
// lontana da tutti gli obiettivi già piazzati, così nessun obiettivo sta appiccicato a un altro.
function buildMap(nodeCount) {
  const { grid, draft } = fillGrid();
  const adjacency = neighbours(grid, draft);
  const doors = carveDoors(draft, adjacency);

  const ordered = [...draft].sort((a, b) => a.row - b.row || a.col - b.col);
  const rooms = ordered.map((r, i) => ({
    id: `${'ABCDE'[r.col - 1]}${String(i + 1).padStart(2, '0')}`,
    name: '', col: r.col, row: r.row, w: r.w, h: r.h, links: [],
  }));
  const byKey = new Map(ordered.map((r, i) => [r.key, rooms[i]]));
  for (const door of doors) {
    const [a, b] = door.split('|');
    const ra = byKey.get(a), rb = byKey.get(b);
    if (!ra || !rb) continue;
    ra.links.push(rb.id);
    rb.links.push(ra.id);
  }

  const border = rooms.filter((r) => r.col === 1);
  const start = pick(border.length ? border : rooms);
  start.start = true;
  const dist = new Map(rooms.map((r) => [r.id, distanceMap(rooms, r.id)]));
  const reachable = rooms.filter((r) => dist.get(start.id)[r.id] !== undefined);
  // Lontananza = porte da attraversare + celle di distanza sulla griglia: un obiettivo "lontano"
  // solo perché il labirinto gira attorno, ma attaccato sullo schermo, non conta come lontano.
  const gap = (a, b) => (dist.get(a.id)[b.id] ?? 0) + cellGap(a, b);

  const vault = shuffle(reachable).sort((a, b) => gap(start, b) - gap(start, a))[0];
  vault.vault = true;
  const drop = shuffle(reachable.filter((r) => r !== vault && r !== start))
    .sort((a, b) => Math.min(gap(vault, b), gap(start, b)) - Math.min(gap(vault, a), gap(start, a)))[0] || start;
  drop.exit = true;

  const placed = [start, vault, drop];
  for (let i = 0; i < nodeCount; i++) {
    const free = shuffle(reachable.filter((r) => !placed.includes(r)));
    const spread = (r) => Math.min(...placed.map((p) => gap(p, r)));
    const node = free.sort((a, b) => spread(b) - spread(a))[0];
    if (!node) break;
    node.node = true;
    placed.push(node);
  }

  const rest = shuffle(reachable.filter((r) => !r.start && !r.vault && !r.exit && !r.node));
  const leftovers = rest.sort((a, b) => b.links.length - a.links.length);
  for (const room of leftovers.slice(0, 2)) room.exposed = true;
  for (const room of leftovers.slice(2)) room.cover = true;

  const doorIdPairs = [...doors].map((d) => { const [a, b] = d.split('|'); return [byKey.get(a).id, byKey.get(b).id]; });
  const doorStates = assignDoorStates(doorIdPairs);

  return { rooms, startRoom: start.id, vaultRoom: vault.id, dropRoom: drop.id, nodeRooms: rooms.filter((r) => r.node).map((r) => r.id), doors: doorStates };
}

function validate(layout) {
  const rooms = layout.rooms;
  const dist = (a, b) => distanceMap(rooms, a)[b];
  const fromStart = distanceMap(rooms, layout.startRoom);
  const allReachable = rooms.every((r) => fromStart[r.id] !== undefined);
  const distVault = fromStart[layout.vaultRoom] || 0;
  const distDrop = fromStart[layout.dropRoom] || 0;
  const distVaultDrop = dist(layout.vaultRoom, layout.dropRoom) || 0;
  // Buchi: celle della griglia 5×4 non occupate da nessuna stanza. Devono essere esattamente
  // HOLES e la plancia deve comunque toccare tutti e quattro i bordi (resta una 5×4 piena).
  const occupied = new Set();
  let maxC = 0, maxR = 0;
  for (const r of rooms) {
    for (let dr = 0; dr < (r.h || 1); dr++) for (let dc = 0; dc < (r.w || 1); dc++) occupied.add(`${r.row + dr},${r.col + dc}`);
    maxC = Math.max(maxC, r.col + (r.w || 1) - 1);
    maxR = Math.max(maxR, r.row + (r.h || 1) - 1);
  }
  const holes = GRID_COLS * GRID_ROWS - occupied.size;
  const fullGrid = maxC === GRID_COLS && maxR === GRID_ROWS;
  // Distanze fra due obiettivi qualunque (partenza, obiettivo, consegna, nodi): in porte e in
  // celle della griglia. `mainCells` = distanza minima sulla griglia fra partenza, obiettivo e
  // consegna, che devono stare in zone diverse della plancia.
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const objects = [layout.startRoom, layout.vaultRoom, layout.dropRoom, ...layout.nodeRooms];
  let objectGap = Infinity, objectCells = Infinity, mainCells = Infinity, cellSpread = 0;
  for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
    const cells = cellGap(byId.get(objects[i]), byId.get(objects[j]));
    objectGap = Math.min(objectGap, dist(objects[i], objects[j]) ?? 0);
    objectCells = Math.min(objectCells, cells);
    if (j < 3) mainCells = Math.min(mainCells, cells);
    cellSpread += cells;
  }
  const doorCount = rooms.reduce((n, r) => n + r.links.length, 0) / 2;
  const loops = doorCount - (rooms.length - 1);
  return { count: rooms.length, allReachable, distVault, distDrop, distVaultDrop, holes, fullGrid, objectGap, objectCells, mainCells, cellSpread, loops, nodes: layout.nodeRooms.length };
}

// Prova diverse griglie e tiene quella con gli obiettivi più sparsi sulla plancia: evita mappe
// minuscole, obiettivi appiccicati fra loro o alla partenza, e labirinti a serpentina dove tutto
// è "lontano" solo perché c'è un unico corridoio (percorsi oltre MAX_PATH porte scartati).
const MAX_PATH = 8;
function bestOf(tries, nodeCount) {
  let best = null, bestScore = -1;
  for (let i = 0; i < tries; i++) {
    const layout = buildMap(nodeCount);
    const v = validate(layout);
    if (!v.allReachable || v.holes !== HOLES || !v.fullGrid || v.nodes !== nodeCount) continue;
    if (v.count < 12 || v.count > 15) continue;
    if (v.objectGap < MIN_OBJECT_GAP || v.objectCells < 1.5 || v.mainCells < 3) continue;
    if (v.distVault < 5 || v.distDrop < 4 || v.distVaultDrop < 5) continue;
    if (Math.max(v.distVault, v.distDrop, v.distVaultDrop) > MAX_PATH) continue;
    if (v.loops < 1) continue;
    const score = v.cellSpread + 4 * v.objectCells + 2 * v.mainCells + v.distVault + v.distVaultDrop + v.loops;
    if (score > bestScore) { bestScore = score; best = layout; }
  }
  return best;
}

// Nomi: con --roles i primi (3 + nodeCount) vanno a partenza, obiettivo, consegna e ai nodi (in
// ordine di id); gli altri si mescolano sulle stanze restanti.
function assignNames(layout, roomNames, roles) {
  const byId = new Map(layout.rooms.map((r) => [r.id, r]));
  let pool = roomNames;
  if (roles) {
    const roleIds = [layout.startRoom, layout.vaultRoom, layout.dropRoom, ...layout.nodeRooms];
    roleIds.forEach((id, i) => { byId.get(id).name = roomNames[i]; });
    pool = roomNames.slice(roleIds.length);
  }
  const names = shuffle(pool);
  layout.rooms.filter((r) => !r.name).forEach((r, i) => { r.name = names[i % names.length]; });
}

// Schizzo ASCII della plancia su stderr, per controllarla a colpo d'occhio prima di incollarla:
// ogni cella mostra l'id della stanza e il ruolo (S partenza, V obiettivo, X consegna, N nodo);
// fra due celle `|` o `-` è un muro cieco, spazio vuoto una porta (o l'interno della stessa stanza).
function sketch(layout) {
  const at = new Map();
  for (const r of layout.rooms) for (let dr = 0; dr < r.h; dr++) for (let dc = 0; dc < r.w; dc++) at.set(`${r.row + dr},${r.col + dc}`, r);
  const tag = (r) => r ? `${r.id}${r.start ? 'S' : r.vault ? 'V' : r.exit ? 'X' : r.node ? 'N' : ' '}` : ' ·· ';
  const open = (a, b) => a && b && (a === b || a.links.includes(b.id));
  const lines = [];
  for (let row = 1; row <= GRID_ROWS; row++) {
    let line = '', under = '';
    for (let col = 1; col <= GRID_COLS; col++) {
      const here = at.get(`${row},${col}`);
      line += ` ${tag(here)} ` + (col < GRID_COLS ? (open(here, at.get(`${row},${col + 1}`)) ? ' ' : '|') : '');
      under += (row < GRID_ROWS ? (open(here, at.get(`${row + 1},${col}`)) ? '      ' : ' ---- ') : '') + (col < GRID_COLS ? ' ' : '');
    }
    lines.push(line);
    if (row < GRID_ROWS) lines.push(under);
  }
  return lines.join('\n');
}

function roomToJs(r) {
  const flags = ['start', 'vault', 'exit', 'node', 'exposed', 'cover']
    .filter((f) => r[f]).map((f) => `${f}:true`).join(',');
  return `{id:'${r.id}',name:'${r.name}',col:${r.col},row:${r.row},w:${r.w},h:${r.h},links:[${r.links.map((l) => `'${l}'`).join(',')}]${flags ? ',' + flags : ''}}`;
}

const args = process.argv.slice(2);
const triesArg = args.find((a) => a.startsWith('--tries='));
const tries = triesArg ? Number(triesArg.split('=')[1]) : 20000;
const nodesArg = args.find((a) => a.startsWith('--nodes='));
const nodeCount = nodesArg ? Number(nodesArg.split('=')[1]) : 2;
const roles = args.includes('--roles');
const roomNames = args.filter((a) => !a.startsWith('--'));
if (roomNames.length < GRID_COLS * GRID_ROWS) {
  console.error(`Servono almeno ${GRID_COLS * GRID_ROWS} nomi di stanza (una voce per ogni cella possibile della griglia ${GRID_COLS}×${GRID_ROWS}).`);
  console.error('Uso: node scripts/generate-map.mjs [--roles] [--nodes=3] "NOME1" "NOME2" ... "NOME20"');
  process.exit(1);
}

const layout = bestOf(tries, nodeCount);
if (!layout) {
  console.error(`Nessuna plancia valida in ${tries} tentativi: rilancia o alza --tries.`);
  process.exit(1);
}
assignNames(layout, roomNames, roles);
const v = validate(layout);
console.error(`// ${v.count} stanze · ${v.holes} buchi · partenza→obiettivo ${v.distVault} · partenza→consegna ${v.distDrop} · obiettivo→consegna ${v.distVaultDrop} porte · fra due obiettivi almeno ${v.objectGap} porte / ${v.objectCells} celle`);
console.error(sketch(layout));
const doorsJs = Object.keys(layout.doors).map((k) => `'${k}':true`).join(',');
const nodeGarrison = layout.nodeRooms.map((_, i) => `{kind:'sec',at:'node:${i}'}`).join(',');
console.log(`layout: {\n  rooms: [\n${layout.rooms.map((r) => `    ${roomToJs(r)},`).join('\n')}\n  ],\n  startRoom: '${layout.startRoom}', vaultRoom: '${layout.vaultRoom}', dropRoom: '${layout.dropRoom}',\n  nodeRooms: [${layout.nodeRooms.map((id) => `'${id}'`).join(', ')}],\n  // Presidio iniziale: 1 nemico sull'obiettivo e 1 su ogni nodo, mai più di 1 per stanza.\n  // I droni non stanno qui: ne parte uno per operativo scelto in lobby (opzionale \`droneSpawns: [6 stanze]\`, altrimenti le più lontane dalla partenza).\n  garrison: [{kind:'elite',at:'vault'},${nodeGarrison}],\n  doors: {${doorsJs}},\n},`);

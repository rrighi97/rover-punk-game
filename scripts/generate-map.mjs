// STRUMENTO DI AUTORING // non fa parte del runtime del gioco, non è importato da server.mjs.
//
// Le plance sono fisse: ogni missione ha un `layout` scritto una volta e non più rigenerato a
// ogni partita (vedi CLAUDE.md). Questo script serve a generare quella plancia UNA VOLTA, quando
// si crea una missione nuova: pesca una griglia a caso con lo stesso algoritmo che il gioco usava
// quando le mappe erano procedurali, ne prova diverse e tiene la migliore, poi stampa un `layout`
// pronto da incollare in `MISSIONS[<id>]` dentro server.mjs.
//
// Uso: node scripts/generate-map.mjs "NOME1" "NOME2" ... (almeno 16 nomi di stanza a tema)
//      node scripts/generate-map.mjs --tries=400 "NOME1" "NOME2" ...

const GRID_COLS = 4;
const GRID_ROWS = 4;
const DOUBLE_ROOM_CHANCE = 0.6;
const EXTRA_DOOR_CHANCE = 0.28;

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
// Passo 4: identità delle stanze (nomi dal pool tematico) e ruoli tattici. Obiettivo e consegna
// finiscono sempre agli antipodi del percorso: bisogna attraversare il livello e poi tornare.
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

  const border = rooms.filter((r) => r.col === 1);
  const start = (border.length ? border : rooms).sort((a, b) => b.row - a.row)[0];
  start.start = true;
  const fromStart = distanceMap(rooms, start.id);
  const reachable = rooms.filter((r) => fromStart[r.id] !== undefined);

  const vault = [...reachable].sort((a, b) => (fromStart[b.id] || 0) - (fromStart[a.id] || 0))[0];
  vault.vault = true;
  const fromVault = distanceMap(rooms, vault.id);
  const drop = reachable.filter((r) => r !== vault && r !== start)
    .sort((a, b) => (fromVault[b.id] || 0) - (fromVault[a.id] || 0))[0] || start;
  drop.exit = true;

  const rest = shuffle(reachable.filter((r) => !r.start && !r.vault && !r.exit));
  for (const room of rest.slice(0, 3)) room.node = true;
  const leftovers = rest.slice(3).sort((a, b) => b.links.length - a.links.length);
  for (const room of leftovers.slice(0, 2)) room.exposed = true;
  for (const room of leftovers.slice(2)) room.cover = true;

  const doorIdPairs = [...doors].map((d) => { const [a, b] = d.split('|'); return [byKey.get(a).id, byKey.get(b).id]; });
  const doorStates = assignDoorStates(doorIdPairs);

  return { rooms, startRoom: start.id, vaultRoom: vault.id, dropRoom: drop.id, nodeRooms: rooms.filter((r) => r.node).map((r) => r.id), doors: doorStates };
}

function validate(layout) {
  const dist = distanceMap(layout.rooms, layout.startRoom);
  const allReachable = layout.rooms.every((r) => dist[r.id] !== undefined);
  const distVault = dist[layout.vaultRoom] || 0;
  const distDrop = dist[layout.dropRoom] || 0;
  const distVaultDrop = distanceMap(layout.rooms, layout.vaultRoom)[layout.dropRoom] || 0;
  return { count: layout.rooms.length, allReachable, distVault, distDrop, distVaultDrop };
}

// Prova diverse griglie e tiene quella con le distanze più equilibrate: evita mappe minuscole,
// consegne appiccicate alla partenza o percorsi degeneri.
function bestOf(roomNames, tries) {
  let best = null, bestScore = -1;
  for (let i = 0; i < tries; i++) {
    const layout = buildMap(roomNames);
    const v = validate(layout);
    if (!v.allReachable) continue;
    if (v.count < 10 || v.count > 14) continue;
    if (v.distDrop < 3) continue;
    const score = v.distVault + v.distDrop + v.distVaultDrop;
    if (score > bestScore) { bestScore = score; best = layout; }
  }
  return best || buildMap(roomNames);
}

function roomToJs(r) {
  const flags = ['start', 'vault', 'exit', 'node', 'exposed', 'cover']
    .filter((f) => r[f]).map((f) => `${f}:true`).join(',');
  return `{id:'${r.id}',name:'${r.name}',col:${r.col},row:${r.row},w:${r.w},h:${r.h},links:[${r.links.map((l) => `'${l}'`).join(',')}]${flags ? ',' + flags : ''}}`;
}

const args = process.argv.slice(2);
const triesArg = args.find((a) => a.startsWith('--tries='));
const tries = triesArg ? Number(triesArg.split('=')[1]) : 200;
const roomNames = args.filter((a) => !a.startsWith('--'));
if (roomNames.length < 16) {
  console.error('Servono almeno 16 nomi di stanza (una voce per ogni cella possibile della griglia 4×4).');
  console.error('Uso: node scripts/generate-map.mjs "NOME1" "NOME2" ... "NOME16"');
  process.exit(1);
}

const layout = bestOf(roomNames, tries);
const v = validate(layout);
console.error(`// ${v.count} stanze · distanza partenza→obiettivo ${v.distVault} · partenza→consegna ${v.distDrop} · obiettivo→consegna ${v.distVaultDrop}`);
const doorsJs = Object.keys(layout.doors).map((k) => `'${k}':true`).join(',');
console.log(`layout: {\n  rooms: [\n${layout.rooms.map((r) => `    ${roomToJs(r)},`).join('\n')}\n  ],\n  startRoom: '${layout.startRoom}', vaultRoom: '${layout.vaultRoom}', dropRoom: '${layout.dropRoom}',\n  nodeRooms: [${layout.nodeRooms.map((id) => `'${id}'`).join(', ')}],\n  doors: {${doorsJs}},\n},`);

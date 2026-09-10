// STRUMENTO DI TARATURA // non fa parte del runtime del gioco.
//
// Importa il MOTORE VERO da ../server.mjs (createGame / applyMove / applyAction / enemyStrike /
// advanceTurn: le stesse funzioni che girano in partita) e ci fa giocare sopra un bot. Serve a
// misurare, per ogni missione × dimensione squadra (2-6), l'effetto delle leve di `missionTuning`
// (`enemyPower`, `enemyHpPower`, `enemyDmgPower`, `alarmStart`) PRIMA di toccarle davvero.
//
// `Math.random` è sostituito da un PRNG con seed: a parità di --seed e --games l'output è identico
// (partite riproducibili). Il bot NON è un giocatore umano: gioca in modo meccanico e coordinato,
// quindi i numeri sono un PAVIMENTO, non una previsione del winrate reale. In particolare sulle
// missioni di scorta un tavolo umano rende parecchio di più.
//
// Uso:
//   npm run sim                        # tutte le missioni, 400 partite/cella, seed 1234
//   node scripts/simulate.mjs --games=800 --seed=7
//   node scripts/simulate.mjs --mission=nucleo --sizes=2,3,4
//   node scripts/simulate.mjs --enemyPower=1.0            # override della sola missione scelta
//   node scripts/simulate.mjs --mission=valigetta --enemyPower=0.9 --alarmStart=26

import {
  MISSIONS, createGame, applyMove, applyAction, enemyStrike, advanceTurn, alive, __setGame,
} from '../server.mjs';
import { templates } from '../characters.mjs';

// ---------- CLI ----------
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const GAMES = Number(args.games || 400);
const BASE_SEED = Number(args.seed || 1234);
const SIZES = (args.sizes ? String(args.sizes).split(',') : ['2', '3', '4', '5', '6']).map(Number);
const MISSION_IDS = args.mission ? [String(args.mission)] : Object.keys(MISSIONS);
const OVERRIDE = {};
for (const k of ['enemyPower', 'enemyHpPower', 'enemyDmgPower', 'alarmStart']) {
  if (args[k] !== undefined) OVERRIDE[k] = Number(args[k]);
}
const ACTIONS_PER_TURN = 3; // costante di base del motore (server.mjs): la manovra ne consuma una

// ---------- PRNG con seed (mulberry32) ----------
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) { h = Math.imul(h ^ (n >>> 0), 16777619); h = Math.imul(h ^ (String(n).length), 16777619); }
  return h >>> 0;
}

// ---------- helper di sola lettura per il bot (nessuna regola qui: le regole stanno nel motore) ----------
const doorKey = (a, b) => [a, b].sort().join('-');
const doorClosed = (g, a, b) => Boolean(g.doors?.[doorKey(a, b)]);
const roomById = (g, id) => g.map.find((r) => r.id === id) || g.map[0];
const enemiesIn = (g, id) => g.enemies.filter((e) => e.hp > 0 && e.room === id);
const breachCount = (g) => g.nodeRooms.filter((id) => g.nodes[id]).length;
const vaultOpen = (g) => breachCount(g) >= (g.nodesRequired || 2);
const hasPassive = (p, id) => Boolean(p.passives?.some((x) => x.id === id));
const caseRoomNow = (g) => (g.caseHolder ? g.players.find((p) => p.id === g.caseHolder)?.room || g.caseRoom : g.caseRoom);
const hostageRoomNow = (g) => {
  if (!g.hostage) return null;
  if (g.hostage.holder) return g.players.find((p) => p.id === g.hostage.holder)?.room || g.hostage.room;
  return g.hostage.room;
};
function distanceMap(g, origin) {
  const byId = new Map(g.map.map((r) => [r.id, r]));
  const dist = { [origin]: 0 };
  const q = [origin];
  while (q.length) {
    const cur = q.shift();
    for (const nx of byId.get(cur)?.links || []) if (dist[nx] === undefined) { dist[nx] = dist[cur] + 1; q.push(nx); }
  }
  return dist;
}
function pathNext(g, from, goal) {
  if (from === goal || goal == null) return null;
  const dist = distanceMap(g, goal);
  let best = null, bestD = dist[from] ?? 99;
  for (const nx of roomById(g, from).links) {
    const d = dist[nx] ?? 99;
    if (d < bestD) { bestD = d; best = nx; }
  }
  return best;
}

// ---------- BOT ----------
// Obiettivo di squadra condiviso: tutti convergono sullo stesso ambiente, così la forza si
// concentra invece di spargersi. Sulle missioni di scorta il gruppo segue il portatore e non lo
// supera mai (correzione del difetto "informatore abbandonato" segnalato nei playtest).
function squadGoalRoom(g) {
  const m = g.missionId;
  if (m === 'valigetta') {
    if (g.caseDelivered) return g.dropRoom;
    if (g.caseHolder) return g.dropRoom;
    if (g.caseTaken) return caseRoomNow(g);
    if (vaultOpen(g)) return g.vaultRoom;
  } else if (m === 'nucleo') {
    if (g.purged) return g.dropRoom;
    if (vaultOpen(g)) return g.vaultRoom;
  } else {
    if (g.hostage.delivered) return g.dropRoom;
    if (g.hostage.holder) return g.dropRoom;            // il portatore punta l'uscita
    if (g.hostage.freed) return hostageRoomNow(g);      // liberato ma a terra: tutti a riprenderlo
    if (vaultOpen(g)) return g.vaultRoom;
  }
  const startDist = distanceMap(g, g.startRoom);
  const open = g.nodeRooms.filter((id) => !g.nodes[id]).sort((a, b) => (startDist[a] ?? 99) - (startDist[b] ?? 99));
  return open[0] || g.vaultRoom;
}
// Bersaglio individuale: sulle missioni di scorta gli operativi che NON portano il carico restano
// col portatore (o con l'informatore a terra) invece di correre avanti.
function playerGoalRoom(g, p) {
  if (g.missionId === 'ostaggio') {
    if (g.hostage.holder && g.hostage.holder !== p.id && !g.hostage.delivered) {
      return g.players.find((x) => x.id === g.hostage.holder)?.room ?? g.dropRoom;
    }
  }
  if (g.missionId === 'valigetta' && g.caseHolder && g.caseHolder !== p.id && !g.caseDelivered) {
    const holderRoom = g.players.find((x) => x.id === g.caseHolder)?.room;
    // se il portatore è ancora lontano dall'uscita, gli altri gli restano vicino
    const dToDrop = distanceMap(g, g.dropRoom);
    if (holderRoom && (dToDrop[holderRoom] ?? 0) > 1) return holderRoom;
  }
  return squadGoalRoom(g);
}
function chooseAbility(g, p, hostiles) {
  if (p.focus < 3) return false;
  const strongest = [...hostiles].sort((a, b) => b.hp - a.hp)[0];
  if ((p.characterId === 'chrome' || p.characterId === 'ghost') && strongest) return true;
  if (p.characterId === 'driver' && hostiles.length) return true;
  if (p.characterId === 'ripper') return g.players.some((x) => x.room === p.room && (x.hp <= 0 || x.hp / x.maxHp < 0.55));
  if (p.characterId === 'face') return g.alarm >= 45 || hostiles.length >= 2;
  if (p.characterId === 'cipher') {
    const reach = [p.room, ...roomById(g, p.room).links];
    return reach.some((id) => roomById(g, id).node && !g.nodes[id]) || hostiles.some((e) => e.type === 'DRONE');
  }
  return false;
}
// il portatore del carico/informatore non parte verso l'uscita finché non ha almeno un paio di
// scorte nella stessa stanza: evita che corra avanti e lasci il carico esposto.
function holderShouldWait(g, p) {
  const carrying = g.caseHolder === p.id || g.hostage?.holder === p.id;
  if (!carrying) return false;
  const escorts = g.players.filter((x) => x.id !== p.id && alive(x) && x.room === p.room).length;
  return escorts < Math.min(2, g.players.filter(alive).length - 1);
}
function botTurn(g, p) {
  if (!alive(p)) return;
  let actionsLeft = ACTIONS_PER_TURN;
  const goal = holderShouldWait(g, p) ? p.room : playerGoalRoom(g, p);
  // manovra verso l'obiettivo: consuma un'azione, tranne la prima con Piede sull'acceleratore
  const stepToGoal = () => {
    const n = pathNext(g, p.room, goal);
    if (!n || doorClosed(g, p.room, n)) return false;
    const free = hasPassive(p, 'accelerator') && (p.maneuverCount || 0) < 1;
    if (!free && actionsLeft <= 0) return false;
    p.move = { roomId: n }; p.maneuverCount = (p.maneuverCount || 0) + 1; applyMove(p);
    if (!free) actionsLeft--;
    return true;
  };
  const next = pathNext(g, p.room, goal);
  if (next) {
    if (doorClosed(g, p.room, next) && actionsLeft > 0) { applyAction(p, { type: 'unlock', roomId: next }); actionsLeft--; }
    if (stepToGoal() && hasPassive(p, 'accelerator')) stepToGoal();
  }
  for (let guard = 0; guard < ACTIONS_PER_TURN * 2 && actionsLeft > 0; guard++) {
    const room = roomById(g, p.room);
    const hostiles = enemiesIn(g, p.room);
    const downHere = g.players.some((x) => x.hp <= 0 && x.room === p.room);
    const woundedHere = g.players.some((x) => x.hp > 0 && x.room === p.room && x.hp / x.maxHp < 0.4);

    if (room.node && !g.nodes[p.room] && breachCount(g) < (g.nodesRequired || 2) + 1) {
      applyAction(p, { type: 'hack' }); actionsLeft--; continue;
    }
    // prendere in mano il carico/informatore solo a stanza sgombra: sotto il fuoco del presidio
    // il portatore lo perde subito e il carico resta esposto (o l'informatore si dissangua).
    const roomClear = hostiles.length === 0;
    if (g.missionId === 'valigetta' && !g.caseHolder && !g.caseDelivered && caseRoomNow(g) === p.room && !(p.room === g.vaultRoom && !vaultOpen(g)) && (roomClear || g.caseTaken)) {
      applyAction(p, { type: 'grab' }); actionsLeft--; continue;
    }
    if (g.missionId === 'nucleo' && !g.purged && p.room === g.vaultRoom && vaultOpen(g)) {
      applyAction(p, { type: 'purge' }); actionsLeft--; continue;
    }
    if (g.missionId === 'ostaggio' && !g.hostage.holder && !g.hostage.delivered && hostageRoomNow(g) === p.room && !(!g.hostage.freed && p.room === g.vaultRoom && !vaultOpen(g)) && (roomClear || g.hostage.freed)) {
      applyAction(p, { type: 'free' }); actionsLeft--; continue;
    }
    if ((downHere || woundedHere) && p.characterId === 'ripper' && p.focus >= 3) { applyAction(p, { type: 'ability' }); actionsLeft--; continue; }
    if ((downHere || woundedHere) && p.focus >= 2) { applyAction(p, { type: 'heal' }); actionsLeft--; continue; }
    if (hostiles.length) {
      const strongest = [...hostiles].sort((a, b) => b.hp - a.hp)[0];
      const useAbility = chooseAbility(g, p, hostiles);
      if (!useAbility && p.mag <= 0) { applyAction(p, { type: 'reload' }); actionsLeft--; continue; }
      applyAction(p, { type: useAbility ? 'ability' : 'attack', targetId: strongest.id });
      actionsLeft--; continue;
    }
    if (p.characterId === 'cipher' && p.focus >= 3) {
      const reach = [p.room, ...room.links];
      if (reach.some((id) => roomById(g, id).node && !g.nodes[id])) { applyAction(p, { type: 'ability' }); actionsLeft--; continue; }
    }
    if (p.characterId === 'face' && p.focus >= 3 && g.alarm >= 55) { applyAction(p, { type: 'ability' }); actionsLeft--; continue; }
    // Ultima scelta a stanza sgombra: rabbocca il caricatore invece di sprecare l'azione (un umano
    // ricarica nelle pause, mai sotto il fuoco).
    if (!hostiles.length && p.mag < p.maxMag) { applyAction(p, { type: 'reload' }); actionsLeft--; continue; }
    // niente da fare qui: le azioni avanzate diventano altre manovre verso l'obiettivo
    if (!hostiles.length && stepToGoal()) continue;
    break;
  }
}

// ---------- una partita ----------
function runOne(missionId, size, seed) {
  Math.random = mulberry32(seed);
  const ids = templates.map((t) => t.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const picks = ids.slice(0, size).map((characterId) => ({ characterId }));

  // override della sola missione sotto misura, senza toccare server.mjs
  const mission = MISSIONS[missionId];
  const savedTuning = mission.tuning;
  if (Object.keys(OVERRIDE).length && (!args.mission || args.mission === missionId)) {
    mission.tuning = { ...savedTuning, ...OVERRIDE };
  }
  const g = createGame({ missionId, players: picks });
  mission.tuning = savedTuning;

  __setGame(g);
  g.phase = 'active';
  g.turnOrder = g.players.map((p) => p.id);
  g.activePlayerId = (g.players.find(alive) || g.players[0]).id;
  g.players.forEach((p) => { p.actions = []; p.move = null; p.maneuverCount = 0; p.turnDone = false; });

  let safety = 0;
  while (g.phase === 'active' && safety++ < 4000) {
    const p = g.players.find((x) => x.id === g.activePlayerId);
    if (!p) break;
    if (alive(p)) botTurn(g, p);
    if (alive(p)) enemyStrike(p);
    advanceTurn();
  }

  const living = g.players.filter(alive);
  const objectiveDone = missionId === 'valigetta' ? g.caseDelivered : missionId === 'nucleo' ? g.purged : g.hostage.delivered;
  let cause = null;
  if (g.phase === 'defeat') cause = g.alarm >= 100 ? 'alarm' : (!living.length ? 'wipe' : 'hostage');
  return {
    win: g.phase === 'victory',
    cause,
    round: g.round,
    nodesDone: breachCount(g) >= (g.nodesRequired || 2),
    objectiveDone,
    extractionReady: living.length > 0 && living.every((p) => p.room === g.dropRoom),
  };
}

// ---------- Wilson 95% ----------
function wilson(w, n) {
  if (!n) return { lo: 0, hi: 0, half: 0 };
  const z = 1.959964;
  const phat = w / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: center - half, hi: center + half, half };
}
const pc = (x) => (x * 100).toFixed(0).padStart(3) + '%';

// ---------- run ----------
console.log(`\nROVERPUNK // simulazione bot — ${GAMES} partite/cella, seed ${BASE_SEED}` +
  (Object.keys(OVERRIDE).length ? `, override ${JSON.stringify(OVERRIDE)}` : ''));
console.log('(bot meccanico: winrate = pavimento, non previsione del gioco umano)\n');

for (const missionId of MISSION_IDS) {
  console.log(`\n=== ${missionId.toUpperCase()}  tuning=${JSON.stringify(MISSIONS[missionId].tuning || {})}` +
    `${Object.keys(OVERRIDE).length ? `  (+override)` : ''} ===`);
  console.log(' sq | win rate (95% CI)  | alarm100 | wipe | ostaggio | round | nodi | obiettivo | estraz.');
  const agg = { games: 0, win: 0, alarm: 0 };
  for (const size of SIZES) {
    let win = 0, alarm = 0, wipe = 0, hostage = 0, rounds = 0, nodes = 0, obj = 0, extr = 0;
    for (let i = 0; i < GAMES; i++) {
      const r = runOne(missionId, size, hashSeed(BASE_SEED, missionId.length * 7 + size, i));
      rounds += r.round;
      if (r.nodesDone) nodes++;
      if (r.objectiveDone) obj++;
      if (r.extractionReady) extr++;
      if (r.win) win++;
      else if (r.cause === 'alarm') alarm++;
      else if (r.cause === 'wipe') wipe++;
      else if (r.cause === 'hostage') hostage++;
    }
    const ci = wilson(win, GAMES);
    agg.games += GAMES; agg.win += win; agg.alarm += alarm;
    console.log(`  ${size} | ${pc(win / GAMES)}  [${pc(ci.lo)}-${pc(ci.hi)}] | ${pc(alarm / GAMES)}   | ${pc(wipe / GAMES)} | ${pc(hostage / GAMES)}    | ${(rounds / GAMES).toFixed(1).padStart(4)} | ${pc(nodes / GAMES)} | ${pc(obj / GAMES)}     | ${pc(extr / GAMES)}`);
  }
  const gci = wilson(agg.win, agg.games);
  console.log(` -- aggregato 2-6: win ${pc(agg.win / agg.games)} [${pc(gci.lo)}-${pc(gci.hi)}]  ·  sconfitte allarme ${pc(agg.alarm / agg.games)}`);
}
console.log('');

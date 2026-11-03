// STRUMENTO DI TARATURA // non fa parte del runtime del gioco.
//
// Importa il MOTORE VERO da ../server.mjs (createGame / applyMove / applyAction / enemyStrike /
// advanceTurn / checkBlackout: le stesse funzioni che girano in partita) e ci fa giocare sopra una
// squadra di bot. Serve a misurare, per ogni missione × dimensione squadra (2-6) × livello di
// rischio, l'effetto delle leve di `missionTuning` PRIMA di toccarle davvero.
//
// IL BOT: niente regole scritte a mano per ogni situazione. A ogni turno l'operativo PIANIFICA:
// elenca le azioni legali (le stesse che accetta /api/action), le prova su una copia dello stato
// facendo girare il motore vero, prevede il colpo che prenderà a fine turno e dà un punteggio alla
// posizione (avanzamento dell'obiettivo, integrità, allarme, ostili rimasti, distanza dal proprio
// obiettivo, pericoli della missione). Tiene le sequenze migliori (beam search) e gioca quella.
// Così scopre da solo le combo (finire l'ostile prima di chiudere il turno, Apertura netta,
// Carica da breccia, Identità sintetica per evitare il colpo…) invece di seguire un copione.
//
// Il bot gioca da ESPERTO: pianifica il turno intero (beam 4), zero errori, si divide i nodi coi
// compagni, usa casse e telecamere. Pianifica solo il proprio turno, non quello dei compagni: un
// tavolo umano molto coordinato può fare meglio.
//
// `Math.random` è sostituito da un PRNG con seed: a parità di argomenti l'output è identico. Le
// partite girano in parallelo su più worker.
//
// Uso:
//   npm run sim                                   # tutte le missioni, rischio medio, 100 partite/cella
//   node scripts/simulate.mjs --games=300 --seed=7
//   node scripts/simulate.mjs --mission=nucleo --sizes=2,3,4
//   node scripts/simulate.mjs --risk=all                        # low, medium, high, brutal
//   node scripts/simulate.mjs --mission=valigetta --enemyPower=0.9 --alarmStart=16
//   node scripts/simulate.mjs --sweep=enemyPower:0.6:1.4:0.1 --target=0.5
//   node scripts/simulate.mjs --csv=data/sim.csv                # una riga per partita
//   node scripts/simulate.mjs --trace --mission=spettro --sizes=3   # racconta UNA partita turno per turno
// Altri flag: --workers=N.

import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import {
  MISSIONS, createGame, applyMove, applyAction, enemyStrike, advanceTurn, checkBlackout, alive, __setGame,
} from '../server.mjs';
import { templates } from '../characters.mjs';

// `log()` del motore timbra ogni riga con toLocaleTimeString('it-IT'), che da solo vale gran parte
// del tempo di simulazione. Qui l'orario non serve a nessuno.
Date.prototype.toLocaleTimeString = () => '00:00';

// ---------- costanti del motore (server.mjs) replicate per il bot ----------
const ACTIONS_PER_TURN = 3;
const MOVE_MAX_DISTANCE = 2;
const LAST_PLATE_COOLDOWN = 3;
const ALARM_KNOCKDOWN = 3;
const RISKS = ['low', 'medium', 'high', 'brutal'];
const RISK_LABEL = { low: 'basso', medium: 'medio', high: 'alto', brutal: 'brutale' };
const TUNING_KEYS = ['enemyPower', 'enemyHpPower', 'enemyDmgPower', 'alarmStart'];

// Ricerca del turno: sequenze tenute a ogni passo (beam) e azioni guardate avanti (depth).
const PLANNER = { beam: 4, depth: 4 };

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

// ---------- lettura dello stato (nessuna regola qui: le regole stanno nel motore) ----------
const ROOM_INDEX = new WeakMap();
function roomOf(g, id) {
  let idx = ROOM_INDEX.get(g.map);
  if (!idx) { idx = new Map(g.map.map((r) => [r.id, r])); ROOM_INDEX.set(g.map, idx); }
  return idx.get(id);
}
const doorKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const doorClosed = (g, a, b) => Boolean(g.doors?.[doorKey(a, b)]);
const playerById = (g, id) => g.players.find((p) => p.id === id);
const enemiesIn = (g, id) => g.enemies.filter((e) => e.hp > 0 && e.room === id);
const breachCount = (g) => g.nodeRooms.filter((id) => g.nodes[id]).length;
const vaultOpen = (g) => breachCount(g) >= (g.nodesRequired || 2);
const hasPassive = (p, id) => Boolean(p.passives?.some((x) => x.id === id));
const caseRoomNow = (g) => (g.caseHolder ? playerById(g, g.caseHolder)?.room || g.caseRoom : g.caseRoom);
const hostageRoomNow = (g) => (g.hostage.holder ? playerById(g, g.hostage.holder)?.room || g.hostage.room : g.hostage.room);
const enemyHpSum = (g) => g.enemies.reduce((s, e) => s + Math.max(0, e.hp), 0);
function objectiveDone(g) {
  switch (g.missionId) {
    case 'valigetta': return g.caseDelivered;
    case 'nucleo': return g.purged;
    case 'assedio': return g.download.done;
    case 'reattore': return g.reactor.exploded;
    case 'spettro': return g.specter.captured;
    default: return g.hostage.delivered;
  }
}
// SPETTRO: vie di fuga = porte aperte verso stanze senza operativi in piedi (come specterExits).
function specterExits(g, roomId) {
  return roomOf(g, roomId).links.filter((id) => !doorClosed(g, roomId, id) && !g.players.some((p) => alive(p) && p.room === id));
}

// Distanze statiche (porte ignorate), per assegnare i nodi.
const STATIC_DIST = new WeakMap();
function staticDist(g, from) {
  let all = STATIC_DIST.get(g.map);
  if (!all) { all = new Map(); STATIC_DIST.set(g.map, all); }
  let d = all.get(from);
  if (!d) {
    d = { [from]: 0 };
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      for (const nx of roomOf(g, cur).links) if (d[nx] === undefined) { d[nx] = d[cur] + 1; q.push(nx); }
    }
    all.set(from, d);
  }
  return d;
}
// Costo di cammino verso `goal`: una porta aperta vale 1, una chiusa vale di più (serve
// un'azione e un focus per SBLOCCARLA, e spezza la manovra lunga).
const CLOSED_DOOR_COST = 2.5;
function pathCost(g, goal) {
  const cost = {}; const done = new Set();
  for (const r of g.map) cost[r.id] = Infinity;
  cost[goal] = 0;
  for (;;) {
    let u = null, best = Infinity;
    for (const r of g.map) if (!done.has(r.id) && cost[r.id] < best) { best = cost[r.id]; u = r.id; }
    if (u === null) break;
    done.add(u);
    for (const v of roomOf(g, u).links) {
      const c = best + (doorClosed(g, u, v) ? CLOSED_DOOR_COST : 1);
      if (c < cost[v]) cost[v] = c;
    }
  }
  return cost;
}
// Stanze raggiungibili con UNA manovra: fino a MOVE_MAX_DISTANCE porte aperte (openDistanceMap).
function moveTargets(g, from) {
  const d = { [from]: 0 }; const q = [from]; const out = [];
  while (q.length) {
    const cur = q.shift();
    if (d[cur] >= MOVE_MAX_DISTANCE) continue;
    for (const nx of roomOf(g, cur).links) {
      if (d[nx] === undefined && !doorClosed(g, cur, nx)) { d[nx] = d[cur] + 1; q.push(nx); out.push(nx); }
    }
  }
  return out;
}

// ---------- copia veloce dello stato ----------
// Solo ciò che il motore muta; la plancia (`map`), le passive e i testi sono condivisi. Le code di
// feedback (feed, hits…) ripartono vuote: nella copia non servono.
function cloneGame(g) {
  return {
    ...g,
    players: g.players.map((p) => ({ ...p, mods: [...(p.mods || [])], actions: [...(p.actions || [])] })),
    enemies: g.enemies.map((e) => ({ ...e })),
    doors: { ...g.doors }, nodes: { ...g.nodes },
    cameras: [...g.cameras], chests: g.chests.map((c) => ({ ...c })),
    hostage: { ...g.hostage }, download: { ...g.download }, reactor: { ...g.reactor }, specter: { ...g.specter },
    alarmSpawns: [...g.alarmSpawns], visited: [...g.visited],
    feed: [], hits: [], abilityActivations: [], unlocks: [], modDrops: [],
  };
}

// ---------- azioni legali (stessi controlli di /api/action) ----------
function abilityOptions(g, p) {
  const room = roomOf(g, p.room);
  const hostiles = enemiesIn(g, p.room);
  const reach = [p.room, ...room.links];
  switch (p.characterId) {
    case 'ghost': case 'chrome': return hostiles.map((e) => ({ type: 'ability', targetId: e.id }));
    case 'cipher': return reach.some((id) => roomOf(g, id).node && !g.nodes[id]) || g.enemies.some((e) => e.hp > 0 && e.type === 'DRONE' && reach.includes(e.room)) ? [{ type: 'ability' }] : [];
    case 'ripper': return g.players.some((x) => x.room === p.room && (!alive(x) || x.hp < x.maxHp)) ? [{ type: 'ability' }] : [];
    case 'face': return [{ type: 'ability' }];
    case 'breacher': return hostiles.length || room.links.some((id) => doorClosed(g, p.room, id)) ? [{ type: 'ability' }] : [];
    case 'handler': return g.players.some((x) => x.id !== p.id && alive(x) && x.room === p.room && x.focus < x.maxFocus) ? [{ type: 'ability' }] : [];
    case 'driver': return g.enemies.some((e) => e.hp > 0 && reach.includes(e.room)) ? [{ type: 'ability' }] : [];
    default: return [];
  }
}
function legalActions(g, p, st) {
  const out = [];
  if (!alive(p) || g.phase !== 'active') return out;
  if (st.left > 0 || st.freeMove) for (const id of moveTargets(g, p.room)) out.push({ type: 'move', roomId: id });
  if (st.left <= 0) return out;
  const room = roomOf(g, p.room);
  const hostiles = enemiesIn(g, p.room);
  const sniper = p.mods?.includes('sniper');
  const shootable = g.enemies.filter((e) => e.hp > 0 && (e.room === p.room || (sniper && room.links.includes(e.room) && !doorClosed(g, p.room, e.room))));
  if (p.mag > 0) for (const e of shootable) out.push({ type: 'attack', targetId: e.id });
  if (p.mag < p.maxMag) out.push({ type: 'reload' });
  if (room.node && !g.nodes[p.room] && p.focus >= 2) out.push({ type: 'hack' });
  if ((p.hp < p.maxHp || g.players.some((x) => !alive(x) && x.room === p.room))) out.push({ type: 'heal' });
  if (p.focus >= 1) for (const id of room.links) if (doorClosed(g, p.room, id)) out.push({ type: 'unlock', roomId: id });
  if (p.focus >= 3) out.push(...abilityOptions(g, p));
  const open = vaultOpen(g);
  switch (g.missionId) {
    case 'valigetta':
      if (!g.caseHolder && !g.caseDelivered && caseRoomNow(g) === p.room && !(p.room === g.vaultRoom && !open)) out.push({ type: 'grab' });
      break;
    case 'nucleo': if (!g.purged && p.room === g.vaultRoom && open) out.push({ type: 'purge' }); break;
    case 'assedio': if (!g.download.done && p.room === g.vaultRoom && open) out.push({ type: 'download' }); break;
    case 'reattore': if (!g.reactor.armed && p.room === g.vaultRoom && open) out.push({ type: 'arm' }); break;
    case 'ostaggio':
      if (!g.hostage.delivered && !g.hostage.holder && hostageRoomNow(g) === p.room && !(!g.hostage.freed && p.room === g.vaultRoom && !open)) out.push({ type: 'free' });
      break;
    case 'spettro': {
      const s = g.specter;
      if (s.awake && !s.captured) {
        // SIGILLA solo dove serve: nella stanza di SPETTRO o sulla porta che dà su di lui.
        if (p.focus >= 1) for (const id of room.links) if (!doorClosed(g, p.room, id) && (s.room === p.room || s.room === id)) out.push({ type: 'seal', roomId: id });
        if (s.room === p.room && !specterExits(g, s.room).length) out.push({ type: 'capture' });
      }
      break;
    }
  }
  if (g.cameras.includes(p.room)) out.push({ type: 'camera' });
  if (!hostiles.length && !p.mods?.length && g.chests.some((c) => c.room === p.room && c.uses > 0)) out.push({ type: 'chest' });
  return out;
}

// Esegue un'azione sullo stato `g` (reale o copia) esattamente come /api/action.
function doAction(g, pid, st, a) {
  __setGame(g);
  const p = playerById(g, pid);
  let { left, freeMove } = st;
  if (a.type === 'move') {
    if (freeMove) freeMove = false; else left--;
    p.move = { roomId: a.roomId }; p.maneuverCount = (p.maneuverCount || 0) + 1;
    applyMove(p);
  } else {
    left--;
    p.actions.push(a);
    applyAction(p, a);
  }
  checkBlackout();
  return { left, freeMove };
}

// ---------- valutazione della posizione ----------
// Pesi in "punti". Il riferimento: un passo di obiettivo (nodo violato, carico preso…) vale
// W.progress; una stanza di distanza dal proprio obiettivo vale W.dist; un punto d'integrità W.hp.
// W.progress deve superare il salto massimo del termine distanza quando cambia fase (l'operativo si
// ritrova lontano dal nuovo obiettivo), altrimenti il bot non completa mai il passo: per questo la
// distanza è limitata a DIST_CAP stanze. Conta solo la distanza di chi gioca il turno.
// Pesi tarati massimizzando il win rate del bot (rischio basso, 2/4/6 operativi): una
// W.dist bassa rende la squadra paziente — si cura, aspetta che gli ostili le vengano incontro e
// ingaggia a ranghi compatti — e dimezza i KO rispetto a una squadra che corre all'obiettivo.
// Per ritararli senza toccare il file: SIM_W='{"dist":6}' npm run sim -- ...
const DIST_CAP = 10;
const W = {
  progress: 1000, win: 5000, alarm: 6, alarmLate: 10, down: 150, hp: 0.35, lowHp: 1.2,
  focus: 2, mag: 1.5, emptyMag: 12, mod: 20, dist: 4, enemy: 1.2, blast: 170, hostageHp: 1.5,
};
if (process.env.SIM_W) Object.assign(W, JSON.parse(process.env.SIM_W));


// Il colpo che l'operativo prenderà chiudendo il turno adesso (enemyStrike + enemyDamage).
function predictStrike(g, p) {
  if (!alive(p)) return 0;
  let hp = p.hp;
  let plate = hasPassive(p, 'last-plate') && (g.turn || 0) - (p.lastPlateTurn ?? -LAST_PLATE_COOLDOWN) >= LAST_PLATE_COOLDOWN;
  for (const e of enemiesIn(g, p.room)) {
    if (e.distracted) continue;
    const d = hasPassive(p, 'chrome-plates') ? Math.ceil(e.damage / 2) : e.damage;
    if (hp - d <= 0) {
      if (plate) { hp = 1; plate = false; continue; }
      return 0;
    }
    hp -= d;
  }
  return hp;
}

// Nodi da violare, divisi fra i compagni: si scelgono i nodi più comodi per la squadra e ognuno
// va sul suo, bilanciando i gruppi. L'assegnazione resta stabile finché i nodi restano aperti.
function assignNodes(g, mem) {
  const need = (g.nodesRequired || 2) - breachCount(g);
  const ops = g.players.filter(alive);
  if (need <= 0 || !ops.length) { mem.assign = null; return; }
  const open = g.nodeRooms.filter((id) => !g.nodes[id]);
  if (mem.assign && ops.every((p) => mem.assign.has(p.id) && open.includes(mem.assign.get(p.id)))) return;
  const k = Math.min(need, open.length);
  const combos = k === 1 ? open.map((x) => [x]) : open.flatMap((a, i) => open.slice(i + 1).map((b) => [a, b]));
  let set = combos[0], bestCost = Infinity;
  for (const c of combos) {
    const cost = c.reduce((s, n) => s + Math.min(...ops.map((p) => staticDist(g, p.room)[n] ?? 99)), 0);
    if (cost < bestCost) { bestCost = cost; set = c; }
  }
  const load = Object.fromEntries(set.map((n) => [n, 0]));
  mem.assign = new Map();
  for (const p of [...ops].sort((a, b) => a.id.localeCompare(b.id))) {
    const n = [...set].sort((a, b) => ((staticDist(g, p.room)[a] ?? 99) + 2 * load[a]) - ((staticDist(g, p.room)[b] ?? 99) + 2 * load[b]))[0];
    load[n]++;
    mem.assign.set(p.id, n);
  }
}

// Dove deve andare ciascun operativo in questa fase della missione.
function goalRoom(g, p, mem, lostHolder) {
  if (!vaultOpen(g)) {
    let n = mem.assign?.get(p.id);
    if (!n || g.nodes[n]) n = g.nodeRooms.filter((id) => !g.nodes[id]).sort((a, b) => (staticDist(g, p.room)[a] ?? 99) - (staticDist(g, p.room)[b] ?? 99))[0];
    return n || g.vaultRoom;
  }
  switch (g.missionId) {
    case 'valigetta': {
      if (g.caseDelivered) return g.dropRoom;
      const holder = g.caseHolder !== lostHolder ? g.caseHolder : null;
      if (holder === p.id) return g.dropRoom;
      if (holder) return playerById(g, holder).room;
      return caseRoomNow(g) || (g.caseHolder ? playerById(g, g.caseHolder).room : g.vaultRoom);
    }
    case 'ostaggio': {
      if (g.hostage.delivered) return g.dropRoom;
      const holder = g.hostage.holder !== lostHolder ? g.hostage.holder : null;
      if (holder === p.id) return g.dropRoom;
      if (holder) return playerById(g, holder).room;
      return hostageRoomNow(g);
    }
    case 'nucleo': return g.purged ? g.dropRoom : g.vaultRoom;
    case 'assedio': return g.download.done ? g.dropRoom : g.vaultRoom;
    case 'reattore': return g.reactor.armed ? g.dropRoom : g.vaultRoom;
    case 'spettro': return g.specter.captured ? g.dropRoom : g.specter.room;
    default: return g.dropRoom;
  }
}

// Avanzamento dell'obiettivo, in "passi". Il carico che cade con chi va a terra non conta.
function progress(g, lostHolder, living) {
  let s = Math.min(breachCount(g), g.nodesRequired || 2);
  let done = objectiveDone(g);
  switch (g.missionId) {
    case 'valigetta': {
      const holder = g.caseHolder !== lostHolder ? g.caseHolder : null;
      // la consegna scatta a fine turno se il portatore è già al punto di raccolta
      if (g.caseDelivered || (holder && playerById(g, holder).room === g.dropRoom)) { s += 2; done = true; }
      else if (holder) s += 1;
      else if (g.caseTaken) s += 0.5;
      break;
    }
    case 'ostaggio': {
      const holder = g.hostage.holder !== lostHolder ? g.hostage.holder : null;
      if (g.hostage.delivered || (holder && playerById(g, holder).room === g.dropRoom)) { s += 2; done = true; }
      else if (holder) s += 1;
      else if (g.hostage.freed) s += 0.5;
      break;
    }
    case 'nucleo': if (g.purged) s += 2; break;
    case 'assedio': s += g.download.done ? 2.5 : g.download.progress * 0.5; break;
    case 'reattore': if (g.reactor.exploded) s += 2; else if (g.reactor.armed) s += 1 + (g.reactor.required - g.reactor.fuse) * 0.1; break;
    case 'spettro': {
      const sp = g.specter;
      if (sp.captured) s += 2.5;
      else if (sp.awake) s += 0.12 * (roomOf(g, sp.room).links.length - specterExits(g, sp.room).length);
      break;
    }
  }
  if (done && living.length) {
    const inDrop = living.filter((p) => p.room === g.dropRoom).length;
    const clear = !enemiesIn(g, g.dropRoom).length;
    s += 0.4 * inDrop / living.length * 3;
    if (inDrop === living.length && clear) s += W.win / W.progress; // vittoria a fine turno
  }
  return s;
}

function evaluate(g, pid, mem) {
  const me = playerById(g, pid);
  const myHp = predictStrike(g, me);
  const meFalls = alive(me) && myHp <= 0;
  const hpOf = (p) => (p.id === pid ? myHp : p.hp);
  const lostHolder = meFalls ? pid : null;
  const living = g.players.filter((p) => hpOf(p) > 0);
  const alarm = g.alarm + (meFalls ? ALARM_KNOCKDOWN : 0);
  if (!living.length) return -1e6;
  if (g.missionId === 'ostaggio' && g.hostage.freed && !g.hostage.delivered && g.hostage.hp <= 0) return -1e6;
  let v = W.progress * progress(g, lostHolder, living);
  v -= W.alarm * alarm + (alarm > 80 ? W.alarmLate * (alarm - 80) : 0);
  if (alarm >= 99) v -= 1e5;
  for (const p of g.players) {
    const hp = hpOf(p);
    if (hp <= 0) { v -= W.down; continue; }
    v += W.hp * hp - (hp < 0.35 * p.maxHp ? W.lowHp * (0.35 * p.maxHp - hp) : 0);
    v += W.focus * Math.min(p.focus, 6) + (p.mag <= 0 ? -W.emptyMag : W.mag * Math.min(p.mag, 3)) + (p.mods?.length ? W.mod : 0);
    if (p.id !== pid) continue;
    const goal = goalRoom(g, p, mem, lostHolder);
    let d = Math.min(pathCost(g, goal)[p.room], DIST_CAP);
    // a caccia di SPETTRO anche presidiare una stanza accanto serve (gli chiude una via)
    if (g.missionId === 'spettro' && goal === g.specter.room && !g.specter.captured) d = Math.max(0, d - 1);
    v -= W.dist * d;
  }
  for (const e of g.enemies) if (e.hp > 0) v -= W.enemy * e.hp * e.damage / 25;
  // REATTORE innescato: chi resta nel raggio quando non avrà più un turno per uscirne va a terra.
  if (g.missionId === 'reattore' && g.reactor.armed && !g.reactor.exploded) {
    const blast = new Set([g.vaultRoom, ...roomOf(g, g.vaultRoom).links]);
    const order = g.turnOrder; const n = order.length; const myIdx = order.indexOf(pid);
    for (const p of living) {
      if (!blast.has(p.room)) continue;
      const j = p.id === pid ? n : ((order.indexOf(p.id) - myIdx + n) % n);
      v -= j >= g.reactor.fuse ? W.blast : W.blast * 0.15;
    }
  }
  if (g.missionId === 'ostaggio' && g.hostage.freed && !g.hostage.delivered) v += W.hostageHp * g.hostage.hp;
  return v;
}

// ---------- pianificazione del turno (beam search sul motore vero) ----------
function signature(g, pid) {
  const p = playerById(g, pid);
  return `${p.room}|${p.hp}|${p.focus}|${p.mag}|${g.alarm}|${enemyHpSum(g)}|${breachCount(g)}`;
}
function planTurn(g, pid, st, mem) {
  const root = { g, st, seq: [], sigs: [], v: evaluate(g, pid, mem) };
  let best = root;
  let beam = [root];
  const depth = Math.min(PLANNER.depth, st.left + (st.freeMove ? 1 : 0));
  for (let d = 0; d < depth; d++) {
    const children = [];
    for (const node of beam) {
      for (const a of legalActions(node.g, playerById(node.g, pid), node.st)) {
        const c = cloneGame(node.g);
        const st2 = doAction(c, pid, node.st, a);
        children.push({ g: c, st: st2, seq: [...node.seq, a], sigs: [...node.sigs, signature(c, pid)], v: evaluate(c, pid, mem) });
      }
    }
    if (!children.length) break;
    children.sort((a, b) => b.v - a.v);
    beam = children.slice(0, PLANNER.beam);
    if (beam[0].v > best.v + 1e-9) best = beam[0];
  }
  return best;
}

// ---------- statistiche di una partita ----------
function newStats(g) {
  const per = {};
  for (const p of g.players) per[p.characterId] = { dmg: 0, ko: 0, ab: 0, rev: 0 };
  return { per, koRooms: {}, alarmAt: {}, tNodes: null, tObj: null, chain: 0, trace: null };
}
function describe(a) {
  return a.type + (a.roomId ? `→${a.roomId}` : '') + (a.targetId ? `@${a.targetId}` : '');
}

function playTurn(g, p, mem, stats) {
  let st = { left: ACTIONS_PER_TURN, freeMove: hasPassive(p, 'accelerator') };
  assignNodes(g, mem);
  const done = [];
  let plan = null, idx = 0;
  for (let guard = 0; guard < 10 && alive(p) && g.phase === 'active'; guard++) {
    if (!plan || idx >= plan.seq.length) { plan = planTurn(g, p.id, st, mem); idx = 0; }
    if (!plan.seq.length) break;
    const a = plan.seq[idx];
    const hpBefore = enemyHpSum(g);
    const downBefore = g.players.filter((x) => !alive(x)).length;
    st = doAction(g, p.id, st, a);
    __setGame(g);
    const s = stats.per[p.characterId];
    s.dmg += Math.max(0, hpBefore - enemyHpSum(g));
    if (a.type === 'ability') s.ab++;
    s.rev += Math.max(0, downBefore - g.players.filter((x) => !alive(x)).length);
    done.push(describe(a));
    idx++;
    if (plan.sigs[idx - 1] !== signature(g, p.id)) plan = null; // il caso (colpo doppio, cassa) ha cambiato le carte
  }
  return done;
}

// ---------- una partita ----------
function runOne({ missionId, size, risk, override }, seed, trace = false) {
  Math.random = mulberry32(seed);
  const ids = templates.map((t) => t.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const picks = ids.slice(0, size).map((characterId) => ({ characterId }));

  const mission = MISSIONS[missionId];
  const savedTuning = mission.tuning;
  if (override && Object.keys(override).length) mission.tuning = { ...savedTuning, ...override };
  const g = createGame({ missionId, players: picks, riskLevel: risk, maxPlayers: size });
  mission.tuning = savedTuning;

  __setGame(g);
  g.phase = 'active';
  g.turnOrder = g.players.map((p) => p.id);
  g.activePlayerId = g.players[0].id;
  g.players.forEach((p) => { p.actions = []; p.move = null; p.maneuverCount = 0; p.turnDone = false; });

  const stats = newStats(g);
  const mem = { assign: null };
  const lines = trace ? [] : null;
  const noteAlarm = () => {
    for (const thr of [25, 50, 75]) if (g.alarm >= thr && stats.alarmAt[thr] === undefined) stats.alarmAt[thr] = g.turn;
    if (stats.tNodes === null && vaultOpen(g)) stats.tNodes = g.turn;
    if (stats.tObj === null && objectiveDone(g)) stats.tObj = g.turn;
  };
  const noteKnockdowns = (before) => {
    for (const p of g.players) if (before.has(p.id) && !alive(p)) {
      stats.per[p.characterId].ko++;
      stats.koRooms[p.room] = (stats.koRooms[p.room] || 0) + 1;
    }
  };

  // KO A CATENA: chi si rialza da solo torna in piedi a 1 di integrità e gioca subito; se ricade
  // entro fine turno è la spirale che trascina l'allarme a 100 (+3 a ogni KO).
  const fallen = new Set();
  let safety = 0;
  while (g.phase === 'active' && safety++ < 3000) {
    const p = playerById(g, g.activePlayerId);
    if (!p) break;
    const rose = alive(p) && fallen.has(p.id);
    if (rose) fallen.delete(p.id);
    let done = [];
    if (alive(p)) {
      const up = new Set(g.players.filter(alive).map((x) => x.id));
      done = playTurn(g, p, mem, stats);
      noteKnockdowns(up);
    }
    __setGame(g);
    const hpBefore = p.hp;
    const up = new Set(g.players.filter(alive).map((x) => x.id));
    if (alive(p)) enemyStrike(p);
    if (lines && (done.length || hpBefore > 0)) {
      lines.push(`T${String(g.turn).padStart(3)} R${String(g.round).padStart(2)} ${p.callsign.padEnd(5)} @${p.room} hp ${String(p.hp).padStart(3)}/${p.maxHp}${hpBefore !== p.hp ? ` (-${hpBefore - p.hp})` : ''} foc ${p.focus} mag ${p.mag} | ${done.join(', ') || '—'} | allarme ${g.alarm}`);
    }
    if (rose && !alive(p)) stats.chain++;
    for (const x of g.players) if (!alive(x)) fallen.add(x.id);
    advanceTurn();
    noteKnockdowns(up);
    noteAlarm();
  }

  const living = g.players.filter(alive);
  let cause = null;
  if (g.phase === 'defeat') {
    const hostageLost = g.missionId === 'ostaggio' && g.hostage.freed && !g.hostage.delivered && g.hostage.hp <= 0;
    cause = !living.length ? 'wipe' : hostageLost ? 'hostage' : g.alarm >= 100 ? 'alarm' : 'altro';
  } else if (g.phase === 'active') cause = 'stallo';
  if (lines) {
    lines.push(`ESITO: ${g.phase === 'victory' ? 'VITTORIA' : `SCONFITTA (${cause})`} al turno ${g.turn}, round ${g.round}, allarme ${g.alarm}`);
    stats.trace = lines;
  }
  return {
    m: missionId, size, risk, val: override?.__val ?? null, seed,
    win: g.phase === 'victory', cause, turns: g.turn, rounds: g.round, alarm: g.alarm,
    standing: living.length, t25: stats.alarmAt[25] ?? null, t50: stats.alarmAt[50] ?? null, t75: stats.alarmAt[75] ?? null,
    tNodes: stats.tNodes, tObj: stats.tObj, nodes: vaultOpen(g), obj: objectiveDone(g), chain: stats.chain,
    chars: g.players.map((p) => p.characterId), per: stats.per, koRooms: stats.koRooms, trace: stats.trace,
  };
}

function runTask(task) {
  const out = [];
  const mIdx = Object.keys(MISSIONS).indexOf(task.missionId);
  for (let i = 0; i < task.games; i++) {
    const seed = hashSeed(task.baseSeed, mIdx * 7 + task.size, i);
    const r = runOne(task, seed);
    delete r.trace;
    out.push(r);
  }
  return out;
}

// ---------- main ----------
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  const GAMES = Number(args.games || 100);
  const BASE_SEED = Number(args.seed || 1234);
  const SIZES = (args.sizes ? String(args.sizes).split(',') : ['2', '3', '4', '5', '6']).map(Number);
  const MISSION_IDS = args.mission ? String(args.mission).split(',') : Object.keys(MISSIONS);
  const RISK_IDS = args.risk === 'all' ? RISKS : String(args.risk || 'medium').split(',');
  const sweep = args.sweep ? parseSweep(String(args.sweep)) : null;
  const OVERRIDE = {};
  for (const k of TUNING_KEYS) if (args[k] !== undefined) OVERRIDE[k] = Number(args[k]);
  for (const id of MISSION_IDS) if (!MISSIONS[id]) throw new Error(`Missione sconosciuta: ${id}`);
  for (const id of RISK_IDS) if (!RISKS.includes(id)) throw new Error(`Rischio sconosciuto: ${id} (${RISKS.join(', ')})`);

  // --trace: una partita raccontata turno per turno, nel thread principale.
  if (args.trace) {
    const task = { missionId: MISSION_IDS[0], size: SIZES[0], risk: RISK_IDS[0], override: OVERRIDE };
    const r = runOne(task, hashSeed(BASE_SEED, Object.keys(MISSIONS).indexOf(task.missionId) * 7 + task.size, Number(args.game || 0)), true);
    console.log(`\nTRACCIA — ${task.missionId} · ${task.size} operativi (${r.chars.join(', ')}) · rischio ${RISK_LABEL[task.risk]}\n`);
    console.log(r.trace.join('\n'));
    return;
  }

  const tasks = [];
  const values = sweep ? sweep.values : [null];
  for (const missionId of MISSION_IDS) for (const risk of RISK_IDS) for (const val of values) for (const size of SIZES) {
    const override = { ...OVERRIDE };
    if (sweep) { override[sweep.key] = val; override.__val = val; }
    tasks.push({ id: tasks.length, missionId, size, risk, override, games: GAMES, baseSeed: BASE_SEED });
  }
  const nWorkers = Math.max(1, Math.min(Number(args.workers || availableParallelism() - 1), tasks.length));
  console.log(`\nROVERPUNK // simulazione — ${GAMES} partite/cella · seed ${BASE_SEED} · rischio ${RISK_IDS.map((r) => RISK_LABEL[r]).join('/')} · ${nWorkers} worker` +
    (Object.keys(OVERRIDE).length ? ` · override ${JSON.stringify(OVERRIDE)}` : '') + (sweep ? ` · sweep ${sweep.key} ${values.join(' ')}` : ''));
  const t0 = Date.now();
  const records = await runPool(tasks, nWorkers);
  console.log(`(${records.length} partite in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (args.csv) writeCsv(String(args.csv), records);
  if (sweep) printSweep(records, MISSION_IDS, RISK_IDS, SIZES, sweep, Number(args.target ?? 0.5));
  else printReport(records, MISSION_IDS, RISK_IDS, SIZES);
}

function parseSweep(s) {
  const [key, from, to, step] = s.split(':');
  if (!TUNING_KEYS.includes(key)) throw new Error(`--sweep: leva sconosciuta ${key} (${TUNING_KEYS.join(', ')})`);
  const a = Number(from), b = Number(to), st = Number(step || (key === 'alarmStart' ? 2 : 0.1));
  const values = [];
  for (let v = a; v <= b + 1e-9; v += st) values.push(Number(v.toFixed(4)));
  return { key, values };
}

function runPool(tasks, n) {
  return new Promise((resolve, reject) => {
    const queue = [...tasks];
    const out = [];
    let finished = 0;
    let lastPct = -1;
    const workers = Array.from({ length: n }, () => new Worker(new URL(import.meta.url)));
    const feed = (w) => { const t = queue.shift(); if (t) w.postMessage(t); };
    for (const w of workers) {
      w.on('message', ({ records }) => {
        out.push(...records);
        finished++;
        const pct = Math.floor((finished / tasks.length) * 10) * 10;
        if (pct !== lastPct && process.stderr.isTTY) { lastPct = pct; process.stderr.write(`\r  avanzamento ${pct}%   `); }
        if (finished === tasks.length) {
          if (process.stderr.isTTY) process.stderr.write('\r                      \r');
          workers.forEach((x) => x.terminate());
          resolve(out);
        } else feed(w);
      });
      w.on('error', reject);
      feed(w);
    }
  });
}

// ---------- report ----------
function wilson(w, n) {
  if (!n) return { lo: 0, hi: 0 };
  const z = 1.959964, phat = w / n, denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n))) / denom;
  return { lo: center - half, hi: center + half };
}
const pc = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—').padStart(4);
const num = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
const winRate = (rs) => (rs.length ? rs.filter((r) => r.win).length / rs.length : NaN);
const alarmLossRate = (rs) => (rs.length ? rs.filter((r) => r.cause === 'alarm').length / rs.length : NaN);
const winLoss = (rs) => `${pc(winRate(rs))}/${pc(alarmLossRate(rs))}`;
const isClose = (r) => r.win && (r.alarm >= 75 || r.standing <= 1);
const isEasy = (r) => r.win && r.alarm < 50 && Object.values(r.per).every((s) => s.ko === 0);
const callsign = Object.fromEntries(templates.map((t) => [t.id, t.callsign]));

function printReport(records, missionIds, riskIds, sizes) {
  for (const risk of riskIds) for (const m of missionIds) {
    const R = records.filter((r) => r.m === m && r.risk === risk);
    const roomName = Object.fromEntries(MISSIONS[m].layout.rooms.map((r) => [r.id, r.name]));
    console.log(`\n=== ${m.toUpperCase()} · rischio ${RISK_LABEL[risk]} · tuning ${JSON.stringify(MISSIONS[m].tuning || {})} ===`);

    if (!R.length) continue;
    console.log(' sq | win  (95% CI)   | loss allarme 100% | wipe | ostag. | turni med/p90 | round | sul filo | facili | nodi | obiett.');
    for (const size of sizes) {
      const c = R.filter((r) => r.size === size);
      const n = c.length, w = c.filter((r) => r.win).length, ci = wilson(w, n);
      const share = (f) => c.filter(f).length / n;
      const turns = c.map((r) => r.turns);
      console.log(`  ${size} | ${pc(w / n)} [${pc(ci.lo)}-${pc(ci.hi)}] | ${pc(share((r) => r.cause === 'alarm')).padStart(9)}         | ${pc(share((r) => r.cause === 'wipe'))} |  ${pc(share((r) => r.cause === 'hostage'))}  |  ${String(quantile(turns, 0.5)).padStart(4)}/${String(quantile(turns, 0.9)).padEnd(4)}    | ${num(mean(c.map((r) => r.rounds))).padStart(5)} |   ${pc(share(isClose))}   |  ${pc(share(isEasy))}  | ${pc(share((r) => r.nodes))} | ${pc(share((r) => r.obj))}`);
    }
    const reach = (k) => { const xs = R.map((r) => r[k]).filter((x) => x !== null); return `turno ${num(mean(xs), 0)} (${pc(xs.length / R.length).trim()} delle partite)`; };
    console.log(` curva allarme: 25% al ${reach('t25')} · 50% al ${reach('t50')} · 75% al ${reach('t75')}`);
    const wins = R.filter((r) => r.win);
    console.log(` fasi: nodi aperti al turno ${num(mean(R.map((r) => r.tNodes).filter((x) => x !== null)), 0)} · obiettivo al turno ${num(mean(R.map((r) => r.tObj).filter((x) => x !== null)), 0)} · vittoria al turno ${num(mean(wins.map((r) => r.turns)), 0)} · allarme medio a fine vittoria ${num(mean(wins.map((r) => r.alarm)), 0)}`);

    printCharacters(R, '');

    const ko = {};
    let koTot = 0;
    for (const r of R) for (const [room, k] of Object.entries(r.koRooms)) { ko[room] = (ko[room] || 0) + k; koTot += k; }
    const top = Object.entries(ko).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (top.length) {
      const chain = R.reduce((a, r) => a + r.chain, 0);
      console.log(` KO: ${num(koTot / R.length, 2)} a partita, ${pc(chain / koTot).trim()} a catena (ricaduti appena rialzati)`);
      console.log(` stanze dove si va a terra: ${top.map(([id, k]) => `${id} ${roomName[id] || ''} ${pc(k / koTot).trim()}`).join(' · ')}`);
    }
  }

  if (missionIds.length > 1 && records.length) {
    const R = records.filter((r) => r.risk === riskIds[0]);
    console.log(`\n=== OPERATIVI · tutte le missioni · rischio ${RISK_LABEL[riskIds[0]]} ===`);
    printCharacters(R, '');
  }
  console.log('');
}

function printCharacters(R, indent) {
  console.log(`${indent} operativo | win con | Δ senza | danno/p | KO/p | abilità/p | rianima/p`);
  const rows = templates.map((t) => {
    const withIt = R.filter((r) => r.chars.includes(t.id));
    const without = R.filter((r) => !r.chars.includes(t.id));
    if (!withIt.length) return null;
    const avg = (k) => mean(withIt.map((r) => r.per[t.id][k]));
    return { t, w: winRate(withIt), d: winRate(withIt) - winRate(without), dmg: avg('dmg'), ko: avg('ko'), ab: avg('ab'), rev: avg('rev') };
  }).filter(Boolean).sort((a, b) => b.d - a.d);
  for (const x of rows) {
    const delta = Number.isFinite(x.d) ? `${x.d >= 0 ? '+' : ''}${(x.d * 100).toFixed(0)}pt` : '—';
    console.log(`${indent} ${`${x.t.callsign} ${x.t.role}`.padEnd(15).slice(0, 15)}| ${pc(x.w)}    | ${delta.padStart(6)}  | ${num(x.dmg, 0).padStart(6)}  | ${num(x.ko, 2)} |   ${num(x.ab, 1).padStart(4)}    |   ${num(x.rev, 2)}`);
  }
}

function printSweep(records, missionIds, riskIds, sizes, sweep, target) {
  for (const risk of riskIds) for (const m of missionIds) {
    console.log(`\n=== SWEEP ${sweep.key} · ${m.toUpperCase()} · rischio ${RISK_LABEL[risk]} · obiettivo win ${pc(target).trim()} ===`);
    console.log(`  celle: win/loss per allarme 100%`);
    console.log(`  ${sweep.key.padEnd(10)} | ${'tot'.padEnd(9)} | ${sizes.map((s) => `sq${s}`.padEnd(9)).join(' | ')}`);
    const curve = [];
    for (const val of sweep.values) {
      const rs = records.filter((r) => r.m === m && r.risk === risk && r.val === val);
      const w = winRate(rs);
      curve.push([val, w]);
      console.log(`  ${String(val).padEnd(10)} | ${winLoss(rs)} | ${sizes.map((s) => winLoss(rs.filter((r) => r.size === s))).join(' | ')}`);
    }
    // interpolazione lineare sul primo tratto che attraversa l'obiettivo
    let pick = null;
    for (let i = 1; i < curve.length; i++) {
      const [a, wa] = curve[i - 1], [b, wb] = curve[i];
      if ((wa - target) * (wb - target) <= 0 && wa !== wb) { pick = a + ((target - wa) * (b - a)) / (wb - wa); break; }
    }
    if (pick === null) {
      const closest = [...curve].sort((x, y) => Math.abs(x[1] - target) - Math.abs(y[1] - target))[0];
      console.log(`  → nessun valore attraversa ${pc(target).trim()}: il più vicino è ${closest[0]} (${pc(closest[1]).trim()})`);
    } else console.log(`  → valore suggerito: ${sweep.key} ≈ ${pick.toFixed(sweep.key === 'alarmStart' ? 0 : 2)}`);
  }
  console.log('');
}

function writeCsv(path, records) {
  const head = ['mission', 'risk', 'size', 'sweep', 'seed', 'win', 'cause', 'turns', 'rounds', 'alarm', 'standing', 't25', 't50', 't75', 'tNodes', 'tObj', 'chainKo', 'chars', 'kos', 'dmg'];
  const rows = records.map((r) => [
    r.m, r.risk, r.size, r.val ?? '', r.seed, r.win ? 1 : 0, r.cause ?? '', r.turns, r.rounds, r.alarm, r.standing,
    r.t25 ?? '', r.t50 ?? '', r.t75 ?? '', r.tNodes ?? '', r.tObj ?? '', r.chain,
    r.chars.map((c) => callsign[c]).join('+'),
    r.chars.map((c) => r.per[c].ko).join('+'),
    r.chars.map((c) => Math.round(r.per[c].dmg)).join('+'),
  ].join(','));
  writeFileSync(path, [head.join(','), ...rows].join('\n') + '\n');
  console.log(`CSV: ${records.length} righe in ${path}`);
}

// ---------- avvio: i worker giocano, il thread principale distribuisce e riassume ----------
if (!isMainThread) {
  parentPort.on('message', (task) => parentPort.postMessage({ id: task.id, records: runTask(task) }));
} else {
  await main();
}

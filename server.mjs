import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { templates } from './characters.mjs';
import { ENEMY_ROSTER } from './enemies.mjs';

// Porta dedicata a Roverpunk.
const PORT = Number(process.env.PORT || 5174);
// Nell'app desktop (`desktop/`) i dati vivono in ~/Library/Application Support e i file statici
// dentro il bundle: `ROVERPUNK_DATA_DIR` / `ROVERPUNK_ROOT` li spostano. Senza variabili nulla cambia.
const DATA_DIR = process.env.ROVERPUNK_DATA_DIR ? pathToFileURL(join(process.env.ROVERPUNK_DATA_DIR, '/')) : new URL('./data/', import.meta.url);
const DATA_FILE = new URL('game-state.json', DATA_DIR);
const DATA_TMP = new URL('game-state.json.tmp', DATA_DIR);
const APP_ROOT = process.env.ROVERPUNK_ROOT || process.cwd();

// Finestra entro cui un telefono è considerato collegato (3 ping persi).
const LINK_TIMEOUT = 15000;

// TARATURA UNICA
// Ogni costante qui sotto è una leva della pressione sulla squadra. Il round è a TURNI: ogni
// operativo gioca il suo turno singolarmente, nell'ordine fisso di `turnOrder` (sempre lo stesso,
// in cerchio, si riparte sempre dal primo). La torre risponde a OGNI turno chiuso, non a fine giro
// (vedi `resolveTurnEnd`). Nessun timer: se un telefono è offline il suo turno lo salta la plancia
// con SALTA TURNO.
// RISCHIO: in fase di configurazione la plancia sceglie uno dei quattro livelli qui sotto (leva unica
// per tutta la squadra, uguale per ogni missione). Sostituisce l'`alarmStart`/`enemyPower` fisso
// della missione, che resta come override esplicito solo se una missione lo dichiara nel proprio
// `tuning` (nessuna lo fa oggi). `enemyPower` moltiplica insieme INTEGRITÀ e DANNO di ogni Helix,
// SEGUGI inclusi. Vedi `missionTuning` e `npm run sim`.
// `autoRise`: chi va a terra si rialza da solo dopo AUTO_RISE_SKIPPED_TURNS (anche Rientro rapido).
// `allyRevive`: un compagno può rialzarlo con RIPRISTINO / Protocollo Lazarus. ALTO toglie il
// rialzo automatico; BRUTALE li toglie entrambi: chi cade è fuori per il resto della missione.
const RISK_LEVELS = {
  low: { label: 'basso', alarmStart: 15, enemyPower: 0.95, autoRise: true, allyRevive: true },
  medium: { label: 'medio', alarmStart: 16, enemyPower: 1.00, autoRise: true, allyRevive: true },
  high: { label: 'alto', alarmStart: 17, enemyPower: 1.05, autoRise: false, allyRevive: true },
  brutal: { label: 'brutale', alarmStart: 18, enemyPower: 1.10, autoRise: false, allyRevive: false },
};
const DEFAULT_RISK_LEVEL = 'medium';
// L'allarme sale col respiro della torre (+1 a ogni fine turno operativo, giocato o saltato) più
// due picchi secchi: violare un nodo e sbloccare l'obiettivo della missione (valigetta/purga/
// ostaggio). Nessuna pressione da contatto/zona esposta/carico. L'unica cosa che lo abbassa è
// l'Identità sintetica di ECHO.
const ALARM_PER_TURN = 1;          // pressione ad ogni fine turno operativo
const ALARM_NODE_BREACH = 5;       // picco alla violazione di ogni nodo
const ALARM_OBJECTIVE_UNLOCK = 10; // picco allo sblocco dell'obiettivo della missione
const ALARM_FACE_RELIEF = 2;       // Identità sintetica del FACE
// Ogni operativo che va a terra costa tempo alla squadra: il danno subito diventa allarme. Se però
// non resta nessuno in piedi, la missione è persa per WIPE.
const ALARM_KNOCKDOWN = 3;
const ALARM_CAMERA_DISABLE = 2;   // sconto d'allarme quando si disabilita una telecamera

// CASSE DI POTENZIAMENTO
// Ogni missione ne dichiara UNA sola nel proprio `layout.chests` (mai la stanza di partenza, di
// uscita, dell'obiettivo o di un nodo — di norma una stanza senza altri ruoli). È fissa come le
// telecamere: stessa plancia, stessa cassa a ogni partita. L'azione APRI CASSA (`chest`) è
// disponibile a tutti e pesca UNA modifica a caso, che si equipaggia sul momento e resta per
// tutta la partita. Ogni operativo può portare UNA SOLA modifica: chi ce l'ha già non apre più
// la cassa, quindi le modifiche in palio vanno per forza a operativi diversi.
// La cassa non si apre finché restano ostili nella stanza: prima si ripulisce, poi si saccheggia.
// La cassa contiene tante modifiche quanti sono i giocatori scelti in fase di setup
// (`maxPlayers`), una per apertura, e poi si esaurisce (resta disegnata sulla plancia, ma spenta).
const MOD_MAG_BONUS = 5;        // Caricatore esteso
const MOD_BARREL_BONUS = 2;     // Canna rinforzata
const MOD_DOUBLE_CHANCE = 0.5;  // Colpo doppio
// Modulo termico: bonus per colpo consecutivo sullo stesso bersaglio (primo colpo nessun bonus,
// secondo +20%, dal terzo +30%). L'indice è il numero di colpi già messi a segno di fila.
const MOD_THERMAL_STEPS = [0, 0.2, 0.3];
const MODS = [
  {id:'mag', name:'CARICATORE ESTESO', text:`+${MOD_MAG_BONUS} munizioni nel caricatore.`},
  {id:'double', name:'COLPO DOPPIO', text:'50% di possibilità di raddoppiare il danno dell’attacco.'},
  {id:'sniper', name:'CECCHINO', text:'Puoi colpire i nemici a una stanza di distanza, oltre una porta aperta.'},
  {id:'barrel', name:'CANNA RINFORZATA', text:`+${MOD_BARREL_BONUS} danni fissi a ogni attacco.`},
  {id:'thermal', name:'MODULO TERMICO', text:'Colpi consecutivi sullo stesso bersaglio: +20% al secondo, +30% dal terzo.'},
];
const hasMod = (player, modId) => Boolean(player?.mods?.includes(modId));
const modById = (id) => MODS.find((m) => m.id === id);
const BLACKOUT_ALARM = 50;         // oltre questa soglia la torre stacca la corrente: ogni porta si richiude
const LOCKDOWN_ALARM = 70;         // oltre questa soglia la torre allerta ogni presidio: tutti convergono sui Player
const ALARM_SPAWN_THRESHOLDS = [25, 35, 45, 55, 65, 75, 85]; // a ogni soglia un nuovo SEGUGIO entra nella penultima stanza prima dell'EXIT e parte a caccia
const NODES_REQUIRED = 2;          // nodi da violare per sbloccare la teca
const ACTIONS_PER_TURN = 3;        // azioni giocabili in un turno: ogni manovra ne consuma una
const MOVE_MAX_DISTANCE = 2;       // la manovra si può puntare fino a 2 porte aperte di distanza: l'operativo arriva direttamente lì
const REVIVE_RATIO = 0.25;
const AUTO_RISE_HP = 1;
const AUTO_RISE_SKIPPED_TURNS = 3; // chi va a terra si rialza dopo aver saltato 3 dei propri turni
const QUICK_REBOUND_SKIPPED_TURNS = 1; // Rientro rapido: si rialza dopo 1 solo turno saltato...
const QUICK_REBOUND_RATIO = 0.25;      // ...al 25% dell'integrità invece che a AUTO_RISE_HP
const HEAL_AMOUNT = 16;            // RIPRISTINO su se stessi — allineato a src/App.tsx
const LAZARUS_RATIO = 0.4;
const LAZARUS_TARGETS = 2;         // Protocollo Lazarus: al massimo 2 bersagli, qualunque sia la squadra
const BREACH_DAMAGE = 20;          // Carica da breccia del BREACHER: danno a ogni ostile della stanza
const SYNC_FOCUS = 4;              // Impulso di squadra dell'HANDLER: focus regalato a ciascun compagno
const SYNC_TARGETS = 2;            // ...al massimo a 2 compagni, qualunque sia la squadra
const LAST_PLATE_COOLDOWN = 3;     // Ultima piastra: si ricarica dopo 3 turni chiusi (di chiunque)
const HITS_KEPT = 24;              // colpi recenti tenuti in coda per il feedback sui token (vedi `hit`)

// SCALING LIMITATO PER DIMENSIONE SQUADRA
// Vita, danno e allarme iniziale sono gli stessi con 2 o con 6 operativi. L'unica eccezione è il
// presidio: i DRONI iniziali sono tanti quanti gli operativi scelti in lobby (2–6). Il gioco scala per
// il resto perché l'unità di tempo è il TURNO del singolo operativo, non il round:
//   - tutto ciò che fa la torre (allarme, inseguimento, colpi, SEGUGI, LOCKDOWN, consegna, vittoria
//     e sconfitta, informatore che si dissangua) succede a ogni fine turno, quindi ogni turno
//     giocato vale la stessa pressione qualunque sia la squadra;
//   - gli Helix colpiscono solo chi chiude il turno (`enemyTarget`): i danni non si spalmano su
//     più corpi quando la squadra è grande;
//   - un operativo a terra fa salire l'allarme (`ALARM_KNOCKDOWN`), e una squadra interamente a
//     terra perde la missione;
//   - abilità e passive hanno effetti a quantità fissa (Lazarus su 2 bersagli, Ultima piastra a
//     ricarica in turni), mai "per ogni compagno".

// MISSIONE 03 // OSTAGGIO
const HOSTAGE_MAX_HP = 70;
const HOSTAGE_UNESCORTED_DAMAGE = 6; // danno subito a ogni fine turno se lasciato solo con ostili

// MISSIONE 04 // ULTIMO BACKUP
// Niente prelievo istantaneo: bisogna restare sulla sorgente e ripetere SCARICA più volte.
// DOWNLOAD_REQUIRED > ACTIONS_PER_TURN (3) apposta: un solo operativo non può chiuderlo da solo
// nel proprio turno, la squadra deve tenere la stanza per più di un turno (o dividersi lo sforzo
// nello stesso round). Ogni ciclo fa salire l'allarme: più si resta, più la torre converge.
const DOWNLOAD_REQUIRED = 4;
const DOWNLOAD_FOCUS = 1;
const ALARM_DOWNLOAD_TICK = 3;

// MISSIONE 05 // PUNTO DI ROTTURA
// L'innesco (azione INNESCO) è un trigger secco come PURGA/SCARICA, ma non porta a un'estrazione
// libera: apre un countdown fisso. Dopo REACTOR_FUSE_TURNS turni chiusi (di chiunque, non solo di
// chi ha innescato) il reattore detona: chiunque sia ancora nella teca o in una stanza collegata
// va a terra sul colpo (stesso effetto di knockDown, non morte permanente). Se l'esplosione
// coglie l'intera squadra nel raggio, la sconfitta scatta come qualsiasi wipe.
const REACTOR_FUSE_TURNS = 6;

// MISSIONE 06 // SPETTRO
// Qui l'obiettivo non sta fermo: MNEMOSYNE si è trasferito in un telaio sintetico (SPETTRO) che
// non combatte, scappa. Si sveglia quando cadono i nodi e da lì, a ogni fine turno, si sposta di
// una stanza lontano dagli operativi — solo attraverso porte APERTE e mai in una stanza occupata
// da un operativo. Le porte, per una volta, servono a chiudere: SIGILLA (solo in questa missione)
// richiude una porta aperta della propria stanza. CATTURA riesce solo se SPETTRO è nella tua
// stanza ed è BRACCATO: ogni sua porta è chiusa oppure dà su una stanza presidiata da un
// operativo in piedi. Se a fine turno si ritrova braccato, invece di muoversi forza una porta
// chiusa (mai verso un operativo): la trappola va quindi chiusa e scattata nello stesso turno,
// oppure tenuta coi corpi dei compagni. Finché è libero riscrive la torre: +SPECTER_ALARM_TICK
// d'allarme extra a ogni fine turno.
const SPECTER_ALARM_TICK = 1;
const SEAL_FOCUS = 1;

// PLANCE DELLE MISSIONI
// La mappa non è procedurale: ogni missione ha una plancia fissa in `MISSIONS[...].layout`,
// sempre la stessa a ogni partita. `createGame` la clona con `structuredClone` senza
// modificarla. Una stanza occupa una cella (quadrata) o due celle adiacenti (rettangolare).
// Le stanze fisicamente vicine NON sono automaticamente collegate: contano solo le porte
// elencate in `links`. Per generare la plancia di una missione nuova (o rigenerare una
// esistente) si usa una tantum `scripts/generate-map.mjs` — vedi il commento in testa a quel
// file — e si incolla il `layout` stampato qui sotto: non è più il motore di gioco a disegnarla
// a ogni partita.

// PORTE
// Ogni collegamento fra due stanze (`links`) è anche una porta, aperta o chiusa. Lo stato
// iniziale (almeno metà delle porte chiuse) è fissato nel `layout.doors` di ogni missione
// (chiave = id stanze in ordine alfabetico unite da '-', valore true = chiusa). Lo stato di
// gioco (`game.doors`) parte come copia di quello e cambia solo con l'azione SBLOCCA PORTA:
// una porta chiusa blocca il passaggio finché un operativo non la sblocca da una delle due
// stanze adiacenti (non serve attraversarla per sbloccarla). Riguarda solo gli operativi: i
// presidi Helix non ne sono mai fermati.
const doorKey = (a, b) => [a, b].sort().join('-');
const doorClosed = (a, b) => Boolean(game.doors?.[doorKey(a, b)]);

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

// Stanze dei droni: `layout.droneSpawns` è l'elenco ordinato (6 stanze) delle posizioni dei droni
// di una missione; se manca si scelgono le stanze più lontane dalla partenza che non siano
// partenza/obiettivo/consegna/nodi né già occupate dal presidio, due nemici nella stessa stanza solo se non c'è alternativa.
function droneRooms(layout, rooms, taken, count) {
  // START ed EXIT sono vietate ai droni in ogni caso, anche se dichiarate in `droneSpawns`.
  const banned = new Set([layout.startRoom, layout.dropRoom]);
  const free = (id) => id && !banned.has(id) && !taken.has(id);
  const picked = [];
  for (const id of layout.droneSpawns || []) {
    if (picked.length >= count) break;
    if (free(id) && !picked.includes(id)) picked.push(id);
  }
  if (picked.length < count) {
    const dist = distanceMap(rooms, layout.startRoom);
    const reserved = new Set([layout.startRoom, layout.vaultRoom, layout.dropRoom, ...(layout.nodeRooms || [])]);
    const pool = rooms.filter((r) => !reserved.has(r.id) && free(r.id) && !picked.includes(r.id))
      .sort((a, b) => (dist[b.id] ?? 0) - (dist[a.id] ?? 0));
    for (const r of pool) { if (picked.length >= count) break; picked.push(r.id); }
  }
  // Nessuna alternativa libera: si accetta una stanza con 2 nemici, prima fra le posizioni dei
  // droni dichiarate, poi fra le stanze non riservate più lontane dalla partenza.
  if (picked.length < count) {
    const dist = distanceMap(rooms, layout.startRoom);
    const spare = [...(layout.droneSpawns || []).filter((id) => !banned.has(id)), ...rooms
      .filter((r) => !banned.has(r.id))
      .sort((a, b) => (dist[b.id] ?? 0) - (dist[a.id] ?? 0)).map((r) => r.id)];
    for (let i = 0; picked.length < count && i < spare.length * 6; i++) {
      const id = spare[i % spare.length];
      if (id && !(i < spare.length && picked.includes(id))) picked.push(id);
    }
  }
  return picked;
}

// I presidi stanno dove c'è qualcosa da difendere: teca e nodi. Nessuno pattuglia l'ingresso.
// Se la missione dichiara `layout.garrison` (array di {kind, at}) si schiera quello, pescando le
// unità dal DATABASE NEMICI (ENEMY_ROSTER); altrimenti vale il presidio di default. I DRONI non
// stanno nel presidio fisso: partono in numero pari a operativi−1 (`startingDrones`: 2→1 … 6→5), uno per stanza (due nella stessa solo senza alternative), nelle posizioni di `layout.droneSpawns`.
// Droni iniziali: base zero, +1 ogni operativo oltre il primo (2→1, 3→2 … 6→5).
function startingDrones(squadSize) {
  return Math.max(0, Math.min(5, Math.floor(squadSize) - 1));
}

function buildEnemies(layout, rooms, hpScale, dmgScale, squadSize = 0) {
  let list;
  if (Array.isArray(layout.garrison) && layout.garrison.length) {
    const seen = {};
    list = layout.garrison
      .filter((slot) => ENEMY_KINDS[slot.kind])
      .map((slot) => {
        seen[slot.kind] = (seen[slot.kind] || 0) + 1;
        return spawnEnemy(slot.kind, garrisonRoom(slot.at, layout, rooms), seen[slot.kind], hpScale, dmgScale);
      });
  } else {
    list = [spawnEnemy('elite', layout.vaultRoom, 1, hpScale, dmgScale)];
    layout.nodeRooms.forEach((roomId, i) => {
      list.push(spawnEnemy('sec', roomId, i + 1, hpScale, dmgScale));
    });
  }
  const taken = new Set(list.map((e) => e.room));
  droneRooms(layout, rooms, taken, startingDrones(squadSize))
    .forEach((roomId, i) => list.push(spawnEnemy('drone', roomId, i + 1, hpScale, dmgScale)));
  return list;
}

// CATALOGO MISSIONI
// Ogni missione riusa lo stesso motore (nodi, allarme, combattimento) e differisce solo per
// l'obiettivo finale in teca/nucleo/cella, per la meccanica di "carico" che lo accompagna e per
// la plancia fissa in `layout`. `narrative` risolve i testi che dipendono dai nomi delle
// stanze usando l'helper `roomName` locale a `createGame`, perché lì la variabile globale
// `game` non è ancora assegnata.
// `layout` = plancia della missione, fissa e sempre uguale a ogni partita (`createGame` la
// clona con `structuredClone` senza toccarla): `rooms` con id/name/col/row/w/h/links e i flag
// di ruolo start/vault/exit/node/exposed/cover, più startRoom/vaultRoom/dropRoom/nodeRooms.
// Generata una tantum con `npm run map:generate` (vedi `scripts/generate-map.mjs`): per
// aggiungere una missione nuova, o rigenerare quella di una esistente, si passa lì il pool di
// 20 nomi di stanza a tema (griglia 5×4, sempre 2 celle vuote) e si incolla il `layout` stampato.
// Presidio iniziale: 1 nemico nella stanza dell'obiettivo, 1 su ogni nodo, eventuali rinforzi in
// altre stanze — mai più di 1 nemico per stanza.
const mapNote = (vaultNoun, roomCount) => `Plancia fissa di questa missione: ${roomCount} stanze su una griglia, collegate solo da alcune porte — due stanze vicine possono non comunicare affatto. La mappa contiene la zona di partenza (S), due nodi di rete (N), ${vaultNoun} dell’obiettivo e il punto di consegna (▼), lontani fra loro, ed è sempre la stessa a ogni partita. Lo schema qui sotto segna solo dove stanno questi elementi.`;

const MISSIONS = {
  valigetta: {
    id: 'valigetta', title: 'MISSIONE 01 // LA VALIGETTA', tagline: 'Furto ed estrazione',
    cover: '/missions/valigetta.png',
    goalHeadline: 'Recuperate MNEMOSYNE',
    missione: 'Dentro la Helix Tower, in una teca cifrata, c’è un prototipo chiamato MNEMOSYNE. Il blackout vi apre una finestra stretta: entrare, aprire la teca e sparire prima che la torre capisca cosa sta succedendo. I presidi Helix stanno esattamente dove dovete passare — ma il vostro obiettivo è la valigetta, non loro.\n\nViolate i nodi per aprire la teca, recuperate la valigetta MNEMOSYNE e consegnatela al punto di raccolta. Gli Helix sono un ostacolo sulla strada, non l’obiettivo.',
    objectives: [
      'Violate 2 nodi di rete per sbloccare la teca.',
      'Raggiungete la stanza della teca e usate RECUPERO per prendere la valigetta MNEMOSYNE.',
      'Trasportate la valigetta fino al punto di consegna senza farvi bloccare dai presidi.',
      'Portate ogni operativo ancora vivo nel punto di consegna per chiudere l’estrazione.',
    ],
    mapNote: mapNote('la teca', 13),
    layout: {
      rooms: [
        {id:'A01',name:'ACCESSO',col:1,row:1,w:1,h:2,links:['B05'],node:true},
        {id:'C02',name:'GARAGE',col:3,row:1,w:1,h:1,links:['C06'],exit:true},
        {id:'D03',name:'OFFICINA',col:4,row:1,w:1,h:1,links:['D07','E04'],cover:true},
        {id:'E04',name:'TERMICA',col:5,row:1,w:1,h:1,links:['D03','E08'],node:true},
        {id:'B05',name:'CONDOTTI',col:2,row:2,w:1,h:1,links:['C06','A01','B10'],cover:true},
        {id:'C06',name:'SPOGLIATOI',col:3,row:2,w:1,h:1,links:['C11','B05','C02'],exposed:true},
        {id:'D07',name:'PONTE',col:4,row:2,w:1,h:2,links:['C11','D03']},
        {id:'E08',name:'MAGAZZINO',col:5,row:2,w:1,h:1,links:['E04','E12'],cover:true},
        {id:'A09',name:'ARCHIVIO',col:1,row:3,w:1,h:2,links:['B10'],start:true},
        {id:'B10',name:'SICUREZZA',col:2,row:3,w:1,h:2,links:['C11','A09','B05'],cover:true},
        {id:'C11',name:'LAB NERO',col:3,row:3,w:1,h:2,links:['D07','B10','C06'],exposed:true},
        {id:'E12',name:'CRIOSALA',col:5,row:3,w:1,h:1,links:['E08','E13'],cover:true},
        {id:'E13',name:'CELLE',col:5,row:4,w:1,h:1,links:['E12'],vault:true},
      ],
      startRoom: 'A09', vaultRoom: 'E13', dropRoom: 'C02',
      nodeRooms: ['A01', 'E04'],
      // Presidio iniziale: 1 nemico sull'obiettivo e 1 su ogni nodo, mai più di 1 per stanza,
      // più un HELIX GOLIATH a guardia del punto di consegna (stanza EXIT) .
      // Droni: uno per operativo scelto in lobby, nelle prime N stanze di `droneSpawns`.
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'sec',at:'node:1'},{kind:'titan',at:'drop'}],
      droneSpawns: ['C11', 'C06', 'B05', 'E12', 'D07', 'D03'],
      // Telecamere: 3 stanze fisse (mai START né EXIT), spente con DISABILITA TELECAMERA.
      cameras: ['B10', 'D03', 'E08'],
      // Cassa di potenziamento: 1 stanza fissa (mai START/EXIT/obiettivo/nodo), aperte con APRI CASSA.
      chests: ['D07'],
      // Nebbia: 2 stanze buie finché nessun operativo ci entra (vedi `game.visited`). Mai START né EXIT.
      fog: ['A01', 'E12'],
      doors: {'C11-D07':true,'D03-D07':true,'B10-C11':true,'B05-C06':true,'E04-E08':true,'A09-B10':true,'E12-E13':true},
    },
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
    cover: '/missions/nucleo.png',
    goalHeadline: 'Cancellate MNEMOSYNE dal nucleo',
    missione: 'MNEMOSYNE non va rubato, va cancellato alla fonte. Scendete nel nucleo dati della Helix Tower, abbattete il firewall e lanciate la PURGA. Nell’istante in cui parte, ogni sistema della torre sa dove siete e converge: da lì in poi è solo fuga.\n\nNiente da rubare: violate i nodi per abbattere il firewall del nucleo dati, raggiungetelo e lanciate la PURGA. Da quel momento ogni sistema Helix converge sulla vostra posizione — sparire in fretta è l’unica strategia.',
    objectives: [
      'Violate 2 nodi di rete per abbattere il firewall del nucleo dati.',
      'Raggiungete il nucleo e lanciate la PURGA.',
      'Dopo la PURGA ogni sistema Helix converge su di voi: raggiungete il punto di consegna prima della saturazione.',
      'Portate ogni operativo ancora vivo nel punto di consegna per l’estrazione.',
    ],
    mapNote: mapNote('il nucleo dati', 15),
    layout: {
      rooms: [
        {id:'A01',name:'FIBRA DORSALE',col:1,row:1,w:1,h:1,links:['B02'],start:true},
        {id:'B02',name:'SALA SERVER',col:2,row:1,w:2,h:1,links:['C06','A01','B05'],cover:true},
        {id:'D03',name:'SALA RACK',col:4,row:1,w:1,h:1,links:['D07','E04'],cover:true},
        {id:'E04',name:'CENTRALE DATI',col:5,row:1,w:1,h:1,links:['D03'],exit:true},
        {id:'B05',name:'TERMINALI',col:2,row:2,w:1,h:2,links:['B02','A08','C06','B12'],exposed:true},
        {id:'C06',name:'CONTROLLO REMOTO',col:3,row:2,w:1,h:2,links:['D09','B02','C13','D07','B05']},
        {id:'D07',name:'RAFFREDDAMENTO',col:4,row:2,w:1,h:1,links:['C06','D03'],cover:true},
        {id:'A08',name:'POZZO CAVI',col:1,row:3,w:1,h:1,links:['B05','A11'],cover:true},
        {id:'D09',name:'CACHE',col:4,row:3,w:1,h:1,links:['E10','C06'],cover:true},
        {id:'E10',name:'MODULO QUANTICO',col:5,row:3,w:1,h:1,links:['E15','D09']},
        {id:'A11',name:'NODO DATI',col:1,row:4,w:1,h:1,links:['A08','B12'],node:true},
        {id:'B12',name:'GRUPPO UPS',col:2,row:4,w:1,h:1,links:['C13','B05','A11'],exposed:true},
        {id:'C13',name:'ARCHIVIO DIGITALE',col:3,row:4,w:1,h:1,links:['C06','B12'],node:true},
        {id:'D14',name:'CAMERA BIANCA',col:4,row:4,w:1,h:1,links:['E15'],vault:true},
        {id:'E15',name:'ANTICAMERA',col:5,row:4,w:1,h:1,links:['E10','D14'],cover:true},
      ],
      startRoom: 'A01', vaultRoom: 'D14', dropRoom: 'E04',
      nodeRooms: ['C13', 'A11'],
      // Nebbia: 2 stanze buie finché nessun operativo ci entra (mai START né EXIT).
      fog: ['C13', 'D07'],
      // Presidio rinforzato: oltre a elite@nucleo e a un presidio su ognuno dei 2 nodi, un HELIX SEC
      // tiene lo snodo più trafficato (B05 TERMINALI) e un HELIX GOLIATH guarda il punto di
      // consegna (stanza EXIT), più i droni (uno per operativo scelto in lobby, prime N stanze di `droneSpawns`).
      // Mai più di 1 nemico per stanza e nessuno adiacente alla partenza. Vedi
      // `missionTuning` e `npm run sim`.
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'sec',at:'node:1'},{kind:'sec',at:'B05'},{kind:'titan',at:'drop'}],
      droneSpawns: ['E10', 'E15', 'D09', 'A08', 'D07', 'D03'],
      // Telecamere: 3 stanze fisse (mai START né EXIT), spente con DISABILITA TELECAMERA.
      cameras: ['C06', 'E15', 'D09'],
      // Cassa di potenziamento: 1 stanza fissa (mai START/EXIT/obiettivo/nodo), aperte con APRI CASSA.
      chests: ['A08'],
      doors: {'C06-D09':true,'B02-C06':true,'C06-C13':true,'A01-B02':true,'C06-D07':true,'D03-E04':true,'A08-A11':true,'B05-B12':true,'A11-B12':true},
    },
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
    cover: '/missions/ostaggio.png',
    goalHeadline: 'Salvate l’informatore',
    missione: 'Nella cella della Helix Tower è rinchiuso un informatore che sa troppo per restare lì. Sbloccate la cella, tiratelo fuori e portatelo vivo all’estrazione. Non spara e non corre: ogni turno che passa lontano da voi, con degli ostili attorno, è un turno in cui rischia di non uscirne.\n\nNella cella è rinchiuso un informatore. Violate i nodi per sbloccarla, liberatelo e scortatelo vivo fino al punto di consegna: non combatte, e se lo lasciate solo con degli ostili viene colpito a ogni turno finché qualcuno non torna a scortarlo.',
    objectives: [
      'Violate 2 nodi di rete per sbloccare la cella.',
      'Usate LIBERA nella stanza della cella per far uscire l’informatore.',
      'Scortatelo fino al punto di consegna: se resta solo con ostili viene colpito a ogni turno.',
      'Portate l’informatore e ogni operativo ancora vivo nel punto di consegna.',
    ],
    mapNote: mapNote('la cella', 14),
    // Informatore: HOSTAGE_UNESCORTED_DAMAGE a ogni fine turno.
    layout: {
      rooms: [
        {id:'A01',name:'DEPOSITO PROVE',col:1,row:1,w:1,h:1,links:['B02'],start:true},
        {id:'B02',name:'LAVANDERIA',col:2,row:1,w:1,h:2,links:['B08','C03','A01'],cover:true},
        {id:'C03',name:'SALA VISITE',col:3,row:1,w:1,h:1,links:['B02'],node:true},
        {id:'D04',name:'UFFICIO DIRETTORE',col:4,row:1,w:1,h:1,links:['D06','E05'],cover:true},
        {id:'E05',name:'SALA INTERROGATORI',col:5,row:1,w:1,h:1,links:['D04'],vault:true},
        {id:'D06',name:'CORTILE',col:4,row:2,w:2,h:1,links:['E10','D04'],cover:true},
        {id:'A07',name:'CORRIDOIO GUARDIE',col:1,row:3,w:1,h:1,links:['B08','A11']},
        {id:'B08',name:'CELLE COMUNI',col:2,row:3,w:2,h:1,links:['A07','B02','C13','D09'],exposed:true},
        {id:'D09',name:'POSTO DI BLOCCO',col:4,row:3,w:1,h:1,links:['C13','E10','B08']},
        {id:'E10',name:'SALA CONTROLLO',col:5,row:3,w:1,h:1,links:['D09','D06','E14'],exposed:true},
        {id:'A11',name:'PARLATORIO',col:1,row:4,w:1,h:1,links:['A07','B12'],cover:true},
        {id:'B12',name:'ARCHIVIO SCHEDE',col:2,row:4,w:1,h:1,links:['A11'],exit:true},
        {id:'C13',name:'INFERMERIA',col:3,row:4,w:2,h:1,links:['B08','D09','E14'],cover:true},
        {id:'E14',name:'ARMERIA',col:5,row:4,w:1,h:1,links:['C13','E10'],node:true},
      ],
      startRoom: 'A01', vaultRoom: 'E05', dropRoom: 'B12',
      nodeRooms: ['C03', 'E14'],
      // Nebbia: 2 stanze buie finché nessun operativo ci entra (mai START né EXIT).
      fog: ['E14', 'D04'],
      // Presidio iniziale: 1 nemico sull'obiettivo e 1 su ogni nodo, mai più di 1 per stanza,
      // più un HELIX GOLIATH a guardia del punto di consegna (stanza EXIT), un HELIX-SEC in
      // LAVANDERIA e i droni (uno per operativo scelto in lobby, prime N stanze di `droneSpawns`).
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'sec',at:'node:1'},{kind:'titan',at:'drop'},
        {kind:'sec',at:'B02'}],
      droneSpawns: ['D09', 'B08', 'E10', 'C13', 'A11', 'D06'],
      // Telecamere: 3 stanze fisse (mai START né EXIT), spente con DISABILITA TELECAMERA.
      cameras: ['B02', 'D09', 'A07'],
      // Cassa di potenziamento: 1 stanza fissa (mai START/EXIT/obiettivo/nodo), aperte con APRI CASSA.
      chests: ['E14'],
      doors: {'A07-B08':true,'B08-C13':true,'A11-B12':true,'D06-E10':true,'D04-D06':true,'C13-E14':true,'B08-D09':true,'E10-E14':true},
    },
    narrative(layout, roomName) {
      return {
        objective: `Violate ${NODES_REQUIRED} nodi per sbloccare la cella in ${roomName(layout.vaultRoom)}, liberate l’informatore e scortatelo vivo fino a ${roomName(layout.dropRoom)}.`,
        vaultUnlocked: `Cella di ${roomName(layout.vaultRoom)} sbloccata: l’informatore può essere liberato.`,
        opening: 'Il blackout è iniziato. Trovate la cella, liberate l’informatore, portatelo via vivo.',
      };
    },
  },
  assedio: {
    id: 'assedio', title: 'MISSIONE 04 // ULTIMO BACKUP', tagline: 'Estrazione sotto assedio',
    cover: '/missions/assedio.png',
    goalHeadline: 'Copiate l’ultima istanza di MNEMOSYNE',
    missione: 'Le altre operazioni hanno insegnato alla Helix a proteggere MNEMOSYNE offline. Questa volta è diverso: un’istanza del prototipo gira ancora live, nascosta in una sorgente dati nel cuore della torre. Non si può portarla via né cancellarla da lontano — bisogna restare collegati abbastanza a lungo da copiarla, e ogni ciclo di trasferimento la lascia un po’ più sveglia e un po’ più capace di vedervi.\n\nNon c’è nulla da rubare né da cancellare: l’unica copia viva di MNEMOSYNE gira su una sorgente dati nel cuore della torre. Violate i nodi per raggiungerla, agganciate il collegamento con SCARICA e restate sul posto finché il trasferimento non è completo: ogni ciclo la sveglia un po’ di più, e lei stessa dirige i presidi contro di voi.',
    objectives: [
      'Violate 2 nodi di rete per sbloccare la sorgente dati.',
      'Raggiungete la sorgente e usate SCARICA più volte di fila per copiare MNEMOSYNE: serve restare sul posto.',
      'Ogni ciclo di SCARICA fa salire l’allarme: resistete ai presidi che convergono finché il trasferimento non è completo.',
      'Portate ogni operativo ancora vivo al punto di consegna per chiudere l’estrazione.',
    ],
    mapNote: mapNote('la sorgente dati', 15),
    // DOWNLOAD_REQUIRED 4 tick da +3 allarme ciascuno (vedi ALARM_DOWNLOAD_TICK).
    layout: {
      rooms: [
        {id:'A01',name:'SNODO SINAPTICO',col:1,row:1,w:1,h:1,links:['B02','A05'],node:true},
        {id:'B02',name:'CRIOGENIA PRIMARIA',col:2,row:1,w:1,h:1,links:['B06','C03','A01'],cover:true},
        {id:'C03',name:'OSSERVATORIO',col:3,row:1,w:2,h:1,links:['B02','E04','C07'],cover:true},
        {id:'E04',name:'SALA MADRE',col:5,row:1,w:1,h:1,links:['C03'],vault:true},
        {id:'A05',name:'SALA QUARANTENA',col:1,row:2,w:1,h:1,links:['A08','A01'],cover:true},
        {id:'B06',name:'ARCHIVIO NEURALE',col:2,row:2,w:1,h:1,links:['B02','B09','C07']},
        {id:'C07',name:'CELLA DI CONTENIMENTO',col:3,row:2,w:2,h:1,links:['B06','C03'],cover:true},
        {id:'A08',name:'CONDOTTO DATI',col:1,row:3,w:1,h:1,links:['B09','A12','A05'],exposed:true},
        {id:'B09',name:'CORRIDOIO SERVIZIO',col:2,row:3,w:2,h:1,links:['B06','D10','B13','A08','C14'],exposed:true},
        {id:'D10',name:'SALA MONITOR',col:4,row:3,w:1,h:1,links:['B09','E11'],cover:true},
        {id:'E11',name:'PONTE DIAGNOSTICO',col:5,row:3,w:1,h:1,links:['D10','E15'],cover:true},
        {id:'A12',name:'INNESTO NEURALE',col:1,row:4,w:1,h:1,links:['A08'],start:true},
        {id:'B13',name:'STAZIONE RIPETITORE',col:2,row:4,w:1,h:1,links:['B09','C14'],cover:true},
        {id:'C14',name:'INCUBATRICE DATI',col:3,row:4,w:1,h:1,links:['B13','B09'],node:true},
        {id:'E15',name:'VARCO BLINDATO',col:5,row:4,w:1,h:1,links:['E11'],exit:true},
      ],
      startRoom: 'A12', vaultRoom: 'E04', dropRoom: 'E15',
      nodeRooms: ['A01', 'C14'],
      // Nebbia: 2 stanze buie finché nessun operativo ci entra (mai START né EXIT).
      fog: ['C14', 'B02'],
      // Presidio iniziale: 1 nemico sulla sorgente e 1 su ogni nodo, mai più di 1 per
      // stanza, più un HELIX GOLIATH a guardia del punto di consegna (stanza EXIT), un HELIX SEC
      // fisso in SALA MONITOR (D10) e i droni (uno per operativo scelto in lobby, prime N stanze
      // di `droneSpawns`).
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'sec',at:'node:1'},{kind:'titan',at:'drop'},
        {kind:'sec',at:'D10'}],
      droneSpawns: ['A08', 'B09', 'C07', 'B13', 'B06', 'E11'],
      // Telecamere: 3 stanze fisse (mai START né EXIT), spente con DISABILITA TELECAMERA.
      cameras: ['B06', 'D10', 'C03'],
      // Cassa di potenziamento: 1 stanza fissa (mai START/EXIT/obiettivo/nodo), aperte con APRI CASSA.
      chests: ['B06'],
      doors: {'B06-C07':true,'B09-B13':true,'D10-E11':true,'B02-C03':true,'A01-B02':true,'E11-E15':true,'C03-C07':true,'A01-A05':true,'B09-C14':true},
    },
    narrative(layout, roomName) {
      return {
        objective: `Violate ${NODES_REQUIRED} nodi per sbloccare la sorgente dati in ${roomName(layout.vaultRoom)}, restate collegati e scaricate MNEMOSYNE prima che la torre vi isoli.`,
        vaultUnlocked: `Sorgente dati di ${roomName(layout.vaultRoom)} sbloccata: il collegamento diretto con SCARICA è disponibile.`,
        downloaded: `Trasferimento completato nella sorgente di ${roomName(layout.vaultRoom)}: ogni unità Helix converge sulla vostra posizione.`,
        opening: 'Il blackout è iniziato. Trovate la sorgente dati, restate collegati, portate via MNEMOSYNE.',
      };
    },
  },
  reattore: {
    id: 'reattore', title: 'MISSIONE 05 // PUNTO DI ROTTURA', tagline: 'Sabotaggio fisico e fuga',
    cover: '/missions/reattore.png',
    goalHeadline: 'Fate detonare il reattore di MNEMOSYNE',
    missione: 'Dopo le ultime fughe di dati la Helix ha staccato MNEMOSYNE dalla rete: vive adesso in un nucleo di fusione isolato, nella pancia della torre, dove nessun hack da remoto può raggiungerlo. Contro un obiettivo offline resta solo la forza bruta — una carica sul reattore stesso — ma una volta innescata nessuno può più fermarla, nemmeno voi.\n\nViolate i nodi per raggiungere il reattore e usate INNESCO per armare la carica. Da quel momento avete un numero fisso di turni prima che detoni: chi resta nel raggio dell’esplosione va a terra sul colpo.',
    objectives: [
      'Violate 2 nodi di rete per aprire l’accesso al reattore.',
      'Raggiungete il reattore e usate INNESCO per armare la carica.',
      'Da quel momento avete un numero fisso di turni per allontanarvi: chi resta nel raggio quando detona va a terra sul colpo.',
      'Portate ogni operativo ancora vivo al punto di consegna per chiudere l’estrazione.',
    ],
    mapNote: mapNote('il reattore', 15),
    layout: {
      rooms: [
        {id:'A01',name:'INNESTO REATTORE',col:1,row:1,w:1,h:1,links:['A05'],start:true},
        {id:'C02',name:'CENTRALE DI POMPAGGIO',col:3,row:1,w:1,h:1,links:['C07','D03'],cover:true},
        {id:'D03',name:'ACCESSO DI EMERGENZA',col:4,row:1,w:1,h:2,links:['C07','E08','E04','D12','C02'],exposed:true},
        {id:'E04',name:'STAZIONE DI CONTROLLO',col:5,row:1,w:1,h:1,links:['D03'],node:true},
        {id:'A05',name:'DEPOSITO SCORIE',col:1,row:2,w:1,h:1,links:['B06','A01'],cover:true},
        {id:'B06',name:'CISTERNA DI RAFFREDDAMENTO',col:2,row:2,w:1,h:1,links:['B10','C07','A05'],exposed:true},
        {id:'C07',name:'GIUNZIONE TERMICA',col:3,row:2,w:1,h:1,links:['B06','D03','C02'],node:true},
        {id:'E08',name:'SALA TURBINE',col:5,row:2,w:1,h:1,links:['D03','E13'],cover:true},
        {id:'A09',name:'GALLERIA DI SERVIZIO',col:1,row:3,w:1,h:1,links:['B10','A14'],cover:true},
        {id:'B10',name:'PASSERELLA SUPERIORE',col:2,row:3,w:1,h:1,links:['B06','A09','C11'],cover:true},
        {id:'C11',name:'SALA COMANDI AUSILIARIA',col:3,row:3,w:1,h:2,links:['B10','D12'],cover:true},
        {id:'D12',name:'CONDOTTO DI RAFFREDDAMENTO',col:4,row:3,w:1,h:1,links:['D03','C11'],cover:true},
        {id:'E13',name:'SALA GENERATORI',col:5,row:3,w:1,h:1,links:['E08','E15'],cover:true},
        {id:'A14',name:'VARCO DI SGANCIO',col:1,row:4,w:2,h:1,links:['A09'],exit:true},
        {id:'E15',name:'CAMERA DI FUSIONE',col:5,row:4,w:1,h:1,links:['E13'],vault:true},
      ],
      startRoom: 'A01', vaultRoom: 'E15', dropRoom: 'A14',
      nodeRooms: ['E04', 'C07'],
      // Nebbia: 2 stanze buie finché nessun operativo ci entra (mai START né EXIT).
      fog: ['C07', 'E13'],
      // Presidio iniziale: 1 nemico sul reattore e 1 su ogni nodo, mai più di 1 per stanza, più un
      // HELIX GOLIATH a guardia del punto di consegna (stanza EXIT) e i droni (uno per
      // operativo scelto in lobby, prime N stanze di `droneSpawns`). Nessuno adiacente alla partenza.
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'sec',at:'node:1'},{kind:'titan',at:'drop'}],
      droneSpawns: ['D03', 'E08', 'C11', 'B10', 'D12', 'C02'],
      // Telecamere: 3 stanze fisse (mai START né EXIT), spente con DISABILITA TELECAMERA.
      cameras: ['C07', 'E08', 'D12'],
      // Cassa di potenziamento: 1 stanza fissa (mai START/EXIT/obiettivo/nodo), aperte con APRI CASSA.
      chests: ['B10'],
      doors: {'A05-B06':true,'A01-A05':true,'B10-C11':true,'D03-E08':true,'E08-E13':true,'D03-D12':true,'E13-E15':true,'C11-D12':true},
    },
    narrative(layout, roomName) {
      return {
        objective: `Violate ${NODES_REQUIRED} nodi per sbloccare l’accesso al reattore in ${roomName(layout.vaultRoom)}, innescate la carica con INNESCO e allontanatevi prima che detoni.`,
        vaultUnlocked: `Accesso al reattore di ${roomName(layout.vaultRoom)} sbloccato: la carica può essere innescata.`,
        armed: `Carica innescata nel reattore di ${roomName(layout.vaultRoom)}: da questo momento avete ${REACTOR_FUSE_TURNS} turni prima che detoni.`,
        detonated: `Il reattore di ${roomName(layout.vaultRoom)} è detonato: ogni unità Helix converge su chi è rimasto in piedi. Sparite da ${roomName(layout.dropRoom)}.`,
        opening: 'Il blackout è iniziato. Trovate il reattore, innescate la carica, sparite prima che detoni.',
      };
    },
  },
  spettro: {
    id: 'spettro', title: 'MISSIONE 06 // SPETTRO', tagline: 'Caccia e cattura',
    cover: '/missions/spettro.png',
    goalHeadline: 'Braccate MNEMOSYNE e chiudetelo in trappola',
    missione: 'Stavolta MNEMOSYNE non aspetta in una teca: si è trasferito in SPETTRO, un telaio sintetico sperimentale nato nella fabbrica di chassis della Helix Tower. Non spara e non si difende — scappa, e ragiona. Appena la rete cade si sveglia e comincia a muoversi fra le stanze, sempre lontano da voi, riscrivendo la torre a ogni passo. Le porte, per una volta, non vanno aperte: vanno chiuse.\n\nViolate i nodi per svegliare SPETTRO nella culla. Da lì scappa di una stanza a ogni fine turno, solo da porte aperte e mai verso un operativo. Chiudetegli le vie di fuga con SIGILLA e coi vostri corpi nelle stanze accanto, poi entrate nella sua stanza e usate CATTURA quando è braccato. Se chiudete la gabbia e non scattate, al turno dopo forza una porta.',
    objectives: [
      'Violate 2 nodi di rete: la culla si apre e SPETTRO si sveglia e comincia a fuggire.',
      'Chiudetegli le vie di fuga: SIGILLA richiude una porta aperta, e un operativo in una stanza accanto blocca quel passaggio.',
      'Quando ogni sua porta è chiusa o presidiata, entrate nella sua stanza e usate CATTURA — nello stesso turno, o forzerà una porta.',
      'Dopo la cattura ogni sistema Helix converge su di voi: portate ogni operativo ancora vivo al punto di consegna.',
    ],
    mapNote: mapNote('la culla', 14),
    layout: {
      rooms: [
        {id:'A01',name:'ASCENSORE MERCI',col:1,row:1,w:1,h:1,links:['A04'],exit:true},
        {id:'C02',name:'FORNO DI COTTURA',col:3,row:1,w:2,h:1,links:['D07','E03','C06'],cover:true},
        {id:'E03',name:'CULLA SINTETICA',col:5,row:1,w:1,h:1,links:['C02','E08'],vault:true},
        {id:'A04',name:'BANCO DI TARATURA',col:1,row:2,w:1,h:2,links:['B09','A01','B05'],cover:true},
        {id:'B05',name:'NASTRO DI SMISTAMENTO',col:2,row:2,w:1,h:1,links:['B09','A04'],cover:true},
        {id:'C06',name:'OFFICINA SERVO',col:3,row:2,w:1,h:1,links:['C02','D07','C10'],cover:true},
        {id:'D07',name:'CAMERA DI VERNICIATURA',col:4,row:2,w:1,h:2,links:['C13','E08','C10','C02','C06'],exposed:true},
        {id:'E08',name:'FONDERIA',col:5,row:2,w:1,h:1,links:['D07','E03'],cover:true},
        {id:'B09',name:'LINEA ROBOTICA',col:2,row:3,w:1,h:1,links:['C10','A04','B05','B12'],cover:true},
        {id:'C10',name:'RELÈ OVEST',col:3,row:3,w:1,h:1,links:['D07','B09','C13','C06'],node:true},
        {id:'A11',name:'BANCHINA DI CARICO',col:1,row:4,w:1,h:1,links:['B12'],start:true},
        {id:'B12',name:'LABORATORIO OTTICO',col:2,row:4,w:1,h:1,links:['C13','A11','B09'],cover:true},
        {id:'C13',name:'SALA PRESSE',col:3,row:4,w:2,h:1,links:['E14','D07','B12','C10'],exposed:true},
        {id:'E14',name:'RELÈ EST',col:5,row:4,w:1,h:1,links:['C13'],node:true},
      ],
      startRoom: 'A11', vaultRoom: 'E03', dropRoom: 'A01',
      nodeRooms: ['C10', 'E14'],
      // Nebbia: 2 stanze buie finché nessun operativo ci entra (mai START né EXIT). Se SPETTRO ci
      // si rifugia, sparisce anche dalla plancia.
      fog: ['E14', 'C02'],
      // Presidio iniziale: 1 nemico sulla culla e 1 su ogni nodo, mai più di 1 per stanza, più un
      // HELIX GOLIATH a guardia del punto di consegna (stanza EXIT) e i droni (uno per operativo
      // scelto in lobby, prime N stanze di `droneSpawns`). Nessuno adiacente alla partenza.
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'sec',at:'node:1'},{kind:'titan',at:'drop'}],
      droneSpawns: ['D07', 'C06', 'E08', 'C13', 'B09', 'C02'],
      // Telecamere: 3 stanze fisse (mai START né EXIT), spente con DISABILITA TELECAMERA.
      cameras: ['D07', 'B05', 'C13'],
      // Cassa di potenziamento: 1 stanza fissa (mai START/EXIT/obiettivo/nodo), aperte con APRI CASSA.
      chests: ['B05'],
      doors: {'C13-E14':true,'C13-D07':true,'C10-D07':true,'C02-D07':true,'B09-C10':true,'B12-C13':true,'A04-B09':true,'C06-D07':true,'E03-E08':true,'C06-C10':true},
    },
    narrative(layout, roomName) {
      return {
        objective: `Violate ${NODES_REQUIRED} nodi per svegliare SPETTRO nella culla di ${roomName(layout.vaultRoom)}, braccatelo chiudendogli ogni via di fuga, catturatelo e sparite da ${roomName(layout.dropRoom)}.`,
        vaultUnlocked: `Culla di ${roomName(layout.vaultRoom)} aperta: SPETTRO si è svegliato e comincia a fuggire.`,
        captured: `SPETTRO è in gabbia: MNEMOSYNE è vostro. Ogni unità Helix converge sulla vostra posizione — sparite da ${roomName(layout.dropRoom)}.`,
        opening: 'Il blackout è iniziato. Svegliate SPETTRO, chiudetelo in trappola, portatelo via.',
      };
    },
  },
};
const missionOf = (id) => MISSIONS[id] || MISSIONS.valigetta;
const missionList = () => Object.values(MISSIONS).map(({ narrative: _narrative, layout: _layout, tuning: _tuning, ...meta }) => meta);
const riskLevelList = () => Object.entries(RISK_LEVELS).map(([id, r]) => ({ id, label: r.label, alarmStart: r.alarmStart, enemyPower: r.enemyPower, autoRise: r.autoRise, allyRevive: r.allyRevive }));
const riskOf = () => RISK_LEVELS[game?.riskLevel] || RISK_LEVELS[DEFAULT_RISK_LEVEL];

// TUNING PER MISSIONE — leve di difficoltà dichiarate a livello di missione (fuori da `layout`,
// che è solo la plancia), applicate sopra al RISCHIO scelto in lobby. Valgono uguali per ogni
// dimensione di squadra: nessuna leva per numero di operativi. Tutte opzionali: se assenti la
// missione eredita `enemyPower`/`alarmStart` dal livello di rischio (vedi `RISK_LEVELS`).
//   enemyPower     moltiplica insieme INTEGRITÀ e DANNO di ogni Helix della missione (SEGUGI
//                  inclusi, perché ereditano `game.hpScale`/`game.dmgScale`).
//   enemyHpPower   override del solo asse integrità (allunga la partita → più esposizione
//   enemyDmgPower  override del solo asse danno   (attrito immediato). Usali quando `enemyPower`
//                  singolo lascia la missione sbilanciata su uno dei due.
//   alarmStart     allarme iniziale della missione: alzarlo toglie turni utili E anticipa le
//                  soglie SEGUGI (25/35/45/55/65/75/85), quindi non è compensabile 1:1 con enemyPower.
// Si tarano una missione alla volta guardando il win rate del simulatore (`npm run sim`).
function missionTuning(mission, riskLevel) {
  const t = mission.tuning || {};
  const risk = RISK_LEVELS[riskLevel] || RISK_LEVELS[DEFAULT_RISK_LEVEL];
  const power = typeof t.enemyPower === 'number' ? t.enemyPower : risk.enemyPower;
  return {
    enemyHpPower: typeof t.enemyHpPower === 'number' ? t.enemyHpPower : power,
    enemyDmgPower: typeof t.enemyDmgPower === 'number' ? t.enemyDmgPower : power,
    alarmStart: typeof t.alarmStart === 'number' ? t.alarmStart : risk.alarmStart,
  };
}

let game = null;

// Ricarica lo stato di sessione da disco e scarta le partite con schema vecchio. Girava a
// livello di modulo (I/O all'import): ora è in una funzione così `server.mjs` si può importare
// da uno script headless (scripts/simulate.mjs) senza toccare il file di stato né avviare nulla.
async function loadPersistedGame() {
  game = null;
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
  // Caricatore: le partite salvate prima di questo sistema non hanno munizioni sui player.
  if (game && game.players?.some((p) => typeof p.mag !== 'number')) game = null;
  // Due azioni per turno: le partite vecchie hanno un singolo slot `action`, non l'array.
  if (game && game.players?.some((p) => !Array.isArray(p.actions))) game = null;
  // Scelta scheda dal telefono: le partite vecchie nascevano con la squadra già fissata dalla
  // plancia (niente `maxPlayers` né contatore `seq` per gli id operativo) — vanno scartate.
  if (game && (typeof game.maxPlayers !== 'number' || typeof game.seq !== 'number')) game = null;
  // Manovra gratuita per round: le partite vecchie non hanno lo slot dedicato.
  if (game) for (const p of game.players) if (p.move === undefined) p.move = null;
  // Le partite salvate prima del sistema missioni sono tutte "LA VALIGETTA".
  if (game && !game.missionId) game.missionId = 'valigetta';
  // Picchi d'allarme: le partite vecchie non tracciano quali soglie hanno già generato un'unità.
  if (game && !Array.isArray(game.alarmSpawns)) game.alarmSpawns = [];
  // Porte: le partite salvate prima di questo sistema non hanno stato porte (tutte aperte).
  if (game && !game.doors) game.doors = {};
  // BLACKOUT: le partite salvate prima di questo sistema non hanno il flag di richiusura porte.
  if (game && typeof game.blackout !== 'boolean') game.blackout = false;
  // Telecamere: le partite salvate prima di questo sistema non ne hanno.
  if (game && !Array.isArray(game.cameras)) game.cameras = [];
  // Casse: le partite salvate prima di questo sistema non ne hanno (restano senza, la plancia
  // è già in corso e le casse sono elementi fissi della mappa).
  if (game && !Array.isArray(game.chests)) game.chests = [];
  // Nebbia: le partite salvate prima di questo sistema non hanno stanze in nebbia.
  if (game && !Array.isArray(game.fog)) game.fog = [];
  if (game && !Array.isArray(game.visited)) game.visited = [];
if (game && !game.cheats) game.cheats = {};
  // MISSIONE 04: le partite salvate prima di ULTIMO BACKUP non hanno lo stato del download.
  if (game && !game.download) game.download = { progress: 0, required: DOWNLOAD_REQUIRED, done: false };
  // MISSIONE 05: le partite salvate prima di PUNTO DI ROTTURA non hanno lo stato del reattore.
  if (game && !game.reactor) game.reactor = { armed: false, fuse: REACTOR_FUSE_TURNS, required: REACTOR_FUSE_TURNS, exploded: false };
  // MISSIONE 06: le partite salvate prima di SPETTRO non hanno lo stato del fuggitivo.
  if (game && !game.specter) game.specter = { room: game.vaultRoom, awake: false, captured: false };
  // Feedback colpo: le partite salvate prima non hanno la coda dei colpi recenti.
  if (game && !Array.isArray(game.hits)) { game.hits = []; game.hitSeq = 0; }
  // Registro eventi numerato: le partite salvate prima non lo hanno.
  if (game && !Array.isArray(game.events)) { game.events = []; game.eventSeq = 0; }
  if (game) game.towerBatch = null;
  // Attivazioni speciali: breve coda di eventi per il pop-up della plancia.
  if (game && !Array.isArray(game.abilityActivations)) { game.abilityActivations = []; game.abilityActivationSeq = 0; }
  // Modifiche estratte dalle casse: stessa coda, stesso scopo.
  if (game && !Array.isArray(game.modDrops)) { game.modDrops = []; game.modDropSeq = 0; }
  // Porte sbloccate: coda per il suono di SBLOCCA PORTA (plancia + telefono di chi l'ha sbloccata).
  if (game && !Array.isArray(game.unlocks)) { game.unlocks = []; game.unlockSeq = 0; }
  // Passive e seconda manovra: aggiorna le partite salvate senza alterarne la squadra.
  // Tempo a turni: le partite salvate prima non contano i turni chiusi (serve a Ultima piastra).
  if (game && typeof game.turn !== 'number') game.turn = 0;
  if (game) for (const p of game.players) {
    const template = templates.find((item) => item.id === p.characterId);
    // Le passive si riallineano sempre al database: i testi e le regole possono essere cambiati.
    p.passives = template?.passives || p.passives || [];
    if (template) { p.ability = template.ability; p.abilityText = template.abilityText; }
    if (typeof p.maneuverCount !== 'number') p.maneuverCount = p.move ? 1 : 0;
    // Modifiche dalle casse: partite salvate prima del sistema.
    if (!Array.isArray(p.mods)) p.mods = [];
    if (typeof p.lastPlateTurn !== 'number') p.lastPlateTurn = -LAST_PLATE_COOLDOWN;
    delete p.lastPlateRound;
  }
}

const nowTime = () => new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
const makeCode = () => `${['NEON','VOID','NOVA','GRID'][Math.floor(Math.random()*4)]}-${Math.floor(10+Math.random()*90)}`;
const alive = (unit) => unit.hp > 0;
const hasPassive = (player, passiveId) => Boolean(player?.passives?.some((passive) => passive.id === passiveId));
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

// MISSIONE SPETTRO: le vie di fuga del fuggitivo dalla stanza in cui si trova. Una porta conta
// solo se è aperta e dà su una stanza senza operativi in piedi. Zero vie = BRACCATO.
function specterExits(roomId = game?.specter?.room) {
  if (!game || game.missionId !== 'spettro' || !roomId) return [];
  return roomById(roomId).links.filter((id) => !doorClosed(roomId, id) && !alliesIn(id).length);
}
const specterCornered = () => Boolean(game.specter?.awake && !game.specter.captured && !specterExits().length);

// TRACCIA HELIX: i SEGUGI entrano tutti nella penultima stanza del percorso più breve dalla
// partenza all'EXIT, cioè quella che dà direttamente sull'EXIT (la stanza da cui si passa per
// estrarre). Stessa stanza a ogni soglia: si accumulano lì.
function hunterSpawnRoom() {
  let room = game.startRoom;
  for (let guard = game.map.length; guard > 0; guard--) {
    const next = stepToward(room, game.dropRoom);
    if (next === game.dropRoom || next === room) return room;
    room = next;
  }
  return room;
}

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

// Come distanceMap ma solo attraverso porte aperte: usata per gli operativi, che a differenza
// degli Helix non possono passare da una porta bloccata.
function openDistanceMap(origin) {
  const dist = { [origin]: 0 };
  const queue = [origin];
  while (queue.length) {
    const current = queue.shift();
    for (const next of roomById(current).links) {
      if (dist[next] === undefined && !doorClosed(current, next)) { dist[next] = dist[current] + 1; queue.push(next); }
    }
  }
  return dist;
}

// Ricostruisce il percorso (porte aperte) più breve da origin a destination, stanza per stanza.
// Usata dalla manovra per capire quali stanze la squadra attraversa, non solo dove arriva:
// un presidio in una stanza di solo passaggio deve agganciarsi comunque, non solo quello di partenza.
function openPath(origin, destination) {
  if (origin === destination) return [origin];
  const parent = { [origin]: null };
  const queue = [origin];
  while (queue.length) {
    const current = queue.shift();
    if (current === destination) break;
    for (const next of roomById(current).links) {
      if (!(next in parent) && !doorClosed(current, next)) { parent[next] = current; queue.push(next); }
    }
  }
  if (!(destination in parent)) return null;
  const path = [destination];
  while (path[path.length - 1] !== origin) path.push(parent[path[path.length - 1]]);
  return path.reverse();
}

// Salvataggi in coda e atomici (file temporaneo + rename): due richieste ravvicinate non
// possono intrecciare le scritture e lasciare un JSON troncato che al riavvio perde la partita.
// Le scritture si accodano ma non si accumulano: se durante una scrittura arrivano altre
// mutazioni, solo l'ultima istantanea viene poi salvata (lo stato è sempre integrale, le
// versioni intermedie non servono a nessuno e terrebbero in memoria una stringa per ognuna).
// JSON compatto: l'indentazione raddoppiava il file e la stringa tenuta in RAM.
let saving = Promise.resolve();
let pendingSnapshot = null;
let flushing = false;
async function flushSaves() {
  if (flushing) return saving;
  flushing = true;
  try {
    await mkdir(DATA_DIR,{recursive:true});
    while (pendingSnapshot !== null) {
      const snapshot = pendingSnapshot;
      pendingSnapshot = null;
      await writeFile(DATA_TMP, snapshot);
      await rename(DATA_TMP, DATA_FILE);
    }
  } catch (error) { console.error(error); }
  finally { flushing = false; }
}
function save() {
  pendingSnapshot = JSON.stringify(game);
  saving = saving.then(flushSaves).catch((error) => console.error(error));
  return saving;
}

function publicGame() {
  if (!game) return null;
  // I segreti non escono mai: `deviceId` autorizza un telefono, `controllerToken` autorizza
  // esclusivamente i comandi della plancia (avvio, salto turno, reset e nuova missione).
  const {controllerToken:_controllerToken,...safeGame}=game;
  const players = game.players.map((p)=>{const {deviceId:_deviceId,...rest}=p;return {...rest,connected:connected(p),riseIn:riseIn(p)};});
  // `waiting` = l'operativo di cui è il turno adesso (una voce sola), per la riga di stato della plancia.
  const active = game.players.find((p)=>p.id===game.activePlayerId&&alive(p));
  const waiting = active?[active.name]:[];
  return {...safeGame, players, waiting, caseAt:caseRoomNow(), hostageAt:hostageRoomNow(), vaultOpen:vaultOpen(), specterExits:specterExits()};
}

// Scheda operativo pronta al gioco a partire da un template: usata sia alla creazione della
// partita (percorso simulazione headless, che passa già `body.players`) sia quando un telefono
// sceglie il personaggio dalla lobby (`/api/join`).
function newPlayer(id, t, name, startRoom) {
  return {id, name:String(name||t.callsign).slice(0,13).toUpperCase(), characterId:t.id, callsign:t.callsign, role:t.role, specialty:t.specialty, color:t.color, maxHp:t.maxHp, hp:t.maxHp, dmg:t.dmg, mag:t.mag, maxMag:t.mag, focus:t.focus, maxFocus:t.focus, weapon:t.weapon, ability:t.ability, abilityText:t.abilityText, passives:t.passives, room:startRoom, actions:[], move:null, mods:[], thermalTarget:null, thermalStreak:0, maneuverCount:0, lastPlateTurn:-LAST_PLATE_COOLDOWN, turnDone:false, deviceId:null, lastSeen:0};
}

// Presidio nemico: si schiera all'AVVIO (`/api/start`), non alla creazione del canale. È lo stesso
// per ogni squadra; la forza viene solo dal `tuning` della missione. Il percorso simulazione lo
// schiera subito da `createGame`.
function buildSquadEnemies(game) {
  const tuning = missionTuning(missionOf(game.missionId), game.riskLevel);
  game.hpScale = tuning.enemyHpPower;
  game.dmgScale = tuning.enemyDmgPower;
  const layoutLike = {garrison:game.garrison, droneSpawns:game.droneSpawns, vaultRoom:game.vaultRoom, dropRoom:game.dropRoom, startRoom:game.startRoom, nodeRooms:game.nodeRooms};
  game.enemies = buildEnemies(layoutLike, game.map, game.hpScale, game.dmgScale, game.maxPlayers);
}

function createGame(body) {
  const mission = missionOf(body.missionId);
  // Plancia fissa della missione, clonata così com'è: nessuna generazione casuale.
  const layout = structuredClone(mission.layout);
  const maxPlayers = Math.max(2, Math.min(6, Number(body.maxPlayers) || 6));
  // La plancia crea il canale VUOTO: gli operativi si aggiungono poi dai telefoni scegliendo la
  // scheda. Il percorso simulazione headless passa invece `body.players` con le schede già fissate.
  const picks = Array.isArray(body.players) ? body.players.slice(0,6) : [];
  let seq = 0;
  const players = picks.map((pick)=>{
    const t = templates.find((item)=>item.id===pick.characterId) || templates[seq];
    return newPlayer(`p${++seq}`, t, pick.name, layout.startRoom);
  });
  const riskLevel = RISK_LEVELS[body.riskLevel] ? body.riskLevel : DEFAULT_RISK_LEVEL;
  const tuning=missionTuning(mission, riskLevel);
  const hpScale=tuning.enemyHpPower;
  const dmgScale=tuning.enemyDmgPower;
  const roomName=(id)=>{const r=layout.rooms.find((x)=>x.id===id);return `${id} // ${r?.name||''}`;};
  const narrative={goalHeadline:mission.goalHeadline, ...mission.narrative(layout,roomName)};
  return {
    code:makeCode(), phase:'lobby', round:1, turn:0, alarm:tuning.alarmStart, breach:0, alarmSpawns:[],
    riskLevel,
    // Segreto consegnato solo alla plancia nella risposta di /api/setup e conservato nel suo
    // localStorage; non viene mai incluso in /api/state, quindi i telefoni non possono pilotare
    // o cancellare la sessione.
    controllerToken:randomUUID(),
    hits:[], hitSeq:0,
    // Registro eventi numerato (vedi `emit`): la plancia lo riproduce in sequenza.
    events:[], eventSeq:0, batchSeq:0, towerBatch:null,
    abilityActivations:[], abilityActivationSeq:0,
    // Modifiche estratte dalle casse: coda per il pop-up centrale della plancia.
    modDrops:[], modDropSeq:0,
    unlocks:[], unlockSeq:0,
    hpScale, dmgScale, maxPlayers, seq,
    turnOrder:players.map((p)=>p.id), activePlayerId:players[0]?.id||null,
    missionId:mission.id, title:mission.title, location:`HELIX TOWER // SETTORE ${['NORD','SUD','EST','OVEST'][Math.floor(Math.random()*4)]}`,
    objective:narrative.objective, narrative,
    map:layout.rooms, startRoom:layout.startRoom, vaultRoom:layout.vaultRoom, dropRoom:layout.dropRoom,
    garrison:layout.garrison||null, droneSpawns:layout.droneSpawns||null,
    nodeRooms:layout.nodeRooms, nodesRequired:NODES_REQUIRED, doors:layout.doors||{},
    // Telecamere ancora attive (id stanza): DISABILITA TELECAMERA toglie la voce.
    cameras:[...(layout.cameras||[])],
    // Nebbia: `fog` = stanze che partono al buio, `visited` = stanze già raggiunte da un operativo
    // (la partenza conta subito). Una stanza in `fog` si "illumina" alla prima visita e resta visibile.
    fog:[...(layout.fog||[])], visited:[layout.startRoom],
    cheats:{},
    // Casse di potenziamento: `uses` scende a ogni APRI CASSA, a 0 la cassa è esaurita.
    chests:(layout.chests||[]).map((room)=>({room,uses:maxPlayers,max:maxPlayers})),
    nodes:Object.fromEntries(layout.nodeRooms.map((id)=>[id,false])),
    caseRoom:layout.vaultRoom, caseHolder:null, caseDelivered:false, purged:false, lockdown:false, blackout:false,
    hostage:{room:layout.vaultRoom, holder:null, hp:HOSTAGE_MAX_HP, maxHp:HOSTAGE_MAX_HP, freed:false, delivered:false},
    download:{progress:0, required:DOWNLOAD_REQUIRED, done:false},
    reactor:{armed:false, fuse:REACTOR_FUSE_TURNS, required:REACTOR_FUSE_TURNS, exploded:false},
    specter:{room:layout.vaultRoom, prev:null, awake:false, captured:false},
    players,
    enemies:players.length?buildEnemies(layout,layout.rooms,hpScale,dmgScale,players.length):[],
    feed:[{time:nowTime(),tone:'system',text:players.length
      ?`Canale clandestino aperto. Squadra in posizione a ${roomName(layout.startRoom)}.`
      :`Canale clandestino aperto. In attesa degli operativi — ingresso da ${roomName(layout.startRoom)}.`}],
    event:{title:'FINESTRA OPERATIVA',text:'Il blackout copre l’infiltrazione, ma l’obiettivo è ancora sigillato: servono i nodi.'},
    createdAt:Date.now(),updatedAt:Date.now(),
  };
}

const FEED_KEPT = 50;
function log(text,tone='system') {
  game.feed.unshift({time:nowTime(),text,tone});
  // Taglio sul posto: `slice` rifaceva l'intero array (e ne lasciava uno da raccogliere) a ogni riga.
  if (game.feed.length > FEED_KEPT) game.feed.length = FEED_KEPT;
}

// FEEDBACK COLPO SUI TOKEN
// Ogni variazione di integrità lascia una voce qui, con un id progressivo. I client fanno
// polling: confrontano l'ultimo id già visto e per le voci nuove fanno salire il numero sopra
// il token colpito (vedi useHitFlashes in src/App.tsx). È un buffer di eventi recenti, non uno
// storico: le voci vecchie si buttano. `targetId` è l'id dell'unità (operativo o nemico) oppure
// `hostage` per l'informatore, `room` serve a piazzare il numero anche se il token è già sparito
// dalla plancia (il nemico ucciso dal colpo che lo ha tolto di mezzo).
// `sourceId` = chi ha sparato (operativo o nemico), quando c'è: la plancia disegna il colpo
// dal tiratore al bersaglio nello stesso istante in cui sale il numero del danno.
function hit(targetId,amount,kind,room,phase=null,sourceId=null) {
  if(!game||!targetId||!room) return;
  const value=Math.round(amount);
  if(value<=0) return;
  emit('hit',{targetId,room,amount:value,kind,...(sourceId?{sourceId}:{})},phase);
  game.hitSeq=(game.hitSeq||0)+1;
  if(!game.hits) game.hits=[];
  game.hits.push({id:game.hitSeq,targetId,room,amount:value,kind});
  // Buffer scorrevole senza ricostruirlo: prima si copiava l'intero array due volte per colpo.
  if(game.hits.length>HITS_KEPT) game.hits.splice(0,game.hits.length-HITS_KEPT);
}

// REGISTRO EVENTI
// Ogni cosa che la plancia deve animare (manovre, inseguimenti, colpi, cadute, rialzi, SEGUGI,
// allarme...) lascia una voce numerata in `game.events`. La plancia la riproduce in ordine invece
// di indovinare cosa è cambiato confrontando due poll. Gli eventi generati dentro la risposta della
// torre (FINE TURNO / SALTA TURNO / CHIUDI ROUND) portano lo stesso `batch` e una `phase`: il
// client li raggruppa per fase (0 movimento, 1 colpi, 2 allarme, 3 eventi di torre, 4 passaggio
// di mano) e li mostra uno step alla volta. Fuori da un batch l'evento si mostra subito.
// È un buffer scorrevole, non uno storico.
const EVENTS_KEPT = 80;
const EVENT_PHASE = {move:0, enemyMove:0, specter:0, hit:1, knockdown:1, alarm:2, spawn:3, lockdown:3, blackout:3, reactor:3, rise:3, breach:3, download:3, handoff:4, phase:4};
function emit(type, data = {}, phase = null) {
  if (!game) return;
  game.eventSeq = (game.eventSeq || 0) + 1;
  if (!game.events) game.events = [];
  game.events.push({ seq: game.eventSeq, type, batch: game.towerBatch || null, phase: phase ?? EVENT_PHASE[type] ?? 1, ...data });
  if (game.events.length > EVENTS_KEPT) game.events.splice(0, game.events.length - EVENTS_KEPT);
}
// Apre/chiude il batch della risposta della torre. Allarme, passaggio di mano e fine partita si
// registrano una volta sola a batch chiuso (differenza fra prima e dopo), così la plancia li
// mostra dopo movimenti e colpi invece che nello stesso istante.
let towerStart = null;
function beginTower() {
  game.batchSeq = (game.batchSeq || 0) + 1;
  game.towerBatch = game.batchSeq;
  towerStart = { alarm: game.alarm, active: game.activePlayerId, round: game.round, phase: game.phase };
}
function endTower() {
  if (!game || !towerStart) return;
  if (game.alarm !== towerStart.alarm) emit('alarm', { from: towerStart.alarm, to: game.alarm });
  if (game.activePlayerId !== towerStart.active || game.round !== towerStart.round) emit('handoff', { from: towerStart.active, to: game.activePlayerId, fromRound: towerStart.round, toRound: game.round });
  if (game.phase !== towerStart.phase) emit('phase', { from: towerStart.phase, to: game.phase });
  game.towerBatch = null;
  towerStart = null;
}

// ATTIVAZIONI SPECIALI
// Come i colpi, anche le abilità hanno una piccola coda con id progressivo: la plancia la
// confronta a ogni poll e apre un avviso solo per gli eventi arrivati dopo il suo caricamento.
const ABILITY_ACTIVATIONS_KEPT = 16;
function activateAbility(player) {
  if (!game || !player) return;
  game.abilityActivationSeq = (game.abilityActivationSeq || 0) + 1;
  game.abilityActivations = [...(game.abilityActivations || []), {
    id: game.abilityActivationSeq,
    playerId: player.id,
    playerName: player.name,
    callsign: player.callsign,
    characterId: player.characterId,
    color: player.color,
    ability: player.ability,
  }].slice(-ABILITY_ACTIVATIONS_KEPT);
}

// PORTE SBLOCCATE
// Stessa coda con id progressivo: i client suonano l'effetto solo per gli eventi nuovi; il
// telefono lo riproduce solo se `playerId` è il proprio.
const UNLOCKS_KEPT = 12;
function announceUnlock(player) {
  if (!game || !player) return;
  game.unlockSeq = (game.unlockSeq || 0) + 1;
  game.unlocks = [...(game.unlocks || []), { id: game.unlockSeq, playerId: player.id }].slice(-UNLOCKS_KEPT);
}

// MODIFICHE TROVATE
// Stessa coda con id progressivo delle attivazioni speciali: la plancia la confronta a ogni poll
// e apre il pop-up centrale solo per gli eventi arrivati dopo il suo caricamento.
const MOD_DROPS_KEPT = 12;
function announceMod(player, mod) {
  if (!game || !player || !mod) return;
  game.modDropSeq = (game.modDropSeq || 0) + 1;
  game.modDrops = [...(game.modDrops || []), {
    id: game.modDropSeq,
    playerId: player.id,
    playerName: player.name,
    callsign: player.callsign,
    characterId: player.characterId,
    color: player.color,
    room: player.room,
    modId: mod.id,
    modName: mod.name,
    modText: mod.text,
  }].slice(-MOD_DROPS_KEPT);
}

function damageEnemy(enemy,dmg,actor,sourceId=null) {
  const before=enemy.hp;
  enemy.hp=Math.max(0,enemy.hp-dmg);
  hit(enemy.id,before-enemy.hp,'damage',enemy.room,null,sourceId);
  log(`${actor} infligge ${dmg} danni a ${enemy.name} in ${enemy.room}.`, 'combat');
  if(enemy.hp===0) log(`${enemy.name} neutralizzato in ${enemy.room}.`, 'success');
}

function revive(target,healer,amount) {
  target.hp=Math.min(target.maxHp,amount);
  target.downAt=null;
  target.downTurnsSkipped=0;
  hit(target.id,target.hp,'heal',target.room);
  log(`${healer} rianima ${target.name} in ${target.room}.`, 'success');
}

function breachNode(roomId,actor){
  game.nodes[roomId]=true;
  game.breach=breachCount();
  game.alarm=Math.min(100,game.alarm+ALARM_NODE_BREACH);
  emit('breach',{room:roomId});
  log(`${actor} viola il nodo di ${roomLabel(roomId)} — nodi ${game.breach}/${game.nodeRooms.length}.`, 'hack');
  if(vaultOpen()&&!game.vaultAnnounced){game.vaultAnnounced=true;log(game.narrative.vaultUnlocked,'success');}
  if(game.missionId==='spettro'&&vaultOpen()&&!game.specter.awake) game.specter.awake=true;
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

// MANOVRA: lo spostamento del turno si risolve subito. Non c'è fuoco di sganciamento, ma chi
// scappa da una stanza con ostili se li porta dietro TUTTI nello stesso istante: ogni nemico che
// presidiava la stanza di partenza (o una qualunque stanza di solo passaggio lungo il tragitto)
// si sposta nella stanza d'arrivo e aggancia chi si è mosso. Muoversi con un nemico addosso non
// lo stacca mai.
function applyMove(p){
  if(!p.move) return;
  const destination=p.move.roomId;
  const origin=p.room;
  if(origin===destination) return;
  const path=openPath(origin,destination);
  if(!path){
    log(`${p.name} non trova un percorso di porte aperte verso ${destination}: resta in ${origin}.`,'system');
    return;
  }
  p.room=destination;
  emit('move',{playerId:p.id,from:origin,to:destination,path});
  if(!game.visited.includes(destination)){
    game.visited.push(destination);
    if(game.fog.includes(destination)) log(`${p.name} entra in ${roomLabel(destination)}: la nebbia si dirada.`,'system');
  }
  const chasers=path.slice(0,-1).flatMap(enemiesIn);
  for(const enemy of chasers){ emit('enemyMove',{enemyId:enemy.id,from:enemy.room,to:destination,follow:true}); enemy.room=destination; enemy.locked=true; enemy.chasing=p.id; }
  if(chasers.length) log(`${chasers.length===1?chasers[0].name:`${chasers.length} unità Helix`} insegue ${p.name} in ${roomLabel(destination)}.`,'danger');
  log(`${p.name} raggiunge ${roomLabel(destination)}${game.caseHolder===p.id?' con la valigetta':''}${game.hostage.holder===p.id?' con l’informatore':''}.`,'system');
}

// BERSAGLI A TIRO
// Di regola il combattimento è solo dentro la stanza. La modifica CECCHINO (cassa) allunga il
// tiro di una stanza, ma solo attraverso una porta APERTA: una porta bloccata ferma il colpo
// come ferma la manovra. I bersagli nella propria stanza restano sempre i primi della lista.
function shootableEnemies(p){
  const rooms=[p.room];
  if(hasMod(p,'sniper')) for(const id of roomById(p.room).links) if(!doorClosed(p.room,id)) rooms.push(id);
  return game.enemies.filter((e)=>alive(e)&&rooms.includes(e.room))
    .sort((a,b)=>(a.room===p.room?0:1)-(b.room===p.room?0:1));
}

// CASSA DI POTENZIAMENTO
// Pesca una modifica a caso fra le cinque e la equipaggia sul momento. Una sola per operativo:
// chi ha già la sua arma modificata non può aprire altre casse (controllo in applyAction e in
// /api/action), quindi qui l'operativo parte sempre da zero modifiche.
// Caricatore esteso e Canna rinforzata cambiano direttamente la scheda (caricatore e danno);
// le altre tre sono flag letti al momento dell'attacco.
function grantMod(p){
  if(!Array.isArray(p.mods)) p.mods=[];
  const mod=MODS[Math.floor(Math.random()*MODS.length)];
  p.mods.push(mod.id);
  if(mod.id==='mag'){ p.maxMag+=MOD_MAG_BONUS; p.mag+=MOD_MAG_BONUS; }
  if(mod.id==='barrel') p.dmg+=MOD_BARREL_BONUS;
  return mod;
}

// AZIONE: ogni azione del turno (fino a ACTIONS_PER_TURN) si risolve subito all'invio, sempre
// limitata alla stanza occupata in quel momento (il tiro del CECCHINO è l'unica eccezione).
function applyAction(p,action){
  if(!alive(p)) return;
  if(!action||action.type==='move') return;
  {
    const room=roomById(p.room);
    const hostiles=enemiesIn(p.room);
    const target=hostiles.find((e)=>e.id===action.targetId)||hostiles[0];

    if(action.type==='attack'){
      // Il bersaglio dell'attacco passa da `shootableEnemies`: con CECCHINO può stare nella stanza
      // accanto, per tutto il resto (abilità comprese) vale solo la stanza occupata.
      const reach=shootableEnemies(p);
      const shot=reach.find((e)=>e.id===action.targetId)||reach[0];
      if(p.mag<=0) log(`${p.name} preme il grilletto a vuoto in ${p.room}: caricatore scarico.`,'system');
      else if(!shot) log(`${p.name} non ha bersagli a tiro da ${p.room}: tiene la posizione.`,'system');
      else{
        const far=shot.room!==p.room;
        const opening=hasPassive(p,'clean-opening')&&!shot.locked;
        let damage=opening?Math.ceil(p.dmg*1.5):p.dmg;
        if(opening){
          log(`${p.name} trova un'apertura su ${shot.name}: +50% danni.`,'combat');
        }
        // MODULO TERMICO: il bonus cresce finché si resta sullo stesso bersaglio, colpo dopo colpo.
        if(hasMod(p,'thermal')){
          p.thermalStreak=p.thermalTarget===shot.id?Math.min(MOD_THERMAL_STEPS.length-1,(p.thermalStreak||0)+1):0;
          p.thermalTarget=shot.id;
          const step=MOD_THERMAL_STEPS[p.thermalStreak]||0;
          if(step>0){
            damage=Math.round(damage*(1+step));
            log(`${p.name}: modulo termico al colpo ${p.thermalStreak+1} su ${shot.name} — +${Math.round(step*100)}% danni.`,'combat');
          }
        }
        // COLPO DOPPIO: mezza probabilità di raddoppiare quanto appena calcolato.
        if(hasMod(p,'double')&&Math.random()<MOD_DOUBLE_CHANCE){
          damage*=2;
          log(`${p.name}: colpo doppio su ${shot.name} — danno raddoppiato.`,'combat');
        }
        // Chi viene colpito reagisce: un tiro da fuori stanza aggancia comunque chi ha sparato.
        if(opening||far){ shot.locked=true; shot.chasing=p.id; }
        if(far) log(`${p.name} spara da ${roomLabel(p.room)} verso ${roomLabel(shot.room)}.`,'combat');
        damageEnemy(shot,damage,p.name,p.id);
        if(!alive(shot)&&p.thermalTarget===shot.id){ p.thermalTarget=null; p.thermalStreak=0; }
        p.mag=Math.max(0,p.mag-1);
        if(p.mag===0) log(`${p.name}: caricatore vuoto, serve RICARICA.`,'system');
      }
    }

    if(action.type==='reload'){
      if(p.mag>=p.maxMag) log(`${p.name}: caricatore già pieno.`,'system');
      else{
        p.mag=p.maxMag;
        log(`${p.name} ricarica ${p.weapon}: caricatore pieno (${p.maxMag}).`,'system');
      }
    }

    if(action.type==='grab'){
      if(game.caseHolder) log(`${p.name}: la valigetta è già in mano a un compagno.`,'system');
      else if(caseRoomNow()!==p.room) log(`${p.name} non trova la valigetta in ${p.room}.`,'system');
      else if(p.room===game.vaultRoom&&!vaultOpen()) log(`${p.name}: la teca di ${p.room} è ancora sigillata.`,'system');
      else{
        const fresh=!game.caseTaken;
        game.caseHolder=p.id;game.caseRoom=null;game.caseTaken=true;
        if(fresh){
          game.alarm=Math.min(100,game.alarm+ALARM_OBJECTIVE_UNLOCK);
          log(`${p.name} stacca la valigetta MNEMOSYNE dalla teca.`,'danger');
        }
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
        game.alarm=Math.min(100,game.alarm+ALARM_OBJECTIVE_UNLOCK);
        // Da qui ogni unità Helix, anche quella mai ingaggiata, insegue la squadra (come il LOCKDOWN).
        for(const e of game.enemies) e.locked=true;
        log(game.narrative.purged,'danger');
      }
    }

    if(action.type==='download'){
      if(game.missionId!=='assedio') log(`${p.name}: nessun collegamento da scaricare in questa missione.`,'system');
      else if(game.download.done) log(`${p.name}: il trasferimento è già completo.`,'system');
      else if(p.room!==game.vaultRoom) log(`${p.name} non è sulla sorgente dati.`,'system');
      else if(!vaultOpen()) log(`${p.name}: la sorgente dati di ${p.room} è ancora sigillata.`,'system');
      else{
        p.focus=Math.max(0,p.focus-DOWNLOAD_FOCUS);
        const fromProgress=game.download.progress;
        game.download.progress=Math.min(game.download.required,game.download.progress+1);
        emit('download',{from:fromProgress,to:game.download.progress,required:game.download.required,room:p.room});
        game.alarm=Math.min(100,game.alarm+ALARM_DOWNLOAD_TICK);
        if(game.download.progress>=game.download.required){
          game.download.done=true;
          // Come la PURGA: da qui ogni unità Helix, anche quella mai ingaggiata, insegue la squadra.
          for(const e of game.enemies) e.locked=true;
          log(game.narrative.downloaded,'danger');
        }
        else log(`${p.name} scarica MNEMOSYNE in ${roomLabel(p.room)}: ${game.download.progress}/${game.download.required}.`,'hack');
      }
    }

    if(action.type==='arm'){
      if(game.missionId!=='reattore') log(`${p.name}: nessuna carica da innescare in questa missione.`,'system');
      else if(game.reactor.armed) log(`${p.name}: la carica è già innescata.`,'system');
      else if(p.room!==game.vaultRoom) log(`${p.name} non è sul reattore.`,'system');
      else if(!vaultOpen()) log(`${p.name}: l'accesso al reattore di ${p.room} è ancora sigillato.`,'system');
      else{
        game.reactor.armed=true;
        game.alarm=Math.min(100,game.alarm+ALARM_OBJECTIVE_UNLOCK);
        // Come la PURGA/SCARICA: da qui ogni unità Helix, anche quella mai ingaggiata, insegue la squadra.
        for(const e of game.enemies) e.locked=true;
        log(game.narrative.armed,'danger');
      }
    }

    if(action.type==='seal'){
      const doorRoom=action.roomId;
      if(game.missionId!=='spettro') log(`${p.name}: nessuna porta da sigillare in questa missione.`,'system');
      else if(!doorRoom||!room.links.includes(doorRoom)) log(`${p.name}: nessuna porta verso ${doorRoom||'?'} da ${p.room}.`,'system');
      else if(doorClosed(p.room,doorRoom)) log(`${p.name}: la porta verso ${roomLabel(doorRoom)} è già chiusa.`,'system');
      else{
        p.focus=Math.max(0,p.focus-SEAL_FOCUS);
        game.doors[doorKey(p.room,doorRoom)]=true;
        log(`${p.name} sigilla la porta fra ${roomLabel(p.room)} e ${roomLabel(doorRoom)}.`,'hack');
        if(game.specter.room===p.room||game.specter.room===doorRoom){
          const left=specterExits().length;
          if(game.specter.awake&&!game.specter.captured) log(left?`SPETTRO ha ancora ${left} ${left===1?'via':'vie'} di fuga da ${roomLabel(game.specter.room)}.`:`SPETTRO è braccato in ${roomLabel(game.specter.room)}: CATTURA adesso.`,left?'system':'success');
        }
      }
    }

    if(action.type==='capture'){
      const s=game.specter;
      if(game.missionId!=='spettro') log(`${p.name}: nessun bersaglio da catturare in questa missione.`,'system');
      else if(s.captured) log(`${p.name}: SPETTRO è già in gabbia.`,'system');
      else if(!s.awake) log(`${p.name}: SPETTRO dorme ancora nella culla sigillata.`,'system');
      else if(s.room!==p.room) log(`${p.name}: SPETTRO non è in ${roomLabel(p.room)}.`,'system');
      else if(!specterCornered()) log(`${p.name} allunga la gabbia, ma SPETTRO ha ancora vie di fuga: ${specterExits().join(' · ')}.`,'system');
      else{
        s.captured=true;
        game.alarm=Math.min(100,game.alarm+ALARM_OBJECTIVE_UNLOCK);
        // Come la PURGA: da qui ogni unità Helix, anche quella mai ingaggiata, insegue la squadra.
        for(const e of game.enemies) e.locked=true;
        log(`${p.name} chiude la gabbia neurale su SPETTRO in ${roomLabel(p.room)}.`,'success');
        log(game.narrative.captured,'danger');
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
        if(fresh){
          game.alarm=Math.min(100,game.alarm+ALARM_OBJECTIVE_UNLOCK);
          log(`${p.name} libera l’informatore.`,'danger');
        }
        else log(`${p.name} riprende la scorta dell’informatore in ${roomLabel(p.room)}.`,'success');
      }
    }

    if(action.type==='unlock'){
      const doorRoom=action.roomId;
      if(!doorRoom||!room.links.includes(doorRoom)) log(`${p.name}: nessuna porta verso ${doorRoom||'?'} da ${p.room}.`,'system');
      else if(!doorClosed(p.room,doorRoom)) log(`${p.name}: la porta verso ${roomLabel(doorRoom)} è già aperta.`,'system');
      else{
        p.focus=Math.max(0,p.focus-1);
        game.doors[doorKey(p.room,doorRoom)]=false;
        announceUnlock(p);
        log(`${p.name} sblocca la porta fra ${roomLabel(p.room)} e ${roomLabel(doorRoom)}.`,'hack');
      }
    }

    if(action.type==='camera'){
      if(!game.cameras.includes(p.room)) log(`${p.name}: nessuna telecamera attiva in ${roomLabel(p.room)}.`,'system');
      else{
        game.cameras=game.cameras.filter((id)=>id!==p.room);
        game.alarm=Math.max(0,game.alarm-ALARM_CAMERA_DISABLE);
        log(`${p.name} disabilita la telecamera di ${roomLabel(p.room)}: allarme -${ALARM_CAMERA_DISABLE}%.`,'hack');
      }
    }

    if(action.type==='chest'){
      const chest=game.chests?.find((c)=>c.room===p.room);
      if(!chest) log(`${p.name}: nessuna cassa in ${roomLabel(p.room)}.`,'system');
      else if(chest.uses<=0) log(`${p.name}: la cassa di ${roomLabel(p.room)} è già svuotata.`,'system');
      // Nessuno apre una cassa sotto tiro: prima si ripulisce la stanza.
      else if(hostiles.length) log(`${p.name} non può aprire la cassa di ${roomLabel(p.room)}: ci sono ancora ostili.`,'system');
      // Una modifica a testa: la cassa serve a chi ha ancora l'arma di serie.
      else if(p.mods?.length) log(`${p.name} ha già ${modById(p.mods[0])?.name||'una modifica'}: lascia la cassa ai compagni.`,'system');
      else{
        chest.uses-=1;
        const mod=grantMod(p);
        announceMod(p,mod);
        log(`${p.name} apre la cassa di ${roomLabel(p.room)}: ${mod.name} — ${mod.text}`,'success');
        if(chest.uses<=0) log(`La cassa di ${roomLabel(p.room)} è ora vuota.`,'system');
      }
    }

    if(action.type==='hack'){
      if(!room.node) log(`${p.name} non trova terminali in ${roomLabel(p.room)}.`,'system');
      else if(game.nodes[p.room]) log(`${p.name}: il nodo di ${p.room} è già violato.`,'system');
      else {
        p.focus=Math.max(0,p.focus-2);
        breachNode(p.room,p.name);
      }
    }

    if(action.type==='heal'){
      // Priorità ai caduti nella stessa stanza: la barella non attraversa i corridoi.
      const down=riskOf().allyRevive?game.players.filter((x)=>!alive(x)&&x.room===p.room)[0]:null;
      if(down) revive(down,p.name,Math.round(down.maxHp*REVIVE_RATIO));
      else if(p.hp>=p.maxHp){ log(`${p.name} è già a piena integrità.`,'system'); }
      else{
        const amount=HEAL_AMOUNT;
        const before=p.hp;
        p.hp=Math.min(p.maxHp,p.hp+amount);
        hit(p.id,p.hp-before,'heal',p.room);
        log(`${p.name} si ripristina ${amount} integrità in ${p.room}.`,'success');
      }
    }

    if(action.type==='ability'){
      p.focus=Math.max(0,p.focus-3);
      activateAbility(p);
      if(p.characterId==='ghost'){
        if(target) damageEnemy(target,26,p.name,p.id);
        else log(`${p.name} svanisce nelle ombre di ${p.room}.`,'system');
      }
      else if(p.characterId==='chrome'){
        if(target) damageEnemy(target,40,p.name,p.id);
        else log(`${p.name} scarica il cromo a vuoto: nessun ostile in ${p.room}.`,'system');
      }
      else if(p.characterId==='cipher'){
        // La guerra di rete raggiunge anche la stanza collegata: il CIPHER non deve esporsi.
        const reach=[p.room,...room.links];
        const nodeRoom=reach.find((id)=>roomById(id).node&&!game.nodes[id]);
        if(nodeRoom) breachNode(nodeRoom,p.name);
        else log(`${p.name} lancia uno zero-day ma non aggancia nodi da ${p.room}.`,'system');
        for(const e of game.enemies.filter((x)=>alive(x)&&x.type==='DRONE'&&reach.includes(x.room))) damageEnemy(e,25,p.name,p.id);
      }
      else if(p.characterId==='ripper'){
        // Effetto a quantità fissa, non "per ogni compagno": al massimo LAZARUS_TARGETS operativi
        // della stanza (lui compreso), prima i caduti e poi i più feriti. Chi è già pieno non conta.
        const patients=game.players
          .filter((x)=>x.room===p.room&&(alive(x)?x.hp<x.maxHp:riskOf().allyRevive))
          .sort((a,b)=>(alive(a)-alive(b))||(a.hp/a.maxHp-b.hp/b.maxHp))
          .slice(0,LAZARUS_TARGETS);
        for(const ally of patients){
          if(alive(ally)){
            const before=ally.hp;
            ally.hp=Math.min(ally.maxHp,ally.hp+22);
            hit(ally.id,ally.hp-before,'heal',ally.room);
          }
          else revive(ally,p.name,Math.round(ally.maxHp*LAZARUS_RATIO));
        }
        log(`${p.name} attiva Protocollo Lazarus in ${roomLabel(p.room)}.`,'success');
      }
      else if(p.characterId==='face'){
        game.alarm=Math.max(0,game.alarm-ALARM_FACE_RELIEF);
        for(const e of hostiles) e.distracted=true;
        log(`${p.name} inietta credenziali sintetiche: allarme in calo, ostili di ${p.room} distratti.`,'hack');
      }
      else if(p.characterId==='breacher'){
        // Area sull'intera stanza (tutti gli ostili presenti) + scasso di ogni porta bloccata.
        for(const e of hostiles) damageEnemy(e,BREACH_DAMAGE,p.name,p.id);
        const sealed=room.links.filter((id)=>doorClosed(p.room,id));
        for(const id of sealed) game.doors[doorKey(p.room,id)]=false;
        if(!hostiles.length&&!sealed.length) log(`${p.name} innesca la carica in ${roomLabel(p.room)}, ma non c'è nulla da abbattere.`,'system');
        else if(sealed.length) log(`${p.name} spalanca ${sealed.length===1?'la porta bloccata':'le porte bloccate'} di ${roomLabel(p.room)}.`,'hack');
      }
      else if(p.characterId==='handler'){
        // Effetto a quantità fissa: al massimo SYNC_TARGETS compagni della stanza, prima chi ha meno focus.
        const mates=game.players
          .filter((x)=>x.id!==p.id&&alive(x)&&x.room===p.room&&x.focus<x.maxFocus)
          .sort((a,b)=>a.focus/a.maxFocus-b.focus/b.maxFocus)
          .slice(0,SYNC_TARGETS);
        for(const ally of mates) ally.focus=Math.min(ally.maxFocus,ally.focus+SYNC_FOCUS);
        if(mates.length) log(`${p.name} trasmette un impulso di squadra: +${SYNC_FOCUS} focus a ${mates.map((x)=>x.name).join(' e ')}.`,'success');
        else log(`${p.name} trasmette un impulso di squadra, ma nessun compagno ne ha bisogno in ${roomLabel(p.room)}.`,'system');
      }
      else if(p.characterId==='driver'){
        const reach=[p.room,...room.links];
        const swarm=game.enemies.filter((e)=>alive(e)&&reach.includes(e.room)).slice(0,2);
        if(!swarm.length) log(`${p.name} lancia lo sciame MANTA ma non trova ostili nel settore.`,'system');
        for(const e of swarm) damageEnemy(e,18,p.name,p.id);
      }
    }
  }
}

// FASE 3 // RISPOSTA HELIX
// Gli ostili NON hanno un turno di attacco: colpiscono solo l'operativo di mano a fine turno, e
// solo se dividono la stanza con lui (vedi enemyStrike). Il movimento invece scatta a ogni fine
// turno di operativo (non a fine round): chi è già ingaggiato insegue la squadra una stanza per
// turno, senza soglia di allarme — appena un'unità è `locked` (ingaggio diretto, spawn da soglia
// d'allarme, LOCKDOWN) insegue da subito.
function stepEngagedEnemies(){
  for(const enemy of game.enemies.filter(alive)){
    if(enemy.distracted){ enemy.distracted=false; continue; }
    if(!enemy.locked) continue;
    if(alliesIn(enemy.room).length) continue; // già addosso alla squadra: nessuno spostamento
    let target=game.players.find((p)=>p.id===enemy.chasing&&alive(p));
    if(!target){
      // Nessun bersaglio agganciato: l'unità punta l'operativo raggiungibile più vicino.
      const dist=distanceMap(game.map,enemy.room);
      target=game.players.filter(alive).map((p)=>({p,d:dist[p.room]??99})).sort((a,b)=>a.d-b.d)[0]?.p;
      if(!target){ enemy.chasing=null; continue; }
      enemy.chasing=target.id;
    }
    const step=stepToward(enemy.room,target.room);
    if(step!==enemy.room){ emit('enemyMove',{enemyId:enemy.id,from:enemy.room,to:step}); enemy.room=step; log(`${enemy.name} insegue ${target.name} verso ${roomLabel(step)}.`,'danger'); }
  }
}

// MISSIONE SPETTRO: a ogni fine turno il fuggitivo fa una mossa, e non sta mai fermo se può
// muoversi. Fra le vie di fuga sceglie la stanza che pesa di più fra distanza dagli operativi in
// piedi (in porte, ignorando lo stato delle porte: gli operativi le possono riaprire) e numero di
// vie di fuga da lì — preferisce gli snodi, dove è più difficile chiuderlo — e non torna nella
// stanza da cui è appena arrivato se ha un'alternativa. Se è braccato forza
// una porta chiusa verso una stanza libera (la migliore secondo lo stesso peso) e resta fermo per
// questo turno.
function stepSpecter(){
  if(game.missionId!=='spettro') return;
  const s=game.specter;
  if(!s.awake||s.captured) return;
  game.alarm=Math.min(100,game.alarm+SPECTER_ALARM_TICK);
  const ops=game.players.filter(alive);
  if(!ops.length) return;
  const threat={};
  for(const op of ops){
    const dist=distanceMap(game.map,op.room);
    for(const [id,d] of Object.entries(dist)) threat[id]=Math.min(threat[id]??99,d);
  }
  const score=(id)=>Math.min(threat[id]??99,6)*4+specterExits(id).length*3;
  const exits=specterExits(s.room);
  if(!exits.length){
    const forced=roomById(s.room).links
      .filter((id)=>doorClosed(s.room,id)&&!alliesIn(id).length)
      .sort((a,b)=>score(b)-score(a))[0];
    if(forced){
      game.doors[doorKey(s.room,forced)]=false;
      log(`SPETTRO è braccato in ${roomLabel(s.room)} e forza la porta verso ${roomLabel(forced)}.`,'danger');
    }
    else log(`SPETTRO è braccato in ${roomLabel(s.room)}: non ha vie d’uscita.`,'hack');
    return;
  }
  // Non torna sui suoi passi se ha un'alternativa: gira negli anelli della plancia invece di
  // rimbalzare fra due stanze.
  const pool=exits.length>1?exits.filter((id)=>id!==s.prev):exits;
  const best=[...pool].sort((a,b)=>score(b)-score(a)||a.localeCompare(b))[0];
  const from=s.room;
  s.prev=from;
  s.room=best;
  emit('specter',{from,to:best});
  log(`SPETTRO scivola da ${roomLabel(from)} a ${roomLabel(best)}.`,'danger');
}

// MISSIONE OSTAGGIO: l'informatore libero, non scortato e solo con ostili si dissangua a ogni fine
// turno (non a fine round: con squadre grandi un round dura di più).
function bleedHostage(){
  if(game.missionId==='ostaggio'&&game.hostage.freed&&!game.hostage.delivered&&!game.hostage.holder){
    const room=hostageRoomNow();
    if(enemiesIn(room).length){
      const before=game.hostage.hp;
      game.hostage.hp=Math.max(0,game.hostage.hp-HOSTAGE_UNESCORTED_DAMAGE);
      // L'informatore non è un'unità: sulla plancia è il segnalino `hostage` della sua stanza.
      hit('hostage',before-game.hostage.hp,'damage',room);
      log(`Gli ostili colpiscono l’informatore lasciato solo in ${roomLabel(room)}: ${HOSTAGE_UNESCORTED_DAMAGE} danni.`,'danger');
    }
  }
}

// Bersaglio: gli ostili colpiscono SEMPRE e solo l'operativo che chiude il turno, se divide la
// stanza con loro ed è ancora in piedi. I compagni nella stessa stanza non subiscono danni.
function enemyTarget(enemy, ender){
  if(!ender||!alive(ender)||ender.room!==enemy.room) return null;
  return ender;
}

function enemyDamage(enemy,target){
  if(game.cheats?.immortal) return {damage:0,saved:false}; // CHEAT: immortalità
  let damage=enemy.damage;
  if(hasPassive(target,'chrome-plates')) damage=Math.ceil(damage/2);
  const lethal=target.hp-damage<=0;
  const before=target.hp;
  // Ultima piastra si ricarica in turni chiusi (di chiunque), non a round: con squadre grandi un
  // round dura di più e la protezione varrebbe meno.
  if(lethal&&hasPassive(target,'last-plate')&&(game.turn||0)-(target.lastPlateTurn??-LAST_PLATE_COOLDOWN)>=LAST_PLATE_COOLDOWN){
    target.hp=1;
    target.lastPlateTurn=game.turn||0;
    hit(target.id,before-target.hp,'damage',target.room,null,enemy.id);
    log(`${target.name} attiva Ultima piastra e resta a 1 integrità.`,'success');
    return {damage,saved:true};
  }
  target.hp=Math.max(0,target.hp-damage);
  // Il numero che sale sul token è l'integrità persa davvero, non il danno nominale: con le
  // Piastre di cromo o l'Ultima piastra deve coincidere con quanto scende la barra.
  hit(target.id,before-target.hp,'damage',target.room,null,enemy.id);
  return {damage,saved:false};
}

// I nemici non hanno un turno proprio: quando un operativo chiude il turno (o viene saltato
// dalla plancia), ciascun ostile che si trova nella sua stanza risolve un attacco. Sempre a segno,
// su chi chiude il turno (enemyTarget).
// Ogni operativo che va a terra fa salire l'allarme di ALARM_KNOCKDOWN.
function enemyStrike(p){
  if(!p||!alive(p)) return;
  const room=p.room;
  for(const enemy of enemiesIn(room)){
    const target=enemyTarget(enemy,p);
    if(!target) break; // nessun operativo in piedi rimasto nella stanza
    if(enemy.distracted){ enemy.distracted=false; log(`${enemy.name} è distratto: manca il colpo su ${target.name}.`,'hack'); continue; }
    if(!enemy.locked){ enemy.locked=true; log(`${enemy.name} ingaggia la squadra in ${roomLabel(enemy.room)}.`,'danger'); }
    enemy.chasing=target.id;
    const hit=enemyDamage(enemy,target);
    const mitigation=hasPassive(target,'chrome-plates')?' · Piastre di cromo':hit.saved?' · Ultima piastra':'';
    log(`${enemy.name} colpisce ${target.name} in ${roomLabel(enemy.room)}: ${hit.damage} danni${mitigation}.`,'danger');
    if(target.hp===0) knockDown(target);
  }
}

function knockDown(target,phase=null){
  target.downAt=game.turn||0;
  target.downTurnsSkipped=0;
  emit('knockdown',{playerId:target.id,room:target.room},phase);
  game.alarm=Math.min(100,game.alarm+ALARM_KNOCKDOWN);
  log(`${target.name} è fuori combattimento in ${roomLabel(target.room)}: allarme +${ALARM_KNOCKDOWN}%.`,'danger');
  if(!riskOf().allyRevive) log(`Rischio BRUTALE: ${target.name} non tornerà in gioco.`,'danger');
  if(game.caseHolder===target.id) dropCase(`${target.name} è a terra`);
  if(game.hostage.holder===target.id) dropHostage(`${target.name} è a terra`);
}

// BLACKOUT: oltre BLACKOUT_ALARM la torre stacca la corrente un istante e ogni porta, anche
// quelle già sbloccate, si richiude. Si riapre come sempre con l'azione SBLOCCA PORTA. Scatta
// appena l'allarme supera la soglia — dopo un'azione, una manovra o a fine turno — una volta sola.
function checkBlackout(){
  if(!game||game.phase!=='active'||game.blackout||game.alarm<BLACKOUT_ALARM) return;
  game.blackout=true;
  emit('blackout',{doors:{...game.doors}});
  for(const room of game.map) for(const linkId of room.links) game.doors[doorKey(room.id,linkId)]=true;
  log(`BLACKOUT: allarme al ${game.alarm}%. La torre stacca la corrente e ogni porta si richiude.`,'danger');
  game.event={title:'BLACKOUT',text:`Allarme al ${game.alarm}%: la torre ha staccato la corrente, ogni porta è richiusa. Usate SBLOCCA PORTA.`};
  game.updatedAt=Date.now();
}

// FINE TURNO DELLA TORRE: gira a OGNI turno operativo che si chiude (giocato o saltato), dopo
// allarme, focus e inseguimento. Il turno è l'unità di tempo del gioco: informatore, LOCKDOWN,
// consegna, vittoria/sconfitta, SEGUGI ed evento della plancia si aggiornano qui, mai a fine round,
// così la pressione per turno è la stessa con qualunque numero di operativi.
function resolveTurnEnd() {
  bleedHostage();
  stepSpecter();
  game.breach=breachCount();

  checkBlackout();

  // LOCKDOWN: oltre LOCKDOWN_ALARM la torre allerta ogni presidio, anche quello mai ingaggiato.
  // Da qui in poi tutti i nemici convergono verso la stanza dei Player.
  if(!game.lockdown&&game.alarm>=LOCKDOWN_ALARM){
    game.lockdown=true;
    for(const e of game.enemies) e.locked=true;
    emit('lockdown');
    log(`LOCKDOWN: allarme al ${game.alarm}%. Ogni unità Helix del settore è allertata e converge sulla squadra.`,'danger');
  }

  // MISSIONE 05: dopo l'innesco il reattore detona da solo dopo REACTOR_FUSE_TURNS turni chiusi
  // (di chiunque, non solo di chi l'ha innescato). Chi è ancora nella teca o in una stanza
  // collegata va a terra sul colpo — stesso knockDown di un colpo nemico, non morte permanente.
  if(game.missionId==='reattore'&&game.reactor.armed&&!game.reactor.exploded){
    game.reactor.fuse=Math.max(0,game.reactor.fuse-1);
    if(game.reactor.fuse<=0){
      game.reactor.exploded=true;
      const blastRooms=[game.vaultRoom,...roomById(game.vaultRoom).links];
      emit('reactor',{room:game.vaultRoom,rooms:blastRooms});
      for(const enemy of game.enemies.filter((e)=>alive(e)&&blastRooms.includes(e.room))){
        const before=enemy.hp;enemy.hp=0;hit(enemy.id,before,'damage',enemy.room,3);
        log(`${enemy.name} è travolto dall'esplosione in ${roomLabel(enemy.room)}.`,'combat');
      }
      for(const target of game.players.filter((pl)=>!game.cheats?.immortal&&alive(pl)&&blastRooms.includes(pl.room))){
        const before=target.hp;target.hp=0;hit(target.id,before,'damage',target.room,3);
        knockDown(target,3);
      }
      for(const e of game.enemies) e.locked=true;
      log(game.narrative.detonated,'danger');
    }
    else log(`Il reattore innescato: ${game.reactor.fuse} turni al detonare.`,'danger');
  }

  // CONSEGNA: la valigetta / l'informatore raggiunge il punto di raccolta a fine turno.
  if(game.missionId==='valigetta'&&!game.caseDelivered&&game.caseHolder&&game.players.find((p)=>p.id===game.caseHolder)?.room===game.dropRoom){
    game.caseDelivered=true;game.caseRoom=game.dropRoom;game.caseHolder=null;
    log(`Valigetta MNEMOSYNE consegnata in ${roomLabel(game.dropRoom)}. Estraete la squadra.`,'success');
  }
  if(game.missionId==='ostaggio'&&!game.hostage.delivered&&game.hostage.holder&&hostageRoomNow()===game.dropRoom){
    game.hostage.delivered=true;game.hostage.room=game.dropRoom;game.hostage.holder=null;
    log(`Informatore consegnato in ${roomLabel(game.dropRoom)}. Estraete la squadra.`,'success');
  }

  const living=game.players.filter(alive);
  const extracted=living.length>0&&living.every((p)=>p.room===game.dropRoom)&&!enemiesIn(game.dropRoom).length;
  const objectiveDone=game.missionId==='valigetta'?game.caseDelivered:game.missionId==='nucleo'?game.purged:game.missionId==='assedio'?game.download.done:game.missionId==='reattore'?game.reactor.exploded:game.missionId==='spettro'?game.specter.captured:game.hostage.delivered;
  const hostageLost=game.missionId==='ostaggio'&&game.hostage.freed&&!game.hostage.delivered&&game.hostage.hp<=0;
  if(objectiveDone&&extracted){
    game.phase='victory';
    const victoryLine=game.missionId==='valigetta'?`Squadra estratta da ${roomLabel(game.dropRoom)}. MNEMOSYNE è nostro.`
      :game.missionId==='nucleo'?`Squadra estratta da ${roomLabel(game.dropRoom)}. Il nucleo Helix è stato cancellato.`
      :game.missionId==='assedio'?`Squadra estratta da ${roomLabel(game.dropRoom)}. La copia di MNEMOSYNE è al sicuro.`
      :game.missionId==='reattore'?`Squadra estratta da ${roomLabel(game.dropRoom)}. Il reattore ha chiuso MNEMOSYNE per sempre.`
      :game.missionId==='spettro'?`Squadra estratta da ${roomLabel(game.dropRoom)} con SPETTRO in gabbia. MNEMOSYNE è vostro.`
      :`Squadra estratta da ${roomLabel(game.dropRoom)} con l’informatore vivo. Missione riuscita.`;
    log(victoryLine,'success');
  }
  // Nessuna sconfitta per squadra a terra: chi cade salta un turno e poi si rialza da solo.
  else if(game.alarm>=100||hostageLost){
    game.phase='defeat';
    log(hostageLost?'L’informatore non ce l’ha fatta: la missione è persa.':'Protocollo Helix completato. La squadra è perduta.','danger');
  }
  else{
    // TRACCIA HELIX: a ogni soglia d'allarme (25/35/45/55/65/75/85%) una nuova unità entra nella
    // penultima stanza prima dell'EXIT e parte subito a caccia. Ogni soglia scatta una volta sola.
    let alarmSpawnEvent=null;
    for(const thr of ALARM_SPAWN_THRESHOLDS){
      if(game.alarm<thr||game.alarmSpawns.includes(thr)) continue;
      game.alarmSpawns.push(thr);
      const room=roomById(hunterSpawnRoom());
      // Indice dopo il più alto già in campo: i SEGUGI extra del presidio (es. hunter-6) non
      // devono collidere con quelli generati qui.
      const idx=Math.max(0,...game.enemies.filter((e)=>e.id.startsWith('hunter-')).map((e)=>Number(e.id.slice(7))||0))+1;
      const unit=spawnEnemy('hunter',room.id,idx,game.hpScale||1,game.dmgScale||1);
      unit.locked=true;
      game.enemies.push(unit);
      emit('spawn',{enemyId:unit.id,room:room.id});
      log(`Allarme al ${thr}%: ${unit.name} entra da ${roomLabel(room.id)} e prende posizione.`,'danger');
      alarmSpawnEvent={title:'TRACCIA HELIX',text:`Allarme ${thr}%: ${unit.name} entra da ${roomLabel(room.id)}.`};
    }

    let progressEvent=null;
    if(game.missionId==='valigetta'){
      if(game.caseDelivered) progressEvent={title:'ESTRAZIONE APERTA',text:`Portate ogni operativo vivo in ${roomLabel(game.dropRoom)} per chiudere l’operazione.`};
      else if(game.caseHolder) progressEvent={title:'CARICO IN MANO',text:`Portate la valigetta fino a ${game.dropRoom} senza farvi inchiodare dai presidi.`};
      else if(vaultOpen()) progressEvent={title:'TECA APERTA',text:`La cifratura è caduta: la valigetta in ${roomLabel(game.vaultRoom)} è prelevabile.`};
    }
    else if(game.missionId==='nucleo'){
      if(game.purged) progressEvent={title:'PURGA LANCIATA',text:`Ogni unità Helix vi dà la caccia. Sparite da ${roomLabel(game.dropRoom)} prima che sia troppo tardi.`};
      else if(vaultOpen()) progressEvent={title:'NUCLEO APERTO',text:`Il firewall è caduto: lanciate la PURGA dal nucleo in ${roomLabel(game.vaultRoom)}.`};
    }
    else if(game.missionId==='assedio'){
      if(game.download.done) progressEvent={title:'TRASFERIMENTO COMPLETO',text:`Ogni unità Helix vi dà la caccia. Sparite da ${roomLabel(game.dropRoom)} prima che sia troppo tardi.`};
      else if(game.download.progress>0) progressEvent={title:'DOWNLOAD IN CORSO',text:`Trasferimento a ${game.download.progress}/${game.download.required}: resistete in ${roomLabel(game.vaultRoom)} e continuate a SCARICARE.`};
      else if(vaultOpen()) progressEvent={title:'SORGENTE APERTA',text:`La cifratura è caduta: agganciate il collegamento in ${roomLabel(game.vaultRoom)} con SCARICA.`};
    }
    else if(game.missionId==='ostaggio'){
      if(game.hostage.delivered) progressEvent={title:'ESTRAZIONE APERTA',text:`Portate ogni operativo vivo in ${roomLabel(game.dropRoom)} per chiudere l’operazione.`};
      else if(game.hostage.holder) progressEvent={title:'SOTTO SCORTA',text:`L’informatore ha ${game.hostage.hp}/${game.hostage.maxHp} HP: non lasciatelo mai solo finché non è in ${roomLabel(game.dropRoom)}.`};
      else if(game.hostage.freed) progressEvent={title:'INFORMATORE ABBANDONATO',text:`L’informatore è solo in ${roomLabel(hostageRoomNow())}: tornate a scortarlo prima che sia troppo tardi.`};
      else if(vaultOpen()) progressEvent={title:'CELLA APERTA',text:`La cifratura è caduta: l’informatore in ${roomLabel(game.vaultRoom)} può essere liberato.`};
    }
    else if(game.missionId==='reattore'){
      if(game.reactor.exploded) progressEvent={title:'REATTORE DETONATO',text:`Ogni unità Helix vi dà la caccia. Sparite da ${roomLabel(game.dropRoom)} prima che sia troppo tardi.`};
      else if(game.reactor.armed) progressEvent={title:'CARICA INNESCATA',text:`Restano ${game.reactor.fuse} turni: allontanatevi dal raggio del reattore in ${roomLabel(game.vaultRoom)} prima che detoni.`};
      else if(vaultOpen()) progressEvent={title:'ACCESSO APERTO',text:`La cifratura è caduta: raggiungete il reattore in ${roomLabel(game.vaultRoom)} e innescate la carica con INNESCO.`};
    }
    else if(game.missionId==='spettro'){
      const s=game.specter;
      if(s.captured) progressEvent={title:'SPETTRO IN GABBIA',text:`Ogni unità Helix vi dà la caccia. Sparite da ${roomLabel(game.dropRoom)} prima che sia troppo tardi.`};
      else if(s.awake){
        const left=specterExits();
        progressEvent=left.length
          ?{title:'CACCIA APERTA',text:`SPETTRO è in ${roomLabel(s.room)} con ${left.length} ${left.length===1?'via':'vie'} di fuga (${left.join(' · ')}). Sigillate o presidiate, poi CATTURA.`}
          :{title:'SPETTRO BRACCATO',text:`SPETTRO è in trappola in ${roomLabel(s.room)}: entrate e usate CATTURA prima che forzi una porta.`};
      }
    }
    if(alarmSpawnEvent) game.event=alarmSpawnEvent;
    else if(progressEvent) game.event=progressEvent;
    else if(game.lockdown) game.event={title:'LOCKDOWN',text:`Allarme al ${game.alarm}%: ogni presidio è allertato e si muove verso di voi.`};
    else game.event={title:'PRESSIONE HELIX',text:`Allarme ${game.alarm}%. Nodi ${game.breach}/${game.nodeRooms.length}, ne servono ${game.nodesRequired}.`};
  }
  game.updatedAt=Date.now();
}

// Chiusura del round: è solo un contatore e l'azzeramento degli slot di turno. Nessuna regola di
// gioco scatta qui (vedi `resolveTurnEnd`).
function closeRound() {
  game.round+=1;
  game.players.forEach((p)=>{p.actions=[];p.move=null;p.maneuverCount=0;p.turnDone=false;});
  game.updatedAt=Date.now();
}

// Dopo la chiusura del round: se la partita è ancora aperta, si riparte dal primo operativo
// dell'ordine di turno (sempre lo stesso giro, in cerchio).
function startNextRound(){
  if(game.phase!=='active') return;
  game.players.forEach((p)=>{p.turnDone=false;});
  const first=game.players.find((p)=>p.id===game.turnOrder?.[0])||game.players[0];
  if(first){
    handTurnTo(first);
    if(!alive(first)){
      log(`${first.name} salta il turno: è fuori combattimento.`,'system');
      advanceTurn();
      return;
    }
  }
  game.updatedAt=Date.now();
}

// Passa la mano a un operativo. Chi è a terra viene gestito da `advanceTurn`: il suo turno viene
// chiuso subito, così resta davvero fuori combattimento per un turno senza bloccare la partita.
function handTurnTo(p){
  game.activePlayerId=p.id;
  p.turnStartedDown=!alive(p);
  p.actions=[];p.move=null;p.maneuverCount=0;p.attackedThisTurn=false;p.killingBlowUsed=false;
}

// A TERRA PER TRE TURNI PROPRI: chi va a terra salta AUTO_RISE_SKIPPED_TURNS dei propri turni e
// poi si rialza da solo a AUTO_RISE_HP nella stanza dove è caduto, purché almeno un compagno sia
// ancora in piedi. Il contatore non usa i turni altrui: equivale a tre round completi.
// Il prezzo di cadere è l'allarme (`knockDown`), l'integrità bassa e il carico perso; se tutti gli
// operativi sono a terra prima del rialzo, la squadra è sterminata.
// Un compagno può rialzarlo prima e meglio (RIPRISTINO 25%, Protocollo Lazarus 40%).
// Turni propri che mancano al rialzo automatico: null se in piedi, -1 se non si rialza da solo
// (rischio ALTO/BRUTALE). Serve solo alla plancia per il contatore sulla pedina a terra.
function riseIn(p){
  if(alive(p)) return null;
  if(!riskOf().autoRise) return -1;
  const need=hasPassive(p,'quick-rebound')?QUICK_REBOUND_SKIPPED_TURNS:AUTO_RISE_SKIPPED_TURNS;
  return Math.max(1,need-(p.downTurnsSkipped||0));
}

function riseFromKnockdown(p){
  p.hp=hasPassive(p,'quick-rebound')?Math.max(AUTO_RISE_HP,Math.round(p.maxHp*QUICK_REBOUND_RATIO)):AUTO_RISE_HP;
  p.downAt=null;
  p.downTurnsSkipped=0;
  hit(p.id,p.hp,'heal',p.room,3);
  emit('rise',{playerId:p.id,room:p.room,hp:p.hp});
  log(`${p.name} si rialza da solo in ${roomLabel(p.room)}: ${p.hp}/${p.maxHp} integrità.`,'system');
}

// Pressione dell'allarme: +ALARM_PER_TURN ad ogni turno operativo che si chiude, giocato o
// saltato che sia.
function bumpAlarmForTurn(){
  game.alarm=Math.min(100,game.alarm+ALARM_PER_TURN);
}

// Il focus si ricarica alla chiusura del turno personale di ciascun operativo (non a fine
// round): +1, +2 con Uplink costante.
function regenFocusForTurn(p){
  p.focus=Math.min(p.maxFocus,p.focus+(hasPassive(p,'constant-uplink')?2:1));
}

// Fa avanzare il turno all'operativo successivo nell'ordine fisso. Ogni turno chiuso fa
// girare la torre (`resolveTurnEnd`); quando il giro è completo si chiude il round e si riparte dal
// primo. Usata dagli operativi (FINE TURNO) e dalla plancia (SALTA TURNO / CHIUDI ROUND).
function advanceTurn(){
  if(!game||game.phase!=='active') return;
  const order=game.turnOrder||game.players.map((p)=>p.id);
  const curIdx=order.indexOf(game.activePlayerId);
  const cur=game.players.find((p)=>p.id===game.activePlayerId);
  const skippedWhileDown=Boolean(cur?.turnStartedDown&&!alive(cur));
  // Senza traccia: chi ha giocato il turno senza attaccare non fa salire l'allarme.
  const silent=Boolean(cur&&!skippedWhileDown&&hasPassive(cur,'silent-step')&&!cur.attackedThisTurn);
  if(cur){ cur.turnDone=true; if(!silent) bumpAlarmForTurn(); regenFocusForTurn(cur); }
  if(silent) log(`${cur.name} chiude il turno senza lasciare traccia: l'allarme non sale.`,'system');
  game.turn=(game.turn||0)+1;
  let justRose=false;
  if(skippedWhileDown&&riskOf().autoRise){
    cur.downTurnsSkipped=(cur.downTurnsSkipped||0)+1;
    if(cur.downTurnsSkipped>=(hasPassive(cur,'quick-rebound')?QUICK_REBOUND_SKIPPED_TURNS:AUTO_RISE_SKIPPED_TURNS)){ riseFromKnockdown(cur); justRose=true; }
  }
  if(!game.players.some(alive)){
    game.phase='defeat';
    log('Squadra sterminata: non resta nessun operativo in piedi.','danger');
    game.updatedAt=Date.now();
    return;
  }
  stepEngagedEnemies();
  resolveTurnEnd();
  if(game.phase!=='active') return;
  // Chi si è appena rialzato da solo riprende subito il proprio turno, invece di dover
  // attendere un altro giro completo a mani vuote.
  if(justRose){
    handTurnTo(cur);
    game.updatedAt=Date.now();
    return;
  }
  for(let i=curIdx+1;i<order.length;i++){
    const np=game.players.find((x)=>x.id===order[i]);
    if(np){
      handTurnTo(np);
      if(!alive(np)){
        log(`${np.name} salta il turno: è fuori combattimento.`,'system');
        advanceTurn();
        return;
      }
      game.updatedAt=Date.now();
      return;
    }
  }
  // Giro completo: si chiude il round e si riparte dal primo.
  closeRound();
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
// Gli indirizzi cambiano solo se cambia la rete: `/api/state` viene chiesto ~9 volte al secondo
// (un poll ogni 800ms per plancia e telefoni) e ogni chiamata a networkInterfaces() alloca
// l'intera tabella delle interfacce. Si ricalcola al massimo una volta ogni NETWORK_TTL.
const NETWORK_TTL = 20000;
let networkCache = null;
let networkCachedAt = 0;
function networkUrls(){
  const now = Date.now();
  if (!networkCache || now - networkCachedAt > NETWORK_TTL) { networkCache = networkCandidates(); networkCachedAt = now; }
  return networkCache;
}
function getNetworkUrl(){ return networkUrls()[0] || `http://localhost:${PORT}`; }

async function jsonBody(req){let raw='';for await(const chunk of req)raw+=chunk;if(!raw)return {};try{return JSON.parse(raw);}catch{throw Object.assign(new Error('JSON non valido'),{status:400});}}
function send(res,status,payload){sendRaw(res,status,JSON.stringify(payload));}
function sendRaw(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);}
// Parte fissa di /api/state, serializzata una volta sola al primo poll.
let staticState = null;
function staticStatePayload(){
  if (staticState === null) staticState = `"templates":${JSON.stringify(templates)},"enemyRoster":${JSON.stringify(ENEMY_ROSTER)},"missions":${JSON.stringify(missionList())},"riskLevels":${JSON.stringify(riskLevelList())}`;
  return staticState;
}
// Le sessioni create prima dell'introduzione del token restano utilizzabili fino alla loro
// chiusura, evitando di bloccare una partita già in corso dopo un aggiornamento. Ogni nuovo
// canale, invece, richiede sempre il token della plancia per le mutazioni amministrative.
function controlsGame(body){
  if(!game?.controllerToken)return true;
  return typeof body?.controllerToken==='string'&&body.controllerToken===game.controllerToken;
}
function isLocalBoard(req){
  const address=req.socket.remoteAddress||'';
  return address==='::1'||address==='127.0.0.1'||address==='::ffff:127.0.0.1';
}

async function api(req,res,url){
  try{
    if(req.method==='GET'&&url.pathname==='/api/state'){
      // La metà statica della risposta (schede, database nemici, missioni coi loro testi) non
      // cambia mai durante la partita: si serializza una volta sola invece che a ogni poll, e
      // con `?lean=1` non viene proprio rispedita — il client la chiede una volta e la tiene.
      // Sono ~13 KB dei ~19 KB di ogni risposta, moltiplicati per un poll ogni 800ms per
      // dispositivo collegato.
      const lean=url.searchParams.get('lean')==='1';
      const statics=lean?'':`${staticStatePayload()},`;
      return sendRaw(res,200,`{"game":${JSON.stringify(publicGame())},${statics}"networkUrl":${JSON.stringify(getNetworkUrl())},"networkUrls":${JSON.stringify(networkUrls())}}`);
    }
    // Livello d'allarme in testo semplice (0-100), o -1 se nessuna partita: lo legge il ponte seriale dell'Arduino.
    if(req.method==='GET'&&url.pathname==='/api/alarm'){
      res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
      return res.end(String(game?Math.round(game.alarm):-1));
    }
    // Recupera il controllo dalla plancia locale. Il token vive nel localStorage del browser:
    // può quindi mancare dopo un cambio di porta/origine, la pulizia dei dati del browser o una
    // nuova installazione della plancia. Solo la macchina che ospita il server può leggerlo o
    // crearne uno; i telefoni sulla LAN non ricevono mai il segreto.
    if(req.method==='POST'&&url.pathname==='/api/claim-controller'){
      if(!game)return send(res,404,{error:'Nessuna partita da reclamare.'});
      if(!isLocalBoard(req))return send(res,403,{error:'Il controllo può essere reclamato solo dalla plancia locale.'});
      if(!game.controllerToken){
        game.controllerToken=randomUUID();
        await save();
      }
      return send(res,200,{controllerToken:game.controllerToken});
    }
    if(req.method==='POST'&&url.pathname==='/api/setup'){
      const body=await jsonBody(req);
      if(!MISSIONS[body.missionId])return send(res,400,{error:'Missione non valida.'});
      if(body.riskLevel!==undefined&&!RISK_LEVELS[body.riskLevel])return send(res,400,{error:'Livello di rischio non valido.'});
      if(game&&!controlsGame(body))return send(res,403,{error:'Comando riservato alla plancia che ha creato il canale.'});
      // La plancia crea il canale VUOTO: sceglie missione, rischio e tetto di posti (2–6). Gli
      // operativi entrano poi dai telefoni scegliendo la scheda in `/api/join`.
      game=createGame({missionId:body.missionId,maxPlayers:body.maxPlayers,riskLevel:body.riskLevel});await save();
      return send(res,200,{game:publicGame(),networkUrl:getNetworkUrl(),controllerToken:game.controllerToken});
    }
    if(req.method==='POST'&&url.pathname==='/api/join'){
      const body=await jsonBody(req);if(!game||body.code?.toUpperCase()!==game.code)return send(res,404,{error:'Codice partita non valido.'});
      const template=templates.find((t)=>t.id===body.characterId);if(!template)return send(res,400,{error:'Scheda operativo non valida.'});
      const mine=game.players.find((x)=>x.deviceId===body.deviceId);
      const holder=game.players.find((x)=>x.characterId===body.characterId);
      // Fuori dalla lobby si può riconnettersi al proprio posto, riprendere una scheda lasciata
      // libera da un telefono caduto, oppure occupare un posto mai preso prima di AVVIA (se c'è
      // ancora spazio sotto maxPlayers): niente cambio scheda a partita in corso se qualcun altro
      // la tiene già collegata.
      if(game.phase!=='lobby'){
        let seat=mine||(holder&&!connected(holder)?holder:null);
        if(!seat){
          if(holder)return send(res,409,{error:'Scheda già scelta da un altro operativo.'});
          if(game.phase!=='active'||game.players.length>=(game.maxPlayers||6))return send(res,409,{error:'Operazione già avviata: impossibile aggiungere operativi.'});
          seat=newPlayer(`p${++game.seq}`,template,body.name,game.startRoom);
          game.players.push(seat);
          game.turnOrder=[...(game.turnOrder||game.players.map((p)=>p.id)),seat.id];
        }
        seat.deviceId=body.deviceId;seat.lastSeen=Date.now();
        await save();return send(res,200,{game:publicGame(),playerId:seat.id});
      }
      // Scheda già presa da un altro telefono ancora collegato: no. Se il telefono che la teneva
      // è caduto, il posto si può riprendere (lo si rimuove e se ne crea uno nuovo pulito).
      if(holder&&holder!==mine){
        if(connected(holder))return send(res,409,{error:'Scheda già scelta da un altro operativo.'});
        game.players=game.players.filter((x)=>x!==holder);
      }
      let seat;
      if(mine){
        // Il telefono aveva già un posto: aggiorna nome e scheda sul posto esistente (stesso id).
        seat=newPlayer(mine.id,template,body.name,game.startRoom);
        seat.deviceId=body.deviceId;seat.lastSeen=Date.now();
        game.players=game.players.map((x)=>x.id===mine.id?seat:x);
      }else{
        if(game.players.length>=(game.maxPlayers||6))return send(res,409,{error:'Squadra al completo.'});
        seat=newPlayer(`p${++game.seq}`,template,body.name,game.startRoom);
        seat.deviceId=body.deviceId;seat.lastSeen=Date.now();
        game.players.push(seat);
      }
      game.turnOrder=game.players.map((x)=>x.id);
      if(!game.players.some((x)=>x.id===game.activePlayerId))game.activePlayerId=game.players[0]?.id||null;
      log(`${seat.name} entra come ${seat.role}.`,'success');
      await save();return send(res,200,{game:publicGame(),playerId:seat.id});
    }
    if(req.method==='POST'&&url.pathname==='/api/ping'){
      const body=await jsonBody(req);const p=game?.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);
      if(!p)return send(res,404,{error:'Sessione non trovata.'});
      p.lastSeen=Date.now();
      return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/start'){
      const body=await jsonBody(req);if(!game||body.code!==game.code)return send(res,404,{error:'Partita non trovata.'});
      if(!controlsGame(body))return send(res,403,{error:'Comando riservato alla plancia che ha creato il canale.'});
      if(game.phase!=='lobby')return send(res,409,{error:'Operazione già avviata.'});
      // Squadra ora nota: presidio nemico e scaling di forza si calcolano adesso.
      if(!game.enemies?.length)buildSquadEnemies(game);
      // Si può avviare anche senza tutti i telefoni collegati (o senza nessuno) per ispezionare
      // plancia/mappa: il turno resta fermo sull'operativo di mano finché il suo telefono non gioca
      // (o la plancia salta).
      game.phase='active';
      game.turnOrder=game.players.map((p)=>p.id);
      game.activePlayerId=(game.players.find((p)=>alive(p))||game.players[0])?.id||null;
      game.players.forEach((p)=>{p.actions=[];p.move=null;p.maneuverCount=0;p.turnDone=false;});
      log(game.narrative.opening,'combat');await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/action'){
      const body=await jsonBody(req);if(!game||body.code!==game.code||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const p=game.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);if(!p||!alive(p))return send(res,403,{error:'Accesso operativo negato.'});
      if(game.activePlayerId!==p.id)return send(res,409,{error:'Non è il tuo turno.'});
      const allowed=['move','attack','hack','heal','ability','grab','purge','free','unlock','reload','download','arm','seal','capture','camera','chest'];if(!allowed.includes(body.type))return send(res,400,{error:'Azione non valida.'});
      // MANOVRA: una stanza alla volta e consuma una delle ACTIONS_PER_TURN azioni, quindi si può
      // ripetere e alternare con le altre azioni. Piede sull'acceleratore rende gratis la prima del turno.
      // Si risolve subito: l'operativo si sposta davvero e gli ostili della stanza lo seguono.
      if(body.type==='move'){
        const freeMove=hasPassive(p,'accelerator')&&(p.maneuverCount||0)<1;
        if(!freeMove&&p.actions.length>=ACTIONS_PER_TURN)return send(res,409,{error:`Hai già usato le ${ACTIONS_PER_TURN} azioni di questo turno.`});
        const moveDist=openDistanceMap(p.room)[body.roomId];
        if(moveDist===undefined||moveDist<1||moveDist>MOVE_MAX_DISTANCE)return send(res,400,{error:`Puoi puntare solo una stanza raggiungibile entro ${MOVE_MAX_DISTANCE} porte aperte.`});
        p.move={roomId:body.roomId};p.maneuverCount=(p.maneuverCount||0)+1;p.lastSeen=Date.now();
        if(!freeMove)p.actions.push({type:'move',targetId:null,roomId:body.roomId});
        applyMove(p);
        checkBlackout();
        await save();return send(res,200,{game:publicGame()});
      }
      const freeUnlock=body.type==='unlock'&&hasPassive(p,'master-lockpick');
      if(!freeUnlock&&p.actions.length>=ACTIONS_PER_TURN)return send(res,409,{error:`Hai già usato le ${ACTIONS_PER_TURN} azioni di questo turno.`});
      // Le manovre fatte sono già risolte: l'azione ha effetto nella stanza attuale.
      const actRoom=p.room;
      if(body.type==='ability'&&p.focus<3)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='hack'&&p.focus<2)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='unlock'&&p.focus<1)return send(res,400,{error:'Focus insufficiente.'});
      // Con CECCHINO il tiro arriva anche nella stanza accanto (porta aperta), altrimenti solo qui.
      if(body.type==='attack'&&!shootableEnemies(p).length)return send(res,400,{error:hasMod(p,'sniper')?'Nessun ostile a tiro da questa stanza.':'Nessun ostile nella tua stanza.'});
      if(body.type==='attack'&&p.mag<=0)return send(res,400,{error:'Caricatore vuoto: usa RICARICA.'});
      if(body.type==='reload'&&p.mag>=p.maxMag)return send(res,400,{error:'Caricatore già pieno.'});
      if(body.type==='hack'&&!roomById(actRoom).node)return send(res,400,{error:'Nessun terminale in questa stanza.'});
      if(body.type==='hack'&&game.nodes[actRoom])return send(res,400,{error:'Il nodo di questa stanza è già violato.'});
      if(body.type==='grab'&&(game.missionId!=='valigetta'||game.caseDelivered))return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='grab'&&game.caseHolder)return send(res,400,{error:'La valigetta è già in mano a un compagno.'});
      if(body.type==='grab'&&caseRoomNow()!==actRoom)return send(res,400,{error:'La valigetta non è in questa stanza.'});
      if(body.type==='grab'&&actRoom===game.vaultRoom&&!vaultOpen())return send(res,400,{error:`Teca sigillata: violate ${game.nodesRequired} nodi.`});
      if(body.type==='purge'&&game.missionId!=='nucleo')return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='purge'&&actRoom!==game.vaultRoom)return send(res,400,{error:'Devi essere nel nucleo dati.'});
      if(body.type==='purge'&&!vaultOpen())return send(res,400,{error:`Firewall attivo: violate ${game.nodesRequired} nodi.`});
      if(body.type==='purge'&&game.purged)return send(res,400,{error:'Il nucleo è già stato purgato.'});
      if(body.type==='download'&&game.missionId!=='assedio')return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='download'&&actRoom!==game.vaultRoom)return send(res,400,{error:'Devi essere sulla sorgente dati.'});
      if(body.type==='download'&&!vaultOpen())return send(res,400,{error:`Sorgente sigillata: violate ${game.nodesRequired} nodi.`});
      if(body.type==='download'&&game.download.done)return send(res,400,{error:'Il trasferimento è già completo.'});
      if(body.type==='free'&&game.missionId!=='ostaggio')return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='free'&&game.hostage.delivered)return send(res,400,{error:'L’informatore è già stato consegnato.'});
      if(body.type==='free'&&game.hostage.holder)return send(res,400,{error:'L’informatore è già scortato da un compagno.'});
      if(body.type==='free'&&hostageRoomNow()!==actRoom)return send(res,400,{error:'L’informatore non è in questa stanza.'});
      if(body.type==='free'&&!game.hostage.freed&&actRoom===game.vaultRoom&&!vaultOpen())return send(res,400,{error:`Cella sigillata: violate ${game.nodesRequired} nodi.`});
      if(body.type==='arm'&&game.missionId!=='reattore')return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='arm'&&actRoom!==game.vaultRoom)return send(res,400,{error:'Devi essere sul reattore.'});
      if(body.type==='arm'&&!vaultOpen())return send(res,400,{error:`Accesso sigillato: violate ${game.nodesRequired} nodi.`});
      if(body.type==='arm'&&game.reactor.armed)return send(res,400,{error:'La carica è già innescata.'});
      if((body.type==='seal'||body.type==='capture')&&game.missionId!=='spettro')return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='seal'&&p.focus<SEAL_FOCUS)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='seal'&&!roomById(actRoom).links.includes(body.roomId))return send(res,400,{error:'Nessuna porta verso quella stanza.'});
      if(body.type==='seal'&&doorClosed(actRoom,body.roomId))return send(res,400,{error:'Quella porta è già chiusa.'});
      if(body.type==='capture'&&game.specter.captured)return send(res,400,{error:'SPETTRO è già in gabbia.'});
      if(body.type==='capture'&&!game.specter.awake)return send(res,400,{error:`SPETTRO dorme ancora: violate ${game.nodesRequired} nodi.`});
      if(body.type==='capture'&&game.specter.room!==actRoom)return send(res,400,{error:'SPETTRO non è nella tua stanza.'});
      if(body.type==='capture'&&!specterCornered())return send(res,400,{error:`SPETTRO ha ancora vie di fuga: ${specterExits().join(' · ')}.`});
      if(body.type==='camera'&&!game.cameras.includes(actRoom))return send(res,400,{error:'Nessuna telecamera attiva in questa stanza.'});
      if(body.type==='chest'&&!game.chests?.some((c)=>c.room===actRoom))return send(res,400,{error:'Nessuna cassa in questa stanza.'});
      if(body.type==='chest'&&!game.chests?.some((c)=>c.room===actRoom&&c.uses>0))return send(res,400,{error:'Questa cassa è già stata svuotata.'});
      if(body.type==='chest'&&enemiesIn(actRoom).length)return send(res,400,{error:'Ostili nella stanza: ripulisci prima di aprire la cassa.'});
      if(body.type==='chest'&&p.mods?.length)return send(res,400,{error:`Hai già una modifica (${modById(p.mods[0])?.name||'—'}): una a testa.`});
      if(body.type==='unlock'&&!roomById(actRoom).links.includes(body.roomId))return send(res,400,{error:'Nessuna porta verso quella stanza.'});
      if(body.type==='unlock'&&!doorClosed(actRoom,body.roomId))return send(res,400,{error:'Quella porta è già aperta.'});
      const action={type:body.type,targetId:body.targetId||null,roomId:body.roomId||null};
      if(!freeUnlock)p.actions.push(action);p.lastSeen=Date.now();
      if(body.type==='attack'||body.type==='ability') p.attackedThisTurn=true;
      const aliveBefore=game.enemies.filter(alive).length;
      applyAction(p,action);
      // Colpo di grazia: la prima eliminazione del turno restituisce l'azione appena spesa.
      if(hasPassive(p,'killing-blow')&&!p.killingBlowUsed&&!freeUnlock&&game.enemies.filter(alive).length<aliveBefore){
        p.killingBlowUsed=true;
        p.actions.pop();
        log(`${p.name}: colpo di grazia — recupera l'azione.`,'combat');
      }
      checkBlackout();
      await save();return send(res,200,{game:publicGame()});
    }
    // FINE TURNO: l'operativo di mano chiude il suo turno e passa la mano.
    if(req.method==='POST'&&url.pathname==='/api/endturn'){
      const body=await jsonBody(req);if(!game||body.code!==game.code||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const p=game.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);if(!p)return send(res,403,{error:'Accesso operativo negato.'});
      if(game.activePlayerId!==p.id)return send(res,409,{error:'Non è il tuo turno.'});
      p.lastSeen=Date.now();log(`${p.name} chiude il turno.`,'system');
      beginTower();
      enemyStrike(p);
      advanceTurn();
      endTower();
      await save();return send(res,200,{game:publicGame()});
    }
    // SALTA TURNO dalla plancia: salta l'operativo di mano (telefono offline o assente).
    if(req.method==='POST'&&url.pathname==='/api/skipturn'){
      const body=await jsonBody(req);if(!game||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      if(!controlsGame(body))return send(res,403,{error:'Comando riservato alla plancia che ha creato il canale.'});
      const skipped=game.players.find((x)=>x.id===game.activePlayerId);
      if(skipped) log(`${skipped.name}: turno saltato dalla plancia.`,'system');
      beginTower();
      if(skipped) enemyStrike(skipped);
      advanceTurn();
      endTower();
      await save();return send(res,200,{game:publicGame()});
    }
    // CHIUDI ROUND dalla plancia: gli operativi che non hanno ancora giocato perdono il turno, uno
    // alla volta come con SALTA TURNO (ogni turno saltato fa girare la torre), fino al round nuovo.
    if(req.method==='POST'&&url.pathname==='/api/resolve'){
      const body=await jsonBody(req);if(!game||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      if(!controlsGame(body))return send(res,403,{error:'Comando riservato alla plancia che ha creato il canale.'});
      const round=game.round;
      beginTower();
      for(let guard=0;game.phase==='active'&&game.round===round&&guard<=game.players.length;guard++){
        const skipped=game.players.find((x)=>x.id===game.activePlayerId);
        if(skipped&&alive(skipped)){ log(`${skipped.name}: turno perso (round chiuso dalla plancia).`,'system'); enemyStrike(skipped); }
        advanceTurn();
      }
      endTower();
      await save();return send(res,200,{game:publicGame()});
    }
    // CHEAT (solo plancia, solo partita in corso): menu nascosto dietro una combinazione di tasti.
    if(req.method==='POST'&&url.pathname==='/api/cheat'){
      const body=await jsonBody(req);if(!game||body.code!==game.code||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      if(!controlsGame(body))return send(res,403,{error:'Comando riservato alla plancia che ha creato il canale.'});
      if(!game.cheats)game.cheats={};
      switch(body.cheat){
        case 'reveal':
          for(const r of game.map) if(!game.visited.includes(r.id)) game.visited.push(r.id);
          log('CHEAT: mappa rivelata.','system');break;
        case 'openDoors':case 'closeDoors':{
          const closed=body.cheat==='closeDoors';
          for(const r of game.map) for(const l of r.links) game.doors[doorKey(r.id,l)]=closed;
          log(closed?'CHEAT: tutte le porte chiuse.':'CHEAT: tutte le porte aperte.','system');break;
        }
        case 'spawnEnemy':{
          const kind=ENEMY_ROSTER[Math.floor(Math.random()*ENEMY_ROSTER.length)].key;
          const free=game.map.filter((r)=>!r.start&&!enemiesIn(r.id).length);
          const pool=free.length?free:game.map;
          const room=pool[Math.floor(Math.random()*pool.length)];
          const idx=Math.max(0,...game.enemies.filter((e)=>e.id.startsWith(`${kind}-`)).map((e)=>Number(e.id.slice(kind.length+1))||0))+1;
          const unit=spawnEnemy(kind,room.id,idx,game.hpScale||1,game.dmgScale||1);
          game.enemies.push(unit);
          emit('spawn',{enemyId:unit.id,room:room.id});
          log(`CHEAT: ${unit.name} compare in ${roomLabel(room.id)}.`,'danger');break;
        }
        case 'alarmZero':
          game.alarm=0;
          log('CHEAT: allarme azzerato.','system');break;
        case 'killEnemies':{
          const targets=game.enemies.filter(alive);
          for(const e of targets){const before=e.hp;e.hp=0;hit(e.id,before,'damage',e.room,3);}
          log(`CHEAT: ${targets.length} nemici eliminati.`,'system');break;
        }
        case 'immortal':{
          game.cheats.immortal=!game.cheats.immortal;
          if(game.cheats.immortal) for(const pl of game.players){
            if(pl.hp>=pl.maxHp) continue;
            const gain=pl.maxHp-pl.hp;pl.hp=pl.maxHp;pl.downAt=null;pl.downTurnsSkipped=0;
            hit(pl.id,gain,'heal',pl.room,3);
          }
          log(`CHEAT: immortalità ${game.cheats.immortal?'attiva':'disattivata'}.`,'system');break;
        }
        default:return send(res,400,{error:'Cheat sconosciuto.'});
      }
      game.updatedAt=Date.now();
      await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/reset'){
      const body=await jsonBody(req);
      if(!controlsGame(body))return send(res,403,{error:'Comando riservato alla plancia che ha creato il canale.'});
      game=null;await save();return send(res,200,{ok:true});
    }
    return send(res,404,{error:'Endpoint non trovato.'});
  }catch(error){
    if(error.status===400)return send(res,400,{error:'Richiesta non valida.'});
    console.error(error);return send(res,500,{error:'Errore del sistema di gioco.'});
  }
}

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json','.webmanifest':'application/manifest+json','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.woff2':'font/woff2'};

// Il manifest è generato per richiesta (non un file statico) perché la PWA installata deve
// riaprirsi nella stessa modalità da cui è stata aggiunta alla home: iOS la lancia sullo
// start_url del manifest, che con un manifest unico era "/" (= plancia). Lo start_url usa un path
// dedicato (/player, /alarm, /database), letto anche da `App.tsx` (currentMode).
// Il link al manifest giusto è scritto dal server direttamente nell'HTML (withManifest) e non da
// uno script client: Safari può leggere il <link rel="manifest"> prima che uno script lo cambi.
const MANIFEST_TITLES={player:['Roverpunk // Telefono','Roverpunk'],alarm:['Roverpunk // Allarme','Allarme'],database:['Roverpunk // Database','Database']};
function pageMode(url){
  const path=url.pathname.replace(/^\/+|\/+$/g,'');
  if(MANIFEST_TITLES[path])return path;
  const mode=url.searchParams.get('mode');
  return MANIFEST_TITLES[mode]?mode:null;
}
// Pagine HTML dell'app: la plancia e le modalità con path dedicato.
function isAppPage(url){
  const path=url.pathname.replace(/^\/+|\/+$/g,'');
  return path===''||path==='index.html'||Boolean(MANIFEST_TITLES[path]);
}
function withManifest(html,url){
  const mode=pageMode(url);
  return mode?html.replace(/(<link rel="manifest" href=")\/manifest\.webmanifest"/,`$1/manifest.webmanifest?mode=${mode}"`):html;
}
function buildManifest(url){
  const mode=url.searchParams.get('mode');
  const [name,shortName]=MANIFEST_TITLES[mode]||['Roverpunk // Protocollo Blackout','Roverpunk'];
  const startUrl=MANIFEST_TITLES[mode]?`/${mode}`:'/';
  return{
    name,short_name:shortName,
    description:'Gioco cooperativo LAN: una plancia piu 2-6 telefoni.',
    id:startUrl,
    start_url:startUrl,
    scope:'/',display:'standalone',orientation:'any',
    background_color:'#050909',theme_color:'#050909',
    icons:[
      {src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
      {src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
      {src:'/icons/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
    ],
  };
}

// Avvio del server. Racchiuso in una funzione (e non più eseguito all'import) così `server.mjs`
// può essere importato come libreria del motore da uno script headless senza far partire HTTP/Vite
// né leggere il file di stato. Gira solo quando `server.mjs` è lanciato direttamente (`npm run dev`).
async function main(){
  await loadPersistedGame();
  let vite;
  if(process.env.NODE_ENV!=='production'){
    const {createServer:createVite}=await import('vite');
    // HMR disattivato: il suo WebSocket gira su una porta separata non raggiungibile dai
    // telefoni sulla rete locale e riempirebbe ogni console di errori di riconnessione.
    vite=await createVite({server:{middlewareMode:true,hmr:false},appType:'spa'});
  }
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(url.pathname.startsWith('/api/'))return api(req,res,url);
    if(url.pathname==='/manifest.webmanifest'){
      res.writeHead(200,{'Content-Type':'application/manifest+json','Cache-Control':'no-store'});
      res.end(JSON.stringify(buildManifest(url)));
      return;
    }
    if(vite){
      if(req.method==='GET'&&isAppPage(url)){
        try{
          const html=await vite.transformIndexHtml(url.pathname+url.search,withManifest(await readFile(join(process.cwd(),'index.html'),'utf8'),url));
          res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(html);
          return;
        }catch(error){console.error(error);}
      }
      return vite.middlewares(req,res,()=>{});
    }
    try{
      const requested=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'');
      let filePath=join(APP_ROOT,'dist',requested);
      if(!existsSync(filePath))filePath=join(APP_ROOT,'dist','index.html');
      const data=await readFile(filePath);
      const isHtml=extname(filePath)==='.html';
      res.writeHead(200,{'Content-Type':mime[extname(filePath)]||'application/octet-stream',...(isHtml?{'Cache-Control':'no-store'}:{})});
      res.end(isHtml?withManifest(data.toString('utf8'),url):data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  server.listen(PORT,'0.0.0.0',()=>{
    console.log(`\nROVERPUNK operativo:`);
    console.log(`  Plancia:  http://localhost:${PORT}`);
    for(const candidate of networkCandidates()) console.log(`  Telefoni: ${candidate}/player`);
    console.log('');
  });
}

// Superficie importabile dal simulatore headless (scripts/simulate.mjs): il motore puro, senza
// HTTP. `__setGame`/`__getGame` danno accesso allo stato-modulo `game` su cui operano tutte le
// funzioni del motore. NON usarli dal codice del server.
export { main, MISSIONS, missionTuning, createGame, applyMove, applyAction, enemyStrike, advanceTurn, resolveTurnEnd, closeRound, startNextRound, checkBlackout, alive, beginTower, endTower };
export const __setGame=(g)=>{ game=g; };
export const __getGame=()=>game;

const runDirect=process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href;
if(runDirect) main();

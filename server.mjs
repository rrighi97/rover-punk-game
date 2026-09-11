import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { templates } from './characters.mjs';
import { ENEMY_ROSTER } from './enemies.mjs';

const PORT = Number(process.env.PORT || 5173);
const DATA_DIR = new URL('./data/', import.meta.url);
const DATA_FILE = new URL('./data/game-state.json', import.meta.url);
const DATA_TMP = new URL('./data/game-state.json.tmp', import.meta.url);

// Finestra entro cui un telefono è considerato collegato (3 ping persi).
const LINK_TIMEOUT = 15000;

// TARATURA UNICA
// Non esistono più livelli di minaccia selezionabili: ROVERPUNK ha una sola difficoltà,
// pensata per essere dura. Ogni costante qui sotto è una leva della pressione sulla squadra.
// Il round è a TURNI: ogni operativo gioca il suo turno singolarmente, nell'ordine fisso di
// `turnOrder` (sempre lo stesso, in cerchio, si riparte sempre dal primo). Quando tutti hanno
// finito rispondono gli Helix. Nessun timer: se un telefono è offline il suo turno lo salta
// la plancia con SALTA TURNO.
const ALARM_START = 20;            // allarme iniziale
// L'allarme ha una sola leva di salita: il respiro della torre, +4 a ogni round. Nessun
// picco secco (stacco carico, PURGA, Sovraccarico cromo, sganciamento) e nessuna pressione
// da contatto/zona esposta/carico. L'unica cosa che lo abbassa è l'Identità sintetica di ECHO.
const ALARM_PER_ROUND = 4;         // pressione base di ogni round
const ALARM_FACE_RELIEF = 5;       // Identità sintetica del FACE
const LOCKDOWN_ALARM = 80;         // oltre questa soglia la torre allerta ogni presidio: tutti convergono sui Player
const ENEMY_ROAM_ALARM = 85;      // sotto questa soglia gli ostili non si spostano a fine round: restano di presidio e colpiscono solo a fine turno
const ALARM_SPAWN_THRESHOLDS = [25, 35, 45, 55, 65, 75]; // a ogni soglia una nuova unità entra in una stanza a caso e parte a caccia
const NODES_REQUIRED = 2;          // nodi da violare per sbloccare la teca
const ACTIONS_PER_TURN = 3;        // azioni giocabili in un turno: ogni manovra ne consuma una
const REVIVE_RATIO = 0.25;
const HEAL_AMOUNT = 12;            // RIPRISTINO sul compagno più ferito — allineato a src/App.tsx
const HACK_DRONE_DAMAGE = 10;      // INTRUSIONE colpisce anche un drone nella stanza — allineato a src/App.tsx
const LAZARUS_RATIO = 0.4;

// TARATURA PER DIMENSIONE SQUADRA
// Il numero di nemici è sempre lo stesso: con la squadra crescono solo vita (`hp`) e danno (`dmg`)
// di ogni unità Helix, SEGUGI compresi. Una leva indipendente per fascia (2-6), perché ogni
// operativo in più è un giro di azioni in più. Valori tarati con simulazioni headless (bot, schede
// casuali). I valori crescono ancora con la squadra, ma più lentamente: ogni operativo in più
// aggiunge un turno d'azione completo e non deve tradursi in una crescita lineare della letalità.
// Il danno è la leva più sensibile: +0,1 sposta il winrate di circa 5-10 punti.
const SQUAD_SCALE = {
  2: { hp: 0.88, dmg: 1.04 },
  3: { hp: 1.30, dmg: 1.25 },
  4: { hp: 1.65, dmg: 1.55 },
  5: { hp: 1.95, dmg: 1.80 },
  6: { hp: 2.25, dmg: 2.00 },
};

// MISSIONE 03 // OSTAGGIO
const HOSTAGE_MAX_HP = 70;
const HOSTAGE_UNESCORTED_DAMAGE = 18; // danno subito se lasciato solo con ostili

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

// I presidi stanno dove c'è qualcosa da difendere: teca e nodi. Nessuno pattuglia l'ingresso.
// Se la missione dichiara `layout.garrison` (array di {kind, at, minSquad?}) si schiera quello,
// pescando le unità dal DATABASE NEMICI (ENEMY_ROSTER); altrimenti vale il presidio di default.
// Il NUMERO di presidi non cambia con la squadra: a crescere è solo la loro forza (`SQUAD_SCALE`).
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
// 16 nomi di stanza a tema e si incolla il `layout` stampato in output.
const mapNote = (vaultNoun, roomCount) => `Plancia fissa di questa missione: ${roomCount} stanze su una griglia, collegate solo da alcune porte — due stanze vicine possono non comunicare affatto. La mappa contiene la zona di partenza (S), tre nodi di rete (N), ${vaultNoun} dell’obiettivo e il punto di consegna (▼), lontani fra loro, ed è sempre la stessa a ogni partita. Lo schema qui sotto segna solo dove stanno questi elementi.`;

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
    mapNote: mapNote('la teca', 12),
    // TARATURA (simulatore bot, N=400/cella): enemyPower 0.93 + alarmStart 17 (era 20) per
    // portare winrate aggregato 2-6 e sconfitte-allarme dentro le fasce target del progetto
    // (52-72% win, 4-18% sconfitte-allarme): risultato 71% win, 19% sconfitte-allarme — la
    // squadra da 6 resta strutturalmente sopra il tetto (partite lunghe, ~34% sconfitte-allarme
    // lì) e tira su l'aggregato di qualche punto oltre il limite. Vedi `missionTuning` e
    // `npm run sim`.
    tuning: { enemyPower: 0.93, alarmStart: 17 },
    layout: {
      rooms: [
        {id:'A01',name:'GARAGE',col:1,row:1,w:1,h:1,links:['B02'],exit:true},
        {id:'B02',name:'ACCESSO',col:2,row:1,w:1,h:1,links:['C03','A01','A05'],node:true},
        {id:'C03',name:'TERMICA',col:3,row:1,w:1,h:1,links:['B02','C06','D04'],node:true},
        {id:'D04',name:'NEXUS',col:4,row:1,w:1,h:1,links:['C03','D07'],exposed:true},
        {id:'A05',name:'CONDOTTI',col:1,row:2,w:2,h:1,links:['C06','B02'],cover:true},
        {id:'C06',name:'LAB NERO',col:3,row:2,w:1,h:2,links:['C03','A08','A05'],exposed:true},
        {id:'D07',name:'CRIOSALA',col:4,row:2,w:1,h:1,links:['D04','D09'],cover:true},
        {id:'A08',name:'SICUREZZA',col:1,row:3,w:2,h:1,links:['C06','A10'],cover:true},
        {id:'D09',name:'PONTE',col:4,row:3,w:1,h:1,links:['D07','D12'],node:true},
        {id:'A10',name:'ARCHIVIO',col:1,row:4,w:1,h:1,links:['A08'],start:true},
        {id:'C11',name:'CELLE',col:3,row:4,w:1,h:1,links:['D12'],vault:true},
        {id:'D12',name:'MENSA',col:4,row:4,w:1,h:1,links:['D09','C11'],cover:true},
      ],
      startRoom: 'A10', vaultRoom: 'C11', dropRoom: 'A01',
      nodeRooms: ['B02', 'C03', 'D09'],
      // Presidio alleggerito di 1 unità rispetto al default (elite@teca + sec/drone/sec sui 3 nodi):
      // qui il terzo guardiano di nodo è rimosso.
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'drone',at:'node:1'}],
      doors: {'A01-B02':true,'A05-B02':true,'C03-D04':true,'A05-C06':true,'D07-D09':true,'D09-D12':true},
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
    brief: 'Niente da rubare: violate i nodi per abbattere il firewall del nucleo dati, raggiungetelo e lanciate la PURGA. Da quel momento ogni sistema Helix converge sulla vostra posizione — sparire in fretta è l’unica strategia.',
    goalHeadline: 'Cancellate MNEMOSYNE dal nucleo',
    intro: 'MNEMOSYNE non va rubato, va cancellato alla fonte. Scendete nel nucleo dati della Helix Tower, abbattete il firewall e lanciate la PURGA. Nell’istante in cui parte, ogni sistema della torre sa dove siete e converge: da lì in poi è solo fuga.',
    objectives: [
      'Violate 2 nodi di rete per abbattere il firewall del nucleo dati.',
      'Raggiungete il nucleo e lanciate la PURGA.',
      'Dopo la PURGA ogni sistema Helix converge su di voi: raggiungete il punto di consegna prima della saturazione.',
      'Portate ogni operativo ancora vivo nel punto di consegna per l’estrazione.',
    ],
    mapNote: mapNote('il nucleo dati', 13),
    // TARATURA (simulatore bot, N=400/cella): enemyPower 0.73 + alarmStart 56 per portare
    // winrate aggregato 2-6 e sconfitte-allarme dentro le fasce target del progetto (52-72% win,
    // 4-18% sconfitte-allarme): risultato 56% win, 6% sconfitte-allarme. Qui l'allarme di
    // partenza va tenuto alto apposta: le partite durano poco (~9-10 round, si muore quasi
    // sempre per sterminio, non per l'allarme) quindi senza un `alarmStart` molto sopra il
    // default l'allarme non arriva mai a 100 e la fascia 4-18% non si può raggiungere. Resta
    // forte pendenza fra 2p (~17%) e 6p (~79%): manca da scortare, ogni operativo in più è quasi
    // puro valore. Chiudere lo spread resta una SECONDA PASSATA — slot `garrison` con `minSquad`
    // per le squadre grandi, uno alla volta e misurati. Vedi `missionTuning` e `npm run sim`.
    tuning: { enemyPower: 0.73, alarmStart: 56 },
    layout: {
      rooms: [
        {id:'A01',name:'SALA SERVER',col:1,row:1,w:2,h:1,links:['A03','C02'],cover:true},
        {id:'C02',name:'CONTROLLO REMOTO',col:3,row:1,w:2,h:1,links:['A01','D06'],node:true},
        {id:'A03',name:'DATACENTER',col:1,row:2,w:1,h:1,links:['B04','A01','A07'],cover:true},
        {id:'B04',name:'BACKUP',col:2,row:2,w:1,h:1,links:['C05','A03','B08'],exposed:true},
        {id:'C05',name:'MODULO QUANTICO',col:3,row:2,w:1,h:1,links:['B04','C09'],node:true},
        {id:'D06',name:'CENTRALE DATI',col:4,row:2,w:1,h:1,links:['C02'],exit:true},
        {id:'A07',name:'FIBRA DORSALE',col:1,row:3,w:1,h:1,links:['B08','A03'],start:true},
        {id:'B08',name:'ARCHIVIO DIGITALE',col:2,row:3,w:1,h:1,links:['B04','A07','B11'],exposed:true},
        {id:'C09',name:'SPECCHIO DATI',col:3,row:3,w:1,h:1,links:['C05','D10'],cover:true},
        {id:'D10',name:'RAFFREDDAMENTO',col:4,row:3,w:1,h:1,links:['C09','D13'],cover:true},
        {id:'B11',name:'NODO DATI',col:2,row:4,w:1,h:1,links:['B08','C12'],node:true},
        {id:'C12',name:'SALA MACCHINE',col:3,row:4,w:1,h:1,links:['B11'],cover:true},
        {id:'D13',name:'CAMERA BIANCA',col:4,row:4,w:1,h:1,links:['D10'],vault:true},
      ],
      startRoom: 'A07', vaultRoom: 'D13', dropRoom: 'D06',
      nodeRooms: ['C02', 'C05', 'B11'],
      // Presidio rinforzato di 1 unità rispetto al default: oltre a elite@nucleo + sec/drone/sec
      // sui 3 nodi, un HELIX SEC in più presidia lo snodo più trafficato.
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'drone',at:'node:1'},{kind:'sec',at:'node:2'},{kind:'sec',at:'hub'}],
      doors: {'A01-A03':true,'C02-D06':true,'A03-A07':true,'B04-C05':true,'B04-B08':true,'C09-D10':true,'B11-C12':true},
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
    brief: 'Nella cella è rinchiuso un informatore. Violate i nodi per sbloccarla, liberatelo e scortatelo vivo fino al punto di consegna: non combatte, e se lo lasciate solo con degli ostili viene colpito ogni round finché qualcuno non torna a scortarlo.',
    goalHeadline: 'Salvate l’informatore',
    intro: 'Nella cella della Helix Tower è rinchiuso un informatore che sa troppo per restare lì. Sbloccate la cella, tiratelo fuori e portatelo vivo all’estrazione. Non spara e non corre: ogni round che passa lontano da voi, con degli ostili attorno, è un round in cui rischia di non uscirne.',
    objectives: [
      'Violate 2 nodi di rete per sbloccare la cella.',
      'Usate LIBERA nella stanza della cella per far uscire l’informatore.',
      'Scortatelo fino al punto di consegna: se resta solo con ostili viene colpito ogni round.',
      'Portate l’informatore e ogni operativo ancora vivo nel punto di consegna.',
    ],
    mapNote: mapNote('la cella', 12),
    // TARATURA (simulatore bot, N=400/cella): enemyPower 0.90 + alarmStart 24 per portare
    // winrate aggregato 2-6 e sconfitte-allarme dentro le fasce target del progetto (52-72% win,
    // 4-18% sconfitte-allarme): risultato 66% win, 16% sconfitte-allarme. `hostageBleed` resta a
    // 18 (default): abbassarlo è SECONDA PASSATA, per rifinire la pressione sul gioco umano dopo
    // i playtest. Vedi `missionTuning` e `npm run sim`.
    tuning: { enemyPower: 0.90, alarmStart: 24 },
    layout: {
      rooms: [
        {id:'A01',name:'CORRIDOIO GUARDIE',col:1,row:1,w:1,h:1,links:['A05','B02'],node:true},
        {id:'B02',name:'POSTO DI BLOCCO',col:2,row:1,w:1,h:1,links:['A01','C03'],node:true},
        {id:'C03',name:'SALA INTERROGATORI',col:3,row:1,w:1,h:1,links:['B02'],vault:true},
        {id:'D04',name:'ARCHIVIO SCHEDE',col:4,row:1,w:1,h:1,links:['D07'],exit:true},
        {id:'A05',name:'MENSA GUARDIE',col:1,row:2,w:1,h:1,links:['A08','A01'],cover:true},
        {id:'C06',name:'BLOCCO DETENZIONE',col:3,row:2,w:1,h:2,links:['B09','D07','C12'],exposed:true},
        {id:'D07',name:'SALA CONTROLLO',col:4,row:2,w:1,h:2,links:['C06','D04','C12'],exposed:true},
        {id:'A08',name:'SALA MONITOR',col:1,row:3,w:1,h:1,links:['B09','A05'],cover:true},
        {id:'B09',name:'ISOLAMENTO',col:2,row:3,w:1,h:1,links:['B11','A08','C06'],cover:true},
        {id:'A10',name:'DEPOSITO PROVE',col:1,row:4,w:1,h:1,links:['B11'],start:true},
        {id:'B11',name:'ATRIO INGRESSO',col:2,row:4,w:1,h:1,links:['B09','A10','C12'],cover:true},
        {id:'C12',name:'ARMERIA',col:3,row:4,w:2,h:1,links:['B11','D07','C06'],node:true},
      ],
      startRoom: 'A10', vaultRoom: 'C03', dropRoom: 'D04',
      nodeRooms: ['A01', 'B02', 'C12'],
      // Presidio alleggerito di 1 unità rispetto al default (elite@cella + sec/drone/sec sui 3 nodi):
      // qui il terzo guardiano di nodo è rimosso.
      garrison: [{kind:'elite',at:'vault'},{kind:'sec',at:'node:0'},{kind:'drone',at:'node:1'}],
      doors: {'A01-A05':true,'B02-C03':true,'A05-A08':true,'C06-D07':true,'C12-D07':true,'B09-B11':true,'B11-C12':true},
    },
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
const missionList = () => Object.values(MISSIONS).map(({ narrative: _narrative, layout: _layout, tuning: _tuning, ...meta }) => meta);

// TUNING PER MISSIONE — leve di difficoltà applicate SOPRA a SQUAD_SCALE, dichiarate a livello
// di missione (fuori da `layout`, che è solo la plancia). Tutte opzionali, default = neutro:
//   enemyPower     moltiplica insieme INTEGRITÀ e DANNO di ogni Helix della missione (SEGUGI
//                  inclusi, perché ereditano `game.hpScale`/`game.dmgScale`).
//   enemyHpPower   override del solo asse integrità (allunga la partita → più esposizione
//   enemyDmgPower  override del solo asse danno   (attrito immediato). Usali quando `enemyPower`
//                  singolo lascia la missione sbilanciata su uno dei due.
//   alarmStart     allarme iniziale della missione: alzarlo toglie round utili E anticipa le
//                  soglie SEGUGI (25/35/45/55/65/75), quindi non è compensabile 1:1 con enemyPower.
// Si tarano una missione alla volta guardando il win rate del simulatore (`npm run sim`).
function missionTuning(mission) {
  const t = mission.tuning || {};
  const power = typeof t.enemyPower === 'number' ? t.enemyPower : 1;
  return {
    enemyHpPower: typeof t.enemyHpPower === 'number' ? t.enemyHpPower : power,
    enemyDmgPower: typeof t.enemyDmgPower === 'number' ? t.enemyDmgPower : power,
    alarmStart: typeof t.alarmStart === 'number' ? t.alarmStart : ALARM_START,
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
  // Passive e seconda manovra: aggiorna le partite salvate senza alterarne la squadra.
  if (game) for (const p of game.players) {
    const template = templates.find((item) => item.id === p.characterId);
    if (!Array.isArray(p.passives)) p.passives = template?.passives || [];
    if (typeof p.maneuverCount !== 'number') p.maneuverCount = p.move ? 1 : 0;
    if (typeof p.lastPlateRound !== 'number') p.lastPlateRound = -1;
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

// Salvataggi in coda e atomici (file temporaneo + rename): due richieste ravvicinate non
// possono intrecciare le scritture e lasciare un JSON troncato che al riavvio perde la partita.
let saving = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(game,null,2);
  saving = saving.then(async () => {
    await mkdir(DATA_DIR,{recursive:true});
    await writeFile(DATA_TMP, snapshot);
    await rename(DATA_TMP, DATA_FILE);
  }).catch((error) => console.error(error));
  return saving;
}

function publicGame() {
  if (!game) return null;
  // `deviceId` non esce mai: chi lo legge potrebbe inviare azioni al posto di un altro telefono.
  const players = game.players.map((p)=>{const {deviceId:_deviceId,...rest}=p;return {...rest,connected:connected(p)};});
  // `waiting` = l'operativo di cui è il turno adesso (una voce sola), per la riga di stato della plancia.
  const active = game.players.find((p)=>p.id===game.activePlayerId&&alive(p));
  const waiting = active?[active.name]:[];
  return {...game, players, waiting, caseAt:caseRoomNow(), hostageAt:hostageRoomNow(), vaultOpen:vaultOpen()};
}

// Scheda operativo pronta al gioco a partire da un template: usata sia alla creazione della
// partita (percorso simulazione headless, che passa già `body.players`) sia quando un telefono
// sceglie il personaggio dalla lobby (`/api/join`).
function newPlayer(id, t, name, startRoom) {
  return {id, name:String(name||t.callsign).slice(0,14).toUpperCase(), characterId:t.id, callsign:t.callsign, role:t.role, specialty:t.specialty, color:t.color, maxHp:t.maxHp, hp:t.maxHp, dmg:t.dmg, mag:t.mag, maxMag:t.mag, focus:t.focus, maxFocus:t.focus, weapon:t.weapon, ability:t.ability, abilityText:t.abilityText, passives:t.passives, room:startRoom, actions:[], move:null, maneuverCount:0, lastPlateRound:-1, turnDone:false, deviceId:null, lastSeen:0};
}

// Presidio nemico e scaling di forza: si calcolano quando la squadra è nota, cioè all'AVVIO
// (`/api/start`), non alla creazione del canale. Il percorso simulazione, che conosce già la
// squadra, lo chiama subito da `createGame`.
function buildSquadEnemies(game) {
  const mission = missionOf(game.missionId);
  const scale = SQUAD_SCALE[game.players.length] || SQUAD_SCALE[3];
  const tuning = missionTuning(mission);
  game.hpScale = scale.hp * tuning.enemyHpPower;
  game.dmgScale = scale.dmg * tuning.enemyDmgPower;
  const layoutLike = {garrison:game.garrison, vaultRoom:game.vaultRoom, dropRoom:game.dropRoom, startRoom:game.startRoom, nodeRooms:game.nodeRooms};
  game.enemies = buildEnemies(layoutLike, game.map, game.hpScale, game.dmgScale, game.players.length);
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
  const scale=SQUAD_SCALE[players.length]||SQUAD_SCALE[3];
  const tuning=missionTuning(mission);
  const hpScale=scale.hp*tuning.enemyHpPower;
  const dmgScale=scale.dmg*tuning.enemyDmgPower;
  const roomName=(id)=>{const r=layout.rooms.find((x)=>x.id===id);return `${id} // ${r?.name||''}`;};
  const narrative={goalHeadline:mission.goalHeadline, ...mission.narrative(layout,roomName)};
  return {
    code:makeCode(), phase:'lobby', round:1, alarm:tuning.alarmStart, breach:0, alarmSpawns:[],
    hpScale:players.length?hpScale:1, dmgScale:players.length?dmgScale:1, maxPlayers, seq,
    turnOrder:players.map((p)=>p.id), activePlayerId:players[0]?.id||null,
    missionId:mission.id, title:mission.title, location:`HELIX TOWER // SETTORE ${['NORD','SUD','EST','OVEST'][Math.floor(Math.random()*4)]}`,
    objective:narrative.objective, narrative,
    map:layout.rooms, startRoom:layout.startRoom, vaultRoom:layout.vaultRoom, dropRoom:layout.dropRoom,
    garrison:layout.garrison||null,
    nodeRooms:layout.nodeRooms, nodesRequired:NODES_REQUIRED, doors:layout.doors||{},
    nodes:Object.fromEntries(layout.nodeRooms.map((id)=>[id,false])),
    caseRoom:layout.vaultRoom, caseHolder:null, caseDelivered:false, purged:false, lockdown:false,
    hostage:{room:layout.vaultRoom, holder:null, hp:HOSTAGE_MAX_HP, maxHp:HOSTAGE_MAX_HP, freed:false, delivered:false},
    players,
    enemies:players.length?buildEnemies(layout,layout.rooms,hpScale,dmgScale,players.length):[],
    feed:[{time:nowTime(),tone:'system',text:players.length
      ?`Canale clandestino aperto. Squadra in posizione a ${roomName(layout.startRoom)}.`
      :`Canale clandestino aperto. In attesa degli operativi — ingresso da ${roomName(layout.startRoom)}.`}],
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

// MANOVRA: lo spostamento del turno si risolve subito. Non c'è fuoco di sganciamento, ma gli
// ostili che presidiavano la stanza di partenza seguono l'operativo nella stanza nuova nello
// stesso istante: muoversi con un nemico addosso non lo stacca.
function applyMove(p){
  if(!p.move) return;
  const destination=p.move.roomId;
  const origin=p.room;
  if(!roomById(origin).links.includes(destination)){
    log(`${p.name} non trova una porta verso ${destination}: resta in ${origin}.`,'system');
    return;
  }
  if(doorClosed(origin,destination)){
    log(`${p.name} trova la porta verso ${destination} bloccata: va sbloccata prima di passare.`,'system');
    return;
  }
  p.room=destination;
  const chasers=enemiesIn(origin);
  for(const enemy of chasers){ enemy.room=destination; enemy.locked=true; enemy.chasing=p.id; }
  if(chasers.length) log(`${chasers.length===1?chasers[0].name:`${chasers.length} unità Helix`} insegue ${p.name} in ${roomLabel(destination)}.`,'danger');
  log(`${p.name} raggiunge ${roomLabel(destination)}${game.caseHolder===p.id?' con la valigetta':''}${game.hostage.holder===p.id?' con l’informatore':''}.`,'system');
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
      if(p.mag<=0) log(`${p.name} preme il grilletto a vuoto in ${p.room}: caricatore scarico.`,'system');
      else if(!target) log(`${p.name} non ha bersagli in ${p.room}: tiene la posizione.`,'system');
      else{
        const opening=hasPassive(p,'clean-opening')&&!target.locked;
        const damage=opening?Math.ceil(p.dmg*1.5):p.dmg;
        if(opening){
          target.locked=true;
          target.chasing=p.id;
          log(`${p.name} trova un'apertura su ${target.name}: +50% danni.`,'combat');
        }
        damageEnemy(target,damage,p.name);
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
        // Da qui ogni unità Helix, anche quella mai ingaggiata, insegue la squadra (come il LOCKDOWN).
        for(const e of game.enemies) e.locked=true;
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

    if(action.type==='unlock'){
      const doorRoom=action.roomId;
      if(!doorRoom||!room.links.includes(doorRoom)) log(`${p.name}: nessuna porta verso ${doorRoom||'?'} da ${p.room}.`,'system');
      else if(!doorClosed(p.room,doorRoom)) log(`${p.name}: la porta verso ${roomLabel(doorRoom)} è già aperta.`,'system');
      else{
        p.focus=Math.max(0,p.focus-1);
        game.doors[doorKey(p.room,doorRoom)]=false;
        log(`${p.name} sblocca la porta fra ${roomLabel(p.room)} e ${roomLabel(doorRoom)}.`,'hack');
      }
    }

    if(action.type==='hack'){
      if(!room.node) log(`${p.name} non trova terminali in ${roomLabel(p.room)}.`,'system');
      else if(game.nodes[p.room]) log(`${p.name}: il nodo di ${p.room} è già violato.`,'system');
      else {
        p.focus=Math.max(0,p.focus-2);
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
// Gli ostili NON hanno un turno di attacco: colpiscono l'operativo di mano a fine turno, se
// dividono la stanza con lui (vedi enemyStrike). A fine round si limitano a spostarsi, e solo
// quando la torre è in piena allerta (allarme ≥ ENEMY_ROAM_ALARM): sotto quella soglia
// restano di presidio dove sono. Chi è già ingaggiato insegue la squadra una porta per round.
function resolveEnemies(){
  // MISSIONE OSTAGGIO: l'informatore libero, non scortato e solo con ostili si dissangua a ogni round.
  if(game.missionId==='ostaggio'&&game.hostage.freed&&!game.hostage.delivered&&!game.hostage.holder){
    const room=hostageRoomNow();
    if(enemiesIn(room).length){
      game.hostage.hp=Math.max(0,game.hostage.hp-HOSTAGE_UNESCORTED_DAMAGE);
      log(`Gli ostili colpiscono l’informatore lasciato solo in ${roomLabel(room)}: ${HOSTAGE_UNESCORTED_DAMAGE} danni.`,'danger');
    }
  }

  if(game.alarm<ENEMY_ROAM_ALARM) return;

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
    if(step!==enemy.room){ enemy.room=step; log(`${enemy.name} insegue ${target.name} verso ${roomLabel(step)}.`,'danger'); }
  }
}

// Priorità bersaglio: chi trasporta l'obiettivo resta sempre esposto; poi intervengono i taunt
// e l'elusione passiva. Senza passive, il bersaglio resta chi sta chiudendo il turno.
function enemyTarget(enemy, preferred){
  const occupants=alliesIn(enemy.room);
  const carriers=occupants.filter((p)=>game.caseHolder===p.id||game.hostage?.holder===p.id);
  if(carriers.length) return carriers[0];
  const taunts=occupants.filter((p)=>hasPassive(p,'big-target'));
  if(taunts.length) return taunts[0];
  const eligible=occupants.filter((p)=>occupants.length===1||!hasPassive(p,'last-in-line'));
  if(eligible.includes(preferred)) return preferred;
  return eligible[0]||occupants[0]||preferred;
}

function enemyDamage(enemy,target){
  let damage=enemy.damage;
  if(hasPassive(target,'chrome-plates')) damage=Math.ceil(damage/2);
  const lethal=target.hp-damage<=0;
  if(lethal&&hasPassive(target,'last-plate')&&target.lastPlateRound!==game.round){
    target.hp=1;
    target.lastPlateRound=game.round;
    log(`${target.name} attiva Ultima piastra e resta a 1 integrità.`,'success');
    return {damage,saved:true};
  }
  target.hp=Math.max(0,target.hp-damage);
  return {damage,saved:false};
}

// I nemici non hanno un turno proprio: quando un operativo chiude il turno (o viene saltato
// dalla plancia), ciascun ostile nella stanza risolve un attacco diretto. Sempre a segno.
function enemyStrike(p){
  if(!p||!alive(p)) return;
  for(const enemy of enemiesIn(p.room)){
    const target=enemyTarget(enemy,p);
    if(!target||!alive(target)) continue;
    if(enemy.distracted){ enemy.distracted=false; log(`${enemy.name} è distratto: manca il colpo su ${target.name}.`,'hack'); continue; }
    if(!enemy.locked){ enemy.locked=true; log(`${enemy.name} ingaggia la squadra in ${roomLabel(enemy.room)}.`,'danger'); }
    enemy.chasing=target.id;
    const hit=enemyDamage(enemy,target);
    const mitigation=hasPassive(target,'chrome-plates')?' · Piastre di cromo':hit.saved?' · Ultima piastra':'';
    log(`${enemy.name} colpisce ${target.name} in ${roomLabel(enemy.room)}: ${hit.damage} danni${mitigation}.`,'danger');
    if(target.hp===0){
      log(`${target.name} è fuori combattimento in ${roomLabel(enemy.room)}.`,'danger');
      if(game.caseHolder===target.id) dropCase(`${target.name} è a terra`);
      if(game.hostage.holder===target.id) dropHostage(`${target.name} è a terra`);
      break;
    }
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
  game.players.forEach((p)=>{p.actions=[];p.move=null;p.maneuverCount=0;p.turnDone=false;p.focus=Math.min(p.maxFocus,p.focus+(hasPassive(p,'constant-uplink')?2:1));});

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
      // Indice dopo il più alto già in campo: i SEGUGI extra del presidio (es. hunter-6) non
      // devono collidere con quelli generati qui.
      const idx=Math.max(0,...game.enemies.filter((e)=>e.id.startsWith('hunter-')).map((e)=>Number(e.id.slice(7))||0))+1;
      const unit=spawnEnemy('hunter',room.id,idx,game.hpScale||1,game.dmgScale||1);
      unit.locked=true;
      game.enemies.push(unit);
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
      np.actions=[];np.move=null;np.maneuverCount=0;
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

async function jsonBody(req){let raw='';for await(const chunk of req)raw+=chunk;if(!raw)return {};try{return JSON.parse(raw);}catch{throw Object.assign(new Error('JSON non valido'),{status:400});}}
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
      if(!missionList().some((m)=>m.id===body.missionId))return send(res,400,{error:'Missione non valida.'});
      // La plancia crea il canale VUOTO: sceglie missione e tetto di posti (2–6). Gli operativi
      // entrano poi dai telefoni scegliendo la scheda in `/api/join`.
      game=createGame({missionId:body.missionId,maxPlayers:body.maxPlayers});await save();
      return send(res,200,{game:publicGame(),networkUrl:getNetworkUrl()});
    }
    if(req.method==='POST'&&url.pathname==='/api/join'){
      const body=await jsonBody(req);if(!game||body.code?.toUpperCase()!==game.code)return send(res,404,{error:'Codice partita non valido.'});
      const template=templates.find((t)=>t.id===body.characterId);if(!template)return send(res,400,{error:'Scheda operativo non valida.'});
      const mine=game.players.find((x)=>x.deviceId===body.deviceId);
      const holder=game.players.find((x)=>x.characterId===body.characterId);
      // Fuori dalla lobby si può solo riconnettersi al proprio posto (o riprendere una scheda
      // lasciata libera da un telefono caduto): niente nuovi posti né cambio scheda a partita in corso.
      if(game.phase!=='lobby'){
        const seat=mine||(holder&&!connected(holder)?holder:null);
        if(!seat)return send(res,409,{error:'Operazione già avviata: impossibile aggiungere operativi.'});
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
      if(game.phase!=='lobby')return send(res,409,{error:'Operazione già avviata.'});
      if(game.players.length<2)return send(res,400,{error:'Servono almeno 2 operativi collegati.'});
      // Squadra ora nota: presidio nemico e scaling di forza si calcolano adesso.
      if(!game.enemies?.length)buildSquadEnemies(game);
      // Si può avviare anche senza tutti i telefoni collegati per ispezionare plancia/mappa:
      // il turno resta fermo sull'operativo di mano finché il suo telefono non gioca (o la plancia salta).
      game.phase='active';
      game.turnOrder=game.players.map((p)=>p.id);
      game.activePlayerId=(game.players.find((p)=>alive(p))||game.players[0]).id;
      game.players.forEach((p)=>{p.actions=[];p.move=null;p.maneuverCount=0;p.turnDone=false;});
      log(game.narrative.opening,'combat');await save();return send(res,200,{game:publicGame()});
    }
    if(req.method==='POST'&&url.pathname==='/api/action'){
      const body=await jsonBody(req);if(!game||body.code!==game.code||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const p=game.players.find((x)=>x.id===body.playerId&&x.deviceId===body.deviceId);if(!p||!alive(p))return send(res,403,{error:'Accesso operativo negato.'});
      if(game.activePlayerId!==p.id)return send(res,409,{error:'Non è il tuo turno.'});
      const allowed=['move','attack','hack','heal','ability','grab','purge','free','unlock','reload'];if(!allowed.includes(body.type))return send(res,400,{error:'Azione non valida.'});
      // MANOVRA: una stanza alla volta e consuma una delle ACTIONS_PER_TURN azioni, quindi si può
      // ripetere e alternare con le altre azioni. Piede sull'acceleratore rende gratis la prima del turno.
      // Si risolve subito: l'operativo si sposta davvero e gli ostili della stanza lo seguono.
      if(body.type==='move'){
        const freeMove=hasPassive(p,'accelerator')&&(p.maneuverCount||0)<1;
        if(!freeMove&&p.actions.length>=ACTIONS_PER_TURN)return send(res,409,{error:`Hai già usato le ${ACTIONS_PER_TURN} azioni di questo turno.`});
        if(!roomById(p.room).links.includes(body.roomId))return send(res,400,{error:'Nessuna porta collega la tua stanza a quella.'});
        if(doorClosed(p.room,body.roomId))return send(res,400,{error:'Quella porta è bloccata: sbloccala prima di passare.'});
        p.move={roomId:body.roomId};p.maneuverCount=(p.maneuverCount||0)+1;p.lastSeen=Date.now();
        if(!freeMove)p.actions.push({type:'move',targetId:null,roomId:body.roomId});
        applyMove(p);
        await save();return send(res,200,{game:publicGame()});
      }
      if(p.actions.length>=ACTIONS_PER_TURN)return send(res,409,{error:`Hai già usato le ${ACTIONS_PER_TURN} azioni di questo turno.`});
      // Le manovre fatte sono già risolte: l'azione ha effetto nella stanza attuale.
      const actRoom=p.room;
      if(body.type==='ability'&&p.focus<3)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='heal'&&p.focus<2)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='hack'&&p.focus<2)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='unlock'&&p.focus<1)return send(res,400,{error:'Focus insufficiente.'});
      if(body.type==='attack'&&!enemiesIn(actRoom).length)return send(res,400,{error:'Nessun ostile nella tua stanza.'});
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
      if(body.type==='free'&&game.missionId!=='ostaggio')return send(res,400,{error:'Azione non disponibile in questa missione.'});
      if(body.type==='free'&&game.hostage.delivered)return send(res,400,{error:'L’informatore è già stato consegnato.'});
      if(body.type==='free'&&game.hostage.holder)return send(res,400,{error:'L’informatore è già scortato da un compagno.'});
      if(body.type==='free'&&hostageRoomNow()!==actRoom)return send(res,400,{error:'L’informatore non è in questa stanza.'});
      if(body.type==='free'&&!game.hostage.freed&&actRoom===game.vaultRoom&&!vaultOpen())return send(res,400,{error:`Cella sigillata: violate ${game.nodesRequired} nodi.`});
      if(body.type==='unlock'&&!roomById(actRoom).links.includes(body.roomId))return send(res,400,{error:'Nessuna porta verso quella stanza.'});
      if(body.type==='unlock'&&!doorClosed(actRoom,body.roomId))return send(res,400,{error:'Quella porta è già aperta.'});
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
      enemyStrike(p);
      advanceTurn();
      await save();return send(res,200,{game:publicGame()});
    }
    // SALTA TURNO dalla plancia: salta l'operativo di mano (telefono offline o assente).
    if(req.method==='POST'&&url.pathname==='/api/skipturn'){
      if(!game||game.phase!=='active')return send(res,409,{error:'Operazione non attiva.'});
      const skipped=game.players.find((x)=>x.id===game.activePlayerId);
      if(skipped) log(`${skipped.name}: turno saltato dalla plancia.`,'system');
      if(skipped) enemyStrike(skipped);
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
  }catch(error){
    if(error.status===400)return send(res,400,{error:'Richiesta non valida.'});
    console.error(error);return send(res,500,{error:'Errore del sistema di gioco.'});
  }
}

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json','.webmanifest':'application/manifest+json','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.woff2':'font/woff2'};

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
}

// Superficie importabile dal simulatore headless (scripts/simulate.mjs): il motore puro, senza
// HTTP. `__setGame`/`__getGame` danno accesso allo stato-modulo `game` su cui operano tutte le
// funzioni del motore. NON usarli dal codice del server.
export { MISSIONS, missionTuning, createGame, applyMove, applyAction, enemyStrike, advanceTurn, runEnemyPhase, startNextRound, alive };
export const __setGame=(g)=>{ game=g; };
export const __getGame=()=>game;

const runDirect=process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href;
if(runDirect) main();

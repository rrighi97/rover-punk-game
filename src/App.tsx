import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity, AlertTriangle, ArrowRight, BookOpen, Brain, Briefcase, CameraOff, Check, ChevronLeft, ChevronRight, CircleDot,
  Copy, Crosshair, Cpu, DoorOpen, Download, Footprints, HeartPulse, LockKeyhole, LogIn, MapPin, Radio, RotateCw,
  Info, Lock, PackagePlus, RefreshCw, ScanEye, ShieldAlert, Skull, Smartphone, Sparkles, Swords, Timer,
  Wifi, WifiOff, X, Zap,
} from 'lucide-react';
import Settings, { SettingsButton } from './Settings';
import { AudioProvider, playSfx, playSiren, useAudio, type SfxName } from './audio';
import { qrMatrix } from './qr';
import BoardMap, { type Hit, type Room } from './BoardMap';
import BoardMapView from './BoardMap3D';
import { charImg, enemyImg, enemyKind, enemyMapImg, weaponImg } from './roster';
import PassiveAbilities, { type PassiveAbility } from './PassiveAbilities';

// Miniatura quadrata di un operativo: riempie il contenitore che la ospita.
const OpIcon=({characterId,alt}:{characterId:string;alt:string})=><img className="unit-icon" src={charImg(characterId)} alt={alt} loading="lazy" decoding="async"/>;
// Miniatura quadrata di un'unità Helix.
const FoeIcon=({kind,alt}:{kind:string;alt:string})=><img className="unit-icon" src={enemyImg(kind)} alt={alt} loading="lazy" decoding="async"/>;
const WeaponArt=({characterId,weapon}:{characterId:string;weapon:string})=><img className="weapon-art" src={weaponImg(characterId)} alt={`Illustrazione: ${weapon}`} loading="lazy" decoding="async"/>;

type Template = { id:string; callsign:string; role:string; specialty:string; color:string; maxHp:number; dmg:number; mag:number; focus:number; weapon:string; ability:string; abilityText:string; passives:PassiveAbility[] };
type PlayerAction = { type:string; targetId?:string|null; roomId?:string|null };
type Player = Template & { name:string; characterId:string; hp:number; maxMag:number; maxFocus:number; room:string; actions:PlayerAction[]; move:null|{roomId:string}; maneuverCount:number; turnDone:boolean; connected:boolean; mods?:string[]; thermalTarget?:string|null; thermalStreak?:number; riseIn?:number|null };
type Enemy = { id:string; name:string; type:string; hp:number; maxHp:number; damage:number; threat:number; room:string; home:string; locked?:boolean; chasing?:string|null };
type FeedItem = { time:string; tone:string; text:string };
// Voce del registro eventi del server (vedi `emit` in server.mjs): `batch` raggruppa la risposta
// della torre a un turno chiuso, `phase` ne dà l'ordine di regia (0 movimento, 1 colpi, 2 allarme,
// 3 eventi di torre, 4 passaggio di mano). I campi restanti dipendono dal tipo.
type GameEvent = { seq:number; type:string; batch:number|null; phase:number; [key:string]:unknown };
type AbilityActivation = { id:number; playerId:string; playerName:string; callsign:string; characterId:string; color:string; ability:string };
// Modifica appena estratta da una cassa: alimenta il pop-up centrale della plancia.
type ModDrop = { id:number; playerId:string; playerName:string; callsign:string; characterId:string; color:string; room:string; modId:string; modName:string; modText:string };
type Hostage = { room:string; holder:string|null; hp:number; maxHp:number; freed:boolean; delivered:boolean };
type Download = { progress:number; required:number; done:boolean };
// Cassa di potenziamento: `uses` scende a ogni APRI CASSA, a 0 resta disegnata ma spenta.
type Chest = { room:string; uses:number; max?:number };
type Reactor = { armed:boolean; fuse:number; required:number; exploded:boolean };
// MISSIONE 06 // SPETTRO: il fuggitivo. `specterExits` (in Game) = le sue vie di fuga adesso,
// calcolate dal server: porte aperte verso stanze senza operativi in piedi. Vuoto = BRACCATO.
type Specter = { room:string; prev?:string|null; awake:boolean; captured:boolean };
type Narrative = { objective:string; vaultUnlocked:string; opening:string; goalHeadline:string; purged?:string; downloaded?:string; armed?:string; detonated?:string; captured?:string };
type MissionMeta = { id:string; title:string; tagline:string; goalHeadline:string; missione:string; objectives:string[]; mapNote:string; cover?:string };
type RiskLevel = { id:string; label:string; alarmStart?:number; enemyPower?:number; autoRise?:boolean; allyRevive?:boolean };
type EnemyRosterEntry = { key:string; tier:number; name:string; type:string; hp:number; damage:number; threat:number; note:string; deploy:string };
type Game ={ code:string; phase:'lobby'|'active'|'victory'|'defeat'; maxPlayers:number; round:number; alarm:number; alarmSpawns:number[]; breach:number; missionId:string; riskLevel:string; title:string; location:string; objective:string; narrative:Narrative; map:Room[]; doors:Record<string,boolean>; cameras?:string[]; chests?:Chest[]; fog?:string[]; visited?:string[]; cheats?:{immortal?:boolean}; nodes:Record<string,boolean>; startRoom:string; vaultRoom:string; dropRoom:string; nodeRooms:string[]; nodesRequired:number; caseRoom:string|null; caseHolder:string|null; caseDelivered:boolean; caseAt:string|null; purged:boolean; lockdown:boolean; blackout:boolean; hostage:Hostage; hostageAt:string|null; download:Download; reactor:Reactor; specter?:Specter; specterExits?:string[]; vaultOpen:boolean; players:Player[]; enemies:Enemy[]; feed:FeedItem[]; hits?:Hit[]; events?:GameEvent[]; abilityActivations?:AbilityActivation[]; modDrops?:ModDrop[]; unlocks?:{id:number;playerId:string}[]; event:{title:string;text:string}; waiting:string[]; turnOrder:string[]; activePlayerId:string|null };
type Snapshot = { game:Game|null; templates:Template[]; enemyRoster:EnemyRosterEntry[]; missions:MissionMeta[]; riskLevels:RiskLevel[]; networkUrl:string; networkUrls?:string[] };

const emptySnapshot:Snapshot={game:null,templates:[],enemyRoster:[],missions:[],riskLevels:[],networkUrl:''};
const ACTIONS_PER_TURN=3; // azioni giocabili in un turno, la manovra ne consuma una — deve restare allineato a server.mjs
const MOVE_MAX_DISTANCE=2; // la manovra punta al massimo una stanza a questa distanza in porte aperte — allineato a server.mjs
// Valori delle azioni base mostrati sui pulsanti del telefono — allineati a server.mjs.
const HEAL_AMOUNT=16, REVIVE_RATIO=0.25;
const HACK_FOCUS=2, UNLOCK_FOCUS=1;
const CAMERA_ALARM_RELIEF=2; // ALARM_CAMERA_DISABLE in server.mjs
// MODIFICHE DELLE CASSE — catalogo e valori allineati a MODS/MOD_* in server.mjs. Qui servono
// solo per i testi e per l'anteprima del danno sul telefono: a decidere è sempre il server.
const MOD_MAG_BONUS=5, MOD_BARREL_BONUS=2, MOD_DOUBLE_CHANCE=0.5;
const MOD_THERMAL_STEPS=[0,0.2,0.3];
const MODS:{id:string;name:string;text:string}[]=[
  {id:'mag',name:'CARICATORE ESTESO',text:`+${MOD_MAG_BONUS} munizioni nel caricatore.`},
  {id:'double',name:'COLPO DOPPIO',text:`${Math.round(MOD_DOUBLE_CHANCE*100)}% di possibilità di raddoppiare il danno dell’attacco.`},
  {id:'sniper',name:'CECCHINO',text:'Puoi colpire i nemici a una stanza di distanza, oltre una porta aperta.'},
  {id:'barrel',name:'CANNA RINFORZATA',text:`+${MOD_BARREL_BONUS} danni fissi a ogni attacco.`},
  {id:'thermal',name:'MODULO TERMICO',text:'Colpi consecutivi sullo stesso bersaglio: +20% al secondo, +30% dal terzo.'},
];
const modById=(id:string)=>MODS.find((m)=>m.id===id);
const hasMod=(player:{mods?:string[]},modId:string)=>Boolean(player.mods?.includes(modId));
const DOWNLOAD_FOCUS=1;
const SEAL_FOCUS=1; // SIGILLA (missione SPETTRO) — allineato a server.mjs
const hasPassive=(player:{passives?:PassiveAbility[]},passiveId:string)=>Boolean(player.passives?.some((passive)=>passive.id===passiveId));
const enemyBadge=(enemy:Enemy)=>enemy.type==='DRONE'?'DR':enemy.type==='ÉLITE'?'EL':'SEC';
const vaultNoun=(game:Game)=>game.missionId==='nucleo'?'NUCLEO':game.missionId==='ostaggio'?'CELLA':game.missionId==='assedio'?'SORGENTE':game.missionId==='reattore'?'REATTORE':game.missionId==='spettro'?'CULLA':'TECA';

// Helper condivisi fra plancia e telefoni: chi occupa una stanza e cosa c'è dentro.
const roomsOf=(game:Game)=>game.map||[];
// Stanze ancora nella nebbia: dichiarate `fog` dalla missione e mai visitate da un operativo.
const foggedOf=(game:Game)=>(game.fog||[]).filter((id)=>!(game.visited||[]).includes(id)&&!game.players.some((p)=>p.room===id));
const roomOf=(game:Game,id:string)=>roomsOf(game).find((r)=>r.id===id);
// Porta fra due stanze: chiave `id1-id2` (ordine alfabetico), allineata a server.mjs.
const doorKey=(a:string,b:string)=>[a,b].sort().join('-');
const doorClosed=(game:Game,a:string,b:string)=>Boolean(game.doors?.[doorKey(a,b)]);
const nameOf=(game:Game,id?:string|null)=>id?`${id} // ${roomOf(game,id)?.name||''}`:'—';
// Stanze raggiungibili in manovra: solo porte aperte, fino a MOVE_MAX_DISTANCE porte di distanza.
// La manovra avanza comunque di una sola stanza per volta (vedi server.mjs, stepTowardOpen).
const reachableRooms=(game:Game,origin:string,maxDistance:number)=>{
  const dist:Record<string,number>={[origin]:0};
  const queue=[origin];
  while(queue.length){
    const current=queue.shift()!;
    if(dist[current]>=maxDistance)continue;
    for(const next of roomOf(game,current)?.links||[]){
      if(dist[next]===undefined&&!doorClosed(game,current,next)){dist[next]=dist[current]+1;queue.push(next);}
    }
  }
  delete dist[origin];
  return Object.keys(dist);
};
// Stato di chi è a terra: turni propri che mancano al rialzo automatico (dal server, `riseIn`).
const downLabel=(riseIn?:number|null)=>riseIn===-1?'A TERRA · NESSUN RIALZO':riseIn?`A TERRA · ${riseIn} ${riseIn===1?'TURNO':'TURNI'} AL RIALZO`:'A TERRA';
const carrierOf=(game:Game)=>game.players.find((p)=>p.id===game.caseHolder);
const hostageCarrierOf=(game:Game)=>game.players.find((p)=>p.id===game.hostage.holder);
// Dove si trova adesso il "carico" della missione: valigetta o informatore, a terra o in spalla.
const caseRoomOf=(game:Game)=>game.caseAt||carrierOf(game)?.room||game.caseRoom;
const hostageRoomOf=(game:Game)=>game.hostageAt||hostageCarrierOf(game)?.room||game.hostage.room;
const pawnsOf=(game:Game,selfId?:string)=>(roomId:string)=>game.players.filter((p)=>p.room===roomId).map((p)=>({id:p.id,label:p.callsign[0],img:charImg(p.characterId),name:`${p.name} · ${p.role}${p.id===game.caseHolder?' · PORTA LA VALIGETTA':''}${p.id===game.hostage.holder?' · SCORTA L’INFORMATORE':''}`,color:p.color,down:p.hp<=0,self:p.id===selfId,carrying:p.id===game.caseHolder||p.id===game.hostage.holder,badge:p.id===game.hostage.holder?'▮':undefined,active:game.phase==='active'&&p.id===game.activePlayerId,riseIn:p.riseIn??null}));
// Un nemico morto resta in game.enemies con hp<=0 (il server non lo rimuove mai): passando gli id
// "in dissolvenza" (vedi useDyingEnemies) lo si tiene a schermo oltre il momento della morte, il
// tempo di far girare l'animazione di collasso invece di farlo sparire di scatto al prossimo poll.
const foesOf=(game:Game,dying:Set<string>=new Set())=>(roomId:string)=>game.enemies.filter((e)=>(e.hp>0||dying.has(e.id))&&e.room===roomId).map((e)=>({id:e.id,label:enemyBadge(e),img:enemyMapImg(enemyKind(e.id)),kind:enemyKind(e.id),name:`${e.name} · ${e.hp}/${e.maxHp} · DANNO +${e.damage} · ${e.locked?'INGAGGIATO: VI INSEGUE':'DI PRESIDIO: FERMO IN QUESTA STANZA'}`,elite:e.type==='ÉLITE',hunting:e.locked,dying:e.hp<=0,patrol:enemyKind(e.id)==='drone'&&e.room===e.home}));

// SEGNALINI DI SCENARIO E MISSIONE
// Oltre a squadra e ostili, la plancia mostra la zona di partenza, i nodi, l'obiettivo
// (teca/nucleo/cella) e il punto di consegna. Ogni segnalino spiega sé stesso al passaggio del mouse.
const marksOf=(game:Game)=>(roomId:string)=>{
  const room=roomOf(game,roomId);
  const out:{id:string;label:string;name:string;kind:string;done?:boolean}[]=[];
  if(!room) return out;
  const noun=vaultNoun(game);
  if(room.start) out.push({id:'start',label:'S',kind:'start',name:`ZONA DI PARTENZA — ${nameOf(game,roomId)}. Qui è entrata la squadra.`});
  const nounArticle=noun==='NUCLEO'?'il nucleo':noun==='CELLA'?'la cella':noun==='SORGENTE'?'la sorgente':noun==='REATTORE'?'il reattore':noun==='CULLA'?'la culla':'la teca';
  if(room.node) out.push({id:'node',label:'N',kind:'node',done:Boolean(game.nodes?.[roomId]),name:game.nodes?.[roomId]?`NODO VIOLATO — ${nameOf(game,roomId)}. Già hackerato.`:`NODO DI RETE — ${nameOf(game,roomId)}. Violalo con INTRUSIONE: ne servono ${game.nodesRequired} per aprire ${nounArticle}.`});
  if(room.vault) out.push({id:'vault',label:'T',kind:'vault',done:game.vaultOpen,name:game.vaultOpen?`${noun} APERTA — ${nameOf(game,roomId)}.`:`${noun} SIGILLATA — ${nameOf(game,roomId)}. Violate ${game.nodesRequired} nodi per aprirla.`});
  if(room.exit) out.push({id:'drop',label:'▼',kind:'drop',done:game.missionId==='valigetta'?game.caseDelivered:game.missionId==='ostaggio'?game.hostage.delivered:game.missionId==='assedio'?game.download.done:game.missionId==='reattore'?game.reactor.exploded:game.missionId==='spettro'?Boolean(game.specter?.captured):game.purged,name:`PUNTO DI CONSEGNA — ${nameOf(game,roomId)}. Portate qui l’obiettivo e poi tutta la squadra.`});
  if(game.missionId==='valigetta'&&!game.caseHolder&&caseRoomOf(game)===roomId) out.push({id:'case',label:'▮',kind:'case',done:game.caseDelivered,name:game.caseDelivered?'VALIGETTA MNEMOSYNE — consegnata.':`VALIGETTA MNEMOSYNE — a terra in ${nameOf(game,roomId)}. Usa RECUPERO per raccoglierla.`});
  if(game.missionId==='ostaggio'&&!game.hostage.delivered&&!game.hostage.holder&&hostageRoomOf(game)===roomId) out.push({id:'hostage',label:'▮',kind:'case',done:game.hostage.delivered,name:`INFORMATORE — ${game.hostage.freed?'lasciato solo, in pericolo':'in cella, ancora da liberare'} in ${nameOf(game,roomId)}.`});
  if(game.missionId==='assedio'&&room.vault&&!game.download.done&&game.download.progress>0) out.push({id:'download',label:'▮',kind:'case',done:false,name:`TRASFERIMENTO IN CORSO — ${game.download.progress}/${game.download.required}. Restate su ${nameOf(game,roomId)} e continuate a SCARICARE.`});
  if(game.missionId==='reattore'&&room.vault&&game.reactor.armed&&!game.reactor.exploded) out.push({id:'reactor',label:'▮',kind:'case',done:false,name:`CARICA INNESCATA — ${game.reactor.fuse} turni al detonare. Allontanatevi da ${nameOf(game,roomId)}.`});
  if(game.missionId==='spettro'&&game.specter&&!game.specter.captured&&game.specter.room===roomId){
    const exits=game.specterExits||[];
    const s=game.specter;
    out.push({id:'specter',label:'Ψ',kind:`specter ${s.awake?(exits.length?'awake':'cornered'):'asleep'}`,done:false,name:!s.awake?`SPETTRO — dorme nella culla di ${nameOf(game,roomId)}. Si sveglia quando cadono ${game.nodesRequired} nodi.`:exits.length?`SPETTRO — in fuga in ${nameOf(game,roomId)}. Vie di fuga: ${exits.join(' · ')}. Sigillatele o presidiatele, poi CATTURA.`:`SPETTRO BRACCATO — ${nameOf(game,roomId)}. Nessuna via di fuga: entrate e usate CATTURA in questo turno.`});
  }
  return out;
};

// L'obiettivo cambia stanza a seconda della fase e della missione attiva.
function missionStage(game:Game){
  const need=game.nodesRequired||2;
  const pending=roomsOf(game).filter((r)=>r.node&&!game.nodes?.[r.id]).map((r)=>r.id);
  const noun=vaultNoun(game);
  if(!game.vaultOpen) return {label:'FASE 1 // RETE',short:`${game.breach}/${need} NODI`,text:`${noun[0]}${noun.slice(1).toLowerCase()} di ${nameOf(game,game.vaultRoom)} è sigillata. Violate ${need} nodi fra: ${pending.join(' · ')||'—'}.`};
  if(game.missionId==='nucleo'){
    if(!game.purged) return {label:'FASE 2 // NUCLEO',short:`PURGA IN ${game.vaultRoom}`,text:`Il firewall è caduto: raggiungete il nucleo in ${nameOf(game,game.vaultRoom)} e lanciate PURGA.`};
    return {label:'FASE 3 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`PURGA lanciata: ogni unità Helix vi insegue. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
  }
  if(game.missionId==='assedio'){
    if(!game.download.done) return {label:'FASE 2 // SORGENTE',short:`${game.download.progress}/${game.download.required} SCARICATO`,text:`La sorgente in ${nameOf(game,game.vaultRoom)} è aperta: restate lì e usate SCARICA finché il trasferimento non è completo.`};
    return {label:'FASE 3 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`Trasferimento completo: ogni unità Helix vi insegue. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
  }
  if(game.missionId==='ostaggio'){
    if(!game.hostage.freed) return {label:'FASE 2 // CELLA',short:`INFORMATORE IN ${game.vaultRoom}`,text:`La cella in ${nameOf(game,game.vaultRoom)} è aperta: liberate l’informatore con LIBERA.`};
    if(!game.hostage.delivered) return {label:'FASE 3 // SCORTA',short:`${game.hostage.hp}/${game.hostage.maxHp} HP`,text:`${hostageCarrierOf(game)?.name||'Nessuno'} scorta l’informatore verso ${nameOf(game,game.dropRoom)}. Se resta solo con ostili viene colpito a ogni turno.`};
    return {label:'FASE 4 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`Informatore consegnato. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
  }
  if(game.missionId==='reattore'){
    if(game.reactor.exploded) return {label:'FASE 3 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`Il reattore è detonato: ogni unità Helix vi insegue. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
    if(game.reactor.armed) return {label:'FASE 2 // INNESCO',short:`${game.reactor.fuse} TURNI AL DETONARE`,text:`Carica innescata in ${nameOf(game,game.vaultRoom)}: allontanatevi prima che detoni. Restano ${game.reactor.fuse} turni.`};
    return {label:'FASE 2 // REATTORE',short:`REATTORE IN ${game.vaultRoom}`,text:`L’accesso è aperto: raggiungete il reattore in ${nameOf(game,game.vaultRoom)} e innescate la carica con INNESCO.`};
  }
  if(game.missionId==='spettro'){
    const s=game.specter;
    const exits=game.specterExits||[];
    if(s?.captured) return {label:'FASE 3 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`SPETTRO è in gabbia: ogni unità Helix vi insegue. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
    if(!exits.length) return {label:'FASE 2 // CATTURA',short:`BRACCATO IN ${s?.room}`,text:`SPETTRO non ha vie di fuga in ${nameOf(game,s?.room)}: entrate e usate CATTURA prima che forzi una porta.`};
    return {label:'FASE 2 // CACCIA',short:`SPETTRO IN ${s?.room} · ${exits.length} VIE`,text:`SPETTRO fugge da ${nameOf(game,s?.room)}. Vie di fuga: ${exits.join(' · ')}. Chiudetele con SIGILLA o presidiatele, poi CATTURA.`};
  }
  if(!game.caseHolder&&!game.caseDelivered) return {label:'FASE 2 // RECUPERO',short:`VALIGETTA IN ${caseRoomOf(game)}`,text:`La valigetta MNEMOSYNE è in ${nameOf(game,caseRoomOf(game))}. Raggiungetela e usate RECUPERO.`};
  if(!game.caseDelivered) return {label:'FASE 3 // TRASPORTO',short:`PORTALA IN ${game.dropRoom}`,text:`${carrierOf(game)?.name||'La squadra'} ha la valigetta: portatela in ${nameOf(game,game.dropRoom)}. Chi la porta è il bersaglio prioritario dei presidi.`};
  return {label:'FASE 4 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`Valigetta consegnata. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
}

// Riquadro "carico" nel pannello Board: valigetta, nucleo o informatore a seconda della missione.
function cargoStatus(game:Game){
  if(game.missionId==='nucleo') return {label:'NUCLEO',text:game.purged?`PURGATO — ${nameOf(game,game.dropRoom)}`:game.vaultOpen?`PRONTO IN ${game.vaultRoom}`:`SIGILLATO IN ${game.vaultRoom}`,done:game.purged};
  if(game.missionId==='assedio') return {label:'DOWNLOAD',text:game.download.done?`COMPLETO — ${nameOf(game,game.dropRoom)}`:game.vaultOpen?`${game.download.progress}/${game.download.required} IN ${game.vaultRoom}`:`SIGILLATO IN ${game.vaultRoom}`,done:game.download.done};
  if(game.missionId==='ostaggio') return {label:'INFORMATORE',text:game.hostage.delivered?`CONSEGNATO IN ${game.dropRoom}`:game.hostage.holder?`SCORTATO DA ${hostageCarrierOf(game)?.name} · ${game.hostage.hp}/${game.hostage.maxHp} HP`:game.hostage.freed?`ABBANDONATO IN ${hostageRoomOf(game)} · ${game.hostage.hp}/${game.hostage.maxHp} HP`:`IN CELLA IN ${game.vaultRoom}`,done:game.hostage.delivered};
  if(game.missionId==='reattore') return {label:'REATTORE',text:game.reactor.exploded?`DETONATO — ${nameOf(game,game.dropRoom)}`:game.reactor.armed?`INNESCATO · ${game.reactor.fuse} TURNI AL DETONARE`:game.vaultOpen?`PRONTO IN ${game.vaultRoom}`:`SIGILLATO IN ${game.vaultRoom}`,done:game.reactor.exploded};
  if(game.missionId==='spettro'){
    const s=game.specter;
    const exits=game.specterExits||[];
    return {label:'SPETTRO',text:s?.captured?`IN GABBIA — ${nameOf(game,game.dropRoom)}`:!s?.awake?`DORMIENTE IN ${game.vaultRoom}`:exits.length?`IN FUGA IN ${s.room} · ${exits.length} ${exits.length===1?'VIA':'VIE'} DI FUGA`:`BRACCATO IN ${s.room}`,done:Boolean(s?.captured)};
  }
  return {label:'VALIGETTA',text:game.caseDelivered?`CONSEGNATA IN ${game.dropRoom}`:game.caseHolder?`IN MANO A ${carrierOf(game)?.name}`:game.vaultOpen?`A TERRA IN ${caseRoomOf(game)}`:`SIGILLATA IN ${game.vaultRoom}`,done:game.caseDelivered};
}

// Schermata di fine operazione: il testo segue la missione e la causa reale della sconfitta.
function outcomeText(game:Game){
  const drop=nameOf(game,game.dropRoom);
  if(game.phase==='victory'){
    if(game.missionId==='nucleo') return {title:'NUCLEO CANCELLATO',text:`PURGA completata e squadra estratta da ${drop}. MNEMOSYNE non esiste più.`};
    if(game.missionId==='assedio') return {title:'BACKUP AL SICURO',text:`Trasferimento completato e squadra estratta da ${drop}. La copia di MNEMOSYNE è con voi.`};
    if(game.missionId==='ostaggio') return {title:'INFORMATORE IN SALVO',text:`Informatore consegnato vivo e squadra estratta da ${drop}.`};
    if(game.missionId==='spettro') return {title:'SPETTRO IN GABBIA',text:`SPETTRO catturato e squadra estratta da ${drop}. MNEMOSYNE non ha più dove scappare.`};
    if(game.missionId==='reattore') return {title:'REATTORE DISTRUTTO',text:`Carica innescata, reattore detonato e squadra estratta da ${drop}. MNEMOSYNE non esiste più.`};
    return {title:'MNEMOSYNE È NOSTRO',text:`Valigetta consegnata e squadra estratta da ${drop}. La Helix non sa ancora cosa ha perso.`};
  }
  if(game.missionId==='ostaggio'&&game.hostage.freed&&game.hostage.hp<=0) return {title:'INFORMATORE PERDUTO',text:'L’informatore non ce l’ha fatta: la missione è persa.'};
  if(!game.players.some((player)=>player.hp>0)) return {title:'SQUADRA STERMINATA',text:'Non resta nessun operativo in piedi. La Helix chiude l’operazione.'};
  if(game.alarm>=100) return {title:'SQUADRA NEUTRALIZZATA',text:'La Helix ha saturato il settore. Il segnale clandestino è perduto.'};
  return {title:'SQUADRA NEUTRALIZZATA',text:'Protocollo Helix completato. La squadra è perduta.'};
}

// crypto.randomUUID esiste solo in contesto sicuro: sui telefoni l'indirizzo di rete è http://, quindi serve un fallback.
function makeDeviceId(){
  try{ if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function') return crypto.randomUUID(); }catch{/* contesto non sicuro */}
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}

async function api(path:string, options?:RequestInit){
  const headers=new Headers(options?.headers);
  headers.set('Content-Type','application/json');
  const response=await fetch(path,{...options,headers});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'Connessione interrotta');
  return data;
}

function Meter({value,max=100,tone='cyan'}:{value:number;max?:number;tone?:string}){
  return <span className={`meter ${tone}`}><i style={{width:`${Math.max(0,Math.min(100,value/max*100))}%`}}/></span>;
}

function useSnapshot(code?:string){
  const [snapshot,setSnapshot]=useState<Snapshot>(emptySnapshot);
  const [offline,setOffline]=useState(false);
  // Il poll arriva ogni 800ms ma fra un turno e l'altro la partita resta identica per secondi:
  // si confronta il testo grezzo della risposta e si aggiorna lo stato solo quando cambia
  // davvero. Senza questo confronto ogni poll ricreava l'intero albero React (plancia, token,
  // mini-mappa) e lasciava al garbage collector una copia completa dello stato ogni 800ms.
  const lastText=useRef('');
  // Schede, database nemici, missioni e livelli di rischio non cambiano mai: si chiedono al
  // primo giro e poi si poll-a con `?lean=1`, che li omette (due terzi della risposta).
  const statics=useRef<Pick<Snapshot,'templates'|'enemyRoster'|'missions'|'riskLevels'>|null>(null);
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{
        const params=[code?`code=${code}`:'',statics.current?'lean=1':''].filter(Boolean).join('&');
        const response=await fetch(`/api/state${params?`?${params}`:''}`);
        const text=await response.text();
        if(!active)return;
        if(!response.ok)throw new Error('stato non disponibile');
        setOffline(false);
        if(text===lastText.current)return; // nulla è cambiato: nessun re-render
        lastText.current=text;
        const data=JSON.parse(text) as Snapshot;
        if(data.templates) statics.current={templates:data.templates,enemyRoster:data.enemyRoster,missions:data.missions,riskLevels:data.riskLevels};
        setSnapshot(statics.current?{...data,...statics.current}:data);
      }catch{ if(active)setOffline(true); }
    };
    void load();
    let timer=window.setInterval(load,800);
    // Schermo spento o app in secondo piano (telefoni): niente poll finché non si torna davanti.
    const visibility=()=>{
      clearInterval(timer);
      if(document.visibilityState!=='visible')return;
      void load();
      timer=window.setInterval(load,800);
    };
    document.addEventListener('visibilitychange',visibility);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[code]);
  // Chi imposta lo stato a mano (creazione canale) deve invalidare il confronto, altrimenti il
  // poll successivo con lo stesso testo di prima non riallineerebbe la schermata.
  const applySnapshot=useCallback((next:React.SetStateAction<Snapshot>)=>{lastText.current='';setSnapshot(next);},[]);
  return {snapshot,setSnapshot:applySnapshot,offline};
}


function Setup({templates,missions,riskLevels,enemyRoster,controllerToken,resumable,onResume,onCreated}:{templates:Template[];missions:MissionMeta[];riskLevels:RiskLevel[];enemyRoster:EnemyRosterEntry[];controllerToken:string|null;resumable:boolean;onResume:()=>void;onCreated:(g:Game,controllerToken:string)=>void}){
  // La plancia non assegna più le schede: sceglie missione, rischio e tetto di posti, poi crea il
  // canale. Nome e personaggio li scelgono i giocatori dal telefono in fase di collegamento.
  const [count,setCount]=useState(4);
  const [selected,setSelected]=useState(templates[0]?.id||'');
  const [missionId,setMissionId]=useState(missions[0]?.id||'valigetta');
  const [riskLevel,setRiskLevel]=useState(riskLevels[1]?.id||riskLevels[0]?.id||'medium');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [settings,setSettings]=useState(false);
  const [briefMission,setBriefMission]=useState<MissionMeta|null>(null);
  const preview=templates.find((t)=>t.id===selected)||templates[0];
  const create=async()=>{try{setBusy(true);setError('');const data=await api('/api/setup',{method:'POST',body:JSON.stringify({missionId,maxPlayers:count,riskLevel,controllerToken})});onCreated(data.game,data.controllerToken);}catch(e){playSfx('alert');setError((e as Error).message);setBusy(false);}};
  if(!preview)return <div className="loading">INIZIALIZZAZIONE ARCHIVIO OPERATIVI...</div>;
  return <main className="setup-shell">
    <header className="setup-header"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>MISSION CONTROL</small></div></div><div className="step-line"><span className="active">01 CONFIGURAZIONE</span><i/><span>02 COLLEGAMENTO</span><i/><span>03 OPERAZIONE</span></div><div className="header-tools"><SettingsButton onOpen={()=>setSettings(true)}/><span className="local-tag"><CircleDot size={13}/> SISTEMA LOCALE</span></div></header>
    <section className="setup-grid">
      <aside className="setup-config panel">
        <div className="panel-kicker">PARAMETRI MISSIONE</div>
        <div className="field-label">POSTI OPERATIVO <b>{count}</b></div>
        <div className="count-picker">{[2,3,4,5,6].map((n)=><button className={count===n?'active':''} onClick={()=>setCount(n)} key={n}>{n}</button>)}</div>
        <div className="field-label">RISCHIO</div>
        <div className="risk-picker">{riskLevels.map((r)=>{
          const mod=Math.round(((r.enemyPower??1)-1)*100);
          const rise=r.autoRise?'automatico e da compagno':r.allyRevive?'solo da un compagno':'nessuno';
          return <button type="button" key={r.id} className={riskLevel===r.id?'active':''} onClick={()=>setRiskLevel(r.id)}>{r.label}
            <span className="risk-tip" role="tooltip"><span>Allarme inizia al: <b>{r.alarmStart}%</b></span><span>Modificatori nemici: <b>{mod>0?'+':mod<0?'−':'±'}{Math.abs(mod)}%</b></span><span>Rialzo: <b>{rise}</b></span></span>
          </button>;
        })}</div>
        <div className="field-label">MISSIONE</div>
        <div className="mission-select">{missions.map((m)=>{
          const [num,name]=m.title.split(' // ');
          return <div className="mission-brief-wrap" key={m.id}>
            <button type="button" className={`mission-brief ${missionId===m.id?'selected':''}`} onClick={()=>setMissionId(m.id)} style={m.cover?{backgroundImage:`linear-gradient(180deg, rgba(6,10,16,.35), rgba(6,10,16,.85)), url(${m.cover})`}:undefined}>
              <small>{num}</small><b>{name||m.title}</b>
            </button>
            <button type="button" className="mission-info" aria-label="Apri il briefing della missione" onClick={()=>setBriefMission(m)}><Info size={20}/></button>
          </div>;
        })}</div>
      </aside>
      <section className="roster panel">
        <div className="roster-head"><span className="panel-kicker">SCHEDE OPERATIVE // {templates.length} PROFILI</span></div>
        <div className="setup-cards">{templates.map((t)=>
          <button type="button" key={t.id} className={`setup-card ${selected===t.id?'selected':''}`} style={{'--accent':t.color} as React.CSSProperties} onClick={()=>setSelected(t.id)}>
            <span className="avatar setup-card-portrait"><OpIcon characterId={t.id} alt={t.callsign}/><i>#{t.id.toUpperCase()}-09</i></span>
            <span className="setup-card-id">
              <b>{t.callsign}</b><small>{t.role}</small><em>{t.specialty}</em>
              <span className="setup-card-stats"><i>HP {t.maxHp}</i><i>DMG +{t.dmg}</i></span>
            </span>
          </button>
        )}</div>
      </section>
      <aside className="character-preview panel" style={{'--accent':preview.color} as React.CSSProperties}>
        <div className="panel-kicker">DOSSIER PERSONAGGIO</div><div className="portrait-large"><img src={charImg(preview.id)} alt={preview.callsign} decoding="async"/><i>ARCHIVIO<br/>#{preview.id.toUpperCase()}-09</i></div>
        <small className="role">SCHEDA {preview.callsign} · {preview.role} // {preview.specialty}</small><h2>{preview.callsign}</h2>
        <div className="weapon-showcase"><div className="weapon"><span className="weapon-label"><Crosshair size={15}/> ARMA:</span> <b>{preview.weapon} +{preview.dmg}</b></div><WeaponArt characterId={preview.id} weapon={preview.weapon}/></div>
        <div className="loadout"><span><small>INTEGRITÀ</small><b>{preview.maxHp}</b></span><span><small>DANNO</small><b>+{preview.dmg}</b></span><span><small>CARICATORE</small><b>{preview.mag}</b></span><span><small>FOCUS</small><b>{preview.focus}</b></span></div>
        <div className="ability-card"><Zap size={18}/><div><small>ABILITÀ // -3 FOCUS</small><b>{preview.ability}</b><p>{preview.abilityText}</p></div></div>
        <PassiveAbilities passives={preview.passives}/>
      </aside>
    </section>
    <footer className="setup-footer"><span className="error">{error}</span>{resumable&&<button className="ghost-btn resume-btn" data-sfx="confirm" onClick={onResume} disabled={busy}>CONTINUA PARTITA</button>}<button className="primary-btn" data-sfx="confirm" onClick={create} disabled={busy}>CREA CANALE DI GIOCO <ArrowRight size={18}/></button></footer>
    {settings&&<Settings templates={templates} database={<DatabaseSection templates={templates} enemyRoster={enemyRoster}/>} onClose={()=>setSettings(false)}/>}
    {briefMission&&<MissionBriefing mission={briefMission} onClose={()=>setBriefMission(null)}/>}
  </main>;
}

// GALLERIA SCHEDE: sfoglia tutti i personaggi con abilità e statistiche prima di scegliere.
// `action` (telefono) aggiunge in fondo il comando per la scheda mostrata, es. SELEZIONA.
// `takenBy` (telefono) restituisce il nome di chi ha già confermato la scheda: la card diventa grigia.
function CharacterGallery({templates,startId,onClose,action,takenBy}:{templates:Template[];startId?:string;onClose:()=>void;action?:(t:Template)=>React.ReactNode;takenBy?:(t:Template)=>string|undefined}){
  const last=templates.length-1;
  const start=Math.max(0,templates.findIndex((t)=>t.id===startId));
  const [index,setIndex]=useState(start);
  const step=(delta:number)=>setIndex((i)=>Math.max(0,Math.min(last,i+delta)));
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='ArrowRight')setIndex((i)=>Math.min(templates.length-1,i+1));if(e.key==='ArrowLeft')setIndex((i)=>Math.max(0,i-1));};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose,templates.length]);
  const t=templates[index];
  if(!t)return null;
  const holder=takenBy?.(t);
  return <div className="manual-overlay">
    <button className="manual-scrim" aria-label="Chiudi" onClick={onClose}/>
    <section className="manual gallery">
      <header className="manual-head"><div className="brand"><span className="brand-mark">R//P</span><div><b>SCHEDE OPERATIVI</b><small>ARCHIVIO COMPLETO // {templates.length} PROFILI</small></div></div>
        <div className="gallery-nav"><button onClick={()=>step(-1)} disabled={index===0} aria-label="Precedente"><ChevronLeft size={28} strokeWidth={3.4}/></button><span>{String(index+1).padStart(2,'0')}/{String(templates.length).padStart(2,'0')}</span><button onClick={()=>step(1)} disabled={index===last} aria-label="Successivo"><ChevronRight size={28} strokeWidth={3.4}/></button></div>
        <button className="manual-close" onClick={onClose} aria-label="Chiudi"><X size={18}/></button></header>
      <div className="gallery-body">
        <button className="gallery-arrow" onClick={()=>step(-1)} disabled={index===0} aria-label="Precedente"><ChevronLeft size={26}/></button>
        <article className={`gallery-card ${holder?'taken':''}`} style={{'--accent':t.color} as React.CSSProperties} key={t.id}>
          <div className="portrait-large"><img src={charImg(t.id)} alt={t.callsign} decoding="async"/><i>ARCHIVIO<br/>#{t.id.toUpperCase()}-09</i>{holder&&<em className="taken-badge">OCCUPATO · {holder}</em>}</div>
          <div className="gallery-info">
            <small className="role">{t.role} // {t.specialty}</small><h2>{t.callsign}</h2>
            <div className="loadout"><span><small>INTEGRITÀ</small><b>{t.maxHp}</b></span><span><small>DANNO</small><b>+{t.dmg}</b></span><span><small>CARICATORE</small><b>{t.mag}</b></span><span><small>FOCUS</small><b>{t.focus}</b></span></div>
            <div className="weapon-showcase"><div className="weapon"><span className="weapon-label"><Crosshair size={15}/> ARMA:</span> <b>{t.weapon} +{t.dmg}</b></div><WeaponArt characterId={t.id} weapon={t.weapon}/></div>
            {action&&<div className="gallery-select">{action(t)}</div>}
          </div>
          <div className="ability-card"><Zap size={18}/><div><small>ABILITÀ // -3 FOCUS</small><b>{t.ability}</b><p>{t.abilityText}</p></div></div>
          <PassiveAbilities passives={t.passives}/>
        </article>
        <button className="gallery-arrow" onClick={()=>step(1)} disabled={index===last} aria-label="Successivo"><ChevronRight size={26}/></button>
      </div>
      <footer className="manual-foot"><span>OPERATIVO {String(index+1).padStart(2,'0')} / {String(templates.length).padStart(2,'0')} — {t.callsign} // {t.role}</span><div className="gallery-dots">{templates.map((x,i)=><button key={x.id} className={`${i===index?'on':''} ${takenBy?.(x)?'taken':''}`} style={{'--accent':x.color} as React.CSSProperties} onClick={()=>setIndex(i)} aria-label={x.callsign}/>)}</div><button className="ghost-btn" onClick={onClose}>CHIUDI</button></footer>
    </section>
  </div>;
}

// Testo che si scrive a macchina quando `active` è vero (non prima), poi chiama `onDone` dopo una
// breve pausa: così più testi si susseguono uno alla volta senza timer che si sovrappongono. Il
// testo intero resta invisibile sotto quello scritto, così il riquadro ha subito la sua misura
// finale e non salta mentre si riempie. Con `instant` mostra subito tutto il testo.
function Typewriter({text,speed=32,instant=false,active=true,onDone}:{text:string;speed?:number;instant?:boolean;active?:boolean;onDone?:()=>void}){
  const [shown,setShown]=useState(instant?text.length:0);
  const doneRef=useRef(onDone);
  doneRef.current=onDone;
  useEffect(()=>{
    if(instant){setShown(text.length);return;}
    if(!active)return;
    let interval=0,pause=0,count=0;
    const perTick=speed<=10?2:1; // sotto i ~10ms il timer del browser non scende: si scrivono 2 caratteri a tick
    const finish=()=>{pause=window.setTimeout(()=>doneRef.current?.(),140);};
    setShown(0);
    if(!text.length)finish();
    else interval=window.setInterval(()=>{count=Math.min(text.length,count+perTick);setShown(count);if(count>=text.length){window.clearInterval(interval);finish();}},speed);
    return()=>{window.clearInterval(interval);window.clearTimeout(pause);};
  },[text,speed,instant,active]);
  return <span className="tw"><span className="tw-ghost" aria-hidden="true">{text}</span><span className="tw-live">{shown>0&&<span className="tw-hl">{text.slice(0,shown)}</span>}{shown>0&&shown<text.length&&<i className="feed-caret" aria-hidden="true"/>}</span></span>;
}

// BRIEFING MISSIONE (un'unica schermata): copertina animata sullo sfondo (zoom lento in loop,
// scanline, polvere) e sopra le info della missione scritte a macchina una dopo l'altra.
// SALTA non cambia schermata: mostra subito tutti i testi. Esc chiude, Invio/spazio saltano.
function MissionBriefing({mission,onClose}:{mission:MissionMeta;onClose:()=>void}){
  const [num,name]=mission.title.split(' // ');
  const [fast,setFast]=useState(()=>!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  // Un solo testo alla volta, dall'alto in basso: `step` è l'indice del testo che si sta scrivendo.
  const [step,setStep]=useState(-1);
  useEffect(()=>{const id=window.setTimeout(()=>setStep(0),350);return()=>window.clearTimeout(id);},[]);
  let n=0;
  const seg=(text:string,speed:number)=>({text,speed,i:n++});
  const h3Mission=seg('Missione',18);
  const paras=mission.missione.split('\n\n').map((p)=>seg(p,8));
  const h3Goals=seg('Obiettivi',18);
  const objs=mission.objectives.map((o)=>seg(o,8));
  const finished=step>=n;
  const typed=(s:{text:string;speed:number;i:number})=><Typewriter text={s.text} speed={s.speed} instant={fast} active={step===s.i} onDone={()=>setStep((v)=>Math.max(v,s.i+1))}/>;
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape')onClose();
      else if((e.key==='Enter'||e.key===' ')&&!fast){e.preventDefault();setFast(true);}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[onClose,fast]);
  return <section className="mb-screen" style={mission.cover?{'--cover':`url(${mission.cover})`} as React.CSSProperties:undefined} role="dialog" aria-label={`Briefing: ${mission.title}`}>
    <div className="mb-bg" aria-hidden="true"><i className="mi-layer back"/><i className="mi-layer front"/><i className="mi-dust"/><i className="mi-scan"/><i className="mi-vignette"/></div>
    <header className="mb-head"><div className="brand"><span className="brand-mark">R//P</span><div><b>{num}</b><small>{name||mission.title}</small></div></div><button className="manual-close" onClick={onClose} aria-label="Chiudi"><X size={18}/></button></header>
    <article className="mb-body"><div className="mb-text">
      <h2><span className="tw-hl">{name||mission.title}</span></h2>
      <p className="mb-tag"><span className="tw-hl">{mission.tagline} — obiettivo: <b>{mission.goalHeadline}</b></span></p>
      <h3>{typed(h3Mission)}</h3>
      {paras.map((p,i)=><p key={i}>{typed(p)}</p>)}
      <h3>{typed(h3Goals)}</h3>
      <ol className="manual-steps">{objs.map((o,i)=><li key={i}>{typed(o)}</li>)}</ol>
    </div></article>
    <footer className="mb-foot"><span>{num} — BRIEFING PRE-OPERAZIONE</span><div className="mb-actions">{!fast&&!finished&&<button type="button" className="mb-skip" data-sfx="back" onClick={()=>setFast(true)}>SALTA <ChevronRight size={16}/></button>}<button className="ghost-btn" onClick={onClose}>CHIUDI</button></div></footer>
  </section>;
}

function QrCode({text,size=320}:{text:string;size?:number}){
  const grid=useMemo(()=>{try{return qrMatrix(text);}catch{return null;}},[text]);
  if(!grid)return null;
  const n=grid.length;const quiet=2;const dim=n+quiet*2;
  let path='';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(grid[y][x])path+=`M${x+quiet} ${y+quiet}h1v1h-1z`;
  return <svg className="qr" width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" aria-labelledby="qr-code-title">
    <title id="qr-code-title">QR code per collegarsi alla partita</title>
    <rect width={dim} height={dim} fill="#ffffff"/>
    <path d={path} fill="#050909"/>
  </svg>;
}

function Lobby({game,templates,networkUrl,controllerToken,onStart,onReset}:{game:Game;templates:Template[];networkUrl:string;controllerToken:string|null;onStart:(g:Game)=>void;onReset:()=>void}){
  const playerUrl=`${networkUrl}/player?code=${game.code}`;
  const [error,setError]=useState('');
  const [settings,setSettings]=useState(false);
  const [confirmOpen,setConfirmOpen]=useState(false);
  const [copied,setCopied]=useState(false);
  const joined=game.players.length;
  const linked=game.players.filter((p)=>p.connected).length;
  const freeSeats=Math.max(0,game.maxPlayers-joined);
  const allLinked=joined>0&&linked===joined;
  const start=async()=>{try{setConfirmOpen(false);setError('');const data=await api('/api/start',{method:'POST',body:JSON.stringify({code:game.code,controllerToken})});onStart(data.game);}catch(e){playSfx('alert');setError((e as Error).message);}};
  const copyLink=async()=>{try{await navigator.clipboard.writeText(playerUrl);setCopied(true);playSfx('confirm');setTimeout(()=>setCopied(false),2000);}catch{/* clipboard non disponibile */}};
  return <main className="lobby-shell">
    <header className="setup-header"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>UPLINK LOBBY</small></div></div><div className="step-line"><span>01 CONFIGURAZIONE</span><i/><span className="active">02 COLLEGAMENTO</span><i/><span>03 OPERAZIONE</span></div><div className="header-tools"><SettingsButton onOpen={()=>setSettings(true)}/><span className="local-tag"><Wifi size={13}/> CANALE APERTO</span></div></header>
    <section className="lobby-content">
      <div className="access-block">
        <div className="lobby-section-heading"><small>01 // COLLEGATI ALLA PARTITA</small><h1>INQUADRA ED ENTRA</h1><p>Apri la fotocamera del telefono e scegli il tuo personaggio.</p></div>
        <div className="qr-block"><QrCode text={playerUrl} size={400}/><span><Smartphone size={16}/> SCANSIONA CON IL TELEFONO</span></div>
        <p className="wifi-warning"><Wifi size={16}/> Telefono e plancia devono essere sullo stesso Wi-Fi</p>
        <div className="lobby-access-details"><div className="lobby-code"><small>CODICE PARTITA</small><strong>{game.code}</strong></div><div className="lobby-link"><small>LINK DI ACCESSO</small><div className="link-row"><code>{playerUrl}</code><button type="button" className="copy-btn" onClick={copyLink} aria-label={copied?'Link copiato':'Copia link'}>{copied?<Check size={16}/>:<Copy size={16}/>}</button></div></div></div>
      </div>
      <div className="connection-list">
        <div className="lobby-squad-heading"><div className="lobby-section-heading"><small>02 // SCEGLI IL TUO PERSONAGGIO</small><h2>LA SQUADRA</h2></div><span className="lobby-ready-count"><b>{linked}<span> / {game.maxPlayers}</span></b><small>COLLEGATI</small></span></div>
        <div className="connection-slots" aria-label="Slot dei personaggi">
        {game.players.map((p,index)=><article key={p.id} style={{'--accent':p.color} as React.CSSProperties} className={p.connected?'online':''}><span className="connection-index">0{index+1}</span><span className="avatar"><OpIcon characterId={p.characterId} alt={p.callsign}/></span><div><small>{p.role}</small><b>{p.name}</b></div><WeaponArt characterId={p.characterId} weapon={p.weapon}/><span className="connection-state">{p.connected?<><Wifi size={15}/> COLLEGATO</>:<><WifiOff size={15}/> IN ATTESA</>}</span></article>)}
        {Array.from({length:freeSeats}).map((_,i)=><article key={`free-${i}`} className="waiting"><span className="connection-index">0{joined+i+1}</span><span className="avatar">—</span><div><small>POSTO LIBERO</small><b>In attesa di un operativo</b></div><span className="connection-weapon placeholder"/><span className="connection-state"><Smartphone size={15}/> DAL TELEFONO</span></article>)}
        </div>
        <p className="lobby-squad-hint"><Smartphone size={15}/> Gli slot si riempiono quando i giocatori scelgono un personaggio dal telefono.</p>
      </div>
    </section>
    <footer className="setup-footer"><button className="ghost-btn" onClick={onReset}>ANNULLA E RICOMINCIA</button><span className="error">{error}</span><span>{linked} / {joined} COLLEGATI · {joined} / {game.maxPlayers} POSTI</span><button className="primary-btn" data-sfx="confirm" onClick={()=>allLinked?start():setConfirmOpen(true)}>AVVIA OPERAZIONE <Swords size={18}/></button></footer>
    {confirmOpen&&<div className="settings-overlay">
      <button className="settings-scrim" aria-label="Chiudi" onClick={()=>setConfirmOpen(false)}/>
      <div className="panel settings-card" style={{width:'min(720px,100%)',height:'auto'}}>
      <div className="settings-head"><div><small>COLLEGAMENTO INCOMPLETO</small><b>AVVIARE COMUNQUE?</b></div></div>
      <div className="settings-body" style={{flex:'0 0 auto'}}><p style={{margin:0}}>{joined===0?'Nessun operativo è ancora collegato dal telefono. ':`Non tutti i dispositivi sono collegati: ${linked} / ${joined}. `}Puoi avviare lo stesso per vedere plancia e mappa, ma i giocatori non collegati resteranno in attesa e il round non si chiude finché nessun telefono è connesso.</p></div>
      <div className="settings-foot" style={{justifyContent:'space-between'}}><button className="ghost-btn" onClick={()=>setConfirmOpen(false)}>ANNULLA</button><button className="primary-btn" data-sfx="confirm" onClick={start}>AVVIA COMUNQUE <Swords size={18}/></button></div>
    </div></div>}
    {settings&&<Settings templates={templates} onClose={()=>setSettings(false)}/>}
  </main>;
}

// Barra di trasferimento sulla stanza obiettivo (MISSIONE 04 // ULTIMO BACKUP): visibile da quando
// la sorgente è aperta, piena e verde a trasferimento completo.
const downloadBarOf=(game:Game)=>game.missionId==='assedio'&&(game.vaultOpen||game.download.progress>0)
  ?{room:game.vaultRoom,value:game.download.progress,max:game.download.required,done:game.download.done,label:game.download.done?'TRASFERIMENTO COMPLETO':'DOWNLOAD MNEMOSYNE'}
  :undefined;

function TacticalMap({game,selfId,hits,dying,blackout,rising=[]}:{game:Game;selfId?:string;hits?:Hit[];dying?:Set<string>;blackout?:boolean;rising?:string[]}){
  const breached=useNodeBreaches(game);
  const pawns=pawnsOf(game,selfId);
  return <BoardMapView
    pulse={breached}
    missionId={game.missionId}
    rooms={roomsOf(game)}
    pawnsIn={(roomId)=>pawns(roomId).map((p)=>rising.includes(p.id)?{...p,rising:true}:p)}
    progress={downloadBarOf(game)}
    foesIn={foesOf(game,dying)}
    marksIn={marksOf(game)}
    doors={game.doors}
    cameras={game.cameras}
    chests={game.chests}
    fogged={foggedOf(game)}
    hits={hits}
    lockdown={game.lockdown}
    blackout={blackout}
  />;
}

// Segue chi passa da vivo a morto fra un poll e l'altro (game.enemies non perde mai le voci a
// hp<=0) e tiene il loro id "in dissolvenza" per DEATH_FADE_MS: il tempo che serve al token/alla
// card per completare l'animazione di collasso (vedi .token.dying/.threat-card.dying in
// styles.css) prima di sparire per davvero da mappa e lista minacce.
const DEATH_FADE_MS=650;
function useDyingEnemies(game:Game|null){
  const prev=useRef<{code:string;alive:Set<string>}>({code:'',alive:new Set()});
  const [dying,setDying]=useState<Set<string>>(new Set());
  useEffect(()=>{
    if(!game)return;
    const aliveNow=new Set(game.enemies.filter((e)=>e.hp>0).map((e)=>e.id));
    const sameGame=prev.current.code===game.code;
    const freshlyDead=sameGame?game.enemies.filter((e)=>e.hp<=0&&prev.current.alive.has(e.id)).map((e)=>e.id):[];
    prev.current={code:game.code,alive:aliveNow};
    if(!freshlyDead.length)return;
    setDying((d)=>new Set([...d,...freshlyDead]));
    const timer=setTimeout(()=>setDying((d)=>{const next=new Set(d);for(const id of freshlyDead)next.delete(id);return next;}),DEATH_FADE_MS);
    return()=>clearTimeout(timer);
  },[game]);
  return dying;
}

function AlarmReadout({alarm}:{alarm:number}){
  const [hovering,setHovering]=useState(false);
  const [pinned,setPinned]=useState(false);
  const [pos,setPos]=useState<{top:number;right:number}|null>(null);
  const open=hovering||pinned;
  const ref=useRef<HTMLSpanElement>(null);
  const tipRef=useRef<HTMLDivElement>(null);
  const closeTimer=useRef<number|undefined>(undefined);
  // La legenda va in un portal su <body> (position:fixed): dentro la topbar finiva sotto la mappa.
  // Chip e legenda condividono l'hover, con un breve ritardo in chiusura per attraversare lo stacco.
  // Sul chip serve onMouseOver, non onMouseEnter: per React il portal è figlio del chip, quindi
  // tornando dalla legenda al chip scatterebbe solo il leave della legenda e mai un nuovo enter.
  const enter=()=>{window.clearTimeout(closeTimer.current);setHovering(true);};
  const leave=()=>{window.clearTimeout(closeTimer.current);closeTimer.current=window.setTimeout(()=>setHovering(false),140);};
  useEffect(()=>()=>window.clearTimeout(closeTimer.current),[]);
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const r=ref.current?.getBoundingClientRect();if(r)setPos({top:r.bottom+11,right:window.innerWidth-r.right-1});};
    place();
    window.addEventListener('resize',place);
    return()=>window.removeEventListener('resize',place);
  },[open,alarm]);
  useEffect(()=>{
    if(!pinned)return;
    const onOutside=(e:PointerEvent)=>{const t=e.target as Node;if(!ref.current?.contains(t)&&!tipRef.current?.contains(t))setPinned(false);};
    document.addEventListener('pointerdown',onOutside);
    return()=>document.removeEventListener('pointerdown',onOutside);
  },[pinned]);
  const shown=useCountUp(alarm);
  const deltas=useAlarmDeltas(alarm);
  const riseKey=useRiseKey(alarm);
  const near=alarmNearness(alarm);
  return <span ref={ref} className={`danger alarm-chip${open?' open':''}${near?' near':''}`} style={near?{'--near':near} as React.CSSProperties:undefined} role="button" tabIndex={0} aria-expanded={open}
    onMouseOver={enter} onMouseLeave={leave} onFocus={enter} onBlur={leave}
    onClick={(e)=>{if(!tipRef.current?.contains(e.target as Node))setPinned((v)=>!v);}}
    onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setPinned((v)=>!v);}}}>
    {riseKey>0&&<i className="alarm-flash" key={riseKey} aria-hidden="true"/>}
    <ShieldAlert size={16}/> ALLARME <b>{shown}%</b>
    {deltas.length>0&&<i className="alarm-deltas" aria-hidden="true">{deltas.map((d)=><i className={d.delta>0?'up':'down'} key={d.id}>{d.delta>0?'+':'−'}{Math.abs(d.delta)}</i>)}</i>}
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- hover condiviso col chip */}
    {createPortal(<div ref={tipRef} className={`alarm-tip${open&&pos?' open':''}`} role="tooltip"
      style={pos?{top:pos.top,right:pos.right}:undefined} onMouseEnter={enter} onMouseLeave={leave}>
      <div className="alarm-tip-head"><ShieldAlert size={13}/> TRACCIA HELIX</div>
      <p className="alarm-tip-lede">A ogni turno che si chiude l’ago sale:</p>
      <ul className="alarm-tip-list">
        <li><b>+1%</b><span>Ad ogni fine turno operativo.</span></li>
        <li><b>+5%</b><span>Ad ogni nodo violato.</span></li>
        <li><b>+10%</b><span>Quando l’obiettivo principale della missione viene sbloccato.</span></li>
        <li><b>+3%</b><span>Ogni volta che un operativo va a terra.</span></li>
      </ul>
      <div className="alarm-tip-sub calm">CHI LA RIPORTA GIÙ</div>
      <ul className="alarm-tip-list calm">
        <li><b>−2%</b><span>ECHO inietta un’Identità sintetica</span></li>
      </ul>
      <div className="alarm-tip-thr">
        <div className="thr"><b>25%<br/>85%</b><div><strong>TRACCIA HELIX</strong><span>A ogni soglia — 25, 35, 45, 55, 65, 75, 85% — una nuova unità (HELIX SEGUGIO) entra nella penultima stanza prima dell’EXIT e parte subito a caccia della squadra.</span></div></div>
        <div className="thr"><b>50%</b><div><strong>BLACKOUT</strong><span>La torre stacca la corrente: ogni porta, anche quelle già sbloccate, si richiude. Si riapre come sempre con SBLOCCA PORTA.</span></div></div>
        <div className="thr"><b>70%</b><div><strong>LOCKDOWN</strong><span>La torre allerta ogni presidio, anche quello mai ingaggiato: da qui in poi tutti i nemici convergono verso la stanza dei Player.</span></div></div>
        <div className="thr dead"><b>100%</b><div><strong>SATURAZIONE</strong><span>La Helix chiude il settore: il segnale clandestino è perso e la squadra con lui.</span></div></div>
      </div>
    </div>,document.body)}
  </span>;
}

// Quando un HELIX SEGUGIO entra per una soglia d'allarme, confrontiamo la lista nemici a ogni
// poll: gli id nuovi (non ancora visti su questo game.code) vanno in coda per l'avviso a tutto
// schermo. Se ne entrano più di uno nello stesso round restano in coda e si mostrano uno alla volta.
// Il confronto vale solo fra due poll entrambi a partita attiva: il presidio iniziale nasce
// all'avvio (/api/start, lobby → active) e non deve contare come minaccia nuova.
function useSpawnAlerts(game:Game|null){
  const seen=useRef<{code:string;phase:string;ids:Set<string>}>({code:'',phase:'',ids:new Set()});
  const [queue,setQueue]=useState<Enemy[]>([]);
  useEffect(()=>{
    if(!game)return;
    const ids=new Set(game.enemies.map((e)=>e.id));
    const known=seen.current;
    seen.current={code:game.code,phase:game.phase,ids};
    if(known.code!==game.code||known.phase!=='active'||game.phase!=='active')return;
    const fresh=game.enemies.filter((e)=>e.hp>0&&!known.ids.has(e.id));
    if(fresh.length){playSfx('alert');setQueue((q)=>[...q,...fresh]);}
  },[game]);
  // `dismiss` stabile: se cambiasse a ogni poll (800ms) il timer di chiusura di SpawnAlert
  // ripartirebbe da capo e l'avviso non si chiuderebbe mai da solo.
  const dismiss=useCallback(()=>setQueue((q)=>q.slice(1)),[]);
  return {current:queue[0]||null,dismiss};
}

// LOCKDOWN: stesso schema di useSpawnAlerts, ma l'evento è il fronte di salita di game.lockdown
// (false→true) invece di un nuovo id nemico — l'avviso a tutto schermo scatta una sola volta
// all'ingresso in lockdown, non a ogni poll finché resta attivo.
function useLockdownAlert(game:Game|null){
  const seen=useRef<{code:string;phase:string;lockdown:boolean}>({code:'',phase:'',lockdown:false});
  const [active,setActive]=useState(false);
  useEffect(()=>{
    if(!game)return;
    const known=seen.current;
    seen.current={code:game.code,phase:game.phase,lockdown:game.lockdown};
    if(known.code!==game.code||known.phase!=='active'||game.phase!=='active')return;
    if(!known.lockdown&&game.lockdown)setActive(true);
  },[game]);
  const dismiss=useCallback(()=>setActive(false),[]);
  return {active,dismiss};
}

// BLACKOUT: stesso schema di useLockdownAlert, sul fronte di salita di game.blackout.
function useBlackoutAlert(game:Game|null){
  const seen=useRef<{code:string;phase:string;blackout:boolean}>({code:'',phase:'',blackout:false});
  const [active,setActive]=useState(false);
  useEffect(()=>{
    if(!game)return;
    const known=seen.current;
    seen.current={code:game.code,phase:game.phase,blackout:game.blackout};
    if(known.code!==game.code||known.phase!=='active'||game.phase!=='active')return;
    if(!known.blackout&&game.blackout)setActive(true);
  },[game]);
  const dismiss=useCallback(()=>setActive(false),[]);
  return {active,dismiss};
}

// FEEDBACK COLPO IN TEMPO REALE
// Il server accoda ogni variazione d'integrità in `game.hits` con un id progressivo (vedi `hit`
// in server.mjs). Qui, a ogni poll, si prendono le voci più recenti di quella già vista e si
// tengono "vive" per HIT_FLASH_MS: finché lo sono, sopra il token colpito sale il numero del
// danno e il token lampeggia (BoardMap). Stesso schema di useSpawnAlerts: si confrontano due
// poll, niente arretrati al primo caricamento di una partita.
// HIT_FLASH_MS e HIT_STAGGER_MS devono restare allineati a durata e ritardo di .hit-float in
// styles.css: più colpi arrivati insieme partono sfalsati, e il numero più in ritardo deve
// arrivare in fondo alla sua animazione prima di essere tolto di scena.
const HIT_FLASH_MS=1200,HIT_STAGGER_MS=120;
const HITS_PER_POLL=8; // un telefono tornato da uno sfondo lungo non deve sparare 24 numeri insieme
function useHitFlashes(game:Game|null){
  const seen=useRef({code:'',id:0});
  const timers=useRef<ReturnType<typeof setTimeout>[]>([]);
  const [live,setLive]=useState<Hit[]>([]);
  useEffect(()=>()=>{timers.current.forEach(clearTimeout);},[]);
  useEffect(()=>{
    if(!game)return;
    const hits=game.hits||[];
    const last=hits.length?hits[hits.length-1].id:0;
    const known=seen.current;
    // Partita nuova (o prima lettura): si parte dal presente, senza rigiocare i colpi già avvenuti.
    if(known.code!==game.code){seen.current={code:game.code,id:last};setLive([]);return;}
    if(last<=known.id)return;
    seen.current={code:game.code,id:last};
    const fresh=hits.filter((h)=>h.id>known.id).slice(-HITS_PER_POLL);
    if(!fresh.length)return;
    setLive((l)=>[...l,...fresh]);
    const ids=new Set(fresh.map((h)=>h.id));
    const timer=setTimeout(()=>{
      timers.current=timers.current.filter((t)=>t!==timer);
      setLive((l)=>l.filter((h)=>!ids.has(h.id)));
    },HIT_FLASH_MS+(fresh.length-1)*HIT_STAGGER_MS);
    timers.current.push(timer);
  },[game]);
  return live;
}

// REGIA DEGLI EVENTI (solo plancia)
// Il server registra in `game.events` ogni cosa da animare, numerata. Qui gli eventi nuovi vanno
// in coda e si riproducono uno step alla volta: gli eventi sciolti (azioni del turno) subito, la
// risposta della torre a un turno chiuso per fasi — prima i nemici si muovono, poi colpiscono,
// poi sale l'allarme, poi SEGUGI/LOCKDOWN/BLACKOUT/rialzi, infine passa la mano.
// Finché un evento è in coda la plancia mostra lo stato "di prima" per quello che l'evento
// cambia (`rewindGame`): così tutti gli hook che confrontano due poll (avvisi SEGUGIO, LOCKDOWN,
// BLACKOUT, fascia di turno, allarme, schermata finale) scattano da soli al momento giusto.
const TOWER_STEP_MS=[760,1080,640,720,0]; // durata di ogni fase della torre, indicizzata per `phase`
const RISE_MS=1800; // allineato a .token-slot.rising in styles.css
const DIRECTOR_MAX_PENDING=60; // oltre, la plancia è rimasta troppo indietro: si salta al presente

// Raggruppa per batch (sempre contigui: nascono nella stessa richiesta) e ordina ogni batch per fase,
// lasciando nell'ordine originale gli eventi della stessa fase.
function orderEvents(fresh:GameEvent[]){
  const out:GameEvent[]=[];
  for(let i=0;i<fresh.length;){
    const batch=fresh[i].batch;
    if(!batch){out.push(fresh[i]);i++;continue;}
    let j=i;
    while(j<fresh.length&&fresh[j].batch===batch)j++;
    out.push(...fresh.slice(i,j).map((e,k)=>({e,k})).sort((a,b)=>a.e.phase-b.e.phase||a.k-b.k).map(({e})=>e));
    i=j;
  }
  return out;
}

// Riporta lo stato a prima degli eventi ancora in coda, dal più recente al più vecchio.
function rewindGame(game:Game,pending:GameEvent[]):Game{
  if(!pending.length)return game;
  const g:Game={...game,players:game.players.map((p)=>({...p})),enemies:game.enemies.map((e)=>({...e})),hostage:{...game.hostage},download:{...game.download},nodes:{...game.nodes},specter:game.specter?{...game.specter}:game.specter};
  const str=(v:unknown)=>typeof v==='string'?v:'';
  const num=(v:unknown)=>typeof v==='number'?v:0;
  for(let i=pending.length-1;i>=0;i--){
    const e=pending[i];
    switch(e.type){
      case 'move':{const p=g.players.find((x)=>x.id===e.playerId);if(p&&str(e.from))p.room=str(e.from);break;}
      case 'enemyMove':{const foe=g.enemies.find((x)=>x.id===e.enemyId);if(foe&&str(e.from))foe.room=str(e.from);break;}
      case 'specter':if(g.specter&&str(e.from))g.specter.room=str(e.from);break;
      case 'hit':{
        const delta=num(e.amount)*(e.kind==='heal'?-1:1);
        if(e.targetId==='hostage'){g.hostage.hp=Math.max(0,Math.min(g.hostage.maxHp,g.hostage.hp+delta));break;}
        const unit=g.players.find((x)=>x.id===e.targetId)||g.enemies.find((x)=>x.id===e.targetId);
        if(unit)unit.hp=Math.max(0,Math.min(unit.maxHp,unit.hp+delta));
        break;
      }
      case 'spawn':g.enemies=g.enemies.filter((x)=>x.id!==e.enemyId);break;
      case 'alarm':g.alarm=num(e.from);break;
      case 'lockdown':g.lockdown=false;break;
      case 'blackout':g.blackout=false;if(e.doors&&typeof e.doors==='object')g.doors=e.doors as Record<string,boolean>;break;
      case 'download':g.download.progress=num(e.from);g.download.done=false;break;
      case 'breach':if(str(e.room)){g.nodes[str(e.room)]=false;g.breach=Math.max(0,g.breach-1);}break;
      case 'handoff':g.activePlayerId=typeof e.from==='string'?e.from:g.activePlayerId;if(num(e.fromRound))g.round=num(e.fromRound);break;
      case 'phase':if(str(e.from))g.phase=str(e.from) as Game['phase'];break;
    }
  }
  return g;
}

function useEventDirector(game:Game){
  const seen=useRef({code:'',seq:0});
  const [queue,setQueue]=useState<GameEvent[]>([]);
  const [live,setLive]=useState<Hit[]>([]);
  const [rising,setRising]=useState<string[]>([]);
  const busy=useRef(false);
  const timers=useRef<number[]>([]);
  // I timer non sono legati al cleanup degli effetti: la coda cambia identità a ogni evento nuovo
  // e non deve interrompere lo step in corso.
  const later=useCallback((fn:()=>void,ms:number)=>{
    const timer=window.setTimeout(()=>{timers.current=timers.current.filter((t)=>t!==timer);fn();},ms);
    timers.current.push(timer);
  },[]);
  useEffect(()=>()=>{timers.current.forEach(clearTimeout);},[]);
  useEffect(()=>{
    const events=game.events||[];
    const last=events.length?events[events.length-1].seq:0;
    const known=seen.current;
    // Prima lettura o partita nuova: si parte dal presente, niente arretrati.
    if(known.code!==game.code){seen.current={code:game.code,seq:last};setQueue([]);return;}
    // Contatore tornato indietro (server riavviato con uno stato più vecchio): si riallinea.
    if(last<known.seq){seen.current={code:game.code,seq:last};return;}
    if(last===known.seq)return;
    const fresh=events.filter((e)=>e.seq>known.seq);
    seen.current={code:game.code,seq:last};
    setQueue((q)=>{const next=[...q,...orderEvents(fresh)];return next.length>DIRECTOR_MAX_PENDING?[]:next;});
  },[game]);
  useEffect(()=>{
    if(busy.current||!queue.length)return;
    const head=queue[0];
    const step:GameEvent[]=[];
    for(const e of queue){
      if(head.batch?(e.batch===head.batch&&e.phase===head.phase):!e.batch)step.push(e);
      else break;
    }
    busy.current=true;
    const fresh:Hit[]=step.filter((e)=>e.type==='hit').map((e)=>({id:e.seq,targetId:String(e.targetId),room:String(e.room),amount:Number(e.amount)||0,kind:String(e.kind),...(typeof e.sourceId==='string'?{sourceId:e.sourceId}:{})}));
    // Sparo e danno insieme: il colpo parte nello stesso istante in cui sale il numero.
    if(fresh.some((h)=>h.sourceId&&h.kind!=='heal'))playSfx('shoot');
    if(fresh.length){
      setLive((l)=>[...l,...fresh]);
      const ids=new Set(fresh.map((h)=>h.id));
      later(()=>setLive((l)=>l.filter((h)=>!ids.has(h.id))),HIT_FLASH_MS+(fresh.length-1)*HIT_STAGGER_MS);
    }
    const rose=step.filter((e)=>e.type==='rise').map((e)=>String(e.playerId));
    if(rose.length){
      setRising((r)=>[...r,...rose]);
      later(()=>setRising((r)=>r.filter((id)=>!rose.includes(id))),RISE_MS);
    }
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const done=new Set(step.map((e)=>e.seq));
    later(()=>{busy.current=false;setQueue((q)=>q.filter((e)=>!done.has(e.seq)));},head.batch&&!reduced?(TOWER_STEP_MS[head.phase]??600):0);
  },[queue,later]);
  const view=useMemo(()=>rewindGame(game,queue),[game,queue]);
  return {view,hits:live,rising};
}

// DANNO SUBITO (telefono): ogni colpo nuovo sul proprio operativo fa tremare lo schermo, lo fa
// lampeggiare del colore del personaggio e mostra quanta integrità si è persa. Legge lo stesso
// registro eventi della plancia, ma senza regia: il telefono reagisce subito.
const SELF_DAMAGE_MS=1500; // allineato a .damage-flash in styles.css
function useSelfDamage(game:Game,playerId:string){
  const seen=useRef({code:'',seq:0});
  const [flash,setFlash]=useState<{id:number;amount:number}|null>(null);
  useEffect(()=>{
    const events=game.events||[];
    const last=events.length?events[events.length-1].seq:0;
    const known=seen.current;
    if(known.code!==game.code||last<known.seq){seen.current={code:game.code,seq:last};return;}
    if(last===known.seq)return;
    const fresh=events.filter((e)=>e.seq>known.seq&&e.type==='hit'&&e.targetId===playerId&&e.kind!=='heal');
    seen.current={code:game.code,seq:last};
    if(!fresh.length)return;
    setFlash({id:fresh[fresh.length-1].seq,amount:fresh.reduce((sum,e)=>sum+(Number(e.amount)||0),0)});
    try{navigator.vibrate?.([140,50,80]);}catch{/* vibrazione non disponibile */}
  },[game,playerId]);
  useEffect(()=>{if(!flash)return;const t=setTimeout(()=>setFlash(null),SELF_DAMAGE_MS);return()=>clearTimeout(t);},[flash]);
  return flash;
}

// ATTIVAZIONI SPECIALI IN TEMPO REALE
// La coda è distinta dalle azioni del turno: queste vengono azzerate a fine turno, mentre gli
// eventi restano disponibili abbastanza a lungo da essere intercettati dalla plancia in polling.
function useAbilityAlerts(game:Game|null){
  const seen=useRef({code:'',id:0});
  const [queue,setQueue]=useState<AbilityActivation[]>([]);
  useEffect(()=>{
    if(!game)return;
    const activations=game.abilityActivations||[];
    const last=activations.length?activations[activations.length-1].id:0;
    const known=seen.current;
    // Prima lettura o nuova operazione: mostriamo solo ciò che succede da questo momento in poi.
    if(known.code!==game.code){seen.current={code:game.code,id:last};setQueue([]);return;}
    if(last<=known.id)return;
    const fresh=activations.filter((activation)=>activation.id>known.id);
    seen.current={code:game.code,id:last};
    if(fresh.length){playSfx('confirm');setQueue((pending)=>[...pending,...fresh]);}
  },[game]);
  const dismiss=useCallback(()=>setQueue((pending)=>pending.slice(1)),[]);
  return {current:queue[0]||null,dismiss};
}

// PORTE SBLOCCATE: effetto sonoro sui fronti nuovi di game.unlocks. Sulla plancia (nessun
// `onlyPlayerId`) suona sempre; sul telefono solo per lo sblocco fatto da quel giocatore.
function useUnlockSound(game:Game|null,onlyPlayerId?:string){
  const seen=useRef({code:'',id:0});
  useEffect(()=>{
    if(!game)return;
    const unlocks=game.unlocks||[];
    const last=unlocks.length?unlocks[unlocks.length-1].id:0;
    const known=seen.current;
    if(known.code!==game.code){seen.current={code:game.code,id:last};return;}
    if(last<=known.id)return;
    const fresh=unlocks.filter((u)=>u.id>known.id);
    seen.current={code:game.code,id:last};
    if(fresh.some((u)=>!onlyPlayerId||u.playerId===onlyPlayerId))playSfx('doorunlock');
  },[game,onlyPlayerId]);
}

// MODIFICHE DALLE CASSE
// Stessa coda con id progressivo delle attivazioni speciali: la plancia mostra solo gli eventi
// arrivati dopo il proprio caricamento, uno alla volta.
function useModDrops(game:Game|null){
  const seen=useRef({code:'',id:0});
  const [queue,setQueue]=useState<ModDrop[]>([]);
  useEffect(()=>{
    if(!game)return;
    const drops=game.modDrops||[];
    const last=drops.length?drops[drops.length-1].id:0;
    const known=seen.current;
    if(known.code!==game.code){seen.current={code:game.code,id:last};setQueue([]);return;}
    if(last<=known.id)return;
    const fresh=drops.filter((drop)=>drop.id>known.id);
    seen.current={code:game.code,id:last};
    if(fresh.length){playSfx('confirm');setQueue((pending)=>[...pending,...fresh]);}
  },[game]);
  const dismiss=useCallback(()=>setQueue((pending)=>pending.slice(1)),[]);
  return {current:queue[0]||null,dismiss};
}

// Avviso a tutto schermo: dimensione fissa (non si adatta al testo, è il testo che ci sta
// dentro), foto del nemico grande, chiusura manuale o dopo SPAWN_ALERT_SECONDS. Durata, sirena
// e pulsazione (vedi .spawn-alert-pulse in styles.css) sono tutte allineate a questo stesso
// valore, così l'avviso visivo e quello sonoro restano equivalenti.
const SPAWN_ALERT_SECONDS=5;
function SpawnAlert({enemy,roomName,onClose}:{enemy:Enemy;roomName:string;onClose:()=>void}){
  useEffect(()=>{const t=setTimeout(onClose,SPAWN_ALERT_SECONDS*1000);return()=>clearTimeout(t);},[enemy,onClose]);
  useEffect(()=>{playSiren(SPAWN_ALERT_SECONDS);},[enemy.id]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  return <div className="spawn-alert spawn-alert--threat" role="alertdialog" aria-modal="true" aria-labelledby={`threat-alert-${enemy.id}`}>
    <button className="spawn-alert-scrim" aria-label="Chiudi avviso" onClick={onClose}/>
    <div className="spawn-alert-card">
      <i className="spawn-alert-scan" aria-hidden="true"/>
      <header className="spawn-alert-head">
        <span><ShieldAlert size={16}/> TRACCIA HELIX // CONTATTO OSTILE</span>
        <small><i/> PRIORITÀ 01</small>
      </header>
      <div className="spawn-alert-target">
        <div className="spawn-alert-portrait"><FoeIcon kind={enemyKind(enemy.id)} alt={enemy.type}/></div>
        <Crosshair className="spawn-alert-reticle" aria-hidden="true"/>
        <span className="spawn-alert-target-label">TARGET ACQUISITO</span>
      </div>
      <div className="spawn-alert-identity">
        <small>UNITÀ NON AUTORIZZATA</small>
        <b id={`threat-alert-${enemy.id}`} className="spawn-alert-name">{enemy.name}</b>
      </div>
      <div className="spawn-alert-data" aria-label={`Tipo ${enemy.type}, danno ${enemy.damage}, integrità ${enemy.hp} su ${enemy.maxHp}`}>
        <span><small>CLASSE</small><b>{enemy.type}</b></span>
        <span><small>DANNO</small><b>+{enemy.damage}</b></span>
        <span><small>INTEGRITÀ</small><b>{enemy.hp}<em>/{enemy.maxHp}</em></b></span>
      </div>
      <p className="spawn-alert-text"><b>{enemy.room} // {roomName}</b><span>Il segugio ha agganciato la squadra. Preparare il contatto.</span></p>
      <footer className="spawn-alert-footer"><span><i/> CHIUSURA AUTOMATICA</span><button className="primary-btn" data-sfx="confirm" onClick={onClose}>RICEVUTO <Check size={17}/></button></footer>
    </div>
  </div>;
}

// Avviso a tutto schermo per l'ingresso in LOCKDOWN: stessa card/sirena/durata di SpawnAlert,
// solo testo al posto del ritratto nemico (nessun nemico specifico da mostrare).
function LockdownAlert({onClose}:{onClose:()=>void}){
  useEffect(()=>{const t=setTimeout(onClose,SPAWN_ALERT_SECONDS*1000);return()=>clearTimeout(t);},[onClose]);
  useEffect(()=>{playSiren(SPAWN_ALERT_SECONDS);},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  return <div className="spawn-alert spawn-alert--lockdown" role="alertdialog" aria-modal="true" aria-labelledby="lockdown-alert-title">
    <button className="spawn-alert-scrim" aria-label="Chiudi avviso" onClick={onClose}/>
    <div className="spawn-alert-card lockdown-alert-card">
      <i className="spawn-alert-scan" aria-hidden="true"/>
      <header className="spawn-alert-head">
        <span><ShieldAlert size={16}/> ALLARME TORRE // CONTENIMENTO</span>
        <small><i/> LIVELLO 70%</small>
      </header>
      <div className="lockdown-alert-core" aria-hidden="true"><i/><i/><i/><LockKeyhole/></div>
      <div className="lockdown-alert-copy">
        <small>SOGLIA CRITICA SUPERATA</small>
        <b id="lockdown-alert-title" className="lockdown-alert-text">LOCKDOWN<br/>IN CORSO</b>
      </div>
      <div className="lockdown-alert-status"><span><i/> PORTE E PRESIDI BLOCCATI</span><span>RISPOSTA HELIX: TOTALE</span></div>
      <p className="spawn-alert-text">Ogni presidio del settore è stato allertato e converge sulla posizione della squadra.</p>
      <footer className="spawn-alert-footer"><span><i/> PROTOCOLLO ATTIVO</span><button className="primary-btn" data-sfx="confirm" onClick={onClose}>RICEVUTO <Check size={17}/></button></footer>
    </div>
  </div>;
}

const ABILITY_ALERT_SECONDS=4;
// Avviso minimale: sostituisce lo header del box operativo nella squadbar (niente più overlay
// a schermo intero, che copriva la mappa) per il tempo dell'attivazione.
function AbilityAlert({activation,onClose}:{activation:AbilityActivation;onClose:()=>void}){
  useEffect(()=>{const timer=setTimeout(onClose,ABILITY_ALERT_SECONDS*1000);return()=>clearTimeout(timer);},[activation.id,onClose]);
  return <button type="button" className="ability-alert" style={{'--ability-accent':activation.color} as React.CSSProperties} onClick={onClose} aria-label={`Abilità attivata: ${activation.ability}`}>
    <i className="ability-alert-scan" aria-hidden="true"/>
    <Zap size={14}/>
    <div><small>PROTOCOLLO ATTIVATO</small><b>{activation.ability}</b></div>
  </button>;
}

const MOD_DROP_SECONDS=4;
// Pop-up al centro della plancia: chi ha aperto la cassa e, sotto in grande, la modifica uscita.
// Sparisce da solo dopo MOD_DROP_SECONDS (o al clic), senza mai bloccare la partita.
function ModDropAlert({drop,onClose}:{drop:ModDrop;onClose:()=>void}){
  useEffect(()=>{const timer=setTimeout(onClose,MOD_DROP_SECONDS*1000);return()=>clearTimeout(timer);},[drop.id,onClose]);
  return <div className="mod-drop" style={{'--accent':drop.color} as React.CSSProperties} role="alert">
    <button type="button" className="mod-drop-card" onClick={onClose} aria-label={`${drop.playerName} ha trovato ${drop.modName}`}>
      <i className="mod-drop-scan" aria-hidden="true"/>
      <span className="mod-drop-kicker"><PackagePlus size={15}/> CASSA APERTA // {drop.room}</span>
      <span className="mod-drop-player"><i><OpIcon characterId={drop.characterId} alt={drop.callsign}/></i>{drop.playerName}</span>
      <b className="mod-drop-name">{drop.modName}</b>
      <small className="mod-drop-text">{drop.modText}</small>
    </button>
  </div>;
}

// LOCKDOWN globale: overlay fisso (scanline rosse + vignette che pulsa) mostrato finché
// `game.lockdown` resta true. È un effetto sostenuto legato allo stato di partita, distinto dal
// lampeggio puntuale di SpawnAlert/alarm-panel-flash che scatta solo al singolo evento di comparsa nemico.
function LockdownOverlay(){
  return <div className="lockdown-overlay" aria-hidden="true"/>;
}

// BLACKOUT: durata unica per il pop-up a tutto schermo, il lampeggio giallo/nero sul pannello
// ALLARME separato e le luci che saltano nelle stanze della plancia — stesso ritmo ovunque.
const BLACKOUT_ALERT_SECONDS=8;

// Copre per intero la fascia in alto (topbar) e quella in basso (squadbar) della plancia,
// lasciando scoperta la mappa in mezzo così restano visibili le stanze che lampeggiano
// (blackoutFlicker su TacticalMap). Ogni banda si sovrappone al suo contenitore reale
// (position:absolute dentro .topbar/.squadbar, entrambi già position:relative), quindi
// copre esattamente quella fascia a ogni breakpoint, niente pop-up a tutto schermo.
function BlackoutBand({variant,onClose}:{variant:'top'|'bottom';onClose?:()=>void}){
  return <div className={`blackout-band blackout-band--${variant}`} role={variant==='top'?'alert':undefined} aria-label={variant==='top'?'BLACKOUT: la torre ha staccato la corrente':undefined}>
    <i className="blackout-band-scan" aria-hidden="true"/>
    {variant==='top'
      ?<div className="blackout-band-marquee" aria-hidden="true"><div className="blackout-band-marquee-track"><span>BLACKOUT</span><span>BLACKOUT</span></div></div>
      :<div className="blackout-band-info"><ShieldAlert size={15}/><span>La torre ha staccato la corrente: ogni porta, anche quelle già sbloccate, si è richiusa. Si riapre come sempre con SBLOCCA PORTA.</span><button type="button" aria-label="Chiudi avviso" onClick={onClose}><X size={14}/></button></div>}
  </div>;
}

// PASSAGGIO DI TURNO
// Quando la mano passa a un altro operativo una fascia col suo ritratto attraversa la plancia.
// Stesso schema di useSpawnAlerts: si confrontano due poll consecutivi, mai al primo render.
const TURN_BANNER_MS=1600;
function useTurnBanner(game:Game){
  const seen=useRef<{code:string;active:string|null}>({code:'',active:null});
  const [banner,setBanner]=useState<{id:number;player:Player}|null>(null);
  useEffect(()=>{
    const known=seen.current;
    seen.current={code:game.code,active:game.activePlayerId};
    if(known.code!==game.code||game.phase!=='active'||!game.activePlayerId||known.active===game.activePlayerId)return;
    const player=game.players.find((p)=>p.id===game.activePlayerId);
    if(player)setBanner({id:Date.now(),player});
  },[game]);
  useEffect(()=>{if(!banner)return;const t=setTimeout(()=>setBanner(null),TURN_BANNER_MS);return()=>clearTimeout(t);},[banner]);
  return banner;
}

function TurnBanner({player}:{player:Player}){
  return <div className="turn-banner" style={{'--accent':player.color} as React.CSSProperties} aria-live="polite">
    <div className="turn-banner-strip"><i className="turn-banner-scan" aria-hidden="true"/><span className="turn-banner-portrait"><OpIcon characterId={player.characterId} alt={player.callsign}/></span><div><small>PASSA LA MANO // TURNO</small><b>{player.name}</b><em>{player.role}</em></div></div>
  </div>;
}

// Telefono: al fronte di salita di `myTurn` il bordo lampeggia e il telefono vibra (dove il
// browser lo permette: iOS Safari ignora navigator.vibrate senza errori).
function useTurnStart(myTurn:boolean){
  const prev=useRef(myTurn);
  const [flash,setFlash]=useState(0);
  useEffect(()=>{
    const was=prev.current;
    prev.current=myTurn;
    if(!myTurn||was)return;
    setFlash(Date.now());
    try{navigator.vibrate?.([70,50,70]);}catch{/* vibrazione non disponibile */}
  },[myTurn]);
  useEffect(()=>{if(!flash)return;const t=setTimeout(()=>setFlash(0),1400);return()=>clearTimeout(t);},[flash]);
  return flash;
}

// Chiave che cambia solo quando `value` SALE fra un render e l'altro (0 finché non succede): usata
// come `key` di un elemento decorativo per far ripartire la sua animazione a ogni aumento.
function useRiseKey(value:number){
  const prev=useRef(value);
  const [key,setKey]=useState(0);
  useEffect(()=>{const before=prev.current;prev.current=value;if(value>before)setKey((k)=>k+1);},[value]);
  return key;
}

// Il numero scorre verso il valore nuovo invece di saltare (ease-out, ~600ms). Con
// prefers-reduced-motion salta subito.
function useCountUp(target:number,ms=600){
  const [value,setValue]=useState(target);
  const from=useRef(target);
  useEffect(()=>{
    const start=from.current;
    if(start===target)return;
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){from.current=target;setValue(target);return;}
    const t0=performance.now();
    let raf=0;
    const tick=(now:number)=>{
      const k=Math.min(1,(now-t0)/ms);
      const cur=Math.round(start+(target-start)*(1-Math.pow(1-k,3)));
      from.current=cur;
      setValue(cur);
      if(k<1)raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(raf);
  },[target,ms]);
  return value;
}

// Variazioni d'allarme fra due poll: ognuna diventa un "+N"/"−N" che sale dal chip e svanisce.
// I timer non sono legati al cleanup dell'effetto: due variazioni ravvicinate non devono
// cancellare il galleggiante della prima.
const ALARM_DELTA_MS=1400;
function useAlarmDeltas(alarm:number){
  const prev=useRef(alarm);
  const timers=useRef<number[]>([]);
  const [deltas,setDeltas]=useState<{id:number;delta:number}[]>([]);
  useEffect(()=>()=>{timers.current.forEach(clearTimeout);},[]);
  useEffect(()=>{
    const delta=alarm-prev.current;
    prev.current=alarm;
    if(!delta)return;
    const id=Date.now()+Math.random();
    setDeltas((d)=>[...d,{id,delta}]);
    const timer=window.setTimeout(()=>{timers.current=timers.current.filter((t)=>t!==timer);setDeltas((d)=>d.filter((x)=>x.id!==id));},ALARM_DELTA_MS);
    timers.current.push(timer);
  },[alarm]);
  return deltas;
}

// Soglie che cambiano la partita (BLACKOUT, LOCKDOWN, sconfitta): negli ultimi 10 punti prima
// di ognuna il chip trema, sempre più forte man mano che ci si avvicina.
const ALARM_DANGER_THRESHOLDS=[50,75,100];
function alarmNearness(alarm:number){
  const next=ALARM_DANGER_THRESHOLDS.find((t)=>t>alarm);
  if(next===undefined)return 0;
  const gap=next-alarm;
  return gap>10?0:Math.max(.15,(11-gap)/10);
}

// NODO VIOLATO: le stanze nodo passate da intatte a violate restano "in onda d'urto" per
// NODE_BREACH_MS. Mai al primo render, né al cambio di partita.
const NODE_BREACH_MS=1700;
function useNodeBreaches(game:Game){
  const prev=useRef<{code:string;nodes:Record<string,boolean>}|null>(null);
  const timers=useRef<number[]>([]);
  const [fresh,setFresh]=useState<string[]>([]);
  useEffect(()=>()=>{timers.current.forEach(clearTimeout);},[]);
  useEffect(()=>{
    const before=prev.current;
    const nodes=game.nodes||{};
    prev.current={code:game.code,nodes:{...nodes}};
    if(!before||before.code!==game.code)return;
    const rooms=Object.keys(nodes).filter((id)=>nodes[id]&&!before.nodes[id]);
    if(!rooms.length)return;
    setFresh((list)=>[...list,...rooms]);
    const timer=window.setTimeout(()=>{timers.current=timers.current.filter((t)=>t!==timer);setFresh((list)=>list.filter((id)=>!rooms.includes(id)));},NODE_BREACH_MS);
    timers.current.push(timer);
  },[game]);
  return fresh;
}

// FLUSSO TATTICO
// Il server fa unshift delle righe nuove e non dà loro un id: la chiave è testo+ora più il
// numero di ripetizioni contate dal fondo, così le righe già viste mantengono la stessa chiave
// quando ne arrivano di nuove in cima. Solo le righe montate dopo il primo render si scrivono
// a macchina; quelle presenti al caricamento compaiono già intere.
function FeedList({feed}:{feed:FeedItem[]}){
  const ready=useRef(false);
  useEffect(()=>{ready.current=true;},[]);
  const seen=new Map<string,number>();
  const keys:string[]=[];
  for(let i=feed.length-1;i>=0;i--){const base=`${feed[i].time}|${feed[i].text}`;const n=seen.get(base)||0;seen.set(base,n+1);keys[i]=`${base}|${n}`;}
  return <ol className="feed">{feed.map((item,i)=><FeedLine item={item} fresh={ready.current} key={keys[i]}/>)}</ol>;
}

const FEED_TYPE_MS=18;
function FeedLine({item,fresh}:{item:FeedItem;fresh:boolean}){
  const animate=fresh&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [shown,setShown]=useState(()=>animate?0:item.text.length);
  useEffect(()=>{
    if(shown>=item.text.length)return;
    const t=setTimeout(()=>setShown((n)=>Math.min(item.text.length,n+1)),FEED_TYPE_MS);
    return()=>clearTimeout(t);
  },[shown,item.text.length]);
  const typing=shown<item.text.length;
  return <li className={`${item.tone}${animate?' fresh':''}`}><time>{item.time}</time><span>{item.text.slice(0,shown)}{typing&&<i className="feed-caret" aria-hidden="true"/>}</span></li>;
}

// FINE PARTITA
// Il rapporto si "stampa" una riga alla volta: titolo, testo, poi ogni statistica con il valore
// che conta da zero, infine il pulsante. Ritmo in OUTCOME_LINE_MS (le righe CSS usano --i).
const OUTCOME_LINE_MS=420;

// PRIMA DEL RAPPORTO: una breve scena, poi il rapporto si stampa.
// Vittoria: gli operativi in piedi escono in fila verso il punto di consegna.
// Sconfitta: lo schermo si spegne come un vecchio monitor, fra glitch e "CONNESSIONE PERSA".
// Durate allineate alle animazioni .extraction / .shutdown in styles.css. Si salta con un clic.
const EXTRACT_WALK_MS=2400, EXTRACT_STAGGER_MS=450, EXTRACT_HOLD_MS=1300;
const SHUTDOWN_MS=3400;
function OutcomeCinematic({game,onDone}:{game:Game;onDone:()=>void}){
  const done=useRef(onDone);
  done.current=onDone;
  const victory=game.phase==='victory';
  const squad=game.players.filter((p)=>p.hp>0);
  const total=victory?EXTRACT_WALK_MS+Math.max(0,squad.length-1)*EXTRACT_STAGGER_MS+EXTRACT_HOLD_MS:SHUTDOWN_MS;
  useEffect(()=>{
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer=window.setTimeout(()=>done.current(),reduced?0:total);
    return()=>window.clearTimeout(timer);
  },[total]);
  if(victory){
    const drop=roomOf(game,game.dropRoom);
    return <button type="button" className="outcome-cine extraction" onClick={()=>done.current()} aria-label="Salta la scena di estrazione" style={{'--n':squad.length} as React.CSSProperties}>
      <small className="ex-kicker">ESTRAZIONE IN CORSO // {game.dropRoom} {drop?.name||''}</small>
      <span className="ex-lane">
        <i className="ex-floor" aria-hidden="true"/>
        {squad.map((p,i)=><span className="ex-op" key={p.id} style={{'--accent':p.color,'--i':i} as React.CSSProperties}><span className="ex-portrait"><OpIcon characterId={p.characterId} alt={p.callsign}/></span><em>{p.callsign}</em></span>)}
        <span className="ex-gate" aria-hidden="true"><i/><b>▼ EXIT</b><small>{game.dropRoom}</small></span>
      </span>
      <b className="ex-title">SQUADRA ESTRATTA</b>
    </button>;
  }
  return <button type="button" className="outcome-cine shutdown" onClick={()=>done.current()} aria-label="Salta: connessione persa">
    <i className="sd-noise" aria-hidden="true"/>
    <span className="sd-bands" aria-hidden="true"><i/><i/><i/></span>
    <span className="sd-text"><small>SEGNALE CLANDESTINO // 0%</small><b data-text="CONNESSIONE PERSA">CONNESSIONE PERSA</b></span>
    <i className="sd-shutter top" aria-hidden="true"/><i className="sd-shutter bottom" aria-hidden="true"/><i className="sd-line" aria-hidden="true"/>
  </button>;
}

function OutcomeScreen({game,title,text,onReset}:{game:Game;title:string;text:string;onReset:()=>void}){
  const [cinematic,setCinematic]=useState(true);
  const endCinematic=useCallback(()=>setCinematic(false),[]);
  const living=game.players.filter((p)=>p.hp>0).length;
  const stats:{label:string;value:number;suffix?:string;total?:number;tone?:string}[]=[
    {label:'ROUND GIOCATI',value:game.round},
    {label:'ALLARME FINALE',value:game.alarm,suffix:'%',tone:game.alarm>=75?'danger':''},
    {label:'OPERATIVI ESTRATTI',value:game.phase==='victory'?living:0,total:game.players.length,tone:game.phase==='victory'?'good':'danger'},
    {label:'NODI VIOLATI',value:game.breach,total:game.nodesRequired},
    {label:'OSTILI NEUTRALIZZATI',value:game.enemies.filter((e)=>e.hp<=0).length},
  ];
  const first=2;
  if(cinematic)return <div className={`outcome ${game.phase} cine`}><OutcomeCinematic game={game} onDone={endCinematic}/></div>;
  return <div className={`outcome ${game.phase}`}><div className="outcome-report">
    <small className="outcome-line" style={{'--i':0} as React.CSSProperties}>OPERAZIONE CONCLUSA // RAPPORTO</small>
    <h2 className="outcome-line" style={{'--i':1} as React.CSSProperties}>{title}</h2>
    <p className="outcome-line" style={{'--i':first} as React.CSSProperties}>{text}</p>
    <dl className="outcome-stats">{stats.map((st,i)=><OutcomeStat key={st.label} index={first+1+i} {...st}/>)}</dl>
    <button className="primary-btn outcome-line" style={{'--i':first+2+stats.length} as React.CSSProperties} data-sfx="confirm" onClick={onReset}>NUOVA OPERAZIONE <RotateCw size={17}/></button>
  </div></div>;
}

function OutcomeStat({index,label,value,suffix='',total,tone=''}:{index:number;label:string;value:number;suffix?:string;total?:number;tone?:string}){
  const [target,setTarget]=useState(0);
  useEffect(()=>{const t=setTimeout(()=>setTarget(value),index*OUTCOME_LINE_MS);return()=>clearTimeout(t);},[index,value]);
  const shown=useCountUp(target,700);
  return <div className={`outcome-line ${tone}`} style={{'--i':index} as React.CSSProperties}><dt>{label}</dt><i aria-hidden="true"/><dd>{shown}{suffix}{total!==undefined&&<small> / {total}</small>}</dd></div>;
}

// Menu cheat: si apre con Alt+Shift+C (solo plancia, solo partita in corso), si chiude con la X.
const CHEATS:{id:string;label:string;hint:string}[]=[
  {id:'reveal',label:'Scopri tutta la mappa',hint:'Toglie la nebbia da ogni stanza'},
  {id:'openDoors',label:'Apri tutte le porte',hint:'Ogni porta della plancia si sblocca'},
  {id:'closeDoors',label:'Chiudi tutte le porte',hint:'Ogni porta si richiude'},
  {id:'spawnEnemy',label:'Spawn nemico casuale',hint:'Un nemico a caso in una stanza a caso'},
  {id:'alarmZero',label:'Allarme a 0%',hint:'Azzera subito il livello d’allarme'},
  {id:'killEnemies',label:'Elimina tutti i nemici',hint:'Ogni nemico in campo va a 0 integrità'},
  {id:'immortal',label:'Immortalità operativi',hint:'Nessun danno subito · cura la squadra'},
];
function CheatMenu({game,controllerToken,onClose}:{game:Game;controllerToken:string|null;onClose:()=>void}){
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  const run=async(cheat:string)=>{try{setBusy(cheat);setError('');await api('/api/cheat',{method:'POST',body:JSON.stringify({code:game.code,controllerToken,cheat})});}catch(e){setError((e as Error).message);}finally{setBusy('');}};
  return <div className="cheat-backdrop" role="presentation" onClick={(e)=>{if(e.target===e.currentTarget)onClose();}} onKeyDown={(e)=>{if(e.key==='Escape')onClose();}}><section className="cheat-menu panel" role="dialog" aria-label="Cheat">
    <header><div><div className="panel-kicker">DEBUG</div><h2>CHEAT</h2></div><button className="cheat-close" aria-label="Chiudi" onClick={onClose}><X size={18}/></button></header>
    <div className="cheat-list">{CHEATS.map((c)=>{const on=c.id==='immortal'&&!!game.cheats?.immortal;return <button key={c.id} className={`cheat-item ${on?'on':''}`} disabled={!!busy} onClick={()=>{void run(c.id);}}><b>{c.label}{c.id==='immortal'&&<em>{on?'ON':'OFF'}</em>}</b><small>{c.hint}</small></button>;})}</div>
    {error&&<div className="error">{error}</div>}
  </section></div>;
}

function Board({game:liveGame,templates,missions,controllerToken,onReset}:{game:Game;templates:Template[];missions:MissionMeta[];controllerToken:string|null;onReset:()=>void}){
  // La plancia disegna lo stato "in regia": uguale a quello del server, salvo ciò che gli eventi
  // ancora da riprodurre non hanno ancora mostrato (vedi useEventDirector).
  const {view:game,hits,rising}=useEventDirector(liveGame);
  const [settings,setSettings]=useState(false);
  const [briefing,setBriefing]=useState(false);
  const [cheatOpen,setCheatOpen]=useState(false);
  const mission=missions.find((m)=>m.id===game.missionId);
  const active=game.players.find((p)=>p.id===game.activePlayerId);
  const alivePlayers=game.players.filter((p)=>p.hp>0).length;
  const doneTurns=game.players.filter((p)=>p.hp>0&&p.turnDone).length;
  const forceRound=()=>{void api('/api/resolve',{method:'POST',body:JSON.stringify({controllerToken})}).catch(()=>{});};
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.altKey&&e.shiftKey&&e.code==='KeyC'){e.preventDefault();setCheatOpen((o)=>!o);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[]);
  const skipTurn=()=>{void api('/api/skipturn',{method:'POST',body:JSON.stringify({controllerToken})}).catch(()=>{});};
  const stage=missionStage(game);
  const cargo=cargoStatus(game);
  const spawnAlert=useSpawnAlerts(game);
  const lockdownAlert=useLockdownAlert(game);
  const {active:blackoutActive,dismiss:blackoutDismiss}=useBlackoutAlert(game);
  const abilityAlert=useAbilityAlerts(game);
  const modDrop=useModDrops(game);
  const dying=useDyingEnemies(game);
  const turnBanner=useTurnBanner(game);
  const breachKey=useRiseKey(game.breach);
  useUnlockSound(game);
  const {duckMusic}=useAudio();
  // `duckMusic` cambia identità col volume musica: tenuto in un ref così un ritocco del volume
  // durante il blackout non fa ripartire suono, taglio musica e luci da capo.
  const duckMusicRef=useRef(duckMusic);
  duckMusicRef.current=duckMusic;
  const [blackoutFlicker,setBlackoutFlicker]=useState(false);
  // BLACKOUT: effetto sonoro one-shot, musica tagliata netta e poi in fade-in, luci delle
  // stanze e pop-up a tutto schermo, tutti per BLACKOUT_ALERT_SECONDS.
  useEffect(()=>{
    if(!blackoutActive)return;
    playSfx('blackout');
    duckMusicRef.current(BLACKOUT_ALERT_SECONDS,1200);
    setBlackoutFlicker(true);
    const t=setTimeout(()=>{setBlackoutFlicker(false);blackoutDismiss();},BLACKOUT_ALERT_SECONDS*1000);
    return()=>clearTimeout(t);
  },[blackoutActive,blackoutDismiss]);
  // Un segnale acustico marca la fine dell'operazione, vittoria o sconfitta.
  useEffect(()=>{ if(game.phase==='victory')playSfx('confirm'); if(game.phase==='defeat')playSfx('alert'); },[game.phase]);
  const outcome=outcomeText(game);
  return <main className="board-shell">
    <i className="mission-neon" aria-hidden="true" />
    <header className="topbar"><div className="telemetry codice-block"><span><Radio size={16}/> CODICE <b>{game.code}</b></span></div><div className="mission"><small>OPERAZIONE ATTIVA</small><strong>{game.title}</strong></div><div className="telemetry"><AlarmReadout alarm={game.alarm}/><button type="button" className="alarm-panel-open" onClick={()=>window.open('/alarm','roverpunk-alarm')} title="Apri il pannello ALLARME in una finestra a parte"><ShieldAlert size={15}/> PANNELLO ALLARME</button><SettingsButton onOpen={()=>setSettings(true)}/></div>{blackoutFlicker&&<BlackoutBand variant="top"/>}</header>
    <section className="board-grid">
      <aside className="panel intel-panel"><div className="panel-kicker">01 // DIRETTIVA</div><h1>{game.narrative.goalHeadline}</h1><p>{game.objective}</p>{mission&&<button className="briefing-link" onClick={()=>setBriefing(true)}><BookOpen size={12}/> BRIEFING MISSIONE</button>}<div className="objective">{breachKey>0&&<em className="objective-flash" key={breachKey} aria-hidden="true"/>}<span>NODI VIOLATI</span><b>{game.breach} / {game.nodesRequired}</b><i style={{width:`${Math.min(1,game.breach/(game.nodesRequired||1))*100}%`}}/></div><div className={`case-track ${cargo.done?'done':''}`}><span><Briefcase size={13}/> {cargo.label}</span><b>{cargo.text}</b></div><div className="stage-card"><small>{stage.label}</small><b>{stage.short}</b><p>{stage.text}</p></div><div className="section-label">FLUSSO TATTICO</div><FeedList feed={game.feed}/></aside>
      <section className="tactical panel"><TacticalMap game={game} hits={hits} dying={dying} blackout={blackoutFlicker} rising={rising}/></section>
      <aside className="panel threats-panel">{(()=>{const fogged=foggedOf(game);const living=game.enemies.filter((e)=>(e.hp>0||dying.has(e.id))&&!fogged.includes(e.room));const ordered=[...living].sort((a,b)=>a.hp-b.hp);return <><div className="panel-kicker">03 // MINACCE · {living.filter((e)=>e.hp>0).length}</div>{ordered.map((e)=>{const isDying=dying.has(e.id);const contested=game.players.some((p)=>p.hp>0&&p.room===e.room);return <div className={`threat-card ${e.type==='ÉLITE'?'elite':''} ${contested?'contested':''} ${isDying?'dying':''}`} key={e.id}><span className="threat-icon"><FoeIcon kind={enemyKind(e.id)} alt={e.type}/></span><div><small>{e.type} // {e.room} {roomOf(game,e.room)?.name||''} · DANNO +{e.damage}</small><b>{e.name}</b><div className="threat-hp"><Meter value={e.hp} max={e.maxHp} tone="red"/><span>{e.hp}/{e.maxHp}</span></div><em>{isDying?'NEUTRALIZZATO':contested?'IN CONTATTO CON LA SQUADRA':e.locked?'VI INSEGUE':'DI PRESIDIO'}</em></div></div>;})}</>;})()}</aside>
    </section>
    <footer className="squadbar">{game.players.map((p)=>{const isTurn=game.phase==='active'&&p.id===game.activePlayerId;const activation=abilityAlert.current?.playerId===p.id?abilityAlert.current:null;return <article className={`operative ${p.hp<=0?'down':''} ${isTurn?'active-turn':''}`} key={p.id} style={{'--accent':p.color} as React.CSSProperties}><div className="op-hp"><Meter value={p.hp} max={p.maxHp}/><b>{p.hp}/{p.maxHp}</b></div><div className="op-body"><span className="portrait"><OpIcon characterId={p.characterId} alt={p.callsign}/></span><div className="op-name"><b>{p.name}</b><small>{p.hp<=0?<span className="op-down-tag">{downLabel(p.riseIn)}</span>:<>{p.role} · {p.connected?'ONLINE':'OFFLINE'}</>}</small><span className="op-room"><MapPin size={10}/> {p.room} {roomOf(game,p.room)?.name||''}</span></div><div className="op-stats"><div><small>FOCUS</small><Meter value={p.focus} max={p.maxFocus} tone="violet"/></div><div><small>CARICATORE</small><Meter value={p.mag} max={p.maxMag} tone="gold"/></div></div></div>{activation&&<AbilityAlert key={activation.id} activation={activation} onClose={abilityAlert.dismiss}/>}</article>;})}{Array.from({length:Math.max(0,game.maxPlayers-game.players.length)}).map((_,i)=><article className="operative placeholder" key={`free-${i}`}><div className="op-body"><span className="portrait">—</span><div className="op-name"><b>POSTO LIBERO</b><small><Smartphone size={10}/> IN ATTESA DAL TELEFONO</small></div></div></article>)}{blackoutFlicker&&<BlackoutBand variant="bottom" onClose={()=>setBlackoutFlicker(false)}/>}</footer>
    {(game.phase==='victory'||game.phase==='defeat')&&<OutcomeScreen game={game} title={outcome.title} text={outcome.text} onReset={onReset}/>}
    {briefing&&mission&&<MissionBriefing mission={mission} onClose={()=>setBriefing(false)}/>}
    {settings&&<Settings templates={templates} onReset={onReset} onClose={()=>setSettings(false)} controls={game.phase==='active'?{turnLabel:`Di mano: ${active?.name??'—'}.`,roundLabel:`Round ${String(game.round).padStart(2,'0')} · ${doneTurns}/${alivePlayers} turni chiusi.`,onSkipTurn:skipTurn,onForceRound:forceRound}:undefined}/>}
    {spawnAlert.current&&<SpawnAlert key={spawnAlert.current.id} enemy={spawnAlert.current} roomName={roomOf(game,spawnAlert.current.room)?.name||''} onClose={spawnAlert.dismiss}/>}
    {modDrop.current&&<ModDropAlert key={modDrop.current.id} drop={modDrop.current} onClose={modDrop.dismiss}/>}
    {turnBanner&&!spawnAlert.current&&<TurnBanner key={turnBanner.id} player={turnBanner.player}/>}
    {lockdownAlert.active&&<LockdownAlert onClose={lockdownAlert.dismiss}/>}
    {game.phase==='active'&&game.lockdown&&<LockdownOverlay/>}
    {cheatOpen&&game.phase==='active'&&<CheatMenu game={liveGame} controllerToken={controllerToken} onClose={()=>setCheatOpen(false)}/>}
  </main>;
}

function PlayerJoin(){
  const params=new URLSearchParams(location.search);
  const initialCode=params.get('code')||'';
  const [code,setCode]=useState(initialCode.toUpperCase());
  const [searchCode,setSearchCode]=useState(initialCode.toUpperCase());
  const {snapshot,offline}=useSnapshot(searchCode);
  const [error,setError]=useState('');
  const [viewing,setViewing]=useState('');
  const [repick,setRepick]=useState(false);
  const [name,setName]=useState('');
  const [joining,setJoining]=useState('');
  const [session,setSession]=useState<{code:string;playerId:string;deviceId:string}|null>(()=>{try{return JSON.parse(localStorage.getItem('roverpunk-session')||'null');}catch{return null;}});
  // Un solo deviceId per telefono, riusato anche quando si cambia scheda in lobby.
  const [deviceId]=useState(()=>session?.deviceId||makeDeviceId());
  const game=session?.code===snapshot.game?.code||searchCode===snapshot.game?.code?snapshot.game:null;
  const player=session&&session.code===snapshot.game?.code?snapshot.game?.players.find((p)=>p.id===session.playerId):null;
  // I browser dei telefoni congelano i timer quando lo schermo si spegne o si cambia app:
  // al ritorno in primo piano serve un ping immediato per tornare subito online.
  useEffect(()=>{if(!session)return;const ping=()=>api('/api/ping',{method:'POST',body:JSON.stringify(session)}).catch(()=>{});void ping();const timer=setInterval(ping,4000);
    const wake=()=>{if(document.visibilityState==='visible')void ping();};
    document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);window.addEventListener('pageshow',wake);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);window.removeEventListener('pageshow',wake);};},[session]);
  const find=()=>{setError('');setSearchCode(code.trim().toUpperCase());};
  const join=async(characterId:string)=>{try{setJoining(characterId);setError('');const data=await api('/api/join',{method:'POST',body:JSON.stringify({code:snapshot.game?.code||searchCode,characterId,name:name.trim(),deviceId})});const next={code:data.game.code,playerId:data.playerId,deviceId};localStorage.setItem('roverpunk-session',JSON.stringify(next));setSession(next);setRepick(false);setViewing('');playSfx('confirm');}catch(e){playSfx('alert');setError((e as Error).message);}finally{setJoining('');}};
  const showPicker=!session||!player||repick;
  if(showPicker){
    const lobby=game?.phase==='lobby';
    const linked=!!game&&game.code===snapshot.game?.code;
    const hasName=name.trim().length>0;
    const canPick=linked&&hasName;
    const takenBy=(id:string)=>game?.players.find((p)=>p.characterId===id&&p.id!==session?.playerId);
    // Toccare una riga apre la scheda completa: la selezione vera avviene solo con SELEZIONA.
    const selectAction=(t:Template)=>{
      const busyHere=!!takenBy(t.id)?.connected;
      const ready=canPick&&!busyHere&&lobby&&joining==='';
      const label=!linked?'INSERISCI PRIMA IL CODICE PARTITA':!hasName?'INSERISCI PRIMA IL NOME':busyHere?'SCHEDA OCCUPATA':!lobby?'OPERAZIONE GIÀ AVVIATA':joining===t.id?'COLLEGAMENTO…':'SELEZIONA ED ENTRA';
      return <button type="button" className="primary-btn" data-sfx="confirm" disabled={!ready} onClick={()=>join(t.id)}>{label}{ready&&<Check size={16}/>}</button>;
    };
    return <main className="join-shell"><section className="join-card">
      <header className="join-head">
        <div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>OPERATIVE UPLINK</small></div></div>
        <div className="join-head-tools">
          <span className={`uplink-icon ${linked&&!offline?'on':''}`} title={linked&&!offline?'Collegato al canale':'Non collegato'}><Smartphone/><i/><Radio/></span>
        </div>
      </header>
      <div className="join-body">
        <div className="join-form">
          <small>INSERISCI CODICE PARTITA</small>
          <form className="code-entry" onSubmit={(e)=>{e.preventDefault();find();}}><input value={code} onChange={(e)=>setCode(e.target.value.toUpperCase())} placeholder="NEON-77" maxLength={7} autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} enterKeyHint="go" aria-label="Codice partita"/><button type="submit" aria-label="Collegati"><LogIn/></button></form>
          {linked?<label className="join-name"><small>NOME OPERATIVO</small><input value={name} onChange={(e)=>setName(e.target.value.toUpperCase())} placeholder="COME TI CHIAMI?" maxLength={13} autoCapitalize="characters" autoCorrect="off" spellCheck={false}/></label>
            :searchCode&&<p className="join-hint">In attesa del canale <b>{searchCode}</b>…</p>}
          {repick&&<button type="button" className="ghost-btn" onClick={()=>setRepick(false)}>ANNULLA</button>}
          <p className="error" role="alert">{error}</p>
        </div>
        {canPick?<div className="seat-select">
          <span>{repick?'CAMBIA SCHEDA':'SCEGLI IL TUO PERSONAGGIO'}{!lobby&&!repick?' — OPERAZIONE GIÀ AVVIATA':''}<small>TOCCA PER APRIRE LA SCHEDA</small></span>
          <div className="seat-list">{snapshot.templates.map((t)=>{
            const taken=takenBy(t.id);const busyHere=!!taken&&taken.connected;const mine=linked&&player?.characterId===t.id;
            return <button type="button" className={`${busyHere?'taken':''} ${mine?'mine':''}`} onClick={()=>setViewing(t.id)} key={t.id} style={{'--accent':t.color} as React.CSSProperties}>
              <i><OpIcon characterId={t.id} alt={t.callsign}/></i>
              <span><small>{t.role} · INT {t.maxHp} · DMG +{t.dmg}</small><b>{t.callsign}</b></span>
              <em>{mine?'TUA SCHEDA':busyHere?'OCCUPATO':taken?'LIBERO':'SCHEDA'}<ChevronRight size={14}/></em>
            </button>;
          })}</div>
        </div>:<div className="seat-select seat-select-locked"><span>SCEGLI IL TUO PERSONAGGIO<small>{!linked?'INSERISCI PRIMA IL CODICE PARTITA':'INSERISCI PRIMA IL NOME'}</small></span></div>}
      </div>
      {viewing&&<CharacterGallery templates={snapshot.templates} startId={viewing} onClose={()=>setViewing('')} action={selectAction} takenBy={(t)=>{const holder=takenBy(t.id);return holder?.connected?holder.name:undefined;}}/>}
    </section></main>;
  }
  return <PlayerConsole game={snapshot.game!} player={player!} session={session!} offline={offline} onRepick={snapshot.game!.phase==='lobby'?()=>{setName(player!.name);setRepick(true);}:undefined}/>;
}

// Card azione del telefono: il primo tocco la arma e sopra compaiono ANNULLA / CONFERMA,
// l'azione parte solo con CONFERMA (niente attivazioni per un tocco sbagliato).
function ActionCard({id,pending,onArm,onCancel,onConfirm,disabled,className,title,label,confirmSfx,children}:{id:string;pending:string|null;onArm:(id:string)=>void;onCancel:()=>void;onConfirm:()=>void;disabled:boolean;className?:string;title?:string;label:string;confirmSfx?:SfxName;children:React.ReactNode}){
  const armed=pending===id&&!disabled;
  const trigger=useRef<HTMLButtonElement>(null);
  const cancel=()=>{onCancel();trigger.current?.focus();};
  return <div className={`action-slot ${armed?'armed':''}`}>
    <button type="button" ref={trigger} className={`console-action-card ${className||''}`} onClick={()=>onArm(id)} disabled={disabled} title={title} aria-expanded={armed} aria-controls={armed?`confirm-${id}`:undefined}>{children}</button>
    {armed&&<div id={`confirm-${id}`} className="confirm-bar" role="group" data-confirmation aria-label={`Conferma ${label}`}><p>{label}?</p><button type="button" data-sfx="back" onClick={cancel}><X/> ANNULLA</button><button type="button" className="ok" data-sfx={confirmSfx||'confirm'} onClick={onConfirm}><Check/> CONFERMA</button></div>}
  </div>;
}

// La mappa ha anche una lista di destinazioni: selezionabile senza precisione sul touch.
function PlayerMoveDialog({onClose,children}:{onClose:()=>void;children:React.ReactNode}){
  const dialog=useRef<HTMLDivElement>(null);
  const close=useRef(onClose);
  useLayoutEffect(()=>{close.current=onClose;},[onClose]);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const node=dialog.current;
    node?.focus();
    const onKeyDown=(event:KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();close.current();}
    if(event.key!=='Tab')return;
    const controls=Array.from(node?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),[tabindex="0"]')||[]).filter((control)=>control.getClientRects().length>0);
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===node)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===node)){event.preventDefault();first?.focus();}
    };
    node?.addEventListener('keydown',onKeyDown);
    return()=>{node?.removeEventListener('keydown',onKeyDown);previous?.focus();};
  },[]);
  return <div className="move-overlay player-move-overlay"><div className="move-panel" role="dialog" aria-modal="true" aria-labelledby="move-title" ref={dialog} tabIndex={-1}>{children}</div></div>;
}

function PlayerImagePreview({player,kind,onClose}:{player:Player;kind:'weapon'|'character';onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialog.current?.showModal();
    return()=>{document.body.style.overflow=previousOverflow;};
  },[]);
  return createPortal(<dialog ref={dialog} className="weapon-preview" aria-labelledby="weapon-preview-name" onCancel={(event)=>{event.preventDefault();onClose();}}>
    {kind==='weapon'?<WeaponArt characterId={player.characterId} weapon={player.weapon}/>:<img className="character-preview-art" src={charImg(player.characterId)} alt={player.callsign} decoding="async"/>}
    <div className="weapon-preview-caption"><small>{kind==='weapon'?'ARMA':player.role}</small><b id="weapon-preview-name">{kind==='weapon'?<>{player.weapon} <em>+{player.dmg}</em></>:player.callsign}</b></div>
    <button type="button" className="weapon-preview-close" aria-label={`Chiudi anteprima ${kind==='weapon'?'arma':'personaggio'}`} onClick={onClose} autoFocus><X aria-hidden="true"/></button>
  </dialog>,document.body);
}

function PlayerConsole({game,player,session,offline,onRepick}:{game:Game;player:Player;session:{playerId:string;deviceId:string};offline:boolean;onRepick?:()=>void}){
  const [sending,setSending]=useState(false);const [error,setError]=useState('');
  const [moving,setMoving]=useState(false);
  const [imagePreview,setImagePreview]=useState<'weapon'|'character'|null>(null);
  // Azione armata in attesa di CONFERMA; si azzera quando passa la mano o cambia round.
  const [pending,setPending]=useState<string|null>(null);
  const consoleRoot=useRef<HTMLElement>(null);
  const confirmationTrigger=useRef<HTMLElement|null>(null);
  const armPending=useCallback((id:string)=>{confirmationTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setPending(id);},[]);
  const cancelPending=useCallback(()=>{
    const trigger=confirmationTrigger.current;
    setPending(null);
    requestAnimationFrame(()=>{(trigger?.id?document.getElementById(trigger.id):trigger)?.focus();});
  },[]);
  useEffect(()=>{
    if(!pending)return;
    consoleRoot.current?.querySelector<HTMLElement>('[data-confirmation] button')?.focus();
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();cancelPending();}};
    document.addEventListener('keydown',escape);
    return()=>document.removeEventListener('keydown',escape);
  },[pending,cancelPending]);
  useEffect(()=>{setPending(null);setMoving(false);},[game.activePlayerId,game.round]);
  // Stesso avviso a tutto schermo della plancia (lampeggio + sirena) quando entra una nuova minaccia.
  const spawnAlert=useSpawnAlerts(game);
  const lockdownAlert=useLockdownAlert(game);
  // Stesso feedback colpo della plancia sulla mini-mappa della manovra.
  const hits=useHitFlashes(game);
  const damage=useSelfDamage(game,player.id);
  useUnlockSound(game,player.id);
  const room=roomOf(game,player.room);
  const exits=room?.links||[];
  // Porte: solo quelle aperte sono attraversabili in manovra; quelle chiuse vanno sbloccate
  // prima con l'azione SBLOCCA PORTA (disponibile a ogni operativo, non serve una scheda specifica).
  const openExits=exits.filter((id)=>!doorClosed(game,player.room,id));
  const lockedExits=exits.filter((id)=>doorClosed(game,player.room,id));
  // Stanze puntabili in manovra: non solo le porte aperte adiacenti, fino a MOVE_MAX_DISTANCE via.
  const moveTargets=useMemo(()=>reachableRooms(game,player.room,MOVE_MAX_DISTANCE),[game,player.room]);
  const [doorTarget,setDoorTarget]=useState('');
  const [attackTarget,setAttackTarget]=useState('');
  // Sistema a turni: 3 azioni per turno, la manovra (una stanza alla volta) ne consuma una e si
  // risolve subito. Piede sull'acceleratore rende gratis la prima manovra del turno.
  const myTurn=game.phase==='active'&&game.activePlayerId===player.id&&player.hp>0;
  const turnFlash=useTurnStart(myTurn);
  const maneuversMade=player.maneuverCount??(player.move?1:0);
  const moved=maneuversMade>0;
  const actedCount=player.actions.length;
  const acted=actedCount>=ACTIONS_PER_TURN;
  const freeMoveLeft=hasPassive(player,'accelerator')&&maneuversMade<1;
  const canMove=freeMoveLeft||!acted;
  const actRoomId=player.room;
  const actRoom=room;
  const hostiles=game.enemies.filter((e)=>e.hp>0&&e.room===actRoomId);
  const hostilesNow=hostiles;
  const squadHere=game.players.filter((p)=>p.id!==player.id&&p.room===actRoomId);
  // A rischio BRUTALE chi cade non si rianima: RIPRISTINO resta solo su se stessi.
  const downedHere=game.riskLevel==='brutal'?undefined:squadHere.find((p)=>p.hp<=0);
  const nodeHere=Boolean(actRoom?.node)&&!game.nodes?.[actRoomId];
  const cameraHere=Boolean(game.cameras?.includes(actRoomId));
  // CASSA DI POTENZIAMENTO: si apre solo se è ancora carica, la stanza è ripulita dagli ostili e
  // l'operativo non ha già la sua modifica (una a testa, una per apertura).
  const chestHere=game.chests?.find((c)=>c.room===actRoomId);
  const mods=(player.mods||[]).map((id)=>modById(id)).filter(Boolean) as {id:string;name:string;text:string}[];
  const modded=mods.length>0;
  const chestReady=Boolean(chestHere&&chestHere.uses>0&&!hostiles.length&&!modded);
  // RECUPERO/LIBERA: il carico va raccolto a mano, e solo se teca/cella è già stata sbloccata.
  const carrying=game.caseHolder===player.id;
  const caseHere=!game.caseHolder&&!game.caseDelivered&&caseRoomOf(game)===actRoomId;
  const caseBlocked=caseHere&&actRoomId===game.vaultRoom&&!game.vaultOpen;
  const escorting=game.hostage.holder===player.id;
  const hostageHere=!game.hostage.holder&&!game.hostage.delivered&&hostageRoomOf(game)===actRoomId;
  const hostageBlocked=hostageHere&&!game.hostage.freed&&actRoomId===game.vaultRoom&&!game.vaultOpen;
  const purgeReady=actRoomId===game.vaultRoom&&game.vaultOpen&&!game.purged;
  const downloadReady=actRoomId===game.vaultRoom&&game.vaultOpen&&!game.download.done;
  const armReady=actRoomId===game.vaultRoom&&game.vaultOpen&&!game.reactor.armed;
  // SPETTRO: CATTURA solo con il fuggitivo nella tua stanza e senza vie di fuga. Le porte della
  // stanza si possono anche richiudere (SIGILLA), non solo aprire.
  const specter=game.specter;
  const specterHere=Boolean(game.missionId==='spettro'&&specter?.awake&&!specter.captured&&specter.room===actRoomId);
  const specterEscapes=game.specterExits||[];
  const captureReady=specterHere&&!specterEscapes.length;
  const sealMode=game.missionId==='spettro';
  // CECCHINO: il tiro esce dalla stanza di una porta aperta. Gli ostili della propria stanza
  // restano comunque i primi della lista, come sul server (shootableEnemies).
  const sniper=hasMod(player,'sniper');
  const shootable=useMemo(()=>{
    if(!sniper) return hostiles;
    const rooms=[actRoomId,...openExits];
    return game.enemies.filter((e)=>e.hp>0&&rooms.includes(e.room)).sort((a,b)=>(a.room===actRoomId?0:1)-(b.room===actRoomId?0:1));
  },[sniper,hostiles,game.enemies,actRoomId,openExits]);
  const selectedTarget=shootable.some((e)=>e.id===attackTarget)?attackTarget:(shootable[0]?.id||'');
  // In missione SPETTRO la carta porta lavora su TUTTE le porte della stanza: chiusa → SBLOCCA,
  // aperta → SIGILLA. Di default propone prima una via di fuga di SPETTRO, se ce n'è una qui.
  const doorChoices=sealMode?exits:lockedExits;
  const defaultDoor=sealMode?(exits.find((id)=>specterEscapes.includes(id)&&(specter?.room===actRoomId||specter?.room===id))||exits[0]||''):(lockedExits[0]||'');
  const selectedDoor=doorChoices.includes(doorTarget)?doorTarget:defaultDoor;
  const selectedDoorClosed=Boolean(selectedDoor)&&doorClosed(game,actRoomId,selectedDoor);
  const targetEnemy=shootable.find((e)=>e.id===selectedTarget);
  const openingStrike=Boolean(targetEnemy&&hasPassive(player,'clean-opening')&&!targetEnemy.locked);
  // Anteprima del danno: canna rinforzata è già dentro player.dmg, il modulo termico dipende dal
  // bersaglio scelto, il colpo doppio resta un tiro di dado e si mostra a parte.
  const thermalStep=(()=>{
    if(!hasMod(player,'thermal')||!targetEnemy) return 0;
    const streak=player.thermalTarget===targetEnemy.id?Math.min(MOD_THERMAL_STEPS.length-1,(player.thermalStreak||0)+1):0;
    return MOD_THERMAL_STEPS[streak]||0;
  })();
  const attackDamage=Math.round((openingStrike?Math.ceil(player.dmg*1.5):player.dmg)*(1+thermalStep));
  const emptyMag=player.mag<=0;
  const magFull=player.mag>=player.maxMag;
  // RIPRISTINO cura solo chi lo usa.
  const turnBlocked=sending||offline||!myTurn||acted;
  const fifthAction=game.missionId==='nucleo'
    ?{label:'PURGA',icon:<Zap/>,stat:'CANCELLA IL NUCLEO DATI',sub:game.purged?'Già lanciata':purgeReady?'Poi portate tutti alla consegna':actRoomId!==game.vaultRoom?`Nucleo in ${game.vaultRoom}`:'Firewall ancora attivo',disabled:turnBlocked||!purgeReady,onClick:()=>act('purge')}
    :game.missionId==='assedio'
    ?{label:'SCARICA',icon:<Download/>,stat:`-${DOWNLOAD_FOCUS} FOCUS · ${game.download.progress}/${game.download.required} TRASFERIMENTO`,sub:game.download.done?'Trasferimento già completo':downloadReady?'Resta sul posto e ripeti finché non è completo':actRoomId!==game.vaultRoom?`Sorgente in ${game.vaultRoom}`:'Sorgente ancora sigillata',disabled:turnBlocked||!downloadReady||player.focus<DOWNLOAD_FOCUS,onClick:()=>act('download')}
    :game.missionId==='ostaggio'
    ?{label:'LIBERA',icon:<Briefcase/>,stat:`LO SCORTI TU · ${game.hostage.hp}/${game.hostage.maxHp} HP`,sub:escorting?'Lo stai già scortando':hostageBlocked?`Cella sigillata: servono ${game.nodesRequired} nodi`:hostageHere?'Libera l’informatore':`Informatore in ${hostageRoomOf(game)||'—'}`,disabled:turnBlocked||!hostageHere||hostageBlocked,onClick:()=>act('free')}
    :game.missionId==='spettro'
    ?{label:'CATTURA',icon:<ScanEye/>,stat:'CHIUDE LA GABBIA SU SPETTRO',sub:specter?.captured?'SPETTRO è già in gabbia':!specter?.awake?`Dorme nella culla: servono ${game.nodesRequired} nodi`:!specterHere?`SPETTRO è in ${specter.room}`:specterEscapes.length?`Ha ancora vie di fuga: ${specterEscapes.join(' · ')}`:'È braccato: catturalo adesso',disabled:turnBlocked||!captureReady,onClick:()=>act('capture')}
    :game.missionId==='reattore'
    ?{label:'INNESCO',icon:<Timer/>,stat:'ARMA LA CARICA DEL REATTORE',sub:game.reactor.exploded?'Reattore già detonato':game.reactor.armed?`Già innescata: ${game.reactor.fuse} turni al detonare`:actRoomId!==game.vaultRoom?`Reattore in ${game.vaultRoom}`:!game.vaultOpen?'Accesso ancora sigillato':'Arma la carica e allontanati subito',disabled:turnBlocked||!armReady,onClick:()=>act('arm')}
    :{label:'RECUPERO',icon:<Briefcase/>,stat:'DIVENTI IL PORTATORE',sub:carrying?'La stai già portando':caseBlocked?`Teca sigillata: servono ${game.nodesRequired} nodi`:caseHere?'Raccogli la valigetta MNEMOSYNE':`Valigetta in ${caseRoomOf(game)||'—'}`,disabled:turnBlocked||!caseHere||caseBlocked,onClick:()=>act('grab')};
  const act=async(type:string,roomId?:string)=>{if(sending||offline||!myTurn)return;try{setSending(true);setError('');await api('/api/action',{method:'POST',body:JSON.stringify({code:game.code,playerId:player.id,deviceId:session.deviceId,type,targetId:selectedTarget,roomId:roomId||null})});setMoving(false);}catch(e){playSfx('alert');setError((e as Error).message);}finally{setSending(false);}};
  const endTurn=async()=>{if(sending||offline||!myTurn)return;try{setSending(true);setError('');await api('/api/endturn',{method:'POST',body:JSON.stringify({code:game.code,playerId:player.id,deviceId:session.deviceId})});setMoving(false);}catch(e){playSfx('alert');setError((e as Error).message);}finally{setSending(false);}};
  const waiting=game.phase==='lobby';
  // Raggio delle abilità che colpiscono "stanza attuale + adiacenti" (CIPHER, DRIVER): stesse regole del server.
  const reachRooms=useMemo(()=>[actRoomId,...(room?.links||[])],[actRoomId,room]);
  const reachHostiles=useMemo(()=>game.enemies.filter((e)=>e.hp>0&&reachRooms.includes(e.room)),[game.enemies,reachRooms]);
  const reachOpenNode=useMemo(()=>reachRooms.some((id)=>{const r=roomOf(game,id);return Boolean(r?.node)&&!game.nodes?.[id];}),[game,reachRooms]);
  const abilityReason=(()=>{
    switch(player.characterId){
      case 'ghost':case 'chrome':return hostiles.length?'':'Nessun ostile nella tua stanza';
      case 'cipher':return(reachOpenNode||reachHostiles.some((e)=>e.type==='DRONE'))?'':'Nessun nodo o drone raggiungibile';
      case 'ripper':return game.players.some((x)=>x.room===actRoomId&&(x.hp<=0||x.hp<x.maxHp))?'':'Nessun compagno da curare qui';
      case 'driver':return reachHostiles.length?'':'Nessun ostile nel settore';
      case 'breacher':return(hostiles.length||lockedExits.length)?'':'Nessun ostile né porta bloccata qui';
      case 'handler':return game.players.some((x)=>x.id!==player.id&&x.hp>0&&x.room===actRoomId&&x.focus<x.maxFocus)?'':'Nessun compagno da ricaricare qui';
      default:return'';
    }
  })();
  const abilityBlocked=turnBlocked||player.focus<3||Boolean(abilityReason);
  const cardProps={pending,onArm:armPending,onCancel:cancelPending};
  const confirm=(run:()=>Promise<void>)=>()=>{setPending(null);void run();};
  const availableActions={
    attack:!turnBlocked&&shootable.length>0&&!emptyMag,
    hack:!turnBlocked&&nodeHere&&player.focus>=HACK_FOCUS,
    heal:!turnBlocked&&Boolean(downedHere||player.hp<player.maxHp),
    mission:!fifthAction.disabled,
    door:!turnBlocked&&(sealMode&&selectedDoor&&!selectedDoorClosed?player.focus>=SEAL_FOCUS:selectedDoorClosed&&player.focus>=UNLOCK_FOCUS),
    reload:!turnBlocked&&!magFull,
    camera:!turnBlocked&&cameraHere,
    chest:!turnBlocked&&chestReady,
  };
  // Sequenza stabile come sulla plancia: le azioni conservano colore e numero anche se non disponibili.
  const actionCards=[
    {id:'attack',content:(
      <div className="action-pair action-pair-attack">
              <ActionCard {...cardProps} id="attack" className="action-attack" label={`FUOCO +${player.dmg}`} confirmSfx="shoot" onConfirm={confirm(()=>act('attack'))} disabled={!availableActions.attack} title={emptyMag?'Caricatore vuoto':shootable.length?'':sniper?'Nessun ostile a tiro':'Nessun ostile nella tua stanza'}><Swords/><span><b>FUOCO +{player.dmg}</b><em className="action-stat">{attackDamage} DANNI{thermalStep?` (+${Math.round(thermalStep*100)}% TERMICO)`:''}{hasMod(player,'double')?` · ${Math.round(MOD_DOUBLE_CHANCE*100)}% DOPPIO`:''} · CARICATORE {player.mag}/{player.maxMag}</em><small>{emptyMag?'Caricatore vuoto: usa RICARICA':targetEnemy?`Colpisci ${targetEnemy.name} (${targetEnemy.hp}/${targetEnemy.maxHp})${targetEnemy.room!==actRoomId?` da ${actRoomId} verso ${targetEnemy.room}`:''}${targetEnemy.hp<=attackDamage?' · LO ABBATTI':''}`:sniper?'Nessun ostile a tiro':'Nessun ostile qui'}</small></span><kbd>01</kbd></ActionCard>
              {shootable.length>1&&<div className="target-row enemy-row"><Crosshair size={14}/><span>BERSAGLIO</span><select aria-label="Bersaglio del fuoco" value={selectedTarget} onChange={(e)=>{setPending(null);setAttackTarget(e.target.value);}} disabled={sending||!myTurn}>{shootable.map((e)=><option value={e.id} key={e.id}>{e.name} // {e.hp}/{e.maxHp} HP{e.room!==actRoomId?` // ${e.room}`:''}</option>)}</select></div>}
            </div>
    )},
    {id:'hack',content:(
      <ActionCard {...cardProps} id="hack" className="action-hack" label="INTRUSIONE" onConfirm={confirm(()=>act('hack'))} disabled={!availableActions.hack} title={nodeHere?'':'Nessun nodo attivo in questa stanza'}><Cpu/><span><b>INTRUSIONE</b><em className="action-stat">-{HACK_FOCUS} FOCUS · +1 NODO ({game.breach}/{game.nodesRequired})</em><small>{player.focus<HACK_FOCUS?`Focus insufficiente (${player.focus}/${HACK_FOCUS})`:nodeHere?'Viola il nodo di questa stanza':'Nessun nodo attivo qui'}</small></span><kbd>02</kbd></ActionCard>
    )},
    {id:'heal',content:(
      <ActionCard {...cardProps} id="heal" className="action-heal" label={downedHere?'RIANIMAZIONE':'RIPRISTINO'} onConfirm={confirm(()=>act('heal'))} disabled={!availableActions.heal}><HeartPulse/><span><b>{downedHere?'RIANIMAZIONE':'RIPRISTINO'}</b><em className="action-stat">{downedHere?`RIENTRA A ${Math.round(downedHere.maxHp*REVIVE_RATIO)} INTEGRITÀ`:`+${HEAL_AMOUNT} INTEGRITÀ`}</em><small>{downedHere?`Rimette in piedi ${downedHere.name} (${Math.round(downedHere.maxHp*REVIVE_RATIO)}/${downedHere.maxHp})`:player.hp>=player.maxHp?'Sei già a piena integrità':`Ti curi (${player.hp}/${player.maxHp})`}</small></span><kbd>03</kbd></ActionCard>
    )},
    {id:'mission',content:(
      <ActionCard {...cardProps} id="mission" label={fifthAction.label} className="grab-action" onConfirm={confirm(fifthAction.onClick)} disabled={!availableActions.mission}>{fifthAction.icon}<span><b>{fifthAction.label}</b><em className="action-stat">{fifthAction.stat}</em><small>{fifthAction.sub}</small></span><kbd>04</kbd></ActionCard>
    )},
    {id:'door',content:(
      sealMode&&selectedDoor&&!selectedDoorClosed?<div className="action-pair action-pair-unlock">
              <ActionCard {...cardProps} id="seal" className="action-unlock action-seal" label="SIGILLA PORTA" onConfirm={confirm(()=>act('seal',selectedDoor))} disabled={!availableActions.door}><Lock/><span><b>SIGILLA PORTA</b><em className="action-stat">-{SEAL_FOCUS} FOCUS · CHIUDE LA PORTA VERSO {selectedDoor}</em><small>{player.focus<SEAL_FOCUS?`Focus insufficiente (${player.focus}/${SEAL_FOCUS})`:specterEscapes.includes(selectedDoor)&&(specter?.room===actRoomId||specter?.room===selectedDoor)?'Toglie una via di fuga a SPETTRO':'SPETTRO passa solo da porte aperte'}</small></span><kbd>05</kbd></ActionCard>
              {doorChoices.length>1&&<div className="target-row door-row"><LockKeyhole size={14}/><span>PORTA</span><select aria-label="Porta da modificare" value={selectedDoor} onChange={(e)=>{setPending(null);setDoorTarget(e.target.value);}} disabled={sending||!myTurn}>{doorChoices.map((id)=><option value={id} key={id}>{id} // {roomOf(game,id)?.name} · {doorClosed(game,actRoomId,id)?'CHIUSA':'APERTA'}</option>)}</select></div>}
            </div>:<div className="action-pair action-pair-unlock">
              <ActionCard {...cardProps} id="unlock" className="action-unlock" label="SBLOCCA PORTA" onConfirm={confirm(()=>act('unlock',selectedDoor))} disabled={!availableActions.door} title={lockedExits.length?'':'Nessuna porta bloccata in questa stanza'}><LockKeyhole/><span><b>SBLOCCA PORTA</b><em className="action-stat">-{UNLOCK_FOCUS} FOCUS · APRE LA PORTA VERSO {selectedDoorClosed?selectedDoor:'—'}</em><small>{player.focus<UNLOCK_FOCUS?`Focus insufficiente (${player.focus}/${UNLOCK_FOCUS})`:lockedExits.length?`Porte bloccate qui: ${lockedExits.join(' · ')}`:'Nessuna porta bloccata qui'}</small></span><kbd>05</kbd></ActionCard>
              {doorChoices.length>1&&<div className="target-row door-row"><LockKeyhole size={14}/><span>{sealMode?'PORTA':'PORTA DA SBLOCCARE'}</span><select aria-label="Porta da modificare" value={selectedDoor} onChange={(e)=>{setPending(null);setDoorTarget(e.target.value);}} disabled={sending||!myTurn}>{doorChoices.map((id)=><option value={id} key={id}>{id} // {roomOf(game,id)?.name}{sealMode?` · ${doorClosed(game,actRoomId,id)?'CHIUSA':'APERTA'}`:''}</option>)}</select></div>}
            </div>
    )},
    {id:'reload',content:(
      <ActionCard {...cardProps} id="reload" label="RICARICA" onConfirm={confirm(()=>act('reload'))} disabled={!availableActions.reload} title={magFull?'Caricatore già pieno':''}><RefreshCw/><span><b>RICARICA</b><em className="action-stat">CARICATORE PIENO ({player.maxMag})</em><small>{magFull?'Caricatore già pieno':`Ora ${player.mag}/${player.maxMag} → torni a ${player.maxMag}`}</small></span><kbd>06</kbd></ActionCard>
    )},
    {id:'camera',content:(
      <ActionCard {...cardProps} id="camera" className="action-camera" label="DISABILITA TELECAMERA" onConfirm={confirm(()=>act('camera'))} disabled={!availableActions.camera} title={cameraHere?'':'Nessuna telecamera attiva in questa stanza'}><CameraOff/><span><b>DISABILITA TELECAMERA</b><em className="action-stat">ALLARME -{CAMERA_ALARM_RELIEF}%</em><small>{cameraHere?'Spegni la telecamera di questa stanza':game.cameras?.length?`Telecamere attive: ${game.cameras.join(' · ')}`:'Nessuna telecamera attiva'}</small></span><kbd>07</kbd></ActionCard>
    )},
    {id:'chest',content:(
      <ActionCard {...cardProps} id="chest" className="action-chest" label="APRI CASSA" onConfirm={confirm(()=>act('chest'))} disabled={!availableActions.chest} title={modded?`Hai già ${mods[0].name}: una modifica a testa`:chestHere?(chestHere.uses<=0?'Cassa già svuotata':hostiles.length?'Ostili nella stanza':''):'Nessuna cassa in questa stanza'}><PackagePlus/><span><b>APRI CASSA</b><em className="action-stat">1 MODIFICA CASUALE{chestHere?` · ${chestHere.uses}/${chestHere.max??chestHere.uses} NELLA CASSA`:''}</em><small>{modded?`Hai già ${mods[0].name}: la cassa è per i compagni`:!chestHere?(game.chests?.length?`Casse in: ${game.chests.filter((c)=>c.uses>0).map((c)=>c.room).join(' · ')||'nessuna, tutte svuotate'}`:'Nessuna cassa su questa plancia'):chestHere.uses<=0?'Cassa già svuotata':hostiles.length?'Prima ripulisci la stanza dagli ostili':'Equipaggi subito la modifica che esce'}</small></span><kbd>08</kbd></ActionCard>
    )}
  ];
  return <main ref={consoleRoot} className={`player-shell player-console${damage?' damage-shake':''}`} style={{'--accent':player.color} as React.CSSProperties}>
    {damage&&<div className="damage-flash" key={damage.id} role="alert" aria-label={`Colpito: meno ${damage.amount} integrità`}><b>−{damage.amount}</b><small>INTEGRITÀ {Math.max(0,player.hp)}/{player.maxHp}</small></div>}
    {turnFlash>0&&<div className="turn-start-flash" key={turnFlash} aria-hidden="true"><b>TOCCA A TE</b></div>}
    <header className="player-top">
      <div className="player-id"><span><OpIcon characterId={player.characterId} alt={player.callsign}/><button type="button" className="weapon-preview-trigger" aria-label={`Ingrandisci ritratto di ${player.callsign}`} aria-haspopup="dialog" onClick={()=>setImagePreview('character')}/></span><div><b>{player.name}</b><small className="player-role">{player.role} // {player.specialty}</small></div></div>
      <div className="round-state"><span>ROUND <b>{String(game.round).padStart(2,'0')}</b></span><span className="pos"><MapPin aria-hidden="true"/><b>{player.room}</b><em>{room?.name}</em></span><span className="alarm">ALLARME <b>{game.alarm}%</b></span></div>
      <div className="player-tools"><small className="console-uplink-label">UPLINK // ENCRYPTED</small><div className={`link-state ${offline?'offline':''}`} role="status" aria-label={offline?'Connessione persa. Riconnessione in corso.':'Connessione attiva'}>{offline?<WifiOff/>:<Wifi/>}<span>{offline?'OFFLINE':'ONLINE'}</span></div></div>
    </header>
    <section className="player-grid">
      <aside className="vitals" aria-label="Risorse dell’operativo">
        <div className="vital-title"><Activity aria-hidden="true"/> STATO BIOMETRICO</div><div className="big-vital"><HeartPulse className="resource-icon" aria-hidden="true"/><span>INTEGRITÀ</span><b>{player.hp}<small>/{player.maxHp}</small></b><Meter value={player.hp} max={player.maxHp}/></div><div className="sub-vitals"><span className="focus-vital"><Brain className="resource-icon" aria-hidden="true"/><i>FOCUS</i><b>{player.focus}/{player.maxFocus}</b><Meter value={player.focus} max={player.maxFocus} tone="violet"/></span><span className="mag-vital"><span className="ammo-glyph" aria-hidden="true"><i/><i/><i/></span><i>CARICATORE</i><b>{player.mag}/{player.maxMag}</b><Meter value={player.mag} max={player.maxMag} tone="gold"/></span></div>
        <div className="console-weapon-summary"><div><small>ARMA</small><b>{player.weapon} <em>+{player.dmg}</em></b></div><WeaponArt characterId={player.characterId} weapon={player.weapon}/><button type="button" className="weapon-preview-trigger" aria-label={`Ingrandisci ${player.weapon}, ${player.dmg} danni`} aria-haspopup="dialog" onClick={()=>setImagePreview('weapon')}/></div>
        {mods.length>0&&<section className="console-mods" aria-label="Modifiche arma"><small>MODIFICHE INSTALLATE</small>{mods.map((m)=><article key={m.id}><b>{m.name}</b><p>{m.text}</p></article>)}</section>}
      </aside>
      <section id="console-actions" aria-label="Azioni operative" tabIndex={-1} className={`actions ${myTurn?'':'off-turn'}`}><div className="action-head"><b>{actedCount}/{ACTIONS_PER_TURN} AZIONI USATE</b><span className="action-budget" aria-hidden="true">{Array.from({length:ACTIONS_PER_TURN},(_,i)=><i key={i} className={i<actedCount?'used':''}/>)}</span></div>
        {waiting?<div className="standby"><Radio/><b>IN ATTESA DELLA PLANCIA</b><span>Sei {player.callsign} // {player.role}. Il computer avvierà l’operazione quando la squadra sarà pronta.</span>{onRepick&&<button type="button" className="ghost-btn" onClick={onRepick}>CAMBIA SCHEDA</button>}</div>:game.phase!=='active'?<div className="standby"><Sparkles/><b>OPERAZIONE CONCLUSA</b><span>Controlla lo schermo principale.</span></div>:player.hp<=0?<div className="standby danger"><Skull/><b>FUORI COMBATTIMENTO</b><span>Sei a terra in {player.room}. Un compagno nella stessa stanza può rianimarti subito; altrimenti ti rialzi da solo a 1 INTEGRITÀ dopo aver saltato 3 dei tuoi turni — ma solo se resta almeno un compagno in piedi.</span></div>:<>
          <button className={`move-btn ${moved?'armed':''}`} data-sfx="confirm" onClick={()=>{setPending(null);setMoving(true);}} disabled={sending||offline||!myTurn||!openExits.length||!canMove}><Footprints/><span><b>{!canMove?'AZIONI ESAURITE':freeMoveLeft?'MANOVRA · GRATIS':'MANOVRA · 1 AZIONE'}</b><small>{!canMove?`Hai usato le ${ACTIONS_PER_TURN} azioni · chiudi il turno`:`${freeMoveLeft?'Piede sull’acceleratore: non consuma azioni · ':moved?`${maneuversMade} ${maneuversMade===1?'manovra fatta':'manovre fatte'} · `:''}${carrying?'Porti la valigetta · ':escorting?'Scorti l’informatore · ':''}${openExits.length?`Porte aperte: ${openExits.join(' · ')}`:'Nessuna porta aperta'}${lockedExits.length?` · Bloccate: ${lockedExits.join(' · ')}`:''}`}</small></span><ChevronRight/></button>
          <div className="action-grid">{actionCards.map(({id,content})=><div className="console-action-item" key={id}>{content}</div>)}</div>
        </>}
      </section>
      <section className="loadout-panel" aria-label="Abilità dell’operativo">
        <div className="ability-panel"><Zap aria-hidden="true"/><h2>{player.ability}</h2><small>−3 FOCUS</small><p>{player.abilityText}</p>{(abilityReason||player.focus<3)&&<p className="ability-warn">{player.focus<3?`Focus insufficiente: ${player.focus}/3`:abilityReason}</p>}{pending==='ability'&&!abilityBlocked?<div className="ability-confirm" role="group" data-confirmation aria-label={`Conferma ${player.ability}`}><button type="button" data-sfx="back" onClick={cancelPending}><X/> ANNULLA</button><button type="button" className="ok" data-sfx="confirm" onClick={confirm(()=>act('ability'))}><Check/> CONFERMA</button></div>:<button id="console-ability" disabled={abilityBlocked} title={abilityReason||undefined} onClick={()=>armPending('ability')}>ATTIVA ABILITÀ <ChevronRight/></button>}</div>
        <PassiveAbilities passives={player.passives}/>

      </section>
    <footer className="console-dock">
      <div className={`endturn-fab ${pending==='endturn'?'armed':''}`}>
      <button type="button" id="console-endturn" className="endturn-card" data-sfx="confirm" onClick={()=>armPending('endturn')} disabled={sending||offline||!myTurn} aria-expanded={pending==='endturn'} aria-controls={pending==='endturn'?'console-endturn-confirm':undefined}>
        <Check/><span><small>{sending?'INVIO COMANDO…':'COMANDO SISTEMA'}</small><b>FINE TURNO{myTurn&&!moved&&!actedCount?' · SALTA':''}</b></span><ChevronRight/>
      </button>
      {pending==='endturn'&&myTurn&&!sending&&!offline&&<div id="console-endturn-confirm" className="endturn-confirm" role="group" data-confirmation aria-label="Conferma fine turno">
        <p>{moved||actedCount?`Chiudi turno · ${actedCount}/${ACTIONS_PER_TURN} azioni usate`:'Salti il turno senza usare azioni'}</p>
        <div><button type="button" data-sfx="back" onClick={cancelPending}><X/> ANNULLA</button><button type="button" className="ok" data-sfx="confirm" onClick={confirm(endTurn)}><Check/> CONFERMA</button></div>
      </div>}
      </div>
      {error&&<p className="console-error" role="alert">{error}</p>}
    </footer>
    </section>
    {moving&&<PlayerMoveDialog onClose={()=>setMoving(false)}><header><div><small>MANOVRA // DA {player.room} {room?.name}</small><b id="move-title">SCEGLI LA STANZA</b></div><button type="button" className="move-close" aria-label="Chiudi manovra" onClick={()=>setMoving(false)}><X size={18}/></button></header>
      <div className="player-move-map">
      <BoardMap variant="mini" missionId={game.missionId} rooms={roomsOf(game)} pawnsIn={pawnsOf(game,player.id)} foesIn={foesOf(game)} marksIn={marksOf(game)} doors={game.doors} cameras={game.cameras} chests={game.chests} fogged={foggedOf(game)} hits={hits} highlight={moveTargets} currentRoom={player.room} onPick={sending||offline||!myTurn||!canMove?undefined:(id)=>{void act('move',id);}}/>
      </div>
      <div className="move-destinations" aria-label="Destinazioni raggiungibili">{moveTargets.map((id)=><button type="button" key={id} disabled={sending||offline||!myTurn||!canMove} onClick={()=>{void act('move',id);}}><MapPin aria-hidden="true"/><b>{id}</b><span>{roomOf(game,id)?.name}</span><ChevronRight aria-hidden="true"/></button>)}</div>
      <footer>{hostilesNow.length?<b className="warn"><AlertTriangle size={16}/> Se esci da {player.room}, {hostilesNow[0].name} ti inseguirà.</b>:<b><DoorOpen size={16}/> Porte aperte: {openExits.join(' · ')||'nessuna'}</b>}{lockedExits.length>0&&<b className="warn"><LockKeyhole size={16}/> Bloccate: {lockedExits.join(' · ')} — sbloccale con SBLOCCA PORTA</b>}<span role="alert">{error}</span></footer>
    </PlayerMoveDialog>}
    {imagePreview&&<PlayerImagePreview player={player} kind={imagePreview} onClose={()=>setImagePreview(null)}/>}
    {spawnAlert.current&&<SpawnAlert key={spawnAlert.current.id} enemy={spawnAlert.current} roomName={roomOf(game,spawnAlert.current.room)?.name||''} onClose={spawnAlert.dismiss}/>}
    {lockdownAlert.active&&<LockdownAlert onClose={lockdownAlert.dismiss}/>}
    {game.phase==='active'&&game.lockdown&&<LockdownOverlay/>}
  </main>;
}

// DATABASE // ARCHIVIO UNITÀ: contenuto in sola lettura del database operativi (gli 8 personaggi
// giocabili) e nemici (set base, forza crescente). Usato sia dalla pagina standalone
// (?mode=database) sia come sezione DATABASE dentro il pannello IMPOSTAZIONI.
function DatabaseSection({templates,enemyRoster}:{templates:Template[];enemyRoster:EnemyRosterEntry[]}){
  return <div className="db-body">
    <section className="panel db-section">
      <div className="panel-kicker">DATABASE OPERATIVI // {templates.length} SCHEDE</div>
      <h1>Operativi</h1>
      <p className="db-note">I personaggi giocabili. Ogni operativo ha una sola abilità esclusiva (3 focus) oltre all’attacco base dell’arma.</p>
      <div className="db-grid">{templates.map((t)=><article className="db-card" style={{'--accent':t.color} as React.CSSProperties} key={t.id}>
        <div className="db-card-head"><span className="avatar"><OpIcon characterId={t.id} alt={t.callsign}/></span><div><b>{t.callsign}</b><small>{t.role} // {t.specialty}</small></div></div>
        <div className="loadout"><span><small>INTEGRITÀ</small><b>{t.maxHp}</b></span><span><small>DANNO</small><b>+{t.dmg}</b></span><span><small>CARICATORE</small><b>{t.mag}</b></span><span><small>FOCUS</small><b>{t.focus}</b></span></div>
        <div className="ability-card"><Zap size={16}/><div><small>{t.weapon} · ABILITÀ // -3 FOCUS</small><b>{t.ability}</b><p>{t.abilityText}</p></div></div>
        <PassiveAbilities passives={t.passives}/>
      </article>)}</div>
    </section>
    <section className="panel db-section">
      <div className="panel-kicker">DATABASE NEMICI // {enemyRoster.length} UNITÀ BASE · FORZA CRESCENTE</div>
      <h1>Nemici</h1>
      <p className="db-note">Set base di unità Helix, dalla più fragile alla più letale. Le missioni pescano da qui il proprio presidio.</p>
      <div className="db-enemies">{enemyRoster.map((e)=><article className="db-enemy" key={e.key}>
        <img className="db-enemy-icon" src={enemyImg(e.key)} alt={e.type} loading="lazy" decoding="async"/>
        <div className="db-tier"><small>TIER</small><b>{e.tier}</b></div>
        <div className="db-enemy-main"><b>{e.name}</b><small>{e.type}</small><p>{e.note}</p><p className="db-deploy"><Skull size={11}/> {e.deploy}</p></div>
        <div className="db-enemy-stats"><span><small>INTEGRITÀ</small><b>{e.hp}</b></span><span><small>DANNO</small><b>+{e.damage}</b></span><span><small>MINACCIA</small><b>{e.threat}</b></span></div>
      </article>)}</div>
    </section>
  </div>;
}

// Pannello ALLARME standalone (?mode=alarm): console leggibile da una finestra/schermo a parte.
// Oltre al livello corrente espone la prossima escalation, così la squadra sa quanto margine ha
// prima di richiamare un Segugio, attivare il lockdown o perdere il settore.
function AlarmPanel(){
  const {snapshot,offline}=useSnapshot();
  const game=snapshot.game;
  const pct=Math.max(0,Math.min(100,game?.alarm??0));
  // Stesso rilevamento della plancia: quando entra una nuova minaccia, per i SPAWN_ALERT_SECONDS
  // in cui sulla plancia lampeggia il pop-up + sirena, qui tutto lo schermo pulsa rosso/nero.
  const {current:spawnCurrent,dismiss:spawnDismiss}=useSpawnAlerts(game);
  const lockdownAlert=useLockdownAlert(game);
  const {active:blackoutActive,dismiss:blackoutDismiss}=useBlackoutAlert(game);
  const [flash,setFlash]=useState(false);
  useEffect(()=>{
    if(!spawnCurrent)return;
    setFlash(true);
    const t=setTimeout(()=>{setFlash(false);spawnDismiss();},SPAWN_ALERT_SECONDS*1000);
    return()=>clearTimeout(t);
  },[spawnCurrent,spawnDismiss]);
  const [blackoutFlash,setBlackoutFlash]=useState(false);
  useEffect(()=>{
    if(!blackoutActive)return;
    playSfx('blackout');
    setBlackoutFlash(true);
    const t=setTimeout(()=>{setBlackoutFlash(false);blackoutDismiss();},BLACKOUT_ALERT_SECONDS*1000);
    return()=>clearTimeout(t);
  },[blackoutActive,blackoutDismiss]);
  const lockdownActive=game?.phase==='active'&&game.lockdown;
  // Vista del pannello: 2D (piatta, quella di sempre) o 3D (console in prospettiva). Resta nel browser.
  const [view,setView]=useState<'2d'|'3d'>(()=>{try{return localStorage.getItem('roverpunk-alarm-view')==='2d'?'2d':'3d';}catch{return '3d';}});
  const pickView=(v:'2d'|'3d')=>{setView(v);try{localStorage.setItem('roverpunk-alarm-view',v);}catch{/* preferenza non salvata */}};
  const escalationSteps=[
    {at:25,label:'SEGUGIO IN ARRIVO',detail:'Nuova unità da caccia'},
    {at:35,label:'SEGUGIO IN ARRIVO',detail:'Nuova unità da caccia'},
    {at:45,label:'SEGUGIO IN ARRIVO',detail:'Nuova unità da caccia'},
    {at:50,label:'BLACKOUT',detail:'Ogni porta si richiude'},
    {at:55,label:'SEGUGIO IN ARRIVO',detail:'Nuova unità da caccia'},
    {at:65,label:'SEGUGIO IN ARRIVO',detail:'Nuova unità da caccia'},
    {at:70,label:'LOCKDOWN',detail:'I presidi convergono'},
    {at:75,label:'SEGUGIO IN ARRIVO',detail:'Nuova unità da caccia'},
    {at:85,label:'SEGUGIO IN ARRIVO',detail:'Nuova unità da caccia'},
    {at:100,label:'SATURAZIONE',detail:'Operazione compromessa'},
  ];
  const nextEscalation=game?.phase==='active'?escalationSteps.find((step)=>pct<step.at):undefined;
  const linkStatus=offline?'SEGNALE INTERROTTO':!game||game.phase==='lobby'?'IN ATTESA DELLA PLANCIA':'LINK TATTICO STABILE';
  return <main className={`alarm-panel view-${view}${flash?' flashing':''}${lockdownActive?' lockdown-active':''}`} style={{'--alarm-progress':`${pct * 3.6}deg`} as React.CSSProperties}>
    {blackoutFlash&&<div className="alarm-panel-blackout-flash" aria-hidden="true"/>}
    {lockdownActive&&<div className="alarm-marquee" aria-hidden="true"><div className="alarm-marquee-track"><span>LOCKDOWN IN CORSO</span><span>LOCKDOWN IN CORSO</span></div></div>}
    <header className="alarm-panel-head">
      <div className="alarm-brand"><ShieldAlert/><span><small>HELIX // SICUREZZA DI SETTORE</small><b>PANNELLO ALLARME</b></span></div>
      <div className="alarm-head-right">
        <div className={`alarm-link ${offline?'offline':''}`}><i/><span>{linkStatus}</span></div>
        <div className="alarm-view-switch" role="group" aria-label="Vista del pannello">{(['2d','3d'] as const).map((v)=><button type="button" key={v} className={view===v?'on':''} aria-pressed={view===v} onClick={()=>pickView(v)}>{v.toUpperCase()}</button>)}</div>
      </div>
    </header>
    <section className="alarm-dashboard">
      <div className="alarm-side-label left">SISTEMA DI RILEVAMENTO<br/>CANALI // 04<br/>ANOMALIE // {game?.alarmSpawns.length??0}</div>
      <div className="alarm-core" aria-live="polite" aria-label={`Allarme al ${pct}%`}>
        <div className="alarm-core-rings" aria-hidden="true"><i/><i/><i/></div>
        <div className="alarm-panel-num"><b>{pct}</b><span>%</span></div>
        <small>LIVELLO DI ALLARME</small>
      </div>
      <div className="alarm-side-label right">TRACCIA HELIX<br/>SOGLIE // 25—85<br/>SISTEMA // {lockdownActive?'BLOCCATO':'ARMATO'}</div>
    </section>
    <div className="alarm-panel-bar" aria-hidden="true"><i style={{width:`${pct}%`}}/><span className="alarm-bar-marker marker-hunters">SEGUGI</span><span className="alarm-bar-marker marker-lockdown">LOCK</span><span className="alarm-bar-marker marker-fail">100</span></div>
    <section className="alarm-next-event">
      <div><small>PROSSIMA ESCALATION</small><b>{nextEscalation?nextEscalation.label:pct>=100?'SETTORE SATURO':'IN ATTESA DI DATI'}</b><span>{nextEscalation?nextEscalation.detail:pct>=100?'Nessun margine operativo residuo':'Avvia una missione per calcolare la soglia'}</span></div>
      <strong>{nextEscalation?<><em>TRA</em> +{nextEscalation.at-pct}%</>:pct>=100?'100%':'—'}</strong>
    </section>
    <footer className="alarm-panel-foot"><span>TELEMETRIA LIVE // ROVERPUNK</span><b>ALLARME HELIX</b><span>{game?.phase==='active'?`ROUND ${String(game.round).padStart(2,'0')}`:'NESSUNA OPERAZIONE'}</span></footer>
    {flash&&<div className="alarm-panel-flash" aria-hidden="true"/>}
    {lockdownAlert.active&&<LockdownAlert onClose={lockdownAlert.dismiss}/>}
    {lockdownActive&&<LockdownOverlay/>}
  </main>;
}

// Pagina standalone del database, avviabile con ?mode=database.
function DatabasePage(){
  const {snapshot}=useSnapshot();
  const {templates,enemyRoster}=snapshot;
  const [settings,setSettings]=useState(false);
  if(!templates.length) return <div className="loading">CARICAMENTO DATABASE...</div>;
  return <main className="db-shell">
    <header className="setup-header">
      <div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>DATABASE // ARCHIVIO UNITÀ</small></div></div>
      <div className="header-tools"><button type="button" className="db-link" onClick={()=>{location.href='/';}}>← PLANCIA</button><SettingsButton onOpen={()=>setSettings(true)}/><span className="local-tag"><CircleDot size={13}/> SOLA LETTURA</span></div>
    </header>
    <DatabaseSection templates={templates} enemyRoster={enemyRoster}/>
    {settings&&<Settings templates={templates} onClose={()=>setSettings(false)}/>}
  </main>;
}

function BoardRoot(){
  const {snapshot,setSnapshot}=useSnapshot();
  const [controllerToken,setControllerToken]=useState<string|null>(()=>{try{return localStorage.getItem('roverpunk-controller-token');}catch{return null;}});
  const rememberController=(token:string)=>{setControllerToken(token);try{localStorage.setItem('roverpunk-controller-token',token);}catch{/* storage non disponibile */}};
  // All'apertura si parte sempre dalla schermata di creazione: una partita già sul server si
  // riprende solo con CONTINUA PARTITA. Il codice ripreso resta in sessionStorage, così una
  // ricarica della pagina mantiene la partita, mentre chiudere e riaprire la scheda riparte da capo.
  const [resumedCode,setResumedCode]=useState<string|null>(()=>{try{return sessionStorage.getItem('roverpunk-resumed');}catch{return null;}});
  const resume=(code:string)=>{setResumedCode(code);try{sessionStorage.setItem('roverpunk-resumed',code);}catch{/* storage non disponibile */}};
  const gameCode=snapshot.game?.code;
  const resumed=!!gameCode&&resumedCode===gameCode;
  // Se il token locale manca (per esempio dopo un cambio di porta/origine), la plancia che
  // ospita il server lo recupera. Il server rifiuta la stessa richiesta dalla LAN.
  useEffect(()=>{
    if(!gameCode||controllerToken)return;
    let active=true;
    void api('/api/claim-controller',{method:'POST',body:'{}'}).then((data)=>{if(active&&data.controllerToken)rememberController(data.controllerToken);}).catch(()=>{});
    return()=>{active=false;};
  },[gameCode,controllerToken]);
  const reset=async()=>{await api('/api/reset',{method:'POST',body:JSON.stringify({controllerToken})});setSnapshot((s)=>({...s,game:null}));setControllerToken(null);try{localStorage.removeItem('roverpunk-controller-token');}catch{/* storage non disponibile */}};
  // La colonna sonora "di partita" parte solo quando il round è avviato (non in lobby/setup).
  const {setPhase}=useAudio();
  const playing=resumed&&!!snapshot.game&&snapshot.game.phase!=='lobby';
  useEffect(()=>{ setPhase(playing?'game':'menu'); },[playing,setPhase]);
  // Il portellone si apre solo nel passaggio lobby → partita visto da questa plancia:
  // un refresh a partita avviata non lo rimostra.
  const phase=snapshot.game?.phase;
  const prevPhase=useRef(phase);
  const [doorOpening,setDoorOpening]=useState(false);
  // Layout effect: il portellone va montato prima del primo paint della plancia.
  useLayoutEffect(()=>{
    if(prevPhase.current==='lobby'&&phase==='active')setDoorOpening(true);
    prevPhase.current=phase;
  },[phase]);
  if(!snapshot.game&&!snapshot.templates.length)return <div className="loading">INIZIALIZZAZIONE ARCHIVIO OPERATIVI...</div>;
  if(!snapshot.game||!resumed){
    const resumable=!!snapshot.game&&(snapshot.game.phase==='lobby'||snapshot.game.phase==='active');
    return <Setup templates={snapshot.templates} missions={snapshot.missions} riskLevels={snapshot.riskLevels} enemyRoster={snapshot.enemyRoster} controllerToken={controllerToken} resumable={resumable} onResume={()=>resume(snapshot.game!.code)} onCreated={(game,token)=>{rememberController(token);setSnapshot((s)=>({...s,game}));resume(game.code);}}/>;
  }
  if(snapshot.game.phase==='lobby')return <Lobby game={snapshot.game} templates={snapshot.templates} networkUrl={snapshot.networkUrl} controllerToken={controllerToken} onStart={(game)=>setSnapshot((s)=>({...s,game}))} onReset={reset}/>;
  return <>
    <Board game={snapshot.game} templates={snapshot.templates} missions={snapshot.missions} controllerToken={controllerToken} onReset={reset}/>
    {doorOpening&&<FactoryDoor onDone={()=>setDoorOpening(false)}/>}
  </>;
}

// Portellone industriale che si sblocca e si apre sulla plancia all'avvio della partita.
const DOOR_UNLOCK_MS=1650;
const DOOR_TOTAL_MS=8600;
function FactoryDoor({onDone}:{onDone:()=>void}){
  const done=useRef(onDone);
  done.current=onDone;
  useEffect(()=>{
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const unlock=window.setTimeout(()=>playSfx('unlock'),reduced?0:DOOR_UNLOCK_MS-250);
    const end=window.setTimeout(()=>done.current(),reduced?400:DOOR_TOTAL_MS);
    return()=>{window.clearTimeout(unlock);window.clearTimeout(end);};
  },[]);
  return <div className="factory-door" aria-hidden="true">
    <div className="fd-backdrop"/><div className="fd-backlight"/>
    {(['left','right'] as const).map((side)=><div className={`fd-leaf ${side}`} key={side}>
      <div className="fd-identity"><small>HELIX INDUSTRIES // H-07</small><strong>{side==='left'?'HΞLIX':'07'}</strong><span>{side==='left'?'SECURITY DIVISION':'RESTRICTED ACCESS'}</span></div>
      <div className="fd-warning"><span>▲</span>{side==='left'?'AREA SIGILLATA':'PERICOLO // ALTA TENSIONE'}</div>
      <div className="fd-edge-light"/>
      <div className="fd-bolt b1"/><div className="fd-bolt b2"/><div className="fd-bolt b3"/>
    </div>)}
    <div className="fd-seam"/><div className="fd-scanner"/>
    <div className="fd-lock"><div className="fd-lock-outer"/><div className="fd-lock-inner"/><div className="fd-lock-core"><b>H</b></div><div className="fd-lock-led"/></div>
    <div className="fd-status"><small>SISTEMA DI SICUREZZA // H-07</small><b className="locked">SIGILLO ATTIVO</b><b className="granted">ACCESSO AUTORIZZATO</b><span className="fd-status-track"/></div>
    <div className="fd-jamb left"/><div className="fd-jamb right"/><div className="fd-rail top"/><div className="fd-rail bottom"/>
    <div className="fd-steam left"/><div className="fd-steam right"/><div className="fd-sparks"><i/><i/><i/><i/><i/><i/></div>
  </div>;
}

// Web app aperta dall'icona in Home su un telefono (non iPad, non Mac "Aggiungi al Dock").
function installedOnPhone():boolean{
  const standalone=(navigator as Navigator&{standalone?:boolean}).standalone===true||matchMedia('(display-mode: standalone)').matches;
  return standalone&&matchMedia('(pointer: coarse)').matches&&Math.min(screen.width,screen.height)<600;
}

// La PWA installata da Home si apre sullo start_url del manifest: per questo il mode va letto
// anche dal path (/player, /alarm, /database) — la query resta supportata per i link/QR esistenti.
// Un'icona installata prima del manifest per modalità si apre ancora su "/": su un telefono la
// plancia non ha senso, quindi lì si apre la console del giocatore.
function currentMode():string|null{
  const path=location.pathname.replace(/^\/+|\/+$/g,'');
  if(path==='player'||path==='alarm'||path==='database')return path;
  const mode=new URLSearchParams(location.search).get('mode');
  if(mode)return mode;
  return installedOnPhone()?'player':null;
}

// La copertina viene mostrata una sola volta per sessione della plancia: un refresh deve
// riportare subito al gioco, mentre una nuova apertura del browser conserva l'ingresso iniziale.
const SPLASH_SEEN_KEY='roverpunk-splash-seen';
function hasSeenSplash():boolean{
  try{return sessionStorage.getItem(SPLASH_SEEN_KEY)==='true';}catch{return false;}
}
function rememberSplash(){
  try{sessionStorage.setItem(SPLASH_SEEN_KEY,'true');}catch{/* storage non disponibile */}
}

// Il primo tasto/tocco serve solo a sbloccare l'audio del browser (che parte a quel punto);
// serve un secondo tasto/tocco per entrare davvero nel gioco.
function SplashScreen({onStart}:{onStart:()=>void}){
  const [primed,setPrimed]=useState(false);
  const trigger=useCallback(()=>{ setPrimed((was)=>{ if(was) onStart(); return true; }); },[onStart]);
  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.repeat)return;
      event.preventDefault();
      trigger();
    };
    window.addEventListener('keydown',onKeyDown);
    return()=>window.removeEventListener('keydown',onKeyDown);
  },[trigger]);
  return <div className="splash-screen" onPointerDown={trigger} role="button" aria-label="Premi un tasto qualsiasi per entrare nel gioco" tabIndex={0}>
    <img src="/roverpunk-copertina.png" alt="Roverpunk 2100" decoding="async"/>
    <div className="splash-vignette" aria-hidden="true"/>
    <p className="splash-prompt">{primed?'PREMI ANCORA PER ENTRARE':'PREMI UN TASTO QUALSIASI'}</p>
  </div>;
}

export default function App(){
  const mode=useMemo(currentMode,[]);
  const isPlayer=mode==='player';
  const [introVisible,setIntroVisible]=useState(()=>!mode&&!hasSeenSplash());
  const dismissIntro=()=>{rememberSplash();setIntroVisible(false);};
  // La colonna sonora esce solo dalla plancia: telefoni e database ricevono solo gli effetti.
  if(mode==='database') return <AudioProvider music={false}><DatabasePage/></AudioProvider>;
  if(mode==='alarm') return <AudioProvider music={false}><AlarmPanel/></AudioProvider>;
  return <AudioProvider music={!isPlayer}>{isPlayer?<PlayerJoin/>:<>{introVisible&&<SplashScreen onStart={dismissIntro}/>}<BoardRoot/></>}</AudioProvider>;
}

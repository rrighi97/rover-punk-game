import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BookOpen, Briefcase, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDot,
  Crosshair, Cpu, DoorOpen, Footprints, HeartPulse, LockKeyhole, LogIn, Map as MapIcon, MapPin, Radio, RotateCw,
  Info, ShieldAlert, Skull, Smartphone, Sparkles, Swords, Target, Timer,
  Users, Wifi, WifiOff, X, Zap,
} from 'lucide-react';
import Settings, { SettingsButton } from './Settings';
import { AudioProvider, playSfx } from './audio';
import { qrMatrix } from './qr';
import BoardMap, { type Room } from './BoardMap';
import { charImg, enemyImg, enemyKind } from './roster';

// Miniatura quadrata di un operativo: riempie il contenitore che la ospita.
const OpIcon=({characterId,alt}:{characterId:string;alt:string})=><img className="unit-icon" src={charImg(characterId)} alt={alt}/>;
// Miniatura quadrata di un'unità Helix.
const FoeIcon=({kind,alt}:{kind:string;alt:string})=><img className="unit-icon" src={enemyImg(kind)} alt={alt}/>;

type Template = { id:string; callsign:string; role:string; specialty:string; color:string; maxHp:number; dmg:number; focus:number; weapon:string; ability:string; abilityText:string };
type PlayerAction = { type:string; targetId?:string|null; roomId?:string|null };
type Player = Template & { name:string; characterId:string; hp:number; maxFocus:number; room:string; action:null|PlayerAction; move:null|{roomId:string}; turnDone:boolean; deviceId:string|null; connected:boolean };
type Enemy = { id:string; name:string; type:string; hp:number; maxHp:number; damage:number; threat:number; room:string; home:string; locked?:boolean; chasing?:string|null };
type FeedItem = { time:string; tone:string; text:string };
type Hostage = { room:string; holder:string|null; hp:number; maxHp:number; freed:boolean; delivered:boolean };
type Narrative = { objective:string; vaultUnlocked:string; opening:string; goalHeadline:string; purged?:string };
type MissionMeta = { id:string; title:string; tagline:string; brief:string; goalHeadline:string; intro:string; objectives:string[]; mapNote:string };
type EnemyRosterEntry = { key:string; tier:number; name:string; type:string; hp:number; damage:number; threat:number; note:string; deploy:string };
type Game ={ code:string; phase:'lobby'|'active'|'victory'|'defeat'; round:number; alarm:number; alarmSpawns:number[]; breach:number; missionId:string; title:string; location:string; objective:string; narrative:Narrative; map:Room[]; nodes:Record<string,boolean>; startRoom:string; vaultRoom:string; dropRoom:string; nodeRooms:string[]; nodesRequired:number; caseRoom:string|null; caseHolder:string|null; caseDelivered:boolean; caseAt:string|null; purged:boolean; hostage:Hostage; hostageAt:string|null; vaultOpen:boolean; players:Player[]; enemies:Enemy[]; feed:FeedItem[]; event:{title:string;text:string}; waiting:string[]; turnOrder:string[]; activePlayerId:string|null };
type Snapshot = { game:Game|null; templates:Template[]; enemyRoster:EnemyRosterEntry[]; missions:MissionMeta[]; networkUrl:string; networkUrls?:string[] };

const emptySnapshot:Snapshot={game:null,templates:[],enemyRoster:[],missions:[],networkUrl:''};
const enemyBadge=(enemy:Enemy)=>enemy.type==='DRONE'?'DR':enemy.type==='ÉLITE'?'EL':'SEC';
const vaultNoun=(game:Game)=>game.missionId==='nucleo'?'NUCLEO':game.missionId==='ostaggio'?'CELLA':'TECA';
const missionVaultNoun=(id:string)=>id==='nucleo'?'NUCLEO':id==='ostaggio'?'CELLA':'TECA';

// Helper condivisi fra plancia e telefoni: chi occupa una stanza e cosa c'è dentro.
const roomsOf=(game:Game)=>game.map||[];
const roomOf=(game:Game,id:string)=>roomsOf(game).find((r)=>r.id===id);
const nameOf=(game:Game,id?:string|null)=>id?`${id} // ${roomOf(game,id)?.name||''}`:'—';
const carrierOf=(game:Game)=>game.players.find((p)=>p.id===game.caseHolder);
const hostageCarrierOf=(game:Game)=>game.players.find((p)=>p.id===game.hostage.holder);
// Dove si trova adesso il "carico" della missione: valigetta o informatore, a terra o in spalla.
const caseRoomOf=(game:Game)=>game.caseAt||carrierOf(game)?.room||game.caseRoom;
const hostageRoomOf=(game:Game)=>game.hostageAt||hostageCarrierOf(game)?.room||game.hostage.room;
const pawnsOf=(game:Game,selfId?:string)=>(roomId:string)=>game.players.filter((p)=>p.room===roomId).map((p)=>({id:p.id,label:p.callsign[0],img:charImg(p.characterId),name:`${p.name} · ${p.role}${p.id===game.caseHolder?' · PORTA LA VALIGETTA':''}${p.id===game.hostage.holder?' · SCORTA L’INFORMATORE':''}`,color:p.color,down:p.hp<=0,self:p.id===selfId,carrying:p.id===game.caseHolder||p.id===game.hostage.holder}));
const foesOf=(game:Game)=>(roomId:string)=>game.enemies.filter((e)=>e.hp>0&&e.room===roomId).map((e)=>({id:e.id,label:enemyBadge(e),img:enemyImg(enemyKind(e.id)),name:`${e.name} · ${e.hp}/${e.maxHp} · DANNO +${e.damage} · ${e.locked?'INGAGGIATO: VI INSEGUE':'DI PRESIDIO: FERMO IN QUESTA STANZA'}`,elite:e.type==='ÉLITE',hunting:e.locked}));

// SEGNALINI DI SCENARIO E MISSIONE
// Oltre a squadra e ostili, la plancia mostra la zona di partenza, i nodi, l'obiettivo
// (teca/nucleo/cella) e il punto di consegna. Ogni segnalino spiega sé stesso al passaggio del mouse.
const marksOf=(game:Game)=>(roomId:string)=>{
  const room=roomOf(game,roomId);
  const out:{id:string;label:string;name:string;kind:string;done?:boolean}[]=[];
  if(!room) return out;
  const noun=vaultNoun(game);
  if(room.start) out.push({id:'start',label:'S',kind:'start',name:`ZONA DI PARTENZA — ${nameOf(game,roomId)}. Qui è entrata la squadra.`});
  const nounArticle=noun==='NUCLEO'?'il nucleo':noun==='CELLA'?'la cella':'la teca';
  if(room.node) out.push({id:'node',label:'N',kind:'node',done:Boolean(game.nodes?.[roomId]),name:game.nodes?.[roomId]?`NODO VIOLATO — ${nameOf(game,roomId)}. Già hackerato.`:`NODO DI RETE — ${nameOf(game,roomId)}. Violalo con INTRUSIONE: ne servono ${game.nodesRequired} per aprire ${nounArticle}.`});
  if(room.vault) out.push({id:'vault',label:'T',kind:'vault',done:game.vaultOpen,name:game.vaultOpen?`${noun} APERTA — ${nameOf(game,roomId)}.`:`${noun} SIGILLATA — ${nameOf(game,roomId)}. Violate ${game.nodesRequired} nodi per aprirla.`});
  if(room.exit) out.push({id:'drop',label:'▼',kind:'drop',done:game.missionId==='valigetta'?game.caseDelivered:game.missionId==='ostaggio'?game.hostage.delivered:game.purged,name:`PUNTO DI CONSEGNA — ${nameOf(game,roomId)}. Portate qui l’obiettivo e poi tutta la squadra.`});
  if(game.missionId==='valigetta'&&!game.caseHolder&&caseRoomOf(game)===roomId) out.push({id:'case',label:'▮',kind:'case',done:game.caseDelivered,name:game.caseDelivered?'VALIGETTA MNEMOSYNE — consegnata.':`VALIGETTA MNEMOSYNE — a terra in ${nameOf(game,roomId)}. Usa RECUPERO per raccoglierla.`});
  if(game.missionId==='ostaggio'&&!game.hostage.delivered&&hostageRoomOf(game)===roomId) out.push({id:'hostage',label:'▮',kind:'case',done:game.hostage.delivered,name:game.hostage.holder?`INFORMATORE — sotto scorta, ${game.hostage.hp}/${game.hostage.maxHp} HP.`:`INFORMATORE — ${game.hostage.freed?'lasciato solo, in pericolo':'in cella, ancora da liberare'} in ${nameOf(game,roomId)}.`});
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
    return {label:'FASE 3 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`PURGA lanciata: l’allarme sale più in fretta. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
  }
  if(game.missionId==='ostaggio'){
    if(!game.hostage.freed) return {label:'FASE 2 // CELLA',short:`INFORMATORE IN ${game.vaultRoom}`,text:`La cella in ${nameOf(game,game.vaultRoom)} è aperta: liberate l’informatore con LIBERA.`};
    if(!game.hostage.delivered) return {label:'FASE 3 // SCORTA',short:`${game.hostage.hp}/${game.hostage.maxHp} HP`,text:`${hostageCarrierOf(game)?.name||'Nessuno'} scorta l’informatore verso ${nameOf(game,game.dropRoom)}. Se resta solo con ostili viene colpito ogni round.`};
    return {label:'FASE 4 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`Informatore consegnato. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
  }
  if(!game.caseHolder&&!game.caseDelivered) return {label:'FASE 2 // RECUPERO',short:`VALIGETTA IN ${caseRoomOf(game)}`,text:`La valigetta MNEMOSYNE è in ${nameOf(game,caseRoomOf(game))}. Raggiungetela e usate RECUPERO.`};
  if(!game.caseDelivered) return {label:'FASE 3 // TRASPORTO',short:`PORTALA IN ${game.dropRoom}`,text:`${carrierOf(game)?.name||'La squadra'} ha la valigetta: portatela in ${nameOf(game,game.dropRoom)}. Ogni round di trasporto alza l’allarme.`};
  return {label:'FASE 4 // ESTRAZIONE',short:`TUTTI IN ${game.dropRoom}`,text:`Valigetta consegnata. Portate ogni operativo vivo in ${nameOf(game,game.dropRoom)}.`};
}

// Riquadro "carico" nel pannello Board: valigetta, nucleo o informatore a seconda della missione.
function cargoStatus(game:Game){
  if(game.missionId==='nucleo') return {label:'NUCLEO',text:game.purged?`PURGATO — ${nameOf(game,game.dropRoom)}`:game.vaultOpen?`PRONTO IN ${game.vaultRoom}`:`SIGILLATO IN ${game.vaultRoom}`,done:game.purged};
  if(game.missionId==='ostaggio') return {label:'INFORMATORE',text:game.hostage.delivered?`CONSEGNATO IN ${game.dropRoom}`:game.hostage.holder?`SCORTATO DA ${hostageCarrierOf(game)?.name} · ${game.hostage.hp}/${game.hostage.maxHp} HP`:game.hostage.freed?`ABBANDONATO IN ${hostageRoomOf(game)} · ${game.hostage.hp}/${game.hostage.maxHp} HP`:`IN CELLA IN ${game.vaultRoom}`,done:game.hostage.delivered};
  return {label:'VALIGETTA',text:game.caseDelivered?`CONSEGNATA IN ${game.dropRoom}`:game.caseHolder?`IN MANO A ${carrierOf(game)?.name}`:game.vaultOpen?`A TERRA IN ${caseRoomOf(game)}`:`SIGILLATA IN ${game.vaultRoom}`,done:game.caseDelivered};
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
  useEffect(()=>{
    let active=true;
    const load=()=>api(`/api/state${code?`?code=${code}`:''}`).then((data)=>{if(active){setSnapshot(data);setOffline(false);}}).catch(()=>active&&setOffline(true));
    void load();const timer=setInterval(load,800);
    return()=>{active=false;clearInterval(timer);};
  },[code]);
  return {snapshot,setSnapshot,offline};
}

// Selettore scheda personaggio: un bottone che apre un menu a tendina in stile plancia
// (il <select> nativo del browser resta bianco e non si può ritingere). Stessa logica di
// prima — un personaggio già assegnato a un altro slot resta bloccato — ma qui lo segnala
// un piccolo indicatore rosso a sinistra invece del solo grigiore del <option disabled>.
function CharacterPicker({options,value,isTaken,onSelect}:{options:Template[];value:string;isTaken:(id:string)=>boolean;onSelect:(id:string)=>void}){
  const [open,setOpen]=useState(false);
  const wrapRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const onDocClick=(e:MouseEvent)=>{if(wrapRef.current&&!wrapRef.current.contains(e.target as Node))setOpen(false);};
    document.addEventListener('mousedown',onDocClick);
    return ()=>document.removeEventListener('mousedown',onDocClick);
  },[open]);
  const current=options.find((o)=>o.id===value);
  return <div className="char-picker" ref={wrapRef}>
    <button type="button" className="char-picker-btn" onClick={(e)=>{e.stopPropagation();setOpen((o)=>!o);}}>
      <span>{current?`${current.callsign} // ${current.role}`:'SELEZIONA PERSONAGGIO'}</span>
      <ChevronDown size={14}/>
    </button>
    {open&&<ul className="char-picker-menu" onClick={(e)=>e.stopPropagation()}>
      <li><button type="button" className="unset" onClick={()=>{onSelect('');setOpen(false);}}><span>— SCEGLI SCHEDA —</span></button></li>
      {options.map((option)=>{
        const taken=isTaken(option.id);
        return <li key={option.id}>
          <button type="button" disabled={taken} className={taken?'taken':''} onClick={()=>{onSelect(option.id);setOpen(false);}}>
            {taken&&<i className="char-picker-flag" aria-hidden="true"/>}
            <span>{option.callsign} // {option.role}</span>
          </button>
        </li>;
      })}
    </ul>}
  </div>;
}

function Setup({templates,missions,enemyRoster,onCreated}:{templates:Template[];missions:MissionMeta[];enemyRoster:EnemyRosterEntry[];onCreated:(g:Game)=>void}){
  const [count,setCount]=useState(3);
  // Nessuna scheda pre-assegnata: ogni slot parte vuoto e va scelto a mano prima di creare il canale.
  const [picks,setPicks]=useState(()=>Array.from({length:6},(_,i)=>({name:`OPERATIVO 0${i+1}`,characterId:''})));
  const [selected,setSelected]=useState(templates[0]?.id||'');
  const missingPick=picks.slice(0,count).some((p)=>!p.characterId);
  const [missionId,setMissionId]=useState(missions[0]?.id||'valigetta');
  const [error,setError]=useState('');
  const [settings,setSettings]=useState(false);
  const [gallery,setGallery]=useState(false);
  const [briefMission,setBriefMission]=useState<MissionMeta|null>(null);
  const preview=templates.find((t)=>t.id===selected)||templates[0];
  // Nome e personaggio sono indipendenti: il nome resta quello scelto per lo slot
  // anche cambiando scheda. Nel dossier mostriamo il nome del giocatore che ha quel personaggio.
  const ownerName=picks.slice(0,count).find((p)=>p.characterId===selected)?.name;
  const update=(index:number,key:'name'|'characterId',value:string)=>setPicks((old)=>old.map((p,i)=>i===index?{...p,[key]:value}:p));
  const create=async()=>{try{setError('');if(missingPick){playSfx('alert');setError('Assegna una scheda a ogni operativo.');return;}const data=await api('/api/setup',{method:'POST',body:JSON.stringify({players:picks.slice(0,count),missionId})});onCreated(data.game);}catch(e){playSfx('alert');setError((e as Error).message);}};
  if(!preview)return <div className="loading">INIZIALIZZAZIONE ARCHIVIO OPERATIVI...</div>;
  return <main className="setup-shell">
    <header className="setup-header"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>MISSION CONTROL</small></div></div><div className="step-line"><span className="active">01 CONFIGURAZIONE</span><i/><span>02 COLLEGAMENTO</span><i/><span>03 OPERAZIONE</span></div><div className="header-tools"><SettingsButton onOpen={()=>setSettings(true)}/><span className="local-tag"><CircleDot size={13}/> SISTEMA LOCALE</span></div></header>
    <section className="setup-grid">
      <aside className="setup-config panel">
        <div className="panel-kicker">PARAMETRI MISSIONE</div>
        <h1>Componi la squadra</h1>
        <div className="field-label">NUMERO OPERATIVI <b>{count}</b></div>
        <div className="count-picker">{[2,3,4,5,6].map((n)=><button className={count===n?'active':''} onClick={()=>setCount(n)} key={n}>{n}</button>)}</div>
        <div className="field-label">LIVELLO DI MINACCIA</div>
        <div className="threat-fixed"><b>UNICO</b><small>ROVERPUNK ha una sola taratura e non fa sconti: allarme che corre, presidi che non mollano più la presa. Nessun tempo limite per round.</small></div>
        <div className="field-label">MISSIONE</div>
        <div className="mission-select">{missions.map((m)=>{
          const [num,name]=m.title.split(' // ');
          return <div className="mission-brief-wrap" key={m.id}>
            <button type="button" className={`mission-brief ${missionId===m.id?'selected':''}`} onClick={()=>setMissionId(m.id)}>
              <small>{num}</small><b>{name||m.title}</b><p>{m.intro}</p>
            </button>
            <button type="button" className="mission-info" aria-label="Apri il briefing della missione" onClick={()=>setBriefMission(m)}><Info size={13}/></button>
          </div>;
        })}</div>
      </aside>
      <section className="roster panel">
        <div className="roster-head"><span className="panel-kicker">ASSEGNAZIONE OPERATIVI // {count} SLOT</span><button type="button" className="brief-open compact" onClick={()=>setGallery(true)}><Users size={13}/> SFOGLIA LE SCHEDE</button></div>
        <p className="roster-note">Nome e personaggio sono indipendenti: scegli un nome qualsiasi e una qualsiasi scheda. Ogni personaggio può essere assegnato a un solo operativo.</p>
        <div className="slot-list">{picks.slice(0,count).map((pick,index)=>{
          const t=templates.find((x)=>x.id===pick.characterId)||null;
          return <article className={`slot ${t&&selected===t.id?'selected':''} ${t?'':'unset'}`} style={{'--accent':t?.color||'#5b7873'} as React.CSSProperties} key={index}>
            <span className="slot-num">0{index+1}</span><span className="avatar">{t?<OpIcon characterId={t.id} alt={t.callsign}/>:'—'}</span>
            <label><small>NOME GIOCATORE</small><input value={pick.name} maxLength={14} onChange={(e)=>update(index,'name',e.target.value)} onClick={(e)=>e.stopPropagation()}/></label>
            <label><small>SCHEDA PERSONAGGIO</small><CharacterPicker options={templates} value={pick.characterId} isTaken={(id)=>picks.slice(0,count).some((p,i)=>i!==index&&p.characterId===id)} onSelect={(id)=>{update(index,'characterId',id);if(id)setSelected(id);}}/></label>
            <ChevronRight size={18}/>
          </article>})}</div>
      </section>
      <aside className="character-preview panel" style={{'--accent':preview.color} as React.CSSProperties}>
        <div className="panel-kicker">DOSSIER PERSONAGGIO</div><div className="portrait-large"><img src={charImg(preview.id)} alt={preview.callsign}/><i>ARCHIVIO<br/>#{preview.id.toUpperCase()}-09</i></div>
        <small className="role">SCHEDA {preview.callsign} · {preview.role} // {preview.specialty}</small><h2>{ownerName||preview.callsign}</h2>
        <div className="loadout"><span><small>INTEGRITÀ</small><b>{preview.maxHp}</b></span><span><small>DANNO</small><b>+{preview.dmg}</b></span><span><small>FOCUS</small><b>{preview.focus}</b></span></div>
        <div className="ability-card"><Zap size={18}/><div><small>ABILITÀ // CONSUMA 3 FOCUS</small><b>{preview.ability}</b><p>{preview.abilityText}</p></div></div>
        <div className="weapon"><Crosshair size={15}/> ARMA: <b>{preview.weapon} +{preview.dmg}</b></div>
      </aside>
    </section>
    <footer className="setup-footer"><span className="error">{error||(missingPick?'Assegna una scheda a ogni operativo per continuare.':'')}</span><button className="primary-btn" data-sfx="confirm" onClick={create} disabled={missingPick}>CREA CANALE DI GIOCO <ArrowRight size={18}/></button></footer>
    {settings&&<Settings templates={templates} database={<DatabaseSection templates={templates} enemyRoster={enemyRoster}/>} onClose={()=>setSettings(false)}/>}
    {gallery&&<CharacterGallery templates={templates} startId={selected} onClose={()=>setGallery(false)}/>}
    {briefMission&&<MissionBriefing mission={briefMission} onClose={()=>setBriefMission(null)}/>}
  </main>;
}

// GALLERIA SCHEDE: sfoglia tutti i personaggi con abilità e statistiche prima di scegliere.
function CharacterGallery({templates,startId,onClose}:{templates:Template[];startId?:string;onClose:()=>void}){
  const last=templates.length-1;
  const start=Math.max(0,templates.findIndex((t)=>t.id===startId));
  const [index,setIndex]=useState(start);
  const step=(delta:number)=>setIndex((i)=>Math.max(0,Math.min(last,i+delta)));
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();if(e.key==='ArrowRight')setIndex((i)=>Math.min(templates.length-1,i+1));if(e.key==='ArrowLeft')setIndex((i)=>Math.max(0,i-1));};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose,templates.length]);
  const t=templates[index];
  if(!t)return null;
  return <div className="manual-overlay">
    <button className="manual-scrim" aria-label="Chiudi" onClick={onClose}/>
    <section className="manual gallery">
      <header className="manual-head"><div className="brand"><span className="brand-mark">R//P</span><div><b>SCHEDE OPERATIVI</b><small>ARCHIVIO COMPLETO // {templates.length} PROFILI</small></div></div><button className="manual-close" onClick={onClose} aria-label="Chiudi"><X size={18}/></button></header>
      <div className="gallery-body">
        <button className="gallery-arrow" onClick={()=>step(-1)} disabled={index===0} aria-label="Precedente"><ChevronLeft size={26}/></button>
        <article className="gallery-card" style={{'--accent':t.color} as React.CSSProperties} key={t.id}>
          <div className="portrait-large"><img src={charImg(t.id)} alt={t.callsign}/><i>ARCHIVIO<br/>#{t.id.toUpperCase()}-09</i></div>
          <div className="gallery-info">
            <small className="role">{t.role} // {t.specialty}</small><h2>{t.callsign}</h2>
            <div className="loadout"><span><small>INTEGRITÀ</small><b>{t.maxHp}</b></span><span><small>DANNO</small><b>+{t.dmg}</b></span><span><small>FOCUS</small><b>{t.focus}</b></span></div>
            <div className="weapon"><Crosshair size={15}/> ARMA: <b>{t.weapon} +{t.dmg}</b></div>
          </div>
          <div className="ability-card"><Zap size={18}/><div><small>ABILITÀ // CONSUMA 3 FOCUS</small><b>{t.ability}</b><p>{t.abilityText}</p></div></div>
        </article>
        <button className="gallery-arrow" onClick={()=>step(1)} disabled={index===last} aria-label="Successivo"><ChevronRight size={26}/></button>
      </div>
      <footer className="manual-foot"><span>OPERATIVO {String(index+1).padStart(2,'0')} / {String(templates.length).padStart(2,'0')} — {t.callsign} // {t.role}</span><div className="gallery-dots">{templates.map((x,i)=><button key={x.id} className={i===index?'on':''} style={{'--accent':x.color} as React.CSSProperties} onClick={()=>setIndex(i)} aria-label={x.callsign}/>)}</div><button className="ghost-btn" onClick={onClose}>CHIUDI</button></footer>
    </section>
  </div>;
}

// BRIEFING MISSIONE: intro, storyline, obiettivi e schema della plancia prima di avviare.
function MissionBriefing({mission,onClose}:{mission:MissionMeta;onClose:()=>void}){
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  const [num,name]=mission.title.split(' // ');
  const noun=missionVaultNoun(mission.id);
  const cells=['S','N','','','◆','N','N','','▼'];
  const cellName=(c:string)=>c==='S'?'Partenza':c==='N'?'Nodo di rete':c==='◆'?noun:c==='▼'?'Consegna':'';
  return <div className="manual-overlay">
    <button className="manual-scrim" aria-label="Chiudi" onClick={onClose}/>
    <section className="manual briefing">
      <header className="manual-head"><div className="brand"><span className="brand-mark">R//P</span><div><b>{num}</b><small>{name||mission.title}</small></div></div><button className="manual-close" onClick={onClose} aria-label="Chiudi"><X size={18}/></button></header>
      <article className="manual-content briefing-content">
        <h2>{name||mission.title}</h2>
        <p className="briefing-tag">{mission.tagline} — obiettivo: <b>{mission.goalHeadline}</b></p>
        <h3>Intro</h3>
        <p>{mission.intro}</p>
        <h3>Storyline</h3>
        <p>{mission.brief}</p>
        <h3>Obiettivi</h3>
        <ol className="manual-steps">{mission.objectives.map((o,i)=><li key={i}>{o}</li>)}</ol>
        <h3>La mappa</h3>
        <div className="briefing-map">
          <div className="briefing-grid">{cells.map((c,i)=><span key={i} className={c?`mark ${c==='◆'?'vault':c==='S'?'start':c==='N'?'node':'exit'}`:''}>{c&&<><b>{c}</b><i>{cellName(c)}</i></>}</span>)}</div>
          <p className="briefing-legend"><MapIcon size={12}/> Solo la legenda degli elementi: la plancia della missione ha 12–13 stanze ed è sempre la stessa.</p>
        </div>
      </article>
      <footer className="manual-foot"><span>{num} — BRIEFING PRE-OPERAZIONE</span><button className="ghost-btn" onClick={onClose}>CHIUDI</button></footer>
    </section>
  </div>;
}

function QrCode({text,size=190}:{text:string;size?:number}){
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

function Lobby({game,templates,networkUrl,onStart,onReset}:{game:Game;templates:Template[];networkUrl:string;onStart:(g:Game)=>void;onReset:()=>void}){
  const playerUrl=`${networkUrl}/?mode=player&code=${game.code}`;
  const [error,setError]=useState('');
  const [settings,setSettings]=useState(false);
  const [confirmOpen,setConfirmOpen]=useState(false);
  const linked=game.players.filter((p)=>p.connected).length;
  const allLinked=game.players.length>0&&linked===game.players.length;
  const start=async()=>{try{setConfirmOpen(false);setError('');const data=await api('/api/start',{method:'POST',body:JSON.stringify({code:game.code})});onStart(data.game);}catch(e){playSfx('alert');setError((e as Error).message);}};
  return <main className="lobby-shell">
    <header className="setup-header"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>UPLINK LOBBY</small></div></div><div className="step-line"><span>01 CONFIGURAZIONE</span><i/><span className="active">02 COLLEGAMENTO</span><i/><span>03 OPERAZIONE</span></div><div className="header-tools"><SettingsButton onOpen={()=>setSettings(true)}/><span className="local-tag"><Wifi size={13}/> CANALE APERTO</span></div></header>
    <section className="lobby-content">
      <div className="access-block"><small>CODICE PARTITA</small><strong>{game.code}</strong><p>Su ogni telefono, apri questo indirizzo in orizzontale:</p><code>{playerUrl}</code><div className="qr-block"><QrCode text={playerUrl}/><span>INQUADRA IL CODICE COL TELEFONO</span></div><div className="signal"><i/><i/><i/><i/><span>RETE LOCALE ATTIVA</span></div></div>
      <div className="connection-list">{game.players.map((p,index)=><article key={p.id} style={{'--accent':p.color} as React.CSSProperties} className={p.connected?'online':''}><span className="connection-index">0{index+1}</span><span className="avatar"><OpIcon characterId={p.characterId} alt={p.callsign}/></span><div><small>{p.role}</small><b>{p.name}</b></div><span className="connection-state">{p.connected?<><Wifi size={15}/> COLLEGATO</>:<><WifiOff size={15}/> IN ATTESA</>}</span></article>)}</div>
    </section>
    <footer className="setup-footer"><button className="ghost-btn" onClick={onReset}>RICOMPONI SQUADRA</button><span className="error">{error}</span><span>{linked} / {game.players.length} DISPOSITIVI COLLEGATI</span><button className="primary-btn" data-sfx="confirm" onClick={()=>allLinked?start():setConfirmOpen(true)}>AVVIA OPERAZIONE <Swords size={18}/></button></footer>
    {confirmOpen&&<div className="settings-overlay">
      <button className="settings-scrim" aria-label="Chiudi" onClick={()=>setConfirmOpen(false)}/>
      <div className="panel settings-card" style={{width:'min(440px,100%)'}}>
      <div className="settings-head"><div><small>COLLEGAMENTO INCOMPLETO</small><b>AVVIARE COMUNQUE?</b></div></div>
      <div className="settings-body"><p>Non tutti i dispositivi sono collegati: <b>{linked} / {game.players.length}</b>. Puoi avviare lo stesso per vedere plancia e mappa, ma i giocatori non collegati resteranno in attesa e il round non si chiude finché nessun telefono è connesso.</p></div>
      <div className="settings-foot" style={{justifyContent:'space-between'}}><button className="ghost-btn" onClick={()=>setConfirmOpen(false)}>ANNULLA</button><button className="primary-btn" data-sfx="confirm" onClick={start}>AVVIA COMUNQUE <Swords size={18}/></button></div>
    </div></div>}
    {settings&&<Settings templates={templates} onClose={()=>setSettings(false)}/>}
  </main>;
}

function TacticalMap({game,selfId}:{game:Game;selfId?:string}){
  return <BoardMap
    rooms={roomsOf(game)}
    pawnsIn={pawnsOf(game,selfId)}
    foesIn={foesOf(game)}
    marksIn={marksOf(game)}
  />;
}

function AlarmReadout({alarm}:{alarm:number}){
  return <span className="danger alarm-chip">
    <ShieldAlert size={16}/> ALLARME <b>{alarm}%</b>
    <div className="alarm-tip" role="tooltip">
      <div className="alarm-tip-head"><ShieldAlert size={13}/> TRACCIA HELIX</div>
      <p className="alarm-tip-lede">La torre non dorme. A ogni round che si chiude l’ago sale:</p>
      <ul className="alarm-tip-list">
        <li><b>+3</b><span>il respiro della torre, sempre, a ogni round</span></li>
      </ul>
      <div className="alarm-tip-sub calm">CHI LA RIPORTA GIÙ</div>
      <ul className="alarm-tip-list calm">
        <li><b>−5</b><span>ECHO inietta un’Identità sintetica</span></li>
      </ul>
      <div className="alarm-tip-thr">
        <div className="thr"><b>25→75%</b><div><strong>TRACCIA HELIX</strong><span>A ogni soglia — 25, 35, 45, 55, 65, 75% — una nuova unità (HELIX SEGUGIO) entra in una stanza a caso e parte subito a caccia della squadra.</span></div></div>
        <div className="thr"><b>80%</b><div><strong>LOCKDOWN</strong><span>La torre allerta ogni presidio, anche quello mai ingaggiato: da qui in poi tutti i nemici convergono verso la stanza dei Player.</span></div></div>
        <div className="thr dead"><b>100%</b><div><strong>SATURAZIONE</strong><span>La Helix chiude il settore: il segnale clandestino è perso e la squadra con lui.</span></div></div>
      </div>
    </div>
  </span>;
}

function Board({game,templates,missions,offline,onReset}:{game:Game;templates:Template[];missions:MissionMeta[];offline:boolean;onReset:()=>void}){
  const [settings,setSettings]=useState(false);
  const [briefing,setBriefing]=useState(false);
  const mission=missions.find((m)=>m.id===game.missionId);
  const active=game.players.find((p)=>p.id===game.activePlayerId);
  const alivePlayers=game.players.filter((p)=>p.hp>0).length;
  const doneTurns=game.players.filter((p)=>p.hp>0&&p.turnDone).length;
  const linked=game.players.filter((p)=>p.connected).length;
  const forceRound=()=>{void api('/api/resolve',{method:'POST'}).catch(()=>{});};
  const skipTurn=()=>{void api('/api/skipturn',{method:'POST'}).catch(()=>{});};
  const stage=missionStage(game);
  const cargo=cargoStatus(game);
  // Un segnale acustico marca la fine dell'operazione, vittoria o sconfitta.
  useEffect(()=>{ if(game.phase==='victory')playSfx('confirm'); if(game.phase==='defeat')playSfx('alert'); },[game.phase]);
  const status=game.phase!=='active'?'OPERAZIONE CONCLUSA':`TURNO DI ${active?.name??'—'} · ${doneTurns}/${alivePlayers} TURNI CHIUSI`;
  return <main className="board-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>{offline?'SEGNALE INTERROTTO':'GM AUTONOMO ONLINE'}</small></div></div><div className="mission"><small>OPERAZIONE ATTIVA</small><strong>{game.title}</strong></div><div className="telemetry"><span><Radio size={16}/> CODICE <b>{game.code}</b></span><span><Timer size={16}/> ROUND <b>{String(game.round).padStart(2,'0')}</b></span>{game.phase==='active'&&active&&<span className="turn-chip"><Footprints size={16}/> TURNO <b>{active.name}</b></span>}<AlarmReadout alarm={game.alarm}/>{game.phase==='active'&&<><button className="topbar-btn" data-sfx="confirm" onClick={skipTurn}>SALTA TURNO</button><button className="topbar-btn" data-sfx="confirm" onClick={forceRound}>CHIUDI ROUND</button></>}<SettingsButton onOpen={()=>setSettings(true)}/></div></header>
    <section className="board-grid">
      <aside className="panel intel-panel"><div className="panel-kicker">01 // DIRETTIVA</div><h1>{game.narrative.goalHeadline}</h1><p>{game.objective}</p>{mission&&<button className="briefing-link" onClick={()=>setBriefing(true)}><BookOpen size={12}/> BRIEFING COMPLETO — INTRO · STORYLINE · OBIETTIVI · MAPPA</button>}<div className="objective"><span>NODI VIOLATI</span><b>{game.breach} / {game.nodesRequired}</b><i style={{width:`${Math.min(1,game.breach/(game.nodesRequired||1))*100}%`}}/></div><div className={`case-track ${cargo.done?'done':''}`}><span><Briefcase size={13}/> {cargo.label}</span><b>{cargo.text}</b></div><div className="stage-card"><small>{stage.label}</small><b>{stage.short}</b><p>{stage.text}</p></div><div className="section-label">FLUSSO TATTICO</div><ol className="feed">{game.feed.slice(0,5).map((item,i)=><li className={item.tone} key={`${item.time}-${i}`}><time>{item.time}</time><span>{item.text}</span></li>)}</ol></aside>
      <section className="tactical panel"><div className="map-head"><span>PIANTA // {game.location}</span><span className="stage-tag">{stage.label} · {stage.short}</span><span>{roomsOf(game).length} STANZE · RILEVAMENTO PASSIVO</span></div><TacticalMap game={game}/><div className="legend"><span><i className="dot friendly"/>SQUADRA</span><span><i className="dot hostile"/>OSTILE</span><span><i className="dot start"/>PARTENZA</span><span><i className="dot system"/>NODO</span>{game.missionId!=='nucleo'&&<span><i className="dot case"/>{cargo.label}</span>}<span><i className="dot exit"/>CONSEGNA</span><span><i className="dot hunting"/>INGAGGIATO</span><strong className={linked===0?'stalled':''}>{status}</strong></div></section>
      <aside className="panel threats-panel">{(()=>{const living=game.enemies.filter((e)=>e.hp>0);return <><div className="panel-kicker">03 // MINACCE · {living.length}</div>{living.map((e)=>{const contested=game.players.some((p)=>p.hp>0&&p.room===e.room);return <div className={`threat-card ${e.type==='ÉLITE'?'elite':''} ${contested?'contested':''}`} key={e.id}><span className="threat-icon"><FoeIcon kind={enemyKind(e.id)} alt={e.type}/></span><div><small>{e.type} // {e.room} {roomOf(game,e.room)?.name||''} · DANNO +{e.damage}</small><b>{e.name}</b><Meter value={e.hp} max={e.maxHp} tone="red"/><em>{contested?'IN CONTATTO CON LA SQUADRA':e.locked?`VI INSEGUE · ${e.hp}/${e.maxHp}`:`DI PRESIDIO · ${e.hp}/${e.maxHp}`}</em></div></div>;})}</>;})()}<div className="section-label">RISPOSTA DEL SISTEMA</div><div className="gm-card"><small>GM AUTONOMO // PREVISIONE</small><b>{game.event.title}</b><p>{game.event.text}</p></div></aside>
    </section>
    <footer className="squadbar"><div className="squad-title"><Users size={19}/><span>SQUADRA<br/><b>{alivePlayers} OPERATIVI</b></span></div>{game.players.map((p)=>{const isTurn=game.phase==='active'&&p.id===game.activePlayerId;return <article className={`operative ${p.hp<=0?'down':''} ${isTurn?'active-turn':''}`} key={p.id} style={{'--accent':p.color} as React.CSSProperties}><span className="portrait"><OpIcon characterId={p.characterId} alt={p.callsign}/></span><div className="op-name"><b>{p.name}</b><small>{p.role} · {p.connected?'ONLINE':'OFFLINE'}</small><span className="op-room"><MapPin size={10}/> {p.room} {roomOf(game,p.room)?.name||''}</span></div><div className="hp"><Meter value={p.hp} max={p.maxHp}/><small>INTEGRITÀ {p.hp}/{p.maxHp}</small></div><div className={`status ${isTurn?'ready':''}`}>{p.hp<=0?'K.O.':isTurn?'IN GIOCO':p.turnDone?'TURNO CHIUSO':'IN CODA'}</div></article>;})}</footer>
    {(game.phase==='victory'||game.phase==='defeat')&&<div className={`outcome ${game.phase}`}><div><small>OPERAZIONE CONCLUSA</small><h2>{game.phase==='victory'?'MNEMOSYNE È NOSTRO':'SQUADRA NEUTRALIZZATA'}</h2><p>{game.phase==='victory'?`Valigetta consegnata e squadra estratta da ${nameOf(game,game.dropRoom)}. La Helix non sa ancora cosa ha perso.`:'La Helix ha saturato il settore. Il segnale clandestino è perduto.'}</p><button className="primary-btn" data-sfx="confirm" onClick={onReset}>NUOVA OPERAZIONE <RotateCw size={17}/></button></div></div>}
    {briefing&&mission&&<MissionBriefing mission={mission} onClose={()=>setBriefing(false)}/>}
    {settings&&<Settings templates={templates} onReset={onReset} onClose={()=>setSettings(false)}/>}
  </main>;
}

function PlayerJoin(){
  const params=new URLSearchParams(location.search);
  const initialCode=params.get('code')||'';
  const [code,setCode]=useState(initialCode.toUpperCase());
  const [searchCode,setSearchCode]=useState(initialCode.toUpperCase());
  const {snapshot,offline}=useSnapshot(searchCode);
  const [error,setError]=useState('');
  const [settings,setSettings]=useState(false);
  const [gallery,setGallery]=useState(false);
  const [session,setSession]=useState<{code:string;playerId:string;deviceId:string}|null>(()=>{try{return JSON.parse(localStorage.getItem('roverpunk-session')||'null');}catch{return null;}});
  const player=session&&session.code===snapshot.game?.code?snapshot.game.players.find((p)=>p.id===session.playerId):null;
  // I browser dei telefoni congelano i timer quando lo schermo si spegne o si cambia app:
  // al ritorno in primo piano serve un ping immediato per tornare subito online.
  useEffect(()=>{if(!session)return;const ping=()=>api('/api/ping',{method:'POST',body:JSON.stringify(session)}).catch(()=>{});void ping();const timer=setInterval(ping,4000);
    const wake=()=>{if(document.visibilityState==='visible')void ping();};
    document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);window.addEventListener('pageshow',wake);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);window.removeEventListener('pageshow',wake);};},[session]);
  const find=()=>{setError('');setSearchCode(code.trim().toUpperCase());};
  const join=async(playerId:string)=>{try{const deviceId=makeDeviceId();await api('/api/join',{method:'POST',body:JSON.stringify({code:searchCode,playerId,deviceId})});const next={code:searchCode,playerId,deviceId};localStorage.setItem('roverpunk-session',JSON.stringify(next));setSession(next);playSfx('confirm');}catch(e){playSfx('alert');setError((e as Error).message);}};
  if(!session||!player){return <main className="join-shell"><section className="join-card"><div className="join-tools"><SettingsButton compact onOpen={()=>setSettings(true)}/></div><div className="brand centered"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>OPERATIVE UPLINK</small></div></div><div className="uplink-icon"><Smartphone/><i/><Radio/></div><small>INSERISCI CODICE PARTITA</small><div className="code-entry"><input value={code} onChange={(e)=>setCode(e.target.value.toUpperCase())} placeholder="NEON-77" maxLength={7}/><button onClick={find}><LogIn/></button></div>{snapshot.templates.length>0&&<button type="button" className="brief-open" onClick={()=>setGallery(true)}><Users size={13}/> SFOGLIA LE SCHEDE OPERATIVI</button>}{snapshot.game&&snapshot.game.code===searchCode?<div className="seat-select"><span>SELEZIONA IL TUO OPERATIVO</span>{snapshot.game.players.map((p)=><button disabled={p.connected} onClick={()=>join(p.id)} key={p.id} style={{'--accent':p.color} as React.CSSProperties}><i><OpIcon characterId={p.characterId} alt={p.callsign}/></i><span><small>{p.role}</small><b>{p.name}</b></span><em>{p.connected?'OCCUPATO':'ENTRA'}</em></button>)}</div>:searchCode&&<p className="join-hint">In attesa del canale <b>{searchCode}</b>…</p>}<p className="error">{error}</p>{settings&&<Settings templates={snapshot.templates} onClose={()=>setSettings(false)}/>}{gallery&&<CharacterGallery templates={snapshot.templates} onClose={()=>setGallery(false)}/>}</section></main>}
  return <PlayerConsole game={snapshot.game!} templates={snapshot.templates} player={player} session={session} offline={offline}/>;
}

function PlayerConsole({game,templates,player,session,offline}:{game:Game;templates:Template[];player:Player;session:{playerId:string;deviceId:string};offline:boolean}){
  const [target,setTarget]=useState('');
  const [sending,setSending]=useState(false);const [error,setError]=useState('');
  const [settings,setSettings]=useState(false);
  const [moving,setMoving]=useState(false);
  const room=roomOf(game,player.room);
  const exits=room?.links||[];
  // Sistema a turni: la manovra si risolve subito, quindi l'azione ha sempre effetto nella
  // stanza attuale. `myTurn` = è il tuo turno; `moved`/`acted` = cosa hai già fatto in questo turno.
  const myTurn=game.phase==='active'&&game.activePlayerId===player.id&&player.hp>0;
  const activeName=game.players.find((p)=>p.id===game.activePlayerId)?.name||'—';
  const moved=Boolean(player.move);
  const acted=Boolean(player.action);
  const doneTurns=game.players.filter((p)=>p.hp>0&&p.turnDone).length;
  const aliveCount=game.players.filter((p)=>p.hp>0).length;
  const actRoomId=player.room;
  const actRoom=room;
  const hostiles=game.enemies.filter((e)=>e.hp>0&&e.room===actRoomId);
  const hostilesNow=hostiles;
  const squadHere=game.players.filter((p)=>p.id!==player.id&&p.room===actRoomId);
  const downedHere=squadHere.find((p)=>p.hp<=0);
  const nodeHere=Boolean(actRoom?.node)&&!game.nodes?.[actRoomId];
  // RECUPERO/LIBERA: il carico va raccolto a mano, e solo se teca/cella è già stata sbloccata.
  const carrying=game.caseHolder===player.id;
  const caseHere=!game.caseHolder&&!game.caseDelivered&&caseRoomOf(game)===actRoomId;
  const caseBlocked=caseHere&&actRoomId===game.vaultRoom&&!game.vaultOpen;
  const escorting=game.hostage.holder===player.id;
  const hostageHere=!game.hostage.holder&&!game.hostage.delivered&&hostageRoomOf(game)===actRoomId;
  const hostageBlocked=hostageHere&&!game.hostage.freed&&actRoomId===game.vaultRoom&&!game.vaultOpen;
  const purgeReady=actRoomId===game.vaultRoom&&game.vaultOpen&&!game.purged;
  const selectedTarget=hostiles.some((e)=>e.id===target)?target:(hostiles[0]?.id||'');
  const stage=missionStage(game);
  const noun=vaultNoun(game);
  const turnBlocked=sending||!myTurn||acted;
  const fifthAction=game.missionId==='nucleo'
    ?{label:'PURGA',icon:<Zap/>,sub:game.purged?'Già lanciata':purgeReady?'Cancella il nucleo dati':actRoomId!==game.vaultRoom?`Nucleo in ${game.vaultRoom}`:'Firewall ancora attivo',disabled:turnBlocked||!purgeReady,onClick:()=>act('purge')}
    :game.missionId==='ostaggio'
    ?{label:'LIBERA',icon:<Briefcase/>,sub:escorting?'Lo stai già scortando':hostageBlocked?`Cella sigillata: servono ${game.nodesRequired} nodi`:hostageHere?'Libera l’informatore':`Informatore in ${hostageRoomOf(game)||'—'}`,disabled:turnBlocked||!hostageHere||hostageBlocked,onClick:()=>act('free')}
    :{label:'RECUPERO',icon:<Briefcase/>,sub:carrying?'La stai già portando':caseBlocked?`Teca sigillata: servono ${game.nodesRequired} nodi`:caseHere?'Raccogli la valigetta MNEMOSYNE':`Valigetta in ${caseRoomOf(game)||'—'}`,disabled:turnBlocked||!caseHere||caseBlocked,onClick:()=>act('grab')};
  const act=async(type:string,roomId?:string)=>{try{setSending(true);setError('');await api('/api/action',{method:'POST',body:JSON.stringify({code:game.code,playerId:player.id,deviceId:session.deviceId,type,targetId:selectedTarget,roomId:roomId||null})});setMoving(false);}catch(e){playSfx('alert');setError((e as Error).message);}finally{setSending(false);}};
  const endTurn=async()=>{try{setSending(true);setError('');await api('/api/endturn',{method:'POST',body:JSON.stringify({code:game.code,playerId:player.id,deviceId:session.deviceId})});setMoving(false);}catch(e){playSfx('alert');setError((e as Error).message);}finally{setSending(false);}};
  const waiting=game.phase==='lobby';
  const abilityBlocked=waiting||!myTurn||acted||player.focus<3||sending;
  return <main className="player-shell" style={{'--accent':player.color} as React.CSSProperties}>
    <div className="rotate-notice"><RotateCw/><b>RUOTA IL DISPOSITIVO</b><span>La console operativa richiede lo schermo orizzontale.</span></div>
    <header className="player-top"><div className="player-id"><span><OpIcon characterId={player.characterId} alt={player.callsign}/></span><div><small>{player.role} // {player.specialty}</small><b>{player.name}</b></div></div><div className="round-state"><span>ROUND <b>{String(game.round).padStart(2,'0')}</b></span><span className="pos"><MapPin size={12}/> <b>{player.room}</b> {room?.name}</span><span className="alarm">ALLARME <b>{game.alarm}%</b></span></div><div className="player-tools"><SettingsButton compact onOpen={()=>setSettings(true)}/><div className={`link-state ${offline?'offline':''}`}>{offline?<WifiOff/>:<Wifi/>}{offline?'OFFLINE':'LINK ATTIVO'}</div></div></header>
    <section className="player-grid">
      <aside className="vitals">
        <div className="room-card"><small>STANZA ATTUALE</small><b>{player.room} // {room?.name}</b><div className="room-flags">{room?.start&&<i className="start">PARTENZA</i>}{room?.node&&<i className={game.nodes?.[player.room]?'done':'live'}>{game.nodes?.[player.room]?'NODO VIOLATO':'NODO ATTIVO'}</i>}{room?.vault&&<i className="vault">{game.vaultOpen?`${noun} APERTA`:`${noun} SIGILLATA`}</i>}{room?.exit&&<i className="exit">CONSEGNA</i>}{room?.cover&&<i className="cover">COPERTURA</i>}{room?.exposed&&<i className="exposed">ZONA ESPOSTA</i>}{carrying&&<i className="case">HAI LA VALIGETTA</i>}{escorting&&<i className="case">SCORTI L’INFORMATORE · {game.hostage.hp}/{game.hostage.maxHp} HP</i>}</div><p className={hostilesNow.length?'danger':''}>{hostilesNow.length?`${hostilesNow.length} OSTILI PRESENTI`:'NESSUN OSTILE'}{game.players.filter((p)=>p.id!==player.id&&p.room===player.room).length?` · ${game.players.filter((p)=>p.id!==player.id&&p.room===player.room).length} COMPAGNI`:' · SEI SOLO'}</p></div>
        <div className="vital-title"><Activity/> STATO BIOMETRICO</div><div className="big-vital"><span>INTEGRITÀ</span><b>{player.hp}<small>/{player.maxHp}</small></b><Meter value={player.hp} max={player.maxHp}/></div><div className="sub-vitals"><span><i>FOCUS</i><b>{player.focus}/{player.maxFocus}</b><Meter value={player.focus} max={player.maxFocus} tone="violet"/></span><span><i>DANNO ARMA</i><b>+{player.dmg}</b></span></div>
      </aside>
      <section className="actions"><div className="action-head"><div><small>CONSOLE AZIONI</small><b>{!myTurn?'ATTENDI IL TURNO':acted?'AZIONE FATTA':moved?'MANOVRA FATTA':'TOCCA A TE'}</b></div><span>{doneTurns}/{aliveCount} TURNI CHIUSI</span></div>
        {waiting?<div className="standby"><Radio/><b>IN ATTESA DELLA PLANCIA</b><span>Il computer avvierà l’operazione quando la squadra sarà pronta.</span></div>:game.phase!=='active'?<div className="standby"><Sparkles/><b>OPERAZIONE CONCLUSA</b><span>Controlla lo schermo principale.</span></div>:player.hp<=0?<div className="standby danger"><Skull/><b>FUORI COMBATTIMENTO</b><span>Sei a terra in {player.room}. Solo un compagno nella tua stessa stanza può rianimarti.</span></div>:!myTurn?<div className="standby"><Radio/><b>TURNO DI {activeName}</b><span>Aspetta la mano: giochi il tuo turno quando tocca a te nel giro.</span></div>:<>
          <button className={`move-btn ${moved?'armed':''}`} data-sfx="confirm" onClick={()=>setMoving(true)} disabled={sending||!exits.length||moved}><Footprints/><span><b>{moved?`MANOVRA FATTA → ${player.move?.roomId}`:'MANOVRA'}</b><small>{moved?'Una sola manovra per turno · ora scegli l’azione o chiudi il turno':`${carrying?'Porti la valigetta · ':escorting?'Scorti l’informatore · ':''}Una manovra per turno · ${exits.join(' · ')}`}</small></span><ChevronRight/></button>
          {hostiles.length>0?<div className="target-row"><Target/><span>BERSAGLIO IN {actRoomId}</span><select value={selectedTarget} onChange={(e)=>setTarget(e.target.value)}>{hostiles.map((e)=><option value={e.id} key={e.id}>{e.name} // HP {e.hp} · DANNO +{e.damage}</option>)}</select></div>:<div className="target-row empty"><Target/><span>NESSUN OSTILE IN {actRoomId} — il fuoco è inutile finché non li raggiungi</span></div>}
          <div className="action-grid">
            <button data-sfx="confirm" onClick={()=>act('attack')} disabled={turnBlocked||!hostiles.length} title={hostiles.length?'':'Nessun ostile nella tua stanza'}><Swords/><span><b>FUOCO +{player.dmg}</b><small>{hostiles.length?'Colpisci un ostile qui':'Nessun ostile qui'}</small></span><kbd>01</kbd></button>
            <button data-sfx="confirm" onClick={()=>act('hack')} disabled={turnBlocked||!nodeHere} title={nodeHere?'':'Nessun nodo attivo in questa stanza'}><Cpu/><span><b>INTRUSIONE</b><small>{nodeHere?'Viola il nodo di questa stanza':'Nessun nodo attivo qui'}</small></span><kbd>02</kbd></button>
            <button data-sfx="confirm" onClick={()=>act('heal')} disabled={turnBlocked||player.focus<2}><HeartPulse/><span><b>{downedHere?'RIANIMAZIONE':'RIPRISTINO'}</b><small>{downedHere?`Rimette in piedi ${downedHere.name}`:'Cura chi è nella tua stanza'}</small></span><kbd>03</kbd></button>
            <button className="grab-action" data-sfx="confirm" onClick={fifthAction.onClick} disabled={fifthAction.disabled}>{fifthAction.icon}<span><b>{fifthAction.label}</b><small>{fifthAction.sub}</small></span><kbd>04</kbd></button>
          </div>
          <button className="endturn-btn" data-sfx="confirm" onClick={endTurn} disabled={sending}><Check size={15}/> FINE TURNO{!moved&&!acted?' (salta)':''} <ChevronRight size={15}/></button>
        </>}
      </section>
      <aside className="loadout-panel"><div className="weapon-block"><Crosshair/><span><small>ARMA PRIMARIA</small><b>{player.weapon} +{player.dmg}</b></span></div><div className="ability-panel"><Zap/><small>ABILITÀ ESCLUSIVA // 3 FOCUS</small><h2>{player.ability}</h2><p>{player.abilityText}</p><button disabled={abilityBlocked} data-sfx="confirm" onClick={()=>act('ability')}>ATTIVA <ChevronRight/></button></div><div className="personal-objective"><LockKeyhole/><div><small>{stage.label}</small><p>{stage.text}</p></div></div></aside>
    </section>
    <footer className="player-footer"><span>{game.code} // {game.location}</span><div className="ticker"><AlertTriangle/> {game.event.title}: {game.event.text}</div><span>{error||'CANALE CIFRATO'}</span></footer>
    {moving&&<div className="move-overlay"><div className="move-panel"><header><div><small>MANOVRA // DA {player.room} {room?.name}</small><b>SCEGLI LA STANZA</b></div><button className="move-close" onClick={()=>setMoving(false)}><X size={18}/></button></header>
      <BoardMap variant="mini" rooms={roomsOf(game)} pawnsIn={pawnsOf(game,player.id)} foesIn={foesOf(game)} marksIn={marksOf(game)} highlight={exits} currentRoom={player.room} onPick={(id)=>{void act('move',id);}}/>
      <footer>{hostilesNow.length?<b className="warn"><AlertTriangle size={13}/> Sganciarti da {player.room} ti espone al fuoco di {hostilesNow[0].name}.</b>:<b><DoorOpen size={13}/> Porte disponibili: {exits.join(' · ')}</b>}<span>{error}</span></footer>
    </div></div>}
    {settings&&<Settings templates={templates} onClose={()=>setSettings(false)}/>}
  </main>;
}

// DATABASE // ARCHIVIO UNITÀ: contenuto in sola lettura del database operativi (i 6 personaggi
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
        <div className="loadout"><span><small>INTEGRITÀ</small><b>{t.maxHp}</b></span><span><small>DANNO</small><b>+{t.dmg}</b></span><span><small>FOCUS</small><b>{t.focus}</b></span></div>
        <div className="ability-card"><Zap size={16}/><div><small>{t.weapon} · ABILITÀ // 3 FOCUS</small><b>{t.ability}</b><p>{t.abilityText}</p></div></div>
      </article>)}</div>
    </section>
    <section className="panel db-section">
      <div className="panel-kicker">DATABASE NEMICI // {enemyRoster.length} UNITÀ BASE · FORZA CRESCENTE</div>
      <h1>Nemici</h1>
      <p className="db-note">Set base di unità Helix, dalla più fragile alla più letale. Le missioni pescano da qui il proprio presidio.</p>
      <div className="db-enemies">{enemyRoster.map((e)=><article className="db-enemy" key={e.key}>
        <img className="db-enemy-icon" src={enemyImg(e.key)} alt={e.type}/>
        <div className="db-tier"><small>TIER</small><b>{e.tier}</b></div>
        <div className="db-enemy-main"><b>{e.name}</b><small>{e.type}</small><p>{e.note}</p><p className="db-deploy"><Skull size={11}/> {e.deploy}</p></div>
        <div className="db-enemy-stats"><span><small>INTEGRITÀ</small><b>{e.hp}</b></span><span><small>DANNO</small><b>+{e.damage}</b></span><span><small>MINACCIA</small><b>{e.threat}</b></span></div>
      </article>)}</div>
    </section>
  </div>;
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
  const {snapshot,setSnapshot,offline}=useSnapshot();
  const reset=async()=>{if(!confirm('Chiudere la partita corrente e tornare al setup?'))return;await api('/api/reset',{method:'POST'});setSnapshot((s)=>({...s,game:null}));};
  if(!snapshot.game&&!snapshot.templates.length)return <div className="loading">INIZIALIZZAZIONE ARCHIVIO OPERATIVI...</div>;
  if(!snapshot.game)return <Setup templates={snapshot.templates} missions={snapshot.missions} enemyRoster={snapshot.enemyRoster} onCreated={(game)=>setSnapshot((s)=>({...s,game}))}/>;
  if(snapshot.game.phase==='lobby')return <Lobby game={snapshot.game} templates={snapshot.templates} networkUrl={snapshot.networkUrl} onStart={(game)=>setSnapshot((s)=>({...s,game}))} onReset={reset}/>;
  return <Board game={snapshot.game} templates={snapshot.templates} missions={snapshot.missions} offline={offline} onReset={reset}/>;
}

export default function App(){
  const mode=useMemo(()=>new URLSearchParams(location.search).get('mode'),[]);
  const isPlayer=mode==='player';
  // La colonna sonora esce solo dalla plancia: telefoni e database ricevono solo gli effetti.
  if(mode==='database') return <AudioProvider music={false}><DatabasePage/></AudioProvider>;
  return <AudioProvider music={!isPlayer}>{isPlayer?<PlayerJoin/>:<BoardRoot/>}</AudioProvider>;
}

import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BookOpen, Briefcase, Check, ChevronRight, CircleDot,
  Crosshair, Cpu, DoorOpen, Footprints, HeartPulse, LockKeyhole, LogIn, MapPin, Radio, RotateCw,
  Shield, ShieldAlert, Skull, Smartphone, Sparkles, Swords, Target, Timer,
  Users, Wifi, WifiOff, X, Zap,
} from 'lucide-react';
import Manual from './Manual';
import Settings, { SettingsButton } from './Settings';
import { AudioProvider, playSfx, useAudio } from './audio';
import { qrMatrix } from './qr';
import BoardMap, { type Room } from './BoardMap';

type Stats = { corpo:number; riflessi:number; mente:number; presenza:number };
type Template = { id:string; callsign:string; role:string; specialty:string; color:string; stats:Stats; maxHp:number; armor:number; focus:number; weapon:string; ability:string; abilityText:string };
type PlayerAction = { type:string; targetId?:string|null; roomId?:string|null };
type Player = Template & { name:string; characterId:string; hp:number; maxFocus:number; stress:number; shield:number; room:string; action:null|PlayerAction; move:null|{roomId:string}; deviceId:string|null; connected:boolean };
type Enemy = { id:string; name:string; type:string; hp:number; maxHp:number; armor:number; damage:number; threat:number; room:string; home:string; locked?:boolean; chasing?:string|null };
type FeedItem = { time:string; tone:string; text:string };
type Hostage = { room:string; holder:string|null; hp:number; maxHp:number; freed:boolean; delivered:boolean };
type Narrative = { objective:string; vaultUnlocked:string; opening:string; goalHeadline:string; purged?:string };
type MissionMeta = { id:string; title:string; tagline:string; brief:string; goalHeadline:string };
type Game = { code:string; phase:'lobby'|'active'|'victory'|'defeat'; round:number; alarm:number; breach:number; missionId:string; title:string; location:string; objective:string; narrative:Narrative; map:Room[]; nodes:Record<string,boolean>; startRoom:string; vaultRoom:string; dropRoom:string; nodeRooms:string[]; nodesRequired:number; caseRoom:string|null; caseHolder:string|null; caseDelivered:boolean; caseAt:string|null; purged:boolean; hostage:Hostage; hostageAt:string|null; vaultOpen:boolean; lockdown:boolean; players:Player[]; enemies:Enemy[]; feed:FeedItem[]; event:{title:string;text:string}; waiting:string[]; secondsLeft:number|null; roundSeconds:number };
type Snapshot = { game:Game|null; templates:Template[]; missions:MissionMeta[]; networkUrl:string; networkUrls?:string[] };

const emptySnapshot:Snapshot={game:null,templates:[],missions:[],networkUrl:''};
const actionLabels:Record<string,string>={move:'MANOVRA',attack:'FUOCO',hack:'INTRUSIONE',guard:'COPERTURA',heal:'RIPRISTINO',ability:'ABILITÀ',grab:'RECUPERO',purge:'PURGA',free:'LIBERA'};
const enemyBadge=(enemy:Enemy)=>enemy.type==='DRONE'?'DR':enemy.type==='ÉLITE'?'EL':'SEC';
const vaultNoun=(game:Game)=>game.missionId==='nucleo'?'NUCLEO':game.missionId==='ostaggio'?'CELLA':'TECA';

// Helper condivisi fra plancia e telefoni: chi occupa una stanza e cosa c'è dentro.
const roomsOf=(game:Game)=>game.map||[];
const roomOf=(game:Game,id:string)=>roomsOf(game).find((r)=>r.id===id);
const nameOf=(game:Game,id?:string|null)=>id?`${id} // ${roomOf(game,id)?.name||''}`:'—';
const carrierOf=(game:Game)=>game.players.find((p)=>p.id===game.caseHolder);
const hostageCarrierOf=(game:Game)=>game.players.find((p)=>p.id===game.hostage.holder);
// Dove si trova adesso il "carico" della missione: valigetta o informatore, a terra o in spalla.
const caseRoomOf=(game:Game)=>game.caseAt||carrierOf(game)?.room||game.caseRoom;
const hostageRoomOf=(game:Game)=>game.hostageAt||hostageCarrierOf(game)?.room||game.hostage.room;
const pawnsOf=(game:Game,selfId?:string)=>(roomId:string)=>game.players.filter((p)=>p.room===roomId).map((p)=>({id:p.id,label:p.callsign[0],name:`${p.name} · ${p.role}${p.id===game.caseHolder?' · PORTA LA VALIGETTA':''}${p.id===game.hostage.holder?' · SCORTA L’INFORMATORE':''}`,color:p.color,down:p.hp<=0,self:p.id===selfId,carrying:p.id===game.caseHolder||p.id===game.hostage.holder}));
const foesOf=(game:Game)=>(roomId:string)=>game.enemies.filter((e)=>e.hp>0&&e.room===roomId).map((e)=>({id:e.id,label:enemyBadge(e),name:`${e.name} · ${e.hp}/${e.maxHp} · ${e.locked?'INGAGGIATO: VI INSEGUE':'DI PRESIDIO: FERMO IN QUESTA STANZA'}`,elite:e.type==='ÉLITE',hunting:e.locked}));

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

function StatPips({value}:{value:number}){
  return <span className="pips">{Array.from({length:10},(_,i)=><i key={i} className={i<value?'on':''}/>)}</span>;
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

function Setup({templates,missions,onCreated}:{templates:Template[];missions:MissionMeta[];onCreated:(g:Game)=>void}){
  const [count,setCount]=useState(3);
  const [picks,setPicks]=useState(()=>templates.map((t)=>({name:t.callsign,characterId:t.id})));
  const [selected,setSelected]=useState(templates[0]?.id||'');
  const [missionId,setMissionId]=useState(missions[0]?.id||'valigetta');
  const [error,setError]=useState('');
  const [manual,setManual]=useState(false);
  const [settings,setSettings]=useState(false);
  const preview=templates.find((t)=>t.id===selected)||templates[0];
  const update=(index:number,key:'name'|'characterId',value:string)=>setPicks((old)=>old.map((p,i)=>i===index?{...p,[key]:value}:p));
  const create=async()=>{try{setError('');const data=await api('/api/setup',{method:'POST',body:JSON.stringify({players:picks.slice(0,count),missionId})});onCreated(data.game);}catch(e){playSfx('alert');setError((e as Error).message);}};
  if(!preview)return <div className="loading">INIZIALIZZAZIONE ARCHIVIO OPERATIVI...</div>;
  return <main className="setup-shell">
    <header className="setup-header"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>MISSION CONTROL</small></div></div><div className="step-line"><span className="active">01 CONFIGURAZIONE</span><i/><span>02 COLLEGAMENTO</span><i/><span>03 OPERAZIONE</span></div><div className="header-tools"><button className="manual-btn" onClick={()=>setManual(true)}><BookOpen size={14}/> ISTRUZIONI</button><SettingsButton onOpen={()=>setSettings(true)}/><span className="local-tag"><CircleDot size={13}/> SISTEMA LOCALE</span></div></header>
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
          return <button type="button" key={m.id} className={`mission-brief ${missionId===m.id?'selected':''}`} onClick={()=>setMissionId(m.id)}>
            <small>{num}</small><b>{name||m.title}</b><p>{m.brief}</p>
          </button>;
        })}</div>
      </aside>
      <section className="roster panel">
        <div className="panel-kicker">ASSEGNAZIONE OPERATIVI // {count} SLOT</div>
        <div className="slot-list">{picks.slice(0,count).map((pick,index)=>{
          const t=templates.find((x)=>x.id===pick.characterId)||templates[index];
          return <article className={`slot ${selected===t.id?'selected':''}`} style={{'--accent':t.color} as React.CSSProperties} key={index}>
            <span className="slot-num">0{index+1}</span><span className="avatar">{t.callsign[0]}</span>
            <label><small>NOME GIOCATORE</small><input value={pick.name} maxLength={14} onChange={(e)=>update(index,'name',e.target.value)} onClick={(e)=>e.stopPropagation()}/></label>
            <label><small>SCHEDA PERSONAGGIO</small><select value={pick.characterId} onChange={(e)=>{update(index,'characterId',e.target.value);setSelected(e.target.value);}} onClick={(e)=>e.stopPropagation()}>{templates.map((option)=><option disabled={picks.slice(0,count).some((p,i)=>i!==index&&p.characterId===option.id)} value={option.id} key={option.id}>{option.callsign} // {option.role}</option>)}</select></label>
            <ChevronRight size={18}/>
          </article>})}</div>
      </section>
      <aside className="character-preview panel" style={{'--accent':preview.color} as React.CSSProperties}>
        <div className="panel-kicker">DOSSIER PERSONAGGIO</div><div className="portrait-large"><span>{preview.callsign[0]}</span><i>ARCHIVIO<br/>#{preview.id.toUpperCase()}-09</i></div>
        <small className="role">{preview.role} // {preview.specialty}</small><h2>{preview.callsign}</h2>
        <div className="stats">{Object.entries(preview.stats).map(([key,value])=><div key={key}><span>{key.toUpperCase()}</span><StatPips value={value}/><b>{value}</b></div>)}</div>
        <div className="loadout"><span><small>INTEGRITÀ</small><b>{preview.maxHp}</b></span><span><small>CORAZZA</small><b>{preview.armor}</b></span><span><small>FOCUS</small><b>{preview.focus}</b></span></div>
        <div className="ability-card"><Zap size={18}/><div><small>ABILITÀ // COSTO 3</small><b>{preview.ability}</b><p>{preview.abilityText}</p></div></div>
        <div className="weapon"><Crosshair size={15}/> ARMA: <b>{preview.weapon}</b></div>
      </aside>
    </section>
    <footer className="setup-footer"><span className="error">{error}</span><button className="primary-btn" data-sfx="confirm" onClick={create}>CREA CANALE DI GIOCO <ArrowRight size={18}/></button></footer>
    {manual&&<Manual templates={templates} onClose={()=>setManual(false)}/>}
    {settings&&<Settings onClose={()=>setSettings(false)}/>}
  </main>;
}

function QrCode({text,size=190}:{text:string;size?:number}){
  const grid=useMemo(()=>{try{return qrMatrix(text);}catch{return null;}},[text]);
  if(!grid)return null;
  const n=grid.length;const quiet=2;const dim=n+quiet*2;
  let path='';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(grid[y][x])path+=`M${x+quiet} ${y+quiet}h1v1h-1z`;
  return <svg className="qr" width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" role="img" aria-label="QR code per collegarsi alla partita">
    <rect width={dim} height={dim} fill="#ffffff"/>
    <path d={path} fill="#050909"/>
  </svg>;
}

function Lobby({game,templates,networkUrl,onStart,onReset}:{game:Game;templates:Template[];networkUrl:string;onStart:(g:Game)=>void;onReset:()=>void}){
  const playerUrl=`${networkUrl}/?mode=player&code=${game.code}`;
  const [error,setError]=useState('');
  const [manual,setManual]=useState(false);
  const [settings,setSettings]=useState(false);
  const linked=game.players.filter((p)=>p.connected).length;
  const start=async()=>{try{setError('');const data=await api('/api/start',{method:'POST',body:JSON.stringify({code:game.code})});onStart(data.game);}catch(e){playSfx('alert');setError((e as Error).message);}};
  return <main className="lobby-shell">
    <header className="setup-header"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>UPLINK LOBBY</small></div></div><div className="step-line"><span>01 CONFIGURAZIONE</span><i/><span className="active">02 COLLEGAMENTO</span><i/><span>03 OPERAZIONE</span></div><div className="header-tools"><button className="manual-btn" onClick={()=>setManual(true)}><BookOpen size={14}/> ISTRUZIONI</button><SettingsButton onOpen={()=>setSettings(true)}/><span className="local-tag"><Wifi size={13}/> CANALE APERTO</span></div></header>
    <section className="lobby-content">
      <div className="access-block"><small>CODICE PARTITA</small><strong>{game.code}</strong><p>Su ogni telefono, apri questo indirizzo in orizzontale:</p><code>{playerUrl}</code><div className="qr-block"><QrCode text={playerUrl}/><span>INQUADRA IL CODICE COL TELEFONO</span></div><div className="signal"><i/><i/><i/><i/><span>RETE LOCALE ATTIVA</span></div></div>
      <div className="connection-list">{game.players.map((p,index)=><article key={p.id} style={{'--accent':p.color} as React.CSSProperties} className={p.connected?'online':''}><span className="connection-index">0{index+1}</span><span className="avatar">{p.callsign[0]}</span><div><small>{p.role}</small><b>{p.name}</b></div><span className="connection-state">{p.connected?<><Wifi size={15}/> COLLEGATO</>:<><WifiOff size={15}/> IN ATTESA</>}</span></article>)}</div>
    </section>
    <footer className="setup-footer"><button className="ghost-btn" onClick={onReset}>RICOMPONI SQUADRA</button><span className="error">{error}</span><span>{linked} / {game.players.length} DISPOSITIVI COLLEGATI</span><button className="primary-btn" disabled={linked===0} title={linked===0?'Collega almeno un telefono':''} data-sfx="confirm" onClick={start}>AVVIA OPERAZIONE <Swords size={18}/></button></footer>
    {manual&&<Manual templates={templates} onClose={()=>setManual(false)}/>}
    {settings&&<Settings onClose={()=>setSettings(false)}/>}
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

function Board({game,offline,onReset}:{game:Game;offline:boolean;onReset:()=>void}){
  const [settings,setSettings]=useState(false);
  const {music}=useAudio();
  const ready=game.players.filter((p)=>p.hp>0&&p.action).length;
  const alivePlayers=game.players.filter((p)=>p.hp>0).length;
  const linked=game.players.filter((p)=>p.connected).length;
  const waiting=game.waiting||[];
  const forceRound=()=>{void api('/api/resolve',{method:'POST'}).catch(()=>{});};
  const stage=missionStage(game);
  const cargo=cargoStatus(game);
  // Un segnale acustico marca la fine dell'operazione, vittoria o sconfitta.
  useEffect(()=>{ if(game.phase==='victory')playSfx('confirm'); if(game.phase==='defeat')playSfx('alert'); },[game.phase]);
  const status=linked===0?'NESSUN TELEFONO COLLEGATO':waiting.length?`IN ATTESA DI ${waiting.join(', ')}`:`${ready}/${alivePlayers} AZIONI RICEVUTE`;
  return <main className="board-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>{offline?'SEGNALE INTERROTTO':'GM AUTONOMO ONLINE'}</small></div></div><div className="mission"><small>OPERAZIONE ATTIVA</small><strong>{game.title}</strong></div><div className="telemetry"><span><Radio size={16}/> CODICE <b>{game.code}</b></span><span><Timer size={16}/> ROUND <b>{String(game.round).padStart(2,'0')}</b></span><span className="danger"><ShieldAlert size={16}/> ALLARME <b>{game.alarm}%</b></span>{game.phase==='active'&&<button className="topbar-btn" data-sfx="confirm" onClick={forceRound}>CHIUDI ROUND</button>}<button className="topbar-btn" onClick={()=>setSettings(true)}>AUDIO {music}</button><button className="topbar-btn" onClick={onReset}>TERMINA</button></div></header>
    <section className="board-grid">
      <aside className="panel intel-panel"><div className="panel-kicker">01 // DIRETTIVA</div><h1>{game.narrative.goalHeadline}</h1><p>{game.objective}</p><div className="objective"><span>NODI VIOLATI</span><b>{game.breach} / {game.nodesRequired}</b><i style={{width:`${Math.min(1,game.breach/(game.nodesRequired||1))*100}%`}}/></div><div className={`case-track ${cargo.done?'done':''}`}><span><Briefcase size={13}/> {cargo.label}</span><b>{cargo.text}</b></div><div className="stage-card"><small>{stage.label}</small><b>{stage.short}</b><p>{stage.text}</p></div><div className="section-label">FLUSSO TATTICO</div><ol className="feed">{game.feed.slice(0,5).map((item,i)=><li className={item.tone} key={`${item.time}-${i}`}><time>{item.time}</time><span>{item.text}</span></li>)}</ol></aside>
      <section className="tactical panel"><div className="map-head"><span>PIANTA // {game.location}</span><span className="stage-tag">{stage.label} · {stage.short}</span><span>{roomsOf(game).length} STANZE · {game.lockdown?'LOCKDOWN':'RILEVAMENTO PASSIVO'}</span></div><TacticalMap game={game}/><div className="legend"><span><i className="dot friendly"/>SQUADRA</span><span><i className="dot hostile"/>OSTILE</span><span><i className="dot start"/>PARTENZA</span><span><i className="dot system"/>NODO</span>{game.missionId!=='nucleo'&&<span><i className="dot case"/>{cargo.label}</span>}<span><i className="dot exit"/>CONSEGNA</span><span><i className="dot hunting"/>INGAGGIATO</span><strong className={linked===0?'stalled':''}>{status}</strong></div></section>
      <aside className="panel threats-panel"><div className="panel-kicker">03 // MINACCE</div>{game.enemies.filter((e)=>e.hp>0).slice(0,3).map((e)=>{const contested=game.players.some((p)=>p.hp>0&&p.room===e.room);return <div className={`threat-card ${e.type==='ÉLITE'?'elite':''} ${contested?'contested':''}`} key={e.id}><span className="threat-icon">{e.type==='ÉLITE'?<Skull size={21}/>:<Crosshair size={21}/>}</span><div><small>{e.type} // {e.room} {roomOf(game,e.room)?.name||''}</small><b>{e.name}</b><Meter value={e.hp} max={e.maxHp} tone="red"/><em>{contested?'IN CONTATTO CON LA SQUADRA':e.locked?`VI INSEGUE · ${e.hp}/${e.maxHp}`:`DI PRESIDIO · ${e.hp}/${e.maxHp}`}</em></div></div>;})}<div className="section-label">RISPOSTA DEL SISTEMA</div><div className="gm-card"><small>GM AUTONOMO // PREVISIONE</small><b>{game.event.title}</b><p>{game.event.text}</p></div></aside>
    </section>
    <footer className="squadbar"><div className="squad-title"><Users size={19}/><span>SQUADRA<br/><b>{alivePlayers} OPERATIVI</b></span></div>{game.players.map((p)=><article className={`operative ${p.hp<=0?'down':''}`} key={p.id} style={{'--accent':p.color} as React.CSSProperties}><span className="portrait">{p.callsign[0]}</span><div className="op-name"><b>{p.name}</b><small>{p.role} · {p.connected?'ONLINE':'OFFLINE'}</small><span className="op-room"><MapPin size={10}/> {p.room} {roomOf(game,p.room)?.name||''}</span></div><div className="hp"><Meter value={p.hp} max={p.maxHp}/><small>INTEGRITÀ {p.hp}/{p.maxHp}</small></div><div className={`status ${p.action?'ready':''}`}>{p.hp<=0?'K.O.':p.action?'PRONTO':p.move?'IN MANOVRA':'SCELTA...'}</div></article>)}</footer>
    {(game.phase==='victory'||game.phase==='defeat')&&<div className={`outcome ${game.phase}`}><div><small>OPERAZIONE CONCLUSA</small><h2>{game.phase==='victory'?'MNEMOSYNE È NOSTRO':'SQUADRA NEUTRALIZZATA'}</h2><p>{game.phase==='victory'?`Valigetta consegnata e squadra estratta da ${nameOf(game,game.dropRoom)}. La Helix non sa ancora cosa ha perso.`:'La torre è in lockdown. Il segnale clandestino è perduto.'}</p><button className="primary-btn" data-sfx="confirm" onClick={onReset}>NUOVA OPERAZIONE <RotateCw size={17}/></button></div></div>}
    {settings&&<Settings onClose={()=>setSettings(false)}/>}
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
  if(!session||!player){return <main className="join-shell"><section className="join-card"><div className="join-tools"><SettingsButton compact onOpen={()=>setSettings(true)}/></div><div className="brand centered"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>OPERATIVE UPLINK</small></div></div><div className="uplink-icon"><Smartphone/><i/><Radio/></div><small>INSERISCI CODICE PARTITA</small><div className="code-entry"><input value={code} onChange={(e)=>setCode(e.target.value.toUpperCase())} placeholder="NEON-77" maxLength={7}/><button onClick={find}><LogIn/></button></div>{snapshot.game&&snapshot.game.code===searchCode?<div className="seat-select"><span>SELEZIONA IL TUO OPERATIVO</span>{snapshot.game.players.map((p)=><button disabled={p.connected} onClick={()=>join(p.id)} key={p.id} style={{'--accent':p.color} as React.CSSProperties}><i>{p.callsign[0]}</i><span><small>{p.role}</small><b>{p.name}</b></span><em>{p.connected?'OCCUPATO':'ENTRA'}</em></button>)}</div>:searchCode&&<p className="join-hint">In attesa del canale <b>{searchCode}</b>…</p>}<p className="error">{error}</p>{settings&&<Settings onClose={()=>setSettings(false)}/>}</section></main>}
  return <PlayerConsole game={snapshot.game!} player={player} session={session} offline={offline}/>;
}

function PlayerConsole({game,player,session,offline}:{game:Game;player:Player;session:{playerId:string;deviceId:string};offline:boolean}){
  const [target,setTarget]=useState('');
  const [sending,setSending]=useState(false);const [error,setError]=useState('');
  const [settings,setSettings]=useState(false);
  const [moving,setMoving]=useState(false);
  const room=roomOf(game,player.room);
  const exits=room?.links||[];
  // La manovra è gratuita e si risolve prima del fuoco: se è già stata dichiarata, l'azione
  // avrà effetto nella stanza di destinazione, quindi la console si riferisce già a quella.
  const actRoomId=player.move?.roomId||player.room;
  const actRoom=roomOf(game,actRoomId);
  const hostiles=game.enemies.filter((e)=>e.hp>0&&e.room===actRoomId);
  const hostilesNow=game.enemies.filter((e)=>e.hp>0&&e.room===player.room);
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
  const fifthAction=game.missionId==='nucleo'
    ?{label:'PURGA',icon:<Zap/>,sub:game.purged?'Già lanciata':purgeReady?'Cancella il nucleo dati':actRoomId!==game.vaultRoom?`Nucleo in ${game.vaultRoom}`:'Firewall ancora attivo',disabled:sending||!purgeReady,onClick:()=>act('purge')}
    :game.missionId==='ostaggio'
    ?{label:'LIBERA',icon:<Briefcase/>,sub:escorting?'Lo stai già scortando':hostageBlocked?`Cella sigillata: servono ${game.nodesRequired} nodi`:hostageHere?'Libera l’informatore':`Informatore in ${hostageRoomOf(game)||'—'}`,disabled:sending||!hostageHere||hostageBlocked,onClick:()=>act('free')}
    :{label:'RECUPERO',icon:<Briefcase/>,sub:carrying?'La stai già portando':caseBlocked?`Teca sigillata: servono ${game.nodesRequired} nodi`:caseHere?'Raccogli la valigetta MNEMOSYNE':`Valigetta in ${caseRoomOf(game)||'—'}`,disabled:sending||!caseHere||caseBlocked,onClick:()=>act('grab')};
  const act=async(type:string,roomId?:string)=>{try{setSending(true);setError('');await api('/api/action',{method:'POST',body:JSON.stringify({code:game.code,playerId:player.id,deviceId:session.deviceId,type,targetId:selectedTarget,roomId:roomId||null})});setMoving(false);}catch(e){playSfx('alert');setError((e as Error).message);}finally{setSending(false);}};
  const waiting=game.phase==='lobby';
  const abilityBlocked=waiting||game.phase!=='active'||Boolean(player.action)||player.focus<3||sending;
  return <main className="player-shell" style={{'--accent':player.color} as React.CSSProperties}>
    <div className="rotate-notice"><RotateCw/><b>RUOTA IL DISPOSITIVO</b><span>La console operativa richiede lo schermo orizzontale.</span></div>
    <header className="player-top"><div className="player-id"><span>{player.callsign[0]}</span><div><small>{player.role} // {player.specialty}</small><b>{player.name}</b></div></div><div className="round-state"><span>ROUND <b>{String(game.round).padStart(2,'0')}</b></span><span className="pos"><MapPin size={12}/> <b>{player.room}</b> {room?.name}</span><span className="alarm">ALLARME <b>{game.alarm}%</b></span></div><div className="player-tools"><SettingsButton compact onOpen={()=>setSettings(true)}/><div className={`link-state ${offline?'offline':''}`}>{offline?<WifiOff/>:<Wifi/>}{offline?'OFFLINE':'LINK ATTIVO'}</div></div></header>
    <section className="player-grid">
      <aside className="vitals">
        <div className="room-card"><small>STANZA ATTUALE</small><b>{player.room} // {room?.name}</b><div className="room-flags">{room?.start&&<i className="start">PARTENZA</i>}{room?.node&&<i className={game.nodes?.[player.room]?'done':'live'}>{game.nodes?.[player.room]?'NODO VIOLATO':'NODO ATTIVO'}</i>}{room?.vault&&<i className="vault">{game.vaultOpen?`${noun} APERTA`:`${noun} SIGILLATA`}</i>}{room?.exit&&<i className="exit">CONSEGNA</i>}{room?.cover&&<i className="cover">COPERTURA</i>}{room?.exposed&&<i className="exposed">ZONA ESPOSTA</i>}{carrying&&<i className="case">HAI LA VALIGETTA</i>}{escorting&&<i className="case">SCORTI L’INFORMATORE · {game.hostage.hp}/{game.hostage.maxHp} HP</i>}</div><p className={hostilesNow.length?'danger':''}>{hostilesNow.length?`${hostilesNow.length} OSTILI PRESENTI`:'NESSUN OSTILE'}{game.players.filter((p)=>p.id!==player.id&&p.room===player.room).length?` · ${game.players.filter((p)=>p.id!==player.id&&p.room===player.room).length} COMPAGNI`:' · SEI SOLO'}</p></div>
        <div className="vital-title"><Activity/> STATO BIOMETRICO</div><div className="big-vital"><span>INTEGRITÀ</span><b>{player.hp}<small>/{player.maxHp}</small></b><Meter value={player.hp} max={player.maxHp}/></div><div className="sub-vitals"><span><i>FOCUS</i><b>{player.focus}/{player.maxFocus}</b><Meter value={player.focus} max={player.maxFocus} tone="violet"/></span><span><i>STRESS</i><b>{player.stress}%</b><Meter value={player.stress} tone="red"/></span><span><i>CORAZZA</i><b>{player.armor}</b><Meter value={player.armor} max={10} tone="acid"/></span></div><div className="mini-stats">{Object.entries(player.stats).map(([k,v])=><span key={k}><i>{k.slice(0,3).toUpperCase()}</i><b>{v}</b></span>)}</div>
      </aside>
      <section className="actions"><div className="action-head"><div><small>CONSOLE AZIONI</small><b>{player.action?'COMANDO TRASMESSO':'SELEZIONA COMANDO'}</b></div><span>{game.players.filter((p)=>p.action).length}/{game.players.filter((p)=>p.hp>0).length} PRONTI</span></div>
        {waiting?<div className="standby"><Radio/><b>IN ATTESA DELLA PLANCIA</b><span>Il computer avvierà l’operazione quando la squadra sarà pronta.</span></div>:game.phase!=='active'?<div className="standby"><Sparkles/><b>OPERAZIONE CONCLUSA</b><span>Controlla lo schermo principale.</span></div>:player.hp<=0?<div className="standby danger"><Skull/><b>FUORI COMBATTIMENTO</b><span>Sei a terra in {player.room}. Solo un compagno nella tua stessa stanza può rianimarti.</span></div>:player.action?<div className="standby confirmed"><Check/><b>{actionLabels[player.action.type]} CONFERMATO</b><span>{player.move?`Manovra gratuita verso ${player.move.roomId} · `:''}Attendi la risoluzione autonoma del round.</span></div>:<>
          <button className={`move-btn ${player.move?'armed':''}`} data-sfx="confirm" onClick={()=>setMoving(true)} disabled={sending||!exits.length}><Footprints/><span><b>MANOVRA GRATUITA{player.move?` → ${player.move.roomId}`:''}</b><small>{player.move?'Manovra pronta · tocca per cambiare stanza · poi scegli l’azione':`${carrying?'Porti la valigetta · ':escorting?'Scorti l’informatore · ':''}Non consuma l’azione · ${exits.join(' · ')}`}</small></span><ChevronRight/></button>
          {hostiles.length>0?<div className="target-row"><Target/><span>BERSAGLIO IN {actRoomId}{player.move?' (dopo la manovra)':''}</span><select value={selectedTarget} onChange={(e)=>setTarget(e.target.value)}>{hostiles.map((e)=><option value={e.id} key={e.id}>{e.name} // HP {e.hp}</option>)}</select></div>:<div className="target-row empty"><Target/><span>NESSUN OSTILE IN {actRoomId} — il fuoco è inutile finché non li raggiungi</span></div>}
          <div className="action-grid">
            <button data-sfx="confirm" onClick={()=>act('attack')} disabled={sending||!hostiles.length} title={hostiles.length?'':'Nessun ostile nella tua stanza'}><Swords/><span><b>FUOCO</b><small>{hostiles.length?'Danno arma + Riflessi':'Nessun ostile qui'}</small></span><kbd>01</kbd></button>
            <button data-sfx="confirm" onClick={()=>act('hack')} disabled={sending||!nodeHere} title={nodeHere?'':'Nessun nodo attivo in questa stanza'}><Cpu/><span><b>INTRUSIONE</b><small>{nodeHere?'Viola il nodo di questa stanza':'Nessun nodo attivo qui'}</small></span><kbd>02</kbd></button>
            <button data-sfx="confirm" onClick={()=>act('guard')} disabled={sending}><Shield/><span><b>COPERTURA</b><small>{room?.cover?'Copertura potenziata in questa stanza':'Assorbe danni in arrivo'}</small></span><kbd>03</kbd></button>
            <button data-sfx="confirm" onClick={()=>act('heal')} disabled={sending||player.focus<2}><HeartPulse/><span><b>{downedHere?'RIANIMAZIONE':'RIPRISTINO'}</b><small>{downedHere?`Rimette in piedi ${downedHere.name}`:'Cura chi è nella tua stanza'}</small></span><kbd>04</kbd></button>
            <button className="grab-action" data-sfx="confirm" onClick={fifthAction.onClick} disabled={fifthAction.disabled}>{fifthAction.icon}<span><b>{fifthAction.label}</b><small>{fifthAction.sub}</small></span><kbd>05</kbd></button>
          </div>
        </>}
      </section>
      <aside className="loadout-panel"><div className="weapon-block"><Crosshair/><span><small>ARMA PRIMARIA</small><b>{player.weapon}</b></span></div><div className="ability-panel"><Zap/><small>ABILITÀ ESCLUSIVA // 3 FOCUS</small><h2>{player.ability}</h2><p>{player.abilityText}</p><button disabled={abilityBlocked} data-sfx="confirm" onClick={()=>act('ability')}>ATTIVA <ChevronRight/></button></div><div className="personal-objective"><LockKeyhole/><div><small>{stage.label}</small><p>{stage.text}</p></div></div></aside>
    </section>
    <footer className="player-footer"><span>{game.code} // {game.location}</span><div className="ticker"><AlertTriangle/> {game.event.title}: {game.event.text}</div><span>{error||'CANALE CIFRATO'}</span></footer>
    {moving&&<div className="move-overlay"><div className="move-panel"><header><div><small>MANOVRA // DA {player.room} {room?.name}</small><b>SCEGLI LA STANZA</b></div><button className="move-close" onClick={()=>setMoving(false)}><X size={18}/></button></header>
      <BoardMap variant="mini" rooms={roomsOf(game)} pawnsIn={pawnsOf(game,player.id)} foesIn={foesOf(game)} marksIn={marksOf(game)} highlight={exits} currentRoom={player.room} onPick={(id)=>{void act('move',id);}}/>
      <footer>{hostilesNow.length?<b className="warn"><AlertTriangle size={13}/> Sganciarti da {player.room} ti espone al fuoco di {hostilesNow[0].name}.</b>:<b><DoorOpen size={13}/> Porte disponibili: {exits.join(' · ')}</b>}<span>{error}</span></footer>
    </div></div>}
    {settings&&<Settings onClose={()=>setSettings(false)}/>}
  </main>;
}

function BoardRoot(){
  const {snapshot,setSnapshot,offline}=useSnapshot();
  const reset=async()=>{if(!confirm('Chiudere la partita corrente e tornare al setup?'))return;await api('/api/reset',{method:'POST'});setSnapshot((s)=>({...s,game:null}));};
  if(!snapshot.game&&!snapshot.templates.length)return <div className="loading">INIZIALIZZAZIONE ARCHIVIO OPERATIVI...</div>;
  if(!snapshot.game)return <Setup templates={snapshot.templates} missions={snapshot.missions} onCreated={(game)=>setSnapshot((s)=>({...s,game}))}/>;
  if(snapshot.game.phase==='lobby')return <Lobby game={snapshot.game} templates={snapshot.templates} networkUrl={snapshot.networkUrl} onStart={(game)=>setSnapshot((s)=>({...s,game}))} onReset={reset}/>;
  return <Board game={snapshot.game} offline={offline} onReset={reset}/>;
}

export default function App(){
  const isPlayer=useMemo(()=>new URLSearchParams(location.search).get('mode')==='player',[]);
  // La colonna sonora esce solo dalla plancia: i telefoni ricevono unicamente gli effetti.
  return <AudioProvider music={!isPlayer}>{isPlayer?<PlayerJoin/>:<BoardRoot/>}</AudioProvider>;
}

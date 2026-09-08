import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BookOpen, Check, ChevronRight, CircleDot,
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
type Player = Template & { name:string; characterId:string; hp:number; maxFocus:number; stress:number; shield:number; room:string; action:null|PlayerAction; deviceId:string|null; connected:boolean };
type Enemy = { id:string; name:string; type:string; hp:number; maxHp:number; armor:number; damage:number; threat:number; room:string; hunting?:boolean };
type FeedItem = { time:string; tone:string; text:string };
type Game = { code:string; phase:'lobby'|'active'|'victory'|'defeat'; difficulty:string; round:number; alarm:number; breach:number; title:string; location:string; objective:string; map:Room[]; nodes:Record<string,boolean>; exitRoom:string; players:Player[]; enemies:Enemy[]; feed:FeedItem[]; event:{title:string;text:string}; waiting:string[]; secondsLeft:number|null; roundSeconds:number };
type Snapshot = { game:Game|null; templates:Template[]; networkUrl:string; networkUrls?:string[] };

const emptySnapshot:Snapshot={game:null,templates:[],networkUrl:''};
const actionLabels:Record<string,string>={move:'MANOVRA',attack:'FUOCO',hack:'INTRUSIONE',guard:'COPERTURA',heal:'RIPRISTINO',ability:'ABILITÀ'};
const enemyBadge=(enemy:Enemy)=>enemy.id==='k9'?'K9':enemy.type==='DRONE'?'DR':enemy.type==='ÉLITE'?'EL':'SEC';

// Helper condivisi fra plancia e telefoni: chi occupa una stanza e cosa c'è dentro.
const roomsOf=(game:Game)=>game.map||[];
const roomOf=(game:Game,id:string)=>roomsOf(game).find((r)=>r.id===id);
const pawnsOf=(game:Game,selfId?:string)=>(roomId:string)=>game.players.filter((p)=>p.room===roomId).map((p)=>({id:p.id,label:p.callsign[0],name:`${p.name} · ${p.role}`,color:p.color,down:p.hp<=0,self:p.id===selfId}));
const foesOf=(game:Game)=>(roomId:string)=>game.enemies.filter((e)=>e.hp>0&&e.room===roomId).map((e)=>({id:e.id,label:enemyBadge(e),name:`${e.name} · ${e.hp}/${e.maxHp} · ${e.hunting?'IN CACCIA':'IN PATTUGLIA'}`,elite:e.type==='ÉLITE',hunting:e.hunting}));
const bossAlive=(game:Game)=>game.enemies.some((e)=>e.id==='k9'&&e.hp>0);

// L'obiettivo cambia stanza a seconda della fase: prima i nodi, poi il Custode, poi l'uscita.
function missionStage(game:Game){
  const pending=roomsOf(game).filter((r)=>r.node&&!game.nodes?.[r.id]).map((r)=>r.id);
  if(game.breach<3) return {label:'FASE 1 // RETE',short:'VIOLA I NODI',text:`Raggiungete e violate i nodi ancora attivi: ${pending.join(' · ')||'—'}.`};
  if(bossAlive(game)) return {label:'FASE 2 // CUSTODE',short:'ABBATTI IL K-9',text:'Il Custode K-9 è sganciato e vi dà la caccia: neutralizzatelo.'};
  return {label:'FASE 3 // ESTRAZIONE',short:`TUTTI IN ${game.exitRoom}`,text:`Portate ogni operativo vivo in ${game.exitRoom} per chiudere l’operazione.`};
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

function Setup({templates,onCreated}:{templates:Template[];onCreated:(g:Game)=>void}){
  const [count,setCount]=useState(3);
  const [difficulty,setDifficulty]=useState('standard');
  const [picks,setPicks]=useState(()=>templates.map((t)=>({name:t.callsign,characterId:t.id})));
  const [selected,setSelected]=useState(templates[0]?.id||'');
  const [error,setError]=useState('');
  const [manual,setManual]=useState(false);
  const [settings,setSettings]=useState(false);
  const preview=templates.find((t)=>t.id===selected)||templates[0];
  const update=(index:number,key:'name'|'characterId',value:string)=>setPicks((old)=>old.map((p,i)=>i===index?{...p,[key]:value}:p));
  const create=async()=>{try{setError('');const data=await api('/api/setup',{method:'POST',body:JSON.stringify({players:picks.slice(0,count),difficulty})});onCreated(data.game);}catch(e){playSfx('alert');setError((e as Error).message);}};
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
        <div className="difficulty-picker">
          {[['recluta','RECLUTA','Più margine, danni ridotti'],['standard','STANDARD','Bilanciato e letale'],['brutale','BRUTALE','Nessuna pietà']].map(([id,label,copy])=><button className={difficulty===id?'active':''} onClick={()=>setDifficulty(id)} key={id}><b>{label}</b><small>{copy}</small></button>)}
        </div>
        <div className="mission-brief"><small>PRIMA MISSIONE</small><b>SPEZZARE LA GABBIA</b><p>Penetrare nella Helix Tower, violare la rete e sottrarre il prototipo MNEMOSYNE.</p></div>
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
    nodes={game.nodes||{}}
    pawnsIn={pawnsOf(game,selfId)}
    foesIn={foesOf(game)}
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
  // Un segnale acustico marca la fine dell'operazione, vittoria o sconfitta.
  useEffect(()=>{ if(game.phase==='victory')playSfx('confirm'); if(game.phase==='defeat')playSfx('alert'); },[game.phase]);
  const status=linked===0?'NESSUN TELEFONO COLLEGATO':waiting.length?`IN ATTESA DI ${waiting.join(', ')}`:`${ready}/${alivePlayers} AZIONI RICEVUTE`;
  return <main className="board-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">R//P</span><div><b>ROVERPUNK</b><small>{offline?'SEGNALE INTERROTTO':'GM AUTONOMO ONLINE'}</small></div></div><div className="mission"><small>OPERAZIONE ATTIVA</small><strong>{game.title}</strong></div><div className="telemetry"><span><Radio size={16}/> CODICE <b>{game.code}</b></span><span><Timer size={16}/> ROUND <b>{String(game.round).padStart(2,'0')}</b></span>{game.secondsLeft!==null&&game.secondsLeft!==undefined&&<span className={game.secondsLeft<=10?'danger':''}><Timer size={16}/> TEMPO <b>{game.secondsLeft}s</b></span>}<span className="danger"><ShieldAlert size={16}/> ALLARME <b>{game.alarm}%</b></span>{game.phase==='active'&&<button className="topbar-btn" data-sfx="confirm" onClick={forceRound}>CHIUDI ROUND</button>}<button className="topbar-btn" onClick={()=>setSettings(true)}>AUDIO {music}</button><button className="topbar-btn" onClick={onReset}>TERMINA</button></div></header>
    <section className="board-grid">
      <aside className="panel intel-panel"><div className="panel-kicker">01 // DIRETTIVA</div><h1>Violate il nucleo Helix</h1><p>{game.objective}</p><div className="objective"><span>BRECCIA RETE</span><b>{game.breach} / 3</b><i style={{width:`${game.breach/3*100}%`}}/></div><div className="stage-card"><small>{stage.label}</small><b>{stage.short}</b><p>{stage.text}</p></div><div className="section-label">FLUSSO TATTICO</div><ol className="feed">{game.feed.slice(0,6).map((item,i)=><li className={item.tone} key={`${item.time}-${i}`}><time>{item.time}</time><span>{item.text}</span></li>)}</ol></aside>
      <section className="tactical panel"><div className="map-head"><span>PIANTA // {game.location}</span><span className="stage-tag">{stage.label} · {stage.short}</span><span>SCANSIONE {Math.min(100,48+game.breach*17)}%</span></div><TacticalMap game={game}/><div className="legend"><span><i className="dot friendly"/>SQUADRA</span><span><i className="dot hostile"/>OSTILE</span><span><i className="dot system"/>NODO</span><span><i className="dot exit"/>ESTRAZIONE</span><span><i className="dot hunting"/>IN CACCIA</span><strong className={linked===0?'stalled':''}>{status}</strong></div></section>
      <aside className="panel threats-panel"><div className="panel-kicker">03 // MINACCE</div>{game.enemies.filter((e)=>e.hp>0).slice(0,3).map((e)=>{const contested=game.players.some((p)=>p.hp>0&&p.room===e.room);return <div className={`threat-card ${e.type==='ÉLITE'?'elite':''} ${contested?'contested':''}`} key={e.id}><span className="threat-icon">{e.type==='ÉLITE'?<Skull size={21}/>:<Crosshair size={21}/>}</span><div><small>{e.type} // {e.room} {roomOf(game,e.room)?.name||''}</small><b>{e.name}</b><Meter value={e.hp} max={e.maxHp} tone="red"/><em>{contested?'IN CONTATTO CON LA SQUADRA':e.hunting?`IN CACCIA · ${e.hp}/${e.maxHp}`:`IN PATTUGLIA · ${e.hp}/${e.maxHp}`}</em></div></div>;})}<div className="section-label">RISPOSTA DEL SISTEMA</div><div className="gm-card"><small>GM AUTONOMO // PREVISIONE</small><b>{game.event.title}</b><p>{game.event.text}</p></div></aside>
    </section>
    <footer className="squadbar"><div className="squad-title"><Users size={19}/><span>SQUADRA<br/><b>{alivePlayers} OPERATIVI</b></span></div>{game.players.map((p)=><article className={`operative ${p.hp<=0?'down':''}`} key={p.id} style={{'--accent':p.color} as React.CSSProperties}><span className="portrait">{p.callsign[0]}</span><div className="op-name"><b>{p.name}</b><small>{p.role} · {p.connected?'ONLINE':'OFFLINE'}</small><span className="op-room"><MapPin size={10}/> {p.room} {roomOf(game,p.room)?.name||''}</span></div><div className="hp"><Meter value={p.hp} max={p.maxHp}/><small>INTEGRITÀ {p.hp}/{p.maxHp}</small></div><div className={`status ${p.action?'ready':''}`}>{p.hp<=0?'K.O.':p.action?'PRONTO':'SCELTA...'}</div></article>)}</footer>
    {(game.phase==='victory'||game.phase==='defeat')&&<div className={`outcome ${game.phase}`}><div><small>OPERAZIONE CONCLUSA</small><h2>{game.phase==='victory'?'MNEMOSYNE È NOSTRO':'SQUADRA NEUTRALIZZATA'}</h2><p>{game.phase==='victory'?'Squadra estratta dall’ACCESSO A01 con il prototipo. La Helix non sa ancora cosa ha perso.':'La torre è in lockdown. Il segnale clandestino è perduto.'}</p><button className="primary-btn" data-sfx="confirm" onClick={onReset}>NUOVA OPERAZIONE <RotateCw size={17}/></button></div></div>}
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
  // Tutto quello che il giocatore può fare dipende dalla stanza in cui si trova fisicamente.
  const hostiles=game.enemies.filter((e)=>e.hp>0&&e.room===player.room);
  const squadHere=game.players.filter((p)=>p.id!==player.id&&p.room===player.room);
  const downedHere=squadHere.find((p)=>p.hp<=0);
  const exits=room?.links||[];
  const nodeHere=Boolean(room?.node)&&!game.nodes?.[player.room];
  const selectedTarget=hostiles.some((e)=>e.id===target)?target:(hostiles[0]?.id||'');
  const stage=missionStage(game);
  const act=async(type:string,roomId?:string)=>{try{setSending(true);setError('');await api('/api/action',{method:'POST',body:JSON.stringify({code:game.code,playerId:player.id,deviceId:session.deviceId,type,targetId:selectedTarget,roomId:roomId||null})});setMoving(false);}catch(e){playSfx('alert');setError((e as Error).message);}finally{setSending(false);}};
  const waiting=game.phase==='lobby';
  const abilityBlocked=waiting||game.phase!=='active'||Boolean(player.action)||player.focus<3||sending;
  return <main className="player-shell" style={{'--accent':player.color} as React.CSSProperties}>
    <div className="rotate-notice"><RotateCw/><b>RUOTA IL DISPOSITIVO</b><span>La console operativa richiede lo schermo orizzontale.</span></div>
    <header className="player-top"><div className="player-id"><span>{player.callsign[0]}</span><div><small>{player.role} // {player.specialty}</small><b>{player.name}</b></div></div><div className="round-state"><span>ROUND <b>{String(game.round).padStart(2,'0')}</b></span><span className="pos"><MapPin size={12}/> <b>{player.room}</b> {room?.name}</span>{game.secondsLeft!==null&&game.secondsLeft!==undefined&&<span className={game.secondsLeft<=10?'alarm':''}>TEMPO <b>{game.secondsLeft}s</b></span>}<span className="alarm">ALLARME <b>{game.alarm}%</b></span></div><div className="player-tools"><SettingsButton compact onOpen={()=>setSettings(true)}/><div className={`link-state ${offline?'offline':''}`}>{offline?<WifiOff/>:<Wifi/>}{offline?'OFFLINE':'LINK ATTIVO'}</div></div></header>
    <section className="player-grid">
      <aside className="vitals">
        <div className="room-card"><small>STANZA ATTUALE</small><b>{player.room} // {room?.name}</b><div className="room-flags">{room?.node&&<i className={game.nodes?.[player.room]?'done':'live'}>{game.nodes?.[player.room]?'NODO VIOLATO':'NODO ATTIVO'}</i>}{room?.vault&&<i className="vault">OBIETTIVO</i>}{room?.exit&&<i className="exit">ESTRAZIONE</i>}{room?.cover&&<i className="cover">COPERTURA</i>}{room?.exposed&&<i className="exposed">ZONA ESPOSTA</i>}</div><p className={hostiles.length?'danger':''}>{hostiles.length?`${hostiles.length} OSTILI PRESENTI`:'NESSUN OSTILE'}{squadHere.length?` · ${squadHere.length} COMPAGNI`:' · SEI SOLO'}</p></div>
        <div className="vital-title"><Activity/> STATO BIOMETRICO</div><div className="big-vital"><span>INTEGRITÀ</span><b>{player.hp}<small>/{player.maxHp}</small></b><Meter value={player.hp} max={player.maxHp}/></div><div className="sub-vitals"><span><i>FOCUS</i><b>{player.focus}/{player.maxFocus}</b><Meter value={player.focus} max={player.maxFocus} tone="violet"/></span><span><i>STRESS</i><b>{player.stress}%</b><Meter value={player.stress} tone="red"/></span><span><i>CORAZZA</i><b>{player.armor}</b><Meter value={player.armor} max={10} tone="acid"/></span></div><div className="mini-stats">{Object.entries(player.stats).map(([k,v])=><span key={k}><i>{k.slice(0,3).toUpperCase()}</i><b>{v}</b></span>)}</div>
      </aside>
      <section className="actions"><div className="action-head"><div><small>CONSOLE AZIONI</small><b>{player.action?'COMANDO TRASMESSO':'SELEZIONA COMANDO'}</b></div><span>{game.players.filter((p)=>p.action).length}/{game.players.filter((p)=>p.hp>0).length} PRONTI</span></div>
        {waiting?<div className="standby"><Radio/><b>IN ATTESA DELLA PLANCIA</b><span>Il computer avvierà l’operazione quando la squadra sarà pronta.</span></div>:game.phase!=='active'?<div className="standby"><Sparkles/><b>OPERAZIONE CONCLUSA</b><span>Controlla lo schermo principale.</span></div>:player.hp<=0?<div className="standby danger"><Skull/><b>FUORI COMBATTIMENTO</b><span>Sei a terra in {player.room}. Solo un compagno nella tua stessa stanza può rianimarti.</span></div>:player.action?<div className="standby confirmed"><Check/><b>{actionLabels[player.action.type]} CONFERMATO</b><span>{player.action.type==='move'?`Manovra verso ${player.action.roomId}. Attendi la risoluzione del round.`:'Attendi la risoluzione autonoma del round.'}</span></div>:<>
          <button className="move-btn" data-sfx="confirm" onClick={()=>setMoving(true)} disabled={sending||!exits.length}><Footprints/><span><b>MANOVRA</b><small>Spostati in una stanza collegata · {exits.join(' · ')}</small></span><ChevronRight/></button>
          {hostiles.length>0?<div className="target-row"><Target/><span>BERSAGLIO IN {player.room}</span><select value={selectedTarget} onChange={(e)=>setTarget(e.target.value)}>{hostiles.map((e)=><option value={e.id} key={e.id}>{e.name} // HP {e.hp}</option>)}</select></div>:<div className="target-row empty"><Target/><span>NESSUN OSTILE IN {player.room} — il fuoco è inutile finché non li raggiungi</span></div>}
          <div className="action-grid">
            <button data-sfx="confirm" onClick={()=>act('attack')} disabled={sending||!hostiles.length} title={hostiles.length?'':'Nessun ostile nella tua stanza'}><Swords/><span><b>FUOCO</b><small>{hostiles.length?'Danno arma + Riflessi':'Nessun ostile qui'}</small></span><kbd>01</kbd></button>
            <button data-sfx="confirm" onClick={()=>act('hack')} disabled={sending||!nodeHere} title={nodeHere?'':'Nessun nodo attivo in questa stanza'}><Cpu/><span><b>INTRUSIONE</b><small>{nodeHere?'Viola il nodo di questa stanza':'Nessun nodo attivo qui'}</small></span><kbd>02</kbd></button>
            <button data-sfx="confirm" onClick={()=>act('guard')} disabled={sending}><Shield/><span><b>COPERTURA</b><small>{room?.cover?'Copertura potenziata in questa stanza':'Assorbe danni in arrivo'}</small></span><kbd>03</kbd></button>
            <button data-sfx="confirm" onClick={()=>act('heal')} disabled={sending||player.focus<2}><HeartPulse/><span><b>{downedHere?'RIANIMAZIONE':'RIPRISTINO'}</b><small>{downedHere?`Rimette in piedi ${downedHere.name}`:'Cura chi è nella tua stanza'}</small></span><kbd>04</kbd></button>
          </div>
        </>}
      </section>
      <aside className="loadout-panel"><div className="weapon-block"><Crosshair/><span><small>ARMA PRIMARIA</small><b>{player.weapon}</b></span></div><div className="ability-panel"><Zap/><small>ABILITÀ ESCLUSIVA // 3 FOCUS</small><h2>{player.ability}</h2><p>{player.abilityText}</p><button disabled={abilityBlocked} data-sfx="confirm" onClick={()=>act('ability')}>ATTIVA <ChevronRight/></button></div><div className="personal-objective"><LockKeyhole/><div><small>{stage.label}</small><p>{stage.text}</p></div></div></aside>
    </section>
    <footer className="player-footer"><span>{game.code} // {game.location}</span><div className="ticker"><AlertTriangle/> {game.event.title}: {game.event.text}</div><span>{error||'CANALE CIFRATO'}</span></footer>
    {moving&&<div className="move-overlay"><div className="move-panel"><header><div><small>MANOVRA // DA {player.room} {room?.name}</small><b>SCEGLI LA STANZA</b></div><button className="move-close" onClick={()=>setMoving(false)}><X size={18}/></button></header>
      <BoardMap variant="mini" rooms={roomsOf(game)} nodes={game.nodes||{}} pawnsIn={pawnsOf(game,player.id)} foesIn={foesOf(game)} highlight={exits} currentRoom={player.room} onPick={(id)=>{void act('move',id);}}/>
      <footer>{hostiles.length?<b className="warn"><AlertTriangle size={13}/> Sganciarti da {player.room} ti espone al fuoco di {hostiles[0].name}.</b>:<b><DoorOpen size={13}/> Uscite disponibili: {exits.join(' · ')}</b>}<span>{error}</span></footer>
    </div></div>}
    {settings&&<Settings onClose={()=>setSettings(false)}/>}
  </main>;
}

function BoardRoot(){
  const {snapshot,setSnapshot,offline}=useSnapshot();
  const reset=async()=>{if(!confirm('Chiudere la partita corrente e tornare al setup?'))return;await api('/api/reset',{method:'POST'});setSnapshot((s)=>({...s,game:null}));};
  if(!snapshot.game&&!snapshot.templates.length)return <div className="loading">INIZIALIZZAZIONE ARCHIVIO OPERATIVI...</div>;
  if(!snapshot.game)return <Setup templates={snapshot.templates} onCreated={(game)=>setSnapshot((s)=>({...s,game}))}/>;
  if(snapshot.game.phase==='lobby')return <Lobby game={snapshot.game} templates={snapshot.templates} networkUrl={snapshot.networkUrl} onStart={(game)=>setSnapshot((s)=>({...s,game}))} onReset={reset}/>;
  return <Board game={snapshot.game} offline={offline} onReset={reset}/>;
}

export default function App(){
  const isPlayer=useMemo(()=>new URLSearchParams(location.search).get('mode')==='player',[]);
  // La colonna sonora esce solo dalla plancia: i telefoni ricevono unicamente gli effetti.
  return <AudioProvider music={!isPlayer}>{isPlayer?<PlayerJoin/>:<BoardRoot/>}</AudioProvider>;
}

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Database, FastForward, Music, Power, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { useAudio } from './audio';
import { chapterList, MobileGuide } from './Manual';

type Templates = Parameters<typeof chapterList>[0];

// Pannello impostazioni: due sezioni a schede, ISTRUZIONI (il manuale operativo) e AUDIO
// (musica + effetti). Sui telefoni la musica non viene riprodotta — la colonna sonora esce
// solo dalla plancia — quindi il cursore relativo resta visibile ma disattivato, con la spiegazione.
export function SettingsButton({onOpen,compact}:{onOpen:()=>void;compact?:boolean}){
  return <button className={`settings-btn ${compact?'compact':''}`} onClick={onOpen} title="Impostazioni">
    <span>IMPOSTAZIONI</span>
  </button>;
}

function Level({icon,label,hint,value,onChange,disabled}:{icon:React.ReactNode;label:string;hint:string;value:number;onChange:(v:number)=>void;disabled?:boolean}){
  return <div className={`audio-row ${disabled?'disabled':''}`}>
    <span className="audio-icon">{value===0?<VolumeX size={17}/>:icon}</span>
    <div className="audio-label"><b>{label}</b><small>{hint}</small></div>
    <input type="range" min={0} max={100} step={1} value={value} disabled={disabled}
      onChange={(e)=>onChange(Number(e.target.value))} style={{'--fill':`${value}%`} as React.CSSProperties}/>
    <b className="audio-value">{value}</b>
  </div>;
}

function AudioSection(){
  const {music,sfx,setMusic,setSfx,musicEnabled}=useAudio();
  return <div className="settings-audio">
    <Level icon={<Music size={17}/>} label="MUSICA" value={music} onChange={setMusic} disabled={!musicEnabled}
      hint={musicEnabled?'Colonna sonora in loop durante tutta la partita.':'La colonna sonora è riprodotta solo dalla plancia.'}/>
    <Level icon={<Volume2 size={17}/>} label="EFFETTI SONORI" value={sfx} onChange={setSfx}
      hint="Comandi, conferme e allarmi dell’interfaccia."/>
    <p className="settings-note">I livelli sono salvati su questo dispositivo: ogni telefono ha le proprie impostazioni.</p>
  </div>;
}

// Comandi di partita (solo con operazione attiva): SALTA TURNO e CHIUDI ROUND stanno nella
// sezione SESSIONE, sopra a TERMINA OPERAZIONE, invece che nella barra in alto della plancia.
export type GameControls = { turnLabel:string; roundLabel:string; onSkipTurn:()=>void; onForceRound:()=>void };

// Sezione SESSIONE: visibile solo dalla plancia in partita (quando arriva onReset).
// Termina l'operazione in corso e riporta tutti alla configurazione — con conferma esplicita.
function SessionSection({onReset,controls}:{onReset:()=>void;controls?:GameControls}){
  const [confirm,setConfirm]=useState(false);
  return <div className="settings-session">
    {controls&&<>
      <div className="audio-row session-row">
        <span className="audio-icon"><SkipForward size={17}/></span>
        <div className="audio-label"><b>SALTA TURNO</b><small>Passa la mano all’operativo successivo (telefono offline o giocatore assente). {controls.turnLabel}</small></div>
        <button className="ghost-btn" data-sfx="confirm" onClick={controls.onSkipTurn}>SALTA TURNO</button>
      </div>
      <div className="audio-row session-row">
        <span className="audio-icon"><FastForward size={17}/></span>
        <div className="audio-label"><b>CHIUDI ROUND</b><small>Chi non ha ancora giocato perde il turno, rispondono subito gli Helix e si apre il round nuovo. {controls.roundLabel}</small></div>
        <button className="ghost-btn" data-sfx="confirm" onClick={controls.onForceRound}>CHIUDI ROUND</button>
      </div>
    </>}
    <div className="audio-row">
      <span className="audio-icon"><Power size={17}/></span>
      <div className="audio-label"><b>TERMINA OPERAZIONE</b><small>Chiude la partita in corso e riporta plancia e telefoni alla configurazione. Non è reversibile.</small></div>
    </div>
    {confirm
      ? <div className="session-confirm"><span>Terminare davvero l’operazione in corso?</span><div><button className="ghost-btn" data-sfx="back" onClick={()=>setConfirm(false)}>ANNULLA</button><button className="danger-btn" data-sfx="alert" onClick={onReset}>TERMINA ORA</button></div></div>
      : <button className="danger-btn" data-sfx="alert" onClick={()=>setConfirm(true)}>TERMINA OPERAZIONE</button>}
  </div>;
}

function ManualSection({templates,chapterId,onPick}:{templates:Templates;chapterId:string;onPick:(id:string)=>void}){
  const chapters=chapterList(templates);
  const chapter=chapters.find((c)=>c.id===chapterId)||chapters[0];
  return <>
    <nav className="manual-nav">{chapters.map((c,i)=><button className={c.id===chapter.id?'active':''} onClick={()=>onPick(c.id)} key={c.id}><i>{String(i+1).padStart(2,'0')}</i>{c.icon}<span>{c.label}</span></button>)}</nav>
    <article className="manual-content" key={chapter.id}>{chapter.content}</article>
  </>;
}

// `mobile`: console del telefono. Pannello a tutto schermo con intestazione su una sola riga
// (titolo, schede, chiudi) e istruzioni ridotte (`MobileGuide`) al posto del manuale completo.
export default function Settings({onClose,templates=[],onReset,database,controls,mobile}:{onClose:()=>void;templates?:Templates;onReset?:()=>void;database?:React.ReactNode;controls?:GameControls;mobile?:boolean}){
  const {play}=useAudio();
  const [tab,setTab]=useState<'istruzioni'|'audio'|'sessione'|'database'>('istruzioni');
  const [chapterId,setChapterId]=useState('come-si-gioca');
  const close=useCallback(()=>{play('back');onClose();},[play,onClose]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{ if(event.key==='Escape') close(); };
    document.addEventListener('keydown',onKey);
    return()=>document.removeEventListener('keydown',onKey);
  },[close]);
  const manualMode=tab==='istruzioni';
  const dbMode=tab==='database';
  const tabs=<>
    <button className={tab==='istruzioni'?'active':''} onClick={()=>setTab('istruzioni')}><BookOpen size={13}/> ISTRUZIONI</button>
    <button className={tab==='audio'?'active':''} onClick={()=>setTab('audio')}><Volume2 size={13}/> AUDIO</button>
    {database&&<button className={tab==='database'?'active':''} onClick={()=>setTab('database')}><Database size={13}/> DATABASE</button>}
    {onReset&&<button className={tab==='sessione'?'active':''} onClick={()=>setTab('sessione')}><Power size={13}/> SESSIONE</button>}
  </>;
  return <div className="settings-overlay">
    <button className="settings-scrim" aria-label="Chiudi impostazioni" onClick={close}/>
    <section className={`settings-card panel ${mobile?'mobile':''}`}>
      {mobile
        ? <header className="settings-head"><b>IMPOSTAZIONI</b><nav className="settings-tabs">{tabs}</nav><button className="icon-btn" data-sfx="back" onClick={close} aria-label="Chiudi"><X size={20}/></button></header>
        : <><header className="settings-head">
            <div><small>CONFIGURAZIONE SISTEMA</small><b>IMPOSTAZIONI</b></div>
            <button className="icon-btn" data-sfx="back" onClick={close}><X size={18}/></button>
          </header>
          <nav className="settings-tabs">{tabs}</nav></>}
      <div className={`settings-body ${manualMode&&!mobile?'manual-mode':''} ${manualMode&&mobile?'guide-mode':''} ${dbMode?'db-mode':''}`}>
        {tab==='istruzioni'&&(mobile?<MobileGuide/>:<ManualSection templates={templates} chapterId={chapterId} onPick={setChapterId}/>)}
        {tab==='audio'&&<AudioSection/>}
        {tab==='sessione'&&onReset&&<SessionSection onReset={onReset} controls={controls}/>}
        {tab==='database'&&database}
      </div>
      {!mobile&&<footer className="settings-foot"><button className="ghost-btn" data-sfx="back" onClick={close}>CHIUDI</button></footer>}
    </section>
  </div>;
}

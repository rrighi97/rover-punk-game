import { useCallback, useEffect } from 'react';
import { Music, Sliders, Volume2, VolumeX, X } from 'lucide-react';
import { useAudio } from './audio';

// Pannello impostazioni: per ora contiene la sezione audio (musica + effetti).
// Sui telefoni la musica non viene riprodotta — la colonna sonora esce solo dalla plancia —
// quindi il cursore relativo resta visibile ma disattivato, con la spiegazione.
export function SettingsButton({onOpen,compact}:{onOpen:()=>void;compact?:boolean}){
  return <button className={`settings-btn ${compact?'compact':''}`} onClick={onOpen} title="Impostazioni">
    <Sliders size={14}/>{compact?null:<span>IMPOSTAZIONI</span>}
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

export default function Settings({onClose}:{onClose:()=>void}){
  const {music,sfx,setMusic,setSfx,musicEnabled,play}=useAudio();
  const close=useCallback(()=>{play('back');onClose();},[play,onClose]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{ if(event.key==='Escape') close(); };
    document.addEventListener('keydown',onKey);
    return()=>document.removeEventListener('keydown',onKey);
  },[close]);
  return <div className="settings-overlay">
    <button className="settings-scrim" aria-label="Chiudi impostazioni" onClick={close}/>
    <section className="settings-card panel">
      <header className="settings-head">
        <div><small>CONFIGURAZIONE SISTEMA</small><b>IMPOSTAZIONI</b></div>
        <button className="icon-btn" data-sfx="back" onClick={close}><X size={18}/></button>
      </header>
      <div className="settings-body">
        <div className="panel-kicker">AUDIO</div>
        <Level icon={<Music size={17}/>} label="MUSICA" value={music} onChange={setMusic} disabled={!musicEnabled}
          hint={musicEnabled?'Colonna sonora in loop durante tutta la partita.':'La colonna sonora è riprodotta solo dalla plancia.'}/>
        <Level icon={<Volume2 size={17}/>} label="EFFETTI SONORI" value={sfx} onChange={setSfx}
          hint="Comandi, conferme e allarmi dell’interfaccia."/>
        <p className="settings-note">I livelli sono salvati su questo dispositivo: ogni telefono ha le proprie impostazioni.</p>
      </div>
      <footer className="settings-foot"><button className="ghost-btn" data-sfx="back" onClick={close}>CHIUDI</button></footer>
    </section>
  </div>;
}

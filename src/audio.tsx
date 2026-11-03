import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Motore audio del gioco.
// - La colonna sonora gira SOLO sulla plancia (il computer con il tabellone): i telefoni
//   riproducono unicamente gli effetti dell'interfaccia.
// - Gli effetti sono sintetizzati con la Web Audio API: nessun file da scaricare, quindi
//   funzionano subito anche sui telefoni collegati alla rete locale.

export type SfxName = 'click'|'confirm'|'alert'|'back'|'shoot'|'blackout'|'unlock'|'doorunlock';

const STORAGE_KEY='roverpunk-audio';
type Levels = { music:number; sfx:number };
const defaults:Levels={music:45,sfx:70};
// La colonna sonora (file mp3, mastered) copre gli effetti sintetizzati quando si interagisce
// (aprire pannelli, toccare comandi): a parità di slider la musica esce al 40% di quanto
// indicato e gli effetti il 20% più forte (con tetto a 100%), per lasciare
// spazio agli effetti. Lo slider mostra e salva il valore scelto; solo il volume
// effettivamente applicato viene scalato.
const MUSIC_RELATIVE_GAIN=0.40;
const SFX_RELATIVE_GAIN=1.20;
function sfxGain(level:number){ return Math.min(1,level/100*SFX_RELATIVE_GAIN); }

function readLevels():Levels{
  try{
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(saved&&typeof saved.music==='number'&&typeof saved.sfx==='number')
      return {music:clamp(saved.music),sfx:clamp(saved.sfx)};
  }catch{/* storage non disponibile */}
  return defaults;
}
function clamp(value:number){ return Math.max(0,Math.min(100,Math.round(value))); }

// ---- sintetizzatore effetti ----------------------------------------------------------
let context:AudioContext|null=null;
let master:GainNode|null=null;
let sfxVolume=sfxGain(defaults.sfx);

function engine(){
  if(context) return {context,master:master!};
  const Ctor=window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
  if(!Ctor) return null;
  context=new Ctor();
  master=context.createGain();
  master.gain.value=sfxVolume;
  master.connect(context.destination);
  return {context,master};
}

// I browser mobili sospendono il contesto finché non c'è un gesto dell'utente.
function resume(){ if(context&&context.state==='suspended') void context.resume(); }

type Voice = { wave:OscillatorType; from:number; to:number; duration:number; gain:number; delay?:number };
const recipes:Partial<Record<SfxName,Voice[]>>={
  // Tocco secco e metallico sui comandi dell'interfaccia.
  click:[{wave:'square',from:880,to:520,duration:0.07,gain:0.16}],
  // Conferma: due note che salgono, per le azioni che vengono trasmesse davvero.
  confirm:[{wave:'triangle',from:520,to:660,duration:0.09,gain:0.18},{wave:'triangle',from:780,to:1040,duration:0.14,gain:0.14,delay:0.07}],
  // Allarme: due colpi bassi e sporchi per errori e situazioni critiche.
  alert:[{wave:'sawtooth',from:300,to:150,duration:0.16,gain:0.16},{wave:'sawtooth',from:260,to:110,duration:0.2,gain:0.14,delay:0.15}],
  // Ritorno / chiusura pannelli.
  back:[{wave:'square',from:420,to:240,duration:0.1,gain:0.14}],
};

// Alcuni effetti sono file mp3 registrati (non sintetizzabili bene), come lo sparo di FUOCO.
const sfxFiles:Partial<Record<SfxName,string>>={ shoot:'/audio/shoot.mp3', blackout:'/audio/blackout.mp3', unlock:'/audio/unlock.mp3', doorunlock:'/audio/unlock_doors.mp3' };
// Alcuni file hanno bisogno di più volume del master (Web Audio accetta guadagni > 1).
const sfxFileBoost:Partial<Record<SfxName,number>>={ unlock:1.4 };
const fileBuffers:Map<string,AudioBuffer>=new Map();
const fileBufferPromises:Map<string,Promise<AudioBuffer>>=new Map();
function loadFileBuffer(ctx:AudioContext,url:string):Promise<AudioBuffer>{
  const cached=fileBuffers.get(url); if(cached) return Promise.resolve(cached);
  const pending=fileBufferPromises.get(url); if(pending) return pending;
  const promise=fetch(url).then((r)=>r.arrayBuffer()).then((data)=>ctx.decodeAudioData(data))
    .then((buffer)=>{ fileBuffers.set(url,buffer); return buffer; });
  fileBufferPromises.set(url,promise);
  return promise;
}

export function playSfx(name:SfxName){
  if(sfxVolume<=0) return;
  const audio=engine(); if(!audio) return;
  resume();
  const file=sfxFiles[name];
  if(file){
    loadFileBuffer(audio.context,file).then((buffer)=>{
      if(sfxVolume<=0) return; // volume azzerato nel frattempo
      const source=audio.context.createBufferSource();
      source.buffer=buffer;
      const boost=sfxFileBoost[name];
      if(boost){ const g=audio.context.createGain(); g.gain.value=boost; source.connect(g); g.connect(audio.master); }
      else source.connect(audio.master);
      source.start();
    });
    return;
  }
  const recipe=recipes[name]; if(!recipe) return;
  const now=audio.context.currentTime;
  for(const voice of recipe){
    const start=now+(voice.delay||0);
    const osc=audio.context.createOscillator();
    const gain=audio.context.createGain();
    osc.type=voice.wave;
    osc.frequency.setValueAtTime(voice.from,start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40,voice.to),start+voice.duration);
    gain.gain.setValueAtTime(0.0001,start);
    gain.gain.exponentialRampToValueAtTime(voice.gain,start+0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001,start+voice.duration);
    osc.connect(gain);gain.connect(audio.master);
    osc.start(start);osc.stop(start+voice.duration+0.02);
  }
}

// Sirena d'allarme: file mp3 (public/audio/alarm.mp3), tagliato/sfumato a `duration` secondi
// per restare sincronizzato col pop-up a schermo. Passa dal master degli effetti, quindi segue
// il volume EFFETTI anche se lo si cambia mentre suona. Una sirena nuova spegne quella precedente
// (più rinforzi in coda non si sovrappongono).
let sirenBuffer:AudioBuffer|null=null;
let sirenBufferPromise:Promise<AudioBuffer>|null=null;
function loadSirenBuffer(ctx:AudioContext):Promise<AudioBuffer>{
  if(sirenBuffer) return Promise.resolve(sirenBuffer);
  if(!sirenBufferPromise) sirenBufferPromise=fetch('/audio/alarm.mp3')
    .then((r)=>r.arrayBuffer())
    .then((data)=>ctx.decodeAudioData(data))
    .then((buffer)=>{ sirenBuffer=buffer; return buffer; });
  return sirenBufferPromise;
}

let siren:{source:AudioBufferSourceNode;gain:GainNode}|null=null;

export function playSiren(duration=5){
  if(sfxVolume<=0) return;
  const audio=engine(); if(!audio) return;
  resume();
  if(siren){ const old=siren; siren=null; try{ old.gain.gain.cancelScheduledValues(0); old.gain.gain.value=0; old.source.stop(); }catch{/* già fermata */} }
  const {context:ctx}=audio;
  loadSirenBuffer(ctx).then((buffer)=>{
    if(sfxVolume<=0) return; // volume azzerato nel frattempo
    const now=ctx.currentTime;
    const end=now+duration;
    const gain=ctx.createGain();
    gain.gain.setValueAtTime(0.0001,now);
    gain.gain.exponentialRampToValueAtTime(0.8,now+0.08);
    gain.gain.setValueAtTime(0.8,Math.max(now+0.08,end-0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001,end);
    gain.connect(audio.master);
    const source=ctx.createBufferSource();
    source.buffer=buffer;
    source.connect(gain);
    source.start(now);
    source.stop(end+0.05);
    const current={source,gain};
    siren=current;
    source.onended=()=>{ if(siren===current) siren=null; };
  });
}

// ---- contesto React ------------------------------------------------------------------
// Due tracce: "menu" (copertina, setup, lobby, impostazioni) e "game" (partita in corso).
// Il cambio fra le due avviene con `setPhase`, chiamato da chi sa in che schermata siamo.
export type MusicPhase='menu'|'game';
const TRACKS:Record<MusicPhase,string>={menu:'/audio/menu.mp3',game:'/audio/soundtrack.mp3'};

// ---- loop musicale con dissolvenza incrociata ----------------------------------------
// L'`<audio loop>` nativo salta da fine a inizio senza sfumatura: si sente come un taglio
// netto. Per evitarlo alterniamo due elementi <audio> che si sovrappongono per
// CROSSFADE_SECONDS: quando quello attivo si avvicina alla fine, l'altro riparte da 0 e i
// due si dissolvono a vicenda (fade-out/fade-in lineari).
const CROSSFADE_SECONDS=4;

type MusicLoop={ setVolume:(v:number)=>void; destroy:()=>void };

function createMusicLoop(url:string,initialVolume:number):MusicLoop{
  const a=new Audio(url); const b=new Audio(url);
  // Solo la traccia in ascolto viene scaricata e decodificata subito: la gemella di riserva
  // serve unicamente per la dissolvenza a fine brano, e con `preload='auto'` teneva in memoria
  // una seconda copia decodificata dello stesso mp3 (la colonna sonora sta sui 6 MB) per tutta
  // la partita. Passa ad 'auto' solo poco prima di entrare in scena (vedi onTime).
  a.preload='auto'; b.preload='none';
  let volume=initialVolume;
  let active=a; let standby=b;
  let crossfading=false;
  let raf:number|undefined;
  let destroyed=false;

  active.volume=volume; standby.volume=0;
  // I browser bloccano l'autoplay finché non c'è un gesto dell'utente: si riprova al primo.
  const attempt=()=>{ resume(); if(volume>0) active.play().catch(()=>{}); };
  const gestures:Array<keyof DocumentEventMap>=['pointerdown','keydown','touchstart'];
  for(const type of gestures) document.addEventListener(type,attempt);
  attempt();

  function beginCrossfade(){
    if(destroyed||crossfading) return;
    crossfading=true;
    const outgoing=active; const incoming=standby;
    incoming.currentTime=0; incoming.volume=0;
    if(volume>0) incoming.play().catch(()=>{});
    const start=performance.now();
    const step=(now:number)=>{
      if(destroyed) return;
      const t=Math.min(1,(now-start)/(CROSSFADE_SECONDS*1000));
      outgoing.volume=volume*(1-t);
      incoming.volume=volume*t;
      if(t<1){ raf=requestAnimationFrame(step); return; }
      outgoing.pause(); outgoing.currentTime=0;
      active=incoming; standby=outgoing;
      crossfading=false;
    };
    raf=requestAnimationFrame(step);
  }

  // Margine di preparazione della gemella: si scarica qualche secondo prima della dissolvenza.
  const PRELOAD_LEAD=CROSSFADE_SECONDS+10;
  const onTime=(event:Event)=>{
    if(destroyed||crossfading) return;
    const el=event.currentTarget as HTMLAudioElement;
    if(el!==active) return;
    const duration=el.duration;
    if(!duration||!isFinite(duration)) return;
    const fade=Math.min(CROSSFADE_SECONDS,duration/2);
    if(standby.preload!=='auto'&&el.currentTime>=duration-fade-PRELOAD_LEAD){ standby.preload='auto'; standby.load(); }
    if(el.currentTime>=duration-fade) beginCrossfade();
  };
  a.addEventListener('timeupdate',onTime);
  b.addEventListener('timeupdate',onTime);

  return {
    setVolume(v){
      volume=v;
      if(crossfading) return; // il prossimo frame della dissolvenza applica il nuovo volume
      active.volume=v;
      if(v===0) active.pause();
      else if(active.paused) active.play().catch(()=>{});
    },
    destroy(){
      destroyed=true;
      if(raf) cancelAnimationFrame(raf);
      for(const type of gestures) document.removeEventListener(type,attempt);
      a.removeEventListener('timeupdate',onTime); b.removeEventListener('timeupdate',onTime);
      a.pause(); b.pause();
      // Cambio di traccia (menu -> partita): senza staccare la sorgente il browser tiene in
      // memoria il buffer del brano precedente finché non passa il garbage collector.
      for(const el of [a,b]){ el.removeAttribute('src'); el.load(); }
    },
  };
}

type AudioApi = { music:number; sfx:number; setMusic:(v:number)=>void; setSfx:(v:number)=>void; play:(name:SfxName)=>void; musicEnabled:boolean; setPhase:(phase:MusicPhase)=>void; duckMusic:(holdSeconds?:number,fadeMs?:number)=>void };
const AudioContextApi=createContext<AudioApi>({music:defaults.music,sfx:defaults.sfx,setMusic:()=>{},setSfx:()=>{},play:()=>{},musicEnabled:false,setPhase:()=>{},duckMusic:()=>{}});

export function useAudio(){ return useContext(AudioContextApi); }

export function AudioProvider({children,music:musicEnabled}:{children:React.ReactNode;music:boolean}){
  const [levels,setLevels]=useState<Levels>(readLevels);
  const [phase,setPhase]=useState<MusicPhase>('menu');
  const loopRef=useRef<MusicLoop|null>(null);
  const duckTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const duckRaf=useRef<number|undefined>(undefined);
  useEffect(()=>()=>{ if(duckTimer.current) clearTimeout(duckTimer.current); if(duckRaf.current) cancelAnimationFrame(duckRaf.current); },[]);

  useEffect(()=>{ sfxVolume=sfxGain(levels.sfx); if(master) master.gain.value=sfxVolume;
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(levels)); }catch{/* storage non disponibile */}
  },[levels]);

  // Colonna sonora: solo sulla plancia, in loop con dissolvenza incrociata (createMusicLoop).
  // La traccia cambia con la fase (menu/partita) ricreando il loop, senza smontare il provider.
  useEffect(()=>{
    if(!musicEnabled) return;
    const loop=createMusicLoop(TRACKS[phase],levels.music/100*MUSIC_RELATIVE_GAIN);
    loopRef.current=loop;
    return()=>{ loop.destroy(); loopRef.current=null; };
  },[musicEnabled,phase]);// eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    loopRef.current?.setVolume(levels.music/100*MUSIC_RELATIVE_GAIN);
  },[levels.music]);

  // Un solo ascoltatore globale sonorizza tutti i comandi dell'interfaccia:
  // `data-sfx` su un elemento sceglie un suono diverso dal click standard.
  useEffect(()=>{
    const onDown=(event:PointerEvent)=>{
      const target=(event.target as HTMLElement|null)?.closest?.('button,select,a,[role="button"],input[type="range"]');
      if(!target) return;
      if((target as HTMLButtonElement).disabled) return;
      playSfx(((target as HTMLElement).dataset.sfx as SfxName)||'click');
    };
    document.addEventListener('pointerdown',onDown);
    return()=>document.removeEventListener('pointerdown',onDown);
  },[]);

  const play=useCallback((name:SfxName)=>playSfx(name),[]);
  // BLACKOUT: taglio netto del volume musica (non una sfumata) tenuto per `holdSeconds`, poi
  // rientro morbido in `fadeMs` fino al volume impostato nelle opzioni. Un secondo blackout
  // durante il rientro annulla il fade precedente invece di sommarsi.
  const duckMusic=useCallback((holdSeconds=5,fadeMs=1200)=>{
    const loop=loopRef.current; if(!loop) return;
    if(duckTimer.current) clearTimeout(duckTimer.current);
    if(duckRaf.current) cancelAnimationFrame(duckRaf.current);
    loop.setVolume(0);
    duckTimer.current=setTimeout(()=>{
      const target=levels.music/100*MUSIC_RELATIVE_GAIN;
      const start=performance.now();
      const step=(now:number)=>{
        const t=Math.min(1,(now-start)/fadeMs);
        loopRef.current?.setVolume(target*t);
        if(t<1) duckRaf.current=requestAnimationFrame(step);
      };
      duckRaf.current=requestAnimationFrame(step);
    },holdSeconds*1000);
  },[levels.music]);
  const value=useMemo<AudioApi>(()=>({
    music:levels.music,sfx:levels.sfx,musicEnabled,play,setPhase,duckMusic,
    setMusic:(v)=>setLevels((old)=>({...old,music:clamp(v)})),
    setSfx:(v)=>setLevels((old)=>({...old,sfx:clamp(v)})),
  }),[levels,musicEnabled,play,duckMusic]);

  return <AudioContextApi.Provider value={value}>{children}</AudioContextApi.Provider>;
}

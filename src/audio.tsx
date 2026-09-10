import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// Motore audio del gioco.
// - La colonna sonora gira SOLO sulla plancia (il computer con il tabellone): i telefoni
//   riproducono unicamente gli effetti dell'interfaccia.
// - Gli effetti sono sintetizzati con la Web Audio API: nessun file da scaricare, quindi
//   funzionano subito anche sui telefoni collegati alla rete locale.

export type SfxName = 'click'|'confirm'|'alert'|'back';

const STORAGE_KEY='roverpunk-audio';
type Levels = { music:number; sfx:number };
const defaults:Levels={music:45,sfx:70};
// La colonna sonora (file mp3, mastered) copre gli effetti sintetizzati quando si interagisce
// (aprire pannelli, toccare comandi): a parità di slider la musica esce sempre il 30% più
// piano di quanto indicato e gli effetti il 20% più forte (con tetto a 100%), per lasciare
// spazio agli effetti. Lo slider mostra e salva il valore scelto; solo il volume
// effettivamente applicato viene scalato.
const MUSIC_RELATIVE_GAIN=0.70;
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
const recipes:Record<SfxName,Voice[]>={
  // Tocco secco e metallico sui comandi dell'interfaccia.
  click:[{wave:'square',from:880,to:520,duration:0.07,gain:0.16}],
  // Conferma: due note che salgono, per le azioni che vengono trasmesse davvero.
  confirm:[{wave:'triangle',from:520,to:660,duration:0.09,gain:0.18},{wave:'triangle',from:780,to:1040,duration:0.14,gain:0.14,delay:0.07}],
  // Allarme: due colpi bassi e sporchi per errori e situazioni critiche.
  alert:[{wave:'sawtooth',from:300,to:150,duration:0.16,gain:0.16},{wave:'sawtooth',from:260,to:110,duration:0.2,gain:0.14,delay:0.15}],
  // Ritorno / chiusura pannelli.
  back:[{wave:'square',from:420,to:240,duration:0.1,gain:0.14}],
};

export function playSfx(name:SfxName){
  if(sfxVolume<=0) return;
  const audio=engine(); if(!audio) return;
  resume();
  const now=audio.context.currentTime;
  for(const voice of recipes[name]){
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

// Sirena d'allarme: ululato che sale e scende per `duration` secondi. Passa dal master degli
// effetti, quindi segue il volume EFFETTI anche se lo si cambia mentre suona. Una sirena nuova
// spegne quella precedente (più rinforzi in coda non si sovrappongono).
let siren:{osc:OscillatorNode[];gain:GainNode}|null=null;

export function playSiren(duration=5){
  if(sfxVolume<=0) return;
  const audio=engine(); if(!audio) return;
  resume();
  if(siren){ const old=siren; siren=null; try{ old.gain.gain.cancelScheduledValues(0); old.gain.gain.value=0; old.osc.forEach((o)=>o.stop()); }catch{/* già fermata */} }
  const {context:ctx}=audio;
  const now=ctx.currentTime;
  const end=now+duration;
  const cycle=1.1; // secondi per una salita + discesa
  const gain=ctx.createGain();
  gain.gain.setValueAtTime(0.0001,now);
  gain.gain.exponentialRampToValueAtTime(0.13,now+0.08);
  gain.gain.setValueAtTime(0.13,end-0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001,end);
  const filter=ctx.createBiquadFilter();
  filter.type='lowpass';filter.frequency.value=2600;
  filter.connect(gain);gain.connect(audio.master);
  const osc=(['sawtooth','square'] as OscillatorType[]).map((wave,i)=>{
    const o=ctx.createOscillator();
    o.type=wave;
    const detune=i?1.006:1;
    o.frequency.setValueAtTime(620*detune,now);
    for(let t=now;t<end;t+=cycle){
      o.frequency.linearRampToValueAtTime(1180*detune,Math.min(end,t+cycle/2));
      o.frequency.linearRampToValueAtTime(620*detune,Math.min(end,t+cycle));
    }
    const voice=ctx.createGain();voice.gain.value=i?0.35:0.65;
    o.connect(voice);voice.connect(filter);
    o.start(now);o.stop(end+0.05);
    return o;
  });
  const current={osc,gain};
  siren=current;
  osc[0].onended=()=>{ if(siren===current) siren=null; };
}

// ---- contesto React ------------------------------------------------------------------
type AudioApi = { music:number; sfx:number; setMusic:(v:number)=>void; setSfx:(v:number)=>void; play:(name:SfxName)=>void; musicEnabled:boolean };
const AudioContextApi=createContext<AudioApi>({music:defaults.music,sfx:defaults.sfx,setMusic:()=>{},setSfx:()=>{},play:()=>{},musicEnabled:false});

export function useAudio(){ return useContext(AudioContextApi); }

export function AudioProvider({children,music:musicEnabled}:{children:React.ReactNode;music:boolean}){
  const [levels,setLevels]=useState<Levels>(readLevels);
  const audioRef=useRef<HTMLAudioElement|null>(null);

  useEffect(()=>{ sfxVolume=sfxGain(levels.sfx); if(master) master.gain.value=sfxVolume;
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(levels)); }catch{/* storage non disponibile */}
  },[levels]);

  // Colonna sonora: solo sulla plancia, in loop, con volume gestito dalle impostazioni.
  useEffect(()=>{
    if(!musicEnabled) return;
    const element=new Audio('/audio/soundtrack.mp3');
    element.loop=true;element.preload='auto';element.volume=levels.music/100*MUSIC_RELATIVE_GAIN;
    audioRef.current=element;
    // I browser bloccano la riproduzione automatica: si riprova al primo gesto dell'utente.
    const start=()=>{ resume(); if(element.volume>0) element.play().catch(()=>{}); };
    start();
    const gestures:Array<keyof DocumentEventMap>=['pointerdown','keydown','touchstart'];
    for(const type of gestures) document.addEventListener(type,start);
    return()=>{ for(const type of gestures) document.removeEventListener(type,start); element.pause();audioRef.current=null; };
  },[musicEnabled]);// eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    const element=audioRef.current; if(!element) return;
    element.volume=levels.music/100*MUSIC_RELATIVE_GAIN;
    if(levels.music===0) element.pause();
    else if(element.paused) element.play().catch(()=>{});
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
  const value=useMemo<AudioApi>(()=>({
    music:levels.music,sfx:levels.sfx,musicEnabled,play,
    setMusic:(v)=>setLevels((old)=>({...old,music:clamp(v)})),
    setSfx:(v)=>setLevels((old)=>({...old,sfx:clamp(v)})),
  }),[levels,musicEnabled,play]);

  return <AudioContextApi.Provider value={value}>{children}</AudioContextApi.Provider>;
}

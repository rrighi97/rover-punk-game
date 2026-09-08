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
let sfxVolume=defaults.sfx/100;

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

// ---- contesto React ------------------------------------------------------------------
type AudioApi = { music:number; sfx:number; setMusic:(v:number)=>void; setSfx:(v:number)=>void; play:(name:SfxName)=>void; musicEnabled:boolean };
const AudioContextApi=createContext<AudioApi>({music:defaults.music,sfx:defaults.sfx,setMusic:()=>{},setSfx:()=>{},play:()=>{},musicEnabled:false});

export function useAudio(){ return useContext(AudioContextApi); }

export function AudioProvider({children,music:musicEnabled}:{children:React.ReactNode;music:boolean}){
  const [levels,setLevels]=useState<Levels>(readLevels);
  const audioRef=useRef<HTMLAudioElement|null>(null);

  useEffect(()=>{ sfxVolume=levels.sfx/100; if(master) master.gain.value=sfxVolume;
    try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(levels)); }catch{/* storage non disponibile */}
  },[levels]);

  // Colonna sonora: solo sulla plancia, in loop, con volume gestito dalle impostazioni.
  useEffect(()=>{
    if(!musicEnabled) return;
    const element=new Audio('/audio/soundtrack.mp3');
    element.loop=true;element.preload='auto';element.volume=levels.music/100;
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
    element.volume=levels.music/100;
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

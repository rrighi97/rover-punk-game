// DATABASE NEMICI — set base di 5 unità Helix in ordine CRESCENTE di forza (tier 1 = più
// fragile, tier 5 = più letale). INTEGRITÀ (hp) = vita. DANNO (damage) = colpo dell'arma,
// sempre a segno. Estratto da server.mjs per rendere le modifiche manuali ai numeri più
// semplici da individuare, senza toccare nessuna meccanica di gioco.
export const ENEMY_ROSTER = [
  { key:'drone',  tier:1, name:'WASP D-2',      type:'DRONE',      hp:35,  damage:13, threat:2,
    note:'Micro-drone da ricognizione. Fragile e leggero: cade in due colpi, ma marca la squadra.',
    deploy:'Presidio leggero ai nodi di rete.' },
  { key:'hunter', tier:2, name:'HELIX SEGUGIO', type:'CACCIATORE', hp:40,  damage:15, threat:3,
    note:'Unità mobile da inseguimento. Poca corazza, ma una volta agganciata non molla la traccia.',
    deploy:'Entra da sola a ogni soglia d’allarme (25→75%) e parte subito a caccia.' },
  { key:'sec',    tier:3, name:'HELIX SEC-4',   type:'FANTERIA',   hp:50,  damage:16, threat:3,
    note:'Guardia di fanteria standard della torre: il presidio più comune e più prevedibile.',
    deploy:'Presidio ai nodi di rete.' },
  { key:'elite',  tier:4, name:'CUSTODE K-9',   type:'ÉLITE',      hp:130, damage:22, threat:5,
    note:'Presidio corazzato dell’obiettivo. Molta integrità e colpo duro: va logorato in gruppo.',
    deploy:'Sempre di guardia alla teca / nucleo / cella.' },
  { key:'titan',  tier:5, name:'HELIX GOLIATH', type:'PESANTE',    hp:225, damage:30, threat:6,
    note:'Blindato d’assalto. La minaccia più alta del settore: da aggirare, non da affrontare a viso aperto.',
    deploy:'Riserva pesante: schierato solo dalle missioni che lo richiamano nel presidio.' },
];

// DATABASE PERSONAGGI
// Statistiche dei 6 operativi giocabili. Estratto da server.mjs per rendere le modifiche
// manuali ai numeri più semplici da individuare, senza toccare nessuna meccanica di gioco.
// DANNO (dmg) = colpo fisso dell'arma, sempre a segno. INTEGRITÀ (maxHp) = unica difesa.
export const templates = [
  { id:'ghost', callsign:'VEX', role:'GHOST', specialty:'Infiltrazione', color:'#62f4ff', maxHp:95, dmg:11, focus:7, weapon:'Monofilo VX', ability:'Passo fantasma', abilityText:'Colpo netto a un ostile nella tua stanza: 26 danni.' },
  { id:'chrome', callsign:'ROOK', role:'CHROME', specialty:'Assalto pesante', color:'#ffcf4a', maxHp:150, dmg:16, focus:4, weapon:'Mastiff AR', ability:'Sovraccarico cromo', abilityText:'Danno massiccio a un ostile nella tua stanza: 40, il più alto del gioco.' },
  { id:'cipher', callsign:'NYX', role:'CIPHER', specialty:'Guerra di rete', color:'#b895ff', maxHp:80, dmg:7, focus:10, weapon:'Pistola ad arco', ability:'Zero-day', abilityText:'Viola a distanza un nodo nella tua stanza o in una collegata e brucia i droni vicini (25 danni).' },
  { id:'ripper', callsign:'KORA', role:'RIPPER', specialty:'Supporto biotecnico', color:'#7dff9b', maxHp:105, dmg:8, focus:8, weapon:'Needler', ability:'Protocollo Lazarus', abilityText:'Cura e rianima tutti i compagni presenti nella tua stanza.' },
  { id:'face', callsign:'ECHO', role:'FACE', specialty:'Manipolazione', color:'#ff73ca', maxHp:90, dmg:9, focus:9, weapon:'Kestrel silenziata', ability:'Identità sintetica', abilityText:'Abbassa l’allarme di tutto il livello e distrae gli ostili nella tua stanza.' },
  { id:'driver', callsign:'JAX', role:'DRIVER', specialty:'Droni e mobilità', color:'#ff8b4a', maxHp:105, dmg:10, focus:6, weapon:'Vector SMG', ability:'Sciame MANTA', abilityText:'Colpisce due ostili nella tua stanza o in una collegata (18 danni ciascuno).' },
];

// DATABASE PERSONAGGI
// Statistiche dei 6 operativi giocabili. Estratto da server.mjs per rendere le modifiche
// manuali ai numeri più semplici da individuare, senza toccare nessuna meccanica di gioco.
// DANNO (dmg) = colpo fisso dell'arma, sempre a segno. INTEGRITÀ (maxHp) = unica difesa.
export const templates = [
  { id:'ghost', callsign:'VEX', role:'GHOST', specialty:'Infiltrazione', color:'#62f4ff', maxHp:95, dmg:11, focus:7, weapon:'Monofilo VX', ability:'Passo fantasma', abilityText:'Colpo netto a un ostile nella tua stanza: 26 danni.', passives:[
    {id:'last-in-line',name:'Ultimo della fila',text:'Con un compagno nella stanza, gli ostili scelgono altri bersagli prima di te.'},
    {id:'clean-opening',name:'Apertura netta',text:'Il primo attacco contro un ostile non ingaggiato infligge +50% danni.'},
  ] },
  { id:'chrome', callsign:'ROOK', role:'CHROME', specialty:'Assalto pesante', color:'#ffcf4a', maxHp:150, dmg:16, focus:4, weapon:'Mastiff AR', ability:'Sovraccarico cromo', abilityText:'Danno massiccio a un ostile nella tua stanza: 40, il più alto del gioco.', passives:[
    {id:'chrome-plates',name:'Piastre di cromo',text:'Ogni colpo nemico diretto a te infligge metà danni, arrotondati per eccesso.'},
    {id:'big-target',name:'Bersaglio grosso',text:'Se sei nella stanza, gli ostili scelgono te prima degli altri operativi; chi porta un carico resta prioritario.'},
  ] },
  { id:'cipher', callsign:'NYX', role:'CIPHER', specialty:'Guerra di rete', color:'#b895ff', maxHp:80, dmg:7, focus:10, weapon:'Pistola ad arco', ability:'Zero-day', abilityText:'Viola a distanza un nodo nella tua stanza o in una collegata e brucia i droni vicini (25 danni).', passives:[
    {id:'constant-uplink',name:'Uplink costante',text:'A fine round recuperi 2 focus invece di 1.'},
    {id:'last-in-line',name:'Ultimo della fila',text:'Con un compagno nella stanza, gli ostili scelgono altri bersagli prima di te.'},
  ] },
  { id:'ripper', callsign:'KORA', role:'RIPPER', specialty:'Supporto biotecnico', color:'#7dff9b', maxHp:105, dmg:8, focus:8, weapon:'Needler', ability:'Protocollo Lazarus', abilityText:'Cura e rianima tutti i compagni presenti nella tua stanza.', passives:[
    {id:'last-plate',name:'Ultima piastra',text:'La prima volta per round che un colpo ti porterebbe a 0, resti a 1 integrità.'},
    {id:'constant-uplink',name:'Uplink costante',text:'A fine round recuperi 2 focus invece di 1.'},
  ] },
  { id:'face', callsign:'ECHO', role:'FACE', specialty:'Manipolazione', color:'#ff73ca', maxHp:90, dmg:9, focus:9, weapon:'Kestrel silenziata', ability:'Identità sintetica', abilityText:'Abbassa l’allarme di tutto il livello e distrae gli ostili nella tua stanza.', passives:[
    {id:'last-plate',name:'Ultima piastra',text:'La prima volta per round che un colpo ti porterebbe a 0, resti a 1 integrità.'},
    {id:'clean-opening',name:'Apertura netta',text:'Il primo attacco contro un ostile non ingaggiato infligge +50% danni.'},
  ] },
  { id:'driver', callsign:'JAX', role:'DRIVER', specialty:'Droni e mobilità', color:'#ff8b4a', maxHp:105, dmg:10, focus:6, weapon:'Vector SMG', ability:'Sciame MANTA', abilityText:'Colpisce due ostili nella tua stanza o in una collegata (18 danni ciascuno).', passives:[
    {id:'accelerator',name:'Piede sull’acceleratore',text:'Puoi fare 2 manovre nel turno, se entrambe le porte sono aperte.'},
    {id:'clean-opening',name:'Apertura netta',text:'Il primo attacco contro un ostile non ingaggiato infligge +50% danni.'},
  ] },
];

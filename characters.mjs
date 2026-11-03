// DATABASE PERSONAGGI
// Statistiche degli 8 operativi giocabili. Estratto da server.mjs per rendere le modifiche
// manuali ai numeri più semplici da individuare, senza toccare nessuna meccanica di gioco.
// DANNO (dmg) = colpo fisso dell'arma, sempre a segno. INTEGRITÀ (maxHp) = unica difesa.
// CARICATORE (mag) = munizioni disponibili: ogni azione FUOCO ne consuma 1, l'azione RICARICA
//   (costa un'azione) lo riporta al massimo. Valori tarati larghi: la meccanica è poco punitiva.
export const templates = [
  { id:'ghost', callsign:'VEX', role:'GHOST', specialty:'Infiltrazione', color:'#62f4ff', maxHp:95, dmg:11, mag:14, focus:8, weapon:'Monofilo VX', ability:'Passo fantasma', abilityText:'Colpo netto a un ostile nella tua stanza: 26 danni.', passives:[
    {id:'master-lockpick',name:'Scassinatore esperto',text:'L’azione SBLOCCA PORTA non consuma un’azione del turno.'},
    {id:'silent-step',name:'Senza traccia',text:'Se nel tuo turno non hai attaccato né usato l’abilità, chiuderlo non fa salire l’allarme.'},
  ] },
  { id:'chrome', callsign:'ROOK', role:'CHROME', specialty:'Assalto pesante', color:'#ffcf4a', maxHp:140, dmg:12, mag:20, focus:5, weapon:'Mastiff AR', ability:'Sovraccarico cromo', abilityText:'Danno massiccio a un ostile nella tua stanza: 40, il più alto del gioco.', passives:[
    {id:'chrome-plates',name:'Piastre di cromo',text:'Ogni colpo nemico diretto a te infligge metà danni, arrotondati per eccesso.'},
    {id:'last-plate',name:'Ultima piastra',text:'Quando un colpo ti porterebbe a 0 resti a 1 integrità. Poi si ricarica in 3 turni chiusi (di chiunque).'},
  ] },
  { id:'cipher', callsign:'NYX', role:'CIPHER', specialty:'Guerra di rete', color:'#b895ff', maxHp:80, dmg:11, mag:12, focus:11, weapon:'Pistola ad arco', ability:'Zero-day', abilityText:'Viola a distanza un nodo nella tua stanza o in una collegata e brucia i droni vicini (25 danni).', passives:[
    {id:'constant-uplink',name:'Uplink costante',text:'A fine del tuo turno recuperi 2 focus invece di 1.'},
    {id:'clean-opening',name:'Apertura netta',text:'Il primo attacco contro un ostile non ingaggiato infligge +50% danni.'},
  ] },
  { id:'ripper', callsign:'KORA', role:'RIPPER', specialty:'Supporto biotecnico', color:'#7dff9b', maxHp:105, dmg:8, mag:14, focus:9, weapon:'Needler', ability:'Protocollo Lazarus', abilityText:'Cura (+22) o rianima (al 40%) fino a 2 operativi nella tua stanza, te compreso: prima i caduti, poi i più feriti.', passives:[
    {id:'quick-rebound',name:'Rientro rapido',text:'Se vai a terra ti rialzi da solo dopo 1 turno saltato invece di 3, al 25% dell’integrità.'},
    {id:'constant-uplink',name:'Uplink costante',text:'A fine del tuo turno recuperi 2 focus invece di 1.'},
  ] },
  { id:'face', callsign:'ECHO', role:'FACE', specialty:'Manipolazione', color:'#ffffff', maxHp:90, dmg:9, mag:14, focus:10, weapon:'Kestrel silenziata', ability:'Identità sintetica', abilityText:'Abbassa l’allarme di tutto il livello e distrae gli ostili nella tua stanza.', passives:[
    {id:'silent-step',name:'Senza traccia',text:'Se nel tuo turno non hai attaccato né usato l’abilità, chiuderlo non fa salire l’allarme.'},
    {id:'clean-opening',name:'Apertura netta',text:'Il primo attacco contro un ostile non ingaggiato infligge +50% danni.'},
  ] },
  { id:'driver', callsign:'JAX', role:'DRIVER', specialty:'Droni e mobilità', color:'#ff8b4a', maxHp:105, dmg:10, mag:20, focus:7, weapon:'Vector SMG', ability:'Sciame MANTA', abilityText:'Colpisce due ostili nella tua stanza o in una collegata (18 danni ciascuno).', passives:[
    {id:'accelerator',name:'Piede sull’acceleratore',text:'La prima manovra del turno non consuma azioni.'},
    {id:'clean-opening',name:'Apertura netta',text:'Il primo attacco contro un ostile non ingaggiato infligge +50% danni.'},
  ] },
  { id:'breacher', callsign:'MAKO', role:'BREACHER', specialty:'Demolizioni', color:'#ff5c7a', maxHp:120, dmg:9, mag:12, focus:6, weapon:'Ram-12 a pompa', ability:'Carica da breccia', abilityText:'Fa esplodere la stanza: 20 danni a tutti gli ostili presenti e apre ogni porta bloccata.', passives:[
    {id:'last-plate',name:'Ultima piastra',text:'Quando un colpo ti porterebbe a 0 resti a 1 integrità. Poi si ricarica in 3 turni chiusi (di chiunque).'},
    {id:'killing-blow',name:'Colpo di grazia',text:'La prima volta nel turno che elimini un ostile, recuperi l’azione appena usata.'},
  ] },
  { id:'handler', callsign:'SOL', role:'HANDLER', specialty:'Coordinamento', color:'#4a8bff', maxHp:90, dmg:8, mag:14, focus:10, weapon:'Carabina a impulsi', ability:'Impulso di squadra', abilityText:'Ricarica +4 focus a fino a 2 compagni in piedi nella tua stanza: prima chi ne ha meno.', passives:[
    {id:'constant-uplink',name:'Uplink costante',text:'A fine del tuo turno recuperi 2 focus invece di 1.'},
    {id:'accelerator',name:'Piede sull’acceleratore',text:'La prima manovra del turno non consuma azioni.'},
  ] },
];

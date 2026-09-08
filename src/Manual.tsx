import { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, Crosshair, Cpu, DoorOpen, Footprints, HeartPulse, Lightbulb,
  LifeBuoy, Map, Radio, Shield, ShieldAlert, Skull, Smartphone, Swords, Target,
  Timer, Trophy, Users, X, Zap,
} from 'lucide-react';

type Stats = { corpo:number; riflessi:number; mente:number; presenza:number };
type Template = { id:string; callsign:string; role:string; specialty:string; color:string; stats:Stats; maxHp:number; armor:number; focus:number; weapon:string; ability:string; abilityText:string };

// Le schede personaggio arrivano dal server: se il manuale viene aperto prima del
// caricamento dell'archivio, il capitolo mostra comunque il resto della guida.
const roleTips:Record<string,string>={
  ghost:'Colpisce forte senza far salire l’allarme: ideale nei round in cui la rete è già rovente.',
  chrome:'Il muro della squadra. Regge i colpi e apre i nemici corazzati, ma alza l’allarme quando spinge.',
  cipher:'Il vero motore della missione: viola i nodi al doppio della velocità e ripulisce i droni.',
  ripper:'Tiene in piedi tutti. Il Protocollo Lazarus può ribaltare un round disastroso.',
  face:'Controlla l’allarme. In BRUTALE è spesso la differenza fra vittoria e lockdown.',
  driver:'Danno diffuso su due bersagli: perfetto quando arrivano i rinforzi.',
};

function Chip({children}:{children:React.ReactNode}){ return <span className="manual-chip">{children}</span>; }

export const chapterList=(templates:Template[])=>[
  {
    id:'come-si-gioca', label:'COME SI GIOCA', icon:<BookOpen size={15}/>,
    content:<>
      <h2>Come si gioca</h2>
      <p><b>ROVERPUNK</b> è un gioco cooperativo cyberpunk per <b>2–6 giocatori</b>. Un computer fa da <b>plancia</b> (la mappa, i nemici, il diario della missione) e ogni giocatore usa il proprio <b>telefono</b> come console personale.</p>
      <p>Non c’è un master umano: il computer è il <b>GM autonomo</b>. Gestisce turni, nemici, allarme, danni e risoluzione delle azioni. Voi dovete solo decidere cosa fare, round dopo round.</p>
      <h3>Obiettivo</h3>
      <p>Infiltrarsi nella <b>Helix Tower</b>, attraversare fisicamente le nove stanze del livello 27, violare i <b>tre nodi</b> della rete di sicurezza, neutralizzare il <b>Custode K-9</b> e riportare tutti gli operativi vivi alla stanza <b>A01 // ACCESSO</b>. Il tutto prima che l’allarme raggiunga il 100%.</p>
      <div className="manual-callout"><Map size={16}/><p>La plancia è una <b>mappa a stanze</b>: ogni operativo occupa una casella precisa e si combatte solo con chi condivide la stessa stanza. Dove vi muovete conta quanto cosa fate.</p></div>
      <h3>Il flusso di una partita</h3>
      <ol className="manual-steps">
        <li><b>Configurazione</b> — sulla plancia scegli quanti siete, il livello di minaccia e assegna un personaggio a ciascun giocatore.</li>
        <li><b>Collegamento</b> — ogni telefono apre l’indirizzo di rete mostrato dalla lobby e inserisce il codice partita.</li>
        <li><b>Operazione</b> — si gioca a round: tutti scelgono un’azione, il computer la risolve, i nemici rispondono.</li>
        <li><b>Esito</b> — vittoria o sconfitta vengono dichiarate automaticamente dalla plancia.</li>
      </ol>
      <div className="manual-callout"><AlertTriangle size={16}/><p>Una partita dura tipicamente <b>20–35 minuti</b>. Non serve carta, dadi o schede: tutto è sullo schermo.</p></div>
    </>,
  },
  {
    id:'preparazione', label:'PREPARAZIONE', icon:<Smartphone size={15}/>,
    content:<>
      <h2>Preparazione e collegamento</h2>
      <h3>1. Cosa serve</h3>
      <ul>
        <li>Un computer collegato a un monitor o TV: è la <b>plancia</b>, visibile a tutti.</li>
        <li>Un telefono per giocatore (da 2 a 6).</li>
        <li><b>Tutti sulla stessa rete Wi-Fi.</b> È l’unico requisito tecnico davvero obbligatorio.</li>
      </ul>
      <h3>2. Sulla plancia</h3>
      <ol className="manual-steps">
        <li>Scegli il <b>numero di operativi</b> (2–6).</li>
        <li>Scegli il <b>livello di minaccia</b>: RECLUTA, STANDARD o BRUTALE.</li>
        <li>Per ogni slot, scrivi il <b>nome del giocatore</b> e scegli la sua <b>scheda personaggio</b>. Ogni personaggio può essere assegnato una volta sola.</li>
        <li>Premi <b>CREA CANALE DI GIOCO</b>.</li>
      </ol>
      <h3>3. Sui telefoni</h3>
      <ol className="manual-steps">
        <li>Apri il browser sull’indirizzo mostrato dalla lobby (es. <code>http://192.168.1.20:5173</code>).</li>
        <li>Inserisci il <b>codice partita</b> (es. NEON-77).</li>
        <li>Tocca il tuo operativo nell’elenco. Se è grigio significa che è già occupato da un altro telefono.</li>
        <li><b>Ruota il telefono in orizzontale</b>: la console richiede lo schermo largo.</li>
      </ol>
      <h3>4. Via</h3>
      <p>Il pulsante <b>AVVIA OPERAZIONE</b> resta bloccato finché non è collegato almeno un telefono. Quando la squadra è pronta, premilo dalla plancia.</p>
      <div className="manual-callout"><Radio size={16}/><p>La partita viene salvata in locale: se il server si riavvia, i telefoni si ricollegano da soli senza perdere il progresso.</p></div>
    </>,
  },
  {
    id:'personaggi', label:'I PERSONAGGI', icon:<Users size={15}/>,
    content:<>
      <h2>I personaggi</h2>
      <p>Sei operativi, sei ruoli. Ognuno ha statistiche, arma e una <b>abilità esclusiva</b> che costa 3 FOCUS. Non esistono ruoli inutili: una squadra tutta d’assalto perde per allarme, una squadra tutta hacker viene fatta a pezzi.</p>
      {templates.length?<div className="manual-cards">{templates.map((t)=><article className="manual-char" style={{'--accent':t.color} as React.CSSProperties} key={t.id}>
        <header><span className="manual-avatar">{t.callsign[0]}</span><div><b>{t.callsign}</b><small>{t.role} // {t.specialty}</small></div></header>
        <div className="manual-statline">{Object.entries(t.stats).map(([k,v])=><span key={k}><i>{k.slice(0,3).toUpperCase()}</i><b>{v}</b></span>)}</div>
        <div className="manual-statline alt"><span><i>INTEGRITÀ</i><b>{t.maxHp}</b></span><span><i>CORAZZA</i><b>{t.armor}</b></span><span><i>FOCUS</i><b>{t.focus}</b></span></div>
        <p className="manual-weapon"><Crosshair size={12}/> {t.weapon}</p>
        <p className="manual-ability"><Zap size={12}/> <b>{t.ability}</b> — {t.abilityText}</p>
        <p className="manual-tip">{roleTips[t.id]}</p>
      </article>)}</div>:<p className="manual-muted">Archivio operativi non ancora caricato.</p>}
      <h3>Chi scegliere se siete in pochi</h3>
      <ul>
        <li><b>In 3:</b> almeno un CIPHER (per i nodi) e un RIPPER o CHROME (per reggere i colpi).</li>
        <li><b>In 4–5:</b> aggiungi un FACE se giocate in BRUTALE, l’allarme sarà il vostro vero nemico.</li>
        <li><b>In 6:</b> squadra completa. Attenzione: i nemici scalano con il numero di giocatori, non sarà più facile.</li>
      </ul>
    </>,
  },
  {
    id:'statistiche', label:'STATISTICHE', icon:<Activity size={15}/>,
    content:<>
      <h2>Statistiche e valori</h2>
      <h3>Le quattro caratteristiche</h3>
      <ul>
        <li><b>CORPO</b> — resistenza fisica. Migliora lo scudo ottenuto in COPERTURA e il danno del Sovraccarico cromo.</li>
        <li><b>RIFLESSI</b> — velocità. Aumenta il danno di FUOCO e determina <b>l’ordine di risoluzione</b>: chi ha più riflessi agisce prima.</li>
        <li><b>MENTE</b> — capacità di rete. Aumenta l’efficacia di INTRUSIONE (nodi e allarme) e la quantità di cura di RIPRISTINO.</li>
        <li><b>PRESENZA</b> — carisma e inganno. È la firma dei ruoli sociali come il FACE.</li>
      </ul>
      <h3>I valori operativi</h3>
      <ul>
        <li><b>INTEGRITÀ (HP)</b> — la tua vita. A zero vai <b>fuori combattimento</b>, ma non sei eliminato: un compagno può rianimarti.</li>
        <li><b>CORAZZA</b> — sottratta a ogni danno subito. Un colpo non fa mai meno di <b>1</b> danno.</li>
        <li><b>FOCUS</b> — la risorsa delle azioni speciali. Costa <b>3</b> per l’ABILITÀ e <b>2</b> per RIPRISTINO. Recuperi <b>+1 FOCUS a fine round</b>.</li>
        <li><b>SCUDO</b> — protezione temporanea data da COPERTURA. Assorbe i danni prima della corazza e cala di <b>3 punti a fine round</b>.</li>
        <li><b>STRESS</b> — sale quando vieni colpito. È l’indicatore della pressione psicologica: le cure lo riducono.</li>
      </ul>
      <div className="manual-callout"><Shield size={16}/><p>Formula del danno subito: <Chip>(danno nemico − scudo − corazza) × moltiplicatore difficoltà</Chip>, con minimo 1.</p></div>
    </>,
  },
  {
    id:'meccaniche', label:'MECCANICHE DI GIOCO', icon:<Timer size={15}/>,
    content:<>
      <h2>Meccaniche di gioco</h2>
      <h3>Il round</h3>
      <p>La partita procede a <b>round simultanei</b>. In ogni round:</p>
      <ol className="manual-steps">
        <li>Ogni giocatore vivo sceglie <b>una</b> azione sul proprio telefono e la trasmette. Non si può cambiare idea.</li>
        <li>Quando tutti hanno trasmesso — o quando scade il tempo — il computer <b>risolve il round</b>.</li>
        <li><b>Fase 1 — MANOVRA:</b> si risolvono per prime tutte le manovre. Chi si è mosso combatte già dalla stanza nuova.</li>
        <li><b>Fase 2 — AZIONI:</b> tutto il resto si risolve <b>in ordine di RIFLESSI</b>, dal più alto al più basso, e sempre solo dentro la stanza occupata.</li>
        <li><b>Fase 3 — RISPOSTA HELIX:</b> rispondono i nemici vivi. Colpiscono solo chi è nella loro stessa stanza; gli altri avanzano o pattugliano.</li>
        <li>Si aggiornano allarme, scudi e focus; parte il round successivo.</li>
      </ol>
      <h3>Il tempo</h3>
      <ul>
        <li>Ogni round ha un tempo massimo: <b>90s</b> in RECLUTA, <b>75s</b> in STANDARD, <b>60s</b> in BRUTALE.</li>
        <li>Chi non trasmette entro il tempo va automaticamente in <b>COPERTURA</b>. La partita non si blocca mai.</li>
        <li>Se un telefono va in standby o si allontana, la squadra lo aspetta comunque per <b>45 secondi</b>.</li>
        <li>Se <b>nessun telefono</b> è collegato il timer si ferma: la partita va in pausa invece di proseguire da sola.</li>
      </ul>
      <h3>Controlli dalla plancia</h3>
      <ul>
        <li><b>CHIUDI ROUND</b> — forza subito la risoluzione, senza aspettare i ritardatari.</li>
        <li><b>TERMINA</b> — chiude la partita e torna alla configurazione.</li>
      </ul>
      <h3>Fuori combattimento</h3>
      <p>Un operativo a <b>0 integrità</b> non gioca più i round, ma <b>non è morto</b>. Torna in piedi con:</p>
      <ul>
        <li><b>RIPRISTINO</b> di un compagno → rientra al <b>35%</b> della sua integrità massima.</li>
        <li><b>Protocollo Lazarus</b> del RIPPER → rientra al <b>50%</b>.</li>
      </ul>
      <div className="manual-callout"><Users size={16}/><p>La difficoltà scala col numero di giocatori: i nemici hanno <b>+34% integrità</b> e <b>+12% danno</b> per ogni giocatore oltre il terzo. Giocare in 6 non è una scorciatoia.</p></div>
    </>,
  },
  {
    id:'plancia', label:'LA PLANCIA', icon:<Map size={15}/>,
    content:<>
      <h2>La plancia a stanze</h2>
      <p>Il livello 27 della Helix Tower è una <b>griglia di nove stanze</b> collegate da corridoi. Ogni operativo e ogni ostile occupa <b>una stanza precisa</b>, visibile in tempo reale sulla plancia: le pedine colorate sono la squadra, quelle rosse gli Helix.</p>
      <p>La regola che cambia tutto: <b>si interagisce solo dentro la propria stanza</b>. Non puoi sparare a un nemico che sta due porte più in là, e lui non può sparare a te.</p>
      <h3>Le nove stanze</h3>
      <table className="manual-table">
        <thead><tr><th>Stanza</th><th>Collegata a</th><th>Cosa contiene</th></tr></thead>
        <tbody>
          <tr><td><b>A01 · ACCESSO</b></td><td>A02 · C02 · A03</td><td>Punto di partenza e <b>zona di estrazione</b>.</td></tr>
          <tr><td><b>A02 · CONDOTTI</b></td><td>A01 · B07</td><td>Copertura: la COPERTURA qui vale <b>+6 scudo</b>.</td></tr>
          <tr><td><b>A03 · GARAGE</b></td><td>A01 · B04</td><td>Copertura.</td></tr>
          <tr><td><b>B07 · SERVER FARM</b></td><td>A02 · C02 · D03</td><td><b>Nodo di rete</b> da violare.</td></tr>
          <tr><td><b>C02 · NEXUS</b></td><td>A01 · B07 · B04 · C09</td><td>Snodo centrale ma <b>zona esposta</b>: chi ci resta a fine round alza l’allarme.</td></tr>
          <tr><td><b>B04 · ARCHIVIO</b></td><td>A03 · C02 · E05</td><td><b>Nodo di rete</b> da violare.</td></tr>
          <tr><td><b>D03 · SICUREZZA</b></td><td>B07 · C09</td><td><b>Nodo di rete</b> da violare.</td></tr>
          <tr><td><b>C09 · LAB NERO</b></td><td>C02 · D03 · E05</td><td>Tana del <b>Custode K-9</b> e obiettivo finale.</td></tr>
          <tr><td><b>E05 · PONTE</b></td><td>B04 · C09</td><td>Copertura. Da qui entrano i rinforzi al round 6.</td></tr>
        </tbody>
      </table>
      <h3>Muoversi</h3>
      <ul>
        <li>La <b>MANOVRA</b> è un’azione come le altre: se ti sposti, quel round non spari e non violi nodi.</li>
        <li>Puoi entrare solo in una stanza <b>collegata</b> a quella che occupi: una porta per round, niente scorciatoie.</li>
        <li><b>Sganciarsi costa.</b> Se lasci una stanza con ostili dentro, subisci metà del loro danno e l’allarme sale di 3.</li>
        <li>Le manovre si risolvono <b>prima</b> di tutto il resto: chi entra in una stanza può essere colpito lì nello stesso round.</li>
      </ul>
      <div className="manual-callout"><Footprints size={16}/><p>Due stanze di distanza sono <b>due round persi</b>. Decidete presto chi va a quale nodo: la squadra che si divide bene vince, quella che si muove tutta insieme resta indietro sull’allarme.</p></div>
      <h3>Cosa vedi sulla plancia</h3>
      <ul>
        <li><b>Riquadro ciano</b> — la tua posizione attuale (sul telefono).</li>
        <li><b>Riquadro rosso</b> — stanza con ostili dentro.</li>
        <li><b>Riquadro verde acido</b> — stanza raggiungibile con una manovra.</li>
        <li><b>Etichette</b> — NODO ATTIVO / VIOLATO, OBIETTIVO, ESTRAZIONE, COPERTURA, ZONA ESPOSTA.</li>
      </ul>
    </>,
  },
  {
    id:'azioni', label:'LE AZIONI', icon:<Swords size={15}/>,
    content:<>
      <h2>Le sei azioni</h2>
      <p>Ogni round scegli <b>una sola</b> di queste. Quasi tutte funzionano <b>solo dentro la stanza che occupi</b>: la console blocca da sola i pulsanti che in quel momento non hanno senso e ti dice perché.</p>
      <div className="manual-actions">
        <article><span><Footprints size={19}/></span><div><b>00 · MANOVRA</b><small>Costo: gratis · esclude ogni altra azione</small><p>Ti sposti in una stanza <b>collegata</b> alla tua. Tocca la stanza sulla mappa del telefono. Se lasci una stanza presidiata subisci <b>metà del danno</b> dell’ostile e l’allarme sale di <b>3</b>.</p></div></article>
        <article><span><Swords size={19}/></span><div><b>01 · FUOCO</b><small>Costo: gratis · serve un ostile nella tua stanza</small><p>Attacchi un bersaglio <b>presente dove sei tu</b>. Danno = <Chip>12 + RIFLESSI + 0–7 casuale</Chip>, meno la corazza del nemico.</p></div></article>
        <article><span><Cpu size={19}/></span><div><b>02 · INTRUSIONE</b><small>Costo: gratis · serve un nodo nella tua stanza</small><p>Violi il nodo di <b>questa</b> stanza: <b>+1 breccia</b> (max 3) e <b>allarme −(5 + MENTE)</b>. Colpisce anche un drone presente per <Chip>8 + MENTE</Chip>. I nodi sono in B07, B04 e D03: bisogna andarci fisicamente.</p></div></article>
        <article><span><Shield size={19}/></span><div><b>03 · COPERTURA</b><small>Costo: gratis</small><p>Ti riparti: scudo pari a <Chip>10 + metà del CORPO</Chip>, <b>+6</b> se sei in una stanza di copertura (A02, A03, E05). Lo scudo residuo cala di 3 a fine round.</p></div></article>
        <article><span><HeartPulse size={19}/></span><div><b>04 · RIPRISTINO</b><small>Costo: 2 FOCUS · agisce solo nella tua stanza</small><p>Se c’è un compagno a terra <b>nella tua stanza</b>, lo <b>rianima</b> al 35%. Altrimenti cura il compagno più ferito <b>presente lì con te</b> di <Chip>12 + MENTE</Chip>. Non si cura a distanza.</p></div></article>
        <article><span><Zap size={19}/></span><div><b>05 · ABILITÀ</b><small>Costo: 3 FOCUS</small><p>La mossa esclusiva del tuo personaggio, con la sua portata. Vedi il capitolo <b>ABILITÀ</b>.</p></div></article>
      </div>
      <h3>Scegliere il bersaglio</h3>
      <p>Il menu <b>BERSAGLIO</b> elenca solo gli ostili <b>presenti nella tua stanza</b>. Se sei in una stanza vuota il menu è spento e FUOCO è bloccato: prima devi raggiungerli.</p>
      <div className="manual-callout"><DoorOpen size={16}/><p>Un compagno a terra può essere rianimato <b>solo da chi si trova nella sua stessa stanza</b>. Se cade da solo dietro le linee, qualcuno deve andarlo a prendere.</p></div>
      <div className="manual-callout"><Target size={16}/><p>Il round si chiude appena <b>tutti</b> hanno trasmesso: se sai già cosa fare, trasmetti subito. La squadra guadagna tempo reale.</p></div>
    </>,
  },
  {
    id:'abilita', label:'ABILITÀ ESCLUSIVE', icon:<Zap size={15}/>,
    content:<>
      <h2>Abilità esclusive</h2>
      <p>Ogni abilità costa <b>3 FOCUS</b> e recuperi 1 FOCUS per round: aspettati di poterla usare circa <b>ogni tre round</b>. Sceglierne il momento è la decisione più importante della partita.</p>
      <table className="manual-table">
        <thead><tr><th>Ruolo</th><th>Abilità</th><th>Effetto esatto</th></tr></thead>
        <tbody>
          <tr><td>GHOST</td><td>Passo fantasma</td><td>Danno <Chip>20 + RIFLESSI</Chip> a un ostile <b>nella tua stanza</b> e <b>+8 scudo</b>. Non alza l’allarme.</td></tr>
          <tr><td>CHROME</td><td>Sovraccarico cromo</td><td>Danno <Chip>29 + CORPO</Chip> a un ostile <b>nella tua stanza</b>, il più alto del gioco, ma <b>allarme +9</b>.</td></tr>
          <tr><td>CIPHER</td><td>Zero-day</td><td><b>+1 breccia</b> su un nodo nella tua stanza <b>o in una adiacente</b>, e 25 danni ai droni nel raggio. L’unica azione a distanza del gioco.</td></tr>
          <tr><td>RIPPER</td><td>Protocollo Lazarus</td><td><b>+15 integrità</b> e rianimazione al 50% per tutti i compagni <b>presenti nella sua stanza</b>.</td></tr>
          <tr><td>FACE</td><td>Identità sintetica</td><td><b>Allarme −18</b> su tutto il livello e gli ostili <b>della sua stanza</b> saltano il turno.</td></tr>
          <tr><td>DRIVER</td><td>Sciame MANTA</td><td>Danno <Chip>18 + RIFLESSI</Chip> a <b>due ostili</b> nella sua stanza o in una adiacente.</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><Zap size={16}/><p>Il <b>CIPHER</b> è l’unico che può violare un nodo <b>senza entrare nella stanza</b>: piazzalo nel corridoio giusto e viola due nodi da posizioni diverse mentre il resto della squadra tiene occupati gli Helix.</p></div>
      <div className="manual-callout"><HeartPulse size={16}/><p>Il <b>Protocollo Lazarus</b> non attraversa i muri: se la squadra è sparpagliata cura una persona sola. Il RIPPER rende al massimo quando il gruppo si ricompatta.</p></div>
    </>,
  },
  {
    id:'nemici', label:'NEMICI E MINACCE', icon:<Skull size={15}/>,
    content:<>
      <h2>Nemici e minacce</h2>
      <p>I nemici non tirano dadi: colpiscono sempre, ma <b>solo chi si trova nella loro stessa stanza</b>. Fuori contatto non fanno danno: la distanza è una difesa reale.</p>
      <h3>Rilevamento e pattuglia</h3>
      <p>Ogni round un ostile senza bersagli nella propria stanza guarda quanto siete lontani, contando i <b>corridoi</b> da attraversare:</p>
      <ul>
        <li><b>Vi rileva</b> se siete entro il suo raggio: <b>1 corridoio</b> con allarme sotto 45%, <b>2</b> da 45%, <b>3</b> da 75%. Allora vi <b>insegue</b>, una stanza per round.</li>
        <li><b>Non vi rileva</b> → perde le tracce e <b>rientra in pattuglia</b> verso la sua zona di partenza.</li>
        <li>Il <b>Custode K-9</b> non lascia mai il LAB NERO finché la breccia è sotto 3/3. Appena arriva a 3, si sgancia e vi dà la caccia ovunque siate.</li>
      </ul>
      <p>Sulla plancia il pannello MINACCE dice per ognuno se è <b>IN PATTUGLIA</b>, <b>IN CACCIA</b> o <b>IN CONTATTO CON LA SQUADRA</b>.</p>
      <div className="manual-callout"><Map size={16}/><p>Tenere l’allarme basso non serve solo a non perdere: <b>restringe la vista dei nemici</b>. Con l’allarme sotto il 45% potete passare a due stanze di distanza senza essere visti.</p></div>
      <h3>Chi colpiscono</h3>
      <p>Quando sono in contatto scelgono un bersaglio fra i presenti seguendo uno schema legato al proprio livello di minaccia: <b>non si può prevedere chi verrà colpito, ma chi resta nella stanza prima o poi lo sarà</b>.</p>
      <table className="manual-table">
        <thead><tr><th>Unità</th><th>Tipo</th><th>Integrità</th><th>Corazza</th><th>Danno</th></tr></thead>
        <tbody>
          <tr><td>CUSTODE K-9</td><td>ÉLITE</td><td>145</td><td>7</td><td>18</td></tr>
          <tr><td>HELIX SEC-4</td><td>FANTERIA</td><td>72</td><td>4</td><td>13</td></tr>
          <tr><td>WASP D-2</td><td>DRONE</td><td>54</td><td>2</td><td>11</td></tr>
          <tr><td>HELIX RAZOR</td><td>RINFORZO</td><td>62</td><td>3</td><td>14</td></tr>
        </tbody>
      </table>
      <p className="manual-muted">Valori base in 3 giocatori. Con più giocatori integrità e danno salgono proporzionalmente.</p>
      <h3>Eventi programmati</h3>
      <ul>
        <li><b>Round 4 — PORTE IN BLOCCO:</b> i corridoi verso il NEXUS finiscono sotto sorveglianza.</li>
        <li><b>Round 6 — RINFORZI:</b> una nuova unità <b>HELIX RAZOR</b> entra dal <b>PONTE E05</b> e pattuglia quel settore.</li>
        <li><b>Breccia 3/3 — CUSTODE SGANCIATO:</b> il K-9 abbandona il LAB NERO e insegue la squadra ovunque.</li>
      </ul>
      <div className="manual-callout"><Skull size={16}/><p>Il <b>Custode K-9</b> ha corazza 7: gli attacchi deboli quasi non lo scalfiscono. Concentrateci sopra il CHROME e le abilità, e lasciate i droni al CIPHER.</p></div>
    </>,
  },
  {
    id:'allarme', label:'ALLARME E BRECCIA', icon:<ShieldAlert size={15}/>,
    content:<>
      <h2>Allarme e breccia</h2>
      <h3>La breccia (0 → 3)</h3>
      <p>È l’obiettivo primario. Sale di 1 con ogni <b>INTRUSIONE</b> riuscita e con lo <b>Zero-day</b> del CIPHER. Arrivati a 3, la cifratura del Lab Nero cade e potete completare la missione.</p>
      <h3>L’allarme (0% → 100%)</h3>
      <p>Parte da <b>18%</b> e rappresenta quanto la Helix sa di voi. <b>A 100% avete perso</b>, anche se siete tutti in piedi.</p>
      <table className="manual-table">
        <thead><tr><th>Cosa lo fa salire</th><th>Cosa lo fa scendere</th></tr></thead>
        <tbody>
          <tr><td>Pressione base per round: <b>+2</b> (recluta), <b>+4</b> (standard), <b>+7</b> (brutale)</td><td>INTRUSIONE: <Chip>−(5 + MENTE)</Chip></td></tr>
          <tr><td><b>+1</b> per ogni nemico ancora vivo, ogni round</td><td>Identità sintetica del FACE: <b>−18</b></td></tr>
          <tr><td><b>+1</b> per ogni operativo fermo nel <b>NEXUS C02</b> a fine round</td><td>—</td></tr>
          <tr><td>Sganciarsi da una stanza presidiata: <b>+3</b></td><td>—</td></tr>
          <tr><td>Sovraccarico cromo del CHROME: <b>+9</b></td><td>—</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><AlertTriangle size={16}/><p>Lasciare nemici vivi costa allarme ogni singolo round. Finire i bersagli feriti è quasi sempre meglio che spargere danni.</p></div>
    </>,
  },
  {
    id:'difficolta', label:'DIFFICOLTÀ', icon:<Crosshair size={15}/>,
    content:<>
      <h2>Livelli di minaccia</h2>
      <table className="manual-table">
        <thead><tr><th>Livello</th><th>Tempo round</th><th>Danno subito</th><th>Allarme per round</th></tr></thead>
        <tbody>
          <tr><td><b>RECLUTA</b></td><td>90 secondi</td><td>×0,75</td><td>+2</td></tr>
          <tr><td><b>STANDARD</b></td><td>75 secondi</td><td>×1</td><td>+4</td></tr>
          <tr><td><b>BRUTALE</b></td><td>60 secondi</td><td>×1,3</td><td>+7</td></tr>
        </tbody>
      </table>
      <ul>
        <li><b>RECLUTA</b> — per il primo tavolo o per gruppi che non hanno mai giocato di ruolo. C’è margine per sbagliare due o tre round.</li>
        <li><b>STANDARD</b> — l’esperienza pensata dal gioco: letale ma giusta, si vince coordinandosi.</li>
        <li><b>BRUTALE</b> — meno tempo per decidere, colpi più duri e allarme che corre. Senza un FACE o senza INTRUSIONE costante si perde per lockdown, non per ferite.</li>
      </ul>
      <div className="manual-callout"><Timer size={16}/><p>Il livello di minaccia si sceglie solo in configurazione e non può essere cambiato a partita avviata.</p></div>
    </>,
  },
  {
    id:'esito', label:'VITTORIA E SCONFITTA', icon:<Trophy size={15}/>,
    content:<>
      <h2>Come finisce la partita</h2>
      <h3>Vittoria</h3>
      <p>Servono <b>tutte e tre</b> le condizioni, nello stesso momento:</p>
      <ul>
        <li><b>Breccia 3 / 3</b> — i nodi di B07, B04 e D03 sono violati, raggiungendoli di persona.</li>
        <li><b>Custode K-9 neutralizzato</b> — l’unità élite è a zero integrità.</li>
        <li><b>Estrazione</b> — <b>ogni operativo ancora vivo si trova in A01 // ACCESSO</b> alla fine del round.</li>
      </ul>
      <p>La missione ha quindi tre fasi, e la plancia ti dice sempre quale stai giocando: <b>FASE 1 // RETE</b>, <b>FASE 2 // CUSTODE</b>, <b>FASE 3 // ESTRAZIONE</b>.</p>
      <p>Solo allora la plancia dichiara <b>MNEMOSYNE È NOSTRO</b>.</p>
      <h3>Sconfitta</h3>
      <p>Basta <b>una</b> di queste:</p>
      <ul>
        <li><b>Tutta la squadra fuori combattimento</b> nello stesso round: non resta nessuno per rianimare.</li>
        <li><b>Allarme al 100%</b>: la torre entra in lockdown e il segnale clandestino è perduto.</li>
      </ul>
      <div className="manual-callout"><Trophy size={16}/><p>Errore classico: abbattere il K-9 con la breccia a 2/3 e poi perdere per allarme mentre si viola l’ultimo nodo. <b>Portate avanti la breccia fin dal primo round.</b></p></div>
      <div className="manual-callout"><DoorOpen size={16}/><p>Secondo errore classico: vincere il combattimento nel LAB NERO e finire l’allarme durante il rientro. Dal LAB NERO all’ACCESSO ci sono <b>due corridoi</b>: mettili in conto <b>prima</b> di ingaggiare il Custode.</p></div>
    </>,
  },
  {
    id:'tattiche', label:'CONSIGLI TATTICI', icon:<Lightbulb size={15}/>,
    content:<>
      <h2>Consigli tattici</h2>
      <h3>Per la squadra</h3>
      <ul>
        <li><b>Assegnate i nodi al primo round.</b> B07, B04 e D03 sono in tre angoli diversi: chi parte adesso arriva due round prima.</li>
        <li><b>Parlate ad alta voce.</b> Il gioco è simultaneo: se non annunciate le manovre, vi ritroverete tutti nella stessa stanza sbagliata.</li>
        <li><b>Non attraversate il NEXUS senza motivo.</b> È lo snodo più rapido ma alza l’allarme a ogni round passato lì.</li>
        <li><b>Muovetevi in coppia dove ci sono ostili.</b> Chi va da solo e cade non ha nessuno che possa rianimarlo: la rianimazione non attraversa i muri.</li>
        <li><b>Una INTRUSIONE per round, sempre.</b> È l’unico modo per non perdere la corsa contro l’allarme.</li>
        <li><b>Concentrate il fuoco.</b> Un nemico morto smette di colpire e smette di alzare l’allarme; un nemico ferito fa entrambe le cose.</li>
        <li><b>Non rianimate in ritardo.</b> Un compagno a terra è un turno perso ogni round: rialzatelo subito.</li>
        <li><b>Sincronizzate le abilità.</b> Zero-day del CIPHER più Sovraccarico del CHROME nello stesso round chiudono partite.</li>
      </ul>
      <h3>Per il singolo</h3>
      <ul>
        <li>Se sei sotto <b>un terzo</b> di integrità, spesso conviene <b>uscire dalla stanza</b> invece di curarti: fuori contatto non prendi più danni. Metti in conto il colpo dello sganciamento.</li>
        <li>Se sei sotto <b>un terzo</b> e sei già al sicuro, vai in COPERTURA — meglio in A02, A03 o E05, dove vale di più.</li>
        <li>Non tenere il FOCUS in banca. Un’abilità non usata a fine partita è un’abilità sprecata.</li>
        <li>Guarda l’ordine dei <b>RIFLESSI</b>: se sei lento, il tuo bersaglio potrebbe già essere morto. Punta su un nemico diverso.</li>
        <li>Il CHROME alza l’allarme quando spinge: usalo con il FACE pronto a ricomprare margine.</li>
      </ul>
      <div className="manual-callout"><Lightbulb size={16}/><p>Apertura tipo di una squadra che vince: il CIPHER verso C02 (viola B07 e B04 a distanza), CHROME e GHOST in coppia verso D03, il RIPPER un passo indietro pronto a raggiungere chi cade.</p></div>
    </>,
  },
  {
    id:'problemi', label:'PROBLEMI E SOLUZIONI', icon:<LifeBuoy size={15}/>,
    content:<>
      <h2>Problemi e soluzioni</h2>
      <dl className="manual-faq">
        <dt>Il telefono non trova la partita</dt>
        <dd>Verifica che telefono e computer siano sulla <b>stessa rete Wi-Fi</b> (non rete dati) e che l’indirizzo sia scritto per intero, porta compresa.</dd>
        <dt>«Questo operativo è già collegato da un altro telefono»</dt>
        <dd>Qualcun altro ha preso quel posto, oppure hai ricaricato la pagina da un dispositivo diverso. Scegli un operativo libero o attendi 15 secondi che il vecchio collegamento scada.</dd>
        <dt>Un giocatore risulta OFFLINE ma è seduto qui</dt>
        <dd>Lo schermo del telefono si è spento: i browser congelano i timer. Basta riaprire l’app, il collegamento si ripristina da solo.</dd>
        <dt>Il round non si chiude</dt>
        <dd>Manca l’azione di qualcuno. La plancia mostra chi. Allo scadere del tempo si chiude comunque; per forzarlo subito usa <b>CHIUDI ROUND</b>.</dd>
        <dt>Il timer è fermo</dt>
        <dd>È il comportamento previsto quando <b>nessun telefono</b> è collegato: la partita si mette in pausa invece di andare avanti da sola.</dd>
        <dt>La console del telefono è illeggibile</dt>
        <dd>Ruota il dispositivo in <b>orizzontale</b> e disattiva il blocco rotazione.</dd>
        <dt>Vogliamo ricominciare da capo</dt>
        <dd>Dalla plancia premi <b>TERMINA</b> (o <b>RICOMPONI SQUADRA</b> dalla lobby) e conferma: si torna alla configurazione.</dd>
      </dl>
    </>,
  },
];

export default function Manual({templates,onClose}:{templates:Template[];onClose:()=>void}){
  const chapters=chapterList(templates);
  const [current,setCurrent]=useState(chapters[0].id);
  const chapter=chapters.find((c)=>c.id===current)||chapters[0];
  // ESC chiude il manuale anche a metà partita, senza dover cercare il pulsante.
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  return <div className="manual-overlay">
    <button className="manual-scrim" aria-label="Chiudi le istruzioni" onClick={onClose}/>
    <section className="manual">
      <header className="manual-head">
        <div className="brand"><span className="brand-mark">R//P</span><div><b>ISTRUZIONI</b><small>MANUALE OPERATIVO // ROVERPUNK</small></div></div>
        <button className="manual-close" onClick={onClose} aria-label="Chiudi le istruzioni"><X size={18}/></button>
      </header>
      <div className="manual-body">
        <nav className="manual-nav">{chapters.map((c,i)=><button className={c.id===current?'active':''} onClick={()=>setCurrent(c.id)} key={c.id}><i>{String(i+1).padStart(2,'0')}</i>{c.icon}<span>{c.label}</span></button>)}</nav>
        <article className="manual-content" key={chapter.id}>{chapter.content}</article>
      </div>
      <footer className="manual-foot"><span>CAPITOLO {String(chapters.indexOf(chapter)+1).padStart(2,'0')} / {String(chapters.length).padStart(2,'0')} — {chapter.label}</span><button className="ghost-btn" onClick={onClose}>CHIUDI</button></footer>
    </section>
  </div>;
}

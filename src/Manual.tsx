import { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, Briefcase, Crosshair, Cpu, DoorOpen, Footprints, HeartPulse,
  Lightbulb, LifeBuoy, Map, Radio, Shield, ShieldAlert, Shuffle, Skull, Smartphone, Swords, Target,
  Timer, Trophy, Users, X, Zap,
} from 'lucide-react';

type Stats = { corpo:number; riflessi:number; mente:number; presenza:number };
type Template = { id:string; callsign:string; role:string; specialty:string; color:string; stats:Stats; maxHp:number; armor:number; focus:number; weapon:string; ability:string; abilityText:string };

// Le schede personaggio arrivano dal server: se il manuale viene aperto prima del
// caricamento dell'archivio, il capitolo mostra comunque il resto della guida.
const roleTips:Record<string,string>={
  ghost:'Colpisce forte senza far salire l’allarme: ideale quando la rete è già rovente.',
  chrome:'Il muro della squadra. Regge i colpi e apre i nemici corazzati, ma alza l’allarme quando spinge.',
  cipher:'Il vero motore della missione: apre la teca prima degli altri e ripulisce i droni.',
  ripper:'Tiene in piedi tutti. Il Protocollo Lazarus può ribaltare un round disastroso.',
  face:'Controlla l’allarme. Con i presidi ingaggiati è spesso la differenza fra estrazione e lockdown.',
  driver:'Danno diffuso su due bersagli: perfetto quando la scia di inseguitori si allunga.',
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
      <p>ROVERPUNK non è un gioco di sterminio: è un <b>colpo</b>. Ogni missione ha un oggetto da prendere e un posto dove portarlo. Gli Helix sono l’ostacolo che sta in mezzo, non la lista della spesa.</p>
      <div className="manual-callout"><Briefcase size={16}/><p>Nella <b>MISSIONE 01 // LA VALIGETTA</b> dovete violare i nodi per aprire la teca, prendere la valigetta <b>MNEMOSYNE</b> e consegnarla al punto di raccolta. Vedi il capitolo <b>LA MISSIONE</b>.</p></div>
      <h3>Il flusso di una partita</h3>
      <ol className="manual-steps">
        <li><b>Configurazione</b> — sulla plancia scegli quanti siete e assegni un personaggio a ciascun giocatore.</li>
        <li><b>Collegamento</b> — ogni telefono apre l’indirizzo di rete mostrato dalla lobby e inserisce il codice partita.</li>
        <li><b>Operazione</b> — si gioca a round: tutti scelgono un’azione, il computer la risolve, i nemici rispondono.</li>
        <li><b>Esito</b> — vittoria o sconfitta vengono dichiarate automaticamente dalla plancia.</li>
      </ol>
      <div className="manual-callout"><AlertTriangle size={16}/><p>Una partita dura tipicamente <b>25–40 minuti</b>. Non serve carta, dadi o schede: tutto è sullo schermo. <b>La plancia è diversa a ogni partita</b>: non esistono aperture imparate a memoria.</p></div>
      <div className="manual-callout"><Timer size={16}/><p>Esiste <b>un solo livello di minaccia</b>, e non si sceglie. ROVERPUNK è tarato per essere duro: allarme che corre e presidi che, una volta svegliati, non vi mollano più. Nessun tempo limite per round: si ragiona con calma.</p></div>
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
        <li>Per ogni slot, scrivi il <b>nome del giocatore</b> e scegli la sua <b>scheda personaggio</b>. Ogni personaggio può essere assegnato una volta sola.</li>
        <li>Premi <b>CREA CANALE DI GIOCO</b>: in quel momento viene generata la plancia della partita.</li>
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
      <div className="manual-callout"><Radio size={16}/><p>La partita viene salvata in locale: se il server si riavvia, i telefoni si ricollegano da soli senza perdere il progresso — plancia generata compresa.</p></div>
    </>,
  },
  {
    id:'missione', label:'LA MISSIONE', icon:<Briefcase size={15}/>,
    content:<>
      <h2>Missione 01 // La valigetta</h2>
      <p>Dentro la Helix Tower c’è un prototipo chiamato <b>MNEMOSYNE</b>, chiuso in una teca cifrata. Il colpo è semplice da spiegare e difficile da eseguire: <b>aprire, prendere, portare fuori</b>.</p>
      <h3>Le quattro fasi</h3>
      <ol className="manual-steps">
        <li><b>FASE 1 // RETE</b> — la teca è sigillata. Servono <b>2 nodi violati</b> (sulla plancia ce ne sono 3: potete scegliere i due più comodi) per far cadere la cifratura.</li>
        <li><b>FASE 2 // RECUPERO</b> — raggiungete la stanza della <b>teca</b> e usate l’azione <b>RECUPERO</b>. Nell’istante in cui la valigetta lascia la teca, l’allarme fa <b>+12</b>.</li>
        <li><b>FASE 3 // TRASPORTO</b> — chi la porta la tiene in mano finché non arriva al <b>punto di consegna</b>. La valigetta emette: <b>+2 allarme ogni round</b> mentre è addosso a qualcuno.</li>
        <li><b>FASE 4 // ESTRAZIONE</b> — consegnata la valigetta, portate <b>ogni operativo ancora vivo</b> nel punto di consegna. Solo allora la missione si chiude.</li>
      </ol>
      <h3>Chi porta la valigetta</h3>
      <ul>
        <li>La può portare <b>una persona sola</b> alla volta. Sulla plancia il suo segnalino diventa dorato.</li>
        <li>Gli ostili nella stanza <b>colpiscono sempre lui per primo</b>: il portatore è il bersaglio prioritario.</li>
        <li>Ha una mano occupata: la sua <b>COPERTURA vale la metà</b>.</li>
        <li>Se va <b>fuori combattimento</b>, la valigetta <b>cade nella stanza dove è caduto lui</b>. Qualcuno deve tornare a prenderla con un altro <b>RECUPERO</b>.</li>
        <li>Può passarla di fatto solo così: mettersi giù non è previsto, ma se il portatore cade il testimone si raccoglie da terra.</li>
      </ul>
      <div className="manual-callout"><Briefcase size={16}/><p>Il punto di consegna è generato <b>lontano dalla teca</b>: recuperare la valigetta è metà lavoro. La parte difficile è il viaggio di ritorno, con l’allarme che sale e una scia di presidi ingaggiati alle spalle.</p></div>
      <div className="manual-callout"><Skull size={16}/><p><b>Non dovete uccidere nessuno per vincere.</b> I combattimenti sono una conseguenza: i presidi stanno dove ci sono i nodi e la teca, cioè esattamente dove dovete andare. Potete anche prendere la valigetta e correre, lasciandoveli dietro — ma vi seguiranno.</p></div>
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
        <li><b>In 3:</b> almeno un CIPHER (apre la teca prima) e un RIPPER o CHROME (per reggere i colpi).</li>
        <li><b>In 4–5:</b> aggiungi un FACE. L’allarme, non le ferite, è quasi sempre quello che vi uccide.</li>
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
        <li><b>SCUDO</b> — protezione temporanea data da COPERTURA. Assorbe i danni prima della corazza e cala di <b>4 punti a fine round</b>.</li>
        <li><b>STRESS</b> — sale quando vieni colpito. È l’indicatore della pressione psicologica: le cure lo riducono.</li>
      </ul>
      <div className="manual-callout"><Shield size={16}/><p>Formula del danno subito: <Chip>danno nemico − scudo − corazza</Chip>, con minimo 1. Non c’è nessun moltiplicatore di difficoltà a salvarvi: i numeri sono quelli.</p></div>
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
        <li>Quando <b>tutti</b> hanno trasmesso il computer <b>risolve il round</b>. Non c’è tempo limite: si aspetta ogni azione (o la chiusura manuale dalla plancia).</li>
        <li><b>Fase 1 — MANOVRA:</b> si risolvono per prime tutte le manovre. Chi si è mosso combatte già dalla stanza nuova.</li>
        <li><b>Fase 2 — AZIONI:</b> tutto il resto si risolve <b>in ordine di RIFLESSI</b>, dal più alto al più basso, e sempre solo dentro la stanza occupata.</li>
        <li><b>Fase 3 — RISPOSTA HELIX:</b> rispondono i nemici vivi. Colpiscono chi è nella loro stanza; quelli già ingaggiati vi inseguono di una stanza.</li>
        <li>Si aggiornano allarme, scudi, focus e stato della valigetta; parte il round successivo.</li>
      </ol>
      <h3>Manovra e azione nello stesso round</h3>
      <ul>
        <li>La <b>MANOVRA è gratuita</b> e non consuma l’azione: nello stesso round puoi spostarti di una stanza <b>e</b> fare qualcosa.</li>
        <li>L’azione ha effetto nella <b>stanza di destinazione</b>: puoi entrare in una stanza e violarne il nodo, o entrare e sparare, nello stesso turno.</li>
        <li>Finché il round non si risolve puoi <b>ridichiarare la manovra</b>; l’azione invece si trasmette una volta sola.</li>
      </ul>
      <h3>Il tempo</h3>
      <ul>
        <li><b>Non c’è tempo limite per il round.</b> Il round si chiude solo quando ogni operativo ha trasmesso la propria azione.</li>
        <li>Se serve sbloccare la situazione, dalla plancia si può forzare la chiusura con <b>CHIUDI ROUND</b>: chi non ha trasmesso va in <b>COPERTURA</b>.</li>
        <li>Se un telefono va in standby o si allontana, la squadra lo aspetta comunque per <b>45 secondi</b>.</li>
        <li>Se <b>nessun telefono</b> è collegato la partita va in pausa invece di proseguire da sola.</li>
      </ul>
      <h3>Controlli dalla plancia</h3>
      <ul>
        <li><b>CHIUDI ROUND</b> — forza subito la risoluzione, senza aspettare i ritardatari.</li>
        <li><b>TERMINA</b> — chiude la partita e torna alla configurazione (la prossima partita avrà una plancia nuova).</li>
      </ul>
      <h3>Fuori combattimento</h3>
      <p>Un operativo a <b>0 integrità</b> non gioca più i round, ma <b>non è morto</b>. Torna in piedi con:</p>
      <ul>
        <li><b>RIPRISTINO</b> di un compagno → rientra al <b>25%</b> della sua integrità massima.</li>
        <li><b>Protocollo Lazarus</b> del RIPPER → rientra al <b>40%</b>.</li>
      </ul>
      <div className="manual-callout"><Users size={16}/><p>La difficoltà scala col numero di giocatori: i nemici hanno <b>+30% integrità</b> e <b>+12% danno</b> per ogni giocatore oltre il terzo, e dai <b>4 giocatori in su</b> compare un presidio in più sullo snodo principale. Giocare in 6 non è una scorciatoia.</p></div>
    </>,
  },
  {
    id:'plancia', label:'LA PLANCIA', icon:<Map size={15}/>,
    content:<>
      <h2>La plancia generata</h2>
      <p>La mappa <b>non è più fissa</b>: viene disegnata da zero ogni volta che create un canale di gioco. Nomi, forma delle stanze, porte, posizione di teca, nodi e punto di consegna cambiano a ogni partita.</p>
      <h3>Stanze quadrate e rettangolari</h3>
      <p>Il livello è una griglia di celle. Una stanza occupa <b>una cella</b> (quadrata) oppure <b>due celle adiacenti</b> (rettangolare, quindi <b>esattamente il doppio</b> di una quadrata), in orizzontale o in verticale. Una plancia tipica ha <b>10–13 stanze</b>, di cui 3–5 rettangolari.</p>
      <p>La dimensione è puramente architettonica: una stanza grande <b>non</b> ospita più gente né dà bonus. Serve a rendere la pianta credibile e a spostare le distanze.</p>
      <h3>Vicine non vuol dire collegate</h3>
      <p>Questa è la regola che rende ogni mappa un labirinto diverso: <b>due stanze possono condividere un muro e non avere nessuna porta</b>. Sulla plancia si vede a colpo d’occhio, perché fra loro non c’è nessun corridoio disegnato.</p>
      <ul>
        <li>Il generatore garantisce che <b>ogni stanza sia raggiungibile</b> dalla zona di partenza: non esistono zone murate.</li>
        <li>Solo una parte dei muri diventa porta. Tutti gli altri restano <b>pareti cieche</b>.</li>
        <li>Si può passare <b>solo dalle porte</b>: la console del telefono elenca le stanze davvero raggiungibili e blocca le altre.</li>
      </ul>
      <div className="manual-callout"><Shuffle size={16}/><p>Conseguenza pratica: la stanza che vedete <b>di fianco</b> a voi può richiedere <b>tre porte</b> per essere raggiunta. Guardate i corridoi disegnati, non la distanza sullo schermo.</p></div>
      <h3>I segnalini della plancia</h3>
      <p>Nelle stanze compaiono pedine quadrate. Oltre a squadra e ostili ci sono i <b>segnalini di scenario e di missione</b>: passandoci sopra il mouse, ognuno dice cosa è.</p>
      <table className="manual-table">
        <thead><tr><th>Segnalino</th><th>Cosa indica</th></tr></thead>
        <tbody>
          <tr><td><b>Lettera colorata</b></td><td>Un operativo. Il colore è quello del personaggio; grigio e opaco significa fuori combattimento.</td></tr>
          <tr><td><b>Pedina dorata</b></td><td>L’operativo che sta <b>portando la valigetta</b>.</td></tr>
          <tr><td><b>SEC / DR / EL</b></td><td>Un ostile: fanteria, drone, élite. Se pulsa è <b>ingaggiato</b> e vi sta seguendo.</td></tr>
          <tr><td><b>S</b> (azzurro)</td><td><b>Zona di partenza</b>: la stanza da cui la squadra è entrata.</td></tr>
          <tr><td><b>N</b> (verde acido)</td><td><b>Nodo di rete</b> da violare. Pieno = già violato.</td></tr>
          <tr><td><b>T</b> (rosso)</td><td><b>Teca</b>. Tratteggiata = sigillata, piena = aperta.</td></tr>
          <tr><td><b>▮</b> (dorato)</td><td><b>Valigetta MNEMOSYNE</b> a terra in quella stanza, pronta da raccogliere.</td></tr>
          <tr><td><b>▼</b> (verde)</td><td><b>Punto di consegna</b>: dove va portata la valigetta e dove ci si estrae.</td></tr>
        </tbody>
      </table>
      <h3>Etichette d’ambiente</h3>
      <ul>
        <li><b>COPERTURA</b> — la COPERTURA vale <b>+6 scudo</b> in questa stanza.</li>
        <li><b>ZONA ESPOSTA</b> — chi ci resta a fine round fa salire l’allarme di <b>2</b> a testa.</li>
      </ul>
      <h3>Muoversi</h3>
      <ul>
        <li>La <b>MANOVRA</b> è gratuita: non consuma l’azione del round. Ti sposti <b>e</b> agisci, dalla stanza in cui arrivi.</li>
        <li>Puoi entrare solo in una stanza <b>collegata da una porta</b>: una porta per round, niente scorciatoie.</li>
        <li><b>Sganciarsi costa.</b> Se lasci una stanza con ostili dentro, subisci il <b>60% del loro danno</b> e l’allarme sale di <b>4</b>.</li>
        <li>Le manovre si risolvono <b>prima</b> di tutto il resto: chi entra in una stanza può essere colpito lì nello stesso round.</li>
      </ul>
      <div className="manual-callout"><Footprints size={16}/><p>Prima mossa di ogni partita: <b>leggete la pianta insieme</b>. Contate le porte fra partenza, nodi, teca e consegna. Su una mappa generata, il percorso migliore non è mai quello che sembra.</p></div>
    </>,
  },
  {
    id:'azioni', label:'LE AZIONI', icon:<Swords size={15}/>,
    content:<>
      <h2>Le azioni</h2>
      <p>Ogni round scegli <b>una sola</b> di queste. Quasi tutte funzionano <b>solo dentro la stanza che occupi</b>: la console blocca da sola i pulsanti che in quel momento non hanno senso e ti dice perché.</p>
      <div className="manual-actions">
        <article><span><Footprints size={19}/></span><div><b>00 · MANOVRA</b><small>Costo: gratis · non consuma l’azione del round</small><p>Ti sposti in una stanza <b>collegata da una porta</b> e poi agisci da lì. Tocca la stanza sulla mappa del telefono. Se lasci una stanza presidiata subisci il <b>60% del danno</b> dell’ostile, e l’allarme sale di <b>3</b> — una volta sola per round, anche se si sgancia tutta la squadra.</p></div></article>
        <article><span><Swords size={19}/></span><div><b>01 · FUOCO</b><small>Costo: gratis · serve un ostile nella tua stanza</small><p>Attacchi un bersaglio <b>presente dove sei tu</b>. Danno = <Chip>12 + RIFLESSI + 0–7 casuale</Chip>, meno la corazza del nemico.</p></div></article>
        <article><span><Cpu size={19}/></span><div><b>02 · INTRUSIONE</b><small>Costo: gratis · serve un nodo nella tua stanza</small><p>Violi il nodo di <b>questa</b> stanza: <b>+1 nodo</b> e <b>allarme −(8 + metà MENTE)</b>. Colpisce anche un drone presente per <Chip>8 + MENTE</Chip>. Servono <b>2 nodi su 3</b> per aprire la teca.</p></div></article>
        <article><span><Shield size={19}/></span><div><b>03 · COPERTURA</b><small>Costo: gratis</small><p>Ti ripari: scudo pari a <Chip>10 + metà del CORPO</Chip>, <b>+6</b> in una stanza di copertura. <b>Dimezzato</b> se porti la valigetta. Lo scudo residuo cala di 4 a fine round.</p></div></article>
        <article><span><HeartPulse size={19}/></span><div><b>04 · RIPRISTINO</b><small>Costo: 2 FOCUS · agisce solo nella tua stanza</small><p>Se c’è un compagno a terra <b>nella tua stanza</b>, lo <b>rianima</b> al 25%. Altrimenti cura il compagno più ferito <b>presente lì con te</b> di <Chip>10 + MENTE</Chip>. Non si cura a distanza.</p></div></article>
        <article><span><Briefcase size={19}/></span><div><b>05 · RECUPERO</b><small>Costo: gratis · la valigetta dev’essere nella tua stanza</small><p>Raccogli la <b>valigetta MNEMOSYNE</b>. Funziona nella teca <b>solo dopo</b> aver violato 2 nodi, e in qualunque stanza dove la valigetta sia caduta. Il primo prelievo dalla teca fa <b>allarme +12</b>.</p></div></article>
        <article><span><Zap size={19}/></span><div><b>06 · ABILITÀ</b><small>Costo: 3 FOCUS</small><p>La mossa esclusiva del tuo personaggio, con la sua portata. Vedi il capitolo <b>ABILITÀ</b>.</p></div></article>
      </div>
      <h3>Scegliere il bersaglio</h3>
      <p>Il menu <b>BERSAGLIO</b> elenca solo gli ostili <b>presenti nella tua stanza</b>. Se sei in una stanza vuota il menu è spento e FUOCO è bloccato: prima devi raggiungerli.</p>
      <div className="manual-callout"><DoorOpen size={16}/><p>Un compagno a terra può essere rianimato <b>solo da chi si trova nella sua stessa stanza</b>. Se cade da solo dietro le linee, qualcuno deve andarlo a prendere — e se aveva la valigetta, deve andarla a riprendere lì.</p></div>
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
          <tr><td>CIPHER</td><td>Zero-day</td><td><b>+1 nodo</b> su un nodo nella tua stanza <b>o in una collegata da una porta</b>, e 25 danni ai droni nel raggio. L’unica azione a distanza del gioco.</td></tr>
          <tr><td>RIPPER</td><td>Protocollo Lazarus</td><td><b>+15 integrità</b> e rianimazione al 40% per tutti i compagni <b>presenti nella sua stanza</b>.</td></tr>
          <tr><td>FACE</td><td>Identità sintetica</td><td><b>Allarme −16</b> su tutto il livello e gli ostili <b>della sua stanza</b> saltano il turno.</td></tr>
          <tr><td>DRIVER</td><td>Sciame MANTA</td><td>Danno <Chip>18 + RIFLESSI</Chip> a <b>due ostili</b> nella sua stanza o in una collegata.</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><Zap size={16}/><p>Lo <b>Zero-day</b> del CIPHER è l’unico modo per violare un nodo <b>senza entrare nella stanza presidiata</b>: se il generatore vi ha messo due nodi vicini, può aprire la teca senza che nessuno venga ingaggiato.</p></div>
      <div className="manual-callout"><HeartPulse size={16}/><p><b>Identità sintetica</b> non disingaggia nessuno: fa saltare un turno agli ostili presenti, cioè vi regala <b>una stanza di vantaggio</b> nella fuga col bottino. È il momento migliore per usarla.</p></div>
    </>,
  },
  {
    id:'nemici', label:'NEMICI E MINACCE', icon:<Skull size={15}/>,
    content:<>
      <h2>Nemici e minacce</h2>
      <p>I nemici non tirano dadi: colpiscono sempre, ma <b>solo chi si trova nella loro stessa stanza</b>. Fuori contatto non fanno danno: la distanza è una difesa reale.</p>
      <h3>Presidio, non pattuglia</h3>
      <p>Gli Helix <b>non girano per la mappa da soli</b>. Ogni unità è assegnata a una stanza — quella dove c’è qualcosa da difendere — e ci resta ferma per tutta la partita, finché non succede una cosa sola:</p>
      <ul>
        <li><b>Ingaggio.</b> Appena un operativo mette piede nella sua stanza, l’unità è ingaggiata. Da quel momento <b>non torna più in postazione</b>.</li>
        <li><b>Inseguimento.</b> Un’unità ingaggiata vi segue di <b>una stanza per round</b>, passando dalle porte come voi. Se scappate, vi viene dietro; se vi dividete, segue chi ha agganciato.</li>
        <li><b>Se il suo bersaglio cade</b>, aggancia l’operativo raggiungibile più vicino e riprende l’inseguimento.</li>
        <li><b>Priorità al bottino:</b> se nella stanza c’è chi porta la valigetta, colpisce lui, sempre.</li>
      </ul>
      <p>Sulla plancia il pannello MINACCE dice per ognuno se è <b>DI PRESIDIO</b> (fermo, non vi ha ancora visti), <b>VI INSEGUE</b> o <b>IN CONTATTO CON LA SQUADRA</b>.</p>
      <div className="manual-callout"><Map size={16}/><p>Questo cambia tutto il gioco: <b>evitare una stanza significa evitare per sempre il suo presidio</b>. Ma ogni stanza che vi serve — nodi e teca — ha una guardia dentro. L’ingaggio non è un incidente: è il prezzo dell’obiettivo, e sta a voi decidere quante volte pagarlo.</p></div>
      <h3>Lockdown</h3>
      <p>Sopra l’<b>80% di allarme</b> la torre sveglia tutti: <b>ogni unità del settore diventa ingaggiata</b> in un colpo solo, anche quelle che non avete mai incontrato, e converge su di voi. È il punto di non ritorno di una partita andata lunga.</p>
      <h3>Le unità</h3>
      <table className="manual-table">
        <thead><tr><th>Unità</th><th>Tipo</th><th>Integrità</th><th>Corazza</th><th>Danno</th><th>Presidia</th></tr></thead>
        <tbody>
          <tr><td>CUSTODE K-9</td><td>ÉLITE</td><td>150</td><td>8</td><td>22</td><td>La teca</td></tr>
          <tr><td>HELIX SEC-4</td><td>FANTERIA</td><td>84</td><td>5</td><td>16</td><td>Nodi (e lo snodo principale se siete in 4+)</td></tr>
          <tr><td>WASP D-2</td><td>DRONE</td><td>62</td><td>3</td><td>13</td><td>Un nodo</td></tr>
          <tr><td>HELIX RAZOR</td><td>RINFORZO</td><td>78</td><td>4</td><td>17</td><td>Entra già in caccia</td></tr>
        </tbody>
      </table>
      <p className="manual-muted">Valori base in 3 giocatori. Con più giocatori integrità e danno salgono proporzionalmente.</p>
      <h3>Eventi programmati</h3>
      <ul>
        <li><b>Round 5 — RINFORZI:</b> un <b>HELIX RAZOR</b> entra dalla <b>zona di partenza</b>, già ingaggiato, e vi cerca. Vi taglia la strada di casa.</li>
        <li><b>Round 9 — SECONDA ONDATA:</b> un secondo RAZOR entra dal <b>punto di consegna</b>, cioè proprio dove dovete arrivare.</li>
        <li><b>Allarme 80% — LOCKDOWN:</b> ogni presidio del settore si allerta insieme.</li>
      </ul>
      <div className="manual-callout"><Skull size={16}/><p>Il <b>CUSTODE K-9</b> ha corazza 8 e 150 di integrità: abbatterlo costa quasi sempre più round di quanti ne avete. <b>Non è obbligatorio.</b> Aprite la teca, prendete la valigetta e trascinatelo dietro di voi: un élite che insegue fa meno danno di un élite che vi trattiene.</p></div>
    </>,
  },
  {
    id:'allarme', label:'ALLARME E NODI', icon:<ShieldAlert size={15}/>,
    content:<>
      <h2>Allarme e nodi</h2>
      <h3>I nodi (0 → 3)</h3>
      <p>Sulla plancia ci sono <b>tre nodi</b>, ma per aprire la teca ne bastano <b>due</b>. Il terzo è facoltativo: si viola solo per <b>ricomprare allarme</b>, e va valutato ogni volta se vale il round e l’ingaggio che costa.</p>
      <h3>L’allarme (0% → 100%)</h3>
      <p>Parte da <b>15%</b> e rappresenta quanto la Helix sa di voi. <b>A 100% avete perso</b>, anche se siete tutti in piedi. A <b>80%</b> scatta il lockdown.</p>
      <table className="manual-table">
        <thead><tr><th>Cosa lo fa salire</th><th>Cosa lo fa scendere</th></tr></thead>
        <tbody>
          <tr><td>Pressione base: <b>+3</b> ogni round</td><td>INTRUSIONE: <Chip>−(8 + metà MENTE)</Chip></td></tr>
          <tr><td><b>+1</b> per ogni ostile che a fine round è <b>nella vostra stanza</b></td><td>Identità sintetica del FACE: <b>−16</b></td></tr>
          <tr><td><b>+1</b> per ogni operativo fermo in <b>zona esposta</b> a fine round</td><td>—</td></tr>
          <tr><td><b>+2</b> ogni round in cui qualcuno <b>porta la valigetta</b></td><td>—</td></tr>
          <tr><td>Primo prelievo della valigetta dalla teca: <b>+10</b></td><td>—</td></tr>
          <tr><td>Sganciarsi da una stanza presidiata: <b>+3</b> (una volta per round)</td><td>—</td></tr>
          <tr><td>Sovraccarico cromo del CHROME: <b>+9</b></td><td>—</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><AlertTriangle size={16}/><p>Costa allarme <b>solo chi vi ha addosso adesso</b>: un inseguitore che avete seminato per un round non trasmette. Staccarsi dagli ostili non è solo una questione di ferite, è il modo più diretto di rallentare l’allarme.</p></div>
      <div className="manual-callout"><Timer size={16}/><p>Conto della serva: partite da 15 e ne avete 85 da bruciare. A regime, con due o tre ostili addosso, si consumano <b>8–12 punti a round</b>: sono circa <b>dieci round</b>. Aprire la teca, arrivarci e tornare indietro ne richiede quasi altrettanti. <b>Non c’è tempo per il giro turistico.</b></p></div>
    </>,
  },
  {
    id:'esito', label:'VITTORIA E SCONFITTA', icon:<Trophy size={15}/>,
    content:<>
      <h2>Come finisce la partita</h2>
      <h3>Vittoria</h3>
      <p>Servono <b>entrambe</b> le condizioni, nello stesso momento:</p>
      <ul>
        <li><b>Valigetta consegnata</b> — chi la porta ha concluso un round dentro il <b>punto di consegna</b>.</li>
        <li><b>Estrazione</b> — <b>ogni operativo ancora vivo si trova nel punto di consegna</b> alla fine del round.</li>
      </ul>
      <p>Chi è a terra <b>non conta</b> per l’estrazione, ma resta indietro: se volete portarli fuori davvero, rianimateli prima.</p>
      <p>La missione ha quattro fasi e la plancia dice sempre quale state giocando: <b>RETE</b>, <b>RECUPERO</b>, <b>TRASPORTO</b>, <b>ESTRAZIONE</b>.</p>
      <h3>Sconfitta</h3>
      <p>Basta <b>una</b> di queste:</p>
      <ul>
        <li><b>Tutta la squadra fuori combattimento</b> nello stesso round: non resta nessuno per rianimare.</li>
        <li><b>Allarme al 100%</b>: la torre entra in lockdown totale e il segnale clandestino è perduto.</li>
      </ul>
      <div className="manual-callout"><Trophy size={16}/><p>Errore classico: aprire la teca al terzo round e poi impiegarne sei per tornare indietro con l’allarme che corre. <b>Studiate la via del ritorno prima di prendere la valigetta</b>, non dopo.</p></div>
      <div className="manual-callout"><DoorOpen size={16}/><p>Secondo errore classico: consegnare la valigetta con mezza squadra sparpagliata dall’altra parte della mappa. La consegna <b>non chiude la partita</b>: la chiude l’ultimo operativo che entra nella stanza.</p></div>
    </>,
  },
  {
    id:'tattiche', label:'CONSIGLI TATTICI', icon:<Lightbulb size={15}/>,
    content:<>
      <h2>Consigli tattici</h2>
      <h3>Per la squadra</h3>
      <ul>
        <li><b>Leggete la mappa nel round 1.</b> È diversa ogni volta: individuate subito i due nodi più vicini fra loro e la via più corta fra teca e consegna.</li>
        <li><b>Scegliete i due nodi più economici.</b> Il terzo lo violate solo se vi avanza allarme da ricomprare.</li>
        <li><b>Non entrate nelle stanze che non vi servono.</b> Un presidio non ingaggiato è un nemico che non esiste — e che non vi costa allarme.</li>
        <li><b>Parlate ad alta voce.</b> Il gioco è simultaneo: se non annunciate le manovre, vi ritroverete tutti nella stessa stanza sbagliata.</li>
        <li><b>Decidete prima chi porta la valigetta.</b> Meglio uno con integrità alta e corazza alta: sarà il bersaglio di tutti.</li>
        <li><b>Scortate il portatore.</b> Chi lo accompagna deve stare nella <b>sua stessa stanza</b>, altrimenti non può né curarlo né rialzarlo.</li>
        <li><b>Concentrate il fuoco</b> solo su chi vi blocca davvero. Un élite ingaggiato che vi insegue si può ignorare; un drone che vi trattiene no.</li>
        <li><b>Sincronizzate le abilità.</b> Identità sintetica del FACE nello stesso round della fuga col bottino vale una stanza intera di vantaggio.</li>
      </ul>
      <h3>Per il singolo</h3>
      <ul>
        <li>Se sei sotto <b>un terzo</b> di integrità, spesso conviene <b>uscire dalla stanza</b> invece di curarti: fuori contatto non prendi più danni. Metti in conto il colpo dello sganciamento.</li>
        <li>Se porti la valigetta, <b>non fermarti mai a combattere</b>: ogni round in più addosso a te è allarme.</li>
        <li>Non tenere il FOCUS in banca. Un’abilità non usata a fine partita è un’abilità sprecata.</li>
        <li>Guarda l’ordine dei <b>RIFLESSI</b>: se sei lento, il tuo bersaglio potrebbe già essere morto. Punta su un nemico diverso.</li>
        <li>Il CHROME alza l’allarme quando spinge: usalo con il FACE pronto a ricomprare margine.</li>
      </ul>
      <div className="manual-callout"><Lightbulb size={16}/><p>Apertura tipo di una squadra che vince: CIPHER e scorta verso i due nodi più vicini, CHROME che apre la strada verso la teca, RIPPER un passo indietro sulla via del ritorno. Nessuno entra in una stanza che non serve all’obiettivo.</p></div>
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
        <dt>La stanza accanto non è selezionabile</dt>
        <dd>Non è un errore: <b>non c’è nessuna porta</b> fra le due. Sono vicine ma separate da un muro. Guarda i corridoi disegnati sulla plancia e cerca un altro percorso.</dd>
        <dt>Non riesco a prendere la valigetta</dt>
        <dd>O la <b>teca è ancora sigillata</b> (servono 2 nodi violati), o la valigetta <b>non è nella tua stanza</b>, o ce l’ha già un compagno. La console lo scrive sotto il pulsante RECUPERO.</dd>
        <dt>Il round non si chiude</dt>
        <dd>Manca l’azione di qualcuno: non c’è tempo limite, il round aspetta tutti. La plancia mostra chi manca; per chiudere comunque usa <b>CHIUDI ROUND</b>.</dd>
        <dt>La partita è ferma</dt>
        <dd>È il comportamento previsto quando <b>nessun telefono</b> è collegato: si mette in pausa invece di andare avanti da sola.</dd>
        <dt>La console del telefono è illeggibile</dt>
        <dd>Ruota il dispositivo in <b>orizzontale</b> e disattiva il blocco rotazione.</dd>
        <dt>Vogliamo una mappa diversa</dt>
        <dd>Dalla plancia premi <b>TERMINA</b> (o <b>RICOMPONI SQUADRA</b> dalla lobby) e crea un nuovo canale: la plancia viene rigenerata da zero.</dd>
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

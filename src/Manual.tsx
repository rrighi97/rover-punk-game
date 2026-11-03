import { useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, Briefcase, CameraOff, Crosshair, Cpu, DoorOpen, EyeOff, Footprints, Gauge, HeartPulse,
  Lightbulb, LifeBuoy, Map, PackagePlus, Radio, RefreshCw, Shield, ShieldAlert, Shuffle, Skull, Smartphone, Swords, Target,
  Timer, Trophy, Users, X, Zap,
} from 'lucide-react';
import { charImg } from './roster';

type Passive = { id:string; name:string; text:string };
type Template = { id:string; callsign:string; role:string; specialty:string; color:string; maxHp:number; dmg:number; mag?:number; focus:number; weapon:string; ability:string; abilityText:string; passives?:Passive[] };

// Le schede personaggio arrivano dal server: se il manuale viene aperto prima del
// caricamento dell'archivio, il capitolo mostra comunque il resto della guida.
const roleTips:Record<string,string>={
  ghost:'Apre le porte senza spendere azioni e, se non spara, non fa salire l’allarme: l’esploratore della squadra.',
  chrome:'Il muro della squadra: tanta integrità, metà danni subiti e il colpo singolo più pesante del gioco.',
  cipher:'Il motore della missione: viola i nodi anche dalla stanza accanto e ripulisce i droni.',
  ripper:'Tiene in piedi tutti. Il Protocollo Lazarus può ribaltare un turno disastroso.',
  face:'Tiene giù l’allarme e fa saltare la prossima risposta agli ostili della sua stanza: un colpo in meno quando serve.',
  driver:'Si muove gratis e colpisce due bersagli anche nella stanza accanto: perfetto quando la scia di inseguitori si allunga.',
  breacher:'Ripulisce una stanza affollata in un colpo solo e apre la strada spalancando le porte bloccate.',
  handler:'Non spara di più, ma fa giocare meglio gli altri: rimette focus ai compagni per le loro abilità.',
};

function Chip({children}:{children:React.ReactNode}){ return <span className="manual-chip">{children}</span>; }

export const chapterList=(templates:Template[])=>[
  {
    id:'come-si-gioca', label:'COME SI GIOCA', icon:<BookOpen size={15}/>,
    content:<>
      <h2>Come si gioca</h2>
      <p><b>ROVERPUNK</b> è un gioco cooperativo cyberpunk per <b>2–6 giocatori</b>. Un computer fa da <b>plancia</b> (la mappa, i nemici, il diario della missione) e ogni giocatore usa il proprio <b>telefono</b> come console personale.</p>
      <p>Non c’è un master umano: il computer è il <b>GM autonomo</b>. Gestisce turni, nemici, allarme, danni e risoluzione delle azioni. Voi dovete solo decidere cosa fare, turno dopo turno.</p>
      <h3>Obiettivo</h3>
      <p>ROVERPUNK non è un gioco di sterminio: è un <b>colpo</b>. Ogni missione ha un obiettivo da raggiungere e un punto di consegna da cui uscire. Gli Helix sono l’ostacolo che sta in mezzo, non la lista della spesa.</p>
      <div className="manual-callout"><Briefcase size={16}/><p>Sei missioni, stesso schema di base: violare i nodi, agire sull’obiettivo e uscire dal punto di consegna. <b>01 // LA VALIGETTA</b> — rubate MNEMOSYNE. <b>02 // GHOST PROTOCOL</b> — cancellate il nucleo con la PURGA. <b>03 // OSTAGGIO</b> — liberate l’informatore e portatelo fuori vivo. <b>04 // ULTIMO BACKUP</b> — restate collegati alla sorgente e scaricate MNEMOSYNE viva. <b>05 // PUNTO DI ROTTURA</b> — innescate la carica sul reattore e scappate prima che detoni. <b>06 // SPETTRO</b> — MNEMOSYNE scappa: chiudetelo in trappola e catturatelo. Vedi il capitolo <b>LE MISSIONI</b>.</p></div>
      <h3>Il flusso di una partita</h3>
      <ol className="manual-steps">
        <li><b>Configurazione</b> — sulla plancia scegli quanti posti aprire (2–6), il <b>rischio</b> e la missione.</li>
        <li><b>Collegamento</b> — ogni telefono apre l’indirizzo di rete mostrato dalla lobby, inserisce il codice partita e il proprio nome, e sceglie il suo personaggio.</li>
        <li><b>Operazione</b> — si gioca a turni: gli operativi giocano uno alla volta nell’ordine fisso, e a ogni turno chiuso risponde la torre.</li>
        <li><b>Esito</b> — vittoria o sconfitta vengono dichiarate automaticamente dalla plancia.</li>
      </ol>
      <div className="manual-callout"><AlertTriangle size={16}/><p>Una partita dura tipicamente <b>25–40 minuti</b>. Non serve carta, dadi o schede: tutto è sullo schermo. <b>Ogni missione ha la sua plancia</b>: cambiando missione cambia la mappa. Nessun tempo limite per turno: si ragiona con calma.</p></div>
      <h3>Il rischio</h3>
      <p>Prima di creare il canale la plancia sceglie uno dei quattro livelli di <b>RISCHIO</b>. Vale per tutta la squadra e per qualunque missione; passando sopra al pulsante la plancia ne mostra i valori.</p>
      <table className="manual-table">
        <thead><tr><th>Rischio</th><th>Allarme iniziale</th><th>Nemici</th><th>Chi va a terra</th></tr></thead>
        <tbody>
          <tr><td><b>BASSO</b></td><td>15%</td><td>−10%</td><td>Si rialza da solo o lo rialza un compagno</td></tr>
          <tr><td><b>MEDIO</b></td><td>16%</td><td>valori base</td><td>Si rialza da solo o lo rialza un compagno</td></tr>
          <tr><td><b>ALTO</b></td><td>17%</td><td>+10%</td><td><b>Solo</b> un compagno può rialzarlo</td></tr>
          <tr><td><b>BRUTALE</b></td><td>18%</td><td>+20%</td><td><b>Nessun rialzo</b>: chi cade è fuori per il resto della missione</td></tr>
        </tbody>
      </table>
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
        <li>Scegli il <b>numero di posti</b> (2–6), il <b>rischio</b> e la <b>missione</b>. I personaggi non si assegnano dalla plancia: li sceglie ogni giocatore dal proprio telefono.</li>
        <li>Premi <b>CREA CANALE DI GIOCO</b>: in quel momento viene caricata la plancia della missione scelta e si apre la lobby con codice partita, indirizzo e QR.</li>
      </ol>
      <p>Il numero di posti non è solo un tetto: decide quanti <b>droni</b> presidiano la plancia e quante modifiche contiene la <b>cassa</b>. Sceglilo pari ai giocatori reali.</p>
      <h3>3. Sui telefoni</h3>
      <ol className="manual-steps">
        <li>Apri il browser sull’indirizzo mostrato dalla lobby (es. <code>http://192.168.1.20:5174</code>) oppure inquadra il QR.</li>
        <li>Inserisci il <b>codice partita</b> (es. NEON-77) e il tuo <b>nome</b>.</li>
        <li>Scegli il tuo <b>personaggio</b> dall’elenco. Ogni scheda va a un solo operativo: se è già stata presa da un altro telefono collegato risulta occupata. Finché si è in lobby puoi cambiarla.</li>
        <li><b>Ruota il telefono in orizzontale</b>: la console richiede lo schermo largo.</li>
      </ol>
      <p>L’<b>ordine di turno</b> è quello d’ingresso nella lobby: il primo telefono che sceglie la scheda gioca per primo.</p>
      <h3>4. Via</h3>
      <p>Quando la squadra è pronta premi <b>AVVIA OPERAZIONE</b> dalla plancia: solo allora i presidi Helix vengono schierati. A partita avviata non si possono più aggiungere operativi, ma un telefono caduto può riprendere il suo posto. Se non tutti i telefoni sono collegati la plancia chiede conferma: puoi avviare lo stesso, ma il giro resta fermo sul turno di chi non è collegato finché non si collega o non lo salti con <b>SALTA TURNO</b>.</p>
      <div className="manual-callout"><Radio size={16}/><p>La partita viene salvata in locale: se il server si riavvia, i telefoni si ricollegano da soli senza perdere il progresso — plancia compresa.</p></div>
    </>,
  },
  {
    id:'missione', label:'LE MISSIONI', icon:<Briefcase size={15}/>,
    content:<>
      <p>Tutte le missioni partono allo stesso modo: l’obiettivo è <b>sigillato</b> finché non violate <b>2 nodi di rete</b> con INTRUSIONE (o con lo Zero-day del CIPHER). Tutte finiscono allo stesso modo: obiettivo compiuto e <b>ogni operativo in piedi nel punto di consegna</b>, sgombro da ostili. Cambia quello che succede in mezzo.</p>
      <h2>Missione 01 // La valigetta</h2>
      <p>Dentro la Helix Tower c’è un prototipo chiamato <b>MNEMOSYNE</b>, chiuso in una teca cifrata. Il colpo è semplice da spiegare e difficile da eseguire: <b>aprire, prendere, portare fuori</b>.</p>
      <h3>Le quattro fasi</h3>
      <ol className="manual-steps">
        <li><b>FASE 1 // RETE</b> — la teca è sigillata. Servono <b>2 nodi violati</b> per far cadere la cifratura.</li>
        <li><b>FASE 2 // RECUPERO</b> — raggiungete la stanza della <b>teca</b> e usate l’azione <b>RECUPERO</b> per prendere la valigetta (allarme <b>+10</b> la prima volta).</li>
        <li><b>FASE 3 // TRASPORTO</b> — chi la porta la tiene in mano finché non chiude un turno nel <b>punto di consegna</b>: lì la valigetta è consegnata.</li>
        <li><b>FASE 4 // ESTRAZIONE</b> — consegnata la valigetta, portate <b>ogni operativo ancora in piedi</b> nel punto di consegna. Solo allora la missione si chiude.</li>
      </ol>
      <h3>Chi porta la valigetta</h3>
      <ul>
        <li>La può portare <b>una persona sola</b> alla volta. Sulla plancia il suo segnalino diventa dorato.</li>
        <li>Il portatore non attira colpi in più: come tutti, prende i colpi degli ostili solo se <b>chiude il turno</b> nella loro stanza.</li>
        <li>Se va <b>fuori combattimento</b>, la valigetta <b>cade nella stanza dove è caduto</b>. Qualcuno deve tornare a prenderla con un altro <b>RECUPERO</b>.</li>
        <li>Non si passa di mano: l’unico modo di cambiare portatore è raccoglierla da terra.</li>
      </ul>
      <div className="manual-callout"><Briefcase size={16}/><p>Il punto di consegna è <b>lontano dalla teca</b>: recuperare la valigetta è metà lavoro. La parte difficile è il viaggio di ritorno, con una scia di presidi ingaggiati alle spalle e i rinforzi che vi vengono incontro.</p></div>
      <div className="manual-callout"><Skull size={16}/><p><b>Non dovete uccidere tutti per vincere.</b> I presidi stanno dove ci sono i nodi, l’obiettivo e la consegna, cioè esattamente dove dovete andare. Potete anche prendere la valigetta e correre, lasciandoveli dietro — ma vi seguiranno. Ricordate che il punto di consegna è sorvegliato da un <b>HELIX GOLIATH</b> e va sgomberato prima di uscire.</p></div>
      <h2>Missione 02 // Ghost Protocol</h2>
      <p>Niente da portare via: MNEMOSYNE va <b>cancellato alla fonte</b>. Violate 2 nodi per abbattere il firewall, raggiungete il <b>nucleo dati</b> e usate l’azione <b>PURGA</b> (allarme <b>+10</b>).</p>
      <ul>
        <li>Nell’istante in cui parte la PURGA <b>ogni unità Helix del settore viene ingaggiata</b>, anche quelle che non vi hanno mai visti, e parte a caccia della squadra.</li>
        <li>Da lì in poi è solo fuga: portate <b>ogni operativo ancora in piedi</b> nel punto di consegna.</li>
      </ul>
      <h2>Missione 03 // Ostaggio</h2>
      <p>Nella cella è rinchiuso un informatore. Violate 2 nodi per sbloccarla e usate l’azione <b>LIBERA</b> nella sua stanza (allarme <b>+10</b> la prima volta): da quel momento lo <b>scortate voi</b> e si sposta con chi l’ha liberato.</p>
      <ul>
        <li>L’informatore ha <b>70 di integrità</b> e non combatte. Finché è scortato gli ostili non lo toccano.</li>
        <li>Se chi lo scorta cade, l’informatore <b>resta in quella stanza</b>: se lì ci sono ostili, gli tolgono <b>6</b> a ogni turno che si chiude. Riprendetelo con un altro <b>LIBERA</b>.</li>
        <li>Se l’informatore muore la missione è <b>persa</b>. Per vincere chi lo scorta deve chiudere un turno nel punto di consegna, poi va estratto il resto della squadra.</li>
      </ul>
      <h2>Missione 04 // Ultimo backup</h2>
      <p>Niente da rubare né da cancellare: l’unica copia <b>viva</b> di MNEMOSYNE gira su una sorgente dati nel cuore della torre. Violate 2 nodi per sbloccarla, poi usate l’azione <b>SCARICA</b> nella sua stanza — <b>più volte</b> — per completare il trasferimento.</p>
      <ul>
        <li>Un solo <b>SCARICA</b> non basta: servono <b>4 cicli</b>, più delle 3 azioni di un turno. Bisogna restare sulla sorgente per più di un turno, o dividersi lo sforzo fra più operativi. Il progresso non si perde.</li>
        <li>Ogni ciclo costa <b>1 FOCUS</b> e fa salire l’<b>allarme di 3</b>: più il trasferimento va avanti, più in fretta arrivano i rinforzi.</li>
        <li>Al quarto ciclo il trasferimento è completo e, come con la PURGA, <b>ogni unità Helix del settore viene ingaggiata</b> e parte a caccia della squadra: da lì in poi è solo fuga verso il punto di consegna.</li>
      </ul>
      <div className="manual-callout"><ShieldAlert size={16}/><p>Qui il nemico non è un presidio da abbattere ma il <b>tempo</b>: ogni ciclo di SCARICA vi avvicina all’obiettivo e all’allarme al 100% insieme. Decidete se spingere fino in fondo o ritirarvi un turno per respirare.</p></div>
      <h2>Missione 05 // Punto di rottura</h2>
      <p>MNEMOSYNE è stato staccato dalla rete: vive offline in un reattore, irraggiungibile da qualunque hack. Violate 2 nodi per aprire l’accesso, raggiungete il reattore e usate l’azione <b>INNESCO</b> (allarme <b>+10</b>): da quel momento parte un <b>conto alla rovescia di 6 turni</b> che nessuno può fermare.</p>
      <ul>
        <li>Innescata la carica, <b>ogni unità Helix del settore viene ingaggiata</b> e parte a caccia, come con PURGA e SCARICA.</li>
        <li>Dopo <b>6 turni chiusi</b> — di chiunque, non solo di chi ha innescato — il reattore <b>detona da solo</b>: chi è ancora nella sua stanza o in una stanza collegata (porte aperte o chiuse) va <b>a terra sul colpo</b>. Anche gli ostili nel raggio vengono spazzati via.</li>
        <li>L’obiettivo è compiuto solo <b>dopo la detonazione</b>: la squadra deve poi trovarsi tutta nel punto di consegna.</li>
        <li>Chi viene travolto va a terra come per un colpo nemico e segue le regole del rischio scelto. Se l’esplosione coglie <b>tutta la squadra</b> nel raggio, è sconfitta.</li>
      </ul>
      <div className="manual-callout"><Timer size={16}/><p>Qui il tempo non è elastico come nelle altre missioni: dopo l’INNESCO il countdown è <b>fisso e non si ferma</b>. Decidete la via di fuga <b>prima</b> di innescare, non dopo.</p></div>
      <h2>Missione 06 // Spettro</h2>
      <p>MNEMOSYNE si è trasferito in <b>SPETTRO</b>, un telaio sintetico che non combatte: <b>scappa</b>. Dorme nella culla finché non violate 2 nodi, poi si sveglia e a ogni fine turno si sposta di una stanza, sempre lontano dalla squadra. Il suo segnalino <b>Ψ</b> è sempre visibile sulla plancia (tranne nella nebbia).</p>
      <ul>
        <li>SPETTRO passa <b>solo da porte aperte</b> e <b>mai</b> in una stanza dove c’è un operativo in piedi. Non torna sui suoi passi se ha un’alternativa e preferisce gli snodi con tante uscite.</li>
        <li>In questa missione le porte si possono anche <b>chiudere</b>: <b>SIGILLA PORTA</b> (-1 FOCUS) richiude una porta aperta della tua stanza. Attenzione: ogni porta che sbloccate per passare è anche una via di fuga in più per lui.</li>
        <li>È <b>braccato</b> quando ogni porta della sua stanza è chiusa oppure dà su una stanza presidiata da un compagno in piedi. Solo allora, dalla sua stanza, <b>CATTURA</b> lo chiude in gabbia (allarme <b>+10</b>).</li>
        <li>Se a fine turno si ritrova braccato ma nessuno l’ha catturato, <b>forza una porta chiusa</b> (mai verso un operativo) e resta fermo quel turno: la trappola va chiusa e scattata nello stesso turno, oppure tenuta con i corpi dei compagni.</li>
        <li>Finché è sveglio e libero riscrive la torre: <b>+1% d’allarme</b> in più a ogni fine turno. Catturato, ogni unità Helix vi dà la caccia fino al punto di consegna.</li>
      </ul>
      <div className="manual-callout"><ShieldAlert size={16}/><p>Qui non vince chi spara di più ma chi <b>si piazza meglio</b>: dividetevi, bloccate gli snodi con il corpo, sigillate le uscite e passate il turno al compagno che chiude la gabbia.</p></div>
    </>,
  },
  {
    id:'personaggi', label:'I PERSONAGGI', icon:<Users size={15}/>,
    content:<>
      <h2>I personaggi</h2>
      <p>Otto operativi, otto ruoli. Ognuno ha la sua <b>integrità</b>, il <b>danno dell’arma</b>, il <b>caricatore</b>, il <b>focus</b>, due <b>passive</b> sempre attive e una <b>abilità esclusiva</b> che costa 3 FOCUS. Non esistono ruoli inutili: una squadra tutta d’assalto si fa logorare dai presidi, una squadra tutta hacker viene fatta a pezzi.</p>
      {templates.length?<div className="manual-cards">{templates.map((t)=><article className="manual-char" style={{'--accent':t.color} as React.CSSProperties} key={t.id}>
        <header><img className="manual-avatar" src={charImg(t.id)} alt={t.callsign} loading="lazy" decoding="async"/><div><b>{t.callsign}</b><small>{t.role} // {t.specialty}</small></div></header>
        <div className="manual-statline"><span><i>INTEGRITÀ</i><b>{t.maxHp}</b></span><span><i>DANNO</i><b>+{t.dmg}</b></span><span><i>CARICATORE</i><b>{t.mag??'—'}</b></span><span><i>FOCUS</i><b>{t.focus}</b></span></div>
        <p className="manual-weapon"><Crosshair size={12}/> {t.weapon} +{t.dmg}</p>
        <p className="manual-ability"><Zap size={12}/> <b>{t.ability}</b> — {t.abilityText}</p>
        {t.passives?.map((passive)=><p className="manual-ability" key={passive.id}><Shield size={12}/> <b>{passive.name}</b> — {passive.text}</p>)}
        <p className="manual-tip">{roleTips[t.id]}</p>
      </article>)}</div>:<p className="manual-muted">Archivio operativi non ancora caricato.</p>}
      <h3>Chi scegliere se siete in pochi</h3>
      <ul>
        <li><b>In 2–3:</b> almeno un CIPHER (apre l’obiettivo prima) e un RIPPER o CHROME (per reggere i colpi).</li>
        <li><b>In 4–5:</b> aggiungi un FACE o un GHOST per tenere basso l’allarme, oppure un BREACHER per aprire la strada.</li>
        <li><b>In 6:</b> squadra completa. Integrità, danno e allarme dei nemici restano uguali; cresce solo il numero di <b>droni</b> (uno per operativo). Più operativi non vuol dire più tempo, perché l’allarme sale a ogni turno di ciascuno.</li>
      </ul>
    </>,
  },
  {
    id:'statistiche', label:'STATISTICHE', icon:<Activity size={15}/>,
    content:<>
      <h2>Statistiche e valori</h2>
      <p>Il combattimento è ridotto all’osso: esistono solo la <b>vita</b> e il <b>danno</b>. Niente corazza, niente scudo, niente tiri di dado. La differenza fra un ruolo e l’altro sta nei valori della scheda, nelle <b>passive</b> e soprattutto nell’<b>abilità esclusiva</b>.</p>
      <h3>I valori operativi</h3>
      <ul>
        <li><b>INTEGRITÀ (HP)</b> — la tua vita, l’unica difesa. A zero vai <b>fuori combattimento</b> (vedi MECCANICHE DI GIOCO).</li>
        <li><b>DANNO ARMA</b> — il numero scritto di fianco all’arma (es. <Chip>Pistola ad arco +11</Chip>). Quando spari fai <b>esattamente quel danno</b>, sempre.</li>
        <li><b>CARICATORE</b> — i colpi disponibili. Ogni FUOCO ne consuma <b>1</b>; a caricatore vuoto FUOCO è bloccato finché non usi <b>RICARICA</b>, che lo riporta pieno al costo di un’azione. Le abilità non consumano colpi.</li>
        <li><b>FOCUS</b> — la risorsa delle azioni speciali. Costa <b>3</b> per l’ABILITÀ, <b>2</b> per INTRUSIONE, <b>1</b> per SBLOCCA PORTA, SCARICA e SIGILLA PORTA. Recuperi <b>+1 FOCUS alla fine del tuo turno</b> (+2 con <b>Uplink costante</b>), fino al tuo massimo.</li>
      </ul>
      <h3>Le passive</h3>
      <p>Ogni personaggio ha due passive sempre attive, elencate sulla sua scheda. Eccole tutte:</p>
      <table className="manual-table">
        <thead><tr><th>Passiva</th><th>Effetto</th></tr></thead>
        <tbody>
          <tr><td><b>Scassinatore esperto</b></td><td>SBLOCCA PORTA non consuma un’azione del turno (il focus sì).</td></tr>
          <tr><td><b>Senza traccia</b></td><td>Se nel turno non hai usato FUOCO né l’abilità, chiuderlo non fa salire l’allarme.</td></tr>
          <tr><td><b>Piastre di cromo</b></td><td>Ogni colpo nemico ti fa metà danni, arrotondati per eccesso.</td></tr>
          <tr><td><b>Ultima piastra</b></td><td>Un colpo che ti porterebbe a 0 ti lascia a 1 integrità. Si ricarica dopo 3 turni chiusi (di chiunque).</td></tr>
          <tr><td><b>Uplink costante</b></td><td>A fine turno recuperi 2 focus invece di 1.</td></tr>
          <tr><td><b>Apertura netta</b></td><td>FUOCO contro un ostile non ancora ingaggiato fa +50% danni — ma lo ingaggia.</td></tr>
          <tr><td><b>Rientro rapido</b></td><td>A terra, ti rialzi da solo dopo 1 turno saltato invece di 3, al 25% dell’integrità (solo ai rischi BASSO e MEDIO).</td></tr>
          <tr><td><b>Piede sull’acceleratore</b></td><td>La prima manovra del turno non consuma azioni.</td></tr>
          <tr><td><b>Colpo di grazia</b></td><td>La prima volta nel turno che elimini un ostile, recuperi l’azione appena usata.</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><Shield size={16}/><p>Non c’è nessuna formula: <b>il danno scritto è il danno inflitto</b>, sia il tuo sia quello dei nemici, e va <b>sempre a segno</b>. Puoi contare in anticipo quanti colpi servono — e quanti ne reggi tu. Le uniche eccezioni sono le passive qui sopra e le modifiche delle casse.</p></div>
    </>,
  },
  {
    id:'meccaniche', label:'MECCANICHE DI GIOCO', icon:<Timer size={15}/>,
    content:<>
      <h2>Meccaniche di gioco</h2>
      <h3>Il turno</h3>
      <p>La partita procede a <b>turni</b>: gli operativi giocano <b>uno alla volta</b>, sempre nello stesso ordine, in cerchio. Quando tutti hanno giocato si chiude un <b>round</b> e si riparte dal primo — il round è solo un contatore. La plancia mostra bene in alto <b>di chi è il turno</b>.</p>
      <ol className="manual-steps">
        <li>Tocca a un operativo: sul suo telefono ha <b>3 azioni</b> da spendere come vuole, fra manovre e azioni della console, nell’ordine che preferisce (anche la stessa azione più volte). Può anche usarne meno, o nessuna.</li>
        <li>Ogni scelta ha <b>effetto immediato</b>: il nemico colpito, la cura, il nodo violato valgono subito e non si possono disfare.</li>
        <li>Quando ha finito preme <b>FINE TURNO</b>.</li>
        <li><b>RISPOSTA HELIX:</b> gli ostili nella <b>stanza di chi ha chiuso il turno</b> lo colpiscono, uno dopo l’altro. Poi l’allarme sale di 1, chi ha chiuso recupera focus e gli ostili ingaggiati avanzano di una stanza verso la squadra.</li>
        <li>Sempre a ogni fine turno si aggiornano rinforzi, BLACKOUT, LOCKDOWN, conto alla rovescia, consegna del carico e vittoria/sconfitta. Poi la mano passa al prossimo operativo.</li>
      </ol>
      <div className="manual-callout"><Timer size={16}/><p>L’unità di tempo è il <b>turno</b>, non il round. Per questo ogni turno giocato vale la stessa pressione in 2 e in 6: la torre risponde a ogni FINE TURNO, chiunque l’abbia premuto.</p></div>
      <h3>La manovra</h3>
      <ul>
        <li>La <b>MANOVRA</b> costa <b>1 azione</b> (gratis la prima del turno con <b>Piede sull’acceleratore</b>) e si può ripetere finché hai azioni.</li>
        <li>Con una manovra raggiungi una stanza a <b>1 o 2 porte aperte</b> di distanza: arrivi direttamente lì.</li>
        <li><b>Non c’è colpo di sganciamento</b>, ma gli ostili non si seminano: tutti quelli nella stanza da cui parti, e in quella che attraversi, <b>ti seguono</b> subito nella stanza d’arrivo e ti agganciano.</li>
      </ul>
      <h3>Il tempo</h3>
      <ul>
        <li><b>Non c’è tempo limite.</b> Il giro sta fermo sull’operativo di mano finché non gioca il suo turno.</li>
        <li>Se il suo telefono è offline o assente, dalla plancia si salta con <b>SALTA TURNO</b>. Un turno saltato conta come chiuso: la torre risponde lo stesso.</li>
      </ul>
      <h3>Controlli dalla plancia</h3>
      <ul>
        <li><b>SALTA TURNO</b> — salta l’operativo di mano e passa al successivo.</li>
        <li><b>CHIUDI ROUND</b> — chiude subito il giro: gli operativi che non hanno giocato saltano il turno, uno alla volta, e a ognuno la torre risponde.</li>
        <li><b>TERMINA</b> — chiude la partita e torna alla configurazione. La plancia di ogni missione resta sempre la stessa.</li>
      </ul>
      <h3>Fuori combattimento</h3>
      <p>Un operativo a <b>0 integrità</b> va <b>a terra</b>. I suoi turni vengono saltati automaticamente. Andare a terra costa:</p>
      <ul>
        <li><b>+3% di allarme</b> alla squadra, ogni volta.</li>
        <li>Il <b>carico</b> (valigetta o informatore), che resta nella stanza.</li>
        <li><b>Tempo</b>: ai rischi BASSO e MEDIO salta i suoi prossimi <b>3 turni</b>, poi si <b>rialza da solo a 1 INTEGRITÀ</b> nella stanza dove è caduto e gioca subito il turno (con <b>Rientro rapido</b>: dopo 1 turno, al 25%). Ai rischi ALTO e BRUTALE non si rialza da solo.</li>
      </ul>
      <p>Un compagno nella stessa stanza può rialzarlo prima e meglio, con un’azione del proprio turno (a rischio BRUTALE non è possibile):</p>
      <ul>
        <li><b>RIPRISTINO</b> di un compagno → rientra al <b>25%</b> della sua integrità massima.</li>
        <li><b>Protocollo Lazarus</b> del RIPPER → rientra al <b>40%</b>.</li>
      </ul>
      <div className="manual-callout"><Users size={16}/><p>Se in un qualunque momento <b>nessun operativo resta in piedi</b>, la missione è persa. Integrità, danno e allarme iniziale <b>non cambiano</b> col numero di giocatori: cambiano solo i droni di partenza, tanti quanti i posti scelti in lobby (2 posti = 2 droni, 6 = 6).</p></div>
    </>,
  },
  {
    id:'plancia', label:'LA PLANCIA', icon:<Map size={15}/>,
    content:<>
      <h2>La plancia della missione</h2>
      <p>Ogni missione ha la <b>sua plancia fissa</b>: stessa mappa a ogni partita. Nomi delle stanze, porte, posizione di obiettivo, nodi e punto di consegna sono quelli mostrati nel briefing. Cambiare missione cambia la mappa.</p>
      <h3>Stanze quadrate e rettangolari</h3>
      <p>Il livello è una griglia di <b>5 colonne × 4 righe</b>. Una stanza occupa <b>una cella</b> (quadrata) oppure <b>due celle adiacenti</b> (rettangolare), in orizzontale o in verticale. <b>Due celle</b> della griglia restano <b>vuote</b>.</p>
      <p>La dimensione è puramente architettonica: una stanza grande <b>non</b> ospita più gente né dà bonus. Serve a rendere la pianta credibile e a spostare le distanze.</p>
      <h3>Vicine non vuol dire collegate</h3>
      <p>Questa è la regola che rende la plancia un labirinto: <b>due stanze possono condividere un muro e non avere nessuna porta</b>. Sulla plancia si vede a colpo d’occhio, perché fra loro non c’è nessun corridoio disegnato.</p>
      <ul>
        <li><b>Ogni stanza è raggiungibile</b> dalla zona di partenza: non esistono zone murate.</li>
        <li>Solo una parte dei muri diventa porta. Tutti gli altri restano <b>pareti cieche</b>.</li>
        <li>Si può passare <b>solo dalle porte aperte</b>: la console del telefono elenca le stanze davvero raggiungibili e blocca le altre.</li>
      </ul>
      <div className="manual-callout"><Shuffle size={16}/><p>Conseguenza pratica: la stanza che vedete <b>di fianco</b> a voi può richiedere <b>tre porte</b> per essere raggiunta. Guardate i corridoi disegnati, non la distanza sullo schermo.</p></div>
      <h3>Porte aperte e bloccate</h3>
      <ul>
        <li>Ogni porta è disegnata sul muro fra le due stanze: <b>verde</b> se aperta, <b>rossa</b> se bloccata. Almeno metà delle porte parte bloccata.</li>
        <li>Una porta bloccata non si attraversa: prima va aperta con l’azione <b>SBLOCCA PORTA</b>, da una delle due stanze che collega. Costa <b>1 FOCUS</b> e un’azione, e la porta resta aperta per tutti.</li>
        <li><b>BLACKOUT</b>: quando l’allarme raggiunge il <b>50%</b> la torre stacca la corrente e <b>ogni porta si richiude</b>, anche quelle già sbloccate. Succede una volta sola.</li>
        <li>Le porte fermano solo voi: <b>gli Helix passano anche da quelle bloccate</b>.</li>
      </ul>
      <h3>I segnalini della plancia</h3>
      <p>Nelle stanze compaiono pedine quadrate. Oltre a squadra e ostili ci sono i <b>segnalini di scenario e di missione</b>: passandoci sopra il mouse, ognuno dice cosa è.</p>
      <table className="manual-table">
        <thead><tr><th>Segnalino</th><th>Cosa indica</th></tr></thead>
        <tbody>
          <tr><td><b>Ritratto col bordo colorato</b></td><td>Un operativo. Il colore è quello del personaggio; grigio e opaco significa fuori combattimento.</td></tr>
          <tr><td><b>Bordo dorato</b></td><td>L’operativo che sta <b>portando la valigetta</b> o <b>scortando l’informatore</b>.</td></tr>
          <tr><td><b>Ritratto col bordo rosso</b></td><td>Un ostile. Se pulsa è <b>ingaggiato</b> e vi sta seguendo.</td></tr>
          <tr><td><b>S</b> (azzurro)</td><td><b>Zona di partenza</b>: la stanza da cui la squadra è entrata.</td></tr>
          <tr><td><b>N</b> (verde acido)</td><td><b>Nodo di rete</b> da violare. Pieno = già violato.</td></tr>
          <tr><td><b>T</b> (rosso)</td><td><b>Obiettivo</b>: teca, nucleo, cella, sorgente dati, reattore o culla. Tratteggiato = sigillato, pieno = aperto.</td></tr>
          <tr><td><b>▮</b> (dorato)</td><td><b>Valigetta MNEMOSYNE</b> a terra, l’<b>informatore</b> (in cella o lasciato solo), o il <b>trasferimento in corso</b> sulla sorgente dati.</td></tr>
          <tr><td><b>Ψ</b></td><td><b>SPETTRO</b> (missione 06).</td></tr>
          <tr><td><b>▼</b> (verde)</td><td><b>Punto di consegna</b>: dove va portato l’obiettivo e dove ci si estrae.</td></tr>
          <tr><td><b>Telecamera</b></td><td>Una <b>telecamera attiva</b>: si spegne con DISABILITA TELECAMERA.</td></tr>
          <tr><td><b>Alone giallo</b></td><td>La <b>cassa di potenziamento</b>. Spenta = svuotata.</td></tr>
          <tr><td><b>Battente verde / rosso</b></td><td>Una <b>porta</b> aperta o bloccata fra due stanze.</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><Footprints size={16}/><p>Prima mossa di ogni partita: <b>leggete la pianta insieme</b>. Contate le porte fra partenza, nodi, obiettivo e consegna. Su queste mappe il percorso migliore non è mai quello che sembra.</p></div>
    </>,
  },
  {
    id:'nebbia', label:'STANZE IN NEBBIA', icon:<EyeOff size={15}/>,
    content:<>
      <h2>Stanze in nebbia</h2>
      <p>Ogni missione ha <b>due stanze in nebbia</b>: zone che la squadra non ha ancora mai visto. Sulla plancia e sulla mini-mappa dei telefoni restano <b>velate</b>, con solo il nome.</p>
      <h3>Cosa non vedi</h3>
      <ul>
        <li>L’<b>arredo</b> e i <b>segnalini</b> della stanza: nodi, obiettivo, oggetti a terra.</li>
        <li>Le <b>casse di potenziamento</b> e le <b>telecamere</b>.</li>
        <li>Gli <b>ostili</b>: non compaiono sulla mappa e non sono nemmeno elencati nel pannello <b>MINACCE</b>.</li>
      </ul>
      <h3>Come si dirada</h3>
      <ul>
        <li>La nebbia cade <b>alla prima visita</b>: appena un operativo entra nella stanza, questa si illumina e il diario della missione lo segnala.</li>
        <li>Ogni stanza illuminata <b>resta visibile</b> per tutta la partita, anche se la squadra se ne va.</li>
        <li>La stanza di partenza non è mai in nebbia: conta come già visitata.</li>
      </ul>
      <h3>Cosa non cambia</h3>
      <ul>
        <li><b>La nebbia è solo visiva.</b> Gli ostili nascosti ci sono, presidiano la stanza e reagiscono come sempre: entrarci significa entrare in combattimento senza sapere chi c’è.</li>
        <li>Le <b>porte</b> valgono come al solito: le stanze in nebbia si raggiungono solo da una porta aperta.</li>
        <li>I ritratti della <b>squadra</b> restano sempre visibili, anche dentro una zona scura.</li>
      </ul>
      <div className="manual-callout"><EyeOff size={16}/><p>La prima stanza in nebbia è sempre un nodo da violare: <b>A01</b> (01), <b>C13</b> (02), <b>E14</b> (03), <b>C14</b> (04), <b>C07</b> (05), <b>E14</b> (06). La seconda è una stanza di passaggio: <b>E12</b> (01), <b>D07</b> (02), <b>D04</b> (03), <b>B02</b> (04), <b>E13</b> (05), <b>C02</b> (06). Preparatevi a trovare un presidio: entrate con l’integrità alta e con un’uscita già aperta alle spalle.</p></div>
    </>,
  },
  {
    id:'azioni', label:'LE AZIONI', icon:<Swords size={15}/>,
    content:<>
      <h2>Le azioni</h2>
      <p>Nel tuo turno hai <b>3 azioni</b>, da spendere in qualsiasi combinazione fra queste. Quasi tutte funzionano <b>solo dentro la stanza che occupi</b>: la console blocca da sola i pulsanti che in quel momento non hanno senso e ti dice perché.</p>
      <div className="manual-actions">
        <article><span><Footprints size={19}/></span><div><b>00 · MANOVRA</b><small>Costo: 1 azione · gratis la prima con Piede sull’acceleratore</small><p>Ti sposti in una stanza a <b>1 o 2 porte aperte</b> di distanza: tocca la stanza sulla mappa del telefono. Gli ostili della stanza da cui parti e di quella che attraversi <b>ti seguono</b> e ti agganciano.</p></div></article>
        <article><span><Swords size={19}/></span><div><b>01 · FUOCO</b><small>Costo: 1 azione · 1 colpo · serve un ostile a tiro</small><p>Attacchi un bersaglio <b>presente dove sei tu</b> (con CECCHINO anche oltre una porta aperta). Danno = <b>il valore della tua arma</b> (es. <Chip>+11</Chip>), sempre a segno.</p></div></article>
        <article><span><Cpu size={19}/></span><div><b>02 · INTRUSIONE</b><small>Costo: -2 FOCUS · serve un nodo nella tua stanza</small><p>Violi il nodo di <b>questa</b> stanza: <b>+1 nodo</b> e allarme <b>+5</b>. Servono <b>entrambi i nodi</b> per aprire l’obiettivo.</p></div></article>
        <article><span><HeartPulse size={19}/></span><div><b>03 · RIPRISTINO / RIANIMAZIONE</b><small>Costo: nessun FOCUS · agisce solo nella tua stanza</small><p>Se c’è un compagno a terra <b>nella tua stanza</b>, lo <b>rianima</b> al 25% (non a rischio BRUTALE). Altrimenti cura <b>te stesso</b> di <Chip>16</Chip>. Non cura altri operativi in piedi.</p></div></article>
        <article><span><Briefcase size={19}/></span><div><b>04 · AZIONE DI MISSIONE</b><small>Costo: 1 azione · cambia con la missione</small><p><b>RECUPERO</b> (01) raccoglie la valigetta: nella teca <b>solo dopo</b> 2 nodi, altrove ovunque sia caduta. <b>PURGA</b> (02) cancella il nucleo, dal nucleo e a firewall abbattuto. <b>LIBERA</b> (03) fa uscire l’informatore dalla cella aperta, o riprende la scorta se è rimasto solo. <b>SCARICA</b> (04, -1 FOCUS) avanza il trasferimento di +1 dalla sorgente aperta: <b>ne servono 4</b>, da chiunque sia lì. <b>INNESCO</b> (05) arma la carica sul reattore aperto: parte un conto alla rovescia di 6 turni. <b>CATTURA</b> (06) chiude la gabbia su SPETTRO: solo nella sua stanza e solo quando è <b>braccato</b>. In quella missione la carta porta diventa anche <b>SIGILLA</b> (-1 FOCUS): richiude una porta aperta.</p></div></article>
        <article><span><DoorOpen size={19}/></span><div><b>05 · SBLOCCA PORTA</b><small>Costo: -1 FOCUS · 1 azione (gratis con Scassinatore esperto)</small><p>Apre una porta bloccata della tua stanza verso una stanza collegata. Se ce n’è più di una, scegli quale dal menu sotto i pulsanti. La porta resta aperta per tutti.</p></div></article>
        <article><span><RefreshCw size={19}/></span><div><b>06 · RICARICA</b><small>Costo: 1 azione · caricatore non pieno</small><p>Riporta il caricatore al massimo. Senza colpi FUOCO resta bloccato.</p></div></article>
        <article><span><CameraOff size={19}/></span><div><b>07 · DISABILITA TELECAMERA</b><small>Costo: 1 azione · serve una telecamera attiva nella tua stanza</small><p>Ogni plancia ha <b>3 telecamere</b> in stanze fisse. Spegnerne una abbassa l’allarme del <b>2%</b>, per sempre. Se restano accese non succede nulla: sono un incentivo a passarci.</p></div></article>
        <article><span><PackagePlus size={19}/></span><div><b>08 · APRI CASSA</b><small>Costo: 1 azione · stanza senza ostili · arma ancora di serie</small><p>Estrai <b>una modifica a caso</b> dalla cassa di potenziamento, valida per il resto della partita. Una modifica a testa. Vedi il capitolo <b>CASSE E MODIFICHE</b>.</p></div></article>
        <article><span><Zap size={19}/></span><div><b>ABILITÀ</b><small>Costo: -3 FOCUS · 1 azione</small><p>La mossa esclusiva del tuo personaggio, con la sua portata. Vedi il capitolo <b>ABILITÀ ESCLUSIVE</b>.</p></div></article>
      </div>
      <h3>Scegliere il bersaglio</h3>
      <p>Il menu <b>BERSAGLIO</b> elenca gli ostili <b>presenti nella tua stanza</b> — e, se hai la modifica <b>CECCHINO</b>, anche quelli di una stanza collegata da una porta aperta. Se non c’è nessuno a tiro il menu è spento e FUOCO è bloccato: prima devi raggiungerli.</p>
      <div className="manual-callout"><DoorOpen size={16}/><p>Un compagno a terra può essere rianimato <b>solo da chi si trova nella sua stessa stanza</b>. Se cade da solo dietro le linee, qualcuno deve andarlo a prendere — e se aveva la valigetta, deve andarla a riprendere lì.</p></div>
      <div className="manual-callout"><Target size={16}/><p>Quando tocca a te, gioca senza esitare e premi <b>FINE TURNO</b>: il giro va avanti solo quando l’operativo di mano ha finito. Ricorda che chiudi il turno <b>nella stanza in cui ti trovi</b>: se ci sono ostili, i loro colpi arrivano a te.</p></div>
    </>,
  },
  {
    id:'casse', label:'CASSE E MODIFICHE', icon:<PackagePlus size={15}/>,
    content:<>
      <h2>Casse di potenziamento e modifiche</h2>
      <p>Ogni plancia nasconde <b>una cassa di potenziamento</b>, riconoscibile dall’<b>alone giallo</b> sulla mappa. Dentro ci sono <b>modifiche per l’arma</b>: pezzi che cambiano il modo in cui spari e restano con te fino a fine partita.</p>
      <h3>Come funziona la cassa</h3>
      <ul>
        <li><b>Dov’è.</b> Sempre nella stessa stanza della missione, a ogni partita. Mai nella zona di partenza, nell’obiettivo o alla consegna.</li>
        <li><b>APRI CASSA</b> costa <b>1 azione</b> e si fa dalla stanza della cassa. Esce <b>una modifica a caso</b>, equipaggiata sul momento; un pop-up sulla plancia mostra chi l’ha trovata e quale.</li>
        <li><b>Stanza ripulita.</b> Finché c’è anche un solo ostile nella stanza la cassa non si apre: prima si ripulisce, poi si saccheggia.</li>
        <li><b>Una modifica a testa.</b> Chi ha già la sua modifica non può aprire altre casse: le restanti toccano ai compagni.</li>
        <li><b>Quante ne contiene.</b> Tante modifiche quanti sono i posti scelti al setup, <b>una per apertura</b>. A cassa vuota resta disegnata sulla mappa ma spenta.</li>
        <li><b>Dove la vedi.</b> La tua modifica compare sul telefono <b>sopra il nome dell’arma</b>, con il suo effetto nella descrizione.</li>
      </ul>
      <h3>Le modifiche che puoi trovare</h3>
      <p>Sono cinque, tutte con la stessa probabilità. La pesca è casuale e <b>può ripetersi</b> fra operativi diversi: due compagni possono ritrovarsi la stessa modifica.</p>
      <table className="manual-table">
        <thead><tr><th>Modifica</th><th>Effetto</th><th>Note</th></tr></thead>
        <tbody>
          <tr><td><b>CARICATORE ESTESO</b></td><td><b>+5 colpi</b> nel caricatore.</td><td>Alza sia il massimo sia i colpi in canna: subito 5 colpi in più.</td></tr>
          <tr><td><b>COLPO DOPPIO</b></td><td><b>50%</b> di possibilità di <b>raddoppiare</b> il danno di FUOCO.</td><td>Tirata a ogni FUOCO. Si applica dopo gli altri bonus di danno.</td></tr>
          <tr><td><b>CECCHINO</b></td><td>FUOCO colpisce anche gli ostili di una <b>stanza collegata</b>.</td><td>Solo oltre una <b>porta aperta</b>: una porta bloccata ferma il colpo. Chi viene colpito da fuori stanza si aggancia e vi insegue.</td></tr>
          <tr><td><b>CANNA RINFORZATA</b></td><td><b>+2 danni</b> fissi a ogni FUOCO.</td><td>Sale direttamente il valore dell’arma sulla scheda.</td></tr>
          <tr><td><b>MODULO TERMICO</b></td><td>FUOCO di fila sullo <b>stesso bersaglio</b>: <b>+20%</b> al secondo colpo, <b>+30%</b> dal terzo.</td><td>Il primo colpo non ha bonus. Cambiare bersaglio azzera la serie, e anche abbatterlo.</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><Lightbulb size={16}/><p>Aprire la cassa costa un’azione: fatelo a stanza sicura. Le modifiche valgono solo per FUOCO, non per le abilità: rendono di più a chi spara di più.</p></div>
    </>,
  },
  {
    id:'abilita', label:'ABILITÀ ESCLUSIVE', icon:<Zap size={15}/>,
    content:<>
      <h2>Abilità esclusive</h2>
      <p>Ogni abilità costa <b>3 FOCUS</b> e un’azione, e non consuma colpi. Recuperi 1 FOCUS alla fine di ogni tuo turno (2 con Uplink costante): sceglierne il momento è la decisione più importante della partita.</p>
      <table className="manual-table">
        <thead><tr><th>Ruolo</th><th>Abilità</th><th>Effetto esatto</th></tr></thead>
        <tbody>
          <tr><td>GHOST</td><td>Passo fantasma</td><td>Danno <Chip>26</Chip> a un ostile <b>nella tua stanza</b>.</td></tr>
          <tr><td>CHROME</td><td>Sovraccarico cromo</td><td>Danno <Chip>40</Chip> a un ostile <b>nella tua stanza</b>, il più alto del gioco.</td></tr>
          <tr><td>CIPHER</td><td>Zero-day</td><td><b>+1 nodo</b> su un nodo nella tua stanza <b>o in una collegata</b> (anche da una porta bloccata), e <Chip>25</Chip> danni a ogni drone nello stesso raggio.</td></tr>
          <tr><td>RIPPER</td><td>Protocollo Lazarus</td><td><b>+22 integrità</b> o rianimazione al 40% per <b>al massimo 2 operativi</b> nella sua stanza (lui compreso): prima i caduti, poi i più feriti. A rischio BRUTALE cura soltanto.</td></tr>
          <tr><td>FACE</td><td>Identità sintetica</td><td><b>Allarme −2</b> e gli ostili <b>della sua stanza</b> sono distratti: saltano il prossimo colpo e il prossimo passo d’inseguimento.</td></tr>
          <tr><td>DRIVER</td><td>Sciame MANTA</td><td>Danno <Chip>18</Chip> a <b>due ostili</b> nella sua stanza o in una collegata (anche da una porta bloccata).</td></tr>
          <tr><td>BREACHER</td><td>Carica da breccia</td><td>Danno <Chip>20</Chip> a <b>tutti gli ostili</b> nella sua stanza e <b>apre ogni porta bloccata</b> della stanza.</td></tr>
          <tr><td>HANDLER</td><td>Impulso di squadra</td><td><b>+4 focus</b> a <b>al massimo 2 compagni</b> in piedi nella sua stanza: prima chi ne ha meno.</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><Zap size={16}/><p>Lo <b>Zero-day</b> del CIPHER è l’unico modo per violare un nodo <b>senza entrare nella stanza presidiata</b>: basta stare in una stanza collegata, anche dietro una porta bloccata.</p></div>
      <div className="manual-callout"><HeartPulse size={16}/><p><b>Identità sintetica</b> non disingaggia nessuno: fa saltare un colpo e un passo agli ostili presenti, cioè vi regala <b>una stanza di vantaggio</b> nella fuga col bottino. Usata l’abilità, però, <b>Senza traccia</b> non vale per quel turno.</p></div>
    </>,
  },
  {
    id:'nemici', label:'NEMICI E MINACCE', icon:<Skull size={15}/>,
    content:<>
      <h2>Nemici e minacce</h2>
      <p>I nemici non tirano dadi: colpiscono sempre, ma <b>solo chi chiude il turno nella loro stanza</b>. Fuori contatto non fanno danno: la distanza è una difesa reale.</p>
      <h3>Presidio, non pattuglia</h3>
      <p>Gli Helix <b>non girano per la mappa da soli</b>. Ogni unità è assegnata a una stanza — quella dove c’è qualcosa da difendere — e ci resta ferma finché non viene <b>ingaggiata</b>:</p>
      <ul>
        <li><b>Ingaggio.</b> Un’unità si ingaggia quando chiudi il turno nella sua stanza, quando esci (o passi) dalla sua stanza con lei dentro, o quando le spari con Apertura netta o da fuori stanza. Da quel momento <b>non torna più in postazione</b>.</li>
        <li><b>Inseguimento.</b> Un’unità ingaggiata vi segue di <b>una stanza a ogni turno che si chiude</b>, e <b>le porte bloccate non la fermano</b>. Se è già nella stanza di un operativo in piedi resta lì.</li>
        <li><b>Se il suo bersaglio cade</b>, aggancia l’operativo in piedi più vicino e riprende l’inseguimento.</li>
      </ul>
      <h3>Chi viene colpito</h3>
      <p>A ogni FINE TURNO <b>ogni</b> ostile nella stanza di chi ha chiuso il turno colpisce <b>proprio lui</b>, uno dopo l’altro. I compagni nella stessa stanza non vengono toccati. Lo stesso vale per un turno saltato dalla plancia.</p>
      <p>Alcuni eventi svegliano <b>tutti</b> i presidi insieme, anche quelli mai visti: <b>PURGA</b> (02), <b>trasferimento completo</b> (04), <b>INNESCO</b> e detonazione (05), <b>CATTURA</b> (06) e il <b>LOCKDOWN</b> al 70% d’allarme.</p>
      <p>Sulla plancia il pannello MINACCE dice per ognuno se è <b>DI PRESIDIO</b> (fermo, non vi ha ancora visti), <b>VI INSEGUE</b> o <b>IN CONTATTO CON LA SQUADRA</b>.</p>
      <div className="manual-callout"><Map size={16}/><p>Questo cambia tutto il gioco: <b>evitare una stanza significa evitare il suo presidio</b>. Ma ogni stanza che vi serve — nodi, obiettivo e consegna — ha una guardia dentro. L’ingaggio non è un incidente: è il prezzo dell’obiettivo, e sta a voi decidere quante volte pagarlo.</p></div>
      <h3>Le unità</h3>
      <table className="manual-table">
        <thead><tr><th>Unità</th><th>Tipo</th><th>Integrità</th><th>Danno</th><th>Presidia</th></tr></thead>
        <tbody>
          <tr><td>WASP D-2</td><td>DRONE</td><td>45</td><td>+16</td><td>Stanze fisse della plancia: operativi − 1 (da 1 a 5)</td></tr>
          <tr><td>HELIX SEGUGIO</td><td>CACCIATORE</td><td>50</td><td>+22</td><td>Entra già in caccia dai picchi d’allarme</td></tr>
          <tr><td>HELIX SEC-4</td><td>FANTERIA</td><td>60</td><td>+28</td><td>Nodi (più un rinforzo fisso nelle missioni 02, 03, 04)</td></tr>
          <tr><td>CUSTODE K-9</td><td>ÉLITE</td><td>140</td><td>+32</td><td>Obiettivo della missione</td></tr>
          <tr><td>HELIX GOLIATH</td><td>PESANTE</td><td>200</td><td>+40</td><td>Punto di consegna</td></tr>
        </tbody>
      </table>
      <p className="manual-muted">Valori base (rischio MEDIO). Il rischio li cambia: −10% a BASSO, +10% ad ALTO, +20% a BRUTALE. Il numero di giocatori non li cambia mai.</p>
      <h3>Traccia Helix</h3>
      <ul>
        <li>A ogni <b>soglia d’allarme</b> (25 / 35 / 45 / 55 / 65 / 75 / 85%) entra <b>un HELIX SEGUGIO</b> nella <b>penultima stanza prima dell’EXIT</b> (quella che dà sull’uscita), <b>già in caccia</b>: i SEGUGI si accumulano lì, sulla via d’estrazione. Ogni soglia scatta una volta sola.</li>
        <li>Più a lungo restate dentro, più l’allarme sale e più cacciatori vi trovate alle spalle: il tempo lavora contro di voi.</li>
      </ul>
      <div className="manual-callout"><Skull size={16}/><p>Il <b>CUSTODE K-9</b> e l’<b>HELIX GOLIATH</b> non vanno per forza abbattuti. Il K-9 si può trascinare dietro di voi; il GOLIATH invece blocca l’estrazione finché resta nel punto di consegna. Ingaggiatelo e portatelo fuori dalla stanza, oppure abbattetelo insieme.</p></div>
    </>,
  },
  {
    id:'allarme', label:'ALLARME E NODI', icon:<ShieldAlert size={15}/>,
    content:<>
      <h2>Allarme e nodi</h2>
      <h3>I nodi (0 → 2)</h3>
      <p>Sulla plancia ci sono <b>due nodi</b>, e servono <b>entrambi</b> per aprire l’obiettivo: non c’è scelta, vanno violati tutti e due. Ogni nodo violato fa salire l’allarme di 5.</p>
      <h3>L’allarme (0% → 100%)</h3>
      <p>Parte dal <b>15–18%</b> a seconda del rischio e rappresenta quanto la Helix sa di voi. <b>A 100% avete perso</b>, anche se siete tutti in piedi.</p>
      <table className="manual-table">
        <thead><tr><th>Cosa lo fa salire</th><th>Cosa lo fa scendere</th></tr></thead>
        <tbody>
          <tr><td>Il respiro della torre: <b>+1</b> a ogni turno che si chiude, giocato o saltato (non con <b>Senza traccia</b>).</td><td>Identità sintetica del FACE: <b>−2</b>.</td></tr>
          <tr><td>Ogni <b>nodo violato</b>: <b>+5</b>.</td><td>Ogni <b>telecamera disabilitata</b>: <b>−2</b> (3 per plancia).</td></tr>
          <tr><td>L’<b>obiettivo della missione</b> — valigetta staccata, PURGA, informatore liberato, INNESCO, CATTURA: <b>+10</b>.</td><td>—</td></tr>
          <tr><td>Ogni ciclo di <b>SCARICA</b> (missione 04): <b>+3</b>, fino a 4 volte.</td><td>—</td></tr>
          <tr><td>Ogni <b>operativo a terra</b>: <b>+3</b>.</td><td>—</td></tr>
          <tr><td><b>SPETTRO</b> sveglio e libero (missione 06): <b>+1</b> a ogni fine turno.</td><td>—</td></tr>
        </tbody>
      </table>
      <h3>Le soglie</h3>
      <table className="manual-table">
        <thead><tr><th>Allarme</th><th>Cosa succede</th></tr></thead>
        <tbody>
          <tr><td><b>25 / 35 / 45 / 55 / 65 / 75 / 85%</b></td><td>Entra un <b>HELIX SEGUGIO</b> già in caccia.</td></tr>
          <tr><td><b>50%</b></td><td><b>BLACKOUT</b>: ogni porta della plancia si richiude.</td></tr>
          <tr><td><b>70%</b></td><td><b>LOCKDOWN</b>: ogni presidio, anche mai ingaggiato, converge sulla squadra.</td></tr>
          <tr><td><b>100%</b></td><td>Sconfitta.</td></tr>
        </tbody>
      </table>
      <div className="manual-callout"><Gauge size={16}/><p>Conto della serva: l’allarme si misura in <b>turni</b>, non in round. In 6 un round dura tre volte più che in 2, ma ogni turno pesa uguale: il margine è lo stesso per qualunque squadra. Se ci arrivate, il problema di solito non è l’ago: siete rimasti impigliati nei combattimenti e siete andati a terra troppe volte.</p></div>
    </>,
  },
  {
    id:'esito', label:'VITTORIA E SCONFITTA', icon:<Trophy size={15}/>,
    content:<>
      <h2>Come finisce la partita</h2>
      <h3>Vittoria</h3>
      <p>Servono <b>entrambe</b> le condizioni alla fine di un turno:</p>
      <ul>
        <li><b>Obiettivo completato</b> — valigetta (01) o informatore (03) consegnati: chi li porta ha chiuso un turno dentro il <b>punto di consegna</b>. PURGA lanciata (02), trasferimento completo (04), reattore <b>detonato</b> (05), SPETTRO catturato (06).</li>
        <li><b>Estrazione</b> — <b>ogni operativo in piedi si trova nel punto di consegna</b> e nella stanza <b>non c’è nessun ostile</b>.</li>
      </ul>
      <p>Chi è a terra <b>non conta</b> per l’estrazione, ma resta indietro: se volete portarli fuori davvero, rianimateli prima.</p>
      <p>Ogni missione è divisa in fasi e la plancia dice sempre quale state giocando (per la valigetta: <b>RETE</b>, <b>RECUPERO</b>, <b>TRASPORTO</b>, <b>ESTRAZIONE</b>).</p>
      <h3>Sconfitta</h3>
      <p>Basta <b>una</b> di queste:</p>
      <ul>
        <li><b>Squadra sterminata</b>: nessun operativo resta in piedi.</li>
        <li><b>Allarme al 100%</b>: la Helix satura il settore e il segnale clandestino è perduto.</li>
        <li><b>Informatore ucciso</b> (missione 03).</li>
      </ul>
      <div className="manual-callout"><Trophy size={16}/><p>Errore classico: aprire l’obiettivo al terzo round e poi impiegarne sei per tornare indietro, raccogliendo presidi a ogni stanza. <b>Studiate la via del ritorno prima di agire sull’obiettivo</b>, non dopo.</p></div>
      <div className="manual-callout"><DoorOpen size={16}/><p>Secondo errore classico: arrivare alla consegna con mezza squadra sparpagliata o con un ostile ancora dentro. La consegna <b>non chiude la partita</b>: la chiude l’ultimo operativo che entra in una stanza sgombra.</p></div>
    </>,
  },
  {
    id:'tattiche', label:'CONSIGLI TATTICI', icon:<Lightbulb size={15}/>,
    content:<>
      <h2>Consigli tattici</h2>
      <h3>Per la squadra</h3>
      <ul>
        <li><b>Leggete la mappa nel primo round.</b> Ogni missione ha sempre la stessa plancia: individuate subito i due nodi e la via più corta fra obiettivo e consegna.</li>
        <li><b>Dividetevi sui due nodi.</b> Vanno violati entrambi: mandare qualcuno su ciascuno in parallelo è più veloce che farli in sequenza.</li>
        <li><b>Non entrate nelle stanze che non vi servono.</b> Un presidio non ingaggiato è un nemico che non esiste.</li>
        <li><b>Parlate ad alta voce.</b> Anche se si gioca a turni, chi ha la mano deve dire dove va: senza coordinarvi finite tutti nella stessa stanza sbagliata.</li>
        <li><b>Decidete prima chi porta il carico.</b> Meglio uno robusto (CHROME su tutti): se cade, valigetta o informatore restano a terra.</li>
        <li><b>Scortate il portatore.</b> Chi lo accompagna deve stare nella <b>sua stessa stanza</b>, altrimenti non può rialzarlo.</li>
        <li><b>Pensate al GOLIATH</b> prima di arrivare alla consegna: va attirato fuori o abbattuto, altrimenti l’estrazione non scatta.</li>
        <li><b>Spegnete le telecamere di passaggio.</b> Un’azione per −2% d’allarme è quasi sempre un buon affare.</li>
      </ul>
      <h3>Per il singolo</h3>
      <ul>
        <li><b>Chiudi il turno fuori contatto</b> quando puoi: prendi i colpi solo se premi FINE TURNO in una stanza con ostili. Spara e poi spostati — sapendo che chi era nella stanza ti seguirà.</li>
        <li>Se porti la valigetta, <b>non fermarti mai a combattere</b>: ogni turno in più è un turno in cui non stai avanzando verso la consegna.</li>
        <li>Non tenere il FOCUS in banca. Un’abilità non usata a fine partita è un’abilità sprecata.</li>
        <li>Tieni d’occhio il <b>caricatore</b>: ricaricare nel turno sbagliato costa un’azione quando serve di più.</li>
        <li>Il CHROME ha il colpo singolo più pesante (40 con l’abilità) e dimezza i danni subiti: mandalo avanti lui sui presidi più duri.</li>
      </ul>
      <div className="manual-callout"><Lightbulb size={16}/><p>Apertura tipo di una squadra che vince: CIPHER e scorta verso i due nodi, CHROME che apre la strada verso l’obiettivo, RIPPER un passo indietro sulla via del ritorno. Nessuno entra in una stanza che non serve all’obiettivo.</p></div>
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
        <dd>O <b>non c’è nessuna porta</b> fra le due (sono vicine ma separate da un muro), o la porta è <b>bloccata</b>, o è a più di 2 porte di distanza. Guarda i corridoi disegnati sulla plancia.</dd>
        <dt>FUOCO è spento</dt>
        <dd>Nessun ostile a tiro, oppure il <b>caricatore è vuoto</b>: usa RICARICA.</dd>
        <dt>Non riesco a prendere la valigetta</dt>
        <dd>O la <b>teca è ancora sigillata</b> (servono 2 nodi violati), o la valigetta <b>non è nella tua stanza</b>, o ce l’ha già un compagno. La console lo scrive sotto il pulsante RECUPERO.</dd>
        <dt>Siamo tutti alla consegna ma la partita non finisce</dt>
        <dd>Controlla che l’obiettivo sia davvero completato e che nella stanza <b>non ci siano ostili</b>. L’estrazione si verifica alla fine di un turno.</dd>
        <dt>Il giro è fermo su un operativo</dt>
        <dd>È il suo turno e il suo telefono non ha ancora giocato (offline o assente). La plancia mostra di chi è il turno: usa <b>SALTA TURNO</b> per passare oltre, o <b>CHIUDI ROUND</b> per chiudere tutto il giro.</dd>
        <dt>La console del telefono è illeggibile</dt>
        <dd>Ruota il dispositivo in <b>orizzontale</b> e disattiva il blocco rotazione.</dd>
        <dt>Vogliamo una mappa diversa</dt>
        <dd>Ogni missione ha la sua plancia fissa: dalla plancia premi <b>TERMINA</b> (o <b>RICOMPONI SQUADRA</b> dalla lobby), crea un nuovo canale e scegli un’altra missione.</dd>
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

// Guida per telefono (console giocatore): versione ridotta del manuale, pensata per lo
// schermo piccolo in orizzontale — una colonna di sezioni a fisarmonica, frasi brevi, niente
// tabelle. I dettagli completi restano nel manuale della plancia (`chapterList`).
type GuideRow = [string, string, string?];
const guideSections:{id:string;title:string;hint:string;icon:React.ReactNode;rows?:GuideRow[];points?:React.ReactNode[]}[]=[
  {id:'turno',title:'IL TUO TURNO',hint:'3 azioni, poi FINE TURNO',icon:<Timer size={18}/>,points:[
    <>Si gioca <b>uno alla volta</b>. Quando tocca a te hai <b>3 azioni</b>, nell’ordine che vuoi.</>,
    <>Ogni azione ha <b>effetto subito</b>. Quando hai finito premi <b>FINE TURNO</b>.</>,
    <>Alla fine gli ostili <b>nella tua stanza</b> ti colpiscono, l’allarme sale di 1 e recuperi 1 focus.</>,
    <>Nessun tempo limite: ragiona con calma.</>,
  ]},
  {id:'azioni',title:'LE AZIONI',hint:'Cosa puoi fare nel turno',icon:<Swords size={18}/>,rows:[
    ['MANOVRA','1 azione','Ti sposti in una stanza a 1–2 porte aperte. Gli ostili vicini ti seguono.'],
    ['FUOCO','1 azione','Danno dell’arma, sempre a segno. Usa 1 colpo del caricatore.'],
    ['RICARICA','1 azione','Riempie il caricatore. A zero colpi FUOCO è bloccato.'],
    ['INTRUSIONE','2 focus','Viola il nodo della stanza. Ne servono 2 per aprire l’obiettivo.'],
    ['RIPRISTINO','gratis','Rianima un compagno a terra nella tua stanza, o cura te di 16.'],
    ['SBLOCCA PORTA','1 focus','Apre una porta rossa della tua stanza, per tutti.'],
    ['MISSIONE','1 azione','Azione speciale dell’obiettivo (RECUPERO, PURGA, LIBERA…).'],
    ['TELECAMERA','1 azione','Spegne una telecamera nella stanza: allarme −2%.'],
    ['APRI CASSA','1 azione','Una modifica per l’arma, a stanza libera. Una a testa.'],
    ['ABILITÀ','3 focus','La mossa esclusiva del tuo operativo.'],
  ]},
  {id:'missione',title:'COME SI VINCE',hint:'Obiettivo e sconfitta',icon:<Trophy size={18}/>,points:[
    <><b>1.</b> Viola i <b>2 nodi</b> di rete (INTRUSIONE).</>,
    <><b>2.</b> Raggiungi l’<b>obiettivo</b> e agisci (azione di missione).</>,
    <><b>3.</b> Porta il carico al punto di consegna <b>▼</b>.</>,
    <><b>4.</b> Tutti gli operativi <b>in piedi</b> nella stanza di consegna, senza ostili.</>,
    <><b>Sconfitta:</b> allarme al <b>100%</b>, nessun operativo in piedi, o informatore morto.</>,
  ]},
  {id:'allarme',title:'ALLARME',hint:'Sale ogni turno: non perdere tempo',icon:<ShieldAlert size={18}/>,rows:[
    ['Sale','+1 ogni turno chiuso'],
    ['Sale','+5 nodo violato · +10 obiettivo · +3 operativo a terra'],
    ['Scende','−2 per telecamera spenta (e abilità del FACE)'],
    ['25–85%','Entra un SEGUGIO in caccia a ogni soglia (+10%)'],
    ['50%','BLACKOUT: tutte le porte si richiudono'],
    ['70%','LOCKDOWN: tutti i presidi vi danno la caccia'],
    ['100%','Sconfitta'],
  ]},
  {id:'nemici',title:'NEMICI',hint:'Presidi fermi, poi inseguitori',icon:<Skull size={18}/>,points:[
    <>Gli Helix <b>presidiano una stanza</b> e restano fermi finché non li ingaggi.</>,
    <>Ingaggiati, ti <b>inseguono di una stanza a turno</b> e le porte chiuse non li fermano.</>,
    <>Colpiscono <b>solo chi chiude il turno</b> nella loro stanza: chiudi il turno fuori contatto.</>,
    <>Evitare una stanza significa evitarne il presidio.</>,
  ]},
  {id:'terra',title:'SE VAI A TERRA',hint:'A 0 integrità',icon:<HeartPulse size={18}/>,points:[
    <>Salti i turni e l’allarme sale di <b>3%</b>. Il carico resta nella stanza.</>,
    <>Un compagno <b>nella tua stessa stanza</b> può rianimarti con RIPRISTINO.</>,
    <>A rischio BASSO/MEDIO ti rialzi da solo dopo 3 turni; ad ALTO solo con aiuto; a BRUTALE no.</>,
  ]},
  {id:'consigli',title:'CONSIGLI',hint:'Per giocare meglio',icon:<Lightbulb size={18}/>,points:[
    <>Leggete la mappa <b>insieme</b> e dividetevi sui due nodi.</>,
    <>Conta le <b>porte</b>, non la distanza sullo schermo: stanza vicina ≠ collegata.</>,
    <>Non lasciare il focus inutilizzato: usa l’abilità al momento giusto.</>,
    <>Chi porta il carico non si ferma a combattere.</>,
  ]},
  {id:'problemi',title:'SE QUALCOSA NON VA',hint:'Pulsanti spenti e simili',icon:<LifeBuoy size={18}/>,rows:[
    ['Stanza non scelta','Manca la porta, è rossa (bloccata) o è oltre 2 porte.'],
    ['FUOCO spento','Nessun ostile a tiro o caricatore vuoto: RICARICA.'],
    ['Giro fermo','Un telefono è offline: dalla plancia SALTA TURNO.'],
    ['Offline','Riapri l’app: il collegamento si ripristina da solo.'],
  ]},
];

export function MobileGuide(){
  const [open,setOpen]=useState<string>('turno');
  return <div className="mguide">
    {guideSections.map((s)=>{
      const on=open===s.id;
      return <section className={`mg-sec ${on?'open':''}`} key={s.id}>
        <button type="button" className="mg-head" aria-expanded={on} onClick={()=>setOpen(on?'':s.id)}>
          <span className="mg-icon">{s.icon}</span>
          <span className="mg-title"><b>{s.title}</b><small>{s.hint}</small></span>
          <i className="mg-chev" aria-hidden="true"/>
        </button>
        {on&&<div className="mg-body">
          {s.points&&<ul>{s.points.map((p,i)=><li key={i}>{p}</li>)}</ul>}
          {s.rows&&<dl>{s.rows.map(([k,a,b],i)=><div key={i}><dt>{k}{b!==undefined&&<small>{a}</small>}</dt><dd>{b??a}</dd></div>)}</dl>}
        </div>}
      </section>;
    })}
  </div>;
}

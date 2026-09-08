# Roverpunk — MVP locale

Gioco cooperativo cyberpunk per una plancia principale e 2–6 telefoni. Il computer gestisce autonomamente turni, nemici, allarme, danni e risoluzione delle azioni.

La plancia è una **mappa a stanze**: ogni operativo occupa una casella precisa del livello 27 della Helix Tower, ci si muove una porta per round e si combatte soltanto con chi condivide la stessa stanza.

## Avvio rapido

Su macOS fai doppio clic su `Avvia Roverpunk.command`. In alternativa, apri il Terminale in questa cartella ed esegui:

```bash
npm run dev
```

La plancia si apre su `http://localhost:5173`. Il Terminale mostra anche l’indirizzo di rete da aprire sui telefoni.

## Collegamento dei giocatori

1. Computer e telefoni devono essere collegati alla stessa rete Wi-Fi.
2. Dalla plancia scegli da 2 a 6 giocatori, assegna i personaggi e crea il canale.
3. Su ogni telefono apri l’indirizzo mostrato dalla lobby.
4. Inserisci il codice partita, scegli il tuo operativo e ruota il telefono in orizzontale.
5. Quando la squadra è pronta, avvia l’operazione dalla plancia.

Il pulsante **AVVIA OPERAZIONE** resta bloccato finché non è collegato almeno un telefono.

Lo stato della partita viene salvato localmente in `data/game-state.json`, quindi un riavvio del server non cancella automaticamente la sessione: i telefoni si ricollegano da soli.

## La plancia

Il livello è una griglia di nove stanze collegate da corridoi.

```
A02 CONDOTTI ─── B07 SERVER FARM ─── D03 SICUREZZA
     │                │      │             │
A01 ACCESSO ───── C02 NEXUS ─┼──────── C09 LAB NERO
     │                │      │             │
A03 GARAGE ────── B04 ARCHIVIO ─────── E05 PONTE
```

- **A01 ACCESSO** — partenza e zona di estrazione.
- **B07 · B04 · D03** — i tre nodi di rete da violare: bisogna raggiungerli fisicamente.
- **C09 LAB NERO** — tana del Custode K-9.
- **A02 · A03 · E05** — stanze di copertura: la COPERTURA vale +6 scudo.
- **C02 NEXUS** — snodo rapido ma zona esposta: chi ci resta a fine round alza l'allarme.

Regole di posizione:

- La **MANOVRA** è un'azione: chi si sposta quel round non spara e non viola nodi. Si entra solo in una stanza collegata.
- **FUOCO**, **RIPRISTINO** e quasi tutte le abilità agiscono solo dentro la stanza occupata. Un compagno a terra può essere rianimato solo da chi si trova con lui.
- Sganciarsi da una stanza presidiata costa metà del danno dell'ostile e +3 di allarme.
- I nemici colpiscono solo chi condivide la stanza. Fuori contatto vi rilevano entro 1 corridoio (2 con allarme ≥45%, 3 con allarme ≥75%), altrimenti rientrano in pattuglia: tenere l'allarme basso permette di aggirarli.
- Il Custode K-9 presidia il LAB NERO finché la breccia non arriva a 3/3, poi si sgancia e insegue la squadra.

La missione ha tre fasi: violare i tre nodi, neutralizzare il K-9, riportare **ogni operativo vivo in A01** per l'estrazione.

## Come scorre un round

- Ogni round ha un tempo massimo: 90 secondi in RECLUTA, 75 in STANDARD, 60 in BRUTALE. Il countdown è visibile sulla plancia e su ogni telefono.
- Il round si chiude appena tutti i giocatori hanno trasmesso il comando, oppure allo scadere del tempo: chi non risponde va in copertura automatica. La partita non può quindi restare bloccata.
- Se un telefono si allontana o va in standby, la squadra lo aspetta comunque per 45 secondi prima di considerarlo assente.
- Se nessun telefono è collegato il timer si ferma: la partita va in pausa invece di proseguire da sola.
- Dalla plancia, **CHIUDI ROUND** forza subito la risoluzione e **TERMINA** chiude la partita.
- Le manovre si risolvono per prime, poi le azioni in ordine di Riflessi, infine la risposta dei nemici.
- Un operativo a terra non è fuori dalla partita: il **RIPRISTINO** di un compagno **nella sua stessa stanza** lo rianima (così come il Protocollo Lazarus del RIPPER).
- La difficoltà dell'incontro scala con il numero di giocatori, quindi una partita in 6 non è più corta di una in 3.

## Comandi

- `npm run dev` — avvio locale per sviluppo e gioco.
- `npm run build` — verifica e crea la versione ottimizzata.
- `npm start` — esegue la versione ottimizzata dopo `npm run build`.

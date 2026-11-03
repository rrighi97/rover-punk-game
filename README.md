# Roverpunk — MVP locale

Gioco cooperativo cyberpunk per una plancia principale e 2–6 telefoni. Il computer ospita la partita sulla rete locale; i telefoni scelgono un operativo e giocano il proprio turno.

## Avvio

Su macOS fai doppio clic su `Avvia Roverpunk.command`. In alternativa, dalla cartella del progetto esegui:

```bash
npm run dev
```

La plancia si apre su `http://localhost:5174`. La lobby mostra anche il QR code e l’indirizzo di rete per i telefoni.

## Creare una partita

1. Dalla plancia scegli una missione e il numero di posti (2–6).
2. Ogni giocatore apre il QR code sul proprio telefono, inserisce il codice e sceglie una scheda.
3. Con almeno due operativi, la plancia avvia l’operazione.

La plancia conserva un token locale per i comandi amministrativi: solo da quel browser si possono avviare, forzare o annullare le partite. Lo stato della sessione resta in `data/game-state.json`, quindi un riavvio del server non cancella automaticamente una partita.

## Regole attuali

- Sono disponibili tre missioni: **La valigetta**, **Ghost Protocol** e **Ostagggio**.
- Ogni missione ha una mappa fissa con porte aperte o bloccate. Gli operativi attraversano solo porte aperte; gli Helix possono inseguire attraverso tutte le connessioni.
- Il gioco procede a turni, senza countdown. In ogni turno un operativo usa fino a **tre azioni**; manovre, fuoco, intrusione, ripristino, ricarica, sblocco porte e azioni obiettivo consumano un’azione.
- Il DRIVER ha una prima manovra gratuita per turno. Le abilità esclusive costano 3 Focus; alcune azioni base consumano Focus come indicato dal telefono.
- Chi esce da una stanza con ostili se li porta dietro: gli Helix ingaggiati inseguono il personaggio che si muove.
- Gli ostili colpiscono alla fine del turno dell’operativo che condivide la loro stanza. A fine giro gli ostili ingaggiati avanzano verso la squadra.
- L’allarme parte da 22% e aumenta di **+1 per ogni turno operativo** chiuso, giocato o saltato. ECHO può ridurlo di 5. Alle soglie 25, 35, 45, 55 e 65 entra un Segugio; a 75% parte il Lockdown; a 100% la missione è persa.
- Per aprire l’obiettivo servono **2 nodi violati su 3**. Poi: recupera e consegna la valigetta, purga il nucleo dati, oppure libera e scorta l’informatore. L’estrazione richiede che tutti gli operativi vivi raggiungano il punto di consegna.

## Comandi

- `npm run dev` — avvia il gioco in locale.
- `npm run build` — esegue controllo TypeScript e build ottimizzata.
- `npm run lint` — esegue il lint.
- `npm run sim` — simula le missioni per controllare il bilanciamento.
- `npm start` — serve la build di produzione dopo `npm run build`.

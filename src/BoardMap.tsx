// PLANCIA DI GIOCO
// La mappa arriva dal server dentro lo stato della partita: qui viene solo disegnata.
// È una plancia fissa per missione: la geometria si ricava dalle stanze stesse: ogni stanza
// occupa una cella (quadrata) o due celle adiacenti (rettangolare, il doppio esatto).
// Non si disegnano corridoi: il collegamento fra due stanze è la porta sul muro condiviso.
// Due stanze possono essere confinanti e restare separate da un muro cieco, senza porta.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nodeImg } from './roster';

export type Room = {
  id: string; name: string; col: number; row: number; w?: number; h?: number; links: string[];
  node?: boolean; exit?: boolean; vault?: boolean; start?: boolean;
};
export type Pawn = { id: string; label: string; img?: string; name: string; color?: string; down?: boolean; self?: boolean; carrying?: boolean; active?: boolean; badge?: string;
  // A terra: turni propri al rialzo automatico (-1 = non si rialza da solo). `rising` = si sta
  // rialzando adesso da solo (animazione di riavvio, vedi RISE_MS in App.tsx).
  riseIn?: number | null; rising?: boolean };
// Barra di avanzamento disegnata dentro una stanza (es. SCARICA sulla sorgente dati).
export type RoomProgress = { room: string; value: number; max: number; label: string; done?: boolean };
// `patrol`: il nemico è un drone ancora nella sua stanza di presidio, dove gira lungo i lati.
export type Foe = { id: string; label: string; img?: string; name: string; kind?: string; elite?: boolean; hunting?: boolean; dying?: boolean; patrol?: boolean };
// Segnalini di scenario e di missione: partenza, nodi, teca, valigetta, punto di consegna.
export type Marker = { id: string; label: string; name: string; kind: string; done?: boolean };
// Colpo appena incassato da un'unità: arriva dal server (game.hits) e resta "vivo" il tempo
// dell'animazione (vedi useHitFlashes in App.tsx).
export type Hit = { id: number; targetId: string; room: string; amount: number; kind: string; sourceId?: string };

const OUTER_X = 0.2, OUTER_Y = 0.4; // margine esterno della pianta, in % (~2px)
const GAP = 1.8; // spazio fra due stanze, in percentuale del riquadro

function geometry(rooms: Room[]) {
  const cols = Math.max(1, ...rooms.map((r) => r.col + (r.w || 1) - 1));
  const rows = Math.max(1, ...rooms.map((r) => r.row + (r.h || 1) - 1));
  // Margine esterno ~2px dal bordo (0.2% in larghezza, 0.4% in altezza su una plancia da ~1000x500px);
  // fra stanze resta GAP.
  const cellW = (100 - 2 * OUTER_X + GAP) / cols, cellH = (100 - 2 * OUTER_Y + GAP) / rows;
  const boxOf = (room: Room) => ({
    left: OUTER_X + (room.col - 1) * cellW,
    top: OUTER_Y + (room.row - 1) * cellH,
    width: (room.w || 1) * cellW - GAP,
    height: (room.h || 1) * cellH - GAP,
  });
  const centerOf = (room: Room) => {
    const box = boxOf(room);
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };
  return { boxOf, centerOf };
}

// Punto esatto della porta: centro del muro condiviso fra le due stanze. Il punto medio fra
// i centri, con stanze di taglia diversa o non allineate, cade dentro una stanza invece che
// sul confine. Se le due stanze non condividono un muro (collegamento "a distanza") si
// ripiega sul punto medio dei centri.
function doorSpot(
  ba: { left: number; top: number; width: number; height: number },
  bb: { left: number; top: number; width: number; height: number },
  ca: { x: number; y: number },
  cb: { x: number; y: number },
) {
  const ax2 = ba.left + ba.width, ay2 = ba.top + ba.height;
  const bx2 = bb.left + bb.width, by2 = bb.top + bb.height;
  const gapX = Math.max(bb.left - ax2, ba.left - bx2);
  const gapY = Math.max(bb.top - ay2, ba.top - by2);
  const overlapX = Math.min(ax2, bx2) - Math.max(ba.left, bb.left);
  const overlapY = Math.min(ay2, by2) - Math.max(ba.top, bb.top);
  if (gapX >= gapY && overlapY > 0) {
    return {
      x: ba.left < bb.left ? (ax2 + bb.left) / 2 : (bx2 + ba.left) / 2,
      y: (Math.max(ba.top, bb.top) + Math.min(ay2, by2)) / 2,
      vertical: true,
    };
  }
  if (overlapX > 0) {
    return {
      x: (Math.max(ba.left, bb.left) + Math.min(ax2, bx2)) / 2,
      y: ba.top < bb.top ? (ay2 + bb.top) / 2 : (by2 + ba.top) / 2,
      vertical: false,
    };
  }
  return { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2, vertical: Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y) };
}

// SLOT DI UN SEGNALINO DENTRO LA STANZA
// I segnalini (marcatori, nemici, operativi) non stanno più nel flusso della stanza: vivono in
// un livello assoluto sopra l'intera plancia, cosi la stessa istanza React (stessa key) si
// sposta da una stanza all'altra restando montata, e la transizione CSS su left/top anima lo
// spostamento invece di un salto secco. `slotPos` calcola solo dove appoggiare il segnalino
// dentro il riquadro della stanza corrente (griglia semplice, ancorata in basso, senza pretese
// di replicare esattamente il vecchio flex-wrap).
const SLOT_PAD_X = 0.14, SLOT_PAD_TOP = 0.36, SLOT_PAD_BOTTOM = 0.08;
function slotPos(box: { left: number; top: number; width: number; height: number }, index: number, total: number) {
  const cols = total <= 1 ? 1 : total <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(total / cols));
  const col = index % cols;
  const rowFromBottom = Math.floor(index / cols);
  const usableW = box.width * (1 - SLOT_PAD_X * 2);
  const usableH = box.height * (1 - SLOT_PAD_TOP - SLOT_PAD_BOTTOM);
  const x = box.left + box.width * SLOT_PAD_X + ((col + 0.5) / cols) * usableW;
  const yFromBottom = ((rowFromBottom + 0.5) / rows) * usableH;
  const y = box.top + box.height * (1 - SLOT_PAD_BOTTOM) - yFromBottom;
  return { x, y };
}

// SLOT DI UN SEGNALINO DI MISSIONE (nodo, valigetta, ostaggio...): a differenza di nemici e
// operativi, questi restano fermi in una stanza, quindi vengono agganciati tutti allo stesso
// angolo — in basso a destra, l'unico angolo "vivo" del riquadro (gli altri tre sono tagliati
// dal clip-path della stanza) — invece che infilarsi nella griglia condivisa con i token mobili.
const MARK_PAD_X = 0.17, MARK_PAD_Y = 0.1, MARK_STEP = 0.24;
function markPos(box: { left: number; top: number; width: number; height: number }, index: number) {
  const x = box.left + box.width * (1 - MARK_PAD_X) - index * box.width * MARK_STEP;
  const y = box.top + box.height * (1 - MARK_PAD_Y);
  return { x, y };
}

// ARREDI DI STANZA
// Piccole silhouette di mobili (public/props/*.png, sempre col taglio dall'alto e sfondo
// trasparente) agganciate a un lato della stanza: stanno sopra al pavimento e sotto a porte,
// segnalini e pedine (tutti su livelli con z-index più alto di `.tile`). La scelta di quale
// mobile e su quale lato è deterministica (seed = missionId + id stanza), quindi la stessa
// plancia mostra sempre lo stesso arredo. Non essendo legata a una missione specifica, la
// decorazione si applica da sola a qualunque missione futura, senza doverla dichiarare nel
// `layout`: basta aggiungere il file in `public/props/` e una riga in ROOM_PROPS qui sotto.
type PropShape = 'wide' | 'tall' | 'square';
const ROOM_PROPS: { src: string; shape: PropShape }[] = [
  { src: '/props/tavolo.png', shape: 'square' },
  { src: '/props/poltrona.png', shape: 'square' },
  { src: '/props/divano.png', shape: 'square' },
  { src: '/props/pianta.png', shape: 'square' },
  { src: '/props/desk.png', shape: 'wide' },
  { src: '/props/letto.png', shape: 'tall' },
  { src: '/props/mobile.png', shape: 'tall' },
  { src: '/props/mobiletto.png', shape: 'tall' },
];
// Un mobile "largo" (es. la scrivania) va su un lato orizzontale, uno "alto" (es. il letto) su
// un lato verticale: così resta sempre appoggiato al muro senza bisogno di ruotarlo. I mobili
// "quadrati" stanno bene ovunque.
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];
const SIDES_FOR_SHAPE: Record<PropShape, readonly Side[]> = {
  wide: ['top', 'bottom'], tall: ['left', 'right'], square: SIDES,
};

export function seedHash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// L'arredo è deterministico (stesso seed = stesso risultato): si calcola una volta per stanza
// e si riusa, invece di rifare shuffle e filtri a ogni render della plancia.
const propCache = new Map<string, { src: string; side: Side }[]>();
export function roomProps(seed: string, slots: number, blocked: readonly Side[] = []) {
  const cacheKey = `${seed}|${slots}|${blocked.join('')}`;
  const cached = propCache.get(cacheKey);
  if (cached) return cached;
  const picks = computeRoomProps(seed, slots, blocked);
  propCache.set(cacheKey, picks);
  return picks;
}

// Lati della stanza con almeno una porta: l'arredo non ci va mai, resta dove c'è solo muro.
export function doorSides(room: Room, rooms: Room[]): Side[] {
  const w = room.w || 1, h = room.h || 1;
  const sides = new Set<Side>();
  for (const id of room.links) {
    const o = rooms.find((r) => r.id === id);
    if (!o) continue;
    const ow = o.w || 1, oh = o.h || 1;
    const overlapRows = o.row < room.row + h && o.row + oh > room.row;
    const overlapCols = o.col < room.col + w && o.col + ow > room.col;
    if (overlapRows && o.col === room.col + w) sides.add('right');
    else if (overlapRows && o.col + ow === room.col) sides.add('left');
    else if (overlapCols && o.row === room.row + h) sides.add('bottom');
    else if (overlapCols && o.row + oh === room.row) sides.add('top');
  }
  return [...sides];
}

function computeRoomProps(seed: string, slots: number, blocked: readonly Side[]) {
  const pool: Side[] = SIDES.filter((side) => !blocked.includes(side));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = seedHash(`${seed}:shuffle:${i}`) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const used = new Set<number>();
  const picks: { src: string; side: Side }[] = [];
  for (let i = 0; i < slots && pool.length; i++) {
    const side = pool.pop() as Side;
    const indexed = ROOM_PROPS.map((prop, index) => ({ prop, index }));
    const fitting = indexed.filter(({ prop, index }) => SIDES_FOR_SHAPE[prop.shape].includes(side) && !used.has(index));
    const candidates = fitting.length ? fitting : indexed.filter(({ index }) => !used.has(index));
    if (!candidates.length) break;
    const choice = candidates[seedHash(`${seed}:${i}:prop`) % candidates.length];
    used.add(choice.index);
    picks.push({ src: choice.prop.src, side });
  }
  return picks;
}

function corridors(rooms: Room[]) {
  const seen = new Set<string>();
  const out: { key: string; a: Room; b: Room }[] = [];
  // Indice id -> stanza: la ricerca lineare dentro il doppio ciclo rendeva il calcolo quadratico.
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const room of rooms) {
    for (const id of room.links) {
      const other = byId.get(id);
      if (!other) continue;
      const key = [room.id, other.id].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, a: room, b: other });
    }
  }
  return out;
}

// APERTURA PORTA
// Quando una porta passa da bloccata (rossa) ad aperta (verde) la si ingrandisce per un istante
// e poi torna normale, così dalla plancia si vede subito *quale* porta è stata sbloccata.
// Il confronto è fra due poll consecutivi di `/api/state`: al primo render non si anima nulla
// (altrimenti a inizio partita lampeggerebbero tutte le porte già aperte).
const DOOR_OPEN_MS = 1425;

function useDoorOpenings(doors?: Record<string, boolean>) {
  const prev = useRef<Record<string, boolean> | null>(null);
  const timers = useRef<number[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); }, []);
  useEffect(() => {
    const before = prev.current;
    prev.current = { ...doors };
    if (!before) return;
    const fresh = Object.keys(before).filter((key) => before[key] && !doors?.[key]);
    if (!fresh.length) return;
    setOpened((list) => [...list, ...fresh]);
    // Il timer non va agganciato al cleanup dell'effetto: l'oggetto `doors` cambia identità a
    // ogni poll (800ms), il cleanup scatterebbe prima della fine dell'animazione.
    const timer = window.setTimeout(() => {
      // Il timer si toglie da solo dalla lista: altrimenti l'array cresceva per tutta la
      // partita con gli id di timeout già scaduti.
      timers.current = timers.current.filter((t) => t !== timer);
      setOpened((list) => list.filter((key) => !fresh.includes(key)));
    }, DOOR_OPEN_MS);
    timers.current.push(timer);
  }, [doors]);
  return opened;
}

// TOOLTIP ISTANTANEO
// Il `title` nativo del browser compare solo dopo un ritardo: segnalini e etichette usano invece
// un riquadro proprio, mostrato subito al passaggio del mouse (come il pannello ALLARME). Vive in
// un portal su <body> perché le stanze hanno overflow e clip-path che lo taglierebbero. Solo mouse:
// sui telefoni un tocco su un segnalino non deve lasciare un riquadro appeso.
type TipTone = 'pawn' | 'foe' | 'mark';
type Tip = { key: string; x: number; y: number; below: boolean };
type Hover = (key: string, text: string, tone: TipTone, color?: string) => {
  'aria-label': string;
  onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
};

// COLPO SUL TOKEN
// Il numero del danno (o della cura) sale sopra l'unità colpita e evapora, e il token lampeggia
// con una scrollata. Il numero NON può stare dentro `.token`: il clip-path del token lo
// taglierebbe. Vive quindi in un contenitore `.token-slot` che avvolge il token e non ritaglia
// nulla. La classe del colpo sta sullo slot: così l'animazione non litiga con quella del token
// (es. la pulsazione di un ostile ingaggiato).
function TokenSlot({ hits, ghost, className = '', style, children }: { hits: Hit[]; ghost?: boolean; className?: string; style?: React.CSSProperties; children?: React.ReactNode }) {
  const tone = !hits.length ? '' : hits.some((h) => h.kind !== 'heal') ? 'hit' : 'healed';
  return <span className={`token-slot ${ghost ? 'ghost' : ''} ${tone} ${className}`} style={style}>
    {children}
    {hits.length > 0 && <span className="hit-floats" aria-hidden="true">
      {hits.map((h, i) => <i className={`hit-float ${h.kind}`} style={{ '--i': i } as React.CSSProperties} key={h.id}>
        {h.kind === 'heal' ? '+' : '−'}{h.amount}
      </i>)}
    </span>}
  </span>;
}

export default function BoardMap({
  rooms, pawnsIn, foesIn, marksIn, doors, cameras = [], chests = [], fogged = [], hits = [], variant = 'board', missionId, highlight = [], pulse = [], selected, currentRoom, onPick, lockdown, blackout, progress,
}: {
  rooms: Room[];
  pawnsIn: (roomId: string) => Pawn[];
  foesIn: (roomId: string) => Foe[];
  marksIn?: (roomId: string) => Marker[];
  // Porte chiuse della plancia: chiave `id1-id2` (ordine alfabetico) -> true se chiusa. Una
  // porta assente dalla mappa è aperta. Disegnata in verde (aperta) o rosso (chiusa).
  doors?: Record<string, boolean>;
  // Stanze con una telecamera ancora attiva: immagine agganciata all'angolo in alto a destra.
  cameras?: string[];
  // Casse di potenziamento della missione: `uses` a 0 = già svuotata (resta disegnata, spenta).
  chests?: { room: string; uses: number; max?: number }[];
  // NEBBIA: stanze mai visitate. Restano scure, con solo il nome: niente arredo, nemici, casse,
  // telecamere né segnalini finché un operativo non ci entra.
  fogged?: string[];
  // Colpi da mostrare adesso sui token, già filtrati per durata da chi chiama.
  hits?: Hit[];
  variant?: 'board' | 'mini';
  // Attiva lo sfondo comune delle stanze per la missione corrente.
  missionId?: string;
  highlight?: string[];
  // Stanze nodo appena violate: l'onda d'urto dura quanto l'animazione (vedi NODE_BREACH_MS
  // in App.tsx) e poi chi chiama le toglie.
  pulse?: string[];
  selected?: string;
  currentRoom?: string;
  onPick?: (roomId: string) => void;
  // In LOCKDOWN la riga che scorre sulla plancia passa da ciano a rossa.
  lockdown?: boolean;
  // BLACKOUT: le luci delle stanze saltano per qualche secondo (vedi BLACKOUT_ALERT_SECONDS
  // in App.tsx). Solo sulla plancia intera: la mini-mappa del telefono non lo mostra.
  blackout?: boolean;
  progress?: RoomProgress;
}) {
  const { boxOf, centerOf } = useMemo(() => geometry(rooms), [rooms]);
  // La lista delle porte dipende solo dalla pianta, che è fissa per tutta la missione.
  const links = useMemo(() => corridors(rooms), [rooms]);
  const justOpened = useDoorOpenings(doors);
  const [tip, setTip] = useState<Tip | null>(null);
  // Misura reale della plancia in px: la ronda dei droni ne ricava le tappe dei keyframe, così
  // il giro segue il perimetro vero di ogni stanza qualunque sia la sua forma o la finestra.
  const mapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const patrolCss = new Map<string, string>();
  // Testi raccolti a ogni render: il riquadro mostra sempre i dati aggiornati (HP, stato) e
  // sparisce da solo se il segnalino sotto il mouse cambia stanza o esce di scena.
  const tips = new Map<string, { text: string; tone: TipTone; color?: string }>();
  const hover: Hover = (key, text, tone, color) => {
    tips.set(key, { text, tone, color });
    return {
      'aria-label': text,
      onPointerEnter: (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = e.currentTarget.getBoundingClientRect();
        const below = r.top < 150;
        setTip({ key, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
      },
      onPointerLeave: () => setTip((t) => (t?.key === key ? null : t)),
    };
  };
  // LIVELLO SEGNALINI: costruito una volta sola qui, in ordine stanza per stanza (marcatori,
  // poi nemici, poi operativi, come nel vecchio flusso) cosi lo slot dentro ogni stanza resta
  // stabile. Ogni voce porta già la posizione assoluta (%) sul riquadro della plancia: mark-token
  // fissi non hanno bisogno di scia, foe/pawn sì perché sono loro a spostarsi tra le stanze.
  const tokenNodes: React.ReactNode[] = [];
  // Posizione (%) di ogni nemico/operativo a schermo: serve a tracciare i colpi tiratore → bersaglio.
  const unitAt = new Map<string, { x: number; y: number }>();
  for (const room of rooms) {
    const box = boxOf(room);
    // I segnalini di consegna ("drop") e partenza ("start") non passano più per gli slot dei
    // token: diventano le scritte EXIT/START sullo sfondo della stanza (vedi loop più sotto).
    const dark = fogged.includes(room.id);
    const marks = dark ? [] : (marksIn?.(room.id) || []).filter((m) => m.kind !== 'drop' && m.kind !== 'start');
    const foes = dark ? [] : foesIn(room.id);
    const pawns = pawnsIn(room.id);
    const roomHits = dark ? [] : hits.filter((h) => h.room === room.id);
    const hitsOn = (unitId: string) => roomHits.filter((h) => h.targetId === unitId);
    // Colpo senza token: il nemico abbattuto sparisce dalla plancia nello stesso istante in cui
    // arriva il danno che lo ha ucciso. Il numero va mostrato lo stesso, in coda alla fila.
    const onBoard = new Set([...marks, ...foes, ...pawns].map((unit) => unit.id));
    const orphanHits = roomHits.filter((h) => !onBoard.has(h.targetId));
    const total = foes.length + pawns.length + (orphanHits.length ? 1 : 0);
    let slot = 0;
    marks.forEach((mark, markIndex) => {
      const { x, y } = markPos(box, markIndex);
      tokenNodes.push(<TokenSlot hits={hitsOn(mark.id)} style={{ left: `${x}%`, top: `calc(${y}% - 8px)` }} key={`${room.id}:${mark.id}`}><span
        className={`token mark-token ${mark.kind} ${mark.done ? 'done' : ''}`}
        {...hover(`${room.id}:mark:${mark.id}`, mark.name, 'mark')}
      >{mark.kind === 'node' ? <img src={nodeImg} alt={mark.label} /> : mark.label}</span></TokenSlot>);
    });
    for (const foe of foes) {
      const { x, y } = slotPos(box, slot++, total);
      unitAt.set(foe.id, { x, y });
      const pos = { left: `${x}%`, top: `${y}%` } as React.CSSProperties;
      // RONDA DEL DRONE (solo visiva): nella sua stanza di presidio il drone gira lungo i lati.
      // Appena entra un operativo (o il drone ingaggia, o cade) l'animazione va in pausa: il
      // token si blocca esattamente dov'è, senza tornare allo slot. Se esce dalla stanza
      // (inseguimento) l'animazione si toglie e il token torna a usare gli slot come gli altri.
      const patrol = Boolean(foe.patrol);
      const halted = foe.hunting || foe.dying || pawns.length > 0;
      let patrolClass = '';
      if (patrol) {
        // Il giro è un rettangolo con margini FISSI in px dai muri (il token è di ~40px e
        // l'intestazione della stanza ha un'altezza fissa): sopra si ferma subito sotto il
        // titolo, qualunque sia l'altezza della stanza. Le tappe dei keyframe sono
        // proporzionali ai lati in px, quindi la velocità resta costante su tutto il perimetro.
        const roomW = box.width / 100 * (size.w || 100), roomH = box.height / 100 * (size.h || 100);
        const insetX = Math.min(26, roomW * 0.3), insetTop = Math.min(50, roomH * 0.5), insetBottom = Math.min(26, roomH * 0.2);
        const sideW = Math.max(1, roomW - 2 * insetX);
        const sideH = Math.max(1, roomH - insetTop - insetBottom);
        const perimeter = 2 * (sideW + sideH);
        const legW = Math.round(sideW / perimeter * 1000) / 10;
        const name = `drone-patrol-${Math.round(sideW)}x${Math.round(sideH)}`;
        patrolCss.set(name, `@keyframes ${name}{0%,100%{left:var(--pl);top:var(--pt)}${legW}%{left:var(--pr);top:var(--pt)}50%{left:var(--pr);top:var(--pb)}${50 + legW}%{left:var(--pl);top:var(--pb)}}`);
        patrolClass = `patrol ${halted ? 'halted' : ''}`;
        Object.assign(pos, {
          '--pl': `calc(${box.left}% + ${insetX}px)`, '--pr': `calc(${box.left + box.width}% - ${insetX}px)`,
          '--pt': `calc(${box.top}% + ${insetTop}px)`, '--pb': `calc(${box.top + box.height}% - ${insetBottom}px)`,
          animationName: name,
          // ~32px/s: stessa velocità in ogni stanza.
          animationDuration: `${Math.max(6, perimeter / 32).toFixed(2)}s`,
          // Fase sfalsata per id: due droni non girano all'unisono.
          '--pd': ([...foe.id].reduce((s, c) => s + c.charCodeAt(0), 0) * 37) % 100 / 10,
        });
      }
      tokenNodes.push(<span className={`token-ghost foe g2 ${patrolClass}`} style={pos} key={`${foe.id}:g2`} />);
      tokenNodes.push(<span className={`token-ghost foe g1 ${patrolClass}`} style={pos} key={`${foe.id}:g1`} />);
      tokenNodes.push(<TokenSlot hits={hitsOn(foe.id)} className={patrolClass} style={pos} key={foe.id}><span
        className={`token foe ${foe.kind ? `foe-${foe.kind}` : ''} ${foe.elite ? 'elite' : ''} ${foe.hunting ? 'hunting' : ''} ${foe.dying ? 'dying' : ''}`}
        {...(foe.dying ? {} : hover(`${room.id}:foe:${foe.id}`, foe.name, 'foe'))}
      >{foe.img ? <img src={foe.img} alt={foe.label} /> : foe.label}</span></TokenSlot>);
    }
    for (const pawn of pawns) {
      const { x, y } = slotPos(box, slot++, total);
      unitAt.set(pawn.id, { x, y });
      const pos = { left: `${x}%`, top: `${y}%`, '--unit': pawn.color } as React.CSSProperties;
      tokenNodes.push(<span className="token-ghost pawn g2" style={pos} key={`${pawn.id}:g2`} />);
      tokenNodes.push(<span className="token-ghost pawn g1" style={pos} key={`${pawn.id}:g1`} />);
      // Il cartellino "a terra" e la scritta di riavvio stanno fuori da `.token`, che ha il clip-path.
      const downTag = pawn.riseIn === -1 ? 'K.O.' : pawn.riseIn ? `${pawn.riseIn} ${pawn.riseIn === 1 ? 'TURNO' : 'TURNI'} AL RIALZO` : 'A TERRA';
      tokenNodes.push(<TokenSlot hits={hitsOn(pawn.id)} className={pawn.rising ? 'rising' : ''} style={pos} key={pawn.id}><span
        className={`token pawn ${pawn.down ? 'down' : ''} ${pawn.self ? 'self' : ''} ${pawn.carrying ? 'carrying' : ''} ${pawn.active ? 'active-pawn' : ''}`}
        {...hover(`${room.id}:pawn:${pawn.id}`, pawn.down ? `${pawn.name} · ${downTag}` : pawn.name, 'pawn', pawn.color)}
      >{pawn.img ? <img src={pawn.img} alt={pawn.label} /> : pawn.label}
      {pawn.badge && <i className="pawn-badge" aria-hidden="true">{pawn.badge}</i>}</span>
      {pawn.down && <i className="pawn-down-tag" aria-hidden="true">{downTag}</i>}
      {pawn.rising && <i className="pawn-reboot" aria-hidden="true"><b>RIAVVIO</b></i>}</TokenSlot>);
    }
    if (orphanHits.length > 0) {
      const { x, y } = slotPos(box, slot++, total);
      tokenNodes.push(<TokenSlot hits={orphanHits} style={{ left: `${x}%`, top: `${y}%` }} ghost key={`orphan:${room.id}`} />);
    }
  }
  return <div ref={mapRef} className={`board-map ${variant} ${missionId ? `mission-${missionId}` : ''}`}>
    {patrolCss.size > 0 && <style>{[...patrolCss.values()].join('')}</style>}
    {/* PORTE COME UNITÀ: un battente disegnato sul muro condiviso di due stanze, sul perimetro,
        verde se aperta e rosso se bloccata. Nessun corridoio disegnato: il collegamento fra
        due stanze È la porta. */}
    <div className="map-doors">
      {links.map(({ key, a, b }) => {
        const spot = doorSpot(boxOf(a), boxOf(b), centerOf(a), centerOf(b));
        const closed = Boolean(doors?.[key]);
        return <span
          key={key}
          className={`door-unit ${spot.vertical ? 'v' : 'h'} ${closed ? 'closed' : 'open'} ${!closed && justOpened.includes(key) ? 'just-opened' : ''}`}
          style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
          {...hover(`door:${key}`, `${closed ? 'PORTA BLOCCATA' : 'PORTA APERTA'} — collega ${a.id} ${a.name} e ${b.id} ${b.name}. ${closed ? 'Va aperta con SBLOCCA PORTA prima di attraversarla.' : 'Attraversabile in manovra.'}`, 'mark')}
        >
          <i className="gap" />
          <i className="leaf l" />
          <i className="leaf r" />
          <i className="bar" />
          <i className="lamp" />
        </span>;
      })}
    </div>
    {rooms.map((room) => {
      const box = boxOf(room);
      // Ogni ambiente ritaglia un punto diverso della texture industriale condivisa:
      // la stessa superficie non dà così l'impressione di essere copiata cella per cella.
      const floorIndex = rooms.indexOf(room);
      const dark = fogged.includes(room.id);
      const foes = dark ? [] : foesIn(room.id);
      const reachable = highlight.includes(room.id);
      const classes = ['tile'];
      if (dark) classes.push('fogged');
      if (foes.length) classes.push('hostile');
      if (room.id === currentRoom) classes.push('current');
      if (reachable) classes.push('reachable');
      const breached = !dark && pulse.includes(room.id);
      if (breached) classes.push('breach-pulse');
      if (room.id === selected) classes.push('selected');
      if (room.exit && !dark) classes.push('exit-room');
      if (room.start && !dark) classes.push('start-room');
      if ((room.w || 1) * (room.h || 1) === 2) classes.push('wide');
      const Tag = onPick && reachable ? 'button' : 'div';
      // Il simbolo EXIT vive dentro il riquadro della stanza (non nel livello segnalini): resta
      // così sotto ai token di operativi e nemici, che sono in `.map-tokens` con z-index maggiore.
      const exitMark = room.exit ? marksIn?.(room.id)?.find((m) => m.kind === 'drop') : undefined;
      // Arredo: solo sulla plancia intera, non sulla mini-mappa (troppo piccola per notarlo).
      const wideRoom = (room.w || 1) * (room.h || 1) === 2;
      const propSeed = `${missionId || ''}:${room.id}`;
      const propSlots = wideRoom ? 2 + (seedHash(`${propSeed}:slots`) % 2) : 1;
      // La cassa prende il posto dell'arredo: nella sua stanza è lei l'oggetto da guardare.
      const chest = chests.find((c) => c.room === room.id);
      const decor = variant === 'board' && !chest && !dark ? roomProps(propSeed, propSlots, doorSides(room, rooms)) : [];
      // Sfalsamento del lampeggio per stanza (seed sull'indice): le luci non saltano tutte
      // all'unisono, come in un vero blackout a catena.
      const flickerDelay = `${(seedHash(`${propSeed}:flicker`) % 700)}ms`;
      return <Tag
        key={room.id}
        className={classes.join(' ')}
        style={{
          left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%`,
          '--floor-x': `${(floorIndex * 29) % 100}%`, '--floor-y': `${(floorIndex * 47) % 100}%`,
          '--flicker-delay': flickerDelay,
        } as React.CSSProperties}
        {...(onPick && reachable ? { onClick: () => onPick(room.id), type: 'button' as const } : {})}
      >
        {!dark && decor.map((d, i) => <img key={`prop:${i}`} className={`room-prop side-${d.side}`} src={d.src} alt="" aria-hidden="true" draggable={false} decoding="async" />)}
        {dark && <span className="fog-veil" aria-hidden="true" />}
        {!dark && chest && <img
          className={`room-chest ${chest.uses > 0 ? 'loaded' : 'spent'}`}
          src="/props/cassa.png" alt="" draggable={false} decoding="async"
          {...hover(`${room.id}:chest`, chest.uses > 0
            ? `CASSA DI POTENZIAMENTO - ${chest.uses}/${chest.max ?? chest.uses}.\nAzione: APRI CASSA, solo a stanza ripulita dagli ostili.`
            : 'CASSA SVUOTATA — non contiene più modifiche.', 'mark')}
        />}
        {!dark && cameras.includes(room.id) && <img
          className={`room-camera ${(room.w || 1) === 2 ? 'wide' : ''}`}
          src="/props/camera.png" alt="" draggable={false} decoding="async"
          {...hover(`${room.id}:camera`, 'TELECAMERA ATTIVA — spegnila con DISABILITA TELECAMERA (1 azione, allarme -2%).', 'mark')}
        />}
        {blackout && variant === 'board' && <span className="tile-flicker" aria-hidden="true" />}
        {breached && <span className="breach-wave" aria-hidden="true"><i /><i /></span>}
        {breached && <span className="breach-glitch" aria-hidden="true"><i /><i /><i /><i /><b data-text="NODO VIOLATO">NODO VIOLATO</b></span>}
        {!dark && progress?.room === room.id && <span
          className={`room-progress ${progress.done ? 'done' : ''}`}
        >
          <small>{progress.label}</small>
          <span className="room-progress-track">{Array.from({ length: progress.max }, (_, i) => <i className={i < progress.value ? 'on' : i === progress.value && !progress.done ? 'next' : ''} key={i} />)}</span>
          <b>{Math.round(progress.value / Math.max(1, progress.max) * 100)}%</b>
        </span>}
        {room.exit && !dark && <span
          className={`exit-symbol ${exitMark?.done ? 'done' : ''}`}
          {...(exitMark ? hover(`${room.id}:exit`, exitMark.name, 'mark') : {})}
        >EXIT</span>}
        {room.start && !dark && <span
          className="start-symbol"
          {...hover(`${room.id}:start`, `ZONA DI PARTENZA — ${room.name}. Qui è entrata la squadra.`, 'mark')}
        >START</span>}
        <header><b>{room.id}</b><small>{room.name}</small></header>
        {room.start && !dark && <small className="role-tag">START</small>}
        {room.exit && !dark && <small className="role-tag">EXIT</small>}
      </Tag>;
    })}
    <div className="map-tokens">{tokenNodes}</div>
    {/* COLPI: tracciante dal tiratore al bersaglio, vampa alla bocca e impatto, nello stesso
        istante del numero del danno (stessa voce di `hits`). Un drone di ronda si muove per
        keyframe: la sua posizione qui è lo slot, basta come punto di partenza del colpo. */}
    <div className="map-shots" aria-hidden="true">
      {hits.map((h) => {
        if (h.kind === 'heal' || !h.sourceId) return null;
        const from = unitAt.get(h.sourceId), to = unitAt.get(h.targetId);
        if (!from || !to) return null;
        const dx = (to.x - from.x) * (size.w || 100) / 100, dy = (to.y - from.y) * (size.h || 100) / 100;
        const len = Math.hypot(dx, dy), angle = Math.atan2(dy, dx) * 180 / Math.PI;
        return <span className={`shot ${/^p\d+$/.test(h.sourceId) ? 'ally' : 'foe'}`} key={`shot:${h.id}`} style={{ left: `${from.x}%`, top: `${from.y}%`, '--len': `${len}px`, '--angle': `${angle}deg`, '--tx': `${to.x}%`, '--ty': `${to.y}%` } as React.CSSProperties}>
          <i className="shot-trace" /><i className="shot-muzzle" />
        </span>;
      })}
      {hits.map((h) => {
        if (h.kind === 'heal' || !h.sourceId) return null;
        const to = unitAt.get(h.targetId);
        return to ? <i className="shot-impact" key={`impact:${h.id}`} style={{ left: `${to.x}%`, top: `${to.y}%` }} /> : null;
      })}
    </div>
    {variant === 'board' && <div className={`scanline ${lockdown ? 'lockdown' : ''}`} />}
    <MapTip tip={tip} content={tip ? tips.get(tip.key) : undefined} onStale={() => setTip(null)} />
  </div>;
}

function MapTip({ tip, content, onStale }: { tip: Tip | null; content?: { text: string; tone: TipTone; color?: string }; onStale: () => void }) {
  const stale = Boolean(tip && !content);
  useEffect(() => { if (stale) onStale(); }, [stale, onStale]);
  if (!tip || !content) return null;
  const x = Math.max(160, Math.min(window.innerWidth - 160, tip.x));
  return createPortal(<div
    className={`map-tip ${content.tone} ${tip.below ? 'below' : ''}`}
    role="tooltip"
    style={{ left: x, top: tip.y, ...(content.color ? { '--tip': content.color } : {}) } as React.CSSProperties}
  >{content.text}</div>, document.body);
}

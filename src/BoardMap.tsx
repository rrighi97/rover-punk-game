// PLANCIA DI GIOCO
// La mappa arriva dal server dentro lo stato della partita: qui viene solo disegnata.
// È una plancia fissa per missione: la geometria si ricava dalle stanze stesse: ogni stanza
// occupa una cella (quadrata) o due celle adiacenti (rettangolare, il doppio esatto).
// Non si disegnano corridoi: il collegamento fra due stanze è la porta sul muro condiviso.
// Due stanze possono essere confinanti e restare separate da un muro cieco, senza porta.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type Room = {
  id: string; name: string; col: number; row: number; w?: number; h?: number; links: string[];
  node?: boolean; exit?: boolean; vault?: boolean; cover?: boolean; exposed?: boolean; start?: boolean;
};
export type Pawn = { id: string; label: string; img?: string; name: string; color?: string; down?: boolean; self?: boolean; carrying?: boolean };
export type Foe = { id: string; label: string; img?: string; name: string; elite?: boolean; hunting?: boolean };
// Segnalini di scenario e di missione: partenza, nodi, teca, valigetta, punto di consegna.
export type Marker = { id: string; label: string; name: string; kind: string; done?: boolean };

const GAP = 1.8; // spazio fra due stanze, in percentuale del riquadro

function geometry(rooms: Room[]) {
  const cols = Math.max(1, ...rooms.map((r) => r.col + (r.w || 1) - 1));
  const rows = Math.max(1, ...rooms.map((r) => r.row + (r.h || 1) - 1));
  const cellW = 100 / cols, cellH = 100 / rows;
  const boxOf = (room: Room) => ({
    left: (room.col - 1) * cellW + GAP / 2,
    top: (room.row - 1) * cellH + GAP / 2,
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

function corridors(rooms: Room[]) {
  const seen = new Set<string>();
  const out: { key: string; a: Room; b: Room }[] = [];
  for (const room of rooms) {
    for (const id of room.links) {
      const other = rooms.find((r) => r.id === id);
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
const DOOR_OPEN_MS = 900;

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
    timers.current.push(window.setTimeout(
      () => setOpened((list) => list.filter((key) => !fresh.includes(key))),
      DOOR_OPEN_MS,
    ));
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

// Etichette d'ambiente: restano testuali perché descrivono la stanza, non un obiettivo.
function RoomMarks({ room, hover }: { room: Room; hover: Hover }) {
  return <div className="tile-marks">
    {room.cover && <i className="mark cover" {...hover(`${room.id}:cover`, 'COPERTURA — ripari e angoli ciechi: sfruttali per muoverti senza farti vedere', 'mark')}>COPERTURA</i>}
    {room.exposed && <i className="mark exposed" {...hover(`${room.id}:exposed`, 'ZONA ESPOSTA — stanza scoperta: è lì che i presidi vi vedono arrivare', 'mark')}>ZONA ESPOSTA</i>}
  </div>;
}

export default function BoardMap({
  rooms, pawnsIn, foesIn, marksIn, doors, variant = 'board', highlight = [], selected, currentRoom, onPick,
}: {
  rooms: Room[];
  pawnsIn: (roomId: string) => Pawn[];
  foesIn: (roomId: string) => Foe[];
  marksIn?: (roomId: string) => Marker[];
  // Porte chiuse della plancia: chiave `id1-id2` (ordine alfabetico) -> true se chiusa. Una
  // porta assente dalla mappa è aperta. Disegnata in verde (aperta) o rosso (chiusa).
  doors?: Record<string, boolean>;
  variant?: 'board' | 'mini';
  highlight?: string[];
  selected?: string;
  currentRoom?: string;
  onPick?: (roomId: string) => void;
}) {
  const { boxOf, centerOf } = geometry(rooms);
  const justOpened = useDoorOpenings(doors);
  const [tip, setTip] = useState<Tip | null>(null);
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
  return <div className={`board-map ${variant}`}>
    {/* PORTE COME UNITÀ: un battente disegnato sul muro condiviso di due stanze, sul perimetro,
        verde se aperta e rosso se bloccata. Nessun corridoio disegnato: il collegamento fra
        due stanze È la porta. */}
    <div className="map-doors">
      {corridors(rooms).map(({ key, a, b }) => {
        const spot = doorSpot(boxOf(a), boxOf(b), centerOf(a), centerOf(b));
        const closed = Boolean(doors?.[key]);
        return <span
          key={key}
          className={`door-unit ${spot.vertical ? 'v' : 'h'} ${closed ? 'closed' : 'open'} ${!closed && justOpened.includes(key) ? 'just-opened' : ''}`}
          style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
          {...hover(`door:${key}`, `${closed ? 'PORTA BLOCCATA' : 'PORTA APERTA'} — collega ${a.id} ${a.name} e ${b.id} ${b.name}. ${closed ? 'Va aperta con SBLOCCA PORTA prima di attraversarla.' : 'Attraversabile in manovra.'}`, 'mark')}
        />;
      })}
    </div>
    {rooms.map((room) => {
      const box = boxOf(room);
      const pawns = pawnsIn(room.id);
      const foes = foesIn(room.id);
      const marks = marksIn?.(room.id) || [];
      const reachable = highlight.includes(room.id);
      const classes = ['tile'];
      if (foes.length) classes.push('hostile');
      if (room.id === currentRoom) classes.push('current');
      if (reachable) classes.push('reachable');
      if (room.id === selected) classes.push('selected');
      if (room.exit) classes.push('exit-room');
      if (room.start) classes.push('start-room');
      if ((room.w || 1) * (room.h || 1) === 2) classes.push('wide');
      const Tag = onPick && reachable ? 'button' : 'div';
      return <Tag
        key={room.id}
        className={classes.join(' ')}
        style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
        {...(onPick && reachable ? { onClick: () => onPick(room.id), type: 'button' as const } : {})}
      >
        <header><b>{room.id}</b><small>{room.name}</small></header>
        <RoomMarks room={room} hover={hover} />
        <div className="tokens">
          {marks.map((mark) => <span
            className={`token mark-token ${mark.kind} ${mark.done ? 'done' : ''}`}
            {...hover(`${room.id}:mark:${mark.id}`, mark.name, 'mark')}
            key={mark.id}
          >{mark.label}</span>)}
          {foes.map((foe) => <span className={`token foe ${foe.elite ? 'elite' : ''} ${foe.hunting ? 'hunting' : ''}`} {...hover(`${room.id}:foe:${foe.id}`, foe.name, 'foe')} key={foe.id}>{foe.img ? <img src={foe.img} alt={foe.label} /> : foe.label}</span>)}
          {pawns.map((pawn) => <span
            className={`token pawn ${pawn.down ? 'down' : ''} ${pawn.self ? 'self' : ''} ${pawn.carrying ? 'carrying' : ''}`}
            {...hover(`${room.id}:pawn:${pawn.id}`, pawn.name, 'pawn', pawn.color)}
            style={{ '--unit': pawn.color } as React.CSSProperties}
            key={pawn.id}
          >{pawn.img ? <img src={pawn.img} alt={pawn.label} /> : pawn.label}</span>)}
        </div>
      </Tag>;
    })}
    {variant === 'board' && <div className="scanline" />}
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

// PLANCIA DI GIOCO
// La mappa arriva dal server dentro lo stato della partita: qui viene solo disegnata.
// È una plancia fissa per missione: la geometria si ricava dalle stanze stesse: ogni stanza
// occupa una cella (quadrata) o due celle adiacenti (rettangolare, il doppio esatto).
// I corridoi disegnati sono SOLO le porte reali: due stanze possono essere confinanti e
// restare separate da un muro cieco, e in quel caso fra loro non compare nessuna linea.

import { useEffect, useState } from 'react';
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
  rooms, pawnsIn, foesIn, marksIn, variant = 'board', highlight = [], selected, currentRoom, onPick,
}: {
  rooms: Room[];
  pawnsIn: (roomId: string) => Pawn[];
  foesIn: (roomId: string) => Foe[];
  marksIn?: (roomId: string) => Marker[];
  variant?: 'board' | 'mini';
  highlight?: string[];
  selected?: string;
  currentRoom?: string;
  onPick?: (roomId: string) => void;
}) {
  const { boxOf, centerOf } = geometry(rooms);
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
    <svg className="map-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {/* Due passate sullo stesso tracciato: la fascia scura è il corridoio, la linea sottile la sua guida luminosa. */}
      {['walls', 'guide'].map((layer) => <g className={`corridor-${layer}`} key={layer}>
        {corridors(rooms).map(({ key, a, b }) => {
          const from = centerOf(a), to = centerOf(b);
          return <line key={key} x1={from.x} y1={from.y} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke" />;
        })}
      </g>)}
    </svg>
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

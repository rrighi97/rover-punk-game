// PLANCIA DI GIOCO
// La mappa arriva dal server dentro lo stato della partita: qui viene solo disegnata.
// È generata proceduralmente, quindi la geometria si ricava dalle stanze stesse: ogni stanza
// occupa una cella (quadrata) o due celle adiacenti (rettangolare, il doppio esatto).
// I corridoi disegnati sono SOLO le porte reali: due stanze possono essere confinanti e
// restare separate da un muro cieco, e in quel caso fra loro non compare nessuna linea.

export type Room = {
  id: string; name: string; col: number; row: number; w?: number; h?: number; links: string[];
  node?: boolean; exit?: boolean; vault?: boolean; cover?: boolean; exposed?: boolean; start?: boolean;
};
export type Pawn = { id: string; label: string; name: string; color?: string; down?: boolean; self?: boolean; carrying?: boolean };
export type Foe = { id: string; label: string; name: string; elite?: boolean; hunting?: boolean };
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

// Etichette d'ambiente: restano testuali perché descrivono la stanza, non un obiettivo.
function RoomMarks({ room }: { room: Room }) {
  return <div className="tile-marks">
    {room.cover && <i className="mark cover" title="COPERTURA — l’azione COPERTURA vale +6 scudo in questa stanza">COPERTURA</i>}
    {room.exposed && <i className="mark exposed" title="ZONA ESPOSTA — chi resta qui a fine round alza l’allarme">ZONA ESPOSTA</i>}
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
        <RoomMarks room={room} />
        <div className="tokens">
          {marks.map((mark) => <span
            className={`token mark-token ${mark.kind} ${mark.done ? 'done' : ''}`}
            title={mark.name}
            key={mark.id}
          >{mark.label}</span>)}
          {foes.map((foe) => <span className={`token foe ${foe.elite ? 'elite' : ''} ${foe.hunting ? 'hunting' : ''}`} title={foe.name} key={foe.id}>{foe.label}</span>)}
          {pawns.map((pawn) => <span
            className={`token pawn ${pawn.down ? 'down' : ''} ${pawn.self ? 'self' : ''} ${pawn.carrying ? 'carrying' : ''}`}
            title={pawn.name}
            style={{ '--unit': pawn.color } as React.CSSProperties}
            key={pawn.id}
          >{pawn.label}</span>)}
        </div>
      </Tag>;
    })}
    {variant === 'board' && <div className="scanline" />}
  </div>;
}

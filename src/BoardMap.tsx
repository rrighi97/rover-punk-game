// PLANCIA DI GIOCO
// La mappa arriva dal server dentro lo stato della partita: qui viene solo disegnata.
// Le stanze sono posizionate su una griglia col/row e i corridoi sono le linee che
// collegano i centri di due stanze adiacenti, così la plancia resta leggibile a distanza.

export type Room = {
  id: string; name: string; col: number; row: number; links: string[];
  node?: boolean; exit?: boolean; vault?: boolean; cover?: boolean; exposed?: boolean;
};
export type Pawn = { id: string; label: string; name: string; color?: string; down?: boolean; self?: boolean };
export type Foe = { id: string; label: string; name: string; elite?: boolean; hunting?: boolean };

// Geometria della griglia, in percentuale sul riquadro della plancia.
const ROOM_W = 26, ROOM_H = 27, COL_STEP = 32, ROW_STEP = 32, OFF_X = 5, OFF_Y = 5;
const boxOf = (room: Room) => ({ left: OFF_X + (room.col - 1) * COL_STEP, top: OFF_Y + (room.row - 1) * ROW_STEP });
const centerOf = (room: Room) => ({ x: boxOf(room).left + ROOM_W / 2, y: boxOf(room).top + ROOM_H / 2 });

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

function RoomMarks({ room, breached }: { room: Room; breached: boolean }) {
  return <div className="tile-marks">
    {room.node && <i className={`mark node ${breached ? 'done' : ''}`}>{breached ? 'NODO VIOLATO' : 'NODO ATTIVO'}</i>}
    {room.vault && <i className="mark vault">OBIETTIVO</i>}
    {room.exit && <i className="mark exit">ESTRAZIONE</i>}
    {room.cover && <i className="mark cover">COPERTURA</i>}
    {room.exposed && <i className="mark exposed">ZONA ESPOSTA</i>}
  </div>;
}

export default function BoardMap({
  rooms, nodes, pawnsIn, foesIn, variant = 'board', highlight = [], selected, currentRoom, onPick,
}: {
  rooms: Room[];
  nodes: Record<string, boolean>;
  pawnsIn: (roomId: string) => Pawn[];
  foesIn: (roomId: string) => Foe[];
  variant?: 'board' | 'mini';
  highlight?: string[];
  selected?: string;
  currentRoom?: string;
  onPick?: (roomId: string) => void;
}) {
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
      const reachable = highlight.includes(room.id);
      const classes = ['tile'];
      if (foes.length) classes.push('hostile');
      if (room.id === currentRoom) classes.push('current');
      if (reachable) classes.push('reachable');
      if (room.id === selected) classes.push('selected');
      if (room.exit) classes.push('exit-room');
      const Tag = onPick && reachable ? 'button' : 'div';
      return <Tag
        key={room.id}
        className={classes.join(' ')}
        style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${ROOM_W}%`, height: `${ROOM_H}%` }}
        {...(onPick && reachable ? { onClick: () => onPick(room.id), type: 'button' as const } : {})}
      >
        <header><b>{room.id}</b><small>{room.name}</small></header>
        <RoomMarks room={room} breached={Boolean(nodes[room.id])} />
        <div className="tokens">
          {foes.map((foe) => <span className={`token foe ${foe.elite ? 'elite' : ''} ${foe.hunting ? 'hunting' : ''}`} title={foe.name} key={foe.id}>{foe.label}</span>)}
          {pawns.map((pawn) => <span
            className={`token pawn ${pawn.down ? 'down' : ''} ${pawn.self ? 'self' : ''}`}
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

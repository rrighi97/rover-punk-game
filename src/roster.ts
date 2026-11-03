// MINIATURE // le icone di operativi e nemici stanno in /public/roster (250x250 PNG).
// Il file di ogni operativo prende il nome dal suo callsign; quello di ogni unità Helix
// dalla sua chiave nel DATABASE NEMICI (drone / hunter / sec / elite / titan).

const CHAR_SLUG: Record<string, string> = {
  ghost: 'vex', chrome: 'rook', cipher: 'nyx', ripper: 'kora', face: 'echo', driver: 'jax',
  breacher: 'mako', handler: 'sol',
};

// characterId dell'operativo -> URL della sua icona.
export const charImg = (characterId: string) => `/roster/${CHAR_SLUG[characterId] || characterId}.png`;

// Illustrazione trasparente dell'arma assegnata a ciascun operativo.
export const weaponImg = (characterId: string) => `/weapons/${characterId}.png`;

// id di un nemico vivo ("sec-2") -> chiave di specie ("sec").
export const enemyKind = (id: string) => id.split('-')[0];

// chiave di specie -> URL dell'icona.
export const enemyImg = (kind: string) => `/roster/${kind}.png`;

// Sulla plancia le unità Helix sono sagome trasparenti; MINACCE usa le miniature quadrate.
export const enemyMapImg = (kind: string) => `/roster/${kind}-map.png`;

// Icona del nodo di rete sulla plancia (sagoma trasparente).
export const nodeImg = '/roster/node-map.png';

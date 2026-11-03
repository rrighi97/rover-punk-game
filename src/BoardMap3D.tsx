// PLANCIA 3D (TEST)
// Stessa interfaccia di BoardMap, ma la pianta è una scena three.js in visuale isometrica
// (camera ortografica): stanze con pavimento e muri estrusi, porte sul muro condiviso, operativi
// e nemici come pedine 3D. Solo visualizzazione: i dati arrivano dallo stesso stato di partita.
// `BoardMapView` è l'interruttore 2D/3D usato dalla plancia: la vista 2D resta quella di sempre.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import BoardMap, { doorSides, roomProps, seedHash, type Foe, type Pawn, type Room } from './BoardMap';
import { buildFoe, hasFoe } from './foes3d';
import { buildOperative, hasOperative } from './operatives3d';
import { nodeImg } from './roster';

type BoardProps = React.ComponentProps<typeof BoardMap>;

// Unità di mondo: una cella è larga CW e profonda CD; G è lo spessore del muro fra due stanze.
const CW = 4, CD = 3, G = 0.3, WALL_H = 0.8, DOOR_W = 1.6;
const BASE_H = 0.07;
// Drone: raggio del guscio, quota di volo e rosso dei suoi neon.
const DRONE_R = 0.21, DRONE_Y = 0.6, DRONE_RED = '#ff2a3c';
const PANEL_SCALE = 1.15;
const RED = '#ff4a5e', GREEN = '#6bdf6a', CYAN = '#62f4ff', ACID = '#c9ff45';
const FONT = 'Impact, "Arial Narrow", sans-serif';
// Porta: stipiti a strisce di pericolo larghi JAMB, due battenti larghi LEAF_W che scorrono nel muro.
const JAMB = 0.1, LEAF_W = (DOOR_W - 2 * JAMB) / 2;
const DOOR_SHUT = new THREE.Color('#ff2a5c'), DOOR_OPEN = new THREE.Color('#3fe9ff'), HAZARD = new THREE.Color('#ffd23f');
// Stesse skin della plancia 2D: lamiera industriale per i pavimenti, portellone fumetto per i battenti.
const FLOOR_SKIN = '/missions/valigetta/floor-industrial-cyberpunk.png', DOOR_SKIN = '/doors/helix-comic-skin.jpg';
// Cassa e nodo: gli stessi disegni della 2D, stesi sul coperchio della cassa e sulle facce del nodo.
const CHEST_SKIN = '/props/cassa.png';
// Segnalini di missione, coi colori di `.token.mark-token.*` in 2D: [neon, lamiera chiara, lamiera
// scura, cantonali (se diversi dal neon)].
const MARK_TONES: Record<string, string[]> = {
  vault: ['#ff83ad', '#3b0d23', '#190810'],
  case: ['#ffda66', '#4b3106', '#1c1205'],
  specter: ['#8feaff', '#0b3340', '#06171c'],
  cornered: ['#ffe38a', '#4b3106', '#1f1806'],
  chest: ['#3fe9ff', '#2b323c', '#10141a', '#f0a81e'],
  done: ['#8b9a95', '#232b29', '#161c1a'],
};
// Direzione di default della camera: da sud-est, dall'alto.
const VIEW_AZIMUTH = 0.6, VIEW_ELEVATION = 0.84;

type Rect = { x0: number; z0: number; x1: number; z1: number };

// ARREDO IN RILIEVO: i mobili non sono dipinti sul pavimento ma costruiti a blocchi, col disegno
// della 2D steso sulle facce superiori. `aspect` = larghezza/profondità della pianta, `max` =
// profondità massima in unità di mondo, `turn` = il retro (lato alto del disegno) va verso il muro.
// Un mobile di `ROOM_PROPS` che non compare qui resta dipinto sul pavimento.
const FURNITURE: Record<string, { aspect: number; max: number; turn: boolean }> = {
  '/props/letto.png': { aspect: 316 / 420, max: 1.3, turn: false },
  '/props/poltrona.png': { aspect: 251 / 322, max: 1, turn: true },
  '/props/tavolo.png': { aspect: 408 / 381, max: 1.3, turn: false },
  '/props/divano.png': { aspect: 396 / 420, max: 1.3, turn: true },
  '/props/pianta.png': { aspect: 1, max: 0.6, turn: false },
  '/props/desk.png': { aspect: 420 / 247, max: 0.9, turn: true },
  // Il disegno è un prospetto, non una pianta: fa da facciata a un armadio in piedi contro il muro.
  '/props/mobile.png': { aspect: 1.5, max: 0.28, turn: true },
  '/props/mobiletto.png': { aspect: 196 / 420, max: 1.3, turn: false },
};
// Ingombro del mobile nella stanza: stesso riquadro e stesso lato dell'arredo dipinto (vedi
// `paintFloor`). `fw` x `fd` è la pianta nel suo verso, `ex` x `ez` quella nel mondo.
type Solid = { src: string; side: string; x: number; z: number; fw: number; fd: number; ex: number; ez: number; rot: number };
function furnitureSpot(r: Rect, src: string, side: string): Solid {
  const f = FURNITURE[src], W = r.x1 - r.x0, D = r.z1 - r.z0;
  const flat = side === 'top' || side === 'bottom', turned = f.turn && !flat;
  const bw = W * (flat ? 0.4 : 0.26), bd = D * (flat ? 0.34 : 0.46);
  const fd = Math.min(turned ? bw : bd, (turned ? bd : bw) / f.aspect, f.max), fw = fd * f.aspect;
  const [ex, ez] = turned ? [fd, fw] : [fw, fd];
  const x = side === 'left' ? r.x0 + W * 0.03 + ex / 2 : side === 'right' ? r.x1 - W * 0.03 - ex / 2 : (r.x0 + r.x1) / 2;
  const z = side === 'top' ? r.z0 + D * 0.03 + ez / 2 : side === 'bottom' ? r.z1 - D * 0.03 - ez / 2 : (r.z0 + r.z1) / 2;
  const rot = !f.turn ? 0 : side === 'bottom' ? Math.PI : side === 'left' ? Math.PI / 2 : side === 'right' ? -Math.PI / 2 : 0;
  return { src, side, x, z, fw, fd, ex, ez, rot };
}
const rectOf = (r: Room): Rect => ({
  x0: (r.col - 1) * CW + G / 2, z0: (r.row - 1) * CD + G / 2,
  x1: (r.col - 1 + (r.w || 1)) * CW - G / 2, z1: (r.row - 1 + (r.h || 1)) * CD - G / 2,
});

// Porta: centro del muro condiviso fra due stanze collegate. `vertical` = il muro corre lungo z
// (le due stanze sono una a ovest e una a est).
type DoorSpot = { key: string; x: number; z: number; vertical: boolean; a: Room; b: Room };
type Side = 'N' | 'S' | 'W' | 'E';
function doorSpots(rooms: Room[]) {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const spots: DoorSpot[] = [];
  const cuts = new Map<string, number[]>();
  const cut = (room: Room, side: Side, at: number) => {
    const k = `${room.id}:${side}`;
    cuts.set(k, [...(cuts.get(k) || []), at]);
  };
  for (const a of rooms) for (const id of a.links) {
    const b = byId.get(id);
    if (!b) continue;
    const key = [a.id, b.id].sort().join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    const ra = rectOf(a), rb = rectOf(b);
    const ovZ = Math.min(ra.z1, rb.z1) - Math.max(ra.z0, rb.z0);
    const ovX = Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0);
    const near = (v: number) => Math.abs(v - G) < 0.01;
    if (ovZ > 0 && (near(rb.x0 - ra.x1) || near(ra.x0 - rb.x1))) {
      const [w, e] = ra.x0 < rb.x0 ? [a, b] : [b, a];
      const z = (Math.max(ra.z0, rb.z0) + Math.min(ra.z1, rb.z1)) / 2;
      spots.push({ key, x: rectOf(w).x1 + G / 2, z, vertical: true, a, b });
      cut(w, 'E', z); cut(e, 'W', z);
    } else if (ovX > 0 && (near(rb.z0 - ra.z1) || near(ra.z0 - rb.z1))) {
      const [n, s] = ra.z0 < rb.z0 ? [a, b] : [b, a];
      const x = (Math.max(ra.x0, rb.x0) + Math.min(ra.x1, rb.x1)) / 2;
      spots.push({ key, x, z: rectOf(n).z1 + G / 2, vertical: false, a, b });
      cut(n, 'S', x); cut(s, 'N', x);
    }
  }
  return { spots, cuts };
}

// Tratti di muro fra `from` e `to`, lasciando un varco largo DOOR_W attorno a ogni porta.
function wallRuns(from: number, to: number, doors: number[]) {
  const runs: [number, number][] = [];
  let start = from;
  for (const d of [...doors].sort((p, q) => p - q)) {
    if (d - DOOR_W / 2 > start) runs.push([start, d - DOOR_W / 2]);
    start = d + DOOR_W / 2;
  }
  if (to > start) runs.push([start, to]);
  return runs;
}

function canvasOf(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') as CanvasRenderingContext2D };
}

function textTexture(text: string, color: string, w = 128, h = 128, size = 84) {
  const { canvas, ctx } = canvasOf(w, h);
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 6; ctx.strokeStyle = '#030707'; ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// UV in unità di mondo: la texture si ripete ogni `tu` x `tv` invece di stirarsi su ogni faccia.
function tileUV(geo: THREE.BoxGeometry, tu: number, tv: number) {
  const { width: sx, height: sy, depth: sz } = geo.parameters;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * dims[i >> 2][0] / tu, uv.getY(i) * dims[i >> 2][1] / tv);
  return geo;
}

// Restringe la u di una faccia del box (4 = fronte, 5 = retro) a una fetta [u0,u1] della texture.
function faceU(geo: THREE.BoxGeometry, face: number, u0: number, u1: number) {
  const uv = geo.attributes.uv;
  for (let i = face * 4; i < face * 4 + 4; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
}

// MURI: lamiera scura a pannelli imbullonati, con neon ciano/magenta e battiscopa. Due pannelli
// per tessera, ripetuta lungo il muro.
function wallTexture() {
  const { canvas, ctx } = canvasOf(256, 128);
  const steel = ctx.createLinearGradient(0, 0, 0, 128);
  steel.addColorStop(0, '#323c50'); steel.addColorStop(0.55, '#1c2433'); steel.addColorStop(1, '#0c1019');
  ctx.fillStyle = steel; ctx.fillRect(0, 0, 256, 128);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = i % 3 ? '#00000026' : '#ffffff0f';
    ctx.fillRect(rand() * 256, rand() * 128, 1 + rand() * 6, 1 + rand() * 3);
  }
  [0, 128].forEach((x, panel) => {
    ctx.fillStyle = '#05070c'; ctx.fillRect(x, 0, 3, 128);
    ctx.fillStyle = '#ffffff1a'; ctx.fillRect(x + 3, 0, 1, 128);
    for (const [rx, ry] of [[12, 12], [116, 12], [12, 100], [116, 100]]) {
      ctx.fillStyle = '#080a10'; ctx.beginPath(); ctx.arc(x + rx, ry, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff33'; ctx.beginPath(); ctx.arc(x + rx - 1, ry - 1, 1.1, 0, Math.PI * 2); ctx.fill();
    }
    const neon = panel ? '#ff5fd0' : '#3fe9ff';
    ctx.shadowColor = neon; ctx.shadowBlur = 12; ctx.fillStyle = neon;
    ctx.fillRect(x + 26, 30, 76, 5);
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffffffb0'; ctx.fillRect(x + 28, 31.5, 72, 1.5);
    ctx.fillStyle = '#05070c';
    for (let y = 54; y < 84; y += 7) ctx.fillRect(x + (panel ? 30 : 58), y, 40, 3);
  });
  ctx.fillStyle = '#06080dd9'; ctx.fillRect(0, 112, 256, 16);
  ctx.fillStyle = '#b56bd066'; ctx.fillRect(0, 111, 256, 1.5);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// STIPITI: strisce diagonali bianche su inchiostro; il colore (giallo o ciano) lo mette il materiale.
function hazardTexture() {
  const { canvas, ctx } = canvasOf(64, 64);
  ctx.fillStyle = '#02040a'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  for (let x = -64; x < 128; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 16, 0); ctx.lineTo(x - 48, 64); ctx.lineTo(x - 64, 64); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Ritaglia un disegno al suo contenuto opaco e lo stende su un fondo pieno (la faccia di un solido
// non può avere buchi); `spent` lo spegne come `grayscale + brightness` in 2D.
function skinTexture(img: HTMLImageElement, bg: string, spent: boolean) {
  const src = canvasOf(img.naturalWidth, img.naturalHeight);
  src.ctx.drawImage(img, 0, 0);
  const { data, width, height } = src.ctx.getImageData(0, 0, src.canvas.width, src.canvas.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 40) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) { x0 = y0 = 0; x1 = width - 1; y1 = height - 1; }
  const { canvas, ctx } = canvasOf(x1 - x0 + 1, y1 - y0 + 1);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src.canvas, -x0, -y0);
  if (spent) {
    ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#02050b8c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return new THREE.CanvasTexture(canvas);
}

// PANNELLO dei segnalini di missione e dei fianchi della cassa: lamiera graffiata con cantonali,
// cornice al neon e, se c'è, la sigla del segnalino.
function panelTexture([neon, c0, c1, corner = neon]: string[], glyph: string, w = 128, h = 128) {
  const { canvas, ctx } = canvasOf(w, h);
  const steel = ctx.createLinearGradient(0, 0, w, h);
  steel.addColorStop(0, c0); steel.addColorStop(1, c1);
  ctx.fillStyle = steel; ctx.fillRect(0, 0, w, h);
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = i % 3 ? '#00000030' : '#ffffff12';
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 8, 1 + rand() * 2);
  }
  ctx.strokeStyle = '#03050c'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, w - 8, h - 8);
  const c = Math.min(w, h) * 0.22;
  ctx.fillStyle = corner;
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (x ? -c : c), y); ctx.lineTo(x, y + (y ? -c : c)); ctx.fill();
  }
  ctx.shadowColor = neon; ctx.shadowBlur = 10;
  ctx.strokeStyle = neon; ctx.lineWidth = 3; ctx.strokeRect(15, 15, w - 30, h - 30);
  if (glyph) {
    ctx.font = `700 ${h * (glyph.length > 2 ? 0.3 : 0.56)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 7; ctx.strokeStyle = '#03050c'; ctx.strokeText(glyph, w / 2, h * 0.53);
    ctx.fillStyle = neon; ctx.fillText(glyph, w / 2, h * 0.53);
  }
  return new THREE.CanvasTexture(canvas);
}

// Materiale di un solido con la skin: l'emissione la tiene leggibile anche in ombra.
function skinMat(tex: THREE.Texture | null, glow: number) {
  return new THREE.MeshStandardMaterial({ map: tex, color: tex ? 0xffffff : 0x1a2030, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: tex ? glow : 0, roughness: 0.55, metalness: 0.2 });
}

// Alone luminoso: rosso col cuore bianco per la telecamera, tinta unita per casse e segnalini.
function glowTexture(color = '#ff4a5e', core = '#ffffff') {
  const { canvas, ctx } = canvasOf(64, 64);
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, core); glow.addColorStop(0.22, color); glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

// Pavimento di una stanza, come la tessera della plancia 2D: ritaglio della lamiera industriale
// (un punto diverso per stanza), velatura di stato, cornice neon, arredo visto dall'alto,
// targhetta con sigla e nome, START/EXIT al centro.
const FLOOR_PX = 128;
// [velatura a 135° su tre fermate, cornice]
const FLOOR_TONES = {
  base: ['#0b1328b8', '#1e0a2a46', '#04141c9c', '#9357a8'],
  hostile: ['#400c27a8', '#16071b55', '#12060cc4', '#e44878'],
  start: ['#042c46a1', '#07142850', '#19092b92', '#54e8ff'],
  exit: ['#300e4aa1', '#0b112350', '#22092b92', '#dc76ff'],
};
// Neon in cima ai muri della stanza: stesso codice colore della cornice.
const TRIM_TONES = { base: '#b56bd0', hostile: '#ff4878', start: '#54e8ff', exit: '#dc76ff', dark: '#3a3350' };
type Decor = { img: HTMLImageElement; side: string };
function paintFloor(ctx: CanvasRenderingContext2D, room: Room, tone: keyof typeof TRIM_TONES, index: number, skin: HTMLImageElement | undefined, decor: Decor[]) {
  const { width: w, height: h } = ctx.canvas;
  ctx.globalAlpha = 1; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  if (tone === 'dark') {
    ctx.fillStyle = '#0d121c'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1a2136'; ctx.lineWidth = 2;
    for (let x = FLOOR_PX / 2; x < w; x += FLOOR_PX / 2) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = FLOOR_PX / 2; y < h; y += FLOOR_PX / 2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = FLOOR_TONES.base[3]; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
  } else {
    ctx.fillStyle = '#111922'; ctx.fillRect(0, 0, w, h);
    if (skin) {
      // Come `background-size:245%` in 2D: una cella mostra circa 1/2.45 della lamiera.
      const k = Math.min(skin.width / 2.45 / (CW * FLOOR_PX), skin.width / w, skin.height / h);
      const sw = w * k, sh = h * k;
      ctx.drawImage(skin, (skin.width - sw) * ((index * 29) % 100) / 100, (skin.height - sh) * ((index * 47) % 100) / 100, sw, sh, 0, 0, w, h);
    }
    const [c0, c1, c2, edge] = FLOOR_TONES[tone];
    const wash = ctx.createLinearGradient(0, 0, w, h);
    wash.addColorStop(0, c0); wash.addColorStop(0.52, c1); wash.addColorStop(1, c2);
    ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h);
    const sides = ctx.createLinearGradient(0, 0, w, 0);
    sides.addColorStop(0, '#21e9ff18'); sides.addColorStop(0.26, '#21e9ff00'); sides.addColorStop(0.72, '#ec5dcb00'); sides.addColorStop(1, '#ec5dcb16');
    ctx.fillStyle = sides; ctx.fillRect(0, 0, w, h);
    const shade = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) / 2);
    shade.addColorStop(0, '#02050b00'); shade.addColorStop(1, '#02050bb8');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = edge; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.strokeStyle = '#d16fe055'; ctx.lineWidth = 2; ctx.strokeRect(13, 13, w - 26, h - 26); ctx.strokeRect(19, 19, w - 38, h - 38);
    const tag = room.exit ? 'EXIT' : room.start ? 'START' : '';
    if (tag) {
      ctx.font = `700 ${Math.min(150, h * 0.42)}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff30'; ctx.fillText(tag, w / 2, h * 0.58);
    }
    // ARREDO: stessi mobili e stessi lati della 2D (vedi `.room-prop.side-*` in styles.css).
    ctx.globalAlpha = 0.92; ctx.shadowColor = '#000000a0'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
    for (const { img, side } of decor) {
      const flat = side === 'top' || side === 'bottom';
      const bw = w * (flat ? 0.4 : 0.26), bh = h * (flat ? 0.34 : 0.46);
      const s = Math.min(bw / img.width, bh / img.height), dw = img.width * s, dh = img.height * s;
      const x = side === 'left' ? w * 0.03 : side === 'right' ? w * 0.97 - dw : (w - dw) / 2;
      const y = side === 'top' ? h * 0.03 : side === 'bottom' ? h * 0.97 - dh : (h - dh) / 2;
      ctx.drawImage(img, x, y, dw, dh);
    }
    ctx.globalAlpha = 1; ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `700 46px ${FONT}`;
  const idW = ctx.measureText(room.id).width;
  const name = room.name.toUpperCase();
  ctx.font = '600 24px ui-sans-serif, system-ui, sans-serif';
  const nameW = Math.min(ctx.measureText(name).width, w - idW - 72);
  ctx.fillStyle = '#080b13c9'; ctx.fillRect(12, 12, idW + nameW + 36, 54);
  ctx.fillStyle = '#78e8ff'; ctx.fillRect(12, 12, 4, 54);
  ctx.fillStyle = '#ffffff'; ctx.fillText(name, 36 + idW, 53, nameW);
  ctx.font = `700 46px ${FONT}`; ctx.fillStyle = '#ffffff';
  ctx.fillText(room.id, 24, 57);
}

type Token = {
  group: THREE.Group; tilt: THREE.Group; faces: THREE.Object3D[]; ring: THREE.Mesh;
  // `model`: il modello 3D dell'unità, che `frame` orienta; `flies` = è il drone, sospeso a mezz'aria.
  model?: THREE.Object3D; flies: boolean;
  sig: string; target: THREE.Vector3; placed: boolean; down: boolean; dying: boolean; pulse: boolean;
  patrol?: { rect: Rect; halted: boolean }; lap: number;
};
type DoorObj = {
  leaves: [THREE.Mesh, THREE.Mesh]; skin: THREE.MeshStandardMaterial; tone: THREE.MeshBasicMaterial; jamb: THREE.MeshStandardMaterial;
  bar: THREE.Mesh; open: number; target: number; group: THREE.Group; spot: DoorSpot;
};
type FloorObj = {
  room: Room; index: number; rect: Rect; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mat: THREE.MeshStandardMaterial;
  trim: THREE.MeshBasicMaterial; fog: THREE.Mesh; state: string; solids: Solid[];
};
type CamObj = { pan: THREE.Group; led: THREE.Mesh; halo: THREE.Sprite; phase: number };
// Segnalino che pulsa (o sfarfalla) e, se `float`, resta sospeso girando su sé stesso.
type GlowObj = { mat: THREE.MeshStandardMaterial; glow: number; period: number; flicker?: boolean; float?: THREE.Object3D; y: number; halo?: THREE.Sprite; size?: number };
type Fx = { obj: THREE.Object3D; born: number; life: number; rise: number };

function dispose(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) m.dispose();
  });
}

class IsoScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  private controls: OrbitControls;
  private hemi = new THREE.HemisphereLight(0xb8efe6, 0x0a1412, 1.1);
  private sun = new THREE.DirectionalLight(0xffffff, 1.7);
  private staticGroup = new THREE.Group();
  private doorGroup = new THREE.Group();
  private propGroup = new THREE.Group();
  private tokenGroup = new THREE.Group();
  private fxGroup = new THREE.Group();
  private floors = new Map<string, FloorObj>();
  private doors: DoorObj[] = [];
  private cams: CamObj[] = [];
  private glows: GlowObj[] = [];
  private images = new Map<string, HTMLImageElement>();
  private resync?: () => void;
  private stale = false;
  private tokens = new Map<string, Token>();
  private fx: Fx[] = [];
  private seenHits = new Set<number>();
  private textures = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  private raycaster = new THREE.Raycaster();
  private center = new THREE.Vector3();
  private half = { x: 10, y: 10 };
  private roomsKey = '';
  private propsKey = '';
  private blackout = false;
  private raf = 0;
  private last = performance.now();
  private resizer: ResizeObserver;

  constructor(private host: HTMLElement, private tip: HTMLElement) {
    // Fondo trasparente: ai lati della pianta si vede lo sfondo della plancia 2D (`.board-map`).
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const el = this.renderer.domElement;
    el.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0';
    host.appendChild(el);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.staticGroup, this.doorGroup, this.propGroup, this.tokenGroup, this.fxGroup);

    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = 1.35;
    this.controls.minZoom = 0.6;
    this.controls.maxZoom = 5;

    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', this.hideTip);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(host);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizer.disconnect();
    this.controls.dispose();
    dispose(this.scene);
    for (const t of this.textures.values()) t.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  resetView = () => {
    const dir = new THREE.Vector3(Math.sin(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION), Math.sin(VIEW_ELEVATION), Math.cos(VIEW_AZIMUTH) * Math.cos(VIEW_ELEVATION));
    this.controls.target.copy(this.center);
    this.camera.position.copy(this.center).addScaledVector(dir, 120);
    this.camera.zoom = 1;
    this.camera.lookAt(this.center);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  };

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const hh = Math.max(this.half.y, this.half.x / aspect) * 1.03;
    this.camera.left = -hh * aspect; this.camera.right = hh * aspect;
    this.camera.top = hh; this.camera.bottom = -hh;
    this.camera.updateProjectionMatrix();
  }

  private cached(key: string, make: () => THREE.Texture) {
    let tex = this.textures.get(key);
    if (!tex) {
      tex = make();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.textures.set(key, tex);
    }
    return tex;
  }

  private texture(url: string) {
    return this.cached(url, () => this.loader.load(url));
  }

  // Immagine da dipingere su pavimenti e segnalini: finché non è caricata non c'è; all'arrivo
  // pavimenti e segnalini si rifanno al fotogramma successivo.
  private image(url: string) {
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.onload = () => { this.stale = true; };
      img.src = url;
      this.images.set(url, img);
    }
    return img.complete && img.naturalWidth ? img : undefined;
  }

  private skin(url: string, bg: string, spent: boolean) {
    const img = this.image(url);
    return img ? this.cached(`skin:${url}:${spent}`, () => skinTexture(img, bg, spent)) : null;
  }

  // PIANTA: pavimenti, muri e porte. Si ricostruisce solo se cambia la plancia (nuova missione).
  private buildRooms(rooms: Room[]) {
    for (const g of [this.staticGroup, this.doorGroup]) { dispose(g); g.clear(); }
    this.floors.clear();
    this.doors = [];
    const cols = Math.max(1, ...rooms.map((r) => r.col + (r.w || 1) - 1));
    const rows = Math.max(1, ...rooms.map((r) => r.row + (r.h || 1) - 1));
    const W = cols * CW, D = rows * CD;
    this.center.set(W / 2, 0, D / 2);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.4, D + 1.2), new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 1 }));
    slab.position.set(W / 2, -0.21, D / 2);
    slab.receiveShadow = true;
    this.staticGroup.add(slab);

    const { spots, cuts } = doorSpots(rooms);
    const wallTex = this.cached('wall', wallTexture);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.35, roughness: 0.7, metalness: 0.1 });
    // Ogni tratto di muro porta in cima un filo di neon col colore di stato della sua stanza.
    const wall = (cx: number, cz: number, sx: number, sz: number, trim: THREE.Material) => {
      const mesh = new THREE.Mesh(tileUV(new THREE.BoxGeometry(sx, WALL_H, sz), WALL_H * 2, WALL_H), wallMat);
      mesh.position.set(cx, WALL_H / 2, cz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const neon = new THREE.Mesh(new THREE.BoxGeometry(sx > sz ? sx : 0.05, 0.03, sx > sz ? 0.05 : sz), trim);
      neon.position.y = WALL_H / 2 + 0.015;
      mesh.add(neon);
      this.staticGroup.add(mesh);
    };
    const fogMat = new THREE.MeshBasicMaterial({ color: 0x0a1218, transparent: true, opacity: 0.42, depthWrite: false });
    rooms.forEach((room, index) => {
      const r = rectOf(room);
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const { canvas, ctx } = canvasOf(Math.round(w * FLOOR_PX), Math.round(d * FLOOR_PX));
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      // L'emissione tiene accesi i neon della lamiera anche dove la luce non arriva.
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.85 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
      floor.receiveShadow = true;
      const fog = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), fogMat);
      fog.position.set((r.x0 + r.x1) / 2, WALL_H / 2 + 0.01, (r.z0 + r.z1) / 2);
      const trim = new THREE.MeshBasicMaterial({ color: TRIM_TONES.base, toneMapped: false });
      this.staticGroup.add(floor, fog);
      this.floors.set(room.id, { room, index, rect: r, ctx, tex, mat, trim, fog, state: '', solids: [] });

      const side = (s: Side) => cuts.get(`${room.id}:${s}`) || [];
      for (const [a, b] of wallRuns(r.x0 - G / 2, r.x1 + G / 2, side('N'))) wall((a + b) / 2, r.z0 - G / 4, b - a, G / 2, trim);
      for (const [a, b] of wallRuns(r.x0 - G / 2, r.x1 + G / 2, side('S'))) wall((a + b) / 2, r.z1 + G / 4, b - a, G / 2, trim);
      for (const [a, b] of wallRuns(r.z0, r.z1, side('W'))) wall(r.x0 - G / 4, (a + b) / 2, G / 2, b - a, trim);
      for (const [a, b] of wallRuns(r.z0, r.z1, side('E'))) wall(r.x1 + G / 4, (a + b) / 2, G / 2, b - a, trim);
    });

    // PORTE, come in 2D: due stipiti a strisce di pericolo, due battenti con la skin del portellone
    // (metà immagine per battente) che scorrono dentro il muro. Bloccata = rossa, con sbarra e
    // in cima una linea neon; aperta = ciano, col varco illuminato a terra.
    const doorTex = this.texture(DOOR_SKIN), hazardTex = this.cached('hazard', hazardTexture);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x0b0e16, roughness: 0.6 });
    const leafGeos = [0, 1].map((i) => {
      const geo = new THREE.BoxGeometry(LEAF_W, WALL_H, G * 0.45);
      faceU(geo, 4, i * 0.5, i * 0.5 + 0.5);
      faceU(geo, 5, 0.5 - i * 0.5, 1 - i * 0.5);
      return geo;
    });
    const jambGeo = tileUV(new THREE.BoxGeometry(JAMB, WALL_H, G), 0.2, 0.2);
    for (const spot of spots) {
      const group = new THREE.Group();
      group.position.set(spot.x, 0, spot.z);
      if (spot.vertical) group.rotation.y = Math.PI / 2;
      const skin = new THREE.MeshStandardMaterial({ map: doorTex, emissive: DOOR_SHUT, emissiveMap: doorTex, emissiveIntensity: 0.75, roughness: 0.5 });
      const tone = new THREE.MeshBasicMaterial({ color: DOOR_SHUT, toneMapped: false });
      const jamb = new THREE.MeshStandardMaterial({ map: hazardTex, color: HAZARD, emissive: HAZARD, emissiveMap: hazardTex, emissiveIntensity: 0.5, roughness: 0.6 });
      const leaf = (geo: THREE.BoxGeometry) => new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, skin, skin]);
      const leaves: [THREE.Mesh, THREE.Mesh] = [leaf(leafGeos[0]), leaf(leafGeos[1])];
      for (const mesh of leaves) { mesh.position.y = WALL_H / 2; mesh.castShadow = true; }
      const posts = [-1, 1].map((dir) => {
        const post = new THREE.Mesh(jambGeo, jamb);
        post.position.set(dir * (DOOR_W - JAMB) / 2, WALL_H / 2, 0);
        post.castShadow = true;
        return post;
      });
      const sill = new THREE.Mesh(new THREE.BoxGeometry(LEAF_W * 2, 0.03, G), tone);
      sill.position.y = 0.015;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(LEAF_W * 2, 0.07, G * 0.45 + 0.05), tone);
      bar.position.y = WALL_H * 0.5;
      const neon = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, 0.03, 0.05), tone);
      neon.position.y = WALL_H + 0.015;
      group.add(...leaves, ...posts, sill, bar, neon);
      this.doorGroup.add(group);
      this.doors.push({ leaves, skin, tone, jamb, bar, open: -1, target: 0, group, spot });
    }

    // Inquadratura: quanto è grande la pianta vista dalla direzione di default.
    this.resetView();
    this.camera.updateMatrixWorld();
    const inv = this.camera.matrixWorldInverse.clone().copy(this.camera.matrixWorld).invert();
    this.half = { x: 1, y: 1 };
    for (const x of [0, W]) for (const y of [0, WALL_H + 1]) for (const z of [0, D]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      this.half.x = Math.max(this.half.x, Math.abs(p.x));
      this.half.y = Math.max(this.half.y, Math.abs(p.y));
    }
    this.sun.position.set(W / 2 - W * 0.35, 22, D / 2 + D * 0.5);
    this.sun.target.position.copy(this.center);
    const reach = Math.hypot(W, D) / 2 + 2;
    Object.assign(this.sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 80 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.resize();
  }

  // PEDINA: il modello 3D dell'unità (drone o figura) sospeso sopra un alone a terra nel suo colore.
  // Un'unità senza modello ripiega sulla sagoma col ritratto, in piedi su una base colorata.
  private buildToken(unit: Pawn | Foe, foe: Foe | null): Omit<Token, 'sig' | 'target' | 'placed' | 'lap'> {
    const group = new THREE.Group(), tilt = new THREE.Group();
    const faces: THREE.Object3D[] = [];
    const tint = new THREE.Color(foe ? RED : (unit as Pawn).color || CYAN);
    const scale = foe?.elite ? 1.25 : 1;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    const key = foe ? foe.kind || '' : unit.img?.match(/\/roster\/(\w+)\.png$/)?.[1] || '';
    const flies = key === 'drone';
    let model: THREE.Object3D | undefined;
    if (flies || (foe ? hasFoe(key) : hasOperative(key))) {
      model = flies ? this.buildDrone() : foe ? buildFoe(key, (color, y) => this.halo(color, y)) : buildOperative(key, tint);
      const glow = foe ? DRONE_RED : `#${tint.getHexString()}`;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), new THREE.MeshBasicMaterial({ map: this.cached(`glow:${glow}`, () => glowTexture(glow, glow)), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.015;
      pool.raycast = () => {};
      // L'alone del nemico collassa con lui; quello dell'operativo resta a terra quando cade.
      tilt.add(model);
      (foe ? tilt : group).add(pool);
    } else {
      const solid = new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.35, roughness: 0.5 });
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, BASE_H, foe ? 6 : 28), solid);
      base.position.y = BASE_H / 2;
      base.castShadow = true;
      const card = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.76, 0.05), new THREE.MeshStandardMaterial({ color: tint.clone().multiplyScalar(0.45), emissive: tint, emissiveIntensity: 0.3, roughness: 0.6 }));
      back.castShadow = true;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.68), new THREE.MeshBasicMaterial({ color: 0x07110f }));
      plate.position.z = 0.027;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.58), new THREE.MeshBasicMaterial({ map: unit.img ? this.texture(unit.img) : textTexture(unit.label, '#ffffff'), transparent: true, alphaTest: 0.05, toneMapped: false }));
      face.position.z = 0.031;
      card.add(back, plate, face);
      card.scale.setScalar(PANEL_SCALE);
      card.position.y = BASE_H + 0.38 * PANEL_SCALE;
      tilt.add(card);
      faces.push(card);
      group.add(base);
    }
    group.add(ring, tilt);
    group.scale.setScalar(scale);
    return { group, tilt, faces, ring, model, flies, down: false, dying: false, pulse: false };
  }

  // DRONE (WASP D-2), ricostruito dal suo disegno: guscio sferico a piastre di corazza con le
  // fughe accese di rosso (un nucleo luminoso che traspare fra una piastra e l'altra), piastra
  // frontale coi quattro occhi, spallacci con le spie gialle, cresta e ugello di sostentamento.
  // Il muso guarda +Z, appena alzato verso la camera; `frame` lo fa galleggiare e lo orienta.
  private buildDrone() {
    const R = DRONE_R, yawer = new THREE.Group(), pod = new THREE.Group();
    const armor = new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.38, metalness: 0.65, flatShading: true });
    const ink = new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.5, metalness: 0.5 });
    const red = new THREE.MeshBasicMaterial({ color: DRONE_RED, toneMapped: false });
    const amber = new THREE.MeshBasicMaterial({ color: '#ffc83d', toneMapped: false });
    const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.965, 24, 16), red);
    core.castShadow = true;
    pod.add(core);
    // Piastre: calotte e due fasce da sei spicchi, sfalsate, separate da fughe sottili.
    const plate = (phi0: number, phiLen: number, th0: number, thLen: number) => pod.add(new THREE.Mesh(new THREE.SphereGeometry(R, 4, 3, phi0, phiLen, th0, thLen), armor));
    const SEAM = 0.07, SLICE = Math.PI / 3;
    plate(0, Math.PI * 2, 0, 0.5);
    plate(0, Math.PI * 2, Math.PI - 0.5, 0.5);
    for (let i = 0; i < 6; i++) {
      plate(i * SLICE + SEAM / 2, SLICE - SEAM, 0.5 + SEAM, Math.PI / 2 - 0.5 - SEAM * 1.5);
      plate((i + 0.5) * SLICE + SEAM / 2, SLICE - SEAM, Math.PI / 2 + SEAM / 2, Math.PI / 2 - 0.5 - SEAM * 1.5);
    }
    // Muso: disco scuro bordato di rosso, coi quattro occhi incassati nelle loro ghiere.
    const face = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.56, R * 0.62, 0.05, 8).rotateX(Math.PI / 2), ink);
    face.position.z = R * 0.86;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.6, 0.008, 6, 8), red);
    rim.position.z = R * 0.86 + 0.012;
    pod.add(face, rim);
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 10), red);
      eye.scale.z = 0.6;
      eye.position.set(dx * 0.052, dy * 0.052, R * 0.86 + 0.03);
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.011, 8, 16), ink);
      bezel.position.copy(eye.position);
      pod.add(eye, bezel);
    }
    // Spallacci con due spie gialle ciascuno, cresta in cima e ugello rosso sotto la pancia.
    for (const dir of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.2), armor);
      pad.position.x = dir * (R + 0.008);
      pad.rotation.z = dir * -0.12;
      pod.add(pad);
      for (const dz of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 0.04), amber);
        lamp.position.set(dir * (R + 0.034), 0.035, dz * 0.045);
        pod.add(lamp);
      }
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.14), red);
      slit.position.set(dir * (R + 0.034), -0.04, 0);
      pod.add(slit);
    }
    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.17), armor);
    crest.position.y = R - 0.004;
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.05, 0.035, 12), ink);
    nozzle.position.y = -R;
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 12), red);
    jet.position.y = -R - 0.02;
    const halo = this.halo(DRONE_RED, 0);
    halo.position.z = R * 0.9;
    halo.scale.setScalar(0.5);
    pod.add(crest, nozzle, jet, halo);
    pod.rotation.x = -0.35;
    yawer.add(pod);
    yawer.position.y = DRONE_Y;
    return yawer;
  }

  // MOBILE IN RILIEVO: blocchi a quote diverse, ognuno col suo ritaglio del disegno 2D sulla faccia
  // superiore (u,v = frazioni del disegno, da sinistra e dall'alto) e i fianchi in tinta unita.
  private buildFurniture({ src, x, z, fw, fd, rot }: Solid) {
    const tex = this.skin(src, '#15171d', false);
    const top = skinMat(tex, 0.3), screen = skinMat(tex, 0.9);
    const metal = new THREE.MeshStandardMaterial({ color: 0x1c2029, roughness: 0.6, metalness: 0.35 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x24262d, roughness: 0.95 });
    const g = new THREE.Group();
    const add = (mesh: THREE.Mesh) => { mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh; };
    // Facce rivolte in alto: prendono il punto del disegno che sta sopra di loro in pianta
    // (`u0`,`v0` = punto del disegno sull'origine della geometria).
    const mapTop = <T extends THREE.BufferGeometry>(geo: T, u0 = 0.5, v0 = 0.5) => {
      const { position: pos, normal: nor, uv } = geo.attributes;
      for (let i = 0; i < uv.count; i++) if (nor.getY(i) > 0.9) uv.setXY(i, u0 + pos.getX(i) / fw, 1 - v0 - pos.getZ(i) / fd);
      return geo;
    };
    const part = (u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, flank: THREE.Material = metal) => {
      const geo = mapTop(new THREE.BoxGeometry((u1 - u0) * fw, y1 - y0, (v1 - v0) * fd), (u0 + u1) / 2, (v0 + v1) / 2);
      add(new THREE.Mesh(geo, [flank, flank, top, flank, flank, flank])).position.set(((u0 + u1) / 2 - 0.5) * fw, (y0 + y1) / 2, ((v0 + v1) / 2 - 0.5) * fd);
    };
    // Blocco ruotato attorno alla verticale, centrato nel punto (u,v) del disegno.
    const turned = (u: number, v: number, sx: number, sz: number, y0: number, y1: number, yaw: number, flank: THREE.Material = metal) => {
      const geo = new THREE.BoxGeometry(sx, y1 - y0, sz).rotateY(yaw).translate((u - 0.5) * fw, (y0 + y1) / 2, (v - 0.5) * fd);
      add(new THREE.Mesh(mapTop(geo), [flank, flank, top, flank, flank, flank]));
    };
    const disc = (u: number, v: number, radius: number, y0: number, y1: number, sides = 40, flank: THREE.Material = metal) => {
      const geo = new THREE.CylinderGeometry(radius, radius, y1 - y0, sides);
      if (sides === 8) geo.rotateY(Math.PI / 8);
      add(new THREE.Mesh(mapTop(geo, u, v), [flank, top, flank])).position.set((u - 0.5) * fw, (y0 + y1) / 2, (v - 0.5) * fd);
    };
    const neon = (color: string, sx: number, sz: number, px: number, py: number, pz: number, sy = 0.03) => {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      strip.position.set(px, py, pz);
      g.add(strip);
    };
    const ring = (color: string, radius: number, y: number, u: number, v: number, sides = 48) => {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.012, 6, sides), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      hoop.rotation.set(Math.PI / 2, 0, sides === 8 ? Math.PI / 8 : 0);
      hoop.position.set((u - 0.5) * fw, y, (v - 0.5) * fd);
      g.add(hoop);
    };
    // Ciuffo di foglie a punta che si apre a raggiera dal punto (u,v) del disegno.
    const foliage = (u: number, v: number, y: number, reach: number, count: number) => {
      const leaf = new THREE.MeshStandardMaterial({ color: 0x2f8a4a, emissive: 0x1c6b35, emissiveIntensity: 0.35, roughness: 0.8, flatShading: true });
      for (let i = 0; i < count; i++) {
        const len = reach * (i ? 1.1 - 0.4 * ((i * 3) % 4) / 3 : 1.15);
        const blade = add(new THREE.Mesh(new THREE.ConeGeometry(reach * 0.11, len, 4).translate(0, len / 2, 0), leaf));
        blade.rotation.set(0, i * 2.4, i ? 0.35 + 0.75 * ((i * 7) % count) / count : 0);
        blade.position.set((u - 0.5) * fw, y, (v - 0.5) * fd);
      }
    };
    // Schermo in piedi: il ritaglio del disegno va sulla faccia frontale, che resta accesa.
    const monitor = (u0: number, v0: number, u1: number, v1: number, px: number, pz: number, y: number, yaw: number) => {
      const w = (u1 - u0) * fw, h = w * 0.5;
      const geo = new THREE.BoxGeometry(w, h, 0.025), uv = geo.attributes.uv;
      for (let i = 16; i < 20; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), 1 - v1 + uv.getY(i) * (v1 - v0));
      const panel = add(new THREE.Mesh(geo, [metal, metal, metal, metal, screen, metal]));
      panel.position.set(px, y + 0.06 + h / 2, pz);
      panel.rotation.y = yaw;
      add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.03), metal)).position.set(px, y + 0.03, pz);
    };
    if (src === '/props/letto.png') {
      // LETTO: telaio, testiera col neon magenta, materasso, piumone e cuscini.
      part(0, 0, 1, 1, 0, 0.14);
      part(0, 0, 1, 0.1, 0.14, 0.52);
      part(0.07, 0.1, 0.93, 0.95, 0.14, 0.3, cloth);
      part(0.07, 0.42, 0.93, 0.95, 0.3, 0.335, cloth);
      part(0.14, 0.14, 0.5, 0.38, 0.3, 0.37, cloth);
      part(0.47, 0.12, 0.86, 0.33, 0.3, 0.36, cloth);
      part(0.45, 0.21, 0.75, 0.4, 0.3, 0.4, cloth);
      neon('#d54bff', fw * 0.7, 0.02, 0, 0.43, -0.4 * fd + 0.01);
    } else if (src === '/props/poltrona.png') {
      // POLTRONA: seduta, braccioli e schienale, coi fili di neon ciano su fianchi e fronte.
      part(0.2, 0.3, 0.8, 1, 0, 0.24, cloth);
      part(0, 0.33, 0.24, 0.86, 0, 0.38);
      part(0.76, 0.33, 1, 0.86, 0, 0.38);
      part(0.12, 0, 0.88, 0.38, 0, 0.64, cloth);
      for (const dir of [-1, 1]) neon('#3fe9ff', 0.02, fd * 0.4, dir * (fw / 2 + 0.006), 0.27, 0.1 * fd);
      neon('#3fe9ff', fw * 0.44, 0.02, 0, 0.12, fd / 2 + 0.006);
    } else if (src === '/props/tavolo.png') {
      // TAVOLO: piano tondo su piede centrale, bordato di neon magenta, e quattro sedie agli angoli
      // con lo schienale verso l'esterno.
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
        const yaw = dx * dz * Math.PI / 4;
        turned(0.5 + dx * 0.3, 0.5 + dz * 0.3, fw * 0.27, fw * 0.27, 0, 0.2, yaw, cloth);
        turned(0.5 + dx * 0.39, 0.5 + dz * 0.39, fw * 0.3, fw * 0.06, 0, 0.44, yaw);
      }
      add(new THREE.Mesh(new THREE.CylinderGeometry(fw * 0.07, fw * 0.12, 0.3, 12), metal)).position.y = 0.15;
      disc(0.5, 0.495, fw * 0.37, 0.3, 0.35);
      ring('#ff5fd0', fw * 0.335, 0.355, 0.5, 0.495);
      disc(0.34, 0.47, fw * 0.05, 0.35, 0.42);
      foliage(0.52, 0.43, 0.35, fw * 0.09, 7);
    } else if (src === '/props/divano.png') {
      // DIVANO AD ANGOLO: due sedute a L, schienali sui due lati esterni, braccioli in testa e cuscini.
      const plum = new THREE.MeshStandardMaterial({ color: 0x6a1470, emissive: 0x6a1470, emissiveIntensity: 0.25, roughness: 0.9 });
      part(0.1, 0.1, 0.58, 0.41, 0, 0.22, cloth);
      part(0.58, 0.1, 0.86, 0.89, 0, 0.22, cloth);
      part(0.02, 0.02, 0.93, 0.1, 0, 0.5);
      part(0.86, 0.06, 0.93, 0.92, 0, 0.5);
      part(0, 0.08, 0.1, 0.41, 0, 0.34);
      part(0.6, 0.88, 0.9, 0.96, 0, 0.34);
      turned(0.74, 0.28, fw * 0.2, fw * 0.2, 0.22, 0.3, Math.PI / 5, plum);
      part(0.69, 0.56, 0.88, 0.82, 0.22, 0.29, cloth);
      neon('#d54bff', fw * 0.42, 0.02, -0.16 * fw, 0.12, -0.09 * fd + 0.006);
      neon('#d54bff', 0.02, fd * 0.46, 0.08 * fw - 0.006, 0.12, 0.15 * fd);
    } else if (src === '/props/pianta.png') {
      // PIANTA: vaso ottagonale col filo di neon ciano, terra e ciuffo di foglie a punta.
      const pot = fw * 0.36;
      disc(0.5, 0.62, pot, 0, 0.3, 8);
      ring('#3fe9ff', pot * 0.96, 0.22, 0.5, 0.62, 8);
      add(new THREE.Mesh(new THREE.CylinderGeometry(pot * 0.8, pot * 0.8, 0.02, 8).rotateY(Math.PI / 8), new THREE.MeshStandardMaterial({ color: 0x2a1d17, roughness: 1 }))).position.set(0, 0.305, 0.12 * fd);
      foliage(0.5, 0.62, 0.3, fw * 0.6, 13);
    } else if (src === '/props/desk.png') {
      // SCRIVANIA: piano su due fianchi e pannello di fondo, tastiera e tre schermi accesi (i due
      // laterali girati verso chi siede).
      part(0.03, 0.1, 0.09, 0.95, 0, 0.3);
      part(0.91, 0.1, 0.97, 0.95, 0, 0.3);
      part(0.09, 0.1, 0.91, 0.14, 0, 0.3);
      part(0, 0.05, 1, 1, 0.3, 0.36);
      part(0.33, 0.43, 0.7, 0.68, 0.36, 0.385);
      monitor(0.335, 0.04, 0.69, 0.27, 0.01 * fw, -0.34 * fd, 0.36, 0);
      monitor(0.06, 0.14, 0.3, 0.38, -0.31 * fw, -0.24 * fd, 0.36, 0.5);
      monitor(0.71, 0.14, 0.95, 0.38, 0.33 * fw, -0.24 * fd, 0.36, -0.5);
      neon('#d54bff', 0.02, fd * 0.09, 0.4 * fw, 0.375, 0.07 * fd);
    } else if (src === '/props/mobile.png') {
      // SCAFFALE: armadio in piedi col prospetto del disegno in facciata, verso la stanza.
      const h = fw * 420 / 189;
      add(new THREE.Mesh(new THREE.BoxGeometry(fw, h, fd), [metal, metal, metal, metal, screen, metal])).position.y = h / 2;
      neon('#3fe9ff', fw * 0.8, 0.02, 0, h + 0.012, fd / 2 - 0.02, 0.024);
    } else if (src === '/props/mobiletto.png') {
      // MOBILETTO: credenza bassa su zoccolo, coi neon ciano sui fianchi lunghi e gli oggetti
      // appoggiati sopra (pianta, scatola, tablet, lampada a sfera).
      part(0.05, 0.03, 0.95, 0.97, 0, 0.05);
      part(0, 0, 1, 1, 0.05, 0.34);
      for (const dir of [-1, 1]) neon('#3fe9ff', 0.02, fd * 0.78, dir * (fw / 2 + 0.006), 0.27, 0);
      part(0.2, 0.37, 0.4, 0.58, 0.34, 0.4);
      turned(0.62, 0.59, fw * 0.36, fw * 0.48, 0.34, 0.36, -0.4);
      foliage(0.6, 0.28, 0.34, fw * 0.3, 9);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(fw * 0.09, 14, 10), new THREE.MeshBasicMaterial({ color: '#7fd4ff', toneMapped: false }));
      orb.position.set(-0.13 * fw, 0.34 + fw * 0.09, 0.27 * fd);
      g.add(orb);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    return g;
  }

  // Bagliore che pulsa attorno a un segnalino, come il `drop-shadow` animato della plancia 2D.
  private halo(color: string, y: number) {
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cached(`glow:${color}`, () => glowTexture(color, color)), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.position.y = y;
    halo.raycast = () => {};
    return halo;
  }

  // Segnalini fissi: nodi e obiettivi di missione, casse, telecamere, arredo in rilievo.
  private buildProps(p: BoardProps, dark: Set<string>) {
    dispose(this.propGroup);
    this.propGroup.clear();
    this.cams = [];
    this.glows = [];
    for (const { room, rect: r, solids } of this.floors.values()) {
      if (dark.has(room.id)) continue;
      const marks = (p.marksIn?.(room.id) || []).filter((m) => m.kind !== 'drop' && m.kind !== 'start');
      // Il mobile sul lato nord si scosta a ovest quanto basta a lasciare l'angolo ai segnalini.
      const markEdge = r.x1 - 0.42 - (marks.length - 1) * 0.6 - 0.36;
      for (const solid of solids) {
        const crowded = marks.length && solid.side === 'top' && solid.x + solid.ex / 2 > markEdge;
        this.propGroup.add(this.buildFurniture(crowded ? { ...solid, x: Math.max(r.x0 + solid.ex / 2 + 0.1, markEdge - solid.ex / 2) } : solid));
      }
      marks.forEach((mark, i) => {
        // NODO: un terminale col suo disegno su ogni faccia. OBIETTIVI: blocchi di lamiera col
        // colore e la sigla del segnalino 2D; la valigetta è una ventiquattrore col manico. Quelli
        // da raccogliere e lo Spettro sveglio restano sospesi e pulsano.
        const [kind, mood] = mark.kind.split(' ');
        const done = Boolean(mark.done), node = kind === 'node', briefcase = mark.id === 'case';
        const tone = done ? MARK_TONES.done : MARK_TONES[mood === 'cornered' ? mood : kind] || MARK_TONES.case;
        const [w, h, d] = briefcase ? [0.5, 0.33, 0.14] : node ? [0.46, 0.46, 0.46] : kind === 'vault' ? [0.52, 0.52, 0.52] : [0.38, 0.38, 0.38];
        const tex = node
          ? this.skin(nodeImg, '#0d1408', done)
          : this.cached(`mark:${tone[0]}:${mark.label}:${briefcase}`, () => panelTexture(tone, mark.label, briefcase ? 192 : 128));
        const glow = done ? 0.15 : mood === 'asleep' ? 0.25 : 0.6;
        const mat = skinMat(tex, glow);
        const edge = briefcase ? new THREE.MeshStandardMaterial({ color: tone[2], emissive: tone[0], emissiveIntensity: 0.25, roughness: 0.5 }) : mat;
        const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [edge, edge, edge, edge, mat, mat]);
        block.castShadow = true;
        if (briefcase) {
          const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.04), edge);
          handle.position.y = h / 2 + 0.025;
          block.add(handle);
        }
        const live = !done && (kind === 'case' || mood === 'awake' || mood === 'cornered');
        block.position.y = h / 2 + (live ? 0.16 : 0);
        const g = new THREE.Group();
        g.add(block);
        if (live) {
          const halo = this.halo(tone[0], block.position.y);
          g.add(halo);
          this.glows.push({ mat, glow, period: mood === 'awake' ? 1400 : mood === 'cornered' ? 900 : 1600, flicker: mood === 'awake', float: block, y: block.position.y, halo, size: 1.5 });
        }
        g.position.set(r.x1 - 0.42 - i * 0.6, 0, r.z0 + 0.42);
        g.userData.tip = mark.name;
        this.propGroup.add(g);
      });
      const chest = p.chests?.find((c) => c.room === room.id);
      if (chest) {
        // CASSA: il disegno della 2D fa da coperchio, i fianchi riprendono lamiera, cantonali gialli
        // e neon ciano. Carica pulsa come `chest-glow`; svuotata resta aperta e spenta.
        const loaded = chest.uses > 0, glow = loaded ? 0.5 : 0.1;
        const top = skinMat(this.skin(CHEST_SKIN, '#12161c', !loaded), glow);
        const side = skinMat(this.cached(`chest:${loaded}`, () => panelTexture(loaded ? MARK_TONES.chest : MARK_TONES.done, '', 192, 96)), glow);
        const rim = new THREE.MeshStandardMaterial({ color: loaded ? '#c98a16' : '#3d4a47', roughness: 0.5, metalness: 0.3 });
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.26, 0.47), [side, side, rim, rim, side, side]);
        box.position.y = 0.13;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.1, 0.51), [rim, rim, top, rim, rim, rim]);
        lid.position.y = 0.31;
        if (!loaded) { lid.rotation.x = -0.9; lid.position.set(0, 0.4, -0.24); }
        box.castShadow = lid.castShadow = true;
        g.add(box, lid);
        if (loaded) {
          const halo = this.halo('#ffc83d', 0.2);
          g.add(halo);
          this.glows.push({ mat: top, glow, period: 1900, y: 0, halo, size: 1.9 }, { mat: side, glow, period: 1900, y: 0 });
        }
        g.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
        g.scale.setScalar(1.3);
        g.userData.tip = loaded ? `CASSA DI POTENZIAMENTO - ${chest.uses}/${chest.max ?? chest.uses}` : 'CASSA SVUOTATA';
        this.propGroup.add(g);
      }
      if (p.cameras?.includes(room.id)) {
        // TELECAMERA: staffa avvitata in cima all'angolo del muro, braccio che sporge nella stanza
        // e testa a proiettile appesa sotto, inclinata verso il pavimento, che brandeggia a destra
        // e sinistra (vedi `frame`). `g` guarda lungo la diagonale della stanza. La luce rossa si
        // vede tre volte: lente con alone, cono di sorveglianza e chiazza del faretto sul pavimento.
        const g = new THREE.Group(), pan = new THREE.Group(), head = new THREE.Group();
        const shell = new THREE.MeshStandardMaterial({ color: 0xd9e2e0, roughness: 0.35, metalness: 0.45 });
        const ink = new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide });
        const red = new THREE.MeshBasicMaterial({ color: 0xff2a3c, toneMapped: false });
        const along = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number) => {
          const mesh = new THREE.Mesh(geo.rotateX(Math.PI / 2), mat);
          mesh.position.z = z;
          return mesh;
        };
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 16), ink);
        base.position.set(0, 0.015, -0.1);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.24, 10), ink);
        mast.position.set(0, 0.12, -0.1);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.46), ink);
        arm.position.set(0, 0.24, 0.12);
        const joint = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), ink);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.1, 10), ink);
        neck.position.y = -0.06;
        const body = along(new THREE.CylinderGeometry(0.095, 0.095, 0.4, 24), shell, 0);
        const rear = along(new THREE.CylinderGeometry(0.08, 0.06, 0.05, 24), ink, -0.225);
        const band = along(new THREE.CylinderGeometry(0.098, 0.098, 0.018, 24), red, -0.1);
        const bezel = along(new THREE.CylinderGeometry(0.102, 0.102, 0.06, 24), ink, 0.215);
        // Parasole: mezza canna aperta sopra il corpo, che sporge oltre la lente.
        const hood = along(new THREE.CylinderGeometry(0.118, 0.118, 0.52, 20, 1, true, Math.PI * 0.6, Math.PI * 0.8), ink, 0.06);
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.062, 16, 12), red);
        lens.scale.z = 0.5;
        lens.position.z = 0.245;
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), red);
        led.position.set(0, 0.125, 0.12);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cached('glow', glowTexture), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        halo.position.z = 0.29;
        const coneGeo = new THREE.ConeGeometry(0.55, 1.9, 28, 1, true);
        coneGeo.translate(0, -0.95, 0);
        coneGeo.rotateX(-Math.PI / 2);
        const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({ color: 0xff2a3c, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
        cone.position.z = 0.25;
        // Alone e cono non devono rubare il tooltip a pedine e segnalini che illuminano.
        halo.raycast = cone.raycast = () => {};
        const spot = new THREE.SpotLight(0xff2a3c, 18, 5, 0.45, 0.7, 2);
        spot.position.z = 0.25;
        spot.target.position.z = 1.5;
        body.castShadow = hood.castShadow = arm.castShadow = true;
        head.add(body, rear, band, bezel, hood, lens, led, halo, cone, spot, spot.target);
        head.position.y = -0.17;
        head.rotation.x = 0.42;
        pan.add(joint, neck, head);
        pan.position.set(0, 0.24, 0.34);
        g.add(base, mast, arm, pan);
        g.position.set(r.x0, WALL_H, r.z0);
        g.rotation.y = Math.PI / 4;
        g.userData.tip = 'TELECAMERA ATTIVA';
        this.propGroup.add(g);
        this.cams.push({ pan, led, halo, phase: (this.cams.length * 2.4) % (Math.PI * 2) });
      }
    }
  }

  // Allinea la scena allo stato di partita: chiamata a ogni render (cioè a ogni poll).
  sync(p: BoardProps) {
    this.resync = () => this.sync(p);
    const roomsKey = JSON.stringify(p.rooms.map((r) => [r.id, r.name, r.col, r.row, r.w, r.h, r.links, r.exit, r.start]));
    if (roomsKey !== this.roomsKey) { this.roomsKey = roomsKey; this.propsKey = ''; this.buildRooms(p.rooms); }
    const dark = new Set(p.fogged || []);
    this.blackout = Boolean(p.blackout);
    this.hemi.color.set(p.lockdown ? 0xff9aa5 : 0xb8efe6);

    for (const d of this.doors) {
      const closed = Boolean(p.doors?.[d.spot.key]);
      d.target = closed ? 0 : 1;
      if (d.open < 0) d.open = d.target;
      d.group.userData.tip = `${closed ? 'PORTA BLOCCATA' : 'PORTA APERTA'} — ${d.spot.a.id} ${d.spot.a.name} / ${d.spot.b.id} ${d.spot.b.name}`;
    }

    const alive = new Set<string>();
    const place = (unit: Pawn | Foe, foe: Foe | null, at: THREE.Vector3, r: Rect, halted: boolean) => {
      alive.add(unit.id);
      const pawn = foe ? null : unit as Pawn;
      const sig = [unit.img, unit.label, pawn?.color, foe?.kind, foe?.elite].join('|');
      let tok = this.tokens.get(unit.id);
      if (!tok || tok.sig !== sig) {
        const old = tok;
        if (old) { this.tokenGroup.remove(old.group); dispose(old.group); }
        tok = { ...this.buildToken(unit, foe), sig, target: at.clone(), placed: false, lap: old?.lap ?? ([...unit.id].reduce((s, c) => s + c.charCodeAt(0), 0) * 0.37) % 1 };
        if (old) { tok.group.position.copy(old.group.position); tok.placed = true; }
        this.tokens.set(unit.id, tok);
        this.tokenGroup.add(tok.group);
      }
      tok.target.copy(at);
      tok.down = Boolean(pawn?.down);
      tok.dying = Boolean(foe?.dying);
      tok.pulse = Boolean(pawn?.active || foe?.hunting);
      tok.patrol = foe?.patrol ? { rect: r, halted } : undefined;
      tok.group.userData.tip = unit.name;
    };
    const skin = this.image(FLOOR_SKIN);
    for (const f of this.floors.values()) {
      const { room, rect: r } = f;
      const hidden = dark.has(room.id);
      const foes = hidden ? [] : p.foesIn(room.id);
      const pawns = p.pawnsIn(room.id);
      const tone = hidden ? 'dark' : foes.length ? 'hostile' : room.exit ? 'exit' : room.start ? 'start' : 'base';
      // Arredo come in 2D: scelto dal seed missione+stanza, e la cassa ne prende il posto.
      const bare = hidden || Boolean(p.chests?.some((c) => c.room === room.id));
      const next = `${tone}|${bare}|${p.missionId}`;
      const seed = `${p.missionId || ''}:${room.id}`;
      const slots = (room.w || 1) * (room.h || 1) === 2 ? 2 + (seedHash(`${seed}:slots`) % 2) : 1;
      const picks = bare ? [] : roomProps(seed, slots, doorSides(room, p.rooms));
      // I mobili in rilievo (vedi `buildFurniture`) sul pavimento non si dipingono.
      f.solids = picks.filter((d) => FURNITURE[d.src]).map((d) => furnitureSpot(r, d.src, d.side));
      if (next !== f.state) {
        const decor = picks.filter((d) => !FURNITURE[d.src]).flatMap((d) => { const img = this.image(d.src); return img ? [{ img, side: d.side }] : []; });
        paintFloor(f.ctx, room, tone, f.index, skin, decor);
        f.tex.needsUpdate = true;
        // La nebbia oscura l'interno, mentre il neon sul perimetro resta acceso.
        f.trim.color.set(TRIM_TONES[hidden ? 'base' : tone]);
        f.state = next;
      }
      f.fog.visible = hidden;
      // Slot delle pedine: griglia ancorata al lato sud, sotto il nome della stanza.
      const total = foes.length + pawns.length;
      const wide = r.x1 - r.x0 > CW;
      const cols = Math.min(Math.max(total, 1), (total <= 1 ? 1 : total <= 4 ? 2 : 3) * (wide ? 2 : 1));
      const rows = Math.max(1, Math.ceil(total / cols));
      // I mobili in rilievo restringono la griglia, così le pedine non ci finiscono dentro.
      let ux0 = r.x0 + 0.5, ux1 = r.x1 - 0.5, uz1 = r.z1 - 0.3;
      for (const s of f.solids) {
        if (s.side === 'left') ux0 = Math.max(ux0, s.x + s.ex / 2 + 0.3);
        if (s.side === 'right') ux1 = Math.min(ux1, s.x - s.ex / 2 - 0.3);
        if (s.side === 'bottom') uz1 = Math.min(uz1, s.z - s.ez / 2 - 0.2);
      }
      const uw = ux1 - ux0, uh = uz1 - (r.z0 + 0.9);
      const slot = (i: number) => new THREE.Vector3(ux0 + ((i % cols) + 0.5) / cols * uw, 0, uz1 - (Math.floor(i / cols) + 0.5) / rows * uh);
      let i = 0;
      for (const foe of foes) place(foe, foe, slot(i++), r, Boolean(foe.hunting || foe.dying || pawns.length));
      for (const pawn of pawns) place(pawn, null, slot(i++), r, false);
    }
    for (const [id, tok] of this.tokens) if (!alive.has(id)) {
      this.tokenGroup.remove(tok.group);
      dispose(tok.group);
      this.tokens.delete(id);
    }

    const propsKey = JSON.stringify([[...dark], p.missionId, p.chests, p.cameras, p.rooms.map((r) => p.marksIn?.(r.id))]);
    if (propsKey !== this.propsKey) { this.propsKey = propsKey; this.buildProps(p, dark); }

    // COLPI: numero del danno che sale sopra il bersaglio e tracciante dal tiratore.
    const hits = p.hits || [];
    for (const h of hits) {
      if (this.seenHits.has(h.id)) continue;
      this.seenHits.add(h.id);
      const to = this.tokens.get(h.targetId)?.group.position;
      if (!to) continue;
      const heal = h.kind === 'heal';
      const num = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(`${heal ? '+' : '−'}${h.amount}`, heal ? GREEN : '#ffd24a', 192, 128, 92), depthTest: false, transparent: true }));
      num.scale.set(0.9, 0.6, 1);
      num.position.set(to.x, 1.5, to.z);
      this.spawnFx(num, 1300, 0.9);
      const from = h.sourceId ? this.tokens.get(h.sourceId)?.group.position : undefined;
      if (!heal && from) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, 0.55, from.z), new THREE.Vector3(to.x, 0.55, to.z)]),
          new THREE.LineBasicMaterial({ color: /^p\d+$/.test(h.sourceId || '') ? CYAN : RED, transparent: true }),
        );
        this.spawnFx(line, 380, 0);
      }
    }
    const live = new Set(hits.map((h) => h.id));
    for (const id of this.seenHits) if (!live.has(id)) this.seenHits.delete(id);
  }

  private spawnFx(obj: THREE.Object3D, life: number, rise: number) {
    this.fxGroup.add(obj);
    this.fx.push({ obj, born: performance.now(), life, rise });
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const ease = 1 - Math.exp(-dt * 7);
    this.controls.update();
    // Skin o arredo appena caricati: pavimenti e segnalini vanno rifatti.
    if (this.stale) {
      this.stale = false;
      this.propsKey = '';
      for (const f of this.floors.values()) f.state = '';
      this.resync?.();
    }
    const yaw = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);

    for (const d of this.doors) {
      d.open += (d.target - d.open) * ease;
      d.leaves.forEach((leaf, i) => { leaf.position.x = (i ? 1 : -1) * LEAF_W * (0.5 + 0.86 * d.open); });
      d.tone.color.copy(DOOR_SHUT).lerp(DOOR_OPEN, d.open);
      d.skin.emissive.copy(d.tone.color);
      d.jamb.color.copy(HAZARD).lerp(DOOR_OPEN, d.open);
      d.jamb.emissive.copy(d.jamb.color);
      d.bar.visible = d.open < 0.08;
    }

    // TELECAMERE: brandeggio a destra e sinistra attorno alla diagonale della stanza.
    for (const c of this.cams) {
      c.pan.rotation.y = 0.6 * Math.sin(now / 1300 + c.phase);
      c.led.visible = (now + c.phase * 400) % 1200 < 700;
      c.halo.scale.setScalar(0.55 + 0.12 * Math.sin(now / 280 + c.phase));
    }

    for (const tok of this.tokens.values()) {
      const pos = tok.group.position;
      const fromX = pos.x, fromZ = pos.z;
      if (tok.patrol && !tok.patrol.halted) {
        // RONDA DEL DRONE: giro lungo i lati della stanza di presidio, a velocità costante.
        const r = tok.patrol.rect;
        const x0 = r.x0 + 0.55, x1 = r.x1 - 0.55, z0 = r.z0 + 0.95, z1 = r.z1 - 0.5;
        const sw = Math.max(0.01, x1 - x0), sd = Math.max(0.01, z1 - z0), per = 2 * (sw + sd);
        tok.lap = (tok.lap + dt * 0.7 / per) % 1;
        const s = tok.lap * per;
        const goal = s < sw ? [x0 + s, z0] : s < sw + sd ? [x1, z0 + s - sw] : s < 2 * sw + sd ? [x1 - (s - sw - sd), z1] : [x0, z1 - (s - 2 * sw - sd)];
        if (tok.placed) { pos.x += (goal[0] - pos.x) * ease; pos.z += (goal[1] - pos.z) * ease; } else pos.set(goal[0], 0, goal[1]);
      } else if (!tok.patrol) {
        if (tok.placed) pos.lerp(tok.target, ease); else pos.copy(tok.target);
      } else if (!tok.placed) pos.copy(tok.target);
      tok.placed = true;
      for (const face of tok.faces) face.rotation.y = yaw;
      tok.tilt.rotation.x += ((tok.down ? -1.3 : 0) - tok.tilt.rotation.x) * ease;
      tok.tilt.position.y += ((tok.down ? 0.12 : 0) - tok.tilt.position.y) * ease;
      tok.tilt.scale.setScalar(tok.tilt.scale.x + ((tok.dying ? 0.01 : 1) - tok.tilt.scale.x) * ease);
      tok.ring.visible = tok.pulse && !tok.dying;
      if (tok.pulse) tok.ring.scale.setScalar(1 + 0.18 * Math.sin(now / 190));
      if (tok.model) {
        // Il modello punta il muso dove va e da fermo si gira verso la camera; il drone galleggia.
        if (tok.flies) tok.model.position.y = DRONE_Y + 0.06 * Math.sin(now / 420 + tok.lap * 20);
        const dx = pos.x - fromX, dz = pos.z - fromZ;
        const aim = Math.hypot(dx, dz) > dt * 0.05 ? Math.atan2(dx, dz) : yaw;
        const turn = Math.atan2(Math.sin(aim - tok.model.rotation.y), Math.cos(aim - tok.model.rotation.y));
        tok.model.rotation.y += turn * ease;
      }
    }
    for (const m of this.glows) {
      const t = now / m.period;
      m.mat.emissiveIntensity = m.glow * (m.flicker ? (t % 1 < 0.5 ? 1 : 0.4) : 1 + 0.35 * Math.sin(t * Math.PI * 2));
      if (m.halo) {
        const w = m.flicker ? (t % 1 < 0.5 ? 1 : 0.2) : 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
        m.halo.material.opacity = 0.25 + 0.55 * w;
        m.halo.scale.setScalar((m.size || 1.5) * (0.8 + 0.35 * w));
      }
      if (m.float) { m.float.position.y = m.y + 0.04 * Math.sin(now / 520); m.float.rotation.y += dt * 0.8; }
    }

    this.fx = this.fx.filter((f) => {
      const t = (now - f.born) / f.life;
      if (t >= 1) { this.fxGroup.remove(f.obj); dispose(f.obj); return false; }
      f.obj.position.y += f.rise * dt;
      ((f.obj as THREE.Line).material as THREE.Material).opacity = 1 - t * t;
      return true;
    });

    // BLACKOUT: le luci saltano a scatti finché dura l'avviso.
    const dim = this.blackout ? (Math.random() < 0.15 ? 0.9 : 0.12) : 1;
    this.sun.intensity = 1.7 * dim;
    this.hemi.intensity = 1.1 * dim;
    for (const f of this.floors.values()) f.mat.emissiveIntensity = 0.3 * dim;
    this.renderer.render(this.scene, this.camera);
  };

  private onMove = (e: PointerEvent) => {
    if (e.buttons) return this.hideTip();
    const box = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - box.left) / box.width * 2 - 1, -(e.clientY - box.top) / box.height * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObjects([this.tokenGroup, this.propGroup, this.doorGroup], true)[0];
    let node: THREE.Object3D | null = hit?.object ?? null;
    while (node && !node.userData.tip) node = node.parent;
    if (!node) return this.hideTip();
    this.tip.textContent = node.userData.tip as string;
    this.tip.style.display = 'block';
    this.tip.style.left = `${Math.max(120, Math.min(box.width - 120, e.clientX - box.left))}px`;
    this.tip.style.top = `${e.clientY - box.top}px`;
  };

  private hideTip = () => { this.tip.style.display = 'none'; };
}

const TIP_STYLE: React.CSSProperties = {
  display: 'none', position: 'absolute', zIndex: 5, transform: 'translate(-50%,calc(-100% - 14px))', maxWidth: 240, pointerEvents: 'none',
  padding: '6px 9px', border: '1px solid #28423e', background: '#050d0df2', color: '#d7f3ee', font: '600 10px/1.4 ui-sans-serif,system-ui,sans-serif', letterSpacing: '.06em', textAlign: 'center',
};

export function BoardMap3D(props: BoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const scene = useRef<IsoScene | null>(null);
  useEffect(() => {
    if (!host.current || !tip.current) return;
    const iso = new IsoScene(host.current, tip.current);
    scene.current = iso;
    return () => { scene.current = null; iso.destroy(); };
  }, []);
  useEffect(() => { scene.current?.sync(props); });
  return <div ref={host} className="board-map" style={{ minHeight: 0, cursor: 'grab' }}>
    <div ref={tip} role="tooltip" style={TIP_STYLE} />
  </div>;
}

// INTERRUTTORE DI VISTA: 2D (plancia di sempre) o 3D isometrica. La scelta resta nel browser della plancia.
const stored = (key: string, fallback: string) => {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};
const store = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* preferenza non salvata: pazienza */ }
};
const switchBtn = (on: boolean): React.CSSProperties => ({
  padding: '2px 6px', border: `1px solid ${on ? ACID : '#28423e'}`, background: '#050d0dd9', color: on ? ACID : '#8ba7a2',
  font: `700 9px ${FONT}`, letterSpacing: '.1em', cursor: 'pointer', opacity: on ? 1 : 0.75,
});

export default function BoardMapView(props: BoardProps) {
  const [view, setView] = useState(() => (stored('roverpunk-map-view', '3d') === '2d' ? '2d' : '3d'));
  const pickView = (v: string) => { setView(v); store('roverpunk-map-view', v); };
  return <div style={{ position: 'relative', display: 'grid', minHeight: 0, minWidth: 0 }}>
    {view === '3d' ? <BoardMap3D {...props} /> : <BoardMap {...props} />}
    <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 8, display: 'flex', gap: 2 }}>
      <button type="button" style={switchBtn(view === '2d')} onClick={() => pickView('2d')}>2D</button>
      <button type="button" style={switchBtn(view === '3d')} onClick={() => pickView('3d')}>3D</button>
    </div>
  </div>;
}

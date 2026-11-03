// PEDINE 3D DEGLI OPERATIVI
// Gli 8 operativi a tutto tondo per la plancia 3D, modellati sul ritratto in /roster e sull'arma di
// `characters.mjs`. Ogni figura è un manichino in posa (bacino, busto, arti piegati da una cinematica
// a due ossa su mani e piedi) vestito su misura: testa, tenuta, arma. I pezzi vengono fusi in una
// mesh per materiale, così una pedina costa una dozzina di draw call.
// La figura guarda +Z coi piedi a y=0: la destra dell'operativo è -X, cioè la sinistra del ritratto.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Vec = THREE.Vector3;
type Mat = THREE.Material;
type Frame = THREE.Matrix4;

const TAU = Math.PI * 2;
// Scala del manichino (alto 1.07 nelle sue misure) sulla plancia, per un operativo di statura 1:
// alla pari delle unità Helix di `foes3d`.
const SCALE = 1;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = v(0, 1, 0), FRONT = v(0, 0, 1), BACK = v(0, 0, -1);

// Riferimento spostato in (x, y, z) e ruotato (Eulero XYZ).
const at = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z);
// Riferimento con l'origine in `a`, l'asse Y verso `b` e l'asse Z il più vicino possibile a `front`.
const along = (a: Vec, b: Vec, front = FRONT) => {
  const y = b.clone().sub(a).normalize(), x = v().crossVectors(y, front);
  if (x.lengthSq() < 1e-6) x.crossVectors(y, UP);
  x.normalize();
  return new THREE.Matrix4().makeBasis(x, y, v().crossVectors(x, y)).setPosition(a);
};
// Riferimento di un'arma: origine in `p`, canna (asse Z) lungo `dir`, dorso (asse Y) verso `up`.
const aim = (p: Vec, dir: Vec, up = UP) => {
  const z = dir.clone().normalize(), x = v().crossVectors(up, z).normalize();
  return new THREE.Matrix4().makeBasis(x, v().crossVectors(z, x), z).setPosition(p);
};
// Cinematica a due ossa da `a` verso `b`: il giunto di mezzo (gomito, ginocchio), spinto verso
// `pole`, e l'estremità raggiunta (che è `b` solo se le ossa `l1` + `l2` ci arrivano).
function bend(a: Vec, b: Vec, l1: number, l2: number, pole: Vec): [Vec, Vec] {
  const dir = b.clone().sub(a), len = Math.min(dir.length(), (l1 + l2) * 0.995);
  dir.normalize();
  const k = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
  const out = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return [a.clone().addScaledVector(dir, k).addScaledVector(out, Math.sqrt(Math.max(0, l1 * l1 - k * k))), a.clone().addScaledVector(dir, len)];
}
// Numero pseudo-casuale stabile in [0,1): la stessa chioma a ogni ricostruzione della pedina.
const rnd = (i: number, k: number) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

// MATERIALI. `lift` è un filo di luce propria: tiene leggibili i fianchi che il sole a picco non tocca.
const solid = (color: number, roughness = 0.8, metalness = 0, flatShading = false, lift = 0.24) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading, emissive: color, emissiveIntensity: lift, side: THREE.DoubleSide });
const cloth = (color: number) => solid(color, 0.85);
const facet = (color: number, roughness = 0.7) => solid(color, roughness, 0.05, true);
const plate = (color: number, roughness = 0.38) => solid(color, roughness, 0.4, true);
const flesh = (color: number) => solid(color, 0.6, 0, false, 0.42);
const lit = (color: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color, toneMapped: false, side: THREE.DoubleSide });

// CRETA: raccoglie i pezzi nel riferimento corrente e alla fine li fonde, una mesh per materiale.
class Clay {
  private parts = new Map<Mat, THREE.BufferGeometry[]>();
  private frame = new THREE.Matrix4();

  add(m: Mat, geo: THREE.BufferGeometry, place?: Frame) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    g.applyMatrix4(place ? this.frame.clone().multiply(place) : this.frame);
    const list = this.parts.get(m);
    if (list) list.push(g); else this.parts.set(m, [g]);
  }

  // Tutto ciò che `make` aggiunge finisce nel riferimento `frame` (testa, arma, arto...).
  within(frame: Frame, make: () => void) {
    const outer = this.frame;
    this.frame = outer.clone().multiply(frame);
    make();
    this.frame = outer;
  }

  box(m: Mat, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    this.add(m, new THREE.BoxGeometry(w, h, d), at(x, y, z, rx, ry, rz));
  }

  ball(m: Mat, r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const n = r < 0.02 ? 8 : r < 0.05 ? 12 : 16;
    this.add(m, new THREE.SphereGeometry(r, n, Math.round(n * 0.7)).scale(sx, sy, sz), at(x, y, z, rx, ry, rz));
  }

  // Cilindro o tronco di cono con l'asse lungo Y (raggio `r0` sotto, `r1` sopra).
  drum(m: Mat, r0: number, r1: number, h: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12) {
    this.add(m, new THREE.CylinderGeometry(r1, r0, h, seg), at(x, y, z, rx, ry, rz));
  }

  // Canna: cilindro con l'asse lungo Z (raggio `r` dietro, `r1` davanti).
  bore(m: Mat, r: number, len: number, x = 0, y = 0, z = 0, seg = 10, r1 = r) {
    this.add(m, new THREE.CylinderGeometry(r1, r, len, seg).rotateX(Math.PI / 2), at(x, y, z));
  }

  // Disco con l'asse lungo X (tamburi, padiglioni, filtri).
  wheel(m: Mat, r: number, w: number, x = 0, y = 0, z = 0, seg = 14, ry = 0) {
    this.add(m, new THREE.CylinderGeometry(r, r, w, seg).rotateZ(Math.PI / 2), at(x, y, z, 0, ry));
  }

  // Anello (toro) nel piano XY del riferimento.
  hoop(m: Mat, r: number, tube: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, arc = TAU) {
    this.add(m, new THREE.TorusGeometry(r, tube, 6, 16, arc), at(x, y, z, rx, ry, rz));
  }

  // Piastra smussata: base `w` x `d`, alta `h`, con la faccia di sopra ridotta a `top` volte la base.
  wedge(m: Mat, w: number, h: number, d: number, top: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const geo = new THREE.CylinderGeometry(top * Math.SQRT1_2, Math.SQRT1_2, h, 4).rotateY(Math.PI / 4).scale(w, 1, d).toNonIndexed();
    geo.computeVertexNormals();
    this.add(m, geo, at(x, y, z, rx, ry, rz));
  }

  // Osso: tronco di cono da `a` a `b` con le estremità arrotondate, per arti e giunture.
  rod(m: Mat, a: Vec, b: Vec, ra: number, rb = ra, seg = 10, round = true) {
    const len = a.distanceTo(b);
    this.add(m, new THREE.CylinderGeometry(rb, ra, len, seg, 1, true).translate(0, len / 2, 0), along(a, b));
    if (round) { this.ball(m, ra, a.x, a.y, a.z); this.ball(m, rb, b.x, b.y, b.z); }
  }

  // Tubo a sezione ellittica lungo una spezzata: un anello [x, y, z, rx, rz] per punto, con `rz`
  // verso `front` (trasportato lungo il percorso). Con `arc` < 2π resta un guscio aperto che parte
  // dall'angolo `from`: 0 = davanti, e su un percorso che sale cresce verso la sinistra
  // dell'operativo. Restituisce i punti generati, anello per anello (per orli e profili al neon).
  sweep(m: Mat, rings: number[][], seg = 12, from = 0, arc = TAU, cap = true, front = FRONT) {
    const closed = arc > TAU - 1e-4, cols = closed ? seg : seg + 1;
    const pts = rings.map((r) => v(r[0], r[1], r[2])), f = front.clone();
    const pos: number[] = [], idx: number[] = [], grid: Vec[][] = [];
    rings.forEach((r, i) => {
      const t = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
      f.addScaledVector(t, -f.dot(t));
      if (f.lengthSq() < 1e-6) f.set(0, -1, 0).addScaledVector(t, t.y);
      f.normalize();
      const s = v().crossVectors(t, f), row: Vec[] = [];
      for (let j = 0; j < cols; j++) {
        const a = from + arc * j / seg;
        const p = pts[i].clone().addScaledVector(s, r[3] * Math.sin(a)).addScaledVector(f, r[4] * Math.cos(a));
        row.push(p);
        pos.push(p.x, p.y, p.z);
      }
      grid.push(row);
    });
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < seg; j++) {
      const a = i * cols + j, b = i * cols + (j + 1) % cols;
      idx.push(a, b, b + cols, a, b + cols, a + cols);
    }
    // Tappi con vertici propri, così lo spigolo resta vivo.
    if (cap && closed) for (const [i, flip] of [[0, true], [rings.length - 1, false]] as const) {
      const base = pos.length / 3;
      for (const p of grid[i]) pos.push(p.x, p.y, p.z);
      pos.push(pts[i].x, pts[i].y, pts[i].z);
      for (let j = 0; j < seg; j++) idx.push(base + seg, base + (flip ? (j + 1) % seg : j), base + (flip ? j : (j + 1) % seg));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.add(m, geo);
    return grid;
  }

  // Filo o tubicino di raggio `r` lungo una spezzata (cavi, orli al neon, antenne).
  tube(m: Mat, pts: Vec[], r: number, seg = 5) {
    this.sweep(m, pts.map((p) => [p.x, p.y, p.z, r, r]), seg, 0, TAU, false);
  }

  // Scheggia: lamina curva e appuntita da `a` a `b` (ciocche, falde, ali), larga `w` alla base e
  // spessa `thick` volte la larghezza, gonfia verso `out` di `lift` volte la sua lunghezza.
  shard(m: Mat, a: Vec, b: Vec, w: number, out: Vec, lift = 0.25, thick = 0.4, seg = 5) {
    const curve = new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).addScaledVector(out, a.distanceTo(b) * lift * 2), b);
    this.sweep(m, [[0, 1], [0.3, 0.95], [0.6, 0.72], [0.85, 0.42], [1, 0.04]].map(([t, k]) => { const p = curve.getPoint(t); return [p.x, p.y, p.z, w * k, w * k * thick]; }), seg, 0, TAU, false, out);
  }

  bake() {
    const group = new THREE.Group();
    for (const [m, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), m);
      mesh.castShadow = m instanceof THREE.MeshStandardMaterial;
      group.add(mesh);
    }
    return group;
  }
}

// MANICHINO. `feet` = [x, z, punta] del piede destro e del sinistro; `hands` = dove stanno la mano
// destra e la sinistra; `look` = [beccheggio, imbardata, rollio] della testa. Indice 0 = lato destro.
type Rig = {
  tall: number; bulk: number; fem?: boolean; hips: number; lean: number; twist: number; look: number[];
  feet: number[][]; hands: Vec[]; elbows?: (Vec | undefined)[];
};
type Wear = { legs: Mat; boots: Mat; top: Mat; arms: Mat; fore: Mat; hands: Mat; neck: Mat; ink: Mat };
const SIDES = [-1, 1];
// Omero e avambraccio (fino al centro della mano), coscia e stinco.
const ARM = [0.18, 0.185], LEG = [0.245, 0.235];

// Bacino, busto, collo, gambe con stivali, braccia con mani. Restituisce i riferimenti di bacino
// (`P`), busto (`T`) e testa (`H`) e le giunture, per appenderci tenuta e accessori.
function body(c: Clay, rig: Rig, w: Wear) {
  const b = rig.bulk, g = (1 + b) / 2, f = rig.fem ? 1 : 0;
  const P = at(0, rig.hips, 0, 0, rig.twist), T = P.clone().multiply(at(0, 0, 0, rig.lean));
  const H = T.clone().multiply(at(0, 0.455, 0.012, rig.look[0], rig.look[1], rig.look[2] || 0));
  c.within(P, () => c.sweep(w.legs, [[0, -0.055, 0, 0.04 * b, 0.045 * g], [0, -0.015, -0.004, (0.102 + 0.008 * f) * b, 0.077 * g], [0, 0.035, -0.004, (0.102 + 0.008 * f) * b, 0.075 * g], [0, 0.08, 0, 0.09 * b, 0.066 * g]], 14));
  c.within(T, () => {
    c.sweep(w.top, [
      [0, 0.045, 0, 0.092 * b, 0.068 * g], [0, 0.105, 0.002, (0.088 - 0.01 * f) * b, (0.064 - 0.004 * f) * g], [0, 0.17, 0.006, (0.104 - 0.006 * f) * b, 0.077 * g],
      [0, 0.235, 0.01, (0.12 - 0.01 * f) * b, (0.084 + 0.004 * f) * g], [0, 0.285, 0.002, (0.116 - 0.01 * f) * b, 0.07 * g], [0, 0.315, -0.004, 0.07 * b, 0.05 * g], [0, 0.338, -0.006, 0.038, 0.038],
    ], 16);
    c.rod(w.neck, v(0, 0.325, -0.006), v(0, 0.378, 0.004), 0.034 * g, 0.031 * g, 10, false);
  });
  const sh = SIDES.map((d) => v(d * (0.128 - 0.012 * f) * (0.4 + 0.6 * b), 0.292, 0).applyMatrix4(T));
  const hip = SIDES.map((d) => v(d * 0.058 * b, -0.01, 0).applyMatrix4(P));
  const legs = SIDES.map((d, i) => bend(hip[i], v(rig.feet[i][0], 0.058, rig.feet[i][1]), LEG[0], LEG[1], v(d * 0.3, 0, 1)));
  const arms = SIDES.map((d, i) => bend(sh[i], rig.hands[i], ARM[0], ARM[1], rig.elbows?.[i] || v(d * 0.8, -0.6, -0.5)));
  const wrist = arms.map(([elbow, hand]) => hand.clone().addScaledVector(elbow.clone().sub(hand).normalize(), 0.034));
  SIDES.forEach((d, i) => {
    const [knee, ankle] = legs[i], [elbow, hand] = arms[i];
    c.rod(w.legs, hip[i], knee, 0.066 * g, 0.049 * g);
    c.rod(w.legs, knee, ankle, 0.048 * g, 0.034 * g);
    // Polpaccio, poi lo stivale: gambale lungo lo stinco, tallone, tomaia e suola nel verso del piede.
    const calf = knee.clone().lerp(ankle, 0.3);
    c.ball(w.legs, 0.043 * g, calf.x, calf.y, calf.z - 0.012, 1, 1.5, 1);
    c.rod(w.boots, ankle, ankle.clone().lerp(knee, 0.48), 0.04 * g, 0.05 * g, 10, false);
    for (const t of [0.12, 0.43]) c.rod(w.ink, ankle.clone().lerp(knee, t), ankle.clone().lerp(knee, t + 0.07), (0.042 + t * 0.022) * g, (0.0435 + t * 0.022) * g, 10, false);
    c.within(at(rig.feet[i][0], 0, rig.feet[i][1], 0, rig.feet[i][2]), () => {
      c.ball(w.boots, 0.04, 0, 0.042, 0.052, 0.88 * g, 0.74, 1.62);
      c.ball(w.boots, 0.04, 0, 0.048, -0.01, 0.92 * g, 1.05, 1);
      c.box(w.ink, 0.07 * g, 0.02, 0.165, 0, 0.01, 0.034);
      c.box(w.ink, 0.066 * g, 0.014, 0.05, 0, 0.022, -0.03);
    });
    c.rod(w.arms, sh[i], elbow, 0.045 * g, 0.036 * g);
    c.rod(w.fore, elbow, wrist[i], 0.036 * g, 0.027 * g);
    // Mano chiusa a pugno: polsino, dorso, dita ripiegate e pollice.
    c.within(along(wrist[i], hand), () => {
      c.drum(w.hands, 0.03 * g, 0.029 * g, 0.024, 0, 0.002, 0);
      c.ball(w.hands, 0.03 * g, 0, 0.03, -0.002, 0.95, 1.05, 0.8);
      c.ball(w.hands, 0.024 * g, 0, 0.05, 0.008, 1.18, 0.78, 0.92);
      c.ball(w.hands, 0.012 * g, -d * 0.024, 0.034, 0.012, 1, 1.6, 1);
    });
  });
  return { P, T, H, b, g, tall: rig.tall, sh, hip, knee: legs.map((l) => l[0]), ankle: legs.map((l) => l[1]), elbow: arms.map((a) => a[0]), wrist, hand: arms.map((a) => a[1]) };
}
type Body = ReturnType<typeof body>;

// TESTA (nel riferimento `H`, origine al centro del cranio). Profilo del cranio, dal mento alla
// cima: un anello [y, z, rx, rz] per quota. `MASK` è l'ovale liscio di ECHO.
const SKULL = [[-0.098, 0.03, 0.016, 0.014], [-0.086, 0.022, 0.036, 0.034], [-0.066, 0.012, 0.05, 0.052], [-0.04, 0.004, 0.06, 0.066], [-0.012, 0, 0.067, 0.076], [0.018, -0.003, 0.07, 0.082], [0.046, -0.006, 0.069, 0.083], [0.07, -0.008, 0.06, 0.074], [0.086, -0.01, 0.042, 0.053], [0.095, -0.01, 0.016, 0.02]];
const MASK = [[-0.108, 0.024, 0.012, 0.012], [-0.092, 0.018, 0.034, 0.034], [-0.066, 0.01, 0.05, 0.054], [-0.03, 0.004, 0.06, 0.07], [0.01, 0, 0.066, 0.08], [0.05, -0.004, 0.066, 0.082], [0.08, -0.008, 0.056, 0.07], [0.098, -0.01, 0.036, 0.046], [0.106, -0.01, 0.012, 0.016]];
// Anello del profilo alla quota `y`, ingrossato di `grow` (per tutto ciò che veste la testa).
const ringAt = (y: number, grow = 0, profile = SKULL) => {
  const above = profile.findIndex((r) => r[0] >= y), i = above < 0 ? profile.length - 1 : Math.max(1, above), [lo, hi] = [profile[i - 1], profile[i]];
  const t = Math.min(1, Math.max(0, (y - lo[0]) / (hi[0] - lo[0]))), mix = (k: number) => lo[k] + (hi[k] - lo[k]) * t;
  return [0, y, mix(1), mix(2) + grow, mix(3) + grow];
};
// Volto: cranio col mento in avanti (mascella larga `jaw`), orecchie, naso e bocca. Senza `lip`
// naso e bocca non ci sono: li copre una maschera. Occhi e sopracciglia a parte, perché ogni
// operativo ha i suoi.
function face(c: Clay, skin: Mat, lip?: Mat, jaw = 1) {
  c.sweep(skin, SKULL.map(([y, z, rx, rz], i) => [0, y, z, rx * (i > 0 && i < 4 ? jaw : 1), rz]), 16);
  for (const d of SIDES) c.ball(skin, 0.017, d * 0.069, -0.004, -0.006, 0.45, 1.15, 0.8);
  if (!lip) return;
  c.sweep(skin, [[0, 0.02, 0.074, 0.006, 0.005], [0, -0.01, 0.085, 0.008, 0.008], [0, -0.023, 0.088, 0.012, 0.009], [0, -0.031, 0.078, 0.011, 0.004]], 6);
  c.ball(lip, 0.012, 0, -0.053, 0.063, 1.3, 0.36, 0.6);
}
// Occhio: sclera, iride e la riga scura della palpebra.
const eye = (c: Clay, white: Mat, iris: Mat, lash: Mat, d: number) => {
  c.ball(white, 0.0098, d * 0.028, 0.012, 0.0685, 1.3, 0.76, 0.6);
  c.ball(iris, 0.0058, d * 0.028, 0.012, 0.073, 1, 1, 0.6);
  c.box(lash, 0.027, 0.0035, 0.008, d * 0.028, 0.0205, 0.0712, 0.2, d * 0.32);
};
// Sopracciglio: `tilt` > 0 lo alza verso la tempia (sguardo duro).
const brow = (c: Clay, m: Mat, d: number, tilt = 0.12) => c.box(m, 0.032, 0.007, 0.012, d * 0.029, 0.031, 0.0715, 0, d * 0.32, d * tilt);
// Segno tracciato sulla testa (cicatrici, galloni, fili di luce): una spezzata di punti
// [angolo, quota], con 0 = davanti e gli angoli positivi verso sinistra, staccata di `grow`.
const mark = (c: Clay, m: Mat, pts: number[][], r = 0.003, grow = 0.001, profile = SKULL) => c.tube(m, pts.map(([a, y]) => {
  const [, , z, rx, rz] = ringAt(y, grow, profile);
  return v(rx * Math.sin(a), y, z + rz * Math.cos(a));
}), r, 4);
// Calotta che veste la testa staccandosene di `grow`: chiusa sopra la quota `crown`, aperta sul viso
// (`temple` radianti per lato) da lì giù fino a `nape`. Capelli corti, cuffie, base delle chiome.
function cap(c: Clay, m: Mat, grow = 0.005, crown = 0.052, nape = -0.045, temple = 1.15, profile = SKULL) {
  const top = profile[profile.length - 1][0], ys = profile.map((r) => r[0]);
  c.sweep(m, [crown - 0.006, ...ys.filter((y) => y > crown + 0.008)].map((y) => ringAt(y, grow, profile)).concat([[0, top + grow, profile[profile.length - 1][1], 0.0004, 0.0004]]), 16, 0, TAU, false);
  if (nape < crown) c.sweep(m, [nape, ...ys.filter((y) => y > nape + 0.008 && y < crown - 0.008), crown].map((y) => ringAt(y, grow, profile)), 12, temple, TAU - 2 * temple, false);
}
// Ciocche disegnate a mano: [radice x,y,z, punta x,y,z, larghezza], gonfie in fuori dal cranio.
const locks = (c: Clay, m: Mat, list: number[][], lift = 0.3) => {
  for (const [ax, ay, az, bx, by, bz, w] of list) {
    const a = v(ax, ay, az), b = v(bx, by, bz);
    c.shard(m, a, b, w, a.clone().lerp(b, 0.5).sub(v(0, 0, -0.007)).normalize(), lift, 0.45);
  }
};
// Chioma a ciuffi: `n` schegge sparse sulla testa (fuori dal viso), lunghe circa `len` e larghe `w`,
// pettinate verso `flow` e scompigliate di `wild`. `pick` sceglie il colore di ogni ciuffo dalla
// sua radice.
function mane(c: Clay, n: number, len: number, w: number, flow: Vec, wild: number, pick: (root: Vec) => Mat) {
  for (let i = 0; i < n; i++) {
    const polar = Math.acos(1 - (i + 0.5) / n * 1.4), turn = i * 2.39996;
    const u = v(Math.sin(polar) * Math.sin(turn), Math.cos(polar), Math.sin(polar) * Math.cos(turn));
    if (u.z > 0.35 && u.y < 0.55) continue;
    const root = v(u.x * 0.073, u.y * 0.1, u.z * 0.086 - 0.007);
    const dir = u.clone().multiplyScalar(0.5).add(flow).add(v(rnd(i, 1) - 0.5, rnd(i, 2) - 0.5, rnd(i, 3) - 0.5).multiplyScalar(wild)).normalize();
    c.shard(pick(root), root, root.clone().addScaledVector(dir, len * (0.75 + 0.5 * rnd(i, 4))), w, u, 0.16, 0.45);
  }
}

// TENUTA (nel riferimento del busto `T` o del bacino `P`; `b` e `g` = larghezza e spessore del corpo).
// Giacca: guscio sul busto aperto davanti di `gap`, staccato dal corpo di `grow`.
const jacket = (c: Clay, m: Mat, { b, g }: Body, gap: number, grow = 0.012, seg = 12) => c.sweep(m, [
  [0, 0.05, 0, 0.093 * b + grow, 0.069 * g + grow], [0, 0.105, 0.002, 0.09 * b + grow, 0.066 * g + grow], [0, 0.17, 0.006, 0.106 * b + grow, 0.078 * g + grow],
  [0, 0.235, 0.01, 0.122 * b + grow, 0.086 * g + grow], [0, 0.288, 0.002, 0.12 * b + grow, 0.073 * g + grow], [0, 0.32, -0.004, 0.074 * b + grow, 0.052 * g + grow],
], seg, gap, TAU - 2 * gap, false);
// Bavero alto aperto davanti di `gap`: sale dalle spalle (`y0`) al bordo (`y1`) allargandosi di `flare`.
const collar = (c: Clay, m: Mat, { b, g }: Body, y0: number, y1: number, gap: number, flare = 1.2, seg = 8) => c.sweep(m, [
  [0, y0, -0.004, 0.082 * b, 0.068 * g], [0, (y0 + y1) / 2, -0.006, 0.078 * b * (1 + flare) / 2, 0.072 * g * (1 + flare) / 2], [0, y1, -0.01, 0.076 * b * flare, 0.078 * g * flare],
], seg, gap, TAU - 2 * gap, false);
// Falde del cappotto: due teli dalla vita (`y0`) all'orlo (`y1`), aperti davanti di `gap`, divisi
// dietro e svasati di `flare`. Restituisce i due teli (destro, sinistro).
const tails = (c: Clay, m: Mat, { b, g }: Body, y0: number, y1: number, gap: number, flare: number, seg = 5) => SIDES.map((d) => c.sweep(m, [
  [0, y0, 0, 0.1 * b, 0.078 * g], [0, (y0 + y1) / 2, -0.008, 0.1 * b * (1 + flare) / 2, 0.08 * g * (1 + flare) / 2], [0, y1, -0.02 - d * 0.006, 0.1 * b * flare, 0.084 * g * flare],
], seg, d > 0 ? gap : Math.PI + 0.1, Math.PI - gap - 0.1, false));
// Cintura con fibbia, alla vita.
const belt = (c: Clay, m: Mat, buckle: Mat, { b, g }: Body, y = 0.072) => {
  c.sweep(m, [[0, y - 0.017, 0, 0.099 * b, 0.074 * g], [0, y + 0.017, 0, 0.096 * b, 0.071 * g]], 14, 0, TAU, false);
  c.box(buckle, 0.032, 0.026, 0.008, 0, y, 0.074 * g);
};
// Profilo al neon lungo una fila di punti (orlo di un guscio).
const trim = (c: Clay, m: Mat, pts: Vec[], r = 0.006) => c.tube(m, pts, r, 4);
const firstCol = (grid: Vec[][]) => grid.map((row) => row[0]);
const lastCol = (grid: Vec[][]) => grid.map((row) => row[row.length - 1]);
// Spallaccio a cupola sopra la spalla `i`, inclinato in fuori, col bordo `rim` se c'è.
const pauldron = (c: Clay, m: Mat, body: Body, i: number, r: number, tilt = 0.5, seg = 8, dy = 0.012, rim?: Mat) => {
  const d = SIDES[i], s = body.sh[i];
  c.within(at(s.x + d * 0.012, s.y + dy, s.z, 0, 0, -d * tilt), () => {
    c.add(m, new THREE.SphereGeometry(1, seg, 4, 0, TAU, 0, Math.PI / 2).scale(r, r * 0.72, r * 1.18));
    if (rim) c.add(rim, new THREE.TorusGeometry(1, 0.07, 5, 20).rotateX(Math.PI / 2).scale(r, r, r * 1.18));
  });
};
// Spallaccio a lamiere: una piastra smussata sopra la spalla `i` e una che scende sul braccio;
// `stud` mette un bullone (o una spia) ai quattro angoli della prima.
const plates = (c: Clay, upper: Mat, lower: Mat, body: Body, i: number, w = 0.115, d = 0.14, stud?: Mat) => {
  const dir = SIDES[i], s = body.sh[i];
  c.within(at(s.x + dir * 0.022, s.y + 0.046, s.z, 0, 0, -dir * 0.45), () => {
    c.wedge(upper, w, 0.036, d, 0.7);
    if (stud) for (const x of SIDES) for (const z of SIDES) c.ball(stud, 0.007, x * w * 0.27, 0.018, z * d * 0.27);
  });
  c.wedge(lower, w * 0.86, 0.03, d * 0.86, 0.72, s.x + dir * 0.06, s.y - 0.006, s.z, 0, 0, -dir * 1);
};
// Piastra sul tratto `t` dell'osso da `a` a `b`, larga `w` e lunga `len`, staccata di `r` dall'asse
// e rivolta verso `out`.
const guard = (c: Clay, m: Mat, a: Vec, b: Vec, out: Vec, t: number, w: number, len: number, r: number) => c.within(along(a, b, out), () => c.wedge(m, w, 0.02, len, 0.72, 0, a.distanceTo(b) * t, r, Math.PI / 2));
// Ginocchiera: guscio sul davanti del ginocchio `i`.
const kneepad = (c: Clay, m: Mat, { g, knee }: Body, i: number) => c.ball(m, 0.036 * g, knee[i].x, knee[i].y, knee[i].z + 0.034 * g, 1, 1.25, 0.6);
// Fascia attorno a un osso, dal tratto `t0` al tratto `t1` (bracciali, schinieri, cosciali).
const cuff = (c: Clay, m: Mat, a: Vec, b: Vec, t0: number, t1: number, r0: number, r1: number, seg = 8) => c.rod(m, a.clone().lerp(b, t0), a.clone().lerp(b, t1), r0, r1, seg, false);

// ARMI, nel riferimento dell'arma: canna lungo +Z, dorso verso +Y, impugnatura sotto l'origine.
// La mano destra stringe in `HOLD`; ogni arma lunga dichiara dove va la sinistra.
const HOLD = v(0, -0.03, -0.006);
const grip = (c: Clay, m: Mat, h = 0.064) => c.box(m, 0.024, h, 0.03, 0, 0.004 - h / 2, -0.008, 0.28);

// MASTIFF AR (ROOK): fucile d'assalto nero e oro col caricatore a tamburo e il freno di bocca.
const MASTIFF_FORE = v(0, 0.006, 0.17);
function mastiff(c: Clay, dark: Mat, gold: Mat) {
  grip(c, dark);
  c.box(dark, 0.036, 0.052, 0.21, 0, 0.03, 0.035);
  c.box(dark, 0.03, 0.04, 0.15, 0, 0.036, 0.2);
  c.box(gold, 0.034, 0.012, 0.13, 0, 0.03, 0.2);
  c.box(gold, 0.038, 0.008, 0.16, 0, 0.012, 0.04);
  c.box(dark, 0.02, 0.008, 0.2, 0, 0.06, 0.1);
  c.box(dark, 0.012, 0.016, 0.02, 0, 0.068, -0.02);
  c.box(dark, 0.01, 0.018, 0.012, 0, 0.066, 0.25);
  c.bore(dark, 0.009, 0.09, 0, 0.04, 0.31);
  c.box(gold, 0.024, 0.024, 0.045, 0, 0.04, 0.365);
  c.box(dark, 0.03, 0.05, 0.12, 0, 0.022, -0.125);
  c.box(gold, 0.034, 0.066, 0.014, 0, 0.018, -0.19);
  c.wheel(dark, 0.042, 0.05, 0, -0.04, 0.09);
  for (const x of [-0.016, 0.016]) c.wheel(gold, 0.044, 0.006, x, -0.04, 0.09);
}

// MONOFILO VX (VEX): emettitore a tamburo da cui esce il filo, teso in una frustata fino al peso a freccia.
function monofilo(c: Clay, dark: Mat, steel: Mat, neon: Mat) {
  c.bore(dark, 0.02, 0.085, 0, 0, 0.005, 10, 0.015);
  c.bore(neon, 0.0205, 0.014, 0, 0, -0.012, 10);
  c.bore(steel, 0.008, 0.03, 0, 0, 0.06, 8, 0.004);
  const wire = new THREE.CatmullRomCurve3([v(0, 0, 0.07), v(0.03, 0.05, 0.17), v(0.1, 0.07, 0.28), v(0.2, 0.02, 0.36), v(0.3, -0.07, 0.4)]).getPoints(18);
  c.tube(neon, wire, 0.005);
  const tip = wire[wire.length - 1], dir = tip.clone().sub(wire[wire.length - 2]).normalize();
  c.within(along(tip, tip.clone().add(dir)), () => { c.drum(steel, 0.014, 0.001, 0.045, 0, 0.02, 0, 0, 0, 0, 4); c.ball(neon, 0.007, 0, 0, 0); });
}

// PISTOLA AD ARCO (NYX): tozza, con la camera al plasma a vista e i due condensatori sul dorso.
function arcPistol(c: Clay, dark: Mat, neon: Mat) {
  grip(c, dark);
  c.box(dark, 0.032, 0.046, 0.045, 0, 0.03, -0.005);
  c.bore(neon, 0.019, 0.045, 0, 0.032, 0.04);
  c.box(dark, 0.034, 0.012, 0.05, 0, 0.054, 0.04);
  c.box(dark, 0.034, 0.012, 0.05, 0, 0.008, 0.04);
  c.box(dark, 0.034, 0.05, 0.05, 0, 0.03, 0.088);
  c.box(neon, 0.036, 0.004, 0.04, 0, 0.012, 0.088);
  c.bore(dark, 0.014, 0.02, 0, 0.03, 0.122);
  c.hoop(neon, 0.012, 0.004, 0, 0.03, 0.133);
  for (const x of [-0.009, 0.009]) { c.bore(dark, 0.008, 0.05, x, 0.066, 0.075, 8); c.bore(neon, 0.0088, 0.008, x, 0.066, 0.06, 8); }
}

// NEEDLER (KORA): iniettore con la fiala verde sul dorso e l'ago in punta.
function needler(c: Clay, dark: Mat, steel: Mat, neon: Mat) {
  grip(c, dark);
  c.box(neon, 0.026, 0.03, 0.004, 0, -0.03, 0.008, 0.28);
  c.box(dark, 0.028, 0.034, 0.1, 0, 0.022, 0.03);
  c.bore(neon, 0.014, 0.06, 0, 0.056, 0.02);
  for (const z of [-0.014, 0.054]) c.bore(steel, 0.016, 0.01, 0, 0.056, z);
  c.bore(steel, 0.009, 0.03, 0, 0.03, 0.095, 8, 0.004);
  c.bore(steel, 0.003, 0.07, 0, 0.03, 0.14, 6);
  c.ball(neon, 0.005, 0, 0.03, 0.177);
  c.hoop(steel, 0.015, 0.005, 0, 0.026, -0.032);
}

// KESTREL SILENZIATA (ECHO): pistola sottile bianca e nera col silenziatore lungo.
function kestrel(c: Clay, black: Mat, white: Mat, cyan: Mat, pink: Mat) {
  grip(c, white, 0.066);
  c.box(black, 0.026, 0.034, 0.014, 0, -0.03, 0.004, 0.28);
  c.box(white, 0.02, 0.016, 0.1, 0, 0.012, 0.035);
  c.box(black, 0.022, 0.026, 0.125, 0, 0.032, 0.04);
  c.bore(black, 0.015, 0.105, 0, 0.032, 0.155, 12);
  c.bore(white, 0.0158, 0.008, 0, 0.032, 0.106, 12);
  c.box(cyan, 0.024, 0.004, 0.012, 0, 0.03, 0.03);
  c.box(pink, 0.024, 0.004, 0.008, 0, 0.03, 0.008);
}

// VECTOR SMG (JAX): mitraglietta compatta col caricatore lungo acceso d'arancio e il calcio a telaio.
const VECTOR_FORE = v(0, -0.045, 0.085);
function vector(c: Clay, dark: Mat, neon: Mat) {
  grip(c, dark);
  c.box(dark, 0.034, 0.056, 0.17, 0, 0.03, 0.04);
  c.box(neon, 0.036, 0.016, 0.05, 0, 0.036, 0.03);
  c.box(dark, 0.03, 0.03, 0.06, 0, 0.044, 0.15);
  c.bore(dark, 0.012, 0.035, 0, 0.044, 0.195);
  c.box(dark, 0.02, 0.01, 0.15, 0, 0.063, 0.04);
  for (const z of [-0.02, 0.1]) c.box(dark, 0.01, 0.016, 0.012, 0, 0.072, z);
  c.box(dark, 0.022, 0.12, 0.032, 0, -0.058, 0.085, -0.12);
  c.box(neon, 0.024, 0.09, 0.012, 0, -0.058, 0.085, -0.12);
  c.box(dark, 0.012, 0.012, 0.11, 0, 0.044, -0.095);
  c.box(dark, 0.012, 0.012, 0.11, 0, 0.004, -0.095, -0.3);
  c.box(dark, 0.02, 0.075, 0.012, 0, 0.012, -0.15);
  c.box(neon, 0.022, 0.03, 0.004, 0, 0.012, -0.157);
}

// RAM-12 A POMPA (MAKO): fucile a pompa con le celle rosa a vista, astina a coste e calcio pieno.
const RAM_FORE = v(0, 0.004, 0.19);
function ram12(c: Clay, dark: Mat, steel: Mat, neon: Mat) {
  grip(c, dark);
  c.box(dark, 0.036, 0.05, 0.17, 0, 0.03, 0.02);
  c.box(neon, 0.04, 0.02, 0.07, 0, 0.036, 0.03);
  c.bore(steel, 0.013, 0.25, 0, 0.046, 0.225);
  c.bore(dark, 0.012, 0.2, 0, 0.018, 0.2);
  c.bore(dark, 0.022, 0.095, 0, 0.02, 0.19, 10);
  for (const z of [0.155, 0.178, 0.201, 0.224]) c.bore(steel, 0.0235, 0.006, 0, 0.02, z, 10);
  c.bore(dark, 0.017, 0.022, 0, 0.046, 0.345);
  c.hoop(neon, 0.014, 0.004, 0, 0.046, 0.357);
  c.box(dark, 0.03, 0.046, 0.13, 0, 0.012, -0.125, -0.1);
  c.box(steel, 0.034, 0.064, 0.014, 0, 0.004, -0.195, -0.1);
  for (const z of [-0.01, 0.012, 0.034]) c.bore(neon, 0.006, 0.018, 0.022, 0.012, z, 6);
}

// CARABINA A IMPULSI (SOL): bullpup con le bobine blu a vista, il mirino e gli anelli dell'emettitore.
function carbine(c: Clay, dark: Mat, steel: Mat, neon: Mat) {
  grip(c, dark);
  c.box(dark, 0.036, 0.06, 0.27, 0, 0.03, 0);
  c.box(neon, 0.04, 0.022, 0.075, 0, 0.036, 0.07);
  c.box(steel, 0.03, 0.04, 0.1, 0, 0.036, 0.175);
  c.bore(dark, 0.011, 0.07, 0, 0.04, 0.255);
  for (const z of [0.24, 0.262]) c.hoop(neon, 0.012, 0.004, 0, 0.04, z);
  c.box(dark, 0.016, 0.014, 0.05, 0, 0.066, 0.03);
  c.box(steel, 0.018, 0.024, 0.03, 0, 0.082, 0.03);
  c.box(neon, 0.012, 0.016, 0.032, 0, 0.083, 0.03);
  c.box(dark, 0.024, 0.064, 0.036, 0, -0.022, -0.085, -0.08);
  c.box(neon, 0.026, 0.04, 0.008, 0, -0.022, -0.085, -0.08);
  c.box(steel, 0.034, 0.07, 0.014, 0, 0.026, -0.14);
  c.box(dark, 0.022, 0.03, 0.04, 0, -0.008, 0.14, 0.35);
}

// OPERATIVI. Ognuno: materiali, arma in pugno, manichino in posa, testa, tenuta.

// VEX — cappuccio a punta bordato di ciano, visore sull'occhio destro e occhio sinistro rosso,
// colletto fin sopra il mento, mantellina con le due code, monofilo in una frustata.
function vex(c: Clay, tint: THREE.Color) {
  const suit = cloth(0x303b52), cloak = facet(0x283349), ink = solid(0x1a1f2b, 0.5, 0.3), steel = solid(0x8a94a2, 0.3, 0.5);
  const skin = flesh(0xe8c9b9), lip = flesh(0xb0666a), hair = facet(0x14161f, 0.8), white = lit(0xd9dde2), neon = lit(tint), red = lit(0xff3d6e);
  const feet = [[-0.1, -0.07, -0.45], [0.085, 0.09, 0.15]];
  const gun = aim(v(-0.2, 0.47, 0.13), v(0.2, -0.2, 1), v(-0.3, 1, 0));
  const b = body(c, { tall: 0.96, bulk: 0.88, fem: true, hips: 0.495, lean: 0.1, twist: 0.2, look: [-0.08, -0.15], feet, hands: [HOLD.clone().applyMatrix4(gun), v(0.15, 0.66, 0.19)] },
    { legs: suit, boots: ink, top: suit, arms: suit, fore: suit, hands: ink, neck: skin, ink });
  c.within(gun, () => monofilo(c, ink, steel, neon));
  c.within(b.H, () => {
    face(c, skin, lip);
    eye(c, white, red, hair, 1);
    brow(c, hair, 1);
    cap(c, hair);
    locks(c, hair, [[0.025, 0.07, 0.062, -0.045, 0.008, 0.086, 0.024], [0, 0.076, 0.064, -0.064, -0.01, 0.068, 0.024], [0.04, 0.066, 0.058, 0.008, 0.024, 0.088, 0.018], [-0.058, 0.04, 0.04, -0.068, -0.075, 0.04, 0.018], [0.06, 0.04, 0.035, 0.068, -0.065, 0.034, 0.018]]);
    // Visore: cornice, lente accesa e stanghetta fino all'orecchio.
    c.box(ink, 0.058, 0.03, 0.014, -0.03, 0.012, 0.079, 0, -0.3);
    c.box(neon, 0.048, 0.02, 0.006, -0.031, 0.012, 0.088, 0, -0.3);
    c.box(ink, 0.012, 0.022, 0.07, -0.073, 0.012, 0.04);
    // Cappuccio a spicchi, aperto sul viso e chiuso a punta sulla fronte, col bordo al neon.
    const hood = c.sweep(cloak, [[0, -0.12, -0.012, 0.088, 0.094], [0, -0.06, -0.014, 0.1, 0.108], [0, 0.01, -0.012, 0.104, 0.115], [0, 0.065, -0.008, 0.098, 0.114], [0, 0.105, 0, 0.076, 0.1], [0, 0.13, 0.012, 0.04, 0.066], [0, 0.142, 0.026, 0.004, 0.02]], 10, 0.8, TAU - 1.6, false);
    trim(c, neon, firstCol(hood));
    trim(c, neon, lastCol(hood));
  });
  c.within(b.T, () => {
    // Colletto alto con la lampo, mantellina a spicchi con l'orlo acceso.
    c.sweep(cloak, [[0, 0.3, -0.004, 0.07, 0.062], [0, 0.36, 0.004, 0.064, 0.07], [0, 0.412, 0.012, 0.068, 0.08]], 8, 0, TAU, false);
    c.box(neon, 0.005, 0.07, 0.004, 0, 0.362, 0.079, -0.12);
    const cape = c.sweep(cloak, [[0, 0.34, -0.005, 0.07, 0.062], [0, 0.305, -0.002, 0.14, 0.1], [0, 0.22, 0.004, 0.165, 0.118], [0, 0.165, 0.004, 0.172, 0.124]], 10, 0, TAU, false);
    const hem = cape[cape.length - 1];
    trim(c, neon, [...hem, hem[0]], 0.004);
    c.sweep(ink, [[-0.1, 0.08, 0.05, 0.014, 0.005], [-0.02, 0.15, 0.078, 0.014, 0.005], [0.06, 0.2, 0.086, 0.014, 0.005]], 4, Math.PI / 4, TAU, false);
  });
  c.within(b.P, () => {
    belt(c, ink, neon, b);
    for (const d of SIDES) c.shard(cloak, v(d * 0.042, 0.2, -0.1), v(d * 0.065, -0.3, -0.17), 0.062, BACK, 0.08, 0.16);
    c.box(ink, 0.04, 0.045, 0.03, 0.09, 0.06, 0.04);
  });
  SIDES.forEach((d, i) => {
    const thigh = (t: number, r: number) => b.hip[i].clone().lerp(b.knee[i], t).add(v(d * r, 0, 0));
    c.tube(neon, [thigh(0.28, 0.059), thigh(0.78, 0.052)], 0.004);
    kneepad(c, ink, b, i);
    cuff(c, ink, b.elbow[i], b.wrist[i], 0.35, 0.95, 0.036, 0.031);
    cuff(c, neon, b.elbow[i], b.wrist[i], 0.5, 0.56, 0.0365, 0.036);
    c.within(at(feet[i][0], 0, feet[i][1], 0, feet[i][2]), () => c.box(neon, 0.05, 0.008, 0.006, 0, 0.03, -0.05));
  });
  // Fondina a coscia sulla destra.
  const strap = b.hip[0].clone().lerp(b.knee[0], 0.45);
  cuff(c, ink, b.hip[0], b.knee[0], 0.4, 0.5, 0.06, 0.058, 10);
  c.box(ink, 0.03, 0.075, 0.045, strap.x - 0.06, strap.y, strap.z);
  return b;
}

// ROOK — chioma a punte, visiera gialla a fascia e maschera spigolosa, cappotto corazzato col
// bavero altissimo profilato di giallo, piastre di cromo su spalle, bracci e stinchi, Mastiff AR.
function rook(c: Clay, tint: THREE.Color) {
  const coat = facet(0x403b32), pants = cloth(0x2c2a26), ink = solid(0x1d1c1b, 0.5, 0.3), chrome = solid(0xb4bac3, 0.2, 0.3), mask = plate(0x1e1f24);
  const skin = flesh(0xd9ab8b), hair = facet(0x1e1812, 0.8), neon = lit(tint), gunmetal = solid(0x1a1b1e, 0.4, 0.5), gold = solid(0xd9a531, 0.3, 0.45);
  const gun = aim(v(-0.09, 0.61, 0.1), v(0.55, -0.06, 0.83));
  const b = body(c, { tall: 1.04, bulk: 1.2, hips: 0.5, lean: 0.04, twist: -0.22, look: [-0.06, 0.25], feet: [[-0.12, -0.07, -0.4], [0.11, 0.09, 0.2]], hands: [HOLD.clone().applyMatrix4(gun), MASTIFF_FORE.clone().applyMatrix4(gun)] },
    { legs: pants, boots: ink, top: ink, arms: coat, fore: coat, hands: ink, neck: skin, ink });
  c.within(gun, () => mastiff(c, gunmetal, gold));
  c.within(b.H, () => {
    face(c, skin);
    cap(c, hair, 0.006);
    mane(c, 30, 0.085, 0.028, v(-0.35, 0.4, 0.25), 0.5, () => hair);
    locks(c, hair, [[0.02, 0.085, 0.03, -0.055, 0.03, 0.1, 0.03], [0, 0.09, 0.02, -0.088, 0.028, 0.07, 0.03], [0.03, 0.088, 0.02, 0, 0.055, 0.106, 0.024], [-0.055, 0.05, 0.03, -0.088, -0.02, 0.045, 0.02]]);
    // Visiera a fascia con le due lame di luce, maschera con la costola al centro e le prese d'aria.
    c.sweep(ink, [-0.006, 0.016, 0.038].map((y) => ringAt(y, 0.007)), 12, -1.3, 2.6, false);
    for (const d of SIDES) mark(c, neon, [[d * 0.1, -0.002], [d * 0.5, 0.005], [d * 0.95, 0.02]], 0.0045, 0.008);
    c.sweep(mask, [-0.098, -0.086, -0.05, -0.006].map((y) => ringAt(y, 0.007)), 6, -1.25, 2.5, false);
    c.box(mask, 0.02, 0.08, 0.022, 0, -0.045, 0.078, -0.2);
    for (const d of SIDES) mark(c, neon, [[d * 0.5, -0.03], [d * 0.5, -0.062]], 0.0028, 0.008);
  });
  c.within(b.T, () => {
    // Cappotto aperto sulla piastra del petto, bavero profilato, spina di luce sulla schiena.
    const shell = jacket(c, coat, b, 0.5);
    trim(c, neon, firstCol(shell));
    trim(c, neon, lastCol(shell));
    const neck = collar(c, coat, b, 0.29, 0.425, 0.62, 1.28);
    trim(c, neon, neck[neck.length - 1]);
    c.box(mask, 0.1, 0.1, 0.02, 0, 0.21, 0.094, -0.08);
    c.box(neon, 0.05, 0.008, 0.006, 0, 0.225, 0.106, -0.08);
    c.box(chrome, 0.06, 0.02, 0.008, 0, 0.19, 0.105, -0.08);
    trim(c, neon, [v(0, 0.28, -0.094), v(0, 0.235, -0.112), v(0, 0.17, -0.105), v(0, 0.08, -0.1)], 0.004);
  });
  c.within(b.P, () => {
    belt(c, ink, gold, b);
    const [right, left] = tails(c, coat, b, 0.06, -0.3, 0.5, 1.55);
    trim(c, neon, lastCol(right));
    trim(c, neon, firstCol(left));
    for (const d of SIDES) c.box(ink, 0.05, 0.055, 0.035, d * 0.075, 0.03, 0.085);
    // Tamburo di scorta sulle reni.
    c.wheel(gunmetal, 0.036, 0.046, 0, 0.03, -0.108);
    for (const x of [-0.014, 0.014]) c.wheel(gold, 0.038, 0.006, x, 0.03, -0.108);
  });
  SIDES.forEach((d, i) => {
    // Spallacci di cromo a due strati col bordo d'oro, bracciali, schinieri e ginocchiere.
    pauldron(c, chrome, b, i, 0.076, 0.45, 12, 0.012, gold);
    pauldron(c, chrome, b, i, 0.06, 0.95, 12, -0.035, gold);
    cuff(c, chrome, b.elbow[i], b.wrist[i], 0.12, 0.8, 0.047, 0.039, 12);
    cuff(c, gold, b.elbow[i], b.wrist[i], 0.12, 0.17, 0.048, 0.0475, 12);
    guard(c, chrome, b.knee[i], b.ankle[i], FRONT, 0.24, 0.07, 0.11, 0.04);
    kneepad(c, chrome, b, i);
    c.ball(ink, 0.012, b.sh[i].x + d * 0.03, b.sh[i].y + 0.066, b.sh[i].z);
  });
  return b;
}

// NYX — ciuffo lungo spiovente a destra e tempia sinistra rasata, respiratore coi due filtri ad
// anello, bavero enorme, bretelle con le fibbie, deck al polso col suo ologramma, pistola ad arco.
function nyx(c: Clay, tint: THREE.Color) {
  const coat = facet(0x3d3259), suit = cloth(0x2a243b), ink = solid(0x1b1824, 0.5, 0.3), steel = solid(0x9a9cab, 0.3, 0.5), mask = plate(0x1f1c29);
  const skin = flesh(0xe4c3b3), hair = facet(0x16131e, 0.8), dye = facet(0x5b3aa0, 0.8), stubble = cloth(0x3a3342), white = lit(0xd9dde2), neon = lit(tint), blue = lit(0x8fb8ff), pink = lit(0xff58d6);
  const holo = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const feet = [[-0.07, 0.02, -0.25], [0.085, -0.04, 0.4]];
  const gun = aim(v(-0.19, 0.5, 0.1), v(-0.12, -0.6, 0.8));
  const b = body(c, { tall: 0.96, bulk: 0.88, fem: true, hips: 0.515, lean: 0, twist: 0.12, look: [-0.1, -0.12, 0.05], feet, hands: [HOLD.clone().applyMatrix4(gun), v(0.03, 0.67, 0.2)], elbows: [undefined, v(0.9, -0.5, -0.1)] },
    { legs: suit, boots: ink, top: suit, arms: coat, fore: coat, hands: ink, neck: skin, ink });
  c.within(gun, () => arcPistol(c, ink, neon));
  c.within(b.H, () => {
    face(c, skin);
    eye(c, white, blue, ink, -1);
    eye(c, white, pink, ink, 1);
    for (const d of SIDES) brow(c, hair, d, 0.2);
    // Capelli: base scura, tempia sinistra rasata, ciocche lunghe pettinate verso destra con le punte viola.
    cap(c, hair, 0.005);
    c.sweep(stubble, [-0.045, -0.012, 0.018, 0.052].map((y) => ringAt(y, 0.0065)), 8, 0.95, 1.9, false);
    locks(c, hair, [
      [0.035, 0.085, 0.03, -0.04, 0.018, 0.09, 0.03], [0.03, 0.09, 0.005, -0.086, -0.05, 0.048, 0.034], [0.03, 0.092, -0.025, -0.092, -0.075, 0, 0.036], [0.025, 0.09, -0.05, -0.082, -0.08, -0.045, 0.036],
      [0.02, 0.082, -0.068, -0.045, -0.07, -0.085, 0.036], [0.045, 0.08, 0.02, 0.01, 0.1, 0.07, 0.026], [0.045, 0.082, -0.01, 0.035, 0.07, -0.085, 0.03], [0.04, 0.08, -0.04, 0.02, 0.02, -0.1, 0.03],
    ], 0.34);
    locks(c, dye, [[-0.02, 0.07, 0.04, -0.074, -0.03, 0.068, 0.02], [-0.04, 0.06, -0.02, -0.096, -0.088, -0.02, 0.022]], 0.36);
    // Respiratore: guscio su naso e bocca, griglia, e i due filtri ad anello sulle guance.
    c.sweep(mask, [-0.098, -0.086, -0.05, -0.012].map((y) => ringAt(y, 0.007)), 6, -1.1, 2.2, false);
    c.box(mask, 0.036, 0.056, 0.03, 0, -0.046, 0.08);
    for (const y of [-0.036, -0.048, -0.06]) c.box(neon, 0.022, 0.003, 0.004, 0, y, 0.096);
    for (const d of SIDES) {
      c.wheel(mask, 0.024, 0.024, d * 0.058, -0.056, 0.05, 12, d * -0.9);
      c.hoop(neon, 0.018, 0.0045, d * 0.066, -0.056, 0.058, 0, d * 0.67);
    }
    c.hoop(ink, 0.008, 0.004, 0.073, -0.022, -0.006, 0, Math.PI / 2);
  });
  c.within(b.T, () => {
    jacket(c, coat, b, 0.42, 0.01);
    const neck = collar(c, coat, b, 0.285, 0.42, 0.5, 1.42);
    for (const col of [firstCol(neck), lastCol(neck)]) trim(c, neon, col.slice(1), 0.006);
    // Bretelle con le fibbie, dal petto alla schiena.
    for (const d of SIDES) {
      c.sweep(ink, [[d * 0.05, 0.06, 0.07, 0.016, 0.006], [d * 0.058, 0.2, 0.092, 0.016, 0.006], [d * 0.062, 0.3, 0.05, 0.016, 0.006], [d * 0.06, 0.315, -0.03, 0.016, 0.006], [d * 0.05, 0.2, -0.084, 0.016, 0.006], [d * 0.04, 0.06, -0.07, 0.016, 0.006]], 4, Math.PI / 4, TAU, false);
      c.box(steel, 0.038, 0.016, 0.01, d * 0.057, 0.18, 0.094, -0.1);
    }
    // Nucleo del deck sulla schiena, coi cavi che salgono alla nuca.
    c.box(mask, 0.09, 0.11, 0.035, 0, 0.2, -0.098);
    c.box(neon, 0.05, 0.006, 0.004, 0, 0.225, -0.117);
    c.box(neon, 0.03, 0.006, 0.004, 0, 0.205, -0.117);
    for (const d of SIDES) c.tube(ink, new THREE.CatmullRomCurve3([v(d * 0.03, 0.25, -0.11), v(d * 0.05, 0.33, -0.12), v(d * 0.035, 0.4, -0.09)]).getPoints(8), 0.006);
  });
  c.within(b.P, () => {
    belt(c, ink, steel, b);
    c.box(ink, 0.05, 0.05, 0.03, -0.08, 0.04, -0.055);
    c.box(ink, 0.04, 0.05, 0.03, 0.085, 0.035, 0.05);
  });
  // Deck sull'avambraccio sinistro e ologramma sospeso sopra il polso.
  const deck = b.elbow[1].clone().lerp(b.wrist[1], 0.55);
  c.within(along(b.elbow[1], b.wrist[1], UP), () => { c.box(mask, 0.05, 0.085, 0.022, 0, 0.09, 0.034); c.box(neon, 0.03, 0.05, 0.004, 0, 0.09, 0.046); });
  c.within(at(deck.x - 0.02, deck.y + 0.085, deck.z + 0.01, -1.05, 0.25), () => {
    c.add(holo, new THREE.PlaneGeometry(0.15, 0.1));
    for (const [w, y] of [[0.11, 0.03], [0.07, 0.012], [0.09, -0.006], [0.05, -0.024]]) c.box(neon, w, 0.005, 0.002, (w - 0.11) / 2, y, 0);
  });
  SIDES.forEach((d, i) => {
    cuff(c, neon, b.hip[i], b.knee[i], 0.53, 0.56, 0.056, 0.0555, 12);
    c.within(at(feet[i][0], 0, feet[i][1], 0, feet[i][2]), () => c.box(neon, 0.066, 0.006, 0.12, 0, 0.022, 0.04));
    pauldron(c, mask, b, i, 0.056, 0.5, 6, 0.016);
    kneepad(c, ink, b, i);
  });
  return b;
}

// KORA — chioma arruffata nera con la ciocca bianca, occhi verdi, cappotto lungo a strisce col
// cappuccio abbassato, sciarpa, ciondolo, borsa da medico e fiale alla cintura, needler.
function kora(c: Clay, tint: THREE.Color) {
  const coat = facet(0x30463a), top = cloth(0x1f2522), pants = cloth(0x262d29), ink = solid(0x191e1c, 0.5, 0.3), leather = solid(0x4d3f30, 0.6), steel = solid(0xa0a6ab, 0.3, 0.5);
  const skin = flesh(0xe9ccb8), lip = flesh(0xb9806f), hair = facet(0x18181c, 0.8), streak = facet(0xdcdcdc, 0.8), neon = lit(tint), white = lit(0xd9dde2);
  const gun = aim(v(-0.17, 0.72, 0.17), v(0.2, 0.75, 0.6), v(0, 0.6, -0.8));
  const b = body(c, { tall: 1, bulk: 0.95, hips: 0.515, lean: 0.02, twist: -0.12, look: [-0.08, 0.14, -0.04], feet: [[-0.085, -0.04, -0.3], [0.08, 0.06, 0.2]], hands: [HOLD.clone().applyMatrix4(gun), v(0.2, 0.48, 0.04)] },
    { legs: pants, boots: ink, top, arms: coat, fore: coat, hands: ink, neck: skin, ink });
  c.within(gun, () => needler(c, ink, steel, neon));
  c.within(b.H, () => {
    face(c, skin, lip);
    for (const d of SIDES) { eye(c, white, neon, hair, d); brow(c, hair, d, 0.18); }
    // Chioma: base scura, ciuffi spettinati che ricadono, frangia con la ciocca bianca a destra.
    cap(c, hair, 0.006);
    mane(c, 40, 0.07, 0.034, v(0, -0.62, 0.08), 0.5, (root) => (root.x < -0.008 && root.z > 0.012 ? streak : hair));
    locks(c, streak, [[-0.02, 0.075, 0.06, -0.05, 0.02, 0.09, 0.026], [-0.035, 0.07, 0.05, -0.075, 0, 0.06, 0.024]]);
    locks(c, hair, [[0.01, 0.078, 0.062, -0.005, 0.03, 0.094, 0.024], [0.035, 0.072, 0.055, 0.045, 0.018, 0.084, 0.024], [0.06, 0.05, 0.03, 0.078, -0.035, 0.035, 0.022], [-0.062, 0.05, 0.02, -0.08, -0.04, 0.02, 0.022], [0, 0.03, -0.085, 0, -0.06, -0.1, 0.036], [0.04, 0.03, -0.075, 0.05, -0.055, -0.09, 0.032], [-0.04, 0.03, -0.075, -0.05, -0.055, -0.09, 0.032]]);
    // Segni sul viso e orecchini: il tratto verde sotto l'occhio sinistro, il sigillo a destra, la targhetta.
    mark(c, neon, [[0.6, -0.008], [0.6, -0.032]], 0.003);
    mark(c, ink, [[-0.56, -0.012], [-0.56, -0.024]], 0.004);
    c.box(ink, 0.004, 0.034, 0.016, -0.074, -0.05, -0.004);
    c.box(neon, 0.005, 0.006, 0.017, -0.074, -0.066, -0.004);
    c.hoop(steel, 0.007, 0.003, 0.074, -0.03, -0.004, 0, Math.PI / 2);
  });
  c.within(b.T, () => {
    const shell = jacket(c, coat, b, 0.55);
    // Sciarpa a collo alto e cappuccio abbassato sulla schiena.
    c.sweep(top, [[0, 0.3, -0.004, 0.06, 0.054], [0, 0.345, 0, 0.054, 0.056], [0, 0.378, 0.006, 0.05, 0.056]], 10, 0, TAU, false);
    c.sweep(coat, [[0, 0.275, -0.05, 0.1, 0.05], [0, 0.325, -0.06, 0.105, 0.062], [0, 0.365, -0.062, 0.085, 0.05]], 8, 1.1, TAU - 2.2, false);
    c.ball(coat, 0.06, 0, 0.3, -0.09, 1.3, 0.7, 0.8);
    // Risvolti e spalle a strisce, ciondolo con la catenina.
    for (const d of SIDES) {
      trim(c, neon, (d > 0 ? firstCol(shell) : lastCol(shell)).slice(2, 5), 0.005);
      c.box(neon, 0.04, 0.006, 0.01, d * 0.1, 0.318, 0.02, 0, 0, -d * 0.35);
    }
    c.hoop(steel, 0.042, 0.0025, 0, 0.27, 0.05, 1.1);
    c.box(steel, 0.012, 0.03, 0.006, 0, 0.215, 0.092);
    c.box(neon, 0.006, 0.022, 0.007, 0, 0.215, 0.093);
    // Tracolla col distintivo a triangolo, spina di luce sulla schiena.
    c.sweep(leather, [[-0.1, 0.07, 0.06, 0.018, 0.006], [-0.03, 0.17, 0.092, 0.018, 0.006], [0.07, 0.3, 0.05, 0.018, 0.006], [0.07, 0.31, -0.04, 0.018, 0.006], [-0.02, 0.17, -0.09, 0.018, 0.006], [-0.1, 0.07, -0.06, 0.018, 0.006]], 4, Math.PI / 4, TAU, false);
    c.drum(neon, 0.016, 0.016, 0.004, -0.05, 0.14, 0.092, Math.PI / 2 - 0.3, 0, 0, 3);
    for (const y of [0.2, 0.15, 0.1]) c.box(neon, 0.03, 0.006, 0.004, 0, y, -0.096 + (0.2 - y) * 0.1);
  });
  c.within(b.P, () => {
    belt(c, leather, steel, b);
    const [right, left] = tails(c, coat, b, 0.06, -0.36, 0.55, 1.5);
    trim(c, neon, lastCol(right).slice(1), 0.004);
    trim(c, neon, firstCol(left).slice(1), 0.004);
    // Borsa da medico sul fianco sinistro con la croce, fiale sul destro.
    c.box(leather, 0.05, 0.085, 0.1, 0.135, 0, 0.01);
    c.box(ink, 0.054, 0.03, 0.104, 0.136, 0.034, 0.01);
    c.box(neon, 0.004, 0.034, 0.012, 0.162, -0.005, 0.01);
    c.box(neon, 0.004, 0.012, 0.034, 0.162, -0.005, 0.01);
    for (const z of [0.02, 0.048, 0.076]) { c.drum(neon, 0.009, 0.009, 0.04, -0.105 + z * 0.3, 0.035, z, 0, 0, 0, 8); c.drum(steel, 0.01, 0.01, 0.01, -0.105 + z * 0.3, 0.06, z, 0, 0, 0, 8); }
  });
  SIDES.forEach((d, i) => {
    const arm = b.sh[i].clone().lerp(b.elbow[i], 0.5);
    c.box(neon, 0.006, 0.05, 0.012, arm.x + d * 0.04, arm.y, arm.z);
    cuff(c, ink, b.elbow[i], b.wrist[i], 0.78, 0.98, 0.034, 0.031);
    kneepad(c, ink, b, i);
  });
  return b;
}

// ECHO — maschera bianca senza volto con le due spie alle tempie, cuffia e padiglioni neri, tuta
// aderente a pannelli con le cuciture chiare, Kestrel silenziata lungo il fianco.
function echo(c: Clay, tint: THREE.Color) {
  const suit = solid(0x262933, 0.38, 0.15), panel = solid(0x3c404e, 0.3, 0.2), ink = solid(0x15171d, 0.4, 0.3), white = solid(0xf2f4f8, 0.2, 0, false, 0.45), seam = lit(tint.clone().multiplyScalar(0.62));
  const cyan = lit(0x6fdcff), pink = lit(0xff6fae);
  const gun = aim(v(-0.185, 0.47, 0.06), v(0, -0.82, 0.57));
  const b = body(c, { tall: 1.03, bulk: 0.85, hips: 0.525, lean: -0.02, twist: 0.1, look: [-0.1, -0.1, 0.06], feet: [[-0.05, 0, -0.15], [0.075, 0.04, 0.35]], hands: [HOLD.clone().applyMatrix4(gun), v(0.06, 0.84, 0.13)], elbows: [undefined, v(0.9, -0.7, 0.1)] },
    { legs: suit, boots: ink, top: suit, arms: suit, fore: suit, hands: panel, neck: suit, ink });
  c.within(gun, () => kestrel(c, ink, white, cyan, pink));
  c.within(b.H, () => {
    // Maschera: ovale liscio, più largo in fronte e stretto al mento. Cuffia su nuca e tempie col
    // cerchietto da un padiglione all'altro.
    c.sweep(white, MASK.map(([y, z, rx, rz]) => [0, y, z, rx, rz]), 18);
    cap(c, ink, 0.007, 0.084, -0.1, 1.12, MASK);
    const band = [-0.01, 0.03, 0.06, 0.085, 0.102].map((y) => ringAt(y, 0.009, MASK));
    c.tube(panel, [...band.map(([, y, z, rx]) => v(-rx, y, z - 0.004)), v(0, 0.117, -0.014), ...band.map(([, y, z, rx]) => v(rx, y, z - 0.004)).reverse()], 0.009, 6);
    for (const d of SIDES) {
      c.wheel(ink, 0.028, 0.022, d * 0.074, -0.004, -0.008);
      c.wheel(panel, 0.018, 0.006, d * 0.087, -0.004, -0.008);
    }
    // Spie alle tempie (ciano a destra, rosa a sinistra) col filo che scende lungo la maschera.
    for (const [d, m] of [[-1, cyan], [1, pink]] as const) {
      const [, y, z, rx, rz] = ringAt(0.06, 0.002, MASK), a = d * 0.52;
      c.hoop(m, 0.0085, 0.003, rx * Math.sin(a), y, z + rz * Math.cos(a), 0, a);
      mark(c, m, [[a, 0.05], [d * 0.56, 0.012], [d * 0.56, -0.002], [d * 0.4, -0.026]], 0.0022, 0.0015, MASK);
    }
  });
  c.within(b.T, () => {
    // Collo alto col bordo chiaro, pannelli sul petto e cuciture; sulla schiena il proiettore d'identità.
    c.sweep(ink, [[0, 0.3, -0.004, 0.056, 0.05], [0, 0.35, 0, 0.044, 0.046], [0, 0.385, 0.004, 0.04, 0.044]], 12, 0, TAU, false);
    c.hoop(seam, 0.042, 0.0026, 0, 0.386, 0.004, Math.PI / 2);
    for (const d of SIDES) {
      c.sweep(panel, [[d * 0.03, 0.1, 0.066, 0.03, 0.006], [d * 0.04, 0.17, 0.082, 0.036, 0.006], [d * 0.052, 0.24, 0.09, 0.044, 0.006], [d * 0.06, 0.29, 0.066, 0.04, 0.006]], 4, Math.PI / 4, TAU, false);
      c.tube(seam, [v(d * 0.008, 0.33, 0.04), v(d * 0.03, 0.27, 0.086), v(d * 0.09, 0.2, 0.074)], 0.0024);
      c.tube(seam, [v(d * 0.06, 0.32, -0.02), v(d * 0.05, 0.2, -0.082), v(d * 0.02, 0.07, -0.07)], 0.0024);
    }
    c.tube(seam, [v(0, 0.3, 0.05), v(0, 0.235, 0.097), v(0, 0.17, 0.085), v(0, 0.08, 0.07)], 0.0024);
    c.drum(panel, 0.034, 0.034, 0.014, 0, 0.235, -0.082, Math.PI / 2, 0, 0, 6);
    c.ball(cyan, 0.006, -0.012, 0.235, -0.091);
    c.ball(pink, 0.006, 0.012, 0.235, -0.091);
  });
  c.within(b.P, () => {
    c.sweep(ink, [[0, 0.055, 0, 0.085, 0.064], [0, 0.085, 0, 0.083, 0.062]], 14, 0, TAU, false);
    c.sweep(seam, [[0, 0.067, 0, 0.0865, 0.0655], [0, 0.073, 0, 0.0865, 0.0655]], 14, 0, TAU, false);
    c.box(white, 0.026, 0.026, 0.008, 0, 0.07, 0.064);
  });
  SIDES.forEach((d, i) => {
    pauldron(c, panel, b, i, 0.052, 0.55, 10, 0.006);
    cuff(c, white, b.elbow[i], b.wrist[i], 0.9, 0.99, 0.03, 0.029, 10);
    cuff(c, panel, b.elbow[i], b.wrist[i], 0.2, 0.86, 0.036, 0.03, 10);
    cuff(c, panel, b.hip[i], b.knee[i], 0.25, 0.8, 0.059, 0.05, 10);
    cuff(c, seam, b.knee[i], b.ankle[i], 0.47, 0.5, 0.05, 0.05, 10);
    kneepad(c, panel, b, i);
  });
  // Fondina a coscia sulla destra.
  const holster = b.hip[0].clone().lerp(b.knee[0], 0.4);
  c.box(ink, 0.026, 0.085, 0.05, holster.x - 0.058, holster.y, holster.z);
  c.box(white, 0.028, 0.006, 0.052, holster.x - 0.058, holster.y + 0.03, holster.z);
  return b;
}

// JAX — corazza integrale a facce: elmo con la cresta chiara e la visiera arancio a fessura, gorgiera,
// spallacci a strati, comando droni sul braccio, una MANTA che gli vola sopra la spalla, Vector SMG.
function jax(c: Clay, tint: THREE.Color) {
  const iron = plate(0x473c34, 0.45), steel = plate(0x8a8076, 0.35), under = cloth(0x202024), ink = solid(0x191716, 0.5, 0.3), neon = lit(tint), gunmetal = solid(0x1b1a1a, 0.4, 0.5);
  const feet = [[-0.105, -0.05, -0.35], [0.1, 0.085, 0.15]];
  const gun = aim(v(-0.07, 0.62, 0.12), v(0.45, -0.32, 0.83));
  const b = body(c, { tall: 1, bulk: 1.06, hips: 0.505, lean: 0.06, twist: -0.18, look: [-0.02, 0.2], feet, hands: [HOLD.clone().applyMatrix4(gun), VECTOR_FORE.clone().applyMatrix4(gun)] },
    { legs: under, boots: iron, top: under, arms: under, fore: under, hands: ink, neck: under, ink });
  c.within(gun, () => vector(c, gunmetal, neon));
  c.within(b.H, () => {
    // Elmo: guscio a facce, cresta chiara, frontale che sporge sulla fessura accesa, mentoniera a cuneo.
    c.add(iron, new THREE.IcosahedronGeometry(1, 1).scale(0.082, 0.102, 0.092), at(0, 0.004, -0.006));
    c.sweep(steel, [[0, 0.03, 0.082, 0.024, 0.008], [0, 0.085, 0.06, 0.026, 0.008], [0, 0.108, 0.005, 0.026, 0.008], [0, 0.095, -0.06, 0.024, 0.008], [0, 0.04, -0.094, 0.02, 0.008]], 4, Math.PI / 4, TAU, false);
    c.sweep(iron, [[0, 0.018, -0.004, 0.084, 0.098], [0, 0.05, -0.006, 0.08, 0.09]], 8, -1.35, 2.7, false);
    c.sweep(neon, [[0, -0.008, -0.004, 0.078, 0.089], [0, 0.016, -0.004, 0.079, 0.09]], 10, -1.05, 2.1, false);
    c.sweep(iron, [[0, -0.12, 0.028, 0.02, 0.024], [0, -0.09, 0.016, 0.05, 0.062], [0, -0.05, 0.004, 0.074, 0.09], [0, -0.01, -0.002, 0.083, 0.097]], 6, -1.4, 2.8, false);
    c.box(steel, 0.03, 0.07, 0.02, 0, -0.06, 0.088, -0.25);
    for (const d of SIDES) {
      c.wheel(steel, 0.03, 0.026, d * 0.084, -0.004, -0.01, 6);
      c.box(neon, 0.004, 0.022, 0.008, d * 0.099, -0.004, -0.01);
      c.box(iron, 0.016, 0.07, 0.05, d * 0.07, -0.06, 0.03, 0, d * 0.3, d * 0.2);
    }
  });
  c.within(b.T, () => {
    // Corazza: busto a facce, pettorali smussati ai lati della costola, lame sull'addome con le
    // fessure accese, gorgiera, zaino dei droni.
    c.sweep(iron, [[0, 0.1, 0.002, 0.1 * b.b, 0.076], [0, 0.17, 0.008, 0.118 * b.b, 0.092], [0, 0.245, 0.012, 0.134 * b.b, 0.1], [0, 0.3, 0.002, 0.122 * b.b, 0.08], [0, 0.33, -0.004, 0.066, 0.052]], 6, Math.PI / 6);
    c.sweep(iron, [[0, 0.05, 0, 0.097 * b.b, 0.074], [0, 0.11, 0.002, 0.1 * b.b, 0.078]], 6, Math.PI / 6, TAU, false);
    c.box(steel, 0.02, 0.1, 0.018, 0, 0.245, 0.104, -0.08);
    for (const d of SIDES) c.wedge(steel, 0.075, 0.02, 0.08, 0.7, d * 0.055, 0.245, 0.106, Math.PI / 2 - 0.08, 0, d * 0.1);
    for (const [k, y] of [0.078, 0.116, 0.154].entries()) {
      c.wedge(steel, 0.12 - k * 0.012, 0.014, 0.032, 0.8, 0, y, 0.07 + k * 0.009, Math.PI / 2 - 0.2);
      if (k) c.box(neon, 0.07, 0.005, 0.004, 0, y - 0.019, 0.066 + k * 0.008);
    }
    collar(c, iron, b, 0.3, 0.385, 0.45, 1.12, 6);
    c.wedge(iron, 0.16, 0.06, 0.18, 0.8, 0, 0.21, -0.1, -Math.PI / 2);
    c.box(steel, 0.11, 0.03, 0.02, 0, 0.27, -0.134);
    for (const d of SIDES) c.box(neon, 0.012, 0.07, 0.006, d * 0.045, 0.19, -0.132);
  });
  c.within(b.P, () => {
    belt(c, ink, steel, b);
    for (const d of SIDES) { c.wedge(iron, 0.05, 0.03, 0.065, 0.75, d * 0.088, 0.02, 0.066, Math.PI / 2, d * 0.55); c.box(neon, 0.02, 0.006, 0.004, d * 0.098, 0.03, 0.084, 0, d * 0.55); }
    c.wedge(iron, 0.07, 0.02, 0.075, 0.7, 0, -0.012, 0.072, Math.PI / 2);
  });
  SIDES.forEach((d, i) => {
    // Spallacci a due lamiere col filo acceso, piastre su braccio, avambraccio, coscia e stinco, ginocchiere a cuneo.
    plates(c, iron, steel, b, i, 0.12, 0.145);
    c.box(neon, 0.006, 0.006, 0.1, b.sh[i].x + d * 0.064, b.sh[i].y + 0.043, b.sh[i].z, 0, 0, -d * 0.45);
    cuff(c, iron, b.elbow[i], b.wrist[i], 0.12, 0.85, 0.046, 0.039, 6);
    guard(c, steel, b.sh[i], b.elbow[i], v(d, 0, 0), 0.62, 0.065, 0.09, 0.04);
    guard(c, steel, b.elbow[i], b.wrist[i], v(d, 0.5, 0), 0.5, 0.055, 0.1, 0.04);
    cuff(c, iron, b.hip[i], b.knee[i], 0.18, 0.82, 0.072, 0.06, 6);
    guard(c, steel, b.hip[i], b.knee[i], FRONT, 0.5, 0.075, 0.12, 0.062);
    cuff(c, iron, b.knee[i], b.ankle[i], 0.08, 0.6, 0.06, 0.052, 6);
    guard(c, steel, b.knee[i], b.ankle[i], FRONT, 0.32, 0.06, 0.1, 0.05);
    c.add(steel, new THREE.ConeGeometry(0.04, 0.07, 4), at(b.knee[i].x, b.knee[i].y + 0.008, b.knee[i].z + 0.034, 0.3, Math.PI / 4));
    c.within(at(feet[i][0], 0, feet[i][1], 0, feet[i][2]), () => { c.wedge(steel, 0.074, 0.03, 0.07, 0.75, 0, 0.05, 0.088); c.box(neon, 0.05, 0.006, 0.004, 0, 0.04, -0.052); });
  });
  // Comando droni sull'avambraccio sinistro.
  c.within(along(b.elbow[1], b.wrist[1], UP), () => { c.box(steel, 0.05, 0.07, 0.02, 0, 0.08, 0.046); c.box(neon, 0.034, 0.04, 0.004, 0, 0.08, 0.057); });
  // MANTA: il drone dello sciame, in volo sopra la spalla sinistra.
  c.within(at(0.29, 1, -0.02, 0.25, -0.5, -0.2), () => {
    c.ball(iron, 0.034, 0, 0, 0, 1, 0.45, 1.5);
    for (const d of SIDES) { c.shard(steel, v(d * 0.016, 0, 0.018), v(d * 0.115, 0.01, -0.042), 0.046, UP, 0.06, 0.16, 4); c.ball(neon, 0.005, d * 0.05, -0.007, -0.01); }
    c.shard(iron, v(0, 0, -0.034), v(0, 0.005, -0.115), 0.012, UP, 0, 0.5, 4);
    c.ball(neon, 0.009, 0, 0.004, 0.048);
    c.drum(neon, 0.012, 0.012, 0.005, 0, -0.016, 0);
  });
  return b;
}

// MAKO — testa rasata coi galloni alla tempia e la cicatrice, braccia nude, giubbotto tattico con
// le fibbie, spallacci di lamiera imbullonati, cella rosa sul petto, cariche alla cintura, Ram-12.
function mako(c: Clay, tint: THREE.Color) {
  const tee = cloth(0x26262c), vest = solid(0x363840, 0.75), pants = cloth(0x30323a), ink = solid(0x1b1b20, 0.5, 0.3), metal = plate(0x8e9299, 0.5), steel = solid(0xb4b8be, 0.3, 0.5);
  const skin = flesh(0x9a6444), lip = flesh(0x74402f), buzz = cloth(0x4a3226), dark = flesh(0x241611), scar = flesh(0x6e3a30), white = lit(0xc9c4bc), neon = lit(tint), band = solid(0xb3202e, 0.5);
  const gunmetal = solid(0x1c1d21, 0.4, 0.5);
  const gun = aim(v(-0.1, 0.58, 0.15), v(0.62, 0.62, 0.48), v(-0.2, 0.3, 1));
  const b = body(c, { tall: 0.98, bulk: 1.22, fem: true, hips: 0.495, lean: 0.03, twist: 0.05, look: [-0.1, 0], feet: [[-0.125, -0.02, -0.45], [0.125, 0.04, 0.4]], hands: [HOLD.clone().applyMatrix4(gun), RAM_FORE.clone().applyMatrix4(gun)] },
    { legs: pants, boots: ink, top: tee, arms: skin, fore: skin, hands: ink, neck: skin, ink });
  c.within(gun, () => ram12(c, gunmetal, steel, neon));
  c.within(b.H, () => {
    face(c, skin, lip, 1.08);
    cap(c, buzz, 0.002, 0.058, -0.03, 1.2);
    for (const d of SIDES) { eye(c, white, dark, dark, d); brow(c, dark, d, 0.3); }
    // Galloni rasati sulla tempia destra, cicatrice sulla guancia.
    for (const k of [0, 1, 2]) mark(c, dark, [[-1.2 - k * 0.13, 0.064], [-1.04 - k * 0.13, 0.048], [-1.2 - k * 0.13, 0.032]], 0.0028, 0.003);
    for (const k of [0, 1]) mark(c, scar, [[-0.66 + k * 0.13, -0.012], [-0.54 + k * 0.13, -0.04]], 0.0026);
  });
  c.within(b.T, () => {
    // Cappuccio arrotolato al collo, giubbotto, spallacci di cinghia con le fibbie.
    c.sweep(tee, [[0, 0.295, -0.01, 0.085, 0.07], [0, 0.33, -0.014, 0.088, 0.078], [0, 0.36, -0.016, 0.066, 0.062]], 10, 0, TAU, false);
    c.sweep(vest, [[0, 0.07, 0, 0.1 * b.b, 0.08], [0, 0.13, 0.004, 0.1 * b.b, 0.082], [0, 0.2, 0.008, 0.112 * b.b, 0.094], [0, 0.262, 0.01, 0.112 * b.b, 0.094]], 12, 0, TAU, false);
    for (const d of SIDES) {
      c.sweep(vest, [[d * 0.07, 0.24, 0.094, 0.024, 0.007], [d * 0.078, 0.31, 0.06, 0.024, 0.007], [d * 0.078, 0.328, -0.02, 0.024, 0.007], [d * 0.07, 0.25, -0.088, 0.024, 0.007]], 4, Math.PI / 4, TAU, false);
      c.box(steel, 0.05, 0.024, 0.012, d * 0.076, 0.27, 0.09, -0.5);
      c.box(vest, 0.06, 0.06, 0.03, d * 0.075, 0.12, 0.1);
      c.box(ink, 0.062, 0.02, 0.032, d * 0.075, 0.145, 0.1);
    }
    // Cella sul petto coi due elementi accesi e i cavi che girano le spalle.
    c.box(metal, 0.075, 0.055, 0.03, 0, 0.215, 0.11);
    for (const x of [-0.016, 0.016]) c.box(neon, 0.016, 0.04, 0.006, x, 0.215, 0.127);
    for (const d of SIDES) c.tube(ink, new THREE.CatmullRomCurve3([v(d * 0.036, 0.23, 0.115), v(d * 0.06, 0.27, 0.11), v(d * 0.05, 0.325, 0.05), v(d * 0.04, 0.33, -0.03)]).getPoints(10), 0.006);
    // Carica da breccia sulla schiena.
    c.box(vest, 0.13, 0.12, 0.05, 0, 0.19, -0.112);
    c.box(metal, 0.09, 0.05, 0.03, 0, 0.2, -0.14);
    c.box(neon, 0.05, 0.008, 0.004, 0, 0.2, -0.156);
    c.tube(ink, [v(0.03, 0.225, -0.15), v(0.07, 0.27, -0.13), v(0.06, 0.3, -0.09)], 0.005);
  });
  c.within(b.P, () => {
    belt(c, ink, steel, b);
    // Cariche a barattolo con la fascia rossa.
    for (const [x, z] of [[-0.07, 0.085], [-0.025, 0.094], [0.02, 0.094], [0.065, 0.085]]) {
      c.drum(gunmetal, 0.017, 0.017, 0.06, x, 0.03, z, 0, 0, 0, 8);
      c.drum(band, 0.0178, 0.0178, 0.01, x, 0.045, z, 0, 0, 0, 8);
      c.drum(steel, 0.012, 0.012, 0.01, x, 0.064, z, 0, 0, 0, 8);
    }
  });
  SIDES.forEach((d, i) => {
    // Spallaccio di lamiera a due piastre coi bulloni, bicipite, fascia al polso, tascone, ginocchiera.
    plates(c, metal, metal, b, i, 0.13, 0.16, steel);
    const arm = b.sh[i].clone().lerp(b.elbow[i], 0.5);
    c.ball(skin, 0.048, arm.x, arm.y, arm.z + 0.008, 1, 1.5, 1);
    cuff(c, tee, b.sh[i], b.elbow[i], 0, 0.32, 0.055, 0.053, 10);
    cuff(c, ink, b.elbow[i], b.wrist[i], 0.62, 0.98, 0.038, 0.034, 10);
    const thigh = b.hip[i].clone().lerp(b.knee[i], 0.5);
    c.box(pants, 0.03, 0.08, 0.07, thigh.x + d * 0.062, thigh.y, thigh.z);
    kneepad(c, ink, b, i);
  });
  return b;
}

// SOL — capelli corti e barba curata, oculare blu a esagono sull'occhio sinistro, cappotto corazzato
// col bavero a tacche luminose, tracolla, radio in spalla con l'antenna, carabina a impulsi; indica.
function sol(c: Clay, tint: THREE.Color) {
  const coat = facet(0x31405f), armor = plate(0x465473, 0.4), top = cloth(0x191d28), pants = cloth(0x262d41), ink = solid(0x181d29, 0.5, 0.3), leather = solid(0x2b2d36, 0.6), steel = solid(0x9aa3b2, 0.3, 0.5);
  const skin = flesh(0x7a5139), lip = flesh(0x5b382b), hair = cloth(0x141318), dark = flesh(0x1e130e), pale = flesh(0xa9785c), white = lit(0xc9c4bc), neon = lit(tint), core = lit(0xd6e6ff), gunmetal = solid(0x1c2029, 0.4, 0.5);
  const gun = aim(v(-0.205, 0.5, 0.07), v(0.04, -0.74, 0.67));
  const b = body(c, { tall: 1.03, bulk: 1.08, hips: 0.515, lean: 0.03, twist: 0.25, look: [-0.08, -0.05], feet: [[-0.09, -0.05, -0.3], [0.095, 0.1, 0.3]], hands: [HOLD.clone().applyMatrix4(gun), v(0.25, 0.79, 0.27)], elbows: [undefined, v(0.6, -0.8, 0)] },
    { legs: pants, boots: ink, top, arms: coat, fore: coat, hands: ink, neck: skin, ink });
  c.within(gun, () => carbine(c, gunmetal, steel, neon));
  c.within(b.H, () => {
    face(c, skin, lip, 1.05);
    eye(c, white, dark, dark, -1);
    for (const d of SIDES) brow(c, hair, d, 0.2);
    // Capelli corti con l'attaccatura netta e la riga rasata, barba piena coi baffi.
    cap(c, hair, 0.004, 0.06, -0.035, 1.25);
    cap(c, hair, 0.009, 0.074, 1);
    mark(c, skin, [[1.0, 0.082], [1.5, 0.064]], 0.0024, 0.0085);
    c.sweep(hair, [-0.1, -0.086, -0.066, -0.036].map((y) => ringAt(y, 0.005)), 12, -1.9, 3.8, false);
    for (const d of SIDES) mark(c, hair, [[d * 1.32, 0.02], [d * 1.36, -0.03]], 0.008, 0.001);
    mark(c, hair, [[-0.32, -0.04], [0, -0.036], [0.32, -0.04]], 0.0045, 0.003);
    c.ball(lip, 0.011, 0, -0.055, 0.066, 1.2, 0.36, 0.6);
    // Oculare: lente a esagono accesa, cornice, stanghetta e modulo all'orecchio; la cicatrice passa sull'occhio.
    c.drum(ink, 0.026, 0.026, 0.006, 0.03, 0.012, 0.078, Math.PI / 2, 0, -0.3, 6);
    c.drum(neon, 0.022, 0.022, 0.006, 0.031, 0.012, 0.081, Math.PI / 2, 0, -0.3, 6);
    c.ball(core, 0.007, 0.032, 0.012, 0.084);
    c.box(ink, 0.012, 0.014, 0.06, 0.068, 0.014, 0.046);
    c.box(ink, 0.018, 0.048, 0.03, 0.076, 0.012, 0);
    c.box(neon, 0.004, 0.03, 0.01, 0.086, 0.012, 0);
    mark(c, pale, [[0.44, 0.062], [0.4, 0.04]], 0.0022);
    mark(c, pale, [[0.36, -0.016], [0.3, -0.034]], 0.0022);
  });
  c.within(b.T, () => {
    const shell = jacket(c, coat, b, 0.4);
    // Bavero corazzato con le tacche luminose, piastre sul petto.
    const neck = collar(c, armor, b, 0.29, 0.4, 0.55, 1.2);
    c.sweep(top, [[0, 0.3, -0.004, 0.058, 0.052], [0, 0.36, 0, 0.05, 0.052]], 10, 0, TAU, false);
    for (const d of SIDES) {
      const edge = d > 0 ? firstCol(neck) : lastCol(neck), rim = d > 0 ? neck.map((row) => row[1]) : neck.map((row) => row[row.length - 2]);
      trim(c, neon, [edge[1].clone().lerp(edge[2], 0.1), edge[1].clone().lerp(edge[2], 0.8)], 0.006);
      trim(c, neon, [rim[0].clone().lerp(rim[1], 0.5), rim[1].clone().lerp(rim[2], 0.5)], 0.005);
      c.box(armor, 0.07, 0.085, 0.016, d * 0.066, 0.215, 0.094, -0.1, d * 0.42);
      c.box(neon, 0.006, 0.05, 0.006, d * 0.07, 0.215, 0.104, -0.1, d * 0.42);
      trim(c, neon, (d > 0 ? firstCol(shell) : lastCol(shell)).slice(0, 3), 0.004);
    }
    // Tracolla dalla spalla sinistra al fianco destro, con la fibbia.
    c.sweep(leather, [[-0.11, 0.07, 0.05, 0.02, 0.007], [-0.02, 0.19, 0.103, 0.02, 0.007], [0.085, 0.31, 0.05, 0.02, 0.007], [0.085, 0.32, -0.04, 0.02, 0.007], [-0.02, 0.19, -0.094, 0.02, 0.007], [-0.11, 0.07, -0.06, 0.02, 0.007]], 4, Math.PI / 4, TAU, false);
    c.box(steel, 0.04, 0.03, 0.012, 0.03, 0.245, 0.097, -0.3, 0.3, -0.8);
    // Radio in spalla: cassa, spia e antenne.
    c.box(armor, 0.13, 0.15, 0.055, 0, 0.21, -0.118);
    c.box(ink, 0.1, 0.04, 0.06, 0, 0.25, -0.118);
    for (const y of [0.17, 0.19]) c.box(neon, 0.05, 0.007, 0.004, -0.02, y, -0.147);
    c.tube(steel, [v(0.045, 0.28, -0.13), v(0.05, 0.45, -0.14), v(0.058, 0.62, -0.16)], 0.0045);
    c.ball(neon, 0.011, 0.058, 0.625, -0.16);
    c.tube(steel, [v(-0.045, 0.28, -0.13), v(-0.05, 0.42, -0.14)], 0.004);
  });
  c.within(b.P, () => {
    belt(c, leather, steel, b);
    const [right, left] = tails(c, coat, b, 0.06, -0.26, 0.42, 1.45);
    trim(c, neon, lastCol(right).slice(1), 0.004);
    trim(c, neon, firstCol(left).slice(1), 0.004);
    for (const x of [-0.085, 0.085]) c.box(leather, 0.045, 0.05, 0.03, x, 0.03, 0.082);
  });
  SIDES.forEach((d, i) => {
    // Spalle e avambracci corazzati con la striscia blu, ginocchiere.
    plates(c, armor, armor, b, i, 0.105, 0.125);
    c.box(neon, 0.04, 0.006, 0.02, b.sh[i].x + d * 0.03, b.sh[i].y + 0.07, b.sh[i].z + 0.02, 0, 0, -d * 0.45);
    guard(c, armor, b.elbow[i], b.wrist[i], v(d, 0.4, 0), 0.5, 0.06, 0.1, 0.032);
    cuff(c, neon, b.elbow[i], b.wrist[i], 0.84, 0.88, 0.034, 0.033, 8);
    kneepad(c, armor, b, i);
  });
  // Indice teso della mano sinistra.
  c.rod(ink, b.hand[1], b.hand[1].clone().addScaledVector(b.hand[1].clone().sub(b.wrist[1]).normalize(), 0.06), 0.009, 0.007, 6);
  return b;
}

const MAKERS: Record<string, (c: Clay, tint: THREE.Color) => Body> = { vex, rook, nyx, kora, echo, jax, mako, sol };
// Nomi dei ritratti in /roster che hanno la loro pedina.
export const hasOperative = (key: string) => key in MAKERS;

// Pedina dell'operativo `key` coi neon nel colore `tint`: un gruppo pronto per la scena, che
// guarda +Z e poggia i piedi a y=0.
export function buildOperative(key: string, tint: THREE.Color) {
  const clay = new Clay(), { tall } = MAKERS[key](clay, tint);
  const group = clay.bake();
  group.scale.setScalar(SCALE * tall);
  return group;
}

// NEMICI HELIX IN 3D
// Segugio, SEC-4, Custode K-9 e Goliath a tutto tondo, ricostruiti dai ritratti di /roster (il
// drone resta in BoardMap3D). Ogni unità è fatta di qualche centinaio di pezzi sfaccettati, quasi
// tutti gusci convessi dati per punti già nelle coordinate finali, che `bake` fonde in una mesh
// per materiale. Guardano +Z coi piedi a quota 0; +X è la loro sinistra, cioè la destra di chi li
// guarda in faccia (dove il ritratto del Goliath ha le crepe blu e quello del Custode la vernice).

import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V = [number, number, number];
type Geo = THREE.BufferGeometry;
type Axis = 'x' | 'y' | 'z';
// Sezione orizzontale rettangolare: centro [x, y, z], larghezza e profondità.
type Cut = [number, number, number, number, number];
type Halo = (color: string, y: number) => THREE.Sprite;

// Il rosso dei neon è quello del drone; il blu è quello delle crepe del Goliath.
const RED = '#ff2a3c', BLUE = '#39b8ff';

const v3 = (p: V) => new THREE.Vector3(p[0], p[1], p[2]);
const mix = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const std = (color: number, roughness: number, metalness: number, flatShading = true) => new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading });
const lit = (color: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

// Tavolozza comune: corazza canna di fucile, piastre in rilievo più chiare, sottotuta, tessuto, neon
// e la brace (un rosso spento per i fili secondari, così i neon veri restano pochi e leggibili).
// Sotto il sole a picco della plancia i toni scendono molto: più scuri di così i dettagli spariscono.
const palette = () => ({
  armor: std(0x3a3f4a, 0.42, 0.35), plate: std(0x5d6472, 0.45, 0.35), ink: std(0x0b0d12, 0.6, 0.3), cloth: std(0x23262e, 0.95, 0),
  neon: lit(RED), ember: new THREE.MeshStandardMaterial({ color: 0x2a070c, emissive: RED, emissiveIntensity: 0.5, roughness: 0.6 }),
});

// Solido sfaccettato: guscio convesso dei punti. `sym` vi aggiunge gli speculari sull'altro fianco.
const hull = (pts: V[]): Geo => new ConvexGeometry(pts.map(v3));
const sym = (pts: V[]): V[] => [...pts, ...pts.filter((p) => p[0] !== 0).map(([x, y, z]): V => [-x, y, z])];
// Tronco fra due o più sezioni orizzontali.
const loft = (...cuts: Cut[]) => hull(cuts.flatMap(([x, y, z, w, d]): V[] => [[x - w / 2, y, z - d / 2], [x + w / 2, y, z - d / 2], [x - w / 2, y, z + d / 2], [x + w / 2, y, z + d / 2]]));
// Segmento rastremato da `a` a `b` a sezione ottagonale (wa×da in partenza, wb×db in arrivo):
// arti, cinghie, lame. Con `bevel` 1 gli spigoli restano vivi.
function limb(a: V, b: V, wa: number, da = wa, wb = wa, db = da, bevel = 0.55): Geo {
  const A = v3(a), B = v3(b), dir = B.clone().sub(A).normalize();
  const u = Math.abs(dir.x) > 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  u.addScaledVector(dir, -u.dot(dir)).normalize();
  const v = dir.clone().cross(u), pts: THREE.Vector3[] = [];
  const at = (c: THREE.Vector3, i: number, j: number) => c.clone().addScaledVector(u, i).addScaledVector(v, j);
  for (const [c, w, d] of [[A, wa / 2, da / 2], [B, wb / 2, db / 2]] as const) for (const i of [-1, 1]) for (const j of [-1, 1]) {
    if (bevel < 1) pts.push(at(c, i * w, j * d * bevel), at(c, i * w * bevel, j * d));
    else pts.push(at(c, i * w, j * d));
  }
  return new ConvexGeometry(pts);
}
// Listello a spigoli vivi: i fili di neon e le feritoie.
const rod = (a: V, b: V, t = 0.008) => limb(a, b, t, t, t, t, 1);
// Tubo dritto da `a` a `b`.
function pipe(a: V, b: V, ra: number, rb = ra, seg = 10): Geo {
  const A = v3(a), axis = v3(b).sub(A), len = axis.length();
  return new THREE.CylinderGeometry(rb, ra, len, seg)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()))
    .translate(A.x + axis.x * len / 2, A.y + axis.y * len / 2, A.z + axis.z * len / 2);
}
// Cavo che passa per i punti dati.
const cable = (pts: V[], r: number): Geo => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(v3)), pts.length * 6, r, 6);
const box = (w: number, h: number, d: number, x: number, y: number, z: number): Geo => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const ball = (r: number, [x, y, z]: V, [sx, sy, sz]: V = [1, 1, 1], seg = 18): Geo => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7)).scale(sx, sy, sz).translate(x, y, z);
// Sfera a facce, per cupole e snodi di corazza.
const gem = (r: number, [x, y, z]: V, [sx, sy, sz]: V = [1, 1, 1], detail = 1): Geo => new THREE.IcosahedronGeometry(r, detail).scale(sx, sy, sz).translate(x, y, z);
// Disco (`drum`) e anello (`hoop`) col proprio asse lungo X, Y o Z.
const turn = (geo: Geo, axis: Axis) => axis === 'x' ? geo.rotateZ(-Math.PI / 2) : axis === 'z' ? geo.rotateX(Math.PI / 2) : geo;
const drum = (r: number, h: number, [x, y, z]: V, axis: Axis = 'y', seg = 14): Geo => turn(new THREE.CylinderGeometry(r, r, h, seg), axis).translate(x, y, z);
const hoop = (R: number, r: number, [x, y, z]: V, axis: Axis = 'y', seg = 22): Geo => turn(new THREE.TorusGeometry(R, r, 6, seg).rotateX(Math.PI / 2), axis).translate(x, y, z);
// Fascia verticale aperta attorno all'asse Y, centrata sul davanti e larga ±half: le visiere.
const band = (r: number, y0: number, y1: number, half: number): Geo => new THREE.CylinderGeometry(r, r, y1 - y0, 18, 1, true, -half, half * 2).translate(0, (y0 + y1) / 2, 0);

// Banco di montaggio: `put` aggiunge i pezzi, `pair` li aggiunge anche specchiati sull'altro fianco.
function rig() {
  const root = new THREE.Group();
  const put = (m: THREE.Material, ...geos: Geo[]) => { for (const geo of geos) root.add(new THREE.Mesh(geo, m)); };
  const pair = (m: THREE.Material, ...geos: Geo[]) => {
    for (const geo of geos) {
      const twin = new THREE.Mesh(geo, m);
      twin.scale.x = -1;
      root.add(new THREE.Mesh(geo, m), twin);
    }
  };
  return { root, put, pair };
}

// Posa un pezzo in `at` col suo asse +Z puntato verso `to`, tenendolo dritto.
function aim(obj: THREE.Object3D, at: V, to: V) {
  obj.position.copy(v3(at));
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(v3(to), v3(at), new THREE.Vector3(0, 1, 0)));
  return obj;
}

// Fonde il modello in una mesh per materiale: centinaia di pezzi, una manciata di draw call.
function bake(model: THREE.Group, scale: number) {
  model.updateMatrixWorld(true);
  const out = new THREE.Group(), parts = new Map<THREE.Material, Geo[]>(), loose: THREE.Object3D[] = [];
  model.traverse((o) => {
    if (o instanceof THREE.Sprite) loose.push(o);
    if (!(o instanceof THREE.Mesh)) return;
    const geo: Geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    geo.deleteAttribute('uv');
    // Un pezzo specchiato ha le facce rovesciate: si rigirano scambiando due vertici per triangolo.
    if (o.matrixWorld.determinant() < 0) for (const name of ['position', 'normal']) {
      const a = geo.attributes[name].array;
      for (let i = 3; i < a.length; i += 9) for (let k = 0; k < 3; k++) [a[i + k], a[i + k + 3]] = [a[i + k + 3], a[i + k]];
    }
    const m = o.material as THREE.Material;
    if (!parts.has(m)) parts.set(m, []);
    parts.get(m)!.push(geo);
  });
  for (const [m, geos] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), m);
    mesh.castShadow = m instanceof THREE.MeshStandardMaterial;
    out.add(mesh);
  }
  for (const o of loose) {
    o.matrixWorld.decompose(o.position, o.quaternion, o.scale);
    out.add(o);
  }
  out.scale.setScalar(scale);
  return out;
}

// HELIX SEGUGIO: cacciatore da inseguimento, magro e proteso in avanti. Testa a cuneo da insetto
// col triangolo rosso sul muso, occhi blu e antenne a uncino; spallacci a lame sovrapposte, zampe
// a ginocchio rovesciato, falci ai gomiti e artigli.
function hunter(halo: Halo) {
  const { root, put, pair } = rig(), { armor, plate, ink, neon } = palette(), blue = lit('#3d8bff');
  // Zampe digitigrade: anca, ginocchio in avanti, garretto alto con lo sperone, piede a punta.
  const hip: V = [0.08, 0.43, -0.01], knee: V = [0.095, 0.28, 0.07], hock: V = [0.09, 0.135, -0.045], ankle: V = [0.09, 0.035, 0.035];
  pair(armor, limb(hip, knee, 0.108, 0.125, 0.07, 0.08), limb(hock, ankle, 0.05, 0.06, 0.055, 0.065),
    hull([[0.05, 0, -0.01], [0.13, 0, -0.01], [0.045, 0, 0.09], [0.135, 0, 0.09], [0.09, 0, 0.165], [0.065, 0.05, 0], [0.115, 0.05, 0], [0.09, 0.035, 0.12]]),
    hull([[0.075, 0.15, -0.05], [0.105, 0.15, -0.05], [0.09, 0.115, -0.05], [0.09, 0.2, -0.12]]));
  pair(ink, limb(knee, hock, 0.062, 0.076, 0.045, 0.055), ball(0.038, knee, [1, 1, 1], 10), ball(0.03, hock, [1, 1, 1], 10));
  pair(plate, limb([0.108, 0.42, 0.005], [0.118, 0.3, 0.075], 0.05, 0.09, 0.035, 0.06),
    hull([[0.065, 0.27, 0.09], [0.125, 0.27, 0.09], [0.095, 0.365, 0.105], [0.095, 0.25, 0.125], [0.07, 0.31, 0.06], [0.12, 0.31, 0.06]]),
    pipe([0.09, 0.37, -0.035], [0.09, 0.16, -0.062], 0.009));
  pair(neon, rod([0.136, 0.4, 0.012], [0.138, 0.31, 0.072], 0.007), rod([0.09, 0.05, 0.01], [0.09, 0.037, 0.115], 0.007));
  // Bacino stretto e addome a segmenti accavallati, come un carapace.
  put(armor, hull(sym([[0.11, 0.45, 0.045], [0.11, 0.45, -0.07], [0.07, 0.38, 0.04], [0.07, 0.38, -0.055], [0, 0.35, 0.01], [0, 0.46, 0.06], [0, 0.46, -0.08]])),
    loft([0, 0.485, 0, 0.14, 0.108], [0, 0.525, 0.008, 0.126, 0.1]));
  put(ink, loft([0, 0.45, -0.005, 0.13, 0.1], [0, 0.49, 0, 0.115, 0.09]), loft([0, 0.52, 0.008, 0.136, 0.106], [0, 0.56, 0.015, 0.15, 0.115]));
  // Torace a chiglia con due piastre a V, e la linea di neon nella loro giunzione.
  put(armor, hull(sym([[0.15, 0.7, -0.035], [0.135, 0.715, 0.07], [0, 0.67, 0.155], [0, 0.555, 0.105], [0.08, 0.545, 0.065], [0.08, 0.545, -0.05], [0.125, 0.705, -0.095], [0, 0.73, -0.105], [0, 0.56, -0.07]])),
    hull(sym([[0.085, 0.64, 0.082], [0, 0.618, 0.143], [0, 0.58, 0.123], [0.075, 0.6, 0.078], [0.085, 0.64, 0.06], [0, 0.58, 0.1]])));
  put(plate, hull(sym([[0.11, 0.712, 0.082], [0, 0.675, 0.164], [0, 0.63, 0.149], [0.1, 0.668, 0.082], [0.11, 0.712, 0.06], [0, 0.63, 0.11]])));
  pair(neon, rod([0.1, 0.662, 0.087], [0.004, 0.625, 0.151]));
  // Schiena: spina dorsale accesa e tre pinne.
  put(neon, rod([0, 0.725, -0.108], [0, 0.565, -0.074], 0.009));
  for (const y of [0.69, 0.64, 0.59]) {
    const z = -0.06 - (y - 0.56) / 0.17 * 0.035;
    put(plate, hull([[-0.013, y, z], [0.013, y, z], [0, y + 0.035, z], [0, y - 0.02, z], [0, y + 0.045, z - 0.085]]));
  }
  // Spallacci: piastra di base e due lame sovrapposte che salgono a punta, bordate di rosso.
  pair(armor, hull([[0.13, 0.725, 0.07], [0.13, 0.725, -0.085], [0.27, 0.705, 0.05], [0.27, 0.705, -0.07], [0.305, 0.6, 0.03], [0.305, 0.6, -0.05], [0.16, 0.64, 0.08], [0.16, 0.64, -0.085]]),
    hull([[0.14, 0.73, -0.03], [0.14, 0.73, -0.095], [0.24, 0.735, -0.09], [0.275, 0.81, -0.11], [0.2, 0.76, -0.05]]));
  pair(plate, hull([[0.12, 0.735, 0.05], [0.12, 0.735, -0.07], [0.25, 0.745, 0.04], [0.25, 0.745, -0.06], [0.32, 0.86, -0.035], [0.2, 0.775, -0.01]]));
  pair(neon, rod([0.125, 0.743, 0.052], [0.25, 0.753, 0.042], 0.007), rod([0.25, 0.753, 0.042], [0.322, 0.864, -0.035], 0.007), rod([0.275, 0.705, 0.053], [0.31, 0.6, 0.033], 0.007));
  // Braccia: omero sottile, avambraccio corazzato con la falce che risale dietro il gomito, artigli.
  const shoulder: V = [0.21, 0.67, -0.005], elbow: V = [0.265, 0.5, -0.045], wrist: V = [0.225, 0.375, 0.085], palm: V = [0.215, 0.335, 0.115];
  pair(ink, limb(shoulder, elbow, 0.078, 0.084, 0.058, 0.064), limb(wrist, palm, 0.055, 0.05, 0.045, 0.04));
  pair(armor, limb(elbow, wrist, 0.072, 0.084, 0.052, 0.058), gem(0.038, elbow));
  pair(plate, hull([[0.262, 0.385, 0.09], [0.278, 0.385, 0.09], [0.262, 0.51, -0.02], [0.278, 0.51, -0.02], [0.27, 0.69, -0.165], [0.27, 0.47, -0.105], [0.27, 0.36, 0.05]]),
    ...[0.185, 0.215, 0.245].map((x) => limb([x * 0.5 + 0.1075, 0.335, 0.115], [x, 0.265, 0.165], 0.018, 0.018, 0.003, 0.003)));
  pair(neon, rod([0.27, 0.47, -0.108], [0.27, 0.69, -0.168], 0.007));
  // Collo proteso coi tendini a vista.
  put(ink, limb([0, 0.7, 0], [0, 0.8, 0.055], 0.075, 0.075, 0.06, 0.06));
  pair(plate, pipe([0.05, 0.7, 0.07], [0.03, 0.8, 0.08], 0.008));

  const head = rig();
  head.root.position.set(0, 0.875, 0.085);
  head.root.rotation.x = -0.12;
  head.root.scale.setScalar(1.1);
  head.put(armor, hull(sym([[0.045, 0.115, -0.02], [0.045, 0.1, 0.06], [0.105, 0.05, -0.03], [0.095, 0.045, 0.07], [0.085, -0.03, 0.075], [0.09, -0.02, -0.03], [0.035, -0.11, 0.085], [0, -0.145, 0.09],
    [0, 0.07, 0.105], [0, -0.03, 0.115], [0.06, 0.06, -0.105], [0, 0.09, -0.115], [0.05, -0.05, -0.08], [0, -0.08, -0.06]])));
  // Calotta in due piastre: nel solco fra l'una e l'altra corre un filo rosso.
  head.pair(plate, hull([[0.01, 0.118, 0.065], [0.01, 0.135, -0.03], [0.075, 0.1, 0.075], [0.115, 0.065, -0.02], [0.11, 0.06, 0.06], [0.07, 0.09, -0.1], [0.01, 0.11, -0.11], [0.05, 0.06, 0]]),
    hull([[0.02, -0.1, 0.085], [0.05, -0.085, 0.07], [0.04, -0.1, 0.095], [0.022, -0.185, 0.11], [0.045, -0.11, 0.06]]));
  head.put(neon, rod([0, 0.105, 0.06], [0, 0.12, -0.02], 0.007), rod([0, 0.12, -0.02], [0, 0.097, -0.11], 0.007));
  // Muso: cornice scura a chiglia e, dentro, il triangolo rosso con la punta in giù.
  head.put(ink, hull(sym([[0.056, 0.03, 0.091], [0, 0.03, 0.114], [0, -0.085, 0.111], [0.056, 0.03, 0.07], [0, -0.085, 0.09]])));
  head.put(neon, hull(sym([[0.04, 0.018, 0.1], [0, 0.018, 0.121], [0, -0.062, 0.12], [0.04, 0.018, 0.085], [0, -0.062, 0.1]])));
  head.pair(blue, ball(0.012, [0.082, 0, 0.074], [0.8, 1.7, 0.8], 10));
  // Pinne alle tempie e antenne che salgono all'indietro e ricadono a uncino.
  head.pair(armor, hull([[0.095, 0.06, 0.03], [0.1, 0.05, -0.06], [0.09, -0.02, -0.02], [0.148, 0.1, -0.075], [0.1, 0, 0.03]]),
    limb([0.05, 0.1, -0.01], [0.105, 0.31, -0.07], 0.03, 0.03, 0.014, 0.014), limb([0.105, 0.31, -0.07], [0.152, 0.262, -0.097], 0.014, 0.014, 0.005, 0.005));
  head.pair(plate, gem(0.023, [0.05, 0.11, -0.012]));
  const glare = halo(RED, 0);
  glare.position.set(0, -0.02, 0.14);
  glare.scale.setScalar(0.26);
  head.root.add(glare);
  root.add(head.root);
  return root;
}

// Carabina del SEC-4, con l'impugnatura nell'origine e la canna lungo +Z.
function carbine({ armor, plate, ink, neon }: ReturnType<typeof palette>) {
  const { root, put } = rig();
  put(armor, box(0.034, 0.05, 0.17, 0, 0.04, 0.035), box(0.014, 0.012, 0.22, 0, 0.071, 0.06),
    hull([[-0.014, 0.015, -0.05], [0.014, 0.015, -0.05], [-0.014, 0.062, -0.05], [0.014, 0.062, -0.05], [-0.016, -0.008, -0.19], [0.016, -0.008, -0.19], [-0.016, 0.06, -0.19], [0.016, 0.06, -0.19]]));
  put(ink, limb([0, 0.02, -0.005], [0, -0.04, -0.03], 0.024, 0.03), limb([0, 0.02, 0.06], [0, -0.065, 0.078], 0.02, 0.04),
    pipe([0, 0.045, 0.27], [0, 0.045, 0.36], 0.009), pipe([0, 0.045, 0.352], [0, 0.045, 0.39], 0.015));
  put(plate, limb([0, 0.04, 0.12], [0, 0.04, 0.27], 0.042, 0.046, 0.036, 0.04), box(0.022, 0.026, 0.06, 0, 0.09, 0.02));
  put(neon, box(0.016, 0.018, 0.004, 0, 0.09, 0.052), box(0.038, 0.007, 0.09, 0, 0.046, 0.045), box(0.046, 0.006, 0.09, 0, 0.04, 0.195));
  root.scale.setScalar(0.78);
  return root;
}

// HELIX SEC-4: fante di guardia. Elmo liscio e lucido con la piastra facciale a tre feritoie rosse
// e i padiglioni tondi, cappotto dal bavero alto a punta e dai revers larghi bordati di rosso sopra
// la corazza del petto, carabina tenuta di traverso a canna bassa.
function sec() {
  const { root, put, pair } = rig(), tones = palette(), { armor, plate, ink, cloth, neon, ember } = tones;
  const gloss = std(0x1a1d25, 0.16, 0.7, false);
  // Scarponi, stinchi col parastinco e la ginocchiera a punta, cosce.
  pair(ink, box(0.1, 0.03, 0.2, 0.075, 0.015, 0.025), loft([0.075, 0.1, 0, 0.075, 0.085], [0.077, 0.26, 0.005, 0.092, 0.1]));
  pair(armor, loft([0.075, 0.03, 0.025, 0.095, 0.19], [0.075, 0.11, -0.005, 0.085, 0.1]),
    hull([[0.03, 0.03, 0.08], [0.12, 0.03, 0.08], [0.036, 0.03, 0.124], [0.114, 0.03, 0.124], [0.04, 0.068, 0.076], [0.11, 0.068, 0.076], [0.048, 0.055, 0.116], [0.102, 0.055, 0.116]]));
  pair(plate, hull([[0.04, 0.12, 0.02], [0.114, 0.12, 0.02], [0.045, 0.12, 0.052], [0.109, 0.12, 0.052], [0.036, 0.245, 0.02], [0.118, 0.245, 0.02], [0.04, 0.245, 0.064], [0.114, 0.245, 0.064], [0.077, 0.305, 0.07], [0.077, 0.27, 0.03]]));
  pair(neon, rod([0.077, 0.14, 0.056], [0.077, 0.235, 0.068]));
  pair(cloth, loft([0.077, 0.25, 0.005, 0.09, 0.1], [0.08, 0.41, 0, 0.115, 0.125]));
  // Bacino e cinturone con fibbia e giberne.
  put(ink, loft([0, 0.37, 0, 0.2, 0.115], [0, 0.44, 0, 0.21, 0.125]));
  put(armor, box(0.235, 0.04, 0.15, 0, 0.45, 0));
  put(plate, box(0.05, 0.036, 0.014, 0, 0.45, 0.08));
  put(neon, box(0.024, 0.012, 0.006, 0, 0.45, 0.089));
  // Cappotto: busto, falde aperte sul davanti con lo spacco dietro, spalle.
  put(cloth, hull(sym([[0.125, 0.44, 0.08], [0.125, 0.44, -0.09], [0.165, 0.6, 0.09], [0.165, 0.6, -0.1], [0.2, 0.665, 0.055], [0.2, 0.665, -0.075], [0.07, 0.715, 0.05], [0.07, 0.715, -0.075]])));
  pair(cloth, hull([[0.006, 0.44, -0.098], [0.125, 0.44, -0.085], [0.012, 0.16, -0.15], [0.18, 0.15, -0.12], [0.006, 0.44, -0.084], [0.125, 0.44, -0.071], [0.012, 0.16, -0.136], [0.18, 0.15, -0.106]]),
    hull([[0.125, 0.44, -0.085], [0.13, 0.44, 0.07], [0.18, 0.15, -0.12], [0.19, 0.15, 0.085], [0.111, 0.44, -0.085], [0.116, 0.44, 0.07], [0.166, 0.15, -0.12], [0.176, 0.15, 0.085]]),
    hull([[0.13, 0.44, 0.07], [0.07, 0.44, 0.098], [0.19, 0.15, 0.085], [0.105, 0.17, 0.135], [0.13, 0.44, 0.056], [0.07, 0.44, 0.084], [0.19, 0.15, 0.071], [0.105, 0.17, 0.121]]));
  pair(neon, rod([0.069, 0.44, 0.101], [0.104, 0.172, 0.138]));
  pair(ember, rod([0.106, 0.168, 0.137], [0.192, 0.148, 0.087], 0.007), rod([0.014, 0.158, -0.153], [0.182, 0.148, -0.123], 0.007), rod([0.007, 0.43, -0.101], [0.013, 0.165, -0.153], 0.006));
  // Corazza del petto nella V dei revers, col suo filo rosso; emblema Helix (triangolo) sulla schiena.
  put(armor, hull(sym([[0.085, 0.685, 0.085], [0.09, 0.6, 0.1], [0.055, 0.5, 0.1], [0, 0.47, 0.105], [0, 0.6, 0.122], [0, 0.69, 0.1], [0.085, 0.685, 0.05], [0.055, 0.5, 0.05]])));
  put(plate, hull(sym([[0.05, 0.5, 0.108], [0.04, 0.47, 0.106], [0, 0.465, 0.112], [0, 0.505, 0.117], [0.05, 0.5, 0.08], [0.04, 0.47, 0.08]])));
  pair(neon, rod([0.05, 0.655, 0.108], [0.006, 0.56, 0.124]));
  put(neon, rod([0, 0.555, 0.124], [0, 0.512, 0.119]));
  put(ember, rod([-0.06, 0.655, -0.087], [0.06, 0.655, -0.087], 0.009));
  pair(ember, rod([0.06, 0.655, -0.087], [0, 0.555, -0.103], 0.009));
  // Revers larghi a punta e bavero alto: due ali ai lati dell'elmo, chiuse dietro la nuca.
  pair(cloth, hull([[0.085, 0.7, 0.088], [0.125, 0.69, 0.07], [0.172, 0.63, 0.078], [0.1, 0.5, 0.098], [0.02, 0.46, 0.108], [0.085, 0.7, 0.106], [0.125, 0.69, 0.088], [0.172, 0.63, 0.096], [0.1, 0.5, 0.116], [0.02, 0.46, 0.126]]));
  pair(neon, rod([0.086, 0.7, 0.108], [0.021, 0.462, 0.128]));
  pair(ember, rod([0.172, 0.63, 0.098], [0.1, 0.5, 0.118], 0.006), rod([0.125, 0.69, 0.09], [0.172, 0.63, 0.098], 0.006));
  pair(armor, hull([[0.07, 0.7, 0.075], [0.085, 0.7, -0.085], [0.165, 0.85, -0.035], [0.118, 0.8, 0.05], [0.09, 0.7, 0.085], [0.11, 0.7, -0.09], [0.175, 0.85, -0.035], [0.134, 0.8, 0.058]]),
    hull([[0.085, 0.7, -0.085], [0.11, 0.7, -0.09], [0.15, 0.84, -0.04], [0.165, 0.845, -0.045], [0.05, 0.7, -0.1], [0.06, 0.7, -0.115], [0.085, 0.82, -0.125], [0.09, 0.825, -0.14]]),
    hull([[0.05, 0.7, -0.1], [0.06, 0.7, -0.115], [0, 0.7, -0.105], [0, 0.7, -0.12], [0.085, 0.82, -0.125], [0.09, 0.825, -0.14], [0, 0.815, -0.14], [0, 0.82, -0.155]]));
  pair(neon, rod([0.092, 0.7, 0.088], [0.136, 0.802, 0.06], 0.007), rod([0.136, 0.802, 0.06], [0.177, 0.853, -0.035], 0.007));
  // Spalline e braccia: la destra all'impugnatura, la sinistra avanti sull'astina.
  pair(armor, hull([[0.165, 0.7, 0.06], [0.165, 0.7, -0.06], [0.255, 0.685, 0.055], [0.255, 0.685, -0.055], [0.27, 0.61, 0.05], [0.27, 0.61, -0.05], [0.2, 0.72, 0], [0.175, 0.62, 0.065], [0.175, 0.62, -0.065]]));
  pair(ember, rod([0.273, 0.612, 0.05], [0.273, 0.612, -0.05], 0.007));
  const grip: V = [-0.075, 0.502, 0.125], fore: V = [0.0505, 0.435, 0.209];
  for (const [shoulder, elbow, wrist, hand] of [[[-0.215, 0.65, 0], [-0.245, 0.485, -0.04], [-0.105, 0.5, 0.105], grip], [[0.215, 0.65, 0], [0.235, 0.5, 0.06], [0.08, 0.44, 0.19], fore]] as V[][]) {
    put(cloth, limb(shoulder, elbow, 0.085, 0.09, 0.075, 0.08), limb(elbow, wrist, 0.07, 0.075, 0.06, 0.065));
    put(armor, limb(mix(elbow, wrist, 0.3), mix(elbow, wrist, 0.9), 0.08, 0.085, 0.07, 0.075), gem(0.044, elbow));
    put(ink, limb(wrist, hand, 0.052, 0.058, 0.05, 0.055), ball(0.03, hand, [1, 1, 1], 8));
  }
  root.add(aim(carbine(tones), grip, fore));
  put(ink, drum(0.052, 0.07, [0, 0.715, 0]));

  const head = rig();
  head.root.position.set(0, 0.835, 0);
  head.root.rotation.x = -0.08;
  head.put(gloss, ball(0.118, [0, 0, 0], [0.92, 1.12, 1], 24));
  // Cresta sottile sopra la calotta, mentoniera, e la piastra facciale piatta con le tre feritoie.
  head.put(armor, hull(sym([[0.014, 0.142, 0], [0.014, 0.117, 0.07], [0.014, 0.117, -0.07], [0.012, 0.068, 0.108], [0.012, 0.068, -0.108], [0.014, 0, 0]])),
    hull(sym([[0.05, -0.08, 0.1], [0.035, -0.15, 0.085], [0, -0.16, 0.095], [0.075, -0.07, 0.03], [0.05, -0.14, 0.03], [0, -0.08, 0.1]])),
    hull(sym([[0.04, 0.1, 0.05], [0.058, 0.075, 0.05], [0.058, -0.08, 0.05], [0.04, -0.13, 0.05], [0.036, 0.098, 0.1], [0.054, 0.072, 0.112], [0.054, -0.078, 0.12], [0.036, -0.126, 0.11]])));
  head.put(ink, hull(sym([[0.043, 0.066, 0.1135], [0.043, -0.072, 0.121], [0.043, 0.066, 0.1], [0.043, -0.072, 0.1]])));
  head.put(neon, rod([0, -0.07, 0.1225], [0, 0.062, 0.1155], 0.011));
  head.pair(neon, rod([0.027, -0.07, 0.1225], [0.027, 0.03, 0.1172], 0.009), hoop(0.03, 0.006, [0.129, 0, -0.005], 'x'));
  head.pair(armor, drum(0.042, 0.03, [0.112, 0, -0.005], 'x'));
  head.pair(ink, drum(0.018, 0.012, [0.13, 0, -0.005], 'x'));
  root.add(head.root);
  return root;
}

// CUSTODE K-9: presidio corazzato. Elmo a cupola con la tesa, la visiera rossa a fascia e la
// mentoniera squadrata; sciarpa al collo, spallacci a più piastre (il sinistro sfregiato di
// vernice rossa), cinghie e fibbie, zaino d'alimentazione. Scudo al braccio sinistro col quadrato
// Helix, sfollagente acceso nella destra.
function elite() {
  const { root, put, pair } = rig(), { armor, plate, ink, cloth, neon, ember } = palette();
  const shell = std(0x3a3f4a, 0.5, 0.35, false), paint = std(0xc21f33, 0.7, 0);
  // Scarponi con puntale, schinieri, ginocchiere, cosce con piastra e cinghia.
  pair(ink, box(0.12, 0.03, 0.23, 0.09, 0.015, 0.03), loft([0.09, 0.11, 0, 0.095, 0.105], [0.092, 0.27, 0.005, 0.115, 0.125]), box(0.15, 0.022, 0.16, 0.095, 0.35, 0));
  pair(armor, loft([0.09, 0.03, 0.03, 0.115, 0.21], [0.09, 0.12, 0, 0.1, 0.125]),
    hull([[0.045, 0.12, 0.02], [0.135, 0.12, 0.02], [0.05, 0.12, 0.062], [0.13, 0.12, 0.062], [0.036, 0.26, 0.02], [0.148, 0.26, 0.02], [0.042, 0.26, 0.078], [0.142, 0.26, 0.078], [0.092, 0.2, 0.088]]),
    hull([[0.05, 0.3, 0.06], [0.14, 0.3, 0.06], [0.045, 0.4, 0.07], [0.15, 0.4, 0.07], [0.055, 0.3, 0.078], [0.135, 0.3, 0.078], [0.05, 0.4, 0.09], [0.145, 0.4, 0.09]]));
  pair(plate, hull([[0.04, 0.03, 0.09], [0.14, 0.03, 0.09], [0.045, 0.03, 0.142], [0.135, 0.03, 0.142], [0.05, 0.075, 0.085], [0.13, 0.075, 0.085], [0.06, 0.06, 0.132], [0.12, 0.06, 0.132]]),
    hull([[0.05, 0.25, 0.07], [0.134, 0.25, 0.07], [0.092, 0.235, 0.1], [0.06, 0.31, 0.075], [0.124, 0.31, 0.075], [0.092, 0.335, 0.085], [0.092, 0.285, 0.11], [0.05, 0.27, 0.03], [0.134, 0.27, 0.03]]));
  pair(neon, rod([0.066, 0.262, 0.096], [0.118, 0.262, 0.096]));
  pair(cloth, loft([0.092, 0.26, 0.005, 0.115, 0.125], [0.095, 0.42, 0, 0.14, 0.15]));
  put(plate, box(0.035, 0.1, 0.07, -0.178, 0.34, 0));
  put(ink, box(0.03, 0.045, 0.035, -0.18, 0.405, 0.02));
  // Bacino con paraventre e fiancali, cinturone carico di giberne.
  put(ink, loft([0, 0.38, 0, 0.24, 0.14], [0, 0.45, 0, 0.26, 0.155]), box(0.28, 0.05, 0.175, 0, 0.465, 0));
  put(armor, hull(sym([[0.05, 0.45, 0.085], [0.035, 0.34, 0.09], [0, 0.315, 0.095], [0, 0.45, 0.1], [0.05, 0.45, 0.06], [0.035, 0.34, 0.06]])));
  pair(plate, hull([[0.085, 0.45, 0.085], [0.165, 0.45, 0.04], [0.17, 0.45, -0.06], [0.09, 0.33, 0.095], [0.185, 0.32, 0.045], [0.19, 0.32, -0.06], [0.085, 0.45, 0.06], [0.15, 0.45, -0.06], [0.1, 0.33, 0.07], [0.17, 0.32, -0.05]]));
  put(plate, box(0.06, 0.04, 0.014, 0, 0.465, 0.092));
  put(neon, box(0.03, 0.012, 0.006, 0, 0.465, 0.1));
  pair(armor, box(0.045, 0.06, 0.035, 0.075, 0.462, 0.1), box(0.04, 0.06, 0.05, 0.155, 0.462, 0.03), box(0.07, 0.06, 0.04, 0.06, 0.46, -0.1));
  // Busto: pettorale, piastra centrale a trapezio, piastra del ventre, cinghie con le fibbie.
  put(cloth, hull(sym([[0.13, 0.45, 0.08], [0.13, 0.45, -0.085], [0.185, 0.62, 0.1], [0.185, 0.62, -0.105], [0.2, 0.7, 0.07], [0.2, 0.7, -0.09], [0.08, 0.74, 0.05], [0.08, 0.74, -0.08]])));
  put(armor, hull(sym([[0.15, 0.7, 0.085], [0.165, 0.61, 0.108], [0.115, 0.525, 0.11], [0, 0.505, 0.122], [0, 0.62, 0.138], [0.06, 0.71, 0.1], [0.15, 0.7, 0.05], [0.115, 0.525, 0.06]])));
  put(plate, hull(sym([[0.075, 0.65, 0.128], [0.055, 0.565, 0.132], [0.075, 0.65, 0.1], [0.055, 0.565, 0.1], [0, 0.65, 0.142], [0, 0.565, 0.146]])),
    hull(sym([[0.1, 0.522, 0.108], [0.09, 0.49, 0.102], [0, 0.486, 0.114], [0, 0.524, 0.124], [0.1, 0.522, 0.07], [0.09, 0.49, 0.07]])));
  put(neon, rod([-0.045, 0.556, 0.136], [0.045, 0.556, 0.136]));
  pair(ink, limb([0.105, 0.53, 0.118], [0.115, 0.62, 0.126], 0.032, 0.012), limb([0.115, 0.62, 0.126], [0.128, 0.71, 0.098], 0.032, 0.012), limb([0.125, 0.72, -0.092], [0.1, 0.5, -0.102], 0.032, 0.012));
  pair(plate, box(0.04, 0.022, 0.012, 0.114, 0.61, 0.129));
  // Zaino d'alimentazione con le feritoie accese e le due bombole.
  put(armor, loft([0, 0.5, -0.125, 0.17, 0.07], [0, 0.69, -0.13, 0.2, 0.08]));
  pair(neon, box(0.012, 0.1, 0.008, 0.04, 0.6, -0.167));
  pair(plate, drum(0.025, 0.13, [0.125, 0.6, -0.13]));
  pair(ember, drum(0.017, 0.01, [0.125, 0.668, -0.13]));
  // Sciarpa: rotolo attorno al collo e lembo sul petto.
  put(cloth, hoop(0.1, 0.042, [0, 0, 0]).scale(1, 0.75, 1).translate(0, 0.745, 0.005), hull(sym([[0.09, 0.735, 0.085], [0, 0.665, 0.146], [0.05, 0.68, 0.134], [0, 0.745, 0.125], [0.08, 0.73, 0.05]])));
  put(ink, drum(0.058, 0.07, [0, 0.745, 0]));
  // Spallacci: calotta, lama inferiore col filo di luce, aletta paracollo, fibbia sul davanti.
  pair(armor, hull([[0.165, 0.745, 0.085], [0.165, 0.745, -0.09], [0.3, 0.735, 0.08], [0.3, 0.735, -0.085], [0.34, 0.665, 0.075], [0.34, 0.665, -0.08], [0.175, 0.68, 0.1], [0.175, 0.68, -0.105], [0.235, 0.775, 0]]),
    hull([[0.15, 0.745, 0.075], [0.15, 0.745, -0.085], [0.165, 0.815, 0.05], [0.165, 0.815, -0.06], [0.19, 0.745, 0.075], [0.19, 0.745, -0.085], [0.18, 0.81, 0.05], [0.18, 0.81, -0.06]]));
  pair(plate, hull([[0.25, 0.675, 0.08], [0.25, 0.675, -0.085], [0.35, 0.655, 0.075], [0.35, 0.655, -0.08], [0.362, 0.57, 0.065], [0.362, 0.57, -0.07], [0.27, 0.58, 0.075], [0.27, 0.58, -0.08]]),
    box(0.035, 0.055, 0.012, 0.21, 0.672, 0.101));
  pair(neon, rod([0.365, 0.572, 0.065], [0.365, 0.572, -0.07]));
  put(paint, rod([0.2, 0.738, 0.09], [0.23, 0.688, 0.097], 0.012), rod([0.235, 0.736, 0.087], [0.265, 0.688, 0.092], 0.012), rod([0.27, 0.73, 0.084], [0.296, 0.692, 0.086], 0.01),
    rod([0.19, 0.762, 0.04], [0.255, 0.766, -0.02], 0.012), rod([0.228, 0.764, 0.05], [0.292, 0.75, -0.012], 0.012));
  // Braccio destro con lo sfollagente acceso, tenuto basso.
  const hand: V = [-0.25, 0.335, 0.088], tip: V = [-0.232, 0.11, 0.283];
  for (const [shoulder, elbow, wrist, fist] of [[[-0.245, 0.68, 0], [-0.275, 0.5, -0.02], [-0.255, 0.365, 0.07], hand], [[0.245, 0.68, 0], [0.29, 0.5, -0.01], [0.275, 0.37, 0.075], [0.27, 0.335, 0.095]]] as V[][]) {
    put(cloth, limb(shoulder, elbow, 0.1, 0.105, 0.09, 0.095));
    put(armor, limb(elbow, wrist, 0.095, 0.1, 0.085, 0.09), gem(0.056, elbow));
    put(plate, limb(mix(elbow, wrist, 0.25), mix(elbow, wrist, 0.8), 0.105, 0.11, 0.097, 0.1));
    put(ink, limb(wrist, fist, 0.075, 0.08, 0.07, 0.075), ball(0.042, fist, [1, 1, 1], 8));
  }
  put(ink, pipe(mix(hand, tip, -0.2), mix(hand, tip, 0.17), 0.015), pipe(mix(hand, tip, 0.97), mix(hand, tip, 1.04), 0.016));
  put(plate, pipe(mix(hand, tip, 0.17), mix(hand, tip, 0.21), 0.027));
  put(neon, pipe(mix(hand, tip, 0.21), mix(hand, tip, 0.97), 0.011));
  // Scudo a chiglia sul braccio sinistro: feritoia in alto e il quadrato Helix al centro.
  const shield = rig();
  shield.put(armor, hull(sym([[0.1, -0.12, 0], [0.07, -0.17, 0], [0.1, 0.13, 0], [0.07, 0.17, 0], [0.1, -0.12, 0.018], [0.07, -0.17, 0.018], [0.1, 0.13, 0.018], [0.07, 0.17, 0.018], [0, -0.17, 0.04], [0, 0.17, 0.04]])));
  shield.put(plate, box(0.06, 0.1, 0.04, 0, 0.02, -0.02));
  shield.pair(ember, rod([0.004, 0.118, 0.042], [0.062, 0.118, 0.029], 0.012));
  shield.pair(neon, rod([0.002, 0.05, 0.043], [0.052, 0.05, 0.032]), rod([0.052, 0.05, 0.032], [0.052, -0.055, 0.032]), rod([0.052, -0.055, 0.032], [0.002, -0.055, 0.043]));
  shield.pair(plate, drum(0.012, 0.01, [0.078, 0.135, 0.026], 'z'), drum(0.012, 0.01, [0.078, -0.13, 0.026], 'z'));
  root.add(aim(shield.root, [0.338, 0.44, 0.05], [0.338 + 0.85, 0.44, 0.05 + 0.52]));

  const head = rig();
  head.root.position.set(0, 0.87, 0);
  head.root.rotation.x = -0.08;
  head.put(shell, ball(0.133, [0, 0, 0], [1, 1, 1.04], 24));
  // Tesa sopra la visiera, pannello centrale della calotta, paranuca e guanciali.
  head.put(armor, hull(sym([[0, 0.085, 0.135], [0.085, 0.08, 0.105], [0.135, 0.07, 0.03], [0, 0.045, 0.152], [0.095, 0.04, 0.118], [0.148, 0.035, 0.03], [0, 0.07, 0.07], [0.11, 0.06, 0]])),
    hull(sym([[0.045, 0.088, 0.1], [0.045, 0.1235, 0.05], [0.045, 0.133, 0], [0.045, 0.119, -0.06], [0.045, 0.075, -0.11], [0, 0.1, 0.1], [0, 0.132, 0.05], [0, 0.141, 0], [0, 0.128, -0.06], [0, 0.088, -0.11], [0.045, 0, 0]])),
    hull(sym([[0.11, -0.03, -0.085], [0.09, -0.11, -0.1], [0, -0.03, -0.145], [0, -0.12, -0.138], [0.12, -0.04, -0.02], [0.1, -0.11, -0.03]])));
  head.pair(armor, hull([[0.1, 0, 0.085], [0.14, 0, 0.01], [0.105, -0.105, 0.065], [0.125, -0.095, 0.005], [0.145, -0.03, 0.045], [0.11, -0.02, 0.02], [0.1, -0.09, 0.01]]));
  head.put(neon, band(0.139, -0.004, 0.042, 1.05));
  // Mentoniera a trapezio con la giunzione al centro e le prese d'aria.
  head.put(plate, hull(sym([[0.08, 0, 0.112], [0, 0, 0.146], [0.065, -0.09, 0.105], [0, -0.105, 0.14], [0.04, -0.145, 0.09], [0, -0.155, 0.108], [0.095, -0.02, 0.06], [0.075, -0.11, 0.05]])));
  head.put(ink, rod([0, -0.006, 0.148], [0, -0.104, 0.142], 0.006));
  for (const y of [-0.045, -0.064, -0.083]) head.pair(ink, rod([0.022, y, 0.136], [0.055, y, 0.119], 0.007));
  // Moduli radio alle orecchie, con l'antenna a destra.
  head.pair(plate, box(0.03, 0.07, 0.075, 0.143, 0.005, -0.015));
  head.pair(neon, box(0.008, 0.02, 0.02, 0.16, 0.012, -0.015));
  head.put(ink, pipe([-0.15, 0.03, -0.04], [-0.166, 0.21, -0.062], 0.006));
  root.add(head.root);
  return root;
}

// HELIX GOLIATH: blindato d'assalto, ingobbito, tutto spalle. Maschera d'acciaio a teschio con
// l'arcata corrugata, la griglia sulla mascella e i rivetti: un occhio rosso acceso e l'altra
// metà del volto spaccata, col blu che traspare fra i frammenti e i cavi che scendono alla
// spalla. Pugni enormi, reattore ad anello sul petto e turbina con due scarichi sulla schiena.
function titan(halo: Halo) {
  const { root, put, pair } = rig(), { armor, ink, neon } = palette();
  const dark = std(0x1c1f27, 0.55, 0.35), mid = std(0x4a4f5b, 0.45, 0.4), steel = std(0x7d8490, 0.45, 0.4), bright = std(0xaab0bc, 0.4, 0.4), blue = lit(BLUE);
  const rivets = (pts: V[], r = 0.009) => pts.map((p) => ball(r, p, [1, 1, 1], 8));
  // Gambe corte e massicce: piede con le piastre sulle dita, schiniere, ginocchiera imbullonata.
  pair(armor, loft([0.13, 0, 0.03, 0.16, 0.26], [0.13, 0.085, 0.01, 0.14, 0.17]),
    hull([[0.06, 0.3, 0.085], [0.2, 0.3, 0.085], [0.05, 0.39, 0.095], [0.21, 0.39, 0.095], [0.07, 0.3, 0.105], [0.19, 0.3, 0.105], [0.065, 0.39, 0.115], [0.195, 0.39, 0.115]]));
  pair(dark, loft([0.13, 0.07, 0.005, 0.12, 0.13], [0.13, 0.25, 0.01, 0.155, 0.165]), loft([0.13, 0.24, 0.01, 0.15, 0.16], [0.125, 0.4, 0, 0.18, 0.19]), drum(0.02, 0.012, [0.13, 0.275, 0.147], 'z'));
  pair(mid, hull([[0.065, 0.09, 0.03], [0.195, 0.09, 0.03], [0.075, 0.09, 0.085], [0.185, 0.09, 0.085], [0.055, 0.24, 0.03], [0.205, 0.24, 0.03], [0.06, 0.24, 0.105], [0.2, 0.24, 0.105], [0.13, 0.17, 0.115]]),
    hull([[0.07, 0.23, 0.09], [0.19, 0.23, 0.09], [0.13, 0.21, 0.13], [0.085, 0.31, 0.095], [0.175, 0.31, 0.095], [0.13, 0.335, 0.105], [0.13, 0.275, 0.145], [0.07, 0.26, 0.04], [0.19, 0.26, 0.04]]));
  pair(steel, hull([[0.055, 0, 0.12], [0.205, 0, 0.12], [0.07, 0, 0.19], [0.19, 0, 0.19], [0.06, 0.06, 0.115], [0.2, 0.06, 0.115], [0.08, 0.04, 0.18], [0.18, 0.04, 0.18]]));
  pair(neon, rod([0.08, 0.345, 0.113], [0.18, 0.345, 0.113], 0.01));
  // Bacino con paraventre e fiancali, ventre a piastre coi pistoni ai lati.
  put(dark, hull(sym([[0.2, 0.44, 0.1], [0.2, 0.44, -0.11], [0.12, 0.34, 0.08], [0.12, 0.34, -0.09], [0, 0.32, 0.085], [0, 0.32, -0.075]])), loft([0, 0.43, 0, 0.3, 0.19], [0, 0.54, 0.01, 0.34, 0.22]));
  put(mid, hull(sym([[0.07, 0.45, 0.105], [0.05, 0.34, 0.11], [0, 0.31, 0.115], [0, 0.45, 0.125], [0.07, 0.45, 0.07], [0.05, 0.34, 0.07]])),
    hull(sym([[0.12, 0.5, 0.118], [0.11, 0.46, 0.108], [0, 0.455, 0.122], [0, 0.505, 0.132], [0.12, 0.5, 0.08], [0.11, 0.46, 0.08]])));
  pair(armor, hull([[0.12, 0.45, 0.1], [0.215, 0.45, 0.05], [0.22, 0.45, -0.08], [0.13, 0.34, 0.11], [0.24, 0.33, 0.055], [0.245, 0.33, -0.075], [0.12, 0.45, 0.06], [0.2, 0.45, -0.08], [0.14, 0.34, 0.07], [0.22, 0.33, -0.06]]));
  pair(bright, pipe([0.15, 0.43, 0.08], [0.19, 0.56, 0.11], 0.014));
  // Torace a botte con la gobba, pettorali rivettati e il reattore ad anello sotto lo sterno.
  put(armor, hull(sym([[0.21, 0.53, 0.1], [0.21, 0.53, -0.12], [0.31, 0.68, 0.13], [0.31, 0.68, -0.15], [0.28, 0.8, 0.08], [0.28, 0.8, -0.14], [0.1, 0.85, 0.06], [0.1, 0.87, -0.13], [0, 0.7, 0.185], [0, 0.56, 0.145], [0, 0.82, -0.18], [0, 0.6, -0.16]])));
  pair(mid, hull([[0.03, 0.75, 0.165], [0.25, 0.76, 0.115], [0.275, 0.64, 0.145], [0.03, 0.625, 0.19], [0.15, 0.69, 0.185], [0.03, 0.75, 0.1], [0.25, 0.76, 0.08], [0.275, 0.64, 0.1], [0.03, 0.625, 0.12]]));
  pair(bright, ...rivets([[0.23, 0.745, 0.124], [0.25, 0.655, 0.151], [0.05, 0.645, 0.187], [0.15, 0.64, 0.17]]));
  put(steel, drum(0.064, 0.03, [0, 0.578, 0.148], 'z'));
  put(ink, drum(0.05, 0.006, [0, 0.578, 0.164], 'z'));
  put(neon, hoop(0.043, 0.009, [0, 0.578, 0.167], 'z'), ball(0.016, [0, 0.578, 0.168]));
  const core = halo(RED, 0);
  core.position.set(0, 0.578, 0.19);
  core.scale.setScalar(0.3);
  root.add(core);
  // Schiena: turbina ad anello fra i due scarichi.
  put(steel, drum(0.078, 0.03, [0, 0.69, -0.168], 'z'));
  put(ink, drum(0.062, 0.006, [0, 0.69, -0.185], 'z'), drum(0.024, 0.016, [0, 0.69, -0.188], 'z'));
  put(neon, hoop(0.054, 0.01, [0, 0.69, -0.187], 'z'));
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    put(bright, rod([Math.cos(a) * 0.022, 0.69 + Math.sin(a) * 0.022, -0.19], [Math.cos(a) * 0.048, 0.69 + Math.sin(a) * 0.048, -0.19], 0.008));
  }
  pair(dark, pipe([0.12, 0.8, -0.14], [0.142, 0.98, -0.2], 0.036));
  pair(steel, pipe([0.139, 0.955, -0.192], [0.142, 0.98, -0.2], 0.043));
  pair(neon, pipe([0.142, 0.98, -0.2], [0.1425, 0.984, -0.2013], 0.027));
  // Collo taurino e spalle: macigno di corazza col bordo d'acciaio rivettato sopra una lama
  // bordata di rosso.
  put(dark, hull(sym([[0.1, 0.88, -0.1], [0.22, 0.82, -0.06], [0.22, 0.8, 0.05], [0.09, 0.8, 0.1], [0, 0.92, -0.08], [0, 0.78, 0.11], [0.08, 0.74, 0]])));
  pair(armor, hull([[0.19, 0.86, 0.08], [0.19, 0.88, -0.12], [0.29, 0.92, 0.03], [0.29, 0.925, -0.08], [0.42, 0.86, 0.07], [0.42, 0.87, -0.11], [0.445, 0.74, 0.1], [0.445, 0.74, -0.14], [0.23, 0.72, 0.13], [0.23, 0.72, -0.16]]),
    hull([[0.26, 0.72, 0.125], [0.26, 0.72, -0.155], [0.44, 0.7, 0.105], [0.44, 0.7, -0.135], [0.46, 0.6, 0.085], [0.46, 0.6, -0.115], [0.31, 0.6, 0.115], [0.31, 0.6, -0.145]]));
  pair(steel, hull([[0.4, 0.878, 0.078], [0.4, 0.888, -0.118], [0.45, 0.745, 0.108], [0.45, 0.745, -0.148], [0.428, 0.868, 0.073], [0.428, 0.878, -0.113], [0.462, 0.745, 0.103], [0.462, 0.745, -0.143]]));
  pair(bright, ...rivets([[0.437, 0.84, 0.05], [0.44, 0.848, -0.02], [0.437, 0.85, -0.09], [0.24, 0.905, 0.04], [0.24, 0.912, -0.09]], 0.011));
  pair(neon, rod([0.463, 0.602, 0.085], [0.463, 0.602, -0.115], 0.01), rod([0.3, 0.925, 0.028], [0.395, 0.884, 0.06], 0.009));
  // Braccia: omero con la piastra e il pistone, avambraccio che si allarga sul polso, pugno a blocco.
  const shoulder: V = [0.335, 0.72, -0.01], elbow: V = [0.385, 0.5, -0.02], wrist: V = [0.375, 0.3, 0.08];
  pair(dark, limb(shoulder, elbow, 0.14, 0.15, 0.12, 0.13),
    hull([[0.28, 0.13, 0.03], [0.47, 0.13, 0.03], [0.28, 0.13, 0.2], [0.47, 0.13, 0.2], [0.29, 0.27, 0.03], [0.46, 0.27, 0.03], [0.29, 0.26, 0.2], [0.46, 0.26, 0.2], [0.375, 0.1, 0.115]]));
  pair(armor, limb(elbow, wrist, 0.14, 0.15, 0.19, 0.2), limb([0.385, 0.68, -0.01], [0.425, 0.54, -0.015], 0.07, 0.13, 0.06, 0.11));
  pair(mid, gem(0.07, elbow));
  pair(steel, limb(mix(elbow, wrist, 0.78), mix(elbow, wrist, 0.96), 0.205, 0.215), ...[0, 1, 2, 3].map((i) => box(0.038, 0.05, 0.045, 0.305 + i * 0.047, 0.15, 0.2)));
  pair(bright, pipe([0.38, 0.62, -0.09], [0.385, 0.42, -0.105], 0.013));
  pair(neon, rod([0.461, 0.47, -0.01], [0.476, 0.33, 0.06], 0.01));
  // Cavi dalla metà spaccata del volto alla spalla sinistra: due di gomma, uno sotto tensione.
  put(ink, cable([[0.12, 0.85, 0.1], [0.185, 0.815, 0.1], [0.215, 0.8, 0.055]], 0.009), cable([[0.11, 0.76, 0.12], [0.17, 0.725, 0.165], [0.205, 0.7, 0.17]], 0.008));
  put(blue, cable([[0.12, 0.8, 0.17], [0.17, 0.775, 0.185], [0.225, 0.755, 0.14]], 0.005));

  const head = rig();
  head.root.position.set(0, 0.865, 0.125);
  head.root.rotation.x = -0.1;
  head.root.scale.setScalar(1.28);
  // Calotta a piastre con la costola centrale, arcata corrugata (più bassa verso il naso), setto.
  head.put(steel, hull(sym([[0.05, 0.125, 0.02], [0.05, 0.12, -0.06], [0.045, 0.1, 0.085], [0.105, 0.06, 0.03], [0.1, 0.05, -0.06], [0.105, -0.04, 0], [0.095, -0.05, -0.07], [0.05, 0.07, -0.115], [0.05, -0.04, -0.11],
    [0, 0.135, -0.01], [0, 0.105, 0.1], [0, 0.08, -0.125], [0, -0.06, -0.115], [0.085, -0.12, 0.02], [0.07, -0.13, -0.06], [0.07, -0.03, 0.085], [0.05, -0.11, 0.085]])),
    hull(sym([[0, 0.06, 0.118], [0.06, 0.085, 0.102], [0.115, 0.075, 0.045], [0, 0, 0.13], [0.05, 0.024, 0.124], [0.113, 0.042, 0.062], [0, 0.05, 0.06], [0.1, 0.05, 0]])),
    hull(sym([[0.014, 0.005, 0.13], [0.024, -0.06, 0.122], [0, -0.07, 0.14], [0, 0.005, 0.142], [0.014, 0.005, 0.1], [0.024, -0.06, 0.1]])),
    // Zigomo sano a destra; a sinistra è spaccato in tre frammenti, col blu che traspare nelle fessure.
    hull([[-0.03, -0.04, 0.12], [-0.1, -0.025, 0.08], [-0.112, -0.075, 0.05], [-0.085, -0.12, 0.072], [-0.04, -0.095, 0.114], [-0.04, -0.04, 0.08], [-0.1, -0.06, 0.03]]),
    hull([[0.03, -0.04, 0.12], [0.064, -0.033, 0.103], [0.054, -0.064, 0.111], [0.034, -0.07, 0.118], [0.035, -0.045, 0.095], [0.055, -0.045, 0.085]]),
    hull([[0.07, -0.03, 0.098], [0.1, -0.025, 0.08], [0.112, -0.075, 0.05], [0.09, -0.088, 0.07], [0.072, -0.055, 0.097], [0.09, -0.04, 0.05]]),
    hull([[0.04, -0.076, 0.116], [0.07, -0.068, 0.101], [0.085, -0.12, 0.072], [0.045, -0.1, 0.11], [0.05, -0.085, 0.09], [0.075, -0.1, 0.06]]),
    hull(sym([[0.05, -0.153, 0.1], [0, -0.158, 0.121], [0, -0.182, 0.11], [0.045, -0.174, 0.09], [0.04, -0.155, 0.07]])));
  head.put(mid, hull(sym([[0.022, 0.132, 0.03], [0.022, 0.128, -0.06], [0.02, 0.108, 0.095], [0.02, 0.09, -0.12], [0, 0.146, -0.01], [0, 0.116, 0.105], [0, 0.092, -0.132], [0.022, 0.05, 0]])),
    hull(sym([[0.066, -0.08, 0.108], [0.08, -0.155, 0.085], [0, -0.175, 0.108], [0, -0.08, 0.125], [0.078, -0.09, 0.04], [0.068, -0.165, 0.03]])));
  head.pair(mid, drum(0.022, 0.018, [0.108, 0, 0], 'x'));
  head.put(blue, hull([[0.04, -0.05, 0.1], [0.09, -0.035, 0.066], [0.098, -0.075, 0.042], [0.078, -0.105, 0.06], [0.045, -0.088, 0.096], [0.045, -0.045, 0.07], [0.09, -0.06, 0.03]]));
  // Orbite scure: occhio rosso acceso a destra, a sinistra solo un barlume blu.
  head.put(ink, hull(sym([[0.02, 0.012, 0.118], [0.09, 0.03, 0.09], [0.085, -0.03, 0.086], [0.025, -0.035, 0.114], [0.02, 0, 0.07], [0.085, 0, 0.05]])));
  head.put(neon, ball(0.022, [-0.052, -0.006, 0.104]));
  head.put(blue, ball(0.01, [0.052, -0.008, 0.104]));
  const glare = halo(RED, 0);
  glare.position.set(-0.052, -0.006, 0.135);
  glare.scale.setScalar(0.3);
  head.root.add(glare);
  // Griglia a sette barre sulla mascella.
  head.put(ink, hull(sym([[0.048, -0.09, 0.117], [0.05, -0.15, 0.101], [0, -0.156, 0.119], [0, -0.09, 0.13], [0.048, -0.09, 0.1], [0.05, -0.15, 0.085]])));
  for (let i = -3; i <= 3; i++) {
    const x = i * 0.014, z = 0.134 - Math.abs(x) * 0.3;
    head.put(bright, rod([x, -0.09, z], [x, -0.152, z - 0.011], 0.008));
  }
  // Rivetti e le crepe blu che scendono dalla fronte.
  head.put(bright, ...rivets([[-0.03, 0.045, 0.121], [0.03, 0.045, 0.121], [-0.088, 0.058, 0.082], [0.088, 0.058, 0.082], [-0.095, -0.04, 0.08], [-0.09, -0.105, 0.068], [-0.07, -0.1, 0.1], [0.07, -0.14, 0.09], [-0.07, 0.1, -0.02], [0.07, 0.1, -0.02]], 0.007));
  const crack: V[] = [[0.03, 0.132, 0], [0.04, 0.118, 0.045], [0.035, 0.104, 0.092], [0.05, 0.075, 0.108], [0.035, 0.045, 0.123], [0.055, 0.022, 0.127]];
  head.put(blue, ...crack.slice(1).map((p, i) => rod(crack[i], p, 0.005)), rod(crack[1], [0.07, 0.103, 0.03], 0.004), rod(crack[3], [0.085, 0.07, 0.086], 0.004));
  root.add(head.root);
  return root;
}

// Unità disponibili: costruttore e statura (il Custode cresce poi del 25% come ogni ÉLITE).
const UNITS: Record<string, [(halo: Halo) => THREE.Group, number]> = { hunter: [hunter, 1], sec: [sec, 1], elite: [elite, 1], titan: [titan, 1.35] };

export const hasFoe = (key: string) => key in UNITS;
// Modello di un nemico; `halo` è il bagliore di BoardMap3D, per gli occhi e i nuclei accesi.
export function buildFoe(key: string, halo: Halo) {
  const [build, scale] = UNITS[key];
  return bake(build(halo), scale);
}

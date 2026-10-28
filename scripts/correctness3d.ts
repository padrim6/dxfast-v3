/**
 * Rede de CORRETUDE geométrica 3D (não apenas consistência).
 *
 * A paridade 2D/3D/PDF prova que os três caminhos concordam entre si, mas NÃO
 * prova que a posição 3D do furo está correta: uma troca de uFace/nFace em
 * getProfileSectionGeometry passa pela paridade (os três leem a mesma fonte) e
 * mesmo assim coloca o furo FORA da parede.
 *
 * Referência independente: o `shape` (seção transversal) devolvido por
 * getProfileSectionGeometry é a geometria REAL que é extrudada para virar a
 * parede 3D. getFoldedPointTransform (o que está sob teste) projeta o furo do
 * plano desenvolvido para o 3D. Se o transform estiver certo, o ponto 3D do
 * furo cai SOBRE a seção (distância ~0). Uma troca de uFace/nFace afasta o furo
 * da seção e esta rede pega.
 *
 * Invariante (sem baseline): distância do furo à seção <= TOL para todo furo de
 * todo template dobrado, em várias amostras de parâmetros.
 */
import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { getFoldedPointTransform, getProfileSectionGeometry } from '../src/utils/foldedMeshBuilder';

const TOL_MM = 0.1; // furo deve cair sobre a parede; folga generosa vs qualquer troca de eixo

type P = { x: number; y: number };

function distPointToPoly(px: number, py: number, pts: P[]): number {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  if (inside) return 0;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[i].x, ay = pts[i].y, bx = pts[j].x, by = pts[j].y;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    let tt = ((px - ax) * dx + (py - ay) * dy) / L2;
    tt = Math.max(0, Math.min(1, tt));
    const qx = ax + tt * dx, qy = ay + tt * dy;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best) best = d;
  }
  return best;
}

function holeCenters(g: any): P[] {
  const out: P[] = [];
  for (const c of g.circles || []) out.push({ x: c.center.x, y: c.center.y });
  for (const p of g.innerPolylines || []) {
    const v = p.vertices || p.points || [];
    if (v.length) {
      let sx = 0, sy = 0;
      for (const pt of v) { sx += pt.x; sy += pt.y; }
      out.push({ x: sx / v.length, y: sy / v.length });
    }
  }
  return out;
}

// Mede a maior distância furo->seção. sabotage: recomputa o transform com nFace
// invertido (prova que a rede é sensível a erro de eixo de face).
function worstDistance(t: any, params: any, features: any, sabotage = false): { max: number; holes: number } | null {
  const g: any = generateGeometry(t, params, features);
  if (g.errors && g.errors.length) return null;
  const sec: any = getProfileSectionGeometry(g, t.id);
  if (!sec || !sec.shape) return null;
  const poly: P[] = sec.shape.getPoints(8).map((p: any) => ({ x: p.x, y: p.y }));
  const holes = holeCenters(g);
  if (!holes.length) return { max: 0, holes: 0 };
  const tk = Math.max(0.5, g.unfoldingMath?.thicknessMm ?? 3);
  let max = 0;
  for (const h of holes) {
    const tr: any = getFoldedPointTransform(g, t.id, h.x, h.y);
    let X = tr.x, Y = tr.y;
    if (sabotage) {
      const fd = sec.faces.find((f: any) => f.faceIndex === tr.faceIndex) || sec.faces[tr.faceIndex];
      if (fd) {
        X = fd.origem.x + tr.distFromFaceStartMm * fd.uFace.x + (tk / 2) * (-fd.nFace.x);
        Y = fd.origem.y + tr.distFromFaceStartMm * fd.uFace.y + (tk / 2) * (-fd.nFace.y);
      }
    }
    const d = distPointToPoly(X, Y, poly);
    if (d > max) max = d;
  }
  return { max, holes: holes.length };
}

// Configurações que produzem furos em cada template dobrado.
const CONFIGS: Record<string, Array<{ params?: any; features?: any }>> = {
  profile_u: [{}, { params: { bendAngle: 70 } }, { params: { bendAngle: 120 } }],
  profile_l: [{}, { params: { bendAngle: 100 } }],
  profile_z: [{ features: { faceHoles: true } }],
  profile_hat: [{ features: { faceHoles: true } }],
  gate_guide_u: [{}, { params: { holeQty: 3, holePitch: 40 } }, { params: { oblongHoles: 1, slotLength: 20 } }, { params: { symmetric: 0, baseA: 90, length: 150 } }],
  lambril_z: [{ params: { holesFixing: 1, holeQty: 3, holePitch: 200 } }, { params: { holesFixing: 1, holeFace: 2 } }],
  gate_weight_box: [{}, { params: { holesFixing: 1 } }, { params: { holesFixing: 1, fixingFace: 1, fixingOblong: 1, fixingSlotLength: 25 } }, { params: { squareSection: 1 } }],
  rufo_flashing: [{}, { params: { holeCount: 4 } }],
};

function withFeature(t: any, names: any): any {
  const f = JSON.parse(JSON.stringify(t.defaultFeatures));
  if (names) for (const k of Object.keys(names)) if (f[k]) f[k].enabled = !!names[k];
  return f;
}

let failures = 0;
let checked = 0;
let totalHoles = 0;
const rows: string[] = [];
let sabotageProof = { max: 0, caught: false };

for (const id of Object.keys(CONFIGS)) {
  const t: any = TEMPLATES.find((x: any) => x.id === id);
  if (!t) continue;
  let worst = 0;
  let holesSeen = 0;
  let sab = 0;
  for (const cfg of CONFIGS[id]) {
    const params = { ...t.defaultParams, ...(cfg.params || {}) };
    const features = withFeature(t, cfg.features);
    const r = worstDistance(t, params, features, false);
    if (!r) continue;
    checked++;
    holesSeen += r.holes;
    if (r.max > worst) worst = r.max;
    const rs = worstDistance(t, params, features, true);
    if (rs && rs.max > sab) sab = rs.max;
  }
  totalHoles += holesSeen;
  if (sab > sabotageProof.max) sabotageProof = { max: sab, caught: sab > TOL_MM };
  const ok = worst <= TOL_MM;
  if (!ok) failures++;
  rows.push(`  ${ok ? '✅' : '❌'} ${id.padEnd(16)} furos ${String(holesSeen).padStart(3)}  max desvio ${worst.toFixed(4)} mm  (sabotado ${sab.toFixed(2)} mm)`);
}

console.log('========================================================================');
console.log('  CORRETUDE GEOMÉTRICA 3D: furo deve cair sobre a parede renderizada');
console.log(`  Tolerância: ${TOL_MM} mm  |  referência independente: seção transversal (shape)`);
console.log('========================================================================');
for (const r of rows) console.log(r);
console.log('------------------------------------------------------------------------');
console.log(`  Templates verificados: ${checked} configs, ${totalHoles} furos no total.`);
console.log(`  Autocheck de sensibilidade (sabotagem de nFace): pior desvio ${sabotageProof.max.toFixed(2)} mm ` +
  `-> ${sabotageProof.caught ? 'seria PEGO pela rede' : 'NAO seria pego (rede fraca!)'}.`);

if (!sabotageProof.caught) {
  console.error('\n❌ [FALHA] A sabotagem de controle nao excedeu a tolerancia: a rede esta fraca demais.');
  process.exit(1);
}
if (failures > 0) {
  console.error(`\n❌ [FALHA] ${failures} template(s) com furo fora da parede (desvio > ${TOL_MM} mm).`);
  process.exit(1);
}
console.log(`\n🎉 [SUCCESS] Todos os furos caem sobre a parede 3D (desvio <= ${TOL_MM} mm) e a rede comprovou sensibilidade a troca de eixo.`);

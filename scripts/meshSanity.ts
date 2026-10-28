import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { createProfileShapeFromGeometry, addPolylineToPath } from '../src/utils/foldedMeshBuilder';
import { TemplateDefinition, GeometryResult } from '../src/types/cad';

class SeededRandom {
  private state: number;
  constructor(seed: number = 42) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }
  next(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }
  range(min: number, max: number, step?: number): number {
    const raw = min + this.next() * (max - min);
    if (!step) return raw;
    const stepped = Math.round((raw - min) / step) * step + min;
    return Math.max(min, Math.min(max, stepped));
  }
}

/**
 * Robust 2D segment intersection test.
 * Returns true if open segment (p1, p2) intersects open segment (p3, p4),
 * or if they have collinear overlapping interiors.
 */
export function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
  eps = 1e-5
): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;

  const cross = d1x * d2y - d1y * d2x;
  const dx = p3.x - p1.x;
  const dy = p3.y - p1.y;

  if (Math.abs(cross) < eps) {
    // Parallel or collinear
    const cross1 = dx * d1y - dy * d1x;
    if (Math.abs(cross1) > eps) return false;
    const dot1 = d1x * d1x + d1y * d1y;
    if (dot1 < eps) return false;
    const t0 = (dx * d1x + dy * d1y) / dot1;
    const t1 = t0 + (d2x * d1x + d2y * d1y) / dot1;
    return Math.max(t0, t1) > eps && Math.min(t0, t1) < 1 - eps;
  }

  const u = (dx * d2y - dy * d2x) / cross;
  const v = (dx * d1y - dy * d1x) / cross;

  return u > eps && u < 1 - eps && v > eps && v < 1 - eps;
}

/**
 * Counts self-intersections of a polygonal closed contour.
 */
export function countContourSelfIntersections(points: { x: number; y: number }[]): number {
  const pts = [...points];
  if (pts.length > 2 && Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) < 1e-4) {
    pts.pop();
  }
  const n = pts.length;
  let crossings = 0;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsIntersect(p1, p2, pts[j], pts[(j + 1) % n])) {
        crossings++;
      }
    }
  }
  return crossings;
}

/**
 * Computes exact signed volume of a 3D closed triangle mesh.
 */
export function computeMeshVolume(geometry: THREE.BufferGeometry): number {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  let totalVol = 0;
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();

  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      pA.set(pos.getX(index.getX(i)), pos.getY(index.getX(i)), pos.getZ(index.getX(i)));
      pB.set(pos.getX(index.getX(i + 1)), pos.getY(index.getX(i + 1)), pos.getZ(index.getX(i + 1)));
      pC.set(pos.getX(index.getX(i + 2)), pos.getY(index.getX(i + 2)), pos.getZ(index.getX(i + 2)));
      totalVol += pA.dot(pB.clone().cross(pC)) / 6.0;
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      pA.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      pB.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      pC.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      totalVol += pA.dot(pB.clone().cross(pC)) / 6.0;
    }
  }
  return totalVol;
}

export interface TemplateSanityResult {
  templateId: string;
  combinations: number;
  totalCrossings: number;
  negativeAreaCount: number;
  avgRatio: number;
  direction: 'CCW' | 'CW' | 'MIXED';
  nonFiniteCoords: number;
  degenerateTriangles: number;
  badVolumeCount: number;
}

export function runMeshSanitySuite(runsPerTemplate: number = 400): {
  results: Record<string, TemplateSanityResult>;
  totalCombinations: number;
  totalCrossings: number;
  totalNegativeAreas: number;
  totalDegenTriangles: number;
  totalBadVolumes: number;
} {
  const rng = new SeededRandom(42);
  const results: Record<string, TemplateSanityResult> = {};
  let totalCombinations = 0;
  let totalCrossings = 0;
  let totalNegativeAreas = 0;
  let totalDegenTriangles = 0;
  let totalBadVolumes = 0;

  for (const template of TEMPLATES) {
    const isBent = template.category === 'bent_profile';
    const tmplRes: TemplateSanityResult = {
      templateId: template.id,
      combinations: runsPerTemplate,
      totalCrossings: 0,
      negativeAreaCount: 0,
      avgRatio: 0,
      direction: 'CCW',
      nonFiniteCoords: 0,
      degenerateTriangles: 0,
      badVolumeCount: 0,
    };

    let posAreaCount = 0;
    let negAreaCount = 0;
    let ratioSum = 0;

    for (let r = 0; r < runsPerTemplate; r++) {
      totalCombinations++;

      // Use default params on first iteration, randomized on rest
      const params: Record<string, number> = {};
      if (r === 0) {
        Object.assign(params, template.defaultParams);
      } else {
        for (const [k, v] of Object.entries(template.baseParams)) {
          params[k] = rng.range(v.min, v.max, v.step);
        }
      }

      const geom = generateGeometry(template, params, template.defaultFeatures);
      const t = Math.max(0.5, geom.unfoldingMath?.thicknessMm || (geom.metrics as any)?.thickness || 3.0);
      const depth = isBent ? Math.max(20, geom.metrics.blankHeightMm || 300) : t;

      let shape: THREE.Shape;
      if (isBent) {
        shape = createProfileShapeFromGeometry(geom, template.id);
      } else {
        shape = new THREE.Shape();
        if (geom.outerPolylines && geom.outerPolylines.length > 0) {
          addPolylineToPath(geom.outerPolylines[0], shape);
        }
        for (const poly of geom.innerPolylines || []) {
          const hPath = new THREE.Path();
          addPolylineToPath(poly, hPath);
          shape.holes.push(hPath);
        }
        for (const circ of geom.circles || []) {
          if (circ.radius > 0.2) {
            const hPath = new THREE.Path();
            hPath.absarc(circ.center.x, circ.center.y, circ.radius, 0, Math.PI * 2, true);
            shape.holes.push(hPath);
          }
        }
      }

      // 1. Sample 2D contour and check for self-intersections
      const pts = shape.getPoints(30);
      const crossings = countContourSelfIntersections(pts);
      tmplRes.totalCrossings += crossings;

      // 2. Section Area & Winding
      const area = THREE.ShapeUtils.area(pts);
      if (area <= 0) {
        negAreaCount++;
        tmplRes.negativeAreaCount++;
      } else {
        posAreaCount++;
      }

      const expArea = isBent
        ? (geom.metrics.blankWidthMm || geom.boundingBox.width) * t
        : geom.metrics.grossAreaMm2;
      const ratio = area / Math.max(1, expArea);
      ratioSum += ratio;

      // 3. Extrusion & Mesh Sanity
      const extrudeGeo = new THREE.ExtrudeGeometry(shape, { steps: 1, depth, bevelEnabled: false });
      const pos = extrudeGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
          tmplRes.nonFiniteCoords++;
        }
      }

      const idx = extrudeGeo.index;
      const pA = new THREE.Vector3();
      const pB = new THREE.Vector3();
      const pC = new THREE.Vector3();
      const triCount = idx ? idx.count / 3 : pos.count / 3;

      for (let i = 0; i < triCount; i++) {
        const i0 = idx ? idx.getX(i * 3) : i * 3;
        const i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
        const i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;

        pA.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        pB.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        pC.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

        const triArea = 0.5 * pB.sub(pA).cross(pC.sub(pA)).length();
        if (triArea < 1e-8) {
          tmplRes.degenerateTriangles++;
        }
      }

      // 4. Volume check vs expected volume
      const meshVol = computeMeshVolume(extrudeGeo);
      const expVol = isBent ? Math.abs(area) * depth : (geom.metrics.netAreaMm2 || geom.metrics.grossAreaMm2) * t;
      const volDiff = Math.abs(Math.abs(meshVol) - expVol) / Math.max(1, expVol);
      const maxAllowedVolDiff = isBent ? 0.05 : 0.25;
      if (volDiff > maxAllowedVolDiff) {
        tmplRes.badVolumeCount++;
      }

      extrudeGeo.dispose();
    }

    tmplRes.avgRatio = ratioSum / runsPerTemplate;
    if (posAreaCount > 0 && negAreaCount === 0) tmplRes.direction = 'CCW';
    else if (negAreaCount > 0 && posAreaCount === 0) tmplRes.direction = 'CW';
    else tmplRes.direction = 'MIXED';

    results[template.id] = tmplRes;
    totalCrossings += tmplRes.totalCrossings;
    totalNegativeAreas += tmplRes.negativeAreaCount;
    totalDegenTriangles += tmplRes.degenerateTriangles;
    totalBadVolumes += tmplRes.badVolumeCount;
  }

  return {
    results,
    totalCombinations,
    totalCrossings,
    totalNegativeAreas,
    totalDegenTriangles,
    totalBadVolumes,
  };
}

function main() {
  const args = process.argv.slice(2);
  const recordMode = args.includes('--record') || args.includes('--record-baseline');
  const baselinePath = path.join(process.cwd(), 'tests', 'mesh_sanity_baseline.json');

  console.log('========================================================================================================');
  console.log('  DXFAST 3D MESH SANITY & CROSS-SECTION SUITE');
  console.log('  Testing 12 Templates x 400 parameter variations = 4,800 checks');
  console.log('========================================================================================================\n');

  const { results, totalCombinations, totalCrossings, totalNegativeAreas, totalDegenTriangles, totalBadVolumes } =
    runMeshSanitySuite(400);

  console.log('TEMPLATE ID       | COMBOS | CRUZAMENTOS | ÁREA NEG | TRIS DEGEN | SENTIDO | STATUS');
  console.log('--------------------------------------------------------------------------------------');
  for (const [id, r] of Object.entries(results)) {
    const isPass =
      r.totalCrossings === 0 &&
      r.negativeAreaCount === 0 &&
      r.degenerateTriangles === 0;
    const status = isPass ? ' PASS ' : ' FAIL ';
    console.log(
      `${id.padEnd(17)} | ` +
      `${r.combinations.toString().padStart(6)} | ` +
      `${r.totalCrossings.toString().padStart(11)} | ` +
      `${r.negativeAreaCount.toString().padStart(8)} | ` +
      `${r.degenerateTriangles.toString().padStart(10)} | ` +
      `${r.direction.padStart(7)} |` +
      status
    );
  }
  console.log('--------------------------------------------------------------------------------------');
  console.log(`TOTALS: Combinações=${totalCombinations} | Cruzamentos=${totalCrossings} | Áreas Neg=${totalNegativeAreas} | Degenerados=${totalDegenTriangles}\n`);

  const currentData = {
    totalCombinations,
    totalCrossings,
    totalNegativeAreas,
    totalDegenTriangles,
    totalBadVolumes,
    results,
    timestamp: new Date().toISOString(),
  };

  if (recordMode || !fs.existsSync(baselinePath)) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(currentData, null, 2), 'utf-8');
    console.log(`📁 [BASELINE REGISTRADA] Linha de base salva em ${baselinePath}`);
    return;
  }

  // Check against baseline or strict criteria
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  console.log(`📁 [BASELINE COMPARADA] Linha de base: ${baseline.totalCrossings} cruzamentos, ${baseline.totalNegativeAreas} áreas negativas.`);

  let hasRegression = false;
  if (totalCrossings > baseline.totalCrossings) {
    console.error(`❌ [FALHA] Cruzamentos aumentaram de ${baseline.totalCrossings} para ${totalCrossings}!`);
    hasRegression = true;
  }
  if (totalNegativeAreas > baseline.totalNegativeAreas) {
    console.error(`❌ [FALHA] Áreas negativas aumentaram de ${baseline.totalNegativeAreas} para ${totalNegativeAreas}!`);
    hasRegression = true;
  }
  if (totalDegenTriangles > baseline.totalDegenTriangles) {
    console.error(`❌ [FALHA] Triângulos degenerados aumentaram de ${baseline.totalDegenTriangles} para ${totalDegenTriangles}!`);
    hasRegression = true;
  }

  if (totalCrossings > 0 || totalNegativeAreas > 0 || totalDegenTriangles > 0) {
    console.error(`❌ [FALHA ESTRITA] Detectados problemas geométricos na malha (cruzamentos: ${totalCrossings}, áreas negativas: ${totalNegativeAreas}, degenerados: ${totalDegenTriangles})!`);
    hasRegression = true;
  }

  if (hasRegression) {
    process.exit(1);
  }

  if (baseline.totalCrossings === 0 && totalCrossings === 0 && totalNegativeAreas === 0) {
    console.log('🎉 [SUCESSO ESTRITO] 0 autocruzamentos, 100% áreas positivas e coerentes, 0 triângulos degenerados!');
  } else {
    console.log('✅ [BASELINE OK] Sanidade da malha dentro dos limites da linha de base registrada.');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

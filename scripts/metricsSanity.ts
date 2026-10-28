import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { LWPolyline, CircleElement, FeatureId, FeatureState } from '../src/types/cad';
import { resolveThickness } from '../src/engine/helpers';

// Steel density constant (7.85 g/cm³ = 7.85e-6 kg/mm³)
export const STEEL_DENSITY_KG_MM3 = 7.85e-6;

class SeededRandom {
  private seed: number;
  constructor(seed: number = 42) {
    this.seed = seed % 233280;
    if (this.seed <= 0) this.seed += 233279;
  }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  range(min: number, max: number, step?: number): number {
    const raw = min + this.next() * (max - min);
    if (step && step > 0) {
      const stepped = Math.round((raw - min) / step) * step + min;
      return Math.min(max, Math.max(min, stepped));
    }
    return Number(raw.toFixed(4));
  }
  boolean(prob: number = 0.5): boolean {
    return this.next() < prob;
  }
}

/**
 * Calculates polyline length by summing straight chords and curved circular arcs
 * exactly using arc radius and sweep angle (DIN / CAD exact geometry).
 */
export function calculatePolylinePerimeter(poly: LWPolyline): number {
  const verts = poly.vertices;
  if (!verts || verts.length < 2) return 0;
  let totalLength = 0;
  const n = verts.length;
  const count = poly.isClosed ? n : n - 1;

  for (let i = 0; i < count; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    const dx = v2.x - v1.x;
    const dy = v2.y - v1.y;
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-7) continue;

    const bulge = v1.bulge || 0;
    if (Math.abs(bulge) < 1e-6) {
      totalLength += chord;
    } else {
      const theta = 4 * Math.atan(Math.abs(bulge));
      const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
      totalLength += radius * theta;
    }
  }

  return totalLength;
}

/**
 * Samples vertices of a polyline into consecutive ordered 2D points,
 * sampling curved arcs with at least 200 segments per arc.
 */
export function samplePolylineVertices(poly: LWPolyline, minSegmentsPerArc: number = 200): { x: number; y: number }[] {
  const verts = poly.vertices;
  if (!verts || verts.length === 0) return [];
  const points: { x: number; y: number }[] = [];
  const n = verts.length;
  const count = poly.isClosed ? n : n - 1;

  for (let i = 0; i < count; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    const bulge = v1.bulge || 0;

    if (Math.abs(bulge) < 1e-6) {
      points.push({ x: v1.x, y: v1.y });
    } else {
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const chord = Math.hypot(dx, dy);
      if (chord < 1e-7) {
        points.push({ x: v1.x, y: v1.y });
        continue;
      }

      const theta = 4 * Math.atan(bulge);
      const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
      const h = (chord * (1 - bulge * bulge)) / (4 * bulge);

      const midX = (v1.x + v2.x) / 2;
      const midY = (v1.y + v2.y) / 2;
      const perpX = -dy / chord;
      const perpY = dx / chord;

      const cx = midX + h * perpX;
      const cy = midY + h * perpY;
      const startAngle = Math.atan2(v1.y - cy, v1.x - cx);

      const segments = Math.max(200, minSegmentsPerArc);
      for (let s = 0; s < segments; s++) {
        const t = s / segments;
        const angle = startAngle + t * theta;
        points.push({
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
        });
      }
    }
  }

  return points;
}

/**
 * Calculates polygon area using the Shoelace formula on sampled vertices.
 */
export function calculateSampledPolylineArea(poly: LWPolyline, minSegmentsPerArc: number = 200): number {
  const pts = samplePolylineVertices(poly, minSegmentsPerArc);
  const n = pts.length;
  if (n < 3) return 0;
  let areaSum = 0;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    areaSum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(areaSum) / 2;
}

export interface MetricCheckResult {
  templateId: string;
  totalSamples: number;
  validSamples: number;
  grossAreaDivergences: number;
  netAreaDivergences: number;
  cutLengthDivergences: number;
  massDivergences: number;
  maxGrossDeviationPct: number;
  maxNetDeviationPct: number;
  maxCutLengthDeviationPct: number;
  worstCaseDescription?: string;
}

export function runMetricsSanitySuite(samplesPerTemplate: number = 400, strictMode: boolean = true) {
  console.log('==================================================================================');
  console.log('  DXFAST METRICS SANITY & ACCURACY SUITE (PROMPT M1)');
  console.log(`  Evaluating 12 Templates x ${samplesPerTemplate} deterministic combinations`);
  console.log('  Tolerance threshold: 0.1% (relative divergence)');
  console.log('==================================================================================\n');

  const rng = new SeededRandom(42);
  const results: MetricCheckResult[] = [];
  let grandTotalValid = 0;
  let grandTotalDivergences = 0;
  const tolerance = 0.001; // 0.1%

  for (const template of TEMPLATES) {
    const res: MetricCheckResult = {
      templateId: template.id,
      totalSamples: samplesPerTemplate,
      validSamples: 0,
      grossAreaDivergences: 0,
      netAreaDivergences: 0,
      cutLengthDivergences: 0,
      massDivergences: 0,
      maxGrossDeviationPct: 0,
      maxNetDeviationPct: 0,
      maxCutLengthDeviationPct: 0,
    };

    let worstDev = 0;

    for (let s = 0; s < samplesPerTemplate; s++) {
      // Generate deterministic parameter combinations
      const params: Record<string, number> = {};
      for (const [key, pDef] of Object.entries(template.baseParams)) {
        params[key] = rng.range(pDef.min, pDef.max, pDef.step);
      }

      // Randomize feature toggles
      const features: Record<FeatureId, FeatureState> = { ...template.defaultFeatures };
      for (const [fId, defFeat] of Object.entries(template.defaultFeatures)) {
        features[fId as FeatureId] = {
          ...defFeat,
          params: { ...(defFeat.params || {}) },
        };
      }
      for (const featId of template.compatibleFeatures) {
        if (features[featId]) {
          features[featId] = {
            ...features[featId],
            enabled: rng.boolean(0.5),
          };
        }
      }

      const geom = generateGeometry(template, params, features);
      if (geom.errors && geom.errors.length > 0) {
        continue;
      }

      res.validSamples++;
      grandTotalValid++;

      const thickness = resolveThickness(template, params);

      // 1. Calculate Real Gross Area (from outer polyline)
      let realGrossArea = 0;
      for (const poly of geom.outerPolylines) {
        realGrossArea += calculateSampledPolylineArea(poly, 200);
      }

      // 2. Calculate Real Inner Features Area
      let realInnerArea = 0;
      for (const poly of geom.innerPolylines) {
        realInnerArea += calculateSampledPolylineArea(poly, 200);
      }
      for (const circ of geom.circles) {
        realInnerArea += Math.PI * circ.radius * circ.radius;
      }

      // 3. Real Net Area
      const realNetArea = Math.max(0, realGrossArea - realInnerArea);

      // 4. Real Perimeters & Cut Length
      let realOuterPerimeter = 0;
      for (const poly of geom.outerPolylines) {
        realOuterPerimeter += calculatePolylinePerimeter(poly);
      }
      let realInnerPerimeter = 0;
      for (const poly of geom.innerPolylines) {
        realInnerPerimeter += calculatePolylinePerimeter(poly);
      }
      for (const circ of geom.circles) {
        realInnerPerimeter += 2 * Math.PI * circ.radius;
      }
      const realCutLength = realOuterPerimeter + realInnerPerimeter;

      // 5. Real Mass
      const realMassKg = (realNetArea * thickness * STEEL_DENSITY_KG_MM3);
      const declaredMassKg = (geom.metrics.netAreaMm2 * thickness * STEEL_DENSITY_KG_MM3);

      // Comparisons against declared metrics
      const declGrossArea = geom.metrics.grossAreaMm2;
      const declNetArea = geom.metrics.netAreaMm2;
      const declCutLength = geom.metrics.cutLengthMm;

      const grossDev = Math.abs(declGrossArea - realGrossArea) / Math.max(1, realGrossArea);
      const netDev = Math.abs(declNetArea - realNetArea) / Math.max(1, realNetArea);
      const cutDev = Math.abs(declCutLength - realCutLength) / Math.max(1, realCutLength);
      const massDev = Math.abs(declaredMassKg - realMassKg) / Math.max(1e-6, realMassKg);

      const grossDevPct = grossDev * 100;
      const netDevPct = netDev * 100;
      const cutDevPct = cutDev * 100;

      if (grossDevPct > res.maxGrossDeviationPct) res.maxGrossDeviationPct = grossDevPct;
      if (netDevPct > res.maxNetDeviationPct) res.maxNetDeviationPct = netDevPct;
      if (cutDevPct > res.maxCutLengthDeviationPct) res.maxCutLengthDeviationPct = cutDevPct;

      let hasDivergence = false;
      if (grossDev > tolerance) {
        res.grossAreaDivergences++;
        hasDivergence = true;
      }
      if (netDev > tolerance) {
        res.netAreaDivergences++;
        hasDivergence = true;
      }
      if (cutDev > tolerance) {
        res.cutLengthDivergences++;
        hasDivergence = true;
      }
      if (massDev > tolerance) {
        res.massDivergences++;
      }

      if (hasDivergence) {
        grandTotalDivergences++;
        const currentWorst = Math.max(grossDevPct, netDevPct, cutDevPct);
        if (currentWorst > worstDev) {
          worstDev = currentWorst;
          res.worstCaseDescription = `Run #${s}: Decl Gross=${declGrossArea.toFixed(1)}, Real Gross=${realGrossArea.toFixed(1)} (dev ${grossDevPct.toFixed(2)}%) | Decl Net=${declNetArea.toFixed(1)}, Real Net=${realNetArea.toFixed(1)} (dev ${netDevPct.toFixed(2)}%) | Decl Cut=${declCutLength.toFixed(1)}, Real Cut=${realCutLength.toFixed(1)} (dev ${cutDevPct.toFixed(2)}%)`;
        }
      }
    }

    results.push(res);
  }

  // Print results
  console.log('-------------------------------------------------------------------------------------------------------------------------');
  console.log('TEMPLATE ID           | VALID | GROSS_DIV | NET_DIV | CUT_DIV | MASS_DIV | MAX_GROSS_% | MAX_NET_% | MAX_CUT_% | STATUS');
  console.log('-------------------------------------------------------------------------------------------------------------------------');

  for (const r of results) {
    const totalDiv = r.grossAreaDivergences + r.netAreaDivergences + r.cutLengthDivergences;
    const status = totalDiv === 0 ? 'PASS ' : 'FAIL ';
    console.log(
      `${r.templateId.padEnd(21)} | ` +
      `${r.validSamples.toString().padStart(5)} | ` +
      `${r.grossAreaDivergences.toString().padStart(9)} | ` +
      `${r.netAreaDivergences.toString().padStart(7)} | ` +
      `${r.cutLengthDivergences.toString().padStart(7)} | ` +
      `${r.massDivergences.toString().padStart(8)} | ` +
      `${r.maxGrossDeviationPct.toFixed(3).padStart(10)}% | ` +
      `${r.maxNetDeviationPct.toFixed(3).padStart(8)}% | ` +
      `${r.maxCutLengthDeviationPct.toFixed(3).padStart(8)}% | ` +
      `${status}`
    );
  }
  console.log('-------------------------------------------------------------------------------------------------------------------------');
  console.log(`TOTALS: Valid Pieces=${grandTotalValid} | Total Metric Divergences (>0.1%)=${grandTotalDivergences}`);

  const worstCases = results.filter((r) => r.worstCaseDescription);
  if (worstCases.length > 0) {
    console.log('\n--- DETALHE DOS TEMPLATES COM DIVERGÊNCIA NA BASELINE ---');
    for (const wc of worstCases) {
      console.log(`[${wc.templateId}] ${wc.worstCaseDescription}`);
    }
  }

  if (strictMode && grandTotalDivergences > 0) {
    console.error(`\n❌ [STRICT CHECK FAILED] Encontradas ${grandTotalDivergences} divergências métricas acima de 0.1%!`);
    process.exit(1);
  } else if (grandTotalDivergences === 0) {
    console.log('\n✅ [METRICS OK] Todas as métricas (área bruta, líquida, perímetro e massa) conferem com a geometria real (<0.1%)!');
  }

  return { results, grandTotalValid, grandTotalDivergences };
}

// Run suite: strict mode is default; permissive mode must be explicitly requested via --permissive
const isPermissive = process.argv.includes('--permissive') || process.env.PERMISSIVE_METRICS === 'true';
const isStrict = !isPermissive;
runMetricsSanitySuite(400, isStrict);

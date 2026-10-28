import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { generateDxfR2000 } from '../src/engine/dxfExporter';
import { LWPolyline, CircleElement, Point2D, FeatureState, FeatureId } from '../src/types/cad';
import { measureBoundingBox } from '../src/utils/geometryMeasure';

interface TestResult {
  templateId: string;
  totalRuns: number;
  exceptions: number;
  dxfCorruptions: number;
  holesCrossingContour: number;
  holesOverlapping: number;
  innerOutsideOuter: number;
  selfIntersectingOuter: number;
  invalidArea: number;
  bboxDivergence: number;
  totalInvalid: number;
  unblockedInvalid: number;
}

// Pseudo-random deterministic generator for repeatable fuzzer runs
class SeededRandom {
  private seed: number;
  constructor(seed: number = 42) {
    this.seed = seed;
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
    return raw;
  }
  boolean(prob: number = 0.5): boolean {
    return this.next() < prob;
  }
}

/**
 * Samples vertices of a polyline, including arcs defined by bulge factor
 */
function samplePolyline(poly: LWPolyline, segmentsPerArc: number = 32): Point2D[] {
  const verts = poly.vertices;
  if (!verts || verts.length === 0) return [];
  const points: Point2D[] = [];
  const n = verts.length;
  const count = poly.isClosed ? n : n - 1;

  for (let i = 0; i < count; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    points.push({ x: v1.x, y: v1.y });

    const bulge = v1.bulge || 0;
    if (Math.abs(bulge) > 1e-6) {
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const chord = Math.hypot(dx, dy);
      if (chord > 1e-6) {
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

        for (let s = 1; s < segmentsPerArc; s++) {
          const t = s / segmentsPerArc;
          const angle = startAngle + t * theta;
          points.push({
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
          });
        }
      }
    }
  }

  return points;
}

/**
 * Point-in-polygon test (ray casting algorithm)
 */
function isPointInPolygon(p: Point2D, polygon: Point2D[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y))
        && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes polygon area using shoelace formula
 */
function polygonArea(points: Point2D[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Checks if polygon is strictly convex
 */
function isPolygonConvex(points: Point2D[]): boolean {
  const n = points.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);
    if (Math.abs(cross) > 1e-7) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 && sign === -1) || (cross < 0 && sign === 1)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Line segment intersection test
 */
function doSegmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  function ccw(a: Point2D, b: Point2D, c: Point2D): number {
    return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  }
  const ccw1 = ccw(p1, p3, p4);
  const ccw2 = ccw(p2, p3, p4);
  const ccw3 = ccw(p1, p2, p3);
  const ccw4 = ccw(p1, p2, p4);

  return ((ccw1 > 0 && ccw2 < 0) || (ccw1 < 0 && ccw2 > 0)) &&
         ((ccw3 > 0 && ccw4 < 0) || (ccw3 < 0 && ccw4 > 0));
}

/**
 * Checks if a sampled polygon self-intersects
 */
function isSelfIntersecting(points: Point2D[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if ((j + 1) % n === i) continue; // adjacent edge
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (doSegmentsIntersect(a1, a2, b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Tests if circle crosses or lies outside the outer polygon
 */
function isCircleCrossingOuter(center: Point2D, radius: number, outerPoly: Point2D[]): boolean {
  if (radius <= 0) return false;
  // Test center
  if (!isPointInPolygon(center, outerPoly)) return true;

  // Test 12 points on circumference
  for (let k = 0; k < 12; k++) {
    const angle = (2 * Math.PI * k) / 12;
    const pt: Point2D = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
    if (!isPointInPolygon(pt, outerPoly)) {
      return true;
    }
  }
  return false;
}

async function runFuzzer() {
  const SAMPLES_PER_TEMPLATE = 500;
  const rng = new SeededRandom(12345);
  const expectedCount = TEMPLATES.length;
  let processedTemplatesCount = 0;

  console.log(`\n========================================================================`);
  console.log(`  DXFAST INDUSTRIAL ENGINE FUZZER & REGRESSION SUITE`);
  console.log(`  Target: ${expectedCount} Templates x ${SAMPLES_PER_TEMPLATE} runs = ${expectedCount * SAMPLES_PER_TEMPLATE} parameter variations`);
  console.log(`========================================================================\n`);

  const results: TestResult[] = [];
  let grandTotalRuns = 0;
  let grandTotalInvalid = 0;
  let grandTotalUnblocked = 0;

  for (const template of TEMPLATES) {
    processedTemplatesCount++;
    const res: TestResult = {
      templateId: template.id,
      totalRuns: 0,
      exceptions: 0,
      dxfCorruptions: 0,
      holesCrossingContour: 0,
      holesOverlapping: 0,
      innerOutsideOuter: 0,
      selfIntersectingOuter: 0,
      invalidArea: 0,
      bboxDivergence: 0,
      totalInvalid: 0,
      unblockedInvalid: 0,
    };

    for (let r = 0; r < SAMPLES_PER_TEMPLATE; r++) {
      res.totalRuns++;
      grandTotalRuns++;

      // 1. Generate randomized parameters within baseParams min/max
      const randomParams: Record<string, number> = {};
      for (const [key, paramDef] of Object.entries(template.baseParams)) {
        randomParams[key] = rng.range(paramDef.min, paramDef.max, paramDef.step);
      }

      // 2. Randomize feature states
      const randomFeatures: Record<FeatureId, FeatureState> = { ...template.defaultFeatures };
      for (const featId of template.compatibleFeatures) {
        if (randomFeatures[featId]) {
          randomFeatures[featId] = {
            ...randomFeatures[featId],
            enabled: rng.boolean(0.5),
          };
        }
      }

      let isInvalid = false;
      let hasErrorBlock = false;

      try {
        const geometry = generateGeometry(template, randomParams, randomFeatures);

        hasErrorBlock = (geometry.errors && geometry.errors.length > 0);

        // Check A: DXF Generation & Text Integrity
        let dxfText = '';
        try {
          dxfText = generateDxfR2000(geometry);
          if (
            dxfText.includes('NaN') ||
            dxfText.includes('Infinity') ||
            dxfText.includes('undefined') ||
            dxfText.includes('null')
          ) {
            res.dxfCorruptions++;
            isInvalid = true;
          }
        } catch {
          res.dxfCorruptions++;
          isInvalid = true;
        }

        // Check B: Area validity
        const { netAreaMm2, grossAreaMm2 } = geometry.metrics;
        if (netAreaMm2 <= 0 || netAreaMm2 > grossAreaMm2 + 0.1) {
          res.invalidArea++;
          isInvalid = true;
        }

        // Check C: Bounding Box divergence
        const measuredBbox = measureBoundingBox(geometry);
        const declW = geometry.metrics.blankWidthMm;
        const declH = geometry.metrics.blankHeightMm;
        if (
          Math.abs(declW - measuredBbox.width) > 0.5 ||
          Math.abs(declH - measuredBbox.height) > 0.5
        ) {
          res.bboxDivergence++;
          // Note: In Phase 0 baseline, bbox divergence is measured as an inconsistency
        }

        // Check D: Sample outer contour for geometric analysis
        const outerPoly = geometry.outerPolylines[0] ? samplePolyline(geometry.outerPolylines[0], 24) : [];

        if (outerPoly.length >= 4) {
          if (isSelfIntersecting(outerPoly)) {
            res.selfIntersectingOuter++;
            isInvalid = true;
          }

          // Check E: Holes crossing outer contour
          for (const c of geometry.circles) {
            if (isCircleCrossingOuter(c.center, c.radius, outerPoly)) {
              res.holesCrossingContour++;
              isInvalid = true;
              break;
            }
          }

          // Check F: Holes overlapping each other
          const circles = geometry.circles;
          for (let i = 0; i < circles.length; i++) {
            for (let j = i + 1; j < circles.length; j++) {
              const dist = Math.hypot(circles[i].center.x - circles[j].center.x, circles[i].center.y - circles[j].center.y);
              if (dist < circles[i].radius + circles[j].radius - 0.1) {
                res.holesOverlapping++;
                isInvalid = true;
                break;
              }
            }
            if (isInvalid) break;
          }

          // Check G: Inner polylines outside outer contour
          for (const inPoly of geometry.innerPolylines) {
            const sampledIn = samplePolyline(inPoly, 16);
            for (const pt of sampledIn) {
              if (!isPointInPolygon(pt, outerPoly)) {
                res.innerOutsideOuter++;
                isInvalid = true;
                break;
              }
            }
            if (isInvalid) break;
          }

          // Check H: Oblong slot geometry precision and convexity
          for (const inPoly of geometry.innerPolylines) {
            const verts = inPoly.vertices;
            if (verts && verts.length === 4) {
              const bulgedVerts = verts.filter((v) => Math.abs(Math.abs(v.bulge || 0) - 1.0) < 1e-4);
              if (bulgedVerts.length === 2) {
                const sampledSlot = samplePolyline(inPoly, 64);
                let minX = Infinity,
                  maxX = -Infinity,
                  minY = Infinity,
                  maxY = -Infinity;
                for (const pt of sampledSlot) {
                  if (pt.x < minX) minX = pt.x;
                  if (pt.x > maxX) maxX = pt.x;
                  if (pt.y < minY) minY = pt.y;
                  if (pt.y > maxY) maxY = pt.y;
                }
                const spanW = maxX - minX;
                const spanH = maxY - minY;
                const L = Math.max(spanW, spanH);
                const d = Math.min(spanW, spanH);
                const expectedSlotArea = (L - d) * d + Math.PI * (d / 2) ** 2;
                const actualSlotArea = polygonArea(sampledSlot);
                const areaRelDiff = Math.abs(actualSlotArea - expectedSlotArea) / Math.max(1e-4, expectedSlotArea);
                const isConvex = isPolygonConvex(sampledSlot);

                if (areaRelDiff > 0.001 || !isConvex) {
                  res.dxfCorruptions++;
                  isInvalid = true;
                  break;
                }
              }
            }
          }
        }
      } catch {
        res.exceptions++;
        isInvalid = true;
      }

      if (isInvalid) {
        res.totalInvalid++;
        grandTotalInvalid++;
        if (!hasErrorBlock) {
          res.unblockedInvalid++;
          grandTotalUnblocked++;
        }
      }
    }

    results.push(res);
  }

  // Print results table
  console.log(`\n---------------------------------------------------------------------------------------------------------`);
  console.log(`TEMPLATE ID           | RUNS | EXCEPT | DXF_BAD | HOLE_CROSS | OVERLAP | INNER_OUT | INVALID | UNBLOCKED`);
  console.log(`---------------------------------------------------------------------------------------------------------`);

  for (const r of results) {
    const invalidPct = ((r.totalInvalid / r.totalRuns) * 100).toFixed(1);
    const unblockedPct = r.totalInvalid > 0 ? ((r.unblockedInvalid / r.totalInvalid) * 100).toFixed(1) : '0.0';
    console.log(
      `${r.templateId.padEnd(21)} | ` +
      `${r.totalRuns.toString().padStart(4)} | ` +
      `${r.exceptions.toString().padStart(6)} | ` +
      `${r.dxfCorruptions.toString().padStart(7)} | ` +
      `${r.holesCrossingContour.toString().padStart(10)} | ` +
      `${r.holesOverlapping.toString().padStart(7)} | ` +
      `${r.innerOutsideOuter.toString().padStart(9)} | ` +
      `${r.totalInvalid.toString().padStart(4)} (${invalidPct.padStart(4)}%) | ` +
      `${r.unblockedInvalid.toString().padStart(4)} (${unblockedPct.padStart(5)}%)`
    );
  }

  console.log(`---------------------------------------------------------------------------------------------------------`);
  const overallInvalidPct = ((grandTotalInvalid / grandTotalRuns) * 100).toFixed(2);
  const overallUnblockedPct = grandTotalInvalid > 0 ? ((grandTotalUnblocked / grandTotalInvalid) * 100).toFixed(2) : '0.0';

  console.log(`\n📊 FUZZER SUMMARY BASELINE:`);
  console.log(`   - Total Executed Runs:            ${grandTotalRuns}`);
  console.log(`   - Total Invalid Geometries:       ${grandTotalInvalid} (${overallInvalidPct}%)`);
  console.log(`   - Unblocked (Silent) Invalids:    ${grandTotalUnblocked} (${overallUnblockedPct}% of invalids delivered with errors.length === 0)`);
  console.log(`========================================================================\n`);

  if (processedTemplatesCount !== expectedCount) {
    console.error(`❌ [COUNT MISMATCH] Processed ${processedTemplatesCount} templates, expected ${expectedCount} from TEMPLATES.`);
    process.exit(1);
  }

  if (grandTotalUnblocked > 0) {
    console.error(`❌ [FUZZER FAILURE] ${grandTotalUnblocked} invalid geometries were silently unblocked (errors.length === 0)!`);
    process.exit(1);
  }

  const grandTotalExceptions = results.reduce((acc, r) => acc + r.exceptions, 0);
  const grandTotalCorruptions = results.reduce((acc, r) => acc + r.dxfCorruptions, 0);
  if (grandTotalExceptions > 0 || grandTotalCorruptions > 0) {
    console.error(`❌ [FUZZER FAILURE] Detected ${grandTotalExceptions} exceptions and ${grandTotalCorruptions} DXF corruptions!`);
    process.exit(1);
  }
}

runFuzzer();

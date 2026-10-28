import { LWPolyline, CircleElement } from '../types/cad';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface MeasuredMetrics {
  grossAreaMm2: number;
  netAreaMm2: number;
  outerPerimeterMm: number;
  innerPerimeterMm: number;
  totalPerimeterMm: number;
  cutLengthMm: number;
}

/**
 * Standard density of carbon and structural steel: 7.85 g/cm³ = 7.85e-6 kg/mm³.
 */
export const STEEL_DENSITY_KG_MM3 = 7.85e-6;

/**
 * Calculates mass in kg from surface area (mm²) and sheet thickness (mm).
 */
export function calculateSteelMassKg(areaMm2: number, thicknessMm: number): number {
  return areaMm2 * thicknessMm * STEEL_DENSITY_KG_MM3;
}

/**
 * Calculates the exact arc length or chord length for a polyline segment.
 */
export function calculateSegmentLength(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bulge: number = 0
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-7) return 0;
  if (Math.abs(bulge) < 1e-6) return chord;

  const theta = 4 * Math.atan(Math.abs(bulge));
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  return radius * theta;
}

/**
 * Calculates true polyline perimeter by summing straight chords and curved arcs.
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
    totalLength += calculateSegmentLength(v1.x, v1.y, v2.x, v2.y, v1.bulge || 0);
  }

  return totalLength;
}

/**
 * Samples vertices of a polyline into consecutive ordered 2D points,
 * sampling curved arcs with at least 200 segments per arc.
 */
export function samplePolylineVertices(
  poly: LWPolyline,
  minSegmentsPerArc: number = 200
): { x: number; y: number }[] {
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
export function calculatePolylineArea(
  poly: LWPolyline,
  minSegmentsPerArc: number = 200
): number {
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

/**
 * Measures the physical gross area, net area, cut lengths and perimeters directly
 * from the generated geometry (outer polylines, inner polylines, and circles).
 */
export function measureGeometry(geometry: {
  outerPolylines?: LWPolyline[];
  innerPolylines?: LWPolyline[];
  circles?: CircleElement[];
}): MeasuredMetrics {
  let grossAreaMm2 = 0;
  let innerAreaMm2 = 0;
  let outerPerimeterMm = 0;
  let innerPerimeterMm = 0;

  if (geometry.outerPolylines) {
    for (const poly of geometry.outerPolylines) {
      grossAreaMm2 += calculatePolylineArea(poly, 200);
      outerPerimeterMm += calculatePolylinePerimeter(poly);
    }
  }

  if (geometry.innerPolylines) {
    for (const poly of geometry.innerPolylines) {
      innerAreaMm2 += calculatePolylineArea(poly, 200);
      innerPerimeterMm += calculatePolylinePerimeter(poly);
    }
  }

  if (geometry.circles) {
    for (const circ of geometry.circles) {
      innerAreaMm2 += Math.PI * circ.radius * circ.radius;
      innerPerimeterMm += 2 * Math.PI * circ.radius;
    }
  }

  const netAreaMm2 = Math.max(0, grossAreaMm2 - innerAreaMm2);
  const totalPerimeterMm = outerPerimeterMm + innerPerimeterMm;
  const cutLengthMm = totalPerimeterMm;

  return {
    grossAreaMm2,
    netAreaMm2,
    outerPerimeterMm,
    innerPerimeterMm,
    totalPerimeterMm,
    cutLengthMm,
  };
}

/**
 * Samples an arc defined by two vertices and a bulge factor (tan(theta/4)).
 * Uses a minimum of 32 segments and tests cardinal extrema.
 */
function sampleArcPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bulge: number,
  segments: number = 32
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  if (Math.abs(bulge) < 1e-6) {
    return points;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-6) {
    return points;
  }

  const theta = 4 * Math.atan(bulge);
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const h = (chord * (1 - bulge * bulge)) / (4 * bulge);

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const perpX = -dy / chord;
  const perpY = dx / chord;

  const cx = midX + h * perpX;
  const cy = midY + h * perpY;

  const startAngle = Math.atan2(y1 - cy, x1 - cx);

  const count = Math.max(32, segments);
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const angle = startAngle + t * theta;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }

  return points;
}

/**
 * Measures the true bounding box of the geometry from outer polylines,
 * inner polylines, and circles.
 */
export function measureBoundingBox(geometry: {
  outerPolylines?: LWPolyline[];
  innerPolylines?: LWPolyline[];
  circles?: CircleElement[];
}): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasGeometry = false;

  const processPolyline = (polyline: LWPolyline) => {
    const verts = polyline.vertices;
    if (!verts || verts.length === 0) return;

    const n = verts.length;
    const isClosed = polyline.isClosed;
    const segmentCount = isClosed ? n : n - 1;

    for (let i = 0; i < segmentCount; i++) {
      const v1 = verts[i];
      const v2 = verts[(i + 1) % n];
      const bulge = v1.bulge || 0;

      const sampled = sampleArcPoints(v1.x, v1.y, v2.x, v2.y, bulge, 32);
      for (const p of sampled) {
        hasGeometry = true;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  };

  if (geometry.outerPolylines) {
    for (const poly of geometry.outerPolylines) {
      processPolyline(poly);
    }
  }

  if (geometry.innerPolylines) {
    for (const poly of geometry.innerPolylines) {
      processPolyline(poly);
    }
  }

  if (geometry.circles) {
    for (const c of geometry.circles) {
      hasGeometry = true;
      const r = c.radius;
      if (c.center.x - r < minX) minX = c.center.x - r;
      if (c.center.x + r > maxX) maxX = c.center.x + r;
      if (c.center.y - r < minY) minY = c.center.y - r;
      if (c.center.y + r > maxY) maxY = c.center.y + r;
    }
  }

  if (!hasGeometry || !Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  const width = maxX - minX;
  const height = maxY - minY;

  return {
    minX: Number(minX.toFixed(4)),
    minY: Number(minY.toFixed(4)),
    maxX: Number(maxX.toFixed(4)),
    maxY: Number(maxY.toFixed(4)),
    width: Number(width.toFixed(4)),
    height: Number(height.toFixed(4)),
  };
}

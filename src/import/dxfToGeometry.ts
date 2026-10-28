// DXFAST :: Montagem de GeometryResult a partir de entidades DXF importadas
// Tesseliza arcos/bulge, encadeia segmentos abertos em lacos fechados, classifica
// contorno externo vs furos e calcula metricas (bbox, perimetros, comprimento de
// corte, perfuracoes, area). O resultado alimenta o mesmo motor de orcamento e
// nesting dos templates. Proibido o caractere traco-longo em qualquer string.

import {
  GeometryResult,
  LWPolyline,
  CircleElement,
  Point2D,
  GeometryMetrics,
} from '../types/cad';
import { DxfEntity, DxfParseResult } from './dxfParser';

export interface ImportReport {
  entityCount: number;
  loopCount: number;
  outerCount: number;
  holeCount: number;
  openChains: number; // segmentos que nao fecharam em laco
  insunits: number;
  unitScaleToMm: number;
  warnings: string[];
}

const BEND_RE = /bend|dobra|vinco/i;
const MARK_RE = /mark|etch|grava|scribe/i;

// ---- tesselizacao ----
function arcPoints(cx: number, cy: number, r: number, a0deg: number, a1deg: number): Point2D[] {
  let a0 = (a0deg * Math.PI) / 180;
  let a1 = (a1deg * Math.PI) / 180;
  // ARC do DXF e sempre anti-horario de a0 para a1
  if (a1 <= a0) a1 += Math.PI * 2;
  const sweep = a1 - a0;
  const segs = Math.max(2, Math.ceil((sweep / (Math.PI * 2)) * 48));
  const pts: Point2D[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + (sweep * i) / segs;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// subdivisao de um segmento com bulge (ver partOutline para a matematica)
function bulgePoints(p1: Point2D, p2: Point2D, bulge: number, depth = 4): Point2D[] {
  if (Math.abs(bulge) < 1e-9 || depth <= 0) return [{ x: p2.x, y: p2.y }];
  const dx = p2.x - p1.x, dy = p2.y - p1.y, chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return [{ x: p2.x, y: p2.y }];
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const px = dy / chord, py = -dx / chord; // perpendicular a direita (bulge>0 CCW)
  const sag = bulge * (chord / 2);
  const mid = { x: mx + px * sag, y: my + py * sag };
  const hb = Math.tan(Math.atan(bulge) / 2);
  return bulgePoints(p1, mid, hb, depth - 1).concat(bulgePoints(mid, p2, hb, depth - 1));
}

function polyVertsToPoints(
  verts: Array<{ x: number; y: number; bulge: number }>,
  closed: boolean
): Point2D[] {
  if (verts.length === 0) return [];
  const pts: Point2D[] = [{ x: verts[0].x, y: verts[0].y }];
  const segCount = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (Math.abs(a.bulge) > 1e-9) pts.push(...bulgePoints(a, b, a.bulge));
    else pts.push({ x: b.x, y: b.y });
  }
  return pts;
}

// ---- geometria auxiliar ----
function signedArea(pts: Point2D[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
function perimeter(pts: Point2D[], closed = true): number {
  let d = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    d += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return d;
}
function centroidSample(pts: Point2D[]): Point2D {
  // ponto garantidamente dentro nao e trivial; usamos a media (suficiente para
  // formas convexas/estreladas tipicas; a classificacao usa varios pontos abaixo)
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}
function pointInPoly(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = (yi > pt.y) !== (yj > pt.y) &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
// A dentro de B? (testa varios pontos de A para robustez)
function loopInside(a: Point2D[], b: Point2D[]): boolean {
  const samples = [centroidSample(a), a[0], a[Math.floor(a.length / 3)], a[Math.floor((2 * a.length) / 3)]];
  let hits = 0;
  for (const s of samples) if (pointInPoly(s, b)) hits++;
  return hits >= 2; // maioria dentro
}

interface Loop {
  pts: Point2D[];
  area: number; // |area|
  isCircle: boolean;
  circle?: { cx: number; cy: number; r: number };
}

// ---- encadeamento de segmentos abertos ----
function chainSegments(open: Point2D[][], tol: number): { loops: Point2D[][]; leftover: number } {
  const key = (p: Point2D) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const chains = open.map((c) => c.slice());
  const used = new Array(chains.length).fill(false);
  const loops: Point2D[][] = [];
  let leftover = 0;

  for (let i = 0; i < chains.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const cur = chains[i].slice();
    let extended = true;
    while (extended) {
      extended = false;
      const endK = key(cur[cur.length - 1]);
      const startK = key(cur[0]);
      if (endK === startK && cur.length > 2) break; // fechou
      for (let j = 0; j < chains.length; j++) {
        if (used[j]) continue;
        const ch = chains[j];
        const cs = key(ch[0]);
        const ce = key(ch[ch.length - 1]);
        if (cs === endK) { cur.push(...ch.slice(1)); used[j] = true; extended = true; break; }
        if (ce === endK) { cur.push(...ch.slice(0, -1).reverse()); used[j] = true; extended = true; break; }
        if (ce === startK) { cur.unshift(...ch.slice(0, -1)); used[j] = true; extended = true; break; }
        if (cs === startK) { cur.unshift(...ch.slice(1).reverse()); used[j] = true; extended = true; break; }
      }
    }
    // fechou?
    if (cur.length > 2 && key(cur[0]) === key(cur[cur.length - 1])) {
      cur.pop(); // remove o ponto duplicado de fechamento
      loops.push(cur);
    } else {
      leftover++;
    }
  }
  return { loops, leftover };
}

/**
 * Converte o resultado do parser em GeometryResult + relatorio de importacao.
 */
export function buildGeometryFromDxf(parsed: DxfParseResult, partName = 'Peca Importada'): {
  geometry: GeometryResult;
  report: ImportReport;
} {
  const warnings = [...parsed.warnings];
  const cutLoops: Loop[] = [];
  const openSegs: Point2D[][] = [];
  let bendCount = 0;

  const isBend = (layer: string) => BEND_RE.test(layer);
  const isMark = (layer: string) => MARK_RE.test(layer);

  for (const e of parsed.entities) {
    const layer = (e as any).layer || '0';
    if (isMark(layer)) continue; // marcacoes nao sao corte
    if (isBend(layer)) {
      if (e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') bendCount++;
      continue;
    }
    switch (e.type) {
      case 'CIRCLE': {
        const pts = arcPoints(e.cx, e.cy, e.r, 0, 360);
        pts.pop();
        cutLoops.push({ pts, area: Math.PI * e.r * e.r, isCircle: true, circle: { cx: e.cx, cy: e.cy, r: e.r } });
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pts = polyVertsToPoints(e.verts, e.closed);
        if (pts.length < 2) break;
        if (e.closed) cutLoops.push({ pts: dedupeClose(pts), area: Math.abs(signedArea(pts)), isCircle: false });
        else openSegs.push(pts);
        break;
      }
      case 'LINE':
        openSegs.push([{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }]);
        break;
      case 'ARC':
        openSegs.push(arcPoints(e.cx, e.cy, e.r, e.a0, e.a1));
        break;
      case 'SPLINE': {
        if (e.pts.length < 2) break;
        if (e.closed) cutLoops.push({ pts: e.pts.slice(), area: Math.abs(signedArea(e.pts)), isCircle: false });
        else openSegs.push(e.pts.slice());
        break;
      }
    }
  }

  // encadeia os segmentos abertos em lacos
  let openChains = 0;
  if (openSegs.length > 0) {
    // tolerancia relativa ao tamanho
    let span = 0;
    for (const s of openSegs) for (const p of s) span = Math.max(span, Math.abs(p.x), Math.abs(p.y));
    const tol = Math.max(0.05, span * 1e-5);
    const { loops, leftover } = chainSegments(openSegs, tol);
    openChains = leftover;
    for (const lp of loops) {
      if (lp.length >= 3) cutLoops.push({ pts: lp, area: Math.abs(signedArea(lp)), isCircle: false });
    }
    if (leftover > 0) warnings.push(`${leftover} trecho(s) aberto(s) nao formaram laco fechado e foram ignorados no corte.`);
  }

  if (cutLoops.length === 0) {
    warnings.push('Nenhum contorno de corte fechado foi reconhecido.');
  }

  // classifica externo vs furo por profundidade de containment
  const outers: Loop[] = [];
  const holes: Loop[] = [];
  for (let i = 0; i < cutLoops.length; i++) {
    let depth = 0;
    for (let j = 0; j < cutLoops.length; j++) {
      if (i === j) continue;
      if (cutLoops[j].area > cutLoops[i].area && loopInside(cutLoops[i].pts, cutLoops[j].pts)) depth++;
    }
    if (depth % 2 === 0) outers.push(cutLoops[i]);
    else holes.push(cutLoops[i]);
  }

  // bounding box de todo o corte
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of [...outers, ...holes]) {
    for (const p of l.pts) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  // monta GeometryResult
  const outerPolylines: LWPolyline[] = [];
  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];

  for (const o of outers) {
    outerPolylines.push({ vertices: o.pts.map((p) => ({ x: p.x, y: p.y })), isClosed: true, layer: 'CUT' });
  }
  for (const h of holes) {
    if (h.isCircle && h.circle) {
      circles.push({ type: 'circle', center: { x: h.circle.cx, y: h.circle.cy }, radius: h.circle.r, layer: 'CUT' });
    } else {
      innerPolylines.push({ vertices: h.pts.map((p) => ({ x: p.x, y: p.y })), isClosed: true, layer: 'CUT' });
    }
  }

  const outerPerimeterMm = outers.reduce((s, l) => s + perimeter(l.pts), 0);
  const innerPerimeterMm = holes.reduce((s, l) => s + perimeter(l.pts), 0);
  const outerArea = outers.reduce((s, l) => s + l.area, 0);
  const holeArea = holes.reduce((s, l) => s + l.area, 0);
  const piercingCount = outers.length + holes.length;

  const metrics: GeometryMetrics = {
    outerPerimeterMm,
    innerPerimeterMm,
    totalPerimeterMm: outerPerimeterMm + innerPerimeterMm,
    cutLengthMm: outerPerimeterMm + innerPerimeterMm,
    netAreaMm2: Math.max(0, outerArea - holeArea),
    grossAreaMm2: outerArea,
    piercingCount,
    bendCount,
    blankWidthMm: Number((maxX - minX).toFixed(2)),
    blankHeightMm: Number((maxY - minY).toFixed(2)),
  };

  const geometry: GeometryResult = {
    outerPolylines,
    innerPolylines,
    circles,
    bendLines: [],
    cotas: [],
    boundingBox: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
    metrics,
    warnings: [],
    errors: [],
  };

  const report: ImportReport = {
    entityCount: parsed.entities.length,
    loopCount: cutLoops.length,
    outerCount: outers.length,
    holeCount: holes.length,
    openChains,
    insunits: parsed.insunits,
    unitScaleToMm: parsed.unitScaleToMm,
    warnings,
  };

  void partName;
  return { geometry, report };
}

// remove ponto final duplicado (fecho) de um laco fechado
function dedupeClose(pts: Point2D[]): Point2D[] {
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) return pts.slice(0, -1);
  }
  return pts;
}

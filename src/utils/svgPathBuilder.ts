import { LWPolyline, LWPolylineVertex, Point2D } from '../types/cad';

/**
 * Converts a segment with bulge to an SVG Arc command
 */
function vertexToSvgArc(
  p1: Point2D,
  p2: Point2D,
  bulge: number
): string {
  if (Math.abs(bulge) < 0.0001) {
    return `L ${p2.x} ${p2.y}`;
  }

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);

  if (chord < 0.0001) {
    return `L ${p2.x} ${p2.y}`;
  }

  // Radius = (chord * (1 + b^2)) / (4 * |b|)
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const largeArcFlag = Math.abs(bulge) > 1.0 ? 1 : 0;
  const sweepFlag = bulge > 0 ? 1 : 0;

  return `A ${radius.toFixed(4)} ${radius.toFixed(4)} 0 ${largeArcFlag} ${sweepFlag} ${p2.x.toFixed(4)} ${p2.y.toFixed(4)}`;
}

/**
 * Converts a closed or open LWPolyline into an SVG path `d` attribute string
 */
export function polylineToSvgPath(poly: LWPolyline): string {
  const v = poly.vertices;
  if (!v || v.length === 0) return '';

  let d = `M ${v[0].x.toFixed(4)} ${v[0].y.toFixed(4)}`;

  for (let i = 0; i < v.length - 1; i++) {
    const current = v[i];
    const next = v[i + 1];
    const bulge = current.bulge || 0;
    d += ' ' + vertexToSvgArc(current, next, bulge);
  }

  if (poly.isClosed && v.length > 1) {
    const last = v[v.length - 1];
    const first = v[0];
    const bulge = last.bulge || 0;
    d += ' ' + vertexToSvgArc(last, first, bulge);
    d += ' Z';
  }

  return d;
}

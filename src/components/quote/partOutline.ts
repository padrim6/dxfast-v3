// DXFAST :: Tesselizacao da geometria real da peca para o preview do nesting
// Converte o contorno externo, os recortes internos e os furos em LACOS de pontos
// (poligonais) no sistema local da peca (y para cima), normalizados para a origem
// da bounding box: x em [0, W], y em [0, H]. Usado para desenhar a peca de verdade
// em cada posicao do aninhamento. Proibido o caractere traco-longo.

import { GeometryResult, LWPolyline, Point2D } from '../../types/cad';

export interface PartLoops {
  outer: Point2D[][]; // contornos externos (preenchidos)
  holes: Point2D[][]; // recortes internos e furos (vazados)
  w: number; // largura da bounding box (mm)
  h: number; // altura da bounding box (mm)
}

// Ponto medio do arco definido por p1->p2 com um dado bulge (tan(theta/4)).
// Usa a sagitta = bulge * (corda/2), medida na perpendicular a corda. O sinal do
// bulge ja define o lado do arco, entao nao ha ambiguidade de orientacao.
function arcMidpoint(p1: Point2D, p2: Point2D, bulge: number): Point2D {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return { x: p1.x, y: p1.y };
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  // Perpendicular a direita da direcao da corda. Convencao DXF: bulge positivo e
  // arco anti-horario, que se abaula para a direita do percurso p1->p2.
  const px = dy / chord;
  const py = -dx / chord;
  const sagitta = bulge * (chord / 2);
  return { x: mx + px * sagitta, y: my + py * sagitta };
}

// Subdivide recursivamente um segmento com bulge em pontos (sem incluir p1).
function subdivideArc(p1: Point2D, p2: Point2D, bulge: number, depth: number): Point2D[] {
  if (depth <= 0 || Math.abs(bulge) < 1e-9) {
    return [{ x: p2.x, y: p2.y }];
  }
  const mid = arcMidpoint(p1, p2, bulge);
  // bulge de cada metade: tan(atan(bulge)/2)
  const halfBulge = Math.tan(Math.atan(bulge) / 2);
  const left = subdivideArc(p1, mid, halfBulge, depth - 1);
  const right = subdivideArc(mid, p2, halfBulge, depth - 1);
  return left.concat(right);
}

// Converte uma LWPolyline em um laco de pontos (tesseliza arcos por bulge).
function polylineToLoop(poly: LWPolyline, depth: number = 4): Point2D[] {
  const vs = poly.vertices;
  if (vs.length === 0) return [];
  const loop: Point2D[] = [{ x: vs[0].x, y: vs[0].y }];
  const segCount = poly.isClosed ? vs.length : vs.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % vs.length];
    const bulge = a.bulge || 0;
    if (Math.abs(bulge) > 1e-9) {
      loop.push(...subdivideArc(a, b, bulge, depth));
    } else {
      loop.push({ x: b.x, y: b.y });
    }
  }
  return loop;
}

// Aproxima um circulo por um poligono regular (n lados).
function circleToLoop(center: Point2D, radius: number, sides: number = 40): Point2D[] {
  const loop: Point2D[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    loop.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return loop;
}

/**
 * Extrai os lacos da geometria real, normalizados para a origem da bounding box
 * (x em [0,W], y em [0,H], y para cima). Apenas camadas de corte (CUT) entram no
 * desenho da peca; dobras e marcacoes sao ignoradas aqui.
 */
export function tessellatePart(geometry: GeometryResult): PartLoops {
  const bb = geometry.boundingBox;
  const ox = bb.minX;
  const oy = bb.minY;
  const norm = (p: Point2D): Point2D => ({ x: p.x - ox, y: p.y - oy });

  const outer: Point2D[][] = [];
  for (const poly of geometry.outerPolylines) {
    if (poly.layer && poly.layer !== 'CUT') continue;
    const loop = polylineToLoop(poly).map(norm);
    if (loop.length >= 2) outer.push(loop);
  }

  const holes: Point2D[][] = [];
  for (const poly of geometry.innerPolylines) {
    if (poly.layer && poly.layer !== 'CUT') continue;
    const loop = polylineToLoop(poly).map(norm);
    if (loop.length >= 2) holes.push(loop);
  }
  for (const circle of geometry.circles) {
    if (circle.layer && circle.layer !== 'CUT') continue;
    const loop = circleToLoop(circle.center, circle.radius).map(norm);
    holes.push(loop);
  }

  return { outer, holes, w: bb.width, h: bb.height };
}

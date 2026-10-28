// DXFAST :: Preview de UMA chapa do nesting heterogeneo (carrinho)
// Desenha a geometria real de cada peca posicionada (contorno + furos), com uma
// cor por tipo de item. Proibido o caractere traco-longo em qualquer string.

import React from 'react';
import { Point2D } from '../../types/cad';
import { MultiPlacement } from '../../quote/multiNest';

export interface PartLoopsLite {
  outer: Point2D[][];
  holes: Point2D[][];
  w: number;
  h: number;
}

interface SheetNestPreviewProps {
  sheetWmm: number;
  sheetLmm: number;
  gapMm: number;
  placements: MultiPlacement[];
  partsLoops: Record<string, PartLoopsLite>;
  colorByKey: Record<string, { fill: string; line: string }>;
}

export const SheetNestPreview: React.FC<SheetNestPreviewProps> = ({
  sheetWmm, sheetLmm, gapMm, placements, partsLoops, colorByKey,
}) => {
  const landscape = sheetWmm >= sheetLmm;
  const boardW = landscape ? sheetWmm : sheetLmm;
  const boardH = landscape ? sheetLmm : sheetWmm;
  const stroke = Math.max(boardW, boardH) / 800;

  const sheetToSvg = (sx: number, sy: number): [number, number] => {
    let dx: number, dy: number;
    if (landscape) { dx = sx; dy = sy; } else { dx = sheetLmm - sy; dy = sx; }
    return [dx, boardH - dy];
  };

  const piecePath = (p: MultiPlacement): string => {
    const g = partsLoops[p.maskKey];
    if (!g) return '';
    const W0 = g.w, H0 = g.h;
    const place = (u: number, v: number): [number, number] => {
      if (p.rot === 90) return [p.x + (H0 - v), p.y + u];
      if (p.rot === 180) return [p.x + (W0 - u), p.y + (H0 - v)];
      if (p.rot === 270) return [p.x + v, p.y + (W0 - u)];
      return [p.x + u, p.y + v];
    };
    const loopToPath = (loop: Point2D[]): string => {
      let d = '';
      for (let i = 0; i < loop.length; i++) {
        const [sx, sy] = place(loop[i].x, loop[i].y);
        const [X, Y] = sheetToSvg(sx, sy);
        d += (i === 0 ? 'M' : 'L') + X.toFixed(2) + ' ' + Y.toFixed(2) + ' ';
      }
      return d + 'Z ';
    };
    let d = '';
    for (const loop of g.outer) d += loopToPath(loop);
    for (const loop of g.holes) d += loopToPath(loop);
    return d;
  };

  return (
    <div className="w-full overflow-hidden rounded-lg border border-slate-300 bg-white">
      <svg
        viewBox={`0 0 ${boardW} ${boardH}`}
        className="block w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Chapa com ${placements.length} pecas posicionadas`}
      >
        <rect x={0} y={0} width={boardW} height={boardH} fill="#f8fafc" stroke="#94a3b8" strokeWidth={stroke * 2} />
        {gapMm > 0 && boardW - 2 * gapMm > 0 && boardH - 2 * gapMm > 0 && (
          <rect x={gapMm} y={gapMm} width={boardW - 2 * gapMm} height={boardH - 2 * gapMm}
            fill="none" stroke="#cbd5e1" strokeWidth={stroke} strokeDasharray={`${stroke * 6} ${stroke * 4}`} />
        )}
        {placements.map((p, i) => {
          const col = colorByKey[p.maskKey] || { fill: '#bfdbfe', line: '#2563eb' };
          return (
            <path key={i} d={piecePath(p)} fill={col.fill} fillRule="evenodd"
              stroke={col.line} strokeWidth={stroke} strokeLinejoin="round" />
          );
        })}
      </svg>
    </div>
  );
};

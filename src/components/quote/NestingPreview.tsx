// DXFAST :: Preview visual do aninhamento real na chapa
// Desenha, em escala, o leiaute calculado pelo packer. Cada peca e desenhada com a
// GEOMETRIA REAL (contorno externo, recortes internos e furos), na orientacao
// correta (nominal ou girada 90 graus). Proibido o caractere traco-longo.

import React, { useMemo } from 'react';
import { QuoteMaterialBreakdown } from '../../quote/quoteTypes';
import { GeometryResult, Point2D } from '../../types/cad';
import { tessellatePart, PartLoops } from './partOutline';

interface NestingPreviewProps {
  material: QuoteMaterialBreakdown;
  geometry: GeometryResult;
}

export const NestingPreview: React.FC<NestingPreviewProps> = ({ material, geometry }) => {
  const {
    sheetWidthMm,
    sheetLengthMm,
    placements,
    piecesPerSheet,
    sheetUtilizationPercent,
    gapMm,
  } = material;

  // Tesseliza a peca uma unica vez (contorno + furos, no sistema local da bbox).
  const loops: PartLoops | null = useMemo(() => {
    try {
      const t = tessellatePart(geometry);
      return t.outer.length > 0 ? t : null;
    } catch {
      return null;
    }
  }, [geometry]);

  if (!sheetWidthMm || !sheetLengthMm || !placements || placements.length === 0) {
    return null;
  }

  // Chapa desenhada deitada (lado maior na horizontal) para melhor uso do espaco.
  const landscape = sheetWidthMm >= sheetLengthMm;
  const boardW = landscape ? sheetWidthMm : sheetLengthMm;
  const boardH = landscape ? sheetLengthMm : sheetWidthMm;

  // Transforma um ponto em coordenadas de chapa (y para cima, margem incluida) para
  // o sistema do SVG (y para baixo), aplicando a rotacao do tabuleiro quando em pe.
  const sheetToSvg = (sx: number, sy: number): [number, number] => {
    let dx: number;
    let dy: number;
    if (landscape) {
      dx = sx;
      dy = sy;
    } else {
      // chapa em pe mostrada deitada: rotacao de 90 graus (propria, sem espelho)
      dx = sheetLengthMm - sy;
      dy = sx;
    }
    return [dx, boardH - dy];
  };

  const maxDim = Math.max(boardW, boardH);
  const stroke = maxDim / 700;

  // Peca real: devolve a string de path (contorno + furos) ja em coords do SVG para
  // uma dada posicao. Usa fill-rule evenodd, entao os furos aparecem vazados.
  const W0 = loops ? loops.w : 0;
  const H0 = loops ? loops.h : 0;

  const piecePath = (px: number, py: number, rot: number): string => {
    if (!loops) return '';
    // ponto local (u,v) -> coordenada de chapa (sx,sy), conforme a rotacao
    const place = (u: number, v: number): [number, number] => {
      if (rot === 90) return [px + (H0 - v), py + u];
      if (rot === 180) return [px + (W0 - u), py + (H0 - v)];
      if (rot === 270) return [px + v, py + (W0 - u)];
      return [px + u, py + v];
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
    for (const loop of loops.outer) d += loopToPath(loop);
    for (const loop of loops.holes) d += loopToPath(loop);
    return d;
  };

  const rotatedCount = placements.filter((p) => p.rot !== 0).length;
  const nominalCount = placements.length - rotatedCount;

  // Desenho detalhado so quando o numero de pecas e legivel; acima disso cai para
  // retangulos simples (evita poluicao visual e excesso de elementos).
  const drawReal = loops !== null && placements.length <= 400;

  return (
    <div className="p-4 bg-slate-50 border border-slate-200/90 rounded-xl space-y-3 text-xs">
      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
        <span className="font-bold text-slate-900">Aninhamento na Chapa (estimado)</span>
        <span className="font-mono font-bold text-slate-900">
          {piecesPerSheet} pç/chapa · {sheetUtilizationPercent.toFixed(1)}%
        </span>
      </div>

      <div className="w-full overflow-hidden rounded-lg border border-slate-300 bg-white">
        <svg
          viewBox={`0 0 ${boardW} ${boardH}`}
          className="block w-full h-auto"
          role="img"
          aria-label={`Leiaute de ${piecesPerSheet} pecas na chapa de ${sheetWidthMm} por ${sheetLengthMm} milimetros, aproveitamento de ${sheetUtilizationPercent.toFixed(1)} por cento`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Chapa */}
          <rect x={0} y={0} width={boardW} height={boardH} fill="#f8fafc" stroke="#94a3b8" strokeWidth={stroke * 2} />
          {/* Margem de borda (area util) */}
          {gapMm > 0 && boardW - 2 * gapMm > 0 && boardH - 2 * gapMm > 0 && (
            <rect
              x={gapMm}
              y={gapMm}
              width={boardW - 2 * gapMm}
              height={boardH - 2 * gapMm}
              fill="none"
              stroke="#cbd5e1"
              strokeWidth={stroke}
              strokeDasharray={`${stroke * 6} ${stroke * 4}`}
            />
          )}
          {/* Pecas */}
          {placements.map((p, i) => {
            // Nominal = azul; girada/encaixada = indigo (tom calmo, nao de alerta).
            const fill = p.rot !== 0 ? '#e0e7ff' : '#bfdbfe';
            const line = p.rot !== 0 ? '#6366f1' : '#2563eb';
            if (drawReal) {
              return (
                <path
                  key={i}
                  d={piecePath(p.x, p.y, p.rot)}
                  fill={fill}
                  fillRule="evenodd"
                  stroke={line}
                  strokeWidth={stroke}
                  strokeLinejoin="round"
                />
              );
            }
            // fallback: retangulo da bounding box
            const [bx, by] = sheetToSvg(p.x, p.y + p.h); // canto superior-esquerdo em coords de chapa
            // em landscape o retangulo mantem w x h; em portrait as dimensoes trocam na tela,
            // por isso desenhamos via dois cantos transformados.
            const [cx2, cy2] = sheetToSvg(p.x + p.w, p.y);
            const rx = Math.min(bx, cx2);
            const ry = Math.min(by, cy2);
            const rw = Math.abs(cx2 - bx);
            const rh = Math.abs(cy2 - by);
            return (
              <rect key={i} x={rx} y={ry} width={rw} height={rh} fill={fill} stroke={line} strokeWidth={stroke} />
            );
          })}
        </svg>
      </div>

      {/* Barra de aproveitamento da chapa */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="font-sans text-slate-500">Aproveitamento da chapa</span>
          <span className="font-mono font-bold text-slate-800">{sheetUtilizationPercent.toFixed(1)}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(100, Math.max(0, sheetUtilizationPercent))}%`, backgroundColor: sheetUtilizationPercent >= 60 ? '#10b981' : sheetUtilizationPercent >= 35 ? '#f59e0b' : '#94a3b8' }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border border-blue-600 bg-blue-200" />
          Nominal: <span className="font-mono font-semibold">{nominalCount}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm border border-indigo-500 bg-indigo-200" />
          Girada / encaixada: <span className="font-mono font-semibold">{rotatedCount}</span>
        </span>
        <span className="text-slate-400 font-mono">
          Chapa {sheetWidthMm}x{sheetLengthMm} mm · gap {gapMm} mm
        </span>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-400">
        A chapa e preenchida aproveitando ao maximo o espaco: pecas em grade e, quando a peca e
        concava, encaixe aos pares (uma peca girada que se encaixa na outra). Cada peca aparece
        com a geometria real (contorno e furos). O espacamento vale entre as pecas e tambem como
        margem na borda (linha tracejada). O numero de pecas e sempre fisicamente alcancavel
        (nunca superestimado); o corte a laser real pode render um pouco mais.
      </p>
    </div>
  );
};

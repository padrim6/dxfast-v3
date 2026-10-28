import React, { useState, useRef, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  Crosshair,
  Compass,
  Grid,
  AlertTriangle,
  RotateCcw,
  Layers,
  Box,
  CheckCircle2,
  Ruler,
} from 'lucide-react';
import { GeometryResult, TemplateDefinition } from '../types/cad';
import type { ThreeFoldedViewerHandle } from './ThreeFoldedViewer';
// Carregado sob demanda: three.js e three-bvh-csg só entram no bundle ao abrir a aba 3D.
const ThreeFoldedViewer = lazy(() =>
  import('./ThreeFoldedViewer').then((m) => ({ default: m.ThreeFoldedViewer }))
);
import { CadErrorBoundary } from './CadErrorBoundary';
import { layoutDimensions } from '../utils/dimensionLayout';

interface CadViewportProps {
  geometry: GeometryResult;
  template: TemplateDefinition;
  partName?: string;
  params: Record<string, number>;
  allow3d?: boolean;
}

export const CadViewport: React.FC<CadViewportProps> = ({
  geometry,
  template,
  partName = 'PECA_PARAMETRICA',
  params,
  allow3d = true,
}) => {
  // View mode: 2D Unfolded Flat Pattern or Interactive 3D Real Folded Model
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');

  // Interactive Viewport State
  const [zoom, setZoom] = useState(1);
  const [zoom3d, setZoom3d] = useState(100);
  const [activeView3d, setActiveView3d] = useState<'iso' | 'front'>('iso');
  const [show3dCotas, setShow3dCotas] = useState<boolean>(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [startPan, setStartPan] = useState({ x: 0, y: 0 });
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  // CAD Layer Visibility
  const [showGrid, setShowGrid] = useState(true);
  const [showCotas, setShowCotas] = useState(true);
  const [showBendLines, setShowBendLines] = useState(true);
  const [showCenterLines, setShowCenterLines] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewer3dRef = useRef<ThreeFoldedViewerHandle>(null);
  const isInteracting = useRef(false);

  // Auto-fit geometry into 2D viewport when switching templates or resetting view
  const fitToScreen = useCallback(() => {
    if (!containerRef.current || viewMode !== '2d') return;
    const { clientWidth, clientHeight } = containerRef.current;
    if (clientWidth === 0 || clientHeight === 0) return;

    const bb = geometry.boundingBox;
    const padding = 100;
    const geomW = Math.max(10, bb.width + padding);
    const geomH = Math.max(10, bb.height + padding);

    const scaleX = clientWidth / geomW;
    const scaleY = clientHeight / geomH;
    const initialZoom = Math.min(scaleX, scaleY, 2.5);

    const centerX = (bb.minX + bb.maxX) / 2;
    const centerY = (bb.minY + bb.maxY) / 2;

    setZoom(initialZoom);
    setPan({
      x: clientWidth / 2 - centerX * initialZoom,
      y: clientHeight / 2 + centerY * initialZoom,
    });
  }, [geometry.boundingBox, viewMode]);

  useEffect(() => {
    if (viewMode === '2d') {
      fitToScreen();
    }
  }, [geometry.boundingBox.width, geometry.boundingBox.height, template.id, viewMode, fitToScreen]);

  // Convert raw mouse screen coordinates to CAD World Millimeters
  const getCadCoordinates = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    const worldX = (screenX - pan.x) / zoom;
    const worldY = -(screenY - pan.y) / zoom;

    return {
      x: Math.round(worldX * 10) / 10,
      y: Math.round(worldY * 10) / 10,
    };
  };

  // Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      setIsPanning(true);
      isInteracting.current = true;
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const coords = getCadCoordinates(e.clientX, e.clientY);
    setCursorPos(coords);

    if (isPanning) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    isInteracting.current = false;
  };

  // Keep refs up-to-date for native non-passive wheel listener
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = pan;
  }, [zoom, pan]);

  // Native non-passive wheel listener ensures mouse wheel over viewport ONLY zooms and NEVER scrolls page
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheelNative = (e: WheelEvent) => {
      // Unconditionally prevent browser window scroll and bubbling
      e.preventDefault();
      e.stopPropagation();

      if (viewMode === '2d') {
        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const currentZoom = zoomRef.current;
        const currentPan = panRef.current;
        const zoomFactor = e.deltaY > 0 ? 0.88 : 1.14;
        const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.05), 30);

        const newPan = {
          x: mouseX - (mouseX - currentPan.x) * (newZoom / currentZoom),
          y: mouseY - (mouseY - currentPan.y) * (newZoom / currentZoom),
        };

        // Immediate ref sync for rapid successive wheel ticks
        zoomRef.current = newZoom;
        panRef.current = newPan;

        setPan(newPan);
        setZoom(newZoom);
      } else if (viewMode === '3d') {
        viewer3dRef.current?.zoomByDelta(e.deltaY);
      }
    };

    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheelNative);
    };
  }, [viewMode]);

  // CAD Layer Paths Rendering
  const outerContourPath = useMemo(() => {
    return geometry.outerPolylines
      .map((poly) => {
        const v = poly.vertices;
        if (!v || v.length === 0) return '';
        let d = `M ${v[0].x} ${v[0].y}`;

        for (let i = 0; i < v.length; i++) {
          const current = v[i];
          const next = i < v.length - 1 ? v[i + 1] : poly.isClosed ? v[0] : null;
          if (!next) break;

          const bulge = current.bulge || 0;
          if (Math.abs(bulge) < 0.0001) {
            d += ` L ${next.x} ${next.y}`;
          } else {
            const dx = next.x - current.x;
            const dy = next.y - current.y;
            const chord = Math.hypot(dx, dy);
            const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
            const largeArc = Math.abs(bulge) > 1 ? 1 : 0;
            const sweep = bulge > 0 ? 1 : 0;
            d += ` A ${radius} ${radius} 0 ${largeArc} ${sweep} ${next.x} ${next.y}`;
          }
        }
        if (poly.isClosed) d += ' Z';
        return d;
      })
      .join(' ');
  }, [geometry.outerPolylines]);

  const innerContoursPath = useMemo(() => {
    return geometry.innerPolylines
      .map((poly) => {
        const v = poly.vertices;
        if (!v || v.length === 0) return '';
        let d = `M ${v[0].x} ${v[0].y}`;

        for (let i = 0; i < v.length; i++) {
          const current = v[i];
          const next = i < v.length - 1 ? v[i + 1] : poly.isClosed ? v[0] : null;
          if (!next) break;

          const bulge = current.bulge || 0;
          if (Math.abs(bulge) < 0.0001) {
            d += ` L ${next.x} ${next.y}`;
          } else {
            const dx = next.x - current.x;
            const dy = next.y - current.y;
            const chord = Math.hypot(dx, dy);
            const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
            const largeArc = Math.abs(bulge) > 1 ? 1 : 0;
            const sweep = bulge > 0 ? 1 : 0;
            d += ` A ${radius} ${radius} 0 ${largeArc} ${sweep} ${next.x} ${next.y}`;
          }
        }
        if (poly.isClosed) d += ' Z';
        return d;
      })
      .join(' ');
  }, [geometry.innerPolylines]);

  // Drilled / Pierced Holes SVG
  const circleElements = useMemo(() => {
    return geometry.circles.map((c, i) => (
      <g key={`circle-${i}`}>
        <circle
          cx={c.center.x}
          cy={c.center.y}
          r={c.radius}
          className="fill-[#0b0f19] stroke-[#f97316] transition-colors"
          strokeWidth={1.5 / zoom}
        />
        {showCenterLines && (
          <g stroke="#f97316" strokeWidth={0.8 / zoom} strokeOpacity={0.7}>
            <line
              x1={c.center.x - c.radius - 3 / zoom}
              y1={c.center.y}
              x2={c.center.x + c.radius + 3 / zoom}
              y2={c.center.y}
              strokeDasharray={`${3 / zoom} ${2 / zoom}`}
            />
            <line
              x1={c.center.x}
              y1={c.center.y - c.radius - 3 / zoom}
              x2={c.center.x}
              y2={c.center.y + c.radius + 3 / zoom}
              strokeDasharray={`${3 / zoom} ${2 / zoom}`}
            />
          </g>
        )}
      </g>
    ));
  }, [geometry.circles, showCenterLines, zoom]);

  // Bend Lines SVG (High-visibility green dashed with parallel tag offset from center)
  const bendLineElements = useMemo(() => {
    if (!showBendLines || !geometry.bendLines) return null;
    return geometry.bendLines.map((b) => {
      const sx = b.startX !== undefined ? b.startX : b.positionX;
      const sy = b.startY;
      const ex = b.endX !== undefined ? b.endX : b.positionX;
      const ey = b.endY;

      const dx = ex - sx;
      const dy = ey - sy;
      let rotDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (rotDeg > 90) rotDeg -= 180;
      if (rotDeg < -90) rotDeg += 180;

      // Center position along the bend line
      const tagX = (sx + ex) / 2;
      const tagY = (sy + ey) / 2;

      return (
        <g key={b.id}>
          <line
            x1={sx}
            y1={sy}
            x2={ex}
            y2={ey}
            stroke="#22c55e"
            strokeWidth={1.8 / zoom}
            strokeDasharray={`${6 / zoom} ${4 / zoom}`}
          />
          {/* Centered Parallel Text Tag */}
          <g transform={`translate(${tagX}, ${tagY}) rotate(${-rotDeg}) scale(${1 / zoom}, ${-1 / zoom})`}>
            <rect
              x={-34}
              y={-9}
              width={68}
              height={18}
              rx={3}
              fill="#064e3b"
              stroke="#22c55e"
              strokeWidth={1.0}
            />
            <text
              x={0}
              y={3.5}
              fill="#86efac"
              fontSize={9.5}
              fontFamily="'JetBrains Mono', monospace"
              textAnchor="middle"
              fontWeight="bold"
            >
              {b.direction} {b.angleDeg || 90}°
            </text>
          </g>
        </g>
      );
    });
  }, [geometry.bendLines, showBendLines, zoom]);

  // Essential Dimension Cotas (Universal de-conflict & auto-hide references)
  const cotaElements = useMemo(() => {
    if (!showCotas || !geometry.cotas) return null;

    // Métricas reais do rótulo convertidas de pixel para mm via 1/zoom
    const charWidthMm = 7.2 / zoom;
    const labelHeightMm = 20 / zoom;

    const laidOutCotas = layoutDimensions(geometry.cotas, geometry.boundingBox, {
      charWidthMm,
      labelHeightMm,
    });

    return laidOutCotas.map((item, idx) => {
      if (item.hidden) return null;

      const { cota, role, resolvedOffset } = item;
      const offset = resolvedOffset / zoom;
      const isRef = role === 'reference';

      // Visual styling hierarchy
      const strokeColor = isRef ? '#94a3b8' : '#fb923c';
      const strokeW = (isRef ? 0.9 : 1.2) / zoom;
      const labelW = Math.max(isRef ? 52 : 64, cota.label.length * (isRef ? 6.2 : 7.2) + 16);
      const badgeBorderW = isRef ? 0.8 : 1.2;
      const badgeFontSize = isRef ? 9.5 : 11;
      const badgeFontWeight = isRef ? 'normal' : 'bold';
      const badgeTextColor = isRef ? '#cbd5e1' : '#f8fafc';

      if (cota.orientation === 'horizontal') {
        const isNegativeOffset = resolvedOffset < 0;
        const yRef = isNegativeOffset
          ? Math.min(cota.start.y, cota.end.y)
          : Math.max(cota.start.y, cota.end.y);
        const yLine = yRef + offset;
        const extOvershoot = isNegativeOffset ? -6 / zoom : 6 / zoom;
        return (
          <g key={`cota-${idx}`} className="select-none">
            {/* Extension lines */}
            <line
              x1={cota.start.x}
              y1={cota.start.y}
              x2={cota.start.x}
              y2={yLine + extOvershoot}
              stroke={strokeColor}
              strokeWidth={0.8 / zoom}
              strokeDasharray={`${2 / zoom} ${2 / zoom}`}
              strokeOpacity={isRef ? 0.45 : 0.6}
            />
            <line
              x1={cota.end.x}
              y1={cota.end.y}
              x2={cota.end.x}
              y2={yLine + extOvershoot}
              stroke={strokeColor}
              strokeWidth={0.8 / zoom}
              strokeDasharray={`${2 / zoom} ${2 / zoom}`}
              strokeOpacity={isRef ? 0.45 : 0.6}
            />
            {/* Dimension Line */}
            <line
              x1={cota.start.x}
              y1={yLine}
              x2={cota.end.x}
              y2={yLine}
              stroke={strokeColor}
              strokeWidth={strokeW}
            />
            {/* Arrows */}
            <polygon
              points={`${cota.start.x},${yLine} ${cota.start.x + 8 / zoom},${yLine - 2.8 / zoom} ${cota.start.x + 8 / zoom},${yLine + 2.8 / zoom}`}
              fill={strokeColor}
            />
            <polygon
              points={`${cota.end.x},${yLine} ${cota.end.x - 8 / zoom},${yLine - 2.8 / zoom} ${cota.end.x - 8 / zoom},${yLine + 2.8 / zoom}`}
              fill={strokeColor}
            />
            {/* Horizontal Text Box */}
            <g transform={`translate(${(cota.start.x + cota.end.x) / 2}, ${yLine}) scale(${1 / zoom}, ${-1 / zoom})`}>
              <rect
                x={-labelW / 2}
                y={-10}
                width={labelW}
                height={20}
                rx={4}
                fill="#1e293b"
                stroke={strokeColor}
                strokeWidth={badgeBorderW}
              />
              <text
                x={0}
                y={4}
                fill={badgeTextColor}
                fontSize={badgeFontSize}
                fontFamily="'JetBrains Mono', monospace"
                textAnchor="middle"
                fontWeight={badgeFontWeight}
              >
                {cota.label}
              </text>
            </g>
          </g>
        );
      } else if (cota.orientation === 'vertical') {
        const isNegativeOffset = resolvedOffset < 0;
        const xRef = isNegativeOffset
          ? Math.min(cota.start.x, cota.end.x)
          : Math.max(cota.start.x, cota.end.x);
        const xLine = xRef + offset;
        const extOvershoot = isNegativeOffset ? -6 / zoom : 6 / zoom;
        return (
          <g key={`cota-${idx}`} className="select-none">
            {/* Extension lines */}
            <line
              x1={cota.start.x}
              y1={cota.start.y}
              x2={xLine + extOvershoot}
              y2={cota.start.y}
              stroke={strokeColor}
              strokeWidth={0.8 / zoom}
              strokeDasharray={`${2 / zoom} ${2 / zoom}`}
              strokeOpacity={isRef ? 0.45 : 0.6}
            />
            <line
              x1={cota.end.x}
              y1={cota.end.y}
              x2={xLine + extOvershoot}
              y2={cota.end.y}
              stroke={strokeColor}
              strokeWidth={0.8 / zoom}
              strokeDasharray={`${2 / zoom} ${2 / zoom}`}
              strokeOpacity={isRef ? 0.45 : 0.6}
            />
            {/* Dimension Line */}
            <line
              x1={xLine}
              y1={cota.start.y}
              x2={xLine}
              y2={cota.end.y}
              stroke={strokeColor}
              strokeWidth={strokeW}
            />
            {/* Arrows */}
            <polygon
              points={`${xLine},${cota.start.y} ${xLine - 2.8 / zoom},${cota.start.y + 8 / zoom} ${xLine + 2.8 / zoom},${cota.start.y + 8 / zoom}`}
              fill={strokeColor}
            />
            <polygon
              points={`${xLine},${cota.end.y} ${xLine - 2.8 / zoom},${cota.end.y - 8 / zoom} ${xLine + 2.8 / zoom},${cota.end.y - 8 / zoom}`}
              fill={strokeColor}
            />
            {/* Vertical Text Box */}
            <g transform={`translate(${xLine}, ${(cota.start.y + cota.end.y) / 2}) rotate(-90) scale(${1 / zoom}, ${-1 / zoom})`}>
              <rect
                x={-labelW / 2}
                y={-10}
                width={labelW}
                height={20}
                rx={4}
                fill="#1e293b"
                stroke={strokeColor}
                strokeWidth={badgeBorderW}
              />
              <text
                x={0}
                y={4}
                fill={badgeTextColor}
                fontSize={badgeFontSize}
                fontFamily="'JetBrains Mono', monospace"
                textAnchor="middle"
                fontWeight={badgeFontWeight}
              >
                {cota.label}
              </text>
            </g>
          </g>
        );
      } else if (cota.orientation === 'aligned') {
        const dx = cota.end.x - cota.start.x;
        const dy = cota.end.y - cota.start.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-4) return null;
        const nx = -dy / len;
        const ny = dx / len;
        const p1x = cota.start.x + nx * offset;
        const p1y = cota.start.y + ny * offset;
        const p2x = cota.end.x + nx * offset;
        const p2y = cota.end.y + ny * offset;
        const midX = (p1x + p2x) / 2;
        const midY = (p1y + p2y) / 2;
        const extOvershoot = 4 / zoom;

        return (
          <g key={`cota-${idx}`} className="select-none">
            {/* Extension lines */}
            <line
              x1={cota.start.x}
              y1={cota.start.y}
              x2={p1x + nx * extOvershoot}
              y2={p1y + ny * extOvershoot}
              stroke={strokeColor}
              strokeWidth={0.8 / zoom}
              strokeDasharray={`${2 / zoom} ${2 / zoom}`}
              strokeOpacity={isRef ? 0.45 : 0.6}
            />
            <line
              x1={cota.end.x}
              y1={cota.end.y}
              x2={p2x + nx * extOvershoot}
              y2={p2y + ny * extOvershoot}
              stroke={strokeColor}
              strokeWidth={0.8 / zoom}
              strokeDasharray={`${2 / zoom} ${2 / zoom}`}
              strokeOpacity={isRef ? 0.45 : 0.6}
            />
            {/* Dimension line */}
            <line
              x1={p1x}
              y1={p1y}
              x2={p2x}
              y2={p2y}
              stroke={strokeColor}
              strokeWidth={strokeW}
            />
            {/* Dimension Badge */}
            <g transform={`translate(${midX}, ${midY}) scale(${1 / zoom}, ${-1 / zoom})`}>
              <rect
                x={-labelW / 2}
                y={-9}
                width={labelW}
                height={18}
                rx={4}
                fill="#1e293b"
                stroke={strokeColor}
                strokeWidth={badgeBorderW}
              />
              <text
                x={0}
                y={3.5}
                fill={badgeTextColor}
                fontSize={badgeFontSize}
                fontFamily="'JetBrains Mono', monospace"
                textAnchor="middle"
                fontWeight={badgeFontWeight}
              >
                {cota.label}
              </text>
            </g>
          </g>
        );
      } else if (cota.type === 'diameter' || cota.type === 'radius') {
        const pStart = cota.start;
        const pEnd = cota.end;
        const angleRad = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);

        // Leader landing shoulder outside workpiece
        const leaderLen = (resolvedOffset || 20) / zoom;
        const shoulderLen = Math.max(26, labelW / 2 + 8) / zoom;
        const elbowX = pEnd.x + leaderLen * Math.cos(angleRad);
        const elbowY = pEnd.y + leaderLen * Math.sin(angleRad);
        const shoulderEndX = elbowX + shoulderLen * (Math.cos(angleRad) >= 0 ? 1 : -1);

        return (
          <g key={`cota-${idx}`} className="select-none">
            {/* Dimension line across circle diameter */}
            <line
              x1={pStart.x}
              y1={pStart.y}
              x2={pEnd.x}
              y2={pEnd.y}
              stroke={strokeColor}
              strokeWidth={strokeW}
            />
            {/* Start Arrow */}
            <circle cx={pStart.x} cy={pStart.y} r={2.5 / zoom} fill={strokeColor} />
            <circle cx={pEnd.x} cy={pEnd.y} r={2.5 / zoom} fill={strokeColor} />

            {/* Leader Line to Shoulder */}
            <line
              x1={pEnd.x}
              y1={pEnd.y}
              x2={elbowX}
              y2={elbowY}
              stroke={strokeColor}
              strokeWidth={strokeW}
            />
            <line
              x1={elbowX}
              y1={elbowY}
              x2={shoulderEndX}
              y2={elbowY}
              stroke={strokeColor}
              strokeWidth={strokeW}
            />

            {/* Dimension Badge */}
            <g transform={`translate(${(elbowX + shoulderEndX) / 2}, ${elbowY + 10 / zoom}) scale(${1 / zoom}, ${-1 / zoom})`}>
              <rect
                x={-labelW / 2}
                y={-10}
                width={labelW}
                height={20}
                rx={4}
                fill="#1e293b"
                stroke={strokeColor}
                strokeWidth={badgeBorderW}
              />
              <text
                x={0}
                y={4}
                fill={badgeTextColor}
                fontSize={badgeFontSize}
                fontFamily="'JetBrains Mono', monospace"
                textAnchor="middle"
                fontWeight={badgeFontWeight}
              >
                {cota.label}
              </text>
            </g>
          </g>
        );
      }
      return null;
    });
  }, [geometry.cotas, geometry.boundingBox, showCotas, zoom]);

  return (
    <div className="flex flex-col gap-3.5 w-full">
      {/* Geometric Errors Banner (Blocking) - Positioned above viewport so it never overlaps controls */}
      {geometry.errors && geometry.errors.length > 0 && (
        <div id="cad-viewport-errors" className="bg-rose-50 border border-rose-200 px-4 py-3 rounded-xl flex items-start gap-3 text-xs text-rose-900 shadow-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-heading uppercase tracking-wide text-rose-950 font-bold">
              Inconsistência Geométrica Bloqueante ({geometry.errors.length} {geometry.errors.length === 1 ? 'erro' : 'erros'}):
            </div>
            <ul className="list-disc list-inside text-rose-800 font-medium space-y-0.5">
              {geometry.errors.map((err, i) => (
                <li key={`geom-err-${i}`}>
                  {err.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Warnings Banner (Sanitizations) - Positioned above viewport */}
      {geometry.warnings.length > 0 && (
        <div id="cad-viewport-warnings" className="bg-amber-50 border border-amber-200/90 px-4 py-2.5 rounded-xl flex items-center gap-2.5 text-xs text-amber-900 shadow-xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <div className="truncate font-sans">
            <span className="font-heading uppercase tracking-wide text-amber-950 font-bold mr-1">
              Sanitização Automática:
            </span>
            <span className="text-amber-800 font-medium">{geometry.warnings[0].message}</span>
          </div>
        </div>
      )}

      {/* CAD Viewport Box */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        className="relative w-full h-[360px] sm:h-[460px] lg:h-[520px] bg-[#0b0f19] rounded-xl overflow-hidden shadow-2xl border border-slate-800 select-none cursor-crosshair group flex flex-col"
      >
        {/* Top Floating Control Bar */}
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-20 pointer-events-none">
          {/* Left Controls: 2D/3D Mode Switcher + Layer / View Presets */}
          <div className="flex items-center gap-2 pointer-events-auto">
            {/* 2D / 3D Mode Selector Switch */}
            <div className="flex items-center gap-1 bg-slate-900/95 backdrop-blur-md border border-slate-700/90 p-1 rounded-lg shadow-xl">
              <button
                id="btn-switch-viewport-2d"
                type="button"
                onClick={() => setViewMode('2d')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all ${
                  viewMode === '2d'
                    ? 'bg-[#FF3000] text-white shadow font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
                aria-label="Visualizador 2D (Blank Planificado)" title="Visualizador 2D (Blank Planificado)"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>2D Planificado</span>
              </button>
              {allow3d && (
                <button
                  id="btn-switch-viewport-3d"
                  type="button"
                  onClick={() => setViewMode('3d')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-all ${
                    viewMode === '3d'
                      ? 'bg-[#FF3000] text-white shadow font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  aria-label="Visualizador 3D (Modelo Dobrado)" title="Visualizador 3D (Modelo Dobrado)"
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>3D Dobrado</span>
                </button>
              )}
            </div>

            {/* Mode-Specific Sub-Controls */}
            {viewMode === '2d' ? (
              <div className="flex items-center gap-1 bg-slate-900/95 backdrop-blur-md border border-slate-700/90 p-1 rounded-lg shadow-xl">
                <button
                  id="btn-toggle-grid-2d"
                  type="button"
                  onClick={() => setShowGrid(!showGrid)}
                  className={`p-1.5 rounded transition-all ${
                    showGrid ? 'bg-slate-800 text-sky-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
                  }`}
                  aria-label="Alternar Grade Milimétrica" title="Alternar Grade Milimétrica"
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  id="btn-toggle-cotas-2d"
                  type="button"
                  onClick={() => setShowCotas(!showCotas)}
                  className={`p-1.5 rounded transition-all ${
                    showCotas ? 'bg-slate-800 text-orange-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
                  }`}
                  aria-label="Alternar Cotas e Dimensões 2D" title="Alternar Cotas e Dimensões 2D"
                >
                  <Compass className="w-4 h-4" />
                </button>
                <button
                  id="btn-toggle-bendlines-2d"
                  type="button"
                  onClick={() => setShowBendLines(!showBendLines)}
                  className={`p-1.5 rounded transition-all ${
                    showBendLines ? 'bg-slate-800 text-emerald-400 font-semibold' : 'text-slate-500 hover:text-slate-300'
                  }`}
                  aria-label="Alternar Linhas de Dobra (BEND)" title="Alternar Linhas de Dobra (BEND)"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 bg-slate-900/95 backdrop-blur-md border border-slate-700/90 p-1 rounded-lg shadow-xl">
                <div className="flex items-center gap-0.5 bg-slate-950/70 p-0.5 rounded-md border border-slate-800">
                  <button
                    id="btn-view-iso-3d"
                    type="button"
                    onClick={() => {
                      setActiveView3d('iso');
                      viewer3dRef.current?.setNamedView('iso');
                    }}
                    className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-all ${
                      activeView3d === 'iso'
                        ? 'bg-slate-700 text-white shadow-sm font-semibold'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                    aria-label="Vista Isométrica (3D Padrão)" title="Vista Isométrica (3D Padrão)"
                  >
                    ISO
                  </button>
                  <button
                    id="btn-view-front-3d"
                    type="button"
                    onClick={() => {
                      setActiveView3d('front');
                      viewer3dRef.current?.setNamedView('front');
                    }}
                    className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-all ${
                      activeView3d === 'front'
                        ? 'bg-slate-700 text-white shadow-sm font-semibold'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                    aria-label="Vista Frontal (Perpendicular)" title="Vista Frontal (Perpendicular)"
                  >
                    Frontal
                  </button>
                </div>

                <button
                  id="btn-toggle-cotas-3d"
                  type="button"
                  onClick={() => setShow3dCotas(!show3dCotas)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-all ${
                    show3dCotas
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                  aria-label="Alternar Cotas e Dimensões 3D" title="Alternar Cotas e Dimensões 3D"
                >
                  <Ruler className="w-3.5 h-3.5" />
                  <span>Cotas 3D</span>
                </button>
              </div>
            )}
          </div>

          {/* Right Controls: Zoom & Fit / Reset Tools */}
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {viewMode === '2d' ? (
              <div className="flex items-center gap-1 bg-slate-900/95 backdrop-blur-md border border-slate-700/90 p-1 rounded-lg shadow-xl">
                <button
                  id="btn-zoom-in-2d"
                  type="button"
                  onClick={() => setZoom((z) => Math.min(z * 1.2, 25))}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                  aria-label="Aumentar Zoom (+)" title="Aumentar Zoom (+)"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  id="btn-zoom-out-2d"
                  type="button"
                  onClick={() => setZoom((z) => Math.max(z * 0.8, 0.08))}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                  aria-label="Diminuir Zoom (-)" title="Diminuir Zoom (-)"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  id="btn-fit-screen-2d"
                  type="button"
                  onClick={fitToScreen}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                  aria-label="Enquadrar Peça (Fit to Screen)" title="Enquadrar Peça (Fit to Screen)"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 bg-slate-900/95 backdrop-blur-md border border-slate-700/90 p-1 rounded-lg shadow-xl">
                <button
                  id="btn-zoom-in-3d"
                  type="button"
                  onClick={() => viewer3dRef.current?.zoomIn()}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                  aria-label="Aumentar Zoom 3D (+)" title="Aumentar Zoom 3D (+)"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  id="btn-zoom-out-3d"
                  type="button"
                  onClick={() => viewer3dRef.current?.zoomOut()}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                  aria-label="Diminuir Zoom 3D (-)" title="Diminuir Zoom 3D (-)"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  id="btn-reset-camera-3d"
                  type="button"
                  onClick={() => viewer3dRef.current?.resetCamera()}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                  aria-label="Resetar Câmera / Enquadrar 3D" title="Resetar Câmera / Enquadrar 3D"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Viewport Content (2D SVG or 3D Three.js WebGL) */}
        {viewMode === '3d' ? (
          <CadErrorBoundary fallbackTitle="Falha no Visualizador 3D">
            <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">Carregando visualizador 3D…</div>}>
              <ThreeFoldedViewer
                ref={viewer3dRef}
                geometry={geometry}
                template={template}
                params={params}
                show3dCotas={show3dCotas}
                activeView={activeView3d}
                onActiveViewChange={setActiveView3d}
                onZoomChange={setZoom3d}
              />
            </Suspense>
          </CadErrorBoundary>
        ) : (
          <svg className="w-full h-full flex-1 overflow-hidden select-none cursor-crosshair">
            <defs>
              {/* Millimeter Engineering Grid */}
              <pattern
                id="grid-mm"
                width={10 * zoom}
                height={10 * zoom}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${10 * zoom} 0 L 0 0 0 ${10 * zoom}`}
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth="0.5"
                  strokeOpacity="0.4"
                />
              </pattern>
              <pattern
                id="grid-100mm"
                width={100 * zoom}
                height={100 * zoom}
                patternUnits="userSpaceOnUse"
              >
                <rect width={100 * zoom} height={100 * zoom} fill="url(#grid-mm)" />
                <path
                  d={`M ${100 * zoom} 0 L 0 0 0 ${100 * zoom}`}
                  fill="none"
                  stroke="#334155"
                  strokeWidth="0.8"
                  strokeOpacity="0.7"
                />
              </pattern>
            </defs>

            {/* Background Grid */}
            {showGrid && (
              <rect
                width="100%"
                height="100%"
                fill="url(#grid-100mm)"
                x={pan.x % (100 * zoom)}
                y={pan.y % (100 * zoom)}
              />
            )}

            {/* CAD Geometry Root Group with standard Cartesian Orientation */}
            <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom}, ${-zoom})`}>
              {/* Origin Marker (0,0) */}
              <g opacity={0.5}>
                <line x1={-15 / zoom} y1={0} x2={15 / zoom} y2={0} stroke="#64748b" strokeWidth={1 / zoom} />
                <line x1={0} y1={-15 / zoom} x2={0} y2={15 / zoom} stroke="#64748b" strokeWidth={1 / zoom} />
                <circle cx={0} cy={0} r={2.5 / zoom} fill="none" stroke="#64748b" strokeWidth={1 / zoom} />
              </g>

              {/* Bounding Box / Blank Envelope */}
              <rect
                x={geometry.boundingBox.minX}
                y={geometry.boundingBox.minY}
                width={geometry.boundingBox.width}
                height={geometry.boundingBox.height}
                fill="none"
                stroke="#334155"
                strokeWidth={0.8 / zoom}
                strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                strokeOpacity={0.4}
              />

              {/* Face Section Region Highlights for Profiles */}
              {geometry.faceSections &&
                geometry.faceSections.map((f, i) => (
                  <rect
                    key={`face-${i}`}
                    x={f.startXBlankMm}
                    y={-f.heightMm / 2}
                    width={f.endXBlankMm - f.startXBlankMm}
                    height={f.heightMm}
                    fill={i % 2 === 0 ? 'rgba(56, 189, 248, 0.03)' : 'rgba(99, 102, 241, 0.03)'}
                    stroke="none"
                  />
                ))}

              {/* Outer Cut Polyline (Solid White Contour) */}
              {outerContourPath && (
                <path
                  d={outerContourPath}
                  className="fill-[#131b2e]/60 stroke-white transition-all"
                  strokeWidth={2.0 / zoom}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}

              {/* Inner Cut Polylines (Slots, Internal Cutouts) */}
              {innerContoursPath && (
                <path
                  d={innerContoursPath}
                  className="fill-[#0b0f19] stroke-[#f97316]"
                  strokeWidth={1.6 / zoom}
                  strokeLinejoin="round"
                />
              )}

              {/* Drilled Holes */}
              {circleElements}

              {/* Bend Lines (Green Dashed with Angles) */}
              {bendLineElements}

              {/* Dynamic Dimension Cotas */}
              {cotaElements}
            </g>
          </svg>
        )}

        {/* Dynamic Coordinates HUD */}
        <div className="absolute bottom-3 left-3 flex items-center gap-2.5 bg-slate-900/90 backdrop-blur border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-300 shadow-md pointer-events-none">
          <Crosshair className="w-3.5 h-3.5 text-[#FF3000]" />
          <span>
            {viewMode === '3d' ? (
              <span className="text-slate-200 font-medium">Modo 3D Interativo</span>
            ) : cursorPos ? (
              <>
                X: <span className="font-bold text-white">{cursorPos.x}</span> mm | Y:{' '}
                <span className="font-bold text-white">{cursorPos.y}</span> mm
              </>
            ) : (
              <span>Cursor no canvas</span>
            )}
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-200 font-semibold">
            Zoom: {viewMode === '3d' ? `${zoom3d}%` : `${(zoom * 100).toFixed(0)}%`}
          </span>
        </div>
      </div>
    </div>
  );
};

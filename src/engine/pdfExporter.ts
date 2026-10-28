import { jsPDF } from 'jspdf';
import { GeometryResult, TemplateDefinition, BendLine, LWPolyline, LWPolylineVertex } from '../types/cad';
import { render3dIsometricSnapshot } from './snapshot3d';
import { layoutDimensions } from '../utils/dimensionLayout';
import { sanitizeFilename } from './dxfExporter';
import { savePdfDoc } from '../utils/download';

export interface PdfExportOptions {
  partName: string;
  thicknessMm: number;
  companyName?: string;
  notes?: string;
  params?: Record<string, number>;
  preview3dImage?: string;
}

/**
 * Standardized Industrial Design Palette:
 * - Ink Black: #0F172A (RGB: 15, 23, 42) -> Contours, Title Text, Main Border
 * - Accent Brand Red: #FF3000 (RGB: 255, 48, 0) -> Dimensions, Leaders, Title Accent
 * - Bend Green: #16A34A (RGB: 22, 163, 74) -> Bend Lines & Bend Callouts
 * - Technical Slate: #475569 / #64748B / #94A3B8 -> Grid, Labels, Dividers
 * - Subtle Card Surface: #F8FAFC / #F1F5F9 -> Tables, Title Block & 3D Shading
 */

/**
 * Samples exact 2D polyline coordinates including smooth arc bulges.
 */
function samplePolylinePoints(poly: LWPolyline, samplesPerArc = 12): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const v = poly.vertices;
  if (!v || v.length === 0) return pts;

  const count = poly.isClosed ? v.length : v.length - 1;

  for (let i = 0; i < count; i++) {
    const p1 = v[i];
    const p2 = v[(i + 1) % v.length];
    const bulge = p1.bulge || 0;

    pts.push({ x: p1.x, y: p1.y });

    if (Math.abs(bulge) > 1e-4) {
      // Calculate circular arc from bulge using exact algebraic formulation
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const chord = Math.hypot(dx, dy);

      if (chord > 1e-4) {
        const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
        const h = (chord * (1 - bulge * bulge)) / (4 * bulge);
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const nx = -dy / chord;
        const ny = dx / chord;
        const cx = midX + nx * h;
        const cy = midY + ny * h;

        const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
        let endAngle = Math.atan2(p2.y - cy, p2.x - cx);

        if (bulge > 0 && endAngle < startAngle) endAngle += 2 * Math.PI;
        if (bulge < 0 && endAngle > startAngle) endAngle -= 2 * Math.PI;

        const arcSteps = Math.max(4, samplesPerArc);
        for (let s = 1; s < arcSteps; s++) {
          const t = s / arcSteps;
          const a = startAngle + t * (endAngle - startAngle);
          pts.push({
            x: cx + radius * Math.cos(a),
            y: cy + radius * Math.sin(a),
          });
        }
      }
    }
  }

  if (!poly.isClosed && v.length > 0) {
    pts.push({ x: v[v.length - 1].x, y: v[v.length - 1].y });
  }

  return pts;
}

/**
 * Draws a polyline on jsPDF with smooth arc resolution.
 */
function drawPolylineOnPdf(
  doc: jsPDF,
  poly: LWPolyline,
  transformX: (x: number) => number,
  transformY: (y: number) => number
) {
  const points = samplePolylinePoints(poly, 16);
  if (points.length < 2) return;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    doc.line(transformX(p1.x), transformY(p1.y), transformX(p2.x), transformY(p2.y));
  }

  if (poly.isClosed && points.length > 2) {
    const pLast = points[points.length - 1];
    const pFirst = points[0];
    doc.line(transformX(pLast.x), transformY(pLast.y), transformX(pFirst.x), transformY(pFirst.y));
  }
}

/**
 * Generates an ultra-clean, standardized ISO/ABNT A4 Landscape Technical Drawing
 * with harmonious color scheme, content-proportional CNC card, and expanded 2D blank.
 */
export function generateTechnicalDrawingPdf(
  geometry: GeometryResult,
  template: TemplateDefinition,
  options: PdfExportOptions
): jsPDF {
  // A4 Landscape dimensions: 297mm x 210mm
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 297;
  const pageHeight = 210;
  const margin = 8;
  const innerMargin = margin + 1.5;

  const params = options.params || template.defaultParams || {};
  const rawThickness = options.thicknessMm ?? params.thickness;
  if (rawThickness === undefined || rawThickness === null || isNaN(rawThickness) || rawThickness <= 0) {
    throw new Error(`Espessura da chapa não informada ou inválida para o modelo "${template.name}".`);
  }
  const thickness = rawThickness;

  // =========================================================================
  // 1. TECHNICAL BORDER WITH ZONE REFERENCE GRID (ISO 5457)
  // =========================================================================
  doc.setDrawColor(15, 23, 42); // Slate-900 (Standard Ink)
  doc.setLineWidth(0.55);
  doc.rect(margin, margin, pageWidth - 2 * margin, pageHeight - 2 * margin);

  doc.setDrawColor(148, 163, 184); // Slate-400
  doc.setLineWidth(0.2);
  doc.rect(innerMargin, innerMargin, pageWidth - 2 * innerMargin, pageHeight - 2 * innerMargin);

  // Zone coordinates markers along borders (1..6 / A..D)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);

  const zonesX = ['1', '2', '3', '4', '5', '6'];
  const stepX = (pageWidth - 2 * margin) / 6;
  zonesX.forEach((zone, i) => {
    const xPos = margin + stepX * (i + 0.5);
    doc.text(zone, xPos, margin - 1.2, { align: 'center' });
    doc.text(zone, xPos, pageHeight - margin + 3.2, { align: 'center' });
  });

  const zonesY = ['A', 'B', 'C', 'D'];
  const stepY = (pageHeight - 2 * margin) / 4;
  zonesY.forEach((zone, i) => {
    const yPos = margin + stepY * (i + 0.5);
    doc.text(zone, margin - 2.5, yPos + 1, { align: 'center' });
    doc.text(zone, pageWidth - margin + 2.5, yPos + 1, { align: 'center' });
  });

  // =========================================================================
  // 2. RIGHT-HAND TECHNICAL COLUMN (WIDTH: 86mm)
  // =========================================================================
  const colW = 86;
  const colX = pageWidth - innerMargin - colW;

  // -------------------------------------------------------------------------
  // 2.1 VISTA ISOMÉTRICA 3D (UPPER RIGHT - SEM QUADRO)
  // -------------------------------------------------------------------------
  const isoCenterX = colX + colW / 2;
  const isoCenterY = innerMargin + 28;
  const isoTargetW = colW - 6;
  const isoTargetH = 46;

  let preview3dImg = options.preview3dImage;
  if (!preview3dImg && typeof document !== 'undefined') {
    preview3dImg = render3dIsometricSnapshot(geometry, template, params, thickness) || undefined;
  }

  draw3dIsometricPreview(
    doc,
    geometry,
    template,
    params,
    thickness,
    isoCenterX,
    isoCenterY,
    isoTargetW,
    isoTargetH,
    preview3dImg
  );

  // Subtitle / Reference text under 3D preview
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(15, 23, 42); // Unified Dark Ink
  doc.text('VISTA ISOMÉTRICA 3D', isoCenterX, innerMargin + 56.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.8);
  doc.setTextColor(100, 116, 139); // Slate-500
  doc.text('(Projeção axonométrica de conformação • Sem escala)', isoCenterX, innerMargin + 60, { align: 'center' });

  // -------------------------------------------------------------------------
  // 2.2 DADOS DE PROCESSO CNC & CONFORMAÇÃO (PROPORTIONATE CARD SIZE)
  // -------------------------------------------------------------------------
  const titleY = pageHeight - innerMargin - 45;
  const titleH = 45;

  // Build rows first to compute exact height
  const metrics = geometry.metrics;
  const cutRows = [
    `Dimensões do Blank: ${metrics.blankWidthMm.toFixed(1)} × ${metrics.blankHeightMm.toFixed(1)} mm`,
    `Perímetro de Corte: ${metrics.cutLengthMm.toFixed(1)} mm  •  Piercings: ${metrics.piercingCount}`,
    `Área Líquida: ${(metrics.netAreaMm2 / 100).toFixed(1)} cm²  •  Aproveitamento: ${((metrics.netAreaMm2 / Math.max(1, metrics.grossAreaMm2)) * 100).toFixed(0)}%`,
  ];

  const bendCount = metrics.bendCount || (geometry.bendLines ? geometry.bendLines.length : 0);
  const bendRows: string[] = [
    `Quantidade de Dobras: ${bendCount} linha(s) de conformação`,
  ];
  if (geometry.unfoldingMath) {
    bendRows.push(`Raio Interno (Ri): ${geometry.unfoldingMath.internalRadiusMm.toFixed(1)} mm  •  Fator K: ${geometry.unfoldingMath.kFactor.toFixed(3)}`);
    bendRows.push(`Dedução de Dobra (BD): ${geometry.unfoldingMath.bendDeductionMm.toFixed(2)} mm / dobra`);
  } else if (bendCount > 0) {
    const rawRi = params.innerRadius || 3.0;
    bendRows.push(`Raio Interno Recomendado: Ri = ${rawRi.toFixed(1)} mm`);
    bendRows.push(`Compensação de Chapa: DIN 6935 (K=0.40)`);
  } else {
    bendRows.push(`Componente plano sem operações de dobra.`);
  }

  const reqRows = [
    '1. Tolerâncias dimensionais gerais segundo norma ISO 2768-m.',
    '2. Arestas de corte limpas, sem rebarbas e sem escória residual.',
    '3. Linhas verdes tracejadas indicam a linha de centro de prensa CNC.',
  ];

  // Exact card width and proportional height
  const cardW = 80;
  const cardX = colX + (colW - cardW) / 2;

  const calculatedCardH =
    4.2 +
    2.0 +
    (3.2 + cutRows.length * 3.0) +
    2.0 +
    (3.2 + bendRows.length * 3.0) +
    2.0 +
    (3.2 + reqRows.length * 2.7) +
    2.5;

  const cncCardH = calculatedCardH;

  // Center the card vertically in the gap between 3D view subtitle and Title Block
  const availableGapTop = innerMargin + 62.5;
  const availableGapBottom = titleY - 2.5;
  const availableSpace = availableGapBottom - availableGapTop;
  const cncCardY = availableGapTop + Math.max(1.5, (availableSpace - cncCardH) / 2);

  doc.setFillColor(248, 250, 252); // Slate-50 surface
  doc.rect(cardX, cncCardY, cardW, cncCardH, 'F');
  doc.setDrawColor(203, 213, 225); // Slate-300
  doc.setLineWidth(0.3);
  doc.rect(cardX, cncCardY, cardW, cncCardH);

  // Card Header Banner
  doc.setFillColor(15, 23, 42); // Slate-900 Dark Ink
  doc.rect(cardX, cncCardY, cardW, 4.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.setTextColor(255, 255, 255);
  doc.text('DADOS DE PROCESSO CNC & CONFORMAÇÃO', cardX + cardW / 2, cncCardY + 2.9, { align: 'center' });

  // Section 1: Dados de Corte (Centralizados no painel)
  let curY = cncCardY + 7.0;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.3);
  doc.setTextColor(255, 48, 0); // Unified Accent Brand Red #FF3000
  doc.text('PARÂMETROS DE CORTE (LASER / PLASMA)', cardX + cardW / 2, curY, { align: 'center' });

  curY += 3.3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.0);
  doc.setTextColor(30, 41, 59); // Slate-800
  cutRows.forEach((row) => {
    doc.text(row, cardX + cardW / 2, curY, { align: 'center' });
    curY += 3.0;
  });

  // Divider Line
  curY += 0.6;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(cardX + 6, curY, cardX + cardW - 6, curY);
  curY += 2.8;

  // Section 2: Dados de Dobra / Caldeiraria (Centralizados)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.3);
  doc.setTextColor(22, 163, 74); // Standard Bend Green
  doc.text('PARÂMETROS DE DOBRA (DIN 6935)', cardX + cardW / 2, curY, { align: 'center' });

  curY += 3.3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.0);
  doc.setTextColor(30, 41, 59);
  bendRows.forEach((row) => {
    doc.text(row, cardX + cardW / 2, curY, { align: 'center' });
    curY += 3.0;
  });

  // Divider Line
  curY += 0.6;
  doc.setDrawColor(226, 232, 240);
  doc.line(cardX + 6, curY, cardX + cardW - 6, curY);
  curY += 2.8;

  // Section 3: Normas e Requisitos de Engenharia (Centralizados e ajustados)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.3);
  doc.setTextColor(71, 85, 105); // Slate-600
  doc.text('REQUISITOS GERAIS DE FABRICAÇÃO', cardX + cardW / 2, curY, { align: 'center' });

  curY += 3.1;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.7);
  doc.setTextColor(100, 116, 139);
  reqRows.forEach((row) => {
    doc.text(row, cardX + cardW / 2, curY, { align: 'center' });
    curY += 2.7;
  });

  // -------------------------------------------------------------------------
  // 2.3 INDUSTRIAL TITLE BLOCK (SELO TÉCNICO NORMALIZADO - BOTTOM RIGHT)
  // -------------------------------------------------------------------------
  doc.setFillColor(248, 250, 252);
  doc.rect(colX, titleY, colW, titleH, 'F');
  
  // Title Box Outer Border
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.rect(colX, titleY, colW, titleH);

  // Internal dividing lines
  doc.setLineWidth(0.2);
  doc.setDrawColor(148, 163, 184);
  doc.line(colX, titleY + 11.25, colX + colW, titleY + 11.25);
  doc.line(colX, titleY + 22.5, colX + colW, titleY + 22.5);
  doc.line(colX, titleY + 33.75, colX + colW, titleY + 33.75);
  
  // Vertical column splits
  doc.line(colX + 45, titleY + 11.25, colX + 45, titleY + 33.75);
  doc.line(colX + 66, titleY + 22.5, colX + 66, titleY + titleH);
  doc.line(colX + 35, titleY + 33.75, colX + 35, titleY + titleH);

  // Header Banner inside Title Block
  doc.setFillColor(255, 48, 0); // DXFAST Brand Red #FF3000
  doc.rect(colX, titleY, colW, 3.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(255, 255, 255);
  doc.text('DXFAST • DESENHO TÉCNICO INDUSTRIAL', colX + colW / 2, titleY + 2.7, { align: 'center' });

  // Row 1: Part Name / Code
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.8);
  doc.setTextColor(100, 116, 139);
  doc.text('PEÇA / CÓDIGO DO COMPONENTE:', colX + 3, titleY + 5.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.0);
  doc.setTextColor(15, 23, 42);
  const partCode = options.partName || template.name;
  doc.text(partCode.length > 25 ? partCode.substring(0, 25) + '...' : partCode, colX + 3, titleY + 9.5);

  // Row 2: Modelo Geométrico & Blank Planificado
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.6);
  doc.setTextColor(100, 116, 139);
  doc.text('GEOMETRIA BASE:', colX + 3, titleY + 14.8);
  doc.text('BLANK DESENVOLVIDO:', colX + 47, titleY + 14.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(15, 23, 42);
  doc.text(template.name.length > 15 ? template.name.substring(0, 15) + '..' : template.name, colX + 3, titleY + 19.2);
  doc.text(`${geometry.metrics.blankWidthMm.toFixed(1)} × ${geometry.metrics.blankHeightMm.toFixed(1)} mm`, colX + 47, titleY + 19.2);

  // Row 3: Espessura Nominal, Perímetro de Corte & Tolerância
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.6);
  doc.setTextColor(100, 116, 139);
  doc.text('ESPESSURA (e):', colX + 3, titleY + 26.0);
  doc.text('PERÍMETRO:', colX + 47, titleY + 26.0);
  doc.text('TOLERÂNCIA:', colX + 68, titleY + 26.0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`${thickness.toFixed(2)} mm`, colX + 3, titleY + 30.2);
  doc.text(`${geometry.metrics.cutLengthMm.toFixed(1)} mm`, colX + 47, titleY + 30.2);
  doc.text('ISO 2768-m', colX + 68, titleY + 30.2);

  // Row 4: Data de Emissão, Unidades & Padrão de Projeção
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.6);
  doc.setTextColor(100, 116, 139);
  doc.text('EMISSÃO:', colX + 3, titleY + 37.2);
  doc.text('UNIDADE:', colX + 37, titleY + 37.2);
  doc.text('PROJEÇÃO:', colX + 68, titleY + 37.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  doc.setTextColor(15, 23, 42);
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  doc.text(dateStr, colX + 3, titleY + 41.8);
  doc.text('Milímetros (mm)', colX + 37, titleY + 41.8);
  doc.text('1º DIEDRO (ISO)', colX + 68, titleY + 41.8);

  // =========================================================================
  // 3. MAIN 2D BLANK VIEWPORT - EXPANDED SCALE (LEFT & CENTER CANVAS)
  // =========================================================================
  const drawAreaX = innerMargin + 4;
  const drawAreaY = innerMargin + 4;
  const drawAreaW = colX - drawAreaX - 6; // Expanded ~184mm width
  const drawAreaH = pageHeight - 2 * innerMargin - 8; // ~180mm high

  const centerX = drawAreaX + drawAreaW / 2;
  const centerY = drawAreaY + drawAreaH / 2;

  const bbW = Math.max(10, geometry.boundingBox.width);
  const bbH = Math.max(10, geometry.boundingBox.height);

  // Fit scale with generous space for dimension lines
  const marginFactor = 1.38;
  const scaleX = drawAreaW / (bbW * marginFactor);
  const scaleY = drawAreaH / (bbH * marginFactor);
  const scale = Math.min(scaleX, scaleY, 1.95);

  const transformX = (x: number) => centerX + x * scale;
  const transformY = (y: number) => centerY - y * scale; // Invert CAD Y for PDF

  // View Title / Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(71, 85, 105);
  doc.text('VISTA PRINCIPAL: BLANK PLANIFICADO DESENVOLVIDO (CORTE CNC)', drawAreaX + 2, drawAreaY + 5);

  // A. Draw Outer Polylines (Cut contour - Black solid line 0.45mm with smooth bulged arcs)
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);

  geometry.outerPolylines.forEach((poly) => {
    drawPolylineOnPdf(doc, poly, transformX, transformY);
  });

  // B. Draw Inner Polylines (Cutouts / Slots / Keyways)
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);

  geometry.innerPolylines.forEach((poly) => {
    drawPolylineOnPdf(doc, poly, transformX, transformY);
  });

  // C. Draw Circles (Holes) with Centerlines
  geometry.circles.forEach((circ) => {
    const cx = transformX(circ.center.x);
    const cy = transformY(circ.center.y);
    const r = circ.radius * scale;

    // Circle contour
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);
    doc.circle(cx, cy, r);

    // Center mark cross (Discrete technical red #FF3000 dash)
    doc.setDrawColor(255, 48, 0);
    doc.setLineWidth(0.15);
    doc.setLineDashPattern([1.5, 1], 0);
    doc.line(cx - r - 2.5, cy, cx + r + 2.5, cy);
    doc.line(cx, cy - r - 2.5, cx, cy + r + 2.5);
    doc.setLineDashPattern([], 0); // reset
  });

  // D. Draw Bend Lines (Standard Bend Green dashed lines with parallel label)
  if (geometry.bendLines) {
    geometry.bendLines.forEach((bend: BendLine, idx: number) => {
      const sx = transformX(bend.startX ?? bend.positionX);
      const sy = transformY(bend.startY);
      const ex = transformX(bend.endX ?? bend.positionX);
      const ey = transformY(bend.endY);

      doc.setDrawColor(22, 163, 74); // Green #16A34A
      doc.setLineWidth(0.35);
      doc.setLineDashPattern([2, 1.5], 0);
      doc.line(sx, sy, ex, ey);
      doc.setLineDashPattern([], 0); // Reset solid

      // Calculate line direction and length
      const dx = ex - sx;
      const dy = ey - sy;
      const lineLen = Math.hypot(dx, dy);
      if (lineLen < 0.1) return;

      // Unit vector along the line
      let ux = dx / lineLen;
      let uy = dy / lineLen;

      // Normalize so text is read from bottom-to-top or left-to-right (ISO standard)
      if (uy > 0.0001 || (Math.abs(uy) <= 0.0001 && ux < -0.0001)) {
        ux = -ux;
        uy = -uy;
      }

      const angleDeg = (Math.atan2(-uy, ux) * 180) / Math.PI;

      const nx = -uy;
      const ny = ux;

      const midX = (sx + ex) / 2;
      const midY = (sy + ey) / 2;

      const offsetDist = 3.5;
      const cOffsetX = midX + nx * offsetDist;
      const cOffsetY = midY + ny * offsetDist;

      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(22, 163, 74); // Standard Green
      const bendTag = `DOBRA ${idx + 1}: ${bend.direction} ${bend.angleDeg || 90}° (Ri ${bend.radiusMm || 3}mm)`;
      const textWidth = doc.getTextWidth(bendTag);

      const startX = cOffsetX - (textWidth / 2) * ux;
      const startY = cOffsetY - (textWidth / 2) * uy;

      doc.text(bendTag, startX, startY, { angle: angleDeg });
    });
  }
  // =========================================================================
  // 4. TECHNICAL DIMENSIONING (COTAS ESSENCIAIS - ISO 129 COM LAYOUT UNIVERSAL)
  // =========================================================================
  if (geometry.cotas && geometry.cotas.length > 0) {
    // Metricas reais do rotulo convertidas da escala do PDF (pontos/mm do doc) para mm do modelo
    const charWidthMm = 1.6 / scale;
    const labelHeightMm = 2.6 / scale;

    const laidOutCotas = layoutDimensions(geometry.cotas, geometry.boundingBox, {
      charWidthMm,
      labelHeightMm,
    });

    for (const item of laidOutCotas) {
      if (item.hidden) continue;

      const { cota, role, resolvedOffset } = item;
      const isRef = role === 'reference';

      // Hierarquia visual estrita (ISO 129): primarias com destaque e referencias mais discretas
      const strokeR = isRef ? 148 : 255;
      const strokeG = isRef ? 163 : 48;
      const strokeB = isRef ? 184 : 0;
      const strokeW = isRef ? 0.18 : 0.25;
      const fontSize = isRef ? 5.8 : 7.0;
      const fontStyle = isRef ? 'normal' : 'bold';
      const textColorR = isRef ? 71 : 15;
      const textColorG = isRef ? 85 : 23;
      const textColorB = isRef ? 105 : 42;

      if (cota.orientation === 'horizontal') {
        const isNeg = resolvedOffset < 0;
        const yRefCad = isNeg
          ? Math.min(cota.start.y, cota.end.y)
          : Math.max(cota.start.y, cota.end.y);
        const yLinePdf = transformY(yRefCad + resolvedOffset);
        const yStartPdf = transformY(cota.start.y);
        const yEndPdf = transformY(cota.end.y);
        const x1Pdf = transformX(cota.start.x);
        const x2Pdf = transformX(cota.end.x);
        const minXPdf = Math.min(x1Pdf, x2Pdf);
        const maxXPdf = Math.max(x1Pdf, x2Pdf);

        // Linhas de extensao com folga de 1.2mm da peca
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.15);
        const extGap = isNeg ? -1.2 : 1.2;
        const extOvershoot = isNeg ? 1.5 : -1.5;
        doc.line(x1Pdf, yStartPdf - extGap, x1Pdf, yLinePdf + extOvershoot);
        doc.line(x2Pdf, yEndPdf - extGap, x2Pdf, yLinePdf + extOvershoot);

        // Linha de cota continua
        doc.setDrawColor(strokeR, strokeG, strokeB);
        doc.setLineWidth(strokeW);
        doc.line(minXPdf, yLinePdf, maxXPdf, yLinePdf);
        drawArrowhead(doc, minXPdf, yLinePdf, 'right');
        drawArrowhead(doc, maxXPdf, yLinePdf, 'left');

        // Rotulo de cota
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', fontStyle);
        doc.setTextColor(textColorR, textColorG, textColorB);
        doc.text(cota.label, (minXPdf + maxXPdf) / 2, yLinePdf - 1.2, { align: 'center' });
      } else if (cota.orientation === 'vertical') {
        const isNeg = resolvedOffset < 0;
        const xRefCad = isNeg
          ? Math.min(cota.start.x, cota.end.x)
          : Math.max(cota.start.x, cota.end.x);
        const xLinePdf = transformX(xRefCad + resolvedOffset);
        const xStartPdf = transformX(cota.start.x);
        const xEndPdf = transformX(cota.end.x);
        const y1Pdf = transformY(cota.start.y);
        const y2Pdf = transformY(cota.end.y);
        const minYPdf = Math.min(y1Pdf, y2Pdf);
        const maxYPdf = Math.max(y1Pdf, y2Pdf);

        // Linhas de extensao com folga de 1.2mm da peca
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.15);
        const extGap = isNeg ? -1.2 : 1.2;
        const extOvershoot = isNeg ? -1.5 : 1.5;
        doc.line(xStartPdf + extGap, y1Pdf, xLinePdf + extOvershoot, y1Pdf);
        doc.line(xEndPdf + extGap, y2Pdf, xLinePdf + extOvershoot, y2Pdf);

        // Linha de cota continua
        doc.setDrawColor(strokeR, strokeG, strokeB);
        doc.setLineWidth(strokeW);
        doc.line(xLinePdf, minYPdf, xLinePdf, maxYPdf);
        drawArrowhead(doc, xLinePdf, minYPdf, 'down');
        drawArrowhead(doc, xLinePdf, maxYPdf, 'up');

        // Rotulo de cota
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', fontStyle);
        doc.setTextColor(textColorR, textColorG, textColorB);
        const textDist = isNeg ? -1.5 : 1.5;
        const textAlign = isNeg ? 'right' : 'left';
        doc.text(cota.label, xLinePdf + textDist, (minYPdf + maxYPdf) / 2 + 1.0, { align: textAlign });
      } else if (cota.orientation === 'aligned') {
        const dx = cota.end.x - cota.start.x;
        const dy = cota.end.y - cota.start.y;
        const len = Math.hypot(dx, dy);
        if (len >= 1e-4) {
          const nx = -dy / len;
          const ny = dx / len;
          const p1CadX = cota.start.x + nx * resolvedOffset;
          const p1CadY = cota.start.y + ny * resolvedOffset;
          const p2CadX = cota.end.x + nx * resolvedOffset;
          const p2CadY = cota.end.y + ny * resolvedOffset;

          const p1PdfX = transformX(p1CadX);
          const p1PdfY = transformY(p1CadY);
          const p2PdfX = transformX(p2CadX);
          const p2PdfY = transformY(p2CadY);

          // Linhas de extensao
          doc.setDrawColor(148, 163, 184);
          doc.setLineWidth(0.15);
          doc.line(transformX(cota.start.x), transformY(cota.start.y), p1PdfX, p1PdfY);
          doc.line(transformX(cota.end.x), transformY(cota.end.y), p2PdfX, p2PdfY);

          // Linha de cota
          doc.setDrawColor(strokeR, strokeG, strokeB);
          doc.setLineWidth(strokeW);
          doc.line(p1PdfX, p1PdfY, p2PdfX, p2PdfY);

          // Rotulo
          doc.setFontSize(fontSize);
          doc.setFont('helvetica', fontStyle);
          doc.setTextColor(textColorR, textColorG, textColorB);
          const midPdfX = (p1PdfX + p2PdfX) / 2;
          const midPdfY = (p1PdfY + p2PdfY) / 2;
          doc.text(cota.label, midPdfX, midPdfY - 1.2, { align: 'center' });
        }
      } else if (cota.type === 'diameter' || cota.type === 'radius') {
        const pStart = cota.start;
        const pEnd = cota.end;
        const angleRad = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);

        const elbowCadX = pEnd.x + (resolvedOffset || 20) * Math.cos(angleRad);
        const elbowCadY = pEnd.y + (resolvedOffset || 20) * Math.sin(angleRad);
        const elbowPdfX = transformX(elbowCadX);
        const elbowPdfY = transformY(elbowCadY);

        doc.setFontSize(fontSize);
        doc.setFont('helvetica', fontStyle);
        const textW = doc.getTextWidth(cota.label);
        const shoulderDir = Math.cos(angleRad) >= 0 ? 1 : -1;
        const shoulderPdfX = elbowPdfX + shoulderDir * (textW + 3);

        const ptPdfX = transformX(pEnd.x);
        const ptPdfY = transformY(pEnd.y);

        doc.setDrawColor(strokeR, strokeG, strokeB);
        doc.setLineWidth(strokeW);
        doc.line(ptPdfX, ptPdfY, elbowPdfX, elbowPdfY);
        doc.line(elbowPdfX, elbowPdfY, shoulderPdfX, elbowPdfY);

        doc.setFillColor(strokeR, strokeG, strokeB);
        doc.circle(ptPdfX, ptPdfY, 0.35, 'FD');

        doc.setTextColor(textColorR, textColorG, textColorB);
        const textXPdf = shoulderDir > 0 ? elbowPdfX + 1.2 : shoulderPdfX + 1.2;
        doc.text(cota.label, textXPdf, elbowPdfY - 1.2);
      }
    }
  }
  return doc;
}

/**
 * Samples arc points for 2D profile cross section with rounded bend fillets
 */
function sampleArcPoints(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  steps = 4
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (i / steps) * (endAngle - startAngle);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

/**
 * Renders a clean, frameless 3D isometric preview of the folded profile or plate.
 * Uses the high-resolution Three.js shaded snapshot when available, or a clean solid vector fallback.
 */
function draw3dIsometricPreview(
  doc: jsPDF,
  geometry: GeometryResult,
  template: TemplateDefinition,
  params: Record<string, number>,
  thickness: number,
  centerX: number,
  centerY: number,
  targetWidth: number,
  targetHeight: number,
  preview3dImage?: string
) {
  // If high-resolution shaded 3D snapshot is available, embed it directly
  if (preview3dImage) {
    const imgW = targetWidth;
    const imgH = targetHeight;
    const imgX = centerX - imgW / 2;
    const imgY = centerY - imgH / 2;
    try {
      doc.addImage(preview3dImage, 'PNG', imgX, imgY, imgW, imgH, undefined, 'FAST');
      return;
    } catch (e) {
      console.warn('Failed to embed 3D snapshot in PDF, using solid vector fallback:', e);
    }
  }

  const t = Math.max(0.5, thickness);
  const Ri = Math.max(0.2 * t, params.innerRadius ?? 3.0);
  const Ro = Ri + t;
  const isBentProfile = template.category === 'bent_profile' || (geometry.bendLines && geometry.bendLines.length > 0);

  // Isometric projection vectors (Axonometric Engineering Angle)
  const radX = (20 * Math.PI) / 180;
  const radZ = (35 * Math.PI) / 180;

  const project3D = (x: number, y: number, z: number, s: number, ox: number, oy: number) => {
    const px = ox + (x * Math.cos(radX) + z * Math.cos(radZ)) * s;
    const py = oy - (y * 0.95 - x * Math.sin(radX) + z * Math.sin(radZ)) * s;
    return { x: px, y: py };
  };

  if (isBentProfile) {
    const bendAngle = Math.max(15, Math.min(165, params.bendAngle ?? 90));
    const alpha = (bendAngle * Math.PI) / 180;
    const osb = Math.tan(alpha / 2) * Ro;
    const length = Math.max(20, params.lengthL || params.length || 200);

    const crossSection: { x: number; y: number }[] = [];

    if (template.id === 'profile_u') {
      let fA = Math.max(osb + 1, params.flangeA || 50);
      let fB = Math.max(2 * osb + 2, params.flangeB || 100);
      let fC = Math.max(osb + 1, params.flangeC || 50);

      if (alpha > Math.PI / 2) {
        const cosFactor = -Math.cos(alpha);
        const maxInward = Math.max(8, fB - 2 * t - 2);
        const maxCombined = maxInward / cosFactor;
        const maxSingle = (fB - t - 2) / cosFactor;
        if ((fA + fC) > maxCombined || fA > maxSingle || fC > maxSingle) {
          const scale = Math.min(1, maxCombined / (fA + fC));
          fA = Math.min(maxSingle, Math.max(osb + 1, fA * scale));
          fC = Math.min(maxSingle, Math.max(osb + 1, fC * scale));
        }
      }

      const uAx = -Math.cos(alpha);
      const uAy = Math.sin(alpha);
      const nAx = Math.sin(alpha);
      const nAy = Math.cos(alpha);

      const uCx = Math.cos(alpha);
      const uCy = Math.sin(alpha);
      const nCx = -Math.sin(alpha);
      const nCy = Math.cos(alpha);

      const p1 = { x: fA * uAx, y: fA * uAy };
      const p2 = { x: osb * uAx, y: osb * uAy };
      const arc1Out = sampleArcPoints(osb, Ro, Ro, 1.5 * Math.PI - alpha, 1.5 * Math.PI, 4);
      const p4 = { x: fB - osb, y: 0 };
      const arc2Out = sampleArcPoints(fB - osb, Ro, Ro, 1.5 * Math.PI, 1.5 * Math.PI + alpha, 4);
      const p6 = { x: fB + fC * uCx, y: fC * uCy };
      const p7 = { x: p6.x + t * nCx, y: p6.y + t * nCy };
      const p8 = { x: fB - osb + osb * uCx + t * nCx, y: osb * uCy + t * nCy };
      const arc2In = sampleArcPoints(fB - osb, Ro, Ri, 1.5 * Math.PI + alpha, 1.5 * Math.PI, 4);
      const p10 = { x: osb, y: t };
      const arc1In = sampleArcPoints(osb, Ro, Ri, 1.5 * Math.PI, 1.5 * Math.PI - alpha, 4);
      const p12 = { x: p1.x + t * nAx, y: p1.y + t * nAy };

      crossSection.push(p1, p2, ...arc1Out, p4, ...arc2Out, p6, p7, p8, ...arc2In, p10, ...arc1In, p12);
    } else if (template.id === 'profile_l') {
      const fA = Math.max(osb + 1, params.flangeA || 50);
      const fB = Math.max(osb + 1, params.flangeB || 50);

      const uAx = -Math.cos(alpha);
      const uAy = Math.sin(alpha);
      const nAx = Math.sin(alpha);
      const nAy = Math.cos(alpha);

      const p1 = { x: fA * uAx, y: fA * uAy };
      const p2 = { x: osb * uAx, y: osb * uAy };
      const arc1Out = sampleArcPoints(osb, Ro, Ro, 1.5 * Math.PI - alpha, 1.5 * Math.PI, 4);
      const p4 = { x: fB, y: 0 };
      const p5 = { x: fB, y: t };
      const p6 = { x: osb, y: t };
      const arc1In = sampleArcPoints(osb, Ro, Ri, 1.5 * Math.PI, 1.5 * Math.PI - alpha, 4);
      const p8 = { x: p1.x + t * nAx, y: p1.y + t * nAy };

      crossSection.push(p1, p2, ...arc1Out, p4, p5, p6, ...arc1In, p8);
    } else if (template.id === 'profile_z') {
      const fA = Math.max(osb + 1, params.flangeA || 40);
      const fB = Math.max(2 * osb + 2, params.flangeB || 120);
      const fC = Math.max(osb + 1, params.flangeC || 40);

      // Top Flange A extends left (-X) at Y = fB
      crossSection.push({ x: -fA, y: fB });
      crossSection.push({ x: -osb, y: fB });
      crossSection.push(...sampleArcPoints(-osb, fB - Ro, Ro, 0.5 * Math.PI, 0, 4));
      crossSection.push({ x: 0, y: Ro });
      crossSection.push(...sampleArcPoints(osb, Ro, Ro, Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: fC, y: 0 });
      crossSection.push({ x: fC, y: t });
      crossSection.push({ x: osb, y: t });
      crossSection.push(...sampleArcPoints(osb, Ro, Ri, 1.5 * Math.PI, Math.PI, 4));
      crossSection.push({ x: -t, y: fB - Ro });
      crossSection.push(...sampleArcPoints(-osb, fB - Ro, Ri, 0, 0.5 * Math.PI, 4));
      crossSection.push({ x: -fA, y: fB - t });
    } else if (template.id === 'profile_hat') {
      const a = Math.max(8, params.flangeA || 25);
      const b = Math.max(10, params.flangeB || 40);
      const c = Math.max(15, params.flangeC || 80);

      crossSection.push({ x: -c / 2 - a, y: 0 });
      crossSection.push({ x: -c / 2 - Ro, y: 0 });
      crossSection.push(...sampleArcPoints(-c / 2 - Ro, Ro, Ri, 1.5 * Math.PI, 2 * Math.PI, 4));
      crossSection.push({ x: -c / 2, y: b - Ro });
      crossSection.push(...sampleArcPoints(-c / 2 + Ro, b - Ro, Ro, Math.PI, 0.5 * Math.PI, 4));
      crossSection.push({ x: c / 2 - Ro, y: b });
      crossSection.push(...sampleArcPoints(c / 2 - Ro, b - Ro, Ro, 0.5 * Math.PI, 0, 4));
      crossSection.push({ x: c / 2, y: Ro });
      crossSection.push(...sampleArcPoints(c / 2 + Ro, Ro, Ri, Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: c / 2 + a, y: 0 });
      crossSection.push({ x: c / 2 + a, y: t });
      crossSection.push({ x: c / 2 + Ro, y: t });
      crossSection.push(...sampleArcPoints(c / 2 + Ro, Ro, Ro, 1.5 * Math.PI, Math.PI, 4));
      crossSection.push({ x: c / 2 - t, y: b - Ro });
      crossSection.push(...sampleArcPoints(c / 2 - Ro, b - Ro, Ri, 0, 0.5 * Math.PI, 4));
      crossSection.push({ x: -c / 2 + Ro, y: b - t });
      crossSection.push(...sampleArcPoints(-c / 2 + Ro, b - Ro, Ri, 0.5 * Math.PI, Math.PI, 4));
      crossSection.push({ x: -c / 2 - t, y: Ro });
      crossSection.push(...sampleArcPoints(-c / 2 - Ro, Ro, Ro, 2 * Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: -c / 2 - a, y: t });
    } else if (template.id === 'gate_guide_u') {
      const isSymmetric = (params.symmetric ?? 1) !== 0;
      const fA = Math.max(2 * Ro + 2 * t, params.baseA ?? 80);
      const fBL = Math.max(osb + 2, isSymmetric ? (params.webB ?? 80) : (params.webB_left ?? 80));
      const fBR = Math.max(osb + 2, isSymmetric ? (params.webB ?? 80) : (params.webB_right ?? 80));
      const fCL = Math.max(10, isSymmetric ? (params.flareC ?? 50) : (params.flareC_left ?? 50));
      const fCR = Math.max(10, isSymmetric ? (params.flareC ?? 50) : (params.flareC_right ?? 50));
      const flareAngleL = Math.min(75, Math.max(10, isSymmetric ? (params.flareAngle ?? 45) : (params.flareAngle_left ?? 45)));
      const flareAngleR = Math.min(75, Math.max(10, isSymmetric ? (params.flareAngle ?? 45) : (params.flareAngle_right ?? 45)));
      const alphaL = (flareAngleL * Math.PI) / 180;
      const alphaR = (flareAngleR * Math.PI) / 180;
      const sb1L = Math.tan(alphaL / 2) * Ri;
      const sb1R = Math.tan(alphaR / 2) * Ri;

      const c1x = -fA / 2 - Ri;
      const c1y = fBL - sb1L;
      const c2x = -fA / 2 + Ro;
      const c2y = Ro;
      const c3x = fA / 2 - Ro;
      const c3y = Ro;
      const c4x = fA / 2 + Ri;
      const c4y = fBR - sb1R;

      const L_seg_L = Math.max(2, fCL - sb1L);
      const tan1_lip_x = c1x + Ri * Math.cos(alphaL);
      const tan1_lip_y = c1y + Ri * Math.sin(alphaL);
      const tip_L_out_x = tan1_lip_x - L_seg_L * Math.sin(alphaL);
      const tip_L_out_y = tan1_lip_y + L_seg_L * Math.cos(alphaL);
      const tip_L_in_x = tip_L_out_x + t * Math.cos(alphaL);
      const tip_L_in_y = tip_L_out_y + t * Math.sin(alphaL);

      const L_seg_R = Math.max(2, fCR - sb1R);
      const tan4_lip_x = c4x - Ri * Math.cos(alphaR);
      const tan4_lip_y = c4y + Ri * Math.sin(alphaR);
      const tip_R_out_x = tan4_lip_x + L_seg_R * Math.sin(alphaR);
      const tip_R_out_y = tan4_lip_y + L_seg_R * Math.cos(alphaR);
      const tip_R_in_x = tip_R_out_x - t * Math.cos(alphaR);
      const tip_R_in_y = tip_R_out_y + t * Math.sin(alphaR);

      crossSection.push({ x: tip_L_out_x, y: tip_L_out_y });
      crossSection.push({ x: tan1_lip_x, y: tan1_lip_y });
      crossSection.push(...sampleArcPoints(c1x, c1y, Ri, alphaL, 0, 4));
      crossSection.push({ x: -fA / 2, y: c2y });
      crossSection.push(...sampleArcPoints(c2x, c2y, Ro, Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: c3x, y: 0 });
      crossSection.push(...sampleArcPoints(c3x, c3y, Ro, 1.5 * Math.PI, 2.0 * Math.PI, 4));
      crossSection.push({ x: fA / 2, y: c4y });
      crossSection.push(...sampleArcPoints(c4x, c4y, Ri, Math.PI, Math.PI - alphaR, 4));
      crossSection.push({ x: tip_R_out_x, y: tip_R_out_y });
      crossSection.push({ x: tip_R_in_x, y: tip_R_in_y });
      crossSection.push({ x: c4x - Ro * Math.cos(alphaR), y: c4y + Ro * Math.sin(alphaR) });
      crossSection.push(...sampleArcPoints(c4x, c4y, Ro, Math.PI - alphaR, Math.PI, 4));
      crossSection.push({ x: fA / 2 - t, y: c3y });
      crossSection.push(...sampleArcPoints(c3x, c3y, Ri, 2.0 * Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: c2x, y: t });
      crossSection.push(...sampleArcPoints(c2x, c2y, Ri, 1.5 * Math.PI, Math.PI, 4));
      crossSection.push({ x: -fA / 2 + t, y: c1y });
      crossSection.push(...sampleArcPoints(c1x, c1y, Ro, 0, alphaL, 4));
      crossSection.push({ x: tip_L_in_x, y: tip_L_in_y });
    } else if (template.id === 'lambril_z') {
      const rawFaceA = params.faceA ?? 95;
      const rawStepB = params.stepB ?? 20;
      const linkLip = (params.linkLipToStep ?? 1) !== 0;
      const rawLipD = linkLip ? rawStepB : (params.lipD ?? 20);
      const equalFaces = (params.equalFaces ?? 0) !== 0;
      const rawFaceC = equalFaces ? rawFaceA : (params.faceC ?? 95);

      const minStraightFace = 2 * (Ri + t);
      const minLip = (Ri + t) + 2 * t;

      const fA = Math.max(minStraightFace, rawFaceA);
      const fB = Math.max(minStraightFace, rawStepB);
      const fC = Math.max(minStraightFace, rawFaceC);
      const fD = Math.max(minLip, rawLipD);

      const c1x = Ro;
      const c1y = fB - Ro;
      const c2x = fA - Ro;
      const c2y = fB - Ro;
      const c3x = fA + Ri;
      const c3y = t + Ri;
      const c4x = fA + fC - Ro;
      const c4y = Ro;

      crossSection.push({ x: 0, y: fB - fD });
      crossSection.push({ x: 0, y: fB - Ro });
      crossSection.push(...sampleArcPoints(c1x, c1y, Ro, Math.PI, Math.PI / 2, 4));
      crossSection.push({ x: fA - Ro, y: fB });
      crossSection.push(...sampleArcPoints(c2x, c2y, Ro, Math.PI / 2, 0, 4));
      crossSection.push({ x: fA, y: t + Ri });
      crossSection.push(...sampleArcPoints(c3x, c3y, Ri, Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: fA + fC - Ro, y: t });
      crossSection.push(...sampleArcPoints(c4x, c4y, Ri, 1.5 * Math.PI, 2 * Math.PI, 4));
      crossSection.push({ x: fA + fC - t, y: fD });
      crossSection.push({ x: fA + fC, y: fD });
      crossSection.push({ x: fA + fC, y: Ro });
      crossSection.push(...sampleArcPoints(c4x, c4y, Ro, 2 * Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: fA + Ri, y: 0 });
      crossSection.push(...sampleArcPoints(c3x, c3y, Ro, 1.5 * Math.PI, Math.PI, 4));
      crossSection.push({ x: fA - t, y: fB - Ro });
      crossSection.push(...sampleArcPoints(c2x, c2y, Ri, 0, Math.PI / 2, 4));
      crossSection.push({ x: Ro, y: fB - t });
      crossSection.push(...sampleArcPoints(c1x, c1y, Ri, Math.PI / 2, Math.PI, 4));
      crossSection.push({ x: t, y: fB - fD });
    } else if (template.id === 'gate_weight_box') {
      const rawHeightA = params.heightA ?? 150;
      const isSquare = (params.squareSection ?? 0) !== 0;
      const rawWidthB = isSquare ? rawHeightA : (params.widthB ?? 100);
      const seamGap = Math.max(0, Math.min(10, params.seamGap ?? 1.0));

      const minStraightFace = 2 * (Ri + t) + 4;
      const fA = Math.max(minStraightFace, rawHeightA);
      const fB = Math.max(minStraightFace, rawWidthB);

      const c1x = Ro;
      const c1y = fA - Ro;
      const c2x = Ro;
      const c2y = Ro;
      const c3x = fB - Ro;
      const c3y = Ro;
      const c4x = fB - Ro;
      const c4y = fA - Ro;

      // Emenda sempre no centro da Face B
      const halfGap = seamGap / 2;
      const seamX = fB / 2;
      crossSection.push({ x: seamX + halfGap, y: fA });
      crossSection.push({ x: fB - Ro, y: fA });
      crossSection.push(...sampleArcPoints(c4x, c4y, Ro, Math.PI / 2, 0, 4));
      crossSection.push({ x: fB, y: Ro });
      crossSection.push(...sampleArcPoints(c3x, c3y, Ro, 0, -Math.PI / 2, 4));
      crossSection.push({ x: Ro, y: 0 });
      crossSection.push(...sampleArcPoints(c2x, c2y, Ro, 1.5 * Math.PI, Math.PI, 4));
      crossSection.push({ x: 0, y: fA - Ro });
      crossSection.push(...sampleArcPoints(c1x, c1y, Ro, Math.PI, Math.PI / 2, 4));
      crossSection.push({ x: seamX - halfGap, y: fA });
      crossSection.push({ x: seamX - halfGap, y: fA - t });
      crossSection.push({ x: Ro, y: fA - t });
      crossSection.push(...sampleArcPoints(c1x, c1y, Ri, Math.PI / 2, Math.PI, 4));
      crossSection.push({ x: t, y: Ro });
      crossSection.push(...sampleArcPoints(c2x, c2y, Ri, Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: fB - Ro, y: t });
      crossSection.push(...sampleArcPoints(c3x, c3y, Ri, 1.5 * Math.PI, 2 * Math.PI, 4));
      crossSection.push({ x: fB - t, y: fA - Ro });
      crossSection.push(...sampleArcPoints(c4x, c4y, Ri, 0, Math.PI / 2, 4));
      crossSection.push({ x: seamX + halfGap, y: fA - t });
    } else {
      const w = Math.max(20, (geometry.metrics.blankWidthMm || 100) / 3);
      const h = Math.max(15, w * 0.6);
      crossSection.push({ x: -w / 2, y: h });
      crossSection.push({ x: -w / 2, y: Ro });
      crossSection.push(...sampleArcPoints(-w / 2 + Ro, Ro, Ro, Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: w / 2 - Ro, y: 0 });
      crossSection.push(...sampleArcPoints(w / 2 - Ro, Ro, Ro, 1.5 * Math.PI, 2 * Math.PI, 4));
      crossSection.push({ x: w / 2, y: h });
      crossSection.push({ x: w / 2 - t, y: h });
      crossSection.push({ x: w / 2 - t, y: Ro });
      crossSection.push(...sampleArcPoints(w / 2 - Ro, Ro, Ri, 2 * Math.PI, 1.5 * Math.PI, 4));
      crossSection.push({ x: -w / 2 + Ro, y: t });
      crossSection.push(...sampleArcPoints(-w / 2 + Ro, Ro, Ri, 1.5 * Math.PI, Math.PI, 4));
      crossSection.push({ x: -w / 2 + t, y: h });
    }

    let minPx = Infinity;
    let maxPx = -Infinity;
    let minPy = Infinity;
    let maxPy = -Infinity;

    crossSection.forEach((pt) => {
      [0, length].forEach((z) => {
        const p = project3D(pt.x, pt.y, z, 1.0, 0, 0);
        if (p.x < minPx) minPx = p.x;
        if (p.x > maxPx) maxPx = p.x;
        if (p.y < minPy) minPy = p.y;
        if (p.y > maxPy) maxPy = p.y;
      });
    });

    const rawW = Math.max(1, maxPx - minPx);
    const rawH = Math.max(1, maxPy - minPy);
    const scaleIso = Math.min(targetWidth / rawW, targetHeight / rawH) * 0.92;

    const rawMidX = ((minPx + maxPx) / 2) * scaleIso;
    const rawMidY = ((minPy + maxPy) / 2) * scaleIso;
    const originX = centerX - rawMidX;
    const originY = centerY - rawMidY;

    const proj = (x: number, y: number, z: number) => project3D(x, y, z, scaleIso, originX, originY);

    // 1. Longitudinal Solid Faces with clean shading and back-face culling
    for (let i = 0; i < crossSection.length; i++) {
      const p1 = crossSection[i];
      const p2 = crossSection[(i + 1) % crossSection.length];

      const q1 = proj(p1.x, p1.y, 0);
      const q2 = proj(p2.x, p2.y, 0);
      const q3 = proj(p2.x, p2.y, length);
      const q4 = proj(p1.x, p1.y, length);

      const area = (q2.x - q1.x) * (q3.y - q1.y) - (q2.y - q1.y) * (q3.x - q1.x);
      if (area < 0) {
        // Front-facing visible longitudinal face
        doc.setFillColor(241, 245, 249); // Clean sheet surface
        doc.setDrawColor(148, 163, 184);
        doc.setLineWidth(0.18);
        doc.line(q1.x, q1.y, q2.x, q2.y);
        doc.line(q2.x, q2.y, q3.x, q3.y);
        doc.line(q3.x, q3.y, q4.x, q4.y);
        doc.line(q4.x, q4.y, q1.x, q1.y);
      }
    }

    // 2. Back End Face
    doc.setFillColor(226, 232, 240);
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.2);
    for (let i = 0; i < crossSection.length; i++) {
      const p1 = proj(crossSection[i].x, crossSection[i].y, length);
      const p2 = proj(crossSection[(i + 1) % crossSection.length].x, crossSection[(i + 1) % crossSection.length].y, length);
      doc.line(p1.x, p1.y, p2.x, p2.y);
    }

    // 3. Longitudinal Edges (Key feature lines along length)
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.3);
    crossSection.forEach((pt) => {
      const startPt = proj(pt.x, pt.y, 0);
      const endPt = proj(pt.x, pt.y, length);
      doc.line(startPt.x, startPt.y, endPt.x, endPt.y);
    });

    // 4. Front Profile Cross-Section
    doc.setFillColor(203, 213, 225);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.4);
    for (let i = 0; i < crossSection.length; i++) {
      const p1 = proj(crossSection[i].x, crossSection[i].y, 0);
      const p2 = proj(crossSection[(i + 1) % crossSection.length].x, crossSection[(i + 1) % crossSection.length].y, 0);
      doc.line(p1.x, p1.y, p2.x, p2.y);
    }

    // 5. 3D Face Holes & Cutouts positioned accurately on folded faces
    if (geometry.circles && geometry.circles.length > 0) {
      const totalW = geometry.metrics.blankWidthMm || 200;
      const b1Global = geometry.faceSections?.[0]?.endXBlankMm ?? -totalW / 6;
      const b2Global = geometry.faceSections?.[1]?.endXBlankMm ?? totalW / 6;

      const uAx = -Math.cos(alpha);
      const uAy = Math.sin(alpha);
      const nAx = Math.sin(alpha);
      const nAy = Math.cos(alpha);

      const uCx = Math.cos(alpha);
      const uCy = Math.sin(alpha);
      const nCx = -Math.sin(alpha);
      const nCy = Math.cos(alpha);

      const fA = Math.max(osb + 1, params.flangeA || 50);
      const fB = Math.max(2 * osb + 2, params.flangeB || 100);
      const fC = Math.max(osb + 1, params.flangeC || 50);

      geometry.circles.forEach((circ) => {
        if (circ.radius <= 0.5) return;
        const zCenter = circ.center.y + length / 2;

        const pts3d: { x: number; y: number; z: number }[] = [];
        const numPts = 16;

        if (template.id === 'profile_u') {
          if (circ.center.x >= b1Global - 1 && circ.center.x <= b2Global + 1) {
            // Hole is on Web Alma B (Horizontal bottom web face at Y = t)
            const u = (circ.center.x - b1Global) / Math.max(1, b2Global - b1Global);
            const cx3d = osb + u * (fB - 2 * osb);
            const cy3d = t;
            for (let i = 0; i < numPts; i++) {
              const a = (i / numPts) * 2 * Math.PI;
              pts3d.push({
                x: cx3d + circ.radius * Math.cos(a),
                y: cy3d,
                z: zCenter + circ.radius * Math.sin(a),
              });
            }
          } else if (circ.center.x < b1Global - 1) {
            // Hole is on Flange Aba A
            const u = (b1Global - circ.center.x) / Math.max(1, b1Global - (-totalW / 2));
            const dist = u * (fA - osb);
            const baseX = osb * uAx + t * nAx;
            const baseY = osb * uAy + t * nAy;
            const cx3d = baseX + dist * uAx;
            const cy3d = baseY + dist * uAy;
            for (let i = 0; i < numPts; i++) {
              const a = (i / numPts) * 2 * Math.PI;
              pts3d.push({
                x: cx3d + circ.radius * Math.cos(a) * uAx,
                y: cy3d + circ.radius * Math.cos(a) * uAy,
                z: zCenter + circ.radius * Math.sin(a),
              });
            }
          } else {
            // Hole is on Flange Aba C
            const u = (circ.center.x - b2Global) / Math.max(1, totalW / 2 - b2Global);
            const dist = u * (fC - osb);
            const baseX = fB - osb + osb * uCx + t * nCx;
            const baseY = osb * uCy + t * nCy;
            const cx3d = baseX + dist * uCx;
            const cy3d = baseY + dist * uCy;
            for (let i = 0; i < numPts; i++) {
              const a = (i / numPts) * 2 * Math.PI;
              pts3d.push({
                x: cx3d + circ.radius * Math.cos(a) * uCx,
                y: cy3d + circ.radius * Math.cos(a) * uCy,
                z: zCenter + circ.radius * Math.sin(a),
              });
            }
          }
        } else if (template.id === 'profile_l') {
          if (circ.center.x > b1Global) {
            // On Aba B (Bottom horizontal flange)
            const u = (circ.center.x - b1Global) / Math.max(1, totalW / 2 - b1Global);
            const cx3d = osb + u * (fB - osb);
            for (let i = 0; i < numPts; i++) {
              const a = (i / numPts) * 2 * Math.PI;
              pts3d.push({
                x: cx3d + circ.radius * Math.cos(a),
                y: t,
                z: zCenter + circ.radius * Math.sin(a),
              });
            }
          } else {
            // On Aba A (Slanted flange)
            const u = (b1Global - circ.center.x) / Math.max(1, b1Global - (-totalW / 2));
            const dist = u * (fA - osb);
            const cx3d = (osb + dist) * uAx + t * nAx;
            const cy3d = (osb + dist) * uAy + t * nAy;
            for (let i = 0; i < numPts; i++) {
              const a = (i / numPts) * 2 * Math.PI;
              pts3d.push({
                x: cx3d + circ.radius * Math.cos(a) * uAx,
                y: cy3d + circ.radius * Math.cos(a) * uAy,
                z: zCenter + circ.radius * Math.sin(a),
              });
            }
          }
        } else {
          // General bent profile face hole
          const cx3d = osb + (fB / 2);
          for (let i = 0; i < numPts; i++) {
            const a = (i / numPts) * 2 * Math.PI;
            pts3d.push({
              x: cx3d + circ.radius * Math.cos(a),
              y: t,
              z: zCenter + circ.radius * Math.sin(a),
            });
          }
        }

        if (pts3d.length > 2) {
          doc.setDrawColor(15, 23, 42);
          doc.setLineWidth(0.25);
          for (let i = 0; i < pts3d.length; i++) {
            const p1 = proj(pts3d[i].x, pts3d[i].y, pts3d[i].z);
            const p2 = proj(pts3d[(i + 1) % pts3d.length].x, pts3d[(i + 1) % pts3d.length].y, pts3d[(i + 1) % pts3d.length].z);
            doc.line(p1.x, p1.y, p2.x, p2.y);
          }
        }
      });
    }

    // 6. 3D Face Slots (Oblong cutouts)
    if (geometry.innerPolylines && geometry.innerPolylines.length > 0) {
      const totalW = geometry.metrics.blankWidthMm || 200;
      const b1Global = geometry.faceSections?.[0]?.endXBlankMm ?? -totalW / 6;
      const b2Global = geometry.faceSections?.[1]?.endXBlankMm ?? totalW / 6;
      const fB = Math.max(2 * osb + 2, params.flangeB || 100);

      geometry.innerPolylines.forEach((poly) => {
        const polyPts = samplePolylinePoints(poly, 12);
        if (polyPts.length < 3) return;

        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.25);

        for (let i = 0; i < polyPts.length; i++) {
          const pt1 = polyPts[i];
          const pt2 = polyPts[(i + 1) % polyPts.length];

          const u1 = (pt1.x - b1Global) / Math.max(1, b2Global - b1Global);
          const u2 = (pt2.x - b1Global) / Math.max(1, b2Global - b1Global);

          const x1 = osb + u1 * (fB - 2 * osb);
          const z1 = pt1.y + length / 2;

          const x2 = osb + u2 * (fB - 2 * osb);
          const z2 = pt2.y + length / 2;

          const p1 = proj(x1, t, z1);
          const p2 = proj(x2, t, z2);
          doc.line(p1.x, p1.y, p2.x, p2.y);
        }
      });
    }
  } else {
    // =========================================================================
    // TRUE 3D EXTRUSION OF 2D FLAT PLATE / FLANGE / KEYWAY / WASHER / POLYGON
    // =========================================================================
    let contour2D: { x: number; y: number }[] = [];

    if (geometry.outerPolylines && geometry.outerPolylines.length > 0) {
      contour2D = samplePolylinePoints(geometry.outerPolylines[0], 16);
    } else {
      const w = Math.max(20, geometry.boundingBox.width);
      const h = Math.max(20, geometry.boundingBox.height);
      contour2D = [
        { x: -w / 2, y: -h / 2 },
        { x: w / 2, y: -h / 2 },
        { x: w / 2, y: h / 2 },
        { x: -w / 2, y: h / 2 },
      ];
    }

    if (contour2D.length < 3) return;

    // Shift CAD Y to Z-axis in 3D: (X = CAD X, Y = thickness (height), Z = CAD Y + bbH/2)
    const bbH = Math.max(10, geometry.boundingBox.height);
    const pts3D = contour2D.map((p) => ({
      x: p.x,
      z: p.y + bbH / 2,
    }));

    // Find 3D Isometric extents
    let minPx = Infinity;
    let maxPx = -Infinity;
    let minPy = Infinity;
    let maxPy = -Infinity;

    pts3D.forEach((pt) => {
      [0, t].forEach((yLevel) => {
        const p = project3D(pt.x, yLevel, pt.z, 1.0, 0, 0);
        if (p.x < minPx) minPx = p.x;
        if (p.x > maxPx) maxPx = p.x;
        if (p.y < minPy) minPy = p.y;
        if (p.y > maxPy) maxPy = p.y;
      });
    });

    const rawW = Math.max(1, maxPx - minPx);
    const rawH = Math.max(1, maxPy - minPy);
    const scaleIso = Math.min(targetWidth / rawW, targetHeight / rawH) * 0.90;

    const rawMidX = ((minPx + maxPx) / 2) * scaleIso;
    const rawMidY = ((minPy + maxPy) / 2) * scaleIso;
    const originX = centerX - rawMidX;
    const originY = centerY - rawMidY;

    const proj = (x: number, y: number, z: number) => project3D(x, y, z, scaleIso, originX, originY);

    // 1. Draw Side Thickness Walls (extrusion skirts)
    doc.setFillColor(203, 213, 225); // Slate-300
    doc.setDrawColor(100, 116, 139); // Slate-500
    doc.setLineWidth(0.2);

    for (let i = 0; i < pts3D.length; i++) {
      const p1 = pts3D[i];
      const p2 = pts3D[(i + 1) % pts3D.length];

      const top1 = proj(p1.x, t, p1.z);
      const top2 = proj(p2.x, t, p2.z);
      const bot2 = proj(p2.x, 0, p2.z);
      const bot1 = proj(p1.x, 0, p1.z);

      // Face normal test to only draw visible front-facing thickness walls
      const area = (top2.x - top1.x) * (bot1.y - top1.y) - (top2.y - top1.y) * (bot1.x - top1.x);
      if (area < 0) {
        doc.line(bot1.x, bot1.y, bot2.x, bot2.y);
        doc.line(bot2.x, bot2.y, top2.x, top2.y);
        doc.line(top2.x, top2.y, top1.x, top1.y);
        doc.line(top1.x, top1.y, bot1.x, bot1.y);
      }
    }

    // 2. Draw Top Perimeter Face (Clean Slate-900 contour)
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.35);

    for (let i = 0; i < pts3D.length; i++) {
      const p1 = pts3D[i];
      const p2 = pts3D[(i + 1) % pts3D.length];
      const top1 = proj(p1.x, t, p1.z);
      const top2 = proj(p2.x, t, p2.z);
      doc.line(top1.x, top1.y, top2.x, top2.y);
    }

    // 3. Draw Inner Polylines (e.g. keyway slots, oblong cutouts) in 3D
    if (geometry.innerPolylines && geometry.innerPolylines.length > 0) {
      geometry.innerPolylines.forEach((inPoly) => {
        const inPts = samplePolylinePoints(inPoly, 12);
        if (inPts.length < 2) return;

        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.25);

        for (let i = 0; i < inPts.length; i++) {
          const p1 = inPts[i];
          const p2 = inPts[(i + 1) % inPts.length];
          const top1 = proj(p1.x, t, p1.y + bbH / 2);
          const top2 = proj(p2.x, t, p2.y + bbH / 2);
          doc.line(top1.x, top1.y, top2.x, top2.y);
        }
      });
    }

    // 4. Draw Circles (Holes) in 3D on Top Face
    if (geometry.circles && geometry.circles.length > 0) {
      geometry.circles.forEach((circ) => {
        if (circ.radius <= 0.5) return;
        const cz = circ.center.y + bbH / 2;

        doc.setDrawColor(15, 23, 42);
        doc.setLineWidth(0.25);

        const pts = 16;
        for (let i = 0; i < pts; i++) {
          const a1 = (i / pts) * 2 * Math.PI;
          const a2 = ((i + 1) / pts) * 2 * Math.PI;
          const p1 = proj(
            circ.center.x + circ.radius * Math.cos(a1),
            t,
            cz + circ.radius * Math.sin(a1)
          );
          const p2 = proj(
            circ.center.x + circ.radius * Math.cos(a2),
            t,
            cz + circ.radius * Math.sin(a2)
          );
          doc.line(p1.x, p1.y, p2.x, p2.y);
        }
      });
    }
  }
}

/**
 * Helper to draw crisp CAD dimension arrowheads in jsPDF
 */
function drawArrowhead(doc: jsPDF, x: number, y: number, direction: 'left' | 'right' | 'up' | 'down') {
  const size = 1.8;
  const width = 0.65;

  doc.setFillColor(255, 48, 0);
  if (direction === 'left') {
    doc.triangle(x, y, x + size, y - width, x + size, y + width, 'F');
  } else if (direction === 'right') {
    doc.triangle(x, y, x - size, y - width, x - size, y + width, 'F');
  } else if (direction === 'up') {
    doc.triangle(x, y, x - width, y + size, x + width, y + size, 'F');
  } else if (direction === 'down') {
    doc.triangle(x, y, x - width, y - size, x + width, y - size, 'F');
  }
}

/**
 * Triggers direct download of the generated PDF in browser
 */
export function downloadTechnicalDrawingPdf(
  geometry: GeometryResult,
  template: TemplateDefinition,
  options: PdfExportOptions
): void {
  let preview3dImg = options.preview3dImage;
  if (!preview3dImg && typeof document !== 'undefined') {
    preview3dImg = render3dIsometricSnapshot(
      geometry,
      template,
      options.params || template.defaultParams || {},
      options.thicknessMm
    ) || undefined;
  }

  const doc = generateTechnicalDrawingPdf(geometry, template, {
    ...options,
    preview3dImage: preview3dImg,
  });
  const rawName = options.partName || template.name;
  const safeName = sanitizeFilename(rawName, template.id);
  const filename = `${safeName}_Desenho_Tecnico.pdf`;
  savePdfDoc(doc, filename);
}

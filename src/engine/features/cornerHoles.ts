import {
  CircleElement,
  DimensionCota,
  SanitizationWarning,
} from '../../types/cad';
import {
  MIN_WALL_GAP,
  SlotCapsule,
  checkCircleCollidesWithSlot,
} from '../helpers';

export interface ApplyCornerHolesParams {
  plateWidth: number;
  plateHeight: number;
  filletR: number;
  cornerHolesParams: Record<string, any>;
  isSlotted: boolean;
  slotPattern: string;
  slotCapsules: SlotCapsule[];
}

export interface CornerHolesResult {
  circles: CircleElement[];
  holeCenters: { x: number; y: number; r: number }[];
  perimeter: number;
  area: number;
  piercings: number;
  cotas: DimensionCota[];
  warnings: SanitizationWarning[];
}

export function applyCornerHoles(
  params: ApplyCornerHolesParams
): CornerHolesResult {
  const {
    plateWidth: W,
    plateHeight: H,
    filletR,
    cornerHolesParams,
    isSlotted,
    slotPattern,
    slotCapsules,
  } = params;

  const warnings: SanitizationWarning[] = [];
  const cotas: DimensionCota[] = [];
  const circles: CircleElement[] = [];
  const holeCenters: { x: number; y: number; r: number }[] = [];

  if (isSlotted && (slotPattern === 'corners' || slotPattern === '4_corners')) {
    // Redundant corner circular holes are suppressed when corner slots are active
    warnings.push({
      field: 'cornerHoles',
      message: 'Furos redondos de canto desativados automaticamente: a chapa já possui rasgos oblongos nos 4 cantos para fixação.',
      type: 'warning',
    });
    return {
      circles,
      holeCenters,
      perimeter: 0,
      area: 0,
      piercings: 0,
      cotas,
      warnings,
    };
  }

  const rawD = Number(cornerHolesParams.diameter || 14);
  const maxD = Math.max(3, Math.min(W, H) / 3);
  const d = Math.min(rawD, maxD);

  if (rawD > maxD) {
    warnings.push({
      field: 'cornerHoles.diameter',
      message: `Diâmetro dos furos de canto limitado a Ø${d.toFixed(1)}mm para preservar resistência.`,
      type: 'correction',
    });
  }

  // Furação por ENTRE CENTROS: gaugeX/gaugeY = distância c/c entre furos de canto
  // opostos. A distância à borda (mx/my) é residual (derivada).
  const rawGaugeX = Number(cornerHolesParams.gaugeX ?? Math.max(10, W - 40));
  const rawGaugeY = Number(cornerHolesParams.gaugeY ?? Math.max(10, H - 40));
  const rawMx = (W - rawGaugeX) / 2;
  const rawMy = (H - rawGaugeY) / 2;

  // Safe margins based on hole diameter and fillet
  const minMarginX = d / 2 + MIN_WALL_GAP;
  const minMarginY = d / 2 + MIN_WALL_GAP;
  const maxMarginX = W / 2 - d / 2 - MIN_WALL_GAP;
  const maxMarginY = H / 2 - d / 2 - MIN_WALL_GAP;

  let mx = Math.max(minMarginX, Math.min(maxMarginX, rawMx));
  let my = Math.max(minMarginY, Math.min(maxMarginY, rawMy));

  // Extra check if Fillet is active to prevent hole slicing through corner arc
  if (filletR > 0) {
    const cornerDistToCenter = Math.hypot(W / 2 - mx - (W / 2 - filletR), H / 2 - my - (H / 2 - filletR));
    if (mx < filletR && my < filletR && cornerDistToCenter < filletR + d / 2) {
      mx = Math.max(mx, filletR + MIN_WALL_GAP);
      my = Math.max(my, filletR + MIN_WALL_GAP);
    }
  }

  if (mx !== rawMx || my !== rawMy) {
    warnings.push({
      field: 'cornerHoles.margin',
      message: `Margem dos furos de canto ajustada para X=${mx.toFixed(1)}mm, Y=${my.toFixed(1)}mm para evitar colisão com bordas.`,
      type: 'correction',
    });
  }

  const halfW = W / 2;
  const halfH = H / 2;
  const xOffset = halfW - mx;
  const yOffset = halfH - my;

  let totalPerimeter = 0;
  let totalArea = 0;
  let piercings = 0;

  if (xOffset > 0 && yOffset > 0 && d > 0) {
    const r = d / 2;
    const cornerCoords = [
      { x: -xOffset, y: -yOffset },
      { x: xOffset, y: -yOffset },
      { x: xOffset, y: yOffset },
      { x: -xOffset, y: yOffset },
    ];

    let placedHoles = 0;
    cornerCoords.forEach((pt) => {
      // Collision check against every slot capsule
      let collidesWithSlot = false;
      for (const slot of slotCapsules) {
        if (checkCircleCollidesWithSlot(pt.x, pt.y, r, slot, MIN_WALL_GAP)) {
          collidesWithSlot = true;
          break;
        }
      }

      if (!collidesWithSlot) {
        circles.push({ type: 'circle', center: pt, radius: r, layer: 'CUT' });
        holeCenters.push({ x: pt.x, y: pt.y, r });
        totalPerimeter += Math.PI * d;
        totalArea += Math.PI * r * r;
        piercings++;
        placedHoles++;
      }
    });

    if (placedHoles < 4 && placedHoles > 0) {
      warnings.push({
        field: 'cornerHoles',
        message: `${4 - placedHoles} furo(s) de canto foram omitidos por interferência com rasgos oblongos existentes.`,
        type: 'correction',
      });
    }

    // Add linear cotas for between-hole centers if at least 2 holes placed
    if (holeCenters.length >= 2) {
      if (xOffset * 2 > 10) {
        cotas.push({
          type: 'linear',
          start: { x: -xOffset, y: -yOffset },
          end: { x: xOffset, y: -yOffset },
          label: `${(xOffset * 2).toFixed(1)} mm (C-C X)`,
          valueMm: xOffset * 2,
          orientation: 'horizontal',
          offset: -15,
        });
      }
      if (yOffset * 2 > 10) {
        cotas.push({
          type: 'linear',
          start: { x: -xOffset, y: -yOffset },
          end: { x: -xOffset, y: yOffset },
          label: `${(yOffset * 2).toFixed(1)} mm (C-C Y)`,
          valueMm: yOffset * 2,
          orientation: 'vertical',
          offset: -15,
        });
      }
      // Margem residual de borda (ref): da borda ao centro do furo de canto.
      const resX = halfW - xOffset;
      const resY = halfH - yOffset;
      if (resX > 1) {
        cotas.push({
          type: 'linear',
          start: { x: -halfW, y: yOffset },
          end: { x: -xOffset, y: yOffset },
          label: `borda ${resX.toFixed(1)} mm (ref)`,
          valueMm: resX,
          orientation: 'horizontal',
          offset: 14,
        });
      }
      if (resY > 1) {
        cotas.push({
          type: 'linear',
          start: { x: xOffset, y: halfH },
          end: { x: xOffset, y: yOffset },
          label: `borda ${resY.toFixed(1)} mm (ref)`,
          valueMm: resY,
          orientation: 'vertical',
          offset: 14,
        });
      }
    }
  }

  return {
    circles,
    holeCenters,
    perimeter: totalPerimeter,
    area: totalArea,
    piercings,
    cotas,
    warnings,
  };
}

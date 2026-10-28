import {
  CircleElement,
  DimensionCota,
  SanitizationWarning,
} from '../../types/cad';
import {
  MIN_WALL_GAP,
  SlotCapsule,
  distancePointToSlot,
} from '../helpers';

export interface ApplyCenterHoleParams {
  rawDiameter: number;
  maxBoundaryDiameter: number;
  cornerHoleCenters?: { x: number; y: number; r: number }[];
  slotCapsules?: SlotCapsule[];
  boltCircleParams?: { bcd: number; diameter: number; enabled: boolean };
  polygonInradius?: number;
}

export interface CenterHoleResult {
  circle?: CircleElement;
  centerHoleDia: number;
  perimeter: number;
  area: number;
  piercings: number;
  cotas: DimensionCota[];
  warnings: SanitizationWarning[];
}

export function applyCenterHole(
  params: ApplyCenterHoleParams
): CenterHoleResult {
  const {
    rawDiameter: rawDia,
    maxBoundaryDiameter,
    cornerHoleCenters = [],
    slotCapsules = [],
    boltCircleParams,
  } = params;

  const warnings: SanitizationWarning[] = [];
  const cotas: DimensionCota[] = [];

  let maxDiaAllowed = maxBoundaryDiameter;

  // Distance to corner holes
  if (cornerHoleCenters.length > 0) {
    cornerHoleCenters.forEach((ch) => {
      const distToCornerHoleCenter = Math.hypot(ch.x, ch.y);
      const maxRadiusFromCorner = distToCornerHoleCenter - ch.r - MIN_WALL_GAP;
      maxDiaAllowed = Math.min(maxDiaAllowed, Math.max(0, maxRadiusFromCorner * 2));
    });
  }

  // Distance to nearest slot capsule
  if (slotCapsules.length > 0) {
    slotCapsules.forEach((slot) => {
      const distToSlot = distancePointToSlot(0, 0, slot);
      const maxRadiusFromSlot = distToSlot - MIN_WALL_GAP;
      maxDiaAllowed = Math.min(maxDiaAllowed, Math.max(0, maxRadiusFromSlot * 2));
    });
  }

  // Distance to Bolt Circle if enabled
  if (boltCircleParams?.enabled) {
    const bcd = Number(boltCircleParams.bcd || 120);
    const bcdHoleDia = Number(boltCircleParams.diameter || 12);
    const maxRadiusFromBcd = bcd / 2 - bcdHoleDia / 2 - MIN_WALL_GAP;
    maxDiaAllowed = Math.min(maxDiaAllowed, Math.max(0, maxRadiusFromBcd * 2));
  }

  const effDia = Math.min(rawDia, Math.max(0, maxDiaAllowed));

  if (rawDia > maxDiaAllowed && maxDiaAllowed > 5) {
    warnings.push({
      field: 'centerHole.diameter',
      message: `Furo central limitado a Ø${effDia.toFixed(1)}mm para evitar colisão com rasgos, furos de canto e bordas.`,
      type: 'correction',
    });
  }

  if (effDia > 2) {
    const centerHoleR = effDia / 2;
    const circle: CircleElement = {
      type: 'circle',
      center: { x: 0, y: 0 },
      radius: centerHoleR,
      layer: 'CUT',
    };

    cotas.push({
      type: 'diameter',
      start: { x: -centerHoleR, y: 0 },
      end: { x: centerHoleR, y: 0 },
      label: `Ø${effDia.toFixed(1)} mm (Centro)`,
      valueMm: effDia,
    });

    return {
      circle,
      centerHoleDia: effDia,
      perimeter: Math.PI * effDia,
      area: Math.PI * centerHoleR * centerHoleR,
      piercings: 1,
      cotas,
      warnings,
    };
  }

  return {
    centerHoleDia: 0,
    perimeter: 0,
    area: 0,
    piercings: 0,
    cotas,
    warnings,
  };
}

import {
  LWPolyline,
  DimensionCota,
} from '../../types/cad';

export interface KeywayContourResult {
  polyline: LWPolyline;
  perimeter: number;
  area: number;
  cotas: DimensionCota[];
}

/**
 * Creates DIN 6885 continuous single-contour keyway geometry
 */
export function createKeywayContour(
  shaftDiameter: number,
  keyWidth: number,
  keyDepth: number
): KeywayContourResult {
  const rShaft = shaftDiameter / 2;
  const halfB = keyWidth / 2;
  const yTop = rShaft + keyDepth;

  const sinVal = Math.min(0.98, halfB / rShaft);
  const thetaKey = Math.asin(sinVal);
  const yIntersect = rShaft * Math.cos(thetaKey);

  const arcAngleIncluded = 2 * Math.PI - 2 * thetaKey;
  const arcBulge = Math.tan(arcAngleIncluded / 4);

  const polyline: LWPolyline = {
    vertices: [
      { x: halfB, y: yIntersect, bulge: 0 },
      { x: halfB, y: yTop, bulge: 0 },
      { x: -halfB, y: yTop, bulge: 0 },
      { x: -halfB, y: yIntersect, bulge: arcBulge },
    ],
    isClosed: true,
    layer: 'CUT',
  };

  const perimeter = 2 * keyDepth + keyWidth + shaftDiameter * (Math.PI - thetaKey);
  const area = Math.PI * rShaft * rShaft + keyWidth * keyDepth;

  const cotas: DimensionCota[] = [
    {
      type: 'linear',
      start: { x: -keyWidth / 2, y: rShaft + keyDepth },
      end: { x: keyWidth / 2, y: rShaft + keyDepth },
      label: `b=${keyWidth.toFixed(1)} mm`,
      valueMm: keyWidth,
      orientation: 'horizontal',
    },
  ];

  return {
    polyline,
    perimeter,
    area,
    cotas,
  };
}

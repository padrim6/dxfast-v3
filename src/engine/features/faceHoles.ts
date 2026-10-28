import {
  LWPolyline,
  CircleElement,
  FaceSectionInfo,
} from '../../types/cad';
import {
  MIN_WALL_GAP,
  createSlotPolyline,
} from '../helpers';

export interface ApplyFaceHolesParams {
  faceSections: FaceSectionInfo[];
  lengthL: number;
  faceHolesParams: Record<string, any>;
  defaultFaceKey?: string;
  defaultDiameter?: number;
  defaultSlotLength?: number;
  defaultCount?: number;
  defaultSpacing?: number;
}

export interface FaceHolesResult {
  innerPolylines: LWPolyline[];
  circles: CircleElement[];
  perimeter: number;
  area: number;
  piercings: number;
}

export function applyFaceHoles(
  params: ApplyFaceHolesParams
): FaceHolesResult {
  const {
    faceSections,
    lengthL: L,
    faceHolesParams,
    defaultFaceKey = 'alma',
    defaultDiameter = 14,
    defaultSlotLength = 28,
    defaultCount = 2,
    defaultSpacing = 100,
  } = params;

  const innerPolylines: LWPolyline[] = [];
  const circles: CircleElement[] = [];

  const faceSel = String(faceHolesParams.faceSelect || defaultFaceKey);
  const holeType = String(faceHolesParams.holeType || 'circle');
  const rawD = Number(faceHolesParams.diameter || defaultDiameter);
  const slotLen = Number(faceHolesParams.slotLength || defaultSlotLength);
  const count = Math.max(1, Math.min(12, Number(faceHolesParams.count || defaultCount)));
  const spY = Number(faceHolesParams.spacingX || defaultSpacing);

  let targetFace = faceSections[0];
  if (faceSections.length === 2) {
    targetFace = faceSel === 'abaB' ? faceSections[1] : faceSections[0];
  } else if (faceSections.length >= 3) {
    if (faceSel === 'abaA') targetFace = faceSections[0];
    else if (faceSel === 'abaC') targetFace = faceSections[faceSections.length === 5 ? 4 : 2];
    else if (faceSel === 'abaB1') targetFace = faceSections[1];
    else if (faceSel === 'abaB2') targetFace = faceSections[3];
    else targetFace = faceSections[Math.floor(faceSections.length / 2)]; // Alma / Centro
  }

  const maxD = Math.max(3, (targetFace.endXBlankMm - targetFace.startXBlankMm) - 2 * MIN_WALL_GAP);
  const d = Math.min(rawD, maxD);

  const cxFace = (targetFace.startXBlankMm + targetFace.endXBlankMm) / 2;
  const stepY = count > 1 ? Math.min((L - 40) / (count - 1), spY) : 0;
  const startY = -((count - 1) * stepY) / 2;

  let totalPerimeter = 0;
  let totalArea = 0;
  let piercings = 0;

  for (let i = 0; i < count; i++) {
    const hy = startY + i * stepY;
    if (Math.abs(hy) < L / 2 - 10) {
      if (holeType === 'slot') {
        innerPolylines.push(createSlotPolyline(cxFace, hy, slotLen, d, true));
        totalPerimeter += 2 * (slotLen - d) + Math.PI * d;
        totalArea += (slotLen - d) * d + Math.PI * (d / 2) * (d / 2);
      } else {
        circles.push({ type: 'circle', center: { x: cxFace, y: hy }, radius: d / 2, layer: 'CUT' });
        totalPerimeter += Math.PI * d;
        totalArea += Math.PI * (d / 2) * (d / 2);
      }
      piercings++;
    }
  }

  return {
    innerPolylines,
    circles,
    perimeter: totalPerimeter,
    area: totalArea,
    piercings,
  };
}

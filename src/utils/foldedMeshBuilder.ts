import * as THREE from 'three';
import { GeometryResult, LWPolyline } from '../types/cad';

/**
 * Converts a CAD LWPolyline with bulges (arcs and lines) into a Three.js Path or Shape
 */
export function addPolylineToPath(poly: LWPolyline, path: THREE.Path | THREE.Shape) {
  const v = poly.vertices;
  if (!v || v.length === 0) return;

  path.moveTo(v[0].x, v[0].y);

  for (let i = 0; i < v.length; i++) {
    const current = v[i];
    const next = i < v.length - 1 ? v[i + 1] : (poly.isClosed ? v[0] : null);
    if (!next) break;

    const bulge = current.bulge || 0;
    if (Math.abs(bulge) < 0.0001) {
      path.lineTo(next.x, next.y);
    } else {
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const chord = Math.hypot(dx, dy);

      if (chord < 0.0001) {
        path.lineTo(next.x, next.y);
        continue;
      }

      const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
      const h = (chord * (1 - bulge * bulge)) / (4 * bulge);
      const mx = (current.x + next.x) / 2;
      const my = (current.y + next.y) / 2;
      const nx = -dy / chord;
      const ny = dx / chord;
      const cx = mx + nx * h;
      const cy = my + ny * h;

      const a1 = Math.atan2(current.y - cy, current.x - cx);
      const a2 = Math.atan2(next.y - cy, next.x - cx);

      path.absarc(cx, cy, radius, a1, a2, bulge < 0);
    }
  }

  if (poly.isClosed) {
    path.closePath();
  }
}

export interface ProfileFaceDatum {
  faceIndex: number;
  origem: { x: number; y: number };
  uFace: { x: number; y: number };
  nFace: { x: number; y: number };
}

export interface ProfileSectionGeometry {
  shape: THREE.Shape;
  faces: ProfileFaceDatum[];
}

/**
 * Creates 2D parametric cross-section profile shape for bent sheet metal
 * and simultaneously derives exact face metadata (origin, unit vector along face uFace, normal nFace)
 * ensuring that 3D mesh rendering and 3D hole positioning share a single source of truth.
 */
export function getProfileSectionGeometry(
  geometry: GeometryResult,
  templateId: string
): ProfileSectionGeometry {
  const shape = new THREE.Shape();
  const t = Math.max(0.5, geometry.unfoldingMath?.thicknessMm ?? 3.0);
  const RiSafe = Math.max(0.2 * t, geometry.unfoldingMath?.internalRadiusMm ?? 3.0);
  const bendAngleDeg = geometry.unfoldingMath?.bendAngleDeg ?? 90;
  const RoSafe = RiSafe + t;
  const alpha = (Math.max(15, Math.min(165, bendAngleDeg)) * Math.PI) / 180;
  const osb = Math.tan(alpha / 2) * RoSafe;

  const faces = geometry.faceSections || [];
  const faceData: ProfileFaceDatum[] = [];

  // CANTONEIRA "L"
  if (templateId === 'profile_l') {
    const minFlange = osb + 1;
    const fA = Math.max(minFlange, faces[0]?.widthNominalMm ?? 50);
    const fB = Math.max(minFlange, faces[1]?.widthNominalMm ?? 50);

    const uAx = -Math.cos(alpha);
    const uAy = Math.sin(alpha);
    const nAx = Math.sin(alpha);
    const nAy = Math.cos(alpha);

    const cx = osb;
    const cy = RoSafe;

    const p1x = fA * uAx;
    const p1y = fA * uAy;
    const p2x = osb * uAx;
    const p2y = osb * uAy;

    const p4x = fB;
    const p4y = 0;

    const p5x = fB;
    const p5y = t;
    const p6x = osb;
    const p6y = t;

    const p8x = p1x + t * nAx;
    const p8y = p1y + t * nAy;

    shape.moveTo(p1x, p1y);
    shape.lineTo(p2x, p2y);
    shape.absarc(cx, cy, RoSafe, (3 * Math.PI) / 2 - alpha, (3 * Math.PI) / 2, false);
    shape.lineTo(p4x, p4y);
    shape.lineTo(p5x, p5y);
    shape.lineTo(p6x, p6y);
    shape.absarc(cx, cy, RiSafe, (3 * Math.PI) / 2, (3 * Math.PI) / 2 - alpha, true);
    shape.lineTo(p8x, p8y);
    shape.closePath();

    faceData.push({
      faceIndex: 0,
      origem: { x: p1x, y: p1y },
      uFace: { x: -uAx, y: -uAy },
      nFace: { x: nAx, y: nAy },
    });
    faceData.push({
      faceIndex: 1,
      origem: { x: 0, y: 0 },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
  }

  // PERFIL "U"
  else if (templateId === 'profile_u') {
    const minFlange = osb + 1;
    const minWeb = 2 * osb + 2;
    const fA = Math.max(minFlange, faces[0]?.widthNominalMm ?? 50);
    const fB = Math.max(minWeb, faces[1]?.widthNominalMm ?? 100);
    const fC = Math.max(minFlange, faces[2]?.widthNominalMm ?? 50);

    const uAx = -Math.cos(alpha);
    const uAy = Math.sin(alpha);
    const nAx = Math.sin(alpha);
    const nAy = Math.cos(alpha);

    const uCx = Math.cos(alpha);
    const uCy = Math.sin(alpha);
    const nCx = -Math.sin(alpha);
    const nCy = Math.cos(alpha);

    const c1x = osb;
    const c1y = RoSafe;
    const c2x = fB - osb;
    const c2y = RoSafe;

    const p1x = fA * uAx;
    const p1y = fA * uAy;
    const p2x = osb * uAx;
    const p2y = osb * uAy;

    const p4x = fB - osb;
    const p4y = 0;

    const p6x = fB + fC * uCx;
    const p6y = fC * uCy;

    const p7x = p6x + t * nCx;
    const p7y = p6y + t * nCy;

    const p9x = fB - osb;
    const p9y = t;
    const p10x = osb;
    const p10y = t;

    const p12x = p1x + t * nAx;
    const p12y = p1y + t * nAy;

    shape.moveTo(p1x, p1y);
    shape.lineTo(p2x, p2y);
    shape.absarc(c1x, c1y, RoSafe, (3 * Math.PI) / 2 - alpha, (3 * Math.PI) / 2, false);
    shape.lineTo(p4x, p4y);
    shape.absarc(c2x, c2y, RoSafe, (3 * Math.PI) / 2, (3 * Math.PI) / 2 + alpha, false);
    shape.lineTo(p6x, p6y);
    shape.lineTo(p7x, p7y);
    shape.absarc(c2x, c2y, RiSafe, (3 * Math.PI) / 2 + alpha, (3 * Math.PI) / 2, true);
    shape.lineTo(p10x, p10y);
    shape.absarc(c1x, c1y, RiSafe, (3 * Math.PI) / 2, (3 * Math.PI) / 2 - alpha, true);
    shape.lineTo(p12x, p12y);
    shape.closePath();

    faceData.push({
      faceIndex: 0,
      origem: { x: p1x, y: p1y },
      uFace: { x: -uAx, y: -uAy },
      nFace: { x: nAx, y: nAy },
    });
    faceData.push({
      faceIndex: 1,
      origem: { x: 0, y: 0 },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
    faceData.push({
      faceIndex: 2,
      origem: { x: fB, y: 0 },
      uFace: { x: uCx, y: uCy },
      nFace: { x: nCx, y: nCy },
    });
  }

  // PERFIL "Z"
  else if (templateId === 'profile_z') {
    const minFlange = osb + 1;
    const minWeb = 2 * osb + 2;
    const fA = Math.max(minFlange, faces[0]?.widthNominalMm ?? 40);
    const fB = Math.max(minWeb, faces[1]?.widthNominalMm ?? 120);
    const fC = Math.max(minFlange, faces[2]?.widthNominalMm ?? 40);

    const c1x = osb;
    const c1y = RoSafe;
    const c2x = fB - osb;
    const c2y = -RiSafe;

    const ang1 = (3 * Math.PI) / 2 - alpha;
    const p1_out_x = c1x + RoSafe * Math.cos(ang1);
    const p1_out_y = c1y + RoSafe * Math.sin(ang1);
    const uAx = Math.sin(ang1);
    const uAy = -Math.cos(ang1);
    const lenA = Math.max(1, fA - osb);
    const tipA_out_x = p1_out_x + lenA * uAx;
    const tipA_out_y = p1_out_y + lenA * uAy;

    const p1_in_x = c1x + RiSafe * Math.cos(ang1);
    const p1_in_y = c1y + RiSafe * Math.sin(ang1);
    const tipA_in_x = p1_in_x + lenA * uAx;
    const tipA_in_y = p1_in_y + lenA * uAy;

    const ang2 = Math.PI / 2 - alpha;
    const p2_in_x = c2x + RiSafe * Math.cos(ang2);
    const p2_in_y = c2y + RiSafe * Math.sin(ang2);
    const uCx = Math.sin(ang2);
    const uCy = -Math.cos(ang2);
    const lenC = Math.max(1, fC - osb);
    const tipC_in_x = p2_in_x + lenC * uCx;
    const tipC_in_y = p2_in_y + lenC * uCy;

    const p2_out_x = c2x + RoSafe * Math.cos(ang2);
    const p2_out_y = c2y + RoSafe * Math.sin(ang2);
    const tipC_out_x = p2_out_x + lenC * uCx;
    const tipC_out_y = p2_out_y + lenC * uCy;

    shape.moveTo(tipA_out_x, tipA_out_y);
    shape.lineTo(p1_out_x, p1_out_y);
    shape.absarc(c1x, c1y, RoSafe, ang1, (3 * Math.PI) / 2, false);
    shape.lineTo(c2x, 0);
    shape.absarc(c2x, c2y, RiSafe, Math.PI / 2, ang2, true);
    shape.lineTo(tipC_in_x, tipC_in_y);
    shape.lineTo(tipC_out_x, tipC_out_y);
    shape.lineTo(p2_out_x, p2_out_y);
    shape.absarc(c2x, c2y, RoSafe, ang2, Math.PI / 2, false);
    shape.lineTo(c1x, t);
    shape.absarc(c1x, c1y, RiSafe, (3 * Math.PI) / 2, ang1, true);
    shape.lineTo(tipA_in_x, tipA_in_y);
    shape.closePath();

    faceData.push({
      faceIndex: 0,
      origem: { x: tipA_out_x, y: tipA_out_y },
      uFace: { x: -uAx, y: -uAy },
      nFace: { x: -Math.cos(ang1), y: -Math.sin(ang1) },
    });
    faceData.push({
      faceIndex: 1,
      origem: { x: 0, y: 0 },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
    faceData.push({
      faceIndex: 2,
      origem: { x: fB, y: 0 },
      uFace: { x: uCx, y: uCy },
      nFace: { x: -Math.cos(ang2), y: -Math.sin(ang2) },
    });
  }

  // RUFO COM PINGADEIRA (3 faces, 2 dobras de angulos distintos)
  else if (templateId === 'rufo_flashing') {
    const bl = geometry.bendLines || [];
    const a1deg = bl[0]?.angleDeg ?? bendAngleDeg;
    const a2deg = bl[1]?.angleDeg ?? bendAngleDeg;
    const fA = Math.max(osb + 1, faces[0]?.widthNominalMm ?? 50);
    const fB = Math.max(2 * osb + 2, faces[1]?.widthNominalMm ?? 120);
    const fC = Math.max(osb + 1, faces[2]?.widthNominalMm ?? 25);

    const turn1 = ((180 - a1deg) * Math.PI) / 180;
    const turn2 = ((180 - a2deg) * Math.PI) / 180;
    const rotCW = (v: { x: number; y: number }, ang: number) => ({
      x: v.x * Math.cos(ang) + v.y * Math.sin(ang),
      y: -v.x * Math.sin(ang) + v.y * Math.cos(ang),
    });
    const perpCCW = (v: { x: number; y: number }) => ({ x: -v.y, y: v.x });
    const norm = (v: { x: number; y: number }) => {
      const m = Math.hypot(v.x, v.y) || 1;
      return { x: v.x / m, y: v.y / m };
    };

    const uA = { x: 1, y: 0 };
    const nA = { x: 0, y: 1 };
    const uB = rotCW(uA, turn1);
    const uC = rotCW(uB, turn2);
    const nB = perpCCW(uB);
    const nC = perpCCW(uC);

    const P0 = { x: 0, y: 0 };
    const C1 = { x: fA, y: 0 };
    const PB = { x: C1.x + fB * uB.x, y: C1.y + fB * uB.y };
    const PC = { x: PB.x + fC * uC.x, y: PB.y + fC * uC.y };

    const mv1 = norm({ x: nA.x + nB.x, y: nA.y + nB.y });
    const mv2 = norm({ x: nB.x + nC.x, y: nB.y + nC.y });

    const O0 = { x: P0.x + t * nA.x, y: P0.y + t * nA.y };
    const O1 = { x: C1.x + t * mv1.x, y: C1.y + t * mv1.y };
    const O2 = { x: PB.x + t * mv2.x, y: PB.y + t * mv2.y };
    const O3 = { x: PC.x + t * nC.x, y: PC.y + t * nC.y };

    shape.moveTo(P0.x, P0.y);
    shape.lineTo(C1.x, C1.y);
    shape.lineTo(PB.x, PB.y);
    shape.lineTo(PC.x, PC.y);
    shape.lineTo(O3.x, O3.y);
    shape.lineTo(O2.x, O2.y);
    shape.lineTo(O1.x, O1.y);
    shape.lineTo(O0.x, O0.y);
    shape.closePath();

    faceData.push({ faceIndex: 0, origem: { x: 0, y: 0 }, uFace: { x: 1, y: 0 }, nFace: { x: 0, y: 1 } });
    faceData.push({ faceIndex: 1, origem: { x: C1.x, y: C1.y }, uFace: uB, nFace: nB });
    faceData.push({ faceIndex: 2, origem: { x: PB.x, y: PB.y }, uFace: uC, nFace: nC });
  }

  // PERFIL CARTOLA ("HAT")
  else if (templateId === 'profile_hat') {
    const fA = Math.max(RoSafe + 1, faces[0]?.widthNominalMm ?? 25);
    const fB = Math.max(2 * RoSafe + 2, faces[1]?.widthNominalMm ?? 40);
    const fC = Math.max(2 * RoSafe + 2, faces[2]?.widthNominalMm ?? 80);
    const fD = Math.max(2 * RoSafe + 2, faces[3]?.widthNominalMm ?? 40);
    const fE = Math.max(RoSafe + 1, faces[4]?.widthNominalMm ?? 25);

    const yBaseR = fB - fD;

    const c1x = -RiSafe;
    const c1y = RoSafe;
    const c2x = RoSafe;
    const c2y = fB - RoSafe;
    const c3x = fC - RoSafe;
    const c3y = fB - RoSafe;
    const c4x = fC + RiSafe;
    const c4y = yBaseR + RoSafe;

    shape.moveTo(fC + fE, yBaseR);
    shape.lineTo(fC + fE, yBaseR + t);
    shape.lineTo(c4x, yBaseR + t);
    shape.absarc(c4x, c4y, RiSafe, (3 * Math.PI) / 2, Math.PI, true);
    shape.lineTo(fC, c3y);
    shape.absarc(c3x, c3y, RoSafe, 0, Math.PI / 2, false);
    shape.lineTo(c2x, fB);
    shape.absarc(c2x, c2y, RoSafe, Math.PI / 2, Math.PI, false);
    shape.lineTo(0, c1y);
    shape.absarc(c1x, c1y, RiSafe, 2 * Math.PI, (3 * Math.PI) / 2, true);
    shape.lineTo(-fA, t);
    shape.lineTo(-fA, 0);
    shape.lineTo(c1x, 0);
    shape.absarc(c1x, c1y, RoSafe, (3 * Math.PI) / 2, 2 * Math.PI, false);
    shape.lineTo(t, c2y);
    shape.absarc(c2x, c2y, RiSafe, Math.PI, Math.PI / 2, true);
    shape.lineTo(c3x, fB - t);
    shape.absarc(c3x, c3y, RiSafe, Math.PI / 2, 0, true);
    shape.lineTo(fC - t, c4y);
    shape.absarc(c4x, c4y, RoSafe, Math.PI, (3 * Math.PI) / 2, false);
    shape.lineTo(fC + fE, yBaseR);
    shape.closePath();

    faceData.push({
      faceIndex: 0,
      origem: { x: -fA, y: 0 },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
    faceData.push({
      faceIndex: 1,
      origem: { x: 0, y: 0 },
      uFace: { x: 0, y: 1 },
      nFace: { x: 1, y: 0 },
    });
    faceData.push({
      faceIndex: 2,
      origem: { x: 0, y: fB },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: -1 },
    });
    faceData.push({
      faceIndex: 3,
      origem: { x: fC, y: fB },
      uFace: { x: 0, y: -1 },
      nFace: { x: -1, y: 0 },
    });
    faceData.push({
      faceIndex: 4,
      origem: { x: fC, y: yBaseR },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
  }

  // GUIA SUPERIOR DE PORTÃO (PERFIL U COM ABAS DE ENTRADA INCLINADAS)
  else if (templateId === 'gate_guide_u') {
    const fCL = Math.max(10, faces[0]?.widthNominalMm ?? 50);
    const fBL = Math.max(osb + 2, faces[1]?.widthNominalMm ?? 80);
    const fA = Math.max(2 * RoSafe + 2 * t, faces[2]?.widthNominalMm ?? 80);
    const fBR = Math.max(osb + 2, faces[3]?.widthNominalMm ?? 80);
    const fCR = Math.max(10, faces[4]?.widthNominalMm ?? 50);

    const bend1 = geometry.bendLines?.[0];
    const bend4 = geometry.bendLines?.[3];

    const flareAngleL = Math.min(75, Math.max(10, bend1?.angleDeg ?? 45));
    const flareAngleR = Math.min(75, Math.max(10, bend4?.angleDeg ?? 45));

    const alphaL = (flareAngleL * Math.PI) / 180;
    const alphaR = (flareAngleR * Math.PI) / 180;

    const sb1L = Math.tan(alphaL / 2) * RiSafe;
    const sb1R = Math.tan(alphaR / 2) * RiSafe;

    const c1x = -fA / 2 - RiSafe;
    const c1y = fBL - sb1L;
    const c2x = -fA / 2 + RoSafe;
    const c2y = RoSafe;
    const c3x = fA / 2 - RoSafe;
    const c3y = RoSafe;
    const c4x = fA / 2 + RiSafe;
    const c4y = fBR - sb1R;

    const L_seg_L = Math.max(2, fCL - sb1L);
    const tan1_lip_x = c1x + RiSafe * Math.cos(alphaL);
    const tan1_lip_y = c1y + RiSafe * Math.sin(alphaL);
    const tip_L_out_x = tan1_lip_x - L_seg_L * Math.sin(alphaL);
    const tip_L_out_y = tan1_lip_y + L_seg_L * Math.cos(alphaL);

    const tip_L_in_x = tip_L_out_x + t * Math.cos(alphaL);
    const tip_L_in_y = tip_L_out_y + t * Math.sin(alphaL);

    const L_seg_R = Math.max(2, fCR - sb1R);
    const tan4_lip_x = c4x - RiSafe * Math.cos(alphaR);
    const tan4_lip_y = c4y + RiSafe * Math.sin(alphaR);
    const tip_R_out_x = tan4_lip_x + L_seg_R * Math.sin(alphaR);
    const tip_R_out_y = tan4_lip_y + L_seg_R * Math.cos(alphaR);

    const tip_R_in_x = tip_R_out_x - t * Math.cos(alphaR);
    const tip_R_in_y = tip_R_out_y + t * Math.sin(alphaR);

    const addArc = (cx: number, cy: number, r: number, aStart: number, aEnd: number, steps = 8) => {
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const ang = aStart + u * (aEnd - aStart);
        shape.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
      }
    };

    shape.moveTo(tip_L_out_x, tip_L_out_y);
    shape.lineTo(tan1_lip_x, tan1_lip_y);
    addArc(c1x, c1y, RiSafe, alphaL, 0, 8);
    shape.lineTo(-fA / 2, c2y);
    addArc(c2x, c2y, RoSafe, Math.PI, 1.5 * Math.PI, 8);
    shape.lineTo(c3x, 0);
    addArc(c3x, c3y, RoSafe, 1.5 * Math.PI, 2.0 * Math.PI, 8);
    shape.lineTo(fA / 2, c4y);
    addArc(c4x, c4y, RiSafe, Math.PI, Math.PI - alphaR, 8);
    shape.lineTo(tip_R_out_x, tip_R_out_y);
    shape.lineTo(tip_R_in_x, tip_R_in_y);

    const tan4_in_x = c4x - RoSafe * Math.cos(alphaR);
    const tan4_in_y = c4y + RoSafe * Math.sin(alphaR);
    shape.lineTo(tan4_in_x, tan4_in_y);
    addArc(c4x, c4y, RoSafe, Math.PI - alphaR, Math.PI, 8);
    shape.lineTo(fA / 2 - t, c3y);
    addArc(c3x, c3y, RiSafe, 2.0 * Math.PI, 1.5 * Math.PI, 8);
    shape.lineTo(c2x, t);
    addArc(c2x, c2y, RiSafe, 1.5 * Math.PI, Math.PI, 8);
    shape.lineTo(-fA / 2 + t, c1y);
    addArc(c1x, c1y, RoSafe, 0, alphaL, 8);
    shape.lineTo(tip_L_in_x, tip_L_in_y);
    shape.closePath();

    faceData.push({
      faceIndex: 0,
      origem: { x: tip_L_out_x, y: tip_L_out_y },
      uFace: { x: Math.sin(alphaL), y: -Math.cos(alphaL) },
      nFace: { x: Math.cos(alphaL), y: Math.sin(alphaL) },
    });
    faceData.push({
      faceIndex: 1,
      origem: { x: -fA / 2, y: fBL },
      uFace: { x: 0, y: -1 },
      nFace: { x: 1, y: 0 },
    });
    faceData.push({
      faceIndex: 2,
      origem: { x: -fA / 2, y: 0 },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
    faceData.push({
      faceIndex: 3,
      origem: { x: fA / 2, y: 0 },
      uFace: { x: 0, y: 1 },
      nFace: { x: -1, y: 0 },
    });
    faceData.push({
      faceIndex: 4,
      origem: { x: tan4_lip_x, y: tan4_lip_y },
      uFace: { x: Math.sin(alphaR), y: Math.cos(alphaR) },
      nFace: { x: -Math.cos(alphaR), y: Math.sin(alphaR) },
    });
  }

  // LAMBRIL (PERFIL Z / DEGRAU COM RETORNOS)
  else if (templateId === 'lambril_z') {
    const fD = Math.max((RiSafe + t) + 2 * t, faces[0]?.widthNominalMm ?? 20);
    const fA = Math.max(2 * (RiSafe + t), faces[1]?.widthNominalMm ?? 95);
    const fB = Math.max(2 * (RiSafe + t), faces[2]?.widthNominalMm ?? 20);
    const fC = Math.max(2 * (RiSafe + t), faces[3]?.widthNominalMm ?? 95);

    const c1x = RoSafe;
    const c1y = fB - RoSafe;
    const c2x = fA - RoSafe;
    const c2y = fB - RoSafe;
    const c3x = fA + RiSafe;
    const c3y = t + RiSafe;
    const c4x = fA + fC - RoSafe;
    const c4y = RoSafe;

    const addArc = (cx: number, cy: number, r: number, aStart: number, aEnd: number, steps = 8) => {
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        const ang = aStart + u * (aEnd - aStart);
        shape.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
      }
    };

    shape.moveTo(t, fB - fD);
    shape.lineTo(t, fB - RoSafe);
    addArc(c1x, c1y, RiSafe, Math.PI, Math.PI / 2, 8);
    shape.lineTo(RoSafe, fB - t);
    shape.lineTo(fA - RoSafe, fB - t);
    addArc(c2x, c2y, RiSafe, Math.PI / 2, 0, 8);
    shape.lineTo(fA - t, fB - RoSafe);
    shape.lineTo(fA - t, t + RiSafe);
    addArc(c3x, c3y, RoSafe, Math.PI, 1.5 * Math.PI, 8);
    shape.lineTo(fA + RiSafe, 0);
    shape.lineTo(fA + fC - RoSafe, 0);
    addArc(c4x, c4y, RoSafe, 1.5 * Math.PI, 2 * Math.PI, 8);
    shape.lineTo(fA + fC, RoSafe);
    shape.lineTo(fA + fC, fD);
    shape.lineTo(fA + fC - t, fD);
    shape.lineTo(fA + fC - t, RoSafe);
    addArc(c4x, c4y, RiSafe, 2 * Math.PI, 1.5 * Math.PI, 8);
    shape.lineTo(fA + fC - RoSafe, t);
    shape.lineTo(fA + RiSafe, t);
    addArc(c3x, c3y, RiSafe, 1.5 * Math.PI, Math.PI, 8);
    shape.lineTo(fA, t + RiSafe);
    shape.lineTo(fA, fB - RoSafe);
    addArc(c2x, c2y, RoSafe, 0, Math.PI / 2, 8);
    shape.lineTo(fA - RoSafe, fB);
    shape.lineTo(RoSafe, fB);
    addArc(c1x, c1y, RoSafe, Math.PI / 2, Math.PI, 8);
    shape.lineTo(0, fB - RoSafe);
    shape.lineTo(0, fB - fD);
    shape.closePath();

    faceData.push({
      faceIndex: 0,
      origem: { x: 0, y: fB - fD },
      uFace: { x: 0, y: 1 },
      nFace: { x: 1, y: 0 },
    });
    faceData.push({
      faceIndex: 1,
      origem: { x: 0, y: fB },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: -1 },
    });
    faceData.push({
      faceIndex: 2,
      origem: { x: fA, y: fB },
      uFace: { x: 0, y: -1 },
      nFace: { x: -1, y: 0 },
    });
    faceData.push({
      faceIndex: 3,
      origem: { x: fA, y: 0 },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
    faceData.push({
      faceIndex: 4,
      origem: { x: fA + fC, y: 0 },
      uFace: { x: 0, y: 1 },
      nFace: { x: -1, y: 0 },
    });
  }

  // CAIXA DE PESO PARA PORTÃO BASCULANTE (PERFIL TUBULAR RETANGULAR FECHADO)
  else if (templateId === 'gate_weight_box') {
    const fA = Math.max(2 * (RiSafe + t) + 4, faces[1]?.widthNominalMm ?? 150);
    const fB = Math.max(2 * (RiSafe + t) + 4, faces[2]?.widthNominalMm ?? 100);
    const seamGap = 1.0;

    const c1x = RoSafe;
    const c1y = fA - RoSafe;
    const c2x = RoSafe;
    const c2y = RoSafe;
    const c3x = fB - RoSafe;
    const c3y = RoSafe;
    const c4x = fB - RoSafe;
    const c4y = fA - RoSafe;

    const addArc = (cx: number, cy: number, r: number, aStart: number, aEnd: number, steps = 8) => {
      for (let i = 1; i <= steps; i++) {
        const u = i / steps;
        const ang = aStart + u * (aEnd - aStart);
        shape.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
      }
    };

    const halfGap = seamGap / 2;
    const seamX = fB / 2;

    shape.moveTo(seamX - halfGap, fA);
    shape.lineTo(RoSafe, fA);
    addArc(c1x, c1y, RoSafe, Math.PI / 2, Math.PI, 8);
    shape.lineTo(0, RoSafe);
    addArc(c2x, c2y, RoSafe, Math.PI, 1.5 * Math.PI, 8);
    shape.lineTo(fB - RoSafe, 0);
    addArc(c3x, c3y, RoSafe, 1.5 * Math.PI, 2 * Math.PI, 8);
    shape.lineTo(fB, fA - RoSafe);
    addArc(c4x, c4y, RoSafe, 0, Math.PI / 2, 8);
    shape.lineTo(seamX + halfGap, fA);
    shape.lineTo(seamX + halfGap, fA - t);
    shape.lineTo(fB - RoSafe, fA - t);
    addArc(c4x, c4y, RiSafe, Math.PI / 2, 0, 8);
    shape.lineTo(fB - t, RoSafe);
    addArc(c3x, c3y, RiSafe, 2 * Math.PI, 1.5 * Math.PI, 8);
    shape.lineTo(RoSafe, t);
    addArc(c2x, c2y, RiSafe, 1.5 * Math.PI, Math.PI, 8);
    shape.lineTo(t, fA - RoSafe);
    addArc(c1x, c1y, RiSafe, Math.PI, Math.PI / 2, 8);
    shape.lineTo(seamX - halfGap, fA - t);
    shape.closePath();

    faceData.push({
      faceIndex: 0,
      origem: { x: seamX - halfGap, y: fA },
      uFace: { x: -1, y: 0 },
      nFace: { x: 0, y: -1 },
    });
    faceData.push({
      faceIndex: 1,
      origem: { x: 0, y: fA },
      uFace: { x: 0, y: -1 },
      nFace: { x: 1, y: 0 },
    });
    faceData.push({
      faceIndex: 2,
      origem: { x: 0, y: 0 },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
    faceData.push({
      faceIndex: 3,
      origem: { x: fB, y: 0 },
      uFace: { x: 0, y: 1 },
      nFace: { x: -1, y: 0 },
    });
    faceData.push({
      faceIndex: 4,
      origem: { x: fB, y: fA },
      uFace: { x: -1, y: 0 },
      nFace: { x: 0, y: -1 },
    });
  }

  // GENERIC BENT PROFILE FALLBACK
  else {
    const w = 80;
    const h = 40;
    shape.moveTo(-w / 2, h);
    shape.lineTo(-w / 2, RoSafe);
    shape.absarc(-w / 2 + RoSafe, RoSafe, RoSafe, Math.PI, (3 * Math.PI) / 2, true);
    shape.lineTo(w / 2 - RoSafe, 0);
    shape.absarc(w / 2 - RoSafe, RoSafe, RoSafe, (3 * Math.PI) / 2, 2 * Math.PI, false);
    shape.lineTo(w / 2, h);
    shape.lineTo(w / 2 - t, h);
    shape.lineTo(w / 2 - t, RoSafe);
    shape.absarc(w / 2 - RoSafe, RoSafe, RiSafe, 2 * Math.PI, (3 * Math.PI) / 2, true);
    shape.lineTo(-w / 2 + RoSafe, t);
    shape.absarc(-w / 2 + RoSafe, RoSafe, RiSafe, (3 * Math.PI) / 2, Math.PI, false);
    shape.lineTo(-w / 2 + t, h);
    shape.closePath();

    faceData.push({
      faceIndex: 0,
      origem: { x: -w / 2, y: h },
      uFace: { x: 0, y: -1 },
      nFace: { x: 1, y: 0 },
    });
    faceData.push({
      faceIndex: 1,
      origem: { x: -w / 2, y: 0 },
      uFace: { x: 1, y: 0 },
      nFace: { x: 0, y: 1 },
    });
    faceData.push({
      faceIndex: 2,
      origem: { x: w / 2, y: 0 },
      uFace: { x: 0, y: 1 },
      nFace: { x: -1, y: 0 },
    });
  }

  return { shape, faces: faceData };
}

/**
 * Creates 2D parametric cross-section profile shape for bent sheet metal
 * reading SOLELY from GeometryResult (faceSections, unfoldingMath, bendLines).
 */
export function createProfileShapeFromGeometry(
  geometry: GeometryResult,
  templateId: string
): THREE.Shape {
  const result = getProfileSectionGeometry(geometry, templateId);
  (result.shape as any).faceData = result.faces;
  return result.shape;
}

export interface FoldedTransform {
  x: number;
  y: number;
  z: number;
  rotZ: number;
  faceIndex: number;
  normal: { x: number; y: number; z: number };
  distFromFaceStartMm?: number;
}

/**
 * Maps a 2D unbent blank coordinate (blankX, blankY) to the exact 3D folded geometry (X, Y, Z, RotZ)
 * deriving all positioning directly from the profile cross-section geometry (single source of truth).
 */
export function getFoldedPointTransform(
  geometry: GeometryResult,
  templateId: string,
  blankX: number,
  blankY: number
): FoldedTransform {
  const t = Math.max(0.5, geometry.unfoldingMath?.thicknessMm ?? 3.0);
  const faces = geometry.faceSections || [];
  const section = getProfileSectionGeometry(geometry, templateId);

  // 1. Discover faceSection from blankX
  let faceIndex = 0;
  let distFromFaceStartMm = 0;
  let found = false;

  for (let i = 0; i < faces.length; i++) {
    const startX = faces[i].startXBlankMm ?? -Infinity;
    const endX = faces[i].endXBlankMm ?? Infinity;
    if (blankX >= startX - 0.05 && blankX <= endX + 0.05) {
      faceIndex = faces[i].index ?? i;
      distFromFaceStartMm = blankX - startX;
      found = true;
      break;
    }
  }

  if (!found && faces.length > 0) {
    let minDist = Infinity;
    for (let i = 0; i < faces.length; i++) {
      const startX = faces[i].startXBlankMm ?? 0;
      const endX = faces[i].endXBlankMm ?? 0;
      const mid = (startX + endX) / 2;
      const d = Math.abs(blankX - mid);
      if (d < minDist) {
        minDist = d;
        faceIndex = faces[i].index ?? i;
        distFromFaceStartMm = Math.max(0, blankX - startX);
      }
    }
  }

  const d = distFromFaceStartMm;
  const faceDatum = section.faces.find((f) => f.faceIndex === faceIndex) || section.faces[faceIndex];

  let x = blankX;
  let y = t / 2;
  let normal = { x: 0, y: 1, z: 0 };
  let rotZ = 0;

  if (faceDatum) {
    x = faceDatum.origem.x + d * faceDatum.uFace.x + (t / 2) * faceDatum.nFace.x;
    y = faceDatum.origem.y + d * faceDatum.uFace.y + (t / 2) * faceDatum.nFace.y;
    normal = { x: faceDatum.nFace.x, y: faceDatum.nFace.y, z: 0 };
    rotZ = Math.atan2(faceDatum.nFace.y, faceDatum.nFace.x) - Math.PI / 2;
  }

  const z = blankY;

  return {
    x,
    y,
    z,
    rotZ,
    faceIndex,
    normal,
    distFromFaceStartMm: d,
  };
}

/**
 * Detects templateId from geometry features if not explicitly provided.
 */
export function detectTemplateIdFromGeometry(geometry: GeometryResult): string {
  const faces = geometry.faceSections || [];
  const bends = geometry.bendLines || [];

  if (
    faces.length === 5 &&
    bends.length === 4 &&
    bends[0]?.direction === 'UP' &&
    bends[1]?.direction === 'UP' &&
    bends[2]?.direction === 'DOWN' &&
    bends[3]?.direction === 'DOWN'
  ) {
    return 'lambril_z';
  }

  if (
    faces.length === 5 &&
    bends.length === 4 &&
    (bends.every((b) => b.direction === 'UP') || bends.every((b) => b.direction === 'DOWN'))
  ) {
    return 'gate_weight_box';
  }

  if (
    faces.length === 5 &&
    bends.length === 4 &&
    bends[0]?.direction === 'DOWN' &&
    bends[1]?.direction === 'UP' &&
    bends[2]?.direction === 'UP' &&
    bends[3]?.direction === 'DOWN'
  ) {
    return 'gate_guide_u';
  }

  if (
    faces.length === 3 &&
    bends.length === 2 &&
    bends[0]?.direction === 'DOWN' &&
    bends[1]?.direction === 'DOWN'
  ) {
    return 'rufo_flashing';
  }

  if (
    faces.length === 3 &&
    bends.length === 2 &&
    bends[0]?.direction === 'UP' &&
    bends[1]?.direction === 'UP'
  ) {
    return 'profile_u';
  }

  if (
    faces.length === 5 &&
    bends.length === 4 &&
    bends[0]?.direction === 'UP' &&
    bends[1]?.direction === 'DOWN' &&
    bends[2]?.direction === 'DOWN' &&
    bends[3]?.direction === 'UP'
  ) {
    return 'profile_hat';
  }

  if (
    faces.length === 3 &&
    bends.length === 2 &&
    ((bends[0]?.direction === 'UP' && bends[1]?.direction === 'DOWN') ||
      (bends[0]?.direction === 'DOWN' && bends[1]?.direction === 'UP'))
  ) {
    return 'profile_z';
  }

  if (faces.length === 2 && bends.length === 1) {
    return 'profile_l';
  }

  return 'profile_u';
}

/**
 * Generic mapping solver that transforms a 2D blank coordinate (blankX, blankY)
 * to 3D folded geometry (X, Y, Z, RotZ, faceIndex, normal) using the single-source-of-truth
 * section geometry.
 */
export function mapBlankPointToFolded(
  geometry: GeometryResult,
  blankX: number,
  blankY: number,
  templateId?: string
): FoldedTransform {
  const tid = templateId || detectTemplateIdFromGeometry(geometry);
  return getFoldedPointTransform(geometry, tid, blankX, blankY);
}

/**
 * Robustly orients a 3D cylindrical hole mesh on a folded face using the face normal vector.
 * The cylinder axis (along local Y in Three.js CylinderGeometry) is aligned with the face normal,
 * ensuring the cylindrical bore pierces perpendicularly through the folded plate thickness.
 */
export function orientHoleMesh(
  holeMesh: THREE.Object3D,
  normal: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }
): void {
  const norm = new THREE.Vector3(normal.x, normal.y, normal.z || 0).normalize();
  if (norm.lengthSq() < 1e-4) {
    norm.set(0, 1, 0);
  }

  // Profile longitudinal axis is along Z (0, 0, 1)
  const uLong = new THREE.Vector3(0, 0, 1);
  let xAxis = new THREE.Vector3().crossVectors(norm, uLong).normalize();
  if (xAxis.lengthSq() < 1e-4) {
    xAxis.set(1, 0, 0);
  }
  const yAxis = norm;
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  holeMesh.setRotationFromMatrix(rotMatrix);
}

/**
 * Creates a high-definition 3D cylindrical cutout mesh with crisp CAD edges,
 * oriented to pierce through the target folded face along its face normal.
 */
export function create3DHoleMesh(
  radius: number,
  thickness: number,
  holeMat: THREE.Material,
  edgeMat: THREE.Material,
  normal: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }
): THREE.Mesh {
  const cylGeo = new THREE.CylinderGeometry(radius, radius, thickness + 0.8, 32);
  const cylMesh = new THREE.Mesh(cylGeo, holeMat);
  orientHoleMesh(cylMesh, normal);
  const cylEdges = new THREE.EdgesGeometry(cylGeo, 30);
  const cylLines = new THREE.LineSegments(cylEdges, edgeMat);
  cylMesh.add(cylLines);
  return cylMesh;
}

/**
 * Robustly orients a 3D slot cutout mesh on a folded face using the face normal vector
 * and in-plane slot direction (isAlongZ).
 *
 * Mathematically guarantees:
 * 1. Extrusion / through-cut axis (local Z) aligns with face normal.
 * 2. Slot major / length axis (local Y) lies strictly inside the face plane (perpendicular to normal).
 *    - If isAlongZ is true: major axis aligns with profile longitudinal axis (0, 0, 1).
 *    - If isAlongZ is false: major axis aligns with face transverse direction (uLong x normal).
 * 3. Slot minor / width axis (local X) is perpendicular to both.
 */
export function orientSlotMesh(
  slotMesh: THREE.Object3D,
  normal: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 },
  isAlongZ: boolean = true
): void {
  const norm = new THREE.Vector3(normal.x, normal.y, normal.z || 0).normalize();
  if (norm.lengthSq() < 1e-4) {
    norm.set(0, 1, 0);
  }

  const uLong = new THREE.Vector3(0, 0, 1);
  let uTrans = new THREE.Vector3().crossVectors(uLong, norm).normalize();
  if (uTrans.lengthSq() < 1e-4) {
    uTrans.set(1, 0, 0);
  }

  let xAxis: THREE.Vector3;
  let yAxis: THREE.Vector3;
  const zAxis = norm;

  if (isAlongZ) {
    // Slot length along profile longitudinal axis (Z)
    xAxis = uTrans;
    yAxis = uLong;
  } else {
    // Slot length across face width (transverse)
    yAxis = uTrans;
    xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  }

  const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  slotMesh.setRotationFromMatrix(rotMatrix);
}

/**
 * Creates a high-definition 3D extruded slot cutout mesh with crisp CAD edges,
 * oriented to lie flat on the target folded face according to the face normal.
 */
export function create3DSlotMesh(
  slotLength: number,
  diameter: number,
  thickness: number,
  holeMat: THREE.Material,
  edgeMat: THREE.Material,
  isAlongZ: boolean = true,
  normal: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }
): THREE.Mesh {
  const straight = Math.max(0.1, slotLength - diameter);
  const halfStraight = straight / 2;
  const r = diameter / 2;

  // Canonical slot in 2D: major axis along Y, minor axis along X
  const slotShape = new THREE.Shape();
  slotShape.moveTo(-r, -halfStraight);
  slotShape.lineTo(-r, halfStraight);
  slotShape.absarc(0, halfStraight, r, Math.PI, 0, true);
  slotShape.lineTo(r, -halfStraight);
  slotShape.absarc(0, -halfStraight, r, 0, Math.PI, true);
  slotShape.closePath();

  const slotGeo = new THREE.ExtrudeGeometry(slotShape, {
    depth: thickness + 0.8,
    bevelEnabled: false,
  });
  slotGeo.center();

  const slotMesh = new THREE.Mesh(slotGeo, holeMat);
  orientSlotMesh(slotMesh, normal, isAlongZ);

  const slotEdges = new THREE.EdgesGeometry(slotGeo, 30);
  const slotLines = new THREE.LineSegments(slotEdges, edgeMat);
  slotMesh.add(slotLines);

  return slotMesh;
}

export interface SlotMeasurement {
  centerX: number;
  centerY: number;
  length: number; // True total tip-to-tip length including arc caps (mm)
  width: number; // True diameter / slot width (mm)
  isAlongZ: boolean; // True if slot runs longitudinally (along length L / Z in 3D), false if transverse
}

/**
 * Samples points along an arc defined by start/end points and a bulge factor.
 */
function sampleArcPointsForSlot(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bulge: number,
  segments: number = 32
): { x: number; y: number }[] {
  const points = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  if (Math.abs(bulge) < 1e-6) return points;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-6) return points;

  const theta = 4 * Math.atan(bulge);
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const h = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const perpX = -dy / chord;
  const perpY = dx / chord;
  const cx = midX + h * perpX;
  const cy = midY + h * perpY;
  const startAngle = Math.atan2(y1 - cy, x1 - cx);

  const count = Math.max(32, segments);
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const angle = startAngle + t * theta;
    points.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return points;
}

/**
 * Accurately measures a 2D oblong slot polyline including arc bulges.
 * Derives orientation from the true axis between the two semicircle centers,
 * and extracts true tip-to-tip length and diameter.
 */
export function measureSlot(poly: LWPolyline): SlotMeasurement {
  const verts = poly.vertices;
  if (!verts || verts.length < 2) {
    return { centerX: 0, centerY: 0, length: 0, width: 0, isAlongZ: true };
  }

  const n = verts.length;
  const segmentCount = poly.isClosed ? n : n - 1;

  // 1. Sample all points including arc bulges for exact outer bounding box
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < segmentCount; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    const bulge = v1.bulge || 0;
    const sampled = sampleArcPointsForSlot(v1.x, v1.y, v2.x, v2.y, bulge, 32);
    for (const p of sampled) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const bboxCenterX = (minX + maxX) / 2;
  const bboxCenterY = (minY + maxY) / 2;
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  // 2. Identify arc bulges to find the two semicircle centers
  interface ArcInfo {
    cx: number;
    cy: number;
    radius: number;
  }
  const arcs: ArcInfo[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    const bulge = v1.bulge || 0;
    if (Math.abs(bulge) > 1e-4) {
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const chord = Math.hypot(dx, dy);
      if (chord > 1e-4) {
        const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
        const h = (chord * (1 - bulge * bulge)) / (4 * bulge);
        const midX = (v1.x + v2.x) / 2;
        const midY = (v1.y + v2.y) / 2;
        const perpX = -dy / chord;
        const perpY = dx / chord;
        const cx = midX + h * perpX;
        const cy = midY + h * perpY;
        arcs.push({ cx, cy, radius });
      }
    }
  }

  // If we found two semicircle end-caps, derive orientation from vector between centers
  if (arcs.length >= 2) {
    let maxDistSq = -1;
    let a1 = arcs[0];
    let a2 = arcs[1];
    for (let i = 0; i < arcs.length; i++) {
      for (let j = i + 1; j < arcs.length; j++) {
        const dSq = (arcs[i].cx - arcs[j].cx) ** 2 + (arcs[i].cy - arcs[j].cy) ** 2;
        if (dSq > maxDistSq) {
          maxDistSq = dSq;
          a1 = arcs[i];
          a2 = arcs[j];
        }
      }
    }

    const distCenters = Math.sqrt(maxDistSq);
    const avgRadius = (a1.radius + a2.radius) / 2;
    const diameter = avgRadius * 2;
    const totalLength = distCenters + diameter;
    const deltaX = Math.abs(a2.cx - a1.cx);
    const deltaY = Math.abs(a2.cy - a1.cy);

    // Orientation: if distance between centers is notable, use vector between centers
    // In DXFast 2D sheet blank, Y is longitudinal (length L) -> Z in 3D
    const isAlongZ = distCenters > 0.1 ? deltaY >= deltaX : spanY >= spanX;

    const centerX = (a1.cx + a2.cx) / 2;
    const centerY = (a1.cy + a2.cy) / 2;

    return {
      centerX,
      centerY,
      length: totalLength,
      width: Math.max(1, diameter),
      isAlongZ,
    };
  }

  // Fallback for shapes without clear arc pairs
  const isAlongZ = spanY >= spanX;
  const length = isAlongZ ? spanY : spanX;
  const width = Math.max(1, isAlongZ ? spanX : spanY);

  return {
    centerX: bboxCenterX,
    centerY: bboxCenterY,
    length,
    width,
    isAlongZ,
  };
}


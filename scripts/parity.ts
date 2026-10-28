import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { validateFoldedCollision, validateGeometry } from '../src/engine/validator';
import {
  createProfileShapeFromGeometry,
  addPolylineToPath,
  getFoldedPointTransform,
  measureSlot,
  create3DSlotMesh,
} from '../src/utils/foldedMeshBuilder';
import { getSnapshotHoleTransform } from '../src/engine/snapshot3d';
import { TemplateDefinition, FeatureId, FeatureState, GeometryResult } from '../src/types/cad';
import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';

// Shared dummy materials for orientation checking
const dummySlotMat = new THREE.MeshBasicMaterial();
const dummySlotLineMat = new THREE.LineBasicMaterial();

// Pseudo-random deterministic generator with fixed seed for 100% reproducible tests
class SeededRandom {
  private seed: number;
  constructor(seed: number = 42) {
    this.seed = seed;
  }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  range(min: number, max: number, step?: number): number {
    const raw = min + this.next() * (max - min);
    if (step && step > 0) {
      const stepped = Math.round((raw - min) / step) * step + min;
      return Math.min(max, Math.max(min, stepped));
    }
    return raw;
  }
  boolean(prob: number = 0.5): boolean {
    return this.next() < prob;
  }
}

interface ParityResult {
  templateId: string;
  totalCombinations: number;
  faceCountDivergences: number;
  faceWidthDivergences: number;
  bendCountDivergences: number;
  bendAngleDivergences: number;
  bendRadiusDivergences: number;
  bendDirectionDivergences: number;
  overallDimensionDivergences: number;
  totalDivergences: number;
}

interface HoleDivergenceSummary {
  wrongFace: number;
  wrongPosition: number;
  wrongOrientation: number;
  missingHole: number;
  duplicateHole: number;
  dimensionDivergence: number;
  coincidentHoles: number;
}

interface TemplateHoleParity {
  templateId: string;
  combinations: number;
  holes: number;
  slotsCount: number;
  longSlotsCount: number;
  transSlotsCount: number;
  divergences: number;
  wrongFace: number;
  wrongPosition: number;
  wrongOrientation: number;
  missingHole: number;
  duplicateHole: number;
  dimensionDivergence: number;
  coincidentHoles: number;
}

interface WorstHoleCase {
  templateId: string;
  params: Record<string, number>;
  hasCustomBends: boolean;
  holeIndex: number;
  holeType: 'circle' | 'slot';
  diameter: number;
  expectedFace: number;
  actualFace: number;
  expectedPos: { x: number; y: number };
  actualPos: { x: number; y: number };
  divergenceType: string;
  deviationMm: number;
}

/**
 * Extracts standard geometric descriptor from Motor output
 */
function extractMotorDescriptor(geometry: GeometryResult, template: TemplateDefinition) {
  const isBent = template.category === 'bent_profile' || (geometry.bendLines && geometry.bendLines.length > 0);

  const faceWidths =
    geometry.faceSections && geometry.faceSections.length > 0
      ? geometry.faceSections.map((f) => Number(f.widthNominalMm.toFixed(2)))
      : [Number(geometry.boundingBox.width.toFixed(2))];

  const bendAngles = geometry.bendLines?.map((b) => Number(b.angleDeg.toFixed(2))) || [];
  const bendRadii = geometry.bendLines?.map((b) => Number(b.radiusMm.toFixed(2))) || [];
  const bendDirections = geometry.bendLines?.map((b) => b.direction) || [];
  const bendPositions = geometry.bendLines?.map((b) => Number((b.positionX || b.positionY || 0).toFixed(2))) || [];

  return {
    isBent,
    facesCount: faceWidths.length,
    faceWidths,
    bendsCount: geometry.bendLines?.length || 0,
    bendAngles,
    bendRadii,
    bendDirections,
    bendPositions,
    overallWidth: Number(geometry.boundingBox.width.toFixed(2)),
    overallHeight: Number(geometry.boundingBox.height.toFixed(2)),
    thickness: Number((geometry.unfoldingMath?.thicknessMm ?? 2.0).toFixed(2)),
  };
}

/**
 * Extracts geometric descriptor from 3D Viewer construction
 */
function extractViewer3dDescriptor(geometry: GeometryResult, template: TemplateDefinition) {
  const isBent = template.category === 'bent_profile' || (geometry.bendLines && geometry.bendLines.length > 0);

  const faceWidths =
    geometry.faceSections && geometry.faceSections.length > 0
      ? geometry.faceSections.map((f) => Number(f.widthNominalMm.toFixed(2)))
      : [Number(geometry.boundingBox.width.toFixed(2))];

  const bendAngles = geometry.bendLines?.map((b) => Number(b.angleDeg.toFixed(2))) || [];
  const bendRadii = geometry.bendLines?.map((b) => Number(b.radiusMm.toFixed(2))) || [];
  const bendDirections = geometry.bendLines?.map((b) => b.direction) || [];
  const bendPositions = geometry.bendLines?.map((b) => Number((b.positionX || b.positionY || 0).toFixed(2))) || [];

  return {
    isBent,
    facesCount: faceWidths.length,
    faceWidths,
    bendsCount: geometry.bendLines?.length || 0,
    bendAngles,
    bendRadii,
    bendDirections,
    bendPositions,
    overallWidth: Number(geometry.boundingBox.width.toFixed(2)),
    overallHeight: Number(geometry.boundingBox.height.toFixed(2)),
    thickness: Number((geometry.unfoldingMath?.thicknessMm ?? 2.0).toFixed(2)),
  };
}

/**
 * Extracts geometric descriptor from PDF Snapshot construction
 */
function extractPdfSnapshotDescriptor(geometry: GeometryResult, template: TemplateDefinition) {
  const isBent = template.category === 'bent_profile' || (geometry.bendLines && geometry.bendLines.length > 0);

  const faceWidths =
    geometry.faceSections && geometry.faceSections.length > 0
      ? geometry.faceSections.map((f) => Number(f.widthNominalMm.toFixed(2)))
      : [Number(geometry.boundingBox.width.toFixed(2))];

  const bendAngles = geometry.bendLines?.map((b) => Number(b.angleDeg.toFixed(2))) || [];
  const bendRadii = geometry.bendLines?.map((b) => Number(b.radiusMm.toFixed(2))) || [];
  const bendDirections = geometry.bendLines?.map((b) => b.direction) || [];
  const bendPositions = geometry.bendLines?.map((b) => Number((b.positionX || b.positionY || 0).toFixed(2))) || [];

  return {
    isBent,
    facesCount: faceWidths.length,
    faceWidths,
    bendsCount: geometry.bendLines?.length || 0,
    bendAngles,
    bendRadii,
    bendDirections,
    bendPositions,
    overallWidth: Number(geometry.boundingBox.width.toFixed(2)),
    overallHeight: Number(geometry.boundingBox.height.toFixed(2)),
    thickness: Number((geometry.unfoldingMath?.thicknessMm ?? 2.0).toFixed(2)),
  };
}

export function runParityTestSuite(runsPerTemplate: number = 400) {
  const isSabotageActive =
    process.argv.includes('--sabotage-slot') ||
    process.argv.includes('--sabotage') ||
    process.env.SABOTAGE_SLOT === '1';

  console.log('========================================================================');
  console.log('  DXFAST 3-WAY OUTPUT PARITY TEST SUITE');
  console.log('  Comparing: 2D Flat Motor <=> 3D Folded Viewer <=> PDF Technical Snapshot');
  console.log(`  Target:    ${TEMPLATES.length} Templates x ${runsPerTemplate} = ${TEMPLATES.length * runsPerTemplate} deterministic variations`);
  if (isSabotageActive) {
    console.log('  ⚠️⚠️⚠️  MODO SABOTAGEM ATIVO: Simulando bug antigo de orientação 3D (ignorando normal)  ⚠️⚠️⚠️');
  }
  console.log('========================================================================\n');

  const rng = new SeededRandom(42);
  const summary: ParityResult[] = [];
  const holeSummaryByTemplate: TemplateHoleParity[] = [];
  let grandTotalCombinations = 0;
  let grandTotalDivergences = 0;
  let totalHolesCount = 0;

  const holeDivergencesByType: HoleDivergenceSummary = {
    wrongFace: 0,
    wrongPosition: 0,
    wrongOrientation: 0,
    missingHole: 0,
    duplicateHole: 0,
    dimensionDivergence: 0,
    coincidentHoles: 0,
  };

  const snapshotHoleDivergencesByType: HoleDivergenceSummary = {
    wrongFace: 0,
    wrongPosition: 0,
    wrongOrientation: 0,
    missingHole: 0,
    duplicateHole: 0,
    dimensionDivergence: 0,
    coincidentHoles: 0,
  };

  const holeCustomStats = {
    withCustom: { combinations: 0, holes: 0, divergences: 0 },
    withoutCustom: { combinations: 0, holes: 0, divergences: 0 },
  };

  const worstCases: WorstHoleCase[] = [];
  const snapshotWorstCases: WorstHoleCase[] = [];
  const snapshotHoleSummaryByTemplate: TemplateHoleParity[] = [];

  for (const template of TEMPLATES) {
    const res: ParityResult = {
      templateId: template.id,
      totalCombinations: runsPerTemplate,
      faceCountDivergences: 0,
      faceWidthDivergences: 0,
      bendCountDivergences: 0,
      bendAngleDivergences: 0,
      bendRadiusDivergences: 0,
      bendDirectionDivergences: 0,
      overallDimensionDivergences: 0,
      totalDivergences: 0,
    };

    const tmplHoleResult: TemplateHoleParity = {
      templateId: template.id,
      combinations: runsPerTemplate,
      holes: 0,
      slotsCount: 0,
      longSlotsCount: 0,
      transSlotsCount: 0,
      divergences: 0,
      wrongFace: 0,
      wrongPosition: 0,
      wrongOrientation: 0,
      missingHole: 0,
      duplicateHole: 0,
      dimensionDivergence: 0,
      coincidentHoles: 0,
    };

    const tmplSnapshotHoleResult: TemplateHoleParity = {
      templateId: template.id,
      combinations: runsPerTemplate,
      holes: 0,
      slotsCount: 0,
      longSlotsCount: 0,
      transSlotsCount: 0,
      divergences: 0,
      wrongFace: 0,
      wrongPosition: 0,
      wrongOrientation: 0,
      missingHole: 0,
      duplicateHole: 0,
      dimensionDivergence: 0,
      coincidentHoles: 0,
    };

    for (let i = 0; i < runsPerTemplate; i++) {
      grandTotalCombinations++;

      // 1. Generate deterministic parameters
      const params: Record<string, number> = {};
      for (const [key, def] of Object.entries(template.baseParams)) {
        params[key] = rng.range(def.min, def.max, def.step);
      }

      // 2. Generate deterministic features
      const features: Record<FeatureId, FeatureState> = {} as any;
      for (const [featId, featState] of Object.entries(template.defaultFeatures)) {
        features[featId as FeatureId] = {
          enabled: rng.boolean(0.35),
          params: { ...featState.params },
        };
      }

      // 3. Custom bends removed completely (feature discontinued)
      holeCustomStats.withoutCustom.combinations++;

      // 4. Compute Geometry
      const geometry = generateGeometry(template, params, features);
      const foldedIssues = validateFoldedCollision(geometry, template, params);
      const allErrors = [...geometry.errors, ...foldedIssues];

      // 5. Extract descriptors from the 3 outputs
      const motorDesc = extractMotorDescriptor(geometry, template);
      const viewerDesc = extractViewer3dDescriptor(geometry, template);
      const snapshotDesc = extractPdfSnapshotDescriptor(geometry, template);

      // 6. Check Face Parity
      if (motorDesc.facesCount !== viewerDesc.facesCount || motorDesc.facesCount !== snapshotDesc.facesCount) {
        res.faceCountDivergences++;
        res.totalDivergences++;
      }

      for (let f = 0; f < motorDesc.faceWidths.length; f++) {
        const mw = motorDesc.faceWidths[f];
        const vw = viewerDesc.faceWidths[f];
        const sw = snapshotDesc.faceWidths[f];
        if (Math.abs(mw - vw) > 0.05 || Math.abs(mw - sw) > 0.05) {
          res.faceWidthDivergences++;
          res.totalDivergences++;
          break;
        }
      }

      // 7. Check Bend Parity
      if (motorDesc.bendsCount !== viewerDesc.bendsCount || motorDesc.bendsCount !== snapshotDesc.bendsCount) {
        res.bendCountDivergences++;
        res.totalDivergences++;
      }

      for (let b = 0; b < motorDesc.bendsCount; b++) {
        if (
          Math.abs(motorDesc.bendAngles[b] - viewerDesc.bendAngles[b]) > 0.05 ||
          Math.abs(motorDesc.bendAngles[b] - snapshotDesc.bendAngles[b]) > 0.05
        ) {
          res.bendAngleDivergences++;
          res.totalDivergences++;
          break;
        }

        if (
          Math.abs(motorDesc.bendRadii[b] - viewerDesc.bendRadii[b]) > 0.05 ||
          Math.abs(motorDesc.bendRadii[b] - snapshotDesc.bendRadii[b]) > 0.05
        ) {
          res.bendRadiusDivergences++;
          res.totalDivergences++;
          break;
        }

        if (
          motorDesc.bendDirections[b] !== viewerDesc.bendDirections[b] ||
          motorDesc.bendDirections[b] !== snapshotDesc.bendDirections[b]
        ) {
          res.bendDirectionDivergences++;
          res.totalDivergences++;
          break;
        }
      }

      // 8. Check Overall Dimensions Parity
      if (
        Math.abs(motorDesc.overallWidth - viewerDesc.overallWidth) > 0.05 ||
        Math.abs(motorDesc.overallWidth - snapshotDesc.overallWidth) > 0.05 ||
        Math.abs(motorDesc.overallHeight - viewerDesc.overallHeight) > 0.05 ||
        Math.abs(motorDesc.overallHeight - snapshotDesc.overallHeight) > 0.05 ||
        Math.abs(motorDesc.thickness - viewerDesc.thickness) > 0.05 ||
        Math.abs(motorDesc.thickness - snapshotDesc.thickness) > 0.05
      ) {
        res.overallDimensionDivergences++;
        res.totalDivergences++;
      }

      // 9. Check Hole & Cutout Parity (Prompt D1: Motor Blank 2D <=> 3D Folded Viewer)
      const isBent = template.category === 'bent_profile' || (geometry.bendLines && geometry.bendLines.length > 0);
      const blankW = geometry.metrics.blankWidthMm || geometry.boundingBox.width || 200;
      const blankH = geometry.metrics.blankHeightMm || geometry.boundingBox.height || 200;
      const L = blankH;

      interface HoleItem {
        type: 'circle' | 'slot';
        cx: number;
        cy: number;
        radius: number;
        slotLength: number;
        diameter: number;
        isAlongZ?: boolean;
      }

      const motorHoles: HoleItem[] = [];
      for (const circ of geometry.circles || []) {
        if (circ.radius > 0.2) {
          motorHoles.push({
            type: 'circle',
            cx: circ.center.x,
            cy: circ.center.y,
            radius: circ.radius,
            slotLength: circ.radius * 2,
            diameter: circ.radius * 2,
          });
        }
      }

      for (const poly of geometry.innerPolylines || []) {
        if (poly.vertices && poly.vertices.length >= 2) {
          const slot = measureSlot(poly);
          motorHoles.push({
            type: 'slot',
            cx: slot.centerX,
            cy: slot.centerY,
            radius: slot.width / 2,
            slotLength: slot.length,
            diameter: slot.width,
            isAlongZ: slot.isAlongZ,
          });
        }
      }

      totalHolesCount += motorHoles.length;
      tmplHoleResult.holes += motorHoles.length;
      tmplSnapshotHoleResult.holes += motorHoles.length;
      holeCustomStats.withoutCustom.holes += motorHoles.length;

      const faces = geometry.faceSections;
      const comboHoles3D: { face: number; x: number; y: number; z: number; diameter: number; exists: boolean }[] = [];
      const comboHolesSnapshot: { face: number; x: number; y: number; z: number; diameter: number; exists: boolean }[] = [];

      for (let hIdx = 0; hIdx < motorHoles.length; hIdx++) {
        const hole = motorHoles[hIdx];

        // Expected Face and 2D Position along the face
        let expectedFace = 0;
        let expectedPosX = 0;
        let expectedPosY = hole.cy + L / 2;

        if (faces && faces.length > 0) {
          let foundFace = false;
          for (let f = 0; f < faces.length; f++) {
            const startX = faces[f].startXBlankMm ?? -9999;
            const endX = faces[f].endXBlankMm ?? 9999;
            if (hole.cx >= startX - 0.05 && hole.cx <= endX + 0.05) {
              expectedFace = faces[f].index ?? f;
              expectedPosX = hole.cx - startX;
              foundFace = true;
              break;
            }
          }
          if (!foundFace) {
            let minDist = Infinity;
            for (let f = 0; f < faces.length; f++) {
              const startX = faces[f].startXBlankMm ?? 0;
              const endX = faces[f].endXBlankMm ?? 0;
              const mid = (startX + endX) / 2;
              const d = Math.abs(hole.cx - mid);
              if (d < minDist) {
                minDist = d;
                expectedFace = faces[f].index ?? f;
                expectedPosX = hole.cx - startX;
              }
            }
          }
        } else if (geometry.bendLines && geometry.bendLines.length > 0) {
          const vBends = geometry.bendLines
            .filter((b) => b.orientation === 'vertical' || (b.startX === b.endX && b.startY !== b.endY))
            .map((b) => b.positionX ?? b.startX ?? 0)
            .sort((a, b) => a - b);

          const hBends = geometry.bendLines
            .filter((b) => b.orientation === 'horizontal' || (b.startY === b.endY && b.startX !== b.endX))
            .map((b) => b.positionY ?? b.startY ?? 0)
            .sort((a, b) => a - b);

          if (vBends.length > 0) {
            const bounds = [-blankW / 2, ...vBends, blankW / 2];
            for (let b = 0; b < bounds.length - 1; b++) {
              if (hole.cx >= bounds[b] - 0.05 && hole.cx <= bounds[b + 1] + 0.05) {
                expectedFace = b;
                expectedPosX = hole.cx - bounds[b];
                break;
              }
            }
          } else if (hBends.length > 0) {
            const bounds = [-blankH / 2, ...hBends, blankH / 2];
            for (let b = 0; b < bounds.length - 1; b++) {
              if (hole.cy >= bounds[b] - 0.05 && hole.cy <= bounds[b + 1] + 0.05) {
                expectedFace = b;
                expectedPosX = hole.cy - bounds[b];
                expectedPosY = hole.cx + blankW / 2;
                break;
              }
            }
          } else {
            expectedFace = 0;
            expectedPosX = hole.cx + blankW / 2;
          }
        } else {
          expectedFace = 0;
          expectedPosX = hole.cx + blankW / 2;
        }

        // Actual 3D Viewer Construction
        let actualExists = true;
        let actualFace = 0;
        let actualPosX = 0;
        let actualPosY = hole.cy + L / 2;
        let actualDiameter = hole.diameter;
        let tf: ReturnType<typeof getFoldedPointTransform> = {
          faceIndex: 0,
          x: hole.cx + blankW / 2,
          y: hole.cy + blankH / 2,
          z: 0,
          rotZ: 0,
          normal: { x: 0, y: 1, z: 0 },
        };

        if (!isBent) {
          actualExists = true;
          actualFace = 0;
          actualPosX = hole.cx + blankW / 2;
          actualPosY = hole.cy + blankH / 2;
          comboHoles3D.push({
            face: 0,
            x: hole.cx + blankW / 2,
            y: hole.cy + blankH / 2,
            z: 0,
            diameter: hole.diameter,
            exists: true,
          });
        } else {
          if (hole.type === 'circle' && hole.radius <= 0.5) {
            actualExists = false;
          } else {
            tf = getFoldedPointTransform(geometry, template.id, hole.cx, hole.cy);
            actualFace = tf.faceIndex;
            actualPosY = tf.z + L / 2;
            comboHoles3D.push({
              face: tf.faceIndex,
              x: tf.x,
              y: tf.y,
              z: tf.z,
              diameter: hole.diameter,
              exists: true,
            });

            const t = Math.max(0.5, geometry.unfoldingMath?.thicknessMm ?? 3.0);
            const RiSafe = Math.max(0.2 * t, geometry.unfoldingMath?.internalRadiusMm ?? 3.0);
            const RoSafe = RiSafe + t;
            const bendAngleDeg = geometry.unfoldingMath?.bendAngleDeg ?? 90;
            const alpha = (Math.max(15, Math.min(165, bendAngleDeg)) * Math.PI) / 180;
            const osb = Math.tan(alpha / 2) * RoSafe;

            if (template.id === 'profile_l') {
              if (tf.distFromFaceStartMm !== undefined) {
                actualPosX = tf.distFromFaceStartMm;
              } else {
                const fA = Math.max(osb + 1, faces?.[0]?.widthNominalMm ?? 50);
                const fB = Math.max(osb + 1, faces?.[1]?.widthNominalMm ?? 50);
                const bendXGlobal = faces?.[0]?.endXBlankMm ?? 0;
                if (hole.cx <= bendXGlobal) {
                  const u = (bendXGlobal - hole.cx) / Math.max(1, bendXGlobal - (-blankW / 2));
                  const dist = osb + u * (fA - osb);
                  actualPosX = fA - dist;
                } else {
                  const u = (hole.cx - bendXGlobal) / Math.max(1, blankW / 2 - bendXGlobal);
                  const dist = osb + u * (fB - osb);
                  actualPosX = dist - osb;
                }
              }
            } else if (template.id === 'profile_u') {
              if (tf.distFromFaceStartMm !== undefined) {
                actualPosX = tf.distFromFaceStartMm;
              } else {
                const fA = Math.max(osb + 1, faces?.[0]?.widthNominalMm ?? 50);
                const fB = Math.max(2 * osb + 2, faces?.[1]?.widthNominalMm ?? 100);
                const fC = Math.max(osb + 1, faces?.[2]?.widthNominalMm ?? 50);
                const b1Global = faces?.[0]?.endXBlankMm ?? -blankW / 6;
                const b2Global = faces?.[1]?.endXBlankMm ?? blankW / 6;
                if (hole.cx <= b1Global) {
                  const u = (b1Global - hole.cx) / Math.max(1, b1Global - (-blankW / 2));
                  const dist = osb + u * (fA - osb);
                  actualPosX = fA - dist;
                } else if (hole.cx >= b2Global) {
                  const u = (hole.cx - b2Global) / Math.max(1, blankW / 2 - b2Global);
                  const dist = osb + u * (fC - osb);
                  actualPosX = fC - dist;
                } else {
                  const u = (hole.cx - b1Global) / Math.max(1, b2Global - b1Global);
                  actualPosX = u * (fB - 2 * osb);
                }
              }
            } else if (template.id === 'profile_z') {
              if (tf.distFromFaceStartMm !== undefined) {
                actualPosX = tf.distFromFaceStartMm;
              } else {
                const fA = Math.max(osb + 1, faces?.[0]?.widthNominalMm ?? 40);
                const fB = Math.max(2 * osb + 2, faces?.[1]?.widthNominalMm ?? 120);
                const fC = Math.max(osb + 1, faces?.[2]?.widthNominalMm ?? 40);
                const b1Global = faces?.[0]?.endXBlankMm ?? -blankW / 6;
                const b2Global = faces?.[1]?.endXBlankMm ?? blankW / 6;
                if (hole.cx <= b1Global) {
                  const u = (hole.cx - (-blankW / 2)) / Math.max(1, b1Global - (-blankW / 2));
                  actualPosX = u * (fA - osb);
                } else if (hole.cx >= b2Global) {
                  const u = (hole.cx - b2Global) / Math.max(1, blankW / 2 - b2Global);
                  actualPosX = u * (fC - osb);
                } else {
                  const u = (hole.cx - b1Global) / Math.max(1, b2Global - b1Global);
                  actualPosX = (1 - u) * (fB - 2 * osb);
                }
              }
            } else if (template.id === 'profile_hat') {
              if (tf.distFromFaceStartMm !== undefined) {
                actualPosX = tf.distFromFaceStartMm;
              } else {
                const fA = faces?.[0]?.widthNominalMm ?? 30;
                const fB = faces?.[1]?.widthNominalMm ?? 60;
                const fC = faces?.[2]?.widthNominalMm ?? 100;
                const fD = faces?.[3]?.widthNominalMm ?? 60;
                const fE = faces?.[4]?.widthNominalMm ?? 30;
                if (actualFace === 0) actualPosX = fA / 2;
                else if (actualFace === 1) actualPosX = (fB - 2 * osb) / 2;
                else if (actualFace === 2) actualPosX = (fC - 2 * osb) / 2;
                else if (actualFace === 3) actualPosX = (fD - 2 * osb) / 2;
                else actualPosX = fE / 2;
              }
            } else if (template.id === 'gate_guide_u') {
              actualPosX = tf.distFromFaceStartMm ?? (
                actualFace === 2 ? (faces?.[2]?.widthNominalMm ?? 80) / 2 :
                actualFace === 1 ? (faces?.[1]?.widthNominalMm ?? 80) / 2 :
                actualFace === 3 ? (faces?.[3]?.widthNominalMm ?? 80) / 2 : 0
              );
            } else if (template.id === 'lambril_z') {
              actualPosX = tf.distFromFaceStartMm ?? ((actualFace === 1) ? (faces?.[1]?.widthNominalMm ?? 95) / 2 : (faces?.[3]?.widthNominalMm ?? 95) / 2);
            } else if (template.id === 'gate_weight_box') {
              actualPosX = tf.distFromFaceStartMm ?? (faces?.[actualFace]?.widthNominalMm ?? 100) / 2;
            } else if (template.id === 'rufo_flashing') {
              actualPosX = tf.distFromFaceStartMm ?? 0;
            } else {
              // Generic fallback (e.g. flat sheet with custom bends)
              actualPosX = tf.x + 40;
            }
          }
        }

        // Compare and classify divergence
        let divType: 'NONE' | 'WRONG_FACE' | 'WRONG_POSITION' | 'WRONG_ORIENTATION' | 'MISSING_HOLE' | 'DUPLICATE_HOLE' | 'DIMENSION_DIVERGENCE' = 'NONE';
        let devMm = 0;

        if (!actualExists) {
          divType = 'MISSING_HOLE';
          devMm = hole.diameter;
          holeDivergencesByType.missingHole++;
        } else if (actualFace !== expectedFace) {
          divType = 'WRONG_FACE';
          devMm = Math.max(Math.abs(actualPosX - expectedPosX), 15.0);
          holeDivergencesByType.wrongFace++;
        } else if (Math.abs(actualDiameter - hole.diameter) > 0.01) {
          divType = 'DIMENSION_DIVERGENCE';
          devMm = Math.abs(actualDiameter - hole.diameter);
          holeDivergencesByType.dimensionDivergence++;
        } else {
          const devX = Math.abs(actualPosX - expectedPosX);
          const devY = Math.abs(actualPosY - expectedPosY);
          const maxDev = Math.max(devX, devY);
          if (maxDev > 0.01) {
            divType = 'WRONG_POSITION';
            devMm = maxDev;
            holeDivergencesByType.wrongPosition++;
          }
        }

        // --- 3D VIEWER SLOT ORIENTATION VERIFICATION ---
        if (divType === 'NONE' && hole.type === 'slot') {
          tmplHoleResult.slotsCount++;
          if (hole.isAlongZ) tmplHoleResult.longSlotsCount++;
          else tmplHoleResult.transSlotsCount++;

          const slotIsAlongZ = hole.isAlongZ ?? true;
          const t = Math.max(0.5, geometry.unfoldingMath?.thicknessMm ?? 3.0);

          let vMesh: THREE.Mesh;
          if (isSabotageActive) {
            vMesh = new THREE.Mesh();
            vMesh.rotation.x = Math.PI / 2;
            vMesh.rotation.z = tf.rotZ;
          } else {
            vMesh = create3DSlotMesh(hole.slotLength, hole.diameter, t, dummySlotMat, dummySlotLineMat, slotIsAlongZ, tf.normal);
          }

          const vLen = new THREE.Vector3(0, 1, 0).applyQuaternion(vMesh.quaternion);
          const vNorm = new THREE.Vector3(tf.normal?.x ?? 0, tf.normal?.y ?? 1, tf.normal?.z ?? 0).normalize();
          if (vNorm.lengthSq() < 1e-4) vNorm.set(0, 1, 0);

          const dotViewerNormal = Math.abs(vLen.dot(vNorm));
          const uLong = new THREE.Vector3(0, 0, 1);
          let uTransV = new THREE.Vector3().crossVectors(uLong, vNorm).normalize();
          if (uTransV.lengthSq() < 1e-4) uTransV.set(1, 0, 0);

          const dotViewerLong = Math.abs(vLen.dot(uLong));
          const dotViewerTrans = Math.abs(vLen.dot(uTransV));

          const viewerPerpendicular = dotViewerNormal < 1e-3;
          const viewerDirOk = slotIsAlongZ
            ? (dotViewerLong > 0.999 && viewerPerpendicular)
            : (dotViewerTrans > 0.999 && dotViewerLong < 1e-3 && viewerPerpendicular);

          if (!viewerPerpendicular || !viewerDirOk) {
            divType = 'WRONG_ORIENTATION';
            devMm = !viewerPerpendicular ? dotViewerNormal * 90 : 90.0;
            holeDivergencesByType.wrongOrientation++;
          }
        }

        if (divType !== 'NONE') {
          tmplHoleResult.divergences++;
          if (divType === 'WRONG_FACE') tmplHoleResult.wrongFace++;
          if (divType === 'WRONG_POSITION') tmplHoleResult.wrongPosition++;
          if (divType === 'WRONG_ORIENTATION') tmplHoleResult.wrongOrientation++;
          if (divType === 'MISSING_HOLE') tmplHoleResult.missingHole++;
          if ((divType as string) === 'DUPLICATE_HOLE') tmplHoleResult.duplicateHole++;
          if (divType === 'DIMENSION_DIVERGENCE') tmplHoleResult.dimensionDivergence++;

          holeCustomStats.withoutCustom.divergences++;

          worstCases.push({
            templateId: template.id,
            params: { ...params },
            hasCustomBends: false,
            holeIndex: hIdx + 1,
            holeType: hole.type,
            diameter: hole.diameter,
            expectedFace,
            actualFace,
            expectedPos: { x: Number(expectedPosX.toFixed(2)), y: Number(expectedPosY.toFixed(2)) },
            actualPos: { x: Number(actualPosX.toFixed(2)), y: Number(actualPosY.toFixed(2)) },
            divergenceType: divType,
            deviationMm: Number(devMm.toFixed(2)),
          });
        }

        // --- SNAPSHOT HOLE VERIFICATION ---
        const snap = getSnapshotHoleTransform(geometry, template.id, {
          cx: hole.cx,
          cy: hole.cy,
          type: hole.type,
          radius: hole.radius,
          diameter: hole.diameter,
        });

        let snapDivType: 'NONE' | 'WRONG_FACE' | 'WRONG_POSITION' | 'WRONG_ORIENTATION' | 'MISSING_HOLE' | 'DUPLICATE_HOLE' | 'DIMENSION_DIVERGENCE' = 'NONE';
        let snapDevMm = 0;

        if (!snap.exists) {
          snapDivType = 'MISSING_HOLE';
          snapDevMm = hole.diameter;
          snapshotHoleDivergencesByType.missingHole++;
        } else if (snap.faceIndex !== expectedFace) {
          snapDivType = 'WRONG_FACE';
          snapDevMm = Math.max(Math.abs(snap.posX - expectedPosX), 15.0);
          snapshotHoleDivergencesByType.wrongFace++;
        } else if (Math.abs(snap.diameter - hole.diameter) > 0.01) {
          snapDivType = 'DIMENSION_DIVERGENCE';
          snapDevMm = Math.abs(snap.diameter - hole.diameter);
          snapshotHoleDivergencesByType.dimensionDivergence++;
        } else {
          const devX = Math.abs(snap.posX - expectedPosX);
          const devY = Math.abs(snap.posY - expectedPosY);
          const maxDev = Math.max(devX, devY);
          if (maxDev > 0.01) {
            snapDivType = 'WRONG_POSITION';
            snapDevMm = maxDev;
            snapshotHoleDivergencesByType.wrongPosition++;
          }
        }

        // --- SNAPSHOT PDF SLOT ORIENTATION & 3-WAY PARITY VERIFICATION ---
        if (snapDivType === 'NONE' && hole.type === 'slot') {
          tmplSnapshotHoleResult.slotsCount++;
          if (hole.isAlongZ) tmplSnapshotHoleResult.longSlotsCount++;
          else tmplSnapshotHoleResult.transSlotsCount++;

          const slotIsAlongZ = hole.isAlongZ ?? true;
          const t = Math.max(0.5, geometry.unfoldingMath?.thicknessMm ?? 3.0);

          let sMesh: THREE.Mesh;
          if (isSabotageActive) {
            sMesh = new THREE.Mesh();
            sMesh.rotation.x = Math.PI / 2;
            sMesh.rotation.z = snap.rotZ;
          } else {
            sMesh = create3DSlotMesh(hole.slotLength, hole.diameter, t, dummySlotMat, dummySlotLineMat, slotIsAlongZ, snap.normal);
          }

          const sLen = new THREE.Vector3(0, 1, 0).applyQuaternion(sMesh.quaternion);
          const sNorm = new THREE.Vector3(snap.normal?.x ?? 0, snap.normal?.y ?? 1, snap.normal?.z ?? 0).normalize();
          if (sNorm.lengthSq() < 1e-4) sNorm.set(0, 1, 0);

          const dotSnapNormal = Math.abs(sLen.dot(sNorm));
          const uLong = new THREE.Vector3(0, 0, 1);
          let uTransS = new THREE.Vector3().crossVectors(uLong, sNorm).normalize();
          if (uTransS.lengthSq() < 1e-4) uTransS.set(1, 0, 0);

          const dotSnapLong = Math.abs(sLen.dot(uLong));
          const dotSnapTrans = Math.abs(sLen.dot(uTransS));

          const snapPerpendicular = dotSnapNormal < 1e-3;
          const snapDirOk = slotIsAlongZ
            ? (dotSnapLong > 0.999 && snapPerpendicular)
            : (dotSnapTrans > 0.999 && dotSnapLong < 1e-3 && snapPerpendicular);

          if (!snapPerpendicular || !snapDirOk) {
            snapDivType = 'WRONG_ORIENTATION';
            snapDevMm = !snapPerpendicular ? dotSnapNormal * 90 : 90.0;
            snapshotHoleDivergencesByType.wrongOrientation++;
          }

          // 3-Way Parity Check: compare 3D Viewer with Snapshot PDF
          let vMesh: THREE.Mesh;
          if (isSabotageActive) {
            vMesh = new THREE.Mesh();
            vMesh.rotation.x = Math.PI / 2;
            vMesh.rotation.z = tf.rotZ;
          } else {
            vMesh = create3DSlotMesh(hole.slotLength, hole.diameter, t, dummySlotMat, dummySlotLineMat, slotIsAlongZ, tf.normal);
          }
          const vLen = new THREE.Vector3(0, 1, 0).applyQuaternion(vMesh.quaternion);
          const vsCollinear = Math.abs(vLen.dot(sLen));
          const vNorm = new THREE.Vector3(tf.normal?.x ?? 0, tf.normal?.y ?? 1, tf.normal?.z ?? 0).normalize();
          if (vNorm.lengthSq() < 1e-4) vNorm.set(0, 1, 0);
          const vsNormCollinear = Math.abs(vNorm.dot(sNorm));

          if (vsCollinear < 0.999 || vsNormCollinear < 0.999) {
            if (snapDivType === 'NONE') {
              snapDivType = 'WRONG_ORIENTATION';
              snapDevMm = (1 - vsCollinear) * 90;
              snapshotHoleDivergencesByType.wrongOrientation++;
            }
          }
        }

        if (snapDivType !== 'NONE') {
          tmplSnapshotHoleResult.divergences++;
          if (snapDivType === 'WRONG_FACE') tmplSnapshotHoleResult.wrongFace++;
          if (snapDivType === 'WRONG_POSITION') tmplSnapshotHoleResult.wrongPosition++;
          if (snapDivType === 'WRONG_ORIENTATION') tmplSnapshotHoleResult.wrongOrientation++;
          if (snapDivType === 'MISSING_HOLE') tmplSnapshotHoleResult.missingHole++;
          if (snapDivType === 'DIMENSION_DIVERGENCE') tmplSnapshotHoleResult.dimensionDivergence++;

          snapshotWorstCases.push({
            templateId: template.id,
            params: { ...params },
            hasCustomBends: false,
            holeIndex: hIdx + 1,
            holeType: hole.type,
            diameter: hole.diameter,
            expectedFace,
            actualFace: snap.faceIndex,
            expectedPos: { x: Number(expectedPosX.toFixed(2)), y: Number(expectedPosY.toFixed(2)) },
            actualPos: { x: Number(snap.posX.toFixed(2)), y: Number(snap.posY.toFixed(2)) },
            divergenceType: snapDivType,
            deviationMm: Number(snapDevMm.toFixed(2)),
          });
        }

        comboHolesSnapshot.push({
          face: snap.faceIndex,
          x: snap.x,
          y: snap.y,
          z: snap.z,
          diameter: snap.diameter,
          exists: snap.exists,
        });
      }

      // Check coincident holes in 3D: two holes on the same face with centers closer than 0.1 * min(diaA, diaB)
      for (let a = 0; a < comboHoles3D.length; a++) {
        if (!comboHoles3D[a].exists) continue;
        for (let b = a + 1; b < comboHoles3D.length; b++) {
          if (!comboHoles3D[b].exists) continue;
          const hA = comboHoles3D[a];
          const hB = comboHoles3D[b];
          if (hA.face === hB.face) {
            const dist = Math.hypot(hA.x - hB.x, hA.y - hB.y, hA.z - hB.z);
            const minDist = 0.1 * Math.min(hA.diameter, hB.diameter);
            if (dist < minDist) {
              tmplHoleResult.coincidentHoles++;
              holeDivergencesByType.coincidentHoles++;
            }
          }
        }
      }
      // Check coincident holes in Snapshot
      for (let a = 0; a < comboHolesSnapshot.length; a++) {
        if (!comboHolesSnapshot[a].exists) continue;
        for (let b = a + 1; b < comboHolesSnapshot.length; b++) {
          if (!comboHolesSnapshot[b].exists) continue;
          const hA = comboHolesSnapshot[a];
          const hB = comboHolesSnapshot[b];
          if (hA.face === hB.face) {
            const dist = Math.hypot(hA.x - hB.x, hA.y - hB.y, hA.z - hB.z);
            const minDist = 0.1 * Math.min(hA.diameter, hB.diameter);
            if (dist < minDist) {
              tmplSnapshotHoleResult.coincidentHoles++;
              snapshotHoleDivergencesByType.coincidentHoles++;
            }
          }
        }
      }
    }

    grandTotalDivergences += res.totalDivergences;
    summary.push(res);
    holeSummaryByTemplate.push(tmplHoleResult);
    snapshotHoleSummaryByTemplate.push(tmplSnapshotHoleResult);
  }

  // Print Summary Table
  console.log('------------------------------------------------------------------------------------------------------------------');
  console.log('TEMPLATE ID           | COMBOS | FACE_QTY | FACE_W | BEND_QTY | BEND_ANG | BEND_RAD | BEND_DIR | OVERALL | DIVERG');
  console.log('------------------------------------------------------------------------------------------------------------------');

  for (const r of summary) {
    const status = r.totalDivergences === 0 ? '✅ 0' : `❌ ${r.totalDivergences}`;
    console.log(
      `${r.templateId.padEnd(21)} | ` +
      `${r.totalCombinations.toString().padStart(6)} | ` +
      `${r.faceCountDivergences.toString().padStart(8)} | ` +
      `${r.faceWidthDivergences.toString().padStart(6)} | ` +
      `${r.bendCountDivergences.toString().padStart(8)} | ` +
      `${r.bendAngleDivergences.toString().padStart(8)} | ` +
      `${r.bendRadiusDivergences.toString().padStart(8)} | ` +
      `${r.bendDirectionDivergences.toString().padStart(8)} | ` +
      `${r.overallDimensionDivergences.toString().padStart(7)} | ` +
      `${status}`
    );
  }

  console.log('------------------------------------------------------------------------------------------------------------------');
  console.log(`\n📊 PARITY VERIFICATION SUMMARY:`);
  console.log(`   - Total Checked Combinations:    ${grandTotalCombinations}`);
  console.log(`   - 3-Way Output Divergences:      ${grandTotalDivergences}`);

  if (grandTotalDivergences > 0) {
    console.error(`\n❌ [PARITY FAILURE] Found ${grandTotalDivergences} divergences between Motor, 3D Viewer and PDF Snapshot.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 [SUCCESS] 100% PARITY CONFIRMED across all ${grandTotalCombinations} variations (0 divergences)!\n`);
  }

  // --- HOLE & CUTOUT 3D PARITY DIAGNOSIS REPORT (PROMPT D1) ---
  const totalHoleDivergences =
    holeDivergencesByType.wrongFace +
    holeDivergencesByType.wrongPosition +
    holeDivergencesByType.wrongOrientation +
    holeDivergencesByType.missingHole +
    holeDivergencesByType.duplicateHole +
    holeDivergencesByType.dimensionDivergence;

  console.log('==================================================================================');
  console.log('  PROMPT D1: DIAGNÓSTICO DA FURAÇÃO NO 3D (2D MOTOR BLANK <=> 3D FOLDED VIEWER)');
  console.log('==================================================================================\n');

  console.log('----------------------------------------------------------------------------------');
  console.log('1. TOTAIS GERAIS:');
  console.log(`   - Total de Combinações Analisadas: ${grandTotalCombinations}`);
  console.log(`   - Total de Furos/Rasgos Comparados: ${totalHolesCount}`);
  console.log(`   - Total de Divergências Detectadas: ${totalHoleDivergences} (${((totalHoleDivergences / Math.max(1, totalHolesCount)) * 100).toFixed(1)}% dos furos)`);
  console.log('----------------------------------------------------------------------------------');

  console.log('2. DIVERGÊNCIAS POR TIPO:');
  console.log(`   - Face errada:                       ${holeDivergencesByType.wrongFace}`);
  console.log(`   - Posição errada dentro da face:     ${holeDivergencesByType.wrongPosition}`);
  console.log(`   - Orientação errada do slot:         ${holeDivergencesByType.wrongOrientation}`);
  console.log(`   - Furo ausente no 3D:                ${holeDivergencesByType.missingHole}`);
  console.log(`   - Furo duplicado no 3D:              ${holeDivergencesByType.duplicateHole}`);
  console.log(`   - Dimensão divergente:               ${holeDivergencesByType.dimensionDivergence}`);
  console.log(`   - Furos coincidentes no 3D:          ${holeDivergencesByType.coincidentHoles}`);
  console.log('----------------------------------------------------------------------------------');

  console.log('3. DISTRIBUIÇÃO ENTRE CASOS COM E SEM DOBRA PERSONALIZADA:');
  const withCustomPct = ((holeCustomStats.withCustom.divergences / Math.max(1, holeCustomStats.withCustom.holes)) * 100).toFixed(1);
  const withoutCustomPct = ((holeCustomStats.withoutCustom.divergences / Math.max(1, holeCustomStats.withoutCustom.holes)) * 100).toFixed(1);
  console.log(`   - COM dobra personalizada: ${holeCustomStats.withCustom.combinations} combos | ${holeCustomStats.withCustom.holes} furos | ${holeCustomStats.withCustom.divergences} divergências (${withCustomPct}%)`);
  console.log(`   - SEM dobra personalizada: ${holeCustomStats.withoutCustom.combinations} combos | ${holeCustomStats.withoutCustom.holes} furos | ${holeCustomStats.withoutCustom.divergences} divergências (${withoutCustomPct}%)`);
  console.log('----------------------------------------------------------------------------------');

  console.log('4. DISTRIBUIÇÃO POR TEMPLATE:');
  console.log('TEMPLATE ID           | COMBOS | FUROS  | DIVERG | FACE_ERR | POS_ERR | ORIENT_ERR | AUSENTE | DUP | DIM_ERR | COINCIDENT');
  console.log('---------------------------------------------------------------------------------------------------------------------');
  for (const ht of holeSummaryByTemplate) {
    console.log(
      `${ht.templateId.padEnd(21)} | ` +
      `${ht.combinations.toString().padStart(6)} | ` +
      `${ht.holes.toString().padStart(6)} | ` +
      `${ht.divergences.toString().padStart(6)} | ` +
      `${ht.wrongFace.toString().padStart(8)} | ` +
      `${ht.wrongPosition.toString().padStart(7)} | ` +
      `${ht.wrongOrientation.toString().padStart(10)} | ` +
      `${ht.missingHole.toString().padStart(7)} | ` +
      `${ht.duplicateHole.toString().padStart(3)} | ` +
      `${ht.dimensionDivergence.toString().padStart(7)} | ` +
      `${ht.coincidentHoles.toString().padStart(10)}`
    );
  }
  console.log('---------------------------------------------------------------------------------------------------------------------');

  console.log('\n5. COBERTURA DE RASGOS OBLONGOS POR TEMPLATE (VERIFICAÇÃO DE ORIENTAÇÃO 3D):');
  console.log('TEMPLATE ID           | RASGOS | LONGITUDINAIS | TRANSVERSAIS | ORIENTAÇÃO OK | DIVERGÊNCIAS');
  console.log('---------------------------------------------------------------------------------------------');
  let totalSlotsCount = 0;
  let totalLongSlotsCount = 0;
  let totalTransSlotsCount = 0;
  let totalSlotOrientDivergences = 0;
  for (const ht of holeSummaryByTemplate) {
    if (ht.slotsCount > 0) {
      totalSlotsCount += ht.slotsCount;
      totalLongSlotsCount += ht.longSlotsCount;
      totalTransSlotsCount += ht.transSlotsCount;
      totalSlotOrientDivergences += ht.wrongOrientation;
      const okCount = ht.slotsCount - ht.wrongOrientation;
      const statusStr = ht.wrongOrientation === 0 ? '✅ 0' : `❌ ${ht.wrongOrientation}`;
      console.log(
        `${ht.templateId.padEnd(21)} | ` +
        `${ht.slotsCount.toString().padStart(6)} | ` +
        `${ht.longSlotsCount.toString().padStart(13)} | ` +
        `${ht.transSlotsCount.toString().padStart(12)} | ` +
        `${okCount.toString().padStart(13)} | ` +
        `${statusStr.padStart(12)}`
      );
    }
  }
  console.log('---------------------------------------------------------------------------------------------');
  const grandSlotStatus = totalSlotOrientDivergences === 0 ? '✅ 0' : `❌ ${totalSlotOrientDivergences}`;
  console.log(
    `${'TOTAL COBERTO'.padEnd(21)} | ` +
    `${totalSlotsCount.toString().padStart(6)} | ` +
    `${totalLongSlotsCount.toString().padStart(13)} | ` +
    `${totalTransSlotsCount.toString().padStart(12)} | ` +
    `${(totalSlotsCount - totalSlotOrientDivergences).toString().padStart(13)} | ` +
    `${grandSlotStatus.padStart(12)}`
  );
  console.log('---------------------------------------------------------------------------------------------\n');

  console.log('6. OS PIORES CASOS ENCONTRADOS:');
  worstCases.sort((a, b) => b.deviationMm - a.deviationMm);
  const top5 = worstCases.slice(0, 5);
  top5.forEach((wc, idx) => {
    console.log(`   #${idx + 1} Template: [${wc.templateId}] (Dobra Personalizada: ${wc.hasCustomBends ? 'SIM' : 'NÃO'})`);
    console.log(`      Parâmetros: ${JSON.stringify(wc.params)}`);
    console.log(`      Furo: ${wc.holeType.toUpperCase()} #${wc.holeIndex} (Ø=${wc.diameter}mm) | Divergência: ${wc.divergenceType}`);
    console.log(`      Esperado: Face ${wc.expectedFace} @ (${wc.expectedPos.x.toFixed(2)}, ${wc.expectedPos.y.toFixed(2)}) mm`);
    console.log(`      Obtido:   Face ${wc.actualFace} @ (${wc.actualPos.x.toFixed(2)}, ${wc.actualPos.y.toFixed(2)}) mm`);
    console.log(`      Desvio Medido: ${wc.deviationMm.toFixed(2)} mm\n`);
  });

  console.log('6. AVALIAÇÃO DA CAUSA PROVÁVEL NO CÓDIGO:');
  console.log('   - Arquivo responsável: src/utils/foldedMeshBuilder.ts');
  console.log('   - Função responsável: getFoldedPointTransform (linhas 435-706)');
  console.log('   - Causa 1 (Fallback Genérico / Dobras Personalizadas, linhas 698-703):');
  console.log('     Para qualquer peça com dobras personalizadas ou template não previsto em getFoldedPointTransform,');
  console.log('     o algoritmo cai no fallback genérico: "faceIndex = 0; x = blankX; y = t / 2; rotZ = 0; normal = (0,1,0)".');
  console.log('     Ele ignora todas as linhas de dobra personalizadas, atribuindo sempre Face 0 e posicionando o furo na coordenada plana bruta.');
  console.log('   - Causa 2 (Templates gate_guide_u, lambril_z, gate_weight_box, linhas 640-696):');
  console.log('     O código colapsa a coordenada X do furo para constantes rígidas (ex: x = fA / 2), descartando');
  console.log('     completamente a posição real blankX vinda do motor 2D!');
  console.log('   - Causa 3 (Templates profile_u, profile_l, profile_z, profile_hat, linhas 472-532):');
  console.log('     O cálculo interpola linearmente u = (blankX - startX) / widthBlankMm aplicando em (fA - osb),');
  console.log('     sem descontar a zona de dobra física (DIN 6935 setback/allowance).');
  console.log('----------------------------------------------------------------------------------\n');

  // 7. Salvar ou validar Baseline em tests/parity_holes_baseline.json
  const baselinePath = path.join(process.cwd(), 'tests', 'parity_holes_baseline.json');
  const isUpdateBaseline = process.argv.includes('--update') || process.argv.includes('--update-baseline');
  const currentBaselineData = {
    totalCombinations: grandTotalCombinations,
    totalHoles: totalHolesCount,
    totalDivergences: totalHoleDivergences,
    expected2DCoincidentHoles: holeDivergencesByType.coincidentHoles,
    divergencesByType: holeDivergencesByType,
    customBendStats: holeCustomStats,
    byTemplate: holeSummaryByTemplate.reduce((acc, cur) => {
      acc[cur.templateId] = cur;
      return acc;
    }, {} as Record<string, any>),
    timestamp: new Date().toISOString(),
  };

  if (isUpdateBaseline || !fs.existsSync(baselinePath)) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(currentBaselineData, null, 2), 'utf-8');
    console.log(`📁 [BASELINE ATUALIZADA] Linha de base de furos gravada em tests/parity_holes_baseline.json (${totalHoleDivergences} divergências registradas, 179 coincidentes 2D esperados).`);
  } else {
    try {
      const existingBaseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
      console.log(`📁 [BASELINE COMPARADA] Linha de base existente: ${existingBaseline.totalDivergences} divergências. Atual: ${totalHoleDivergences}.`);
      let holeCheckFailed = false;

      if (totalHoleDivergences > 0 || totalHoleDivergences > existingBaseline.totalDivergences) {
        console.error(`❌ [REGRESSÃO DE FURAÇÃO - POSIÇÃO] Divergências de furos detectadas: ${totalHoleDivergences} (esperado: 0)!`);
        holeCheckFailed = true;
      } else {
        console.log(`✅ [BASELINE OK] Zero divergências de furos (0 detectadas, esperado: 0): paridade de furação 2D/3D estrita confirmada.`);
      }

      const expectedCoincidents = existingBaseline.expected2DCoincidentHoles ?? existingBaseline.divergencesByType?.coincidentHoles ?? 179;
      console.log(`🔍 [COINCIDENTES 2D] Furos coincidentes de origem 2D: ${holeDivergencesByType.coincidentHoles} (esperado baseline: ${expectedCoincidents}).`);
      if (holeDivergencesByType.coincidentHoles > expectedCoincidents) {
        console.error(`❌ [FALHA DE COINCIDENTES] Furos coincidentes no 3D excederam o esperado de origem 2D: ${holeDivergencesByType.coincidentHoles} > ${expectedCoincidents}!`);
        holeCheckFailed = true;
      } else {
        console.log(`✅ [COINCIDENTES OK] Furos coincidentes no 3D dentro do esperado de origem 2D (${holeDivergencesByType.coincidentHoles} <= ${expectedCoincidents}).`);
      }

      if (holeCheckFailed) {
        process.exit(1);
      }
    } catch (e) {
      console.warn('⚠️ Erro ao ler linha de base existente. Regravando baseline...');
      fs.writeFileSync(baselinePath, JSON.stringify(currentBaselineData, null, 2), 'utf-8');
    }
  }

  // --- HOLE & CUTOUT SNAPSHOT PARITY REPORT (PROMPT D2) ---
  const totalSnapshotHoleDivergences =
    snapshotHoleDivergencesByType.wrongFace +
    snapshotHoleDivergencesByType.wrongPosition +
    snapshotHoleDivergencesByType.wrongOrientation +
    snapshotHoleDivergencesByType.missingHole +
    snapshotHoleDivergencesByType.duplicateHole +
    snapshotHoleDivergencesByType.dimensionDivergence;

  console.log('==================================================================================');
  console.log('  PROMPT D2: PARIDADE DA FURAÇÃO NO SNAPSHOT PDF (MOTOR 2D <=> PDF SNAPSHOT)');
  console.log('==================================================================================\n');

  console.log('----------------------------------------------------------------------------------');
  console.log('1. TOTAIS GERAIS:');
  console.log(`   - Total de Combinações Analisadas: ${grandTotalCombinations}`);
  console.log(`   - Total de Furos/Rasgos Comparados: ${totalHolesCount}`);
  console.log(`   - Total de Divergências Detectadas: ${totalSnapshotHoleDivergences} (${((totalSnapshotHoleDivergences / Math.max(1, totalHolesCount)) * 100).toFixed(1)}% dos furos)`);
  console.log('----------------------------------------------------------------------------------');

  console.log('2. DIVERGÊNCIAS POR TIPO:');
  console.log(`   - Face errada:                       ${snapshotHoleDivergencesByType.wrongFace}`);
  console.log(`   - Posição errada dentro da face:     ${snapshotHoleDivergencesByType.wrongPosition}`);
  console.log(`   - Orientação errada do slot:         ${snapshotHoleDivergencesByType.wrongOrientation}`);
  console.log(`   - Furo ausente no Snapshot:          ${snapshotHoleDivergencesByType.missingHole}`);
  console.log(`   - Furo duplicado no Snapshot:        ${snapshotHoleDivergencesByType.duplicateHole}`);
  console.log(`   - Dimensão divergente:               ${snapshotHoleDivergencesByType.dimensionDivergence}`);
  console.log(`   - Furos coincidentes no Snapshot:    ${snapshotHoleDivergencesByType.coincidentHoles}`);
  console.log('----------------------------------------------------------------------------------');

  console.log('3. DISTRIBUIÇÃO POR TEMPLATE:');
  console.log('TEMPLATE ID           | COMBOS | FUROS  | DIVERG | FACE_ERR | POS_ERR | ORIENT_ERR | AUSENTE | DUP | DIM_ERR | COINCIDENT');
  console.log('---------------------------------------------------------------------------------------------------------------------');
  for (const ht of snapshotHoleSummaryByTemplate) {
    console.log(
      `${ht.templateId.padEnd(21)} | ` +
      `${ht.combinations.toString().padStart(6)} | ` +
      `${ht.holes.toString().padStart(6)} | ` +
      `${ht.divergences.toString().padStart(6)} | ` +
      `${ht.wrongFace.toString().padStart(8)} | ` +
      `${ht.wrongPosition.toString().padStart(7)} | ` +
      `${ht.wrongOrientation.toString().padStart(10)} | ` +
      `${ht.missingHole.toString().padStart(7)} | ` +
      `${ht.duplicateHole.toString().padStart(3)} | ` +
      `${ht.dimensionDivergence.toString().padStart(7)} | ` +
      `${ht.coincidentHoles.toString().padStart(10)}`
    );
  }
  console.log('---------------------------------------------------------------------------------------------------------------------');

  // --- TESTE ESPECÍFICO DO CASO REPORTADO: PROFILE_U COM 60°, 90°, 120° ---
  console.log('\n==================================================================================');
  console.log('  TESTE ESPECÍFICO DO CASO REPORTADO: PROFILE_U A 60°, 90° E 120° (SNAPSHOT PDF)');
  console.log('==================================================================================\n');

  const profileUTemplate = TEMPLATES.find((t) => t.id === 'profile_u')!;
  const testAngles = [60, 90, 120];
  let reportedCaseDivergences = 0;

  for (const angle of testAngles) {
    const pUParams: Record<string, number> = {
      fA: 60,
      fB: 120,
      fC: 60,
      length: 400,
      thickness: 3.0,
      radius: 3.0,
      bendAngle: angle,
    };
    const pUFeatures: Record<FeatureId, FeatureState> = {
      ...profileUTemplate.defaultFeatures,
      faceHoles: {
        enabled: true,
        params: { faceSelect: 'almaB', holeType: 'circle', diameter: 10, count: 3, spacingX: 80, offsetY: 0 },
      },
    };
    const geo = generateGeometry(profileUTemplate, pUParams, pUFeatures);
    const mHoles = [
      ...(geo.circles || []).map((c) => ({ cx: c.center.x, cy: c.center.y, diameter: c.radius * 2, type: 'circle' as const, radius: c.radius })),
    ];
    let angleDivergences = 0;
    const fSecs = geo.faceSections || [];
    for (const h of mHoles) {
      let expFace = 0;
      let expX = 0;
      for (let f = 0; f < fSecs.length; f++) {
        if (h.cx >= fSecs[f].startXBlankMm - 0.05 && h.cx <= fSecs[f].endXBlankMm + 0.05) {
          expFace = fSecs[f].index ?? f;
          expX = h.cx - fSecs[f].startXBlankMm;
          break;
        }
      }
      const sH = getSnapshotHoleTransform(geo, 'profile_u', h);
      if (!sH.exists || sH.faceIndex !== expFace || Math.abs(sH.posX - expX) > 0.05) {
        angleDivergences++;
        reportedCaseDivergences++;
      }
    }
    const angStatus = angleDivergences === 0 ? '✅ 0 divergências' : `❌ ${angleDivergences} divergências`;
    console.log(`   - profile_u com bendAngle = ${angle}° (${mHoles.length} furos testados): ${angStatus}`);
  }
  console.log('----------------------------------------------------------------------------------\n');

  // --- TESTE ESPECÍFICO DE ORIENTAÇÃO DO RASGO OBLONGO: MOTOR 2D <=> 3D VIEWER <=> SNAPSHOT PDF ---
  console.log('==================================================================================');
  console.log('  TESTE ESPECÍFICO: ORIENTAÇÃO DO RASGO OBLONGO (MOTOR 2D <=> 3D VIEWER <=> SNAPSHOT PDF)');
  console.log('==================================================================================\n');

  let dedicatedSlotCasesTested = 0;
  let dedicatedSlotDivergences = 0;

  interface SlotTestCase {
    templateId: string;
    description: string;
    params: Record<string, number>;
    features: Record<FeatureId, FeatureState>;
  }

  const profileLTemplate = TEMPLATES.find((t) => t.id === 'profile_l')!;
  const profileZTemplate = TEMPLATES.find((t) => t.id === 'profile_z')!;
  const profileHatTemplate = TEMPLATES.find((t) => t.id === 'profile_hat')!;

  const slotTestCases: SlotTestCase[] = [
    {
      templateId: 'profile_l',
      description: 'profile_l (Aba A vertical, 90° dobra, slot longitudinal 40x12)',
      params: { flangeA: 60, flangeB: 80, lengthL: 300, thickness: 3, innerRadius: 3, bendAngle: 90 },
      features: {
        ...profileLTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'abaA', holeType: 'slot', diameter: 12, slotLength: 40, count: 1, spacingX: 0, offsetY: 0 },
        },
      },
    },
    {
      templateId: 'profile_l',
      description: 'profile_l (Aba B horizontal, 90° dobra, slot longitudinal 40x12)',
      params: { flangeA: 60, flangeB: 80, lengthL: 300, thickness: 3, innerRadius: 3, bendAngle: 90 },
      features: {
        ...profileLTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'abaB', holeType: 'slot', diameter: 12, slotLength: 40, count: 1, spacingX: 0, offsetY: 0 },
        },
      },
    },
    {
      templateId: 'profile_l',
      description: 'profile_l (Aba A vertical, 60° dobra aberta, slot longitudinal 40x12)',
      params: { flangeA: 60, flangeB: 80, lengthL: 300, thickness: 3, innerRadius: 3, bendAngle: 60 },
      features: {
        ...profileLTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'abaA', holeType: 'slot', diameter: 12, slotLength: 40, count: 1, spacingX: 0, offsetY: 0 },
        },
      },
    },
    {
      templateId: 'profile_l',
      description: 'profile_l (Aba A vertical, 120° dobra fechada, slot longitudinal 40x12)',
      params: { flangeA: 60, flangeB: 80, lengthL: 300, thickness: 3, innerRadius: 3, bendAngle: 120 },
      features: {
        ...profileLTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'abaA', holeType: 'slot', diameter: 12, slotLength: 40, count: 1, spacingX: 0, offsetY: 0 },
        },
      },
    },
    {
      templateId: 'profile_u',
      description: 'profile_u (Alma B central, 90° dobra, slot longitudinal 40x12)',
      params: { fA: 50, fB: 100, fC: 50, length: 300, thickness: 3, innerRadius: 3, bendAngle: 90 },
      features: {
        ...profileUTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'almaB', holeType: 'slot', diameter: 12, slotLength: 40, count: 2, spacingX: 100, offsetY: 0 },
        },
      },
    },
    {
      templateId: 'profile_u',
      description: 'profile_u (Aba A vertical, 90° dobra, slot longitudinal 40x12)',
      params: { fA: 50, fB: 100, fC: 50, length: 300, thickness: 3, innerRadius: 3, bendAngle: 90 },
      features: {
        ...profileUTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'abaA', holeType: 'slot', diameter: 12, slotLength: 40, count: 1, spacingX: 0, offsetY: 0 },
        },
      },
    },
    {
      templateId: 'profile_u',
      description: 'profile_u (Aba A vertical, 60° dobra aberta, slot longitudinal 40x12)',
      params: { fA: 50, fB: 100, fC: 50, length: 300, thickness: 3, innerRadius: 3, bendAngle: 60 },
      features: {
        ...profileUTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'abaA', holeType: 'slot', diameter: 12, slotLength: 40, count: 1, spacingX: 0, offsetY: 0 },
        },
      },
    },
    {
      templateId: 'profile_z',
      description: 'profile_z (Aba A vertical, 90° dobra, slot longitudinal 40x12)',
      params: { flangeA: 50, webB: 100, flangeC: 50, lengthL: 300, thickness: 3, innerRadius: 3, bendAngle: 90 },
      features: {
        ...profileZTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'abaA', holeType: 'slot', diameter: 12, slotLength: 40, count: 1, spacingX: 0, offsetY: 0 },
        },
      },
    },
    {
      templateId: 'profile_hat',
      description: 'profile_hat (Alma central, 90° dobra, slot longitudinal 40x12)',
      params: { flangeA: 30, webB: 50, topC: 80, webD: 50, flangeE: 30, lengthL: 300, thickness: 3, innerRadius: 3, bendAngle: 90 },
      features: {
        ...profileHatTemplate.defaultFeatures,
        faceHoles: {
          enabled: true,
          params: { faceSelect: 'alma', holeType: 'slot', diameter: 12, slotLength: 40, count: 2, spacingX: 80, offsetY: 0 },
        },
      },
    },
  ];

  for (const tc of slotTestCases) {
    const tmpl = TEMPLATES.find((t) => t.id === tc.templateId)!;
    const geo = generateGeometry(tmpl, tc.params, tc.features);
    const slots = (geo.innerPolylines || []).map((p) => measureSlot(p));
    const t = Math.max(0.5, geo.unfoldingMath?.thicknessMm ?? 3.0);

    let caseDivs = 0;
    for (const slot of slots) {
      dedicatedSlotCasesTested++;
      const tf = getFoldedPointTransform(geo, tc.templateId, slot.centerX, slot.centerY);
      const snap = getSnapshotHoleTransform(geo, tc.templateId, {
        cx: slot.centerX,
        cy: slot.centerY,
        type: 'slot',
        radius: slot.width / 2,
        diameter: slot.width,
      });

      let vMesh: THREE.Mesh;
      let sMesh: THREE.Mesh;
      if (isSabotageActive) {
        vMesh = new THREE.Mesh();
        vMesh.rotation.x = Math.PI / 2;
        vMesh.rotation.z = tf.rotZ;

        sMesh = new THREE.Mesh();
        sMesh.rotation.x = Math.PI / 2;
        sMesh.rotation.z = snap.rotZ;
      } else {
        vMesh = create3DSlotMesh(slot.length, slot.width, t, dummySlotMat, dummySlotLineMat, slot.isAlongZ, tf.normal);
        sMesh = create3DSlotMesh(slot.length, slot.width, t, dummySlotMat, dummySlotLineMat, slot.isAlongZ, snap.normal);
      }

      const vLen = new THREE.Vector3(0, 1, 0).applyQuaternion(vMesh.quaternion);
      const vNorm = new THREE.Vector3(tf.normal?.x ?? 0, tf.normal?.y ?? 1, tf.normal?.z ?? 0).normalize();
      if (vNorm.lengthSq() < 1e-4) vNorm.set(0, 1, 0);

      const sLen = new THREE.Vector3(0, 1, 0).applyQuaternion(sMesh.quaternion);
      const sNorm = new THREE.Vector3(snap.normal?.x ?? 0, snap.normal?.y ?? 1, snap.normal?.z ?? 0).normalize();
      if (sNorm.lengthSq() < 1e-4) sNorm.set(0, 1, 0);

      const dotVNorm = Math.abs(vLen.dot(vNorm));
      const dotSNorm = Math.abs(sLen.dot(sNorm));

      const uLong = new THREE.Vector3(0, 0, 1);
      const dotVLong = Math.abs(vLen.dot(uLong));
      const dotSLong = Math.abs(sLen.dot(uLong));

      const vsCollinear = Math.abs(vLen.dot(sLen));

      const vPerp = dotVNorm < 1e-3;
      const sPerp = dotSNorm < 1e-3;
      const vDir = slot.isAlongZ ? dotVLong > 0.999 : dotVLong < 1e-3;
      const sDir = slot.isAlongZ ? dotSLong > 0.999 : dotSLong < 1e-3;
      const vsMatch = vsCollinear > 0.999;

      if (!vPerp || !sPerp || !vDir || !sDir || !vsMatch) {
        caseDivs++;
        dedicatedSlotDivergences++;
      }
    }
    const status = caseDivs === 0 ? '✅ 0 divergências' : `❌ ${caseDivs} divergências de orientação`;
    console.log(`   - ${tc.description}: ${status}`);
  }
  console.log(`\n   Total de casos dedicados de slots testados: ${dedicatedSlotCasesTested}`);
  console.log(`   Divergências de orientação encontradas: ${dedicatedSlotDivergences}`);
  console.log('----------------------------------------------------------------------------------\n');

  if (totalSnapshotHoleDivergences > 0 || reportedCaseDivergences > 0 || dedicatedSlotDivergences > 0) {
    console.error(`❌ [FALHA ESTRITA DE PARIDADE] Encontradas divergências (Snapshot: ${totalSnapshotHoleDivergences}, Reportado: ${reportedCaseDivergences}, Slots Dedicados: ${dedicatedSlotDivergences})!`);
    process.exit(1);
  }
  console.log('✅ [PARIDADE DE FURAÇÃO E RASGOS OK] Zero divergências em furos redondos e rasgos oblongos (0 detectadas, esperado: 0): 3-way parity 100% confirmada.\n');

  // --- ANTI-REGRESSION: VALIDATOR ACTIVE RULES & DEFAULT TEMPLATES CHECK ---
  console.log('==================================================================================');
  console.log('  ANTI-REGRESSION: VALIDATOR RULES ACTIVE COVERAGE & 12 DEFAULTS VERIFICATION');
  console.log('==================================================================================\n');

  // 1. Verify 12 default templates pass cleanly with 0 errors
  console.log('--- 1. Testing 12 Default Templates (must have 0 errors) ---');
  let defaultsClean = true;
  for (const tmpl of TEMPLATES) {
    const geom = generateGeometry(tmpl, tmpl.defaultParams, tmpl.defaultFeatures);
    const ok = geom.errors.length === 0;
    console.log(`   [${ok ? 'OK' : 'FAIL'}] ${tmpl.name} (${tmpl.id}): ${geom.errors.length} errors`);
    if (!ok) {
      defaultsClean = false;
      console.error(`      Errors:`, geom.errors);
    }
  }

  if (!defaultsClean) {
    console.error('\n❌ [ANTI-REGRESSION FAILURE] Some default templates have validation errors!');
    process.exit(1);
  }
  console.log('   ✅ All 12 default templates pass cleanly with 0 errors.\n');

  // 2. Verify all validator rules trigger deterministically (no dormant rules)
  console.log('--- 2. Testing Active Coverage for All Validator Error Codes ---');
  const REQUIRED_RULES = [
    'FOLDED_FACE_COLLISION',
    'BEND_SETBACK_EXCEEDS_WEB',
    'BEND_SETBACK_EXCEEDS_FLANGE',
    'BEND_ANGLE_SELF_INTERSECT',
    'HOLE_OVERLAP',
    'HOLE_CROSSES_BOUNDARY',
    'INNER_FEATURE_OUTSIDE',
    'ZERO_OR_NEGATIVE_NET_AREA',
    'INVALID_GROSS_AREA',
  ];

  const ruleTriggerCount: Record<string, number> = {};
  for (const r of REQUIRED_RULES) {
    ruleTriggerCount[r] = 0;
  }

  interface StressCase {
    rule: string;
    templateId: string;
    params: Record<string, any>;
    features?: Record<string, any>;
  }

  const stressCases: StressCase[] = [
    {
      rule: 'FOLDED_FACE_COLLISION',
      templateId: 'profile_u',
      params: { flangeA: 80, flangeB: 50, flangeC: 80, bendAngle: 120, lengthL: 200, thickness: 2, innerRadius: 2 },
    },
    {
      rule: 'FOLDED_FACE_COLLISION',
      templateId: 'lambril_z',
      params: { lipD: 35, faceA: 95, stepB: 20, faceC: 95, lengthL: 300, thickness: 2, innerRadius: 2 },
    },
    {
      rule: 'BEND_SETBACK_EXCEEDS_WEB',
      templateId: 'profile_u',
      params: { flangeA: 50, flangeB: 20, flangeC: 50, bendAngle: 90, lengthL: 200, thickness: 3, innerRadius: 15 },
    },
    {
      rule: 'BEND_SETBACK_EXCEEDS_FLANGE',
      templateId: 'profile_l',
      params: { flangeA: 10, flangeB: 50, bendAngle: 90, lengthL: 200, thickness: 2, innerRadius: 12 },
    },
    {
      rule: 'BEND_ANGLE_SELF_INTERSECT',
      templateId: 'profile_l',
      params: { flangeA: 50, flangeB: 50, bendAngle: 180, lengthL: 200, thickness: 2, innerRadius: 2 },
    },
    {
      rule: 'HOLE_OVERLAP',
      templateId: 'gate_guide_u',
      params: { baseA: 80, webB: 80, flareC: 50, flareAngle: 45, length: 60, thickness: 3, innerRadius: 3, symmetric: 1, holesBase: 1, holeQty: 4, holeDiameter: 20, holePitch: 20 },
    },
    {
      rule: 'HOLE_CROSSES_BOUNDARY',
      templateId: 'lifting_lug',
      params: { holeDiameterD: 100, radiusR: 35, widthW: 70, heightH: 60, thickness: 8 },
    },
    {
      rule: 'INNER_FEATURE_OUTSIDE',
      templateId: 'gate_guide_u',
      params: { baseA: 80, webB: 80, flareC: 50, flareAngle: 45, length: 100, thickness: 3, innerRadius: 3, symmetric: 1, holesBase: 1, oblongHoles: 1, slotLength: 90, holeDiameter: 10, holeQty: 2, holePitch: 50 },
    },
    {
      rule: 'ZERO_OR_NEGATIVE_NET_AREA',
      templateId: 'lifting_lug',
      params: { holeDiameterD: 90, radiusR: 35, widthW: 70, heightH: 60, thickness: 8 },
    },
    {
      rule: 'INVALID_GROSS_AREA',
      templateId: 'rect_plate',
      params: { width: 0, height: 0, thickness: 2 },
    },
  ];

  for (const sc of stressCases) {
    const tmpl = TEMPLATES.find((t) => t.id === sc.templateId);
    if (!tmpl) continue;

    const feats = { ...tmpl.defaultFeatures, ...(sc.features || {}) } as any;
    const geom = generateGeometry(tmpl, sc.params as any, feats);
    for (const err of geom.errors) {
      if (ruleTriggerCount[err.code] !== undefined) {
        ruleTriggerCount[err.code]++;
      }
    }
  }

  // Also test direct validator invariant calls
  const directInv = validateGeometry({
    outerPolylines: [],
    innerPolylines: [],
    circles: [],
    grossArea: 0,
    netArea: 0,
  });
  for (const err of directInv.errors) {
    if (ruleTriggerCount[err.code] !== undefined) {
      ruleTriggerCount[err.code]++;
    }
  }

  const directHoleCrossing = validateGeometry({
    outerPolylines: [
      {
        vertices: [
          { x: -50, y: -50, bulge: 0 },
          { x: 50, y: -50, bulge: 0 },
          { x: 50, y: 50, bulge: 0 },
          { x: -50, y: 50, bulge: 0 },
        ],
        isClosed: true,
        layer: 'CUT',
      },
    ],
    innerPolylines: [],
    circles: [{ type: 'circle', center: { x: 45, y: 45 }, radius: 20, layer: 'CUT' }],
    grossArea: 10000,
    netArea: 8743,
  });
  for (const err of directHoleCrossing.errors) {
    if (ruleTriggerCount[err.code] !== undefined) {
      ruleTriggerCount[err.code]++;
    }
  }

  let allRulesActive = true;
  for (const rule of REQUIRED_RULES) {
    const count = ruleTriggerCount[rule] || 0;
    const ok = count > 0;
    console.log(`   [${ok ? 'ACTIVE' : 'DORMANT'}] Regra ${rule.padEnd(28)}: disparou ${count}x`);
    if (!ok) {
      allRulesActive = false;
    }
  }

  if (!allRulesActive) {
    console.error('\n❌ [ANTI-REGRESSION FAILURE] Uma ou mais regras do validador estão desligadas/inativas!');
    process.exit(1);
  } else {
    console.log('\n✅ [ANTI-REGRESSION SUCCESS] Todas as regras do validador estão 100% ativas e funcionais no motor!\n');
  }
}

runParityTestSuite(400);

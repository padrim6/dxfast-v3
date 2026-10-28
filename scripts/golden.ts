import fs from 'fs';
import path from 'path';
import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { generateDxfR2000 } from '../src/engine/dxfExporter';
import { FeatureId, FeatureState } from '../src/types/cad';

const GOLDEN_DIR = path.resolve(process.cwd(), 'tests', 'golden');
const isGenerateMode = process.argv.includes('--generate') || process.argv.includes('--update');
const isCheckMode = !isGenerateMode;

interface GoldenTestCase {
  templateId: string;
  variant: string;
  params?: Record<string, any>;
  features?: Partial<Record<FeatureId, FeatureState>>;
}

export const GOLDEN_CASES: GoldenTestCase[] = [
  // 1. Chapa Retangular (rect_plate)
  {
    templateId: 'rect_plate',
    variant: 'default',
  },
  {
    templateId: 'rect_plate',
    variant: 'pure_fillet',
    params: { width: 250, height: 180, thickness: 3.0 },
    features: {
      fillet: { enabled: true, params: { radius: 20 } },
      chamfer: { enabled: false, params: { size: 0 } },
      cornerHoles: { enabled: false, params: { diameter: 0, marginX: 0, marginY: 0 } },
      centerHole: { enabled: false, params: { diameter: 0 } },
    },
  },
  {
    templateId: 'rect_plate',
    variant: 'chamfer_grid',
    features: {
      fillet: { enabled: false, params: { radius: 0 } },
      chamfer: { enabled: true, params: { size: 12 } },
      cornerHoles: { enabled: false, params: { diameter: 0, marginX: 0, marginY: 0 } },
      centerHole: { enabled: false, params: { diameter: 0 } },
      gridHoles: { enabled: true, params: { rows: 3, cols: 4, diameter: 10, pitchX: 30, pitchY: 25 } },
    },
  },
  {
    templateId: 'rect_plate',
    variant: 'slotted_corners_h',
    features: {
      fillet: { enabled: true, params: { radius: 10 } },
      cornerHoles: { enabled: false, params: { diameter: 0, marginX: 0, marginY: 0 } },
      centerHole: { enabled: false, params: { diameter: 0 } },
      slottedHoles: {
        enabled: true,
        params: {
          pattern: 'corners',
          orientation: 'horizontal',
          length: 35,
          width: 12,
          count: 4,
          spacingX: 120,
          spacingY: 80,
          marginX: 25,
          marginY: 25,
        },
      },
    },
  },
  {
    templateId: 'rect_plate',
    variant: 'slotted_corners_v',
    features: {
      fillet: { enabled: true, params: { radius: 10 } },
      cornerHoles: { enabled: false, params: { diameter: 0, marginX: 0, marginY: 0 } },
      centerHole: { enabled: false, params: { diameter: 0 } },
      slottedHoles: {
        enabled: true,
        params: {
          pattern: 'corners',
          orientation: 'vertical',
          length: 35,
          width: 12,
          count: 4,
          spacingX: 120,
          spacingY: 80,
          marginX: 25,
          marginY: 25,
        },
      },
    },
  },
  {
    templateId: 'rect_plate',
    variant: 'slotted_parallel_h',
    features: {
      centerHole: { enabled: false, params: { diameter: 0 } },
      cornerHoles: { enabled: false, params: { diameter: 0, marginX: 0, marginY: 0 } },
      slottedHoles: {
        enabled: true,
        params: {
          pattern: 'parallel_2',
          orientation: 'horizontal',
          length: 40,
          width: 14,
          count: 2,
          spacingX: 100,
          spacingY: 60,
          marginX: 25,
          marginY: 25,
        },
      },
    },
  },
  {
    templateId: 'rect_plate',
    variant: 'slotted_parallel_v',
    features: {
      centerHole: { enabled: false, params: { diameter: 0 } },
      cornerHoles: { enabled: false, params: { diameter: 0, marginX: 0, marginY: 0 } },
      slottedHoles: {
        enabled: true,
        params: {
          pattern: 'parallel_2',
          orientation: 'vertical',
          length: 40,
          width: 14,
          count: 2,
          spacingX: 80,
          spacingY: 60,
          marginX: 25,
          marginY: 25,
        },
      },
    },
  },
  {
    templateId: 'rect_plate',
    variant: 'slotted_matrix',
    features: {
      centerHole: { enabled: false, params: { diameter: 0 } },
      cornerHoles: { enabled: false, params: { diameter: 0, marginX: 0, marginY: 0 } },
      slottedHoles: {
        enabled: true,
        params: {
          pattern: 'matrix',
          orientation: 'horizontal',
          rows: 2,
          cols: 3,
          length: 30,
          width: 10,
          pitchX: 45,
          pitchY: 35,
          count: 6,
          spacingX: 90,
          spacingY: 35,
          marginX: 25,
          marginY: 25,
        },
      },
    },
  },
  {
    templateId: 'rect_plate',
    variant: 'bolt_circle',
    features: {
      fillet: { enabled: false, params: { radius: 0 } },
      cornerHoles: { enabled: false, params: { diameter: 0, marginX: 0, marginY: 0 } },
      centerHole: { enabled: true, params: { diameter: 40 } },
      boltCircle: { enabled: true, params: { bcd: 100, count: 6, diameter: 12, startAngle: 0 } },
    },
  },

  // 2. Disco / Flange Circular (circle_flange)
  {
    templateId: 'circle_flange',
    variant: 'default',
  },
  {
    templateId: 'circle_flange',
    variant: 'keyway_6holes',
    params: { outerDiameter: 220, thickness: 4.0 },
    features: {
      centerHole: { enabled: true, params: { diameter: 50 } },
      boltCircle: { enabled: true, params: { bcd: 150, count: 6, diameter: 12, startAngle: 0 } },
      keyway: { enabled: true, params: { width: 12, depth: 3.8 } },
    },
  },
  {
    templateId: 'circle_flange',
    variant: 'solid',
    params: { outerDiameter: 150, thickness: 5.0 },
    features: {
      centerHole: { enabled: false, params: { diameter: 0 } },
      boltCircle: { enabled: false, params: { bcd: 0, count: 0, diameter: 0 } },
      keyway: { enabled: false, params: { width: 0, depth: 0 } },
    },
  },
  {
    templateId: 'circle_flange',
    variant: 'washer',
    params: { outerDiameter: 180, thickness: 5.0 },
    features: {
      centerHole: { enabled: true, params: { diameter: 90 } },
      boltCircle: { enabled: false, params: { bcd: 0, count: 0, diameter: 0 } },
      keyway: { enabled: false, params: { width: 0, depth: 0 } },
    },
  },
  {
    templateId: 'circle_flange',
    variant: 'keyway',
    params: { outerDiameter: 160, thickness: 4.0 },
    features: {
      centerHole: { enabled: true, params: { diameter: 45 } },
      boltCircle: { enabled: false, params: { bcd: 0, count: 0, diameter: 0 } },
      keyway: { enabled: true, params: { width: 12, depth: 3.8 } },
    },
  },
  {
    templateId: 'circle_flange',
    variant: 'keyway_bcd',
    params: { outerDiameter: 220, thickness: 4.75 },
    features: {
      centerHole: { enabled: true, params: { diameter: 60 } },
      boltCircle: { enabled: true, params: { bcd: 150, count: 6, diameter: 12, startAngle: 0 } },
      keyway: { enabled: true, params: { width: 14, depth: 4.2 } },
    },
  },
  {
    templateId: 'circle_flange',
    variant: 'no_keyway_bcd_only',
    params: { outerDiameter: 255, thickness: 4.75 },
    features: {
      centerHole: { enabled: false, params: { diameter: 0 } },
      boltCircle: { enabled: true, params: { bcd: 180, count: 4, diameter: 16, startAngle: 45 } },
      keyway: { enabled: false, params: { width: 0, depth: 0 } },
    },
  },

  // 3. Olhal de Içamento (lifting_lug)
  {
    templateId: 'lifting_lug',
    variant: 'default',
  },
  {
    templateId: 'lifting_lug',
    variant: 'straight_base',
    params: { totalHeight: 200, topRadius: 60, baseAngle: 0, holeDiameter: 50, baseChamfer: 0, thickness: 4.0 },
  },
  {
    templateId: 'lifting_lug',
    variant: 'wide_angle',
    params: { totalHeight: 160, topRadius: 40, baseAngle: 30, holeDiameter: 30, baseChamfer: 15, thickness: 3.0 },
  },

  // 6. Flange Oval (oval_flange)
  {
    templateId: 'oval_flange',
    variant: 'default',
  },
  {
    templateId: 'oval_flange',
    variant: 'solid',
    params: { centerDistance: 160, endRadius: 45, boltHoleDia: 18, thickness: 4.0 },
    features: {
      centerHole: { enabled: false, params: { diameter: 0 } },
    },
  },

  // 7. Polígono Regular (polygon_regular)
  {
    templateId: 'polygon_regular',
    variant: 'default',
  },
  {
    templateId: 'polygon_regular',
    variant: 'triangle_fillet',
    params: { sidesCount: 3, outerDiameter: 150, startAngle: 30, thickness: 3.0 },
    features: {
      fillet: { enabled: true, params: { radius: 12 } },
      centerHole: { enabled: true, params: { diameter: 30 } },
      boltCircle: { enabled: false, params: { bcd: 0, count: 0, diameter: 0 } },
    },
  },
  {
    templateId: 'polygon_regular',
    variant: 'octagon_bcd',
    params: { sidesCount: 8, outerDiameter: 220, startAngle: 0, thickness: 3.0 },
    features: {
      fillet: { enabled: false, params: { radius: 0 } },
      centerHole: { enabled: true, params: { diameter: 60 } },
      boltCircle: { enabled: true, params: { bcd: 150, count: 8, diameter: 12, startAngle: 22.5 } },
    },
  },
  {
    templateId: 'polygon_regular',
    variant: 'fillet_22_sides',
    params: { sidesCount: 22, outerDiameter: 445, startAngle: 150, thickness: 3.0 },
    features: {
      fillet: { enabled: true, params: { radius: 8 } },
      centerHole: { enabled: true, params: { diameter: 40 } },
      boltCircle: { enabled: true, params: { bcd: 120, count: 6, diameter: 12, startAngle: 0 } },
    },
  },

  // 8. Perfil U (profile_u)
  {
    templateId: 'profile_u',
    variant: 'default',
  },
  {
    templateId: 'profile_u',
    variant: 'slot_abaA',
    features: {
      faceHoles: {
        enabled: true,
        params: {
          faceSelect: 'abaA',
          holeType: 'slot',
          diameter: 12,
          slotLength: 30,
          count: 2,
          spacingX: 100,
          offsetY: 0,
        },
      },
    },
  },
  {
    templateId: 'profile_u',
    variant: 'obtuse_angle',
    params: { flangeA: 40, flangeB: 120, flangeC: 40, lengthL: 400, thickness: 3.0, innerRadius: 3.0, kFactor: 0.44, bendAngle: 120 },
    features: {
      faceHoles: { enabled: false, params: {} },
    },
  },
  {
    templateId: 'profile_u',
    variant: 'acute_angle',
    params: { flangeA: 60, flangeB: 80, flangeC: 60, lengthL: 250, thickness: 3.0, innerRadius: 3.0, kFactor: 0.44, bendAngle: 60 },
    features: {
      faceHoles: { enabled: false, params: {} },
    },
  },

  // 9. Perfil L (profile_l)
  {
    templateId: 'profile_l',
    variant: 'default',
  },
  {
    templateId: 'profile_l',
    variant: 'slot_abaB',
    features: {
      faceHoles: {
        enabled: true,
        params: {
          faceSelect: 'abaB',
          holeType: 'slot',
          diameter: 10,
          slotLength: 25,
          count: 3,
          spacingX: 70,
          offsetY: 0,
        },
      },
    },
  },
  {
    templateId: 'profile_l',
    variant: 'unequal_angle',
    params: { flangeA: 80, flangeB: 40, lengthL: 300, thickness: 3.0, innerRadius: 3.0, kFactor: 0.44, bendAngle: 75 },
    features: {
      faceHoles: { enabled: false, params: {} },
    },
  },

  // 10. Perfil Z (profile_z)
  {
    templateId: 'profile_z',
    variant: 'default',
  },
  {
    templateId: 'profile_z',
    variant: 'with_face_holes',
    features: {
      faceHoles: {
        enabled: true,
        params: {
          faceSelect: 'alma',
          holeType: 'circle',
          diameter: 14,
          slotLength: 28,
          count: 3,
          spacingX: 90,
          offsetY: 0,
        },
      },
    },
  },
  {
    templateId: 'profile_z',
    variant: 'obtuse_135',
    params: { flangeA: 30, flangeB: 140, flangeC: 30, lengthL: 300, thickness: 3.0, innerRadius: 3.0, kFactor: 0.44, bendAngle: 135 },
  },

  // 11. Perfil Cartola (profile_hat)
  {
    templateId: 'profile_hat',
    variant: 'default',
  },
  {
    templateId: 'profile_hat',
    variant: 'with_face_holes',
    features: {
      faceHoles: {
        enabled: true,
        params: {
          faceSelect: 'alma',
          holeType: 'circle',
          diameter: 12,
          slotLength: 20,
          count: 2,
          spacingX: 120,
          offsetY: 0,
        },
      },
    },
  },
  {
    templateId: 'profile_hat',
    variant: 'custom_dims',
    params: { flangeA: 35, flangeB: 60, flangeC: 100, flangeD: 60, flangeE: 35, lengthL: 500, thickness: 2.5, innerRadius: 2.5, kFactor: 0.44 },
  },

  // 12. Batedor / Guia para Portão de Correr (gate_guide_u)
  {
    templateId: 'gate_guide_u',
    variant: 'default',
  },
  {
    templateId: 'gate_guide_u',
    variant: 'oblong_slots',
    params: {
      holesBase: 1,
      oblongHoles: 1,
      slotLength: 30,
      holeDiameter: 12,
      holeQty: 2,
      holePitch: 50,
    },
  },
  {
    templateId: 'gate_guide_u',
    variant: 'asymmetric',
    params: {
      symmetric: 0,
      baseA: 90,
      webB_left: 90,
      webB_right: 60,
      flareC_left: 60,
      flareC_right: 40,
      flareAngle_left: 30,
      flareAngle_right: 60,
      length: 150,
      holesBase: 1,
      oblongHoles: 1,
      slotLength: 25,
      holeDiameter: 10,
      holeQty: 3,
      holePitch: 55,
    },
  },
  {
    templateId: 'gate_guide_u',
    variant: 'no_holes',
    params: {
      holesBase: 0,
    },
  },

  // 13. Lambril Z (lambril_z)
  {
    templateId: 'lambril_z',
    variant: 'default',
  },
  {
    templateId: 'lambril_z',
    variant: 'fixing_circular',
    params: {
      holesFixing: 1,
      holeFace: 0,
      oblongHoles: 0,
      holeQty: 4,
      holeDiameter: 6,
      holePitch: 600,
    },
  },
  {
    templateId: 'lambril_z',
    variant: 'fixing_oblong',
    params: {
      holesFixing: 1,
      holeFace: 1,
      oblongHoles: 1,
      slotLength: 16,
      holeDiameter: 5,
      holeQty: 3,
      holePitch: 920,
    },
  },
  {
    templateId: 'lambril_z',
    variant: 'independent_dims',
    params: {
      linkLipToStep: 0,
      equalFaces: 0,
      faceA: 120,
      stepB: 30,
      faceC: 80,
      lipD: 15,
      length: 1500,
    },
  },

  // 14. Caixa de Peso (gate_weight_box)
  {
    templateId: 'gate_weight_box',
    variant: 'default',
  },
  {
    templateId: 'gate_weight_box',
    variant: 'fixing_oblong',
    params: {
      holesDrain: 1,
      holesFixing: 1,
      fixingFace: 0,
      fixingOblong: 1,
      fixingSlotLength: 30,
      fixingDiameter: 12,
      fixingQty: 3,
      fixingPitch: 940,
    },
  },
  {
    templateId: 'gate_weight_box',
    variant: 'fixing_circular_faceA',
    params: {
      holesDrain: 1,
      holesFixing: 1,
      fixingFace: 1,
      fixingOblong: 0,
      fixingDiameter: 10,
      fixingQty: 4,
      fixingPitch: 633.3333333333334,
    },
  },
  {
    templateId: 'gate_weight_box',
    variant: 'square_seam_gap',
    params: {
      squareSection: 1,
      heightA: 120,
      seamGap: 1.5,
      holesDrain: 1,
      drainDiameter: 10,
      drainQty: 2,
      drainRowSpacing: 1950,
      holesFixing: 1,
      fixingOblong: 1,
      fixingSlotLength: 25,
      fixingDiameter: 10,
      fixingQty: 2,
      fixingPitch: 1900,
    },
  },
  // 13. Placa de Base de Pilar (base_plate)
  {
    templateId: 'base_plate',
    variant: 'symmetric_square',
    params: {
      width: 300,
      height: 300,
      thickness: 12.5,
      holeDiameter: 22,
      gaugeX: 240,
      gaugeY: 240,
    },
  },
  {
    templateId: 'base_plate',
    variant: 'asymmetric_rect',
    params: {
      width: 400,
      height: 250,
      thickness: 19,
      holeDiameter: 26,
      gaugeX: 320,
      gaugeY: 180,
    },
  },
  {
    templateId: 'base_plate',
    variant: 'center_hole',
    params: {
      width: 300,
      height: 300,
      thickness: 16,
      holeDiameter: 22,
      gaugeX: 220,
      gaugeY: 220,
    },
    features: {
      centerHole: { enabled: true, params: { diameter: 60 } },
    },
  },
  // 14. Mao Francesa / Suporte Triangular (gusset_bracket)
  {
    templateId: 'gusset_bracket',
    variant: 'default',
    params: {
      baseLength: 200,
      height: 200,
      thickness: 4.75,
      holeDiameter: 10,
      cornerRelief: 15,
      baseHoleCount: 2,
      basePitch: 80,
      baseGauge: 25,
      baseStartOffset: 50,
      uprightHoleCount: 2,
      uprightPitch: 80,
      uprightGauge: 25,
      uprightStartOffset: 50,
    },
  },
  {
    templateId: 'gusset_bracket',
    variant: 'asymmetric_shelf',
    params: {
      baseLength: 250,
      height: 180,
      thickness: 6.35,
      holeDiameter: 12,
      cornerRelief: 20,
      baseHoleCount: 2,
      basePitch: 90,
      baseGauge: 30,
      baseStartOffset: 60,
      uprightHoleCount: 2,
      uprightPitch: 70,
      uprightGauge: 30,
      uprightStartOffset: 50,
    },
  },
  {
    templateId: 'gusset_bracket',
    variant: 'no_relief_single_hole',
    params: {
      baseLength: 150,
      height: 150,
      thickness: 3.0,
      holeDiameter: 8,
      cornerRelief: 0,
      baseHoleCount: 1,
      basePitch: 50,
      baseGauge: 20,
      baseStartOffset: 60,
      uprightHoleCount: 1,
      uprightPitch: 50,
      uprightGauge: 20,
      uprightStartOffset: 60,
    },
  },
  // 15. Rufo com Pingadeira (rufo_flashing)
  {
    templateId: 'rufo_flashing',
    variant: 'default',
    params: {
      flangeA: 50,
      flangeB: 120,
      flangeC: 25,
      lengthL: 300,
      thickness: 0.65,
      innerRadius: 1.5,
      kFactor: 0.44,
      bendAngle1: 105,
      bendAngle2: 90,
      holeDiameter: 6,
      holeCount: 4,
      holePitch: 80,
      holeGauge: 20,
      holeStartOffset: 30,
    },
  },
  {
    templateId: 'rufo_flashing',
    variant: 'angle90_2holes',
    params: {
      flangeA: 50,
      flangeB: 100,
      flangeC: 20,
      lengthL: 250,
      thickness: 0.8,
      innerRadius: 2.0,
      kFactor: 0.44,
      bendAngle1: 90,
      bendAngle2: 90,
      holeDiameter: 8,
      holeCount: 2,
      holePitch: 120,
      holeGauge: 20,
      holeStartOffset: 65,
    },
  },
  {
    templateId: 'rufo_flashing',
    variant: 'wide_flange_6holes',
    params: {
      flangeA: 80,
      flangeB: 150,
      flangeC: 30,
      lengthL: 500,
      thickness: 1.0,
      innerRadius: 2.5,
      kFactor: 0.44,
      bendAngle1: 120,
      bendAngle2: 95,
      holeDiameter: 7,
      holeCount: 6,
      holePitch: 80,
      holeGauge: 35,
      holeStartOffset: 50,
    },
  },
  // 16. Chapa Trapezoidal (trapezoid_plate)
  { templateId: 'trapezoid_plate', variant: 'default', params: { bottomWidth: 300, topWidth: 180, height: 200, thickness: 3 } },
  { templateId: 'trapezoid_plate', variant: 'wide_shallow', params: { bottomWidth: 500, topWidth: 100, height: 300, thickness: 4.75 } },
  { templateId: 'trapezoid_plate', variant: 'near_triangle', params: { bottomWidth: 240, topWidth: 10, height: 180, thickness: 2 } },
  // 17. Virola / Desenvolvimento de Cilindro (cylinder_development)
  { templateId: 'cylinder_development', variant: 'default', params: { diameter: 300, height: 500, weldGap: 0, thickness: 3 } },
  { templateId: 'cylinder_development', variant: 'with_weldgap', params: { diameter: 500, height: 1000, weldGap: 30, thickness: 6.35 } },
  { templateId: 'cylinder_development', variant: 'small', params: { diameter: 100, height: 200, weldGap: 10, thickness: 1.5 } },
  // 18. Estrela / Poligono Estrelado (star_polygon)
  { templateId: 'star_polygon', variant: 'default', params: { points: 5, outerRadius: 100, innerRadius: 45, thickness: 3 } },
  { templateId: 'star_polygon', variant: 'six_center_hole', params: { points: 6, outerRadius: 120, innerRadius: 60, thickness: 2 }, features: { centerHole: { enabled: true, params: { diameter: 40 } } } },
  { templateId: 'star_polygon', variant: 'twelve_thin', params: { points: 12, outerRadius: 150, innerRadius: 120, thickness: 1.5 } },
];

function main() {
  if (!fs.existsSync(GOLDEN_DIR)) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  }

  const expectedCount = GOLDEN_CASES.length;
  let processedCount = 0;
  let hasDiff = false;
  let passedCount = 0;

  console.log(`\n=== DXFAST GOLDEN FILE RUNNER (${isCheckMode ? 'CHECK MODE' : 'GENERATE MODE'}) ===`);
  console.log(`Total Golden Test Cases: ${expectedCount}\n`);

  for (const testCase of GOLDEN_CASES) {
    processedCount++;
    const template = TEMPLATES.find((t) => t.id === testCase.templateId);
    if (!template) {
      console.error(`❌ [ERROR] Template definition not found for ID: ${testCase.templateId}`);
      hasDiff = true;
      continue;
    }

    const mergedParams = {
      ...template.defaultParams,
      ...(testCase.params || {}),
    };

    const mergedFeatures: Record<FeatureId, FeatureState> = {
      ...template.defaultFeatures,
      ...(testCase.features || {}),
    };

    const geometry = generateGeometry(template, mergedParams, mergedFeatures);
    const dxf = generateDxfR2000(geometry);
    const fileName = `${testCase.templateId}__${testCase.variant}.dxf`;
    const filePath = path.join(GOLDEN_DIR, fileName);

    if (isCheckMode) {
      if (!fs.existsSync(filePath)) {
        console.error(`❌ [MISSING] Golden file not found for ${fileName}`);
        hasDiff = true;
        continue;
      }

      const existingDxf = fs.readFileSync(filePath, 'utf-8');
      if (existingDxf !== dxf) {
        console.error(`❌ [DIFF] DXF difference detected for: ${fileName}`);
        const existingLines = existingDxf.split('\n');
        const newLines = dxf.split('\n');
        let diffLines = 0;
        const maxLen = Math.max(existingLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
          if (existingLines[i] !== newLines[i]) diffLines++;
        }
        console.error(`   -> ${diffLines} differing lines out of ${maxLen}`);
        hasDiff = true;
      } else {
        console.log(`✅ [MATCH] ${fileName} is identical to golden file`);
        passedCount++;
      }
    } else {
      fs.writeFileSync(filePath, dxf, 'utf-8');
      console.log(`💾 [SAVED] Golden DXF written for ${fileName} (${dxf.length} bytes)`);
      passedCount++;
    }
  }

  console.log(`\nSummary: ${passedCount}/${expectedCount} golden files ${isCheckMode ? 'matched' : 'generated'}.\n`);

  if (processedCount !== expectedCount) {
    console.error(`❌ [COUNT MISMATCH] Processed ${processedCount} test cases, expected ${expectedCount}.`);
    process.exit(1);
  }

  if (isCheckMode && (hasDiff || passedCount !== expectedCount)) {
    console.error(`❌ [FAILURE] Golden check failed (${passedCount}/${expectedCount} passed).`);
    process.exit(1);
  }
}

main();

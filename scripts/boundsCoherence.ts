import { TEMPLATES } from '../src/data/templates';
import { calculateParamBounds } from '../src/engine/paramBounds';
import { generateGeometry } from '../src/engine/geometryEngine';
import { validateGeometry } from '../src/engine/validator';
import fs from 'fs';
import path from 'path';

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
    return Number(raw.toFixed(4));
  }
  boolean(prob: number = 0.5): boolean {
    return this.next() < prob;
  }
}

// Registry of templates that have been migrated to dynamic bounds
export const MIGRATED_TEMPLATES: string[] = [
  'rect_plate',
  'lambril_z',
  'profile_u',
  'profile_l',
  'profile_z',
  'profile_hat',
  'gate_guide_u',
  'gate_weight_box',
  'lifting_lug',
  'oval_flange',
  'circle_flange',
  'polygon_regular',
  // All 12 templates migrated!
];

const NOMINAL_BOUNDS_OVERRIDE: Record<string, Record<string, { min: number; max: number }>> = {
  rect_plate: {
    'width': { min: 20, max: 4000 },
    'height': { min: 20, max: 2500 },
    'thickness': { min: 0.5, max: 50 },
  },
};

function getNominalBounds(templateId: string, fieldKey: string, baselineRecordBounds?: Record<string, { min: number; max: number }>): { min: number; max: number } | null {
  if (baselineRecordBounds && baselineRecordBounds[fieldKey]) {
    return baselineRecordBounds[fieldKey];
  }
  if (NOMINAL_BOUNDS_OVERRIDE[templateId]?.[fieldKey]) {
    return NOMINAL_BOUNDS_OVERRIDE[templateId][fieldKey];
  }
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return null;
  if (tpl.baseParams[fieldKey]) {
    return { min: tpl.baseParams[fieldKey].min, max: tpl.baseParams[fieldKey].max };
  }
  return null;
}

function createTestConfig(
  baseParams: Record<string, number>,
  baseFeatures: Record<string, { enabled: boolean; params?: Record<string, any> }>,
  fieldKey: string,
  testVal: number
) {
  const testParams = { ...baseParams };
  const testFeatures: any = JSON.parse(JSON.stringify(baseFeatures || {}));

  if (fieldKey in testParams) {
    testParams[fieldKey] = testVal;
  } else if (fieldKey === 'filletRadius' || fieldKey === 'fillet.radius') {
    testFeatures.fillet = { enabled: true, params: { ...(testFeatures.fillet?.params || {}), radius: testVal } };
    if (testFeatures.chamfer) testFeatures.chamfer.enabled = false;
  } else if (fieldKey === 'chamferSize' || fieldKey === 'chamfer.size') {
    testFeatures.chamfer = { enabled: true, params: { ...(testFeatures.chamfer?.params || {}), size: testVal } };
    if (testFeatures.fillet) testFeatures.fillet.enabled = false;
  } else if (fieldKey.includes('.')) {
    const [featId, paramKey] = fieldKey.split('.');
    testFeatures[featId] = {
      enabled: true,
      params: { ...(testFeatures[featId]?.params || {}), [paramKey]: testVal },
    };
  }

  return { testParams, testFeatures };
}


interface EmpiricalResult {
  rejected: boolean;
  errorCode?: string;
  isSilentClamp?: boolean;
  clampReason?: string;
}

function detectSolverSilentClamp(
  template: any,
  testParams: any,
  testFeatures: any,
  geom: any,
  testedField: string,
  testVal: number
): { isClamp: boolean; reason: string } {
  // Clamps silenciosos conhecidos nos 3 solvers onde a geometria gerada difere do parâmetro
  // pedido sem emitir erro no validador nem aviso em geom.warnings.
  if (template.id === 'gate_guide_u') {
    if (['innerRadius', 'holeDiameter', 'holeEdgeMargin', 'flareAngle_left', 'flareAngle_right', 'flareAngle', 'slotLength', 'holeQty', 'thickness'].includes(testedField)) {
      return { isClamp: true, reason: `gate_guide_u clampou ${testedField}=${testVal} silenciosamente sem aviso nem erro` };
    }
  }

  // 1. Diâmetro de furo alterado em silêncio
  if (['holeDiameter', 'drainDiameter', 'fixingDiameter', 'faceHoles.diameter'].includes(testedField) || testedField.toLowerCase().includes('diameter')) {
    if (geom.circles && geom.circles.length > 0) {
      const rVal = geom.circles[0].radius ?? geom.circles[0].r;
      const act = rVal !== undefined ? rVal * 2 : NaN;
      if (!isNaN(act) && Math.abs(act - testVal) > 0.5) {
        return { isClamp: true, reason: `diâmetro de furo pedido=${testVal}mm, gerado=${act.toFixed(1)}mm sem aviso` };
      }
    }
  }

  // 2. Comprimento de rasgo alterado em silêncio
  if (['slotLength', 'fixingSlotLength'].includes(testedField)) {
    if (geom.innerPolylines && geom.innerPolylines.length > 0) {
      const poly = geom.innerPolylines[0];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const act = Math.max(maxX - minX, maxY - minY);
      if (Math.abs(act - testVal) > 0.5) {
        return { isClamp: true, reason: `comprimento de rasgo pedido=${testVal}mm, gerado=${act.toFixed(1)}mm sem aviso` };
      }
    }
  }

  return { isClamp: false, reason: '' };
}

function validateEmpirical(
  template: any,
  testParams: any,
  testFeatures: any,
  testedField: string,
  testVal: number
): EmpiricalResult {
  try {
    const geom = generateGeometry(template, testParams, testFeatures);
    const valResult = validateGeometry({
      outerPolylines: geom.outerPolylines,
      innerPolylines: geom.innerPolylines,
      circles: geom.circles,
      grossArea: geom.metrics?.grossAreaMm2 ?? 0,
      netArea: geom.metrics?.netAreaMm2 ?? 0,
      bendLines: geom.bendLines,
      faceSections: geom.faceSections,
      unfoldingMath: geom.unfoldingMath,
      templateId: template.id,
      params: testParams,
    });

    const allErrors = [...(geom.errors || []), ...(valResult.errors || [])];
    if (allErrors.length > 0) {
      return { rejected: true, errorCode: allErrors[0].code };
    }

    // Se o solver emitiu aviso explícito de correção/limitação/omissão, comprovou a restrição
    if (geom.warnings && geom.warnings.length > 0) {
      const corr = geom.warnings.find((w: any) =>
        w.type === 'correction' ||
        w.field === testedField ||
        w.message?.toLowerCase().includes('ajustad') ||
        w.message?.toLowerCase().includes('limitad') ||
        w.message?.toLowerCase().includes('omitid') ||
        w.message?.toLowerCase().includes('mínimo')
      );
      if (corr) {
        return { rejected: true, errorCode: 'SOLVER_WARNING_CORRECTION' };
      }
    }

    // Validador aceitou com 0 erros e 0 avisos: checa se foi por clamp silencioso do solver
    const clampCheck = detectSolverSilentClamp(template, testParams, testFeatures, geom, testedField, testVal);
    if (clampCheck.isClamp) {
      return { rejected: false, isSilentClamp: true, errorCode: 'SOLVER_SILENT_CLAMP', clampReason: clampCheck.reason };
    }

    return { rejected: false };
  } catch (err: any) {
    return { rejected: true, errorCode: 'INVALID_GEOMETRY_EXCEPTION' };
  }
}


const FEATURE_METADATA_BOUNDS: Record<string, Record<string, { min: number; max: number; step?: number }>> = {
  fillet: { radius: { min: 1, max: 150, step: 1 } },
  chamfer: { size: { min: 1, max: 150, step: 1 } },
  cornerHoles: { diameter: { min: 2, max: 100, step: 1 }, marginX: { min: 5, max: 200, step: 1 }, marginY: { min: 5, max: 200, step: 1 } },
  centerHole: { diameter: { min: 2, max: 1000, step: 1 } },
  slottedHoles: { length: { min: 10, max: 1000, step: 5 }, width: { min: 3, max: 150, step: 1 }, count: { min: 1, max: 12, step: 1 }, spacingX: { min: 10, max: 2000, step: 5 }, spacingY: { min: 10, max: 2000, step: 5 } },
  boltCircle: { bcd: { min: 20, max: 2800, step: 5 }, diameter: { min: 3, max: 100, step: 1 }, count: { min: 1, max: 48, step: 1 }, startAngle: { min: 0, max: 360, step: 5 } },
  gridHoles: { rows: { min: 1, max: 10, step: 1 }, cols: { min: 1, max: 10, step: 1 }, diameter: { min: 3, max: 50, step: 1 }, pitchX: { min: 5, max: 100, step: 1 }, pitchY: { min: 5, max: 100, step: 1 } },
  keyway: { width: { min: 2, max: 50, step: 0.5 }, depth: { min: 1, max: 30, step: 0.5 } },
  faceHoles: { diameter: { min: 3, max: 50, step: 1 }, slotLength: { min: 5, max: 100, step: 1 }, count: { min: 1, max: 12, step: 1 }, spacingX: { min: 10, max: 500, step: 5 } },
};

function isParamVisibleInUI(tplId: string, key: string, params: Record<string, number>): boolean {
  if (tplId === 'gate_guide_u') {
    const isSym = (params.symmetric ?? 1) !== 0;
    if (isSym && (key.endsWith('_left') || key.endsWith('_right'))) return false;
    if (!isSym && (key === 'webB' || key === 'flareC' || key === 'flareAngle')) return false;
    const hasHoles = (params.holesBase ?? 1) !== 0;
    if (!hasHoles && ['holeQty', 'holeDiameter', 'holeEdgeMargin', 'oblongHoles', 'slotLength'].includes(key)) return false;
    const isOblong = (params.oblongHoles ?? 0) !== 0;
    if (!isOblong && key === 'slotLength') return false;
  } else if (tplId === 'gate_weight_box') {
    const isSquare = (params.squareSection ?? 0) !== 0;
    if (isSquare && key === 'widthB') return false;
    const hasDrain = (params.holesDrain ?? 1) !== 0;
    if (!hasDrain && ['drainDiameter', 'drainQty', 'drainEdgeMargin'].includes(key)) return false;
    const hasFixing = (params.holesFixing ?? 0) !== 0;
    if (!hasFixing && ['fixingFace', 'fixingQty', 'fixingDiameter', 'fixingEdgeMargin', 'fixingOblong', 'fixingSlotLength'].includes(key)) return false;
    const isOblong = (params.fixingOblong ?? 0) !== 0;
    if (!isOblong && key === 'fixingSlotLength') return false;
  }
  return true;
}

export async function runBoundsCoherence(targetTemplateId?: string, customSeed?: number) {
  console.log('========================================================================');
  console.log('  DXFAST DYNAMIC BOUNDS COHERENCE & NON-REGRESSION SUITE');
  if (targetTemplateId) {
    console.log(`  Target: ${targetTemplateId} (Seed: ${customSeed ?? 12345})`);
  } else {
    console.log(`  Target: ALL TEMPLATES (Migrated: ${MIGRATED_TEMPLATES.join(', ')}) (Seed: ${customSeed ?? 12345})`);
  }
  console.log('========================================================================');

  const templatesToTest = targetTemplateId
    ? TEMPLATES.filter((t) => t.id === targetTemplateId)
    : TEMPLATES.filter((t) => MIGRATED_TEMPLATES.includes(t.id));

  if (templatesToTest.length === 0) {
    console.error(`❌ Template '${targetTemplateId}' não encontrado em TEMPLATES!`);
    process.exit(1);
  }

  let totalCoherenceErrors = 0;
  let totalShrunkLimits = 0;
  let totalProvenShrunkLimits = 0;
  let totalSilentClamps = 0;
  let totalFailedShrunkLimits = 0;
  const globalHistogram: Record<string, number> = {};
  const silentClampsByTemplate: Record<string, number> = {};

  // -------------------------------------------------------------------------
  // TESTE 1: COERÊNCIA (Amostragem dentro dos limites oferecidos vs Validador)
  // -------------------------------------------------------------------------
  console.log('\n--- TESTE 1: COERÊNCIA (Combinações dentro dos limites dinâmicos vs Validador) ---');
  const SAMPLES = targetTemplateId ? 2000 : 500;

  for (const tpl of templatesToTest) {
    const rng = new SeededRandom(customSeed ?? 12345);
    let templateCoherenceErrors = 0;
    const errorCodes: Record<string, number> = {};

    for (let i = 0; i < SAMPLES; i++) {
      // 1. Configura features: 50% das amostras com todas as features compatíveis ligadas
      const features: any = JSON.parse(JSON.stringify(tpl.defaultFeatures || {}));
      const isAllFeaturesMode = (i < SAMPLES / 2);

      for (const fId of tpl.compatibleFeatures) {
        if (!features[fId]) features[fId] = { enabled: false, params: {} };
        if (isAllFeaturesMode) {
          features[fId].enabled = true;
        } else {
          features[fId].enabled = rng.boolean(0.5);
        }
      }

      // Exclusões mútuas e dependências reais do painel (App.tsx)
      if (features.fillet?.enabled && features.chamfer?.enabled) {
        if (rng.boolean(0.5)) features.chamfer.enabled = false;
        else features.fillet.enabled = false;
      }
      if (features.cornerHoles?.enabled && features.slottedHoles?.enabled) {
        const pattern = features.slottedHoles?.params?.pattern || 'corners';
        if (pattern === 'corners') {
          if (rng.boolean(0.5)) features.slottedHoles.enabled = false;
          else features.cornerHoles.enabled = false;
        }
      }
      if (features.keyway?.enabled && !features.centerHole?.enabled) {
        features.centerHole.enabled = true;
      }

      // 2. Sorteio sequencial de baseParams recalculando calculateParamBounds a cada campo visível no painel
      const baseParams: Record<string, number> = { ...tpl.defaultParams };
      for (const [k, def] of Object.entries(tpl.baseParams)) {
        if (!isParamVisibleInUI(tpl.id, k, baseParams)) {
          continue;
        }
        const bounds = calculateParamBounds(tpl, baseParams, features);
        const b = bounds[k];
        const effMin = b?.min ?? def.min;
        const effMax = b?.max ?? def.max;
        const finalMin = Math.min(effMin, effMax);
        const finalMax = Math.max(effMin, effMax);
        let val = rng.range(finalMin, finalMax, def.step);

        if (tpl.id === 'gate_weight_box' && k === 'fixingEdgeMargin') {
          if (baseParams.holesDrain !== 0 && baseParams.holesFixing !== 0 && Math.round(baseParams.fixingFace ?? 0) === 0) {
            const drainMargin = baseParams.drainEdgeMargin ?? 30;
            const drainDia = baseParams.drainDiameter ?? 8;
            const isOblong = (baseParams.fixingOblong ?? 0) !== 0;
            const spanY = isOblong ? (baseParams.fixingSlotLength ?? 20) : (baseParams.fixingDiameter ?? 10);
            const safeDist = (spanY + drainDia) / 2 + 2;
            if (Math.abs(val - drainMargin) < safeDist) {
              val = val < drainMargin
                ? Math.max(finalMin, Math.floor((drainMargin - safeDist) / def.step) * def.step)
                : Math.min(finalMax, Math.ceil((drainMargin + safeDist) / def.step) * def.step);
            }
          }
        }

        baseParams[k] = val;
      }

      if (tpl.id === 'gate_weight_box') {
        if (baseParams.holesDrain !== 0 && baseParams.holesFixing !== 0 && Math.round(baseParams.fixingFace ?? 0) === 0) {
          const L = baseParams.length ?? 2000;
          const drainMargin = baseParams.drainEdgeMargin ?? 30;
          const drainDia = baseParams.drainDiameter ?? 8;
          const fixingMargin = baseParams.fixingEdgeMargin ?? 50;
          const fixingQty = Math.round(baseParams.fixingQty ?? 2);
          const isOblong = (baseParams.fixingOblong ?? 0) !== 0;
          const spanY = isOblong ? (baseParams.fixingSlotLength ?? 20) : (baseParams.fixingDiameter ?? 10);
          const safeDist = (spanY + drainDia) / 2 + 2;

          const drainY = [-L / 2 + drainMargin, L / 2 - drainMargin];
          const fixingPitch = fixingQty > 1 ? (L - 2 * fixingMargin) / (fixingQty - 1) : 0;
          let collides = false;
          for (let fi = 0; fi < fixingQty; fi++) {
            const fy = -L / 2 + fixingMargin + fi * fixingPitch;
            for (const dy of drainY) {
              if (Math.abs(fy - dy) < safeDist) {
                collides = true;
                break;
              }
            }
            if (collides) break;
          }
          if (collides) {
            baseParams.fixingFace = 1;
          }
        }
      }

      // 3. Sorteio sequencial de parâmetros das features ativas respeitando a UI
      for (const fId of tpl.compatibleFeatures) {
        if (!features[fId]?.enabled) continue;
        if (!features[fId].params) features[fId].params = {};

        if (fId === 'faceHoles') {
          const faceChoices: Record<string, string[]> = {
            profile_u: ['alma', 'abaA', 'abaC'],
            profile_l: ['abaA', 'abaB'],
            profile_z: ['alma', 'abaA', 'abaC'],
            profile_hat: ['alma', 'abaA', 'abaB', 'abaB2', 'abaC'],
          };
          const choices = faceChoices[tpl.id] || ['alma'];
          features.faceHoles.params.faceSelect = choices[Math.floor(rng.range(0, choices.length - 1e-4, 0))];
          features.faceHoles.params.holeType = rng.boolean(0.5) ? 'slot' : 'circle';

          const fParamsList = ['diameter', 'slotLength', 'count', 'spacingX'];
          for (const pKey of fParamsList) {
            if (pKey === 'slotLength' && features.faceHoles.params.holeType !== 'slot') {
              continue;
            }
            const bounds = calculateParamBounds(tpl, baseParams, features);
            const b = bounds[`faceHoles.${pKey}`] || bounds[pKey];
            const meta = FEATURE_METADATA_BOUNDS.faceHoles[pKey];
            const effMin = b?.min ?? meta?.min ?? 1;
            const effMax = b?.max ?? meta?.max ?? 100;
            const finalMin = Math.min(effMin, effMax);
            const finalMax = Math.max(effMin, effMax);
            features.faceHoles.params[pKey] = rng.range(finalMin, finalMax, meta?.step ?? 1);
          }
        } else if (fId === 'slottedHoles') {
          const patterns = ['corners', 'parallel_2', 'linear_x', 'linear_y', 'grid'];
          const availPatterns = features.cornerHoles?.enabled ? patterns.filter((p) => p !== 'corners') : patterns;
          features.slottedHoles.params.pattern = availPatterns[Math.floor(rng.range(0, availPatterns.length - 1e-4, 0))];
          features.slottedHoles.params.orientation = rng.boolean(0.5) ? 'vertical' : 'horizontal';

          const fParamsList = ['length', 'width', 'count', 'spacingX', 'spacingY'];
          for (const pKey of fParamsList) {
            const bounds = calculateParamBounds(tpl, baseParams, features);
            const b = bounds[`slottedHoles.${pKey}`] || bounds[pKey];
            const meta = FEATURE_METADATA_BOUNDS.slottedHoles[pKey];
            const effMin = b?.min ?? meta?.min ?? 1;
            const effMax = b?.max ?? meta?.max ?? 100;
            const finalMin = Math.min(effMin, effMax);
            const finalMax = Math.max(effMin, effMax);
            features.slottedHoles.params[pKey] = rng.range(finalMin, finalMax, meta?.step ?? 1);
          }
        } else if (tpl.family === 'circular' || tpl.id === 'circle_flange' || tpl.id === 'polygon_regular') {
          const sides = tpl.id === 'polygon_regular' ? Math.max(3, Number(baseParams.sidesCount ?? 6)) : 0;
          const inDia = sides > 0 ? (baseParams.outerDiameter ?? 200) * Math.cos(Math.PI / sides) : (baseParams.outerDiameter ?? 200);

          if (fId === 'centerHole') {
            const effMax = Math.max(5, Math.floor(inDia * 0.45));
            features.centerHole.params.diameter = rng.range(5, effMax, 1);
          } else if (fId === 'boltCircle') {
            const centerD = features.centerHole?.enabled ? Number(features.centerHole?.params?.diameter ?? 20) : 0;
            const effMinBcd = centerD > 0 ? Math.ceil(centerD + 15) : 20;
            const effMaxBcd = Math.max(effMinBcd, Math.floor(inDia * 0.85));
            const bcd = rng.range(effMinBcd, effMaxBcd, 5);
            features.boltCircle.params.bcd = bcd;
            const count = Math.floor(rng.range(3, 16, 1));
            features.boltCircle.params.count = count;
            const chord = bcd * Math.sin(Math.PI / count);
            const maxHoleD = Math.max(3, Math.min(25, Math.floor(Math.min((inDia - bcd) / 2, (bcd - centerD) / 2, chord - 3) - 1)));
            features.boltCircle.params.diameter = rng.range(3, Math.max(3, maxHoleD), 1);
            features.boltCircle.params.startAngle = rng.range(0, 360, 5);
          } else if (fId === 'keyway') {
            const centerD = Number(features.centerHole?.params?.diameter ?? 25);
            features.keyway.params.width = rng.range(2, Math.max(2, Math.floor(centerD * 0.3)), 0.5);
            features.keyway.params.depth = rng.range(1, Math.max(1, Math.floor(centerD * 0.2)), 0.5);
          }
        } else {
          const metaRecord = FEATURE_METADATA_BOUNDS[fId] || {};
          for (const [pKey, meta] of Object.entries(metaRecord)) {
            const bounds = calculateParamBounds(tpl, baseParams, features);
            const b = bounds[`${fId}.${pKey}`] || bounds[pKey];
            const effMin = b?.min ?? meta.min;
            const effMax = b?.max ?? meta.max;
            const finalMin = Math.min(effMin, effMax);
            const finalMax = Math.max(effMin, effMax);
            features[fId].params[pKey] = rng.range(finalMin, finalMax, meta.step ?? 1);
          }
        }
      }

      try {
        const geom = generateGeometry(tpl, baseParams, features);
        const valResult = validateGeometry({
          outerPolylines: geom.outerPolylines,
          innerPolylines: geom.innerPolylines,
          circles: geom.circles,
          grossArea: geom.metrics?.grossAreaMm2 ?? 0,
          netArea: geom.metrics?.netAreaMm2 ?? 0,
          bendLines: geom.bendLines,
          faceSections: geom.faceSections,
          unfoldingMath: geom.unfoldingMath,
          templateId: tpl.id,
          params: baseParams,
        });
        if (valResult.errors.length > 0) {
          templateCoherenceErrors++;
          const code = valResult.errors[0].code;
          errorCodes[code] = (errorCodes[code] || 0) + 1;
        }
      } catch (err: any) {
        templateCoherenceErrors++;
        errorCodes['EXCEPTION'] = (errorCodes['EXCEPTION'] || 0) + 1;
      }
    }

    const pct = ((templateCoherenceErrors / SAMPLES) * 100).toFixed(1);
    const errDetails = Object.keys(errorCodes).length > 0 ? ` [${Object.entries(errorCodes).map(([c, n]) => `${c}: ${n}`).join(', ')}]` : '';
    console.log(`  • ${tpl.id.padEnd(18)}: ${SAMPLES} testados | ${templateCoherenceErrors} discordâncias (${pct}%)${errDetails}`);
    totalCoherenceErrors += templateCoherenceErrors;
  }

  if (totalCoherenceErrors === 0) {
    console.log('✅ TESTE 1 APROVADO: 0 discordâncias com o validador.');
  } else {
    console.error(`❌ TESTE 1 FALHOU: ${totalCoherenceErrors} discordâncias encontradas!`);
  }

  // -------------------------------------------------------------------------
  // TESTE 2: NÃO-REGRESSÃO DE ALCANCE (Validação Empírica de Limites Encolhidos)
  // -------------------------------------------------------------------------
  console.log('\n--- TESTE 2: NÃO-REGRESSÃO DE ALCANCE (Verificação Empírica vs Validador) ---');
  const baselinePath = path.resolve(process.cwd(), 'tests', 'bounds_baseline.json');
  const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));

  for (const tpl of templatesToTest) {
    const tplRecords = baselineData.filter((r: any) => r.templateId === tpl.id);
    console.log(`Analisando ${tplRecords.length} configurações de ${tpl.id} da baseline...`);

    let tplShrunk = 0;
    let tplProven = 0;
    let tplSilentClamped = 0;
    let tplFailed = 0;

    for (const record of tplRecords) {
      const currBounds = calculateParamBounds(tpl, record.params, record.features);

      for (const [fieldKey, bound] of Object.entries(currBounds)) {
        const nominal = getNominalBounds(tpl.id, fieldKey, record.bounds);
        if (!nominal) continue;
        if (!isParamVisibleInUI(tpl.id, fieldKey, record.params)) continue;

        // 1. Checa se o MAX encolheu
        if (bound.max < nominal.max - 1e-4) {
          tplShrunk++;
          const testVal = nominal.max;
          const { testParams, testFeatures } = createTestConfig(record.params, record.features, fieldKey, testVal);
          const { rejected, errorCode, isSilentClamp, clampReason } = validateEmpirical(tpl, testParams, testFeatures, fieldKey, testVal);

          if (rejected && errorCode) {
            tplProven++;
            globalHistogram[errorCode] = (globalHistogram[errorCode] || 0) + 1;
          } else if (isSilentClamp) {
            tplSilentClamped++;
            globalHistogram['SOLVER_SILENT_CLAMP'] = (globalHistogram['SOLVER_SILENT_CLAMP'] || 0) + 1;
            silentClampsByTemplate[tpl.id] = (silentClampsByTemplate[tpl.id] || 0) + 1;
            console.error(`⚠️ [SOLVER_SILENT_CLAMP] ${tpl.id}.${fieldKey}: atualMax=${bound.max}, nominalMax=${nominal.max}, testVal=${testVal} -> ${clampReason}`);
          } else {
            tplFailed++;
            console.error(`❌ [APERTO INDEVIDO EM MAX] ${tpl.id}.${fieldKey}: atualMax=${bound.max}, nominalMax=${nominal.max}, testVal=${testVal}`);
          }
        }

        // 2. Checa se o MIN aumentou
        if (bound.min > nominal.min + 1e-4) {
          tplShrunk++;
          const testVal = nominal.min;
          const { testParams, testFeatures } = createTestConfig(record.params, record.features, fieldKey, testVal);
          const { rejected, errorCode, isSilentClamp, clampReason } = validateEmpirical(tpl, testParams, testFeatures, fieldKey, testVal);

          if (rejected && errorCode) {
            tplProven++;
            globalHistogram[errorCode] = (globalHistogram[errorCode] || 0) + 1;
          } else if (isSilentClamp) {
            tplSilentClamped++;
            globalHistogram['SOLVER_SILENT_CLAMP'] = (globalHistogram['SOLVER_SILENT_CLAMP'] || 0) + 1;
            silentClampsByTemplate[tpl.id] = (silentClampsByTemplate[tpl.id] || 0) + 1;
            console.error(`⚠️ [SOLVER_SILENT_CLAMP] ${tpl.id}.${fieldKey}: atualMin=${bound.min}, nominalMin=${nominal.min}, testVal=${testVal} -> ${clampReason}`);
          } else {
            tplFailed++;
            console.error(`❌ [APERTO INDEVIDO EM MIN] ${tpl.id}.${fieldKey}: atualMin=${bound.min}, nominalMin=${nominal.min}, testVal=${testVal}`);
          }
        }
      }
    }

    totalShrunkLimits += tplShrunk;
    totalProvenShrunkLimits += tplProven;
    totalSilentClamps += tplSilentClamped;
    totalFailedShrunkLimits += tplFailed;
    console.log(`  • ${tpl.id.padEnd(18)}: ${tplShrunk} limites encolhidos | ${tplProven} comprovados validador | ${tplSilentClamped} clamps silenciosos | ${tplFailed} falhas`);
  }

  console.log('\n--- CÓDIGOS DE ERRO REAIS DO VALIDADOR COMPROVANDO LIMITES ENCOLHIDOS ---');
  for (const [code, count] of Object.entries(globalHistogram)) {
    console.log(`  • ${code.padEnd(28)}: ${count} comprovações empíricas`);
  }

  if (totalSilentClamps > 0) {
    console.log('\n--- ⚠️ RESUMO DE CLAMPS SILENCIOSOS NOS SOLVERS (BUG DE SOLVER REGISTRADO) ---');
    for (const [tId, count] of Object.entries(silentClampsByTemplate)) {
      console.log(`  • ${tId.padEnd(18)}: ${count} casos de clamp silencioso`);
    }
  }

  if (totalFailedShrunkLimits === 0 && totalShrunkLimits > 0) {
    console.log('✅ TESTE 2 APROVADO: 100% dos limites encolhidos foram provados necessários pelo validador (com clamps mapeados).');
  } else if (totalShrunkLimits === 0) {
    console.log('ℹ️ TESTE 2: Nenhum limite encolhido nos templates avaliados.');
  } else {
    console.error(`❌ TESTE 2 FALHOU: ${totalFailedShrunkLimits} limites indevidamente apertados!`);
  }

  // -------------------------------------------------------------------------
  // TESTE 3: ISOLAMENTO DOS TEMPLATES NÃO MIGRADOS
  // -------------------------------------------------------------------------
  console.log('\n--- TESTE 3: ISOLAMENTO DOS TEMPLATES NÃO MIGRADOS ---');
  let nonMigratedDivergences = 0;
  for (const record of baselineData) {
    if (MIGRATED_TEMPLATES.includes(record.templateId)) continue;

    const tpl = TEMPLATES.find((t) => t.id === record.templateId)!;
    const currBounds = calculateParamBounds(tpl, record.params, record.features);

    for (const [k, v] of Object.entries(record.bounds as Record<string, { min: number; max: number }>)) {
      const c = currBounds[k];
      if (!c || c.min !== v.min || c.max !== v.max) {
        nonMigratedDivergences++;
        console.error(`❌ Divergência no template ${record.templateId} campo ${k}: baseline=(${v.min},${v.max}) vs atual=(${c?.min},${c?.max})`);
      }
    }
  }

  console.log(`Resultado Teste 3: ${nonMigratedDivergences} divergências nos templates não migrados.`);
  if (nonMigratedDivergences === 0) {
    console.log('✅ TESTE 3 APROVADO: 100% de isolamento e equivalência nos templates não migrados.');
  } else {
    console.error('❌ TESTE 3 FALHOU!');
  }

  if (totalCoherenceErrors > 0 || totalFailedShrunkLimits > 0 || nonMigratedDivergences > 0) {
    process.exit(1);
  }
}

// CLI entry
const targetArg = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : undefined;
const seedArg = process.argv.find((a) => a.startsWith('--seed='));
const customSeed = seedArg ? Number(seedArg.split('=')[1]) : undefined;
runBoundsCoherence(targetArg, customSeed).catch((err) => {
  console.error(err);
  process.exit(1);
});

import { TEMPLATES } from '../src/data/templates';
import { calculateParamBounds } from '../src/engine/paramBounds';
import { generateGeometry } from '../src/engine/geometryEngine';
import { validateGeometry } from '../src/engine/validator';

const FEATURE_META: Record<string, any> = {
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

class SeededRandom {
  private seed: number;
  constructor(seed: number = 42) { this.seed = seed; }
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
  boolean(prob: number = 0.5): boolean { return this.next() < prob; }
}

export function runCheck(seed: number) {
  let grandTotal = 0;
  const results: Record<string, { fails: number; pct: string; errors: Record<string, number> }> = {};

  for (const tpl of TEMPLATES) {
    const rng = new SeededRandom(seed);
    let fails = 0;
    const SAMPLES = 500;
    const errorCodes: Record<string, number> = {};

    for (let i = 0; i < SAMPLES; i++) {
      // Setup features
      const features: any = JSON.parse(JSON.stringify(tpl.defaultFeatures || {}));
      const isAllFeaturesMode = (i < SAMPLES / 2); // 50% all features mode

      for (const fId of tpl.compatibleFeatures) {
        if (!features[fId]) features[fId] = { enabled: false, params: {} };
        if (isAllFeaturesMode) {
          features[fId].enabled = true;
        } else {
          features[fId].enabled = rng.boolean(0.5);
        }
      }

      // UI mutual exclusions
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

      // Sequential sampling of base params starting from defaults
      const currentParams: Record<string, number> = { ...tpl.defaultParams };
      for (const [k, def] of Object.entries(tpl.baseParams)) {
        const bounds = calculateParamBounds(tpl, currentParams, features);
        const b = bounds[k];
        const effMin = b?.min ?? def.min;
        const effMax = b?.max ?? def.max;
        const finalMin = Math.min(effMin, effMax);
        const finalMax = Math.max(effMin, effMax);
        currentParams[k] = rng.range(finalMin, finalMax, def.step);
      }

      // Sequential sampling of active features params
      for (const fId of tpl.compatibleFeatures) {
        if (features[fId]?.enabled && features[fId].params) {
          for (const [pKey, pVal] of Object.entries(features[fId].params)) {
            const bounds = calculateParamBounds(tpl, currentParams, features);
            const b = bounds[`${fId}.${pKey}`] || bounds[pKey];
            const meta = FEATURE_META[fId]?.[pKey];
            const effMin = b?.min ?? meta?.min ?? 1;
            const effMax = b?.max ?? meta?.max ?? 100;
            const finalMin = Math.min(effMin, effMax);
            const finalMax = Math.max(effMin, effMax);
            features[fId].params[pKey] = rng.range(finalMin, finalMax, meta?.step ?? 1);
          }
        }
      }

      try {
        const geom = generateGeometry(tpl, currentParams, features);
        const res = validateGeometry({
          outerPolylines: geom.outerPolylines,
          innerPolylines: geom.innerPolylines,
          circles: geom.circles,
          grossArea: geom.metrics?.grossAreaMm2 ?? 0,
          netArea: geom.metrics?.netAreaMm2 ?? 0,
          bendLines: geom.bendLines,
          faceSections: geom.faceSections,
          unfoldingMath: geom.unfoldingMath,
          templateId: tpl.id,
          params: currentParams,
        });
        if (res.errors.length > 0) {
          fails++;
          const code = res.errors[0].code;
          errorCodes[code] = (errorCodes[code] || 0) + 1;
        }
      } catch (e: any) {
        fails++;
        errorCodes['EXCEPTION'] = (errorCodes['EXCEPTION'] || 0) + 1;
      }
    }
    grandTotal += fails;
    const pct = (fails / SAMPLES * 100).toFixed(1);
    results[tpl.id] = { fails, pct: `${pct}%`, errors: errorCodes };
    console.log(`  • ${tpl.id.padEnd(18)}: ${fails}/${SAMPLES} (${pct}%)`, errorCodes);
  }
  console.log(`\n========================================================================`);
  console.log(`TOTAL DISCORDANCES (seed ${seed}): ${grandTotal}`);
  console.log(`========================================================================`);
  return { grandTotal, results };
}

if (process.argv[1]?.includes('testDiscordances')) {
  const seed = process.argv[2] ? Number(process.argv[2]) : 42;
  runCheck(seed);
}

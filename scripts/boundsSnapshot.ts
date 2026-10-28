import fs from 'fs';
import path from 'path';
import { TEMPLATES } from '../src/data/templates';
import { FeatureId, FeatureState } from '../src/types/cad';
import { calculateParamBounds } from '../src/engine/paramBounds';

const BASELINE_FILE = path.resolve(process.cwd(), 'tests', 'bounds_baseline.json');
const isGenerateMode = process.argv.includes('--generate') || process.argv.includes('--update');
const SAMPLES_PER_TEMPLATE = 400;

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

export interface BoundsRecord {
  templateId: string;
  runIndex: number;
  params: Record<string, number>;
  features: Record<string, { enabled: boolean; params?: Record<string, any> }>;
  bounds: Record<string, { min: number; max: number }>;
}

export function generateBoundsRecords(): BoundsRecord[] {
  const rng = new SeededRandom(54321);
  const records: BoundsRecord[] = [];

  for (const template of TEMPLATES) {
    for (let r = 0; r < SAMPLES_PER_TEMPLATE; r++) {
      const randomParams: Record<string, number> = {};
      for (const [key, paramDef] of Object.entries(template.baseParams)) {
        randomParams[key] = rng.range(paramDef.min, paramDef.max, paramDef.step);
      }

      const randomFeatures: Record<FeatureId, FeatureState> = { ...template.defaultFeatures };
      for (const [featId, defaultFeat] of Object.entries(template.defaultFeatures)) {
        randomFeatures[featId as FeatureId] = {
          ...defaultFeat,
          params: { ...(defaultFeat.params || {}) },
        };
      }

      for (const featId of template.compatibleFeatures) {
        if (randomFeatures[featId]) {
          const isEnabled = rng.boolean(0.5);
          randomFeatures[featId] = {
            ...randomFeatures[featId],
            enabled: isEnabled,
          };
        }
      }

      const bounds = calculateParamBounds(template, randomParams, randomFeatures);

      const recordFeatures: Record<string, { enabled: boolean; params?: Record<string, any> }> = {};
      for (const [fId, fVal] of Object.entries(randomFeatures)) {
        recordFeatures[fId] = {
          enabled: fVal.enabled,
          params: fVal.params,
        };
      }

      records.push({
        templateId: template.id,
        runIndex: r,
        params: randomParams,
        features: recordFeatures,
        bounds,
      });
    }
  }

  return records;
}

// Check or generate baseline
async function main() {
  console.log('========================================================================');
  console.log('  DXFAST PARAMETER BOUNDS SNAPSHOT & EQUIVALENCE SUITE');
  console.log(`  Target: ${TEMPLATES.length} Templates x ${SAMPLES_PER_TEMPLATE} = ${TEMPLATES.length * SAMPLES_PER_TEMPLATE} parameter variations`);
  console.log(`  Mode:   ${isGenerateMode ? 'GENERATE BASELINE' : 'CHECK EQUIVALENCE'}`);
  console.log('========================================================================');

  const currentRecords = generateBoundsRecords();

  if (isGenerateMode) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(currentRecords, null, 2), 'utf-8');
    console.log(`💾 [SAVED] Bounds baseline saved with ${currentRecords.length} combinations to:`);
    console.log(`   ${BASELINE_FILE}`);
    return;
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`❌ [ERROR] Baseline file not found at: ${BASELINE_FILE}`);
    console.error('Run "npx tsx scripts/boundsSnapshot.ts --generate" first.');
    process.exit(1);
  }

  const raw = fs.readFileSync(BASELINE_FILE, 'utf-8');
  const baselineRecords: BoundsRecord[] = JSON.parse(raw);

  if (baselineRecords.length !== currentRecords.length) {
    console.error(`❌ [MISMATCH] Record count mismatch: baseline=${baselineRecords.length}, current=${currentRecords.length}`);
    process.exit(1);
  }

  let divergences = 0;
  const perTemplateDivergences: Record<string, number> = {};

  for (let i = 0; i < baselineRecords.length; i++) {
    const base = baselineRecords[i];
    const curr = currentRecords[i];

    if (!perTemplateDivergences[base.templateId]) {
      perTemplateDivergences[base.templateId] = 0;
    }

    const baseKeys = Object.keys(base.bounds).sort();
    const currKeys = Object.keys(curr.bounds).sort();

    let diffFound = false;
    if (baseKeys.length !== currKeys.length || baseKeys.some((k, idx) => k !== currKeys[idx])) {
      diffFound = true;
    } else {
      for (const k of baseKeys) {
        const b = base.bounds[k];
        const c = curr.bounds[k];
        if (b.min !== c.min || b.max !== c.max) {
          diffFound = true;
          break;
        }
      }
    }

    if (diffFound) {
      divergences++;
      perTemplateDivergences[base.templateId]++;
      if (divergences <= 5) {
        console.error(`❌ [DIVERGENCE] ${base.templateId} run #${base.runIndex}:`);
        console.error(`   Baseline bounds:`, JSON.stringify(base.bounds));
        console.error(`   Current bounds: `, JSON.stringify(curr.bounds));
      }
    }
  }

  console.log('------------------------------------------------------------------------');
  console.log('TEMPLATE BOUNDS DIVERGENCE SUMMARY:');
  for (const t of TEMPLATES) {
    const count = perTemplateDivergences[t.id] ?? 0;
    console.log(`  - ${t.id.padEnd(22)}: ${count === 0 ? '✅ 0 divergences' : `❌ ${count} DIVERGENCES`}`);
  }
  console.log('------------------------------------------------------------------------');

  if (divergences > 0) {
    console.error(`❌ [FAILURE] Found ${divergences} divergences out of ${baselineRecords.length} test combinations.`);
    process.exit(1);
  } else {
    console.log(`🎉 [SUCCESS] All ${baselineRecords.length} parameter bounds match baseline exactly (0 divergences)!`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

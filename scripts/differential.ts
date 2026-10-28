import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { generateDxfR2000 } from '../src/engine/dxfExporter';
import { measureBoundingBox } from '../src/utils/geometryMeasure';
import { FeatureId, FeatureState } from '../src/types/cad';

const BASELINE_FILE = path.resolve(process.cwd(), 'tests', 'differential_baseline.json');
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

export interface DifferentialRecord {
  templateId: string;
  runIndex: number;
  params: Record<string, number>;
  features: Record<string, { enabled: boolean; params?: Record<string, any> }>;
  dxfHash: string;
  bbox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  netAreaMm2: number;
  bendCount: number;
  errorCount: number;
  warningCount: number;
}

export function getTemplateSeed(templateId: string, baseSeed: number = 12345): number {
  let hash = baseSeed;
  for (let i = 0; i < templateId.length; i++) {
    hash = ((hash * 31) + templateId.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

export function runDifferentialSuite(targetTemplateId?: string): { records: DifferentialRecord[]; totalRuns: number } {
  const records: DifferentialRecord[] = [];
  const templatesToRun = targetTemplateId
    ? TEMPLATES.filter((t) => t.id === targetTemplateId)
    : TEMPLATES;

  if (targetTemplateId && templatesToRun.length === 0) {
    throw new Error(`Template not found: ${targetTemplateId}`);
  }

  for (const template of templatesToRun) {
    const rng = new SeededRandom(getTemplateSeed(template.id, 12345));
    for (let r = 0; r < SAMPLES_PER_TEMPLATE; r++) {
      // 1. Generate randomized parameters within baseParams min/max
      const randomParams: Record<string, number> = {};
      for (const [key, paramDef] of Object.entries(template.baseParams)) {
        randomParams[key] = rng.range(paramDef.min, paramDef.max, paramDef.step);
      }

      // 2. Randomize feature states
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

      // 3. Solve geometry
      const geometry = generateGeometry(template, randomParams, randomFeatures);
      const dxf = generateDxfR2000(geometry);
      const dxfHash = crypto.createHash('sha256').update(dxf).digest('hex');
      const bbox = measureBoundingBox(geometry);

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
        dxfHash,
        bbox,
        netAreaMm2: Number(geometry.metrics.netAreaMm2.toFixed(4)),
        bendCount: geometry.metrics.bendCount || 0,
        errorCount: geometry.errors?.length || 0,
        warningCount: geometry.warnings?.length || 0,
      });
    }
  }

  return { records, totalRuns: records.length };
}

async function main() {
  const templateArg = process.argv.slice(2).find((arg) => !arg.startsWith('--') && TEMPLATES.some((t) => t.id === arg))
    || (() => {
      const idx = process.argv.indexOf('--template');
      return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : undefined;
    })();

  const targetTemplates = templateArg
    ? TEMPLATES.filter((t) => t.id === templateArg)
    : TEMPLATES;

  console.log(`\n========================================================================`);
  console.log(`  DXFAST DIFFERENTIAL REGRESSION TEST SUITE`);
  console.log(`  Target: ${targetTemplates.length} Template(s) x ${SAMPLES_PER_TEMPLATE} = ${targetTemplates.length * SAMPLES_PER_TEMPLATE} parameter variations`);
  console.log(`  Scope:  ${templateArg ? `Template [${templateArg}]` : 'ALL 12 TEMPLATES (Per-template PRNG Streams)'}`);
  console.log(`  Mode:   ${isGenerateMode ? 'GENERATE / UPDATE BASELINE' : 'CHECK AGAINST BASELINE'}`);
  console.log(`========================================================================\n`);

  const { records: currentRuns, totalRuns } = runDifferentialSuite(templateArg);

  if (isGenerateMode) {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    let finalRecords: DifferentialRecord[] = currentRuns;

    if (templateArg && fs.existsSync(BASELINE_FILE)) {
      const existing: DifferentialRecord[] = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
      const remaining = existing.filter((r) => r.templateId !== templateArg);
      finalRecords = [...remaining, ...currentRuns].sort((a, b) => {
        const orderA = TEMPLATES.findIndex((t) => t.id === a.templateId);
        const orderB = TEMPLATES.findIndex((t) => t.id === b.templateId);
        if (orderA !== orderB) return orderA - orderB;
        return a.runIndex - b.runIndex;
      });
      console.log(`🔄 [UPDATED] Replaced baseline records for [${templateArg}] (${currentRuns.length} records).`);
    } else {
      console.log(`💾 [SAVED] Differential baseline saved with ${finalRecords.length} test combinations.`);
    }

    fs.writeFileSync(BASELINE_FILE, JSON.stringify(finalRecords, null, 2), 'utf8');
    console.log(`   Saved to: ${BASELINE_FILE}\n`);
    return;
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`❌ [ERROR] Baseline file not found at: ${BASELINE_FILE}`);
    console.error(`   Run with 'npx tsx scripts/differential.ts --generate' to initialize baseline.`);
    process.exit(1);
  }

  const baselineAll: DifferentialRecord[] = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const baseline = templateArg
    ? baselineAll.filter((r) => r.templateId === templateArg)
    : baselineAll;

  if (baseline.length !== currentRuns.length) {
    console.error(`❌ [MISMATCH] Baseline contains ${baseline.length} records, current run produced ${currentRuns.length} records.`);
    process.exit(1);
  }

  let divergences = 0;
  const templateDivergences: Record<string, number> = {};

  for (let i = 0; i < currentRuns.length; i++) {
    const act = currentRuns[i];
    const exp = baseline[i];

    let hasDiff = false;
    const diffReasons: string[] = [];

    if (act.dxfHash !== exp.dxfHash) {
      diffReasons.push(`DXF Hash mismatch (exp: ${exp.dxfHash.substring(0, 8)}..., act: ${act.dxfHash.substring(0, 8)}...)`);
      hasDiff = true;
    }
    if (Math.abs(act.bbox.width - exp.bbox.width) > 1e-3 || Math.abs(act.bbox.height - exp.bbox.height) > 1e-3) {
      diffReasons.push(`BBox mismatch: exp ${exp.bbox.width}x${exp.bbox.height}, act ${act.bbox.width}x${act.bbox.height}`);
      hasDiff = true;
    }
    if (Math.abs(act.netAreaMm2 - exp.netAreaMm2) > 1e-2) {
      diffReasons.push(`Net Area mismatch: exp ${exp.netAreaMm2}, act ${act.netAreaMm2}`);
      hasDiff = true;
    }
    if (act.bendCount !== exp.bendCount) {
      diffReasons.push(`Bend count mismatch: exp ${exp.bendCount}, act ${act.bendCount}`);
      hasDiff = true;
    }
    if (act.errorCount !== exp.errorCount || act.warningCount !== exp.warningCount) {
      diffReasons.push(`Diagnostics mismatch: exp err=${exp.errorCount}/warn=${exp.warningCount}, act err=${act.errorCount}/warn=${act.warningCount}`);
      hasDiff = true;
    }

    if (hasDiff) {
      divergences++;
      templateDivergences[act.templateId] = (templateDivergences[act.templateId] || 0) + 1;
      if (divergences <= 10) {
        console.error(`❌ [DIVERGENCE] ${act.templateId} (Run #${act.runIndex}):`);
        for (const r of diffReasons) {
          console.error(`     - ${r}`);
        }
      }
    }
  }

  console.log(`------------------------------------------------------------------------`);
  console.log(`TEMPLATE DIVERGENCE SUMMARY:`);
  for (const t of targetTemplates) {
    const divCount = templateDivergences[t.id] || 0;
    const status = divCount === 0 ? '✅ 0 divergences' : `❌ ${divCount} divergences / ${SAMPLES_PER_TEMPLATE}`;
    console.log(`  - ${t.id.padEnd(22)} : ${status}`);
  }
  console.log(`------------------------------------------------------------------------`);

  if (divergences === 0) {
    console.log(`\n🎉 [SUCCESS] All ${totalRuns} differential test combinations match baseline exactly (0 divergences)!\n`);
  } else {
    console.error(`\n❌ [FAILED] ${divergences} / ${totalRuns} combinations diverged from baseline.\n`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes('differential')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

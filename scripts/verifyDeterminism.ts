import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { generateDxfR2000 } from '../src/engine/dxfExporter';

const SAMPLES_PER_TEMPLATE = 300;
const SNAPSHOT_FILE = path.resolve(process.cwd(), 'tests', 'determinism_snapshot.json');

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
}

function getDeterministicSeed(templateId: string, baseSeed: number = 99999): number {
  let hash = baseSeed;
  for (let i = 0; i < templateId.length; i++) {
    hash = ((hash * 31) + templateId.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

export interface DeterministicRecord {
  templateId: string;
  runIndex: number;
  params: Record<string, number>;
  dxfHash: string;
}

export function generateDeterministicDxfHashes(): Record<string, DeterministicRecord[]> {
  const result: Record<string, DeterministicRecord[]> = {};

  for (const template of TEMPLATES) {
    const records: DeterministicRecord[] = [];
    const rng = new SeededRandom(getDeterministicSeed(template.id, 99999));

    for (let r = 0; r < SAMPLES_PER_TEMPLATE; r++) {
      const params: Record<string, number> = {};

      if (r === 0) {
        // Run 0: nominal defaults
        for (const [key, def] of Object.entries(template.baseParams)) {
          params[key] = def.default;
        }
      } else if (r === 1) {
        // Run 1: minimum bounds
        for (const [key, def] of Object.entries(template.baseParams)) {
          params[key] = def.min;
        }
      } else if (r === 2) {
        // Run 2: maximum bounds
        for (const [key, def] of Object.entries(template.baseParams)) {
          params[key] = def.max;
        }
      } else {
        // Runs 3..299: deterministic distribution
        for (const [key, def] of Object.entries(template.baseParams)) {
          params[key] = rng.range(def.min, def.max, def.step);
        }
      }

      // Features strictly fixed at defaultFeatures
      const geometry = generateGeometry(template, params, template.defaultFeatures);
      const dxf = generateDxfR2000(geometry);
      const dxfHash = crypto.createHash('sha256').update(dxf).digest('hex');

      records.push({
        templateId: template.id,
        runIndex: r,
        params,
        dxfHash,
      });
    }

    result[template.id] = records;
  }

  return result;
}

async function main() {
  const isSnapshotMode = process.argv.includes('--snapshot') || process.argv.includes('--before');
  const isCompareMode = process.argv.includes('--compare') || process.argv.includes('--after');

  const current = generateDeterministicDxfHashes();
  const totalCombinations = TEMPLATES.length * SAMPLES_PER_TEMPLATE;

  if (isSnapshotMode || !fs.existsSync(SNAPSHOT_FILE)) {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(current, null, 2), 'utf-8');
    console.log(`\n========================================================================`);
    console.log(`  DETERMINISTIC GEOMETRY VERIFICATION - SNAPSHOT GENERATED`);
    console.log(`  Target: ${TEMPLATES.length} Templates x ${SAMPLES_PER_TEMPLATE} = ${totalCombinations} combinations`);
    console.log(`  Features: Fixed at defaultFeatures for all templates`);
    console.log(`========================================================================`);
    console.log(`💾 Snapshot successfully written to: ${SNAPSHOT_FILE}\n`);
    return;
  }

  // Compare mode
  console.log(`\n========================================================================`);
  console.log(`  DETERMINISTIC GEOMETRY VERIFICATION (ANTES vs DEPOIS)`);
  console.log(`  Target: ${TEMPLATES.length} Templates x ${SAMPLES_PER_TEMPLATE} = ${totalCombinations} combinations`);
  console.log(`  Features: Fixed at defaultFeatures for all templates`);
  console.log(`========================================================================\n`);

  const baseline: Record<string, DeterministicRecord[]> = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));

  let totalDivergences = 0;
  console.log(`------------------------------------------------------------------------`);
  console.log(`TEMPLATE DIVERGENCE AUDIT (DXF SHA-256 HASHES):`);
  console.log(`------------------------------------------------------------------------`);

  for (const template of TEMPLATES) {
    const baseList = baseline[template.id] || [];
    const currList = current[template.id] || [];

    let tempDivergences = 0;
    for (let r = 0; r < SAMPLES_PER_TEMPLATE; r++) {
      const b = baseList[r];
      const c = currList[r];
      if (!b || !c || b.dxfHash !== c.dxfHash) {
        tempDivergences++;
        if (totalDivergences + tempDivergences <= 5) {
          console.error(`❌ [DIVERGENCE] ${template.id} Run #${r}:`);
          console.error(`   Expected hash: ${b?.dxfHash}`);
          console.error(`   Actual hash:   ${c?.dxfHash}`);
          console.error(`   Params:        ${JSON.stringify(c?.params)}`);
        }
      }
    }

    totalDivergences += tempDivergences;
    const status = tempDivergences === 0
      ? `✅ 0 divergências (${SAMPLES_PER_TEMPLATE}/${SAMPLES_PER_TEMPLATE} idênticos)`
      : `❌ ${tempDivergences} DIVERGÊNCIAS / ${SAMPLES_PER_TEMPLATE}`;
    console.log(`  • ${template.id.padEnd(20)} : ${status}`);
  }

  console.log(`------------------------------------------------------------------------`);
  if (totalDivergences === 0) {
    console.log(`\n🎉 [PROVA CONCLUÍDA COM SUCESSO]`);
    console.log(`   Todas as ${totalCombinations} combinações determinísticas produziram hashes DXF 100% idênticos!`);
    console.log(`   Zero divergências geométricas detectadas antes e depois.\n`);
  } else {
    console.error(`\n❌ [FALHA] ${totalDivergences} divergências detectadas entre antes e depois.\n`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes('verifyDeterminism')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

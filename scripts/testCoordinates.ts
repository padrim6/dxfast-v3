import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { getFoldedPointTransform } from '../src/utils/foldedMeshBuilder';

export function testTemplateCoordinates(templateId: string): {
  templateId: string;
  uniqueCount: number;
  totalTested: number;
  passed: boolean;
  samples: Array<{ blankX: number; folded: { x: number; y: number; z: number; faceIndex: number } }>;
} {
  const tmpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tmpl) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const params: any = {};
  for (const [k, d] of Object.entries(tmpl.baseParams)) {
    params[k] = d.default;
  }

  const geom = generateGeometry(tmpl, params, tmpl.defaultFeatures);
  const totalW = geom.metrics.blankWidthMm || 200;

  // Generate 5 distinct blankX positions along the width of the blank
  const inputX = [
    -0.4 * totalW,
    -0.2 * totalW,
    0.0,
    0.2 * totalW,
    0.4 * totalW,
  ];

  const results = inputX.map((bx) => {
    const tf = getFoldedPointTransform(geom, templateId, bx, 0);
    return {
      blankX: bx,
      folded: {
        x: Number(tf.x.toFixed(3)),
        y: Number(tf.y.toFixed(3)),
        z: Number(tf.z.toFixed(3)),
        faceIndex: tf.faceIndex,
      },
    };
  });

  // Check unique 3D positions
  const uniqueKeys = new Set(
    results.map((r) => `${r.folded.faceIndex}_${r.folded.x}_${r.folded.y}_${r.folded.z}`)
  );

  return {
    templateId,
    uniqueCount: uniqueKeys.size,
    totalTested: inputX.length,
    passed: uniqueKeys.size === inputX.length,
    samples: results,
  };
}

if (process.argv[1]?.includes('testCoordinates')) {
  const targetId = process.argv[2];
  const list = targetId ? [targetId] : TEMPLATES.map((t) => t.id);

  console.log('=== TESTE DE COORDENADAS 3D (5 ENTRADAS DISTINTAS => 5 SAÍDAS DISTINTAS) ===\n');
  for (const id of list) {
    const res = testTemplateCoordinates(id);
    const status = res.passed ? '✅ PASS' : '❌ FAIL';
    console.log(
      `${res.templateId.padEnd(20)} | Resultado: ${res.uniqueCount}/${res.totalTested} distintas | ${status}`
    );
    if (!res.passed || process.argv.includes('--verbose')) {
      for (const s of res.samples) {
        console.log(`   in: blankX=${s.blankX.toFixed(1)} -> Face ${s.folded.faceIndex} @ (${s.folded.x}, ${s.folded.y}, ${s.folded.z})`);
      }
    }
  }
}

// DXFAST :: Round-trip do importador de DXF
// Para cada template: gera a geometria, exporta DXF, reimporta e confere que as
// metricas batem (bbox, numero de lacos, area, comprimento de corte). E a prova
// mais forte do parser, pois a entrada e um DXF de geometria conhecida.
// Rodar: npm run test:import
// Proibido o caractere traco-longo em qualquer string.

import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { generateDxfR2000, DEFAULT_DXF_OPTIONS } from '../src/engine/dxfExporter';
import { parseDxf } from '../src/import/dxfParser';
import { buildGeometryFromDxf } from '../src/import/dxfToGeometry';

let failures = 0;
const fail = (m: string) => { failures++; console.error('  [FALHA] ' + m); };

const approx = (a: number, b: number, tolAbs: number, tolRel = 0) =>
  Math.abs(a - b) <= tolAbs + tolRel * Math.max(Math.abs(a), Math.abs(b));

console.log('================================================================');
console.log(' ROUND-TRIP DO IMPORTADOR DXF (exporta -> reimporta -> compara)');
console.log('================================================================\n');

for (const tpl of TEMPLATES) {
  const geom = generateGeometry(tpl, { ...tpl.defaultParams }, tpl.defaultFeatures);
  const dxf = generateDxfR2000(geom, DEFAULT_DXF_OPTIONS);
  const parsed = parseDxf(dxf);
  const { geometry: imp, report } = buildGeometryFromDxf(parsed);

  // lacos de corte originais: contornos + furos internos + circulos
  const srcLoops =
    geom.outerPolylines.length + geom.innerPolylines.length + geom.circles.length;
  const impLoops = report.outerCount + report.holeCount;

  const okBox =
    approx(imp.metrics.blankWidthMm, geom.metrics.blankWidthMm, 0.5, 0.005) &&
    approx(imp.metrics.blankHeightMm, geom.metrics.blankHeightMm, 0.5, 0.005);
  const okLoops = impLoops === srcLoops && report.openChains === 0;
  const okArea = approx(imp.metrics.netAreaMm2, geom.metrics.netAreaMm2, 50, 0.03);
  const okCut = approx(imp.metrics.cutLengthMm, geom.metrics.cutLengthMm, 5, 0.03);

  const ok = okBox && okLoops && okArea && okCut;
  if (!ok) {
    fail(
      `${tpl.id}: box=${okBox} loops=${okLoops}(${impLoops}/${srcLoops}) area=${okArea}(${imp.metrics.netAreaMm2.toFixed(0)}/${geom.metrics.netAreaMm2.toFixed(0)}) cut=${okCut}(${imp.metrics.cutLengthMm.toFixed(0)}/${geom.metrics.cutLengthMm.toFixed(0)}) openChains=${report.openChains}`
    );
  }
  console.log(
    `  ${ok ? 'OK ' : 'XX '}${tpl.id.padEnd(16)} bbox ${imp.metrics.blankWidthMm.toFixed(0)}x${imp.metrics.blankHeightMm.toFixed(0)} | lacos ${impLoops}/${srcLoops} (ext ${report.outerCount} furo ${report.holeCount}) | pierce ${imp.metrics.piercingCount} | corte ${imp.metrics.cutLengthMm.toFixed(0)}mm`
  );
}

console.log('\n================================================================');
if (failures === 0) {
  console.log(' RESULTADO: ROUND-TRIP OK (0 falhas).');
  process.exit(0);
} else {
  console.log(` RESULTADO: ${failures} FALHA(S).`);
  process.exit(1);
}

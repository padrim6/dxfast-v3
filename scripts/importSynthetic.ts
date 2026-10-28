// DXFAST :: Teste do importador em DXF sinteticos (caminhos nao cobertos pelo round-trip)
import { parseDxf } from '../src/import/dxfParser';
import { buildGeometryFromDxf } from '../src/import/dxfToGeometry';
let failures=0; const fail=(m:string)=>{failures++;console.error('  [FALHA] '+m);};
const P=(...xs:(string|number)[])=>xs.join('\n'); // ja em pares
function dxf(entities:string, insunits?:number){
  const hdr = insunits!==undefined ? P(0,'SECTION',2,'HEADER',9,'$INSUNITS',70,insunits,0,'ENDSEC') : '';
  return P(hdr, 0,'SECTION',2,'ENTITIES', entities, 0,'ENDSEC',0,'EOF');
}
function check(name:string, text:string, exp:{w:number,h:number,outer:number,holes:number,open:number}){
  const {geometry:g,report:r}=buildGeometryFromDxf(parseDxf(text));
  const ok = Math.abs(g.metrics.blankWidthMm-exp.w)<0.6 && Math.abs(g.metrics.blankHeightMm-exp.h)<0.6
    && r.outerCount===exp.outer && r.holeCount===exp.holes && r.openChains===exp.open;
  if(!ok) fail(`${name}: bbox ${g.metrics.blankWidthMm.toFixed(1)}x${g.metrics.blankHeightMm.toFixed(1)} ext=${r.outerCount} furo=${r.holeCount} open=${r.openChains} (esperado ${exp.w}x${exp.h} ext${exp.outer} furo${exp.holes} open${exp.open})`);
  console.log(`  ${ok?'OK ':'XX '}${name.padEnd(28)} bbox ${g.metrics.blankWidthMm.toFixed(0)}x${g.metrics.blankHeightMm.toFixed(0)} ext=${r.outerCount} furo=${r.holeCount} open=${r.openChains} pierce=${g.metrics.piercingCount} corte=${g.metrics.cutLengthMm.toFixed(0)}`);
}

// 1. Quadrado de 4 LINEs separados (encadeamento)
const sq=P(0,'LINE',8,'0',10,0,20,0,11,100,21,0, 0,'LINE',8,'0',10,100,20,0,11,100,21,50,
  0,'LINE',8,'0',10,100,20,50,11,0,21,50, 0,'LINE',8,'0',10,0,20,50,11,0,21,0);
check('4 LINEs -> quadrado', dxf(sq), {w:100,h:50,outer:1,holes:0,open:0});

// 2. Quadrado (LINEs) + furo circular
check('quadrado + furo', dxf(sq+'\n'+P(0,'CIRCLE',8,'0',10,50,20,25,40,10)), {w:100,h:50,outer:1,holes:1,open:0});

// 3. POLYLINE/VERTEX (R12) fechado, triangulo
const tri=P(0,'POLYLINE',8,'0',70,1, 0,'VERTEX',8,'0',10,0,20,0, 0,'VERTEX',8,'0',10,120,20,0,
  0,'VERTEX',8,'0',10,0,20,90, 0,'SEQEND',8,'0');
check('POLYLINE/VERTEX triangulo', dxf(tri), {w:120,h:90,outer:1,holes:0,open:0});

// 4. Unidades em polegadas: quadrado 2x1 pol -> 50.8 x 25.4 mm
const sqIn=P(0,'LINE',8,'0',10,0,20,0,11,2,21,0, 0,'LINE',8,'0',10,2,20,0,11,2,21,1,
  0,'LINE',8,'0',10,2,20,1,11,0,21,1, 0,'LINE',8,'0',10,0,20,1,11,0,21,0);
check('polegadas (INSUNITS=1)', dxf(sqIn,1), {w:50.8,h:25.4,outer:1,holes:0,open:0});

// 5. Laco de 4 ARCs = circulo de raio 40 (encadeamento de arcos)
const c4=P(0,'ARC',8,'0',10,0,20,0,40,40,50,0,51,90, 0,'ARC',8,'0',10,0,20,0,40,40,50,90,51,180,
  0,'ARC',8,'0',10,0,20,0,40,40,50,180,51,270, 0,'ARC',8,'0',10,0,20,0,40,40,50,270,51,360);
check('4 ARCs -> circulo r40', dxf(c4), {w:80,h:80,outer:1,holes:0,open:0});

// 6. LWPOLYLINE aberta que NAO fecha (deve virar open chain, ignorada)
const openL=P(0,'LWPOLYLINE',8,'0',90,3,70,0,10,0,20,0,10,50,20,0,10,50,20,50);
check('LWPOLYLINE aberta (ignora)', dxf(openL+'\n'+P(0,'CIRCLE',8,'0',10,25,20,25,40,10)), {w:20,h:20,outer:1,holes:0,open:1});

console.log(failures===0?'\nTUDO OK (0 falhas).':`\n${failures} FALHA(S).`);
process.exit(failures===0?0:1);

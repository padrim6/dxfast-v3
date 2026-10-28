import { TEMPLATES } from '../src/data/templates';
import { generateGeometry } from '../src/engine/geometryEngine';
import { computeCartQuote, CartItem } from '../src/quote/cartQuote';
function geom(id:string){const t=TEMPLATES.find(x=>x.id===id)!;return generateGeometry(t,{...t.defaultParams},t.defaultFeatures);}
const items:CartItem[]=[
  {id:'a',name:'Gusset',geometry:geom('gusset_bracket'),thicknessMm:3,qty:12},
  {id:'b',name:'Chapa',geometry:geom('rect_plate'),thicknessMm:3,qty:8},
  {id:'c',name:'Flange 6mm',geometry:geom('circle_flange'),thicknessMm:6,qty:5},
];
const config:any={
  cuttingMachines:[{id:'m1',name:'Laser',type:'laser',hourlyRateBrl:300,setupTimeMinPerJob:10,
    speedRanges:[{minThicknessMm:0.5,maxThicknessMm:12,speedMmPerMinAtMin:8000,speedMmPerMinAtMax:1500,pierceTimeSecAtMin:0.3,pierceTimeSecAtMax:1.2}]}],
  bendingMachines:[{id:'b1',name:'Prensa',maxTonnageTons:100,hourlyRateBrl:200,setupTimeMinPerJob:15,cycleTimeSecPerBend:12}],
  sheets:[{id:'s3',materialId:'mat',thicknessMm:3,widthMm:3000,lengthMm:1500,pricePerSheet:450},
          {id:'s6',materialId:'mat',thicknessMm:6,widthMm:3000,lengthMm:1500,pricePerSheet:900}],
  materials:[{id:'mat',densityGPerCm3:7.85}],
};
const q=computeCartQuote({items,cuttingMachine:config.cuttingMachines[0],bendingMachine:config.bendingMachines[0],sheets:config.sheets,materials:config.materials,marginPercent:20,gapMm:5});
console.log('blocked=',q.blocked,'reason=',q.reason||'-');
console.log('grupos:', q.groups.map(g=>`${g.thicknessMm}mm:${g.totalParts}pc/${g.sheetsNeeded}chapas${g.blockedReason?' AVISO:'+g.blockedReason:''}`).join(' | '));
console.log('totalParts=',q.totalParts,'totalSheets=',q.totalSheets);
console.log('material=',q.materialCost.toFixed(2),'corte=',q.cuttingCost.toFixed(2),'dobra=',q.bendingCost.toFixed(2),'setup=',q.setupCost.toFixed(2));
console.log('subtotal=',q.subtotal.toFixed(2),'total(+'+q.marginPercent+'%)=',q.total.toFixed(2));
const ok = !q.blocked && q.groups.length===2 && q.totalSheets>=2 && q.total>0;
console.log(ok?'\nOK cart quote':'\nXX cart quote'); process.exit(ok?0:1);

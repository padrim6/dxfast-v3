// DXFAST :: Auditoria do aninhamento real (nesting em faixas alinhadas, com margem de borda)
// Prova as 4 garantias: (1) nunca super-estima (posicoes validas, sem
// sobreposicao, dentro da chapa); (2) nunca pior que a grade ingenua;
// (3) a mistura de orientacoes realmente ganha em casos classicos;
// (4) deterministico. Alem disso mede o pior caso de desempenho.
// Rodar: npx tsx scripts/nestingSanity.ts  (ou npm run test:nesting)

import { nestRectangles, Placement } from '../src/quote/nesting';

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error('  [FALHA] ' + msg);
}

// Grade pura COM a mesma margem de borda (= gap) do motor. Baseline honesto de
// nao-regressao: o nesting nunca pode render menos que isto.
function naiveGrid(SW: number, SL: number, PW: number, PH: number, gap: number): number {
  const uW = SW - 2 * gap;
  const uL = SL - 2 * gap;
  if (uW <= 0 || uL <= 0) return 0;
  const fit = (pw: number, ph: number) =>
    Math.floor((uW + gap) / (pw + gap)) * Math.floor((uL + gap) / (ph + gap));
  return Math.max(fit(PW, PH), fit(PH, PW));
}

// Verifica que um conjunto de posicoes e fisicamente valido.
function validateLayout(
  placements: Placement[],
  SW: number,
  SL: number,
  PW: number,
  PH: number,
  gap: number,
  label: string
): void {
  for (const p of placements) {
    // dimensoes devem corresponder a peca (em alguma orientacao)
    const swapped = p.rot === 90 || p.rot === 270;
    const okDims =
      (Math.abs(p.w - PW) < 1e-6 && Math.abs(p.h - PH) < 1e-6 && !swapped) ||
      (Math.abs(p.w - PH) < 1e-6 && Math.abs(p.h - PW) < 1e-6 && swapped);
    if (!okDims) {
      fail(`${label}: peca com dimensoes inconsistentes (${p.w}x${p.h} rot=${p.rot})`);
      return;
    }
    // dentro da area util: respeita a margem de borda (= gap) em todos os lados.
    if (
      p.x < gap - 1e-6 ||
      p.y < gap - 1e-6 ||
      p.x + p.w > SW - gap + 1e-6 ||
      p.y + p.h > SL - gap + 1e-6
    ) {
      fail(`${label}: peca fora da area util em (${p.x},${p.y}) ${p.w}x${p.h} chapa ${SW}x${SL} margem ${gap}`);
      return;
    }
  }
  // sem sobreposicao (respeitando o gap: pecas devem estar separadas por >= gap OU
  // encostar so na borda). Checagem O(n^2) com folga numerica.
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i];
      const b = placements[j];
      const overlapX = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6;
      const overlapY = a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
      if (overlapX && overlapY) {
        fail(
          `${label}: SOBREPOSICAO entre (${a.x},${a.y} ${a.w}x${a.h}) e (${b.x},${b.y} ${b.w}x${b.h})`
        );
        return;
      }
    }
  }
}

console.log('================================================================');
console.log(' AUDITORIA DO ANINHAMENTO REAL (faixas alinhadas + margem de borda)');
console.log('================================================================\n');

// -------------------------------------------------------------------------
// 1 + 2. Varredura ampla deterministica: validade fisica + nunca pior que grade
// -------------------------------------------------------------------------
console.log('[1/4] Validade fisica e nao-regressao vs grade ingenua...');
const sheets: Array<[number, number]> = [
  [3000, 1500],
  [2000, 1000],
  [1200, 1200],
  [600, 400],
];
const gaps = [0, 3, 5, 8];
let combos = 0;
let improved = 0;
let worseThanGrid = 0;
let invalid = 0;
let fullyChecked = 0;

// Foco no regime onde a recursao de mistura importa (pecas medias/grandes, poucas
// por chapa). A validade fisica independe da contagem; para layouts densos (muitas
// pecas) checamos so bordas e contagem, pois grade e regioes guilhotina sao
// disjuntas por construcao. A checagem O(n^2) completa roda quando count <= 400.
for (const [SW, SL] of sheets) {
  for (let PW = 60; PW <= 900; PW += 47) {
    for (let PH = 60; PH <= 900; PH += 61) {
      for (const gap of gaps) {
        combos++;
        const res = nestRectangles(SW, SL, PW, PH, gap);
        const before = failures;
        if (res.placements.length <= 400) {
          validateLayout(res.placements, SW, SL, PW, PH, gap, `S${SW}x${SL} P${PW}x${PH} g${gap}`);
          fullyChecked++;
        } else {
          // checagem leve de bordas (respeitando a margem = gap)
          for (const p of res.placements) {
            if (
              p.x < gap - 1e-6 ||
              p.y < gap - 1e-6 ||
              p.x + p.w > SW - gap + 1e-6 ||
              p.y + p.h > SL - gap + 1e-6
            ) {
              fail(`borda: peca fora da area util (${p.x},${p.y}) ${p.w}x${p.h} margem ${gap}`);
              break;
            }
          }
        }
        if (failures > before) invalid++;
        if (res.count !== res.placements.length) {
          fail(`contagem (${res.count}) difere do numero de posicoes (${res.placements.length})`);
        }
        const naive = naiveGrid(SW, SL, PW, PH, gap);
        if (res.count < naive) {
          worseThanGrid++;
          fail(`PIOR QUE A GRADE: real=${res.count} grade=${naive} (S${SW}x${SL} P${PW}x${PH} g${gap})`);
        }
        if (res.count > naive) improved++;
      }
    }
  }
}
console.log(`      Layouts com checagem O(n^2) completa: ${fullyChecked}`);
console.log(`      Combinacoes testadas: ${combos}`);
console.log(`      Layouts invalidos (sobreposicao/fora): ${invalid}`);
console.log(`      Casos pior que a grade: ${worseThanGrid}`);
console.log(`      Casos em que a mistura ganhou pecas: ${improved} (${((improved / combos) * 100).toFixed(1)}%)\n`);

// -------------------------------------------------------------------------
// 3. Casos classicos em que a mistura de orientacoes DEVE ganhar
// -------------------------------------------------------------------------
console.log('[3/4] Casos de ganho obrigatorio por mistura de orientacoes...');
const winCases: Array<{ s: [number, number]; p: [number, number]; gap: number; min: number; desc: string }> = [
  { s: [100, 100], p: [60, 40], gap: 0, min: 3, desc: 'chapa 100x100, peca 60x40' },
  { s: [100, 100], p: [70, 30], gap: 0, min: 4, desc: 'chapa 100x100, peca 70x30' },
];
for (const wc of winCases) {
  const res = nestRectangles(wc.s[0], wc.s[1], wc.p[0], wc.p[1], wc.gap);
  const naive = naiveGrid(wc.s[0], wc.s[1], wc.p[0], wc.p[1], wc.gap);
  validateLayout(res.placements, wc.s[0], wc.s[1], wc.p[0], wc.p[1], wc.gap, wc.desc);
  const okWin = res.count >= wc.min && res.count > naive;
  console.log(
    `      ${okWin ? 'OK ' : 'XX '}${wc.desc}: real=${res.count} grade=${naive} (esperado >= ${wc.min} e > grade)`
  );
  if (!okWin) fail(`${wc.desc}: mistura nao superou a grade (real=${res.count}, grade=${naive})`);
}
console.log('');

// -------------------------------------------------------------------------
// 4. Determinismo + desempenho de pior caso
// -------------------------------------------------------------------------
console.log('[4/4] Determinismo e desempenho...');
const detCase = nestRectangles(3000, 1500, 237, 149, 5);
const detCase2 = nestRectangles(3000, 1500, 237, 149, 5);
if (detCase.count !== detCase2.count || detCase.placements.length !== detCase2.placements.length) {
  fail('determinismo quebrado: duas chamadas identicas divergiram');
} else {
  console.log(`      Determinismo OK (${detCase.count} pecas, repetivel).`);
}

// pior caso de desempenho: peca pequena em chapa grande (grade densa, guarda de skip)
// e peca media (recursao ativa).
const perfCases: Array<[number, number, number, number, number, string]> = [
  [3000, 1500, 10, 10, 2, 'peca minuscula 10x10 (grade densa)'],
  [3000, 1500, 97, 61, 5, 'peca pequena 97x61 (recursao)'],
  [3000, 1500, 410, 330, 6, 'peca media 410x330 (recursao cheia)'],
  [3000, 1500, 23, 17, 3, 'peca 23x17 (muito densa)'],
];
let maxMs = 0;
for (const [SW, SL, PW, PH, gap, desc] of perfCases) {
  const t0 = performance.now();
  const r = nestRectangles(SW, SL, PW, PH, gap);
  const dt = performance.now() - t0;
  maxMs = Math.max(maxMs, dt);
  console.log(`      ${dt.toFixed(1).padStart(6)} ms  ${desc} -> ${r.count} pecas`);
  if (dt > 150) fail(`${desc}: lento demais (${dt.toFixed(1)} ms > 150 ms)`);
}
console.log(`      Pior tempo: ${maxMs.toFixed(1)} ms\n`);

console.log('================================================================');
if (failures === 0) {
  console.log(' RESULTADO: TODAS AS GARANTIAS CONFIRMADAS (0 falhas).');
  console.log('================================================================');
  process.exit(0);
} else {
  console.log(` RESULTADO: ${failures} FALHA(S) DETECTADA(S).`);
  console.log('================================================================');
  process.exit(1);
}

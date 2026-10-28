// DXFAST :: Interpolacao de parametros de corte (helper puro, fora do engine)
// Encontra a faixa de espessura da maquina e interpola linearmente velocidade e
// tempo de perfuracao. Filosofia holeGuard: fora de faixa retorna null, nunca
// extrapola nem usa a faixa mais proxima em silencio. Proibido o traco-longo.

import { CuttingMachineConfig, CuttingSpeedBand } from '../../types/admin';

export interface ResolvedCutParams {
  speedMmPerMin: number;
  pierceTimeSec: number;
}

const EPS = 1e-6;

// Retorna a primeira faixa que contem a espessura (min <= t <= max), ou null.
export function findBand(
  bands: CuttingSpeedBand[],
  thicknessMm: number
): CuttingSpeedBand | null {
  if (!bands || bands.length === 0) return null;
  for (const b of bands) {
    if (thicknessMm >= b.thicknessMinMm - EPS && thicknessMm <= b.thicknessMaxMm + EPS) {
      return b;
    }
  }
  return null;
}

// Interpola linearmente dentro da faixa. Fora de faixa: null (bloqueio honesto).
export function resolveCutParams(
  machine: CuttingMachineConfig | null | undefined,
  thicknessMm: number
): ResolvedCutParams | null {
  if (!machine) return null;
  const band = findBand(machine.bands, thicknessMm);
  if (!band) return null;

  const span = band.thicknessMaxMm - band.thicknessMinMm;
  const frac = span > EPS ? (thicknessMm - band.thicknessMinMm) / span : 0;
  const clamped = Math.max(0, Math.min(1, frac));

  const speedMmPerMin =
    band.speedAtMinMmPerMin + clamped * (band.speedAtMaxMmPerMin - band.speedAtMinMmPerMin);
  const pierceTimeSec =
    band.pierceAtMinSec + clamped * (band.pierceAtMaxSec - band.pierceAtMinSec);

  if (!(speedMmPerMin > 0)) return null;
  return { speedMmPerMin, pierceTimeSec };
}

// Faixas padrao sugeridas ao criar uma maquina nova (ponto de partida, o usuario
// calibra depois com os dados reais da maquina dele).
export function defaultBandsFor(type: 'laser' | 'plasma'): CuttingSpeedBand[] {
  if (type === 'plasma') {
    return [
      { thicknessMinMm: 3.0, thicknessMaxMm: 6.0, speedAtMinMmPerMin: 5000, speedAtMaxMmPerMin: 3500, pierceAtMinSec: 0.5, pierceAtMaxSec: 0.8 },
      { thicknessMinMm: 6.0, thicknessMaxMm: 12.0, speedAtMinMmPerMin: 3500, speedAtMaxMmPerMin: 2000, pierceAtMinSec: 0.8, pierceAtMaxSec: 1.5 },
      { thicknessMinMm: 12.0, thicknessMaxMm: 20.0, speedAtMinMmPerMin: 2000, speedAtMaxMmPerMin: 1200, pierceAtMinSec: 1.5, pierceAtMaxSec: 3.0 },
      { thicknessMinMm: 20.0, thicknessMaxMm: 30.0, speedAtMinMmPerMin: 1200, speedAtMaxMmPerMin: 600, pierceAtMinSec: 3.0, pierceAtMaxSec: 6.0 },
    ];
  }
  return [
    { thicknessMinMm: 0.5, thicknessMaxMm: 1.0, speedAtMinMmPerMin: 9000, speedAtMaxMmPerMin: 7000, pierceAtMinSec: 0.2, pierceAtMaxSec: 0.3 },
    { thicknessMinMm: 1.0, thicknessMaxMm: 3.0, speedAtMinMmPerMin: 7000, speedAtMaxMmPerMin: 4000, pierceAtMinSec: 0.3, pierceAtMaxSec: 0.6 },
    { thicknessMinMm: 3.0, thicknessMaxMm: 6.0, speedAtMinMmPerMin: 4000, speedAtMaxMmPerMin: 2000, pierceAtMinSec: 0.6, pierceAtMaxSec: 1.2 },
    { thicknessMinMm: 6.0, thicknessMaxMm: 10.0, speedAtMinMmPerMin: 2000, speedAtMaxMmPerMin: 1200, pierceAtMinSec: 1.2, pierceAtMaxSec: 2.5 },
    { thicknessMinMm: 10.0, thicknessMaxMm: 15.0, speedAtMinMmPerMin: 1200, speedAtMaxMmPerMin: 700, pierceAtMinSec: 2.5, pierceAtMaxSec: 5.0 },
  ];
}

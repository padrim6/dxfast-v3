import { TemplateDefinition, FeatureState } from '../../types/cad';
import { generateGeometry } from '../geometryEngine';

export interface ParamBound {
  min: number;
  max: number;
  reason?: string;
}

export type ParamBoundsMap = Record<string, ParamBound>;

export const MIN_GAP = 3.5;

/**
 * Refinamento airtight por geometria real (campanha Bounds Airtight).
 * Para cada campo em `keys`, restringe bounds[key] ao MAIOR intervalo contiguo
 * de validade que CONTEM o valor atual, amostrando a geometria real (o proprio
 * validador). Robusto a nao monotonicidade e a parametros onde o valor baixo e
 * o pior caso. So aperta (nunca afrouxa). Chaves de feature no formato 'fid.param'.
 */
export function refineAirtight(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>,
  keys: string[],
  samples = 40
): void {
  const isValid = (
    over: Record<string, number>,
    feat: { fid: string; pk: string; val: number } | null
  ): boolean => {
    const pp: Record<string, number> = { ...params, ...over };
    const ff: Record<string, FeatureState> = JSON.parse(JSON.stringify(features || {}));
    if (feat) {
      if (!ff[feat.fid]) ff[feat.fid] = { enabled: true, params: {} };
      ff[feat.fid].enabled = true;
      ff[feat.fid].params = { ...(ff[feat.fid].params || {}), [feat.pk]: feat.val };
    }
    try {
      return generateGeometry(template, pp, ff).errors.length === 0;
    } catch {
      return false;
    }
  };
  const curVal = (key: string): number => {
    if (key.includes('.')) {
      const [fid, pk] = key.split('.');
      return Number(features?.[fid]?.params?.[pk] ?? bounds[key].min);
    }
    return Number(params[key] ?? bounds[key].min);
  };
  const testAt = (key: string, v: number): boolean => {
    if (key.includes('.')) {
      const [fid, pk] = key.split('.');
      return isValid({}, { fid, pk, val: v });
    }
    return isValid({ [key]: v }, null);
  };
  for (const key of keys) {
    const b = bounds[key];
    if (!b || b.max <= b.min) continue;
    const integer = /count|rows|cols|qty/i.test(key);
    const cur = Math.max(b.min, Math.min(b.max, curVal(key)));
    const n = integer ? Math.max(1, Math.round(b.max - b.min)) : samples;
    const step = (b.max - b.min) / n;
    const snap = (v: number) => (integer ? Math.round(v) : v);
    if (!testAt(key, snap(cur))) continue; // valor atual ja invalido: estado transitorio, solver bloqueia
    let hi = cur;
    for (let v = cur + step; v <= b.max + 1e-9; v += step) {
      if (testAt(key, snap(v))) hi = v; else break;
    }
    let lo = cur;
    for (let v = cur - step; v >= b.min - 1e-9; v -= step) {
      if (testAt(key, snap(v))) lo = v; else break;
    }
    const nmin = integer ? Math.ceil(lo) : Math.ceil(lo * 100) / 100;
    const nmax = integer ? Math.floor(hi) : Math.floor(hi * 100) / 100;
    if (nmin > b.min) b.min = Math.min(b.max, nmin);
    if (nmax < b.max) b.max = Math.max(b.min, nmax);
  }
}

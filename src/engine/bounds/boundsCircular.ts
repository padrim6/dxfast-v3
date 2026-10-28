import { TemplateDefinition, FeatureState } from '../../types/cad';
import { ParamBound, MIN_GAP, refineAirtight } from './core';

export function bounds_circle_flange(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    let minOD = 20;
    let odReason: string | undefined;

    const fState = features || {};
    if (fState.boltCircle?.enabled) {
      const bcd = Number(fState.boltCircle.params?.bcd ?? 150);
      const dia = Number(fState.boltCircle.params?.diameter ?? 14);
      const bcdRequired = Math.ceil(bcd + dia + 2 * MIN_GAP);
      if (bcdRequired > minOD) {
        minOD = bcdRequired;
        odReason = `mínimo de ${minOD} mm para conter os furos do padrão circular BCD com parede de ${MIN_GAP} mm`;
      }
    }

    bounds.outerDiameter = { min: minOD, max: 3000, reason: odReason };
    bounds.thickness = { min: 0.5, max: 50 };

    // Bounds iniciais generosos dos parametros de feature (depois apertados
    // ao intervalo valido real por refineAirtight).
    const OD = params.outerDiameter ?? 200;
    if (fState.centerHole?.enabled) {
      bounds['centerHole.diameter'] = { min: 1, max: Math.max(1, Math.floor(OD - 2 * MIN_GAP)) };
    }
    if (fState.boltCircle?.enabled) {
      bounds['boltCircle.bcd'] = { min: 1, max: Math.max(1, Math.floor(OD)) };
      bounds['boltCircle.diameter'] = { min: 1, max: Math.max(1, Math.floor(OD / 2)) };
      bounds['boltCircle.count'] = { min: 1, max: 48 };
      bounds['boltCircle.startAngle'] = { min: 0, max: 360 };
    }
    if (fState.keyway?.enabled) {
      bounds['keyway.width'] = { min: 1, max: Math.max(1, Math.floor(OD)) };
      bounds['keyway.depth'] = { min: 1, max: Math.max(1, Math.floor(OD)) };
    }

    // Refinamento airtight: nenhuma combinacao alcancavel por slider pode gerar
    // furacao fora do disco ou colidindo. startAngle (rotacao) nao gera overflow.
    const cfKeys = ['outerDiameter'];
    if (fState.centerHole?.enabled) cfKeys.push('centerHole.diameter');
    if (fState.boltCircle?.enabled) cfKeys.push('boltCircle.bcd', 'boltCircle.diameter', 'boltCircle.count');
    if (fState.keyway?.enabled) cfKeys.push('keyway.width', 'keyway.depth');
    refineAirtight(template, params, features, bounds, cfKeys);
}

export function bounds_polygon_regular(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    bounds.sidesCount = { min: 3, max: 24 };
    bounds.outerDiameter = { min: 20, max: 3000 };
    bounds.startAngle = { min: 0, max: 360 };
    bounds.thickness = { min: 0.5, max: 50 };
}

export function bounds_oval_flange(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const r = params.endRadius ?? 35;
    const cc = params.centerDistance ?? 130;
    const rawBoltD = params.boltHoleDia ?? 14;

    const effBoltD = Math.min(rawBoltD, Math.max(4, 2 * r - 6));
    const minCC = Math.max(30, Math.ceil(effBoltD));
    const maxBoltD = Math.max(4, Math.floor(Math.min(2 * r - 6, cc)));

    bounds.centerDistance = { min: minCC, max: 2000 };
    bounds.endRadius = { min: 15, max: 500 };
    bounds.boltHoleDia = { min: 4, max: maxBoltD };
    refineAirtight(template, params, features, bounds, Object.keys(bounds));
}

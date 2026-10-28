import { TemplateDefinition, FeatureState } from '../../types/cad';
import { ParamBound, MIN_GAP, refineAirtight } from './core';

export function bounds_gate_guide_u(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const t = params.thickness ?? 3.0;
    const ri = params.innerRadius ?? 3.0;
    const effectiveRi = Math.max(0.2 * t, ri);
    const ro = effectiveRi + t;
    const flareAngle = params.flareAngle ?? 45;
    const alphaRad = ((flareAngle / 2) * Math.PI) / 180;
    const tanHalf = Math.tan(alphaRad);
    const osb1 = tanHalf * ro;
    const minBaseA = Math.ceil(2 * ro + 0.01);
    const minWebB = Math.ceil(osb1 + ro + 0.01);
    const minFlareC = Math.ceil(osb1 + 0.01);

    bounds.baseA = { min: minBaseA, max: 800 };
    bounds.webB = { min: minWebB, max: 600 };
    bounds.webB_left = { min: minWebB, max: 600 };
    bounds.webB_right = { min: minWebB, max: 600 };
    bounds.flareC = { min: minFlareC, max: 400 };
    bounds.flareC_left = { min: minFlareC, max: 400 };
    bounds.flareC_right = { min: minFlareC, max: 400 };
    bounds.length = { min: 30, max: 4000 };

    const isSymmetric = (params.symmetric ?? 1) !== 0;
    const curA = Math.max(minBaseA, params.baseA ?? 80);
    const curBL = isSymmetric ? Math.max(minWebB, params.webB ?? 80) : Math.max(minWebB, params.webB_left ?? 80);
    const curBR = isSymmetric ? Math.max(minWebB, params.webB ?? 80) : Math.max(minWebB, params.webB_right ?? 80);
    const curCL = isSymmetric ? Math.max(minFlareC, params.flareC ?? 50) : Math.max(minFlareC, params.flareC_left ?? 50);
    const curCR = isSymmetric ? Math.max(minFlareC, params.flareC ?? 50) : Math.max(minFlareC, params.flareC_right ?? 50);

    const angleL = isSymmetric ? (params.flareAngle ?? 45) : (params.flareAngle_left ?? 45);
    const angleR = isSymmetric ? (params.flareAngle ?? 45) : (params.flareAngle_right ?? 45);
    const tanHalfL = Math.tan(((angleL / 2) * Math.PI) / 180);
    const tanHalfR = Math.tan(((angleR / 2) * Math.PI) / 180);

    // Dynamic thickness and innerRadius:
    // 2 * osb < rawA => Ro < curA / 2
    // osb + osbFlare < rawB => Ro * (1 + tanHalf) < curB
    // osbFlare < rawC => Ro * tanHalf < curC
    const maxRoBase = curA / 2 - 0.05;
    const maxRoWebL = curBL / (1 + tanHalfL) - 0.05;
    const maxRoWebR = curBR / (1 + tanHalfR) - 0.05;
    const maxRoFlareL = curCL / Math.max(1e-4, tanHalfL) - 0.05;
    const maxRoFlareR = curCR / Math.max(1e-4, tanHalfR) - 0.05;
    const maxRo = Math.max(0.5, Math.min(maxRoBase, maxRoWebL, maxRoWebR, maxRoFlareL, maxRoFlareR));

    const riParam = params.innerRadius;
    const rawMaxT = Math.min(
      maxRo / 1.2,
      riParam !== undefined ? maxRo - riParam : maxRo - 0.5
    );
    const maxT = Math.min(12, Math.max(1, Math.floor(rawMaxT * 10) / 10));
    bounds.thickness = { min: 1, max: Math.max(1, maxT) };

    const maxRi = Math.min(20, Math.max(0.5, Math.floor((maxRo - t) * 10) / 10));
    bounds.innerRadius = { min: 0.5, max: Math.max(0.5, maxRi) };

    // Dynamic flareAngle:
    const maxTanHalfWebL = (curBL - ro) / Math.max(1e-4, ro);
    const maxTanHalfFlareL = curCL / Math.max(1e-4, ro);
    const maxTanHalfL = Math.min(maxTanHalfWebL, maxTanHalfFlareL) - 0.001;
    const maxAngleL = maxTanHalfL > 0 ? Math.min(75, Math.floor((2 * Math.atan(maxTanHalfL) * 180) / Math.PI)) : 10;

    const maxTanHalfWebR = (curBR - ro) / Math.max(1e-4, ro);
    const maxTanHalfFlareR = curCR / Math.max(1e-4, ro);
    const maxTanHalfR = Math.min(maxTanHalfWebR, maxTanHalfFlareR) - 0.001;
    const maxAngleR = maxTanHalfR > 0 ? Math.min(75, Math.floor((2 * Math.atan(maxTanHalfR) * 180) / Math.PI)) : 10;

    bounds.flareAngle_left = { min: 10, max: Math.max(10, maxAngleL) };
    bounds.flareAngle_right = { min: 10, max: Math.max(10, maxAngleR) };
    bounds.flareAngle = { min: 10, max: Math.max(10, Math.min(maxAngleL, maxAngleR)) };

    const L = Math.max(30, params.length ?? 100);
    const flatBaseWidth = curA - 2 * ro;
    const maxDiaBase = Math.floor(flatBaseWidth - 3 * t);

    const isOblong = (params.oblongHoles ?? 0) !== 0;
    const curQty = Math.max(1, Math.min(10, Math.round(params.holeQty ?? 2)));
    const curPitch = Math.max(8, params.holePitch ?? 50);

    // Diâmetro: limitado pela face, pelo passo (não colidir) e pela margem residual.
    let maxDiaL = Math.floor(L - 4);
    if (curQty > 1) {
      const maxDiaResidual = Math.floor((L - (curQty - 1) * curPitch) / 2); // residual >= dia
      const maxDiaPitch = Math.floor(curPitch - 2); // não colidir (span circular = dia)
      maxDiaL = Math.min(maxDiaResidual, maxDiaPitch);
    }
    const maxDia = Math.min(25, Math.max(4, Math.min(maxDiaBase, maxDiaL)));
    bounds.holeDiameter = { min: 4, max: Math.max(4, maxDia) };

    const curDia = Math.max(4, Math.min(maxDia, params.holeDiameter ?? 10));

    // Comprimento do rasgo: limitado pelo passo (não colidir) e teto absoluto.
    let maxSlotL = Math.floor(L - 4);
    if (curQty > 1) {
      maxSlotL = Math.floor(curPitch - 2);
    }
    const maxSlot = Math.min(100, Math.max(10, maxSlotL));
    const minSlot = Math.min(maxSlot, Math.max(6, Math.ceil(curDia + 2)));
    bounds.slotLength = { min: minSlot, max: maxSlot };

    const curSlot = isOblong
      ? Math.max(minSlot, Math.min(maxSlot, params.slotLength ?? 20))
      : curDia;
    const span = isOblong ? curSlot : curDia;

    // Passo entre centros (driver): mínimo = vão do furo + folga;
    // máximo = o padrão cabe com margem residual (borda->centro) >= diâmetro.
    const minPitch = Math.ceil(span + 2);
    let maxPitch = Math.floor(L); // qty = 1: passo irrelevante
    if (curQty > 1) {
      maxPitch = Math.floor((L - 2 * curDia) / (curQty - 1));
    }
    bounds.holePitch = { min: minPitch, max: Math.max(minPitch, maxPitch) };

    // Quantidade: quantos furos cabem no comprimento dado o passo atual.
    const maxQty = curPitch > 0
      ? Math.max(1, Math.min(10, Math.floor(1 + (L - 2 * curDia) / curPitch)))
      : 1;
    bounds.holeQty = { min: 1, max: maxQty };

    // Refino airtight: os bounds analiticos acima sao aproximados e acoplados
    // (mover baseA/length/thickness/innerRadius invalida a furacao vigente, e os
    // tetos/pisos de margem e diametro nao batem exatamente com o solver). Aperta
    // cada campo ao intervalo valido real contra a geometria, segurando os demais.
    refineAirtight(template, params, features, bounds, Object.keys(bounds));
}

export function bounds_gate_weight_box(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const isSquare = (params.squareSection ?? 0) !== 0;
    const t = Math.max(0.8, params.thickness ?? 1.5);
    const ri = Math.max(0.5, params.innerRadius ?? 1.5);
    const ro = ri + t;
    const sb = ro;
    const minFace = Math.ceil(2 * (ro + t) + 1.0 - 1e-4);

    bounds.heightA = { min: minFace, max: 600 };
    bounds.widthB = { min: minFace, max: 600 };
    bounds.length = { min: 100, max: 6000 };
    bounds.seamGap = { min: 0.0, max: 5.0 };

    const curA = Math.max(minFace, params.heightA ?? 150);
    const curB = isSquare ? curA : Math.max(minFace, params.widthB ?? 100);
    const minDim = Math.min(curA, curB);

    // Dynamic thickness & innerRadius:
    // Validator: minDim < 2 * (Ro + t) + 1.0 - 1e-4 => 2 * ri + 4 * t <= minDim - 1.0
    const rawMaxT = (minDim - 1.0 - 2 * ri) / 4;
    const maxT = Math.min(4.75, Math.floor(rawMaxT * 10) / 10);
    bounds.thickness = { min: 0.8, max: Math.max(0.8, maxT) };

    const rawMaxRi = (minDim - 1.0 - 4 * t) / 2;
    const maxRi = Math.min(10.0, Math.floor(rawMaxRi * 10) / 10);
    bounds.innerRadius = { min: 0.5, max: Math.max(0.5, maxRi) };

    const L = Math.max(100, params.length ?? 2000);
    const faceBFlatW = Math.max(10, curB - 2 * sb);
    const faceAFlatW = Math.max(10, curA - 2 * sb);

    const hasDrain = (params.holesDrain ?? 1) !== 0;
    if (hasDrain) {
      const curDrainQty = Math.max(1, Math.min(4, Math.round(params.drainQty ?? 2)));
      const drainDivisor = curDrainQty === 1 ? 1 : curDrainQty === 2 ? 4 : (curDrainQty + 1);
      const maxDrainDia = Math.min(25.0, Math.max(4.0, Math.floor((faceBFlatW - 0.05) / drainDivisor)));
      bounds.drainDiameter = { min: 4.0, max: maxDrainDia };

      const curDrainDia = Math.max(4.0, Math.min(maxDrainDia, params.drainDiameter ?? 8.0));
      let maxDrainQty = 1;
      if (faceBFlatW >= 5 * curDrainDia - 0.35) {
        maxDrainQty = 4;
      } else if (faceBFlatW >= 4 * curDrainDia - 0.25) {
        maxDrainQty = 3;
      }
      bounds.drainQty = { min: 1, max: maxDrainQty };

      const minDrainMargin = Math.max(10, Math.ceil(curDrainDia / 2));
      // Espaçamento entre as 2 fileiras (c/c): cabe com margem residual >= mínimo.
      const maxSpacing = Math.max(20, Math.floor(L - 2 * minDrainMargin));
      bounds.drainRowSpacing = { min: Math.max(20, Math.ceil(curDrainDia)), max: maxSpacing };
    } else {
      bounds.drainDiameter = { min: 4.0, max: 25.0 };
      bounds.drainQty = { min: 1, max: 4 };
      bounds.drainRowSpacing = { min: 20, max: 6000 };
    }

    const hasFixing = (params.holesFixing ?? 0) !== 0;
    if (hasFixing) {
      const fixingFace = Math.round(params.fixingFace ?? 0);
      const targetFaceFlatW = fixingFace === 0 ? faceBFlatW : faceAFlatW;
      bounds.fixingDiameter = { min: 4.0, max: Math.min(25.0, Math.max(4.0, targetFaceFlatW - 2)) };

      const curFixingDia = Math.max(4.0, Math.min(25.0, params.fixingDiameter ?? 10.0));
      const curFixingQty = Math.max(1, Math.min(10, Math.round(params.fixingQty ?? 2)));
      const isOblong = (params.fixingOblong ?? 0) !== 0;

      const minSlotLen = isOblong ? Math.max(6, Math.ceil(curFixingDia + 2)) : 6;
      const curFixingPitch = Math.max(8, params.fixingPitch ?? 100);

      // Rasgo limitado pelo passo (não colidir) e teto absoluto.
      let maxSlotLen = Math.floor(L - 4);
      if (curFixingQty > 1) maxSlotLen = Math.floor(curFixingPitch - 2);
      maxSlotLen = Math.min(60, Math.max(minSlotLen, maxSlotLen));
      bounds.fixingSlotLength = { min: minSlotLen, max: maxSlotLen };

      const curSlotLen = isOblong ? Math.max(minSlotLen, Math.min(maxSlotLen, params.fixingSlotLength ?? 20)) : curFixingDia;
      const spanY = isOblong ? Math.max(curSlotLen, minSlotLen) : curFixingDia;
      const minFixingMargin = Math.max(10, Math.ceil(spanY / 2));

      const fixingResidual = (L - (curFixingQty - 1) * curFixingPitch) / 2;
      const canBeOblong = fixingResidual >= (curFixingDia + 2) / 2 - 1e-4;
      bounds.fixingOblong = { min: 0, max: canBeOblong ? 1 : 0 };

      // Passo entre centros (driver): mín = vão + folga; máx = cabe com margem residual.
      const minPitch = Math.ceil(spanY + 2);
      let maxPitch = Math.floor(L);
      if (curFixingQty > 1) maxPitch = Math.floor((L - 2 * minFixingMargin) / (curFixingQty - 1));
      bounds.fixingPitch = { min: minPitch, max: Math.max(minPitch, maxPitch) };

      const maxFixingQty = curFixingPitch > 0 ? Math.max(1, Math.min(10, Math.floor(1 + (L - 2 * minFixingMargin) / curFixingPitch))) : 1;
      bounds.fixingQty = { min: 1, max: maxFixingQty };
    } else {
      bounds.fixingDiameter = { min: 4.0, max: 25.0 };
      bounds.fixingQty = { min: 1, max: 10 };
      bounds.fixingPitch = { min: 8, max: 6000 };
      bounds.fixingSlotLength = { min: 6, max: 60 };
    }

    // Refino airtight: bounds de furo (dreno/fixacao) sao acoplados a face e ao
    // comprimento; mover heightA/widthB/length/diametro invalida a furacao vigente.
    // Exclui fixingOblong (flag de modo 0/1, tratado como toggle honesto).
    const gwbKeys = Object.keys(bounds).filter((k) => k !== 'fixingOblong');
    refineAirtight(template, params, features, bounds, gwbKeys);
}

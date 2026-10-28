import { TemplateDefinition, FeatureState } from '../../types/cad';
import { ParamBound, MIN_GAP, refineAirtight } from './core';

export function bounds_profile_u(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const t = Math.max(0.5, params.thickness ?? 3.0);
    const effectiveRi = Math.max(0.2 * t, params.innerRadius ?? 3.0);
    const ro = effectiveRi + t;
    const angle = params.bendAngle ?? 90;
    const alphaRad = (angle * Math.PI) / 180;
    const tanHalf = Math.tan(alphaRad / 2);
    const osb = tanHalf * ro;

    const minFlange = Math.ceil(osb + 0.01);
    let minWeb = Math.ceil(2 * osb + 0.01);

    let maxFlangeA = 1000;
    let maxFlangeC = 1000;

    if (angle > 90) {
      const cosFactor = -Math.cos(alphaRad);
      const minWebForCollision = Math.ceil(2 * minFlange * cosFactor + 2 * t + 0.01);
      minWeb = Math.max(minWeb, minWebForCollision);

      const webVal = Math.max(minWeb, params.flangeB ?? 100);
      const availInside = webVal - 2 * t - 0.05;
      const singleLimit = webVal - t - 0.05;

      const absoluteMaxFlange = Math.floor(Math.min(availInside - minFlange * cosFactor, singleLimit) / cosFactor);

      const fC = Math.max(minFlange, params.flangeC ?? 50);
      const maxAFromC = Math.floor(Math.min(availInside - fC * cosFactor, singleLimit) / cosFactor);
      maxFlangeA = Math.max(minFlange, Math.min(absoluteMaxFlange, maxAFromC));

      const fA = Math.max(minFlange, params.flangeA ?? 50);
      const maxCFromA = Math.floor(Math.min(availInside - fA * cosFactor, singleLimit) / cosFactor);
      maxFlangeC = Math.max(minFlange, Math.min(absoluteMaxFlange, maxCFromA));
    }

    bounds.flangeA = { min: minFlange, max: maxFlangeA };
    bounds.flangeB = { min: minWeb, max: 2000 };
    bounds.flangeC = { min: minFlange, max: maxFlangeC };

    const fA = params.flangeA ?? 50;
    const fB = params.flangeB ?? 100;
    const fC = params.flangeC ?? 50;
    const L = params.lengthL ?? 300;

    const maxOSB = Math.max(0.01, Math.min(fA - 0.01, fC - 0.01, (fB - 0.01) / 2));
    const rawMaxRi = (maxOSB / tanHalf) - t;
    const maxRi = Math.min(30, Math.max(0.5, Math.floor(rawMaxRi * 10) / 10));
    bounds.innerRadius = { min: 0.5, max: Math.max(0.5, maxRi) };

    const riParam = params.innerRadius;
    const rawMaxT = riParam !== undefined
      ? (maxOSB / tanHalf) - Math.max(0.2 * t, riParam)
      : Math.min((maxOSB / tanHalf) / 1.2, (maxOSB / tanHalf) - 0.5);

    let maxT = Math.min(25, Math.max(0.5, Math.floor(rawMaxT * 10) / 10));
    if (angle > 90) {
      const cosFactor = -Math.cos(alphaRad);
      const reachA = fA * cosFactor;
      const reachC = fC * cosFactor;
      const maxTColl = (fB - (reachA + reachC) - 0.05) / 2;
      const maxTSingle = fB - Math.max(reachA, reachC) - 0.05;
      maxT = Math.min(maxT, maxTColl, maxTSingle);
    }
    bounds.thickness = { min: 0.5, max: Math.max(0.5, Math.floor(maxT * 10) / 10) };

    const maxTanHalf = maxOSB / ro;
    let maxAngle = Math.min(150, Math.floor(2 * Math.atan(maxTanHalf) * 180 / Math.PI));

    const availInside = fB - 2 * t - 0.5;
    const singleLimit = fB - t - 0.5;
    const sumFlanges = fA + fC;
    const maxFlange = Math.max(fA, fC);
    const maxCosFactor = Math.min(availInside / sumFlanges, singleLimit / maxFlange);
    if (maxCosFactor <= 0) {
      maxAngle = Math.min(maxAngle, 90);
    } else if (maxCosFactor < 1) {
      const maxAngleColl = Math.floor(Math.acos(-maxCosFactor) * 180 / Math.PI);
      maxAngle = Math.min(maxAngle, maxAngleColl);
    }
    bounds.bendAngle = { min: 30, max: Math.max(30, maxAngle) };

    const fState = features || {};
    const faceHoles = fState.faceHoles?.enabled ? fState.faceHoles.params : null;
    if (faceHoles) {
      const holeType = String(faceHoles.holeType || 'circle');
      const d = Number(faceHoles.diameter || 14);
      const slotLen = Number(faceHoles.slotLength || 28);
      const count = Math.max(1, Math.min(12, Number(faceHoles.count || 1)));

      // diameter max along length
      const maxDia = Math.min(50, Math.max(3, Math.floor(L - 20)));
      bounds['faceHoles.diameter'] = { min: 3, max: maxDia };

      // slotLength max
      if (holeType === 'slot') {
        const maxSlot = Math.min(100, Math.max(10, Math.floor(L - 20)));
        bounds['faceHoles.slotLength'] = { min: Math.ceil(d + 2), max: maxSlot };
      }

      const effD = Math.min(d, maxDia);
      const effSlot = Math.min(slotLen, Math.floor(L - 20));
      const spanY = holeType === 'slot' ? effSlot : effD;

      // count max: profileU clamps stepY to (L - 40)/(count - 1), placing outer holes at +/- (L/2 - 20).
      // If outerReach >= 19.5mm, the hole touches/crosses the boundary at L/2 unless count is 1 (centered).
      const outerReach = holeType === 'slot' ? effSlot / 2 : effD / 2;
      let maxCount = 12;
      if (outerReach >= 19.5) {
        maxCount = 1;
      } else {
        maxCount = Math.min(12, Math.max(1, Math.floor((L - 40) / spanY) + 1));
      }
      bounds['faceHoles.count'] = { min: 1, max: maxCount };

      // spacingX
      if (count > 1) {
        const minSpacing = Math.ceil(spanY + 1);
        bounds['faceHoles.spacingX'] = { min: minSpacing, max: 500 };
      } else {
        bounds['faceHoles.spacingX'] = { min: 10, max: 500 };
      }
    }
    refineAirtight(template, params, features, bounds, Object.keys(bounds));
}

export function bounds_profile_l(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const t = params.thickness ?? 3.0;
    const ri = params.innerRadius ?? 3.0;
    const effectiveRi = Math.max(0.2 * t, ri);
    const ro = effectiveRi + t;
    const angle = params.bendAngle ?? 90;
    const alphaRad = (angle * Math.PI) / 180;
    const tanHalf = Math.tan(alphaRad / 2);
    const osb = tanHalf * ro;
    const minFlange = Math.ceil(osb + 0.01);

    bounds.flangeA = { min: minFlange, max: 1000 };
    bounds.flangeB = { min: minFlange, max: 1000 };

    const fA = Math.max(minFlange, params.flangeA ?? 50);
    const fB = Math.max(minFlange, params.flangeB ?? 50);
    const maxOSB = Math.min(fA, fB) - 0.05;

    const maxRo = maxOSB / Math.max(1e-4, tanHalf);
    const riParam = params.innerRadius;
    const rawMaxT = Math.min(
      maxRo / 1.2,
      riParam !== undefined ? maxRo - riParam : maxRo - 0.5
    );
    const maxT = Math.min(25, Math.max(0.5, Math.floor(rawMaxT * 10) / 10));
    bounds.thickness = { min: 0.5, max: Math.max(0.5, maxT) };

    const maxRi = Math.min(30, Math.max(0.5, Math.floor((maxRo - t) * 10) / 10));
    bounds.innerRadius = { min: 0.5, max: Math.max(0.5, maxRi) };

    const maxTanHalf = maxOSB / Math.max(1e-4, ro);
    const maxAngle = Math.min(150, Math.floor((2 * Math.atan(maxTanHalf) * 180) / Math.PI));
    bounds.bendAngle = { min: 30, max: Math.max(30, maxAngle) };

    const fState = features || {};
    const faceHoles = fState.faceHoles?.enabled ? fState.faceHoles.params : null;
    if (faceHoles) {
      const faceSel = String(faceHoles.faceSelect || 'abaA');
      const holeType = String(faceHoles.holeType || 'circle');
      const d = Number(faceHoles.diameter || 12);
      const slotLen = Number(faceHoles.slotLength || 24);
      const count = Math.max(1, Math.min(12, Number(faceHoles.count || 2)));
      const L = Math.max(20, params.lengthL ?? 250);

      const kFactor = params.kFactor ?? 0.44;
      const ba = alphaRad * (effectiveRi + kFactor * t);
      const targetFlange = faceSel === 'abaB' ? fB : fA;
      const faceBlankW = targetFlange - osb + ba / 2;

      const maxDiaFace = Math.floor(faceBlankW - 10);
      const maxDiaL = Math.floor(L - 20);
      const maxDia = Math.min(50, Math.max(3, Math.min(maxDiaFace, maxDiaL)));
      bounds['faceHoles.diameter'] = { min: 3, max: Math.max(3, maxDia) };

      if (holeType === 'slot') {
        const maxSlotL = Math.floor(L - 20);
        const maxSlot = Math.min(100, Math.max(10, maxSlotL));
        bounds['faceHoles.slotLength'] = { min: Math.min(maxSlot, Math.ceil(d + 2)), max: maxSlot };
      }

      const effD = Math.min(d, maxDia);
      const effSlot = Math.min(slotLen, Math.floor(L - 20));
      const spanY = holeType === 'slot' ? effSlot : effD;

      const outerReach = spanY / 2;
      let maxCount = 12;
      if (outerReach >= 19.5) {
        maxCount = 1;
      } else {
        maxCount = Math.min(12, Math.max(1, Math.floor((L - 40) / spanY) + 1));
      }
      bounds['faceHoles.count'] = { min: 1, max: maxCount };

      if (count > 1) {
        const minSpacing = Math.max(10, Math.ceil(spanY));
        bounds['faceHoles.spacingX'] = { min: minSpacing, max: 500 };
      } else {
        bounds['faceHoles.spacingX'] = { min: 10, max: 500 };
      }
    }
    refineAirtight(template, params, features, bounds, Object.keys(bounds));
}

export function bounds_profile_z(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const t = params.thickness ?? 3.0;
    const ri = params.innerRadius ?? 3.0;
    const effectiveRi = Math.max(0.2 * t, ri);
    const ro = effectiveRi + t;
    const angle = params.bendAngle ?? 90;
    const alphaRad = (angle * Math.PI) / 180;
    const tanHalf = Math.tan(alphaRad / 2);
    const osb = tanHalf * ro;

    const minFlange = Math.ceil(osb + 0.01);
    let minWeb = Math.ceil(2 * osb + 0.01);

    let maxFlangeA = 800;
    let maxFlangeC = 800;

    if (angle > 90) {
      const cosFactor = -Math.cos(alphaRad);
      const minWebForCollision = Math.ceil(minFlange * cosFactor + t + 0.05);
      minWeb = Math.max(minWeb, minWebForCollision);

      const webVal = params.flangeB ?? 120;
      const limitReach = Math.floor((webVal - t - 0.05) / cosFactor);
      maxFlangeA = Math.max(minFlange, limitReach);
      maxFlangeC = Math.max(minFlange, limitReach);
    }

    bounds.flangeA = { min: minFlange, max: maxFlangeA };
    bounds.flangeB = { min: minWeb, max: 1500 };
    bounds.flangeC = { min: minFlange, max: maxFlangeC };

    const fA = params.flangeA ?? 40;
    const fB = params.flangeB ?? 120;
    const fC = params.flangeC ?? 40;
    const L = params.lengthL ?? 350;

    const maxOSB = Math.max(0.01, Math.min(fA - 0.01, fC - 0.01, (fB - 0.01) / 2));
    const rawMaxRi = (maxOSB / tanHalf) - t;
    const maxRi = Math.min(30, Math.max(0.5, Math.floor(rawMaxRi * 10) / 10));
    bounds.innerRadius = { min: 0.5, max: Math.max(0.5, maxRi) };

    const riParam = params.innerRadius;
    const rawMaxT = riParam !== undefined
      ? (maxOSB / tanHalf) - Math.max(0.2 * t, riParam)
      : Math.min((maxOSB / tanHalf) / 1.2, (maxOSB / tanHalf) - 0.5);

    let maxT = Math.min(25, Math.max(0.5, Math.floor(rawMaxT * 10) / 10));
    if (angle > 90) {
      const cosFactor = -Math.cos(alphaRad);
      const maxTSingle = fB - Math.max(fA, fC) * cosFactor - 0.05;
      maxT = Math.min(maxT, maxTSingle);
    }
    bounds.thickness = { min: 0.5, max: Math.max(0.5, Math.floor(maxT * 10) / 10) };

    const maxTanHalf = maxOSB / ro;
    let maxAngle = Math.min(150, Math.floor(2 * Math.atan(maxTanHalf) * 180 / Math.PI));
    const maxFlange = Math.max(fA, fC);
    if (maxFlange > 0) {
      const limitReach = fB - t - 0.05;
      const maxCosFactor = limitReach / maxFlange;
      if (maxCosFactor <= 0) {
        maxAngle = Math.min(maxAngle, 90);
      } else if (maxCosFactor < 1) {
        const maxAngleColl = Math.floor(Math.acos(-maxCosFactor) * 180 / Math.PI);
        maxAngle = Math.min(maxAngle, maxAngleColl);
      }
    }
    bounds.bendAngle = { min: 30, max: Math.max(30, maxAngle) };

    // Face holes
    const fState = features || {};
    const faceHoles = fState.faceHoles?.enabled ? fState.faceHoles.params : null;
    if (faceHoles) {
      const holeType = String(faceHoles.holeType || 'circle');
      const d = Number(faceHoles.diameter || 14);
      const slotLen = Number(faceHoles.slotLength || 28);
      const count = Math.max(1, Math.min(12, Number(faceHoles.count || 1)));

      const maxDia = Math.min(50, Math.max(3, Math.floor(L - 20)));
      bounds['faceHoles.diameter'] = { min: 3, max: maxDia };

      if (holeType === 'slot') {
        const maxSlot = Math.min(100, Math.max(10, Math.floor(L - 20)));
        bounds['faceHoles.slotLength'] = { min: Math.ceil(d + 2), max: maxSlot };
      }

      const effD = Math.min(d, maxDia);
      const effSlot = Math.min(slotLen, Math.floor(L - 20));
      const spanY = holeType === 'slot' ? effSlot : effD;

      const outerReach = holeType === 'slot' ? effSlot / 2 : effD / 2;
      let maxCount = 12;
      if (outerReach >= 19.5) {
        maxCount = 1;
      } else {
        maxCount = Math.min(12, Math.max(1, Math.floor((L - 40) / spanY) + 1));
      }
      bounds['faceHoles.count'] = { min: 1, max: maxCount };

      if (count > 1) {
        const minSpacing = Math.ceil(spanY + 1);
        bounds['faceHoles.spacingX'] = { min: minSpacing, max: 500 };
      } else {
        bounds['faceHoles.spacingX'] = { min: 10, max: 500 };
      }
    }
    refineAirtight(template, params, features, bounds, Object.keys(bounds));
}

export function bounds_profile_hat(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const t = params.thickness ?? 2.0;
    const ri = params.innerRadius ?? 2.0;
    const effectiveRi = ri;
    const ro = effectiveRi + t;
    const osb = ro; // 90 deg

    const minFlange = Math.ceil(osb + 0.01);
    const minWeb = Math.ceil(2 * osb + 0.01);

    bounds.flangeA = { min: minFlange, max: 500 };
    bounds.flangeB = { min: minFlange, max: 800 };
    bounds.flangeC = { min: minWeb, max: 1000 };
    bounds.flangeD = { min: minFlange, max: 800 };
    bounds.flangeE = { min: minFlange, max: 500 };

    const fA = Math.max(minFlange, params.flangeA ?? 25);
    const fB = Math.max(minFlange, params.flangeB ?? 40);
    const fC = Math.max(minWeb, params.flangeC ?? 80);
    const fD = Math.max(minFlange, params.flangeD ?? 40);
    const fE = Math.max(minFlange, params.flangeE ?? 25);

    const maxOSB = Math.min(fA, fB, fD, fE, fC / 2) - 0.05;

    const riParam = params.innerRadius;
    const rawMaxT = Math.min(
      maxOSB / 1.2,
      riParam !== undefined ? maxOSB - riParam : maxOSB - 0.5
    );
    const maxT = Math.min(20, Math.max(0.5, Math.floor(rawMaxT * 10) / 10));
    bounds.thickness = { min: 0.5, max: Math.max(0.5, maxT) };

    const maxRi = Math.min(20, Math.max(0.5, Math.floor((maxOSB - t) * 10) / 10));
    bounds.innerRadius = { min: 0.5, max: Math.max(0.5, maxRi) };

    const fState = features || {};
    const faceHoles = fState.faceHoles?.enabled ? fState.faceHoles.params : null;
    if (faceHoles) {
      const L = params.lengthL ?? 300;
      const faceSel = String(faceHoles.faceSelect || 'alma');
      const holeType = String(faceHoles.holeType || 'circle');
      const d = Number(faceHoles.diameter || 10);
      const slotLen = Number(faceHoles.slotLength || 20);
      const count = Math.max(1, Math.min(12, Number(faceHoles.count || 2)));

      let faceNominal = fC;
      let bendsOnFace = 2;
      if (faceSel === 'abaA' || faceSel === 'abaA1') {
        faceNominal = fA;
        bendsOnFace = 1;
      } else if (faceSel === 'abaB' || faceSel === 'abaB1') {
        faceNominal = fB;
        bendsOnFace = 2;
      } else if (faceSel === 'abaB2' || faceSel === 'abaD') {
        faceNominal = fD;
        bendsOnFace = 2;
      } else if (faceSel === 'abaC' || faceSel === 'abaA2' || faceSel === 'abaE') {
        faceNominal = fE;
        bendsOnFace = 1;
      }

      const kFactor = params.kFactor ?? 0.44;
      const ba = (Math.PI / 2) * (effectiveRi + kFactor * t);
      const faceBlankW = bendsOnFace === 1
        ? faceNominal - osb + ba / 2
        : faceNominal - 2 * osb + ba;

      const maxDiaFace = Math.floor(faceBlankW - 10);
      const maxDiaL = Math.floor(L - 20);
      const maxDia = Math.min(50, Math.max(3, Math.min(maxDiaFace, maxDiaL)));
      bounds['faceHoles.diameter'] = { min: 3, max: Math.max(3, maxDia) };

      if (holeType === 'slot') {
        const maxSlotL = Math.floor(L - 20);
        const maxSlot = Math.min(100, Math.max(10, maxSlotL));
        bounds['faceHoles.slotLength'] = { min: Math.min(maxSlot, Math.ceil(d + 2)), max: maxSlot };
      }

      const effD = Math.min(d, maxDia);
      const effSlot = Math.min(slotLen, Math.floor(L - 20));
      const spanY = holeType === 'slot' ? effSlot : effD;

      const outerReach = spanY / 2;
      let maxCount = 12;
      if (outerReach >= 19.5) {
        maxCount = 1;
      } else {
        maxCount = Math.min(12, Math.max(1, Math.floor((L - 40) / spanY) + 1));
      }
      bounds['faceHoles.count'] = { min: 1, max: maxCount };

      if (count > 1) {
        const minSpacing = Math.max(10, Math.ceil(spanY));
        bounds['faceHoles.spacingX'] = { min: minSpacing, max: 500 };
      } else {
        bounds['faceHoles.spacingX'] = { min: 10, max: 500 };
      }
    }
    refineAirtight(template, params, features, bounds, Object.keys(bounds));
}

export function bounds_lambril_z(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const t = params.thickness ?? 1.2;
    const ri = params.innerRadius ?? 1.2;
    const stepB = params.stepB ?? 20;
    const faceA = params.faceA ?? 95;
    const equalFaces = (params.equalFaces ?? 1) !== 0;
    const faceC = equalFaces ? faceA : (params.faceC ?? 95);
    const lipD = params.lipD ?? 20;
    const L = params.length ?? 2000;

    // 1. Retorno D: limitado à altura do degrau B (rawD <= rawB)
    const maxLipD = Math.min(100, Math.floor(stepB));
    bounds.lipD = {
      min: 5,
      max: maxLipD,
      reason: maxLipD < 100 ? `Retorno D limitado a ${maxLipD} mm pela altura do degrau B` : undefined,
    };

    // 2. Degrau B: mínimo deve comportar duas dobras (2*(Ri+t)) e ser >= lipD
    const minStepB = Math.max(5, Math.ceil(Math.max(2 * (ri + t) + 0.01, lipD)));
    bounds.stepB = {
      min: minStepB,
      max: 150,
      reason: minStepB > 5 ? `Degrau B mínimo (${minStepB} mm) para acomodar retorno D e duas dobras` : undefined,
    };

    // 3. Faces A e C: devem comportar duas dobras
    const minFace = Math.max(15, Math.ceil(2 * (ri + t) + 0.01));
    bounds.faceA = {
      min: minFace,
      max: 600,
      reason: minFace > 15 ? `Face A mínima (${minFace} mm) para acomodar as dobras` : undefined,
    };
    bounds.faceC = {
      min: minFace,
      max: 600,
      reason: minFace > 15 ? `Face C mínima (${minFace} mm) para acomodar as dobras` : undefined,
    };

    // 4. Raio interno: limitado por min(stepB, faceA, faceC)
    const minDim = Math.min(stepB, faceA, faceC);
    const maxRi = Math.min(10, Math.max(0.3, Number((minDim / 2 - t - 0.01).toFixed(1))));
    bounds.innerRadius = {
      min: 0.3,
      max: maxRi,
      reason: maxRi < 10 ? `Raio interno limitado a ${maxRi} mm pelas dobras do degrau/faces` : undefined,
    };

    // 5. Espessura: limitada por min(stepB, faceA, faceC)
    const maxT = Math.min(3.0, Math.max(0.5, Number((minDim / 2 - ri - 0.01).toFixed(1))));
    bounds.thickness = {
      min: 0.5,
      max: maxT,
      reason: maxT < 3.0 ? `Espessura máxima (${maxT} mm) limitada pelo degrau e faces` : undefined,
    };

    bounds.length = { min: 100, max: 6000 };

    // 6. Furações de fixação (holesFixing)
    const holesEnabled = (params.holesFixing ?? 0) !== 0;
    if (!holesEnabled) {
      bounds.holeQty = { min: 1, max: 20 };
      bounds.holeDiameter = { min: 2, max: 15 };
      bounds.holePitch = { min: 8, max: 3000 };
      bounds.slotLength = { min: 4, max: 60 };
    } else {
      const isOblong = (params.oblongHoles ?? 0) !== 0;
      const curQty = Math.max(1, Math.min(20, Math.round(params.holeQty ?? 2)));
      const rawHoleFace = Math.round(params.holeFace ?? 0);
      const activeFaceW = rawHoleFace === 2 ? Math.min(faceA, faceC) : (rawHoleFace === 1 ? faceC : faceA);
      const flatW = Math.max(0, activeFaceW - 2 * (ri + t));
      const maxDiaFace = Math.max(2, Math.min(15, flatW - 3 * t));
      const curPitch = Math.max(8, params.holePitch ?? 200);

      // Diâmetro: limitado pela face, pelo passo (não colidir) e pela margem residual.
      let maxDia = maxDiaFace;
      if (curQty > 1) {
        const maxDiaResidual = Math.floor((L - (curQty - 1) * curPitch) / 2);
        const maxDiaPitch = Math.floor(curPitch - 2);
        maxDia = Math.max(2, Math.min(maxDiaFace, maxDiaResidual, maxDiaPitch));
      }
      bounds.holeDiameter = { min: 2, max: Math.max(2, Math.min(15, maxDia)) };

      const curDia = Math.max(2, Math.min(maxDia, params.holeDiameter ?? 4.8));

      // Rasgo: limitado pelo passo (não colidir) e teto absoluto.
      let maxSlot = Math.floor(L - 4);
      if (curQty > 1) maxSlot = Math.floor(curPitch - 2);
      maxSlot = Math.min(60, Math.max(6, maxSlot));
      const minSlot = Math.min(maxSlot, Math.max(4, Math.ceil(curDia + 2)));
      bounds.slotLength = { min: minSlot, max: maxSlot };

      const curSlot = isOblong ? Math.max(minSlot, Math.min(maxSlot, params.slotLength ?? 12)) : curDia;
      const span = isOblong ? curSlot : curDia;

      // Passo entre centros (driver): mín = vão + folga; máx = cabe com margem residual >= diâmetro.
      const minPitch = Math.ceil(span + 2);
      let maxPitch = Math.floor(L);
      if (curQty > 1) maxPitch = Math.floor((L - 2 * curDia) / (curQty - 1));
      bounds.holePitch = { min: minPitch, max: Math.max(minPitch, maxPitch) };

      // Quantidade: quantos furos cabem dado o passo atual.
      const maxQty = curPitch > 0 ? Math.max(1, Math.min(20, Math.floor(1 + (L - 2 * curDia) / curPitch))) : 1;
      bounds.holeQty = { min: 1, max: maxQty };
    }
    refineAirtight(template, params, features, bounds, Object.keys(bounds));
}

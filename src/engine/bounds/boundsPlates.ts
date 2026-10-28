import { TemplateDefinition, FeatureState } from '../../types/cad';
import { ParamBound, MIN_GAP, refineAirtight } from './core';

export function bounds_rect_plate(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
  const W = params.width ?? 200;
  const H = params.height ?? 150;

  let minW = 20;
  let minH = 20;
  const maxW = 4000;
  const maxH = 2500;

  const fState = features || {};
  
  const filletParams = fState.fillet?.params || {};
  const chamferParams = fState.chamfer?.params || {};
  const cornerParams = fState.cornerHoles?.params || {};
  const centerParams = fState.centerHole?.params || {};
  const slottedParams = fState.slottedHoles?.params || {};
  const boltParams = fState.boltCircle?.params || {};
  const gridParams = fState.gridHoles?.params || {};

  const filletEnabled = Boolean(fState.fillet?.enabled);
  const chamferEnabled = Boolean(fState.chamfer?.enabled);
  const cornerEnabled = Boolean(fState.cornerHoles?.enabled);
  const centerEnabled = Boolean(fState.centerHole?.enabled);
  const slottedEnabled = Boolean(fState.slottedHoles?.enabled);
  const boltEnabled = Boolean(fState.boltCircle?.enabled);
  const gridEnabled = Boolean(fState.gridHoles?.enabled);

  const filletR = Number(filletParams.radius ?? 10);
  const chamferS = Number(chamferParams.size ?? 10);
  const cornerCut = filletR > 0 ? 2 * (filletR * (1 - Math.SQRT1_2) + MIN_GAP) : 2 * MIN_GAP;

  const chD = Number(cornerParams.diameter ?? 12);
  // Furação por entre centros: gaugeX/gaugeY são os parâmetros; a margem (chMx/chMy)
  // é derivada para a matemática interna de limites.
  const chGaugeX = Number(cornerParams.gaugeX ?? Math.max(10, W - 40));
  const chGaugeY = Number(cornerParams.gaugeY ?? Math.max(10, H - 40));
  const chMx = Math.max(0, (W - chGaugeX) / 2);
  const chMy = Math.max(0, (H - chGaugeY) / 2);
  const chR = chD / 2;

  const sW = Number(slottedParams.width ?? 14);
  const sL = Number(slottedParams.length ?? 40);
  const sCount = Math.round(Number(slottedParams.count ?? 4));
  const sPattern = slottedParams.pattern || (sCount === 2 ? 'parallel_2' : sCount === 4 ? 'corners' : 'linear_x');
  const isVert = slottedParams.orientation === 'vertical' || slottedParams.orientation === '1';
  const sDx = isVert ? sW : sL;
  const sDy = isVert ? sL : sW;
  const sSpX = Number(slottedParams.spacingX ?? (W - 2 * (Number(slottedParams.marginX || 25) + sDx / 2)));
  const sSpY = Number(slottedParams.spacingY ?? (H - 2 * (Number(slottedParams.marginY || 25) + sDy / 2)));
  const outerTipX = Math.abs(sSpX) / 2 + sDx / 2;
  const outerTipY = Math.abs(sSpY) / 2 + sDy / 2;

  const gD = Number(gridParams.diameter ?? 10);
  const gCols = Math.max(1, Number(gridParams.cols ?? 2));
  const gRows = Math.max(1, Number(gridParams.rows ?? 2));
  const gPx = Number(gridParams.pitchX ?? 25);
  const gPy = Number(gridParams.pitchY ?? 25);
  const outerGx = ((gCols - 1) * gPx) / 2;
  const outerGy = ((gRows - 1) * gPy) / 2;
  const gR = gD / 2;

  const bcd = Number(boltParams.bcd ?? 150);
  const bcdCount = Math.max(1, Number(boltParams.count ?? 4));
  const bcdHoleD = Number(boltParams.diameter ?? 12);
  const effectiveBcdCount = Math.min(24, bcdCount);
  const cD = Number(centerParams.diameter ?? 50);

  // 1. Fillet & Chamfer bounds
  let maxFillet = Math.max(1, Math.min(150, Math.floor(Math.min(W, H) / 2 - MIN_GAP)));
  const cornerClearanceFillet = Math.min(chMx, chMy) - chR - MIN_GAP;
  if (cornerClearanceFillet < maxFillet && cornerClearanceFillet >= 1) {
    maxFillet = Math.floor(cornerClearanceFillet);
  }
  if (sPattern === 'corners' || sPattern === '4_corners') {
    const slotClearanceX = (W - Math.abs(sSpX) - sDx - 2 * MIN_GAP) / (2 * (1 - Math.SQRT1_2));
    const slotClearanceY = (H - Math.abs(sSpY) - sDy - 2 * MIN_GAP) / (2 * (1 - Math.SQRT1_2));
    const maxFilletFromSlots = Math.floor(Math.min(slotClearanceX, slotClearanceY));
    if (maxFilletFromSlots < maxFillet && maxFilletFromSlots >= 1) {
      maxFillet = maxFilletFromSlots;
    }
  }
  bounds['fillet.radius'] = { min: 1, max: Math.max(1, maxFillet) };
  bounds.filletRadius = bounds['fillet.radius'];

  let maxChamfer = Math.max(1, Math.min(150, Math.floor(Math.min(W, H) / 2 - MIN_GAP)));
  const chamferClearanceCorner = chMx + chMy - (chR + MIN_GAP) * Math.SQRT2;
  if (chamferClearanceCorner < maxChamfer && chamferClearanceCorner >= 1) {
    maxChamfer = Math.floor(chamferClearanceCorner);
  }
  const gridClearance = (W + H) / 2 - (outerGx + outerGy + (gR + MIN_GAP) * Math.SQRT2);
  if (gridClearance < maxChamfer && gridClearance >= 1) {
    maxChamfer = Math.floor(gridClearance);
  }
  const bcdClearance = ((W + H) - (bcd + bcdHoleD + 2 * MIN_GAP) * Math.SQRT2) / 2;
  if (bcdClearance < maxChamfer && bcdClearance >= 1) {
    maxChamfer = Math.floor(bcdClearance);
  }
  if (sPattern === 'corners' || sPattern === '4_corners') {
    const slotClearance = (W + H) / 2 - (outerTipX + outerTipY + MIN_GAP);
    if (slotClearance < maxChamfer && slotClearance >= 1) {
      maxChamfer = Math.floor(slotClearance);
    }
  }
  bounds['chamfer.size'] = { min: 1, max: Math.max(1, maxChamfer) };
  bounds.chamferSize = bounds['chamfer.size'];

  // Minimos de W e H exigidos por fillet e chamfer
  if (filletEnabled) {
    minW = Math.max(minW, Math.ceil(2 * (filletR + MIN_GAP)));
    minH = Math.max(minH, Math.ceil(2 * (filletR + MIN_GAP)));
  }
  if (chamferEnabled) {
    minW = Math.max(minW, Math.ceil(2 * (chamferS + MIN_GAP)));
    minH = Math.max(minH, Math.ceil(2 * (chamferS + MIN_GAP)));
  }

  // 2. Corner Holes limits
  let minMarginX = Math.max(5, Math.ceil(chR + MIN_GAP));
  let minMarginY = Math.max(5, Math.ceil(chR + MIN_GAP));

  if (filletR > 0) {
    minMarginX = Math.max(minMarginX, Math.ceil(filletR + MIN_GAP));
    minMarginY = Math.max(minMarginY, Math.ceil(filletR + MIN_GAP));
  }
  if (chamferS > 0) {
    const minMxFromChamfer = Math.ceil(chamferS + (chR + MIN_GAP) * Math.SQRT2 - chMy);
    minMarginX = Math.max(minMarginX, minMxFromChamfer);
    const minMyFromChamfer = Math.ceil(chamferS + (chR + MIN_GAP) * Math.SQRT2 - chMx);
    minMarginY = Math.max(minMarginY, minMyFromChamfer);
  }

  let maxMarginX = Math.min(200, Math.floor(W / 2 - chR - MIN_GAP));
  let maxMarginY = Math.min(200, Math.floor(H / 2 - chR - MIN_GAP));

  const reqDistCenter = (cD + chD) / 2 + MIN_GAP;
  if (reqDistCenter > Math.abs(H / 2 - chMy)) {
    const minSepX = Math.sqrt(Math.max(0, reqDistCenter * reqDistCenter - (H / 2 - chMy) * (H / 2 - chMy)));
    maxMarginX = Math.min(maxMarginX, Math.floor(W / 2 - minSepX));
  }
  if (reqDistCenter > Math.abs(W / 2 - chMx)) {
    const minSepY = Math.sqrt(Math.max(0, reqDistCenter * reqDistCenter - (W / 2 - chMx) * (W / 2 - chMx)));
    maxMarginY = Math.min(maxMarginY, Math.floor(H / 2 - minSepY));
  }

  const reqBcdDist = (bcd + bcdHoleD + chD) / 2 + MIN_GAP;
  if (reqBcdDist > Math.abs(H / 2 - chMy)) {
    const minSepX = Math.sqrt(Math.max(0, reqBcdDist * reqBcdDist - (H / 2 - chMy) * (H / 2 - chMy)));
    maxMarginX = Math.min(maxMarginX, Math.floor(W / 2 - minSepX));
  }
  if (reqBcdDist > Math.abs(W / 2 - chMx)) {
    const minSepY = Math.sqrt(Math.max(0, reqBcdDist * reqBcdDist - (W / 2 - chMx) * (W / 2 - chMx)));
    maxMarginY = Math.min(maxMarginY, Math.floor(H / 2 - minSepY));
  }

  maxMarginX = Math.max(minMarginX, maxMarginX);
  maxMarginY = Math.max(minMarginY, maxMarginY);

  // Saída em entre-centros: gauge = dimensão - 2*margem (margem maior => gauge menor).
  bounds['cornerHoles.gaugeX'] = {
    min: Math.max(1, Math.floor(W - 2 * maxMarginX)),
    max: Math.max(1, Math.ceil(W - 2 * minMarginX)),
  };
  bounds['cornerHoles.gaugeY'] = {
    min: Math.max(1, Math.floor(H - 2 * maxMarginY)),
    max: Math.max(1, Math.ceil(H - 2 * minMarginY)),
  };

  // Diameter limits
  let maxChD = Math.min(100, Math.floor(Math.min(W, H) / 3));
  const maxDFromMx = Math.floor(2 * (chMx - MIN_GAP));
  const maxDFromMy = Math.floor(2 * (chMy - MIN_GAP));
  const maxDFromCenterW = Math.floor(2 * (W / 2 - chMx - MIN_GAP));
  const maxDFromCenterH = Math.floor(2 * (H / 2 - chMy - MIN_GAP));
  let marginDLimit = Math.min(maxDFromMx, maxDFromMy, maxDFromCenterW, maxDFromCenterH);

  if (chamferS > 0) {
    const maxDFromChamfer = Math.floor(2 * ((chMx + chMy - chamferS) / Math.SQRT2 - MIN_GAP));
    if (maxDFromChamfer < marginDLimit) marginDLimit = maxDFromChamfer;
  }
  if (filletR > 0 && chMx < filletR + MIN_GAP && chMy < filletR + MIN_GAP) {
    const distArc = Math.hypot(filletR - chMx, filletR - chMy);
    const maxDFillet = Math.floor(2 * (filletR - distArc - MIN_GAP));
    if (maxDFillet < marginDLimit) marginDLimit = maxDFillet;
  }

  maxChD = Math.min(maxChD, marginDLimit);

  const distToCenter = Math.hypot(W / 2 - chMx, H / 2 - chMy);
  const maxDFromCenter = Math.floor(2 * (distToCenter - cD / 2 - MIN_GAP));
  if (maxDFromCenter < maxChD) maxChD = maxDFromCenter;

  const maxDFromBcd = Math.floor(2 * (distToCenter - bcd / 2 - bcdHoleD / 2 - MIN_GAP));
  if (maxDFromBcd < maxChD) maxChD = maxDFromBcd;

  bounds['cornerHoles.diameter'] = { min: 2, max: Math.max(2, maxChD) };

  // Minimos de W e H exigidos por cornerHoles (expresso em entre-centros):
  // a dimensão deve comportar o gauge mais a parede mínima dos dois lados.
  if (cornerEnabled) {
    minW = Math.max(minW, Math.ceil(chGaugeX + 2 * (chR + MIN_GAP)));
    minH = Math.max(minH, Math.ceil(chGaugeY + 2 * (chR + MIN_GAP)));

    // Nota: com furação por entre centros o furo de canto fica fixo pelo gauge
    // (não se move com W/H), então a folga vs furo central/BCD é garantida pelos
    // tetos de diâmetro desses furos (que já usam a distância ao canto via gauge),
    // e não por mínimos de W/H. O refino airtight ao final sela qualquer resíduo.
  }

  // 3. Center Hole limits
  let maxCenterD = Math.min(1000, Math.floor(Math.min(W, H) - 2 * MIN_GAP));
  const maxDFromCornerCenter = Math.floor(2 * (distToCenter - chD / 2 - MIN_GAP));
  if (maxDFromCornerCenter < maxCenterD) maxCenterD = maxDFromCornerCenter;

  const maxDFromBcdCenter = Math.floor(bcd - bcdHoleD - 2 * MIN_GAP);
  if (maxDFromBcdCenter < maxCenterD) maxCenterD = maxDFromBcdCenter;

  if (sPattern === 'corners' || sPattern === '4_corners') {
    const halfSx = Math.abs(sSpX) / 2;
    const halfSy = Math.abs(sSpY) / 2;
    const distToSlotCenter = Math.hypot(halfSx, halfSy);
    const slotHalfDiag = Math.hypot(sDx / 2, sDy / 2);
    const maxFromSlot = Math.floor(2 * (distToSlotCenter - slotHalfDiag - MIN_GAP));
    if (maxFromSlot < maxCenterD) maxCenterD = maxFromSlot;
  }
  const otherHolesAreaCenter = (cornerEnabled ? 4 * Math.PI * (chD / 2) ** 2 : 0) +
    (boltEnabled ? Math.min(24, bcdCount) * Math.PI * (bcdHoleD / 2) ** 2 : 0) +
    (gridEnabled ? gCols * gRows * Math.PI * (gD / 2) ** 2 : 0) +
    (slottedEnabled ? sCount * ((sL - sW) * sW + Math.PI * (sW / 2) ** 2) : 0);
  const maxCenterArea = Math.max(0, W * H - otherHolesAreaCenter - 200);
  const maxCenterDByArea = Math.floor(2 * Math.sqrt(maxCenterArea / Math.PI));
  if (maxCenterDByArea < maxCenterD) maxCenterD = Math.max(2, maxCenterDByArea);
  bounds['centerHole.diameter'] = { min: 2, max: Math.max(2, maxCenterD) };

  if (centerEnabled) {
    minW = Math.max(minW, Math.ceil(cD + 2 * MIN_GAP));
    minH = Math.max(minH, Math.ceil(cD + 2 * MIN_GAP));
  }

  // 4. Bolt Circle limits
  const currentBcd = bcd;

  // BCD count max
  let maxBcdCount = 24;
  const chordRequired = bcdHoleD + MIN_GAP;
  if (chordRequired > currentBcd) {
    maxBcdCount = 1;
  } else {
    const sinArgCount = chordRequired / currentBcd;
    if (sinArgCount >= 1) maxBcdCount = 2;
    else maxBcdCount = Math.min(24, Math.max(1, Math.floor(Math.PI / Math.asin(sinArgCount))));
  }
  bounds['boltCircle.count'] = { min: 1, max: maxBcdCount };
  bounds['boltCircle.startAngle'] = { min: 0, max: 360 };

  // BCD Hole Diameter max
  let maxBcdHoleD = Math.min(100, Math.floor(Math.min(W, H) - currentBcd - 2 * MIN_GAP));
  maxBcdHoleD = Math.min(maxBcdHoleD, Math.floor(currentBcd - cD - 2 * MIN_GAP));

  if (effectiveBcdCount > 1) {
    const chord = currentBcd * Math.sin(Math.PI / effectiveBcdCount);
    maxBcdHoleD = Math.min(maxBcdHoleD, Math.floor(chord - MIN_GAP));
  }
  maxBcdHoleD = Math.min(maxBcdHoleD, Math.floor(2 * (distToCenter - currentBcd / 2 - chD / 2 - MIN_GAP)));

  const otherHolesAreaBcd = (centerEnabled ? Math.PI * (cD / 2) ** 2 : 0) +
    (cornerEnabled ? 4 * Math.PI * (chD / 2) ** 2 : 0) +
    (gridEnabled ? gCols * gRows * Math.PI * (gD / 2) ** 2 : 0) +
    (slottedEnabled ? sCount * ((sL - sW) * sW + Math.PI * (sW / 2) ** 2) : 0);
  const maxBcdAreaAvailable = Math.max(0, W * H - otherHolesAreaBcd - 200);
  const maxBcdDByArea = Math.floor(2 * Math.sqrt(maxBcdAreaAvailable / (effectiveBcdCount * Math.PI)));
  if (maxBcdDByArea < maxBcdHoleD) maxBcdHoleD = Math.max(3, maxBcdDByArea);
  bounds['boltCircle.diameter'] = { min: 3, max: Math.max(3, maxBcdHoleD) };

  // BCD limits
  let minBcd = 20;
  minBcd = Math.max(minBcd, Math.ceil(cD + bcdHoleD + 2 * MIN_GAP));
  if (effectiveBcdCount > 1) {
    const minChordBcd = Math.ceil((bcdHoleD + MIN_GAP) / Math.sin(Math.PI / effectiveBcdCount));
    minBcd = Math.max(minBcd, minChordBcd);
  }

  let maxBcd = Math.min(2800, Math.floor(Math.min(W, H) - bcdHoleD - 2 * MIN_GAP));
  if (chamferS > 0) {
    const maxBcdChamfer = Math.floor((W + H - 2 * chamferS - (bcdHoleD + 2 * MIN_GAP) * Math.SQRT2) * Math.SQRT1_2);
    maxBcd = Math.min(maxBcd, maxBcdChamfer);
  }
  const maxBcdFromCorner = Math.floor(2 * (distToCenter - chD / 2 - bcdHoleD / 2 - MIN_GAP));
  maxBcd = Math.min(maxBcd, maxBcdFromCorner);

  bounds['boltCircle.bcd'] = { min: minBcd, max: Math.max(minBcd, maxBcd) };

  if (boltEnabled) {
    minW = Math.max(minW, Math.ceil(currentBcd + bcdHoleD + 2 * MIN_GAP));
    minH = Math.max(minH, Math.ceil(currentBcd + bcdHoleD + 2 * MIN_GAP));
    if (chamferEnabled && chamferS > 0) {
      const diagReq = (currentBcd + bcdHoleD + 2 * MIN_GAP) * Math.SQRT2 + 2 * chamferS;
      minW = Math.max(minW, Math.ceil(diagReq - H));
      minH = Math.max(minH, Math.ceil(diagReq - W));
    }
  }

  // 5. Slotted Holes limits
  const sRowsCount = sPattern === 'grid' ? Math.max(1, Math.min(4, Math.round(Math.sqrt(sCount)))) * Math.max(1, Math.min(4, Math.ceil(sCount / Math.max(1, Math.min(4, Math.round(Math.sqrt(sCount))))))) : (sPattern === 'corners' || sPattern === '4_corners' ? 4 : (sPattern === 'parallel_2' ? 2 : sCount));
  const plateGrossArea = W * H - (filletEnabled ? (4 - Math.PI) * filletR ** 2 : 0) - (chamferEnabled ? 2 * chamferS ** 2 : 0);
  let otherHolesArea = 0;
  if (centerEnabled) otherHolesArea += Math.PI * (cD / 2) ** 2;
  if (cornerEnabled) otherHolesArea += 4 * Math.PI * (chD / 2) ** 2;
  if (boltEnabled) otherHolesArea += effectiveBcdCount * Math.PI * (bcdHoleD / 2) ** 2;
  if (gridEnabled) otherHolesArea += gCols * gRows * Math.PI * (gD / 2) ** 2;
  const availSlotArea = Math.max(0, plateGrossArea - otherHolesArea - 200);

  let maxSlotW = Math.min(150, Math.floor(Math.min(W, H) / 2 - MIN_GAP));
  if (sPattern === 'corners' || sPattern === '4_corners') {
    const wLimitX = isVert ? (W - 3 * MIN_GAP) / 2 : W - 2 * MIN_GAP;
    const wLimitY = isVert ? H - 2 * MIN_GAP : (H - 3 * MIN_GAP) / 2;
    maxSlotW = Math.min(150, Math.max(3, Math.floor(Math.min(wLimitX, wLimitY))));
  } else if (sPattern === 'parallel_2') {
    if (isVert) maxSlotW = Math.min(150, Math.max(3, Math.floor((W - 3 * MIN_GAP) / 2)));
    else maxSlotW = Math.min(150, Math.max(3, Math.floor((H - 3 * MIN_GAP) / 2)));
  }
  if (sL > 0) maxSlotW = Math.min(maxSlotW, sL);
  if (sRowsCount > 0 && sL > 0) {
    const maxAreaPerSlot = availSlotArea / sRowsCount;
    const maxWByArea = Math.floor(maxAreaPerSlot / sL);
    maxSlotW = Math.min(maxSlotW, Math.max(3, maxWByArea));
  }
  bounds['slottedHoles.width'] = { min: 3, max: Math.max(3, maxSlotW) };

  // Slot Length max
  const plateLimitForSlot = isVert ? H : W;
  let maxSlotL = Math.min(1000, Math.floor(plateLimitForSlot - 2 * MIN_GAP));
  if (sPattern === 'corners' || sPattern === '4_corners') {
    const dimL = isVert ? H : W;
    let limitL = Math.floor((dimL - 3 * MIN_GAP) / 2);
    const relevantSp = Math.abs(isVert ? sSpY : sSpX);
    const perpSp = Math.abs(isVert ? sSpX : sSpY);
    if (relevantSp > 0) limitL = Math.min(limitL, Math.floor(dimL - relevantSp - 2 * MIN_GAP));
    if (chamferS > 0) {
      const chamferLimit = Math.floor(W + H - 2 * chamferS - 2 * MIN_GAP - perpSp - sW - relevantSp);
      limitL = Math.min(limitL, chamferLimit);
    }
    if (filletR > 0) {
      const filletLimit = Math.floor(dimL - relevantSp - cornerCut);
      limitL = Math.min(limitL, filletLimit);
    }
    maxSlotL = Math.min(1000, Math.max(sW, limitL));
  } else if (sPattern === 'parallel_2') {
    maxSlotL = Math.min(1000, Math.floor((isVert ? H : W) - 2 * MIN_GAP));
  } else if (sPattern === 'linear_x') {
    const safeCount = Math.max(1, sCount);
    maxSlotL = !isVert ? Math.min(1000, Math.floor((W - (safeCount + 1) * MIN_GAP) / safeCount)) : Math.min(1000, Math.floor(H - 2 * MIN_GAP));
  } else if (sPattern === 'linear_y') {
    const safeCount = Math.max(1, sCount);
    maxSlotL = isVert ? Math.min(1000, Math.floor((H - (safeCount + 1) * MIN_GAP) / safeCount)) : Math.min(1000, Math.floor(W - 2 * MIN_GAP));
  } else if (sPattern === 'grid') {
    const rows = Math.max(1, Math.min(4, Math.round(Math.sqrt(sCount))));
    const cols = Math.max(1, Math.min(4, Math.ceil(sCount / rows)));
    maxSlotL = isVert ? Math.min(1000, Math.floor((H - (rows + 1) * MIN_GAP) / rows)) : Math.min(1000, Math.floor((W - (cols + 1) * MIN_GAP) / cols));
  }
  if (sRowsCount > 0 && sW > 0) {
    const maxAreaPerSlot = availSlotArea / sRowsCount;
    const maxLByArea = Math.floor((maxAreaPerSlot + sW * sW * (1 - Math.PI / 4)) / sW);
    maxSlotL = Math.min(maxSlotL, Math.max(sW, maxLByArea));
  }
  bounds['slottedHoles.length'] = { min: Math.min(maxSlotL, Math.max(5, sW)), max: Math.max(sW, maxSlotL) };

  // Slot spacing X and Y
  const effectiveSlotL = Math.min(sL, bounds['slottedHoles.length'].max);
  const effectiveSlotW = Math.min(sW, bounds['slottedHoles.width'].max);
  const effDx = isVert ? effectiveSlotW : effectiveSlotL;
  const effDy = isVert ? effectiveSlotL : effectiveSlotW;

  let minSpX = Math.ceil(effDx + 2 * MIN_GAP);
  let maxSpX = Math.min(2000, Math.max(minSpX, Math.floor(W - effDx - 2 * MIN_GAP)));
  let minSpY = Math.ceil(effDy + 2 * MIN_GAP);
  let maxSpY = Math.min(2000, Math.max(minSpY, Math.floor(H - effDy - 2 * MIN_GAP)));

  if (sPattern === 'corners' || sPattern === '4_corners') {
    if (chamferS > 0) {
      const curSpY = Math.max(minSpY, Number(slottedParams.spacingY ?? minSpY));
      const curSpX = Math.max(minSpX, Number(slottedParams.spacingX ?? minSpX));
      maxSpX = Math.min(maxSpX, Math.max(minSpX, Math.floor(W + H - 2 * chamferS - 2 * MIN_GAP - effDx - effDy - curSpY)));
      maxSpY = Math.min(maxSpY, Math.max(minSpY, Math.floor(W + H - 2 * chamferS - 2 * MIN_GAP - effDx - effDy - curSpX)));
    }
    if (filletR > 0) {
      maxSpX = Math.min(maxSpX, Math.max(minSpX, Math.floor(W - effDx - cornerCut)));
      maxSpY = Math.min(maxSpY, Math.max(minSpY, Math.floor(H - effDy - cornerCut)));
    }
  } else if (sPattern === 'parallel_2') {
    if (!isVert) { minSpX = 0; maxSpX = 0; maxSpY = Math.min(2000, Math.max(minSpY, Math.floor(H - effDy - 2 * MIN_GAP))); }
    else { minSpY = 0; maxSpY = 0; maxSpX = Math.min(2000, Math.max(minSpX, Math.floor(W - effDx - 2 * MIN_GAP))); }
  } else if (sPattern === 'linear_x') {
    minSpX = Math.ceil((Math.max(1, sCount) - 1) * (effDx + MIN_GAP));
    maxSpX = Math.min(2000, Math.max(minSpX, Math.floor(W - effDx - 2 * MIN_GAP)));
    minSpY = 0; maxSpY = 0;
  } else if (sPattern === 'linear_y') {
    minSpY = Math.ceil((Math.max(1, sCount) - 1) * (effDy + MIN_GAP));
    maxSpY = Math.min(2000, Math.max(minSpY, Math.floor(H - effDy - 2 * MIN_GAP)));
    minSpX = 0; maxSpX = 0;
  } else if (sPattern === 'grid') {
    const rows = Math.max(1, Math.min(4, Math.round(Math.sqrt(sCount))));
    const cols = Math.max(1, Math.min(4, Math.ceil(sCount / rows)));
    minSpX = Math.ceil((cols - 1) * (effDx + MIN_GAP));
    maxSpX = Math.min(2000, Math.max(minSpX, Math.floor(W - effDx - 2 * MIN_GAP)));
    minSpY = Math.ceil((rows - 1) * (effDy + MIN_GAP));
    maxSpY = Math.min(2000, Math.max(minSpY, Math.floor(H - effDy - 2 * MIN_GAP)));
  }

  bounds['slottedHoles.spacingX'] = { min: minSpX, max: Math.max(minSpX, maxSpX) };
  bounds['slottedHoles.spacingY'] = { min: minSpY, max: Math.max(minSpY, maxSpY) };

  bounds['slottedHoles.marginX'] = { min: MIN_GAP, max: Math.max(MIN_GAP, Math.floor((W - effDx - 2 * MIN_GAP) / 2)) };
  bounds['slottedHoles.marginY'] = { min: MIN_GAP, max: Math.max(MIN_GAP, Math.floor((H - effDy - 2 * MIN_GAP) / 2)) };

  let maxSlotCount = 12;
  if (sPattern === 'corners' || sPattern === '4_corners') maxSlotCount = 4;
  else if (sPattern === 'parallel_2') maxSlotCount = 2;
  else if (sPattern === 'linear_x') maxSlotCount = Math.min(12, Math.max(1, Math.floor((W - MIN_GAP) / (effDx + MIN_GAP))));
  else if (sPattern === 'linear_y') maxSlotCount = Math.min(12, Math.max(1, Math.floor((H - MIN_GAP) / (effDy + MIN_GAP))));

  const curSlotArea = Math.max(1, (effectiveSlotL - effectiveSlotW) * effectiveSlotW + Math.PI * (effectiveSlotW / 2) ** 2);
  const maxSlotsByArea = Math.floor(availSlotArea / curSlotArea);
  if (sPattern === 'grid') {
    let maxGridCount = 1;
    for (let c = 1; c <= 16; c++) {
      const r = Math.max(1, Math.min(4, Math.round(Math.sqrt(c))));
      const cl = Math.max(1, Math.min(4, Math.ceil(c / r)));
      if (r * cl <= maxSlotsByArea) maxGridCount = c;
    }
    maxSlotCount = Math.min(maxSlotCount, maxGridCount);
  } else {
    maxSlotCount = Math.min(maxSlotCount, Math.max(1, maxSlotsByArea));
  }
  bounds['slottedHoles.count'] = { min: 1, max: Math.max(1, maxSlotCount) };

  // Minimos de W e H exigidos por slottedHoles
  if (slottedEnabled) {
    const spXVal = Math.abs(Number(slottedParams.spacingX ?? minSpX));
    const spYVal = Math.abs(Number(slottedParams.spacingY ?? minSpY));
    if (sPattern === 'corners' || sPattern === '4_corners') {
      minW = Math.max(minW, Math.ceil(spXVal + effDx + 2 * MIN_GAP));
      minH = Math.max(minH, Math.ceil(spYVal + effDy + 2 * MIN_GAP));
      if (chamferEnabled && chamferS > 0) {
        const diagReq = spXVal + spYVal + effDx + effDy + 2 * chamferS + 2 * MIN_GAP;
        minW = Math.max(minW, Math.ceil(diagReq - H));
        minH = Math.max(minH, Math.ceil(diagReq - W));
      }
      if (filletEnabled && filletR > 0) {
        minW = Math.max(minW, Math.ceil(spXVal + effDx + cornerCut));
        minH = Math.max(minH, Math.ceil(spYVal + effDy + cornerCut));
      }
    } else if (sPattern === 'parallel_2') {
      if (isVert) {
        minW = Math.max(minW, Math.ceil(spXVal + effDx + 2 * MIN_GAP));
        minH = Math.max(minH, Math.ceil(effDy + 2 * MIN_GAP));
      } else {
        minH = Math.max(minH, Math.ceil(spYVal + effDy + 2 * MIN_GAP));
        minW = Math.max(minW, Math.ceil(effDx + 2 * MIN_GAP));
      }
    } else if (sPattern === 'linear_x') {
      minW = Math.max(minW, Math.ceil(spXVal + effDx + 2 * MIN_GAP));
      minH = Math.max(minH, Math.ceil(effDy + 2 * MIN_GAP));
    } else if (sPattern === 'linear_y') {
      minH = Math.max(minH, Math.ceil(spYVal + effDy + 2 * MIN_GAP));
      minW = Math.max(minW, Math.ceil(effDx + 2 * MIN_GAP));
    } else if (sPattern === 'grid') {
      minW = Math.max(minW, Math.ceil(spXVal + effDx + 2 * MIN_GAP));
      minH = Math.max(minH, Math.ceil(spYVal + effDy + 2 * MIN_GAP));
    }
  }

  // 6. Grid Holes limits
  let maxGridD = Math.min(50, Math.max(3, Math.floor(Math.min(gPx - MIN_GAP, gPy - MIN_GAP, Math.min(W, H) / 4))));
  if (chamferS > 0) {
    const maxDChamfer = Math.floor(W + H - 2 * chamferS - 2 * MIN_GAP - (gCols - 1) * gPx - (gRows - 1) * gPy);
    maxGridD = Math.min(maxGridD, Math.max(3, maxDChamfer));
  }
  const otherHolesAreaGrid = (centerEnabled ? Math.PI * (cD / 2) ** 2 : 0) +
    (cornerEnabled ? 4 * Math.PI * (chD / 2) ** 2 : 0) +
    (boltEnabled ? effectiveBcdCount * Math.PI * (bcdHoleD / 2) ** 2 : 0) +
    (slottedEnabled ? sCount * ((sL - sW) * sW + Math.PI * (sW / 2) ** 2) : 0);
  const maxGridAreaAvailable = Math.max(0, W * H - otherHolesAreaGrid - 200);
  const maxGridDByArea = Math.floor(2 * Math.sqrt(maxGridAreaAvailable / (gCols * gRows * Math.PI)));
  if (maxGridDByArea < maxGridD) maxGridD = Math.max(3, maxGridDByArea);
  bounds['gridHoles.diameter'] = { min: 3, max: maxGridD };

  const minPitchX = Math.ceil(gD + MIN_GAP);
  let maxPitchX = gCols > 1 ? Math.min(100, Math.max(minPitchX, Math.floor((W - gD - 2 * MIN_GAP) / (gCols - 1)))) : 100;
  if (gCols > 1 && chamferS > 0) {
    const chamferMaxPitchX = Math.floor((W + H - 2 * chamferS - (gD + 2 * MIN_GAP) * Math.SQRT2 - (gRows - 1) * gPy) / (gCols - 1));
    maxPitchX = Math.min(maxPitchX, Math.max(minPitchX, chamferMaxPitchX));
  }
  if (gCols > 1 && filletR > 0) {
    const filletMaxPitchX = Math.floor((W - gD - cornerCut) / (gCols - 1));
    maxPitchX = Math.min(maxPitchX, Math.max(minPitchX, filletMaxPitchX));
  }
  bounds['gridHoles.pitchX'] = { min: minPitchX, max: maxPitchX };

  const minPitchY = Math.ceil(gD + MIN_GAP);
  let maxPitchY = gRows > 1 ? Math.min(100, Math.max(minPitchY, Math.floor((H - gD - 2 * MIN_GAP) / (gRows - 1)))) : 100;
  if (gRows > 1 && chamferS > 0) {
    const chamferMaxPitchY = Math.floor((W + H - 2 * chamferS - (gD + 2 * MIN_GAP) * Math.SQRT2 - (gCols - 1) * gPx) / (gRows - 1));
    maxPitchY = Math.min(maxPitchY, Math.max(minPitchY, chamferMaxPitchY));
  }
  if (gRows > 1 && filletR > 0) {
    const filletMaxPitchY = Math.floor((H - gD - cornerCut) / (gRows - 1));
    maxPitchY = Math.min(maxPitchY, Math.max(minPitchY, filletMaxPitchY));
  }
  bounds['gridHoles.pitchY'] = { min: minPitchY, max: maxPitchY };

  let maxCols = Math.min(10, Math.max(1, Math.floor((W - gD - 2 * MIN_GAP) / Math.max(1, gPx)) + 1));
  let maxRows = Math.min(10, Math.max(1, Math.floor((H - gD - 2 * MIN_GAP) / Math.max(1, gPy)) + 1));
  if (chamferS > 0) {
    const chamferCols = Math.floor((W + H - 2 * chamferS - (gD + 2 * MIN_GAP) * Math.SQRT2 - (gRows - 1) * gPy) / Math.max(1, gPx)) + 1;
    maxCols = Math.min(maxCols, Math.max(1, chamferCols));
    const chamferRows = Math.floor((W + H - 2 * chamferS - (gD + 2 * MIN_GAP) * Math.SQRT2 - (gCols - 1) * gPx) / Math.max(1, gPy)) + 1;
    maxRows = Math.min(maxRows, Math.max(1, chamferRows));
  }
  bounds['gridHoles.cols'] = { min: 1, max: maxCols };
  bounds['gridHoles.rows'] = { min: 1, max: maxRows };

  if (gridEnabled) {
    minW = Math.max(minW, Math.ceil((gCols - 1) * gPx + gD + 2 * MIN_GAP));
    minH = Math.max(minH, Math.ceil((gRows - 1) * gPy + gD + 2 * MIN_GAP));
    if (chamferEnabled && chamferS > 0) {
      const diagReq = (gCols - 1) * gPx + (gRows - 1) * gPy + 2 * chamferS + (gD + 2 * MIN_GAP) * Math.SQRT2;
      minW = Math.max(minW, Math.ceil(diagReq - H));
      minH = Math.max(minH, Math.ceil(diagReq - W));
    }
  }

  // 7. Area liquida positiva
  let totalHoleArea = 0;
  if (centerEnabled) totalHoleArea += Math.PI * (cD / 2) ** 2;
  if (cornerEnabled) totalHoleArea += 4 * Math.PI * (chD / 2) ** 2;
  if (boltEnabled) totalHoleArea += effectiveBcdCount * Math.PI * (bcdHoleD / 2) ** 2;
  if (gridEnabled) totalHoleArea += gCols * gRows * Math.PI * (gD / 2) ** 2;
  if (slottedEnabled) totalHoleArea += sCount * ((effectiveSlotL - effectiveSlotW) * effectiveSlotW + Math.PI * (effectiveSlotW / 2) ** 2);

  const cornerLoss = (filletEnabled ? (4 - Math.PI) * filletR ** 2 : 0) + (chamferEnabled ? 2 * chamferS ** 2 : 0);
  if (totalHoleArea > 0 || cornerLoss > 0) {
    const minArea = totalHoleArea + cornerLoss + 200;
    minW = Math.max(minW, Math.ceil(minArea / Math.max(20, H)));
    minH = Math.max(minH, Math.ceil(minArea / Math.max(20, W)));
  }

  bounds.width = { min: minW, max: maxW };
  bounds.height = { min: minH, max: maxH };
  bounds.thickness = { min: 0.5, max: 50 };

  // ------------------------------------------------------------------
  // Refinamento airtight por geometria real (apenas quando slottedHoles
  // esta ligado, que e o unico cenario que ainda vazava). Para cada campo
  // editavel, restringe o bound ao MAIOR intervalo contiguo de validade que
  // CONTEM o valor atual, amostrando a geometria real (o proprio validador).
  // Robusto a nao monotonicidade e a parametros onde o valor baixo e o pior
  // (margem/espacamento empurrando o rasgo para fora), porque trabalha com a
  // ilha de validade em torno do valor corrente, e nao assumindo ordenacao.
  // So altera bounds para dentro (nunca afrouxa).
  // ------------------------------------------------------------------
  // Refino airtight por geometria real quando ha rasgos oblongos (o unico cenario
  // que ainda vazava analiticamente). Usa o helper unico refineAirtight, apenas nas
  // chaves das features ATIVAS (o helper liga a feature da chave pontilhada durante
  // o teste, entao refinar uma feature desligada testaria geometria errada).
  if (slottedEnabled) {
    const rpKeys: string[] = ['width', 'height'];
    if (centerEnabled) rpKeys.push('centerHole.diameter');
    rpKeys.push(
      'slottedHoles.length', 'slottedHoles.width', 'slottedHoles.count',
      'slottedHoles.spacingX', 'slottedHoles.spacingY',
      'slottedHoles.marginX', 'slottedHoles.marginY'
    );
    if (boltEnabled) rpKeys.push('boltCircle.bcd', 'boltCircle.diameter', 'boltCircle.count');
    if (gridEnabled) rpKeys.push('gridHoles.diameter', 'gridHoles.pitchX', 'gridHoles.pitchY', 'gridHoles.rows', 'gridHoles.cols');
    if (cornerEnabled) rpKeys.push('cornerHoles.gaugeX', 'cornerHoles.gaugeY', 'cornerHoles.diameter');
    refineAirtight(template, params, features, bounds, rpKeys.filter((k) => bounds[k]));
  }

}

export function bounds_base_plate(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const W = params.width ?? 300;
    const H = params.height ?? 300;
    const holeDia = params.holeDiameter ?? 22;

    bounds.width = { min: 60, max: 2000 };
    bounds.height = { min: 60, max: 2000 };
    bounds.thickness = { min: 4.75, max: 50 };

    const maxHoleDia = Math.max(10, Math.floor(Math.min(W, H) / 4));
    bounds.holeDiameter = { min: 10, max: maxHoleDia };

    const minGaugeX = Math.ceil(holeDia + MIN_GAP);
    const maxGaugeX = Math.floor(W - holeDia - 2 * MIN_GAP);
    bounds.gaugeX = {
      min: minGaugeX,
      max: Math.max(minGaugeX, maxGaugeX),
    };

    const minGaugeY = Math.ceil(holeDia + MIN_GAP);
    const maxGaugeY = Math.floor(H - holeDia - 2 * MIN_GAP);
    bounds.gaugeY = {
      min: minGaugeY,
      max: Math.max(minGaugeY, maxGaugeY),
    };

    const fState = features || {};
    const maxCorner = Math.max(1, Math.min(150, Math.floor(Math.min(W, H) / 2 - MIN_GAP)));

    if (fState.fillet?.enabled) {
      bounds['fillet.radius'] = { min: 1, max: maxCorner };
      bounds.filletRadius = bounds['fillet.radius'];
    }

    if (fState.chamfer?.enabled) {
      bounds['chamfer.size'] = { min: 1, max: maxCorner };
      bounds.chamferSize = bounds['chamfer.size'];
    }

    if (fState.centerHole?.enabled) {
      const gX = params.gaugeX ?? 240;
      const gY = params.gaugeY ?? 240;
      const distToAnchor = Math.hypot(gX / 2, gY / 2);
      const maxCenterByAnchor = 2 * (distToAnchor - holeDia / 2 - MIN_GAP);
      const maxCenterByPlate = Math.min(W, H) - 2 * MIN_GAP;
      const maxCenter = Math.max(10, Math.floor(Math.min(maxCenterByPlate, maxCenterByAnchor)));
      bounds['centerHole.diameter'] = { min: 10, max: maxCenter };
      bounds.centerHoleDiameter = bounds['centerHole.diameter'];
    }

    // Refinamento airtight: nenhuma combinacao alcancavel por slider pode gerar
    // furo de ancoragem (ou furo central) fora da placa ou com parede insuficiente.
    const bpKeys = ['width', 'height', 'holeDiameter', 'gaugeX', 'gaugeY'];
    if (fState.fillet?.enabled) bpKeys.push('fillet.radius');
    if (fState.chamfer?.enabled) bpKeys.push('chamfer.size');
    if (fState.centerHole?.enabled) bpKeys.push('centerHole.diameter');
    refineAirtight(template, params, features, bounds, bpKeys);
}

export function bounds_lifting_lug(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const r = params.topRadius ?? 50;
    const h = params.totalHeight ?? 180;
    const rawD = params.holeDiameter ?? 45;

    const effD = Math.min(rawD, Math.max(8, 2 * r - 20));
    const minH = Math.max(50, Math.ceil(r + Math.max(25, effD / 2)));
    bounds.totalHeight = { min: minH, max: 2000 };
    bounds.topRadius = { min: 15, max: 600 };
    bounds.baseAngle = { min: 0, max: 45 };

    const maxD_head = 2 * r - 20;
    const maxD_base = 2 * (h - r);
    const maxD = Math.max(8, Math.floor(Math.min(maxD_head, maxD_base)));
    bounds.holeDiameter = { min: 8, max: maxD };
    bounds.baseChamfer = { min: 0, max: 100 };
    refineAirtight(template, params, features, bounds, Object.keys(bounds));
}

export function bounds_gusset_bracket(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const L = params.baseLength ?? 200;
    const H = params.height ?? 200;
    const holeDia = params.holeDiameter ?? 10;
    const relief = params.cornerRelief ?? 15;
    const baseCount = Math.max(0, Math.floor(params.baseHoleCount ?? 2));
    const uprightCount = Math.max(0, Math.floor(params.uprightHoleCount ?? 2));
    const baseStart = params.baseStartOffset ?? 50;
    const basePitch = params.basePitch ?? 80;
    const baseGauge = params.baseGauge ?? 25;
    const uprightStart = params.uprightStartOffset ?? 50;
    const uprightPitch = params.uprightPitch ?? 80;
    const uprightGauge = params.uprightGauge ?? 25;

    bounds.thickness = { min: 1.0, max: 50 };

    const hypLen = Math.hypot(L, H);
    const reqGap = holeDia / 2 + MIN_GAP;
    const capHyp = L * H - reqGap * hypLen;
    const EPS = 0.02;

    // Colecao atual dos centros de furacao
    const baseHoles: { x: number; y: number }[] = [];
    for (let k = 0; k < baseCount; k++) {
      baseHoles.push({ x: baseStart + k * basePitch, y: baseGauge });
    }

    const uprightHoles: { x: number; y: number }[] = [];
    for (let k = 0; k < uprightCount; k++) {
      uprightHoles.push({ x: uprightGauge, y: uprightStart + k * uprightPitch });
    }

    const allHoles = [...baseHoles, ...uprightHoles];

    // 1. cornerRelief: maximo chanfro que nao invade nenhum furo nem degenera o contorno
    let maxRelief = Math.min(100, Math.max(0, Math.min(L, H) / 2 - MIN_GAP));
    for (const pt of allHoles) {
      maxRelief = Math.min(maxRelief, pt.x + pt.y - reqGap * Math.SQRT2 - EPS);
    }
    bounds.cornerRelief = { min: 0, max: Math.max(0, maxRelief) };

    // 2. holeDiameter: maximo diametro compativel com todas as folgas minimas
    let maxDia = 60;
    if (baseCount >= 2) maxDia = Math.min(maxDia, basePitch - MIN_GAP - EPS);
    if (uprightCount >= 2) maxDia = Math.min(maxDia, uprightPitch - MIN_GAP - EPS);
    for (const b of baseHoles) {
      for (const u of uprightHoles) {
        maxDia = Math.min(maxDia, Math.hypot(b.x - u.x, b.y - u.y) - MIN_GAP - EPS);
      }
    }
    for (const pt of allHoles) {
      maxDia = Math.min(maxDia, 2 * (pt.y - MIN_GAP - EPS));
      maxDia = Math.min(maxDia, 2 * (pt.x - MIN_GAP - EPS));
      const dHyp = (L * H - H * pt.x - L * pt.y) / hypLen;
      maxDia = Math.min(maxDia, 2 * (dHyp - MIN_GAP - EPS));
      if (relief > 0.05) {
        const dRelief = (pt.x + pt.y - relief) / Math.SQRT2;
        maxDia = Math.min(maxDia, 2 * (dRelief - MIN_GAP - EPS));
      }
    }
    bounds.holeDiameter = { min: 4, max: Math.max(4, maxDia) };

    // 3. baseHoleCount: maior quantidade inteira de furos que cabem na base
    let maxBc = 0;
    for (let n = 1; n <= 20; n++) {
      if (n >= 2 && basePitch < holeDia + MIN_GAP) break;
      const k = n - 1;
      const xk = baseStart + k * basePitch;
      const yk = baseGauge;
      if (yk < reqGap || xk < reqGap) break;
      if (H * xk + L * yk > capHyp - EPS * hypLen) break;
      if (relief > 0.05 && xk + yk < relief + reqGap * Math.SQRT2 + EPS) break;
      let collides = false;
      for (const u of uprightHoles) {
        if (Math.hypot(xk - u.x, yk - u.y) < holeDia + MIN_GAP + EPS) {
          collides = true;
          break;
        }
      }
      if (collides) break;
      maxBc = n;
    }
    bounds.baseHoleCount = { min: 0, max: maxBc };

    // 4. uprightHoleCount: maior quantidade inteira de furos que cabem no montante
    let maxUc = 0;
    for (let n = 1; n <= 20; n++) {
      if (n >= 2 && uprightPitch < holeDia + MIN_GAP) break;
      const k = n - 1;
      const xk = uprightGauge;
      const yk = uprightStart + k * uprightPitch;
      if (xk < reqGap || yk < reqGap) break;
      if (H * xk + L * yk > capHyp - EPS * hypLen) break;
      if (relief > 0.05 && xk + yk < relief + reqGap * Math.SQRT2 + EPS) break;
      let collides = false;
      for (const b of baseHoles) {
        if (Math.hypot(b.x - xk, b.y - yk) < holeDia + MIN_GAP + EPS) {
          collides = true;
          break;
        }
      }
      if (collides) break;
      maxUc = n;
    }
    bounds.uprightHoleCount = { min: 0, max: maxUc };

    // 5. baseStartOffset: deslocamento inicial dos furos da base
    if (baseCount === 0) {
      bounds.baseStartOffset = { min: 5, max: 1000 };
    } else {
      let minBs = Math.max(5, reqGap + EPS);
      if (relief > 0.05) {
        minBs = Math.max(minBs, relief + reqGap * Math.SQRT2 - baseGauge + EPS);
      }
      const lastK = baseCount - 1;
      let maxBs = (capHyp - L * baseGauge) / H - lastK * basePitch - EPS;
      for (const u of uprightHoles) {
        const dy = Math.abs(baseGauge - u.y);
        if (dy < holeDia + MIN_GAP + EPS) {
          const dxSafe = Math.sqrt((holeDia + MIN_GAP + EPS) ** 2 - dy ** 2);
          for (let k = 0; k < baseCount; k++) {
            const forbMin = u.x - dxSafe - k * basePitch;
            const forbMax = u.x + dxSafe - k * basePitch;
            if (baseStart >= forbMax) {
              minBs = Math.max(minBs, forbMax + EPS);
            } else if (baseStart <= forbMin) {
              maxBs = Math.min(maxBs, forbMin - EPS);
            }
          }
        }
      }
      bounds.baseStartOffset = { min: minBs, max: Math.max(minBs, maxBs) };
    }

    // 6. uprightStartOffset: deslocamento inicial dos furos do montante
    if (uprightCount === 0) {
      bounds.uprightStartOffset = { min: 5, max: 1000 };
    } else {
      let minUs = Math.max(5, reqGap + EPS);
      if (relief > 0.05) {
        minUs = Math.max(minUs, relief + reqGap * Math.SQRT2 - uprightGauge + EPS);
      }
      const lastK = uprightCount - 1;
      let maxUs = (capHyp - H * uprightGauge) / L - lastK * uprightPitch - EPS;
      for (const b of baseHoles) {
        const dx = Math.abs(uprightGauge - b.x);
        if (dx < holeDia + MIN_GAP + EPS) {
          const dySafe = Math.sqrt((holeDia + MIN_GAP + EPS) ** 2 - dx ** 2);
          for (let k = 0; k < uprightCount; k++) {
            const forbMin = b.y - dySafe - k * uprightPitch;
            const forbMax = b.y + dySafe - k * uprightPitch;
            if (uprightStart >= forbMax) {
              minUs = Math.max(minUs, forbMax + EPS);
            } else if (uprightStart <= forbMin) {
              maxUs = Math.min(maxUs, forbMin - EPS);
            }
          }
        }
      }
      bounds.uprightStartOffset = { min: minUs, max: Math.max(minUs, maxUs) };
    }

    // 7. basePitch: entre centros dos furos da base
    if (baseCount <= 1) {
      bounds.basePitch = { min: Math.max(10, Math.ceil(holeDia + MIN_GAP)), max: 1000 };
    } else {
      let minBp = Math.max(10, holeDia + MIN_GAP + EPS);
      const lastK = baseCount - 1;
      let maxBp = ((capHyp - L * baseGauge) / H - baseStart) / lastK - EPS;
      for (const u of uprightHoles) {
        const dy = Math.abs(baseGauge - u.y);
        if (dy < holeDia + MIN_GAP + EPS) {
          const dxSafe = Math.sqrt((holeDia + MIN_GAP + EPS) ** 2 - dy ** 2);
          for (let k = 1; k < baseCount; k++) {
            const forbMin = (u.x - dxSafe - baseStart) / k;
            const forbMax = (u.x + dxSafe - baseStart) / k;
            if (basePitch >= forbMax) {
              minBp = Math.max(minBp, forbMax + EPS);
            } else if (basePitch <= forbMin) {
              maxBp = Math.min(maxBp, forbMin - EPS);
            }
          }
        }
      }
      bounds.basePitch = { min: minBp, max: Math.max(minBp, maxBp) };
    }

    // 8. uprightPitch: entre centros dos furos do montante
    if (uprightCount <= 1) {
      bounds.uprightPitch = { min: Math.max(10, Math.ceil(holeDia + MIN_GAP)), max: 1000 };
    } else {
      let minUp = Math.max(10, holeDia + MIN_GAP + EPS);
      const lastK = uprightCount - 1;
      let maxUp = ((capHyp - H * uprightGauge) / L - uprightStart) / lastK - EPS;
      for (const b of baseHoles) {
        const dx = Math.abs(uprightGauge - b.x);
        if (dx < holeDia + MIN_GAP + EPS) {
          const dySafe = Math.sqrt((holeDia + MIN_GAP + EPS) ** 2 - dx ** 2);
          for (let k = 1; k < uprightCount; k++) {
            const forbMin = (b.y - dySafe - uprightStart) / k;
            const forbMax = (b.y + dySafe - uprightStart) / k;
            if (uprightPitch >= forbMax) {
              minUp = Math.max(minUp, forbMax + EPS);
            } else if (uprightPitch <= forbMin) {
              maxUp = Math.min(maxUp, forbMin - EPS);
            }
          }
        }
      }
      bounds.uprightPitch = { min: minUp, max: Math.max(minUp, maxUp) };
    }

    // 9. baseGauge: distancia da borda inferior ate a linha de furos da base
    if (baseCount === 0) {
      bounds.baseGauge = { min: 5, max: 500 };
    } else {
      let minBg = Math.max(5, reqGap + EPS);
      if (relief > 0.05) {
        minBg = Math.max(minBg, relief + reqGap * Math.SQRT2 - baseStart + EPS);
      }
      const lastX = baseStart + (baseCount - 1) * basePitch;
      let maxBg = (capHyp - H * lastX) / L - EPS;
      for (const u of uprightHoles) {
        for (let k = 0; k < baseCount; k++) {
          const xk = baseStart + k * basePitch;
          const dx = Math.abs(xk - u.x);
          if (dx < holeDia + MIN_GAP + EPS) {
            const dySafe = Math.sqrt((holeDia + MIN_GAP + EPS) ** 2 - dx ** 2);
            const forbMin = u.y - dySafe;
            const forbMax = u.y + dySafe;
            if (baseGauge >= forbMax) {
              minBg = Math.max(minBg, forbMax + EPS);
            } else if (baseGauge <= forbMin) {
              maxBg = Math.min(maxBg, forbMin - EPS);
            }
          }
        }
      }
      bounds.baseGauge = { min: minBg, max: Math.max(minBg, maxBg) };
    }

    // 10. uprightGauge: distancia da borda esquerda ate a linha de furos do montante
    if (uprightCount === 0) {
      bounds.uprightGauge = { min: 5, max: 500 };
    } else {
      let minUg = Math.max(5, reqGap + EPS);
      if (relief > 0.05) {
        minUg = Math.max(minUg, relief + reqGap * Math.SQRT2 - uprightStart + EPS);
      }
      const lastY = uprightStart + (uprightCount - 1) * uprightPitch;
      let maxUg = (capHyp - L * lastY) / H - EPS;
      for (const b of baseHoles) {
        for (let k = 0; k < uprightCount; k++) {
          const yk = uprightStart + k * uprightPitch;
          const dy = Math.abs(yk - b.y);
          if (dy < holeDia + MIN_GAP + EPS) {
            const dxSafe = Math.sqrt((holeDia + MIN_GAP + EPS) ** 2 - dy ** 2);
            const forbMin = b.x - dxSafe;
            const forbMax = b.x + dxSafe;
            if (uprightGauge >= forbMax) {
              minUg = Math.max(minUg, forbMax + EPS);
            } else if (uprightGauge <= forbMin) {
              maxUg = Math.min(maxUg, forbMin - EPS);
            }
          }
        }
      }
      bounds.uprightGauge = { min: minUg, max: Math.max(minUg, maxUg) };
    }

    // Limites bidirecionais inversos: calcular baseLength.min e height.min a partir dos furos existentes
    const isLValid = (candL: number): boolean => {
      if (relief > 0 && candL < 2 * (relief + MIN_GAP)) return false;
      const candHyp = Math.hypot(candL, H);
      for (const pt of allHoles) {
        if (candL - pt.x < reqGap) return false;
        const dHyp = (candL * H - H * pt.x - candL * pt.y) / candHyp;
        if (dHyp < reqGap) return false;
      }
      return true;
    };

    let lowL = Math.max(50, Math.ceil(relief > 0 ? 2 * (relief + MIN_GAP) : 0));
    for (const pt of allHoles) {
      lowL = Math.max(lowL, Math.ceil(pt.x + reqGap));
    }
    let highL = 2000;
    let minL = lowL;

    if (!isLValid(highL)) {
      minL = 2000;
    } else if (isLValid(lowL)) {
      minL = lowL;
    } else {
      while (highL - lowL > 0.01) {
        const mid = (lowL + highL) / 2;
        if (isLValid(mid)) {
          highL = mid;
        } else {
          lowL = mid;
        }
      }
      const floorL = Math.floor(highL);
      minL = isLValid(floorL) ? floorL : Math.ceil(highL);
    }
    minL = Math.min(2000, Math.max(50, minL));
    bounds.baseLength = { min: minL, max: 2000 };

    // Busca binaria para o menor height valido com a furacao atual
    const isHValid = (candH: number): boolean => {
      if (relief > 0 && candH < 2 * (relief + MIN_GAP)) return false;
      const candHyp = Math.hypot(L, candH);
      for (const pt of allHoles) {
        if (candH - pt.y < reqGap) return false;
        const dHyp = (L * candH - candH * pt.x - L * pt.y) / candHyp;
        if (dHyp < reqGap) return false;
      }
      return true;
    };

    let lowH = Math.max(50, Math.ceil(relief > 0 ? 2 * (relief + MIN_GAP) : 0));
    for (const pt of allHoles) {
      lowH = Math.max(lowH, Math.ceil(pt.y + reqGap));
    }
    let highH = 2000;
    let minH = lowH;

    if (!isHValid(highH)) {
      minH = 2000;
    } else if (isHValid(lowH)) {
      minH = lowH;
    } else {
      while (highH - lowH > 0.01) {
        const mid = (lowH + highH) / 2;
        if (isHValid(mid)) {
          highH = mid;
        } else {
          lowH = mid;
        }
      }
      const floorH = Math.floor(highH);
      minH = isHValid(floorH) ? floorH : Math.ceil(highH);
    }
    minH = Math.min(2000, Math.max(50, minH));
    bounds.height = { min: minH, max: 2000 };

}

export function bounds_rufo_flashing(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
    const t = Math.max(0.3, params.thickness ?? 0.65);
    const ri = Math.max(0.2 * t, params.innerRadius ?? 1.5);
    const kFactor = Math.max(0.1, Math.min(0.9, params.kFactor ?? 0.44));
    const ro = ri + t;

    const angle1 = params.bendAngle1 ?? 105;
    const alpha1 = (Math.max(15, Math.min(165, angle1)) * Math.PI) / 180;
    const osb1 = Math.tan(alpha1 / 2) * ro;

    const angle2 = params.bendAngle2 ?? 90;
    const alpha2 = (Math.max(15, Math.min(165, angle2)) * Math.PI) / 180;
    const osb2 = Math.tan(alpha2 / 2) * ro;

    const ba1 = (Math.PI / 180) * angle1 * (ri + kFactor * t);

    const holeDia = params.holeDiameter ?? 6;
    const rHole = holeDia / 2;
    const reqGap = rHole + MIN_GAP;
    const holeCount = Math.max(0, Math.floor(params.holeCount ?? 4));
    const holePitch = params.holePitch ?? 80;
    const holeGauge = params.holeGauge ?? 20;
    const holeStart = params.holeStartOffset ?? 30;
    const L = params.lengthL ?? 300;
    const fA = params.flangeA ?? 50;

    // Helper: verifica se um dado conjunto de parametros do rufo gera erro no solver
    const hasError = (testP: Record<string, number>): boolean => {
      const curThick = Math.max(0.3, testP.thickness ?? t);
      const curRi = Math.max(0.2 * curThick, testP.innerRadius ?? ri);
      const curK = Math.max(0.1, Math.min(0.9, testP.kFactor ?? kFactor));
      const curRo = curRi + curThick;
      const curAng1 = testP.bendAngle1 ?? angle1;
      const a1Rad = (Math.max(15, Math.min(165, curAng1)) * Math.PI) / 180;
      const curOsb1 = Math.tan(a1Rad / 2) * curRo;
      const curBa1 = (Math.PI / 180) * curAng1 * (curRi + curK * curThick);

      const curFa = testP.flangeA ?? fA;
      const curL = testP.lengthL ?? L;
      const curDia = testP.holeDiameter ?? holeDia;
      const curR = curDia / 2;
      const curReqGap = curR + MIN_GAP;
      const curCount = Math.max(0, Math.floor(testP.holeCount ?? holeCount));
      const curPitch = testP.holePitch ?? holePitch;
      const curGauge = testP.holeGauge ?? holeGauge;
      const curStart = testP.holeStartOffset ?? holeStart;

      if (curDia <= 0) return true;
      if (curCount >= 2 && curPitch < curDia + MIN_GAP) return true;
      if (curGauge - curR < MIN_GAP) return true;

      // Largura util da aba A ate a zona de dobra
      const usefulA = curFa - curOsb1 - curBa1 / 2;
      if (usefulA - (curGauge + curR) < MIN_GAP) return true;

      for (let k = 0; k < curCount; k++) {
        const yPos = curStart + k * curPitch;
        if (yPos - curR < MIN_GAP) return true;
        if (curL - yPos - curR < MIN_GAP) return true;
      }
      return false;
    };

    const findMax = (key: string, minLimit: number, maxLimit: number): number => {
      if (hasError({ ...params, [key]: minLimit })) return minLimit;
      if (!hasError({ ...params, [key]: maxLimit })) return maxLimit;
      let lo = minLimit;
      let hi = maxLimit;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (hasError({ ...params, [key]: mid })) hi = mid;
        else lo = mid;
      }
      return lo;
    };

    const findMin = (key: string, minLimit: number, maxLimit: number): number => {
      if (hasError({ ...params, [key]: maxLimit })) return maxLimit;
      if (!hasError({ ...params, [key]: minLimit })) return minLimit;
      let lo = minLimit;
      let hi = maxLimit;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (hasError({ ...params, [key]: mid })) lo = mid;
        else hi = mid;
      }
      return hi;
    };

    // 1. Parametros de conformacao (protegidos contra invasao da furacao existente)
    bounds.thickness = { min: 0.35, max: Math.max(0.35, Number(findMax('thickness', 0.35, 6.0).toFixed(2))) };
    bounds.innerRadius = { min: 0.5, max: Math.max(0.5, Number(findMax('innerRadius', 0.5, 15).toFixed(1))) };
    bounds.kFactor = { min: 0.2, max: 0.8 };
    bounds.bendAngle1 = { min: 90, max: Math.max(90, Math.floor(findMax('bendAngle1', 90, 160))) };
    bounds.bendAngle2 = { min: 90, max: 170 };

    // 2. Diâmetro dos furos
    const usefulFlangeA = fA - osb1 - ba1 / 2;
    const maxDiaLeft = Math.floor(2 * (holeGauge - MIN_GAP));
    const maxDiaBend = Math.floor(2 * (usefulFlangeA - holeGauge - MIN_GAP));
    let maxDia = Math.min(25, maxDiaLeft, maxDiaBend);
    if (holeCount >= 2) {
      maxDia = Math.min(maxDia, Math.floor(holePitch - MIN_GAP));
    }
    if (holeCount >= 1) {
      maxDia = Math.min(maxDia, Math.floor(2 * (holeStart - MIN_GAP)));
      const lastY = holeStart + (holeCount - 1) * holePitch;
      maxDia = Math.min(maxDia, Math.floor(2 * (L - lastY - MIN_GAP)));
    }
    bounds.holeDiameter = { min: 3, max: Math.max(3, maxDia) };

    // 3. holeGauge
    const minGauge = Math.ceil(reqGap);
    const maxGauge = Math.max(minGauge, Math.floor(usefulFlangeA - reqGap));
    bounds.holeGauge = { min: minGauge, max: Math.max(minGauge, maxGauge) };

    // 4. holePitch
    const minPitch = Math.ceil(holeDia + MIN_GAP);
    let maxPitch = 1000;
    if (holeCount >= 2) {
      maxPitch = Math.max(minPitch, Math.floor((L - holeStart - reqGap) / (holeCount - 1)));
    }
    bounds.holePitch = { min: minPitch, max: Math.min(1000, maxPitch) };

    // 5. holeStartOffset
    const minStart = Math.ceil(reqGap);
    const maxStart = Math.max(minStart, Math.floor(L - reqGap - Math.max(0, holeCount - 1) * holePitch));
    bounds.holeStartOffset = { min: minStart, max: Math.max(minStart, maxStart) };

    // 6. holeCount
    // Só pode ter furos (> 0) se a posição transversal atual (holeGauge) e a primeira posição longitudinal (holeStart)
    // deixarem folga estrita MIN_GAP na chapa útil
    const gaugeValid = holeGauge - reqGap >= 0 && (usefulFlangeA - holeGauge - reqGap) >= 0;
    const startValid = holeStart - reqGap >= 0 && (L - holeStart - reqGap) >= 0;
    let maxHoles = 0;
    if (gaugeValid && startValid && holePitch >= holeDia + MIN_GAP) {
      maxHoles = Math.max(0, Math.floor((L - holeStart - reqGap) / holePitch) + 1);
    }
    bounds.holeCount = { min: 0, max: Math.min(30, Math.max(0, maxHoles)) };

    // 7. lengthL
    let minL = 50;
    if (holeCount >= 1) {
      const requiredL = Math.ceil(holeStart + (holeCount - 1) * holePitch + reqGap);
      minL = Math.max(minL, requiredL);
    }
    bounds.lengthL = { min: Math.min(6000, minL), max: 6000 };

    // 8. flangeA
    const minFaGeo = Math.ceil(osb1 + 2);
    let minFaHole = minFaGeo;
    if (holeCount >= 1) {
      minFaHole = Math.ceil(holeGauge + reqGap + osb1 + ba1 / 2);
    }
    const minFa = Math.max(minFaGeo, minFaHole);
    bounds.flangeA = { min: minFa, max: 500 };

    // 9. flangeB e flangeC
    const minFb = Math.ceil(osb1 + osb2 + 4);
    const minFc = Math.ceil(osb2 + 2);
    bounds.flangeB = { min: minFb, max: 1000 };
    bounds.flangeC = { min: minFc, max: 300 };
}

export function bounds_trapezoid_plate(
  _template: TemplateDefinition,
  _params: Record<string, number>,
  _features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
  bounds.bottomWidth = { min: 20, max: 3000 };
  bounds.topWidth = { min: 2, max: 3000 };
  bounds.height = { min: 20, max: 3000 };
  bounds.thickness = { min: 0.5, max: 50 };
}

export function bounds_cylinder_development(
  _template: TemplateDefinition,
  _params: Record<string, number>,
  _features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
  bounds.diameter = { min: 20, max: 3000 };
  bounds.height = { min: 10, max: 6000 };
  bounds.weldGap = { min: 0, max: 100 };
  bounds.thickness = { min: 0.5, max: 50 };
}

export function bounds_star_polygon(
  template: TemplateDefinition,
  params: Record<string, number>,
  features: Record<string, FeatureState> | undefined,
  bounds: Record<string, ParamBound>
): void {
  const outerR = params.outerRadius ?? 100;
  bounds.points = { min: 3, max: 24 };
  bounds.outerRadius = { min: 20, max: 1500 };
  bounds.innerRadius = { min: 5, max: Math.max(5, Math.floor(outerR - 2)) };
  bounds.thickness = { min: 0.5, max: 50 };

  if (features?.centerHole?.enabled) {
    const innerR = params.innerRadius ?? 45;
    const maxDia = Math.max(2, Math.floor(2 * innerR - 2 * MIN_GAP));
    bounds['centerHole.diameter'] = { min: 2, max: maxDia };
    bounds.centerHoleDiameter = bounds['centerHole.diameter'];
    refineAirtight(template, params, features, bounds, ['outerRadius', 'innerRadius', 'centerHole.diameter']);
  }
}

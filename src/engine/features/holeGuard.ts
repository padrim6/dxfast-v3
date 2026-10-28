import { GeometryIssue } from '../../types/cad';

export interface HoleGuardInput {
  requestedDiameter: number;
  maxAvailableDiameter: number;
  minDiameter?: number;
  maxAllowedDiameter?: number;
  field?: string;
  locationLabel?: string;
}

export interface HoleGuardResult {
  isValid: boolean;
  diameter: number;
  error?: GeometryIssue;
}

export interface SlotGuardInput {
  requestedLength: number;
  holeDiameter: number;
  maxAvailableLength: number;
  minLength?: number;
  maxAllowedLength?: number;
  field?: string;
  locationLabel?: string;
}

export interface SlotGuardResult {
  isValid: boolean;
  length: number;
  error?: GeometryIssue;
}

export interface MarginGuardInput {
  requestedMargin: number;
  minMargin: number;
  maxMargin: number;
  field?: string;
  locationLabel?: string;
}

export interface MarginGuardResult {
  isValid: boolean;
  margin: number;
  error?: GeometryIssue;
}

/**
 * Valida o diâmetro de um furo contra o espaço físico disponível e limites de produto.
 * 
 * Princípio da Honestidade Geométrica:
 * - Se o diâmetro solicitado cabe no espaço disponível e respeita os limites -> retorna o diâmetro exato sem alteração.
 * - Se NÃO cabe ou excede limites -> NUNCA reduz em silêncio. Retorna isValid: false e o GeometryIssue com
 *   as informações necessárias para o solver registrar o erro e bloquear a exportação.
 */
export function guardHoleDiameter(input: HoleGuardInput): HoleGuardResult {
  const {
    requestedDiameter,
    maxAvailableDiameter,
    minDiameter = 1,
    maxAllowedDiameter = Infinity,
    field = 'holeDiameter',
    locationLabel = 'face',
  } = input;

  const effMax = Math.min(maxAvailableDiameter, maxAllowedDiameter);

  if (requestedDiameter > effMax) {
    const isPhysical = maxAvailableDiameter <= maxAllowedDiameter;
    const reasonMsg = isPhysical
      ? `excede o espaço físico disponível (${maxAvailableDiameter.toFixed(1)}mm) em ${locationLabel}`
      : `excede o diâmetro máximo permitido pelo produto (${maxAllowedDiameter.toFixed(1)}mm)`;

    return {
      isValid: false,
      diameter: requestedDiameter,
      error: {
        code: 'HOLE_EXCEEDS_AVAILABLE_SPACE',
        severity: 'error',
        field,
        message: `Diâmetro do furo solicitado (${requestedDiameter}mm) ${reasonMsg}.`,
      },
    };
  }

  if (requestedDiameter < minDiameter) {
    return {
      isValid: false,
      diameter: requestedDiameter,
      error: {
        code: 'HOLE_BELOW_MIN_DIAMETER',
        severity: 'error',
        field,
        message: `Diâmetro do furo solicitado (${requestedDiameter}mm) é inferior ao mínimo permitido (${minDiameter}mm).`,
      },
    };
  }

  return {
    isValid: true,
    diameter: requestedDiameter,
  };
}

/**
 * Valida o comprimento de um rasgo oblongo contra o espaço disponível e limites de produto.
 */
export function guardSlotLength(input: SlotGuardInput): SlotGuardResult {
  const {
    requestedLength,
    holeDiameter,
    maxAvailableLength,
    minLength = holeDiameter + 2,
    maxAllowedLength = Infinity,
    field = 'slotLength',
    locationLabel = 'face',
  } = input;

  const effMax = Math.min(maxAvailableLength, maxAllowedLength);

  if (requestedLength > effMax) {
    return {
      isValid: false,
      length: requestedLength,
      error: {
        code: 'SLOT_EXCEEDS_AVAILABLE_SPACE',
        severity: 'error',
        field,
        message: `Comprimento do rasgo solicitado (${requestedLength}mm) excede o espaço disponível (${effMax.toFixed(1)}mm) em ${locationLabel}.`,
      },
    };
  }

  if (requestedLength < minLength) {
    return {
      isValid: false,
      length: requestedLength,
      error: {
        code: 'SLOT_BELOW_MIN_LENGTH',
        severity: 'error',
        field,
        message: `Comprimento do rasgo (${requestedLength}mm) deve ser no mínimo ${minLength.toFixed(1)}mm (diâmetro + folga).`,
      },
    };
  }

  return {
    isValid: true,
    length: requestedLength,
  };
}

/**
 * Valida a margem de borda para furações em uma face.
 */
export function guardHoleMargin(input: MarginGuardInput): MarginGuardResult {
  const {
    requestedMargin,
    minMargin,
    maxMargin,
    field = 'holeEdgeMargin',
    locationLabel = 'face',
  } = input;

  if (requestedMargin > maxMargin) {
    return {
      isValid: false,
      margin: requestedMargin,
      error: {
        code: 'HOLE_MARGIN_EXCEEDS_SPACE',
        severity: 'error',
        field,
        message: `Margem de borda solicitada (${requestedMargin}mm) excede o espaço disponível (${maxMargin.toFixed(1)}mm) em ${locationLabel}.`,
      },
    };
  }

  if (requestedMargin < minMargin) {
    return {
      isValid: false,
      margin: requestedMargin,
      error: {
        code: 'HOLE_MARGIN_TOO_SMALL',
        severity: 'error',
        field,
        message: `Margem de borda solicitada (${requestedMargin}mm) é inferior ao mínimo seguro (${minMargin.toFixed(1)}mm) em ${locationLabel}.`,
      },
    };
  }

  return {
    isValid: true,
    margin: requestedMargin,
  };
}

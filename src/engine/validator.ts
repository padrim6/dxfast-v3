import {
  LWPolyline,
  CircleElement,
  GeometryIssue,
  SanitizationWarning,
  Point2D,
} from '../types/cad';

/**
 * Samples vertices of a polyline, including arcs defined by bulge factor
 */
export function samplePolyline(poly: LWPolyline, segmentsPerArc: number = 24): Point2D[] {
  const verts = poly.vertices;
  if (!verts || verts.length === 0) return [];
  const points: Point2D[] = [];
  const n = verts.length;
  const count = poly.isClosed ? n : n - 1;

  for (let i = 0; i < count; i++) {
    const v1 = verts[i];
    const v2 = verts[(i + 1) % n];
    points.push({ x: v1.x, y: v1.y });

    const bulge = v1.bulge || 0;
    if (Math.abs(bulge) > 1e-6) {
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const chord = Math.hypot(dx, dy);
      if (chord > 1e-6) {
        const theta = 4 * Math.atan(bulge);
        const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
        const h = (chord * (1 - bulge * bulge)) / (4 * bulge);
        const midX = (v1.x + v2.x) / 2;
        const midY = (v1.y + v2.y) / 2;
        const perpX = -dy / chord;
        const perpY = dx / chord;
        const cx = midX + h * perpX;
        const cy = midY + h * perpY;
        const startAngle = Math.atan2(v1.y - cy, v1.x - cx);

        for (let s = 1; s < segmentsPerArc; s++) {
          const t = s / segmentsPerArc;
          const angle = startAngle + t * theta;
          points.push({
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
          });
        }
      }
    }
  }

  return points;
}

/**
 * Point-in-polygon test (ray casting algorithm)
 */
export function isPointInPolygon(p: Point2D, polygon: Point2D[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y))
        && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Tests if circle crosses or lies outside the outer polygon
 */
export function isCircleCrossingOuter(center: Point2D, radius: number, outerPoly: Point2D[]): boolean {
  if (radius <= 0) return false;
  if (!isPointInPolygon(center, outerPoly)) return true;

  for (let k = 0; k < 12; k++) {
    const angle = (2 * Math.PI * k) / 12;
    const pt: Point2D = {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
    if (!isPointInPolygon(pt, outerPoly)) {
      return true;
    }
  }
  return false;
}

export interface ValidationInput {
  outerPolylines: LWPolyline[];
  innerPolylines: LWPolyline[];
  circles: CircleElement[];
  grossArea: number;
  netArea: number;
  bendLines?: any[];
  faceSections?: any[];
  unfoldingMath?: any;
  templateId?: string;
  params?: Record<string, number>;
}

export interface ValidationResult {
  errors: GeometryIssue[];
  warnings: SanitizationWarning[];
  adjustedNetArea: number;
}

/**
 * Validates folded profile 3D physical face collisions and geometric bend limits
 */
export function validateFoldedCollision(
  geometry: {
    faceSections?: any[];
    bendLines?: any[];
    unfoldingMath?: any;
    outerPolylines?: any[];
  },
  template?: { id: string; category?: string },
  params?: Record<string, number>
): GeometryIssue[] {
  const issues: GeometryIssue[] = [];
  const templateId = template?.id || '';

  const t = Math.max(0.5, geometry.unfoldingMath?.thicknessMm ?? params?.thickness ?? 2.0);
  const Ri = Math.max(0.2 * t, geometry.unfoldingMath?.internalRadiusMm ?? params?.innerRadius ?? 3.0);
  const angleDeg = params?.bendAngle ?? geometry.unfoldingMath?.bendAngleDeg ?? 90;

  if (angleDeg >= 180 || angleDeg <= 0) {
    issues.push({
      code: 'BEND_ANGLE_SELF_INTERSECT',
      severity: 'error',
      field: 'bendAngle',
      message: `Ângulo de dobra inválido (${angleDeg}°): o perfil colide consigo mesmo.`,
    });
    return issues;
  }

  const Ro = Ri + t;
  const alphaRad = (angleDeg * Math.PI) / 180;
  const osb = Math.tan(alphaRad / 2) * Ro;

  const faces = geometry.faceSections || [];

  if (templateId === 'profile_u') {
    const rawA = params?.flangeA ?? faces[0]?.widthNominalMm ?? 50;
    const rawB = params?.flangeB ?? faces[1]?.widthNominalMm ?? 100;
    const rawC = params?.flangeC ?? faces[2]?.widthNominalMm ?? 50;

    if (2 * osb >= rawB) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_WEB',
        severity: 'error',
        field: 'flangeB',
        message: `Incompatibilidade geométrica: O recuo de dobra (${(2 * osb).toFixed(1)}mm) para Ri=${Ri.toFixed(1)}mm e ângulo=${angleDeg}° excede a alma B (${rawB}mm).`,
      });
    }
    if (osb >= rawA) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeA',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede o comprimento da aba A (${rawA}mm).`,
      });
    }
    if (osb >= rawC) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeC',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede o comprimento da aba C (${rawC}mm).`,
      });
    }

    if (angleDeg > 90) {
      const cosFactor = -Math.cos(alphaRad);
      const reachA = rawA * cosFactor;
      const reachC = rawC * cosFactor;
      const availableInside = rawB - 2 * t;

      if (reachA + reachC >= availableInside - 0.01) {
        issues.push({
          code: 'FOLDED_FACE_COLLISION',
          severity: 'error',
          field: 'flangeA',
          message: `Colisão entre faces dobradas: As abas A (${rawA}mm) e C (${rawC}mm) se cruzam no interior do perfil para o ângulo de ${angleDeg}°.`,
        });
      } else if (reachA >= rawB - t - 0.01) {
        issues.push({
          code: 'FOLDED_FACE_COLLISION',
          severity: 'error',
          field: 'flangeA',
          message: `Colisão de face dobrada: A aba A (${rawA}mm) colide contra a parede oposta do perfil para o ângulo de ${angleDeg}°.`,
        });
      } else if (reachC >= rawB - t - 0.01) {
        issues.push({
          code: 'FOLDED_FACE_COLLISION',
          severity: 'error',
          field: 'flangeC',
          message: `Colisão de face dobrada: A aba C (${rawC}mm) colide contra a parede oposta do perfil para o ângulo de ${angleDeg}°.`,
        });
      }
    }
  } else if (templateId === 'profile_l') {
    const rawA = params?.flangeA ?? faces[0]?.widthNominalMm ?? 50;
    const rawB = params?.flangeB ?? faces[1]?.widthNominalMm ?? 50;

    if (osb >= rawA) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeA',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede a aba A (${rawA}mm).`,
      });
    }
    if (osb >= rawB) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeB',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede a aba B (${rawB}mm).`,
      });
    }
  } else if (templateId === 'profile_z') {
    const rawA = params?.flangeA ?? faces[0]?.widthNominalMm ?? 40;
    const rawB = params?.flangeB ?? params?.webB ?? faces[1]?.widthNominalMm ?? 120;
    const rawC = params?.flangeC ?? faces[2]?.widthNominalMm ?? 40;

    if (2 * osb >= rawB) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_WEB',
        severity: 'error',
        field: 'flangeB',
        message: `Incompatibilidade geométrica: O recuo de dobra (${(2 * osb).toFixed(1)}mm) excede a alma B (${rawB}mm).`,
      });
    }
    if (osb >= rawA) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeA',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede a aba A (${rawA}mm).`,
      });
    }
    if (osb >= rawC) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeC',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede a aba C (${rawC}mm).`,
      });
    }

    if (angleDeg > 90) {
      const cosFactor = -Math.cos(alphaRad);
      const reachA = rawA * cosFactor;
      const reachC = rawC * cosFactor;

      if (reachA >= rawB - t - 0.01) {
        issues.push({
          code: 'FOLDED_FACE_COLLISION',
          severity: 'error',
          field: 'flangeA',
          message: `Colisão de face dobrada: A aba A (${rawA}mm) colide contra a alma do perfil Z para o ângulo de ${angleDeg}°.`,
        });
      }
      if (reachC >= rawB - t - 0.01) {
        issues.push({
          code: 'FOLDED_FACE_COLLISION',
          severity: 'error',
          field: 'flangeC',
          message: `Colisão de face dobrada: A aba C (${rawC}mm) colide contra a alma do perfil Z para o ângulo de ${angleDeg}°.`,
        });
      }
    }
  } else if (templateId === 'profile_hat') {
    const rawA = params?.flangeA ?? faces[0]?.widthNominalMm ?? 25;
    const rawB = params?.flangeB ?? faces[1]?.widthNominalMm ?? 40;
    const rawC = params?.flangeC ?? faces[2]?.widthNominalMm ?? 80;
    const rawD = params?.flangeD ?? faces[3]?.widthNominalMm ?? 40;
    const rawE = params?.flangeE ?? faces[4]?.widthNominalMm ?? 25;

    if (2 * osb >= rawC) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_WEB',
        severity: 'error',
        field: 'flangeC',
        message: `Incompatibilidade geométrica: O recuo de dobra (${(2 * osb).toFixed(1)}mm) excede o topo C (${rawC}mm).`,
      });
    }
    if (osb >= rawB) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeB',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede a altura da perna B (${rawB}mm).`,
      });
    }
    if (osb >= rawD) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeD',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede a altura da perna D (${rawD}mm).`,
      });
    }
    if (osb >= rawA) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeA',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede a aba A (${rawA}mm).`,
      });
    }
    if (osb >= rawE) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flangeE',
        message: `Incompatibilidade geométrica: O recuo de dobra (${osb.toFixed(1)}mm) excede a aba E (${rawE}mm).`,
      });
    }

    if (angleDeg > 90) {
      const cosFactor = -Math.cos(alphaRad);
      const reachLegs = 2 * rawB * cosFactor;
      if (reachLegs >= rawC - 2 * t - 0.01) {
        issues.push({
          code: 'FOLDED_FACE_COLLISION',
          severity: 'error',
          field: 'flangeB',
          message: `Colisão entre faces dobradas: As pernas do perfil cartola colidem entre si para o ângulo de ${angleDeg}°.`,
        });
      }
    }
  } else if (templateId === 'gate_guide_u') {
    const rawA = params?.baseA ?? faces[2]?.widthNominalMm ?? 80;
    const rawB = params?.webB ?? params?.webB_left ?? faces[1]?.widthNominalMm ?? 80;
    const rawC = params?.flareC ?? params?.flareC_left ?? faces[0]?.widthNominalMm ?? 50;
    const flareAngle = params?.flareAngle ?? params?.flareAngle_left ?? 45;
    const alphaFlareRad = (flareAngle * Math.PI) / 180;
    const osbFlare = Math.tan(alphaFlareRad / 2) * Ro;

    if (2 * osb >= rawA) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_WEB',
        severity: 'error',
        field: 'baseA',
        message: `Incompatibilidade geométrica: O recuo de dobra (${(2 * osb).toFixed(1)}mm) excede a base A (${rawA}mm).`,
      });
    }
    if (osb + osbFlare >= rawB) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'webB',
        message: `Incompatibilidade geométrica: A soma dos recuos de dobra (${(osb + osbFlare).toFixed(1)}mm) excede a aba vertical B (${rawB}mm).`,
      });
    }
    if (osbFlare >= rawC) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'flareC',
        message: `Incompatibilidade geométrica: O recuo de dobra da aba de entrada (${osbFlare.toFixed(1)}mm) excede o comprimento C (${rawC}mm).`,
      });
    }
  } else if (templateId === 'lambril_z') {
    const rawD = params?.lipD ?? faces[0]?.widthNominalMm ?? 20;
    const rawA = params?.faceA ?? faces[1]?.widthNominalMm ?? 95;
    const rawB = params?.stepB ?? faces[2]?.widthNominalMm ?? 20;
    const rawC = params?.faceC ?? faces[3]?.widthNominalMm ?? 95;

    if (rawD > rawB + 0.01) {
      issues.push({
        code: 'FOLDED_FACE_COLLISION',
        severity: 'error',
        field: 'lipD',
        message: `Colisão entre faces dobradas: O retorno D (${rawD}mm) é maior que a altura do degrau B (${rawB}mm), atravessando a face oposta.`,
      });
    }
    if (2 * (Ri + t) >= rawB) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_WEB',
        severity: 'error',
        field: 'stepB',
        message: `Incompatibilidade geométrica: A altura do degrau B (${rawB}mm) é insuficiente para acomodar as duas dobras com raio Ri=${Ri}mm.`,
      });
    }
    if (2 * (Ri + t) >= rawA || 2 * (Ri + t) >= rawC) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'faceA',
        message: `Incompatibilidade geométrica: O comprimento da face (${Math.min(rawA, rawC)}mm) é insuficiente para acomodar as dobras.`,
      });
    }
  } else if (templateId === 'gate_weight_box') {
    const rawA = params?.faceA ?? faces[1]?.widthNominalMm ?? 150;
    const rawB = params?.faceB ?? faces[2]?.widthNominalMm ?? 100;

    if (rawA < 2 * (Ro + t) + 1.0 - 1e-4) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'faceA',
        message: `Incompatibilidade geométrica: A altura A (${rawA}mm) é insuficiente para acomodar os raios de conformação da caixa.`,
      });
    }
    if (rawB < 2 * (Ro + t) + 1.0 - 1e-4) {
      issues.push({
        code: 'BEND_SETBACK_EXCEEDS_FLANGE',
        severity: 'error',
        field: 'faceB',
        message: `Incompatibilidade geométrica: A largura B (${rawB}mm) é insuficiente para acomodar os raios de conformação da caixa.`,
      });
    }
  }

  return issues;
}

/**
 * Validates physical and geometric integrity of CAD output
 */
export function validateGeometry(input: ValidationInput): ValidationResult {
  const errors: GeometryIssue[] = [];
  const warnings: SanitizationWarning[] = [];
  let adjustedNetArea = input.netArea;

  // Strict Physical Area Invariant Checks
  if (input.grossArea <= 0) {
    errors.push({
      code: 'INVALID_GROSS_AREA',
      severity: 'error',
      field: 'grossArea',
      message: 'Área bruta calculada é inválida (menor ou igual a zero). Verifique as dimensões nominais da peça.',
    });
  }

  if (adjustedNetArea <= 0) {
    errors.push({
      code: 'ZERO_OR_NEGATIVE_NET_AREA',
      severity: 'error',
      field: 'netArea',
      message: 'Área líquida resultante é nula ou negativa (as furações e cortes internos consumiram todo o material da peça).',
    });
  } else if (adjustedNetArea > input.grossArea + 1e-4) {
    // Correct numerical drift or warn if netArea exceeds grossArea
    warnings.push({
      field: 'netArea',
      message: 'Área líquida corrigida para não exceder a área bruta da chapa.',
      type: 'correction',
    });
    adjustedNetArea = input.grossArea;
  }

  // Strict Industrial Geometric Integrity Validations (Holes, Overlaps, Boundaries)
  const sampledOuter = input.outerPolylines[0] ? samplePolyline(input.outerPolylines[0], 24) : [];

  if (sampledOuter.length >= 3) {
    // 1. Circle collision / overlap detection
    for (let i = 0; i < input.circles.length; i++) {
      for (let j = i + 1; j < input.circles.length; j++) {
        const dist = Math.hypot(
          input.circles[i].center.x - input.circles[j].center.x,
          input.circles[i].center.y - input.circles[j].center.y
        );
        if (dist < input.circles[i].radius + input.circles[j].radius - 0.1) {
          errors.push({
            code: 'HOLE_OVERLAP',
            severity: 'error',
            field: 'circles',
            message: `Furações sobrepostas detectadas com espaçamento entre centros menor que a soma dos raios (${dist.toFixed(1)}mm).`,
          });
          break;
        }
      }
      if (errors.some((e) => e.code === 'HOLE_OVERLAP')) break;
    }

    // 2. Circle outside or crossing outer boundary
    for (const c of input.circles) {
      if (isCircleCrossingOuter(c.center, c.radius, sampledOuter)) {
        errors.push({
          code: 'HOLE_CROSSES_BOUNDARY',
          severity: 'error',
          field: 'circles',
          message: `Furação em (${c.center.x.toFixed(1)}, ${c.center.y.toFixed(1)}) ultrapassa o contorno externo da chapa.`,
        });
        break;
      }
    }

    // 3. Inner polylines crossing outer boundary
    for (const inPoly of input.innerPolylines) {
      const sampledIn = samplePolyline(inPoly, 16);
      for (const pt of sampledIn) {
        if (!isPointInPolygon(pt, sampledOuter)) {
          errors.push({
            code: 'INNER_FEATURE_OUTSIDE',
            severity: 'error',
            field: 'innerPolylines',
            message: 'Corte ou rasgo interno ultrapassa o contorno externo da peça.',
          });
          break;
        }
      }
      if (errors.some((e) => e.code === 'INNER_FEATURE_OUTSIDE')) break;
    }
  }

  // 4. Folded face collision validation
  if (input.templateId || input.faceSections || input.unfoldingMath) {
    const foldedIssues = validateFoldedCollision(input, { id: input.templateId || '' }, input.params);
    errors.push(...foldedIssues);
  }

  return {
    errors,
    warnings,
    adjustedNetArea,
  };
}

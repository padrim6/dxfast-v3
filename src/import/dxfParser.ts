// DXFAST :: Parser de DXF ASCII (entidades essenciais de corte)
// Le o arquivo como pares (codigo de grupo, valor) e extrai as entidades da secao
// ENTITIES: LINE, LWPOLYLINE, POLYLINE (2D via VERTEX), CIRCLE, ARC e SPLINE
// (aproximada por pontos). Le $INSUNITS do cabecalho para a conversao de unidade.
// Puro e deterministico. Proibido o caractere traco-longo em qualquer string.

export interface DxfVertex {
  x: number;
  y: number;
  bulge: number; // tan(theta/4); 0 = reto
}
export type DxfEntity =
  | { type: 'LINE'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { type: 'CIRCLE'; layer: string; cx: number; cy: number; r: number }
  | { type: 'ARC'; layer: string; cx: number; cy: number; r: number; a0: number; a1: number }
  | { type: 'LWPOLYLINE'; layer: string; closed: boolean; verts: DxfVertex[] }
  | { type: 'POLYLINE'; layer: string; closed: boolean; verts: DxfVertex[] }
  | { type: 'SPLINE'; layer: string; closed: boolean; pts: Array<{ x: number; y: number }> };

export interface DxfParseResult {
  entities: DxfEntity[];
  unitScaleToMm: number; // fator para converter as coordenadas em mm
  insunits: number; // valor bruto de $INSUNITS (0 = indefinido)
  warnings: string[];
}

// $INSUNITS -> mm. Tabela do DXF. 0/indefinido assume mm (padrao do app).
function unitsToMm(insunits: number): number {
  switch (insunits) {
    case 1: return 25.4; // polegadas
    case 2: return 304.8; // pes
    case 4: return 1; // milimetros
    case 5: return 10; // centimetros
    case 6: return 1000; // metros
    case 8: return 0.0254; // micropolegadas? raro
    case 9: return 0.0254; // mils (1/1000 pol) -> 0.0254 mm
    case 10: return 914.4; // jardas
    case 13: return 1e-6; // nanometros
    case 14: return 0.01; // decimetros
    default: return 1; // 0 (indefinido), 3 (milhas) e outros: assume mm
  }
}

interface Pair {
  code: number;
  value: string;
}

/** Quebra o texto DXF em pares (codigo, valor). */
function toPairs(text: string): Pair[] {
  // DXF usa pares em linhas alternadas. Aceita \r\n e \n.
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) {
      // desalinhado: tenta ressincronizar pulando uma linha
      i -= 1;
      continue;
    }
    pairs.push({ code, value: lines[i + 1] });
  }
  return pairs;
}

const num = (s: string): number => {
  const v = parseFloat(String(s).trim());
  return isNaN(v) ? 0 : v;
};

/** Faz o parse de um DXF ASCII. Nunca lanca; acumula avisos. */
export function parseDxf(text: string): DxfParseResult {
  const warnings: string[] = [];
  const pairs = toPairs(text);

  // 1. $INSUNITS no HEADER
  let insunits = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i].code === 9 && pairs[i].value.trim() === '$INSUNITS') {
      // o proximo par com codigo 70 carrega o valor
      for (let j = i + 1; j < Math.min(i + 4, pairs.length); j++) {
        if (pairs[j].code === 70) { insunits = parseInt(pairs[j].value.trim(), 10) || 0; break; }
      }
      break;
    }
  }
  const unitScaleToMm = unitsToMm(insunits);

  // 2. Localiza a secao ENTITIES
  let start = -1;
  let end = pairs.length;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i].code === 0 && pairs[i].value.trim() === 'SECTION' &&
        pairs[i + 1].code === 2 && pairs[i + 1].value.trim() === 'ENTITIES') {
      start = i + 2;
      break;
    }
  }
  if (start < 0) {
    warnings.push('Secao ENTITIES nao encontrada.');
    return { entities: [], unitScaleToMm, insunits, warnings };
  }
  for (let i = start; i < pairs.length; i++) {
    if (pairs[i].code === 0 && pairs[i].value.trim() === 'ENDSEC') { end = i; break; }
  }

  // 3. Agrupa em entidades (codigo 0 inicia uma entidade)
  const entities: DxfEntity[] = [];
  let i = start;
  while (i < end) {
    if (pairs[i].code !== 0) { i++; continue; }
    const type = pairs[i].value.trim();
    // coleta os pares da entidade ate o proximo codigo 0
    const body: Pair[] = [];
    i++;
    while (i < end && pairs[i].code !== 0) { body.push(pairs[i]); i++; }

    if (type === 'LINE') entities.push(parseLine(body, unitScaleToMm));
    else if (type === 'CIRCLE') entities.push(parseCircle(body, unitScaleToMm));
    else if (type === 'ARC') entities.push(parseArc(body, unitScaleToMm));
    else if (type === 'LWPOLYLINE') entities.push(parseLwpolyline(body, unitScaleToMm));
    else if (type === 'POLYLINE') {
      // POLYLINE antigo: os vertices sao entidades VERTEX ate SEQEND
      const flags = firstCode(body, 70) || 0;
      const layer = firstStr(body, 8) || '0';
      const verts: DxfVertex[] = [];
      while (i < end) {
        if (pairs[i].code === 0 && pairs[i].value.trim() === 'VERTEX') {
          const vb: Pair[] = [];
          i++;
          while (i < end && pairs[i].code !== 0) { vb.push(pairs[i]); i++; }
          verts.push({
            x: (firstCode(vb, 10) || 0) * unitScaleToMm,
            y: (firstCode(vb, 20) || 0) * unitScaleToMm,
            bulge: firstCode(vb, 42) || 0,
          });
        } else if (pairs[i].code === 0 && pairs[i].value.trim() === 'SEQEND') {
          i++;
          break;
        } else if (pairs[i].code === 0) {
          break; // algo inesperado: encerra o polyline
        } else {
          i++;
        }
      }
      entities.push({ type: 'POLYLINE', layer, closed: (flags & 1) === 1, verts });
      continue; // i ja avancado
    } else if (type === 'SPLINE') entities.push(parseSpline(body, unitScaleToMm));
    // outras entidades (TEXT, DIMENSION, INSERT, etc) sao ignoradas nesta fase
  }

  return { entities, unitScaleToMm, insunits, warnings };
}

function firstCode(body: Pair[], code: number): number | undefined {
  for (const p of body) if (p.code === code) return num(p.value);
  return undefined;
}
function firstStr(body: Pair[], code: number): string | undefined {
  for (const p of body) if (p.code === code) return p.value.trim();
  return undefined;
}

function parseLine(body: Pair[], s: number): DxfEntity {
  return {
    type: 'LINE',
    layer: firstStr(body, 8) || '0',
    x1: (firstCode(body, 10) || 0) * s,
    y1: (firstCode(body, 20) || 0) * s,
    x2: (firstCode(body, 11) || 0) * s,
    y2: (firstCode(body, 21) || 0) * s,
  };
}
function parseCircle(body: Pair[], s: number): DxfEntity {
  return {
    type: 'CIRCLE',
    layer: firstStr(body, 8) || '0',
    cx: (firstCode(body, 10) || 0) * s,
    cy: (firstCode(body, 20) || 0) * s,
    r: (firstCode(body, 40) || 0) * s,
  };
}
function parseArc(body: Pair[], s: number): DxfEntity {
  return {
    type: 'ARC',
    layer: firstStr(body, 8) || '0',
    cx: (firstCode(body, 10) || 0) * s,
    cy: (firstCode(body, 20) || 0) * s,
    r: (firstCode(body, 40) || 0) * s,
    a0: firstCode(body, 50) || 0,
    a1: firstCode(body, 51) || 0,
  };
}
function parseLwpolyline(body: Pair[], s: number): DxfEntity {
  const layer = firstStr(body, 8) || '0';
  const flags = firstCode(body, 70) || 0;
  const verts: DxfVertex[] = [];
  // as coordenadas vem em sequencia: cada 10 inicia um vertice; 20 o y; 42 o bulge
  let cur: Partial<DxfVertex> | null = null;
  for (const p of body) {
    if (p.code === 10) {
      if (cur) verts.push({ x: cur.x || 0, y: cur.y || 0, bulge: cur.bulge || 0 });
      cur = { x: num(p.value) * s, y: 0, bulge: 0 };
    } else if (p.code === 20 && cur) {
      cur.y = num(p.value) * s;
    } else if (p.code === 42 && cur) {
      cur.bulge = num(p.value);
    }
  }
  if (cur) verts.push({ x: cur.x || 0, y: cur.y || 0, bulge: cur.bulge || 0 });
  return { type: 'LWPOLYLINE', layer, closed: (flags & 1) === 1, verts };
}
function parseSpline(body: Pair[], s: number): DxfEntity {
  const layer = firstStr(body, 8) || '0';
  const flags = firstCode(body, 70) || 0;
  // Aproximacao: usa pontos de ajuste (11/21) se houver; senao pontos de controle (10/20).
  const fitX: number[] = [], fitY: number[] = [], ctrlX: number[] = [], ctrlY: number[] = [];
  for (const p of body) {
    if (p.code === 11) fitX.push(num(p.value) * s);
    else if (p.code === 21) fitY.push(num(p.value) * s);
    else if (p.code === 10) ctrlX.push(num(p.value) * s);
    else if (p.code === 20) ctrlY.push(num(p.value) * s);
  }
  const useFit = fitX.length >= 2 && fitX.length === fitY.length;
  const xs = useFit ? fitX : ctrlX;
  const ys = useFit ? fitY : ctrlY;
  const pts: Array<{ x: number; y: number }> = [];
  const n = Math.min(xs.length, ys.length);
  for (let k = 0; k < n; k++) pts.push({ x: xs[k], y: ys[k] });
  return { type: 'SPLINE', layer, closed: (flags & 1) === 1, pts };
}

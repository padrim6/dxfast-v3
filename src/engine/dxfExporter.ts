import { GeometryResult, DxfExportOptions } from '../types/cad';
import { downloadBlob } from '../utils/download';

export const DEFAULT_DXF_OPTIONS: DxfExportOptions = {
  dxfVersion: 'R2000',
  layerCutName: 'CUT',
  layerCutColor: 7, // 7 = White/Black standard for CNC laser cutting
  layerBendName: 'BEND',
  layerBendColor: 3, // 3 = Green (Standard for press brake bend line)
  layerMarkName: 'MARK',
  layerMarkColor: 5, // 5 = Blue for laser etching / markings
  includeBendLines: true,
  includeMarkings: false,
  unit: 'mm',
  closedPolylinesOnly: true,
};

/**
 * Formats float number for DXF with 4 decimals and clean format.
 * Throws immediately if value is NaN or infinite to prevent silent DXF corruption.
 */
function formatDxfNum(val: number): string {
  if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
    throw new Error(`DXF Export Error: Invalid numerical coordinate encountered (${val}). Export aborted to prevent corrupt CNC/CAD output.`);
  }
  const fixed = val.toFixed(4);
  return fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0000$/, '.0');
}

/**
 * Generates an ultra-compatible, industry-standard AutoCAD DXF file (AC1015 R2000 or AC1009 R12)
 * Validated for AutoCAD, SolidWorks, Fusion 360, LibreCAD, CypCut, Lantek, Pronest, and SheetCAM.
 */
export function generateDxfR2000(
  geometry: GeometryResult,
  options: Partial<DxfExportOptions> = {}
): string {
  const opt: DxfExportOptions = { ...DEFAULT_DXF_OPTIONS, ...options };
  const lines: string[] = [];
  let handleCounter = 0x20;

  const getNextHandle = () => (handleCounter++).toString(16).toUpperCase();

  const add = (code: number, value: string | number) => {
    lines.push(code.toString());
    lines.push(value.toString());
  };

  const { minX, minY, maxX, maxY } = geometry.boundingBox;

  // ==========================================
  // 1. HEADER SECTION
  // ==========================================
  add(0, 'SECTION');
  add(2, 'HEADER');

  add(9, '$ACADVER');
  add(1, opt.dxfVersion === 'R12' ? 'AC1009' : 'AC1015');

  add(9, '$INSUNITS');
  add(70, 4); // 4 = Millimeters

  add(9, '$MEASUREMENT');
  add(70, 1); // 1 = Metric

  add(9, '$ANGBASE');
  add(50, 0.0);

  add(9, '$ANGDIR');
  add(70, 0);

  add(9, '$EXTMIN');
  add(10, formatDxfNum(minX));
  add(20, formatDxfNum(minY));
  add(30, '0.0');

  add(9, '$EXTMAX');
  add(10, formatDxfNum(maxX));
  add(20, formatDxfNum(maxY));
  add(30, '0.0');

  add(0, 'ENDSEC');

  // ==========================================
  // 2. TABLES SECTION
  // ==========================================
  add(0, 'SECTION');
  add(2, 'TABLES');

  // VPORT Table
  add(0, 'TABLE');
  add(2, 'VPORT');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTable');
  }
  add(70, 1);
  add(0, 'VPORT');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTableRecord');
    add(100, 'AcDbViewportTableRecord');
  }
  add(2, '*ACTIVE');
  add(70, 0);
  add(10, '0.0');
  add(20, '0.0');
  add(11, '1.0');
  add(21, '1.0');
  add(12, formatDxfNum((minX + maxX) / 2));
  add(22, formatDxfNum((minY + maxY) / 2));
  add(40, formatDxfNum(Math.max(100, maxY - minY + 40)));
  add(41, '1.4');
  add(0, 'ENDTAB');

  // LTYPE Table
  add(0, 'TABLE');
  add(2, 'LTYPE');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTable');
  }
  add(70, 3);

  // LTYPE: CONTINUOUS
  add(0, 'LTYPE');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTableRecord');
    add(100, 'AcDbLinetypeTableRecord');
  }
  add(2, 'CONTINUOUS');
  add(70, 0);
  add(3, 'Solid line');
  add(72, 65);
  add(73, 0);
  add(40, '0.0');

  // LTYPE: DASHED (for bend lines)
  add(0, 'LTYPE');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTableRecord');
    add(100, 'AcDbLinetypeTableRecord');
  }
  add(2, 'DASHED');
  add(70, 0);
  add(3, 'Dashed __ __ __');
  add(72, 65);
  add(73, 2);
  add(40, '12.7');
  add(49, '6.35');
  add(49, '-6.35');

  add(0, 'ENDTAB');

  // LAYER Table
  add(0, 'TABLE');
  add(2, 'LAYER');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTable');
  }
  add(70, 4);

  // Layer 0
  add(0, 'LAYER');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTableRecord');
    add(100, 'AcDbLayerTableRecord');
  }
  add(2, '0');
  add(70, 0);
  add(62, 7);
  add(6, 'CONTINUOUS');

  // Layer CUT
  add(0, 'LAYER');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTableRecord');
    add(100, 'AcDbLayerTableRecord');
  }
  add(2, opt.layerCutName);
  add(70, 0);
  add(62, opt.layerCutColor);
  add(6, 'CONTINUOUS');

  // Layer BEND
  if (opt.includeBendLines) {
    add(0, 'LAYER');
    if (opt.dxfVersion !== 'R12') {
      add(5, getNextHandle());
      add(100, 'AcDbSymbolTableRecord');
      add(100, 'AcDbLayerTableRecord');
    }
    add(2, opt.layerBendName);
    add(70, 0);
    add(62, opt.layerBendColor);
    add(6, 'DASHED');
  }

  // Layer MARK
  if (opt.includeMarkings) {
    add(0, 'LAYER');
    if (opt.dxfVersion !== 'R12') {
      add(5, getNextHandle());
      add(100, 'AcDbSymbolTableRecord');
      add(100, 'AcDbLayerTableRecord');
    }
    add(2, opt.layerMarkName);
    add(70, 0);
    add(62, opt.layerMarkColor);
    add(6, 'CONTINUOUS');
  }

  add(0, 'ENDTAB');

  // STYLE Table
  add(0, 'TABLE');
  add(2, 'STYLE');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTable');
  }
  add(70, 1);
  add(0, 'STYLE');
  if (opt.dxfVersion !== 'R12') {
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTableRecord');
    add(100, 'AcDbTextStyleTableRecord');
  }
  add(2, 'STANDARD');
  add(70, 0);
  add(40, '0.0');
  add(41, '1.0');
  add(50, '0.0');
  add(71, 0);
  add(42, '2.5');
  add(3, 'txt');
  add(4, '');
  add(0, 'ENDTAB');

  // BLOCK_RECORD Table (R2000 requirement)
  if (opt.dxfVersion !== 'R12') {
    add(0, 'TABLE');
    add(2, 'BLOCK_RECORD');
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTable');
    add(70, 2);

    add(0, 'BLOCK_RECORD');
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTableRecord');
    add(100, 'AcDbBlockTableRecord');
    add(2, '*MODEL_SPACE');

    add(0, 'BLOCK_RECORD');
    add(5, getNextHandle());
    add(100, 'AcDbSymbolTableRecord');
    add(100, 'AcDbBlockTableRecord');
    add(2, '*PAPER_SPACE');

    add(0, 'ENDTAB');
  }

  add(0, 'ENDSEC');

  // ==========================================
  // 3. BLOCKS SECTION
  // ==========================================
  add(0, 'SECTION');
  add(2, 'BLOCKS');

  if (opt.dxfVersion !== 'R12') {
    // Model space block
    add(0, 'BLOCK');
    add(5, getNextHandle());
    add(100, 'AcDbEntity');
    add(8, '0');
    add(100, 'AcDbBlockBegin');
    add(2, '*MODEL_SPACE');
    add(70, 0);
    add(10, '0.0');
    add(20, '0.0');
    add(30, '0.0');
    add(3, '*MODEL_SPACE');
    add(1, '');
    add(0, 'ENDBLK');
    add(5, getNextHandle());
    add(100, 'AcDbEntity');
    add(8, '0');
    add(100, 'AcDbBlockEnd');

    // Paper space block
    add(0, 'BLOCK');
    add(5, getNextHandle());
    add(100, 'AcDbEntity');
    add(8, '0');
    add(100, 'AcDbBlockBegin');
    add(2, '*PAPER_SPACE');
    add(70, 0);
    add(10, '0.0');
    add(20, '0.0');
    add(30, '0.0');
    add(3, '*PAPER_SPACE');
    add(1, '');
    add(0, 'ENDBLK');
    add(5, getNextHandle());
    add(100, 'AcDbEntity');
    add(8, '0');
    add(100, 'AcDbBlockEnd');
  }

  add(0, 'ENDSEC');

  // ==========================================
  // 4. ENTITIES SECTION
  // ==========================================
  add(0, 'SECTION');
  add(2, 'ENTITIES');

  // A. Outer Polylines (Cutting Contours)
  geometry.outerPolylines.forEach((poly) => {
    if (!poly.vertices || poly.vertices.length === 0) return;

    if (opt.dxfVersion === 'R12') {
      // R12 Classic 2D POLYLINE
      add(0, 'POLYLINE');
      add(8, opt.layerCutName);
      add(66, 1);
      add(10, '0.0');
      add(20, '0.0');
      add(30, '0.0');
      add(70, poly.isClosed ? 1 : 0);

      poly.vertices.forEach((v) => {
        add(0, 'VERTEX');
        add(8, opt.layerCutName);
        add(10, formatDxfNum(v.x));
        add(20, formatDxfNum(v.y));
        add(30, '0.0');
        if (v.bulge !== undefined && Math.abs(v.bulge) > 0.0001) {
          add(42, formatDxfNum(v.bulge));
        }
      });
      add(0, 'SEQEND');
      add(8, opt.layerCutName);
    } else {
      // R2000 LWPOLYLINE with correct Subclass Markers
      add(0, 'LWPOLYLINE');
      add(5, getNextHandle());
      add(100, 'AcDbEntity');
      add(8, opt.layerCutName);
      add(100, 'AcDbPolyline');
      add(90, poly.vertices.length);
      add(70, poly.isClosed ? 1 : 0);
      add(43, '0.0');

      poly.vertices.forEach((v) => {
        add(10, formatDxfNum(v.x));
        add(20, formatDxfNum(v.y));
        if (v.bulge !== undefined && Math.abs(v.bulge) > 0.0001) {
          add(42, formatDxfNum(v.bulge));
        }
      });
    }
  });

  // B. Inner Polylines (Cutouts, Slots, Keyways)
  geometry.innerPolylines.forEach((poly) => {
    if (!poly.vertices || poly.vertices.length === 0) return;

    if (opt.dxfVersion === 'R12') {
      add(0, 'POLYLINE');
      add(8, opt.layerCutName);
      add(66, 1);
      add(10, '0.0');
      add(20, '0.0');
      add(30, '0.0');
      add(70, poly.isClosed ? 1 : 0);

      poly.vertices.forEach((v) => {
        add(0, 'VERTEX');
        add(8, opt.layerCutName);
        add(10, formatDxfNum(v.x));
        add(20, formatDxfNum(v.y));
        add(30, '0.0');
        if (v.bulge !== undefined && Math.abs(v.bulge) > 0.0001) {
          add(42, formatDxfNum(v.bulge));
        }
      });
      add(0, 'SEQEND');
      add(8, opt.layerCutName);
    } else {
      add(0, 'LWPOLYLINE');
      add(5, getNextHandle());
      add(100, 'AcDbEntity');
      add(8, opt.layerCutName);
      add(100, 'AcDbPolyline');
      add(90, poly.vertices.length);
      add(70, poly.isClosed ? 1 : 0);
      add(43, '0.0');

      poly.vertices.forEach((v) => {
        add(10, formatDxfNum(v.x));
        add(20, formatDxfNum(v.y));
        if (v.bulge !== undefined && Math.abs(v.bulge) > 0.0001) {
          add(42, formatDxfNum(v.bulge));
        }
      });
    }
  });

  // C. Circles (Drilled and Laser-cut Holes)
  geometry.circles.forEach((circ) => {
    add(0, 'CIRCLE');
    if (opt.dxfVersion !== 'R12') {
      add(5, getNextHandle());
      add(100, 'AcDbEntity');
      add(8, opt.layerCutName);
      add(100, 'AcDbCircle');
    } else {
      add(8, opt.layerCutName);
    }
    add(10, formatDxfNum(circ.center.x));
    add(20, formatDxfNum(circ.center.y));
    add(30, '0.0');
    add(40, formatDxfNum(circ.radius));
  });

  // D. Bend Lines (Layer BEND)
  if (opt.includeBendLines && geometry.bendLines) {
    geometry.bendLines.forEach((bend) => {
      const sx = bend.startX !== undefined ? bend.startX : bend.positionX;
      const sy = bend.startY;
      const ex = bend.endX !== undefined ? bend.endX : bend.positionX;
      const ey = bend.endY;

      add(0, 'LINE');
      if (opt.dxfVersion !== 'R12') {
        add(5, getNextHandle());
        add(100, 'AcDbEntity');
        add(8, opt.layerBendName);
        add(100, 'AcDbLine');
      } else {
        add(8, opt.layerBendName);
      }
      add(10, formatDxfNum(sx));
      add(20, formatDxfNum(sy));
      add(30, '0.0');
      add(11, formatDxfNum(ex));
      add(21, formatDxfNum(ey));
      add(31, '0.0');
    });
  }

  add(0, 'ENDSEC');

  // ==========================================
  // 5. OBJECTS SECTION (R2000 requirement)
  // ==========================================
  if (opt.dxfVersion !== 'R12') {
    add(0, 'SECTION');
    add(2, 'OBJECTS');
    add(0, 'DICTIONARY');
    add(5, getNextHandle());
    add(100, 'AcDbDictionary');
    add(281, 1);
    add(0, 'ENDSEC');
  }

  // ==========================================
  // 6. END OF FILE
  // ==========================================
  add(0, 'EOF');

  // Return with standard Windows CRLF for CNC CAM compatibility
  return lines.join('\r\n') + '\r\n';
}

/**
 * Sanitizes a filename by removing invalid filesystem characters while preserving accents and valid symbols.
 */
export function sanitizeFilename(name: string, fallback: string = 'desenho'): string {
  const cleaned = name.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

/**
 * Direct Client-Side DXF File Download
 */
export function downloadDxfFile(
  filename: string,
  dxfContent: string
): void {
  const safeName = sanitizeFilename(filename.replace(/\.dxf$/i, ''), 'desenho');
  const blob = new Blob([dxfContent], { type: 'application/dxf;charset=utf-8' });
  // Download padrão em página de topo; fallback (nova aba + clipboard) quando
  // rodando dentro de iframe/sandbox, onde o download direto é bloqueado.
  void downloadBlob(blob, `${safeName}.dxf`, dxfContent);
}

/**
 * Types & Interfaces for CAD Rápido DXF Industrial Engine
 */

export type TemplateCategory = 'flat_sheet' | 'bent_profile';

export type TemplateFamily =
  | 'rectangular'
  | 'circular'
  | 'polygonal'
  | 'profile_bent'
  | 'special';

export type FeatureId =
  | 'fillet'         // Cantos arredondados (Raio R)
  | 'chamfer'        // Chanfros angulares
  | 'cornerHoles'    // Furos de fixação nos vértices
  | 'centerHole'     // Furo/recorte central
  | 'slottedHoles'   // Rasgos oblongos de regulagem
  | 'boltCircle'     // Furação circunferencial (Flange BCD)
  | 'gridHoles'      // Matriz de furação (Ventilação/Grelha)
  | 'keyway'         // Rasgo de chaveta
  | 'faceHoles';     // Furações modulares por face/aba de perfil dobrado

export interface FeatureState {
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export interface TemplateParamDef {
  label: string;
  unit: 'mm' | 'deg' | 'qty' | 'factor';
  min: number;
  max: number;
  step: number;
  default: number;
  description?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  category: TemplateCategory;
  family: TemplateFamily;
  description: string;
  iconName: string;
  compatibleFeatures: FeatureId[];
  baseParams: Record<string, TemplateParamDef>;
  defaultParams: Record<string, number>;
  defaultFeatures: Record<FeatureId, FeatureState>;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface LWPolylineVertex {
  x: number;
  y: number;
  bulge?: number; // tan(theta / 4) -> 0 for straight segment
}

export interface LWPolyline {
  vertices: LWPolylineVertex[];
  isClosed: boolean;
  layer: 'CUT' | 'BEND' | 'MARK';
}

export interface CircleElement {
  type: 'circle';
  center: Point2D;
  radius: number;
  layer: 'CUT' | 'BEND' | 'MARK';
}

export interface BendLine {
  id: string;
  faceIndex?: number;
  label: string;
  direction: 'UP' | 'DOWN';
  angleDeg: number;
  radiusMm: number;
  kFactor: number;
  orientation?: 'vertical' | 'horizontal';
  positionX: number; // Blank X coordinate or center
  positionY?: number;
  startX?: number;
  startY: number;
  endX?: number;
  endY: number;
  sheetThicknessMm?: number;
  bendAllowanceMm?: number;
  bendDeductionMm?: number;
  setbackMm?: number;
}

export interface FaceSectionInfo {
  index: number;
  name: string;
  widthNominalMm: number;
  widthBlankMm: number;
  startXBlankMm: number;
  endXBlankMm: number;
  heightMm: number;
}

export type FaceSection = FaceSectionInfo;

export interface DimensionCota {
  type: 'linear' | 'diameter' | 'radius' | 'angle' | 'bend';
  start: Point2D;
  end: Point2D;
  label: string;
  valueMm: number;
  orientation?: 'horizontal' | 'vertical' | 'aligned';
  offset?: number;
}

export interface GeometryMetrics {
  outerPerimeterMm: number;
  innerPerimeterMm: number;
  totalPerimeterMm: number;
  cutLengthMm: number;
  netAreaMm2: number;
  grossAreaMm2: number;
  piercingCount: number;
  bendCount: number;
  blankWidthMm: number;
  blankHeightMm: number;
}

export interface SanitizationWarning {
  field: string;
  message: string;
  type: 'warning' | 'correction' | 'info';
}

export interface GeometryIssue {
  code: string;                 // ex: 'HOLE_OUTSIDE_CONTOUR'
  severity: 'error' | 'warning' | 'info';
  message: string;              // texto em português, para o operador
  field?: string;               // parâmetro responsável, para foco na UI
  entityRef?: {                 // elemento a destacar no viewport
    kind: 'circle' | 'innerPolyline' | 'outerPolyline' | 'bendLine';
    index: number;
  };
}

export type GeometryError = GeometryIssue;

export interface GeometryResult {
  outerPolylines: LWPolyline[];
  innerPolylines: LWPolyline[];
  circles: CircleElement[];
  bendLines: BendLine[];
  faceSections?: FaceSectionInfo[];
  cotas: DimensionCota[];
  boundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  metrics: GeometryMetrics;
  warnings: SanitizationWarning[];
  errors: GeometryIssue[];
  unfoldingMath?: {
    thicknessMm: number;
    internalRadiusMm: number;
    kFactor: number;
    bendAngleDeg: number;
    setbackMm: number;
    bendAllowanceMm: number;
    bendDeductionMm: number;
    formulaExplanation: string;
  };
}

export interface DxfExportOptions {
  dxfVersion: 'R2000' | 'R12';
  layerCutName: string;
  layerCutColor: number; // AutoCAD Color Index (ACI) 1=Red, 7=White/Black
  layerBendName: string;
  layerBendColor: number; // 3=Green, 4=Cyan
  layerMarkName: string;
  layerMarkColor: number; // 5=Blue
  includeBendLines: boolean;
  includeMarkings: boolean;
  unit: 'mm';
  closedPolylinesOnly: boolean;
}

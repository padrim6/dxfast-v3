import {
  TemplateDefinition,
  FeatureState,
  FeatureId,
  LWPolyline,
  CircleElement,
  BendLine,
  FaceSectionInfo,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';
import { BendCalculationResult } from '../../utils/bendMath';

export interface TemplateExecutionContext {
  template: TemplateDefinition;
  params: Record<string, number>;
  features: Record<FeatureId, FeatureState>;
  sheetThickness: number;
}

export interface TemplateGeometryOutput {
  outerPolylines: LWPolyline[];
  innerPolylines: LWPolyline[];
  circles: CircleElement[];
  bendLines: BendLine[];
  faceSections?: FaceSectionInfo[];
  cotas: DimensionCota[];
  warnings: SanitizationWarning[];
  errors: GeometryIssue[];
  piercingCount: number;
  bendCount: number;
  blankWidthMm: number;
  blankHeightMm: number;
  unfoldingMath?: BendCalculationResult;
}

export type TemplateSolver = (context: TemplateExecutionContext) => TemplateGeometryOutput;

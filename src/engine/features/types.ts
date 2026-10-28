import {
  LWPolyline,
  CircleElement,
  DimensionCota,
  SanitizationWarning,
  GeometryIssue,
} from '../../types/cad';
import { SlotCapsule } from '../helpers';

export interface FeatureExecutionContext {
  outerPolylines: LWPolyline[];
  innerPolylines: LWPolyline[];
  circles: CircleElement[];
  cotas: DimensionCota[];
  warnings: SanitizationWarning[];
  errors: GeometryIssue[];
  totalInnerPerimeter: number;
  netArea: number;
  piercingCount: number;
  cornerHoleCenters: { x: number; y: number; r: number }[];
  slotCapsules: SlotCapsule[];
  centerHoleDia: number;
  filletR: number;
  chamferS: number;
}

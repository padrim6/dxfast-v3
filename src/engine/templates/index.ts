import { registerTemplate } from '../templateRegistry';
import { solveRectPlate } from './rectPlate';
import { solveCircleFlange } from './circleFlange';
import { solveOvalFlange } from './ovalFlange';
import { solvePolygonRegular } from './polygonRegular';
import { solveLiftingLug } from './liftingLug';
import { solveProfileL } from './profileL';
import { solveProfileU } from './profileU';
import { solveProfileZ } from './profileZ';
import { solveProfileHat } from './profileHat';
import { solveGateGuideU } from './gateGuideU';
import { solveLambrilZ } from './lambrilZ';
import { solveGateWeightBox } from './gateWeightBox';
import { solveBasePlate } from './basePlate';
import { solveGussetBracket } from './gussetBracket';
import { solveRufoFlashing } from './rufoFlashing';
import { solveTrapezoidPlate } from './trapezoidPlate';
import { solveCylinderDevelopment } from './cylinderDevelopment';
import { solveStarPolygon } from './starPolygon';

// Register Template Solvers
registerTemplate('rect_plate', solveRectPlate);
registerTemplate('circle_flange', solveCircleFlange);
registerTemplate('oval_flange', solveOvalFlange);
registerTemplate('polygon_regular', solvePolygonRegular);
registerTemplate('lifting_lug', solveLiftingLug);
registerTemplate('profile_l', solveProfileL);
registerTemplate('profile_u', solveProfileU);
registerTemplate('profile_z', solveProfileZ);
registerTemplate('profile_hat', solveProfileHat);
registerTemplate('gate_guide_u', solveGateGuideU);
registerTemplate('lambril_z', solveLambrilZ);
registerTemplate('gate_weight_box', solveGateWeightBox);
registerTemplate('base_plate', solveBasePlate);
registerTemplate('gusset_bracket', solveGussetBracket);
registerTemplate('rufo_flashing', solveRufoFlashing);
registerTemplate('trapezoid_plate', solveTrapezoidPlate);
registerTemplate('cylinder_development', solveCylinderDevelopment);
registerTemplate('star_polygon', solveStarPolygon);

export * from './types';
export * from './rectPlate';
export * from './circleFlange';
export * from './ovalFlange';
export * from './polygonRegular';
export * from './liftingLug';
export * from './profileL';
export * from './profileU';
export * from './profileZ';
export * from './profileHat';
export * from './gateGuideU';
export * from './lambrilZ';
export * from './gateWeightBox';
export * from './basePlate';
export * from './gussetBracket';
export * from './rufoFlashing';
export * from './trapezoidPlate';
export * from './cylinderDevelopment';
export * from './starPolygon';














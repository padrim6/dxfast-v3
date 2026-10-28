import { TemplateDefinition, FeatureState } from '../types/cad';
import { ParamBound, ParamBoundsMap } from './bounds/core';
import { bounds_circle_flange, bounds_polygon_regular, bounds_oval_flange } from './bounds/boundsCircular';
import {
  bounds_rect_plate,
  bounds_base_plate,
  bounds_lifting_lug,
  bounds_gusset_bracket,
  bounds_rufo_flashing,
  bounds_trapezoid_plate,
  bounds_cylinder_development,
  bounds_star_polygon,
} from './bounds/boundsPlates';
import {
  bounds_profile_u,
  bounds_profile_l,
  bounds_profile_z,
  bounds_profile_hat,
  bounds_lambril_z,
} from './bounds/boundsProfiles';
import { bounds_gate_guide_u, bounds_gate_weight_box } from './bounds/boundsAssemblies';

// Re-exporta os tipos para os importadores existentes (antes vinham daqui).
export type { ParamBound, ParamBoundsMap } from './bounds/core';

/**
 * Calcula os bounds dinâmicos dos parâmetros para a UI e as travas de validação.
 * Despacha para o módulo de bounds do template (um arquivo por família em
 * ./bounds/*). A lógica por template vive nesses módulos; aqui só roteia.
 */
export function calculateParamBounds(
  template: TemplateDefinition,
  params: Record<string, number>,
  features?: Record<string, FeatureState>
): ParamBoundsMap {
  const bounds: Record<string, ParamBound> = {};

  if (template.id === 'circle_flange' || template.family === 'circular') {
    bounds_circle_flange(template, params, features, bounds);
  } else if (template.id === 'polygon_regular') {
    bounds_polygon_regular(template, params, features, bounds);
  } else if (template.id === 'rect_plate') {
    bounds_rect_plate(template, params, features, bounds);
  } else if (template.id === 'profile_u') {
    bounds_profile_u(template, params, features, bounds);
  } else if (template.id === 'profile_l') {
    bounds_profile_l(template, params, features, bounds);
  } else if (template.id === 'profile_z') {
    bounds_profile_z(template, params, features, bounds);
  } else if (template.id === 'profile_hat') {
    bounds_profile_hat(template, params, features, bounds);
  } else if (template.id === 'lambril_z') {
    bounds_lambril_z(template, params, features, bounds);
  } else if (template.id === 'gate_guide_u') {
    bounds_gate_guide_u(template, params, features, bounds);
  } else if (template.id === 'gate_weight_box') {
    bounds_gate_weight_box(template, params, features, bounds);
  } else if (template.id === 'oval_flange') {
    bounds_oval_flange(template, params, features, bounds);
  } else if (template.id === 'lifting_lug') {
    bounds_lifting_lug(template, params, features, bounds);
  } else if (template.id === 'base_plate') {
    bounds_base_plate(template, params, features, bounds);
  } else if (template.id === 'gusset_bracket') {
    bounds_gusset_bracket(template, params, features, bounds);
  } else if (template.id === 'rufo_flashing') {
    bounds_rufo_flashing(template, params, features, bounds);
  } else if (template.id === 'trapezoid_plate') {
    bounds_trapezoid_plate(template, params, features, bounds);
  } else if (template.id === 'cylinder_development') {
    bounds_cylinder_development(template, params, features, bounds);
  } else if (template.id === 'star_polygon') {
    bounds_star_polygon(template, params, features, bounds);
  }

  return bounds;
}

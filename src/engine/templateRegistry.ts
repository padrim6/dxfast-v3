import { TemplateSolver } from './templates/types';

const registry: Record<string, TemplateSolver> = {};

export function registerTemplate(id: string, solver: TemplateSolver): void {
  registry[id] = solver;
}

export function getTemplateSolver(id: string): TemplateSolver | undefined {
  return registry[id];
}

export function isTemplateRegistered(id: string): boolean {
  return Boolean(registry[id]);
}

export function getRegisteredTemplateIds(): string[] {
  return Object.keys(registry);
}

import * as THREE from 'three';

/**
 * Recursively traverses a Three.js Object3D hierarchy and disposes all geometries,
 * materials, and attached textures (including canvas textures).
 */
export function disposeThreeObject(root: THREE.Object3D | null | undefined): void {
  if (!root) return;

  root.traverse((child) => {
    // 1. Dispose Geometry
    if ('geometry' in child && (child as any).geometry) {
      const geo = (child as any).geometry;
      if (typeof geo.dispose === 'function') {
        try {
          geo.dispose();
        } catch (e) {
          // ignore error
        }
      }
    }

    // 2. Dispose Materials and Textures
    if ('material' in child && (child as any).material) {
      const matOrArray = (child as any).material;
      const materials: THREE.Material[] = Array.isArray(matOrArray) ? matOrArray : [matOrArray];

      materials.forEach((mat) => {
        if (!mat) return;

        // Traverse all properties on the material to find any textures
        for (const key of Object.keys(mat)) {
          try {
            const prop = (mat as any)[key];
            if (prop && typeof prop === 'object') {
              if ((prop.isTexture || prop instanceof THREE.Texture) && typeof prop.dispose === 'function') {
                prop.dispose();
              }
            }
          } catch (e) {
            // ignore error
          }
        }

        // Dispose the material itself
        if (typeof mat.dispose === 'function') {
          try {
            mat.dispose();
          } catch (e) {
            // ignore error
          }
        }
      });
    }
  });
}

/**
 * Properly disposes a WebGLRenderer instance and forces WebGL context loss
 * to prevent leaking the browser's hardware WebGL contexts.
 */
export function disposeThreeRenderer(renderer: THREE.WebGLRenderer | null | undefined): void {
  if (!renderer) return;

  try {
    renderer.dispose();
  } catch (e) {
    // ignore error
  }

  try {
    if (typeof renderer.forceContextLoss === 'function') {
      renderer.forceContextLoss();
    }
  } catch (e) {
    // ignore error
  }
}

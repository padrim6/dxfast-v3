import * as THREE from 'three';
import { GeometryResult, TemplateDefinition, LWPolyline } from '../types/cad';
import {
  addPolylineToPath,
  createProfileShapeFromGeometry,
  mapBlankPointToFolded,
  getFoldedPointTransform,
  create3DHoleMesh,
  create3DSlotMesh,
  measureSlot,
} from '../utils/foldedMeshBuilder';
import { disposeThreeObject, disposeThreeRenderer } from '../utils/threeCleanup';

/**
 * Converts CAD LWPolyline with bulges (arcs and lines) into a Three.js Path or Shape
 */
function addPolylineToThreePath(poly: LWPolyline, path: THREE.Path | THREE.Shape) {
  addPolylineToPath(poly, path);
}

export interface SnapshotHoleResult {
  exists: boolean;
  faceIndex: number;
  posX: number;
  posY: number;
  diameter: number;
  x: number;
  y: number;
  z: number;
  rotZ: number;
  normal?: { x: number; y: number; z: number };
}

/**
 * Computes hole placement as defined by the snapshot logic
 */
export function getSnapshotHoleTransform(
  geometry: GeometryResult,
  templateId: string,
  hole: { cx: number; cy: number; type: 'circle' | 'slot'; radius: number; diameter: number }
): SnapshotHoleResult {
  const isBentProfile =
    (geometry.bendLines && geometry.bendLines.length > 0) ||
    (geometry.faceSections && geometry.faceSections.length > 1);
  const blankW = geometry.boundingBox.width;
  const blankH = geometry.boundingBox.height;
  const L = Math.max(20, geometry.metrics.blankHeightMm || 300);

  if (!isBentProfile) {
    if (hole.type === 'circle' && hole.radius <= 0.2) {
      return { exists: false, faceIndex: 0, posX: 0, posY: 0, diameter: hole.diameter, x: 0, y: 0, z: 0, rotZ: 0 };
    }
    return {
      exists: true,
      faceIndex: 0,
      posX: hole.cx + blankW / 2,
      posY: hole.cy + blankH / 2,
      diameter: hole.diameter,
      x: hole.cx + blankW / 2,
      y: hole.cy + blankH / 2,
      z: 0,
      rotZ: 0,
      normal: { x: 0, y: 1, z: 0 },
    };
  }

  if (hole.type === 'circle' && hole.radius <= 0.5) {
    return { exists: false, faceIndex: 0, posX: 0, posY: 0, diameter: hole.diameter, x: 0, y: 0, z: 0, rotZ: 0 };
  }

  const tf = getFoldedPointTransform(geometry, templateId, hole.cx, hole.cy);
  return {
    exists: true,
    faceIndex: tf.faceIndex,
    posX: tf.distFromFaceStartMm ?? 0,
    posY: tf.z + L / 2,
    diameter: hole.diameter,
    x: tf.x,
    y: tf.y,
    z: tf.z,
    rotZ: tf.rotZ,
    normal: tf.normal,
  };
}

/**
 * Renders a high-resolution, solid shaded 3D isometric snapshot using Three.js offscreen renderer.
 * Produces industrial CAD standard "Shaded with Edges" output on a clean white background.
 * Consumes GeometryResult as the single source of truth for geometry dimensions.
 */
export function render3dIsometricSnapshot(
  geometry: GeometryResult,
  template: TemplateDefinition,
  params: Record<string, number>,
  thicknessMm?: number,
  outputWidth: number = 1000,
  outputHeight: number = 650
): string | null {
  if (typeof document === 'undefined') return null;

  try {
    const t = Math.max(0.5, thicknessMm || geometry.unfoldingMath?.thicknessMm || (geometry.metrics as any)?.thickness || 3.0);
    const RiSafe = Math.max(0.5, geometry.unfoldingMath?.internalRadiusMm ?? 3.0);
    const isBentProfile = template.category === 'bent_profile' || (geometry.bendLines && geometry.bendLines.length > 0);

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true,
    });

    renderer.setSize(outputWidth, outputHeight, false);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0xffffff, 0); // Transparent / clean background
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();

    // Studio Lighting
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
    keyLight.position.set(200, 300, 250);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.7);
    fillLight.position.set(-200, 150, -150);
    scene.add(fillLight);

    const topLight = new THREE.DirectionalLight(0xffffff, 0.6);
    topLight.position.set(0, 400, 0);
    scene.add(topLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    // Industrial Solid Steel / Aluminum Material
    const steelMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4d8df, // Slate metallic grey
      roughness: 0.32,
      metalness: 0.25,
      side: THREE.DoubleSide,
    });

    const edgeLineMaterial = new THREE.LineBasicMaterial({
      color: 0x000000, // Black ink silhouette
      linewidth: 2,
    });

    const meshGroup = new THREE.Group();

    if (!isBentProfile) {
      // ---------------------------------------------------------------------
      // 2D FLAT PLATE / FLANGE / WASHER / LUG EXTRUSION
      // ---------------------------------------------------------------------
      const shape = new THREE.Shape();

      if (geometry.outerPolylines && geometry.outerPolylines.length > 0) {
        addPolylineToThreePath(geometry.outerPolylines[0], shape);
      } else {
        const w = Math.max(20, geometry.boundingBox.width);
        const h = Math.max(20, geometry.boundingBox.height);
        shape.moveTo(-w / 2, -h / 2);
        shape.lineTo(w / 2, -h / 2);
        shape.lineTo(w / 2, h / 2);
        shape.lineTo(-w / 2, h / 2);
        shape.closePath();
      }

      // Add inner holes (polylines)
      if (geometry.innerPolylines && geometry.innerPolylines.length > 0) {
        geometry.innerPolylines.forEach((poly) => {
          const holePath = new THREE.Path();
          addPolylineToThreePath(poly, holePath);
          shape.holes.push(holePath);
        });
      }

      // Add circular holes
      if (geometry.circles && geometry.circles.length > 0) {
        geometry.circles.forEach((circ) => {
          if (circ.radius <= 0.2) return;
          const holePath = new THREE.Path();
          holePath.absarc(circ.center.x, circ.center.y, circ.radius, 0, Math.PI * 2, true);
          shape.holes.push(holePath);
        });
      }

      const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
        steps: 1,
        depth: t,
        bevelEnabled: false,
      });

      extrudeGeo.center();
      // Lay flat in XZ plane with thickness along Y
      extrudeGeo.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(extrudeGeo, steelMaterial);
      meshGroup.add(mesh);

      const edges = new THREE.EdgesGeometry(extrudeGeo, 20);
      const edgeLines = new THREE.LineSegments(edges, edgeLineMaterial);
      meshGroup.add(edgeLines);
    } else {
      // ---------------------------------------------------------------------
      // 3D PARAMETRIC BENT PROFILE (U, L, Z, HAT, ETC.)
      // ---------------------------------------------------------------------
      const L = Math.max(20, geometry.metrics.blankHeightMm || 300);
      const bendAngle = geometry.unfoldingMath?.bendAngleDeg ?? 90;

      const profileShape = createProfileShapeFromGeometry(geometry, template.id);
      // Unificação em fonte única: a malha extrudada do perfil dobrado é estritamente sólida.
      // Recortes na seção transversal são eliminados; furos e rasgos são representados
      // exclusivamente pelos meshes 3D posicionados via getSnapshotHoleTransform (getFoldedPointTransform).
      profileShape.holes = [];

      const extrudeGeo = new THREE.ExtrudeGeometry(profileShape, {
        steps: 1,
        depth: L,
        bevelEnabled: false,
      });

      extrudeGeo.computeBoundingBox();
      const rawBbox = extrudeGeo.boundingBox ? extrudeGeo.boundingBox.clone() : new THREE.Box3();
      const centerOffset = new THREE.Vector3();
      rawBbox.getCenter(centerOffset);

      extrudeGeo.center();

      const mesh = new THREE.Mesh(extrudeGeo, steelMaterial);
      meshGroup.add(mesh);

      const edges = new THREE.EdgesGeometry(extrudeGeo, 20);
      const edgeLines = new THREE.LineSegments(edges, edgeLineMaterial);
      meshGroup.add(edgeLines);

      // Optional Multi-Blade Assembly Preview for Lambril Z
      if (template.id === 'lambril_z' && (params?.showAssembly ?? 0) !== 0) {
        const faces = geometry.faceSections || [];
        const fA = faces[1]?.widthNominalMm ?? 95;
        const fC = faces[3]?.widthNominalMm ?? 95;
        const pitchX = fA + fC;

        const ghostMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          metalness: 0.3,
          roughness: 0.5,
          transparent: true,
          opacity: 0.35,
        });
        const ghostEdgeMat = new THREE.LineBasicMaterial({
          color: 0x0284c7,
          transparent: true,
          opacity: 0.45,
        });

        // Left blade
        const meshLeft = new THREE.Mesh(extrudeGeo, ghostMat);
        meshLeft.position.set(-pitchX, 0, 0);
        meshGroup.add(meshLeft);
        const linesLeft = new THREE.LineSegments(edges, ghostEdgeMat);
        linesLeft.position.set(-pitchX, 0, 0);
        meshGroup.add(linesLeft);

        // Right blade
        const meshRight = new THREE.Mesh(extrudeGeo, ghostMat);
        meshRight.position.set(pitchX, 0, 0);
        meshGroup.add(meshRight);
        const linesRight = new THREE.LineSegments(edges, ghostEdgeMat);
        linesRight.position.set(pitchX, 0, 0);
        meshGroup.add(linesRight);
      }

      // Render 3D through-holes (both circular and slotted)
      const holeMat = new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        metalness: 0.8,
        roughness: 0.3,
      });
      const holeEdgeMat = new THREE.LineBasicMaterial({
        color: 0x020617,
        linewidth: 1.5,
      });

      // 1. Circular Holes
      if (geometry.circles && geometry.circles.length > 0) {
        geometry.circles.forEach((circ) => {
          if (circ.radius <= 0.5) return;
          const tf = getSnapshotHoleTransform(geometry, template.id, {
            cx: circ.center.x,
            cy: circ.center.y,
            type: 'circle',
            radius: circ.radius,
            diameter: circ.radius * 2,
          });
          if (!tf.exists) return;

          const cylMesh = create3DHoleMesh(circ.radius, t, holeMat, holeEdgeMat, tf.normal);
          cylMesh.position.set(tf.x - centerOffset.x, tf.y - centerOffset.y, tf.z);
          meshGroup.add(cylMesh);
        });
      }

      // 2. Slotted / Oblong Holes (innerPolylines)
      if (geometry.innerPolylines && geometry.innerPolylines.length > 0) {
        geometry.innerPolylines.forEach((poly) => {
          if (!poly.vertices || poly.vertices.length < 2) return;
          const slot = measureSlot(poly);
          if (slot.length <= 0.5) return;

          const tf = getSnapshotHoleTransform(geometry, template.id, {
            cx: slot.centerX,
            cy: slot.centerY,
            type: 'slot',
            radius: slot.width / 2,
            diameter: slot.width,
          });
          if (!tf.exists) return;

          const slotMesh = create3DSlotMesh(slot.length, slot.width, t, holeMat, holeEdgeMat, slot.isAlongZ, tf.normal);
          slotMesh.position.set(tf.x - centerOffset.x, tf.y - centerOffset.y, tf.z);
          meshGroup.add(slotMesh);
        });
      }
    }

    scene.add(meshGroup);

    // Compute bounding box and framing
    const bbox = new THREE.Box3().setFromObject(meshGroup);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 20);

    const aspect = outputWidth / outputHeight;
    const viewSize = maxDim * 1.45;

    const camera = new THREE.OrthographicCamera(
      (-viewSize * aspect) / 2,
      (viewSize * aspect) / 2,
      viewSize / 2,
      -viewSize / 2,
      1,
      3000
    );

    const isoDir = new THREE.Vector3(1.35, 1.1, 1.65).normalize();
    const camDistance = 1000;
    camera.position.copy(center).addScaledVector(isoDir, camDistance);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    // Render snapshot
    renderer.render(scene, camera);
    const dataUrl = canvas.toDataURL('image/png');

    // Clean up WebGL resources
    disposeThreeObject(scene);
    disposeThreeRenderer(renderer);

    return dataUrl;
  } catch (err) {
    console.warn('Error generating 3D isometric snapshot:', err);
    return null;
  }
}

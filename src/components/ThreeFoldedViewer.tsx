import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import * as THREE from 'three';
import { AlertTriangle, Grid } from 'lucide-react';
import { GeometryResult, TemplateDefinition } from '../types/cad';

const GRID_DIVISIONS = 56;
const GRID_STEP_SERIES = [10, 25, 50, 100, 250, 500];
import {
  addPolylineToPath,
  createProfileShapeFromGeometry,
  getFoldedPointTransform,
  create3DHoleMesh,
  create3DSlotMesh,
  measureSlot,
} from '../utils/foldedMeshBuilder';
import { disposeThreeObject, disposeThreeRenderer } from '../utils/threeCleanup';

/**
 * Creates clean high-resolution technical dimension text mesh oriented in 3D (No rectangular background box)
 */
function createTechnicalTextMesh(
  labelText: string,
  accentColor: string = '#f97316'
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  const canvasHeight = 120;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  let baseWidth = 50;
  let baseHeight = 12;

  if (ctx) {
    ctx.font = 'bold 44px "JetBrains Mono", -apple-system, monospace';
    const textMetrics = ctx.measureText(labelText);
    const measuredWidth = Math.max(120, Math.ceil(textMetrics.width));

    canvas.width = measuredWidth + 80;

    ctx.font = 'bold 44px "JetBrains Mono", -apple-system, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fine dark outline
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.95)';
    ctx.lineWidth = 8;
    ctx.lineJoin = 'round';
    ctx.strokeText(labelText, canvas.width / 2, canvas.height / 2);

    // Crisp colored text fill
    ctx.fillStyle = accentColor;
    ctx.fillText(labelText, canvas.width / 2, canvas.height / 2);

    const textAspect = (measuredWidth + 80) / canvasHeight;
    baseHeight = 20;
    baseWidth = baseHeight * textAspect;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 999;
  mesh.userData = {
    isCotaText: true,
    baseWidth,
    baseHeight,
  };
  mesh.scale.set(baseWidth, baseHeight, 1);
  return mesh;
}

/**
 * Builds a 3D linear dimension with witness lines and text placed PARALLEL to the dimension line
 */
function create3DLinearDimension(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  paramLabel: string,
  paramValue: number | string,
  unit: string = 'mm',
  offsetVec?: THREE.Vector3,
  color: number = 0xf97316
): THREE.Group {
  const group = new THREE.Group();

  const off = offsetVec || new THREE.Vector3(0, 0, 0);
  const q1 = p1.clone().add(off);
  const q2 = p2.clone().add(off);

  const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2, depthTest: false });
  const extMat = new THREE.LineDashedMaterial({
    color: 0x94a3b8,
    dashSize: 3,
    gapSize: 2,
    depthTest: false,
    opacity: 0.7,
    transparent: true,
  });

  // Main dimension line
  const mainGeo = new THREE.BufferGeometry().setFromPoints([q1, q2]);
  const mainLine = new THREE.Line(mainGeo, lineMat);
  mainLine.renderOrder = 998;
  group.add(mainLine);

  // Extension witness lines if offset is non-zero
  if (off.lengthSq() > 0.1) {
    const ext1Geo = new THREE.BufferGeometry().setFromPoints([p1, q1]);
    const ext1 = new THREE.Line(ext1Geo, extMat);
    ext1.computeLineDistances();
    ext1.renderOrder = 997;
    group.add(ext1);

    const ext2Geo = new THREE.BufferGeometry().setFromPoints([p2, q2]);
    const ext2 = new THREE.Line(ext2Geo, extMat);
    ext2.computeLineDistances();
    ext2.renderOrder = 997;
    group.add(ext2);
  }

  // End tick points
  const sphereGeo = new THREE.SphereGeometry(1.2, 12, 12);
  const sphereMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const m1 = new THREE.Mesh(sphereGeo, sphereMat);
  m1.position.copy(q1);
  m1.renderOrder = 999;
  const m2 = new THREE.Mesh(sphereGeo, sphereMat);
  m2.position.copy(q2);
  m2.renderOrder = 999;
  group.add(m1, m2);

  // Format label
  const valStr = typeof paramValue === 'number' ? `${paramValue}${unit ? ' ' + unit : ''}` : `${paramValue}`;
  const labelText = paramLabel.includes(':') || paramLabel.includes('Ø') || paramLabel.includes('(') ? `${valStr}` : `${paramLabel}: ${valStr}`;

  const hexStr = `#${color.toString(16).padStart(6, '0')}`;
  const textMesh = createTechnicalTextMesh(labelText, hexStr);

  const dir = new THREE.Vector3().subVectors(q2, q1);
  const len = dir.length();
  const normDir = len > 0.0001 ? dir.clone().normalize() : new THREE.Vector3(1, 0, 0);

  const isXYPlane = Math.abs(q1.z - q2.z) < 1.0 && Math.abs(normDir.z) < 0.2;

  let normal = new THREE.Vector3(0, 0, 0);
  let angle = 0;

  if (isXYPlane) {
    angle = Math.atan2(normDir.y, normDir.x);
    if (angle > Math.PI / 2) {
      angle -= Math.PI;
    } else if (angle < -Math.PI / 2) {
      angle += Math.PI;
    }

    textMesh.rotation.z = angle;
    normal = new THREE.Vector3(-normDir.y, normDir.x, 0).normalize();
    if (off.lengthSq() > 0.1 && normal.dot(off) < 0) {
      normal.negate();
    }
  } else {
    angle = Math.atan2(normDir.z, normDir.x);
    if (angle > Math.PI / 2) {
      angle -= Math.PI;
    } else if (angle < -Math.PI / 2) {
      angle += Math.PI;
    }

    textMesh.rotation.x = -Math.PI / 2;
    textMesh.rotation.z = angle;

    normal = new THREE.Vector3(-normDir.z, 0, normDir.x).normalize();
    if (off.lengthSq() > 0.1 && normal.dot(off) < 0) {
      normal.negate();
    }
  }

  const mid = new THREE.Vector3().addVectors(q1, q2).multiplyScalar(0.5);
  const textOffset = 6.0;
  textMesh.position.copy(mid).addScaledVector(normal, textOffset);
  textMesh.position.z += 0.3;
  group.add(textMesh);

  return group;
}

/**
 * Builds a 3D Callout dimension (e.g. for bending radius Ri)
 */
function create3DCalloutDimension(
  targetPos: THREE.Vector3,
  paramLabel: string,
  paramValue: number | string,
  unit: string = 'mm',
  offsetVec: THREE.Vector3 = new THREE.Vector3(-25, 20, 0),
  color: number = 0x10b981
): THREE.Group {
  const group = new THREE.Group();
  const textPos = targetPos.clone().add(offsetVec);

  const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2, depthTest: false });

  const kneePos = new THREE.Vector3(textPos.x - 6, textPos.y, textPos.z);
  const leaderGeo = new THREE.BufferGeometry().setFromPoints([targetPos, kneePos, textPos]);
  const leaderLine = new THREE.Line(leaderGeo, lineMat);
  leaderLine.renderOrder = 998;
  group.add(leaderLine);

  const dotGeo = new THREE.SphereGeometry(1.2, 12, 12);
  const dotMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.position.copy(targetPos);
  dot.renderOrder = 999;
  group.add(dot);

  const valStr = typeof paramValue === 'number' ? `${paramValue}${unit ? ' ' + unit : ''}` : `${paramValue}`;
  const labelText = `${paramLabel}: ${valStr}`;

  const hexStr = `#${color.toString(16).padStart(6, '0')}`;
  const textMesh = createTechnicalTextMesh(labelText, hexStr);
  textMesh.position.copy(textPos);
  textMesh.position.z += 0.3;
  group.add(textMesh);

  return group;
}

export interface ThreeFoldedViewerHandle {
  resetCamera: () => void;
  setNamedView: (view: 'iso' | 'front') => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomByDelta: (deltaY: number) => void;
  toggleCotas: () => void;
}

export interface ThreeFoldedViewerProps {
  geometry: GeometryResult;
  template: TemplateDefinition;
  params: Record<string, number>;
  show3dCotas?: boolean;
  activeView?: 'iso' | 'front';
  onActiveViewChange?: (view: 'iso' | 'front') => void;
  onZoomChange?: (zoomPercent: number) => void;
}

export const ThreeFoldedViewer = forwardRef<ThreeFoldedViewerHandle, ThreeFoldedViewerProps>(
  (
    {
      geometry,
      template,
      params,
      show3dCotas = false,
      activeView: externalActiveView,
      onActiveViewChange,
      onZoomChange,
    },
    ref
  ) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const meshGroupRef = useRef<THREE.Group | null>(null);
    const gridHelperRef = useRef<THREE.GridHelper | null>(null);
    const lastTemplateIdRef = useRef<string>(template.id);
    const baseRadiusRef = useRef<number>(450);

    const [gridStepMm, setGridStepMm] = useState<number>(25);
    const [internalActiveView, setInternalActiveView] = useState<'iso' | 'front'>('iso');
    const currentActiveView = externalActiveView ?? internalActiveView;

    const isDraggingRef = useRef<boolean>(false);
    const dragButtonRef = useRef<number>(0);
    const previousMousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    const sphericalRef = useRef<{ radius: number; theta: number; phi: number }>({
      radius: 450,
      theta: Math.PI / 4,
      phi: Math.PI / 3.2,
    });
    const targetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 0));

    const updateCamera = useCallback(() => {
      if (!cameraRef.current) return;
      const { radius, theta, phi } = sphericalRef.current;
      const target = targetRef.current;

      cameraRef.current.position.x = target.x + radius * Math.sin(phi) * Math.sin(theta);
      cameraRef.current.position.y = target.y + radius * Math.cos(phi);
      cameraRef.current.position.z = target.z + radius * Math.sin(phi) * Math.cos(theta);
      cameraRef.current.lookAt(target);

      if (rendererRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }

      if (onZoomChange && baseRadiusRef.current > 0) {
        const zoomRatio = baseRadiusRef.current / radius;
        const zoomPercent = Math.round(zoomRatio * 100);
        onZoomChange(zoomPercent);
      }
    }, [onZoomChange]);

    const resetCamera = useCallback(() => {
      const radius = baseRadiusRef.current || 450;
      sphericalRef.current = {
        radius,
        theta: Math.PI / 4,
        phi: Math.PI / 3.2,
      };
      setInternalActiveView('iso');
      onActiveViewChange?.('iso');
      updateCamera();
    }, [onActiveViewChange, updateCamera]);

    const setNamedView = useCallback(
      (view: 'iso' | 'front') => {
        setInternalActiveView(view);
        onActiveViewChange?.(view);
        const radius = sphericalRef.current.radius || baseRadiusRef.current || 450;

        if (view === 'iso') {
          sphericalRef.current = {
            radius,
            theta: Math.PI / 4,
            phi: Math.PI / 3.2,
          };
        } else if (view === 'front') {
          sphericalRef.current = {
            radius,
            theta: 0,
            phi: Math.PI / 2,
          };
        }
        updateCamera();
      },
      [onActiveViewChange, updateCamera]
    );

    const zoomIn = useCallback(() => {
      sphericalRef.current.radius = Math.max(30, sphericalRef.current.radius * 0.85);
      updateCamera();
    }, [updateCamera]);

    const zoomOut = useCallback(() => {
      sphericalRef.current.radius = Math.min(3000, sphericalRef.current.radius * 1.18);
      updateCamera();
    }, [updateCamera]);

    const zoomByDelta = useCallback(
      (deltaY: number) => {
        const factor = Math.min(Math.max(Math.pow(1.0018, deltaY), 0.75), 1.35);
        sphericalRef.current.radius = Math.max(30, Math.min(3000, sphericalRef.current.radius * factor));
        updateCamera();
      },
      [updateCamera]
    );

    useImperativeHandle(
      ref,
      () => ({
        resetCamera,
        setNamedView,
        zoomIn,
        zoomOut,
        zoomByDelta,
        toggleCotas: () => {},
      }),
      [resetCamera, setNamedView, zoomIn, zoomOut, zoomByDelta]
    );

    // Sync external view prop
    useEffect(() => {
      if (externalActiveView && externalActiveView !== internalActiveView) {
        setNamedView(externalActiveView);
      }
    }, [externalActiveView, internalActiveView, setNamedView]);

    // Initialize Scene
    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const width = container.clientWidth || 600;
      const height = container.clientHeight || 450;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0f172a); // Premium dark slate background
      sceneRef.current = scene;

      const camera = new THREE.PerspectiveCamera(42, width / height, 1, 5000);
      cameraRef.current = camera;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
        logarithmicDepthBuffer: true,
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;

      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // Studio Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambientLight);

      const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.4);
      dirLight1.position.set(300, 500, 300);
      dirLight1.castShadow = true;
      dirLight1.shadow.mapSize.width = 2048;
      dirLight1.shadow.mapSize.height = 2048;
      dirLight1.shadow.camera.near = 50;
      dirLight1.shadow.camera.far = 2500;
      const d = 500;
      dirLight1.shadow.camera.left = -d;
      dirLight1.shadow.camera.right = d;
      dirLight1.shadow.camera.top = d;
      dirLight1.shadow.camera.bottom = -d;
      scene.add(dirLight1);

      const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.45);
      dirLight2.position.set(-300, 150, -300);
      scene.add(dirLight2);

      const dirLight3 = new THREE.DirectionalLight(0xffedd5, 0.35);
      dirLight3.position.set(0, -300, 200);
      scene.add(dirLight3);

      // Workbench Grid resting at Y = 0
      const gridHelper = new THREE.GridHelper(1400, GRID_DIVISIONS, 0x334155, 0x1e293b);
      gridHelper.position.y = 0;
      scene.add(gridHelper);
      gridHelperRef.current = gridHelper;

      const meshGroup = new THREE.Group();
      scene.add(meshGroup);
      meshGroupRef.current = meshGroup;

      updateCamera();

    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
      rendererRef.current.render(scene, cameraRef.current);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (sceneRef.current) {
        disposeThreeObject(sceneRef.current);
      }
      if (rendererRef.current) {
        disposeThreeRenderer(rendererRef.current);
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
      }
    };
  }, [updateCamera]);

  // Build Geometry (Fully consuming GeometryResult)
  useEffect(() => {
    if (!sceneRef.current || !meshGroupRef.current) return;

    const meshGroup = meshGroupRef.current;
    // Dispose previous children including all materials, textures, and geometries
    while (meshGroup.children.length > 0) {
      const child = meshGroup.children[0];
      meshGroup.remove(child);
      disposeThreeObject(child);
    }

    const t = Math.max(0.5, geometry.unfoldingMath?.thicknessMm || (geometry.metrics as any)?.thickness || 3.0);
    const isBentProfile = template.category === 'bent_profile' || (geometry.bendLines && geometry.bendLines.length > 0);

    const steelMaterial = new THREE.MeshStandardMaterial({
      color: 0xd4d8df, // Tom cinza claro (chapa metálica)
      metalness: 0.22,
      roughness: 0.38,
      side: THREE.FrontSide,
    });

    const edgeLineMaterial = new THREE.LineBasicMaterial({
      color: 0x000000, // Arestas destacadas em preto
      linewidth: 2,
    });

    if (!isBentProfile) {
      // ---------------------------------------------------------------------
      // 2D FLAT PLATE / FLANGE / WASHER / LUG EXTRUSION
      // ---------------------------------------------------------------------
      const shape = new THREE.Shape();

      if (geometry.outerPolylines && geometry.outerPolylines.length > 0) {
        addPolylineToPath(geometry.outerPolylines[0], shape);
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
          addPolylineToPath(poly, holePath);
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
      extrudeGeo.rotateX(-Math.PI / 2);

      const mesh = new THREE.Mesh(extrudeGeo, steelMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      meshGroup.add(mesh);

      const edges = new THREE.EdgesGeometry(extrudeGeo, 20);
      const edgeLines = new THREE.LineSegments(edges, edgeLineMaterial);
      meshGroup.add(edgeLines);

      // Flat Sheet Cotas
      if (show3dCotas) {
        const cotaGroup = new THREE.Group();
        const W = geometry.boundingBox.width;
        const H = geometry.boundingBox.height;
        const halfW = W / 2;
        const halfH = H / 2;

        cotaGroup.add(
          create3DLinearDimension(
            new THREE.Vector3(-halfW, t / 2, halfH),
            new THREE.Vector3(halfW, t / 2, halfH),
            'W',
            W,
            'mm',
            new THREE.Vector3(0, 0, 25)
          )
        );

        cotaGroup.add(
          create3DLinearDimension(
            new THREE.Vector3(halfW, t / 2, -halfH),
            new THREE.Vector3(halfW, t / 2, halfH),
            'H',
            H,
            'mm',
            new THREE.Vector3(25, 0, 0)
          )
        );

        meshGroup.add(cotaGroup);
      }
    } else {
      // ---------------------------------------------------------------------
      // 3D PARAMETRIC BENT PROFILE (U, L, Z, HAT, ETC.)
      // ---------------------------------------------------------------------
      const RiSafe = Math.max(0.5, geometry.unfoldingMath?.internalRadiusMm ?? 3.0);
      const L = Math.max(20, geometry.metrics.blankHeightMm || 300);
      const bendAngle = geometry.unfoldingMath?.bendAngleDeg ?? 90;

      const profileShape = createProfileShapeFromGeometry(geometry, template.id);
      // Unificação em fonte única: a malha extrudada do perfil dobrado é estritamente sólida.
      // Recortes na seção transversal são eliminados; furos e rasgos são representados
      // exclusivamente pelos meshes 3D posicionados via getFoldedPointTransform.
      profileShape.holes = [];

      const extrudeSettings: THREE.ExtrudeGeometryOptions = {
        steps: 1,
        depth: L,
        bevelEnabled: false,
      };

      const extrudeGeo = new THREE.ExtrudeGeometry(profileShape, extrudeSettings);
      extrudeGeo.computeBoundingBox();
      const rawBbox = extrudeGeo.boundingBox ? extrudeGeo.boundingBox.clone() : new THREE.Box3();
      const centerOffset = new THREE.Vector3();
      rawBbox.getCenter(centerOffset);

      extrudeGeo.center();

      const mesh = new THREE.Mesh(extrudeGeo, steelMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
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

        const meshLeft = new THREE.Mesh(extrudeGeo, ghostMat);
        meshLeft.position.set(-pitchX, 0, 0);
        meshGroup.add(meshLeft);
        const linesLeft = new THREE.LineSegments(edges, ghostEdgeMat);
        linesLeft.position.set(-pitchX, 0, 0);
        meshGroup.add(linesLeft);

        const meshRight = new THREE.Mesh(extrudeGeo, ghostMat);
        meshRight.position.set(pitchX, 0, 0);
        meshGroup.add(meshRight);
        const linesRight = new THREE.LineSegments(edges, ghostEdgeMat);
        linesRight.position.set(pitchX, 0, 0);
        meshGroup.add(linesRight);
      }

      // Render 3D through-holes (both circular and slotted/oblong inner polylines)
      const holeMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        metalness: 0.15,
        roughness: 0.75,
      });
      const holeEdgeMat = new THREE.LineBasicMaterial({
        color: 0x0f172a,
        linewidth: 2,
      });

      // 1. Circular Holes
      if (geometry.circles && geometry.circles.length > 0) {
        geometry.circles.forEach((circ) => {
          if (circ.radius <= 0.5) return;
          const tf = getFoldedPointTransform(geometry, template.id, circ.center.x, circ.center.y);
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

          const tf = getFoldedPointTransform(geometry, template.id, slot.centerX, slot.centerY);
          const slotMesh = create3DSlotMesh(slot.length, slot.width, t, holeMat, holeEdgeMat, slot.isAlongZ, tf.normal);
          slotMesh.position.set(tf.x - centerOffset.x, tf.y - centerOffset.y, tf.z);
          meshGroup.add(slotMesh);
        });
      }

      // --- DYNAMIC 3D COTAS FOR BENT PROFILES ---
      if (show3dCotas) {
        const cotaGroup = new THREE.Group();
        const cz = rawBbox.max.z + 0.5 - centerOffset.z;
        const RoSafe = RiSafe + t;
        const alphaRad = (Math.max(15, Math.min(165, bendAngle)) * Math.PI) / 180;
        const osb = Math.tan(alphaRad / 2) * RoSafe;
        const offDist = 18;
        const faces = geometry.faceSections || [];

        if (template.id === 'profile_u') {
          const fA = faces[0]?.widthNominalMm ?? 50;
          const fB = faces[1]?.widthNominalMm ?? 100;
          const fC = faces[2]?.widthNominalMm ?? 50;

          const uAx = -Math.cos(alphaRad);
          const uAy = Math.sin(alphaRad);
          const uCx = Math.cos(alphaRad);
          const uCy = Math.sin(alphaRad);

          const P_baseA = new THREE.Vector3(0 - centerOffset.x, 0 - centerOffset.y, cz);
          const P_tipA = new THREE.Vector3(fA * uAx - centerOffset.x, fA * uAy - centerOffset.y, cz);
          const P_baseC = new THREE.Vector3(fB - centerOffset.x, 0 - centerOffset.y, cz);
          const P_tipC = new THREE.Vector3(fB + fC * uCx - centerOffset.x, fC * uCy - centerOffset.y, cz);

          const offVecA = new THREE.Vector3(-offDist * Math.sin(alphaRad), -offDist * Math.cos(alphaRad), 0);
          const offVecB = new THREE.Vector3(0, -offDist, 0);
          const offVecC = new THREE.Vector3(offDist * Math.sin(alphaRad), -offDist * Math.cos(alphaRad), 0);

          cotaGroup.add(create3DLinearDimension(P_baseA, P_tipA, 'A', fA, 'mm', offVecA));
          cotaGroup.add(create3DLinearDimension(P_baseA, P_baseC, 'B', fB, 'mm', offVecB));
          cotaGroup.add(create3DLinearDimension(P_baseC, P_tipC, 'C', fC, 'mm', offVecC));

          const P_ri = new THREE.Vector3(osb - RiSafe * 0.7 - centerOffset.x, RoSafe - RiSafe * 0.7 - centerOffset.y, cz);
          cotaGroup.add(create3DCalloutDimension(P_ri, 'Ri', `${RiSafe}`, 'mm', new THREE.Vector3(32, 26, 0), 0x10b981));
        } else if (template.id === 'profile_l') {
          const fA = faces[0]?.widthNominalMm ?? 50;
          const fB = faces[1]?.widthNominalMm ?? 50;
          const uAx = -Math.cos(alphaRad);
          const uAy = Math.sin(alphaRad);

          const P_corner = new THREE.Vector3(0 - centerOffset.x, 0 - centerOffset.y, cz);
          const P_tipA = new THREE.Vector3(fA * uAx - centerOffset.x, fA * uAy - centerOffset.y, cz);
          const P_tipB = new THREE.Vector3(fB - centerOffset.x, 0 - centerOffset.y, cz);

          const offVecA = new THREE.Vector3(-offDist * Math.sin(alphaRad), -offDist * Math.cos(alphaRad), 0);
          const offVecB = new THREE.Vector3(0, -offDist, 0);

          cotaGroup.add(create3DLinearDimension(P_corner, P_tipA, 'A', fA, 'mm', offVecA));
          cotaGroup.add(create3DLinearDimension(P_corner, P_tipB, 'B', fB, 'mm', offVecB));

          const P_ri = new THREE.Vector3(osb + RiSafe * 0.7 - centerOffset.x, RoSafe - RiSafe * 0.7 - centerOffset.y, cz);
          cotaGroup.add(create3DCalloutDimension(P_ri, 'Ri', `${RiSafe}`, 'mm', new THREE.Vector3(30, 26, 0), 0x10b981));
        } else if (template.id === 'profile_z') {
          const fA = faces[0]?.widthNominalMm ?? 40;
          const fB = faces[1]?.widthNominalMm ?? 120;
          const fC = faces[2]?.widthNominalMm ?? 40;

          const P_tipA = new THREE.Vector3(-fA - centerOffset.x, fB - centerOffset.y, cz);
          const P_bend1 = new THREE.Vector3(0 - centerOffset.x, fB - centerOffset.y, cz);
          const P_bend2 = new THREE.Vector3(0 - centerOffset.x, 0 - centerOffset.y, cz);
          const P_tipC = new THREE.Vector3(fC - centerOffset.x, 0 - centerOffset.y, cz);

          cotaGroup.add(create3DLinearDimension(P_bend1, P_tipA, 'A', fA, 'mm', new THREE.Vector3(0, offDist, 0)));
          cotaGroup.add(create3DLinearDimension(P_bend2, P_bend1, 'B', fB, 'mm', new THREE.Vector3(-offDist, 0, 0)));
          cotaGroup.add(create3DLinearDimension(P_bend2, P_tipC, 'C', fC, 'mm', new THREE.Vector3(0, -offDist, 0)));

          const P_ri = new THREE.Vector3(-osb + RiSafe * 0.7 - centerOffset.x, fB - RoSafe + RiSafe * 0.7 - centerOffset.y, cz);
          cotaGroup.add(create3DCalloutDimension(P_ri, 'Ri', `${RiSafe}`, 'mm', new THREE.Vector3(28, 22, 0), 0x10b981));
        } else if (template.id === 'profile_hat') {
          const fA = faces[0]?.widthNominalMm ?? 25;
          const fB = faces[1]?.widthNominalMm ?? 40;
          const fC = faces[2]?.widthNominalMm ?? 80;

          const P_flangeLeft_start = new THREE.Vector3(-fA - osb - centerOffset.x, 0 - centerOffset.y, cz);
          const P_flangeLeft_end = new THREE.Vector3(-osb - centerOffset.x, 0 - centerOffset.y, cz);
          const P_webLeft_top = new THREE.Vector3(0 - centerOffset.x, fB - centerOffset.y, cz);
          const P_webRight_top = new THREE.Vector3(fC - centerOffset.x, fB - centerOffset.y, cz);

          cotaGroup.add(create3DLinearDimension(P_flangeLeft_start, P_flangeLeft_end, 'A', fA, 'mm', new THREE.Vector3(0, -offDist, 0)));
          cotaGroup.add(create3DLinearDimension(P_flangeLeft_end, new THREE.Vector3(-osb - centerOffset.x, fB - centerOffset.y, cz), 'B', fB, 'mm', new THREE.Vector3(-offDist, 0, 0)));
          cotaGroup.add(create3DLinearDimension(P_webLeft_top, P_webRight_top, 'C', fC, 'mm', new THREE.Vector3(0, offDist, 0)));

          const P_ri = new THREE.Vector3(-osb + RiSafe * 0.7 - centerOffset.x, RoSafe - RiSafe * 0.7 - centerOffset.y, cz);
          cotaGroup.add(create3DCalloutDimension(P_ri, 'Ri', `${RiSafe}`, 'mm', new THREE.Vector3(28, 22, 0), 0x10b981));
        } else if (template.id === 'gate_guide_u') {
          const fCL = faces[0]?.widthNominalMm ?? 50;
          const fBL = faces[1]?.widthNominalMm ?? 80;
          const fA = faces[2]?.widthNominalMm ?? 80;

          const P_baseLeft = new THREE.Vector3(-fA / 2 - centerOffset.x, 0 - centerOffset.y, cz);
          const P_baseRight = new THREE.Vector3(fA / 2 - centerOffset.x, 0 - centerOffset.y, cz);
          const P_webLeft_top = new THREE.Vector3(-fA / 2 - centerOffset.x, fBL - centerOffset.y, cz);

          cotaGroup.add(create3DLinearDimension(P_baseLeft, P_baseRight, 'A', fA, 'mm', new THREE.Vector3(0, -offDist, 0)));
          cotaGroup.add(create3DLinearDimension(P_baseLeft, P_webLeft_top, 'B', fBL, 'mm', new THREE.Vector3(-offDist, 0, 0)));

          const folgaLivre = fA - 2 * t;
          const P_inLeft = new THREE.Vector3(-fA / 2 + t - centerOffset.x, fBL / 2 - centerOffset.y, cz);
          const P_inRight = new THREE.Vector3(fA / 2 - t - centerOffset.x, fBL / 2 - centerOffset.y, cz);
          cotaGroup.add(create3DLinearDimension(P_inLeft, P_inRight, 'L. Interna', folgaLivre, 'mm', new THREE.Vector3(0, 0, 0)));

          const P_ri = new THREE.Vector3(-fA / 2 + RoSafe - centerOffset.x, RoSafe - centerOffset.y, cz);
          cotaGroup.add(create3DCalloutDimension(P_ri, 'Ri', `${RiSafe}`, 'mm', new THREE.Vector3(28, 24, 0), 0x10b981));
        } else if (template.id === 'lambril_z') {
          const fD = faces[0]?.widthNominalMm ?? 20;
          const fA = faces[1]?.widthNominalMm ?? 95;
          const fB = faces[2]?.widthNominalMm ?? 20;
          const fC = faces[3]?.widthNominalMm ?? 95;

          const P_cornerTopLeft = new THREE.Vector3(0 - centerOffset.x, fB - centerOffset.y, cz);
          const P_cornerTopMid = new THREE.Vector3(fA - centerOffset.x, fB - centerOffset.y, cz);
          const P_cornerBotMid = new THREE.Vector3(fA - centerOffset.x, 0 - centerOffset.y, cz);
          const P_cornerBotRight = new THREE.Vector3(fA + fC - centerOffset.x, 0 - centerOffset.y, cz);
          const P_tipLeft = new THREE.Vector3(0 - centerOffset.x, fB - fD - centerOffset.y, cz);

          cotaGroup.add(create3DLinearDimension(P_cornerTopLeft, P_cornerTopMid, 'A', fA, 'mm', new THREE.Vector3(0, offDist, 0)));
          cotaGroup.add(create3DLinearDimension(P_cornerBotMid, P_cornerTopMid, 'B', fB, 'mm', new THREE.Vector3(-offDist * 0.8, 0, 0)));
          cotaGroup.add(create3DLinearDimension(P_cornerBotMid, P_cornerBotRight, 'C', fC, 'mm', new THREE.Vector3(0, -offDist, 0)));
          cotaGroup.add(create3DLinearDimension(P_tipLeft, P_cornerTopLeft, 'D', fD, 'mm', new THREE.Vector3(-offDist, 0, 0)));

          cotaGroup.add(
            create3DLinearDimension(
              new THREE.Vector3(0 - centerOffset.x, -offDist * 1.5 - centerOffset.y, cz),
              new THREE.Vector3(fA + fC - centerOffset.x, -offDist * 1.5 - centerOffset.y, cz),
              'Largura Útil (A+C)',
              fA + fC,
              'mm',
              new THREE.Vector3(0, -offDist * 0.8, 0)
            )
          );

          const P_ri = new THREE.Vector3(RoSafe - centerOffset.x, fB - RoSafe - centerOffset.y, cz);
          cotaGroup.add(create3DCalloutDimension(P_ri, 'Ri', `${RiSafe}`, 'mm', new THREE.Vector3(28, 24, 0), 0x10b981));
        } else if (template.id === 'gate_weight_box') {
          const fA = faces[1]?.widthNominalMm ?? 150;
          const fB = faces[2]?.widthNominalMm ?? 100;

          const P_cornerBotLeft = new THREE.Vector3(0 - centerOffset.x, 0 - centerOffset.y, cz);
          const P_cornerBotRight = new THREE.Vector3(fB - centerOffset.x, 0 - centerOffset.y, cz);
          const P_cornerTopLeft = new THREE.Vector3(0 - centerOffset.x, fA - centerOffset.y, cz);

          cotaGroup.add(create3DLinearDimension(P_cornerBotLeft, P_cornerTopLeft, 'A', fA, 'mm', new THREE.Vector3(-offDist * 1.2, 0, 0)));
          cotaGroup.add(create3DLinearDimension(P_cornerBotLeft, P_cornerBotRight, 'B', fB, 'mm', new THREE.Vector3(0, -offDist * 1.2, 0)));

          const P_ri = new THREE.Vector3(RoSafe - centerOffset.x, RoSafe - centerOffset.y, cz);
          cotaGroup.add(create3DCalloutDimension(P_ri, 'Ri', `${RiSafe}`, 'mm', new THREE.Vector3(28, 24, 0), 0x10b981));
        }

        meshGroup.add(cotaGroup);
      }
    }

    // Elevate the entire meshGroup so its lowest vertex rests cleanly at Y = 0 (on top of the workbench grid)
    meshGroup.position.set(0, 0, 0);
    meshGroup.updateMatrixWorld(true);

    const bbox = new THREE.Box3().setFromObject(meshGroup);
    const size = new THREE.Vector3();
    bbox.getSize(size);

    // Adaptive Workbench Grid scaling to piece dimensions
    const maxHoriz = Math.max(size.x, size.z, 20);
    const requiredGridSize = Math.max(maxHoriz * 1.25, maxHoriz + 100);

    let chosenStep = 25;
    for (const step of GRID_STEP_SERIES) {
      if (step * GRID_DIVISIONS >= requiredGridSize) {
        chosenStep = step;
        break;
      }
      chosenStep = step;
    }
    const adaptiveGridSize = chosenStep * GRID_DIVISIONS;

    if (sceneRef.current) {
      if (gridHelperRef.current) {
        sceneRef.current.remove(gridHelperRef.current);
        gridHelperRef.current.geometry.dispose();
        if (Array.isArray(gridHelperRef.current.material)) {
          gridHelperRef.current.material.forEach((m) => m.dispose());
        } else {
          gridHelperRef.current.material.dispose();
        }
      }
      const newGrid = new THREE.GridHelper(adaptiveGridSize, GRID_DIVISIONS, 0x334155, 0x1e293b);
      newGrid.position.y = 0;
      sceneRef.current.add(newGrid);
      gridHelperRef.current = newGrid;
    }
    setGridStepMm(chosenStep);

    const minY = bbox.min.y;
    if (isFinite(minY)) {
      meshGroup.position.y = -minY;
    }

    const centerY = size.y / 2;
    targetRef.current.set(0, centerY, 0);

    const maxDim = Math.max(size.x, size.y, size.z, 50);
    const calculatedRadius = maxDim * 2.2;
    baseRadiusRef.current = calculatedRadius;

    if (lastTemplateIdRef.current !== template.id) {
      lastTemplateIdRef.current = template.id;
      sphericalRef.current.radius = calculatedRadius;
    }

    updateCamera();
  }, [geometry, template, params, show3dCotas, updateCamera]);

  // Mouse Orbit & Pan Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    dragButtonRef.current = e.button;
    previousMousePositionRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;

    const deltaX = e.clientX - previousMousePositionRef.current.x;
    const deltaY = e.clientY - previousMousePositionRef.current.y;
    previousMousePositionRef.current = { x: e.clientX, y: e.clientY };

    if (dragButtonRef.current === 0) {
      // Left Click = Orbit
      sphericalRef.current.theta -= deltaX * 0.008;
      sphericalRef.current.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sphericalRef.current.phi - deltaY * 0.008));
      setInternalActiveView('iso');
      onActiveViewChange?.('iso');
      updateCamera();
    } else if (dragButtonRef.current === 1 || dragButtonRef.current === 2) {
      // Middle or Right Click = Pan
      if (!cameraRef.current) return;
      const panSpeed = sphericalRef.current.radius * 0.0012;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraRef.current.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraRef.current.quaternion);

      targetRef.current.addScaledVector(right, -deltaX * panSpeed);
      targetRef.current.addScaledVector(up, deltaY * panSpeed);
      updateCamera();
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    zoomByDelta(e.deltaY);
  };

  return (
    <div
      id="three-folded-viewer-container"
      className="relative w-full h-full min-h-[380px] bg-slate-950 select-none overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={mountRef} className="w-full h-full" />

      {/* 3D Physical Collision Warning Overlay */}
      {geometry.errors && geometry.errors.length > 0 && (
        <div
          id="folded-collision-3d-alert"
          className="absolute top-16 left-3 max-w-sm bg-red-950/90 border border-red-500/80 rounded-lg p-3 text-red-100 shadow-xl backdrop-blur-md pointer-events-auto z-10"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <div className="font-bold text-red-200 mb-1">
                Geometria Impossível (Colisão 3D Detectada)
              </div>
              <div className="space-y-1 text-red-300 font-mono text-[11px] leading-relaxed">
                {geometry.errors.map((err, idx) => (
                  <div key={idx}>• {err.message}</div>
                ))}
              </div>
              <div className="mt-2 pt-1.5 border-t border-red-500/30 text-[10px] text-red-300/80 italic">
                O 3D exibe a conformação geométrica real sem alterações artificiais. Exportações DXF e PDF bloqueadas.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grid Step Indicator */}
      <div
        id="three-folded-grid-indicator"
        className="absolute bottom-3 left-3 bg-slate-900/80 backdrop-blur-sm px-2.5 py-1 rounded-md border border-slate-800 text-[11px] font-mono text-slate-300 pointer-events-none shadow-md flex items-center gap-1.5"
      >
        <Grid className="w-3.5 h-3.5 text-slate-400" />
        <span>Grade: {gridStepMm} mm ({GRID_DIVISIONS} div)</span>
      </div>

      {/* Bottom Navigation Hint */}
      <div className="absolute bottom-3 right-3 bg-slate-900/80 backdrop-blur-sm px-2.5 py-1 rounded-md border border-slate-800 text-[11px] font-mono text-slate-400 pointer-events-none shadow-md">
        Botão Esq: Orbitar | Botão Dir: Pan | Scroll: Zoom
      </div>
    </div>
  );
});

ThreeFoldedViewer.displayName = 'ThreeFoldedViewer';

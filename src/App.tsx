import {
  Bounds,
  Environment,
  OrbitControls,
  PerspectiveCamera,
  useGLTF,
  useHelper,
} from '@react-three/drei';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { folder, Leva, useControls } from 'leva';
import React, {
  ChangeEvent,
  FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { RectAreaLightHelper } from 'three/examples/jsm/helpers/RectAreaLightHelper.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

declare global {
  interface Window {
    scene?: THREE.Object3D;
    canvasScene?: THREE.Scene;
  }
}

RectAreaLightUniformsLib.init();
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

/** Maximum Device Pixel Ratio (DPR) cap matching MC Studio Canvas3D */
const MAX_DPR = 2;

/** Default Field of View (FOV) matching MC Studio `cameraConfig.threeDFov` (20 deg) */
const DEFAULT_FOV = 20;

/** Background colors for different canvas modes matching MC Studio `ViewerGroup.tsx` */
const BACKGROUND_COLORS = {
  Capture: '#ffffff',
  Edit: '#f5f5f5',
} as const;

/** Chrome / Hardware HDR Environment map URL used by MC Studio `MaterialManager.ts` */
const HDR_ENV_URL =
  'https://drlniib7ad5li.cloudfront.net/hdr/empty_warehouse_01_1k.hdr';

/** Default environment light intensity matching MC Studio `Env.tsx` */
const DEFAULT_ENV_INTENSITY = 0.2;

/** Tone mapping options available for runtime renderer tuning */
const TONE_MAPPING_OPTIONS = {
  ACESFilmic: THREE.ACESFilmicToneMapping,
  Cineon: THREE.CineonToneMapping,
  Linear: THREE.LinearToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
} as const;

// GLB files dropped in public/assets/
const MODEL_OPTIONS = {
  greyCloset: '/assets/greyCloset.glb',
  greyCloset2: '/assets/greyCloset2.glb',
  whiteCloset: '/assets/whiteCloset.glb',
} as const;

function ErrorFallback() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[40, 40, 40]} />
        <meshStandardMaterial color="#663333" wireframe />
      </mesh>
    </group>
  );
}

class ModelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { errored: boolean }
> {
  state = { errored: false };
  static getDerivedStateFromError() {
    return { errored: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[render-sandbox] Failed to load model', error);
  }
  render() {
    if (this.state.errored) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}

// leva doesn't publicly export its Schema/SchemaItem types, so recover the
// item type from folder()'s own parameter instead of hand-rolling one.
type LevaSchema = Parameters<typeof folder>[0];
type LevaSchemaItem = LevaSchema[string];

// GLTF materials are typically MeshStandardMaterial/MeshPhysicalMaterial, but
// the base THREE.Material type doesn't declare these — widen it so we can
// probe for whichever properties a given material actually has.
type TunableMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  envMap?: THREE.Texture | null;
  envMapIntensity?: number;
  envMapRotation?: THREE.Euler;
  metalness?: number;
  normalMap?: THREE.Texture | null;
  normalScale?: THREE.Vector2;
  roughness?: number;
  wireframe?: boolean;
};

// Mirrors mc-studio-frontend/src/state/Design3D/MaterialManager.ts: hardware
// materials (metalness ~0.89, e.g. ChromeMaterial/chrome) get this HDR
// assigned directly as their own envMap, independent of the scene's env
// intensity. glTF has no per-material envMap slot, so the exported GLB loses
// that assignment on export — this restores it for any metallic material.
/** Minimum metalness threshold for treating a material as chrome/hardware */
const HARDWARE_METALNESS_THRESHOLD = 0.5;

/** Default rotation vector for chrome hardware environment mapping */
const HARDWARE_ENV_ROTATION: [number, number, number] = [0, 0, -Math.PI / 2];

interface MaterialDescriptor {
  material: TunableMaterial;
  meshNames: string[];
}

/**
 * Returns a display-friendly part name for a given mesh, appending _expanded if applicable.
 */
function getMeshDisplayName(mesh: THREE.Mesh): string {
  const meshName = mesh.name || '';
  const parentName = mesh.parent?.name || '';
  const isExpanded =
    meshName.toLowerCase().includes('_expanded') ||
    parentName.toLowerCase().includes('_expanded');

  let baseName = meshName || parentName || 'part';
  if (isExpanded && !baseName.toLowerCase().includes('_expanded')) {
    baseName = `${baseName}_expanded`;
  }
  return baseName;
}

/**
 * Traverses the scene hierarchy and returns a deduplicated list of unique materials
 * along with the names of the parts/meshes that use each material.
 */
function collectMaterials(scene: THREE.Object3D): MaterialDescriptor[] {
  const map = new Map<
    string,
    { material: TunableMaterial; meshNames: Set<string> }
  >();

  scene.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    const displayName = getMeshDisplayName(mesh);

    materials.forEach((material) => {
      if (!material) return;
      let entry = map.get(material.uuid);
      if (!entry) {
        entry = {
          material: material,
          meshNames: new Set(),
        };
        map.set(material.uuid, entry);
      }
      if (displayName) {
        entry.meshNames.add(displayName);
      }
    });
  });

  return Array.from(map.values()).map(({ material, meshNames }) => ({
    material,
    meshNames: Array.from(meshNames),
  }));
}

/**
 * Builds a Leva GUI control schema dynamically from collected materials,
 * displaying material names, part names, and tunable properties.
 */
function buildMaterialSchema(descriptors: MaterialDescriptor[]) {
  const schema: Record<string, LevaSchemaItem> = {};
  const usedLabels = new Set<string>();

  descriptors.forEach(({ material: mat, meshNames }, index) => {
    const matName =
      mat.name && mat.name.trim() !== '' ? mat.name : `Material ${index}`;
    const meshTag =
      meshNames.length > 0
        ? ` [${meshNames.slice(0, 2).join(', ')}${meshNames.length > 2 ? '...' : ''}]`
        : '';

    let label = `${matName}${meshTag}`;
    while (usedLabels.has(label)) label = `${label} (${index})`;
    usedLabels.add(label);

    const controls: Record<string, LevaSchemaItem> = {
      [`${index}_nameInfo`]: {
        editable: false,
        label: 'material name',
        value: mat.name || 'unnamed',
      },
      [`${index}_partsInfo`]: {
        editable: false,
        label: 'used by parts',
        value: meshNames.join(', ') || 'scene',
      },
      [`${index}_visible`]: { label: 'visible', value: mat.visible },
    };

    if (typeof mat.wireframe === 'boolean') {
      controls[`${index}_wireframe`] = {
        label: 'wireframe',
        value: mat.wireframe,
      };
    }
    if (mat.color) {
      controls[`${index}_color`] = {
        label: 'color',
        value: `#${mat.color.getHexString()}`,
      };
    }
    if (typeof mat.roughness === 'number') {
      controls[`${index}_roughness`] = {
        label: 'roughness',
        max: 1,
        min: 0,
        step: 0.01,
        value: mat.roughness,
      };
    }
    if (typeof mat.metalness === 'number') {
      controls[`${index}_metalness`] = {
        label: 'metalness',
        max: 1,
        min: 0,
        step: 0.01,
        value: mat.metalness,
      };
    }
    if (mat.normalMap && mat.normalScale) {
      controls[`${index}_normalScaleX`] = {
        label: 'normalScale X',
        max: 10,
        min: -10,
        step: 0.01,
        value: mat.normalScale.x,
      };
      controls[`${index}_normalScaleY`] = {
        label: 'normalScale Y',
        max: 10,
        min: -10,
        step: 0.01,
        value: mat.normalScale.y,
      };
    }
    if (typeof mat.envMapIntensity === 'number') {
      controls[`${index}_envMapIntensity`] = {
        label: 'envMapIntensity',
        max: 3,
        min: 0,
        step: 0.05,
        value: mat.envMapIntensity,
      };
    }
    if (mat.emissive) {
      controls[`${index}_emissive`] = {
        label: 'emissive',
        value: `#${mat.emissive.getHexString()}`,
      };
      controls[`${index}_emissiveIntensity`] = {
        label: 'emissiveIntensity',
        max: 5,
        min: 0,
        step: 0.05,
        value: mat.emissiveIntensity ?? 1,
      };
    }
    controls[`${index}_transparent`] = {
      label: 'transparent',
      value: mat.transparent,
    };
    controls[`${index}_opacity`] = {
      label: 'opacity',
      max: 1,
      min: 0,
      step: 0.01,
      value: mat.opacity,
    };

    schema[label] = folder(controls, { collapsed: true });
  });

  return schema;
}

/**
 * Updates Three.js material instances when Leva GUI values change at runtime.
 */
function applyMaterialValues(
  descriptors: MaterialDescriptor[],
  values: Record<string, boolean | number | string>,
) {
  descriptors.forEach(({ material: mat }, index) => {
    const visible = values[`${index}_visible`];
    if (typeof visible === 'boolean') mat.visible = visible;

    const wireframe = values[`${index}_wireframe`];
    if (typeof wireframe === 'boolean') mat.wireframe = wireframe;

    const color = values[`${index}_color`];
    if (typeof color === 'string' && mat.color) mat.color.set(color);

    const roughness = values[`${index}_roughness`];
    if (typeof roughness === 'number') mat.roughness = roughness;

    const metalness = values[`${index}_metalness`];
    if (typeof metalness === 'number') mat.metalness = metalness;

    if (mat.normalMap && mat.normalScale) {
      const normalScaleX = values[`${index}_normalScaleX`];
      if (typeof normalScaleX === 'number') mat.normalScale.x = normalScaleX;

      const normalScaleY = values[`${index}_normalScaleY`];
      if (typeof normalScaleY === 'number') mat.normalScale.y = normalScaleY;
    }

    const envMapIntensity = values[`${index}_envMapIntensity`];
    if (typeof envMapIntensity === 'number')
      mat.envMapIntensity = envMapIntensity;

    const emissive = values[`${index}_emissive`];
    if (typeof emissive === 'string' && mat.emissive)
      mat.emissive.set(emissive);

    const emissiveIntensity = values[`${index}_emissiveIntensity`];
    if (typeof emissiveIntensity === 'number')
      mat.emissiveIntensity = emissiveIntensity;

    const transparent = values[`${index}_transparent`];
    if (typeof transparent === 'boolean') mat.transparent = transparent;

    const opacity = values[`${index}_opacity`];
    if (typeof opacity === 'number') mat.opacity = opacity;

    mat.needsUpdate = true;
  });
}

function ensureSceneLights(scene: THREE.Object3D) {
  let hasAmbient = false;
  let hasRect = false;
  let hasSpot = false;

  const box = new THREE.Box3().setFromObject(scene);
  const center = box.isEmpty()
    ? new THREE.Vector3()
    : box.getCenter(new THREE.Vector3());
  const size = box.isEmpty()
    ? new THREE.Vector3(100, 100, 100)
    : box.getSize(new THREE.Vector3());
  const isMetersScale = !box.isEmpty() && box.max.z < 10;

  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const nameLower = (mesh.name || '').toLowerCase();
      // const parentNameLower = (mesh.parent?.name || '').toLowerCase();
      // const isExpanded =
      //   nameLower.includes('_expanded') ||
      //   parentNameLower.includes('_expanded');
      const isWall = mesh.userData?.isWall || nameLower.includes('wall');
      const isLineOrEdge =
        mesh instanceof THREE.Line || nameLower.includes('edge');

      if (isLineOrEdge) {
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      } else if (isWall) {
        mesh.castShadow = false;
        mesh.receiveShadow = true;
      } else {
        // Modules, drawers, shelves, shaker doors, hardware, islands, expanded instanced meshes
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }

      // console.log('[render-sandbox] Mesh Shadow Check:', {
      //   castShadow: mesh.castShadow,
      //   isExpanded,
      //   name: mesh.name || 'unnamed_mesh',
      //   parentName: mesh.parent?.name || 'scene',
      //   receiveShadow: mesh.receiveShadow,
      // });
    }
    if ((child as THREE.Light).isLight) {
      if ((child as THREE.AmbientLight).isAmbientLight) hasAmbient = true;
      if ((child as THREE.RectAreaLight).isRectAreaLight) hasRect = true;

      if ((child as THREE.SpotLight).isSpotLight) {
        hasSpot = true;
        const spot = child as THREE.SpotLight;
        spot.castShadow = true;
        spot.decay = 0.001; // Override GLTFLoader default decay=2 to match MC Studio spotDecay: 0.001

        if (!spot.target) {
          spot.target = new THREE.Object3D();
        }
        if (!spot.target.parent) {
          scene.add(spot.target);
        }

        spot.target.updateMatrixWorld(true);
        spot.updateMatrixWorld(true);

        if (spot.shadow) {
          //  rectIntensity: 1.2,
          // shadowBias: -0.0009,
          // shadowEnabled: true,
          // shadowMapSize: 1024,
          // shadowNormalBias: 0.001,
          // ....................
          spot.shadow.bias = -0.01;
          spot.shadow.normalBias = 0.05;
          // ..............
          // spot.shadow.bias = -0.0009;
          // spot.shadow.normalBias = 0.001;
          spot.shadow.radius = 1.4;
          spot.shadow.mapSize.set(1024, 1024);
        }
        // console.log('[render-sandbox] SpotLight Config Check:', {
        //   angle: spot.angle,
        //   castShadow: spot.castShadow,
        //   color: `#${spot.color.getHexString()}`,
        //   decay: spot.decay,
        //   distance: spot.distance,
        //   intensity: spot.intensity,
        //   name: spot.name || 'SpotLight',
        //   penumbra: spot.penumbra,
        //   position: spot.position.toArray(),
        //   shadowBias: spot.shadow?.bias,
        //   shadowMapSize: spot.shadow
        //     ? [spot.shadow.mapSize.x, spot.shadow.mapSize.y]
        //     : null,
        //   shadowNormalBias: spot.shadow?.normalBias,
        //   shadowRadius: spot.shadow?.radius,
        //   targetPosition: spot.target ? spot.target.position.toArray() : null,
        // });
      }
    }
  });

  const extraLights = scene.userData?.extraLights as
    Array<Record<string, unknown>> | undefined;

  // Reconstruct missing AmbientLight (#e8e8e8, 1.5) from GLB extraLights or defaults
  if (!hasAmbient) {
    const ambientMeta = extraLights?.find((l) => l.type === 'AmbientLight');
    const ambientColor = (ambientMeta?.color as string) ?? '#e8e8e8';
    const ambientIntensity = (ambientMeta?.intensity as number) ?? 1.5;
    const ambLight = new THREE.AmbientLight(ambientColor, ambientIntensity);
    ambLight.name = 'AmbientLight';
    scene.add(ambLight);
    // console.log('[render-sandbox] AmbientLight Check:', {
    //   color: `#${ambLight.color.getHexString()}`,
    //   intensity: ambLight.intensity,
    //   name: ambLight.name,
    // });
  }

  // Reconstruct missing RectAreaLight (#ffffff, 1.2) from GLB extraLights or defaults
  if (!hasRect) {
    const rectMeta = extraLights?.find((l) => l.type === 'RectAreaLight');
    if (rectMeta) {
      const rectLight = new THREE.RectAreaLight(
        (rectMeta.color as string) ?? '#ffffff',
        (rectMeta.intensity as number) ?? 1.2,
        (rectMeta.width as number) ??
          (isMetersScale ? size.y * 0.9 : Math.max(0, size.y - 11)),
        (rectMeta.height as number) ??
          (isMetersScale ? size.x * 0.9 : Math.max(0, size.x - 11)),
      );
      if (Array.isArray(rectMeta.position)) {
        const pos = rectMeta.position as [number, number, number];
        rectLight.position.set(
          isMetersScale && pos[2] > 20 ? pos[0] * 0.036 : pos[0],
          isMetersScale && pos[2] > 20 ? pos[1] * 0.036 : pos[1],
          isMetersScale && pos[2] > 20 ? pos[2] * 0.036 : pos[2],
        );
      }
      if (Array.isArray(rectMeta.rotation)) {
        rectLight.rotation.set(
          ...(rectMeta.rotation as [number, number, number]),
        );
      } else {
        rectLight.rotation.set(0, 0, -Math.PI / 2);
      }
      rectLight.name = 'RectAreaLight';
      scene.add(rectLight);
      // console.log('[render-sandbox] RectAreaLight Check:', {
      //   color: `#${rectLight.color.getHexString()}`,
      //   height: rectLight.height,
      //   intensity: rectLight.intensity,
      //   name: rectLight.name,
      //   position: rectLight.position.toArray(),
      //   rotation: [
      //     rectLight.rotation.x,
      //     rectLight.rotation.y,
      //     rectLight.rotation.z,
      //   ],
      //   width: rectLight.width,
      // });
    } else if (!box.isEmpty()) {
      const rectWidth = Math.max(
        0.1,
        isMetersScale ? size.y * 0.9 : Math.max(0, size.y - 11),
      );
      const rectHeight = Math.max(
        0.1,
        isMetersScale ? size.x * 0.9 : Math.max(0, size.x - 11),
      );
      const rectLight = new THREE.RectAreaLight(
        '#ffffff',
        1.2,
        rectWidth,
        rectHeight,
      );
      rectLight.position.set(center.x, center.y, box.max.z - 0.01);
      rectLight.rotation.set(0, 0, -Math.PI / 2);
      rectLight.name = 'RectAreaLight';
      scene.add(rectLight);

      // console.log('[render-sandbox] RectAreaLight Check (Fallback):', {
      //   color: `#${rectLight.color.getHexString()}`,
      //   height: rectLight.height,
      //   intensity: rectLight.intensity,
      //   name: rectLight.name,
      //   position: rectLight.position.toArray(),
      //   rotation: [
      //     rectLight.rotation.x,
      //     rectLight.rotation.y,
      //     rectLight.rotation.z,
      //   ],
      //   width: rectLight.width,
      // });
    }
  }

  if (!hasSpot && !box.isEmpty()) {
    const ceilingZ = isMetersScale ? box.max.z + 0.1 : box.max.z - 1;

    const spotPositions = [
      new THREE.Vector3(center.x - size.x * 0.25, center.y, ceilingZ),
      new THREE.Vector3(center.x + size.x * 0.25, center.y, ceilingZ),
    ];

    spotPositions.forEach((pos, idx) => {
      const spot = new THREE.SpotLight(0xffffff, 2.2);
      spot.name = `SpotLight ${idx}`;
      spot.position.copy(pos);
      spot.angle = 1.46;
      spot.penumbra = 0.1;
      spot.decay = 0.001;
      spot.distance = isMetersScale ? size.length() * 4 : 500;
      spot.castShadow = true;

      spot.shadow.bias = isMetersScale ? -0.0001 : -0.0009;
      spot.shadow.normalBias = 0.001;
      spot.shadow.radius = 1.4;
      spot.shadow.mapSize.set(1024, 1024);

      const targetObj = new THREE.Object3D();
      targetObj.position.set(pos.x, pos.y, 0);
      spot.target = targetObj;

      scene.add(spot);
      scene.add(targetObj);
      targetObj.updateMatrixWorld(true);
      spot.updateMatrixWorld(true);
    });
  }

  // Clean up any previously added synthetic back wall mesh
  const existingBackWall = scene.getObjectByName('sandboxBackWall');
  if (existingBackWall) {
    scene.remove(existingBackWall);
  }
}

function collectLights(scene: THREE.Object3D): THREE.Light[] {
  ensureSceneLights(scene);
  const lights: THREE.Light[] = [];
  scene.traverse((child) => {
    if ((child as THREE.Light).isLight) {
      lights.push(child as THREE.Light);
    }
  });
  return lights;
}

function buildLightSchema(lights: THREE.Light[]) {
  const schema: Record<string, LevaSchemaItem> = {};
  const usedLabels = new Set<string>();

  lights.forEach((light, index) => {
    let typeName = 'Light';
    if ((light as THREE.AmbientLight).isAmbientLight) typeName = 'AmbientLight';
    else if ((light as THREE.SpotLight).isSpotLight) typeName = 'SpotLight';
    else if ((light as THREE.RectAreaLight).isRectAreaLight)
      typeName = 'RectAreaLight';
    else if ((light as THREE.DirectionalLight).isDirectionalLight)
      typeName = 'DirectionalLight';
    else if ((light as THREE.PointLight).isPointLight) typeName = 'PointLight';

    let label = light.name
      ? `${typeName} (${light.name})`
      : `${typeName} ${index}`;
    while (usedLabels.has(label)) label = `${label} (${index})`;
    usedLabels.add(label);

    const controls: Record<string, LevaSchemaItem> = {
      [`light_${index}_visible`]: { label: 'visible', value: light.visible },
      [`light_${index}_intensity`]: {
        label: 'intensity',
        max: 10,
        min: 0,
        step: 0.05,
        value: light.intensity,
      },
      [`light_${index}_color`]: {
        label: 'color',
        value: `#${light.color.getHexString()}`,
      },
    };

    if (!(light as THREE.AmbientLight).isAmbientLight) {
      controls[`light_${index}_posX`] = {
        label: 'posX',
        max: 500,
        min: -500,
        step: 0.1,
        value: light.position.x,
      };
      controls[`light_${index}_posY`] = {
        label: 'posY',
        max: 500,
        min: -500,
        step: 0.1,
        value: light.position.y,
      };
      controls[`light_${index}_posZ`] = {
        label: 'posZ',
        max: 500,
        min: -500,
        step: 0.1,
        value: light.position.z,
      };
    }

    if ((light as THREE.SpotLight).isSpotLight) {
      const spot = light as THREE.SpotLight;
      const targetPos = spot.target
        ? spot.target.position
        : new THREE.Vector3();
      controls[`light_${index}_targetX`] = {
        label: 'targetX',
        max: 500,
        min: -500,
        step: 0.1,
        value: targetPos.x,
      };
      controls[`light_${index}_targetY`] = {
        label: 'targetY',
        max: 500,
        min: -500,
        step: 0.1,
        value: targetPos.y,
      };
      controls[`light_${index}_targetZ`] = {
        label: 'targetZ',
        max: 500,
        min: -500,
        step: 0.1,
        value: targetPos.z,
      };

      controls[`light_${index}_angle`] = {
        label: 'angle',
        max: Math.PI / 2,
        min: 0,
        step: 0.01,
        value: spot.angle,
      };
      controls[`light_${index}_penumbra`] = {
        label: 'penumbra',
        max: 1,
        min: 0,
        step: 0.01,
        value: spot.penumbra,
      };
      controls[`light_${index}_decay`] = {
        label: 'decay',
        max: 5,
        min: 0,
        step: 0.001,
        value: spot.decay,
      };
      controls[`light_${index}_distance`] = {
        label: 'distance',
        max: 2000,
        min: 0,
        step: 10,
        value: spot.distance,
      };
    }

    if ((light as THREE.RectAreaLight).isRectAreaLight) {
      const rect = light as THREE.RectAreaLight;
      controls[`light_${index}_width`] = {
        label: 'width',
        max: 1000,
        min: 1,
        step: 1,
        value: rect.width,
      };
      controls[`light_${index}_height`] = {
        label: 'height',
        max: 1000,
        min: 1,
        step: 1,
        value: rect.height,
      };
    }

    if (light.shadow) {
      controls[`light_${index}_castShadow`] = {
        label: 'castShadow',
        value: light.castShadow,
      };
      controls[`light_${index}_shadowBias`] = {
        label: 'shadowBias',
        max: 0.005,
        min: -0.005,
        step: 0.0001,
        value: light.shadow.bias,
      };
      controls[`light_${index}_shadowNormalBias`] = {
        label: 'shadowNormalBias',
        max: 0.05,
        min: -0.05,
        step: 0.0005,
        value: light.shadow.normalBias,
      };
      controls[`light_${index}_shadowRadius`] = {
        label: 'shadowRadius',
        max: 10,
        min: 0,
        step: 0.1,
        value: light.shadow.radius,
      };
    }

    schema[label] = folder(controls, { collapsed: false });
  });

  return schema;
}

function applyLightValues(
  lights: THREE.Light[],
  values: Record<string, boolean | number | string>,
) {
  lights.forEach((light, index) => {
    const visible = values[`light_${index}_visible`];
    if (typeof visible === 'boolean') light.visible = visible;

    const intensity = values[`light_${index}_intensity`];
    if (typeof intensity === 'number') light.intensity = intensity;

    const color = values[`light_${index}_color`];
    if (typeof color === 'string') light.color.set(color);

    const posX = values[`light_${index}_posX`];
    const posY = values[`light_${index}_posY`];
    const posZ = values[`light_${index}_posZ`];
    if (
      typeof posX === 'number' &&
      typeof posY === 'number' &&
      typeof posZ === 'number'
    ) {
      light.position.set(posX, posY, posZ);
      light.updateMatrixWorld(true);
    }

    if ((light as THREE.SpotLight).isSpotLight) {
      const spot = light as THREE.SpotLight;

      const targetX = values[`light_${index}_targetX`];
      const targetY = values[`light_${index}_targetY`];
      const targetZ = values[`light_${index}_targetZ`];
      if (
        spot.target &&
        typeof targetX === 'number' &&
        typeof targetY === 'number' &&
        typeof targetZ === 'number'
      ) {
        spot.target.position.set(targetX, targetY, targetZ);
        spot.target.updateMatrixWorld(true);
        spot.updateMatrixWorld(true);
        spot.shadow?.camera.updateProjectionMatrix();
      }

      const angle = values[`light_${index}_angle`];
      if (typeof angle === 'number') spot.angle = angle;

      const penumbra = values[`light_${index}_penumbra`];
      if (typeof penumbra === 'number') spot.penumbra = penumbra;

      const decay = values[`light_${index}_decay`];
      if (typeof decay === 'number') spot.decay = decay;

      const distance = values[`light_${index}_distance`];
      if (typeof distance === 'number') spot.distance = distance;
    }

    if ((light as THREE.RectAreaLight).isRectAreaLight) {
      const rect = light as THREE.RectAreaLight;
      const width = values[`light_${index}_width`];
      if (typeof width === 'number') rect.width = width;

      const height = values[`light_${index}_height`];
      if (typeof height === 'number') rect.height = height;
    }

    if (light.shadow) {
      const castShadow = values[`light_${index}_castShadow`];
      if (typeof castShadow === 'boolean') light.castShadow = castShadow;

      const shadowBias = values[`light_${index}_shadowBias`];
      if (typeof shadowBias === 'number') light.shadow.bias = shadowBias;

      const shadowNormalBias = values[`light_${index}_shadowNormalBias`];
      if (typeof shadowNormalBias === 'number')
        light.shadow.normalBias = shadowNormalBias;

      const shadowRadius = values[`light_${index}_shadowRadius`];
      if (typeof shadowRadius === 'number') light.shadow.radius = shadowRadius;
    }
  });
}

function Model({
  hdrUrl,
  showLightHelpers,
  url,
}: {
  hdrUrl: string;
  showLightHelpers: boolean;
  url: string;
}) {
  const { scene } = useGLTF(url);
  const materialDescriptors = useMemo(() => collectMaterials(scene), [scene]);
  const materialSchema = useMemo(
    () => buildMaterialSchema(materialDescriptors),
    [materialDescriptors],
  );
  const materialValues = useControls('Materials', materialSchema) as Record<
    string,
    boolean | number | string
  >;

  const lights = useMemo(() => collectLights(scene), [scene]);
  const lightSchema = useMemo(() => buildLightSchema(lights), [lights]);
  const lightValues = useControls('GLB Lights', lightSchema) as Record<
    string,
    boolean | number | string
  >;

  // Raw (non-PMREM) equirect texture, loaded the same way MaterialManager's
  // _loadChromeEnv() does, so hardware reflections match production exactly.
  const hardwareEnv = useLoader(RGBELoader, hdrUrl);
  hardwareEnv.mapping = THREE.EquirectangularReflectionMapping;

  useEffect(() => {
    ensureSceneLights(scene);
    window.scene = scene;
  }, [scene]);

  useEffect(() => {
    materialDescriptors.forEach(({ material: mat }) => {
      if (
        typeof mat.metalness === 'number' &&
        mat.metalness >= HARDWARE_METALNESS_THRESHOLD
      ) {
        mat.envMap = hardwareEnv;
        mat.envMapRotation?.set(...HARDWARE_ENV_ROTATION);
        mat.needsUpdate = true;
      }
    });
  }, [materialDescriptors, hardwareEnv]);

  useEffect(() => {
    applyMaterialValues(materialDescriptors, materialValues);
  }, [materialDescriptors, materialValues]);

  useEffect(() => {
    applyLightValues(lights, lightValues);
  }, [lights, lightValues]);

  return (
    <>
      <primitive object={scene} />
      {showLightHelpers && <GlbLightHelpers scene={scene} />}
    </>
  );
}

function GlbLightHelpers({ scene }: { scene: THREE.Object3D }) {
  const lights = useMemo(() => {
    const list: THREE.Light[] = [];
    scene.traverse((child) => {
      if ((child as THREE.Light).isLight) {
        list.push(child as THREE.Light);
      }
    });
    return list;
  }, [scene]);

  return (
    <>
      {lights.map((light) => (
        <GlbLightHelperInstance key={light.uuid} light={light} />
      ))}
    </>
  );
}

function GlbLightHelperInstance({ light }: { light: THREE.Light }) {
  const ref = React.useRef<THREE.Object3D>(light);

  if ((light as THREE.SpotLight).isSpotLight) {
    return <SpotHelperInstance spotRef={ref} />;
  }
  if ((light as THREE.RectAreaLight).isRectAreaLight) {
    return <RectHelperInstance rectRef={ref} />;
  }
  return null;
}

function SpotHelperInstance({
  spotRef,
}: {
  spotRef: React.MutableRefObject<THREE.Object3D>;
}) {
  useHelper(spotRef, THREE.SpotLightHelper, 'yellow');
  return null;
}

function RectHelperInstance({
  rectRef,
}: {
  rectRef: React.MutableRefObject<THREE.Object3D>;
}) {
  useHelper(rectRef, RectAreaLightHelper, 'cyan');
  return null;
}

function SceneExporter() {
  const { scene } = useThree();
  useEffect(() => {
    window.canvasScene = scene;
    if (!window.scene) {
      window.scene = scene;
    }
  }, [scene]);
  return null;
}

function HdrSourcePanel({
  hdrUrl,
  onHdrChange,
}: {
  hdrUrl: string;
  onHdrChange: (source: string) => void;
}) {
  const [link, setLink] = useState(HDR_ENV_URL);
  const [fileName, setFileName] = useState('Default environment');
  const objectUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;
    setFileName(file.name);
    onHdrChange(objectUrl);
  };

  const handleLinkSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextLink = link.trim();
    if (!nextLink) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = undefined;
    }
    setFileName('Remote environment');
    onHdrChange(nextLink);
  };

  return (
    <section
      style={{
        background: 'rgba(20, 20, 20, 0.92)',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        borderRadius: 8,
        color: '#fff',
        display: 'grid',
        gap: 10,
        left: 16,
        maxWidth: 360,
        padding: 14,
        position: 'fixed',
        top: 16,
        width: 'calc(100vw - 32px)',
        zIndex: 10,
      }}>
      <strong style={{ fontSize: 14 }}>HDR environment</strong>
      <label style={{ display: 'grid', fontSize: 12, gap: 6 }}>
        Upload HDR
        <input
          accept=".hdr,image/vnd.radiance"
          onChange={handleFileChange}
          type="file"
        />
      </label>
      <form onSubmit={handleLinkSubmit} style={{ display: 'grid', gap: 6 }}>
        <label style={{ fontSize: 12 }} htmlFor="hdr-link">
          Upload link
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            id="hdr-link"
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://example.com/scene.hdr"
            style={{
              background: '#2b2b2b',
              border: '1px solid #555',
              borderRadius: 4,
              color: '#fff',
              minWidth: 0,
              padding: '7px 8px',
              width: '100%',
            }}
            type="url"
            value={link}
          />
          <button type="submit">Load</button>
        </div>
      </form>
      <small style={{ color: '#bdbdbd', overflowWrap: 'anywhere' }}>
        Active: {fileName}
        {hdrUrl.startsWith('blob:') ? ' (local file)' : ''}
      </small>
    </section>
  );
}

export function App() {
  const [hdrUrl, setHdrUrl] = useState(HDR_ENV_URL);

  const { model } = useControls('Model', {
    model: { options: Object.keys(MODEL_OPTIONS), value: 'greyCloset2' },
  });

  const { antialias, exposure } = useControls(
    'Renderer (Canvas3D.tsx parity)',
    {
      antialias: true,
      exposure: { max: 3, min: 0, step: 0.05, value: 0.9 },
    },
  );

  const { fov } = useControls('Camera', {
    fov: { max: 90, min: 5, step: 1, value: DEFAULT_FOV },
  });

  const background = useControls('Background (ViewerGroup.tsx parity)', {
    mode: { options: Object.keys(BACKGROUND_COLORS), value: 'Edit' },
  });

  const env = useControls('Environment (Env.tsx / MaterialManager.ts parity)', {
    envIntensity: { max: 3, min: 0, step: 0.05, value: DEFAULT_ENV_INTENSITY },
    isEnvBackgroundVisible: false,
  });

  const helpers = useControls('Light Helpers', {
    showLightHelpers: false,
  });

  return (
    <>
      <HdrSourcePanel hdrUrl={hdrUrl} onHdrChange={setHdrUrl} />
      <Leva collapsed={false} />
      <Canvas
        camera={{ fov }}
        dpr={[1, MAX_DPR]}
        gl={{
          antialias,
          outputColorSpace: THREE.SRGBColorSpace,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: exposure,
        }}
        shadows={{ type: THREE.PCFShadowMap }}
        style={{ background: '#1a1a1a', height: '100vh', width: '100vw' }}>
        <SceneExporter />
        <PerspectiveCamera makeDefault fov={fov} position={[300, 250, 300]} />
        <OrbitControls makeDefault />

        <color
          args={[
            BACKGROUND_COLORS[
              background.mode as keyof typeof BACKGROUND_COLORS
            ],
          ]}
          attach="background"
        />
        <Environment
          background={env.isEnvBackgroundVisible}
          environmentIntensity={env.envIntensity}
          files={hdrUrl}
        />

        <Suspense fallback={null}>
          <ModelErrorBoundary key={model}>
            <Bounds fit clip observe margin={1.2}>
              <Model
                hdrUrl={hdrUrl}
                url={MODEL_OPTIONS[model as keyof typeof MODEL_OPTIONS]}
                showLightHelpers={helpers.showLightHelpers}
              />
            </Bounds>
          </ModelErrorBoundary>
        </Suspense>
      </Canvas>
    </>
  );
}

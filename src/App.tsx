import { Bounds, OrbitControls, PerspectiveCamera, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Leva, useControls } from 'leva';
import React, { Suspense } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

RectAreaLightUniformsLib.init();

// Mirrors mc-studio-frontend/src/components/Viewer3D/Canvas3D/Canvas3D.tsx
const MAX_DPR = 2;

// Mirrors mc-studio-frontend/src/common/constant.ts -> cameraConfig.threeDFov
const DEFAULT_FOV = 20;

const TONE_MAPPING_OPTIONS = {
  ACESFilmic: THREE.ACESFilmicToneMapping,
  Cineon: THREE.CineonToneMapping,
  Linear: THREE.LinearToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
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
    console.error('[render-sandbox] Failed to load /model.glb', error);
  }
  render() {
    if (this.state.errored) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

function Lights({
  ambientColor,
  ambientIntensity,
  rectColor,
  rectEnabled,
  rectIntensity,
  rectPosition,
  rectSize,
  shadowBias,
  shadowEnabled,
  shadowMapSize,
  shadowNormalBias,
  shadowRadius,
  spotAngle,
  spotColor,
  spotDecay,
  spotDistance,
  spotEnabled,
  spotIntensity,
  spotPenumbra,
  spotPosition,
  spotTarget,
}: {
  ambientColor: string;
  ambientIntensity: number;
  rectColor: string;
  rectEnabled: boolean;
  rectIntensity: number;
  rectPosition: [number, number, number];
  rectSize: [number, number];
  shadowBias: number;
  shadowEnabled: boolean;
  shadowMapSize: number;
  shadowNormalBias: number;
  shadowRadius: number;
  spotAngle: number;
  spotColor: string;
  spotDecay: number;
  spotDistance: number;
  spotEnabled: boolean;
  spotIntensity: number;
  spotPenumbra: number;
  spotPosition: [number, number, number];
  spotTarget: [number, number, number];
}) {
  const targetRef = React.useRef<THREE.Object3D>(null);

  return (
    <>
      <ambientLight color={ambientColor} intensity={ambientIntensity} />

      {rectEnabled && (
        <rectAreaLight
          color={rectColor}
          intensity={rectIntensity}
          position={rectPosition}
          width={rectSize[0]}
          height={rectSize[1]}
          rotation={[0, 0, -Math.PI / 2]}
        />
      )}

      {spotEnabled && (
        <>
          <object3D position={spotTarget} ref={targetRef} />
          {targetRef.current && (
            <spotLight
              angle={spotAngle}
              castShadow={shadowEnabled}
              color={spotColor}
              decay={spotDecay}
              distance={spotDistance}
              intensity={spotIntensity}
              penumbra={spotPenumbra}
              position={spotPosition}
              shadow-bias={shadowBias}
              shadow-mapSize={[shadowMapSize, shadowMapSize]}
              shadow-normalBias={shadowNormalBias}
              shadow-radius={shadowRadius}
              target={targetRef.current}
            />
          )}
        </>
      )}
    </>
  );
}

export function App() {
  const {
    antialias,
    exposure,
    toneMapping,
  } = useControls('Renderer (Canvas3D.tsx parity)', {
    antialias: true,
    exposure: { max: 3, min: 0, step: 0.05, value: 0.9 },
    toneMapping: { options: Object.keys(TONE_MAPPING_OPTIONS), value: 'Linear' },
  });

  const { fov } = useControls('Camera', {
    fov: { max: 90, min: 5, step: 1, value: DEFAULT_FOV },
  });

  const ambient = useControls('Ambient Light', {
    ambientColor: '#e8e8e8',
    ambientIntensity: { max: 5, min: 0, step: 0.1, value: 1.5 },
  });

  const rect = useControls('Rect Area Light', {
    rectColor: '#ffffff',
    rectEnabled: true,
    rectIntensity: { max: 10, min: 0, step: 0.1, value: 1.2 },
    rectPosition: { value: [0, 0, 200] },
    rectSize: { value: [200, 100] },
  });

  const spot = useControls('Spot Light', {
    spotAngle: { max: Math.PI / 2, min: 0.05, step: 0.01, value: 1.46 },
    spotColor: '#ffffff',
    spotDecay: { max: 2, min: 0, step: 0.001, value: 0.001 },
    spotDistance: { max: 1000, min: 0, step: 10, value: 500 },
    spotEnabled: true,
    spotIntensity: { max: 10, min: 0, step: 0.1, value: 2.2 },
    spotPenumbra: { max: 1, min: 0, step: 0.01, value: 0.1 },
    spotPosition: { value: [150, 150, 250] },
    spotTarget: { value: [0, 0, 0] },
  });

  const shadow = useControls('Shadows', {
    shadowBias: { max: 0, min: -0.01, step: 0.0001, value: -0.0009 },
    shadowEnabled: true,
    shadowMapSize: { options: [512, 1024, 2048, 4096], value: 1024 },
    shadowNormalBias: { max: 0.01, min: 0, step: 0.0001, value: 0.001 },
    shadowRadius: { max: 5, min: 0, step: 0.1, value: 1.4 },
  });

  return (
    <>
      <Leva collapsed={false} />
      <Canvas
        camera={{ fov }}
        dpr={[1, MAX_DPR]}
        gl={{
          antialias,
          toneMapping: TONE_MAPPING_OPTIONS[toneMapping as keyof typeof TONE_MAPPING_OPTIONS],
          toneMappingExposure: exposure,
        }}
        shadows={shadow.shadowEnabled ? { type: THREE.PCFShadowMap } : false}
        style={{ background: '#1a1a1a', height: '100vh', width: '100vw' }}>
        <PerspectiveCamera makeDefault fov={fov} position={[300, 250, 300]} />
        <OrbitControls makeDefault />

        <Lights
          ambientColor={ambient.ambientColor}
          ambientIntensity={ambient.ambientIntensity}
          rectColor={rect.rectColor}
          rectEnabled={rect.rectEnabled}
          rectIntensity={rect.rectIntensity}
          rectPosition={rect.rectPosition as [number, number, number]}
          rectSize={rect.rectSize as [number, number]}
          shadowBias={shadow.shadowBias}
          shadowEnabled={shadow.shadowEnabled}
          shadowMapSize={shadow.shadowMapSize}
          shadowNormalBias={shadow.shadowNormalBias}
          shadowRadius={shadow.shadowRadius}
          spotAngle={spot.spotAngle}
          spotColor={spot.spotColor}
          spotDecay={spot.spotDecay}
          spotDistance={spot.spotDistance}
          spotEnabled={spot.spotEnabled}
          spotIntensity={spot.spotIntensity}
          spotPenumbra={spot.spotPenumbra}
          spotPosition={spot.spotPosition as [number, number, number]}
          spotTarget={spot.spotTarget as [number, number, number]}
        />

        <Suspense fallback={null}>
          <ModelErrorBoundary>
            <Bounds fit clip observe margin={1.2}>
              <Model url="/model.glb" />
            </Bounds>
          </ModelErrorBoundary>
        </Suspense>
      </Canvas>
    </>
  );
}

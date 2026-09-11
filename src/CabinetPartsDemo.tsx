import { useControls } from 'leva';
import React from 'react';
import * as THREE from 'three';

// -------------------------------------------------------------------------
// 1. CREATE PROCEDURAL WOOD TEXTURE WITH TILE BORDERS
// -------------------------------------------------------------------------
function createWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base wood background
  ctx.fillStyle = '#d4a373';
  ctx.fillRect(0, 0, 512, 512);

  // Dark border around tile edge (makes texture repeating 100% obvious when scaling)
  ctx.strokeStyle = '#3e2723';
  ctx.lineWidth = 16;
  ctx.strokeRect(0, 0, 512, 512);

  // Wood grain & planks
  ctx.fillStyle = '#bc8a5f';
  for (let i = 0; i < 512; i += 64) {
    ctx.fillRect(i, 0, 32, 512);
  }

  ctx.strokeStyle = '#5c3d2e';
  ctx.lineWidth = 3;
  for (let i = 0; i < 512; i += 32) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.bezierCurveTo(170, i - 20, 340, i + 20, 512, i);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// -------------------------------------------------------------------------
// 2. SHARED GEOMETRY & SINGLE SHARED MATERIAL SETUP
// ALL MESHES SHARE THIS EXACT SAME MATERIAL INSTANCE (1 DRAW CALL OPTIMIZATION)
// -------------------------------------------------------------------------
const sharedBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

const sharedMaterial = new THREE.MeshStandardMaterial({
  map: createWoodTexture(),
  roughness: 0.35,
});

// Reactive texture density uniform
const sharedUniforms = {
  uTextureDensity: { value: 0.02 },
};

// Shader injection: scale vMapUv based on live modelMatrix scale & face direction
sharedMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uTextureDensity = sharedUniforms.uTextureDensity;

  shader.vertexShader = `
    uniform float uTextureDensity;
    ${shader.vertexShader}
  `;

  shader.vertexShader = shader.vertexShader.replace(
    '#include <uv_vertex>',
    `
    #include <uv_vertex>
    // 1. Extract live mesh scale from modelMatrix (sx, sy, sz)
    float sx = length(modelMatrix[0].xyz);
    float sy = length(modelMatrix[1].xyz);
    float sz = length(modelMatrix[2].xyz);

    // 2. Determine 2D dimensions of current box face
    vec3 n = abs(normal);
    vec2 faceDimensions = vec2(1.0);

    if (n.x > 0.5) {
      faceDimensions = vec2(sz, sy); // Side face: Depth x Height
    } else if (n.y > 0.5) {
      faceDimensions = vec2(sx, sz); // Top/Bottom face: Width x Depth
    } else {
      faceDimensions = vec2(sx, sy); // Front/Back face: Width x Height
    }

    vec2 scaleFactor = faceDimensions * uTextureDensity;

    // 3. Apply non-stretching scale to map varyings (Three.js r151+ compatible)
    #ifdef USE_MAP
      vMapUv = vMapUv * scaleFactor;
    #endif
    #ifdef USE_NORMALMAP
      vNormalMapUv = vNormalMapUv * scaleFactor;
    #endif
    #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv = vRoughnessMapUv * scaleFactor;
    #endif
    #if defined( USE_UV ) || defined( USE_ANISOTROPY )
      vUv = vUv * scaleFactor;
    #endif
    `,
  );
};

// -------------------------------------------------------------------------
// 3. DEMO: MULTIPLE PANELS OF DIFFERENT SCALES SHARING 1 MATERIAL
// -------------------------------------------------------------------------
export function CabinetPartsDemo() {
  const globalConfig = useControls('Global Texture Config', {
    textureDensity: { max: 0.1, min: 0.005, step: 0.005, value: 0.02 },
  });

  sharedUniforms.uTextureDensity.value = globalConfig.textureDensity;

  // Panel A: Cabinet Door (Tall & Thin depth)
  const door = useControls('Panel A (Door)', {
    depth: { max: 50, min: 2, step: 1, value: 4 },
    height: { max: 300, min: 50, step: 5, value: 160 },
    width: { max: 200, min: 20, step: 5, value: 80 },
  });

  // Panel B: Side Wall Panel (Deep & Medium width)
  const sideWall = useControls('Panel B (Side Wall)', {
    depth: { max: 200, min: 10, step: 5, value: 60 },
    height: { max: 300, min: 50, step: 5, value: 200 },
    width: { max: 50, min: 2, step: 1, value: 4 },
  });

  // Panel C: Shelf Panel (Wide & Medium depth)
  const shelf = useControls('Panel C (Shelf)', {
    depth: { max: 200, min: 10, step: 5, value: 60 },
    height: { max: 50, min: 2, step: 1, value: 4 },
    width: { max: 300, min: 50, step: 5, value: 140 },
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Mesh A - All 3 meshes use material={sharedMaterial}! ZERO material cloning */}
      <mesh
        geometry={sharedBoxGeometry}
        material={sharedMaterial}
        position={[-120, door.height / 2, 0]}
        scale={[door.width, door.height, door.depth]}
      />

      {/* Mesh B */}
      <mesh
        geometry={sharedBoxGeometry}
        material={sharedMaterial}
        position={[0, sideWall.height / 2, 0]}
        scale={[sideWall.width, sideWall.height, sideWall.depth]}
      />

      {/* Mesh C */}
      <mesh
        geometry={sharedBoxGeometry}
        material={sharedMaterial}
        position={[140, shelf.height / 2 + 50, 0]}
        scale={[shelf.width, shelf.height, shelf.depth]}
      />
    </group>
  );
}

export default CabinetPartsDemo;

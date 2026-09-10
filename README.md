# render-sandbox

Standalone rendering playground for mc-studio-frontend's 3D viewer. Loads a single
exported `.glb` into a Canvas that mirrors production's renderer/camera/light
defaults, with live `leva` controls to tune tone mapping, exposure, and lighting
before porting the winning values back.

Mirrors, from `mc-studio-frontend`:
- `src/components/Viewer3D/Canvas3D/Canvas3D.tsx` — `gl` props (antialias, tone
  mapping, exposure), shadow map type, dpr clamp
- `src/components/Viewer3D/Camera/Camera..tsx` + `src/common/constant.ts` —
  default 3D FOV (`cameraConfig.threeDFov`)
- `src/components/Viewer3D/Light/lightingControlsStore.ts` — default ambient /
  rect-area / spot light values and shadow params

It does **not** pull in mc-studio-frontend's app state (MobX managers, room
geometry, API calls) — light positions here are static and adjustable via the
leva panel instead of being derived from room walls, since the sandbox has no
room to derive them from.

## Setup

1. Export a GLB from the real app: open the mc-studio-frontend browser console
   on a loaded closet and run `window.downloadGLB('model.glb')`.
2. Drop the downloaded file at `public/model.glb`.
3. `npm install`
4. `npm run dev`

## Workflow

Edit locally → `git commit` → `git push`. The CodeSandbox project imported
from this repo's GitHub URL tracks these commits for the live preview.

Once a lighting/tone-mapping setup looks better here, copy the specific
constants back into `Canvas3D.tsx` / `lightingControlsStore.ts` in
mc-studio-frontend — this repo has no business logic of its own to merge back,
just tuning values.

import { useEffect, useRef } from 'react';
import { Button, Text } from '@mantine/core';
import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  SceneLoader,
  Color3,
  Color4,
  StandardMaterial,
  TransformNode,
  Animation,
  CubicEase,
  EasingFunction,
  type AbstractMesh,
} from '@babylonjs/core';
import { STLFileLoader } from '@babylonjs/loaders/STL';
import { binColor } from '../sidebar/binColors';
import type { PreviewStl } from '../../hooks/useBinGeometry';

// Import STL vertices exactly as written. The loader's default Y/Z swap is a
// reflection (determinant −1), which renders the model as its mirror image; a
// right-handed scene plus a rigid −90° X rotation on the model root maps the
// file's Z-up frame to Babylon's Y-up frame without any mirroring.
STLFileLoader.DO_NOT_ALTER_FILE_COORDINATES = true;

// Default view: above the horizon looking down into the bin cavities, from the
// canvas-bottom side (+Z after the root rotation) so the plan orientation
// matches the shape editor.
const DEFAULT_ALPHA = Math.PI / 4;
const DEFAULT_BETA = Math.PI * 0.32;
const DEFAULT_RADIUS = 140;

const FIT_MARGIN = 1.08;   // headroom so the model doesn't touch the viewport edge
const ANIM_FPS = 60;
const ANIM_FRAMES = 36;    // 0.6 s ease-in-out

interface Props {
  previews: PreviewStl[];
  error: string | null;
}

export function BabylonViewer({ previews, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const rootRef = useRef<TransformNode | null>(null);
  const loadIdRef = useRef(0);
  const currentRef = useRef<{ meshes: AbstractMesh[]; materials: StandardMaterial[] }>({
    meshes: [],
    materials: [],
  });

  /**
   * Points the camera at the loaded model, choosing the radius that fits the
   * whole bounding box in view for the current FOV/aspect. Keeps the user's
   * orbit angle unless resetAngles is set (the Reset view button).
   */
  const fitCamera = (animate: boolean, resetAngles = false) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;

    let target = Vector3.Zero();
    let radius = DEFAULT_RADIUS;
    const meshes = currentRef.current.meshes;
    if (meshes.length > 0) {
      let min: Vector3 | null = null;
      let max: Vector3 | null = null;
      for (const m of meshes) {
        m.computeWorldMatrix(true);
        const bb = m.getBoundingInfo().boundingBox;
        min = min ? Vector3.Minimize(min, bb.minimumWorld) : bb.minimumWorld.clone();
        max = max ? Vector3.Maximize(max, bb.maximumWorld) : bb.maximumWorld.clone();
      }
      target = min!.add(max!).scale(0.5);
      const bound = max!.subtract(min!).length() / 2;
      const vFov = camera.fov;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * scene.getEngine().getAspectRatio(camera));
      radius = (bound / Math.sin(Math.min(vFov, hFov) / 2)) * FIT_MARGIN;
    }
    camera.upperRadiusLimit = Math.max(800, radius * 3);

    // Orbiting accumulates full turns in alpha; reset to the nearest equivalent
    // of the default so the camera doesn't spin all the way back around.
    const twoPi = 2 * Math.PI;
    const alpha = DEFAULT_ALPHA + twoPi * Math.round((camera.alpha - DEFAULT_ALPHA) / twoPi);

    if (!animate) {
      camera.target = target;
      camera.radius = radius;
      if (resetAngles) {
        camera.alpha = alpha;
        camera.beta = DEFAULT_BETA;
      }
      return;
    }

    scene.stopAnimation(camera);
    const ease = new CubicEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
    const start = (key: 'target' | 'radius' | 'alpha' | 'beta', to: Vector3 | number) =>
      Animation.CreateAndStartAnimation(`cam-${key}`, camera, key, ANIM_FPS, ANIM_FRAMES,
        key === 'target' ? camera.target.clone() : camera[key],
        to, Animation.ANIMATIONLOOPMODE_CONSTANT, ease);
    start('target', target);
    start('radius', radius);
    if (resetAngles) {
      start('alpha', alpha);
      start('beta', DEFAULT_BETA);
    }
  };

  // Initialise engine + scene once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    // Right-handed like the STL itself, so the render can never be mirrored.
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.11, 0.11, 0.13, 1);
    sceneRef.current = scene;

    // All model meshes are parented here: rotates the STL's Z-up into Y-up.
    const root = new TransformNode('modelRoot', scene);
    root.rotation.x = -Math.PI / 2;
    rootRef.current = root;

    const camera = new ArcRotateCamera('cam', DEFAULT_ALPHA, DEFAULT_BETA, DEFAULT_RADIUS, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 30;
    camera.upperRadiusLimit = 800;
    camera.wheelDeltaPercentage = 0.01;
    cameraRef.current = camera;

    // Hemispheric light: high groundColor so downward-facing surfaces (peg undersides) are lit.
    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.45;
    ambient.diffuse = new Color3(1, 1, 1);
    ambient.groundColor = new Color3(0.75, 0.75, 0.8);

    // Key light from upper-left-front.
    const key = new DirectionalLight('key', new Vector3(-1, -2, -1), scene);
    key.intensity = 0.7;

    // Fill light from below to illuminate the connector peg profile.
    const fill = new DirectionalLight('fill', new Vector3(0.5, 1, 0.5), scene);
    fill.intensity = 0.4;

    engine.runRenderLoop(() => scene.render());

    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    // The window doesn't fire 'resize' when the sidebar drag changes the
    // canvas's own container size, so watch the canvas directly too.
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas);

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      engine.dispose();
    };
  }, []);

  // Load the new model whenever fresh preview buffers arrive, one mesh group
  // per logical bin, colored with the same palette as the editors. The old
  // model stays on screen until the replacement is fully parsed.
  useEffect(() => {
    const scene = sceneRef.current;
    const root = rootRef.current;
    if (!scene || !root || previews.length === 0) return;

    const loadId = ++loadIdRef.current;

    Promise.all(previews.map(async (p) => {
      const url = URL.createObjectURL(new Blob([p.buffer], { type: 'application/octet-stream' }));
      try {
        const { meshes } = await SceneLoader.ImportMeshAsync('', url, '', scene, null, '.stl');
        meshes.forEach((m) => m.setEnabled(false)); // hidden until the whole swap commits
        return { bin: p.bin, meshes };
      } finally {
        URL.revokeObjectURL(url);
      }
    }))
      .then((groups) => {
        const loaded: AbstractMesh[] = [];
        const materials: StandardMaterial[] = [];
        groups.forEach(({ bin, meshes }) => {
          const mat = new StandardMaterial(`bin-${bin}`, scene);
          mat.diffuseColor = Color3.FromHexString(binColor(bin));
          mat.specularColor = new Color3(0.15, 0.15, 0.15);
          materials.push(mat);
          meshes.forEach((m) => {
            m.material = mat;
            m.parent = root;
            loaded.push(m);
          });
        });

        if (loadId !== loadIdRef.current) {
          // Superseded while parsing — discard this load.
          loaded.forEach((m) => m.dispose());
          materials.forEach((m) => m.dispose());
          return;
        }

        currentRef.current.meshes.forEach((m) => m.dispose());
        currentRef.current.materials.forEach((m) => m.dispose());
        currentRef.current = { meshes: loaded, materials };
        loaded.forEach((m) => m.setEnabled(true));

        // Keep the user's orbit angle; just glide to frame the new model.
        fitCamera(true);
      })
      .catch((err) => console.error('STL load failed:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previews]);

  return (
    <div className="viewer">
      <canvas ref={canvasRef} className="viewer-canvas" />
      <Button
        className="viewer-reset"
        size="compact-xs"
        variant="default"
        onClick={() => fitCamera(true, true)}
      >
        Reset view
      </Button>
      {error && (
        <div className="viewer-overlay viewer-overlay--error">
          <Text size="sm" c="red">Error: {error}</Text>
        </div>
      )}
    </div>
  );
}

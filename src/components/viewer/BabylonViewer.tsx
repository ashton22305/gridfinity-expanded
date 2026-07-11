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
  Effect,
  GeometryBufferRenderer,
  PostProcess,
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

// Deferred split-seam appearance. These are intentionally centralized here so
// the preview treatment can be tuned without touching geometry generation.
const SPLIT_SEAM_COLOR = new Color3(1, 0.03, 0.01);
const SPLIT_SEAM_WIDTH_PX = 1.25;
const SPLIT_SEAM_GLOW_RADIUS_PX = 6;
const SPLIT_SEAM_GLOW_INTENSITY = 0.8;

const SPLIT_ID_BASE = 0.125;
const SPLIT_ID_STEP = 1 / 512;

Effect.ShadersStore.splitSeamFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D splitIdSampler;
uniform vec2 texelSize;
uniform vec3 seamColor;
uniform vec3 seamParams;

float seamAt(vec2 uv, vec2 offset, vec2 centerId) {
  vec2 sampleUv = uv + offset * texelSize;
  vec2 otherId = texture2D(splitIdSampler, sampleUv).rg;
  // Babylon writes StandardMaterial specular colors to the reflectivity
  // attachment in linear space, so the encoded 0.125 base arrives near 0.014.
  float sameBin = 1.0 - step(0.0001, abs(centerId.r - otherId.r));
  float differentPiece = step(0.0001, abs(centerId.g - otherId.g));
  float validIds = step(0.005, centerId.r) * step(0.005, otherId.r);
  return sameBin * differentPiece * validIds;
}

float ring(vec2 uv, vec2 centerId, float radius) {
  vec2 x = vec2(radius, 0.0);
  vec2 y = vec2(0.0, radius);
  return max(
    max(seamAt(uv, x, centerId), seamAt(uv, -x, centerId)),
    max(seamAt(uv, y, centerId), seamAt(uv, -y, centerId))
  );
}

void main(void) {
  vec4 base = texture2D(textureSampler, vUV);
  vec2 centerId = texture2D(splitIdSampler, vUV).rg;
  float core = ring(vUV, centerId, seamParams.x);
  float nearGlow = ring(vUV, centerId, (seamParams.x + seamParams.y) * 0.5);
  float farGlow = ring(vUV, centerId, seamParams.y);
  float glow = max(nearGlow * seamParams.z, farGlow * seamParams.z * 0.35);
  float strength = clamp(max(core, glow), 0.0, 1.0);
  gl_FragColor = vec4(mix(base.rgb, seamColor, strength), base.a);
}
`;

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

    // The reflectivity attachment is repurposed as a per-piece ID buffer. The
    // final post-process compares neighboring IDs after ordinary scene shading.
    const geometryBuffer = scene.enableGeometryBufferRenderer();
    if (geometryBuffer) {
      geometryBuffer.enableReflectivity = true;
      const splitIdIndex = geometryBuffer.getTextureIndex(GeometryBufferRenderer.REFLECTIVITY_TEXTURE_TYPE);
      const seamPass = new PostProcess(
        'split-seam',
        'splitSeam',
        ['texelSize', 'seamColor', 'seamParams'],
        ['splitIdSampler'],
        1,
        camera,
      );
      seamPass.onApply = (effect) => {
        const gBuffer = geometryBuffer.getGBuffer();
        effect.setTexture('splitIdSampler', gBuffer.textures[splitIdIndex]);
        effect.setFloat2('texelSize', 1 / engine.getRenderWidth(), 1 / engine.getRenderHeight());
        effect.setColor3('seamColor', SPLIT_SEAM_COLOR);
        effect.setFloat3(
          'seamParams',
          SPLIT_SEAM_WIDTH_PX,
          SPLIT_SEAM_GLOW_RADIUS_PX,
          SPLIT_SEAM_GLOW_INTENSITY,
        );
      };
    }

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
        return { ...p, meshes };
      } finally {
        URL.revokeObjectURL(url);
      }
    }))
      .then((groups) => {
        const loaded: AbstractMesh[] = [];
        const materials: StandardMaterial[] = [];
        const splitBins = [...new Set(groups.filter((g) => g.pieceCount > 1).map((g) => g.bin))];
        groups.forEach(({ bin, piece, pieceCount, meshes }) => {
          const mat = new StandardMaterial(`bin-${bin}-piece-${piece}`, scene);
          mat.diffuseColor = Color3.FromHexString(binColor(bin));
          if (pieceCount > 1) {
            const groupId = splitBins.indexOf(bin) + 1;
            mat.specularColor = new Color3(
              SPLIT_ID_BASE + groupId * SPLIT_ID_STEP,
              SPLIT_ID_BASE + (piece + 1) * SPLIT_ID_STEP,
              0.15,
            );
          } else {
            mat.specularColor = new Color3(0, 0, 0.15);
          }
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

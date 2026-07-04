import { useEffect, useRef } from 'react';
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
} from '@babylonjs/core';
import '@babylonjs/loaders/STL';

interface Props {
  stlBuffer: ArrayBuffer | null;
  generating: boolean;
  error: string | null;
}

export function BabylonViewer({ stlBuffer, generating, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);

  // Initialise engine + scene once.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.11, 0.11, 0.13, 1);
    sceneRef.current = scene;

    // Camera starts at a low angle so the connector pegs on the underside are visible.
    const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI * 0.62, 140, Vector3.Zero(), scene);
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

    return () => {
      window.removeEventListener('resize', onResize);
      engine.dispose();
    };
  }, []);

  // Reload mesh whenever the STL buffer changes.
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !stlBuffer) return;

    // Dispose all existing meshes and materials before loading the new mesh.
    scene.meshes.slice().forEach((m) => m.dispose());
    scene.materials.slice().forEach((m) => m.dispose());

    const blob = new Blob([stlBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);

    SceneLoader.ImportMeshAsync('', url, '', scene, null, '.stl')
      .then(({ meshes }) => {
        URL.revokeObjectURL(url);

        const mat = new StandardMaterial('binMat', scene);
        mat.diffuseColor = new Color3(0.2, 0.55, 0.9);
        mat.specularColor = new Color3(0.15, 0.15, 0.15);

        meshes.forEach((m) => {
          m.material = mat;
        });

        // Auto-fit camera to the loaded geometry.
        if (camera && meshes.length > 0) {
          const bounds = meshes[0].getBoundingInfo().boundingBox;
          const centre = bounds.centerWorld;
          const size = bounds.maximumWorld.subtract(bounds.minimumWorld);
          const maxDim = Math.max(size.x, size.y, size.z);
          camera.target = centre;
          camera.radius = maxDim * 2;
        }
      })
      .catch((err) => {
        URL.revokeObjectURL(url);
        console.error('STL load failed:', err);
      });
  }, [stlBuffer]);

  const overlay =
    'pointer-events-none absolute inset-0 flex items-center justify-center gap-2.5 text-[0.9rem]';

  return (
    <div className="relative size-full overflow-hidden bg-zinc-900">
      <canvas ref={canvasRef} className="block size-full outline-none" />
      {generating && (
        <div className={`${overlay} bg-zinc-900/70 text-zinc-300`}>
          <span
            className="inline-block size-[18px] animate-spin rounded-full border-2 border-white/20 border-t-white"
            aria-hidden="true"
          />
          Generating…
        </div>
      )}
      {error && !generating && (
        <div className={`${overlay} bg-zinc-900/85 text-red-400`}>
          Error: {error}
        </div>
      )}
    </div>
  );
}

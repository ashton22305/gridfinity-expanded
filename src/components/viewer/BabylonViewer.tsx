import { useCallback, useEffect, useRef } from 'react';
import { Button, Text } from '@mantine/core';
import {
  Animation,
  ArcRotateCamera,
  Color3,
  Color4,
  CubicEase,
  DirectionalLight,
  EasingFunction,
  Engine,
  HemisphericLight,
  Mesh,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import type { GeneratedPart } from '../../lib/types';
import { binColor } from '../sidebar/binColors';

const DEFAULT_ALPHA = Math.PI / 4;
const DEFAULT_BETA = Math.PI * 0.32;
const DEFAULT_RADIUS = 140;
const FIT_MARGIN = 1.08;
const ANIMATION_FPS = 60;
const ANIMATION_FRAMES = 36;

interface Props {
  parts: GeneratedPart[];
  error: string | null;
}

export function BabylonViewer({ parts, error }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const rootRef = useRef<TransformNode | null>(null);
  const currentRef = useRef<{ meshes: Mesh[]; materials: StandardMaterial[] }>({
    meshes: [],
    materials: [],
  });

  const fitCamera = useCallback((animate: boolean, resetAngles = false) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;

    let target = Vector3.Zero();
    let radius = DEFAULT_RADIUS;
    const meshes = currentRef.current.meshes;
    if (meshes.length > 0) {
      let min: Vector3 | null = null;
      let max: Vector3 | null = null;
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo().boundingBox;
        min = min ? Vector3.Minimize(min, bounds.minimumWorld) : bounds.minimumWorld.clone();
        max = max ? Vector3.Maximize(max, bounds.maximumWorld) : bounds.maximumWorld.clone();
      }
      target = min!.add(max!).scale(0.5);
      const bound = max!.subtract(min!).length() / 2;
      const verticalFov = camera.fov;
      const horizontalFov = 2 * Math.atan(
        Math.tan(verticalFov / 2) * scene.getEngine().getAspectRatio(camera),
      );
      radius = bound / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * FIT_MARGIN;
    }
    camera.upperRadiusLimit = Math.max(800, radius * 3);
    const twoPi = Math.PI * 2;
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
    const easing = new CubicEase();
    easing.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
    const start = (key: 'target' | 'radius' | 'alpha' | 'beta', to: Vector3 | number) =>
      Animation.CreateAndStartAnimation(
        `camera-${key}`,
        camera,
        key,
        ANIMATION_FPS,
        ANIMATION_FRAMES,
        key === 'target' ? camera.target.clone() : camera[key],
        to,
        Animation.ANIMATIONLOOPMODE_CONSTANT,
        easing,
      );
    start('target', target);
    start('radius', radius);
    if (resetAngles) {
      start('alpha', alpha);
      start('beta', DEFAULT_BETA);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0.11, 0.11, 0.13, 1);
    sceneRef.current = scene;

    // The generated mesh is Z-up. This is the viewer's only coordinate change.
    const root = new TransformNode('model-root', scene);
    root.rotation.x = -Math.PI / 2;
    rootRef.current = root;

    const camera = new ArcRotateCamera(
      'camera', DEFAULT_ALPHA, DEFAULT_BETA, DEFAULT_RADIUS, Vector3.Zero(), scene,
    );
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 30;
    camera.upperRadiusLimit = 800;
    camera.wheelDeltaPercentage = 0.01;
    cameraRef.current = camera;

    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.45;
    ambient.diffuse = new Color3(1, 1, 1);
    ambient.groundColor = new Color3(0.75, 0.75, 0.8);
    const key = new DirectionalLight('key', new Vector3(-1, -2, -1), scene);
    key.intensity = 0.7;
    const fill = new DirectionalLight('fill', new Vector3(0.5, 1, 0.5), scene);
    fill.intensity = 0.4;

    engine.runRenderLoop(() => scene.render());
    const resize = () => engine.resize();
    window.addEventListener('resize', resize);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      window.removeEventListener('resize', resize);
      observer.disconnect();
      engine.dispose();
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const root = rootRef.current;
    if (!scene || !root) return;

    currentRef.current.meshes.forEach((mesh) => mesh.dispose());
    currentRef.current.materials.forEach((material) => material.dispose());
    const materials = new Map<string, StandardMaterial>();
    const meshes = parts.map((part) => {
      let material = materials.get(part.binId);
      if (!material) {
        material = new StandardMaterial(`bin-${part.binId}`, scene);
        material.diffuseColor = Color3.FromHexString(binColor(part.binId));
        material.specularColor = new Color3(0.15, 0.15, 0.15);
        materials.set(part.binId, material);
      }
      const mesh = new Mesh(part.id, scene);
      const vertexData = new VertexData();
      const normals: number[] = [];
      VertexData.ComputeNormals(part.mesh.positions, part.mesh.indices, normals);
      vertexData.positions = part.mesh.positions;
      vertexData.indices = part.mesh.indices;
      vertexData.normals = normals;
      vertexData.applyToMesh(mesh);
      mesh.material = material;
      mesh.parent = root;
      mesh.position.set(
        part.layoutPosition.x + part.previewOffset.x,
        part.layoutPosition.y + part.previewOffset.y,
        0,
      );
      return mesh;
    });
    currentRef.current = { meshes, materials: [...materials.values()] };
    fitCamera(true);
  }, [fitCamera, parts]);

  return (
    <div
      className="viewer"
      data-part-count={parts.length}
      data-preview-offsets={parts.map((part) =>
        `${part.previewOffset.x.toFixed(2)},${part.previewOffset.y.toFixed(2)}`).join(';')}
    >
      <canvas ref={canvasRef} className="viewer-canvas" aria-label="3D bin preview" />
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
          <Text size="sm" c="red">{error}</Text>
        </div>
      )}
    </div>
  );
}

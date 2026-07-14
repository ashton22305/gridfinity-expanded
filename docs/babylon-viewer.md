# Babylon Viewer

The normative preview/export relationship and coordinate rules live in [`geometry-pipeline.md`](./geometry-pipeline.md). This document records the viewer-specific implementation.

## Input

`BabylonViewer` receives the same `GeneratedPart[]` that `ExportMenu` serializes. Each part contains final local-print `positions` and `indices`, its model-space `layoutPosition`, and a preview-only `previewOffset`.

There is no preview STL, `Blob`, object URL, `SceneLoader`, STL loader, asynchronous parse, or loader race. On a new part array, the viewer synchronously replaces its Babylon meshes and applies `VertexData` directly. Normals are computed from the indexed winding for lighting.

## Scene coordinates

The generated meshes are right-handed and Z-up. The scene is right-handed. All model meshes share one root whose only coordinate transform is `rotation.x = -Math.PI / 2`, mapping model Z to Babylon Y. The viewer must not mirror X or Y; row-down editor coordinates were already normalized before geometry generation.

Every mesh is placed at:

```text
layoutPosition + previewOffset
```

The 0.3 mm multipart gap therefore exists only in transforms. Export never observes it.

## Lifecycle and camera

The engine, scene, root, camera, and lights are created once. A `ResizeObserver` keeps the canvas matched to resizable side panels. New part arrays dispose the previous meshes/materials, construct replacements, and refit the camera while preserving the user's orbit angle. “Reset view” also restores the default orbit.

The generic worker failure message overlays the canvas while the last successful part array remains available in the hook. Viewer code does not classify geometry or input errors.

# Babylon Viewer

The normative preview/export relationship and coordinate rules live in [`geometry-pipeline.md`](./geometry-pipeline.md). This document records viewer-specific behavior.

## Input and meshes

`BabylonViewer` receives the same `GeneratedPart[]` that `ExportMenu` serializes. Each part contains a `binIndex`, a global-coordinate `Float32Array` triangle soup, and a preview-only offset.

There is no preview STL, loader, vertex welding, smoothing, or vertex splitting. The viewer creates sequential indices for the soup, computes normals, and applies `VertexData` directly. Since every triangle owns three vertices, its normal remains independent and the preview is flat-faceted. Manifold emits outward counter-clockwise winding, so the shared Babylon materials explicitly use counter-clockwise face orientation in the right-handed scene; back-face culling remains enabled and hides only the solid interior.

## Coordinates

Geometry preserves the editor's row-down X/Y values and uses Z-up. The right-handed Babylon scene rotates the shared root by `-Math.PI / 2` to display Z-up data in Y-up space. The default camera orbits from the opposite Z side so editor rows retain their visible direction without mirroring geometry.

Meshes stay at their generated coordinates. Only `previewOffset` is applied as a mesh transform, creating the 0.3 mm multipart gap without changing exported triangles.

## Lifecycle and camera

The engine, scene, root, camera, and lights are created once. A `ResizeObserver` keeps the canvas matched to the resizable side panels. New part arrays dispose old meshes and materials, construct replacements, and refit the camera while preserving the user's orbit. “Reset view” restores the default orbit.

The generic worker failure message overlays the canvas while the last successful parts remain available. Viewer code does not classify geometry or input errors.

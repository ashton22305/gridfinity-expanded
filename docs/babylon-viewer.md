# Babylon Viewer

The normative preview/export relationship and coordinate rules live in [`geometry-pipeline.md`](./geometry-pipeline.md). This document records viewer-specific behavior.

## Input and meshes

`BabylonViewer` receives the same `Bin[]` that `ExportMenu` splits into printable objects, plus the validated design snapshot that produced it. `previewLayout()` in `src/lib/preview.ts` — the "modifications for better viewing" stage — flattens each bin's grouped pieces and computes their preview-only multipart gap offsets from each piece's echoed footprint cells and its bin's cuts in the paired snapshot. Each flattened piece keeps the stable `binId` shared with the 2D editors, and materials and palette colors are keyed by that id, so the 3D preview always matches the editor color for the same bin even after deletions cause ids and array positions to diverge.

There is no preview STL, loader, vertex welding, smoothing, or vertex splitting. The viewer creates sequential indices for the soup, computes normals, and applies `VertexData` directly. Since every triangle owns three vertices, its normal remains independent and the preview is flat-faceted. Manifold emits outward counter-clockwise winding, so the shared Babylon materials explicitly use counter-clockwise face orientation in the right-handed scene; back-face culling remains enabled and hides only the solid interior.

## Coordinates

Geometry preserves the editor's row-down X/Y values and uses Z-up. The right-handed Babylon scene rotates the shared root by `-Math.PI / 2` to display Z-up data in Y-up space. The default camera orbits from the opposite Z side so editor rows retain their visible direction without mirroring geometry.

Meshes stay at their generated coordinates. Only the `previewLayout()` offset is applied as a mesh transform, creating the 0.3 mm multipart gap without changing exported triangles.

## Lifecycle and camera

`App` loads the named `BabylonViewer` export through `React.lazy` as soon as the center pane mounts. Its `Suspense` fallback fills the same pane while the separate viewer chunk loads, so the preview remains an always-present part of the layout. Viewer code imports concrete Babylon ESM modules instead of the package barrel. Keep the side-effect modules for the engine, arc-rotate camera, and `Animations/animatable.js`: the last one installs the `Scene` animation methods used by camera fit and reset transitions.

The engine, scene, root, camera, and lights are created once. A `ResizeObserver` keeps the canvas matched to the resizable side panels. New bin arrays dispose old meshes and materials, construct replacements, and refit the camera while preserving the user's orbit. “Reset view” restores the default orbit.

The generic worker failure message overlays the canvas while the last successful parts remain available. Viewer code does not classify geometry or input errors.

# Babylon Viewer

The normative preview/export relationship and coordinate rules live in [`geometry-pipeline.md`](./geometry-pipeline.md). This document records viewer-specific behavior.

## Input and meshes

`BabylonViewer` receives the same `Bin[]` that `ExportMenu` splits into printable objects, plus the validated design snapshot that produced it and derived full/safe printer-volume dimensions. `previewLayout()` in `src/lib/preview.ts` — the "modifications for better viewing" stage — flattens each bin's grouped pieces, mirrors its bin's cuts into the generated coordinate frame, and computes preview-only multipart gap offsets from those cuts and each piece's echoed generation-coordinate footprint cells. Each flattened piece keeps the stable `binId` shared with the 2D editors, and materials and palette colors are keyed by that id, so the 3D preview always matches the editor color for the same bin even after deletions cause ids and array positions to diverge.

There is no preview STL, loader, vertex welding, smoothing, or vertex splitting. The viewer creates sequential indices for the soup, computes normals, and applies `VertexData` directly. Since every triangle owns three vertices, its normal remains independent and the preview is flat-faceted. Manifold emits outward counter-clockwise winding, so the shared Babylon materials explicitly use counter-clockwise face orientation in the right-handed scene; back-face culling remains enabled and hides only the solid interior.

## Coordinates

`buildBinParameters()` mirrors the editor's row-down Y values across the complete design's occupied height before geometry generation; geometry uses those global coordinates with Z-up. The right-handed Babylon scene rotates the shared root by `-Math.PI / 2` to display Z-up data in Y-up space. It does not transform the mesh again for orientation. The default camera uses an alpha of `3π / 4`, a 180-degree orbit from the pre-mirror view, so the generated layout immediately faces the same direction as the editor.

Meshes stay at their generated coordinates. Only the `previewLayout()` offset is applied as a mesh transform, creating the 0.3 mm multipart gap without changing exported triangles.

The printer overlay contains separate wireframe boxes for the full X/Y/Z build volume and the safe volume after applying the per-side X/Y head-clearance inset. Both use the same Z-up model root and are centered on the unspaced generated cell footprint. They are viewer-owned meshes: they are never included in `Bin[]`, geometry cache entries, printable objects, or STL output.

![Asymmetric vertically separated bins matching between the editor and viewer](./images/babylon-viewer-mirrored-multi-bin.png)

## Lifecycle and camera

`App` loads the named `BabylonViewer` export through `React.lazy` as soon as the center pane mounts. Its `Suspense` fallback fills the same pane while the separate viewer chunk loads, so the preview remains an always-present part of the layout. Viewer code imports concrete Babylon ESM modules instead of the package barrel. Keep the side-effect modules for the engine, arc-rotate camera, and `Animations/animatable.js`: the last one installs the `Scene` animation methods used by camera fit and reset transitions.

The engine, scene, root, camera, and lights are created once. A `ResizeObserver` keeps the canvas matched to the resizable side panels. New bin arrays dispose old meshes and materials, construct replacements, and refit the camera while preserving the user's orbit. Volume overlays have a separate lifecycle and are deliberately excluded from the mesh set used to calculate camera fit, so a tall printer does not shrink the generated part preview. “Reset view” restores the editor-matching `3π / 4` orbit.

The generic worker failure message overlays the canvas while the last successful parts remain available. Viewer code does not classify geometry or input errors.

# gridfinity-expanded

Browser-based Gridfinity bin generator. Supports non-rectangular (tetris-piece) bin shapes, irregular divider placement, and configurable heights. Exports STL for FDM printing.

## Tech stack

| Concern | Library | Why |
|---|---|---|
| Framework | React 18 + Vite 6 | Stable, GitHub Pages deploy |
| Geometry (authoring) | `@jscad/modeling` | Programmatic CSG in TypeScript; builds the 2D profiles and primitive solids |
| Geometry (booleans) | `manifold-3d` (WASM) | Guaranteed watertight, 2-manifold output — JSCAD's mesh booleans leave non-manifold T-junctions and its `offset()` self-intersects on thick walls |
| 3D preview | Babylon.js | Microsoft-maintained; TypeScript-first |
| Bundler | Vite 6 (rollup) | Vite 8 rolldown OOMs on large @jscad bundles |
| Styling | CSS Modules | Ready for shadcn/ui or similar later |
| Deploy | GitHub Actions → GitHub Pages | `.github/workflows/deploy.yml` |

## Project layout

```
src/
  lib/
    types.ts              shared types: BinConfig, GridCell, PrinterProfile
    printers.ts           printer profiles + bed-fit calculation
    geometry/
      gridfinity.ts       builds profiles/primitives; generateBinManifold() is the
                          default path, generateBin() (pure JSCAD) is the fallback
      manifold.ts         manifold-3d WASM init + JSCAD→manifold bridge + output weld
    export/
      stl.ts              STL download helper + meshToStl() (indexed mesh → binary STL)
  workers/
    geometry.worker.ts    Web Worker: manifold path (STL via meshToStl), JSCAD fallback
  hooks/
    useBinGeometry.ts     debounces config changes, drives worker, exposes STL buffer
  components/
    layout/
      AppLayout.tsx       two-column layout (sidebar + viewer)
    sidebar/
      Sidebar.tsx         tabbed left panel
      tabs/
        ShapeTab.tsx      click/drag grid cell editor (6×6)
        DimensionsTab.tsx height units (1–8u), wall thickness
        PrinterTab.tsx    printer presets + bed-fit warning
    viewer/
      BabylonViewer.tsx   Babylon.js canvas; reloads mesh on stlBuffer change
    ExportMenu.tsx        Export STL button
  App.tsx                 root: owns BinConfig + PrinterProfile state
```

## Gridfinity dimensions (key constants in gridfinity.ts)

| Name | Value | Source |
|---|---|---|
| `GRID_PITCH` | 42 mm | Gridfinity standard |
| `OUTER_SIZE` | 41.5 mm | 42 − 0.5 mm clearance |
| `BASE_HEIGHT` | 4.75 mm | Gridfinity standard |
| `FLOOR_THICKNESS` | 1.2 mm | one nozzle width |
| `HEIGHT_PER_UNIT` | 7 mm | Gridfinity standard |
| `MAGNET_RADIUS` | 3.25 mm | 6.5 mm OD N52 disc magnets |
| `MAGNET_DEPTH` | 2.4 mm | 2 mm magnet + 0.4 mm tolerance |
| `MAGNET_INSET` | 13.5 mm | from cell centre to magnet centre |

## Adding features

- **New bin parameter** → add to `BinConfig` in `types.ts`, update `gridfinity.ts` (both `generateBinManifold` and the `generateBin` fallback), add control in the appropriate tab component.
- **New tab** → add to `TABS` in `Sidebar.tsx`, create `src/components/sidebar/tabs/MyTab.tsx`.
- **New export format** → add serializer in `lib/export/`, add option to `ExportMenu.tsx`.
- **Manifold correctness** → after any geometry change, run `npm run check:manifold`. It builds every config in the test matrix and asserts the exported STL is watertight and 2-manifold (no boundary/non-manifold edges, degenerate or duplicate faces). Combine solids with manifold booleans and do inward 2D offsets with `CrossSection.offset` (never JSCAD `offset()` for large inward deltas — it self-intersects). Feed the manifold engine only individually-closed primitives, and keep stacked junctions **flush** (manifold fuses coincident faces exactly; overlaps of differing cross-sections leave slivers).
- **Theming** → CSS Modules are used everywhere. When adding shadcn/ui: install it, wrap the app in its provider, and progressively replace CSS Module components.

## Local dev

```bash
npm install
npm run dev
```

## Deployment

Push to `main`. GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages automatically. The `base` path (`/gridfinity-expanded/`) is applied only when `CI=true`.

## Known limitations (MVP)

- Bottom chamfer on bin edges not yet implemented (printable but not spec-perfect).
- Babylon.js main bundle is ~6 MB; switch to tree-shaken imports from `@babylonjs/core/...` to reduce.
- Grid editor is fixed at 6×6 cells; larger grids need a size control.
- STL only; 3MF export not yet wired (`@jscad/3mf-serializer` is installed).

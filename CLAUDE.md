# gridfinity-expanded

Browser-based Gridfinity bin generator. Supports non-rectangular (tetris-piece) bin shapes, irregular divider placement, and configurable heights. Exports STL for FDM printing.

## Tech stack

| Concern | Library | Why |
|---|---|---|
| Framework | React 18 + Vite 6 | Stable, GitHub Pages deploy |
| Geometry | `@jscad/modeling` | Programmatic CSG in TypeScript; no WASM for MVP |
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
      gridfinity.ts       JSCAD CSG: generates Gridfinity bin Geom3
    export/
      stl.ts              STL blob download helper
  workers/
    geometry.worker.ts    Web Worker: runs JSCAD off the main thread
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

- **New bin parameter** → add to `BinConfig` in `types.ts`, update `gridfinity.ts`, add control in the appropriate tab component.
- **New tab** → add to `TABS` in `Sidebar.tsx`, create `src/components/sidebar/tabs/MyTab.tsx`.
- **New export format** → add serializer in `lib/export/`, add option to `ExportMenu.tsx`.
- **Performance** → geometry is already in a Web Worker; if generation is still slow, consider manifold-wasm as a drop-in replacement for JSCAD's boolean operations.
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

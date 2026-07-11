# Repository Guidelines

## Project Structure & Module Organization

This repository is a React 19 + Vite 6 TypeScript app for generating and exporting Gridfinity bin STL files. `src/main.tsx` mounts the app, `src/App.tsx` defines the Mantine AppShell layout, `src/store.ts` owns global state with Zustand, and `src/theme.ts` centralizes Mantine control defaults.

Domain logic lives in `src/lib/`: shared config/types in `types.ts`, edge helpers in `edges.ts`, split/logical-bin helpers in `split.ts`, printer fit logic in `printers.ts`, geometry builders and mesh validation helpers in `geometry/`, and STL download/serialization in `export/stl.ts`. Geometry runs in `src/workers/geometry.worker.ts`, driven by the debounced hook in `src/hooks/useBinGeometry.ts`.

UI is under `src/components/`. The AppShell has two resizable side panels around the viewer: the left sidebar (`Sidebar.tsx`) hosts the spatial editor tabs `ShapeTab`, `WallsTab`, and `SplitTab`, while the right settings panel (`SettingsPanel.tsx`) stacks the parameter-form sections `PrinterTab`, `DimensionsTab`, and `FeaturesTab` in one scroll view. All six components live in `src/components/sidebar/tabs/`, and both panels resize through `PanelResizeHandle.tsx` with widths owned by the store (`panelWidths`). `BabylonViewer.tsx` previews generated STL buffers. Static deployment assets are in `public/`; validation utilities are in `scripts/`; Vitest unit tests live beside source files as `*.test.ts`, and Playwright smoke tests live in `e2e/`.

## Build, Test, and Development Commands

- `npm install`: install local dependencies.
- `npm run dev`: start Vite with hot reload.
- `npm run build`: run TypeScript project checks and build `dist/`.
- `npm run lint`: run Oxlint.
- `npm run check:manifold`: bundle and run the production-path geometry/STL manifold validation matrix.
- `npm run preview`: serve the production build locally.

For non-trivial changes, run `npm run build` and `npm run lint`. For geometry, split, STL export, printer-fit, or config-shape changes, also run `npm run check:manifold`. Vitest and Playwright configuration is present for unit and browser smoke coverage; CI runs those suites alongside lint, build, and manifold validation.

## Coding Style & Naming Conventions

Use TypeScript ES modules, React function components, and two-space indentation. Component files use `PascalCase.tsx`; hooks use `useName.ts`; pure helpers use descriptive camelCase exports. Keep shared shape/config contracts in `src/lib/types.ts` and keep reusable domain logic in `src/lib/`, not inside components. TypeScript rejects unused locals and unused parameters.

Tabs should read and write through `useAppStore()` instead of prop drilling. `BinConfig` stores explicit `LogicalBin` entries; each bin owns its cells, manual/automatic split mode, effective `splitLines`, and optional slope. Use `updateBin()` for bin-owned state so automatic split lines stay effective, and keep `BinConfig` plain JSON-compatible data for worker `postMessage`.

## Architecture Notes

`useBinGeometry()` keeps one module worker alive, waits 1000 ms after config changes, sends a `requestId`, and ignores stale replies. The worker initializes `manifold-3d` through Vite's `manifold.wasm?url`; if WASM init or generation fails, it falls back to `generateBinPiecesJscad()`.

The production geometry path is `generateBinPieces()` / `generateBinManifold()` in `src/lib/geometry/gridfinity.ts`. JSCAD authors primitive solids and profiles; `manifold-3d` performs robust booleans, inward offsets, and final mesh output. `manifoldMesh()` is part of the export path and must remain in place because it welds output vertices and repairs float32-degenerate slivers.

Key constants include `GRID_PITCH = 42`, `HEIGHT_PER_UNIT = 7`, `BASE_TOTAL_HEIGHT = 7`, `FLOOR_THICKNESS = 1.2`, `MAGNET_RADIUS = 3.25`, `MAGNET_DEPTH = 2.4`, `SCREW_RADIUS = 1.5`, `SCREW_DEPTH = 6.0`, and `FASTENER_INSET = 13.0`.

## Geometry Implementation Rules

The outer wall always follows the Gridfinity spec profile: 41.5 mm top width and 3.75 mm outer radius. `cavityCornerRadius` affects only the cavity interior. `LogicalBin` owns the cells for each separate logical bin; adjacent cells in different logical bins become separate complete bins with their own walls.

`openEdges` remove perimeter walls, and `dividerEdges` add internal grid-aligned walls. Free-form `innerWalls` are mm segments with per-wall width and optional height; lower walls ramp into taller structures in the manifold path. `LogicalBin.slope` is optional; absent means flat, and zero-angle slope entries should not be persisted. Split seam edges come from each logical bin's own `splitLines` and are open unless a divider lies exactly on the split line. Every output mesh (previews and export pieces) is mirrored across Y on the way out of `generateBinPieces`/`generateBinPiecesJscad` because the editors map SVG y (downward) straight to mm +y, so an unmirrored part would print as the chiral mirror of the drawn layout.

When changing geometry, combine solids with manifold booleans and do inward 2D offsets with `CrossSection.offset`; do not use JSCAD `offset()` for large inward deltas. Feed manifold only individually closed primitives. Do not stack extrusions flush unless the joining z coordinates are bit-identical; otherwise use `CSG_EPSILON` overlap into a containing neighbor to avoid zero-thickness membranes.

## Implementing Features

- **New bin parameter**: add global parameters to `BinConfig` or per-bin parameters to `LogicalBin` in `src/lib/types.ts`, add a default in `DEFAULT_CONFIG` in `src/store.ts`, update both the manifold and JSCAD fallback paths in `gridfinity.ts`, then add the UI control in the appropriate tab using `updateConfig({ ... })` or `updateBin(id, { ... })`.
- **New tab or settings section**: create `src/components/sidebar/tabs/MyTab.tsx` and read state with `useAppStore()`. Spatial editors go in `TABS` in `src/components/sidebar/Sidebar.tsx` (left panel); parameter forms go in `SECTIONS` in `src/components/sidebar/SettingsPanel.tsx` (right panel).
- **New export format**: add helpers under `src/lib/export/`, then extend `ExportMenu.tsx`. `@jscad/3mf-serializer` is installed, but no 3MF UI/export path exists yet.
- **New printer behavior**: update `PRINTER_PROFILES`, `checkBedFit()`, `computeAutoSplitLines()`, or `checkPieceFit()` in `src/lib/printers.ts`; remember automatic split lines are derived per bin in the store.
- **Worker-visible changes**: keep transferred data structured-clone friendly and return buffers that can be transferred from the worker.

## UI, Styling, and Theming

Use Mantine components and layout primitives before creating custom UI. Put cross-app control styling in `src/theme.ts` via `createTheme()` component defaults. Use `src/index.css` only for global sizing, AppShell/viewer/sidebar scaffolding, and documented library workarounds. Use `src/components/sidebar/editor.css` only for bespoke SVG grid editors that Mantine cannot express.

Avoid design constants in JSX. Inline style is acceptable for genuinely data-driven values such as bin color, SVG wall thickness, grid dimensions, or a small library workaround that cannot live cleanly in the theme.

## Common Mistakes to Avoid

- **Do not reinvent the wheel.** Prioritize fitting the conventions of this codebase over subjective visual polish unless explicitly asked to restructure. Prefer existing well-maintained libraries and the stack already in use.
- **Do not provide suboptimal solutions because they are common or quick.** For example, inserting raw HTML into a `.tsx` file may be fast, but this app should rely on Mantine and existing components. Shortcuts that avoid the stack are acceptable only when no elegant existing-library solution exists, and they must be justified in code comments and in the final report.
- **Do not bypass the store contract.** Tabs should read/write through `useAppStore()`, and bin-owned state should go through `updateBin()` so automatic split lines stay effective.
- **Do not treat JSCAD fallback as the primary quality bar.** Keep it usable, but production correctness is defined by the manifold path and `npm run check:manifold`.
- **Do not add unrelated refactors.** Geometry, UI, and deployment assumptions are tightly coupled; keep edits scoped to the requested behavior.

## Commit & Pull Request Guidelines

Recent commits use short, imperative subjects such as `Replace Tailwind CSS with Mantine for centralized styling` and `Guarantee watertight, manifold STL exports via manifold-3d`. Keep subjects concise and behavior-focused. Pull requests should describe user-visible changes, list validation commands run, link related issues, and include screenshots or recordings for UI changes. For geometry or export changes, call out printability and manifold implications.

## Deployment and Configuration

GitHub Actions deploys pushes to `main` with Node 20, `npm ci`, `npm run build`, and GitHub Pages artifact upload. The app is served from `gridfinityexpanded.ashtonsouth.me`; `public/CNAME` pins that domain and `vite.config.ts` keeps `base: '/'`. Change the Vite base deliberately if deployment moves back to a GitHub Pages project subpath.

## Known Limitations

STL is the only wired export format. The JSCAD fallback skips inner-wall transition ramps, stair-steps sloped floors, and can degrade split seam profile behavior if 2D intersection fails. Babylon.js imports include broad engine, loader, camera, lighting, and material support; optimize imports if bundle size becomes a priority.

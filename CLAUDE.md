# gridfinity-expanded

Browser-based Gridfinity bin generator. It supports non-rectangular cell layouts, multiple logical bins in one editor, removable perimeter walls, grid dividers, free-form inner walls, split-for-printer export pieces, per-bin sloped floors, magnet recesses, and screw pilot holes. The app previews generated STL in the browser and exports binary STL files for FDM printing.

## Tech Stack

| Concern | Library | Notes |
|---|---|---|
| Framework | React 19 + Vite 6 | `src/main.tsx` mounts the app and forces Mantine dark mode. |
| State | `zustand` | One `useAppStore` owns `BinConfig`, printer profile, editor grid size, and side-panel widths. Tabs read/write the store directly. |
| UI | Mantine 9 + PostCSS | AppShell owns layout chrome. Cross-app control defaults live in `src/theme.ts`; custom SVG editor styles live in `src/components/sidebar/editor.css`. |
| Geometry authoring | `@jscad/modeling` | Builds 2D profiles and primitive solids in TypeScript. |
| Geometry booleans | `manifold-3d` WASM | Production path for robust booleans, inward offsets, and watertight 2-manifold mesh output. |
| Fallback geometry | JSCAD-only path | Used if WASM fails; split-aware, but lower fidelity for some features. |
| Preview | Babylon.js | `BabylonViewer` loads generated STL buffers with the STL loader and auto-fits the camera. |
| Export | Custom binary STL serializer | `meshToStl()` serializes manifold indexed meshes; `@jscad/stl-serializer` is used only for fallback. |
| Deploy | GitHub Actions → GitHub Pages | `.github/workflows/deploy.yml`; custom domain is pinned by `public/CNAME`. |

## Project Layout

```text
src/
  main.tsx                 React root, MantineProvider, forced dark scheme
  App.tsx                  AppShell header/sidebar/viewer/settings-panel layout
  store.ts                 zustand store, defaults, auto split derivation, grid/panel sizing
  theme.ts                 Mantine component defaultProps and centralized control styling
  index.css                global sizing, AppShell workaround, viewer/panel scaffolding
  lib/
    types.ts               shared BinConfig, GridCell, GridEdge, InnerWall, SplitLine, PrinterProfile
    edges.ts               edge keys, perimeter/internal edge scans, wall toggle helpers
    split.ts               split-line sorting/partitioning and logical-bin grouping
    printers.ts            printer presets, bed fit checks, auto split line calculation
    geometry/
      gridfinity.ts        manifold and JSCAD geometry builders
      manifold.ts          WASM init, JSCAD adapters, mesh weld/repair
    export/
      stl.ts               download helpers and binary STL serialization
  workers/
    geometry.worker.ts     manifold generation with JSCAD fallback; returns per-bin preview + per-piece STL buffers
  hooks/
    useBinGeometry.ts      1s debounce, long-lived worker, stale request discard
  components/
    ExportMenu.tsx         single or multi-piece STL download menu
    viewer/BabylonViewer.tsx
    ui/                    Field, SliderField, StatusBanner wrappers
    sidebar/
      Sidebar.tsx          left-panel tab map: Shape, Walls, Split (spatial editors)
      SettingsPanel.tsx    right-panel section stack: Printer, Dimensions, Features
      PanelResizeHandle.tsx  inner-edge drag strip shared by both side panels
      EditorCanvas.tsx     shared SVG grid/editor background
      editorCoords.ts      SVG/grid/mm coordinate conversion
      binColors.ts         logical-bin color palette
      editor.css           bespoke SVG editor and grid-cell styles
      tabs/
        ShapeTab.tsx       resizable 1-40 cell editor, drag painting, multi-bin palette
        WallsTab.tsx       perimeter open walls, internal dividers, free-form inner walls
        SplitTab.tsx       auto/manual split lines and per-piece bed-fit status
        DimensionsTab.tsx  height, wall thickness, cavity radius, inner fillet, base slopes (settings section)
        FeaturesTab.tsx    magnet recess and M3 screw pilot toggles (settings section)
        PrinterTab.tsx     printer presets, custom bed size, bed-fit status (settings section)
scripts/check-manifold.ts  production-path manifold/STL validation matrix
```

## Runtime Flow

`App.tsx` reads config and panel widths from `useAppStore`, passes config to `useBinGeometry`, and renders `ExportMenu` plus `BabylonViewer`. The AppShell has two resizable side panels: the left sidebar (`AppShell.Navbar`) hosts the spatial editor tabs (Shape, Walls, Split), and the right settings panel (`AppShell.Aside`) stacks the parameter forms (Printer, Dimensions, Features) in one scroll view. Both panels resize via `PanelResizeHandle` on their inner edge, clamped by `PANEL_MIN_WIDTH`/`PANEL_MAX_WIDTH` in `store.ts`. `useBinGeometry` keeps one module worker alive, waits 1000 ms after config changes, tags each request with `requestId`, and ignores stale worker replies. The worker initializes `manifold-3d` through Vite's `manifold.wasm?url`; if init or generation fails, it falls back to `generateBinPiecesJscad()` and serializes with `@jscad/stl-serializer`.

In auto split mode, `store.ts` re-derives `splitLines` on every config or printer write via `computeAutoSplitLines()`. The stored config is therefore the effective config consumed by geometry.

## Gridfinity Constants

Key values in `src/lib/geometry/gridfinity.ts`:

| Name | Value | Meaning |
|---|---:|---|
| `GRID_PITCH` | 42 mm | Gridfinity cell pitch |
| `HEIGHT_PER_UNIT` | 7 mm | height-unit increment |
| `BASE_TOTAL_HEIGHT` | 7 mm | connector peg plus bridge before cavity floor |
| `PEG_HEIGHT` | 4.75 mm | connector peg height |
| `PEG_W_TOP` | 41.5 mm | 42 mm pitch minus 0.5 mm clearance |
| `PEG_R_TOP` / `OUTER_R` | 3.75 mm | spec outer corner radius |
| `FLOOR_THICKNESS` | 1.2 mm | cavity floor thickness |
| `MAGNET_RADIUS` / `MAGNET_DEPTH` | 3.25 / 2.4 mm | 6.5 mm magnet recess |
| `SCREW_RADIUS` / `SCREW_DEPTH` | 1.5 / 6.0 mm | M3 pilot holes |
| `FASTENER_INSET` | 13.0 mm | pocket centers from cell center |
| `CSG_EPSILON` | 0.01 mm | intentional boolean overlap |
| `EXPLODE_GAP` | 4 mm | preview gap between split pieces |

Total displayed height is `BASE_TOTAL_HEIGHT + heightUnits * HEIGHT_PER_UNIT`.

## Geometry Semantics

- The outer wall always follows the spec profile: 41.5 mm top width with 3.75 mm corners. `cavityCornerRadius` rounds only the cavity interior, using a clamped morphological opening so narrow channels do not collapse.
- `GridCell.bin` assigns cells to logical bins. Missing `bin` means bin 0. Adjacent cells with different bin ids become separate complete bins with their own double walls.
- `openEdges` remove perimeter walls. `dividerEdges` add internal grid-aligned walls. Edges between different logical bins are perimeter edges for both bins.
- The cavity is planned from axis-aligned rectangles in `planCavity()` so manifold and JSCAD paths share wall layout. Rounding and fillet insets operate through open faces and are intersected back to avoid ribs at open or split seams.
- `innerWalls` are free-form mm segments with per-wall width and optional height. Full-height walls reach the top; lower walls ramp into taller structures they touch. The JSCAD fallback skips these ramps.
- `baseSlopes` are per logical bin. An absent entry means flat. A zero-angle entry should not be persisted; `DimensionsTab` removes it.
- Split pieces are generated independently. Seam edges are open unless a divider lies exactly on the split line. The manifold path cuts a piece from the logical bin's whole outer profile with `pieceProfileCS()` so glue seams land on pitch planes instead of acquiring outer-wall clearance.
- `manifoldMesh()` is part of the export path. It welds output vertices, drops collapsed triangles, and repairs float32-degenerate slivers by splitting the neighboring triangle instead of opening a hole.
- Every output mesh (previews and export pieces) is mirrored across Y on the way out of `generateBinPieces`/`generateBinPiecesJscad` (`mirrorMeshY`, `transforms.mirrorY`): the editors map SVG y (downward) straight to mm +y, so an unmirrored part would print as the chiral mirror of the drawn layout. Previews are returned one mesh per logical bin so `BabylonViewer` can color them with the editors' `binColor()` palette; the viewer renders a right-handed scene with unaltered STL coordinates (rigid −90° X rotation only) so it can never re-mirror the model.

## Adding Features

- **New bin parameter** → add it to `BinConfig` in `src/lib/types.ts`, add a default in `DEFAULT_CONFIG` in `src/store.ts`, update both `generateBinManifold`/`generateBinPieces` and the JSCAD fallback in `gridfinity.ts`, then add the control to the appropriate tab/section with `updateConfig({ ... })`.
- **New tab or settings section** → create `src/components/sidebar/tabs/MyTab.tsx` and read/write state through `useAppStore()` rather than threading props. Spatial editors go in `TABS` in `src/components/sidebar/Sidebar.tsx` (left panel); form-shaped parameter groups go in `SECTIONS` in `src/components/sidebar/SettingsPanel.tsx` (right panel).
- **New export format** → add serialization/download helpers under `src/lib/export/`, then extend `ExportMenu.tsx`. `@jscad/3mf-serializer` is installed, but no 3MF UI/export path is wired yet.
- **New printer behavior** → update `PRINTER_PROFILES`, `checkBedFit()`, `computeAutoSplitLines()`, or `checkPieceFit()` in `src/lib/printers.ts`; remember auto split mode is re-derived in the store.
- **Worker-visible changes** → ensure data crossing `postMessage` remains structured-clone friendly. `BinConfig` should stay plain JSON data.

## Manifold Correctness

After any geometry, split, STL, printer-fit, or config-shape change, run `npm run check:manifold`. It validates production manifold output and serialized STL output across normal, split, multi-bin, open-wall, divider, inner-wall, slope, fastener, and edge-case configurations. It rejects boundary edges, non-manifold edges, orientation errors, degenerate triangles, duplicate faces, and zero-thickness membranes.

Combine solids with manifold booleans and do inward 2D offsets with `CrossSection.offset`; never use JSCAD `offset()` for large inward deltas because it self-intersects. Feed the manifold engine only individually closed primitives. Never stack extrusions flush unless both sides of the junction land on a bit-identical coordinate, such as `PEG_HEIGHT = 4.75`. Z-values built from different float expressions can miss by an ULP, and booleans preserve the sub-nanometre gap; after float32 output welds, that gap can become a zero-thickness membrane. Prefer a `CSG_EPSILON` overlap into a containing neighbor so the overshoot is swallowed inside the larger solid.

## UI and Theming Rules

Mantine is the default for controls and layout. Use Mantine components and primitives (`Stack`, `Group`, `Text`, `Paper`, `Select`, `NumberInput`, `Switch`, `SegmentedControl`, `Tabs`, `Menu`, `Alert`) before creating raw UI. Change cross-app control appearance in `src/theme.ts` through `createTheme()` component defaults. Use `src/index.css` only for viewport/layout scaffolding and specific AppShell/viewer workarounds. Use `src/components/sidebar/editor.css` only for the bespoke SVG/grid editors that a component library cannot express.

Avoid design constants in JSX. Inline style is acceptable for genuinely data-driven values such as a cell's bin color, an SVG wall thickness, grid dimensions, or a small library workaround that cannot live cleanly in the theme.

## Common Mistakes to Avoid

- **Do not reinvent the wheel.** Prioritize fitting the conventions of this codebase over subjective visual polish unless explicitly asked to restructure. Prefer existing well-maintained libraries and the stack already in use.
- **Do not provide suboptimal solutions because they are common or quick.** For example, inserting raw HTML into a `.tsx` file may be fast, but this app should rely on Mantine and existing components. Shortcuts that avoid the stack are acceptable only when no elegant existing-library solution exists, and they must be justified in code comments and in the final report.
- **Do not bypass the store contract.** Tabs should read/write through `useAppStore()`. Keep `splitLines` effective in auto mode by using existing setters.
- **Do not treat JSCAD fallback as the primary quality bar.** Keep it usable, but manifold output and `check:manifold` define production correctness.
- **Do not add unrelated refactors.** Geometry, UI, and deployment assumptions are tightly coupled; keep changes scoped to the requested behavior.

## Commands and Validation

```bash
npm install
npm run dev
npm run build
npm run lint
npm run check:manifold
npm run preview
```

There is no dedicated unit test runner configured. `npm run build` performs TypeScript project checks and a production Vite build. `npm run lint` runs Oxlint. Use `npm run check:manifold` for geometry-affecting work.

## Deployment

Pushes to `main` deploy through `.github/workflows/deploy.yml`: Node 20, `npm ci`, `npm run build`, upload `dist`, then deploy to GitHub Pages. The site is served from `gridfinityexpanded.ashtonsouth.me`; `public/CNAME` pins the domain and `vite.config.ts` keeps `base: '/'`. If deployment ever moves back to a GitHub Pages project subpath, update `base` deliberately.

## Known Limitations

- STL is the only wired export format; 3MF dependencies are installed but unused.
- The JSCAD fallback skips inner-wall transition ramps and approximates sloped floors with stair steps.
- The JSCAD fallback can degrade split seam profile behavior if 2D intersection fails.
- Babylon.js imports include engine, STL loader, scene loader, camera, lights, and material support; optimize imports if bundle size becomes a priority.
- No unit/integration test runner is configured beyond build, lint, and manifold validation.

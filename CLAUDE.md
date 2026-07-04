# gridfinity-expanded

Browser-based Gridfinity bin generator. Supports non-rectangular (tetris-piece) bin shapes, irregular divider placement, and configurable heights. Exports STL for FDM printing.

## Tech stack

| Concern | Library | Why |
|---|---|---|
| Framework | React 19 + Vite 6 | Stable, GitHub Pages deploy |
| State | `zustand` | single `useAppStore` (config + printer + editor grid size); tabs read it directly — no prop drilling |
| Geometry (authoring) | `@jscad/modeling` | Programmatic CSG in TypeScript; builds the 2D profiles and primitive solids |
| Geometry (booleans) | `manifold-3d` (WASM) | Guaranteed watertight, 2-manifold output — JSCAD's mesh booleans leave non-manifold T-junctions and its `offset()` self-intersects on thick walls |
| 3D preview | Babylon.js | Microsoft-maintained; TypeScript-first |
| Bundler | Vite 6 (rollup) | Vite 8 rolldown OOMs on large @jscad bundles |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`) | utility classes + shared primitives in `components/ui/`; zinc palette, blue-600 accent |
| Deploy | GitHub Actions → GitHub Pages | `.github/workflows/deploy.yml` |

## Project layout

```
src/
  lib/
    types.ts              shared types: BinConfig, GridCell, GridEdge, SplitLine, PrinterProfile
    edges.ts              pure grid-edge helpers: perimeter/internal classification,
                          effectiveWalls() (resolves open/divider config per bin or piece)
    split.ts              pure split-line partitioning (partitionCells)
    printers.ts           printer profiles, bed fit, computeAutoSplitLines/checkPieceFit
    geometry/
      gridfinity.ts       geometry: generateBinManifold() (whole bin) and
                          generateBinPieces() (split-aware, one solid per piece +
                          exploded preview) are the default path; generateBin()/
                          generateBinPiecesJscad() (pure JSCAD) are the fallback
      manifold.ts         manifold-3d WASM init + JSCAD→manifold bridge + output weld
    export/
      stl.ts              STL download helper + meshToStl() (indexed mesh → binary STL)
  workers/
    geometry.worker.ts    Web Worker: returns preview STL + one STL per split piece
  hooks/
    useBinGeometry.ts     debounces config changes, drives worker; exposes previewBuffer + pieces
  components/
    ui/                   shared Tailwind primitives: Field/Label/Hint, SliderField,
                          NumberInput/Select, Switch, StatusBanner
    sidebar/
      Sidebar.tsx         tabbed left panel (tab name → component map)
      binColors.ts        bin-id → color palette for the editors
      EditorCanvas.tsx    shared SVG base for Walls/Split editors (grid bg + bin-tinted
                          cells; exports CELL/PAD svg-unit constants)
      tabs/
        ShapeTab.tsx      click/drag cell editor; resizable grid (up to 40×40),
                          multi-bin painting palette
        WallsTab.tsx      SVG edge editor (open walls, grid dividers) + drag-to-draw
                          free-form inner walls (endpoints snap to grid lines,
                          segments snap near 45° increments) with width/height list
        SplitTab.tsx      SVG split-line editor (auto-from-bed / manual) + piece fit
        DimensionsTab.tsx height (1–20u), wall thickness, cavity corner radius,
                          inner fillet, per-bin base slope (angle + low side)
        PrinterTab.tsx    printer presets + bed-fit warning
    viewer/
      BabylonViewer.tsx   Babylon.js canvas; reloads mesh on stlBuffer change
    ExportMenu.tsx        Export STL button (dropdown per piece when split)
  store.ts                zustand store: BinConfig + PrinterProfile + editor grid size;
                          auto split mode re-derives splitLines inside every setter
  App.tsx                 root: header/sidebar/viewer layout; feeds store config to useBinGeometry
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

Geometry semantics worth knowing:

- The **outer wall is always the Gridfinity spec profile** (41.5 mm/cell, 3.75 mm
  corners = `PEG_R_TOP`). `cavityCornerRadius` rounds only the cavity interior
  (a Clipper2 morphological opening, binary-search-clamped so the cavity never
  collapses); `innerFilletRadius` is the floor-to-wall fillet.
- Walls are per-edge: `openEdges` removes perimeter walls, `dividerEdges` adds
  internal ones. The cavity cross-section is authored as plain rects in
  `planCavity()` (cell squares minus wall/divider strips + concave-corner
  patches), shared by both build paths. Rounding and fillet insets operate on
  the cavity *extended through its open faces*, then intersect back — otherwise
  they retreat at open/seam faces and grow ribs on glue surfaces.
- `innerWalls` are free-form (non-grid-aligned) segments in mm with per-wall
  width and height, clipped to the outer profile so an end reaching a wall
  overlaps into it. A lower wall gets a concave quarter-round ramp
  (`TRANSITION_R`, clamped to headroom) into anything taller it touches, built
  as slabs of dilate(taller-material) ∩ wall-footprint that shrink with height
  and overshoot CSG_EPSILON *downward* (containment rule). The JSCAD fallback
  skips the ramps.
- `baseSlopes` tilts cavity floors PER LOGICAL BIN (`{bin, angle, dir}`; absent
  = flat): a wedge = cavityCS expanded 0.2 mm into the walls (flush-face
  membrane guard), clipped to the outer profile, extruded and cut by
  `trimByPlane`. The slope plane spans the logical bin's bbox so split pieces
  line up. Fallback approximates with slab stairs.
- `GridCell.bin` (optional, default 0) assigns cells to distinct logical bins:
  each is generated independently with full perimeter walls (inter-bin edges
  are perimeter for both sides), exported as its own STL, spec 0.5 mm apart.
- Split pieces are independent bins; seam edges are open unless a divider sits
  exactly on the split line. A piece's outer profile is the LOGICAL BIN's spec
  profile cut by the piece's pitch box (`pieceProfileCS`), so seam faces land
  exactly on the split-line pitch plane — square-cornered, without the 0.25 mm
  perimeter clearance — and glued pieces butt flush. (A profile built from the
  piece's own cells insets/rounds the seam like an outer wall, gapping every
  glue joint.) Stale edge/line config entries are ignored by the geometry
  layer, never migrated.
- `manifoldMesh()` welds output vertices and repairs float32-degenerate sliver
  triangles by splitting the neighbor across the sliver's long edge — keep it
  in the export path.

## Adding features

- **New bin parameter** → add to `BinConfig` in `types.ts` (and `DEFAULT_CONFIG` in `store.ts`), update `gridfinity.ts` (both `generateBinManifold` and the `generateBin` fallback), add control in the appropriate tab component via `updateConfig({ … })`.
- **New tab** → add to the `TABS` map in `Sidebar.tsx`, create `src/components/sidebar/tabs/MyTab.tsx` (no props — read `useAppStore()`).
- **New export format** → add serializer in `lib/export/`, add option to `ExportMenu.tsx`.
- **Manifold correctness** → after any geometry change, run `npm run check:manifold`. It builds every config in the test matrix and asserts the exported STL is watertight and 2-manifold (no boundary/non-manifold edges, degenerate or duplicate faces). Combine solids with manifold booleans and do inward 2D offsets with `CrossSection.offset` (never JSCAD `offset()` for large inward deltas — it self-intersects). Feed the manifold engine only individually-closed primitives. Never stack extrusions **flush** unless both sides of the junction land on the bit-identical coordinate (e.g. an exactly-representable constant like `PEG_HEIGHT = 4.75`): z-values built from differing float expressions (`floorZ + i*stepH` vs `(floorZ + (i-1)*stepH) + stepH`) miss by an ULP, and the boolean keeps the sub-nanometre gap — subtracting such a stack leaves zero-thickness membranes that z-fight in slicer viewports. Instead overlap each solid by `CSG_EPSILON` into a neighbor whose cross-section contains its own, so the overshoot is swallowed inside the larger solid.
- **Theming** → Tailwind CSS 4 everywhere (no CSS Modules). Global base styles live in `src/index.css`; reusable control styling lives in `src/components/ui/` — extend those primitives rather than repeating utility strings. shadcn/ui drops in cleanly if needed later.

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
- STL only; 3MF export not yet wired (`@jscad/3mf-serializer` is installed).
- Inner-wall ramps blend into walls/dividers/taller inner walls but not into the
  sloped-base wedge; inner walls have no floor fillet along their own base.
- JSCAD fallback (WASM-failure mode only) skips inner-wall ramps and stair-steps
  the sloped base.

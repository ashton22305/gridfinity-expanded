# Object and Method Reference

This is the exhaustive reference for non-test runtime TypeScript/TSX under `src/`. It covers application-defined components, hooks, functions, private helpers, store commands, structured objects, and the external/browser class instances the application creates. CSS modules contain no JavaScript runtime objects and are outside this inventory.

Gridfinity Expanded defines no application-specific classes. Names such as `Design`, `Bin`, and `GeometryState` are TypeScript-only descriptions of plain JavaScript objects; they have no prototypes or methods at runtime. React components and hooks are functions. Babylon.js, Manifold, DOM, worker, IndexedDB, typed-array, and renderer objects are external class instances.

For the architectural narrative, see [Application Architecture](./application-architecture.md). For detailed algorithms, [Gridfinity Geometry Pipeline](./geometry-pipeline.md) and [Babylon Viewer](./babylon-viewer.md) remain authoritative.

## Reading the entries

- **Context** names the main browser thread, geometry worker, or either environment.
- **Calls / effects** lists direct important relationships, including browser or library effects.
- **Lifetime / performance** records ownership, reuse, copying, mutation, and allocation relevance without implying measured speed.
- Anonymous render callbacks and inline event handlers appear under their owning component rather than as invented global symbols.

## Entry and composition

| Symbol | Context and responsibility | Calls / effects | Lifetime / performance |
| --- | --- | --- | --- |
| `main.tsx` module body | Main-thread entry point. | `document.getElementById`, React DOM `createRoot(...).render(...)`; mounts `StrictMode` → `MantineProvider(theme)` → `App`. | Runs once per module evaluation. React development `StrictMode` may replay lifecycle work. The returned React root is not retained by application code. |
| `App` | Root function component and dependency-injection point for design, generation, preview, and export. | Selects `design`, `panelWidths`, and `gestureActive` with `useAppStore`; calls `useBinGeometry`; renders Mantine `AppShell`, editors, `ExportMenu`, resize handles, and lazy `BabylonViewer`. | Renders on selected store values or geometry state changes. It passes the exact generated design snapshot to the viewer. |
| lazy `BabylonViewer` loader | `App.tsx` module-owned React lazy component. | Dynamic-imports `BabylonViewer.tsx` and maps its named export to `default`; `Suspense` renders a status fallback until resolved. | Module lifetime; creates a separate asynchronous module/chunk boundary and a one-time promise managed by React. |
| `theme` | Mantine theme configuration object created by `createTheme`. | Uses each Mantine component's static `extend` method to define default props/styles for `Button`, `NumberInput`, `Select`, `Slider`, `Switch`, `Tabs`, `Alert`, `Menu`, and `Text`. | Created at module evaluation and shared through `MantineProvider`; no application mutation. |

`App` contains no event handlers. Its `Suspense` fallback is an inline React element only. Header export always receives the most recently published bins, while the viewer additionally receives the producing design and current generation error.

## Zustand store

### Store objects and private helpers

| Symbol | Context and responsibility | Calls / effects | Lifetime / performance |
| --- | --- | --- | --- |
| `PanelSide` | Type-only union for `sidebar` and `settings`. | Keys panel-width state and `setPanelWidth`. | Erased at runtime. |
| `PANEL_MIN_WIDTH`, `PANEL_MAX_WIDTH`, `MAX_GRID` | Exported UI bounds. | Used by store commands and editor inputs. | Module constants. |
| `DEFAULT_PANEL_WIDTHS` | Initial `Record<PanelSide, number>`. | Seeds `AppState.panelWidths`. | Module object; store later replaces it on width edits. |
| `DEFAULT_PRINTER` | Default profile selected from `PRINTER_PROFILES` by `DESIGN_DEFAULTS.printerName`. | Seeds `DEFAULT_DESIGN`. | Module reference; asserted present. |
| `sortCells` | Private deterministic row-then-column copy/sort. | Called by `resetForShape`. | Allocates a new array; does not mutate input. |
| `emptyBin` | Private `BinDesign` creator with empty arrays. | Used for defaults and new painted bins. | Allocates independent wrapper/arrays per call. |
| `resetForShape` | Rebuilds a changed bin footprint and clears dependent openings/walls. | Calls `sortCells` and `cutsForPrinter`. | Allocates a bin and arrays; retains unrelated scalar fields/id. |
| `nextBinId` | Finds the first unused `bin-N` id. | Builds an id `Set`. Called by `startNewBin` and disconnected `paintCell`. | Linear scan/allocation per call; ids may be reused after deletion. |
| `isEdgeConnected` | Tests whether a candidate cell shares one unit edge with any cell. | Used by `paintCell` at gesture targeting. | Linear, read-only. |
| `cutOrientation`, `cutCenter` | Private cut navigation projections. | Used by `moveCut` to compare candidate directions/distances. | `cutCenter` allocates a point. |
| `binPartsFit` | Tests every current part against a printer. | `partitionCells` → `checkBedFit`; used by `setPrinter`. | Allocates partition results; short-circuits on first failure. |
| `initialCells` | Four-cell default footprint. | Embedded in `DEFAULT_DESIGN`. | Module array; normal commands replace rather than mutate it. |
| `DEFAULT_DESIGN` | Exported initial plain `Design`. | Initializes store and selected id. | Module object graph; nested fastener/printer objects are copied from defaults. |
| `minGridSize` | Returns minimum editor grid dimensions covering all cells, with a 4×4 floor. | Used by `ShapeTab` and `setGridSize`. | Allocates one result; scans cells. |
| `AppState` | Type-only complete store contract. | Describes design/session fields and commands below. | Erased; Zustand owns the runtime state object for page lifetime. |
| `useAppStore` | Zustand hook plus static `getState`. | Created with `create<AppState>` and a setter-backed initializer. Components subscribe through selectors; `ShapeTab` uses `getState()` after painting to capture the resolved target id. | Module singleton. Commands use immutable replacements; selector granularity controls render propagation. |

### Store commands

Every command runs on the main thread. Commands passed a functional updater receive the latest store state; no command mutates an existing `Design`, bin, or nested array in place.

| Command | State effect and direct calls | Allocation / behavior notes |
| --- | --- | --- |
| `setGestureActive(active)` | Replaces `gestureActive`. | Used to hold generation during shape painting. |
| `selectBin(id)` | Replaces `selectedBinId`. | Does not validate existence; a pending new id represents “new bin” mode. |
| `startNewBin()` | Sets selection to `nextBinId(design.bins)`. | Creates no empty bin until a cell is painted. |
| `paintCell(cell, targetBinId?)` | Finds the current cell owner, resolves an edge-connected or new target, removes the cell from its former owner, adds it to target, calls `resetForShape` on affected bins, removes empty bins, and selects target. | Rebuilds the bins array and affected bin dependencies. Returns existing state for an already-owned target cell. Explicit target keeps a drag in one bin. |
| `removeSelectedCell(cell)` | Removes a matching cell from the selected bin via `resetForShape`; filters empty bins. | Rebuilds design/bins even when no matching cell is found. |
| `setHeightUnits`, `setPerimeterThickness`, `setFilletRadius` | Replace one global design scalar. | `DimensionsTab`, not the store, coordinates height-dependent fillet validity. |
| `setFasteners(patch)` | Shallow-merges a partial patch into `design.fasteners`. | Allocates design and fastener objects. |
| `setPrinter(printer)` | Replaces printer; retains bins whose current pieces fit and otherwise calls `cutsForPrinter` preserving existing cuts. | May partition/check every bin and add cuts; allocates design/bins array. |
| `setOpeningState(edges, open)` | For each bin, filters input to its perimeter edges and opens or closes them by key. | Builds per-bin cell/key sets; sorts opened edges. Present runtime API with no current UI caller. |
| `toggleOpening(edge)` | Finds every bin for which the coincident edge is perimeter, chooses one shared open/closed result, and updates all bordering bins. | Preserves coincident-bin semantics; allocates sets/arrays and design wrappers. |
| `resetSelectedWalls()` | Closes perimeter openings belonging to the selected bin footprint across all bins and clears only the selected bin's free-form walls. | Uses `perimeterEdges`; allocates every bin wrapper, even unchanged ones. |
| `addWall(wall)` | Appends a wall to the selected bin. | Stores the supplied plain wall reference; creates array/bin/design wrappers. |
| `updateWall(index, patch)` | Shallow-merges patch into the indexed selected-bin wall. | Maps walls and bins; out-of-range index leaves wall values unchanged but still rebuilds wrappers. |
| `removeWall(index)` | Filters the indexed selected-bin wall. | Creates replacement arrays/wrappers. |
| `toggleCut(binId, cut)` | Replaces the target bin's cuts with library `toggleCut`. | Canonicalizes, deduplicates, and sorts through the helper. |
| `moveCut(binId, index, direction)` | Finds same-orientation available cuts; locates current or nearest candidate; clamps one step; removes old and inserts/sorts new. | Computes maps/distances and candidate arrays; returns a bin unchanged at limits or on invalid input. |
| `resetCuts(binId)` | Replaces target cuts with printer-required `cutsForPrinter`. | Discards optional user cuts. |
| `setGridSize(cols, rows)` | Clamps rounded values between occupied `minGridSize` and `MAX_GRID`. | Session UI only; does not change design geometry. |
| `setPanelWidth(panel, width)` | Clamps rounded width between panel bounds and replaces keyed `panelWidths`. | Session UI only. |

## Shared structured objects

All interfaces and type aliases below are erased after compilation. Their runtime values are plain objects/arrays unless a field explicitly names a typed array, map, or set.

| Object/type | Fields; creator → owner → transformations/consumers | Lifetime, mutation, cloning |
| --- | --- | --- |
| `Cell` | `{x, y}` grid coordinate. Created by defaults, editors, edge/cut helpers, mirroring, and cache clones; stored in bin footprints and piece groups; consumed throughout planning and geometry. | Usually copied into new arrays/objects. Structured-cloned to workers/IndexedDB. |
| `Point2` | `{x, y}` generic point; `GridPoint` is a type-only extension with no extra fields. | Wall/cut/preview/editor helpers allocate points; no methods. |
| `EdgeOrientation`, `Edge`, `EdgeKind` | `'h'|'v'`; edge `{x,y,orientation}`; classification `'perimeter'|'internal'|'none'`. | Store owns opening edges; mirrored copies enter workers. |
| `Wall` | `{start,end,width}` in editor millimetres. Created by `WallsTab`, stored by the selected bin, mirrored by `buildBinParameters`, consumed by geometry. | Draft is locally replaced during drag; stored walls are immutably replaced; worker requests clone them. |
| `Cut` | `{start,end}` axis-aligned grid points. Created by cut planners and UI candidates; store owns active cuts; partitioning consumes them. | Canonical/sort helpers create wrappers/arrays. Cuts are not sent to workers; derived piece footprints are. |
| `FastenerSettings` | `{magnets,m3}` global design flags. | Store replaces via shallow merge; referenced in parameters, then cloned to workers/cache-key serialization. |
| `PrinterSettings` | `{name,bedWidth,bedDepth}` from profiles/custom UI. | Store-owned plain object; used only for edit/cut planning, not worker input. |
| `BinDesign` | `{id,cells,openings,walls,cuts}` logical editor bin. | Store owns until replacement; `buildBinParameters`, editors, and printer checks consume it. Never sent directly to workers or cache. |
| `Design` | `{bins,heightUnits,perimeterThickness,filletRadius,fasteners,printer}`. | Zustand owns current snapshot; hook retains producing snapshots in pending/published state. Plain and clone-compatible but not itself posted. |
| `BinParameters` | `{binId,height,perimeterThickness,filletRadius,fasteners,cells,openings,walls,pieces}`. `buildBinParameters` creates it; hook hashes/caches/posts it; worker/geometry consume it. | Fresh wrappers and spatial arrays per design derivation; request structured cloning copies it. |
| `BinPiece` | `{triangles,cells}`. Geometry creates it; worker transfers triangle buffer; hook/cache own result; preview/export consume it. | Triangle buffer detaches in worker on transfer. IndexedDB clones it. Main-thread downstream branches share its array reference. |
| `Bin` | `{binId,pieces}`. Geometry or `readCachedBin` creates it; hook orders/publishes it. | Wrapper survives until superseded geometry state and downstream references release it. |
| `PrintableObject` | `{name,triangles}` from `toPrintableObjects`; consumed by export. | Wrapper/name new; triangles shared with `BinPiece`. |
| `BedFitResult` | `{fits,width,depth,rotated}` from `checkBedFit`. | Short-lived derived result. |
| `GenerateGeometryRequest` | `{revision,bins}` posted by hook. | Request wrapper is short-lived; structured cloning copies contents to worker. |
| `GenerateGeometryResponse` | Discriminated `{ok:true,revision,bins}` or `{ok:false,revision,error}` created by worker. | Success triangle buffers transfer; failure is cloned plain data. |
| `DisplayCell` | `Cell` plus `binId`, created by `flattenBins` for 2D editors. | Fresh render-time wrappers; never persisted. |
| `CellPart` | `{id,cells}` from `partitionCells`. | Derived planning object; piece id is not sent to geometry. |
| `UnitCut` | Private `{orientation,line,along}` representation in cut planning. | Short-lived within `availableCuts`/bisection calls. |
| `DesignFitResult` | `{allFit,parts,worst}` from `checkDesignFit`. | Render-time summary for Cuts/Printer tabs. |
| `PreviewPiece` | `{binId,pieceIndex,triangles,previewOffset}` from `previewLayout`. | Memoized by viewer; triangles shared, offset/wrapper new. |
| `GeometryState` | `{bins,design,generating,error}` returned by `useBinGeometry`. | React state; immutable replacements pair output with its producing snapshot. |
| `PendingGeneration` | `{revision,design,binIds,binsById,cacheKeysByBinId,remaining}` hook-private accumulator. | Stored in a ref, mutated as worker replies arrive, cleared on completion/failure/unmount. Maps are main-thread only. |
| `CachedGeometryRecord` | `{key,pieces,byteSize,lastAccess}` IndexedDB record. | Database owns persisted clone. `refreshLastAccess` mutates a read clone before putting it back. |
| `ConstantSolids` | `{base?,filletSpheres}` worker-local Manifold cache value. | Retained in `constantSolids` for the owning WASM runtime; cached solids intentionally not deleted. |
| `Polygon` | Private `[number,number][]` alias in geometry. | Arrays returned/consumed by Manifold polygon APIs and mesh construction. |

Component prop interfaces (`Props`, `EditorCanvasProps`, `FieldProps`, `SliderFieldProps`, `StatusBannerProps`) describe React-owned props for their named components. React creates/passes ephemeral prop objects; components read them without mutation. `EditorCanvasProps` also includes native SVG props. `Tab` is the type-only key union of `TABS`.

## Domain helpers

### Edges and cuts

| Function | Calls / effects | Lifetime / performance |
| --- | --- | --- |
| `cellKey`, `edgeKey` | Produce canonical strings for maps/sets. | Allocate strings; called heavily by store/edit planning. |
| `cellSet` | Maps cells through `cellKey` into `Set`. | New set. |
| `adjacentCells` | Returns the two cells separated by an edge. | New tuple and cell objects. |
| `classifyEdge` | Uses `adjacentCells`/`cellKey` and membership to return `EdgeKind`. | Read-only. |
| `edgeInsideCell` | Returns the single occupied adjacent cell or `null`. | Exported but currently has no runtime caller in `src/`. |
| `cellEdges` | Returns four canonical unit edges for a cell. | New array/objects. |
| `edgesOfKind` | Private deduplicating scan using `cellSet`, `cellEdges`, `classifyEdge`, `sortEdges`. | Allocates set/array; drives perimeter/internal queries. |
| `perimeterEdges`, `internalEdges` | Call `edgesOfKind` for one classification. | New sorted arrays; `internalEdges` currently has no runtime caller in `src/`. |
| `sortEdges` | Copies and deterministic-sorts edges. | Does not mutate input. |
| `toggleByKey` | Generic add/remove by caller-supplied key function. | Filters to a new array. |
| `toggleEdge` | `toggleByKey` + `sortEdges`. | Exported but current store implements shared-bin opening behavior directly. |
| `flattenBins` | Flattens bin cells into copied `{...cell,binId}` display cells. | New array and wrapper per cell. |
| `canonicalCut`, `cutKey` | Normalize endpoint order and form stable key. | May return original cut or allocate wrapper; key allocates string. |
| `sortCuts` | Canonicalizes/deduplicates with `Map`, copies values, deterministic sort. | New map/array. |
| `toggleCut` | Adds/removes by `cutKey`, then `sortCuts`. | New arrays. |
| `severedEdges` | Private expansion of cut spans to unit-edge keys. | New set. |
| `partitionCells` | Breadth-first connected components after severing; calls `cellKey`/`severedEdges`; sorts parts and assigns ids. | Allocates maps, sets, queue/part arrays, cells array copies. `shift()` mutates only the local queue. |
| `unitInternalCuts` | Private scan of right/down occupied neighbors. | New set and unit list. |
| `mergeUnitCuts` | Private grouping/merging of contiguous units; nested `push` callback emits a `Cut`; calls `sortCuts`. | New maps/groups/cut objects. |
| `availableCuts` | `unitInternalCuts` → `mergeUnitCuts`. | Produces maximal segments. |
| `cutsAtLine` | Private filter of units at one grid line → `mergeUnitCuts`. | Recomputes units for each candidate line. |
| `closestCellBisection` | Enumerates x/y lines, calls `cutsAtLine`, ranks imbalance/largest side with x-before-y ties. | Allocates candidate/value arrays; no state effects. |
| `addCutsUntilFit` | Repeatedly partitions, selects first failing part using supplied `fits`, adds its closest bisection, and guards loop length. | Deterministic iterative allocation; preserves existing cuts. |

### Coordinates, printers, preview, and export shaping

| Function | Calls / effects | Lifetime / performance |
| --- | --- | --- |
| `maximumOccupiedRow` | Scans every design cell; returns at least zero. | Temporary flattened arrays from `flatMap`/`map`. |
| `mirrorCell`, `mirrorEdge`, `mirrorGridPoint`, `mirrorMillimetrePoint` | Create generation-frame coordinate copies. | Pure allocation. |
| `mirrorCut` | Calls `mirrorGridPoint` for endpoints. | Used only by preview layout; cuts do not cross worker boundary. |
| `mirrorWall` | Calls `mirrorMillimetrePoint` for endpoints. | Preserves width through object spread. |
| `buildBinParameters` | `gridfinityHeight`, `maximumOccupiedRow`, `partitionCells`, mirror helpers; creates trusted per-bin worker input. | Memoized by hook per `design` reference; allocates all spatial transforms/piece arrays. |
| `footprintCells` | Computes cell bounding-box width/depth in cells. | Allocates x/y arrays; empty input returns zeroes. |
| `checkBedFit` | `footprintCells`; converts to mm, includes allowance, tests normal/rotated fit. | New result; no mutation. |
| `cutsForPrinter` | `addCutsUntilFit` with a `checkBedFit` closure. | Cut-planning allocations; no printer data reaches geometry. |
| `checkDesignFit` | Partitions every bin, checks each piece, tracks worst result by failure then area. | Short-lived summary and partitions. |
| `previewOffsetFor` | Builds unique cut-line sets and displaces pieces wholly to either side by half-gap per line. | New sets/result point. |
| `previewLayout` | Finds paired design cuts, mirrors them, calls `previewOffsetFor`, flattens bins. | New wrappers/offsets; shares triangle arrays. |
| `partFilename` | Derives single/multi-bin and piece-index STL name. | New string. |
| `toPrintableObjects` | Flattens bins/pieces and calls `partFilename`. | New wrappers/strings; shares triangle arrays. |
| `downloadBuffer` | Creates `Blob`, object URL, anchor; sets `href`/`download`; clicks; revokes URL. | Browser side effect. Buffer is wrapped, not rewritten. Anchor is not inserted into DOM. |
| `trianglesToStl` | Allocates `ArrayBuffer`/`DataView`, computes triangle normals, writes binary STL little-endian. | One serialized allocation per call; reads but does not modify triangles. |
| `downloadStl` | `trianglesToStl` → `downloadBuffer` with `model/stl`. | Default filename when omitted. |

### Gridfinity specification

`GRIDFINITY_SPEC`, `GRIDFINITY_DERIVED`, `DESIGN_DEFAULTS`, `IMPLEMENTATION_ALLOWANCES`, and `GRIDFINITY_SOURCES` are module-lifetime readonly-by-TypeScript plain object/array constants. They separate normative dimensions, calculated values, product choices, non-normative tolerances/gaps, and human-readable citations. Runtime code reads them without mutation.

`gridfinityHeight(heightUnits)` multiplies by the spec height unit. `maximumFilletRadius(height)` subtracts base, floor, and minimum straight-wall allowance and clamps at zero. Both are pure arithmetic helpers used by parameter derivation and dimension controls.

## Geometry and Manifold

All entries in this section run in a geometry worker in production. Validation scripts can call them in another JavaScript runtime. Detailed mechanics and resource-deletion rationale belong to [Gridfinity Geometry Pipeline](./geometry-pipeline.md).

### Manifold initialization and extraction

| Symbol | Calls / effects | Lifetime / performance |
| --- | --- | --- |
| module `cached` | Private `Promise<ManifoldToplevel> | null`. | One initialization promise per module runtime/worker. Rejected promises remain cached. |
| `initManifold` | Calls external `Module` with optional `locateFile`, awaits WASM, calls `wasm.setup`, returns runtime. | Reuses `cached`; worker passes bundled WASM URL resolver. |
| `manifoldTriangles` | Calls `manifold.getMesh`; welds float32-quantized vertices with `Map`, creates `Uint32Array` remap, drops index-collapsed faces, calls `repairDegenerateTris`, expands into `Float32Array`. | Sole production extraction boundary; deliberately duplicates vertices in final soup. Does not delete its input. |
| `repairDegenerateTris` | Private repair loop. Local `area` and `len2` callbacks measure facets/edges; an oriented-edge map finds the neighbor to split; dead facets are filtered; stops when unchanged or after 256 iterations. | Mutates its local triangle array and appends replacements; allocates maps/sets/arrays each iteration. |

### Gridfinity construction helpers

| Symbol | Direct relationships and responsibility | Lifetime / performance |
| --- | --- | --- |
| `roundedRect` | `CrossSection.square(...).offset(...)`. | Returns native 2D object. |
| `profilePoints` | `CrossSection.toPolygons`, flattens at supplied Z. | New JS point arrays for hull input. |
| `loft` | Combines two `profilePoints` sets with `Manifold.hull`. | Returns native solid. |
| `constantSolids`, `constantsFor` | `WeakMap<ManifoldToplevel, ConstantSolids>` lookup/creator. | Keys do not keep a WASM wrapper alive by themselves; values retain cached native solids while key lives. |
| `filletSphere` | Radius-keyed `Manifold.sphere` cache. | Cached spheres intentionally retained and never deleted by callers. |
| `canonicalBase` | Builds rounded bottom/middle/top profiles, lofts/extrudes/translates, unions; calls `numVert` to force evaluation. | One cached solid per WASM runtime. Returned base/translated derivatives must not be deleted under current ownership rule. |
| `cellFootprint` | Unions translated pitch-sized `CrossSection.square` objects. | New native 2D result and input intermediates. |
| `closeReentrantCorners` | Decomposes regions, examines polygon signed area/turns, performs round offsets, circle envelopes, intersection/add/union. | Returns new 2D result; creates native and JS intermediates. |
| `outerFootprint` | Square inset/round offset then `closeReentrantCorners`. | Derives body contour from shared footprint. |
| `openingChannel` | Creates/translates one square based on edge orientation. | New native 2D object. |
| `wallFootprint` | Computes wall quad and invokes `new wasm.CrossSection`. | New native 2D object; expects nonzero wall length. |
| `cavityFootprint` | Insets shared footprint, unions opening channels, subtracts unioned wall footprints. | Rebinds local cavity to new native results. |
| `nearestOnContours` | Scans every contour segment for nearest projected point. | Pure JS loop; returns a new point tuple. |
| `sweptRegionMesh` | Builds fillet rings/walls/caps as numeric arrays; local `addVertex` and `emit` callbacks append; uses `nearestOnContours`, `offset`, `simplify`, `toPolygons`, `wasm.triangulate`, `new wasm.Mesh`, `new wasm.Manifold`, and `numVert`; returns `null` on projection discontinuity/empty solid. | Heavy temporary JS/native allocation. Explicitly deletes raw wall/wall and rejected solid; returned solid passes ownership to caller. |
| `sphericalSweep` | Extrudes/translates seed then `minkowskiSum(sphere)`; deletes two intermediates. | Fallback region solid; cached sphere is retained. |
| `roundedCavity` | Handles zero radius, closes/insets/simplifies/decomposes; maps regions through `sweptRegionMesh` or `sphericalSweep`; unions multiple cavities; deletes documented intermediates. | Returns one native cavity solid. |
| `canonicalHardwareCutter` | Builds four translated cylinders and unions them. | New native solid for one feature. |
| `hardwareCutters` | Builds enabled canonical cutters and translates each to every cell. | Returns native solid array; empty when features disabled. |
| `buildBinSolid` | Creates footprint, translated bases, body union, subtracts rounded cavity and optional unioned hardware cutters. | One complete solid per logical bin; local `solid` is rebound across booleans. |
| `partCutter` | Extrudes/offsets a piece cell footprint beyond vertical solid bounds. | New native cutter avoids coincident faces. |
| `generateGeometry` | Gets `canonicalBase`; maps bins; calls `buildBinSolid`; single-piece uses complete solid, multipart intersects `partCutter`; simplifies; calls `manifoldTriangles`; echoes cells. | Synchronous worker work. Produces plain wrappers and transferable typed arrays. |

Production code also reads module constants `PITCH`, `BASE`, `FILLET_SEGMENTS`, `SLIVER_EPSILON`, `FILLET_RINGS`, `HARDWARE_OFFSET`, and `HARDWARE_OFFSETS`. They are immutable module values used to avoid repeated specification lookup and to define discretization/allowances. No timing guarantee is associated with them.

## Remaining runtime constants

These named module values complete the runtime declaration inventory. They are created once per evaluating JavaScript realm and are not mutated.

| Constants | Use |
| --- | --- |
| `DOWNLOAD_SPACING_MS` | Delay multiplier between “download all” callbacks. |
| `GRID_PITCH`, `CELL`, `PAD` | Editor conversion inputs: spec millimetres per cell, SVG units per cell, and SVG padding. |
| `GRID_SIZE_INPUT_WIDTH` | Shape grid `NumberInput` width. |
| `POINT_SNAP_MM`, `MIN_WALL_LENGTH`, `WALL_WIDTH_INPUT` | Wall endpoint snap radius, accepted draft length, and width-input presentation width. |
| `DEFAULT_ALPHA`, `DEFAULT_BETA`, `DEFAULT_RADIUS`, `FIT_MARGIN` | Babylon initial/reset orbit and camera-fit margin. |
| `ANIMATION_FPS`, `ANIMATION_FRAMES`, `FACE_ORIENTATION` | Camera animation inputs and diagnostic winding label. |
| `BUSY_DEBOUNCE_MS`, `MAX_POOL_SIZE` | In-flight edit coalescing window and worker cap. |
| `OUT_WELD` | Manifold extraction's millimetre-to-micron quantization multiplier. |
| `DATABASE_NAME`, `DATABASE_VERSION`, `STORE_NAME`, `LAST_ACCESS_INDEX`, `CACHE_KEY_VERSION`, `MAX_CACHE_BYTES` | IndexedDB schema, cache-key invalidation salt, and approximate eviction ceiling. |

## Geometry cache and worker orchestration

### `geometryCache.ts`

| Function/object | Calls / effects | Lifetime / performance |
| --- | --- | --- |
| cache constants | Database/store/index/version names and `MAX_CACHE_BYTES`. | Module lifetime; cache-key salt explicitly invalidates older geometry encodings. |
| `databasePromise` | Cached database-open promise. | Reset to `null` only after open rejection so later calls retry. |
| `requestResult` | Wraps `IDBRequest` success/error callbacks in `Promise`. | Event handlers close over request until settlement. |
| `transactionComplete` | Wraps transaction complete/error/abort events. | Required before treating writes/scans as committed/finished. |
| `openDatabase` | Calls `indexedDB.open`; upgrade creates object store/key path and last-access index; success resolves or closes after prior failure; blocked/error rejects. | One live database instance per successful module lifetime; no explicit page-lifetime close. |
| `isCell`, `isPiece`, `isRecord` | Runtime cache corruption/type guards. | Read-only scans; `isPiece` requires nonempty triangle soup divisible by 9. |
| `approximateSize` | Sums triangle byte lengths plus estimated cell/wrapper overhead. | Approximation drives policy, not exact storage accounting. |
| `removeRecord` | Opens readwrite transaction, deletes key, awaits completion. | Best-effort caller may ignore failure. |
| `refreshLastAccess` | Mutates read record's timestamp, puts it in a new transaction, awaits completion. | Background best effort; rewrites structured clone. |
| `cachedBytes` | Cursor-scans store and sums valid positive `byteSize`; promise resolves at cursor end. | Does not materialize records into a new collection. |
| `evictOldest` | Cursor-scans last-access index, deletes until total is within ceiling. | Mutates IndexedDB inside caller transaction. |
| `evictLeastRecentlyUsed` | Readonly size transaction then conditional readwrite eviction transaction. | Runs after every successful write. Concurrent writers are serialized by IndexedDB transactions. |
| `geometryCacheKey` | Builds explicit geometry-only object; `JSON.stringify`; `new TextEncoder().encode`; `crypto.subtle.digest`; `new Uint8Array`; hex join. | Several temporary allocations per bin; excludes `binId`. |
| `readCachedBin` | Reads by key with `requestResult`; validates; schedules invalid removal or access refresh; returns `{binId,pieces}` or `null`; catches all errors. | Cache clone supplies typed arrays; hit wrapper reapplies current identity. |
| `writeCachedBin` | Creates timestamped record, puts/awaits, then evicts. | Errors reject to hook, which intentionally ignores them. |

### `useBinGeometry` and worker module

| Symbol | Calls / effects | Lifetime / performance |
| --- | --- | --- |
| `poolSize` | Reads `navigator.hardwareConcurrency`; clamps `(value ?? 2)-1` to 1…4. | Evaluated at worker-pool creation. |
| `useBinGeometry` | React hook described below. | Hook lifetime is the mounted `App`. |
| worker module `manifoldReady` | Calls `initManifold(() => wasmUrl)` at worker module evaluation. | One promise per worker. |
| worker `self.onmessage` | Awaits `manifoldReady`; calls `generateGeometry`; builds success response and transfer list from triangle buffers; `self.postMessage`. Catch builds generic failure response. | One async handler per worker global. Manifold work after await is synchronous; transferred buffers detach. |

`useBinGeometry` owns:

- React `state`, initialized to empty bins/no design/not generating/no error.
- memoized `parameters = buildBinParameters(design)`.
- refs for the worker array, current revision, current mutable `PendingGeneration`, and debounce timer.
- a mount effect and a design/parameter/hold effect.

The mount effect defines private `fail`, creates workers with `new Worker(new URL(...), {type:'module'})`, and installs `onmessage`/`onerror`. The response callback rejects stale revisions, calls `fail` for current failures, merges bins into `PendingGeneration.binsById`, schedules `writeCachedBin(...).catch`, decrements `remaining`, and publishes results in original `binIds` order when complete. Cleanup increments revision and terminates each worker.

The generation effect increments revision, clears the prior timer, and returns early while held. Its timer callback launches an async closure: marks generating; publishes empty output for no parameters; performs parallel hash/cache lookups with per-bin fallback; rejects stale lookup completion; separates hits/misses; publishes all-hit output or creates `PendingGeneration`; posts each missing bin round-robin. Cleanup clears the timer. Timer clearing prevents callbacks not yet started; revision checks handle async work already underway.

## React UI components and owned callbacks

### Shared and panel components

| Component/helper | Behavior, callbacks, and state effects | Lifetime / performance |
| --- | --- | --- |
| `Label`, `Hint` | Pure presentational functions around Mantine `Text`. | Render-only; no local state/effects. |
| `Field` | Renders `Input.Wrapper` with `LABEL_PROPS`, label, description, and children. | `LABEL_PROPS` is module-shared. |
| `SliderField` | Calls Mantine `useId`; renders controlled `Slider`; forwards its `onChange`; formats display/unit/children. | New React elements per render; no internal value state. |
| `StatusBanner` | Chooses green/check or yellow/warning Mantine `Alert` from `ok`. | Pure render. |
| `Sidebar` | Owns `activeTab`; `TABS` maps names to components. `Tabs.onChange` ignores null then casts/sets; tab-map callback renders buttons. | Only active spatial editor mounts; switching tabs unmounts prior panel. |
| `SettingsPanel` | `SECTIONS` maps labels to parameter components; map callback renders all as an uncontrolled multiple accordion. | Sections remain in React tree according to Mantine behavior; component owns no application state. |
| `PanelResizeHandle` | Selects width/command; ref holds drag start. `onPointerDown` captures pointer, stores coordinates, adds `body.no-select`; `onPointerMove` calls `setPanelWidth`; `onPointerUp` releases capture/removes class. | Pointer callbacks recreated per render. Body class can remain if pointer-up is never received; no effect cleanup exists. |
| `EditorCanvas` | Calculates view box; memoizes background rect grid by dimensions and selected-cell layer by cells; spreads native SVG props and renders overlays. | Background can contain up to `MAX_GRID²` elements but is reused across pointer renders while dimensions are stable. |
| `binColor` | Stable unsigned rolling hash of optional bin id into module `BIN_COLORS`. | Pure string/array lookup. |
| coordinate lambdas `gridToSvg`, `mmToSvg`, `svgToMm` | Convert grid/mm/SVG units using `CELL`, `PAD`, and pitch. | Pure arithmetic. |
| `pointerToMm` | Reads SVG bounding rectangle/viewBox and calls `svgToMm` for pointer coordinates. | Browser layout read plus new point. |

### `ShapeTab`

`cellGap` chooses visual grid gap from dimensions. `ShapeTab` selects design/session fields and commands, owns `paintMode` state and `paintBinId` ref, and derives flattened cells, a cell-owner `Map`, selection existence, footprint, and grid minima each render.

Named local callbacks are `handlePointerDown` (starts gesture; chooses remove/add; calls store; captures resolved target through `useAppStore.getState()`), `handlePointerEnter` (continues the active mode against the captured bin), `endPaint` (clears local gesture state and releases generation), and `cellFromEvent` (uses DOM `closest`/dataset to resolve delegated grid cells). Inline callbacks:

- two `NumberInput.onChange` handlers coerce values and call `setGridSize`;
- bin button maps call `selectBin`;
- grid `onPointerDown`/`onPointerOver` delegate through `cellFromEvent` and named handlers;
- nested `Array.from` callbacks create cells/buttons and read `cellBin`.

The delegated grid avoids one pointer handler per cell. Derived maps/arrays are rebuilt on render; held paint state deliberately causes renders while geometry is paused.

### `WallsTab`

Module helpers: `edgePoints` maps an edge to SVG endpoints; `snapHalfMillimetre` rounds; `snapPoint` scans existing wall endpoints, compares grid snapping, then falls back to half-mm coordinates.

The component selects design/editor state and wall commands; owns `svgRef`, `draft`, and `selectedWall`; memoizes selected-cell keys, deduplicated design perimeter edges, and open-edge keys. Named local callbacks:

- `insideSelected` samples around grid boundaries to determine whether a mm point belongs to the selected bin;
- `clampEndpoint` walks a proposed segment in 0.5 mm-or-smaller steps and returns its last inside point;
- the keydown effect's `onKeyDown` ignores editable targets, deletes the selected wall, or clears selection; effect cleanup removes the listener;
- `pointFromEvent` calls `pointerToMm` with the SVG ref;
- `beginWall` validates/snap-starts a draft, clears selection, and captures the pointer;
- `moveWall` snaps/clamps and replaces the draft;
- `finishWall` adds drafts meeting `MIN_WALL_LENGTH`, then clears them.

Inline perimeter callbacks stop pointer propagation and call `toggleOpening`. Wall-map callbacks compute selection/points and render groups; group clicks select only walls belonging to the active bin. Width input parses finite values and calls `updateWall`; close handlers stop row selection, remove, and clear selection. Editor pointer props bind the named draft callbacks. Perimeter, open-key, and selected-cell memoization avoids repeating scans during draft movement; rendered wall lists/geometry are still rebuilt.

### `CutsTab`

`cutPoints` maps cut endpoints through `gridToSvg`. The component selects design/grid and cut commands, derives display cells, `checkDesignFit`, and selected bin. Bin summary mapping calls `partitionCells`. The canvas's bin callback builds active/candidate `Map`s, merges active cuts into candidates, and each inline click calls store `toggle`. Selected-cut controls call `reset`, `move(...,-1|1)`, or `toggle`. All callbacks run on the main thread; candidate and fit derivations repeat per render.

### Settings tabs

| Component | Owned callbacks and state effects | Notes |
| --- | --- | --- |
| `DimensionsTab` | Local `filletMaxFor` calls `gridfinityHeight`/`maximumFilletRadius`. Height `onChange` calls `setHeightUnits`, computes max, and conditionally calls `setFilletRadius`; other sliders receive store commands directly. | Store updates may be separate notifications; validity coordination is intentionally UI-owned. |
| `FeaturesTab` | Two switch callbacks read `event.currentTarget.checked` and call `setFasteners` with one-field patches. | Reads magnet dimensions from shared spec. |
| `PrinterTab` | Select callback finds named `PRINTER_PROFILES` entry then `setPrinter`; custom dimension map renders inputs whose callbacks clone printer and replace one numeric field. | Calls `checkDesignFit` each render. `Number(value)` performs UI coercion. |

### `ExportMenu`

The component memoizes `toPrintableObjects(bins)` and derives disabled state. Named local `downloadAll` maps printable objects and schedules `setTimeout` closures that call `downloadStl` with `index * DOWNLOAD_SPACING_MS`. The single-export inline handler guards the first object then downloads it. Per-item inline handlers download their captured object. Export is disabled while geometry reports generating, but the last published bins remain visible and retained.

### `BabylonViewer`

The component memoizes `previewLayout`, owns canvas/scene/camera/root refs, and a mutable `{meshes,materials}` ref. Its memoized `fitCamera(animate, resetAngles)` computes combined world bounds through mesh methods, camera FOV/aspect-derived radius, writes limits, normalizes default alpha to the nearest orbit, then either assigns target/radius/angles or calls `scene.stopAnimation`, configures `CubicEase`, and uses local `start` to invoke `Animation.CreateAndStartAnimation` for each property.

The mount effect constructs the Babylon scene graph and lights, starts `engine.runRenderLoop(() => scene.render())`, defines `resize = () => engine.resize()`, registers it on `window` and a `ResizeObserver`, and cleans up listener/observer/engine. The geometry effect disposes old meshes/materials, uses a material map, and maps preview parts: it creates material/mesh/vertex data, sequential `Uint32Array` indices, normal array through `VertexData.ComputeNormals`, assigns/applies data, parent/material/position, updates the ownership ref, and calls `fitCamera(true)`. Render-time map callbacks format diagnostic data attributes. Reset's inline click calls `fitCamera(true, true)`.

## External and browser-created instances

Only methods/properties exercised by application code are listed.

### Browser, React, and platform objects

| Instance / creator | Used API | Owner and lifetime |
| --- | --- | --- |
| React root from `createRoot` | `render` | Entry module; renderer owns component tree. |
| module `Worker[]` from `new Worker` | `onmessage`, `onerror`, `postMessage`, `terminate` | `useBinGeometry` mount effect to cleanup. |
| `URL` from `new URL(..., import.meta.url)` | String/URL value passed to Worker | Temporary worker construction input. |
| timers | `setTimeout`, `clearTimeout` | Hook debounce ref and export scheduling closures. |
| `TextEncoder` | `encode` | Temporary cache-key hashing object. |
| Web Crypto | `crypto.subtle.digest` | Returns digest promise/array buffer. |
| typed arrays | `Float32Array` constructor/fields, `Uint32Array` constructor/`from`, `Uint8Array`; `length`, `byteLength`, `buffer` | Geometry output, mesh data, hashing, transfer, cache, STL. Buffers may transfer only worker→main. |
| `ArrayBuffer`, `DataView` | constructors; `setUint32`, `setFloat32`, `setUint16` | STL serialization buffer/view. |
| `Blob` | constructor | Temporary download payload. |
| global `URL` | `createObjectURL`, `revokeObjectURL` | Temporary download URL. |
| anchor from `document.createElement` | `href`, `download`, `click` | Temporary export helper; not attached. |
| DOM root/body/targets | `getElementById`; `body.classList.add/remove`; `closest`; `dataset`; pointer capture/release; SVG `getBoundingClientRect`, `viewBox.baseVal` | Entry and editor events. DOM owns elements. |
| `ResizeObserver` | constructor callback, `observe`, `disconnect` | Viewer mount effect. |
| `Map`, `Set`, `WeakMap` | standard construction, lookup/update/iteration methods used throughout | Local derivation, hook pending state, geometry caches. `WeakMap` owns constant-cache association. |

### IndexedDB instances

| Instance | Used methods/properties | Owner/lifetime |
| --- | --- | --- |
| `IDBOpenDBRequest` from `indexedDB.open` | `result`, `error`, `onupgradeneeded`, `onsuccess`, `onerror`, `onblocked` | `openDatabase` promise handlers. |
| `IDBDatabase` | `createObjectStore`, `transaction`, `close` | Cached module promise; close only if open succeeds after failure. |
| `IDBObjectStore` | `createIndex`, `get`, `put`, `delete`, `openCursor`, `index` | Scoped to upgrade/transactions. |
| `IDBIndex` | `openCursor` | LRU ordering. |
| `IDBRequest` | `result`, `error`, `onsuccess`, `onerror` | Promise/cursor wrappers. |
| `IDBTransaction` | `objectStore`, `oncomplete`, `onerror`, `onabort`, `error` | One operation or scan; awaited before completion. |
| `IDBCursorWithValue` | `value`, `continue`, `delete` | Size and eviction scans. |

### Manifold instances

| Instance | Used API |
| --- | --- |
| `ManifoldToplevel` (`wasm`) | `setup`; `CrossSection.square/circle/union`; `Manifold.hull/union/sphere/cylinder`; constructors `new CrossSection`, `new Mesh`, `new Manifold`; `triangulate`. |
| `CrossSection` | `offset`, `translate`, `toPolygons`, `decompose`, `add`, `intersect`, `subtract`, `union` through static API, `extrude`, `simplify`, `delete`. |
| `Manifold` | `translate`, `subtract`, `intersect`, `simplify`, `minkowskiSum`, `getMesh`, `numVert`, `delete`; static creation/boolean methods above. |
| `Mesh` | Constructor input carrier; extracted mesh properties `vertProperties`, `triVerts`, `numProp`. |

These are native/WASM-backed and are not structured-clone compatible. Production confines them to the worker. The code deliberately caches some instances and explicitly deletes selected intermediates; the geometry guide is authoritative for ownership constraints.

### Babylon instances

| Instance | Used methods/properties | Owner/lifetime |
| --- | --- | --- |
| `Engine` | constructor, `runRenderLoop`, `resize`, `dispose`, `getAspectRatio` | Viewer mount. Disposal tears down owned scene resources. |
| `Scene` | constructor; `useRightHandedSystem`, `clearColor`; `render`, `getEngine`, `stopAnimation` | Viewer mount. |
| `TransformNode` | constructor; `rotation.x` | Shared mesh parent for mount. |
| `ArcRotateCamera` | constructor; `attachControl`; `target`, `radius`, `alpha`, `beta`, `fov`, radius limits, `wheelDeltaPercentage` | Viewer mount; refs and fit/reset mutate it. |
| `HemisphericLight`, `DirectionalLight` | constructors; `intensity`; ambient `diffuse`, `groundColor` | Scene-owned for mount. |
| `StandardMaterial` | constructor; `diffuseColor`, `specularColor`, `sideOrientation`, `dispose` | One per bin per geometry effect; replaced on new parts. |
| `Mesh` | constructor; `material`, `parent`, `position.set`, `computeWorldMatrix`, `getBoundingInfo`, `dispose` | One per preview piece until replacement/unmount. |
| `VertexData` | constructor; `positions`, `indices`, `normals`, `applyToMesh`; static `ComputeNormals` | Temporary per mesh; applied data becomes mesh-owned. |
| `Vector3` | static `Zero`, `Minimize`, `Maximize`; `clone`, `add`, `scale`, `subtract`, `length` | Camera/bounds temporaries and light directions. |
| `Color3`, `Color4` | constructors; `Color3.FromHexString` | Scene/material color values. |
| `CubicEase` | constructor; `setEasingMode` | One per animated camera fit call. |
| `Animation` | static `CreateAndStartAnimation`; constants `ANIMATIONLOOPMODE_CONSTANT` | Scene-owned animation results are not retained. |

## Synchronization checklist

When a non-test runtime symbol is added, removed, renamed, or changes ownership/calls/effects, update the relevant row or owning-component callback inventory here. Also update [Application Architecture](./application-architecture.md) when the change affects an execution boundary, lifecycle, concurrency, caching, or top-level flow. Keep geometry algorithms in [Gridfinity Geometry Pipeline](./geometry-pipeline.md) and Babylon mechanics in [Babylon Viewer](./babylon-viewer.md), linking rather than duplicating them.

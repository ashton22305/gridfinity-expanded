# Gridfinity Geometry Pipeline

This is the canonical specification and architecture record for the alpha generator. The UI supplies complete, valid, generation-ready input; invalid geometry-domain input has undefined behavior.

## Pipeline and ownership

```mermaid
flowchart TB
  Frontend["Frontend (store, editors — only allows valid parameters)"] --> Params["BinParameters[]"]
  Params --> Generation["Geometry generation (worker pool, one bin per message)"]
  Generation --> Bins["Bin[]"]
  Bins --> Layout["Modifications for better viewing (previewLayout)"]
  Layout --> Viewer["Babylon viewer"]
  Bins --> Split["Split bins into distinct objects (toPrintableObjects)"]
  Split --> Printable["PrintableObject[]"]
  Printable --> STL["Binary STL"]
  STL --> Export["Download"]
```

The store owns bins, cuts, printer selection, and all editing behavior. The UI is responsible for only allowing valid parameters — controls constrain their own ranges and dependent values (the height slider re-clamps the shared fillet when it lowers the ceiling), and painting outside the selected bin's edge-connected footprint automatically starts and selects a new logical bin. There is no geometry-facing clamping or validation layer between the UI and geometry generation, and enforcement of UI validity is best-effort during the alpha. `buildBinParameters()` converts the design directly into self-contained per-bin parameters, converting height units to millimetres and partitioning cells into piece footprints using the stored cuts. Geometry owns only solid construction and piece-footprint intersection; it trusts its input completely.

Downstream of generation, `Bin[]` fans out to two branches. The viewer branch (`previewLayout()` in `src/lib/preview.ts`) flattens pieces and attaches the multipart preview gap offsets. The export branch (`toPrintableObjects()` in `src/lib/export/printableObjects.ts`) splits each bin's grouped pieces into distinct, fully named printable objects for STL serialization.

The worker contract is:

```ts
interface BinParameters {
  binId: string;
  height: number;               // mm, already converted from height units
  perimeterThickness: number;
  filletRadius: number;         // already validated by the frontend
  fasteners: FastenerSettings;
  cells: Cell[];
  openings: Edge[];
  walls: Wall[];
  pieces: Cell[][];             // piece footprints; array order defines piece index
}

interface BinPiece {
  triangles: Float32Array;      // global-coordinate flat triangle soup
  cells: Cell[];                // footprint echoed for viewer-side layout
}

interface Bin {
  binId: string;
  pieces: BinPiece[];
}
```

Array order supplies each bin's piece index. Each bin carries its stable store id so preview colors and export filenames follow the same bin identity as the 2D editors, even after bins are deleted and ids are reused. Geometry receives no cuts, printers, filenames, or presentation transforms, and emits no preview data beyond each piece's echoed footprint cells.

## Gridfinity specification

`src/lib/gridfinitySpec.ts` separates compatibility dimensions from product defaults and implementation allowances. The generated profile uses a 42 mm pitch, 7 mm height units, 41.5 mm outer top width, 3.75 mm outer radius, 4.75 mm base profile, 7 mm complete base, and 1.2 mm fixed floor. Optional recesses are 6.5 × 2.4 mm for magnets and 3 × 6 mm for M3 hardware.

References are the community [Gridfinity specification](https://gridfinity.xyz/specification/), [Gridfinity Rebuilt OpenSCAD](https://github.com/kennetek/gridfinity-rebuilt-openscad), and [Gridfinity Documentation — Original Spec](https://stu142.com/Gridfinity-Documentation/).

## Valid-input assumptions

Each supplied bin is connected and all cells, openings, walls, radii, and piece groups are valid. The Shape editor preserves that contract when adding cells: a cell sharing a horizontal or vertical edge extends the selected bin, while any other painted cell starts a new selected bin. Enclosed holes, irregular shapes, U shapes, and rings are supported. Geometry does not clamp values, find components, repair invalid profiles, create fallback cavities, or reinterpret piece groups. It also does not verify that its output is manifold; it trusts that valid input produces manifold output, and `npm run check:manifold` is the gate that verifies it.

The fillet slider derives its maximum from `maximumFilletRadius(height)` (cavity depth minus `IMPLEMENTATION_ALLOWANCES.minimumStraightCavityWall`), and the height slider writes the clamped fillet back when lowering the ceiling, so normal UI interaction cannot request a fillet deeper than the cavity. Nothing re-validates behind the UI.

Openings are canonical unit grid edges. Walls are straight millimetre segments with a width. Pieces are exact cell groups already derived by UI cut planning. Separate bins always create separate complete bins, even where cells touch.

## Solid construction

`generateGeometry()` creates one canonical Gridfinity base and translates it to every cell. It unions those bases with the complete outer-footprint extrusion.

The cavity begins as the cell footprint inset by clearance and perimeter thickness. Opening channels are unioned into that footprint and supplied wall footprints are subtracted from it. For a positive shared fillet, the footprint eroded by the fillet radius is extruded exactly from the fillet's tangent height through the open top and Minkowski-summed once with a sphere; only the lower hemisphere intersects the bin, producing the rounded floor transition and straight upper cavity as one exact solid. Filleting has no tolerance-based simplification, seed-thickness padding, or re-anchoring — those coarse approximations produced visible terraces on non-rectangular footprints. A zero-radius cavity is a straight extrusion.

The complete cavity is subtracted once. Canonical magnet and M3 cutters are translated to each cell and subtracted. A single-piece bin is emitted as built; a cut bin is intersected with each supplied piece footprint, using cutters that vertically overshoot the solid so no boolean faces coincide. The resulting pieces stay grouped under their bin in the returned `Bin[]`.

Each finished piece is simplified with a sub-micron epsilon to collapse boolean slivers, then extracted through one quantization boundary: `manifoldTriangles()` welds vertices on a 1-micron grid at serialized float32 precision, drops triangles the weld collapses, and rewrites the neighbors of any remaining exactly-degenerate facet so the soup stays closed and 2-manifold. Exact booleans can rebuild a feature twice within one float32 ULP, so a mesh that is valid in float64 can only be made watertight at the precision consumers receive by repairing after quantization. There is no output localization and no shape-level repair.

## Coordinates, preview, and export

Editor coordinates are model coordinates: X increases right, Y increases with editor rows, and Z increases upward. Geometry and STL preserve those coordinates. Origin placement is not changed per piece.

Preview offsets are a viewer-branch concern: `previewLayout()` computes each piece's 0.3 mm multipart gap offset from the piece's echoed footprint cells and the cuts in the design snapshot paired with the generated bins. The viewer applies only that offset and the Z-up display rotation. Its camera is configured so the row-down design matches the editor. Sequential preview indices give each triangle an independent normal without smoothing or vertex splitting.

`toPrintableObjects()` splits each bin's grouped pieces into distinct printable objects, deriving names from the bin's stable id and piece index. STL serialization writes each object's triangle soup directly and calculates one normal per triangle; preview offsets never affect printable coordinates.

The hook derives `BinParameters[]` and generates bins in parallel: it maintains a small worker pool (sized from `navigator.hardwareConcurrency`, capped at 4), debounces changes, increments a revision, and posts one single-bin message per bin round-robin across the pool. Responses for the current revision are gathered and reassembled in design order; stale replies are ignored, any failure clears the pending revision and reports one generic message, and the completed `Bin[]` is paired with the design snapshot that produced it. There is no serialized design key.

## Printability gates

`npm run check:manifold` exercises valid rectangular, irregular, U, ring/hole, opening, wall, hardware, multiple-bin, multipart, and minimum-height/maximum-fillet fixtures through the production `buildBinParameters → generateGeometry` path. It reconstructs topology from triangle coordinates and requires non-empty pieces, watertight edges, consistent winding, no degenerates, duplicate faces, membranes, serialized-STL topology errors, or near-horizontal faces (by face normal) inside the fillet transition band — the terrace signature. It also asserts the 0.3 mm multipart gap through the viewer-branch `previewLayout()`.

Unit tests own cut-to-piece derivation, preview layout, and printable-object naming. Browser tests cover editor-matching orientation, flat-faceted preview, orbit/reset, multipart gaps, and STL export.

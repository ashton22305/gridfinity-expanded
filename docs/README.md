# Developer Documentation

This directory explains how the two least-obvious subsystems in this repository work: the geometry generation pipeline and the Babylon.js viewer. Read these alongside the code, not instead of it — line numbers and function names here can drift; treat this as a map, not a spec.

## Contents

- [`geometry-pipeline.md`](./geometry-pipeline.md) — how a `BinConfig` in the store becomes STL buffers: the store/worker boundary, the `manifold-3d` CSG construction inside `generatePieceManifold()`, the split between preview and export output, and the Y-mirroring invariant that keeps the canvas, the 3D preview, and the printed part all in agreement.
- [`babylon-viewer.md`](./babylon-viewer.md) — how `BabylonViewer.tsx` turns those preview STL buffers into the rendered scene: scene/camera/lighting setup, the STL load lifecycle and its race guard, per-bin coloring, and how the viewer avoids undoing the mirror the geometry pipeline already applied.

## How this relates to AGENTS.md

`AGENTS.md` states the rules agents must follow (what's allowed, what needs approval, which commands must pass). These documents explain the architecture and reasoning behind those rules — why the worker boundary is shaped the way it is, why previews and export pieces diverge, why the viewer must never re-mirror. When you change the geometry pipeline or the Babylon viewer, AGENTS.md requires updating the matching document here in the same change.

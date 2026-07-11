# Repository Development Guide

This is the sole operative repository guide for LLM-assisted development. Other agent files must import it instead of duplicating policy.

## Scope and Autonomy

This repository is a React 19 + Vite 6 TypeScript application that generates printable Gridfinity STL files. Agents may choose local implementation details that fit the existing design. Ask before changing architecture, user-visible semantics, compatibility policy, or project scope.

Keep changes narrowly scoped, preserve unrelated working-tree changes, and inspect relevant call sites before editing. In particular, trace changes across the store, worker boundary, preview, and export paths where applicable. Preview data may be grouped, colored, or positioned for presentation; printable export data must preserve its coordinates, topology, orientation, and per-piece meaning.

## Project Structure

`src/main.tsx` mounts the app, `src/App.tsx` defines the Mantine AppShell, `src/store.ts` owns Zustand state, and `src/theme.ts` centralizes Mantine defaults. Domain logic is in `src/lib/`: shared contracts in `types.ts`, edge helpers in `edges.ts`, split logic in `split.ts`, printer fit in `printers.ts`, geometry in `geometry/`, and STL serialization in `export/stl.ts`.

Geometry runs in `src/workers/geometry.worker.ts`, driven by `src/hooks/useBinGeometry.ts`. UI components live under `src/components/`; the left panel contains the Shape, Walls, and Split spatial editors, the right panel contains Printer, Dimensions, and Features settings, and `BabylonViewer.tsx` presents generated STL buffers. Validation scripts are in `scripts/`; Vitest files live beside source as `*.test.ts`; browser tests live in `e2e/`.

## Implementation Rules

Use TypeScript ES modules, React function components, and two-space indentation. Use `PascalCase.tsx` for components, `useName.ts` for hooks, and descriptive camelCase exports for helpers. Keep shared configuration contracts in `src/lib/types.ts` and reusable domain logic in `src/lib/`.

Use Mantine controls and layout primitives before custom UI. Put cross-app control styling in `src/theme.ts`, global layout and documented library workarounds in `src/index.css`, and bespoke SVG editor styles in `src/components/sidebar/editor.css`. Avoid fixed design constants in JSX unless a value is genuinely data-driven.

Tabs read and write through `useAppStore()`. Bin-owned state must go through `updateBin()` so automatic split lines remain effective. Keep `BinConfig` plain and structured-clone compatible for worker messages.

The manifold path (`generateBinPieces()` / `generateBinManifold()`) is the production correctness standard. Maintain the JSCAD fallback where practical, but feature parity is not required and fallback limitations must never weaken manifold behavior. Preserve `manifoldMesh()` in the export path because it welds vertices and repairs float32-degenerate slivers.

The editors map SVG y downward to mm +y, so generated output is mirrored across Y at the geometry boundary. Do not compensate for orientation in the viewer. Split seam edges are open unless a divider lies on the seam. Combine solids with manifold booleans, use `CrossSection.offset` for inward 2D offsets, feed manifold individually closed primitives, and use a small overlap such as `CSG_EPSILON` where non-identical flush coordinates could create membranes.

The outer wall follows the Gridfinity profile (41.5 mm top width, 3.75 mm outer radius); `cavityCornerRadius` affects only the cavity. Separate `LogicalBin` entries create separate complete bins. `openEdges` remove perimeter walls, `dividerEdges` add grid-aligned internal walls, and `innerWalls` are free-form mm segments. A missing slope is flat and zero-angle slopes should not be persisted.

## Validation and Completion

Available commands:

- `npm run lint`: run Oxlint.
- `npm run test`: run the existing Vitest suite.
- `npm run build`: type-check and produce the Vite build.
- `npm run check:manifold`: validate production geometry and serialized STL printability.
- `npm run test:e2e`: run the Chromium Playwright smoke suite.
- `npm run classify:changes -- <base> <head>`: classify revision changes for CI gates.

Run lint and the production build for every non-trivial code change. Do not add new Vitest coverage by default during rapid feature development. Run existing Vitest tests locally when changing printer behavior or mesh-validation behavior already covered by the suite; CI always runs the complete suite.

Run `check:manifold` for every print-affecting change, including geometry, split-piece generation, STL serialization, walls, slopes, fasteners, worker generation, and configuration consumed by geometry. Manifold validation is the printability gate; JSCAD fallback output is best effort.

Use Playwright for every browser-visible change. If Playwright is unavailable locally, equivalent manual browser verification is acceptable, but the final report must name the method used. CI has no manual fallback: when path classification requires Playwright, a browser-test failure is a failed check.

A task is complete only when required commands have finished with confirmed successful exit codes. Timeouts, truncated output, and partially observed runs are not successes. Final reports must honestly list checks run, their results, and any required or relevant checks omitted.

## CI Change Classification

CI always runs lint, Vitest, and the production build. The repository classifier conditionally enables additional gates with a broad, fail-safe mapping:

- Runtime UI, application entrypoints, styles, store, hooks, workers, shared types, dependencies, and build configuration require Playwright.
- Geometry, split generation, STL export, geometry workers, and geometry-consumed configuration require manifold validation.
- Ambiguous shared runtime files require both.
- Documentation-only and isolated test-only changes require neither additional gate.

When a changed path is not safely recognized, classify it conservatively. Keep deployment behavior in `.github/workflows/deploy.yml` unchanged unless deployment is explicitly in scope.

## Pull Requests

Create a dedicated feature branch in a new Git worktree based on the latest `origin/main`, and make changes in that worktree rather than directly on `main`. Open pull requests with `main` as the target branch.

Use short, imperative commit subjects. Pull requests should describe user-visible changes, list validation commands, link related issues, and include screenshots or recordings for UI changes. For geometry or export changes, call out printability and manifold implications.

## Known Limitations

STL is the only wired export format. The JSCAD fallback skips inner-wall transition ramps, approximates sloped floors, and can degrade split seam profiles. Babylon.js imports are broad and may be optimized later if bundle size becomes a priority.

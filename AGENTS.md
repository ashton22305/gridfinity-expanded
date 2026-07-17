# Repository Development Guide

This is the sole operative repository guide for LLM-assisted development. Other agent files must import it instead of duplicating policy.

## Scope and Autonomy

This repository is a React 19 + Vite 6 TypeScript application that generates printable Gridfinity STL files. Agents may choose local implementation details that fit the existing design. Ask before changing architecture, user-visible semantics, compatibility policy, or project scope.

Keep changes narrowly scoped, preserve unrelated working-tree changes, and inspect relevant call sites before editing. In particular, trace changes across the store, worker boundary, preview, and export paths where applicable. Preview data may be grouped, colored, or positioned for presentation; printable export data must preserve its coordinates, topology, orientation, and per-piece meaning.

## Project Structure

`src/main.tsx` mounts the app, `src/App.tsx` defines the Mantine AppShell, `src/store.ts` owns Zustand state and explicit design commands, and `src/theme.ts` centralizes Mantine defaults. Domain logic is in `src/lib/`: shared contracts in `types.ts`, normative dimensions in `gridfinitySpec.ts`, per-bin worker-input derivation in `binParameters.ts`, persistent per-bin triangle caching in `geometryCache.ts`, viewer-branch preview layout in `preview.ts`, edge helpers in `edges.ts`, editable cut planning in `cuts.ts`, printer fit in `printers.ts`, geometry in `geometry/`, printable-object splitting and naming in `export/printableObjects.ts`, and STL serialization in `export/stl.ts`.

Geometry runs in `src/workers/geometry.worker.ts`, driven by `src/hooks/useBinGeometry.ts`. UI components live under `src/components/`; the left panel contains the Shape, Walls, and Cuts spatial editors, the right panel contains Printer, Dimensions, and Features settings, and `BabylonViewer.tsx` renders generated triangle meshes directly. Validation scripts are in `scripts/`; Vitest files live beside source as `*.test.ts`; browser tests live in `e2e/`. [`docs/geometry-pipeline.md`](./docs/geometry-pipeline.md) is the canonical specification and architecture record.

## Implementation Rules

Use TypeScript ES modules, React function components, and two-space indentation. Use `PascalCase.tsx` for components, `useName.ts` for hooks, and descriptive camelCase exports for helpers. Keep shared configuration contracts in `src/lib/types.ts` and reusable domain logic in `src/lib/`.

Use Mantine controls and layout primitives before custom UI. Put cross-app control styling in `src/theme.ts`, global layout and documented library workarounds in `src/index.css`, and bespoke SVG editor styles in `src/components/sidebar/editor.css`. Avoid fixed design constants in JSX unless a value is genuinely data-driven.

Tabs read and write through explicit `useAppStore()` commands. Keep `Design`, `BinParameters`, `Bin`, and their nested values plain and structured-clone compatible. A shape change resets the changed bin's openings, walls, and cuts before reseeding required cuts. The UI is responsible for only allowing valid parameters — controls constrain their own ranges and dependent values; do not add store clamping or a validation layer between the UI and geometry generation. The UI must derive complete piece groups before invoking geometry. Preview offsets are a viewer-branch concern computed by `previewLayout()` after generation, never worker input or output.

`generateGeometry()` is the sole production geometry path. It accepts trusted generation-ready `BinParameters[]`, builds each complete logical bin once, then intersects the finished solid with supplied piece footprints, returning each bin's cut pieces grouped in a `Bin`. The export branch splits those grouped pieces into distinct named `PrintableObject`s via `toPrintableObjects()`. Author geometry with native `manifold-3d` `CrossSection` and `Manifold` operations, exactly — never approximate shape with coarse tolerances or padding, which previously produced terraced fillets. Geometry must not plan cuts, name parts, inspect printers, validate input, verify output manifoldness, normalize coordinates, or localize output; `check:manifold` is the only manifold verifier. `manifoldTriangles()` is the one extraction boundary: it quantizes each finished part to serialized float32 precision with a 1-micron weld and degenerate-facet repair; no other repair exists.

Editor coordinates are model coordinates. The viewer camera, not geometry, is responsible for presenting row-down orientation correctly after the Z-up display rotation. Preview and STL export must consume the identical global-coordinate triangle soup, with multipart preview spacing applied only through viewer transforms. Expand the quantized extraction output so each triangle owns its vertices and flat normal. Combine solids with manifold booleans and use `CrossSection.offset` for inward 2D offsets.

The alpha generator assumes every supplied bin is edge-connected and otherwise valid. Do not add geometry-side component normalization, repair, rejection, fallback behavior, or tests that define disconnected-bin behavior. Enclosed holes remain supported. Full specification, editing, cut, coordinate, and invalid-input rules live in [`docs/geometry-pipeline.md`](./docs/geometry-pipeline.md); future rule changes must update that document and relevant happy-path tests together.

When changing the geometry pipeline (`src/lib/geometry/`, `src/workers/geometry.worker.ts`, `src/hooks/useBinGeometry.ts`, `src/lib/binParameters.ts`, `src/lib/geometryCache.ts`, `src/lib/preview.ts`, `src/lib/export/printableObjects.ts`, `src/lib/cuts.ts`, `src/lib/gridfinitySpec.ts`, `src/lib/edges.ts`) or the Babylon viewer (`src/components/viewer/BabylonViewer.tsx`), update the matching document in `docs/` in the same change.

## Validation and Completion

Available commands:

- `npm run lint`: run Oxlint.
- `npm run test`: run the existing Vitest suite.
- `npm run build`: type-check and produce the Vite build.
- `npm run check:manifold`: validate production geometry and serialized STL printability.
- `npm run test:e2e`: run the Chromium Playwright smoke suite.
- `npm run classify:changes -- <base> <head>`: classify revision changes for CI gates.

Run lint and the production build for every non-trivial code change. Do not add new Vitest coverage by default during rapid feature development. Run existing Vitest tests locally when changing printer, cut-to-part, or export behavior already covered by the suite; CI always runs the complete suite.

Run `check:manifold` for every print-affecting change, including geometry, cut/part generation, STL serialization, walls, fasteners, worker generation, and configuration consumed by geometry. Manifold validation is the printability gate.

Use Playwright for every browser-visible change. If Playwright is unavailable locally, equivalent manual browser verification is acceptable, but the final report must name the method used. CI has no manual fallback: when path classification requires Playwright, a browser-test failure is a failed check.

A task is complete only when required commands have finished with confirmed successful exit codes. Timeouts, truncated output, and partially observed runs are not successes. Final reports must honestly list checks run, their results, and any required or relevant checks omitted.

## CI Change Classification

CI always runs lint, Vitest, and the production build. The repository classifier conditionally enables additional gates with a broad, fail-safe mapping:

- Runtime UI, application entrypoints, styles, store, hooks, workers, shared types, dependencies, and build configuration require Playwright.
- Geometry, cut/part generation, STL export, geometry workers, and geometry-consumed configuration require manifold validation.
- Ambiguous shared runtime files require both.
- Documentation-only and isolated test-only changes require neither additional gate.

When a changed path is not safely recognized, classify it conservatively. Keep deployment behavior in `.github/workflows/deploy.yml` unchanged unless deployment is explicitly in scope.

## Pull Requests

Create a dedicated feature branch in a new Git worktree based on the latest `origin/main`, and make changes in that worktree rather than directly on `main`. Open pull requests with `main` as the target branch.

Use short, imperative commit subjects. Pull requests should describe user-visible changes, list validation commands, link related issues, and include screenshots or recordings for UI changes. For geometry or export changes, call out printability and manifold implications. Pull requests that touch the geometry pipeline or Babylon viewer must include any corresponding `docs/` updates.

Use `--body-file` for multiline `gh` pull-request bodies and comments. Do not embed escaped `\\n` sequences in shell arguments because GitHub renders them as literal text.

## Known Limitations

STL is the only wired export format.

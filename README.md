# Gridfinity Expanded

A React 19 + Vite 6 TypeScript application for designing connected Gridfinity bins and exporting printable STL parts.

The editor supports multiple explicitly selected bins, perimeter openings, full-height internal walls, editable printer-aware cuts, magnet recesses, and M3 recesses. The UI resolves cuts into printable parts, then a background worker builds trusted input into triangle soups used directly by both Babylon preview and STL export.

## Development

```sh
npm install
npm run dev
```

Required validation commands are documented in [`AGENTS.md`](./AGENTS.md).

## Architecture documentation

Start with [`docs/application-architecture.md`](./docs/application-architecture.md) for the end-to-end application design, ownership, execution boundaries, caching, concurrency, preview, and export flows. [`docs/object-method-reference.md`](./docs/object-method-reference.md) is the comprehensive reference for runtime components, hooks, functions, objects, callbacks, and external instances used by the application.

[`docs/geometry-pipeline.md`](./docs/geometry-pipeline.md) remains the canonical geometry specification and architecture record. It documents the Gridfinity dimensions and sources, trusted-input contract, shape/wall/cut ownership, solid construction, direct preview, STL export, and printability gates. [`docs/babylon-viewer.md`](./docs/babylon-viewer.md) records viewer-specific mechanics.

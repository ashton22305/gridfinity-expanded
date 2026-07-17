# Gridfinity Expanded

A React 19 + Vite 6 TypeScript application for designing connected Gridfinity bins and exporting printable STL parts.

The editor supports multiple explicitly selected bins, perimeter openings, full-height internal walls, editable printer-aware cuts, magnet recesses, and M3 recesses. The UI resolves cuts into printable parts, then a background worker builds trusted input into triangle soups used directly by both Babylon preview and STL export.

## Development

```sh
npm install
npm run dev
```

Required validation commands are documented in [`AGENTS.md`](./AGENTS.md).

## Geometry documentation

[`docs/geometry-pipeline.md`](./docs/geometry-pipeline.md) is the canonical specification and architecture record. It documents the Gridfinity dimensions and sources, trusted-input contract, shape/wall/cut ownership, solid construction, direct preview, STL export, and printability gates.

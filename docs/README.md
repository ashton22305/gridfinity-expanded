# Developer Documentation

- [`application-architecture.md`](./application-architecture.md) is the approachable end-to-end guide to modules, state ownership, execution boundaries, caching, workers, generation, preview, export, and lifecycle.
- [`object-method-reference.md`](./object-method-reference.md) inventories every non-test runtime component, hook, function, store command, private helper, structured object, owned callback group, and app-created external instance under `src/`.
- [`geometry-pipeline.md`](./geometry-pipeline.md) is the canonical record for the Gridfinity specification, trusted-input contract, editing ownership, solid construction, coordinates, preview/export identity, and printability rules.
- [`babylon-viewer.md`](./babylon-viewer.md) records the viewer-specific scene, direct `VertexData`, camera, and lifecycle details.

Future runtime object or method changes must keep the application architecture and object/method reference synchronized. Geometry or behavior rule changes must update the canonical geometry document and the relevant happy-path tests together. `AGENTS.md` contains operative repository workflow rules and points here instead of duplicating the architecture.

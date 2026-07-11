/// <reference lib="webworker" />
import { generateBinPieces } from '../lib/geometry/gridfinity';
import { initManifold } from '../lib/geometry/manifold';
// Vite resolves this to the hashed, base-path-aware asset URL for the WASM binary.
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { meshToStl } from '../lib/export/stl';
import type { BinConfig } from '../lib/types';

// Kick off WASM init at startup. Initialization and generation failures are
// reported through the existing error response so the UI keeps its last good
// preview and export buffers.
const manifoldReady = initManifold(() => wasmUrl);

interface PieceBuffers {
  previews: { bin: number; buffer: ArrayBuffer }[];
  pieces: { name: string; buffer: ArrayBuffer }[];
}

self.onmessage = async (e: MessageEvent<{ config: BinConfig; requestId: number }>) => {
  const { config, requestId } = e.data;
  try {
    const wasm = await manifoldReady;
    const { pieces, previews } = generateBinPieces(wasm, config);
    const result: PieceBuffers = {
      previews: previews.map((p) => ({
        bin: p.bin,
        buffer: meshToStl(p.mesh.vertProperties, p.mesh.triVerts),
      })),
      pieces: pieces.map((p) => ({
        name: p.name,
        buffer: meshToStl(p.mesh.vertProperties, p.mesh.triVerts),
      })),
    };
    self.postMessage({ ok: true, requestId, ...result },
      [...result.previews.map((p) => p.buffer), ...result.pieces.map((p) => p.buffer)]);
  } catch (err) {
    self.postMessage({ ok: false, requestId, error: String(err) });
  }
};

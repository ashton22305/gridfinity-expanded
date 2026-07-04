/// <reference lib="webworker" />
import { generateBinPieces, generateBinPiecesJscad } from '../lib/geometry/gridfinity';
import { initManifold } from '../lib/geometry/manifold';
// Vite resolves this to the hashed, base-path-aware asset URL for the WASM binary.
import wasmUrl from 'manifold-3d/manifold.wasm?url';
// @ts-expect-error — no type declarations published for this package
import { serialize } from '@jscad/stl-serializer';
import { meshToStl } from '../lib/export/stl';
import type { BinConfig } from '../lib/types';

// Kick off WASM init at startup. If it ever fails to load, we degrade to the
// pure-JS JSCAD path rather than leaving the app unable to generate anything.
const manifoldReady = initManifold(() => wasmUrl).catch(() => null);

interface PieceBuffers {
  preview: ArrayBuffer;
  pieces: { name: string; buffer: ArrayBuffer }[];
}

/** Serializes one or more JSCAD Geom3s to a single binary STL buffer. */
function jscadStl(geoms: unknown[]): ArrayBuffer {
  const parts = serialize({ binary: true }, ...geoms) as ArrayBuffer[];
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    combined.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return combined.buffer;
}

/** JSCAD fallback: split-aware generation via @jscad/stl-serializer. */
function jscadPieces(config: BinConfig): PieceBuffers {
  const parts = generateBinPiecesJscad(config);
  return {
    preview: jscadStl(parts.map((p) => p.previewGeom)),
    pieces: parts.map((p) => ({ name: p.name, buffer: jscadStl([p.exportGeom]) })),
  };
}

self.onmessage = async (e: MessageEvent<{ config: BinConfig; requestId: number }>) => {
  const { config, requestId } = e.data;
  try {
    const wasm = await manifoldReady;
    let result: PieceBuffers;
    if (wasm) {
      const { pieces, preview } = generateBinPieces(wasm, config);
      result = {
        preview: meshToStl(preview.vertProperties, preview.triVerts),
        pieces: pieces.map((p) => ({
          name: p.name,
          buffer: meshToStl(p.mesh.vertProperties, p.mesh.triVerts),
        })),
      };
    } else {
      result = jscadPieces(config);
    }
    self.postMessage({ ok: true, requestId, ...result },
      [result.preview, ...result.pieces.map((p) => p.buffer)]);
  } catch (err) {
    // A failure in the manifold path (e.g. an unexpected degenerate input) still
    // yields a model via the JSCAD fallback before surfacing an error.
    try {
      const result = jscadPieces(config);
      self.postMessage({ ok: true, requestId, ...result },
        [result.preview, ...result.pieces.map((p) => p.buffer)]);
    } catch {
      self.postMessage({ ok: false, requestId, error: String(err) });
    }
  }
};

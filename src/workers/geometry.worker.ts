/// <reference lib="webworker" />
import { generateBin, generateBinManifold } from '../lib/geometry/gridfinity';
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

/** JSCAD fallback: serialize a Geom3 to binary STL via @jscad/stl-serializer. */
function jscadStl(config: BinConfig): ArrayBuffer {
  const parts = serialize({ binary: true }, generateBin(config)) as ArrayBuffer[];
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    combined.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return combined.buffer;
}

self.onmessage = async (e: MessageEvent<{ config: BinConfig; requestId: number }>) => {
  const { config, requestId } = e.data;
  try {
    const wasm = await manifoldReady;
    let buffer: ArrayBuffer;
    if (wasm) {
      const mesh = generateBinManifold(wasm, config);
      buffer = meshToStl(mesh.vertProperties, mesh.triVerts);
    } else {
      buffer = jscadStl(config);
    }
    self.postMessage({ ok: true, buffer, requestId }, [buffer]);
  } catch (err) {
    // A failure in the manifold path (e.g. an unexpected degenerate input) still
    // yields a model via the JSCAD fallback before surfacing an error.
    try {
      const buffer = jscadStl(config);
      self.postMessage({ ok: true, buffer, requestId }, [buffer]);
    } catch {
      self.postMessage({ ok: false, error: String(err), requestId });
    }
  }
};

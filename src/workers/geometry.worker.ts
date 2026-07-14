/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { generateDesignParts } from '../lib/geometry/gridfinity';
import { initManifold } from '../lib/geometry/manifold';
import type { GenerateGeometryRequest, GenerateGeometryResponse } from '../lib/types';

const manifoldReady = initManifold(() => wasmUrl);

self.onmessage = async (event: MessageEvent<GenerateGeometryRequest>) => {
  const { design, requestId } = event.data;
  try {
    const wasm = await manifoldReady;
    const parts = generateDesignParts(wasm, design);
    const response: GenerateGeometryResponse = { ok: true, requestId, parts };
    const transfer = parts.flatMap((part) => [
      part.mesh.positions.buffer as ArrayBuffer,
      part.mesh.indices.buffer as ArrayBuffer,
    ]);
    self.postMessage(response, transfer);
  } catch {
    const response: GenerateGeometryResponse = {
      ok: false,
      requestId,
      error: 'Generation failed. Try changing the design and retrying.',
    };
    self.postMessage(response);
  }
};

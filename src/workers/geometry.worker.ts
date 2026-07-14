/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { generateGeometry } from '../lib/geometry/gridfinity';
import { initManifold } from '../lib/geometry/manifold';
import type { GenerateGeometryRequest, GenerateGeometryResponse } from '../lib/types';

const manifoldReady = initManifold(() => wasmUrl);

self.onmessage = async (event: MessageEvent<GenerateGeometryRequest>) => {
  const { input, revision } = event.data;
  try {
    const wasm = await manifoldReady;
    const parts = generateGeometry(wasm, input);
    const response: GenerateGeometryResponse = { ok: true, revision, parts };
    const transfer = parts.map((part) => part.triangles.buffer as ArrayBuffer);
    self.postMessage(response, transfer);
  } catch {
    const response: GenerateGeometryResponse = {
      ok: false,
      revision,
      error: 'Geometry generation failed.',
    };
    self.postMessage(response);
  }
};

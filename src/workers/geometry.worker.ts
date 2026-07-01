/// <reference lib="webworker" />
import { generateBin } from '../lib/geometry/gridfinity';
// @ts-expect-error — no type declarations published for this package
import { serialize } from '@jscad/stl-serializer';
import type { BinConfig } from '../lib/types';

self.onmessage = (e: MessageEvent<{ config: BinConfig; requestId: number }>) => {
  const { config, requestId } = e.data;
  try {
    const geometry = generateBin(config);
    // serialize() returns an array of ArrayBuffers (header / count / triangles).
    const parts = serialize({ binary: true }, geometry) as ArrayBuffer[];
    const totalLength = parts.reduce((n, p) => n + p.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      combined.set(new Uint8Array(part), offset);
      offset += part.byteLength;
    }
    self.postMessage({ ok: true, buffer: combined.buffer, requestId }, [combined.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err), requestId });
  }
};

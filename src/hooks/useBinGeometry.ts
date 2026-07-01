import { useEffect, useMemo, useRef, useState } from 'react';
import type { BinConfig } from '../lib/types';

const DEBOUNCE_MS = 350;

export interface PieceStl {
  name: string;
  buffer: ArrayBuffer;
}

interface GeometryState {
  previewBuffer: ArrayBuffer | null;
  pieces: PieceStl[];
  generating: boolean;
  error: string | null;
}

type WorkerResult =
  | { ok: true; preview: ArrayBuffer; pieces: PieceStl[]; requestId: number }
  | { ok: false; error: string; requestId: number };

export function useBinGeometry(config: BinConfig): GeometryState {
  const [state, setState] = useState<GeometryState>({
    previewBuffer: null,
    pieces: [],
    generating: false,
    error: null,
  });

  // JSON key gates the effect so it only re-fires when config actually changes value.
  const configKey = useMemo(() => JSON.stringify(config), [config]);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One long-lived worker reused across config changes, instead of re-spawning
  // (and re-paying module bootstrap cost) on every debounced edit.
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/geometry.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerResult>) => {
      const data = e.data;
      if (data.requestId !== requestIdRef.current) return; // superseded — discard stale result
      if (data.ok) {
        setState({ previewBuffer: data.preview, pieces: data.pieces, generating: false, error: null });
      } else {
        setState((s) => ({ ...s, generating: false, error: data.error }));
      }
    };

    worker.onerror = () => {
      setState((s) => ({ ...s, generating: false, error: 'Geometry worker failed to load.' }));
    };

    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const requestId = ++requestIdRef.current;
      setState((s) => ({ ...s, generating: true, error: null }));
      workerRef.current?.postMessage({ config, requestId });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  return state;
}

import { useEffect, useRef, useState } from 'react';
import type { BinConfig } from '../lib/types';

const DEBOUNCE_MS = 350;

interface GeometryState {
  stlBuffer: ArrayBuffer | null;
  generating: boolean;
  error: string | null;
}

type WorkerResult = { ok: true; buffer: ArrayBuffer } | { ok: false; error: string };

export function useBinGeometry(config: BinConfig): GeometryState {
  const [state, setState] = useState<GeometryState>({
    stlBuffer: null,
    generating: false,
    error: null,
  });

  // JSON key gates the effect so it only re-fires when config actually changes value.
  const configKey = JSON.stringify(config);
  const workerRef = useRef<Worker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      workerRef.current?.terminate();

      const worker = new Worker(
        new URL('../workers/geometry.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current = worker;

      setState((s) => ({ ...s, generating: true, error: null }));

      worker.onmessage = (e: MessageEvent<WorkerResult>) => {
        if (workerRef.current !== worker) return; // superseded — discard stale result
        const data = e.data;
        if (data.ok) {
          setState({ stlBuffer: data.buffer, generating: false, error: null });
        } else {
          setState((s) => ({ ...s, generating: false, error: data.error }));
        }
        worker.terminate();
      };

      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        setState((s) => ({ ...s, generating: false, error: 'Geometry worker failed to load.' }));
        worker.terminate();
      };

      worker.postMessage(config);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  useEffect(() => {
    return () => workerRef.current?.terminate();
  }, []);

  return state;
}

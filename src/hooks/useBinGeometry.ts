import { useEffect, useMemo, useRef, useState } from 'react';
import { buildGeometryInput } from '../lib/geometryInput';
import type {
  Design,
  GenerateGeometryRequest,
  GenerateGeometryResponse,
  GeneratedPart,
} from '../lib/types';

const DEBOUNCE_MS = 300;

export interface GeometryState {
  parts: GeneratedPart[];
  generating: boolean;
  error: string | null;
}

export function useBinGeometry(design: Design): GeometryState {
  const [state, setState] = useState<GeometryState>({
    parts: [],
    generating: false,
    error: null,
  });
  const input = useMemo(() => buildGeometryInput(design), [design]);
  const workerRef = useRef<Worker | null>(null);
  const revisionRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/geometry.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<GenerateGeometryResponse>) => {
      const response = event.data;
      if (response.revision !== revisionRef.current) return;
      if (response.ok) {
        setState({ parts: response.parts, generating: false, error: null });
      } else {
        setState((current) => ({ ...current, generating: false, error: response.error }));
      }
    };
    worker.onerror = () => {
      setState((current) => ({
        ...current,
        generating: false,
        error: 'Geometry generation failed.',
      }));
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const revision = ++revisionRef.current;
      const request: GenerateGeometryRequest = { input, revision };
      setState((current) => ({ ...current, generating: true, error: null }));
      workerRef.current?.postMessage(request);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input]);

  return state;
}

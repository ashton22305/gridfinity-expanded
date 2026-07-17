import { useEffect, useMemo, useRef, useState } from 'react';
import { buildBinParameters } from '../lib/binParameters';
import { validateDesign } from '../lib/validation';
import type {
  Bin,
  Design,
  GenerateGeometryRequest,
  GenerateGeometryResponse,
} from '../lib/types';

const DEBOUNCE_MS = 300;

export interface GeometryState {
  bins: Bin[];
  /** The validated design snapshot that produced `bins`, for viewer layout. */
  design: Design | null;
  generating: boolean;
  error: string | null;
}

export function useBinGeometry(design: Design): GeometryState {
  const [state, setState] = useState<GeometryState>({
    bins: [],
    design: null,
    generating: false,
    error: null,
  });
  const validated = useMemo(() => validateDesign(design), [design]);
  const parameters = useMemo(() => buildBinParameters(validated), [validated]);
  const workerRef = useRef<Worker | null>(null);
  const revisionRef = useRef(0);
  const postedDesignRef = useRef<Design | null>(null);
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
        setState({
          bins: response.bins,
          design: postedDesignRef.current,
          generating: false,
          error: null,
        });
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
      postedDesignRef.current = validated;
      const request: GenerateGeometryRequest = { bins: parameters, revision };
      setState((current) => ({ ...current, generating: true, error: null }));
      workerRef.current?.postMessage(request);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [parameters, validated]);

  return state;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildBinParameters } from '../lib/binParameters';
import type {
  Bin,
  Design,
  GenerateGeometryRequest,
  GenerateGeometryResponse,
} from '../lib/types';

const DEBOUNCE_MS = 300;
const MAX_POOL_SIZE = 4;

export interface GeometryState {
  bins: Bin[];
  /** The design snapshot that produced `bins`, for viewer layout. */
  design: Design | null;
  generating: boolean;
  error: string | null;
}

interface PendingGeneration {
  revision: number;
  design: Design;
  /** Posted bin order; gathered results are reassembled to match. */
  binIds: string[];
  binsById: Map<string, Bin>;
  remaining: number;
}

function poolSize(): number {
  return Math.min(MAX_POOL_SIZE, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));
}

export function useBinGeometry(design: Design): GeometryState {
  const [state, setState] = useState<GeometryState>({
    bins: [],
    design: null,
    generating: false,
    error: null,
  });
  const parameters = useMemo(() => buildBinParameters(design), [design]);
  const workersRef = useRef<Worker[]>([]);
  const revisionRef = useRef(0);
  const pendingRef = useRef<PendingGeneration | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fail = () => {
      pendingRef.current = null;
      setState((current) => ({
        ...current,
        generating: false,
        error: 'Geometry generation failed.',
      }));
    };
    const workers = Array.from({ length: poolSize() }, () => {
      const worker = new Worker(
        new URL('../workers/geometry.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (event: MessageEvent<GenerateGeometryResponse>) => {
        const response = event.data;
        const pending = pendingRef.current;
        if (response.revision !== revisionRef.current || pending?.revision !== response.revision) {
          return;
        }
        if (!response.ok) {
          fail();
          return;
        }
        for (const bin of response.bins) pending.binsById.set(bin.binId, bin);
        pending.remaining -= 1;
        if (pending.remaining > 0) return;
        pendingRef.current = null;
        setState({
          bins: pending.binIds.map((binId) => pending.binsById.get(binId)!),
          design: pending.design,
          generating: false,
          error: null,
        });
      };
      worker.onerror = fail;
      return worker;
    });
    workersRef.current = workers;
    return () => workers.forEach((worker) => worker.terminate());
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const revision = ++revisionRef.current;
      pendingRef.current = {
        revision,
        design,
        binIds: parameters.map((bin) => bin.binId),
        binsById: new Map(),
        remaining: parameters.length,
      };
      setState((current) => ({ ...current, generating: true, error: null }));
      const workers = workersRef.current;
      parameters.forEach((bin, index) => {
        const request: GenerateGeometryRequest = { revision, bins: [bin] };
        workers[index % workers.length]?.postMessage(request);
      });
      if (parameters.length === 0) {
        pendingRef.current = null;
        setState({ bins: [], design, generating: false, error: null });
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [design, parameters]);

  return state;
}

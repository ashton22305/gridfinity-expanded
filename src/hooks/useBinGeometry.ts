import { useEffect, useMemo, useRef, useState } from 'react';
import { buildBinParameters } from '../lib/binParameters';
import {
  geometryCacheKey,
  readCachedBin,
  writeCachedBin,
} from '../lib/geometryCache';
import type {
  BandMeshData,
  Bin,
  BinParameters,
  Design,
  GeometryPolygon,
  GeometryWorkerRequest,
  GeometryWorkerResponse,
} from '../lib/types';

const DEBOUNCE_MS = 300;
const MAX_POOL_SIZE = 4;
const HELPER_TIMEOUT_MS = 10_000;

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
  cacheKeysByBinId: Map<string, string>;
  remaining: number;
}

interface GenerateTask {
  revision: number;
  bin: BinParameters;
}

type WorkerBusy =
  | { type: 'generate'; revision: number }
  | {
    type: 'helper';
    revision: number;
    bandId: string;
    groupId: string;
    timer: ReturnType<typeof setTimeout>;
  };

interface WorkerSlot {
  index: number;
  worker: Worker;
  busy: WorkerBusy | null;
  homeQueue: GenerateTask[];
}

interface BandCoordination {
  revision: number;
  primaryIndex: number;
  pendingGroupIds: Set<string>;
  failed: boolean;
}

function poolSize(): number {
  return Math.min(MAX_POOL_SIZE, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));
}

/** FNV-1a keeps each logical bin on one worker so its WASM-local LRUs stay hot. */
function homeWorkerIndex(binId: string, workerCount: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < binId.length; index++) {
    hash ^= binId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % workerCount;
}

function splitChains(chains: GeometryPolygon[], count: number): GeometryPolygon[][] {
  return Array.from({ length: count }, (_, index) =>
    chains.slice(
      Math.floor(index * chains.length / count),
      Math.floor((index + 1) * chains.length / count),
    ));
}

function meshTransfer(mesh: BandMeshData): ArrayBuffer[] {
  return [
    mesh.vertProperties.buffer as ArrayBuffer,
    mesh.triVerts.buffer as ArrayBuffer,
    mesh.mergeFromVert.buffer as ArrayBuffer,
    mesh.mergeToVert.buffer as ArrayBuffer,
  ];
}

export function useBinGeometry(design: Design): GeometryState {
  const [state, setState] = useState<GeometryState>({
    bins: [],
    design: null,
    generating: false,
    error: null,
  });
  const parameters = useMemo(() => buildBinParameters(design), [design]);
  const workersRef = useRef<WorkerSlot[]>([]);
  const bandsRef = useRef(new Map<string, BandCoordination>());
  const revisionRef = useRef(0);
  const pendingRef = useRef<PendingGeneration | null>(null);

  useEffect(() => {
    const slots: WorkerSlot[] = [];
    const bands = bandsRef.current;
    workersRef.current = slots;

    const failGeneration = () => {
      pendingRef.current = null;
      slots.forEach((slot) => {
        slot.homeQueue = [];
      });
      setState((current) => ({
        ...current,
        generating: false,
        error: 'Geometry generation failed.',
      }));
    };

    const dispatchHome = (slot: WorkerSlot) => {
      if (slot.busy) return;
      while (slot.homeQueue.length > 0) {
        const task = slot.homeQueue.shift()!;
        if (task.revision !== revisionRef.current) continue;
        slot.busy = { type: 'generate', revision: task.revision };
        const request: GeometryWorkerRequest = {
          type: 'generate',
          revision: task.revision,
          bins: [task.bin],
        };
        slot.worker.postMessage(request);
        return;
      }
    };

    const installWorker = (index: number, queue: GenerateTask[] = []) => {
      const previous = slots[index];
      if (previous?.busy?.type === 'helper') clearTimeout(previous.busy.timer);
      previous?.worker.terminate();
      const worker = new Worker(
        new URL('../workers/geometry.worker.ts', import.meta.url),
        { type: 'module' },
      );
      const slot: WorkerSlot = {
        index,
        worker,
        busy: null,
        homeQueue: queue,
      };
      slots[index] = slot;

      const failHelper = (failedIndex: number, bandId: string, groupId: string) => {
        const coordination = bandsRef.current.get(bandId);
        if (coordination && !coordination.failed) {
          coordination.failed = true;
          const primary = slots[coordination.primaryIndex];
          const failure: GeometryWorkerRequest = {
            type: 'band-result',
            revision: coordination.revision,
            bandId,
            groupId,
            ok: false,
            error: 'Band helper failed.',
          };
          primary?.worker.postMessage(failure);
          bandsRef.current.delete(bandId);
        }
        const retainedQueue = slots[failedIndex]?.homeQueue ?? [];
        installWorker(failedIndex, retainedQueue);
        dispatchHome(slots[failedIndex]);
      };

      worker.onmessage = (event: MessageEvent<GeometryWorkerResponse>) => {
        const response = event.data;
        if (response.type === 'band-group-request') {
          const pending = pendingRef.current;
          if (response.revision !== revisionRef.current ||
            pending?.revision !== response.revision) {
            const cancel: GeometryWorkerRequest = {
              type: 'cancel',
              revision: revisionRef.current,
            };
            worker.postMessage(cancel);
            return;
          }
          const activeBins = Math.min(slots.length, pending.remaining);
          const helperLimit = Math.max(0, slots.length - activeBins);
          const helpers = slots.filter((candidate) =>
            candidate.index !== index &&
            !candidate.busy &&
            candidate.homeQueue.length === 0
          ).slice(0, helperLimit);
          const groups = splitChains(response.chains, helpers.length + 1);
          const groupIds = helpers.map((_, helperIndex) =>
            response.bandId + ':' + helperIndex);
          if (helpers.length > 0) {
            bandsRef.current.set(response.bandId, {
              revision: response.revision,
              primaryIndex: index,
              pendingGroupIds: new Set(groupIds),
              failed: false,
            });
          }
          helpers.forEach((helper, helperIndex) => {
            const groupId = groupIds[helperIndex];
            const request: GeometryWorkerRequest = {
              type: 'run-band-group',
              revision: response.revision,
              bandId: response.bandId,
              groupId,
              radius: response.radius,
              upperZ: response.upperZ,
              chains: groups[helperIndex + 1],
            };
            const timer = setTimeout(() => {
              const current = slots[helper.index];
              if (current?.busy?.type === 'helper' &&
                current.busy.bandId === response.bandId &&
                current.busy.groupId === groupId) {
                failHelper(helper.index, response.bandId, groupId);
              }
            }, HELPER_TIMEOUT_MS);
            helper.busy = {
              type: 'helper',
              revision: response.revision,
              bandId: response.bandId,
              groupId,
              timer,
            };
            helper.worker.postMessage(request);
          });
          const allocation: GeometryWorkerRequest = {
            type: 'band-allocation',
            revision: response.revision,
            bandId: response.bandId,
            localChains: groups[0],
            helperGroupIds: groupIds,
          };
          worker.postMessage(allocation);
          return;
        }

        if (response.type === 'band-group-result') {
          const current = slots[index];
          if (current.busy?.type !== 'helper' ||
            current.busy.bandId !== response.bandId ||
            current.busy.groupId !== response.groupId) return;
          clearTimeout(current.busy.timer);
          current.busy = null;
          const coordination = bandsRef.current.get(response.bandId);
          if (coordination && !coordination.failed &&
            coordination.revision === response.revision) {
            coordination.pendingGroupIds.delete(response.groupId);
            const primary = slots[coordination.primaryIndex];
            const forwarded: GeometryWorkerRequest = {
              type: 'band-result',
              revision: response.revision,
              bandId: response.bandId,
              groupId: response.groupId,
              ok: true,
              mesh: response.mesh,
            };
            primary?.worker.postMessage(forwarded, meshTransfer(response.mesh));
            if (coordination.pendingGroupIds.size === 0) {
              bandsRef.current.delete(response.bandId);
            }
          }
          dispatchHome(current);
          return;
        }

        if (response.type === 'band-group-failure') {
          failHelper(index, response.bandId, response.groupId);
          return;
        }

        if (response.type === 'band-group-cancel') {
          const coordination = bandsRef.current.get(response.bandId);
          if (coordination?.revision === response.revision) {
            coordination.failed = true;
            bandsRef.current.delete(response.bandId);
          }
          return;
        }

        const current = slots[index];
        if (current.busy?.type === 'generate' &&
          current.busy.revision === response.revision) {
          current.busy = null;
        }
        if (response.revision !== revisionRef.current) {
          dispatchHome(current);
          return;
        }
        if (response.type === 'generation-failure') {
          failGeneration();
          dispatchHome(current);
          return;
        }
        const pending = pendingRef.current;
        if (!pending || pending.revision !== response.revision) {
          dispatchHome(current);
          return;
        }
        for (const bin of response.bins) {
          pending.binsById.set(bin.binId, bin);
          const cacheKey = pending.cacheKeysByBinId.get(bin.binId);
          if (cacheKey) void writeCachedBin(cacheKey, bin).catch(() => undefined);
        }
        pending.remaining -= 1;
        if (pending.remaining === 0) {
          pendingRef.current = null;
          setState({
            bins: pending.binIds.map((binId) => pending.binsById.get(binId)!),
            design: pending.design,
            generating: false,
            error: null,
          });
        }
        dispatchHome(current);
      };

      worker.onerror = (event) => {
        event.preventDefault();
        const current = slots[index];
        if (current.busy?.type === 'helper') {
          failHelper(index, current.busy.bandId, current.busy.groupId);
          return;
        }
        failGeneration();
        const retainedQueue = current.homeQueue;
        installWorker(index, retainedQueue);
        dispatchHome(slots[index]);
      };
    };

    for (let index = 0; index < poolSize(); index++) installWorker(index);

    return () => {
      revisionRef.current += 1;
      slots.forEach((slot) => {
        if (slot.busy?.type === 'helper') clearTimeout(slot.busy.timer);
        slot.worker.terminate();
      });
      bands.clear();
    };
  }, []);

  useEffect(() => {
    const revision = ++revisionRef.current;
    const slots = workersRef.current;
    const cancel: GeometryWorkerRequest = { type: 'cancel', revision };
    slots.forEach((slot) => {
      slot.homeQueue = [];
      slot.worker.postMessage(cancel);
    });
    for (const [bandId, coordination] of bandsRef.current) {
      if (coordination.revision < revision) bandsRef.current.delete(bandId);
    }
    const timer = setTimeout(() => {
      void (async () => {
        setState((current) => ({ ...current, generating: true, error: null }));
        if (parameters.length === 0) {
          pendingRef.current = null;
          setState({ bins: [], design, generating: false, error: null });
          return;
        }

        const lookups = await Promise.all(parameters.map(async (bin) => {
          try {
            const key = await geometryCacheKey(bin);
            return { bin, key, cached: await readCachedBin(key, bin.binId) };
          } catch {
            return { bin, key: null, cached: null };
          }
        }));
        if (revision !== revisionRef.current) return;

        const binsById = new Map<string, Bin>();
        const cacheKeysByBinId = new Map<string, string>();
        const missing: BinParameters[] = [];
        for (const lookup of lookups) {
          if (lookup.key) cacheKeysByBinId.set(lookup.bin.binId, lookup.key);
          if (lookup.cached) binsById.set(lookup.bin.binId, lookup.cached);
          else missing.push(lookup.bin);
        }

        if (missing.length === 0) {
          pendingRef.current = null;
          setState({
            bins: parameters.map((bin) => binsById.get(bin.binId)!),
            design,
            generating: false,
            error: null,
          });
          return;
        }

        pendingRef.current = {
          revision,
          design,
          binIds: parameters.map((bin) => bin.binId),
          binsById,
          cacheKeysByBinId,
          remaining: missing.length,
        };
        missing.forEach((bin) => {
          const home = slots[homeWorkerIndex(bin.binId, slots.length)];
          home.homeQueue.push({ revision, bin });
        });
        slots.forEach((slot) => {
          if (slot.busy) return;
          const taskIndex = slot.homeQueue.findIndex((task) => task.revision === revision);
          if (taskIndex < 0) return;
          const [task] = slot.homeQueue.splice(taskIndex, 1);
          slot.busy = { type: 'generate', revision };
          const request: GeometryWorkerRequest = {
            type: 'generate',
            revision,
            bins: [task.bin],
          };
          slot.worker.postMessage(request);
        });
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [design, parameters]);

  return state;
}

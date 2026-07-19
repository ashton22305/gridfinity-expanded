/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import {
  generateBandGroupMesh,
  generateGeometry,
} from '../lib/geometry/gridfinity';
import type {
  BandMeshData,
  GeometryPolygon,
  GeometryWorkerRequest,
  GeometryWorkerResponse,
} from '../lib/types';
import { initManifold } from '../lib/geometry/manifold';

const manifoldReady = initManifold(() => wasmUrl);
let cancelBeforeRevision = 0;
let activeRevision = 0;
let nextBandId = 0;

interface PendingBand {
  revision: number;
  allocation: {
    resolve: (value: { localChains: GeometryPolygon[]; helperGroupIds: string[] }) => void;
    reject: (error: Error) => void;
  };
  helpers: {
    expected: Set<string>;
    meshes: BandMeshData[];
    resolve: (meshes: BandMeshData[]) => void;
    reject: (error: Error) => void;
  };
}

const pendingBands = new Map<string, PendingBand>();

function abortError(): Error {
  return new DOMException('Geometry generation was superseded.', 'AbortError');
}

function transferMesh(mesh: BandMeshData): ArrayBuffer[] {
  return [
    mesh.vertProperties.buffer as ArrayBuffer,
    mesh.triVerts.buffer as ArrayBuffer,
    mesh.mergeFromVert.buffer as ArrayBuffer,
    mesh.mergeToVert.buffer as ArrayBuffer,
  ];
}

async function delegateBandUnion(
  request: {
    chains: GeometryPolygon[];
    radius: number;
    upperZ: number;
  },
) {
  const revision = activeRevision;
  if (revision < cancelBeforeRevision) throw abortError();
  const bandId = `${revision}:${nextBandId++}`;
  let resolveAllocation!: PendingBand['allocation']['resolve'];
  let rejectAllocation!: PendingBand['allocation']['reject'];
  const allocationPromise = new Promise<{
    localChains: GeometryPolygon[];
    helperGroupIds: string[];
  }>((resolve, reject) => {
    resolveAllocation = resolve;
    rejectAllocation = reject;
  });
  let resolveHelpers!: PendingBand['helpers']['resolve'];
  let rejectHelpers!: PendingBand['helpers']['reject'];
  const helperMeshes = new Promise<BandMeshData[]>((resolve, reject) => {
    resolveHelpers = resolve;
    rejectHelpers = reject;
  });
  void helperMeshes.catch(() => undefined);
  const pending: PendingBand = {
    revision,
    allocation: { resolve: resolveAllocation, reject: rejectAllocation },
    helpers: {
      expected: new Set(),
      meshes: [],
      resolve: resolveHelpers,
      reject: rejectHelpers,
    },
  };
  pendingBands.set(bandId, pending);
  const message: GeometryWorkerResponse = {
    type: 'band-group-request',
    revision,
    bandId,
    ...request,
  };
  self.postMessage(message);
  const allocation = await allocationPromise;
  if (revision < cancelBeforeRevision) throw abortError();
  return {
    localChains: allocation.localChains,
    helperCount: allocation.helperGroupIds.length,
    helperMeshes,
  };
}

async function runGeneration(
  message: Extract<GeometryWorkerRequest, { type: 'generate' }>,
): Promise<void> {
  activeRevision = message.revision;
  try {
    const wasm = await manifoldReady;
    if (message.revision < cancelBeforeRevision) return;
    const bins = await generateGeometry(wasm, message.bins, delegateBandUnion);
    if (message.revision < cancelBeforeRevision) return;
    const response: GeometryWorkerResponse = {
      type: 'generation-complete',
      revision: message.revision,
      bins,
    };
    const transfer = bins.flatMap((bin) =>
      bin.pieces.map((piece) => piece.triangles.buffer as ArrayBuffer));
    self.postMessage(response, transfer);
  } catch (error) {
    if (message.revision < cancelBeforeRevision ||
      (error instanceof Error && error.name === 'AbortError')) return;
    const response: GeometryWorkerResponse = {
      type: 'generation-failure',
      revision: message.revision,
      error: 'Geometry generation failed.',
    };
    self.postMessage(response);
  }
}

async function runBandGroup(
  message: Extract<GeometryWorkerRequest, { type: 'run-band-group' }>,
): Promise<void> {
  try {
    const wasm = await manifoldReady;
    if (message.revision < cancelBeforeRevision) return;
    const mesh = generateBandGroupMesh(
      wasm,
      message.chains,
      message.radius,
      message.upperZ,
    );
    if (message.revision < cancelBeforeRevision) return;
    const response: GeometryWorkerResponse = {
      type: 'band-group-result',
      revision: message.revision,
      bandId: message.bandId,
      groupId: message.groupId,
      mesh,
    };
    self.postMessage(response, transferMesh(mesh));
  } catch {
    const response: GeometryWorkerResponse = {
      type: 'band-group-failure',
      revision: message.revision,
      bandId: message.bandId,
      groupId: message.groupId,
    };
    self.postMessage(response);
  }
}

function receiveAllocation(
  message: Extract<GeometryWorkerRequest, { type: 'band-allocation' }>,
): void {
  const pending = pendingBands.get(message.bandId);
  if (!pending || pending.revision !== message.revision) return;
  pending.helpers.expected = new Set(message.helperGroupIds);
  pending.allocation.resolve({
    localChains: message.localChains,
    helperGroupIds: message.helperGroupIds,
  });
  if (message.helperGroupIds.length === 0) {
    pending.helpers.resolve([]);
    pendingBands.delete(message.bandId);
  }
}

function receiveBandResult(
  message: Extract<GeometryWorkerRequest, { type: 'band-result' }>,
): void {
  const pending = pendingBands.get(message.bandId);
  if (!pending || pending.revision !== message.revision ||
    !pending.helpers.expected.has(message.groupId)) return;
  pending.helpers.expected.delete(message.groupId);
  if (!message.ok) {
    pending.helpers.reject(new Error(message.error));
    pendingBands.delete(message.bandId);
    const cancel: GeometryWorkerResponse = {
      type: 'band-group-cancel',
      revision: message.revision,
      bandId: message.bandId,
    };
    self.postMessage(cancel);
    return;
  }
  pending.helpers.meshes.push(message.mesh);
  if (pending.helpers.expected.size === 0) {
    pending.helpers.resolve(pending.helpers.meshes);
    pendingBands.delete(message.bandId);
  }
}

function cancelStale(revision: number): void {
  cancelBeforeRevision = Math.max(cancelBeforeRevision, revision);
  for (const [bandId, pending] of pendingBands) {
    if (pending.revision >= revision) continue;
    const error = abortError();
    pending.allocation.reject(error);
    pending.helpers.reject(error);
    pendingBands.delete(bandId);
    const cancel: GeometryWorkerResponse = {
      type: 'band-group-cancel',
      revision: pending.revision,
      bandId,
    };
    self.postMessage(cancel);
  }
}

self.onmessage = (event: MessageEvent<GeometryWorkerRequest>) => {
  const message = event.data;
  switch (message.type) {
    case 'generate':
      void runGeneration(message);
      break;
    case 'run-band-group':
      void runBandGroup(message);
      break;
    case 'band-allocation':
      receiveAllocation(message);
      break;
    case 'band-result':
      receiveBandResult(message);
      break;
    case 'cancel':
      cancelStale(message.revision);
      break;
  }
};

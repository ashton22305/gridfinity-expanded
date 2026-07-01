// Pure grid-edge helpers shared by the geometry layer, the UI editors, and the
// split logic. No geometry-library dependencies so the check script and tests
// can use them directly.
import type { GridCell, GridEdge } from './types';

export type EdgeKind = 'perimeter' | 'internal' | 'none';

export function cellKey(c: GridCell): string {
  return `${c.x},${c.y}`;
}

export function edgeKey(e: GridEdge): string {
  return `${e.orientation}:${e.x},${e.y}`;
}

export function cellSet(cells: GridCell[]): Set<string> {
  return new Set(cells.map(cellKey));
}

/** The two cells an edge separates (either may be outside the shape). */
function adjacentCells(e: GridEdge): [GridCell, GridCell] {
  return e.orientation === 'v'
    ? [{ x: e.x - 1, y: e.y }, { x: e.x, y: e.y }]
    : [{ x: e.x, y: e.y - 1 }, { x: e.x, y: e.y }];
}

export function classifyEdge(cells: Set<string>, e: GridEdge): EdgeKind {
  const [a, b] = adjacentCells(e);
  const hasA = cells.has(cellKey(a));
  const hasB = cells.has(cellKey(b));
  if (hasA && hasB) return 'internal';
  if (hasA || hasB) return 'perimeter';
  return 'none';
}

/** The existing cell that a perimeter edge's wall is carved into (null if not perimeter). */
export function edgeInsideCell(cells: Set<string>, e: GridEdge): GridCell | null {
  const [a, b] = adjacentCells(e);
  const hasA = cells.has(cellKey(a));
  const hasB = cells.has(cellKey(b));
  if (hasA === hasB) return null;
  return hasA ? a : b;
}

/** All four edges bounding a cell, in canonical form. */
export function cellEdges(c: GridCell): GridEdge[] {
  return [
    { orientation: 'v', x: c.x, y: c.y },      // west
    { orientation: 'v', x: c.x + 1, y: c.y },  // east
    { orientation: 'h', x: c.x, y: c.y },      // south
    { orientation: 'h', x: c.x, y: c.y + 1 },  // north
  ];
}

function edgesOfKind(cells: GridCell[], kind: EdgeKind): GridEdge[] {
  const set = cellSet(cells);
  const seen = new Set<string>();
  const out: GridEdge[] = [];
  for (const c of cells) {
    for (const e of cellEdges(c)) {
      const key = edgeKey(e);
      if (seen.has(key)) continue;
      seen.add(key);
      if (classifyEdge(set, e) === kind) out.push(e);
    }
  }
  return out;
}

export function perimeterEdges(cells: GridCell[]): GridEdge[] {
  return edgesOfKind(cells, 'perimeter');
}

export function internalEdges(cells: GridCell[]): GridEdge[] {
  return edgesOfKind(cells, 'internal');
}

export interface EffectiveWalls {
  walled: GridEdge[];    // perimeter edges that get a wall
  open: GridEdge[];      // perimeter edges left open
  dividers: GridEdge[];  // internal edges with a divider
}

/**
 * Resolves the wall layout for a piece (or the whole bin, when
 * pieceCells === wholeBinCells). Stale config entries — edges that no longer
 * border the current cells — are ignored, so the config never has to be
 * migrated when cells change.
 *
 * Piece-perimeter edges that were internal to the whole bin are seams: open by
 * default so glued pieces form one continuous cavity, but walled when the user
 * placed a divider on that edge (a divider on a split line becomes a full wall
 * on both adjacent pieces).
 */
export function effectiveWalls(
  pieceCells: GridCell[],
  wholeBinCells: GridCell[],
  openEdges: GridEdge[],
  dividerEdges: GridEdge[],
): EffectiveWalls {
  const wholeSet = cellSet(wholeBinCells);
  const openSet = new Set(openEdges.map(edgeKey));
  const dividerSet = new Set(dividerEdges.map(edgeKey));

  const walled: GridEdge[] = [];
  const open: GridEdge[] = [];
  for (const e of perimeterEdges(pieceCells)) {
    const key = edgeKey(e);
    const isSeam = classifyEdge(wholeSet, e) === 'internal';
    const hasWall = isSeam ? dividerSet.has(key) : !openSet.has(key);
    (hasWall ? walled : open).push(e);
  }

  const dividers = internalEdges(pieceCells).filter((e) => dividerSet.has(edgeKey(e)));
  return { walled, open, dividers };
}

/** Canonical sort so JSON-serialized configs compare stably. */
export function sortEdges(edges: GridEdge[]): GridEdge[] {
  return [...edges].sort((a, b) =>
    a.orientation.localeCompare(b.orientation) || a.y - b.y || a.x - b.x);
}

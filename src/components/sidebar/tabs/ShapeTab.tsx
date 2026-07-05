import { useState } from 'react';
import { Button, ColorSwatch, Group, NumberInput, Stack, Text } from '@mantine/core';
import { cellKey } from '../../../lib/edges';
import { GRID_PITCH } from '../../../lib/geometry/gridfinity';
import { getGridFootprintCells } from '../../../lib/printers';
import { groupBins } from '../../../lib/split';
import { MAX_GRID, minGridSize, useAppStore } from '../../../store';
import { binColor } from '../binColors';
import { Hint, Label } from '../../ui/Field';

/** Grid gap in px: tighter as the cell count grows so large grids stay legible. */
function cellGap(cols: number, rows: number): number {
  if (cols > 14 || rows > 14) return 1;
  return cols > 8 ? 2 : 4;
}

/** Shared width for the compact grid-size number fields. */
const GRID_SIZE_INPUT_WIDTH = 64;

export function ShapeTab() {
  const { config, updateConfig, gridCols, gridRows, setGridSize } = useAppStore();
  const cellBin = new Map(config.cells.map((c) => [cellKey(c), c.bin ?? 0]));
  const bins = groupBins(config.cells);
  const [activeBin, setActiveBin] = useState(0);

  // Track pointer-drag state so users can paint by holding the mouse.
  const [paintMode, setPaintMode] = useState<'add' | 'remove' | null>(null);

  // Bin ids offered for painting: every used id plus one fresh one.
  const usedIds = bins.map((b) => b.id);
  const nextId = usedIds.length ? Math.max(...usedIds) + 1 : 0;
  const paletteIds = [...new Set([...usedIds, Math.min(nextId, 7)])].sort((a, b) => a - b);

  function assignCell(x: number, y: number) {
    const key = cellKey({ x, y });
    if (cellBin.get(key) === activeBin) return;
    updateConfig({
      cells: [...config.cells.filter((c) => cellKey(c) !== key), { x, y, bin: activeBin }],
    });
  }

  function removeCell(x: number, y: number) {
    const key = cellKey({ x, y });
    if (!cellBin.has(key)) return;
    updateConfig({ cells: config.cells.filter((c) => cellKey(c) !== key) });
  }

  function handlePointerDown(x: number, y: number) {
    if (cellBin.get(cellKey({ x, y })) === activeBin) {
      setPaintMode('remove');
      removeCell(x, y);
    } else {
      setPaintMode('add');
      assignCell(x, y);
    }
  }

  function handlePointerEnter(x: number, y: number) {
    if (paintMode === 'add') assignCell(x, y);
    if (paintMode === 'remove') removeCell(x, y);
  }

  // Delegated cell events: one pair of handlers on the grid container reads the
  // painted cell from data-attrs, so the up-to-1600 cell buttons carry no
  // per-cell closures (rebuilt on every paint-drag render otherwise).
  function cellFromEvent(e: React.PointerEvent): { x: number; y: number } | null {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    return el ? { x: Number(el.dataset.x), y: Number(el.dataset.y) } : null;
  }

  const cells = config.cells;
  const { widthCells, depthCells } = getGridFootprintCells(cells);
  const min = minGridSize(cells);  // setGridSize clamps; this only feeds the input min attrs

  return (
    <Stack
      className="no-select"
      gap="sm"
      onPointerUp={() => setPaintMode(null)}
      onPointerLeave={() => setPaintMode(null)}
    >
      <Group gap="xs">
        <Label>Grid</Label>
        <NumberInput
          w={GRID_SIZE_INPUT_WIDTH}
          hideControls
          min={min.cols}
          max={MAX_GRID}
          value={gridCols}
          onChange={(v) => setGridSize(Number(v), gridRows)}
          aria-label="Grid columns"
        />
        <Text span>×</Text>
        <NumberInput
          w={GRID_SIZE_INPUT_WIDTH}
          hideControls
          min={min.rows}
          max={MAX_GRID}
          value={gridRows}
          onChange={(v) => setGridSize(gridCols, Number(v))}
          aria-label="Grid rows"
        />
        <Text span>cells</Text>
      </Group>

      <Group gap="xs">
        {paletteIds.map((id) => {
          const active = activeBin === id;
          return (
            <Button
              key={id}
              size="xs"
              variant="default"
              onClick={() => setActiveBin(id)}
              style={active ? { borderColor: binColor(id) } : undefined}
              leftSection={<ColorSwatch color={binColor(id)} size={10} withShadow={false} />}
              title={usedIds.includes(id) ? `Paint bin ${id + 1}` : 'Start a new bin'}
            >
              {usedIds.includes(id) ? `Bin ${id + 1}` : '+ New'}
            </Button>
          );
        })}
      </Group>

      <Hint>
        Click or drag to toggle cells for the selected bin. Adjacent bins are
        printed as separate, complete bins.
      </Hint>
      <div
        className="cell-grid"
        style={{
          gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
          aspectRatio: `${gridCols} / ${gridRows}`,
          gap: cellGap(gridCols, gridRows),
        }}
        onPointerDown={(e) => { const c = cellFromEvent(e); if (c) handlePointerDown(c.x, c.y); }}
        onPointerOver={(e) => { if (paintMode) { const c = cellFromEvent(e); if (c) handlePointerEnter(c.x, c.y); } }}
      >
        {Array.from({ length: gridRows }, (_, row) =>
          Array.from({ length: gridCols }, (_, col) => {
            const bin = cellBin.get(cellKey({ x: col, y: row }));
            const isSelected = bin !== undefined;
            return (
              <button
                key={`${col}-${row}`}
                data-cell data-x={col} data-y={row}
                className={isSelected ? 'cell is-on' : 'cell'}
                style={isSelected ? { background: binColor(bin), borderColor: binColor(bin) } : undefined}
                aria-label={`Cell ${col},${row}`}
                aria-pressed={isSelected}
              />
            );
          })
        )}
      </div>
      <Stack gap={2}>
        <Text>
          {cells.length} cell{cells.length !== 1 ? 's' : ''}
          {bins.length > 1 ? ` in ${bins.length} bins` : ''}
        </Text>
        {cells.length > 0 && (
          <Text>
            {widthCells * GRID_PITCH} × {depthCells * GRID_PITCH} mm footprint
          </Text>
        )}
      </Stack>
    </Stack>
  );
}

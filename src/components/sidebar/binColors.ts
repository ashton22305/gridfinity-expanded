// Palette for logical bins in the editors (bin id → color, cycles past 8).
export const BIN_COLORS = [
  '#2563eb', '#16a34a', '#d97706', '#dc2626',
  '#9333ea', '#0d9488', '#db2777', '#65a30d',
];

export function binColor(bin: number | undefined): string {
  return BIN_COLORS[(bin ?? 0) % BIN_COLORS.length];
}

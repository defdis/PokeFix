/**
 * JS masonry packing for the Masonry preview layout.
 *
 * The previous implementation used CSS multi-column with a fixed
 * `column-width: 275px`. Wide (scaled) devices simply overflowed their
 * column and were clipped at the window edge, which made the whole layout
 * look broken. This packer assigns devices to the shortest column and
 * verifies the packed width against the available width, so it degrades to
 * fewer columns instead of overflowing.
 *
 * Pure function — unit-tested in masonry.test.ts.
 */

export interface MasonryItem {
  id: string;
  /** Scaled outer width of the item (including any side padding). */
  width: number;
  /** Scaled outer height of the item (frame + label + toolbar + paddings). */
  height: number;
}

export interface MasonryPlacement {
  left: number;
  top: number;
}

export interface MasonryLayout {
  /** Absolute position per device id. */
  placements: Map<string, MasonryPlacement>;
  /** Total packed width (sum of column widths + gaps). */
  width: number;
  /** Total packed height (tallest column). */
  height: number;
  /** Column count actually used. */
  columns: number;
}

interface PackedColumn {
  items: MasonryItem[];
  width: number;
  height: number;
}

const pack = (items: MasonryItem[], columnCount: number, gap: number): PackedColumn[] => {
  const columns: PackedColumn[] = Array.from({length: columnCount}, () => ({
    items: [],
    width: 0,
    height: 0,
  }));
  for (const item of items) {
    // Shortest column wins (ties: leftmost) — classic masonry.
    let target = columns[0];
    for (const column of columns) {
      if (column.height < target.height) {
        target = column;
      }
    }
    target.items.push(item);
    target.width = Math.max(target.width, item.width);
    target.height += item.height + (target.items.length > 1 ? gap : 0);
  }
  return columns;
};

export const packMasonry = (
  items: MasonryItem[],
  containerWidth: number,
  gap: number
): MasonryLayout => {
  if (items.length === 0) {
    return {placements: new Map(), width: 0, height: 0, columns: 0};
  }
  const available = Math.max(1, containerWidth);
  let best: PackedColumn[] | null = null;
  // Prefer the most columns that still fit the available width.
  for (let k = 1; k <= items.length; k += 1) {
    const columns = pack(items, k, gap);
    const totalWidth = columns.reduce((sum, col) => sum + col.width, 0) + gap * (k - 1);
    if (totalWidth <= available) {
      best = columns;
    }
  }
  // Nothing fits (a single device is wider than the viewport) — fall back
  // to one column and let the container scroll horizontally.
  if (best === null) {
    best = pack(items, 1, gap);
  }

  const placements = new Map<string, MasonryPlacement>();
  let x = 0;
  let totalHeight = 0;
  for (const column of best) {
    let y = 0;
    for (const item of column.items) {
      placements.set(item.id, {
        left: x + Math.round((column.width - item.width) / 2),
        top: y,
      });
      y += item.height + gap;
    }
    totalHeight = Math.max(totalHeight, y - gap);
    x += column.width + gap;
  }

  return {
    placements,
    width: x - gap,
    height: Math.max(0, totalHeight),
    columns: best.length,
  };
};

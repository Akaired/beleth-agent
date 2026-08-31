/**
 * Forum category palette. Instead of a fixed list of swatches, the palette is
 * built from four anchor hues and grows on demand: every extra swatch is the
 * midpoint between two adjacent colours, added only as the number of categories
 * increases. So the editor shows 4 colours by default and fills in the
 * in-between shades one bisection at a time (4 → 7 → 13 → 25 …), and the
 * colours that were already there never shift.
 *
 * Pure and client-safe.
 */

/** The four anchor hues, in the Beleth accent family. */
export const FORUM_PALETTE_ANCHORS = [
  "#d9a03c", // gold
  "#35a67c", // green
  "#5b8fb0", // blue
  "#c2544d", // red
] as const;

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: RGB): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend of two hex colours; `t` is 0 (a) … 1 (b). */
export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  ]);
}

/**
 * At least `count` swatches, evenly spread along the anchor ramp. Starts from
 * the four anchors and bisects every adjacent pair until there are enough, so
 * the result size steps 4 → 7 → 13 → 25 … and earlier swatches keep their
 * position and value.
 */
export function forumPalette(count: number): string[] {
  const target = Math.max(count, FORUM_PALETTE_ANCHORS.length);
  let stops: string[] = [...FORUM_PALETTE_ANCHORS];
  while (stops.length < target) {
    const next: string[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      next.push(stops[i], mixHex(stops[i], stops[i + 1], 0.5));
    }
    next.push(stops[stops.length - 1]);
    stops = next;
  }
  return stops;
}

/**
 * A stable colour for the category at ordinal `index` of `total`, picked so the
 * whole set is spread across the ramp rather than clustered at one end. Used to
 * seed a new category's colour.
 */
export function forumCategoryColor(index: number, total: number): string {
  const palette = forumPalette(total);
  if (total <= 1) return palette[0];
  const pos = Math.round((index / (total - 1)) * (palette.length - 1));
  return palette[Math.min(Math.max(pos, 0), palette.length - 1)];
}

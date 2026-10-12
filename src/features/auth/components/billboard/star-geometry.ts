/**
 * Geometry of the LevelUp star (public/icon.svg, 512 × 512 user units).
 * Ten facets meet at one centre point: each facet is (centre, outer tip,
 * inner notch) or (centre, inner notch, outer tip). Shared by the particle
 * star canvas and the page transition so they all draw the same mark.
 */
export const STAR_CENTER = { x: 256, y: 278 } as const;

/** Outline clockwise from the top tip, alternating tip / inner notch. */
export const STAR_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [256, 38],
  [310, 192],
  [484, 204],
  [344, 280],
  [397, 470],
  [256, 362],
  [115, 470],
  [168, 280],
  [28, 204],
  [202, 192]
];

/** Facet colours of icon.svg (gradient start), clockwise from the top-left facet. */
export const STAR_FACET_COLORS = [
  '#C8B3FE',
  '#843FF4',
  '#7327EB',
  '#5111CA',
  '#430BA8',
  '#5211C8',
  '#691CDD',
  '#7C2CF0',
  '#9754FD',
  '#B583FF'
] as const;

/** Bounding box of the outline, used to centre the mark. */
export const STAR_BOUNDS = {
  minX: 28,
  maxX: 484,
  minY: 38,
  maxY: 470
} as const;

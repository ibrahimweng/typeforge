/**
 * The document model.
 *
 * Outlines are stored as cubic beziers with in/out handles per node, the same
 * shape Glyphs and Illustrator use. It is the representation a pen tool wants,
 * and it maps cleanly to both export formats: CFF/OTF is cubic already, and
 * TrueType quadratics convert up to cubic exactly on import and back down by
 * approximation on export (see `quadratic.ts`).
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * How a node's two handles relate to each other.
 * - `corner`: handles move independently, the outline may kink here.
 * - `smooth`: handles stay collinear, so the curve passes through without a kink.
 * - `tangent`: one side is a straight line, the other curves away from it smoothly.
 */
export type NodeType = "corner" | "smooth" | "tangent";

export interface GlyphNode {
  /** The on-curve point the outline actually passes through. */
  point: Vec2;
  /** Control point governing the segment arriving at this node, in absolute units. */
  handleIn: Vec2 | null;
  /** Control point governing the segment leaving this node, in absolute units. */
  handleOut: Vec2 | null;
  type: NodeType;
}

export interface Contour {
  nodes: GlyphNode[];
  closed: boolean;
}

/**
 * A component is a reference to another glyph, the mechanism that lets `á`
 * reuse the outlines of `a` and `acute`. TrueType calls these composite glyphs.
 */
export interface Component {
  /** Name of the glyph being referenced. */
  glyphName: string;
  /** 2x2 transform followed by a translation, applied to the referenced outline. */
  transform: { a: number; b: number; c: number; d: number; dx: number; dy: number };
}

export interface Glyph {
  /** Stable identity across edits. Glyph *index* is derived at export time. */
  name: string;
  /** Codepoints that map to this glyph. Empty for unencoded glyphs. */
  unicodes: number[];
  advanceWidth: number;
  contours: Contour[];
  components: Component[];
  /** Per-glyph overrides layered on top of the family parameters. */
  params: Partial<GlyphParams>;
  /** Set when the user has touched this glyph, used for "changed only" export. */
  dirty: boolean;
}

/**
 * Parameters that reshape outlines. The same set applies family-wide and
 * per-glyph; a glyph's own value wins where it sets one.
 *
 * These are stored, not baked. Outlines on disk stay pristine and the stack is
 * re-evaluated on every render, so any value stays adjustable forever.
 */
export interface GlyphParams {
  /** Corner rounding in font units. Rounds sharp corners of the outline. */
  cornerRadius: number;
  /** Outline emboldening in font units. Positive is bolder, negative lighter. */
  weight: number;
  /** Horizontal scale about the glyph origin, as a multiplier. */
  width: number;
  /** Italic slant in degrees, sheared about the baseline. */
  slant: number;
  /** Vertical scale applied to everything above the baseline. */
  xHeightScale: number;
  /**
   * "Middle space": pushes counters (the enclosed white space inside letters
   * like o, e, a) open or closed by moving inner contours against outer ones.
   */
  counterScale: number;
  /** Extra space added to both sidebearings, in font units. */
  tracking: number;
}

export const DEFAULT_PARAMS: GlyphParams = {
  cornerRadius: 0,
  weight: 0,
  width: 1,
  slant: 0,
  xHeightScale: 1,
  counterScale: 1,
  tracking: 0,
};

export interface VerticalMetrics {
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
  lineGap: number;
}

export interface FontMeta {
  familyName: string;
  styleName: string;
  version: string;
  designer: string;
  manufacturer: string;
  copyright: string;
  license: string;
}

/** A kerning adjustment between two glyphs, in font units. Negative pulls together. */
export interface KernPair {
  left: string;
  right: string;
  value: number;
}

/**
 * Class kerning: every glyph in `left` kerns against every glyph in `right` by
 * the same value. This is how real fonts avoid storing tens of thousands of
 * individual pairs, and it is what GPOS PairPos format 2 encodes.
 */
export interface KernClass {
  id: string;
  name: string;
  left: string[];
  right: string[];
  value: number;
}

/**
 * The bytes and table layout of the imported file, kept so "preserve" export
 * can hand back tables we never touched (ligatures, hinting, colour, variations)
 * exactly as they arrived.
 */
export interface SourceFont {
  bytes: Uint8Array;
  sfntVersion: number;
  /** Raw table data keyed by 4-character tag. */
  tables: Map<string, Uint8Array>;
  /** True when outlines came from a CFF table rather than glyf. */
  isCFF: boolean;
  fileName: string;
}

export interface Typeface {
  meta: FontMeta;
  unitsPerEm: number;
  metrics: VerticalMetrics;
  glyphs: Glyph[];
  /** Glyph name to index in `glyphs`, kept in sync by the store. */
  glyphIndex: Map<string, number>;
  kerning: KernPair[];
  kernClasses: KernClass[];
  params: GlyphParams;
  source: SourceFont | null;
}

export function emptyTypeface(): Typeface {
  return {
    meta: {
      familyName: "Untitled",
      styleName: "Regular",
      version: "1.000",
      designer: "",
      manufacturer: "",
      copyright: "",
      license: "",
    },
    unitsPerEm: 1000,
    metrics: { ascender: 800, descender: -200, capHeight: 700, xHeight: 500, lineGap: 0 },
    glyphs: [],
    glyphIndex: new Map(),
    kerning: [],
    kernClasses: [],
    params: { ...DEFAULT_PARAMS },
    source: null,
  };
}

/**
 * The document model.
 *
 * Outlines are stored as cubic beziers with in/out handles per node, the same
 * shape Glyphs and Illustrator use. It is the representation a pen tool wants,
 * and it maps cleanly to both export formats: CFF/OTF is cubic already, and
 * TrueType quadratics convert up to cubic exactly on import and back down by
 * approximation on export (see `quadratic.ts`).
 */

import type { Cast } from "./cast";
import type { Cuts } from "./cuts";

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
 * A named attachment point.
 *
 * A base letter carries an anchor such as `top`; a mark carries the matching
 * entry anchor `_top`. Lining the two up is what positions an accent, and it is
 * why moving the anchor on `a` moves the accent on every glyph built from it.
 */
export interface Anchor {
  /** `top`, `bottom`, `center` on a base; the same name with a leading underscore on a mark. */
  name: string;
  x: number;
  y: number;
}

/** True for the entry anchor on a mark, as opposed to an exit anchor on a base. */
export const isMarkAnchor = (name: string): boolean => name.startsWith("_");

/** The base-side name a mark anchor attaches to, or null if it is not a mark anchor. */
export const baseAnchorName = (name: string): string | null =>
  name.startsWith("_") ? name.slice(1) : null;

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
  /** Named attachment points, used to position marks on this glyph. */
  anchors: Anchor[];
  /** Per-glyph overrides layered on top of the family parameters. */
  params: Partial<GlyphParams>;
  /**
   * This glyph's own cuts, standing in for the font's rather than adding to
   * them.
   *
   * An exception rather than an override, which is the difference between a
   * cut and every parameter above it. Parameters are numbers and layering one
   * over another means something; cuts are a set of switched-on operations,
   * and half a font's cuts plus half a letter's own is not a description
   * anybody wrote. So a letter either goes along with the font or is cut its
   * own way, and the panel says which.
   */
  cuts?: Cuts;
  /** This glyph's own cast, standing in for the font's on the same terms. */
  cast?: Cast;
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
  /**
   * Cells across the em square when quantising the letter to a pixel grid.
   * Zero leaves the outline alone.
   */
  pixelGrid: number;
  /**
   * How far a slab serif reaches past each stroke end, in font units. Zero
   * leaves the stroke ends bare.
   */
  slab: number;
  /**
   * Raises or lowers the horizontal stroke crossing the middle of a letter --
   * the bar of an H or A, the middle arm of an E, the eye of an e -- in font
   * units.
   */
  crossbar: number;
  /**
   * Raises or lowers where an arch springs from its stem, in font units.
   * Raising it squares the shoulder; lowering it opens the letter out.
   */
  shoulder: number;
}

export const DEFAULT_PARAMS: GlyphParams = {
  cornerRadius: 0,
  weight: 0,
  width: 1,
  slant: 0,
  xHeightScale: 1,
  counterScale: 1,
  tracking: 0,
  pixelGrid: 0,
  slab: 0,
  crossbar: 0,
  shoulder: 0,
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
  /**
   * How heavy this font is, from 100 to 900, as every font file says.
   *
   * It used to be worked out from the style name -- seven hundred if the word
   * "bold" appeared in it, four hundred otherwise -- which is fine for a font
   * that comes on its own and useless for a family. A Light and a Black and a
   * Medium all read as four hundred, so a word processor offered nine faces
   * with nothing to sort them by and picked whichever it saw first for bold.
   */
  weightClass: number;
}

/** A kerning adjustment between two glyphs, in font units. Negative pulls together. */
export interface KernPair {
  left: string;
  right: string;
  value: number;
  /**
   * Which lookup this belongs to, for pairs read out of a font.
   *
   * The same grouping the classes carry, and needed for the same reason. A
   * pair written in one lookup and a class covering it in another are two
   * adjustments that add up; move the pair into the other lookup and it
   * overrides the class instead, which is a different font. Absent on pairs
   * made here, which all go in one lookup together.
   */
  group?: number;
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
  /**
   * Which lookup this belongs to, for classes read out of a font.
   *
   * A font's kerning is several lookups and every one of them is applied, so
   * two classes that disagree about the same pair are not a contradiction --
   * they are two adjustments that add up. Two classes in the *same* lookup
   * that disagree are a contradiction, because only the first is ever
   * consulted. Keeping the grouping is what lets an imported font be written
   * back out meaning what it meant.
   *
   * Absent on classes made here, which all go in one lookup together.
   */
  group?: number;
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
  /** How the whole font is cut. Undefined is the same as nothing switched on. */
  cuts?: Cuts;
  /** What is put on the whole font, on the same terms. */
  cast?: Cast;
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
      weightClass: 400,
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

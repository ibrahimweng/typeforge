/**
 * Type declarations for opentype.js, which ships none.
 *
 * Only the surface Typeforge actually calls is declared here, so this stays
 * small and honest rather than pretending to describe the whole library.
 */
declare module "opentype.js" {
  export interface PathCommand {
    type: "M" | "L" | "C" | "Q" | "Z";
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface Path {
    commands: PathCommand[];
  }

  export interface Glyph {
    index: number;
    name: string | null;
    unicode?: number;
    unicodes: number[];
    advanceWidth?: number;
    leftSideBearing?: number;
    path: Path;
    getPath(x?: number, y?: number, fontSize?: number): Path;
  }

  export interface GlyphSet {
    length: number;
    get(index: number): Glyph;
  }

  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    numGlyphs: number;
    glyphs: GlyphSet;
    outlinesFormat: "truetype" | "cff";
    /** Keyed `"leftGlyphId,rightGlyphId"`, populated from `kern` and from GPOS. */
    kerningPairs: Record<string, number>;
    tables: Record<string, unknown> & {
      os2?: Record<string, number>;
      head?: Record<string, number>;
      hhea?: Record<string, number>;
      name?: Record<string, Record<string, string>>;
    };
    names: Record<string, Record<string, string>>;
    charToGlyph(char: string): Glyph;
    charToGlyphIndex(char: string): number;
    getKerningValue(left: Glyph, right: Glyph): number;
  }

  export function parse(buffer: ArrayBuffer, options?: Record<string, unknown>): Font;

  /** Path builder used when constructing glyphs for export. */
  export class Path {
    commands: PathCommand[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    quadTo(x1: number, y1: number, x: number, y: number): void;
    close(): void;
  }

  export class Glyph {
    constructor(options: {
      name?: string;
      unicode?: number;
      unicodes?: number[];
      advanceWidth?: number;
      leftSideBearing?: number;
      path: Path;
    });
    name: string | null;
    unicode?: number;
    unicodes: number[];
    advanceWidth?: number;
    path: Path;
  }

  /**
   * Constructing a Font and calling `toArrayBuffer` is how OTF export happens:
   * opentype.js owns the CFF charstring encoding, which is intricate enough to
   * be worth delegating. Kerning is injected into the result afterwards,
   * because this writer does not emit any.
   */
  export class Font {
    constructor(options: {
      familyName: string;
      styleName: string;
      unitsPerEm: number;
      ascender: number;
      descender: number;
      glyphs: Glyph[];
      designer?: string;
      manufacturer?: string;
      copyright?: string;
      license?: string;
      version?: string;
    });
    toArrayBuffer(): ArrayBuffer;
  }
}

import { noCuts, NO_CUTS, sameCut, type CutName, type Cuts } from "@/font/cuts";
import { noCast, NO_CAST, sameCast, type Cast, type CastName } from "@/font/cast";
import type { GlyphParams } from "@/font/types";
import { PenStore } from "./store-pen";

export abstract class ParameterStore extends PenStore {
  setFamilyParam<K extends keyof GlyphParams>(key: K, value: GlyphParams[K]): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    typeface.params = { ...typeface.params, [key]: value };
    this.touch();
  }

  /** Record one history entry for a finished family-parameter gesture. */
  commitFamilyParams(label: string, before: GlyphParams): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const after = { ...typeface.params };
    this.push({
      label,
      undo: () => {
        typeface.params = { ...before };
      },
      redo: () => {
        typeface.params = { ...after };
      },
    });
    this.touch();
  }

  setGlyphParam<K extends keyof GlyphParams>(name: string, key: K, value: GlyphParams[K]): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    glyph.params = { ...glyph.params, [key]: value };
    /*
     * Touched, and it has to say so.
     *
     * An override is a change to the letter as surely as dragging a point is,
     * and two things downstream ask this rather than looking at the outline. A
     * "preserve" export writes the original bytes for any glyph that has not
     * been touched, which meant an override was quietly dropped from the file
     * -- the one place it would never be noticed, since the letter is right on
     * screen the whole time. The grid's own "changed" mark reads it too.
     */
    glyph.dirty = true;
    this.touch();
  }

  /** Drop a glyph's override so it follows the family value again. */
  clearGlyphParam(name: string, key: keyof GlyphParams): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    const next = { ...glyph.params };
    delete next[key];
    const before = glyph.params;
    glyph.params = next;
    // Still touched: going back to the family's value is a decision too, and
    // the glyph has to be rebuilt to show it.
    glyph.dirty = true;
    this.push({
      label: `Reset ${key}`,
      undo: () => {
        typeface.glyphs[index].params = before;
      },
      redo: () => {
        typeface.glyphs[index].params = next;
      },
    });
    this.touch();
  }

  // -------------------------------------------------------------------------
  // Cutting
  // -------------------------------------------------------------------------

  /*
   * Cuts are not parameters, and they are kept apart on purpose.
   *
   * A parameter is a number and a glyph's own value layers over the family's.
   * A cut is a set of switched-on operations, and half the font's cuts merged
   * with half a letter's own is not a description anybody wrote -- so a letter
   * either goes along with the font or is cut its own way, and these say which.
   */

  /** Change one operation of the font's cuts. */
  changeCut(name: CutName, patch: Partial<Cuts[CutName]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const cuts = typeface.cuts ?? noCuts();
    typeface.cuts = { ...cuts, [name]: { ...cuts[name], ...patch } } as Cuts;
    this.touch();
  }

  /** Record one history entry for a finished cut gesture. */
  commitCuts(label: string, before: Cuts | undefined): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const after = typeface.cuts;
    this.push({
      label,
      undo: () => {
        typeface.cuts = before;
      },
      redo: () => {
        typeface.cuts = after;
      },
    });
    this.touch();
  }

  /** Change one operation of a letter's own cuts, taking it out of the font's. */
  changeGlyphCut(name: string, cut: CutName, patch: Partial<Cuts[CutName]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    // Starting from the font's, so the first change to one operation keeps the
    // rest of what the letter was already showing rather than clearing it.
    const cuts = glyph.cuts ?? typeface.cuts ?? noCuts();
    glyph.cuts = { ...cuts, [cut]: { ...cuts[cut], ...patch } } as Cuts;
    // Touched, for the same reasons an override is: a "preserve" export writes
    // the original bytes for any glyph nobody has touched.
    glyph.dirty = true;
    this.touch();
  }

  /** Put a letter back to being cut like the rest of the font. */
  cutLikeTheRest(name: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    if (!glyph.cuts) return;
    const before = glyph.cuts;
    glyph.cuts = undefined;
    glyph.dirty = true;
    this.push({
      label: `Cut ${name} like the rest`,
      undo: () => {
        typeface.glyphs[index].cuts = before;
      },
      redo: () => {
        typeface.glyphs[index].cuts = undefined;
      },
    });
    this.touch();
  }

  /* The same set again for the cast, on the same terms throughout. */

  changeCast(name: CastName, patch: Partial<Cast[CastName]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const cast = typeface.cast ?? noCast();
    typeface.cast = { ...cast, [name]: { ...cast[name], ...patch } } as Cast;
    this.touch();
  }

  commitCast(label: string, before: Cast | undefined): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const after = typeface.cast;
    this.push({
      label,
      undo: () => {
        typeface.cast = before;
      },
      redo: () => {
        typeface.cast = after;
      },
    });
    this.touch();
  }

  changeGlyphCast(name: string, operation: CastName, patch: Partial<Cast[CastName]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    const cast = glyph.cast ?? typeface.cast ?? noCast();
    glyph.cast = { ...cast, [operation]: { ...cast[operation], ...patch } } as Cast;
    glyph.dirty = true;
    this.touch();
  }

  castLikeTheRest(name: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    if (!glyph.cast) return;
    const before = glyph.cast;
    glyph.cast = undefined;
    glyph.dirty = true;
    this.push({
      label: `Cast ${name} like the rest`,
      undo: () => {
        typeface.glyphs[index].cast = before;
      },
      redo: () => {
        typeface.glyphs[index].cast = undefined;
      },
    });
    this.touch();
  }

  castFor(name: string): Cast {
    const typeface = this.state.typeface;
    if (!typeface) return noCast();
    const index = typeface.glyphIndex.get(name);
    const own = index === undefined ? undefined : typeface.glyphs[index].cast;
    return own ?? typeface.cast ?? noCast();
  }

  castHeldBy(name: string, operation: CastName): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const index = typeface.glyphIndex.get(name);
    const own = index === undefined ? undefined : typeface.glyphs[index].cast;
    if (!own) return false;
    return !sameCast(own[operation], (typeface.cast ?? NO_CAST)[operation]);
  }

  /** Which way round the two layers go. A decision about the font, never a letter. */
  changeCastOrder(order: Cast["order"]): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = typeface.cast;
    typeface.cast = { ...(typeface.cast ?? noCast()), order };
    this.commitCast("Which shaping goes first", before);
  }

  /** How a letter is cut, whether that is its own way or the font's. */
  cutsFor(name: string): Cuts {
    const typeface = this.state.typeface;
    if (!typeface) return noCuts();
    const index = typeface.glyphIndex.get(name);
    const glyph = index === undefined ? undefined : typeface.glyphs[index];
    return glyph?.cuts ?? typeface.cuts ?? noCuts();
  }

  /** Whether this letter is cut its own way rather than the font's. */
  isCutException(name: string): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const index = typeface.glyphIndex.get(name);
    return index !== undefined && typeface.glyphs[index].cuts !== undefined;
  }

  /** Whether this letter's own cuts say something different about one operation. */
  cutHeldBy(name: string, cut: CutName): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const index = typeface.glyphIndex.get(name);
    const own = index === undefined ? undefined : typeface.glyphs[index].cuts;
    if (!own) return false;
    return !sameCut(own[cut], (typeface.cuts ?? NO_CUTS)[cut]);
  }
}

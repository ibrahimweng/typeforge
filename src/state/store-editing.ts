/**
 * Making an edit, and putting it in history.
 *
 * `editGlyph` is what every other kind of edit in the store goes through. It
 * clones the glyph before and after, hands the middle to the caller, and
 * records the pair as one undo step. `commitGlyphEdit` is the same story for a
 * drag, which cannot record anything until it ends.
 *
 * The control letters live here too, because a change to one is pushed out to
 * the letters that follow it as part of the same edit.
 */

import { deriveParams, isControlGlyph, readControls, type ControlChange } from "@/font/control";
import { buildLinks, pointsThatMoved, propagateMoves } from "@/font/link";
import { cloneGlyph } from "@/font/types";
import { effectiveParams } from "@/font/transform";
import { DEFAULT_PARAMS, type Glyph, type GlyphParams } from "@/font/types";
import { NavigationStore } from "./store-navigation";

/**
 * The two edits that may touch an expanded letter's outlines and still leave
 * the way back to its strokes.
 *
 * Everything else that changes those contours is a person editing the ink,
 * which is the point of expanding, and which means the strokes no longer
 * describe the letter. These two are the expand and un-expand themselves.
 */
const KEEPS_STROKES = new Set(["Take the ink", "Back to strokes"]);

export abstract class EditingStore extends NavigationStore {
  /**
   * Apply an edit to one glyph, recording enough to undo it.
   *
   * The glyph is cloned before and after, so history holds two copies of one
   * glyph rather than of the whole font.
   */
  editGlyph(name: string, label: string, mutate: (glyph: Glyph) => void): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;

    const before = cloneGlyph(typeface.glyphs[index]);
    mutate(typeface.glyphs[index]);
    /*
     * An expanded letter whose outlines were edited by hand is no longer a way
     * back to its strokes, and this is where that is noticed.
     *
     * Un-expand re-sweeps, so it would throw away whatever was done to the
     * outlines. Every other tool with an Expand tells its users to save a copy
     * first and leaves them with undo; the honest answer is to keep the way
     * back exactly as long as it is true, and to say so on the button. So the
     * strokes go the moment the outlines are touched by anything other than the
     * sweep -- which is every edit through here, since the sweep writes through
     * `reswept` and not through a labelled edit.
     */
    const edited = typeface.glyphs[index];
    if (edited.written?.expanded && !KEEPS_STROKES.has(label)) {
      /*
       * Both sides cloned before they are compared, and that is the whole of
       * this line's history.
       *
       * `cloneGlyph` rebuilds a contour with its own order of keys -- `closed`
       * before `nodes`, where the sweep writes `nodes` first -- and
       * `JSON.stringify` is order-sensitive. Compared straight against the
       * live glyph the two strings never matched, so this read as changed
       * every single time: turning a pen, moving a stroke point, an edit that
       * touched no outline at all, each one threw away an expanded letter's
       * strokes. The button still offered to put them back.
       *
       * The same trap is written up over `whole` in `forge/document.ts`, where
       * it decides whether a drawing is worth keeping. Two `JSON.stringify`
       * results are only comparable when both sides were built the same way.
       */
      const outlines = (one: Glyph): string => JSON.stringify(cloneGlyph(one).contours);
      if (outlines(edited) !== JSON.stringify(before.contours)) edited.written = undefined;
    }
    typeface.glyphs[index].dirty = true;
    const after = cloneGlyph(typeface.glyphs[index]);

    this.push({
      label,
      undo: () => {
        typeface.glyphs[index] = cloneGlyph(before);
      },
      redo: () => {
        typeface.glyphs[index] = cloneGlyph(after);
      },
    });
    this.touch();
  }

  /**
   * Edit without recording history, for the continuous part of a drag. The
   * caller records one entry when the gesture finishes.
   */
  editGlyphLive(name: string, mutate: (glyph: Glyph) => void): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    mutate(typeface.glyphs[index]);
    typeface.glyphs[index].dirty = true;
    this.touch();
  }

  /** Record a completed gesture whose before-state the caller captured. */
  commitGlyphEdit(name: string, label: string, before: Glyph): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return;
    const after = cloneGlyph(typeface.glyphs[index]);

    /*
     * A control letter moves the rest of the font two ways, and they must not
     * both charge for the same edit.
     *
     * Letters that are built on this one -- h is n with a taller stem, sharing
     * fourteen of its sixteen points -- follow the shape exactly, point for
     * point. Those are then held at neutral parameters, because they have
     * already taken the edit in full and the parametric version of the same
     * change would land on them a second time.
     *
     * Everything else follows the measured qualities instead, which is the
     * honest description of a letter that was drawn separately.
     */
    const followers = new Set(this.followersOf(name));
    const shapeBefore = new Map(
      [...followers].map((follower) => {
        const at = typeface.glyphIndex.get(follower);
        return [follower, at === undefined ? null : cloneGlyph(typeface.glyphs[at])] as const;
      }),
    );

    const links = this.controlLinks.get(name);
    const moved = links ? propagateMoves(typeface, links, pointsThatMoved(before, after)) : [];

    const shapeAfter = new Map(
      [...followers].map((follower) => {
        const at = typeface.glyphIndex.get(follower);
        return [follower, at === undefined ? null : cloneGlyph(typeface.glyphs[at])] as const;
      }),
    );

    const paramsBefore = { ...typeface.params };
    const pinned = [...(this.controlBaseline?.keys() ?? []), ...moved];
    const controlsBefore = new Map(
      pinned.map((pinnedName) => {
        const at = typeface.glyphIndex.get(pinnedName);
        return [pinnedName, at === undefined ? {} : { ...typeface.glyphs[at].params }] as const;
      }),
    );
    const changes = isControlGlyph(name) ? this.propagateFromControls() : [];
    for (const follower of moved) {
      const at = typeface.glyphIndex.get(follower);
      if (at !== undefined) typeface.glyphs[at].params = { ...DEFAULT_PARAMS };
    }
    const paramsAfter = { ...typeface.params };
    const controlsAfter = new Map(
      [...controlsBefore.keys()].map((controlName) => {
        const at = typeface.glyphIndex.get(controlName);
        return [controlName, at === undefined ? {} : { ...typeface.glyphs[at].params }] as const;
      }),
    );

    const restore = (
      params: GlyphParams,
      controls: ReadonlyMap<string, Partial<GlyphParams>>,
      shapes: ReadonlyMap<string, Glyph | null>,
    ): void => {
      typeface.params = { ...params };
      for (const [controlName, controlParams] of controls) {
        const at = typeface.glyphIndex.get(controlName);
        if (at !== undefined) typeface.glyphs[at].params = { ...controlParams };
      }
      for (const [follower, shape] of shapes) {
        const at = typeface.glyphIndex.get(follower);
        if (at !== undefined && shape) typeface.glyphs[at] = cloneGlyph(shape);
      }
    };

    this.push({
      label,
      undo: () => {
        typeface.glyphs[index] = cloneGlyph(before);
        restore(paramsBefore, controlsBefore, shapeBefore);
      },
      redo: () => {
        typeface.glyphs[index] = cloneGlyph(after);
        restore(paramsAfter, controlsAfter, shapeAfter);
      },
    });
    this.set({ lastDerivation: changes });
    this.touch();
  }

  /**
   * Push what changed on a control letter out to the rest of the font.
   *
   * The letter that was edited is pinned to neutral parameters afterwards.
   * Without that it is hit twice -- once by the points the designer moved, and
   * again by the family weight those very points produced -- so thickening n by
   * 30 units would leave n 30 units ahead of the alphabet it is supposed to be
   * setting the standard for.
   */

  /**
   * Record the control letters as they stand, as the thing later edits are
   * measured against. Called when a font is opened, and whenever the document
   * is replaced wholesale.
   */
  captureControlBaseline(): void {
    const typeface = this.state.typeface;
    this.controlBaseline = typeface ? readControls(typeface) : null;
    this.controlOutlines = new Map();
    if (!typeface || !this.controlBaseline) return;
    for (const name of this.controlBaseline.keys()) {
      const index = typeface.glyphIndex.get(name);
      if (index === undefined) continue;
      this.controlOutlines.set(name, structuredClone(typeface.glyphs[index].contours));
    }

    this.controlLinks = new Map();
    for (const name of this.controlBaseline.keys()) {
      this.controlLinks.set(name, buildLinks(typeface, name));
    }
  }

  /** Glyph names that follow a control letter's shape point for point. */
  followersOf(controlName: string): string[] {
    const links = this.controlLinks.get(controlName);
    if (!links) return [];
    const names = new Set<string>();
    for (const followers of links.values()) {
      for (const address of followers) names.add(address.glyph);
    }
    return [...names].sort();
  }

  private propagateFromControls(): ControlChange[] {
    const typeface = this.state.typeface;
    const baseline = this.controlBaseline;
    if (!typeface || !baseline) return [];

    const outlineFor = (name: string) => this.controlOutlines.get(name) ?? null;

    const { params, changes } = deriveParams(
      baseline,
      readControls(typeface),
      typeface.unitsPerEm,
      outlineFor,
    );
    if (changes.length === 0) return [];

    typeface.params = { ...typeface.params, ...params };
    for (const name of baseline.keys()) {
      const index = typeface.glyphIndex.get(name);
      if (index !== undefined) {
        typeface.glyphs[index].params = { ...DEFAULT_PARAMS };
      }
    }
    return changes;
  }

  /**
   * Redraw everything, for when the boolean library arrives after the font.
   *
   * The letters on screen are correct without it -- a cut that cannot be made
   * is not made -- so nothing is wrong until it lands, and then everything
   * has to be asked again.
   */
  refresh(): void {
    if (this.state.typeface) this.touch();
  }

  /** Copy the resolved parameters of a glyph, for the inspector to display. */
  paramsFor(name: string): GlyphParams {
    const typeface = this.state.typeface;
    if (!typeface) return { ...DEFAULT_PARAMS };
    const index = typeface.glyphIndex.get(name);
    if (index === undefined) return { ...typeface.params };
    return effectiveParams(typeface.glyphs[index], typeface);
  }
}

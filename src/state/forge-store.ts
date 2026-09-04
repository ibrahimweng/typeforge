/**
 * The state of a font being drawn.
 *
 * Kept apart from the store that holds an imported font, because the two are
 * genuinely different documents: one has outlines somebody else drew and a
 * source file to preserve, the other has a description and no source at all.
 * Folding them together would mean every field carrying a note about which half
 * of the application it belongs to.
 *
 * Undo is a stack of whole documents rather than of reversible edits. A forged
 * font is a style and a short list of exceptions -- a few hundred bytes -- so
 * keeping the last fifty of them costs less than the machinery for working out
 * how to undo a slider.
 */

import type { Cast, CastName } from "@/font/cast";
import type { EffectName, Effects } from "@/font/effects";
import {
  chooseForm,
  clearCutException,
  clearException,
  editCast,
  editCut,
  releaseCast as giveCastBack,
  setCastOrder,
  editEffect,
  editMetrics,
  editPart,
  editPen,
  editScript,
  familyOf,
  importLetter,
  relinkLetter,
  setFamily,
  solid,
  startFrom,
  type Forge,
} from "@/forge/document";
import type { CutName, Cuts } from "@/forge/cut";
import type { Fill, Grid, Port } from "@/forge/kit";
import {
  clearTiles,
  editGrid,
  editRoundness,
  layOut,
  setColumns,
  stampFill,
  togglePort,
  useKit,
} from "@/forge/document";
import type { Family } from "@/forge/family";
import { letterSvg, readLetterSvg, type Arrival } from "@/forge/exchange";
import { codepointsFor } from "@/forge/typeface";
import type { Contour, Glyph, GlyphNode, VerticalMetrics } from "@/font/types";
import type { PartName } from "@/forge/parts";
import { baseNamed } from "@/forge/document";
import { SANS, type Metrics, type Parts, type Style } from "@/forge/style";
import type { Pen } from "@/forge/types";

/** Which letter's controls are being shown, and whether they apply to it alone. */
export type Scope = "family" | "letter";

/**
 * Where a change falls in a drag.
 *
 * `single` is a change on its own. `during` is one of the run a drag sends.
 * `end` is the last of that run, which folds into it rather than starting
 * another.
 */
export type Phase = "single" | "during" | "end";

export interface ForgeState {
  forge: Forge;
  /**
   * The document as it was when the last gesture finished.
   *
   * There for the two things that read the whole alphabet -- the grid of every
   * glyph, and the warnings, which measure every letter at every weight. Both
   * are worth having and neither is worth having forty times a second: with
   * the cuts switched on, redrawing two hundred glyphs is most of a second of
   * boolean geometry, and a slider that has to wait for it is a slider nobody
   * can aim.
   *
   * So they follow this instead, and it stands still while a drag is in
   * flight. What moves under the hand is the letter on the stage, the specimen
   * line and the panel, which are a dozen glyphs between them and can be drawn
   * every frame; the grid and the warnings catch up the moment the drag ends.
   * The alternative is not a livelier grid, it is a slider that jumps.
   */
  settled: Forge;
  /** The letter open in the large view. */
  letter: string;
  /** Whether an edit lands on the family or on this letter alone. */
  scope: Scope;
  familyName: string;
  /** Whether the spine and the pen are drawn over the letter. */
  showSkeleton: boolean;
  /**
   * The shape a press on a cell puts down, when the letters are built on a
   * grid.
   *
   * A choice about the tool rather than about the font, so it is kept here and
   * not in the document: undoing a letter should not put a different shape in
   * your hand, and which shape was selected does not belong in a file anybody
   * exports.
   *
   * Nothing chosen means a press clears whatever is in the cell, which is the
   * eraser -- and is the state it starts in, so a stray press on the stage
   * cannot quietly fill a cell in.
   */
  fill: Fill | null;
  /** What the specimen line is set in. */
  specimen: string;
  /** Whether the specimen is shown light on dark, which is how a display face gets judged. */
  reversed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * The control the panel has been asked to show, named as a drive.
   *
   * Set by pressing a spot on the letter, which is a way of finding a control
   * by pointing at what it does rather than by reading forty labels. The count
   * beside it is bumped on every ask, so pressing the same spot twice takes the
   * panel back there instead of doing nothing the second time.
   */
  focus: { id: string; asked: number } | null;
  /**
   * Whether a gesture is in flight.
   *
   * The shaping layers -- the cuts and the casts -- are booleans over the whole
   * outline, and they cost between five and forty milliseconds a letter. Run on
   * every frame of a drag they are what turns a slider into a frozen window:
   * measured on the draw page, one ten-step pull of `Fillets: Size` blocked the
   * main thread for four hundred and twenty-three seconds.
   *
   * So while a gesture is open the live views draw the letter without them and
   * put them back the moment it ends. What is lost is watching a shadow grow
   * under the hand; what is bought is a slider that moves at all.
   */
  resting: boolean;
  /** Bumped on every change, so views can memoise against it. */
  revision: number;
  /** The same, for `settled`: bumped only when a gesture has finished. */
  settledRevision: number;
}

const HISTORY = 50;

class ForgeStore {
  private state: ForgeState = {
    forge: startFrom(SANS),
    settled: startFrom(SANS),
    resting: true,
    letter: "n",
    scope: "family",
    familyName: "Untitled",
    showSkeleton: false,
    fill: null,
    specimen: "Handgloves",
    reversed: false,
    canUndo: false,
    canRedo: false,
    focus: null,
    revision: 0,
    settledRevision: 0,
  };

  private past: Forge[] = [];
  private future: Forge[] = [];
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ForgeState => this.state;

  private set(patch: Partial<ForgeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Whether a drag is open, and therefore whether the next change folds in. */
  private gestureOpen = false;

  /**
   * The trailing catch-up, so the grid is never left behind.
   *
   * `settled` waits for a control to say its gesture has ended, and not every
   * control says so: a slider driven from the keyboard sends a run of changes
   * and nothing after the last of them, because there is no last one until
   * somebody stops pressing the key. Waiting on a signal that may not come is
   * how a view ends up quietly showing a font from a minute ago.
   *
   * So there are two ways to settle and either is enough: the gesture ends, or
   * the changes stop. A sixth of a second is longer than the gap between two
   * frames of a drag and shorter than anyone waiting for a grid to catch up.
   *
   * It waits twice, and the second wait is the one that matters here. Quiet is
   * not the same as finished: a drag on a heavy font stalls for longer than a
   * sixth of a second between frames, and treating every stall as the end of
   * the gesture is what made this page slow -- the expensive layers went back
   * on, the next frame stalled harder, and the two fed each other. So the first
   * wait lets the views catch up and says nothing about the hand; only after a
   * second, much longer, silence is the gesture given up for over. That one is
   * for the control that never says it has finished, and it is the only thing
   * standing between such a control and a view stuck a minute in the past.
   */
  private catchUp: ReturnType<typeof setTimeout> | null = null;

  private static readonly QUIET = 160;

  /*
   * How long after the last change a gesture nobody closed is given up for
   * over.
   *
   * A pointer drag says when it ends, so this is really for the slider held
   * down on an arrow key, which sends a run of changes and nothing to say the
   * last of them was the last. The cost of being wrong is small in one
   * direction and not the other: too long and a keyboard run waits a moment
   * before the strip catches up; too short and a drag that stalled for one bad
   * frame is read as finished and puts the whole cast back mid-pull.
   *
   * A second and a fifth, against a worst frame measured at seven hundred
   * milliseconds on the heaviest setting this page has.
   */
  private static readonly ABANDONED = 1200;

  /**
   * Record the document as it was, then move to a new one.
   *
   * A drag arrives as a run of changes, and each one recorded separately would
   * leave a hundred entries in the history for one pull of a stem. So the first
   * change of a run is recorded and the rest replace it.
   *
   * Which is why this needs three phases rather than a flag saying "part of a
   * drag". A run has a beginning and an end, and both of them arrive looking
   * like an ordinary change: a slider sends its final value with nothing to
   * mark it as the last, and a single click sends only that. Told apart by a
   * flag, a drag came out as two entries -- one for the first change and one
   * for the last -- and undoing it moved the stem back part of the way and
   * stopped.
   */
  private commit(next: Forge, phase: Phase = "single"): void {
    if (!this.gestureOpen) {
      this.past.push(this.state.forge);
      if (this.past.length > HISTORY) this.past.shift();
      this.future = [];
    }
    this.gestureOpen = phase === "during";
    const resting = phase !== "during";
    if (this.catchUp !== null) clearTimeout(this.catchUp);
    this.catchUp = resting ? null : setTimeout(() => this.wentQuiet(), ForgeStore.QUIET);
    this.set({
      forge: next,
      settled: resting ? next : this.state.settled,
      settledRevision: this.state.settledRevision + (resting ? 1 : 0),
      resting,
      canUndo: true,
      canRedo: false,
      revision: this.state.revision + 1,
    });
  }

  /**
   * Say that a drag has finished.
   *
   * Needed for a gesture this application drives itself -- a handle pulled
   * across the stage -- where there is no final change to mark the end. Without
   * it the run would stay open and the next edit would disappear into it.
   */
  endGesture(): void {
    this.stopMoving();
    if (this.state.settled !== this.state.forge) this.settle();
    else if (!this.state.resting) this.set({ resting: true });
  }

  /**
   * Nothing has arrived for a while.
   *
   * Let the views catch up, and then wait again, much longer, before deciding
   * the gesture itself is over -- see the note on `catchUp` for why those are
   * two different questions.
   */
  private wentQuiet(): void {
    if (this.state.settled !== this.state.forge) this.settle();
    this.catchUp = setTimeout(() => {
      this.catchUp = null;
      this.gestureOpen = false;
      if (!this.state.resting) this.set({ resting: true });
    }, ForgeStore.ABANDONED);
  }

  /** Let whatever was waiting for the drag to finish catch up. */
  private settle(): void {
    this.set({
      settled: this.state.forge,
      settledRevision: this.state.settledRevision + 1,
      /*
       * Still moving, unless the gesture has actually closed.
       *
       * Two different questions, and running them together is what made this
       * whole page slow. `settled` is there so that whatever follows the
       * alphabet is never left showing a stale font; it is allowed to catch up
       * in a pause. `resting` is there so that the expensive layers stay off
       * while a hand is on a control, and a pause is not a hand coming off.
       *
       * When the timer set them both, a drag that stalled -- which is to say,
       * any drag on a font with a cast on it -- read as finished on every
       * frame, the layers went back on, and the next frame stalled harder.
       */
      resting: !this.gestureOpen,
    });
  }

  // --- what is being looked at -------------------------------------------

  select(letter: string): void {
    this.set({ letter });
  }

  setScope(scope: Scope): void {
    this.set({ scope });
  }

  /** Ask the panel to show one control, and to say which one it is showing. */
  showControl(id: string): void {
    this.set({ focus: { id, asked: (this.state.focus?.asked ?? 0) + 1 } });
  }

  /**
   * The drawn half, for writing down and for putting back.
   *
   * Restoring goes through the same commit the editing does, so the document
   * that comes back can be undone away from -- which is what somebody expects
   * after opening the wrong file.
   */
  snapshot(): { forge: Forge; familyName: string; specimen: string } {
    return {
      forge: this.state.forge,
      familyName: this.state.familyName,
      specimen: this.state.specimen,
    };
  }

  restore(saved: { forge: Forge; familyName: string; specimen: string }): void {
    this.commit(saved.forge, "single");
    this.set({ familyName: saved.familyName, specimen: saved.specimen, focus: null });
  }

  setFamilyName(familyName: string): void {
    this.set({ familyName });
  }

  /**
   * Which weights the typeface has.
   *
   * Undoable like any other change to the document, because it is one: turning
   * the Black off throws away a member of the family, and somebody who did it
   * by mistake should be able to take it back the way they take back
   * everything else here.
   */
  setFamily(family: Family): void {
    this.commit(setFamily(this.state.forge, family));
  }

  /** Add or remove one weight, leaving the one on screen alone. */
  toggleWeight(weight: number): void {
    const family = familyOf(this.state.forge);
    if (weight === family.drawn) return;
    const also = family.also.includes(weight)
      ? family.also.filter((one) => one !== weight)
      : [...family.also, weight];
    this.commit(setFamily(this.state.forge, { ...family, also }));
  }

  /**
   * Say which weight the drawing on screen is.
   *
   * Not a change to the letters -- the same pen draws the same shapes -- but a
   * change to what the rest of the family is worked out from, so the whole set
   * moves. A face drawn as its Black has a light family below it and no heavy
   * one above, which is what a display family usually is.
   */
  setDrawnWeight(weight: number): void {
    const family = familyOf(this.state.forge);
    this.commit(
      setFamily(this.state.forge, {
        drawn: weight,
        also: family.also.filter((one) => one !== weight),
      }),
    );
  }

  /*
   * How the font is being looked at, rather than what it is.
   *
   * None of these go through the history. Undoing a change to the letters and
   * finding the skeleton had switched itself back on would be undo doing
   * something nobody asked for.
   */
  setShowSkeleton(showSkeleton: boolean): void {
    this.set({ showSkeleton });
  }

  /** Choose the shape a press on a cell puts down. Nothing chosen is the eraser. */
  chooseFill(fill: Fill | null): void {
    this.set({ fill });
  }

  setSpecimen(specimen: string): void {
    this.set({ specimen });
  }

  setReversed(reversed: boolean): void {
    this.set({ reversed });
  }

  // --- the document -------------------------------------------------------

  /**
   * Start again from one of the three bases.
   *
   * Everything drawn so far goes, which is why it is undoable: it is the one
   * action here that can lose work.
   */
  startFromBase(name: string): void {
    const base = baseNamed(name);
    if (!base) return;
    this.commit(startFrom(base));
    this.set({
      familyName: this.state.familyName === "Untitled" ? `My ${name}` : this.state.familyName,
    });
  }

  /**
   * Start from a style worked out somewhere else.
   *
   * The library uses this: it measures a font, builds a style from the
   * measurements, and hands it over. Undoable like starting from a base,
   * because it is the same kind of act and can lose the same work.
   */
  startFromStyle(style: Style, base: string): void {
    this.commit({ ...startFrom(style), base });
    this.set({ familyName: style.name || this.state.familyName });
  }

  /**
   * Change a part.
   *
   * On the family by default, which is the whole point of the thing: the edit
   * reaches every letter that has that part. In letter scope it makes this
   * letter an exception and leaves the rest of the font alone.
   */
  changePart(part: PartName, patch: Partial<Parts[PartName]>, phase: Phase = "single"): void {
    const { forge, scope, letter } = this.state;
    this.commit(editPart(forge, part, patch, scope === "letter" ? letter : undefined), phase);
  }

  /**
   * Draw this letter from a different skeleton.
   *
   * The one decision here that belongs to a letter rather than to the font.
   * Choosing a double-storey a says nothing about the g, and everything else --
   * the pen, the proportions, every named part -- still reaches it.
   */
  chooseAlternate(form: string): void {
    const { forge, letter } = this.state;
    this.commit(chooseForm(forge, letter, form));
  }

  /**
   * Put this letter back on the family's terms.
   *
   * With nothing named that means everything: the parts it holds its own
   * version of and the cuts alike. Somebody pressing "rejoin the family" is
   * saying this letter should stop being special, and leaving half of what
   * made it special in place would be answering a different question.
   */
  rejoinFamily(part?: PartName): void {
    const { forge, letter } = this.state;
    const parts = clearException(forge, letter, part);
    this.commit(part === undefined ? clearCutException(parts, letter) : parts);
  }

  /**
   * Change what is taken out of the letters.
   *
   * On the whole font by default, because a face is cut one way. In letter
   * scope it makes this letter an exception, for the one that has nowhere to
   * put the third slot.
   */
  changeCut(name: CutName, patch: Partial<Cuts[CutName]>, phase: Phase = "single"): void {
    const { forge, scope, letter } = this.state;
    this.commit(editCut(forge, name, patch, scope === "letter" ? letter : undefined), phase);
  }

  /** Cut this letter the way the rest of the font is cut. */
  releaseCut(name?: CutName): void {
    const { forge, letter } = this.state;
    this.commit(clearCutException(forge, letter, name));
  }

  /** Change what is put on the letters, on the same terms as the cuts. */
  changeCast(name: CastName, patch: Partial<Cast[CastName]>, phase: Phase = "single"): void {
    const { forge, scope, letter } = this.state;
    this.commit(editCast(forge, name, patch, scope === "letter" ? letter : undefined), phase);
  }

  /**
   * Change something about the tool that drew the font.
   *
   * Never scoped to a letter, which is the one place this parts company with
   * the cut and the cast. Those describe things done to a letter and a letter
   * can reasonably be done to differently; this describes what drew the font,
   * and a font drawn with two different markers is not a font.
   */
  changeEffect(
    name: EffectName,
    patch: Partial<Effects[EffectName]>,
    phase: Phase = "single",
  ): void {
    this.commit(editEffect(this.state.forge, name, patch), phase);
  }

  /** Cast this letter the way the rest of the font is cast. */
  releaseCast(name?: CastName): void {
    const { forge, letter } = this.state;
    this.commit(name === undefined ? forge : giveCastBack(forge, letter, name));
  }

  /**
   * Which way round the two layers go.
   *
   * Never a letter's own. One letter whose shadow is thrown by the cut face
   * while the rest are cut through their shadows is not a decision anybody
   * makes on purpose, and the panel does not offer it.
   */
  changeCastOrder(order: Cast["order"]): void {
    this.commit(setCastOrder(this.state.forge, order));
  }

  // --- the kit -----------------------------------------------------------

  /**
   * Build the letters from cells, or go back to drawing them.
   *
   * Switching on lays the alphabet out from the skeletons the font already has,
   * unless it has been laid out before -- so the first press gives a whole
   * font on the grid to argue with rather than an empty sheet, and the second
   * one does not throw away an afternoon of cell editing.
   */
  useKit(on: boolean): void {
    const { forge } = this.state;
    const laid = Object.keys(forge.kit?.glyphs ?? {}).length > 0;
    this.commit(useKit(on && !laid ? layOut(forge) : forge, on));
  }

  changeGrid(patch: Partial<Grid>, phase: Phase = "single"): void {
    this.commit(editGrid(this.state.forge, patch), phase);
  }

  changeRoundness(roundness: number, phase: Phase = "single"): void {
    this.commit(editRoundness(this.state.forge, roundness), phase);
  }

  /** Turn one place on one cell's boundary on or off. */
  togglePort(key: string, port: Port): void {
    this.commit(togglePort(this.state.forge, this.state.letter, key, port));
  }

  /**
   * Put a filled shape in a cell, or take it out again.
   *
   * Stamping the shape a cell already has clears it, so one gesture both
   * places and removes and there is no eraser to go and find.
   */
  stampFill(key: string, fill?: Fill): void {
    this.commit(stampFill(this.state.forge, this.state.letter, key, fill));
  }

  changeColumns(columns: number, phase: Phase = "single"): void {
    this.commit(setColumns(this.state.forge, this.state.letter, columns), phase);
  }

  /** Put this letter back to what its skeleton says, or lay the whole font out. */
  layOutLetters(all = false): void {
    this.commit(layOut(this.state.forge, all ? undefined : [this.state.letter]));
  }

  /** Empty this letter's cells, to start it again from nothing. */
  clearLetter(): void {
    this.commit(clearTiles(this.state.forge, this.state.letter));
  }

  /**
   * Say that something outside the document has changed what it can draw.
   *
   * There is one such thing: the boolean library the cuts are made of arrives
   * after the application does, and until it has, a letter with slots through
   * it is drawn without them. This is what asks every view to draw again once
   * it is there. Deliberately not a commit -- nothing about the document
   * changed, and finding a step in the undo history for a download that
   * finished would be undo doing something nobody asked for.
   *
   * Said by handing out the same document in a new wrapper, because a bumped
   * revision on its own is not enough to shift a drawing: letters are
   * remembered against the object they were drawn from, and the object has not
   * changed -- so every view that asked again got the very drawings made
   * without the library handed straight back. A shallow copy holds all the
   * same parts and is a different thing to remember against, which is exactly
   * the distinction wanted: nothing about the font is different, and every
   * letter of it has to be drawn afresh.
   */
  refresh(): void {
    const again = { ...this.state.forge };
    this.set({
      forge: again,
      settled: this.state.settled === this.state.forge ? again : { ...this.state.settled },
      revision: this.state.revision + 1,
      settledRevision: this.state.settledRevision + 1,
    });
  }

  /** The pen reaches every letter; there are no exceptions to be had from it. */
  changePen(patch: Partial<Pen>, phase: Phase = "single"): void {
    this.commit(editPen(this.state.forge, patch), phase);
  }

  changeMetrics(patch: Partial<Metrics>, phase: Phase = "single"): void {
    this.commit(editMetrics(this.state.forge, patch), phase);
  }

  /**
   * The join reaches every letter, and no letter may hold an exception to it.
   *
   * Family scope whatever the panel is set to, which is the one place a
   * control ignores that switch. A seam is an agreement between two letters
   * rather than a property of one, so a letter holding its own would hand over
   * at a height its neighbour never arrives at and the pair would come apart.
   */
  changeScript(patch: Partial<Style["parts"]["script"]>, phase: Phase = "single"): void {
    this.commit(editScript(this.state.forge, patch), phase);
  }

  // --- the trip out and back ----------------------------------------------

  /** This letter as an SVG sheet, with the metrics on it as guides. */
  letterAsSvg(letter?: string): string | null {
    return letterSvg(letter ?? this.state.letter, this.state.forge);
  }

  /**
   * Read a sheet without taking it.
   *
   * Separate from taking it so the dialog can say what is about to happen --
   * which letter this is for, and whether that is the letter it is being
   * dropped onto -- before anything changes.
   */
  readSheet(text: string, into?: string): Arrival | null {
    return readLetterSvg(text, this.state.forge, into);
  }

  /**
   * Take a drawn letter into the font.
   *
   * Undoable like every other change, and it needs to be more than most: this
   * is the one edit that replaces a description with an outline, and finding
   * out you would rather have kept the description should cost one keystroke.
   */
  takeLetter(arrival: Arrival, from: string): void {
    this.commit(
      importLetter(this.state.forge, arrival.letter, {
        contours: arrival.contours,
        advanceWidth: arrival.advanceWidth,
        from,
      }),
    );
    this.set({ letter: arrival.letter });
  }

  /** Put an imported letter back under the family's control, to be drawn again. */
  redrawLetter(letter?: string): void {
    this.commit(relinkLetter(this.state.forge, letter ?? this.state.letter));
  }

  /**
   * This letter as a glyph, ready to be put on the editor's desk.
   *
   * The same trip the SVG sheet makes, without the file. What goes out is the
   * *solid* letter rather than the drawn one -- the letter the cuts are applied
   * to, not the letter after them -- for the reason the sheet uses it: a slot or
   * a saw is a description of what the font takes out of every letter, and a
   * drawing that arrived with its slots already cut into it would be cut again
   * the moment it came back.
   *
   * An imported letter hands back what it already is, so opening a hand-drawn
   * letter a second time carries on from the drawing rather than starting over
   * from a skeleton it has not had for some time.
   */
  letterAsGlyph(
    letter?: string,
  ): { glyph: Glyph; unitsPerEm: number; metrics: VerticalMetrics; family: string } | null {
    const name = letter ?? this.state.letter;
    const forge = this.state.forge;
    const outside = forge.imported[name];
    const drawn = outside
      ? { contours: outside.contours, advanceWidth: outside.advanceWidth }
      : solid(name, forge);
    if (!drawn) return null;
    const { metrics } = forge.style;
    return {
      glyph: {
        name,
        unicodes: codepointsFor(name),
        advanceWidth: drawn.advanceWidth,
        contours: drawn.contours.map((one: Contour) => ({
          ...one,
          nodes: one.nodes.map((node: GlyphNode) => ({ ...node })),
        })),
        components: [],
        anchors: [],
        params: {},
        dirty: false,
      },
      unitsPerEm: metrics.unitsPerEm,
      metrics: {
        ascender: metrics.ascender,
        descender: metrics.descender,
        capHeight: metrics.capHeight,
        xHeight: metrics.xHeight,
        lineGap: 0,
      },
      family: this.state.familyName,
    };
  }

  // --- history ------------------------------------------------------------

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state.forge);
    this.stopMoving();
    this.set({
      forge: previous,
      settled: previous,
      settledRevision: this.state.settledRevision + 1,
      resting: true,
      canUndo: this.past.length > 0,
      canRedo: true,
      revision: this.state.revision + 1,
    });
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.forge);
    this.stopMoving();
    this.set({
      forge: next,
      settled: next,
      settledRevision: this.state.settledRevision + 1,
      resting: true,
      canUndo: true,
      canRedo: this.future.length > 0,
      revision: this.state.revision + 1,
    });
  }

  /**
   * Whatever run was open is not open any more.
   *
   * Undo and redo are not part of a drag: they are somebody stepping outside
   * one, and the step they undid may well be the drag itself. So the gesture
   * closes and its timers go with it -- otherwise the views that hold still
   * while a hand is on a control would go on holding the font that was just
   * undone, until a timer that is about something else got round to them.
   */
  private stopMoving(): void {
    this.gestureOpen = false;
    if (this.catchUp !== null) {
      clearTimeout(this.catchUp);
      this.catchUp = null;
    }
  }

  get style(): Style {
    return this.state.forge.style;
  }
}

export const forgeStore = new ForgeStore();

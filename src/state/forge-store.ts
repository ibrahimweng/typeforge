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

import {
  chooseForm,
  clearCutException,
  clearException,
  editCut,
  editMetrics,
  editPart,
  editPen,
  familyOf,
  importLetter,
  relinkLetter,
  setFamily,
  startFrom,
  type Forge,
} from "@/forge/document";
import type { CutName, Cuts } from "@/forge/cut";
import type { Grid, Port } from "@/forge/kit";
import {
  clearTiles,
  editGrid,
  editRoundness,
  layOut,
  setColumns,
  toggleSolid,
  togglePort,
  useKit,
} from "@/forge/document";
import type { Family } from "@/forge/family";
import { letterSvg, readLetterSvg, type Arrival } from "@/forge/exchange";
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
    letter: "n",
    scope: "family",
    familyName: "Untitled",
    showSkeleton: false,
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
   */
  private catchUp: ReturnType<typeof setTimeout> | null = null;

  private static readonly QUIET = 160;

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
    this.catchUp = resting
      ? null
      : setTimeout(() => {
          this.catchUp = null;
          if (this.state.settled !== this.state.forge) this.settle();
        }, ForgeStore.QUIET);
    this.set({
      forge: next,
      settled: resting ? next : this.state.settled,
      settledRevision: this.state.settledRevision + (resting ? 1 : 0),
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
    this.gestureOpen = false;
    if (this.catchUp !== null) {
      clearTimeout(this.catchUp);
      this.catchUp = null;
    }
    if (this.state.settled !== this.state.forge) this.settle();
  }

  /** Let whatever was waiting for the drag to finish catch up. */
  private settle(): void {
    this.set({
      settled: this.state.forge,
      settledRevision: this.state.settledRevision + 1,
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
    this.set({ familyName: this.state.familyName === "Untitled" ? `My ${name}` : this.state.familyName });
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

  /** Fill one cell in outright, or empty it again. */
  toggleSolid(key: string): void {
    this.commit(toggleSolid(this.state.forge, this.state.letter, key));
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
   * it is drawn without them. Bumping the revision is what asks every view to
   * draw again once it is there. Deliberately not a commit -- nothing about
   * the document changed, and finding a step in the undo history for a
   * download that finished would be undo doing something nobody asked for.
   */
  refresh(): void {
    this.set({
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

  // --- history ------------------------------------------------------------

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state.forge);
    this.set({
      forge: previous,
      settled: previous,
      settledRevision: this.state.settledRevision + 1,
      canUndo: this.past.length > 0,
      canRedo: true,
      revision: this.state.revision + 1,
    });
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.forge);
    this.set({
      forge: next,
      settled: next,
      settledRevision: this.state.settledRevision + 1,
      canUndo: true,
      canRedo: this.future.length > 0,
      revision: this.state.revision + 1,
    });
  }

  get style(): Style {
    return this.state.forge.style;
  }
}

export const forgeStore = new ForgeStore();

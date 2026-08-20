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
  clearException,
  editMetrics,
  editPart,
  editPen,
  startFrom,
  type Forge,
} from "@/forge/document";
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
  /** Bumped on every change, so views can memoise against it. */
  revision: number;
}

const HISTORY = 50;

class ForgeStore {
  private state: ForgeState = {
    forge: startFrom(SANS),
    letter: "n",
    scope: "family",
    familyName: "Untitled",
    showSkeleton: false,
    specimen: "Handgloves",
    reversed: false,
    canUndo: false,
    canRedo: false,
    revision: 0,
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
    this.set({
      forge: next,
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
  }

  // --- what is being looked at -------------------------------------------

  select(letter: string): void {
    this.set({ letter });
  }

  setScope(scope: Scope): void {
    this.set({ scope });
  }

  setFamilyName(familyName: string): void {
    this.set({ familyName });
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

  /** Put this letter back on the family's terms. */
  rejoinFamily(part?: PartName): void {
    const { forge, letter } = this.state;
    this.commit(clearException(forge, letter, part));
  }

  /** The pen reaches every letter; there are no exceptions to be had from it. */
  changePen(patch: Partial<Pen>, phase: Phase = "single"): void {
    this.commit(editPen(this.state.forge, patch), phase);
  }

  changeMetrics(patch: Partial<Metrics>, phase: Phase = "single"): void {
    this.commit(editMetrics(this.state.forge, patch), phase);
  }

  // --- history ------------------------------------------------------------

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state.forge);
    this.set({
      forge: previous,
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

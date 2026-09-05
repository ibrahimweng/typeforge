/**
 * The state of a font being assembled.
 *
 * Built the same way as the forge's store, for the same reasons: every edit
 * returns a whole new document, undo is a stack of them, and a drag folds into
 * one entry rather than fifty.
 */

import {
  addPieces,
  chooseFit,
  clearSlot,
  editMetrics,
  editSpacing,
  emptyAssembly,
  mapPiece,
  pieceFrom,
  pieceInto,
  putInSlot,
  removePiece,
  cutLikeTheRest,
  castFor,
  castLikeTheRest as castLikeRest,
  castOneWay,
  castOrNone,
  cutOneWay,
  cutsFor,
  cutsOrNone,
  editCast,
  editCuts,
  setKern,
  tweak,
  type Assembly,
  type Piece,
  type Tweak,
} from "@/assemble/document";
import { build } from "@/assemble/document";
import type { Cast, CastName } from "@/font/cast";
import type { CutName, Cuts } from "@/font/cuts";
import type { FitMetrics, FitMode } from "@/assemble/fit";
import type { SpacingSettings } from "@/assemble/spacing";
import type { Typeface } from "@/font/types";
import { adjustmentsFor, borrowFrom, kernsIn } from "@/library/borrow";

export type Phase = "single" | "during" | "end";

export interface AssembleState {
  assembly: Assembly;
  familyName: string;
  /** The character whose drawing is open in the large view. */
  selected: string;
  /** What the specimen line is set in. */
  specimen: string;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped on every change, so views can memoise against it. */
  revision: number;
  /** Set while files are being read. */
  reading: boolean;
  /** Said when a file could not be read into the box it was chosen for. */
  problem: string | null;
}

const HISTORY = 50;

class AssembleStore {
  private state: AssembleState = {
    assembly: emptyAssembly(),
    familyName: "Untitled",
    selected: "",
    specimen: "Handgloves",
    canUndo: false,
    canRedo: false,
    revision: 0,
    reading: false,
    problem: null,
  };

  private past: Assembly[] = [];
  private future: Assembly[] = [];
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AssembleState => this.state;

  private set(patch: Partial<AssembleState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private gestureOpen = false;

  private commit(next: Assembly, phase: Phase = "single"): void {
    /*
     * A finished edit gets its own entry even when a drag is open.
     *
     * `during` says a gesture is in flight and the next commit folds into it,
     * which is what keeps one pull of a slider to one entry. `single` says the
     * opposite -- this is a whole edit by itself -- and it was folding in
     * anyway, so a click that landed while a drag was open could not be undone
     * on its own. Both went back in one step.
     *
     * The quill store asks it this way round already.
     */
    if (phase === "single" || !this.gestureOpen) {
      this.past.push(this.state.assembly);
      if (this.past.length > HISTORY) this.past.shift();
      this.future = [];
    }
    this.gestureOpen = phase === "during";
    this.set({ assembly: next, canUndo: true, canRedo: false, revision: this.state.revision + 1 });
  }

  // --- the pile ------------------------------------------------------------

  /**
   * Read a set of files in.
   *
   * Everything that could be read is taken and everything that could not is
   * named, rather than the whole drop failing because one file in it was a
   * screenshot. Dropping thirty files and being told nothing happened is the
   * worst possible answer.
   */
  async take(files: File[]): Promise<string[]> {
    if (files.length === 0) return [];
    this.set({ reading: true });
    const pieces: Piece[] = [];
    const refused: string[] = [];
    try {
      for (const file of files) {
        try {
          const piece = pieceFrom(file.name, await file.text());
          if (piece) pieces.push(piece);
          else refused.push(file.name);
        } catch {
          refused.push(file.name);
        }
      }
      if (pieces.length > 0) {
        this.commit(addPieces(this.state.assembly, pieces));
        if (!this.state.selected) {
          const first = pieces.find((piece) => piece.character !== "");
          if (first) this.set({ selected: first.character });
        }
      }
    } finally {
      this.set({ reading: false });
    }
    return refused;
  }

  /**
   * Read one file into one box.
   *
   * Nothing is guessed, because the box was chosen first. Returns whether the
   * file held anything drawable, so the box can say so rather than sitting
   * there looking as though nothing happened.
   */
  async takeInto(character: string, file: File): Promise<boolean> {
    this.set({ reading: true, problem: null });
    try {
      const piece = pieceInto(character, file.name, await file.text());
      if (!piece) {
        this.set({ problem: `Nothing drawable in ${file.name}.` });
        return false;
      }
      this.commit(putInSlot(this.state.assembly, piece));
      this.set({ selected: character });
      return true;
    } catch {
      this.set({ problem: `${file.name} could not be read.` });
      return false;
    } finally {
      this.set({ reading: false });
    }
  }

  /** Empty one box. */
  empty(character: string): void {
    this.commit(clearSlot(this.state.assembly, character));
  }

  drop(id: string): void {
    this.commit(removePiece(this.state.assembly, id));
  }

  /** Say which character a drawing is for. */
  map(id: string, character: string): void {
    this.commit(mapPiece(this.state.assembly, id, character));
    if (character) this.set({ selected: character });
  }

  select(character: string): void {
    this.set({ selected: character });
  }

  /** The assembled half, for writing down and for putting back. */
  snapshot(): { assembly: Assembly; familyName: string; specimen: string } {
    return {
      assembly: this.state.assembly,
      familyName: this.state.familyName,
      specimen: this.state.specimen,
    };
  }

  restore(saved: { assembly: Assembly; familyName: string; specimen: string }): void {
    this.commit(saved.assembly, "single");
    this.set({
      familyName: saved.familyName,
      specimen: saved.specimen,
      problem: null,
      selected: saved.assembly.pieces.find((piece) => piece.character)?.character ?? "",
    });
  }

  setFamilyName(familyName: string): void {
    this.set({ familyName });
  }

  setSpecimen(specimen: string): void {
    this.set({ specimen });
  }

  // --- the settings --------------------------------------------------------

  setFit(fit: FitMode): void {
    this.commit(chooseFit(this.state.assembly, fit));
  }

  changeMetrics(patch: Partial<FitMetrics>, phase: Phase = "single"): void {
    this.commit(editMetrics(this.state.assembly, patch), phase);
  }

  changeSpacing(patch: Partial<SpacingSettings>, phase: Phase = "single"): void {
    this.commit(editSpacing(this.state.assembly, patch), phase);
  }

  nudge(character: string, patch: Partial<Tweak>, phase: Phase = "single"): void {
    this.commit(tweak(this.state.assembly, character, patch), phase);
  }

  /*
   * Cutting.
   *
   * A drawing either goes along with the pile or is cut its own way -- an
   * exception rather than a layer, because half the pile's cuts merged with
   * half a drawing's own is not a description anybody wrote.
   */

  changeCut(name: CutName, patch: Partial<Cuts[CutName]>, phase: Phase = "single"): void {
    const cuts = cutsOrNone(this.state.assembly);
    this.commit(
      editCuts(this.state.assembly, { ...cuts, [name]: { ...cuts[name], ...patch } } as Cuts),
      phase,
    );
  }

  changeOneCut(
    character: string,
    name: CutName,
    patch: Partial<Cuts[CutName]>,
    phase: Phase = "single",
  ): void {
    // Starting from however this character is cut now, so changing one
    // operation keeps the rest of what it was already showing.
    const cuts = cutsFor(character, this.state.assembly) ?? cutsOrNone(this.state.assembly);
    this.commit(
      cutOneWay(this.state.assembly, character, {
        ...cuts,
        [name]: { ...cuts[name], ...patch },
      } as Cuts),
      phase,
    );
  }

  /** Put one drawing back to being cut like the rest of the pile. */
  cutLikeTheRest(character: string): void {
    this.commit(cutLikeTheRest(this.state.assembly, character));
  }

  /* The same three again for the cast, on the same terms throughout. */

  changeCast(name: CastName, patch: Partial<Cast[CastName]>, phase: Phase = "single"): void {
    const cast = castOrNone(this.state.assembly);
    this.commit(
      editCast(this.state.assembly, { ...cast, [name]: { ...cast[name], ...patch } } as Cast),
      phase,
    );
  }

  changeOneCast(
    character: string,
    name: CastName,
    patch: Partial<Cast[CastName]>,
    phase: Phase = "single",
  ): void {
    const cast = castFor(character, this.state.assembly) ?? castOrNone(this.state.assembly);
    this.commit(
      castOneWay(this.state.assembly, character, {
        ...cast,
        [name]: { ...cast[name], ...patch },
      } as Cast),
      phase,
    );
  }

  castLikeTheRest(character: string): void {
    this.commit(castLikeRest(this.state.assembly, character));
  }

  /** Which way round the two layers go. A decision about the pile, never one drawing. */
  changeCastOrder(order: Cast["order"]): void {
    const cast = castOrNone(this.state.assembly);
    this.commit(editCast(this.state.assembly, { ...cast, order }));
  }

  /**
   * Rebuild, for when the boolean library arrives after the drawings.
   *
   * `build` keeps its answer against the assembly it was given, so a pile
   * built before the library landed would stay uncut however many times it was
   * asked. A new object is a new question.
   */
  refresh(): void {
    this.set({ assembly: { ...this.state.assembly }, revision: this.state.revision + 1 });
  }

  setPairKern(left: string, right: string, value: number | null, phase: Phase = "single"): void {
    this.commit(setKern(this.state.assembly, left, right, value), phase);
  }

  /**
   * Wear another font's rhythm.
   *
   * The spacing arrives as a target for the total white beside each letter,
   * and the assembly has already measured how much of that its own drawing
   * supplies -- so what gets stored is the difference, in the same place a
   * person's own nudges go. Which means it can be undone in one keystroke and
   * turned back into your own measurements by clearing the nudges, rather than
   * being baked in somewhere it cannot be got out of.
   *
   * Only the letters both fonts have. A drawing of an ampersand gets nothing
   * from a font that has no ampersand, and that is reported rather than passed
   * over.
   */
  borrowFrom(typeface: Typeface): { letters: number; pairs: number } {
    const assembly = this.state.assembly;
    const assembled = build(assembly);
    if (assembled.letters.length === 0) return { letters: 0, pairs: 0 };

    const characters = assembled.letters.map((letter) => letter.character);
    const borrowed = borrowFrom(typeface, characters);

    // What the assembly's own measurement gave each letter, before any nudge,
    // since the nudge is what is about to be replaced.
    const own = new Map<string, { left: number; right: number }>();
    for (const letter of assembled.letters) {
      const nudge = assembly.tweaks[letter.character] ?? { left: 0, right: 0 };
      own.set(letter.character, {
        left: letter.bearings.left - nudge.left,
        right: letter.bearings.right - nudge.right,
      });
    }

    const em = assembly.metrics.unitsPerEm;
    const adjustments = adjustmentsFor(borrowed, em, own);
    const kerns = kernsIn(borrowed, em);

    let next = assembly;
    for (const adjustment of adjustments) {
      next = tweak(next, adjustment.character, { left: adjustment.left, right: adjustment.right });
    }
    for (const [pair, value] of kerns) {
      const [left, right] = pair.split(" ");
      if (left && right) next = setKern(next, left, right, value);
    }

    this.commit(next);
    return { letters: adjustments.length, pairs: kerns.size };
  }

  // --- history -------------------------------------------------------------

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state.assembly);
    /*
     * Whatever was being dragged is not being dragged any more.
     *
     * Undo is somebody stepping outside a gesture, and the step they took back
     * may well be the gesture itself. Left open, the next edit folded into an
     * entry that had already been undone -- so one undo went back two steps and
     * the state in between could not be reached at all.
     */
    this.gestureOpen = false;
    this.set({
      assembly: previous,
      canUndo: this.past.length > 0,
      canRedo: true,
      revision: this.state.revision + 1,
    });
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.assembly);
    /*
     * The same, though not for a reason anything can reach today: opening a
     * gesture clears the redo stack on its first commit, so there is never
     * anything to redo while one is open. Kept for the symmetry, and because
     * the day that changes this is not where anybody would think to look.
     */
    this.gestureOpen = false;
    this.set({
      assembly: next,
      canUndo: true,
      canRedo: this.future.length > 0,
      revision: this.state.revision + 1,
    });
  }
}

export const assembleStore = new AssembleStore();

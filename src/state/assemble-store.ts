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
  setKern,
  tweak,
  type Assembly,
  type Piece,
  type Tweak,
} from "@/assemble/document";
import { build } from "@/assemble/document";
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
    if (!this.gestureOpen) {
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
    this.set({
      assembly: next,
      canUndo: true,
      canRedo: this.future.length > 0,
      revision: this.state.revision + 1,
    });
  }
}

export const assembleStore = new AssembleStore();

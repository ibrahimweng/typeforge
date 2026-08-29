/**
 * The state of a font being traced and reshaped.
 *
 * A third document beside the forged font and the imported one, and separate
 * for the same reason those two are separate from each other: what it holds is
 * neither a description that generates letters nor outlines somebody else drew,
 * but strokes recovered from ink. Folding it into either would mean every field
 * carrying a note about which of three things it belonged to.
 *
 * Undo is a stack of whole documents, as it is next door. A traced alphabet is
 * a few hundred strokes and the hand laid over them; keeping the last fifty of
 * those costs far less than machinery for reversing a slider.
 *
 * What is *not* undoable is the tracing itself. Reading a font in replaces the
 * whole document, and offering to step back into the letters from a different
 * font would be offering a state nobody was ever in.
 */

import { importFont } from "@/font/parse";
import { PLAIN_HAND, restyle, type QuillStyle } from "@/quill/controls";
import { fitGlyph } from "@/quill/fit";
import { sweepAll } from "@/quill/sweep";
import type { QuillGlyph } from "@/quill/types";
import type { Contour } from "@/font/types";

/** Where a change falls in a drag, exactly as the forge means it. */
export type Phase = "single" | "during" | "end";

/** One traced letter: the strokes as read, and what they cost to read. */
export interface Traced {
  glyph: QuillGlyph;
  /** How far the redrawing strayed from the outline it was read from. */
  deviation: number;
  /** The outline it was read from, kept so the two can be compared on screen. */
  source: Contour[];
}

export interface QuillDocument {
  /** The letters, by name, in the order they were read. */
  letters: Traced[];
  /** The hand laid over all of them. */
  style: QuillStyle;
  /** Where the letters came from, for the panel to say. */
  from: string;
  unitsPerEm: number;
}

export interface QuillState {
  document: QuillDocument;
  /** Which letter the editor is showing. */
  letter: string;
  /** Whether the source outline is shown underneath the redrawing. */
  showSource: boolean;
  /** Whether the recovered centre-lines are drawn over it. */
  showSpines: boolean;
  /** True while a font is being read, which takes a moment. */
  tracing: boolean;
  /** What went wrong, if anything did. */
  trouble: string | null;
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
}

const EMPTY: QuillDocument = {
  letters: [],
  style: { ...PLAIN_HAND },
  from: "",
  unitsPerEm: 1000,
};

/*
 * The letters read from a font, and why it is only these.
 *
 * The lowercase is where a script lives and where the fitter has been measured;
 * the capitals and the figures are read too because a font that gives back
 * twenty-six letters is a demonstration rather than a font. What is left out is
 * everything built from a base and a mark -- an accented letter is its base
 * moved, so tracing it separately would trace the same strokes twice and give
 * two copies that drift apart the first time one is edited.
 */
const WANTED =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?'\"-".split("");

class QuillStore {
  private state: QuillState = {
    document: EMPTY,
    letter: "a",
    showSource: true,
    showSpines: false,
    tracing: false,
    trouble: null,
    canUndo: false,
    canRedo: false,
    revision: 0,
  };

  private past: QuillDocument[] = [];
  private future: QuillDocument[] = [];
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): QuillState => this.state;

  private set(patch: Partial<QuillState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /**
   * Whether a drag is open, and therefore whether the next change folds in.
   *
   * Without this a single drag of a slider would push sixty documents onto the
   * undo stack and one press of undo would step back a sixtieth of the way.
   */
  private gestureOpen = false;

  private commit(next: QuillDocument, phase: Phase): void {
    if (phase === "single" || !this.gestureOpen) {
      this.past.push(this.state.document);
      if (this.past.length > 50) this.past.shift();
      this.future = [];
    }
    this.gestureOpen = phase === "during";
    this.set({
      document: next,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      revision: this.state.revision + 1,
    });
  }

  // --- reading a font in -----------------------------------------------------

  /**
   * Read a font and recover strokes from every letter it has.
   *
   * Slow enough to be worth saying so -- a hundred and sixty milliseconds a
   * letter, most of it in the distance transform -- which is why `tracing` is a
   * field rather than something the caller is left to guess at.
   */
  async trace(bytes: Uint8Array, name: string): Promise<void> {
    this.set({ tracing: true, trouble: null });
    try {
      const { typeface } = await importFont(bytes, name);
      const em = typeface.unitsPerEm ?? 1000;
      const byChar = new Map<string, (typeof typeface.glyphs)[number]>();
      for (const glyph of typeface.glyphs) {
        for (const code of glyph.unicodes ?? []) byChar.set(String.fromCodePoint(code), glyph);
      }
      const letters: Traced[] = [];
      for (const character of WANTED) {
        const found = byChar.get(character);
        if (!found?.contours?.length) continue;
        const fitted = fitGlyph(character, found.contours, found.advanceWidth, { unitsPerEm: em });
        if (!fitted || fitted.glyph.strokes.length === 0) continue;
        letters.push({
          glyph: fitted.glyph,
          deviation: fitted.spineDeviation,
          source: found.contours,
        });
      }
      if (letters.length === 0) {
        this.set({ tracing: false, trouble: "Nothing in that font came back as strokes." });
        return;
      }
      this.past = [];
      this.future = [];
      this.set({
        document: {
          letters,
          style: { ...PLAIN_HAND },
          from: name,
          unitsPerEm: em,
        },
        letter: letters.find((one) => one.glyph.name === "a")?.glyph.name ?? letters[0].glyph.name,
        tracing: false,
        trouble: null,
        canUndo: false,
        canRedo: false,
        revision: this.state.revision + 1,
      });
    } catch (trouble) {
      this.set({
        tracing: false,
        trouble: trouble instanceof Error ? trouble.message : "That file could not be read.",
      });
    }
  }

  // --- the hand --------------------------------------------------------------

  /** Change one setting of the hand, which reaches every letter at once. */
  changeStyle(patch: Partial<QuillStyle>, phase: Phase = "single"): void {
    this.commit(
      { ...this.state.document, style: { ...this.state.document.style, ...patch } },
      phase,
    );
  }

  /** Put the hand back where it started, leaving the strokes alone. */
  resetStyle(): void {
    this.commit({ ...this.state.document, style: { ...PLAIN_HAND } }, "single");
  }

  setLetter(letter: string): void {
    this.set({ letter });
  }

  setShowSource(showSource: boolean): void {
    this.set({ showSource });
  }

  setShowSpines(showSpines: boolean): void {
    this.set({ showSpines });
  }

  clearTrouble(): void {
    this.set({ trouble: null });
  }

  undo(): void {
    const back = this.past.pop();
    if (!back) return;
    this.future.push(this.state.document);
    this.gestureOpen = false;
    this.set({
      document: back,
      canUndo: this.past.length > 0,
      canRedo: true,
      revision: this.state.revision + 1,
    });
  }

  redo(): void {
    const forward = this.future.pop();
    if (!forward) return;
    this.past.push(this.state.document);
    this.gestureOpen = false;
    this.set({
      document: forward,
      canUndo: true,
      canRedo: this.future.length > 0,
      revision: this.state.revision + 1,
    });
  }
}

export const quillStore = new QuillStore();

/**
 * One letter, drawn with the hand currently set.
 *
 * Free of the store on purpose, so the view, the specimen strip and anything
 * else that needs a letter all go through one function and cannot come to
 * disagree about what the sliders mean.
 */
export function drawTraced(traced: Traced, style: QuillStyle) {
  const moved = restyle(traced.glyph, style);
  const drawn = sweepAll(moved.strokes);
  return { contours: drawn.contours, advanceWidth: moved.advanceWidth, exactness: drawn.exactness };
}

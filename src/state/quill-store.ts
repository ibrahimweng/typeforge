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

import { PLAIN_HAND, restyle, type QuillStyle } from "@/quill/controls";
import type { JoinedVerdict } from "@/quill/joined";
import { sweepAll, toleranceFor } from "@/quill/sweep";
import { linesOf } from "@/quill/typeface";
import type { Contour, Glyph, VerticalMetrics } from "@/font/types";
import type { QuillGlyph } from "@/quill/types";
import type { TracedProject } from "@/project/format";
import {
  traceFont,
  type TraceMessage,
  type TraceProgress,
  type Traced,
  type TraceResult,
} from "@/quill/tracing";

export type { Traced, TraceProgress } from "@/quill/tracing";

/**
 * A name for the font going out, from the name of the file that came in.
 *
 * "DancingScript.ttf" suggests "DancingScript Traced" rather than
 * "DancingScript", because the second is a claim and the first is a
 * description. Somebody will rename it; what matters is that the field never
 * arrives pre-filled with a name this font is not entitled to.
 */
/*
 * Nothing here is rounded, and that is a decision with a measurement behind it.
 *
 * Rounding the saved coordinates is the obvious economy and it was tried. What
 * it costs is not obvious at all: these are *spine* coordinates, and the ink is
 * that spine offset by half a stroke width and then refitted to cubics -- so a
 * nudge to a centre-line point arrives at the edge of the letter magnified by
 * about two hundred and fifty times, because it can flip where the offset
 * fitter chooses to subdivide.
 *
 * Measured across a traced alphabet, worst case, at the edge of the ink:
 *
 *   no rounding    0.000 units      857 KB
 *   6 places       0.004 units
 *   4 places       0.245 units
 *   3 places       0.969 units      639 KB
 *   2 places       5.504 units      607 KB
 *
 * Two places -- which looked entirely safe, a hundredth of a unit -- moves a
 * letter's edge by five and a half units. So the saving is real and small (a
 * quarter of the file) and the cost is a document that does not come back the
 * same. What is written is what the engine holds, and a reopened trace redraws
 * the identical ink rather than nearly identical ink.
 */

export function suggestedName(fileName: string): string {
  const stem = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return stem ? `${stem} Traced` : "Traced";
}

/** Where a change falls in a drag, exactly as the forge means it. */
export type Phase = "single" | "during" | "end";

export interface QuillDocument {
  /** The letters, by name, in the order they were read. */
  letters: Traced[];
  /** The hand laid over all of them. */
  style: QuillStyle;
  /** Where the letters came from, for the panel to say. */
  from: string;
  /**
   * The pen this font reads as having been written with, if one explains it.
   *
   * Read out of the whole alphabet at once and reported rather than applied,
   * for the reasons `tracing.ts` sets out beside the measurement. Worth saying
   * even so: "this face reads as a pen held at ten degrees with a blade of
   * 0.38" is a fact about the drawing that somebody about to reshape it wants,
   * and it is the difference between a slider they are guessing with and one
   * they know what to do with.
   */
  hand: { contrast: number; angle: number; flatter: number } | null;
  /**
   * What the font going out is called.
   *
   * Separate from `from`, and it has to be. `from` is the file the strokes were
   * read out of and never changes; this is the name of the new thing, which
   * somebody types. A traced face that exported under the name of the font it
   * derives from would be claiming to be that font.
   */
  name: string;
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
  /**
   * How far through a font the tracing is, or null when nothing is being read.
   *
   * A count rather than a flag, because the thing it describes takes most of a
   * minute and a spinner that says only "working" for that long is
   * indistinguishable from one that has hung.
   */
  progress: TraceProgress | null;
  /** What went wrong, if anything did. */
  trouble: string | null;
  /**
   * The evidence that sent this font here, when it was not asked for by hand.
   *
   * A font opened anywhere in the application is measured, and one whose
   * letters join is read into strokes here rather than opened as outlines next
   * door -- because the controls next door cannot reach what a script is made
   * of. That is a decision taken on somebody's behalf, so the reason for it is
   * kept and shown rather than left to be inferred from the application having
   * moved on its own. Null where a font was read from the panel deliberately.
   */
  routed: JoinedVerdict | null;
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
}

const EMPTY: QuillDocument = {
  letters: [],
  style: { ...PLAIN_HAND },
  from: "",
  hand: null,
  name: "",
  unitsPerEm: 1000,
};

class QuillStore {
  private state: QuillState = {
    document: EMPTY,
    letter: "a",
    showSource: true,
    showSpines: false,
    progress: null,
    trouble: null,
    routed: null,
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

  /** The worker doing the reading, while one is. */
  private worker: Worker | null = null;

  /**
   * Which read is the current one.
   *
   * Reading a second font while the first is still going is an ordinary thing
   * to do -- the first takes most of a minute -- and without a token the slow
   * one would post its letters over the top of the quick one whenever it
   * happened to finish second. Every message carries the token it was started
   * under and anything from an older read is dropped.
   */
  private reading = 0;

  /** Stop whatever is being read, and stop listening to it. */
  private stopReading(): void {
    this.worker?.terminate();
    this.worker = null;
    this.reading++;
  }

  /**
   * Read a font and recover strokes from every letter it has.
   *
   * In a worker, because the arithmetic has no waiting in it: a couple of
   * hundred milliseconds a letter and seventy letters, during which a tab doing
   * it inline answers nothing at all -- not a scroll, not the cancel button,
   * not even a spinner, because the frame that would turn the spinner never
   * runs. Off the thread the page stays live and can say how far along it is.
   *
   * Where there is no worker -- a test, or a browser without module workers --
   * it runs inline and reports progress just the same. That path is slow and
   * blocking and is not pretended otherwise; it is there so the behaviour is
   * degraded rather than absent.
   *
   * `routed` carries the measurement that sent a font here on its own, and is
   * null when somebody asked for this font by name. It is set at the start
   * rather than at the end because it explains the minute of tracing as well as
   * the letters, and a reason that only appears once the work is finished has
   * arrived too late to be the reason for anything.
   */
  async trace(bytes: Uint8Array, name: string, routed: JoinedVerdict | null = null): Promise<void> {
    this.stopReading();
    const mine = this.reading;
    this.set({ progress: { done: 0, total: 0, letter: "" }, trouble: null, routed });

    const arrived = (result: TraceResult) => {
      if (mine !== this.reading) return;
      if (result.letters.length === 0) {
        this.set({ progress: null, trouble: "Nothing in that font came back as strokes." });
        return;
      }
      this.past = [];
      this.future = [];
      this.set({
        document: {
          letters: result.letters,
          style: { ...PLAIN_HAND },
          from: name,
          hand: result.hand
            ? {
                contrast: result.hand.contrast,
                angle: result.hand.angle,
                flatter: 1 - result.hand.spread / result.hand.roundSpread,
              }
            : null,
          // A first guess rather than a decision: the source file's name with
          // "Traced" on it, so the field is never empty and never silently the
          // other font's name either.
          name: suggestedName(name),
          unitsPerEm: result.unitsPerEm,
        },
        letter:
          result.letters.find((one) => one.glyph.name === "a")?.glyph.name ??
          result.letters[0].glyph.name,
        progress: null,
        trouble: null,
        canUndo: false,
        canRedo: false,
        revision: this.state.revision + 1,
      });
    };

    const wentWrong = (why: string) => {
      if (mine !== this.reading) return;
      this.set({ progress: null, trouble: why });
    };

    if (typeof Worker === "undefined") {
      try {
        arrived(
          await traceFont(bytes, name, (progress) => {
            if (mine === this.reading) this.set({ progress });
          }),
        );
      } catch (trouble) {
        wentWrong(trouble instanceof Error ? trouble.message : "That file could not be read.");
      }
      return;
    }

    /*
     * The bytes are handed over rather than copied.
     *
     * A font is a megabyte or two and structured-cloning it costs a copy at
     * each end; transferring the buffer costs neither. It does empty the array
     * on this side, which is why a fresh copy is taken first -- the caller
     * handed us their bytes and is entitled to still have them afterwards.
     */
    const carried = bytes.slice().buffer;
    try {
      const worker = new Worker(new URL("../quill/trace-worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<TraceMessage>) => {
        if (mine !== this.reading) return;
        const message = event.data;
        if (message.kind === "progress") this.set({ progress: message.progress });
        else if (message.kind === "done") {
          this.worker = null;
          worker.terminate();
          arrived(message.result);
        } else {
          this.worker = null;
          worker.terminate();
          wentWrong(message.why);
        }
      };
      // A worker that dies rather than replying would otherwise leave the bar
      // sitting still for ever.
      worker.onerror = () => {
        this.worker = null;
        worker.terminate();
        wentWrong("The tracing stopped unexpectedly.");
      };
      worker.postMessage({ bytes: carried, name }, [carried]);
    } catch {
      // Some environments have `Worker` and refuse to build one. Falling back
      // is better than telling somebody their font is broken when it is not.
      try {
        arrived(
          await traceFont(bytes, name, (progress) => {
            if (mine === this.reading) this.set({ progress });
          }),
        );
      } catch (trouble) {
        wentWrong(trouble instanceof Error ? trouble.message : "That file could not be read.");
      }
    }
  }

  /** Give up on the read in progress and leave what was already there. */
  stopTracing(): void {
    if (!this.state.progress) return;
    this.stopReading();
    this.set({ progress: null });
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

  /** What the font going out is called. */
  setName(name: string): void {
    if (name === this.state.document.name) return;
    this.commit({ ...this.state.document, name }, "single");
  }

  /**
   * What is worth keeping, as the project format wants it.
   *
   * Null where there is nothing traced, which is what keeps a saved file from
   * claiming a half that was never opened. Written at full precision, for the
   * reason argued above the helper below.
   */
  snapshot(): TracedProject | undefined {
    const { letters, style, from, name, unitsPerEm } = this.state.document;
    if (letters.length === 0) return undefined;
    return {
      from,
      name,
      unitsPerEm,
      style: { ...style } as unknown as Record<string, number>,
      letters: letters.map((one) => ({
        name: one.glyph.name,
        advanceWidth: one.glyph.advanceWidth,
        deviation: one.deviation,
        strokes: one.glyph.strokes as unknown[],
        /*
         * Written down, because a field this enumerates is a field it can lose.
         *
         * Everything else about a traced letter is here by name, so a drawing
         * left out would be gone the moment somebody saved -- and would look
         * like the drawing had never been made rather than like a bug.
         */
        ...(one.byHand
          ? {
              byHand: {
                contours: one.byHand.contours as unknown[],
                advanceWidth: one.byHand.advanceWidth,
              },
            }
          : {}),
      })),
    };
  }

  /**
   * A saved trace, put back.
   *
   * The source outlines are not in the file and are not invented here: the
   * letters come back with an empty `source`, so the comparison overlay has
   * nothing to draw until the font is read in again. That is the honest state
   * rather than a ghost of the wrong shape, and the panel says so.
   */
  restoreSaved(saved: TracedProject): void {
    const letters: Traced[] = saved.letters.map((one) => ({
      glyph: {
        name: one.name,
        advanceWidth: one.advanceWidth,
        strokes: one.strokes as QuillGlyph["strokes"],
        unitsPerEm: saved.unitsPerEm || 1000,
      },
      deviation: one.deviation,
      source: [],
      ...(one.byHand
        ? {
            byHand: {
              contours: one.byHand.contours as Contour[],
              advanceWidth: one.byHand.advanceWidth,
            },
          }
        : {}),
    }));
    this.restore({
      letters,
      style: { ...PLAIN_HAND, ...(saved.style as unknown as Partial<QuillStyle>) },
      from: saved.from,
      /*
       * Not saved, and read again would need the source font, which a project
       * file does not carry. Null rather than a stale reading: the pen is a
       * measurement of the font that was traced, and a number from a font
       * somebody no longer has is worse than none.
       */
      hand: null,
      name: saved.name,
      unitsPerEm: saved.unitsPerEm || 1000,
    });
  }

  /**
   * Put a whole traced document back, as a saved project reopens it.
   *
   * Not undoable, and for the same reason reading a font in is not: what it
   * replaces is the entire document, and offering to step back into the letters
   * of a different font would be offering a state nobody was ever in.
   */
  restore(document: QuillDocument): void {
    this.stopReading();
    this.past = [];
    this.future = [];
    this.set({
      document,
      letter:
        document.letters.find((one) => one.glyph.name === "a")?.glyph.name ??
        document.letters[0]?.glyph.name ??
        "a",
      progress: null,
      trouble: null,
      routed: null,
      canUndo: false,
      canRedo: false,
      revision: this.state.revision + 1,
    });
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

  // --- one letter, by hand ------------------------------------------------

  /**
   * This letter as a glyph, ready to be put on the editor's desk.
   *
   * The letter as it is currently drawn, hand and all, because that is what a
   * person looking at it has in front of them and what they mean when they ask
   * to move a point on it. Where the forge sends its *solid* letter -- the one
   * its cuts have not been applied to -- there is no equivalent here: a traced
   * face has no cuts, so what is on screen is the whole of it.
   */
  letterAsGlyph(letter?: string): {
    glyph: Glyph;
    unitsPerEm: number;
    metrics: VerticalMetrics;
    family: string;
  } | null {
    const name = letter ?? this.state.letter;
    const { document } = this.state;
    const traced = document.letters.find((one) => one.glyph.name === name);
    if (!traced) return null;
    const drawn = drawTraced(traced, document.style);
    const em = document.unitsPerEm;
    return {
      glyph: {
        name,
        unicodes: [...name].map((one) => one.codePointAt(0)!),
        advanceWidth: drawn.advanceWidth,
        contours: drawn.contours.map((one) => ({
          ...one,
          nodes: one.nodes.map((node) => ({ ...node })),
        })),
        components: [],
        anchors: [],
        params: {},
        dirty: false,
      },
      unitsPerEm: em,
      /*
       * Read off the letters rather than declared, because a traced font has no
       * metrics of its own: what came in was outlines, and what is known about
       * where its lines fall is where its letters actually reach.
       */
      metrics: {
        ...linesOf(
          new Map(
            document.letters.map((one) => [
              one.glyph.name,
              { contours: drawTraced(one, document.style).contours },
            ]),
          ),
          em,
        ),
        lineGap: 0,
      },
      family: document.name,
    };
  }

  /**
   * Take a drawn letter into the font, standing where its strokes were.
   *
   * Undoable like every other change here, and it needs to be more than most:
   * this is the one edit that puts an outline where a description was, and
   * finding out you would rather have kept the strokes should cost one
   * keystroke.
   */
  takeLetter(letter: string, contours: Contour[], advanceWidth: number): void {
    const { document } = this.state;
    this.commit(
      {
        ...document,
        letters: document.letters.map((one) =>
          one.glyph.name === letter ? { ...one, byHand: { contours, advanceWidth } } : one,
        ),
      },
      "single",
    );
    this.set({ letter });
  }

  /** Put a drawn letter back under the hand, to be swept from its strokes again. */
  redrawLetter(letter?: string): void {
    const name = letter ?? this.state.letter;
    const { document } = this.state;
    this.commit(
      {
        ...document,
        letters: document.letters.map((one) => {
          if (one.glyph.name !== name || !one.byHand) return one;
          const { byHand: _gone, ...rest } = one;
          return rest;
        }),
      },
      "single",
    );
  }

  /** Whether this letter is an outline somebody drew rather than strokes. */
  drawnByHand(letter?: string): boolean {
    const name = letter ?? this.state.letter;
    return Boolean(this.state.document.letters.find((one) => one.glyph.name === name)?.byHand);
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
  /*
   * A letter somebody drew is what it is, and the hand does not reach it.
   *
   * Said here rather than at each caller because every one of them goes through
   * this function -- which is why it exists -- and a letter that answered the
   * sliders in the specimen strip and not on the canvas would be worse than one
   * that answered them nowhere.
   */
  if (traced.byHand) {
    return {
      contours: traced.byHand.contours,
      advanceWidth: traced.byHand.advanceWidth,
      exactness: { exact: true, deviation: 0 },
    };
  }
  const moved = restyle(traced.glyph, style);
  const drawn = sweepAll(moved.strokes, toleranceFor(moved.unitsPerEm));
  return { contours: drawn.contours, advanceWidth: moved.advanceWidth, exactness: drawn.exactness };
}

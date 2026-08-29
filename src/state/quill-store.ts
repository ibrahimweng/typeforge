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
import { sweepAll } from "@/quill/sweep";
import { traceFont, type TraceMessage, type TraceProgress, type Traced } from "@/quill/tracing";

export type { Traced, TraceProgress } from "@/quill/tracing";

/** Where a change falls in a drag, exactly as the forge means it. */
export type Phase = "single" | "during" | "end";

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

class QuillStore {
  private state: QuillState = {
    document: EMPTY,
    letter: "a",
    showSource: true,
    showSpines: false,
    progress: null,
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
   */
  async trace(bytes: Uint8Array, name: string): Promise<void> {
    this.stopReading();
    const mine = this.reading;
    this.set({ progress: { done: 0, total: 0, letter: "" }, trouble: null });

    const arrived = (result: { letters: Traced[]; unitsPerEm: number }) => {
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
        arrived(await traceFont(bytes, name, (progress) => {
          if (mine === this.reading) this.set({ progress });
        }));
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
        arrived(await traceFont(bytes, name, (progress) => {
          if (mine === this.reading) this.set({ progress });
        }));
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

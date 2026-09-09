/**
 * The undo pair for whichever document is in front.
 *
 * Four documents keep four histories -- the imported font, the parametric
 * drawing, the traced strokes and the pile of assembled artwork -- because
 * they are four documents. Anything offering to undo has to ask the one being
 * looked at, and there are two of those now: the buttons in the top bar and
 * the Edit menu. Wired twice they would disagree the first time a fifth
 * document appeared, and they would disagree by greying out a control that
 * should work, which reads as the history being empty rather than as the
 * wiring being wrong.
 *
 * The names come with it, and only from the editor, because only the editor's
 * stack has names on it. The three generators undo a whole set of parameters
 * at once and the alphabet redraws in front of you; in the editor the step
 * taken back can be a point in a letter you are no longer looking at, and
 * "Undo" alone does not say which.
 */

import type { Mode } from "@/App";
import { redoDrawing, undoDrawing, useDrawing } from "@/state/drawn";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { quillStore, useQuill } from "@/state/useQuill";
import { store, useAppState } from "@/state/useStore";

export interface History {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** What the step is called, where the stack knows. */
  undoLabel?: string | null;
  redoLabel?: string | null;
}

export function useHistory(mode: Mode): History {
  const state = useAppState();
  const drawn = useDrawing();
  const assemble = useAssemble();
  const quill = useQuill();

  if (mode === "forge") {
    return {
      undo: () => void undoDrawing(),
      redo: () => void redoDrawing(),
      canUndo: drawn.canUndo,
      canRedo: drawn.canRedo,
    };
  }
  if (mode === "assemble") {
    return {
      undo: () => assembleStore.undo(),
      redo: () => assembleStore.redo(),
      canUndo: assemble.canUndo,
      canRedo: assemble.canRedo,
    };
  }
  if (mode === "quill") {
    return {
      undo: () => quillStore.undo(),
      redo: () => quillStore.redo(),
      canUndo: quill.canUndo,
      canRedo: quill.canRedo,
    };
  }
  return {
    undo: () => store.undo(),
    redo: () => store.redo(),
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undoLabel: state.undoLabel,
    redoLabel: state.redoLabel,
  };
}

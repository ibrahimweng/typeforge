/**
 * The strip above a letter that does not belong to this document.
 *
 * A loan is a parenthesis, and a parenthesis that is not visible is a trap.
 * What is on the canvas looks exactly like an ordinary letter of an ordinary
 * font -- the tools are the same tools, the guides are in the same places --
 * and it is not one: it came out of Draw, the font that was open has been put
 * aside, and it is going back the moment somebody says so. Every one of those
 * is worth knowing before the next click rather than after it.
 *
 * Two ways out and no third, which is the point. The tabs are not one: walking
 * to another tab in the middle of a loan would leave the borrowed letter on the
 * desk and the real document in a drawer, and nothing on screen to say why the
 * font you opened this morning is not there. So the strip says whose letter
 * this is, and the only exits from it are keeping the drawing and throwing it
 * away.
 */

import type * as React from "react";

import { forgeStore } from "@/state/useForge";
import { quillStore } from "@/state/useQuill";
import { store, useAppState } from "@/state/useStore";

export function OnLoan(): React.JSX.Element | null {
  const { loan } = useAppState();
  if (!loan) return null;

  const keep = (): void => {
    const from = loan.from;
    const kept = store.keepLoan();
    if (kept && from === "forge") {
      /*
       * In through the same door a file comes in by.
       *
       * `takeLetter` is what the SVG round trip has always used, and using it
       * here is not a shortcut: it is the same decision with the same
       * consequences -- the letter becomes an outline, keeps its advance, and
       * is one keystroke from being undone -- so it had better be the same
       * call, or the two ways in would come to disagree about what they mean.
       */
      forgeStore.takeLetter(
        {
          note: null,
          letter: kept.letter,
          contours: kept.contours,
          advanceWidth: kept.advanceWidth,
          mismatched: false,
        },
        "the tools here",
      );
    }
    if (kept && from === "quill") {
      quillStore.takeLetter(kept.letter, kept.contours, kept.advanceWidth);
    }
    store.askForMode(from);
  };

  const drop = (): void => {
    const from = loan.from;
    store.dropLoan();
    store.askForMode(from);
  };

  return (
    <div
      data-on-loan={loan.letter}
      className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-1.5"
    >
      <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
        <span className="font-medium text-foreground">{loan.letter}</span> of{" "}
        {loan.family || "Untitled"}, on loan from {loan.from === "forge" ? "Draw" : "Trace"}.
        Keeping it makes this letter your drawing: it holds its advance and stops answering the
        controls that drew it.
      </p>
      <button
        type="button"
        onClick={keep}
        data-loan-keep
        className="shrink-0 rounded-md border border-accent px-2 py-1 text-2xs text-foreground transition-colors hover:bg-accent/10"
      >
        Keep the drawing
      </button>
      <button
        type="button"
        onClick={drop}
        data-loan-drop
        className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
      >
        Throw it away
      </button>
    </div>
  );
}

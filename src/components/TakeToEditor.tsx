/**
 * The way out of a generator and into the tools.
 *
 * Draw and Trace do not hold outlines. A letter in Draw is a description --
 * a skeleton, a pen, a set of parts -- and a letter in Trace is a set of
 * strokes with widths along them; both are redrawn from scratch every time a
 * slider moves. So the point tools cannot be put in either of them: dragging a
 * node would be undone by the next parameter change, and a tool that loses
 * your work as soon as you touch anything else is worse than no tool.
 *
 * What can be done is the other direction. Both engines already know how to
 * build a real typeface -- it is what their export dialogs do -- and until now
 * that typeface only ever went into a file. This takes it into the editor
 * instead, where every tool in the application is waiting for it.
 *
 * It is a one-way door and says so. The letters that arrive are outlines and
 * have stopped answering to the sliders that drew them, which is exactly what
 * somebody who wants to move a point is asking for, and exactly what somebody
 * who wanted to keep adjusting the weight is not.
 */

import * as React from "react";

import { cn } from "@/ui/lib/utils";

export function TakeToEditor({
  onEdit,
  what,
  disabled,
}: {
  onEdit: () => Promise<void>;
  /** What is about to be handed over, for the sentence under the button. */
  what: string;
  disabled?: boolean;
}): React.JSX.Element {
  const [working, setWorking] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const go = async (): Promise<void> => {
    setWorking(true);
    setProblem(null);
    try {
      await onEdit();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The letters could not be handed over.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="border-t border-border p-3" data-take-to-editor>
      <button
        type="button"
        onClick={() => void go()}
        disabled={disabled || working}
        title={`Draws ${what} once, with the strokes fused and the kerning measured, and opens them in the editor with the pen, the shapes, the knife and the rest of the tools. They arrive as outlines and stop answering to these controls, so this is a step forward rather than a way of looking.`}
        className={cn(
          "w-full rounded border border-border px-2 py-1.5 text-2xs transition-colors",
          "hover:border-accent hover:text-foreground disabled:opacity-40 disabled:hover:border-border",
        )}
      >
        {working ? "Drawing every letter…" : "Edit these letters"}
      </button>
      {/*
        Two lines, with the rest on the hover.

        The first version said the whole thing here -- what gets built, which
        tools are waiting, and that it is a one-way door -- and took five lines
        of a panel that has none to spare, permanently, to explain a button
        most people press once. What has to be on the face is the part that
        cannot be undone.
      */}
      <p className="pt-2 text-2xs leading-relaxed text-muted-foreground">
        {problem ?? "They arrive as outlines and stop answering to these controls."}
      </p>
    </section>
  );
}

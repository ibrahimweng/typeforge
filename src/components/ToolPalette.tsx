/**
 * The tools, down the left of the canvas.
 *
 * They were a segmented strip in the toolbar, which worked for two of them and
 * stopped working at five: the toolbar already shares its line with the mode
 * switch, the view switch, the font's name and the export button, and it had
 * already been taught to wrap once. Three more buttons put the glyph view on
 * two rows at fourteen hundred pixels while every other view stayed on one --
 * so switching to Glyph moved the canvas down, and switching away moved it
 * back. A toolbar that changes height when you change view is a toolbar that
 * makes the page jump under the pointer.
 *
 * Down the side, floating over the canvas, it costs no layout at all and has
 * room for the tools still to come. It is also where every drawing application
 * has put its tools since MacPaint, which is the other half of the argument:
 * somebody looking for the knife looks down the left.
 *
 * Mounted by whatever draws a letter, rather than by the chrome, so the tools
 * arrive wherever letters are drawn and nowhere else.
 */

import * as React from "react";
import {
  CircleIcon,
  CursorIcon,
  KnifeIcon,
  PenNibIcon,
  PencilSimpleIcon,
  RectangleIcon,
  type Icon,
} from "@phosphor-icons/react";

import { store, useAppState, type ToolId } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

/*
 * A drawn icon rather than a word for each, and the word on the hover.
 *
 * Five words down the side of a canvas is a column eighty pixels wide taken
 * out of the drawing. The first version of this used the nearest characters --
 * an arrow, a nib, a square, a circle, a pair of scissors -- and they came out
 * at five different weights and two different sizes, because a text font's
 * dingbats were drawn by different people for different purposes. These come
 * from the icon set the rest of the application already uses.
 *
 * The single key each answers to is on the hover with the name, because that
 * is where somebody looks the first time and never again.
 */
const TOOLS: Array<{ id: ToolId; mark: Icon; name: string; hint: string; key: string }> = [
  { id: "select", mark: CursorIcon, name: "Select", key: "V", hint: "Select and move points" },
  { id: "pen", mark: PenNibIcon, name: "Pen", key: "P", hint: "Add points to an outline" },
  {
    id: "pencil",
    mark: PencilSimpleIcon,
    name: "Pencil",
    key: "B",
    hint: "Draw freehand. The line is fitted to curves when you let go, and closes if you come back to where you started",
  },
  {
    id: "rectangle",
    mark: RectangleIcon,
    name: "Rectangle",
    key: "R",
    hint: "Drag a rectangle. Shift for a square, alt from the middle",
  },
  {
    id: "ellipse",
    mark: CircleIcon,
    name: "Ellipse",
    key: "O",
    hint: "Drag an ellipse. Shift for a circle, alt from the middle",
  },
  {
    id: "knife",
    mark: KnifeIcon,
    name: "Knife",
    key: "K",
    hint: "Drag a line right across a shape to cut it in two",
  },
];

const BY_KEY = new Map(TOOLS.map((tool) => [tool.key.toLowerCase(), tool.id]));

export function ToolPalette(): React.JSX.Element {
  const state = useAppState();

  /*
   * The single-key shortcuts, here rather than in the toolbar.
   *
   * They belong with the thing they switch, and here they are bound only while
   * something is drawing a letter -- so pressing `k` in the kerning table
   * types a `k` into the preview instead of arming a knife nobody can see.
   */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tool = BY_KEY.get(event.key.toLowerCase());
      if (tool) store.setTool(tool);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    /*
      A column of its own rather than a box floating over the drawing.

      Floating cost nothing in layout and covered the word `ascender`, which is
      drawn at the left edge of the canvas along with the other four metric
      names. Thirty-six pixels of a canvas eleven hundred wide is a cheaper
      thing to give up than a label somebody is reading the letter against.
    */
    <div
      role="group"
      aria-label="Tool"
      data-tool-palette
      className="flex shrink-0 flex-col gap-0.5 border-r border-border bg-background p-1"
    >
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          aria-label={tool.name}
          aria-pressed={state.tool === tool.id}
          title={`${tool.name} — ${tool.hint} (${tool.key})`}
          onClick={() => store.setTool(tool.id)}
          data-tool={tool.id}
          data-phase={state.tool === tool.id ? state.toolState.phase : "off"}
          className={cn(
            "relative flex h-7 w-7 items-center justify-center rounded text-xs-plus leading-none",
            "transition-colors",
            /*
              Hover did nothing at all. The class was `hover:bg-background` and
              the rail it sits in *is* `bg-background`, so pointing at a tool
              changed exactly nothing -- it looked deliberate and had been dead
              the whole time. `bg-card` is the surface everything else here uses
              for a thing under the pointer.
            */
            state.tool !== tool.id && "text-muted-foreground hover:bg-card hover:text-foreground",
            /*
              And what the tool in hand is doing. Held apart from selected
              rather than replacing it: a tool mid-gesture is still the tool
              that is picked, and losing the accent while drawing would read as
              the tool letting go.
            */
            state.tool === tool.id && "bg-accent text-accent-foreground",
            state.tool === tool.id && state.toolState.phase === "active" && "ring-1 ring-accent/60",
            state.tool === tool.id &&
              state.toolState.phase === "willDo" &&
              "ring-2 ring-[color:var(--attention)]",
          )}
        >
          <tool.mark size={15} weight={state.tool === tool.id ? "fill" : "regular"} />
          {/*
            One dot for "this tool is part way through something", which is the
            state a tool used to have no way of showing at all. Under the icon
            rather than over it, so it never covers the mark somebody is
            reading the button by.
          */}
          {state.tool === tool.id && state.toolState.phase !== "idle" && (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute bottom-0.5 h-0.5 w-0.5 rounded-full",
                state.toolState.phase === "willDo"
                  ? "bg-[color:var(--attention)]"
                  : "bg-accent-foreground/70",
              )}
            />
          )}
        </button>
      ))}
    </div>
  );
}

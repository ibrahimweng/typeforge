/**
 * The tools, down the left of the canvas, in groups with a flyout.
 *
 * They were a segmented strip in the toolbar, which worked for two of them and
 * stopped working at five; then a flat column, which worked for six and stops
 * at thirteen. Thirteen icons down a rail is thirteen things to tell apart at
 * fifteen pixels each, and the four pen tools would sit among them looking like
 * four unrelated ideas rather than the four verbs of one.
 *
 * So one button per group, showing whichever tool of that group you used last,
 * with the rest a click away. It is what every drawing program has done since
 * Illustrator 88, and the reason is the same now as it was then: a person
 * looking for "take this point out" looks under the nib, not along a row.
 *
 * Mounted by whatever draws a letter, rather than by the chrome, so the tools
 * arrive wherever letters are drawn and nowhere else.
 */

import * as React from "react";
import {
  ArrowsOutCardinalIcon,
  CircleIcon,
  CursorIcon,
  type Icon,
  KnifeIcon,
  LassoIcon,
  MinusCircleIcon,
  PenNibIcon,
  PencilSimpleIcon,
  PlusCircleIcon,
  PolygonIcon,
  RectangleIcon,
  ScissorsIcon,
  SelectionIcon,
} from "@phosphor-icons/react";

import { GROUPS, TOOLS, groupOf, toolsIn, type GroupId, type ToolInfo } from "@/font/toolset";
import { store, useAppState, type ToolId } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

/*
 * A drawn icon rather than a word for each, and the word on the flyout.
 *
 * Thirteen words down the side of a canvas is a column eighty pixels wide taken
 * out of the drawing. The first version of this used the nearest characters --
 * an arrow, a nib, a square, a circle, a pair of scissors -- and they came out
 * at five different weights and two different sizes, because a text font's
 * dingbats were drawn by different people for different purposes. These come
 * from the icon set the rest of the application already uses.
 */
const MARKS: Record<ToolId, Icon> = {
  select: CursorIcon,
  selectPath: SelectionIcon,
  lasso: LassoIcon,
  pen: PenNibIcon,
  freehand: PencilSimpleIcon,
  addPoint: PlusCircleIcon,
  deletePoint: MinusCircleIcon,
  convertPoint: ArrowsOutCardinalIcon,
  rectangle: RectangleIcon,
  ellipse: CircleIcon,
  polygon: PolygonIcon,
  knife: KnifeIcon,
  scissors: ScissorsIcon,
};

const BY_KEY = new Map(GROUPS.map((group) => [group.key.toLowerCase(), group.id]));

export function ToolPalette(): React.JSX.Element {
  const state = useAppState();
  const [open, setOpen] = React.useState<GroupId | null>(null);

  /*
   * The single-key shortcuts, here rather than in the toolbar.
   *
   * They belong with the thing they switch, and here they are bound only while
   * something is drawing a letter -- so pressing `k` in the kerning table
   * types a `k` into the preview instead of arming a knife nobody can see.
   *
   * One key per group, and pressing it again walks the group. Thirteen tools
   * cannot have thirteen single keys without colliding with everything else
   * the editor binds, and the group is what a person means anyway: `P` for
   * "the pen, whichever of them I had".
   */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") {
        setOpen(null);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const group = BY_KEY.get(event.key.toLowerCase());
      if (group) {
        store.takeUpGroup(group);
        setOpen(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A click anywhere else puts the flyout away, which is what a person expects
  // of a menu and is the only way out that needs no instructions.
  React.useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-tool-palette]")) return;
      setOpen(null);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

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
      className="relative flex shrink-0 flex-col gap-0.5 border-r border-border bg-background p-1"
    >
      {GROUPS.map((group) => {
        const showing = state.lastInGroup[group.id];
        const here = groupOf(state.tool) === group.id;
        const Mark = MARKS[showing];
        const many = toolsIn(group.id).length > 1;

        return (
          <div key={group.id} className="relative">
            <button
              type="button"
              aria-label={group.name}
              aria-pressed={here}
              aria-haspopup={many || undefined}
              aria-expanded={many ? open === group.id : undefined}
              title={`${group.name} (${group.key})${many ? " — click and hold, or press again, for the rest" : ""}`}
              data-tool={showing}
              data-tool-group={group.id}
              data-phase={here ? state.toolState.phase : "off"}
              onClick={() => {
                /*
                 * A click takes the tool up; a click on the group you are
                 * already in opens the flyout. So the common case -- reaching
                 * for a tool you can see -- costs one click and never opens a
                 * menu, and the flyout is one click further for the case where
                 * you want a different one.
                 */
                if (here && many) setOpen(open === group.id ? null : group.id);
                else {
                  store.setTool(showing);
                  setOpen(null);
                }
              }}
              onContextMenu={(event) => {
                if (!many) return;
                event.preventDefault();
                setOpen(open === group.id ? null : group.id);
              }}
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
                !here && "text-muted-foreground hover:bg-card hover:text-foreground",
                here && "bg-accent text-accent-foreground",
                here && state.toolState.phase === "active" && "ring-1 ring-accent/60",
                here &&
                  state.toolState.phase === "willDo" &&
                  "ring-1 ring-[color:var(--attention)]",
              )}
            >
              <Mark size={15} weight={here ? "fill" : "regular"} />

              {/*
                The corner tick that says there is more under this button.

                Without it a group looks exactly like a single tool, and the
                other four pen tools might as well not exist -- which was the
                whole complaint. Bottom right, the corner every application has
                used for this since the classic Mac.
              */}
              {many && (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute right-[2px] bottom-[2px] h-0 w-0",
                    "border-r-[3px] border-b-[3px] border-l-[3px] border-transparent",
                    here ? "border-b-accent-foreground/70" : "border-b-muted-foreground/60",
                  )}
                />
              )}

              {/*
                One dot for "this tool is part way through something", which is the
                state a tool used to have no way of showing at all. Top left, out
                of the corner the flyout tick uses.
              */}
              {here && state.toolState.phase !== "idle" && (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute top-0.5 left-0.5 h-1 w-1 rounded-full",
                    state.toolState.phase === "willDo"
                      ? "bg-[color:var(--attention)]"
                      : "bg-accent-foreground/70",
                  )}
                />
              )}
            </button>

            {open === group.id && <Flyout group={group.id} onPick={() => setOpen(null)} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The group's tools, beside the rail.
 *
 * Named and described rather than a second row of icons, because the reason to
 * open this is that you do not know which icon you want. Thirteen tools where
 * six used to be is only an improvement if the twelve you are not using can be
 * read; a flyout of unlabelled marks would move the problem rather than solve
 * it.
 */
function Flyout({ group, onPick }: { group: GroupId; onPick: () => void }): React.JSX.Element {
  const state = useAppState();
  const first = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    first.current?.focus();
  }, []);

  return (
    <div
      role="menu"
      aria-label={`${group} tools`}
      data-tool-flyout={group}
      className={cn(
        "absolute top-0 left-[calc(100%+6px)] z-30 w-72 rounded-md border border-border",
        "bg-popover p-1 shadow-lg",
      )}
    >
      {toolsIn(group).map((tool, at) => (
        <FlyoutRow
          key={tool.id}
          tool={tool}
          picked={state.tool === tool.id}
          ref={at === 0 ? first : undefined}
          onPick={() => {
            store.setTool(tool.id);
            onPick();
          }}
        />
      ))}
    </div>
  );
}

const FlyoutRow = React.forwardRef<
  HTMLButtonElement,
  { tool: ToolInfo; picked: boolean; onPick: () => void }
>(function FlyoutRow({ tool, picked, onPick }, ref) {
  const Mark = MARKS[tool.id];
  return (
    <button
      ref={ref}
      type="button"
      role="menuitemradio"
      aria-checked={picked}
      data-flyout-tool={tool.id}
      onClick={onPick}
      className={cn(
        "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors",
        picked ? "bg-accent/15 text-foreground" : "text-muted-foreground hover:bg-card hover:text-foreground",
      )}
    >
      <Mark size={15} weight={picked ? "fill" : "regular"} className="mt-[1px] shrink-0" />
      <span className="min-w-0">
        <span className="block text-2xs font-medium text-foreground">{tool.name}</span>
        <span className="block text-2xs leading-snug opacity-80">{tool.hint}</span>
      </span>
    </button>
  );
});

export { TOOLS };

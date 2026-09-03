/**
 * The weights of this typeface, and which one you are drawing.
 *
 * A variable font is drawn twice and blended, and until now the application
 * could only blend: the export synthesised a bold by moving `params.weight`,
 * which offsets every node along its own normal and thickens a hairline and a
 * stem by the same amount. This is where a real one is asked for.
 *
 * Placed rather than hidden, which is the rule the whole of `docs/ease.md` is
 * built on -- and a change of mind against `docs/masters.md`'s first draft,
 * which said a font with one weight should show nothing at all about masters.
 * Nothing at all is how a feature stays undiscovered. So: one quiet line in the
 * whole-font screen, always, under a label that says what it is for; and the
 * chips to switch between them above the canvas, where the decision is taken,
 * only once there is more than one to switch between.
 */

import * as React from "react";

import { OUTLINE_ACTION, SEGMENT_TRACK, segment } from "@/components/controls";
import { lettersThatCannotVary, WGHT } from "@/font/master";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

export function Weights({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const state = useAppState();
  const [arming, setArming] = React.useState<string | null>(null);

  const masters = state.masters;
  const here = masters.find((one) => one.id === state.master);
  /*
   * How much of the font will actually move, said before the export rather than
   * in its notes afterwards. Contour and component counts only, so this is a
   * walk over the glyph list rather than over the drawing.
   */
  const stuck = React.useMemo(
    // The revision is in here because it is what says a drawing changed: the
    // master list is the same array of the same objects across an edit.
    () => lettersThatCannotVary(masters),
    [masters, state.revision],
  );

  // A switch with one thing to switch to is furniture, so above the canvas
  // this waits until there is a second weight. The line in the whole-font
  // screen is what says the second weight is possible at all.
  if (!state.typeface || masters.length === 0) return null;
  if (compact && masters.length < 2) return null;

  const chips = (
    <div className={SEGMENT_TRACK} role="group" aria-label="Weight">
      {masters.map((master) => (
        <button
          key={master.id}
          type="button"
          data-weight={master.id}
          aria-pressed={master.id === state.master}
          onClick={() => store.goToMaster(master.id)}
          title={`Draw the ${master.name} — ${master.at[WGHT] ?? 400} on the weight axis`}
          className={segment(master.id === state.master)}
        >
          {master.name}
        </button>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div
        data-weights="compact"
        className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-2xs"
      >
        <span className="text-muted-foreground">Drawing</span>
        {chips}
      </div>
    );
  }

  return (
    <div
      data-weights="full"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2 text-2xs"
    >
      <span className="text-muted-foreground">Weights</span>
      {chips}
      <button
        type="button"
        data-add-weight
        onClick={() => store.addMaster()}
        title="Copy this weight into a new one and draw it differently. The exported font blends between them."
        className={OUTLINE_ACTION}
      >
        Add a weight
      </button>
      {/*
        And what it will cost, if anything. A letter whose weights are not the
        same points in the same order has no difference to store, so it stands
        still while the rest of the font moves -- and that is a thing to know
        now rather than in the export's notes.
      */}
      {stuck.size > 0 && (
        <span data-weights-stuck={stuck.size} className="text-[var(--attention)]">
          {stuck.size} letter{stuck.size === 1 ? "" : "s"} will not vary
        </span>
      )}

      {/*
        And what to do with the one in hand, beside it rather than behind a
        dialog: its name, where it sits on the axis, and the way to be rid of
        it. All three are meaningless with one weight, so none of them is drawn.
      */}
      {here && masters.length > 1 && (
        <>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Called
            <input
              value={here.name}
              data-weight-name
              aria-label="What this weight is called"
              onChange={(event) => store.nameMaster(here.id, event.target.value)}
              className="h-6 w-24 rounded border border-input bg-card px-1.5 text-2xs text-foreground outline-none focus-visible:border-accent"
            />
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            at
            <input
              type="number"
              min={100}
              max={900}
              step={50}
              value={here.at[WGHT] ?? 400}
              data-weight-at
              aria-label="Where this weight sits on the axis"
              onChange={(event) => store.placeMaster(here.id, Number(event.target.value))}
              className="h-6 w-16 rounded border border-input bg-card px-1.5 text-2xs tabular-nums text-foreground outline-none focus-visible:border-accent"
            />
          </label>
          {/*
            Asked twice, because this is a whole alphabet and there is no undo
            behind it. Armed on the first press and said out loud on the second,
            rather than a dialog over the top of the thing being talked about.
          */}
          <button
            type="button"
            data-remove-weight
            onClick={() => {
              if (arming !== here.id) {
                setArming(here.id);
                return;
              }
              setArming(null);
              store.removeMaster(here.id);
            }}
            onBlur={() => setArming(null)}
            className={cn(
              OUTLINE_ACTION,
              "ml-auto",
              arming === here.id && "border-destructive text-destructive",
            )}
          >
            {arming === here.id ? `Throw away ${here.name}?` : "Remove this weight"}
          </button>
        </>
      )}
    </div>
  );
}

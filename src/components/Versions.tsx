/**
 * The versions of this typeface, which one you are drawing, and everywhere
 * between them.
 *
 * A variable font is drawn more than once and blended, and until this the
 * application could only blend: the export synthesised a bold by moving
 * `params.weight`, which offsets every node along its own normal and thickens a
 * hairline and a stem by the same amount. This is where real ones are asked for.
 *
 * "Versions" rather than "masters", which is the trade's word and is on the
 * hover for anybody who knows it. A person drawing their first typeface has a
 * Regular and a Bold, and those are two versions of one thing; nothing about
 * the word "master" says that.
 *
 * Placed rather than hidden, which is the rule the whole of `docs/ease.md` is
 * built on -- and a change of mind against `docs/masters.md`'s first draft,
 * which said a font with one version should show nothing at all about them.
 * Nothing at all is how a feature stays undiscovered. So: one quiet line in the
 * whole-font screen, always, under a label that says what it is for; and the
 * chips to switch between them above the canvas, where the decision is taken,
 * only once there is more than one to switch between.
 */

import * as React from "react";

import { OUTLINE_ACTION, SEGMENT_TRACK, segment } from "@/components/controls";
import { AXES, axesOf, axisSpec, lettersThatCannotVary } from "@/font/master";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

export function Versions({ compact = false }: { compact?: boolean }): React.JSX.Element | null {
  const state = useAppState();
  const [arming, setArming] = React.useState<string | null>(null);

  const masters = state.masters;
  const here = masters.find((one) => one.id === state.master);
  /*
   * The axes, and which letters will not follow them. Both read off the
   * versions rather than kept beside them, so neither can be out of step: an
   * axis exists because something was drawn away from the middle of it.
   */
  const axes = React.useMemo(() => axesOf(masters), [masters]);
  const stuck = React.useMemo(
    // The revision is in here because it is what says a drawing changed: the
    // version list is the same array of the same objects across an edit.
    () => lettersThatCannotVary(masters),
    [masters, state.revision],
  );

  // A switch with one thing to switch to is furniture, so above the canvas this
  // waits until there is a second version. The line in the whole-font screen is
  // what says a second version is possible at all.
  if (!state.typeface || masters.length === 0) return null;
  if (compact && masters.length < 2) return null;

  const chips = (
    <div className={SEGMENT_TRACK} role="group" aria-label="Version">
      {masters.map((master) => (
        <button
          key={master.id}
          type="button"
          data-version={master.id}
          aria-pressed={master.id === state.master}
          onClick={() => store.goToMaster(master.id)}
          title={`Draw the ${master.name} — ${axes
            .map((axis) => `${axis.label.toLowerCase()} ${master.at[axis.tag] ?? axis.default}`)
            .join(", ") || "the only version"}`}
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
        data-versions="compact"
        className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 text-2xs"
      >
        <span className="text-muted-foreground">Drawing</span>
        {chips}
      </div>
    );
  }

  /*
   * Which axis each button would add, and how many are offered at all.
   *
   * A font nobody has made a second version of gets one button: a second
   * weight, which is what almost everybody wants first and the only one of
   * these that explains itself. The other three appear once there are two
   * versions, which is the moment the idea has been met -- the rule
   * `docs/ease.md` is built on is that an advanced control is placed rather
   * than hidden, and four of them on the first screen of a first font is
   * placing it in the way.
   *
   * After that, only the axes not already there, except weight: a second
   * version along an axis that already has one is a third weight, which is an
   * ordinary thing to want. What is not offered twice is a *new* axis nobody
   * has drawn on.
   */
  const spare = (masters.length < 2 ? AXES.filter((axis) => axis.tag === "wght") : AXES).filter(
    (axis) => axis.tag === "wght" || !axes.some((one) => one.tag === axis.tag),
  );

  return (
    <div
      data-versions="full"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2 text-2xs"
    >
      <span className="text-muted-foreground" title="Masters, in the trade">
        Versions
      </span>
      {chips}

      {/*
        One button per axis, so what a version can differ by is on screen rather
        than something to know. Weight is always offered because a third weight
        is an ordinary thing to want; a new axis is offered once each.
      */}
      {spare.map((axis) => (
        <button
          key={axis.tag}
          type="button"
          data-add-version={axis.tag}
          onClick={() => store.addMaster(axis.tag)}
          title={`Copy this version into another one you draw ${axis.label.toLowerCase()} away from it. The exported font blends between them.`}
          className={OUTLINE_ACTION}
        >
          Add {axis.label === "Optical size" ? "an" : "a"} {axis.label.toLowerCase()}
        </button>
      ))}

      {/*
        And what it will cost, if anything. A letter whose versions are not the
        same points in the same order has no difference to store, so it stands
        still while the rest of the font moves -- and that is a thing to know
        now rather than in the export's notes.
      */}
      {stuck.size > 0 && (
        <span data-versions-stuck={stuck.size} className="text-[var(--attention)]">
          {stuck.size} letter{stuck.size === 1 ? "" : "s"} will not vary
        </span>
      )}

      {/*
        Everything between them, which is the reason for drawing more than one.

        One slider per axis, because a font with a Bold and a Condensed is
        looked at somewhere in a square rather than somewhere along a line.
        Looking rather than editing: the letters go blended, the drawing
        underneath is untouched, and pressing a version puts it back.
      */}
      {axes.map((axis) => (
        <label key={axis.tag} className="flex items-center gap-2 text-muted-foreground">
          {axes.length > 1 ? axis.label : "Look at"}
          <input
            type="range"
            min={axis.min}
            max={axis.max}
            step={1}
            value={state.preview?.[axis.tag] ?? here?.at[axis.tag] ?? axis.default}
            data-version-preview={axis.tag}
            aria-label={`Look at a ${axis.label.toLowerCase()} between the ones drawn`}
            onChange={(event) => store.setPreview(axis.tag, Number(event.target.value))}
            className="h-1 w-28 cursor-pointer accent-[color:var(--accent)]"
          />
          <span
            data-version-previewing={state.preview ? axis.tag : undefined}
            className={cn("tabular-nums", state.preview !== null && "text-accent")}
          >
            {state.preview?.[axis.tag] ?? here?.at[axis.tag] ?? axis.default}
          </span>
        </label>
      ))}
      {state.preview !== null && (
        <button
          type="button"
          data-version-stop-preview
          onClick={() => store.setPreview(null)}
          className="text-accent underline-offset-2 hover:underline"
        >
          Back to the drawing
        </button>
      )}

      {/*
        And what to do with the one in hand, beside it rather than behind a
        dialog: its name, where it stands on the axis it moves, and the way to
        be rid of it. All three are meaningless with one version, so none of
        them is drawn.
      */}
      {here && masters.length > 1 && (
        <>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Called
            <input
              value={here.name}
              data-version-name
              aria-label="What this version is called"
              onChange={(event) => store.nameMaster(here.id, event.target.value)}
              className="h-6 w-24 rounded border border-input bg-card px-1.5 text-2xs text-foreground outline-none focus-visible:border-accent"
            />
          </label>
          {/*
            The axis this one moves, which is the one it stands away from the
            first version on. A version moves one axis -- that is what makes a
            design space a star rather than a grid -- so there is one number
            here however many axes the font has.
          */}
          {(() => {
            const moved =
              axes.find((axis) => (here.at[axis.tag] ?? axis.default) !== masters[0].at[axis.tag]) ??
              axes[0];
            if (!moved) return null;
            const spec = axisSpec(moved.tag);
            return (
              <label className="flex items-center gap-1.5 text-muted-foreground">
                {moved.label.toLowerCase()}
                <input
                  type="number"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={here.at[moved.tag] ?? moved.default}
                  data-version-at
                  aria-label="Where this version stands on its axis"
                  onChange={(event) =>
                    store.placeMaster(here.id, moved.tag, Number(event.target.value))
                  }
                  className="h-6 w-16 rounded border border-input bg-card px-1.5 text-2xs tabular-nums text-foreground outline-none focus-visible:border-accent"
                />
              </label>
            );
          })()}
          {/*
            Asked twice, because this is a whole alphabet and there is no undo
            behind it. Armed on the first press and said out loud on the second,
            rather than a dialog over the top of the thing being talked about.
          */}
          <button
            type="button"
            data-remove-version
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
            {arming === here.id ? `Throw away ${here.name}?` : "Remove this version"}
          </button>
        </>
      )}
    </div>
  );
}

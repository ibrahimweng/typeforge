/**
 * The inspector: parameters that reshape the typeface.
 *
 * Family values apply to every glyph at once. A glyph can override any of them,
 * and an overridden control shows a reset affordance so it is obvious which
 * values are local and which are inherited.
 *
 * Nothing here is destructive. Parameters sit on top of the drawn outlines and
 * re-evaluate on every render, so any of them can be taken back to its starting
 * point at any time.
 */

import * as React from "react";

import { enterStaggered } from "@/anim/motion";
import { CompositionPanel } from "@/components/CompositionPanel";
import { FeaturesPanel } from "@/components/FeaturesPanel";
import { LetterPanel } from "@/components/LetterPanel";
import { PathsPanel } from "@/components/PathsPanel";
import { PointsPanel } from "@/components/PointsPanel";
import { TransformPanel } from "@/components/TransformPanel";
import { CoachMark } from "@/components/CoachMark";
import { ControlLetters } from "@/components/ControlLetters";
import { segment, SIDE_PANEL } from "@/components/controls";
import { PARAMS } from "@/components/param-specs";
import { noCast, type Cast, type CastName } from "@/font/cast";
import { CutPanel } from "@/components/CutPanel";
import { noCuts, type CutName, type Cuts } from "@/font/cuts";
import { hasLetters } from "@/font/library";
import { DEFAULT_PARAMS, type GlyphParams } from "@/font/types";
import { store, useAppState, type ViewId } from "@/state/useStore";
// Imported from the control directly rather than through the UI barrel: the
// barrel re-exports every control, which pulls the whole kit into the bundle.
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { cn } from "@/ui/lib/utils";

type Scope = "family" | "glyph" | "build";

/** The views whose subject is one letter rather than the whole typeface. */
const ABOUT_ONE_LETTER = new Set<ViewId>(["glyph", "metrics"]);

export function Inspector(): React.JSX.Element {
  const state = useAppState();
  const [scope, setScope] = React.useState<Scope>("family");
  const listRef = React.useRef<HTMLDivElement>(null);
  const gestureRef = React.useRef<GlyphParams | null>(null);

  React.useEffect(() => {
    if (listRef.current) {
      enterStaggered(Array.from(listRef.current.children) as Element[], { step: 10 });
    }
  }, [scope]);

  /*
   * The panel follows the view, in both directions.
   *
   * Two of these five views are about one letter -- the glyph editor, where
   * the letter is the whole screen, and the spacing table, where it is the row
   * you clicked. The other three are about the typeface: a grid of a hundred
   * letters, a paragraph of them, a report over all of them.
   *
   * Leaving the panel on the family in the two meant everything about the
   * letter sat behind a tab whose label was a single character and which
   * nothing suggested was a tab at all. In the glyph editor that made the
   * paths list unreachable; in the spacing table it pointed the three controls
   * that actually move a sidebearing at all six thousand glyphs while you read
   * one of them.
   *
   * Going the other way matters as much and was the half that got left out at
   * first: a panel that switches to the letter on the way in and stays there
   * on the way out is not following anything, it is drifting. Coming back to
   * the grid put a hundred letters on screen with the parameters aimed at one
   * of them, and nothing had said so.
   *
   * Only on arriving, so a deliberate switch stands for as long as you are in
   * the view you made it in.
   */
  const arrivedIn = React.useRef<ViewId | null>(null);
  React.useEffect(() => {
    if (arrivedIn.current === state.view) return;
    arrivedIn.current = state.view;
    setScope(ABOUT_ONE_LETTER.has(state.view) ? "glyph" : "family");
  }, [state.view]);

  const typeface = state.typeface;
  const glyphName = state.selectedGlyph;
  const glyph = store.glyph(glyphName);

  if (!typeface) {
    return (
      <aside aria-label="Parameters" className={cn(SIDE_PANEL, "shrink-0 border-l border-border p-4")}>
        <p className="text-2xs text-muted-foreground">
          Parameters appear once a font is open.
        </p>
      </aside>
    );
  }

  /*
   * A font with nothing drawn in it, which is where every font starts.
   *
   * Everything below reshapes letters -- rounds their corners, thickens their
   * strokes, opens the counters of o, e and a -- so on a font with none it was
   * ten sliders describing what they do to nothing, and every one of them
   * moved without moving anything. The letter scope was worse than useless:
   * with no letter selected it fell back to the family's values and showed
   * them under a tab labelled Letter, so the numbers on screen belonged to
   * something other than what the tab said they did.
   *
   * The control letters below say the same in the other direction -- seven
   * dashed outlines and "0 of 7" -- and the coach mark over them offers to
   * carry an edit to the whole alphabet. So the whole panel goes and says the
   * one thing that is true, which is also the one thing to do next.
   */
  if (!hasLetters(typeface)) {
    return (
      <aside
        aria-label="Parameters"
        className={cn(SIDE_PANEL, "shrink-0 border-l border-border p-4")}
        data-no-letters
      >
        <p className="text-2xs leading-relaxed text-muted-foreground">
          Parameters reshape letters — their weight, their width, the space
          inside them. This font has none yet, so there is nothing for them to
          take hold of. Draw a letter and they appear.
        </p>
      </aside>
    );
  }

  const editingGlyph = scope === "glyph" && glyph !== null;
  const resolved = editingGlyph && glyphName ? store.paramsFor(glyphName) : typeface.params;

  return (
    <aside
      aria-label="Parameters"
      className={cn(SIDE_PANEL, "toolcraft-panel-surface flex shrink-0 flex-col border-l border-border")}
    >
      <div
        className="flex gap-0.5 border-b border-border bg-card/60 p-1"
        role="group"
        aria-label="Inspector scope"
      >
        {(["family", "glyph", "build"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={scope === option}
            onClick={() => setScope(option)}
            disabled={option === "glyph" && !glyph}
            title={
              option === "family"
                ? "Every glyph in the font at once"
                : option === "glyph"
                  ? glyph
                    ? `Just ${glyph.name}, which can override any family value`
                    : "Open a letter to reach its own values"
                  : "How the letters are built out of each other"
            }
            className={segment(
              scope === option,
              cn("min-w-0 flex-1 truncate", option === "glyph" && !glyph && "opacity-40"),
            )}
          >
            {/*
              Named for what it is, with the letter beside it rather than
              instead of it.

              This tab used to be labelled with the glyph's name and nothing
              else, so the three read `Family`, `A`, `Build`: two scopes and a
              letter. It is a good idea -- the panel really is about that one
              letter -- with nothing at all to say it was a tab rather than a
              readout of what is selected, which is how the paths list ended up
              being shipped somewhere nobody would press.

              Also why `capitalize` is off the label and on the two words that
              need it. Applied to the whole tab it reached the glyph name too,
              so the letter `a` announced itself as `A` and `eacute` as
              `Eacute` -- a font's glyph names are case-sensitive, and the one
              place in the application that shows you which letter you have was
              quietly changing it.
            */}
            {option === "glyph" ? (
              <>
                {/*
                  A real space rather than a left padding, because the gap has
                  to be in the text and not only in the picture of it. Set with
                  `pl-1` this read `Lettera` to anything that computes an
                  accessible name by joining the text nodes -- a screen reader,
                  and the test below that caught it.
                */}
                Letter{" "}
                {glyph && <span className="opacity-60">{glyph.name}</span>}
              </>
            ) : (
              <span className="capitalize">{option}</span>
            )}
          </button>
        ))}
      </div>

      {/*
        The way in to the tools, from every view that shows a letter but is not
        the one you can draw in.

        Above the scope tabs rather than inside one of them, and that is the
        whole point. The tools sat behind a gesture nobody could see: the font
        grid opened a letter on a double click, the spacing table selected one
        without opening it at all, and the proof sheet did neither. Putting the
        way out under the letter tab would have moved it from one thing nobody
        presses to another -- the panel opens on the family in three of these
        four views, which is the tab that is showing when you arrive.

        So it is outside the tabs, in the same place whichever one is chosen,
        and it says which letter it means because in a grid of a hundred that
        is not obvious.
      */}
      {glyph && state.view !== "glyph" && (
        <div className="border-b border-border p-2" data-open-in-editor>
          <button
            type="button"
            onClick={() => store.selectGlyph(glyph.name, { open: true })}
            className={cn(
              "w-full rounded border border-border px-2 py-1.5 text-2xs text-muted-foreground",
              "transition-colors hover:border-accent hover:text-foreground",
            )}
          >
            Open <span className="font-mono text-foreground">{glyph.name}</span> in the editor
          </button>
        </div>
      )}

      {scope === "build" ? (
        /*
          What the font does with a letter, under the same scope as how a letter
          is put together -- because a ligature is the same kind of fact as a
          composite: not how this letter looks, but what the font makes of it.
        */
        <div className="toolcraft-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          <CompositionPanel />
          <div className="border-t border-border pt-4">
            <FeaturesPanel />
          </div>
        </div>
      ) : (
      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
      {scope === "family" && <ControlLetters />}
      {scope === "family" && <CoachMark id="family" />}
      {/*
        Under the letter's own scope, because that is what it is about, and in
        the view where a path is what you are handling.

        A path belongs to one glyph and to no family, so it has no business in
        the family tab where every other control reaches four hundred and fifty
        letters at once. Nor in the spacing table, which is also about one
        letter and reaches this panel for that reason: which way a contour runs
        is a fact about the drawing, and a column of sidebearings is not the
        place to be told it.
      */}
      {/*
        What the letter *is*, above the three panels that change how it looks.
        A level up from them: those redraw it, this decides whether it is there
        and what it is called.
      */}
      {editingGlyph && <LetterPanel />}
      {editingGlyph && state.view === "glyph" && <PathsPanel />}
      {/*
        Under the same scope and the same view as the paths, and for the same
        reason: a transform acts on one letter's outlines, and the glyph view
        is where a letter's outlines are in hand.
      */}
      {editingGlyph && state.view === "glyph" && <TransformPanel />}
      {/*
        And below the transforms, because the order is the order of scope: a
        path, then the whole drawing, then a point in it. Somebody working
        their way down the panel goes from the largest thing they can act on
        to the smallest.
      */}
      {editingGlyph && state.view === "glyph" && <PointsPanel />}
      <div ref={listRef} className="p-3">
        {PARAMS.map((spec) => {
          const scaleFactor = spec.emRelative ? typeface.unitsPerEm : 1;
          const value = resolved[spec.key];
          const overridden = editingGlyph && glyph!.params[spec.key] !== undefined;

          return (
            <div key={spec.key} className="pb-3.5">
              {/* The label lives on the slider itself. This row is only here
                  when there is something to say beside it. */}
              {overridden && (
                <div className="flex items-baseline justify-end pb-1">
                  <button
                    type="button"
                    onClick={() => glyphName && store.clearGlyphParam(glyphName, spec.key)}
                    className="text-2xs text-accent hover:underline"
                    title="Follow the family value again"
                  >
                    reset
                  </button>
                </div>
              )}
              <Slider
                /*
                 * The slider prints this as its own label, so it has to be the
                 * name of the control rather than an identifier. It had been
                 * `family-cornerRadius`, which appeared under every heading in
                 * the panel as though it meant something.
                 */
                name={spec.label}
                value={value / scaleFactor}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                unit={spec.unit}
                baseValue={DEFAULT_PARAMS[spec.key]}
                showFill
                onValueChange={(next, meta) => {
                  const scaled = next * scaleFactor;
                  // A drag arrives as a run of "merge" updates followed by a
                  // final one. Snapshot at the start and record at the end, so
                  // the whole gesture is a single undo step.
                  if (meta?.history === "merge") {
                    gestureRef.current ??= { ...typeface.params };
                    if (editingGlyph && glyphName) {
                      store.setGlyphParam(glyphName, spec.key, scaled);
                    } else {
                      store.setFamilyParam(spec.key, scaled);
                    }
                    return;
                  }
                  if (editingGlyph && glyphName) {
                    store.setGlyphParam(glyphName, spec.key, scaled);
                  } else {
                    const before = gestureRef.current ?? { ...typeface.params };
                    store.setFamilyParam(spec.key, scaled);
                    store.commitFamilyParams(`Set ${spec.label.toLowerCase()}`, before);
                  }
                  gestureRef.current = null;
                }}
              />
              <p className="pt-1 text-2xs leading-snug text-muted-foreground">{spec.hint}</p>
            </div>
          );
        })}
      </div>

      <Cutting scope={scope} glyphName={glyphName} />

      <div className="p-3">
        <button
          type="button"
          onClick={() => {
            if (editingGlyph && glyphName) {
              for (const spec of PARAMS) store.clearGlyphParam(glyphName, spec.key);
            } else {
              const before = { ...typeface.params };
              for (const spec of PARAMS) store.setFamilyParam(spec.key, DEFAULT_PARAMS[spec.key]);
              store.commitFamilyParams("Reset parameters", before);
            }
          }}
          className="w-full rounded-md border border-border px-2 py-1.5 text-2xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
        >
          Reset {scope === "glyph" ? "this glyph" : "all parameters"}
        </button>
      </div>
      </div>
      )}
    </aside>
  );
}

/**
 * Cutting an opened font.
 *
 * The same panel the drawn side has, on the same description -- what differs
 * is only that these outlines came out of a file. Two of the six cuts are made
 * out of a skeleton and a file has none, so they are switched on and say so
 * rather than quietly doing nothing.
 */
function Cutting({
  scope,
  glyphName,
}: {
  scope: Scope;
  glyphName: string | null;
}): React.JSX.Element | null {
  const state = useAppState();
  const typeface = state.typeface;
  if (!typeface || scope === "build") return null;

  const one = scope === "glyph" && glyphName !== null;
  /*
   * In glyph scope this shows what the letter actually has rather than what
   * the font has, which is where cuts part company with the rows above.
   *
   * A parameter override is rare and starts from the family's value, so
   * showing the family's is showing what the first drag moves away from. A cut
   * exception is the ordinary way to deal with the letter that has nowhere to
   * put the third slot, and showing the font's value there would be showing a
   * number this letter is not cut by.
   */
  const cuts: Cuts = one ? store.cutsFor(glyphName) : typeface.cuts ?? noCuts();
  const held = one ? (name: CutName) => store.cutHeldBy(glyphName, name) : null;

  const change = (name: CutName, patch: Record<string, unknown>): void => {
    if (one) store.changeGlyphCut(glyphName, name, patch as never);
    else {
      const before = typeface.cuts;
      store.changeCut(name, patch as never);
      store.commitCuts(`Cut ${name}`, before);
    }
  };

  const cast: Cast = one ? store.castFor(glyphName) : typeface.cast ?? noCast();
  const castHeld = one ? (name: CastName) => store.castHeldBy(glyphName, name) : null;
  const changeCast = (name: CastName, patch: Record<string, unknown>): void => {
    if (one) store.changeGlyphCast(glyphName, name, patch as never);
    else {
      const before = typeface.cast;
      store.changeCast(name, patch as never);
      store.commitCast(`Cast ${name}`, before);
    }
  };

  return (
    <>
      <CutPanel
        tag="edit"
        cuts={cuts}
        onChange={change}
        unitsPerEm={typeface.unitsPerEm}
        scopeNote={
          one
            ? `Cutting ${glyphName} alone. The rest of the font keeps its own.`
            : "Cutting the whole font."
        }
        reach={
          "Nothing here: this one is made out of the skeleton a letter was drawn " +
          "from, and a letter out of a font file has none."
        }
        heldNote={(name) => (held?.(name) ? "own" : null)}
        onRelease={() => glyphName && store.cutLikeTheRest(glyphName)}
      />
      <CutPanel
        layer="cast"
        tag="edit-cast"
        cuts={cast}
        onChange={changeCast}
        unitsPerEm={typeface.unitsPerEm}
        scopeNote={
          one
            ? `Casting ${glyphName} alone. The rest of the font keeps its own.`
            : "Casting the whole font."
        }
        reach={
          "Nothing here: this one is made out of the skeleton a letter was drawn " +
          "from, and a letter out of a font file has none."
        }
        heldNote={(name) => (castHeld?.(name) ? "own" : null)}
        onRelease={() => glyphName && store.castLikeTheRest(glyphName)}
        footer={<CastOrder order={cast.order} onChange={(next) => store.changeCastOrder(next)} />}
      />
    </>
  );
}

/**
 * Which of the two shaping layers goes first.
 *
 * Not an operation -- no switch, draws nothing on its own -- so it sits under
 * the rows rather than among them, and it is never a letter's own.
 */
export function CastOrder({
  order,
  onChange,
}: {
  order: Cast["order"];
  onChange: (order: Cast["order"]) => void;
}): React.JSX.Element {
  return (
    <div className="border-t border-border pt-2" data-cast-order-picker>
      <div className="pb-1 text-2xs font-medium text-foreground">Which goes first</div>
      <div className="flex gap-0.5 rounded-md bg-card/60 p-0.5" role="group" aria-label="Which goes first">
        <button
          type="button"
          aria-pressed={order === "after"}
          data-cast-order="after"
          onClick={() => onChange("after")}
          className={segment(order === "after", "flex-1")}
        >
          Cut, then cast
        </button>
        <button
          type="button"
          aria-pressed={order === "before"}
          data-cast-order="before"
          onClick={() => onChange("before")}
          className={segment(order === "before", "flex-1")}
        >
          Cast, then cut
        </button>
      </div>
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">
        Cut first and the shadow is thrown by the letter as it now is, so a slot
        through the face shows as a slot through the shadow. Cast first and the
        two are one block for the cut to slice, which can put a band across the
        shadow where the face has none.
      </p>
    </div>
  );
}

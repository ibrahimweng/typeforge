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
import { PathsPanel } from "@/components/PathsPanel";
import { CoachMark } from "@/components/CoachMark";
import { ControlLetters } from "@/components/ControlLetters";
import { segment } from "@/components/controls";
import { PARAMS } from "@/components/param-specs";
import { noCast, type Cast, type CastName } from "@/font/cast";
import { CutPanel } from "@/components/CutPanel";
import { noCuts, type CutName, type Cuts } from "@/font/cuts";
import { DEFAULT_PARAMS, type GlyphParams } from "@/font/types";
import { store, useAppState } from "@/state/useStore";
// Imported from the control directly rather than through the UI barrel: the
// barrel re-exports every control, which pulls the whole kit into the bundle.
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { cn } from "@/ui/lib/utils";

type Scope = "family" | "glyph" | "build";

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
   * Opening a letter puts the panel on that letter.
   *
   * The panel opens on the family, which is right in the font view: there the
   * subject is the typeface and a hundred letters are on screen. In the glyph
   * view the subject is one letter, and leaving the panel on the family meant
   * that everything about the letter -- its own parameters, and now its paths
   * -- sat behind a tab whose label is a single character and which nothing
   * suggested was a tab at all. The feature was there and unreachable.
   *
   * Only on arriving in the view, not on every render, so somebody who
   * deliberately switches back to the family stays there while they work.
   */
  const arrivedInGlyphView = React.useRef(false);
  React.useEffect(() => {
    if (state.view === "glyph" && !arrivedInGlyphView.current) setScope("glyph");
    arrivedInGlyphView.current = state.view === "glyph";
  }, [state.view]);

  const typeface = state.typeface;
  const glyphName = state.selectedGlyph;
  const glyph = store.glyph(glyphName);

  if (!typeface) {
    return (
      <aside aria-label="Parameters" className="w-72 shrink-0 border-l border-border p-4">
        <p className="text-2xs text-muted-foreground">
          Parameters appear once a font is open.
        </p>
      </aside>
    );
  }

  const editingGlyph = scope === "glyph" && glyph !== null;
  const resolved = editingGlyph && glyphName ? store.paramsFor(glyphName) : typeface.params;

  return (
    <aside
      aria-label="Parameters"
      className="toolcraft-panel-surface flex w-72 shrink-0 flex-col border-l border-border"
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
            className={segment(
              scope === option,
              cn("min-w-0 flex-1 truncate capitalize", option === "glyph" && !glyph && "opacity-40"),
            )}
          >
            {option === "glyph" && glyph ? glyph.name : option}
          </button>
        ))}
      </div>

      {scope === "build" ? (
        <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
          <CompositionPanel />
        </div>
      ) : (
      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
      {scope === "family" && <ControlLetters />}
      {scope === "family" && <CoachMark id="family" />}
      {/*
        Under the letter's own scope, because that is what it is about.

        A path belongs to one glyph and to no family, so it has no business in
        the family tab where every other control reaches four hundred and fifty
        letters at once.
      */}
      {editingGlyph && <PathsPanel />}
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

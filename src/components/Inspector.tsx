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
import { CoachMark } from "@/components/CoachMark";
import { ControlLetters } from "@/components/ControlLetters";
import { segment } from "@/components/controls";
import { PARAMS } from "@/components/param-specs";
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

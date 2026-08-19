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
import { DEFAULT_PARAMS, type GlyphParams } from "@/font/types";
import { store, useAppState } from "@/state/useStore";
// Imported from the control directly rather than through the UI barrel: the
// barrel re-exports every control, which pulls the whole kit into the bundle.
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { cn } from "@/ui/lib/utils";

type Scope = "family" | "glyph";

interface ParamSpec {
  key: keyof GlyphParams;
  label: string;
  /** What the control does, in the terms a designer would use. */
  hint: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Whether the range is in font units and should scale with the em size. */
  emRelative?: boolean;
}

const PARAMS: ParamSpec[] = [
  {
    key: "cornerRadius",
    label: "Corner radius",
    hint: "Rounds sharp corners. Stem ends and serif joints soften first.",
    min: 0,
    max: 0.15,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "weight",
    label: "Weight",
    hint: "Thickens or thins every stroke. Negative values lighten.",
    min: -0.04,
    max: 0.06,
    step: 0.0005,
    emRelative: true,
  },
  {
    key: "counterScale",
    label: "Middle space",
    hint: "Opens or closes the enclosed space inside letters such as o, e and a.",
    min: 0.6,
    max: 1.4,
    step: 0.005,
  },
  {
    key: "width",
    label: "Width",
    hint: "Stretches or condenses letterforms horizontally.",
    min: 0.6,
    max: 1.5,
    step: 0.005,
  },
  {
    key: "slant",
    label: "Slant",
    hint: "Shears the letters about the baseline, making an oblique.",
    min: -20,
    max: 20,
    step: 0.5,
    unit: "°",
  },
  {
    key: "xHeightScale",
    label: "x-height",
    hint: "Scales everything above the baseline. Descenders stay put.",
    min: 0.8,
    max: 1.25,
    step: 0.005,
  },
  {
    key: "tracking",
    label: "Tracking",
    hint: "Adds space either side of every glyph, loosening the whole setting.",
    min: -0.05,
    max: 0.1,
    step: 0.001,
    emRelative: true,
  },
];

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
      <aside className="w-72 shrink-0 border-l border-border p-4">
        <p className="text-2xs text-muted-foreground">
          Parameters appear once a font is open.
        </p>
      </aside>
    );
  }

  const editingGlyph = scope === "glyph" && glyph !== null;
  const resolved = editingGlyph && glyphName ? store.paramsFor(glyphName) : typeface.params;

  return (
    <aside className="toolcraft-panel-surface flex w-72 shrink-0 flex-col border-l border-border">
      <div className="flex gap-1 border-b border-border p-2">
        {(["family", "glyph"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setScope(option)}
            disabled={option === "glyph" && !glyph}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-2xs capitalize transition-colors",
              scope === option
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
              option === "glyph" && !glyph && "opacity-40",
            )}
          >
            {option === "glyph" && glyph ? glyph.name : option}
          </button>
        ))}
      </div>

      <div ref={listRef} className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {PARAMS.map((spec) => {
          const scaleFactor = spec.emRelative ? typeface.unitsPerEm : 1;
          const value = resolved[spec.key];
          const overridden = editingGlyph && glyph!.params[spec.key] !== undefined;

          return (
            <div key={spec.key} className="pb-3.5">
              <div className="flex items-baseline justify-between pb-1">
                <span className="text-2xs text-foreground">{spec.label}</span>
                {overridden && (
                  <button
                    type="button"
                    onClick={() => glyphName && store.clearGlyphParam(glyphName, spec.key)}
                    className="text-2xs text-accent hover:underline"
                    title="Follow the family value again"
                  >
                    reset
                  </button>
                )}
              </div>
              <Slider
                name={`${scope}-${spec.key}`}
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
    </aside>
  );
}

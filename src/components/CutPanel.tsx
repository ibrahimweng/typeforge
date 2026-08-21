/**
 * The Cut panel, wherever a letter is being cut.
 *
 * There are three halves of this application that can cut a letter -- a face
 * drawn here, a font somebody opened, and a pile of drawings somebody made
 * elsewhere -- and the panel is the same in all three, because the cuts are.
 * So it takes the cuts and a way to change them rather than reaching for a
 * store, and each half hands it its own.
 *
 * What differs between them is only what a cut can reach. Two of the six are
 * made out of the skeleton, and a letter that arrived as an outline has none;
 * `reach` is how a caller says so, and the row says it on the letter rather
 * than leaving somebody to work it out from a drawing that did not change.
 */

import * as React from "react";

import { segment } from "@/components/controls";
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { FROM_SKELETON, type CutName, type Cuts } from "@/font/cuts";
import { CUT_SPECS, cutValuesOf, type CutSpec, type PartControl } from "@/forge/parts";
import { cn } from "@/ui/lib/utils";

/** Whether a change is one of a run or the end of one, for the undo stack. */
export type Phase = "single" | "during" | "end";

export interface CutPanelProps {
  /** The cuts as they stand, which is what the controls show. */
  cuts: Cuts;
  onChange: (name: CutName, patch: Record<string, unknown>, phase: Phase) => void;
  /** Em size, for any control measured as a share of it. */
  unitsPerEm: number;
  /** What is being cut, in the words of this half: "the whole font", "A alone". */
  scopeNote: string;
  /**
   * Why a skeleton cut will do nothing here, or null when it will.
   *
   * A sentence rather than a flag, because the reason differs: in one half the
   * letter was imported into a drawn font, in another there was never a
   * skeleton to begin with.
   */
  reach?: string | null;
  /** Shown against an operation this letter holds its own version of. */
  heldNote?: (name: CutName) => string | null;
  onRelease?: (name: CutName) => void;
  /** Marks the panel for tests and for the tour to find. */
  tag?: string;
}

export function CutPanel({
  cuts,
  onChange,
  unitsPerEm,
  scopeNote,
  reach = null,
  heldNote,
  onRelease,
  tag = "cuts",
}: CutPanelProps): React.JSX.Element {
  return (
    <section className="border-b border-border p-3" data-cut-panel={tag}>
      <h3 className="text-2xs font-medium">Cut</h3>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">
        Taken out after the letter is drawn, so everything above still reaches
        it. Sizes are in stem widths, which is what keeps a cut meaning the same
        thing at every weight.
      </p>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">{scopeNote}</p>

      {CUT_SPECS.map((spec) => (
        <CutRow
          key={spec.name}
          spec={spec}
          cuts={cuts}
          onChange={onChange}
          unitsPerEm={unitsPerEm}
          reach={reach}
          held={heldNote?.(spec.name) ?? null}
          onRelease={onRelease}
        />
      ))}
    </section>
  );
}

/** One cut: a switch, and its settings once it is on. */
function CutRow({
  spec,
  cuts,
  onChange,
  unitsPerEm,
  reach,
  held,
  onRelease,
}: {
  spec: CutSpec;
  cuts: Cuts;
  onChange: CutPanelProps["onChange"];
  unitsPerEm: number;
  reach: string | null;
  held: string | null;
  onRelease?: (name: CutName) => void;
}): React.JSX.Element {
  const values = cutValuesOf(spec.name, cuts);
  const on = Boolean(values.on);
  // The control still works -- it is a decision about the whole font -- but on
  // this letter it will do nothing, and that is worth knowing here rather than
  // after staring at a drawing that did not change.
  const unreachable = reach !== null && on && FROM_SKELETON.has(spec.name);

  return (
    <div className="border-t border-border pt-2 first-of-type:mt-2" data-cut={spec.name}>
      {/*
        A row, not a label.
        *
        * It was a <label> wrapping the name, the "own" badge and the switch,
        * which reads well and does the wrong thing: a click on any button
        * inside a label is forwarded to the label's own control as well, so
        * pressing "own" to give a letter back to the font released it and then
        * immediately toggled the switch, putting the exception straight back.
        * Both handlers fired on one press. The switch names itself with
        * aria-label, so the label element was buying nothing to begin with.
      */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-2xs font-medium text-foreground">{spec.label}</span>
        {held && (
          <button
            type="button"
            onClick={() => onRelease?.(spec.name)}
            data-cut-release={spec.name}
            className="shrink-0 text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70"
          >
            {held}
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={spec.label}
          data-cut-switch={spec.name}
          onClick={() => onChange(spec.name, { on: !on }, "single")}
          className={cn(
            "h-4 w-7 shrink-0 rounded-full transition-colors",
            on ? "bg-[color:var(--accent)]" : "bg-card",
          )}
        >
          <span
            className={cn(
              "block size-3 rounded-full bg-background transition-transform",
              on ? "translate-x-3.5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{spec.hint}</p>
      {unreachable && (
        <p className="pt-0.5 text-2xs leading-snug text-[color:var(--accent)]">{reach}</p>
      )}

      {on && (
        <div className="pt-1">
          {spec.controls.map((control) => (
            <CutControl
              key={control.key}
              control={control}
              values={values}
              unitsPerEm={unitsPerEm}
              onChange={(patch, phase) => onChange(spec.name, patch, phase)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One setting of one cut.
 *
 * The same three shapes the drawn side's controls take -- a row of named
 * shapes, a switch, or a slider -- without the business of scrolling itself
 * into view when a letter is pressed, which is something only the drawn side
 * can be asked.
 */
function CutControl({
  control,
  values,
  unitsPerEm,
  onChange,
}: {
  control: PartControl;
  values: Record<string, number | boolean | string>;
  unitsPerEm: number;
  onChange: (patch: Record<string, unknown>, phase: Phase) => void;
}): React.JSX.Element {
  const scale = control.emRelative ? unitsPerEm : 1;

  /*
   * A choice between named shapes rather than a number.
   *
   * Drawn as a row rather than as a menu because the difference between them
   * is a shape: side by side they can be compared, and behind a menu they have
   * to be remembered.
   */
  if (control.options) {
    const chosen = String(values[control.key]);
    return (
      <div className="py-1">
        <div className="pb-1 text-2xs text-foreground">{control.label}</div>
        <div
          className="flex flex-wrap gap-0.5 rounded-md bg-card/60 p-0.5"
          role="group"
          aria-label={control.label}
        >
          {control.options.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              aria-pressed={chosen === option.value}
              onClick={() => onChange({ [control.key]: option.value }, "single")}
              className={segment(chosen === option.value, "flex-1")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
      </div>
    );
  }

  if (control.toggle) {
    const on = Boolean(values[control.key]);
    return (
      <label className="flex items-center justify-between gap-2 py-1.5">
        <span className="min-w-0 flex-1 text-2xs text-foreground">{control.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={control.label}
          onClick={() => onChange({ [control.key]: !on }, "single")}
          className={cn(
            "h-4 w-7 shrink-0 rounded-full transition-colors",
            on ? "bg-[color:var(--accent)]" : "bg-card",
          )}
        >
          <span
            className={cn(
              "block size-3 rounded-full bg-background transition-transform",
              on ? "translate-x-3.5" : "translate-x-0.5",
            )}
          />
        </button>
      </label>
    );
  }

  const value = Number(values[control.key] ?? 0);
  return (
    <div className="py-1">
      {/* The slider draws its own label from `name`, so there is no second one
          here; passing an identifier instead showed people "slot-width". */}
      <Slider
        name={control.label}
        value={value / scale}
        min={control.min}
        max={control.max}
        step={control.step}
        showFill
        onValueChange={(next: number, meta?: { history?: string }) =>
          onChange({ [control.key]: next * scale }, meta?.history === "merge" ? "during" : "end")
        }
      />
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
    </div>
  );
}

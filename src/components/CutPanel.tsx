/**
 * The Cut and Cast panels, wherever a letter is being shaped.
 *
 * There are three halves of this application that can shape a letter -- a face
 * drawn here, a font somebody opened, and a pile of drawings somebody made
 * elsewhere -- and the panel is the same in all three, because the operations
 * are. So it takes the description and a way to change it rather than reaching
 * for a store, and each half hands it its own.
 *
 * And one panel draws both layers rather than two panels drawing one each. A
 * cast is described in exactly the shape a cut is -- named operations, each
 * with a switch and a few numbered controls, sized in stem widths -- so the
 * only things that differ between them are the list of operations, where the
 * values are read from, and the words at the top. Those are arguments.
 *
 * What differs between them is only what a cut can reach. Two of the six are
 * made out of the skeleton, and a letter that arrived as an outline has none;
 * `reach` is how a caller says so, and the row says it on the letter rather
 * than leaving somebody to work it out from a drawing that did not change.
 */

import type * as React from "react";

import { segment } from "@/components/controls";
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { FROM_SKELETON as CAST_FROM_SKELETON, type Cast, type CastName } from "@/font/cast";
import { FROM_SKELETON, type CutName, type Cuts } from "@/font/cuts";
import {
  FROM_SKELETON as EFFECT_FROM_SKELETON,
  type EffectName,
  type Effects,
} from "@/font/effects";
import {
  CAST_SPECS,
  CUT_SPECS,
  EFFECT_SPECS,
  castValuesOf,
  cutValuesOf,
  effectValuesOf,
  type CastSpec,
  type CutSpec,
  type EffectSpec,
  type PartControl,
} from "@/forge/parts";
import { cn } from "@/ui/lib/utils";

/** Whether a change is one of a run or the end of one, for the undo stack. */
export type Phase = "single" | "during" | "end";

/** One operation as the panel needs to see it, whichever layer it came from. */
type Named = { name: string; label: string; hint: string; controls: PartControl[] };

/** What both layers ask for. */
interface Common {
  /** Em size, for any control measured as a share of it. */
  unitsPerEm: number;
  /** What is being shaped, in the words of this half: "the whole font", "A alone". */
  scopeNote: string;
  /**
   * Why a skeleton operation will do nothing here, or null when it will.
   *
   * A sentence rather than a flag, because the reason differs: in one half the
   * letter was imported into a drawn font, in another there was never a
   * skeleton to begin with.
   */
  reach?: string | null;
  /** Marks the panel for tests and for the tour to find. */
  tag?: string;
  /**
   * Drawn beside the heading, for anything that is about the whole layer.
   *
   * Where a letter's own release goes: "H holds 3 · release" belongs at the
   * top, next to the name of the thing it is releasing, rather than under a
   * list of six operations it is not about.
   */
  header?: React.ReactNode;
  /** Drawn under the operations, for anything the layer has that is not one. */
  footer?: React.ReactNode;
}

/**
 * Typed per layer, so a caller cannot hand the cast panel a cut's name.
 *
 * The two are the same panel and the same code path -- the only things that
 * differ are which operations are listed, where their values are read from,
 * and the words at the top. Inside, the pair is widened once and handled as
 * one; at the edge it stays two, because that is where the mistakes would be.
 */
export type CutPanelProps =
  | (Common & {
      layer?: "cut";
      cuts: Cuts;
      onChange: (name: CutName, patch: Record<string, unknown>, phase: Phase) => void;
      /** Shown against an operation this letter holds its own version of. */
      heldNote?: (name: CutName) => string | null;
      onRelease?: (name: CutName) => void;
    })
  | (Common & {
      layer: "cast";
      cuts: Cast;
      onChange: (name: CastName, patch: Record<string, unknown>, phase: Phase) => void;
      heldNote?: (name: CastName) => string | null;
      onRelease?: (name: CastName) => void;
    })
  | (Common & {
      /*
       * The third layer, and the one that is never a letter's own: a cut and a
       * cast are things done to a letter and a letter can reasonably be done to
       * differently, where this describes what drew the font. So it offers no
       * badge and no way to release one, and the panel simply never asks.
       */
      layer: "effect";
      cuts: Effects;
      onChange: (name: EffectName, patch: Record<string, unknown>, phase: Phase) => void;
    });

export function CutPanel(props: CutPanelProps): React.JSX.Element {
  const {
    cuts,
    unitsPerEm,
    scopeNote,
    reach = null,
    tag = "cuts",
    layer = "cut",
    header,
    footer,
  } = props;
  // Widened once, here, so everything below is written for one panel rather
  // than for two that happen to look alike.
  const onChange = props.onChange as (
    name: string,
    patch: Record<string, unknown>,
    phase: Phase,
  ) => void;
  const held = props as {
    heldNote?: (name: string) => string | null;
    onRelease?: (name: string) => void;
  };
  const heldNote = held.heldNote;
  const onRelease = held.onRelease;
  const cast = layer === "cast";
  const tool = layer === "effect";
  const specs: Named[] = tool
    ? (EFFECT_SPECS as EffectSpec[])
    : cast
      ? (CAST_SPECS as CastSpec[])
      : (CUT_SPECS as CutSpec[]);
  const skeleton: ReadonlySet<string> = tool
    ? EFFECT_FROM_SKELETON
    : cast
      ? CAST_FROM_SKELETON
      : FROM_SKELETON;
  const values = tool ? effectValuesOf : cast ? castValuesOf : cutValuesOf;

  return (
    <section className="border-b border-border p-3" data-cut-panel={tag}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-2xs font-medium">{tool ? "The tool" : cast ? "Cast" : "Cut"}</h3>
        {header}
      </div>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">
        {tool
          ? "What the tool that drew the letters was like. Shown on the letter you are working on and on nothing else until the font is exported, when it is baked into every glyph in the file \u2014 roughening four hundred and fifty letters between two frames is what a slider cannot survive."
          : cast
            ? "Put on after the letter is drawn, so everything above still reaches it. Sizes are in stem widths, which is what keeps a shadow meaning the same thing at every weight."
            : "Taken out after the letter is drawn, so everything above still reaches it. Sizes are in stem widths, which is what keeps a cut meaning the same thing at every weight."}
      </p>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">{scopeNote}</p>

      {specs.map((spec) => (
        <CutRow
          key={spec.name}
          spec={spec}
          cuts={cuts as unknown as Record<string, unknown>}
          onChange={onChange}
          unitsPerEm={unitsPerEm}
          reach={reach}
          fromSkeleton={skeleton}
          valuesOf={
            values as (name: string, from: never) => Record<string, number | boolean | string>
          }
          held={heldNote?.(spec.name) ?? null}
          onRelease={onRelease}
        />
      ))}
      {footer}
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
  fromSkeleton,
  valuesOf,
  held,
  onRelease,
}: {
  spec: Named;
  cuts: Record<string, unknown>;
  onChange: (name: string, patch: Record<string, unknown>, phase: Phase) => void;
  unitsPerEm: number;
  reach: string | null;
  fromSkeleton: ReadonlySet<string>;
  valuesOf: (name: string, from: never) => Record<string, number | boolean | string>;
  held: string | null;
  onRelease?: (name: string) => void;
}): React.JSX.Element {
  const values = valuesOf(spec.name, cuts as never);
  const on = Boolean(values.on);
  // The control still works -- it is a decision about the whole font -- but on
  // this letter it will do nothing, and that is worth knowing here rather than
  // after staring at a drawing that did not change.
  const unreachable = reach !== null && on && fromSkeleton.has(spec.name);

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
            // Named for what it sets rather than for where it sits, so a test
            // or the walkthrough can point at one setting of one operation.
            <div key={control.key} data-cut-control={`${spec.name}:${control.key}`}>
              <CutControl
                control={control}
                values={values}
                unitsPerEm={unitsPerEm}
                onChange={(patch, phase) => onChange(spec.name, patch, phase)}
              />
            </div>
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

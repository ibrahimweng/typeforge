/**
 * The controls for a font being drawn.
 *
 * Every slider here is generated from the part it belongs to rather than
 * written out, so the panel cannot come to offer a control the tool does not
 * have, or quietly stop offering one it does.
 *
 * The thing worth getting right is what an edit says about itself. Moving the
 * serif changes more than forty letters, and a panel that lets that happen with
 * no more ceremony than moving a slider is hiding the most important fact about
 * the tool. So each part says how far it reaches before it is touched, and a
 * letter that has been told to keep its own version says so where it can be
 * seen and undone.
 */

import * as React from "react";

import { segment } from "@/components/controls";
import { contoursToSvgPath } from "@/font/geometry";
import { drawLetter } from "@/forge/build";
import { formOf, isException, partsOf, reach, styleFor } from "@/forge/document";
import { formsOf } from "@/forge/letters";
import {
  METRIC_CONTROLS,
  PART_SPECS,
  PEN_CONTROLS,
  specFor,
  valuesOf,
  type FieldControl,
  type PartControl,
  type PartName,
} from "@/forge/parts";
import { BASES } from "@/forge/style";
import { forgeStore, useForge, type Phase } from "@/state/useForge";
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { cn } from "@/ui/lib/utils";

export function ForgePanel(): React.JSX.Element {
  const state = useForge();
  const { forge, letter, scope } = state;

  /*
   * Every part the font has, not only the ones this letter happens to use.
   *
   * Showing the letter's own parts and nothing else was the original rule, and
   * it read well: open an o and you are offered a bowl, open an n and you are
   * offered a shoulder. What it cost was that the two controls which change a
   * face most -- how square the bowls are, and how far a corner is rounded --
   * were invisible on the letter the application opens on. Squareness lives on
   * an o, rounding lives on an A or a k, and n has neither. There was no way to
   * find out that the tool could square a bowl at all without first guessing
   * that you should go and click on a different letter.
   *
   * So all of them are shown, the ones this letter uses first, and the rest
   * marked as belonging to letters elsewhere. What each edit reaches is still
   * said out loud on every part, which is the thing that actually needed
   * saying.
   */
  const mine = React.useMemo(
    () => new Set(partsOf(letter, forge)),
    [letter, forge, state.revision],
  );
  const held = isException(forge, letter);

  return (
    <aside
      aria-label="Forge"
      className="toolcraft-panel-surface flex w-80 shrink-0 flex-col border-l border-border"
    >
      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
        <Section title="Start from">
          <div className="grid grid-cols-2 gap-1.5">
            {BASES.map((base) => (
              <button
                key={base.name}
                type="button"
                onClick={() => forgeStore.startFromBase(base.name)}
                aria-pressed={forge.base === base.name}
                title={base.blurb}
                data-forge-base={base.name}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-left text-2xs transition-colors",
                  forge.base === base.name
                    ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_12%,transparent)] text-foreground"
                    : "border-border text-muted-foreground hover:border-muted-foreground hover:bg-card",
                )}
              >
                {base.name}
              </button>
            ))}
          </div>
          <p className="pt-2 text-2xs leading-snug text-muted-foreground">
            {BASES.find((base) => base.name === forge.base)?.blurb}
          </p>
          <p className="pt-1.5 text-2xs leading-snug text-muted-foreground">
            One set of skeletons, eight sets of decisions over it. Not one letter
            is drawn differently between them, and every control below stays live
            whichever you pick. Choosing one starts again from it.
          </p>
        </Section>

        <Section title="The pen">
          {PEN_CONTROLS.map((control) => (
            <Field
              key={control.key}
              control={control}
              value={(forge.style.pen as unknown as Record<string, number>)[control.key]}
              onChange={(next, phase) => forgeStore.changePen({ [control.key]: next }, phase)}
            />
          ))}
        </Section>

        <div className="border-b border-border p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-2xs font-medium">Parts of {letter}</h3>
            {held && (
              <button
                type="button"
                onClick={() => forgeStore.rejoinFamily()}
                className="text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70"
              >
                Rejoin the family
              </button>
            )}
          </div>

          <div className="flex gap-0.5 rounded-md bg-card/60 p-0.5" role="group" aria-label="Scope">
            <button
              type="button"
              aria-pressed={scope === "family"}
              onClick={() => forgeStore.setScope("family")}
              className={segment(scope === "family", "flex-1")}
            >
              Whole font
            </button>
            <button
              type="button"
              aria-pressed={scope === "letter"}
              onClick={() => forgeStore.setScope("letter")}
              className={segment(scope === "letter", "flex-1")}
            >
              {letter} alone
            </button>
          </div>
          <p className="pt-2 text-2xs leading-snug text-muted-foreground">
            {scope === "family"
              ? "An edit reaches every letter with that part."
              : `An edit makes ${letter} an exception and leaves the rest alone.`}
          </p>
        </div>

        {/* Always in the same order, whichever letter is open. A panel whose
            controls move about as you click around is one nobody can learn. */}
        {PART_SPECS.map((spec) => (
          <Part key={spec.name} part={spec.name} mine={mine.has(spec.name)} />
        ))}

        <Section title="Proportions">
          {METRIC_CONTROLS.map((control) => (
            <Field
              key={control.key}
              control={control}
              value={(forge.style.metrics as unknown as Record<string, number>)[control.key]}
              onChange={(next, phase) => forgeStore.changeMetrics({ [control.key]: next }, phase)}
            />
          ))}
        </Section>

        <Forms letter={letter} />

      </div>
    </aside>
  );
}

/**
 * The other ways this letter can be drawn.
 *
 * Shown as the shapes themselves rather than as their names, because the
 * difference between a one-storey a and a two-storey one is a shape and nobody
 * reads "two storey" and sees it. Each thumbnail is the letter drawn with the
 * font as it stands, so what is being compared is this font's version of each
 * rather than a picture of the idea.
 *
 * Only appears on letters that have another form. Most do not, and a row of
 * one option would be a control that cannot be used.
 */
function Forms({ letter }: { letter: string }): React.JSX.Element | null {
  const state = useForge();
  const forms = React.useMemo(() => formsOf(letter), [letter]);
  const chosen = formOf(state.forge, letter);

  const drawings = React.useMemo(
    () =>
      forms.map((form) => {
        const drawn = drawLetter(letter, styleFor(letter, state.forge), form.id);
        return { ...form, d: drawn ? contoursToSvgPath(drawn.contours) : "", width: drawn?.advanceWidth ?? 1 };
      }),
    [forms, letter, state.forge, state.revision],
  );

  if (forms.length === 0) return null;
  const { metrics } = state.forge.style;

  return (
    <section className="border-b border-border p-3" data-forge-forms={letter}>
      <h3 className="pb-2 text-2xs font-medium">Shape of {letter}</h3>
      <div className="flex flex-wrap gap-1.5">
        {drawings.map((form) => (
          <button
            key={form.id || "default"}
            type="button"
            title={`${form.label}: ${form.hint}`}
            aria-pressed={chosen === form.id}
            aria-label={form.label}
            onClick={() => forgeStore.chooseAlternate(form.id)}
            data-forge-form={form.id || "default"}
            className={cn(
              "flex size-12 items-center justify-center rounded-md border transition-colors",
              chosen === form.id
                ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_12%,transparent)]"
                : "border-border hover:border-muted-foreground hover:bg-card",
            )}
          >
            <svg
              viewBox={`0 ${-metrics.ascender} ${Math.max(form.width, 1)} ${metrics.ascender - metrics.descender}`}
              className="h-8 w-8"
              aria-hidden
            >
              <g transform="scale(1,-1)">
                <path d={form.d} fill="var(--foreground)" fillRule="nonzero" />
              </g>
            </svg>
          </button>
        ))}
      </div>
      <p className="pt-2 text-2xs leading-snug text-muted-foreground">
        A different skeleton for this letter alone. The pen, the proportions and
        every part still reach it.
      </p>
    </section>
  );
}

/** One part, with what it reaches and the controls that change it. */
function Part({ part, mine }: { part: PartName; mine: boolean }): React.JSX.Element | null {
  const state = useForge();
  const spec = specFor(part);
  const { letters, held } = React.useMemo(
    () => reach(state.forge, part),
    [state.forge, part, state.revision],
  );
  if (!spec) return null;

  // Shown from the family's values even in letter scope: an exception starts
  // from where the family is, so this is what the first drag will move away
  // from either way.
  const values = valuesOf(part, state.forge.style.parts);
  const pinned = isException(state.forge, state.letter, part);

  return (
    <section
      className="border-b border-border p-3"
      data-forge-part={part}
      data-forge-part-here={mine ? "yes" : "no"}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className={cn("text-2xs font-medium", !mine && "text-muted-foreground")}>
          {spec.label}
          {!mine && <span className="pl-1.5 font-normal">· not in {state.letter}</span>}
        </h4>
        {pinned ? (
          <button
            type="button"
            onClick={() => forgeStore.rejoinFamily(part)}
            className="shrink-0 text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70"
          >
            held · release
          </button>
        ) : (
          <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
            {letters.length} {letters.length === 1 ? "letter" : "letters"}
            {held.length > 0 && ` · ${held.length} holding`}
          </span>
        )}
      </div>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">{spec.hint}</p>

      <div className="pt-2">
        {spec.controls.map((control) => (
          <Control key={control.key} part={part} control={control} values={values} />
        ))}
      </div>
    </section>
  );
}

function Control({
  part,
  control,
  values,
}: {
  part: PartName;
  control: PartControl;
  values: Record<string, number | boolean | string>;
}): React.JSX.Element {
  const state = useForge();
  const em = state.forge.style.metrics.unitsPerEm;
  const scale = control.emRelative ? em : 1;

  /*
   * A choice between named shapes rather than a number.
   *
   * Drawn as a row rather than as a menu because there are three of them and
   * the difference between them is a shape: put side by side they can be
   * compared, and behind a menu they have to be remembered.
   */
  if (control.options) {
    const chosen = String(values[control.key]);
    return (
      <div className="py-1">
        <div className="pb-1 text-2xs text-foreground">{control.label}</div>
        <div className="flex gap-0.5 rounded-md bg-card/60 p-0.5" role="group" aria-label={control.label}>
          {control.options.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              aria-pressed={chosen === option.value}
              onClick={() => forgeStore.changePart(part, { [control.key]: option.value } as never)}
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
          onClick={() =>
            forgeStore.changePart(part, { [control.key]: !on } as never)
          }
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
          here; passing an identifier instead showed people "slab-projection". */}
      <Slider
        name={control.label}
        value={value / scale}
        min={control.min}
        max={control.max}
        step={control.step}
        showFill
        onValueChange={(next: number, meta?: { history?: string }) =>
          forgeStore.changePart(
            part,
            { [control.key]: next * scale } as never,
            meta?.history === "merge" ? "during" : "end",
          )
        }
      />
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="border-b border-border p-3">
      <h3 className="pb-2 text-2xs font-medium">{title}</h3>
      {children}
    </section>
  );
}

/**
 * One control on the pen or the proportions, drawn from its own description.
 *
 * The panel used to write these out by hand, which is how two of them came to
 * exist in the panel and nowhere else. Generated from the same table the tests
 * read, a control that changes nothing is a failing test rather than a slider
 * somebody drags and puts back.
 */
function Field({
  control,
  value,
  onChange,
}: {
  control: FieldControl;
  value: number;
  onChange: (value: number, phase: Phase) => void;
}): React.JSX.Element {
  const state = useForge();
  const scale = control.emRelative ? state.forge.style.metrics.unitsPerEm : 1;
  return (
    <div className="py-1">
      <Slider
        name={control.label}
        value={value}
        min={control.min * scale}
        max={control.max * scale}
        step={Math.max(control.step * scale, 0.001)}
        showFill
        onValueChange={(next: number, meta?: { history?: string }) =>
          onChange(next, meta?.history === "merge" ? "during" : "end")
        }
      />
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
    </div>
  );
}

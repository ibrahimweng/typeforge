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
import { isException, partsOf, reach } from "@/forge/document";
import { specFor, valuesOf, type PartControl, type PartName } from "@/forge/parts";
import { BASES } from "@/forge/style";
import { forgeStore, useForge, type Phase } from "@/state/useForge";
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { cn } from "@/ui/lib/utils";

export function ForgePanel(): React.JSX.Element {
  const state = useForge();
  const { forge, letter, scope } = state;

  const parts = React.useMemo(() => partsOf(letter, forge), [letter, forge, state.revision]);
  const held = isException(forge, letter);

  return (
    <aside
      aria-label="Forge"
      className="toolcraft-panel-surface flex w-80 shrink-0 flex-col border-l border-border"
    >
      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
        <Section title="Start from">
          <div className="flex gap-1.5">
            {BASES.map((base) => (
              <button
                key={base.name}
                type="button"
                onClick={() => forgeStore.startFromBase(base.name)}
                aria-pressed={forge.base === base.name}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1.5 text-2xs transition-colors",
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
            Three sets of decisions over one set of skeletons. Picking one starts again from it.
          </p>
        </Section>

        <Section title="The pen">
          <Numeric
            label="Weight"
            hint="How wide the pen is. Every letter is redrawn at the new width rather than pushed outwards, so this cannot fold a stroke however far it goes."
            value={forge.style.pen.weight}
            min={forge.style.metrics.unitsPerEm * 0.01}
            max={forge.style.metrics.unitsPerEm * 0.26}
            step={1}
            onChange={(weight, phase) => forgeStore.changePen({ weight }, phase)}
          />
          <Numeric
            label="Contrast"
            hint="How much thinner the strokes running across the pen are. Zero is monolinear, which is a sans; more is what gives a serif its thick and thin."
            value={forge.style.pen.contrast}
            min={0}
            max={0.85}
            step={0.01}
            onChange={(contrast, phase) => forgeStore.changePen({ contrast }, phase)}
          />
          <Numeric
            label="Pen angle"
            hint="Which way the pen is broadest, as a nib is held."
            value={forge.style.pen.angle}
            min={-40}
            max={40}
            step={0.5}
            onChange={(angle, phase) => forgeStore.changePen({ angle }, phase)}
          />
        </Section>

        <Section title="Proportions">
          <Numeric
            label="x-height"
            hint="How tall the lowercase is. Most of reading happens here, so it does more for the character of a face than almost anything else."
            value={forge.style.metrics.xHeight}
            min={forge.style.metrics.unitsPerEm * 0.3}
            max={forge.style.metrics.unitsPerEm * 0.68}
            step={1}
            onChange={(xHeight, phase) => forgeStore.changeMetrics({ xHeight }, phase)}
          />
          <Numeric
            label="Cap height"
            hint="How tall the capitals are."
            value={forge.style.metrics.capHeight}
            min={forge.style.metrics.unitsPerEm * 0.5}
            max={forge.style.metrics.unitsPerEm * 0.85}
            step={1}
            onChange={(capHeight, phase) => forgeStore.changeMetrics({ capHeight }, phase)}
          />
          <Numeric
            label="Rhythm"
            hint="The width inside an n, which sets how wide everything with two uprights runs. The round letters are as wide as they are tall and do not read it."
            value={forge.style.metrics.counterWidth}
            min={forge.style.metrics.unitsPerEm * 0.15}
            max={forge.style.metrics.unitsPerEm * 0.6}
            step={1}
            onChange={(counterWidth, phase) => forgeStore.changeMetrics({ counterWidth }, phase)}
          />
          <Numeric
            label="Spacing"
            hint="White space either side of every letter."
            value={forge.style.metrics.sidebearing}
            min={0}
            max={forge.style.metrics.unitsPerEm * 0.2}
            step={1}
            onChange={(sidebearing, phase) => forgeStore.changeMetrics({ sidebearing }, phase)}
          />
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

        {parts.length === 0 && (
          <p className="p-3 text-2xs text-muted-foreground">
            This glyph is drawn from the pen and the proportions alone; it has no named parts.
          </p>
        )}

        {parts.map((part) => (
          <Part key={part} part={part} />
        ))}
      </div>
    </aside>
  );
}

/** One part, with what it reaches and the controls that change it. */
function Part({ part }: { part: PartName }): React.JSX.Element | null {
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
    <section className="border-b border-border p-3" data-forge-part={part}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-2xs font-medium">{spec.label}</h4>
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

/** A plain number with a slider, for the pen and the proportions. */
function Numeric({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number, phase: Phase) => void;
}): React.JSX.Element {
  return (
    <div className="py-1">
      <Slider
        name={label}
        value={value}
        min={min}
        max={max}
        step={step}
        showFill
        onValueChange={(next: number, meta?: { history?: string }) =>
          onChange(next, meta?.history === "merge" ? "during" : "end")
        }
      />
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

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
import type { Cuts } from "@/forge/cut";
import {
  cutsFor,
  cutsHeldBy,
  cutsOf,
  formOf,
  isCutException,
  isException,
  partsOf,
  reach,
  styleFor,
} from "@/forge/document";
import type { Imported } from "@/forge/exchange";
import { formsOf } from "@/forge/letters";
import {
  CUT_SPECS,
  METRIC_CONTROLS,
  PART_SPECS,
  PEN_CONTROLS,
  cutValuesOf,
  specFor,
  valuesOf,
  type CutSpec,
  type FieldControl,
  type PartControl,
  type PartName,
} from "@/forge/parts";
import { BASES, FAMILIES } from "@/forge/style";
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
          {/*
            Under headings rather than in one grid. A dozen and a half starting
            points in a single block is a dozen and a half guesses; the same
            ones under four headings say what kind of thing a typeface can be,
            and make it visible that the difference between a grotesque and a
            didone is a set of numbers rather than a different program.
          */}
          {FAMILIES.map((family) => {
            const members = BASES.filter((base) => base.family === family.id);
            if (members.length === 0) return null;
            return (
              <div key={family.id} className="pb-2 last:pb-0">
                <p
                  className="pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground"
                  title={family.hint}
                  data-forge-family={family.id}
                >
                  {family.label}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {members.map((base) => (
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
              </div>
            );
          })}
          <p className="pt-2 text-2xs leading-snug text-muted-foreground">
            {BASES.find((base) => base.name === forge.base)?.blurb}
          </p>
          <p className="pt-1.5 text-2xs leading-snug text-muted-foreground">
            One set of skeletons under all of them. Not one letter is drawn
            differently between these, and every control below stays live
            whichever you pick. Choosing one starts again from it.
          </p>
        </Section>

        <Section title="The pen">
          {PEN_CONTROLS.map((control) => (
            <Field
              key={control.key}
              on="pen"
              control={control}
              value={(forge.style.pen as unknown as Record<string, number>)[control.key]}
              onChange={(next, phase) => forgeStore.changePen({ [control.key]: next } as never, phase)}
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
              on="metrics"
              control={control}
              value={(forge.style.metrics as unknown as Record<string, number | boolean>)[control.key]}
              onChange={(next, phase) => forgeStore.changeMetrics({ [control.key]: next } as never, phase)}
            />
          ))}
        </Section>

        <Cuts />

        <Forms letter={letter} />

        <Trip key={letter} letter={letter} />

      </div>
    </aside>
  );
}

/**
 * What is taken out of the letters after they are drawn.
 *
 * A second layer with its own heading rather than six more parts, because it
 * is a different kind of decision and saying so is most of what makes it
 * usable. Everything above describes how a stroke is made; everything here
 * happens to the letter once it has been. The two stay separable, which is why
 * turning the weight up on a face full of slots redraws the letters heavier
 * and cuts the same slots through them.
 *
 * Each cut is a switch with its own settings folded underneath it, so the
 * panel is six rows until somebody wants more than six rows. A control that is
 * off has nothing worth reading.
 */
function Cuts(): React.JSX.Element {
  const state = useForge();
  const { forge, letter, scope } = state;
  /*
   * In letter scope this shows what the letter actually has, rather than what
   * the font has -- which is where this parts company with the rows above.
   *
   * The difference is in how the two are used. A part exception is rare and
   * starts from the family's value, so showing the family's value is showing
   * what the first drag moves away from. A cut exception is the ordinary way
   * to deal with the letter that has nowhere to put the third slot, and it
   * gets adjusted again; showing the font's value there would be showing a
   * number this letter is not cut by.
   */
  const cuts = scope === "letter" ? cutsFor(letter, forge) : cutsOf(forge);
  const held = cutsHeldBy(forge, letter);

  return (
    <section className="border-b border-border p-3" data-forge-cuts>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-2xs font-medium">Cut</h3>
        {held.length > 0 && (
          <button
            type="button"
            onClick={() => forgeStore.releaseCut()}
            data-forge-release-cuts
            className="shrink-0 text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70"
          >
            {letter} holds {held.length} · release
          </button>
        )}
      </div>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">
        Taken out after the letter is drawn, so every control above still
        reaches it. Sizes are in stem widths, which is what keeps a cut meaning
        the same thing at every weight.
      </p>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">
        {scope === "family"
          ? "Cutting the whole font."
          : `Cutting ${letter} alone. The rest of the font keeps its own.`}
      </p>

      {CUT_SPECS.map((spec) => (
        <Cutting key={spec.name} spec={spec} cuts={cuts} />
      ))}
    </section>
  );
}

/** One cut: a switch, and its settings once it is on. */
function Cutting({
  spec,
  cuts,
}: {
  spec: CutSpec;
  cuts: Cuts;
}): React.JSX.Element {
  const state = useForge();
  const values = cutValuesOf(spec.name, cuts);
  const on = Boolean(values.on);
  const pinned = isCutException(state.forge, state.letter, spec.name);

  return (
    <div className="border-t border-border pt-2 first-of-type:mt-2" data-forge-cut={spec.name}>
      <label className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-2xs font-medium text-foreground">{spec.label}</span>
        {pinned && (
          <button
            type="button"
            onClick={() => forgeStore.releaseCut(spec.name)}
            className="shrink-0 text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70"
          >
            held
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={spec.label}
          data-forge-cut-switch={spec.name}
          onClick={() => forgeStore.changeCut(spec.name, { on: !on } as never)}
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
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{spec.hint}</p>

      {on && (
        <div className="pt-1">
          {spec.controls.map((control) => (
            <Control
              key={control.key}
              id={`cut:${spec.name}:${control.key}`}
              control={control}
              values={values}
              onChange={(patch, phase) => forgeStore.changeCut(spec.name, patch as never, phase)}
            />
          ))}
        </div>
      )}
    </div>
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
        // Cut as the rest of the font is, so what is being compared is this
        // font's version of each shape rather than a picture of the idea.
        const drawn = drawLetter(
          letter,
          styleFor(letter, state.forge),
          form.id,
          cutsFor(letter, state.forge),
        );
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

/**
 * Taking one letter out of the system, and putting it back.
 *
 * The one thing a parametric font tool cannot do is the letter you have in
 * your head that no arrangement of sliders reaches. So a letter can leave as a
 * drawing, be worked on in whatever tool draws best, and come back into the
 * space it left -- keeping its advance, so the rhythm of the font does not
 * change under it.
 *
 * What it costs is said plainly rather than discovered later. A letter that
 * came in from outside is an outline, not a description: the weight control
 * cannot reach it and neither can the serif, because there is no pen. That is
 * worth knowing before the next family-wide edit quietly misses it, and it is
 * one button to undo.
 */
function Trip({ letter }: { letter: string }): React.JSX.Element {
  const state = useForge();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const outside: Imported | undefined = state.forge.imported[letter];

  const send = (): void => {
    const svg = forgeStore.letterAsSvg(letter);
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${nameForFile(letter)}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const receive = async (file: File | undefined): Promise<void> => {
    setProblem(null);
    setNotice(null);
    if (!file) return;
    const text = await file.text();
    // Read before taking, so a file that turns out to be for a different
    // letter can say so rather than land somewhere surprising.
    const arrival = forgeStore.readSheet(text, letter);
    if (!arrival) {
      setProblem("Nothing in that file could be read as an outline.");
      return;
    }
    forgeStore.takeLetter(arrival, file.name);
    if (arrival.mismatched) {
      setNotice(`That file was drawn for ${arrival.note?.name}. It has gone into ${letter}.`);
    }
  };

  return (
    <section className="border-b border-border p-3" data-forge-trip={letter}>
      <h3 className="pb-2 text-2xs font-medium">Draw {letter} yourself</h3>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={send}
          data-forge-send-svg={letter}
          className="flex-1 rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
        >
          Download SVG
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-forge-take-svg={letter}
          className="flex-1 rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
        >
          Put one back
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        data-forge-svg-input={letter}
        onChange={(event) => {
          void receive(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {problem && (
        <p className="pt-2 text-2xs leading-snug text-[color:var(--destructive)]">{problem}</p>
      )}
      {notice && <p className="pt-2 text-2xs leading-snug text-muted-foreground">{notice}</p>}

      {outside ? (
        <div className="pt-2" data-forge-imported={letter}>
          <p className="text-2xs leading-snug text-muted-foreground">
            {letter} is your drawing, from {outside.from}. It keeps its advance, and
            nothing in this panel reaches it any more -- there is no pen behind
            it to change.
          </p>
          <button
            type="button"
            onClick={() => forgeStore.redrawLetter(letter)}
            data-forge-redraw={letter}
            className="mt-1.5 w-full rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
          >
            Draw it from the family again
          </button>
        </div>
      ) : (
        <p className="pt-2 text-2xs leading-snug text-muted-foreground">
          The sheet carries the baseline, the x-height and the sidebearings as
          guides. Edit the black outline anywhere, and it comes back into this
          letter's space at the width it left with.
        </p>
      )}
    </section>
  );
}

/**
 * What the downloaded file is called.
 *
 * The names are already safe to write to disk -- the marks travel as `period`
 * and `question` rather than as themselves -- so the only thing left to settle
 * is case. A and a are different letters and would land in the same file on a
 * filesystem that does not think so, which is most of them. An underscore
 * after each capital is how the UFO format has always answered this, and
 * somebody drawing type will have seen it before.
 */
function nameForFile(letter: string): string {
  return letter.replace(/[A-Z]/g, (capital) => `${capital}_`);
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
          <Control
            key={control.key}
            id={`part:${part}:${control.key}`}
            control={control}
            values={values}
            onChange={(patch, phase) => forgeStore.changePart(part, patch as never, phase)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * One editable number, switch or choice, drawn from its own description.
 *
 * Told where to send a change rather than knowing: the same control row serves
 * the parts and the cuts, which are edited through different calls and are
 * otherwise described identically. Writing it twice would have meant two rows
 * that drift apart, and the one that drifts is the one nobody is looking at.
 */
function Control({
  id,
  control,
  values,
  onChange,
}: {
  /** Names this control for the panel to scroll to when the letter is asked. */
  id: string;
  control: PartControl;
  values: Record<string, number | boolean | string>;
  onChange: (patch: Record<string, number | boolean | string>, phase: Phase) => void;
}): React.JSX.Element {
  const state = useForge();
  const em = state.forge.style.metrics.unitsPerEm;
  const scale = control.emRelative ? em : 1;
  const { ref, shown } = useShown(id);

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
    <div className={cn("py-1", shown && SHOWN)} ref={ref} data-forge-control={id}>
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
          onChange(
            { [control.key]: next * scale },
            meta?.history === "merge" ? "during" : "end",
          )
        }
      />
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
    </div>
  );
}

/**
 * Bring a control into view when the letter is asked about it.
 *
 * Pressing a spot on the drawing names a control, and a name is no use if the
 * control it names is forty rows down a scrolling panel. So the row is scrolled
 * to, marked for a moment so it can be found by eye among its neighbours, and
 * its slider is given the keyboard -- which makes the arrow keys work on the
 * thing that was just pressed, and is the fastest way to nudge a number.
 *
 * Keyed on how many times the question has been asked rather than on which
 * control was named, or pressing the same spot twice would scroll once.
 */
function useShown(id: string): {
  ref: React.RefObject<HTMLDivElement | null>;
  shown: boolean;
} {
  const state = useForge();
  const ref = React.useRef<HTMLDivElement>(null);
  const mine = state.focus?.id === id;
  const asked = mine ? state.focus?.asked : null;

  React.useEffect(() => {
    if (!mine || !ref.current) return;
    ref.current.scrollIntoView({ block: "center", behavior: "smooth" });
    const slider = ref.current.querySelector<HTMLElement>('[role="slider"]');
    slider?.focus({ preventScroll: true });
  }, [mine, asked]);

  return { ref, shown: mine };
}

/** How a row marks itself while it is the one being pointed at. */
const SHOWN = "-mx-1 rounded-md px-1 ring-1 ring-[color:var(--accent)]";

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
  on,
}: {
  control: FieldControl;
  /** Which half of the style this control lives in, for naming it. */
  on: "pen" | "metrics";
  /*
   * Undefined is a real state, not a mistake to be asserted away.
   *
   * A control whose setting is optional has no value on a base that never set
   * it, and the panel reads the style rather than a defaulted copy of it. The
   * first optional setting to arrive found this out the hard way: fed to a
   * slider, an absent value took the whole view down.
   */
  value: number | boolean | undefined;
  onChange: (value: number | boolean, phase: Phase) => void;
}): React.JSX.Element {
  const state = useForge();
  const scale = control.emRelative ? state.forge.style.metrics.unitsPerEm : 1;
  const id = `${on}:${control.key}`;
  const { ref, shown } = useShown(id);

  if (control.toggle) {
    const switched = Boolean(value);
    return (
      <label
        className={cn("flex items-center justify-between gap-2 py-1.5", shown && SHOWN)}
        ref={ref as unknown as React.RefObject<HTMLLabelElement>}
        data-forge-control={id}
      >
        <span className="min-w-0 flex-1 text-2xs text-foreground">{control.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={switched}
          aria-label={control.label}
          onClick={() => onChange(!switched, "single")}
          className={cn(
            "h-4 w-7 shrink-0 rounded-full transition-colors",
            switched ? "bg-[color:var(--accent)]" : "bg-card",
          )}
        >
          <span
            className={cn(
              "block size-3 rounded-full bg-background transition-transform",
              switched ? "translate-x-3.5" : "translate-x-0.5",
            )}
          />
        </button>
      </label>
    );
  }

  return (
    <div className={cn("py-1", shown && SHOWN)} ref={ref} data-forge-control={id}>
      <Slider
        name={control.label}
        value={Number(value ?? control.min * scale)}
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

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

import { segment, WIDE_PANEL } from "@/components/controls";
import { contoursToSvgPath } from "@/font/geometry";
import { filled, FILL_KINDS } from "@/forge/kit";
import { drawLetter } from "@/forge/build";
import { CutPanel } from "@/components/CutPanel";
import { TakeToEditor } from "@/components/TakeToEditor";
import {
  castFor,
  castHeldBy,
  castOf,
  effectsOf,
  cutsFor,
  cutsHeldBy,
  cutsOf,
  formOf,
  isException,
  isImported,
  kitOf,
  partsOf,
  reach,
  styleFor,
  tilesFor,
} from "@/forge/document";
import type { Imported } from "@/forge/exchange";
import { formsOf } from "@/forge/letters";
import {
  METRIC_CONTROLS,
  SCRIPT_CONTROLS,
  PART_SPECS,
  PEN_CONTROLS,
  specFor,
  valuesOf,
  type FieldControl,
  type PartControl,
  type PartName,
} from "@/forge/parts";
import { BASES, FAMILIES } from "@/forge/style";
import { forgeStore, useForge, type Phase } from "@/state/useForge";
import { store } from "@/state/useStore";
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { cn } from "@/ui/lib/utils";

export function ForgePanel({ onEdit }: { onEdit: () => Promise<void> }): React.JSX.Element {
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
      className={cn(WIDE_PANEL, "toolcraft-panel-surface flex shrink-0 flex-col border-l border-border")}
    >
      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
        <Section title="Start from" mark="start">
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
            One set of skeletons under all of them, so every control below stays
            live whichever you pick. Choosing one starts again from it.
          </p>
        </Section>

        <Section title="The pen" mark="pen">
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

        <Section title="Proportions" mark="proportions">
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


        <Group
          title="Shape the parts"
          mark="parts"
          said="A serif, a shoulder, a corner. Change one and every letter that has it follows."
        />

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

        <Joining />

        <KitPanel />


        <Group
          title="Finishing"
          mark="finishing"
          said="What is taken away from the letters, what is added on top, and what the pen is made of."
        />

        <Cuts />

        <Cast />

        <Tool />


        <Group
          title={`${letter} alone`}
          mark="letter"
          said="These reach only the letter on screen. Everything above reaches the whole font."
        />

        <Forms letter={letter} />

        <Trip key={letter} letter={letter} />

      </div>
      {/*
        Outside the scrolling column, at the foot, because it is the one thing
        in this panel that leaves it. Everything above changes the letters;
        this hands them on.
      */}
      <TakeToEditor onEdit={onEdit} what="every letter in this family" />
    </aside>
  );
}

/**
 * Letters built on a grid, out of a small set of parts.
 *
 * A different construction rather than a different setting, so it is one
 * switch and everything under it belongs to it. What it does not change is
 * worth saying out loud in the panel: the pen still draws these letters, so
 * weight and contrast and terminals all still reach them, and the cuts still
 * cut them.
 */
function KitPanel(): React.JSX.Element {
  const state = useForge();
  const { forge, letter } = state;
  const kit = kitOf(forge);
  const tiles = tilesFor(forge, letter);
  const laid = Object.keys(kit.glyphs).length;

  return (
    <section className="border-b border-border p-3" data-forge-kit>
      <label className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-2xs font-medium text-foreground">Build on a grid</span>
        <button
          type="button"
          role="switch"
          aria-checked={kit.on}
          aria-label="Build on a grid"
          data-forge-kit-switch
          onClick={() => forgeStore.useKit(!kit.on)}
          className={cn(
            "h-4 w-7 shrink-0 rounded-full transition-colors",
            kit.on ? "bg-[color:var(--accent)]" : "bg-card",
          )}
        >
          <span
            className={cn(
              "block size-3 rounded-full bg-background transition-transform",
              kit.on ? "translate-x-3.5" : "translate-x-0.5",
            )}
          />
        </button>
      </label>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">
        Every letter assembled from the same few parts on the same grid. The pen
        still draws them, so weight, contrast and terminals all still reach
        them, and the cuts still cut them.
      </p>

      {kit.on && (
        <>
          <p className="pt-2 text-2xs leading-snug text-muted-foreground">
            Press a spot on a cell's edge to send a stroke out through it.
            Double-click the middle of a cell to fill it in. {laid}{" "}
            {laid === 1 ? "letter is" : "letters are"} laid out.
          </p>

          {GRID_CONTROLS.map((control) => (
            <div className="py-1" key={control.key}>
              <Slider
                name={control.label}
                value={Number((kit.grid as unknown as Record<string, number>)[control.key])}
                min={control.min}
                max={control.max}
                step={control.step}
                showFill
                onValueChange={(next: number, meta?: { history?: string }) =>
                  forgeStore.changeGrid(
                    { [control.key]: next } as never,
                    meta?.history === "merge" ? "during" : "end",
                  )
                }
              />
              <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
            </div>
          ))}

          <div className="py-1">
            <Slider
              name="Roundness"
              value={kit.roundness}
              min={0}
              max={1}
              step={0.01}
              showFill
              onValueChange={(next: number, meta?: { history?: string }) =>
                forgeStore.changeRoundness(next, meta?.history === "merge" ? "during" : "end")
              }
            />
            <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">
              How a turn inside a cell is taken: nothing is a square corner, one
              is a quarter of a circle touching both edges. Held above what the
              pen can bend through, so asking for rounder than it can go leaves
              the corner square rather than folding it.
            </p>
          </div>

          <Palette />

          {tiles && (
            <div className="py-1">
              <Slider
                name={`Cells across ${letter}`}
                value={tiles.columns}
                min={1}
                max={12}
                step={1}
                showFill
                onValueChange={(next: number, meta?: { history?: string }) =>
                  forgeStore.changeColumns(next, meta?.history === "merge" ? "during" : "end")
                }
              />
              <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">
                What this letter is spaced by. Cells are square, so this is its
                width and its rhythm at once.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 pt-2">
            <button
              type="button"
              onClick={() => forgeStore.layOutLetters(false)}
              data-forge-kit-relay
              className="flex-1 rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
            >
              Lay {letter} out again
            </button>
            <button
              type="button"
              onClick={() => forgeStore.clearLetter()}
              data-forge-kit-clear
              className="flex-1 rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
            >
              Empty {letter}
            </button>
            <button
              type="button"
              onClick={() => forgeStore.layOutLetters(true)}
              data-forge-kit-relay-all
              className="w-full rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
            >
              Lay the whole font out again
            </button>
          </div>
          <p className="pt-2 text-2xs leading-snug text-muted-foreground">
            Laying out reads the skeletons this font already has and puts them
            on the grid. It is an approximation and is meant to be: a stem lands
            exactly, a shoulder lands on the nearest eight places a stroke can
            leave a square. Every cell of it is one press to change.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The shapes a press on a cell puts down.
 *
 * Drawn from the same geometry that fills the cell, so what is in the palette
 * is exactly what lands -- a picture of a tile redrawn by hand in the panel is
 * a picture that goes out of date the first time the tile changes.
 *
 * The eraser is the first one and is where it starts, so a stray press on the
 * stage cannot quietly fill a cell in. Turning is one button rather than four
 * copies of every shape: five shapes and a turn is a row anybody can read, and
 * twenty tiles is a menu.
 */
function Palette(): React.JSX.Element {
  const state = useForge();
  const chosen = state.fill;
  const turn = chosen?.turn ?? 0;
  const box = { xMin: 0, yMin: 0, xMax: 1, yMax: 1 };

  return (
    <div className="pt-2" data-forge-fills>
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <span className="text-2xs text-foreground">Fill a cell</span>
        <button
          type="button"
          onClick={() => chosen && forgeStore.chooseFill({ ...chosen, turn: (turn + 1) % 4 })}
          disabled={!chosen}
          data-forge-fill-turn
          className="shrink-0 text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70 disabled:opacity-30"
        >
          Turn
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={chosen === null}
          aria-label="Erase"
          title="Erase: press a cell to take its shape out"
          onClick={() => forgeStore.chooseFill(null)}
          data-forge-fill="none"
          className={cn(
            "flex size-9 items-center justify-center rounded-md border text-2xs transition-colors",
            chosen === null
              ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_12%,transparent)] text-foreground"
              : "border-border text-muted-foreground hover:border-muted-foreground hover:bg-card",
          )}
        >
          None
        </button>
        {FILL_KINDS.map((kind) => {
          const fill = { kind, turn };
          const on = chosen?.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              aria-label={kind}
              title={FILL_HINTS[kind]}
              onClick={() => forgeStore.chooseFill(fill)}
              data-forge-fill={kind}
              className={cn(
                "flex size-9 items-center justify-center rounded-md border transition-colors",
                on
                  ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_12%,transparent)]"
                  : "border-border hover:border-muted-foreground hover:bg-card",
              )}
            >
              <svg viewBox="0 0 1 1" className="size-5" aria-hidden>
                <g transform="translate(0,1) scale(1,-1)">
                  <path d={contoursToSvgPath(filled(fill, box), 4)} fill="var(--foreground)" />
                </g>
              </svg>
            </button>
          );
        })}
      </div>
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">
        {chosen
          ? `Press a cell to put a ${chosen.kind} in it, and press it again to take it out.`
          : "Press a cell to take whatever shape is in it out. Choose a shape to put one in."}
      </p>
    </div>
  );
}

const FILL_HINTS: Record<string, string> = {
  full: "The whole cell. What a heavy grid face is mostly made of.",
  pie: "A quarter disc about one corner. Four of them round a shared corner make a circle.",
  bite: "The cell with that quarter taken out, which is what turns a block into the inside of a C.",
  half: "The cell cut across the middle.",
  wedge: "The cell cut corner to corner.",
};

/** The grid itself, counted in cells rather than measured in units. */
const GRID_CONTROLS = [
  {
    key: "rows",
    label: "Rows to the cap height",
    hint: "What sets the size of a cell, and with it how coarse the whole alphabet is. Fewer rows is a blockier face built from bigger parts.",
    min: 2,
    max: 12,
    step: 1,
  },
  {
    key: "below",
    label: "Rows below the baseline",
    hint: "How far the grid reaches down, for the descenders.",
    min: 0,
    max: 5,
    step: 1,
  },
  {
    key: "above",
    label: "Rows above the cap",
    hint: "How far it reaches up, for the ascenders and the accents.",
    min: 0,
    max: 5,
    step: 1,
  },
];

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
/**
 * What is put on the letters, and which way round the two layers go.
 *
 * Drawn by the shared panel rather than by a copy of the rows above, because a
 * cast is described in exactly the shape a cut is and there is nothing here to
 * make a second set of rows out of.
 *
 * The order is not an operation -- it has no switch and draws nothing on its
 * own -- so it goes under them rather than among them, and it is never a
 * letter's own: one letter whose shadow is thrown by the cut face while the
 * rest are cut through their shadows is not a decision anybody makes on
 * purpose.
 */
function Cast(): React.JSX.Element {
  const { forge, letter, scope } = useForge();
  const cast = scope === "letter" ? castFor(letter, forge) : castOf(forge);
  const held = castHeldBy(forge, letter);
  const order = castOf(forge).order;

  return (
    <CutPanel
      layer="cast"
      tag="forge-cast"
      cuts={cast}
      onChange={(name, patch, phase) => forgeStore.changeCast(name, patch as never, phase)}
      unitsPerEm={forge.style.metrics.unitsPerEm}
      scopeNote={
        scope === "family"
          ? "Casting the whole font."
          : `Casting ${letter} alone. The rest of the font keeps its own.`
      }
      heldNote={(name) => (scope === "letter" && held.includes(name) ? "own" : null)}
      onRelease={(name) => forgeStore.releaseCast(name)}
      footer={
        <div className="border-t border-border pt-2" data-forge-cast-order>
          <div className="pb-1 text-2xs font-medium text-foreground">Which goes first</div>
          <div className="flex gap-0.5 rounded-md bg-card/60 p-0.5" role="group" aria-label="Which goes first">
            <button
              type="button"
              aria-pressed={order === "after"}
              data-cast-order="after"
              onClick={() => forgeStore.changeCastOrder("after")}
              className={segment(order === "after", "flex-1")}
            >
              Cut, then cast
            </button>
            <button
              type="button"
              aria-pressed={order === "before"}
              data-cast-order="before"
              onClick={() => forgeStore.changeCastOrder("before")}
              className={segment(order === "before", "flex-1")}
            >
              Cast, then cut
            </button>
          </div>
          <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">
            Cut first and the shadow is thrown by the letter as it now is, so a
            slot through the face shows as a slot through the shadow. Cast first
            and the two are one block for the cut to slice, which can put a band
            across the shadow where the face has none.
          </p>
        </div>
      }
    />
  );
}

/**
 * What the tool that drew the letters was like.
 *
 * The third layer, drawn by the same panel as the other two because it is
 * described in exactly the same shape. What it does not have is a scope note or
 * a way to give a letter back: a cut and a cast are things done to a letter and
 * a letter can be done to differently, and this says what drew the font.
 */
function Tool(): React.JSX.Element {
  const { forge } = useForge();
  return (
    <CutPanel
      layer="effect"
      tag="forge-tool"
      cuts={effectsOf(forge)}
      onChange={(name, patch, phase) => forgeStore.changeEffect(name, patch as never, phase)}
      unitsPerEm={forge.style.metrics.unitsPerEm}
      scopeNote="A decision about the whole font, never about one letter."
    />
  );
}

function Cuts(): React.JSX.Element {
  const { forge, letter, scope } = useForge();
  /*
   * In letter scope this shows what the letter actually has, rather than what
   * the font has -- which is where this parts company with the part rows above.
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
    <CutPanel
      tag="forge-cuts"
      cuts={cuts}
      onChange={(name, patch, phase) => forgeStore.changeCut(name, patch as never, phase)}
      unitsPerEm={forge.style.metrics.unitsPerEm}
      scopeNote={
        scope === "family"
          ? "Cutting the whole font."
          : `Cutting ${letter} alone. The rest of the font keeps its own.`
      }
      reach={
        isImported(forge, letter)
          ? `Not on ${letter}: this one is made out of the skeleton, and your drawing has none. The rest of the font still gets it.`
          : null
      }
      heldNote={(name) => (scope === "letter" && held.includes(name) ? "held" : null)}
      onRelease={(name) => forgeStore.releaseCut(name)}
      header={
        held.length > 0 ? (
          <button
            type="button"
            onClick={() => forgeStore.releaseCut()}
            data-forge-release-cuts
            className="shrink-0 text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70"
          >
            {letter} holds {held.length} · release
          </button>
        ) : null
      }
    />
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

  /*
   * The same trip, made without leaving.
   *
   * Everything below this hands the letter to another program and waits for it
   * to come back. That is worth keeping -- the tool somebody draws best in is
   * the tool they already have -- but it is a strange first answer to "I want to
   * move this point", when the application it is being asked of has a pen, a
   * knife and eleven other tools sitting one tab away.
   *
   * So the letter is drawn once, put on the desk on its own, and handed back
   * into the slot it left at the width it left with, exactly as the file would
   * have been. What it costs is the same thing the file costs and is said in the
   * same words: the letter stops being a description.
   */
  const here = (): void => {
    const lent = forgeStore.letterAsGlyph(letter);
    if (!lent) {
      setProblem(`${letter} has nothing drawn in it to work on.`);
      return;
    }
    store.borrowLetter({ letter, family: state.familyName, from: "forge" }, lent.glyph, {
      unitsPerEm: lent.unitsPerEm,
      metrics: lent.metrics,
    });
    store.askForMode("edit");
  };

  return (
    <section className="border-b border-border p-3" data-forge-trip={letter}>
      <h3 className="pb-2 text-2xs font-medium">Draw {letter} yourself</h3>
      <button
        type="button"
        onClick={here}
        data-forge-draw-here={letter}
        title={`Puts ${letter} on the canvas on its own, with the pen, the knife, the shapes and every other tool pointed at it. It comes back into this slot at the width it left with. Like a drawing brought in from outside, it stops answering the controls above — and one button puts it back under the family's control.`}
        className="mb-1.5 w-full rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-accent hover:bg-card"
      >
        {outside ? `Work on ${letter} with the tools` : `Draw ${letter} with the tools`}
      </button>
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
            {letter} is your drawing, from {outside.from}. It keeps its advance,
            and nothing above reaches it any more — there is no pen behind it
            to change. The cuts still do: a slot or a saw is taken out of
            whatever the letter is, so your drawing is cut with the rest of the
            font. The two made out of the skeleton — the inline and the breaks
            — are the exception, because your drawing has no skeleton.
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
          Either way {letter} leaves the sliders and comes back into its own
          space at the width it left with. The tools here put it on the canvas
          with the pen, the knife and the shapes on it; the sheet carries the
          baseline, the x-height and the sidebearings as guides for whatever you
          draw in elsewhere.
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
          {!mine && <span className="font-normal"> · not in {state.letter}</span>}
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

/**
 * How the letters reach each other, which had no panel at all until now.
 *
 * The four joined faces carried these numbers and nothing offered them, so the
 * only way to a script that was not one of those four was to pick the nearest
 * and live with it. They are ordinary controls and they read the way the rest
 * of the panel reads.
 *
 * The switch stays live and the rest go quiet when it is off, rather than the
 * section disappearing. A face whose letters stand apart is one press away from
 * one whose letters join, and a panel that hides the press hides the fact --
 * the join is the largest single decision this engine makes about a face, and
 * finding it should not require having already chosen a face that has it.
 */
function Joining(): React.JSX.Element {
  const state = useForge();
  const script = state.forge.style.parts.script;
  const joined = Boolean(script.on);

  return (
    <section className="border-b border-border p-3" data-forge-joining={joined ? "on" : "off"}>
      <h3 className="pb-2 text-2xs font-medium">Joining</h3>
      {SCRIPT_CONTROLS.map((control) => {
        // Everything but the switch is about a join, so with no join there is
        // nothing for them to be about. Dimmed and left in place: they say what
        // turning the switch on would give access to.
        const idle = !joined && control.key !== "on";
        return (
          <div key={control.key} className={cn(idle && "pointer-events-none opacity-40")} aria-hidden={idle}>
            <Field
              on="script"
              control={control}
              value={(script as unknown as Record<string, number | boolean>)[control.key]}
              onChange={(next, phase) => forgeStore.changeScript({ [control.key]: next } as never, phase)}
            />
          </div>
        );
      })}
      <p className="pt-2 text-2xs leading-snug text-muted-foreground">
        {joined
          ? "The join reaches every letter. There is no exception to be had from it: two letters can only meet at one height, so a letter keeping its own seam would hand over where its neighbour never arrives."
          : "The letters stand apart. Turn joining on and the space between two of them stops being space and becomes the stroke that carries one into the next."}
      </p>
    </section>
  );
}

/**
 * A rule across the panel saying what the next stretch of it is for.
 *
 * This panel is eight thousand six hundred pixels tall in an eight hundred
 * pixel window, which is ten and a half screens, and it had no ranking at all:
 * the twenty starting points you choose once sat above the pen you drag every
 * minute, and the nine sections about parts of letters sat between the pen and
 * the proportions. Everything was reachable and nothing said what to look at.
 *
 * So the three that decide what the whole font looks like come first, and the
 * rest is grouped under rules that say what each group is. Nothing is hidden:
 * scrolling past a rule is one gesture, and the rule tells you whether the
 * thing you want is under it.
 */
function Group({
  title,
  said,
  mark,
}: {
  title: string;
  said: string;
  mark: string;
}): React.JSX.Element {
  return (
    <div className="border-b border-border bg-card/40 px-3 py-2" data-panel-section={mark}>
      <h3 className="text-2xs font-medium uppercase tracking-wide text-foreground">{title}</h3>
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{said}</p>
    </div>
  );
}

function Section({
  title,
  mark,
  children,
}: {
  title: string;
  /** A name for this stretch of the panel, so its place in the order can be pinned. */
  mark?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="border-b border-border p-3" data-panel-section={mark}>
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
  on: "pen" | "metrics" | "script";
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

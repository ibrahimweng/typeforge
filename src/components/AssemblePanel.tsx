/**
 * The controls for a font being assembled.
 *
 * Ordered by how much each thing matters and how early you need it: the pile
 * first, because a file in the wrong slot makes everything below it nonsense;
 * then the lines the letters are fitted to; then the spacing; then the one
 * pair you happen to be looking at.
 *
 * Every number here starts as something measured off the drawings. The panel's
 * job is to say what was measured and let it be overruled, which is why the
 * measured value stays visible next to the adjustment rather than being
 * replaced by it.
 */

import * as React from "react";

import {
  build,
  castFor,
  castHeldBy,
  castOrNone,
  cutHeldBy,
  cutsFor,
  cutsOrNone,
  kernKey,
} from "@/assemble/document";
import { CutPanel } from "@/components/CutPanel";
import { CastOrder } from "@/components/Inspector";
import { segment, WIDE_PANEL } from "@/components/controls";
import { contoursToSvgPath } from "@/font/geometry";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { cn } from "@/ui/lib/utils";

/** A line of the font, as a control. */
const METRIC_CONTROLS: Array<{ key: string; label: string; hint: string; min: number; max: number }> = [
  {
    key: "capHeight",
    label: "Cap height",
    hint: "How tall the capitals stand. The drawings are scaled to meet it, so moving it resizes the set rather than stretching it.",
    min: 0.4,
    max: 0.95,
  },
  {
    key: "xHeight",
    label: "x-height",
    hint: "How tall the lowercase stands. Only read when the set is fitted letter by letter; fitted together, the drawings keep the proportion they were made at.",
    min: 0.25,
    max: 0.85,
  },
  {
    key: "ascender",
    label: "Ascender",
    hint: "How far a b or an l reaches above the x-height.",
    min: 0.5,
    max: 1,
  },
  {
    key: "descender",
    label: "Descender",
    hint: "How far a p or a g hangs below the baseline.",
    min: -0.5,
    max: 0,
  },
  {
    key: "overshoot",
    label: "Overshoot",
    hint: "How far a round letter is allowed past a flat one, so the two look level.",
    min: 0,
    max: 0.05,
  },
];

export function AssemblePanel(): React.JSX.Element {
  return (
    <aside
      aria-label="Assemble"
      className={cn(WIDE_PANEL, "toolcraft-panel-surface flex shrink-0 flex-col border-l border-border")}
    >
      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
        <Files />
        <Fit />
        <Lines />
        <Spacing />
        <Cutting />
        <Letter />
        <Pair />
      </div>
    </aside>
  );
}

/**
 * Cutting a pile of drawings.
 *
 * The same panel and the same description as the other two halves. What is
 * different here is only what a cut can be measured against: nothing in the
 * pile was drawn with a pen that could be asked how thick a stem is, so it is
 * measured off the drawings once they have all been fitted to the same
 * metrics -- see `build`.
 *
 * The selected drawing is cut its own way rather than the pile's, which is the
 * same exception the other two offer and is worth more here than anywhere:
 * a pile is drawings from different hands, and the one that has nowhere to put
 * the third slot is the ordinary case rather than the odd one.
 */
function Cutting(): React.JSX.Element {
  const state = useAssemble();
  const { assembly, selected } = state;
  /*
   * Whose cuts are being changed, asked rather than assumed.
   *
   * It used to follow whatever drawing was selected, and a drawing always is:
   * so the first press of the Slots switch cut one letter and left the other
   * twenty-five alone, which is neither what it looks like nor what anybody
   * wants first. The pile is the default and the letter is a decision, which
   * is the way round the drawn side has it too.
   */
  const [scope, setScope] = React.useState<"pile" | "one">("pile");
  const has = assembly.pieces.some((piece) => piece.character === selected);
  const one = scope === "one" && selected !== "" && has;
  const cuts = one ? cutsFor(selected, assembly) ?? cutsOrNone(assembly) : cutsOrNone(assembly);

  return (
    <>
      <div className="border-b border-border px-3 pt-3">
        <div className="flex gap-0.5 rounded-md bg-card/60 p-0.5" role="group" aria-label="Cut scope">
          <button
            type="button"
            aria-pressed={scope === "pile"}
            onClick={() => setScope("pile")}
            data-cut-scope="pile"
            className={segment(scope === "pile", "flex-1")}
          >
            Whole pile
          </button>
          <button
            type="button"
            aria-pressed={scope === "one"}
            disabled={!has}
            onClick={() => setScope("one")}
            data-cut-scope="one"
            className={segment(scope === "one", cn("flex-1", !has && "opacity-40"))}
          >
            {has ? selected : "One drawing"}
          </button>
        </div>
      </div>
      <CutPanel
        tag="assemble"
        cuts={cuts}
        onChange={(name, patch, phase) => {
          if (one) assembleStore.changeOneCut(selected, name, patch as never, phase);
          else assembleStore.changeCut(name, patch as never, phase);
        }}
        unitsPerEm={assembly.metrics.unitsPerEm}
        scopeNote={
          one
            ? `Cutting ${selected} alone. The rest of the pile keeps its own.`
            : "Cutting every drawing in the pile."
        }
        reach={
          "Nothing here: this one is made out of the skeleton a letter was drawn " +
          "from, and a drawing that arrived as an outline has none."
        }
        heldNote={(name) => (one && cutHeldBy(assembly, selected, name) ? "own" : null)}
        onRelease={() => one && assembleStore.cutLikeTheRest(selected)}
      />
      <CutPanel
        layer="cast"
        tag="assemble-cast"
        cuts={one ? castFor(selected, assembly) ?? castOrNone(assembly) : castOrNone(assembly)}
        onChange={(name, patch, phase) => {
          if (one) assembleStore.changeOneCast(selected, name, patch as never, phase);
          else assembleStore.changeCast(name, patch as never, phase);
        }}
        unitsPerEm={assembly.metrics.unitsPerEm}
        scopeNote={
          one
            ? `Casting ${selected} alone. The rest of the pile keeps its own.`
            : "Casting every drawing in the pile."
        }
        reach={
          "Nothing here: this one is made out of the skeleton a letter was drawn " +
          "from, and a drawing that arrived as an outline has none."
        }
        heldNote={(name) => (one && castHeldBy(assembly, selected, name) ? "own" : null)}
        onRelease={() => one && assembleStore.castLikeTheRest(selected)}
        footer={
          <CastOrder
            order={castOrNone(assembly).order}
            onChange={(next) => assembleStore.changeCastOrder(next)}
          />
        }
      />
    </>
  );
}

function Section({
  title,
  children,
  mark,
}: {
  title: string;
  children: React.ReactNode;
  mark?: string;
}): React.JSX.Element {
  return (
    <section className="border-b border-border p-3" data-assemble-section={mark ?? title}>
      <h3 className="pb-2 text-2xs font-medium">{title}</h3>
      {children}
    </section>
  );
}

/**
 * What is in the pile, and which box each drawing sits in.
 *
 * Mostly a way of correcting the second route in. A drawing chosen for a
 * particular box already knows what it is; a heap dropped in at once had its
 * characters guessed from the file names, and the guesses that came out empty
 * are the rows worth looking at here.
 */
function Files(): React.JSX.Element {
  const state = useAssemble();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [refused, setRefused] = React.useState<string[]>([]);

  const take = async (files: FileList | null): Promise<void> => {
    setRefused(await assembleStore.take([...(files ?? [])]));
  };

  return (
    <Section title="The drawings" mark="files">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          data-assemble-add
          className="flex-1 rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
        >
          {state.reading ? "Reading…" : "Add a folder at once"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        multiple
        className="hidden"
        data-assemble-panel-input
        onChange={(event) => {
          void take(event.target.files);
          event.target.value = "";
        }}
      />

      {refused.length > 0 && (
        <p className="pt-2 text-2xs leading-snug text-muted-foreground">
          Nothing drawable in {refused.length === 1 ? refused[0] : `${refused.length} files`}.
        </p>
      )}

      {state.assembly.pieces.length === 0 ? (
        <p className="pt-2 text-2xs leading-snug text-muted-foreground">
          The ordinary way in is to double-click a box and choose its drawing.
          This is the shortcut for a folder you have already exported: names it
          recognises — <code>a.svg</code>, <code>A_.svg</code>,{" "}
          <code>period.svg</code>, <code>uni0041.svg</code> — go straight into
          their boxes, and anything it cannot name is listed here to place by
          hand.
        </p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto pt-2" data-assemble-list>
          {state.assembly.pieces.map((piece) => (
            <li key={piece.id} className="flex items-center gap-1.5">
              <input
                value={piece.character}
                onChange={(event) =>
                  assembleStore.map(piece.id, [...event.target.value][0] ?? "")
                }
                aria-label={`Character for ${piece.file}`}
                data-assemble-map={piece.id}
                placeholder="?"
                className={cn(
                  "w-8 shrink-0 rounded border bg-transparent px-1 py-0.5 text-center text-2xs outline-none",
                  piece.character
                    ? "border-border focus:border-muted-foreground"
                    : "border-[color:var(--destructive)]",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                {piece.file}
              </span>
              <button
                type="button"
                onClick={() => assembleStore.drop(piece.id)}
                aria-label={`Remove ${piece.file}`}
                data-assemble-drop={piece.id}
                className="shrink-0 rounded px-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Whether the set was drawn against each other or separately. */
function Fit(): React.JSX.Element {
  const state = useAssemble();
  const { fit, fitChosen } = state.assembly;

  return (
    <Section title="How they were drawn" mark="fit">
      <div className="flex gap-1" role="group" aria-label="Fit">
        <button
          type="button"
          aria-pressed={fit === "together"}
          onClick={() => assembleStore.setFit("together")}
          data-assemble-fit="together"
          className={segment(fit === "together", "flex-1")}
        >
          On one canvas
        </button>
        <button
          type="button"
          aria-pressed={fit === "alone"}
          onClick={() => assembleStore.setFit("alone")}
          data-assemble-fit="alone"
          className={segment(fit === "alone", "flex-1")}
        >
          Separately
        </button>
      </div>
      <p className="pt-2 text-2xs leading-snug text-muted-foreground">
        {fit === "together"
          ? "The drawings keep the sizes they were made at relative to each other, and the whole set moves onto the lines as one. Right when the files came out of a single document."
          : "Each drawing is fitted to what its own character should measure. Right when the files were made separately, and wrong when a letter was drawn small on purpose."}
      </p>
      {!fitChosen && state.assembly.pieces.length > 1 && (
        <p className="pt-1 text-2xs leading-snug text-muted-foreground opacity-70">
          Chosen by looking at the files: they{" "}
          {fit === "together" ? "share a canvas height" : "have different canvas heights"}.
        </p>
      )}
    </Section>
  );
}

/** The lines the drawings are fitted to. */
function Lines(): React.JSX.Element {
  const state = useAssemble();
  const { metrics } = state.assembly;
  const em = metrics.unitsPerEm;

  return (
    <Section title="The lines" mark="lines">
      {METRIC_CONTROLS.map((control) => (
        <div key={control.key} className="py-1">
          <Slider
            name={control.label}
            value={(metrics as unknown as Record<string, number>)[control.key]}
            min={control.min * em}
            max={control.max * em}
            step={1}
            showFill
            onValueChange={(next: number, meta?: { history?: string }) =>
              assembleStore.changeMetrics(
                { [control.key]: next },
                meta?.history === "merge" ? "during" : "end",
              )
            }
          />
          <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
        </div>
      ))}
    </Section>
  );
}

/** How much white goes between the letters. */
function Spacing(): React.JSX.Element {
  const state = useAssemble();
  const { spacing } = state.assembly;

  const controls: Array<{
    key: "white" | "depth" | "kern";
    label: string;
    hint: string;
    min: number;
    max: number;
    step: number;
  }> = [
    {
      key: "white",
      label: "Spacing",
      hint: "The white wanted beside a flat-sided letter. Everything else is measured against it: a round letter gets less, because its own curve has already given some back.",
      min: 0.01,
      max: 0.12,
      step: 0.001,
    },
    {
      key: "depth",
      label: "How far the eye looks in",
      hint: "How far into a letter's own hollows counts as white beside it. Turn it up and open letters tighten; turn it down and every letter is spaced by its outermost point alone.",
      min: 0.005,
      max: 0.15,
      step: 0.001,
    },
    {
      key: "kern",
      label: "Kerning",
      hint: "How much of the excess between an awkward pair gets taken out. Zero for none. Two flat letters and two round ones are already right and are never touched.",
      min: 0,
      max: 1,
      step: 0.01,
    },
  ];

  return (
    <Section title="The space between" mark="spacing">
      {controls.map((control) => (
        <div key={control.key} className="py-1">
          <Slider
            name={control.label}
            value={spacing[control.key]}
            min={control.min}
            max={control.max}
            step={control.step}
            showFill
            onValueChange={(next: number, meta?: { history?: string }) =>
              assembleStore.changeSpacing(
                { [control.key]: next },
                meta?.history === "merge" ? "during" : "end",
              )
            }
          />
          <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
        </div>
      ))}
    </Section>
  );
}

/** The one letter being looked at, and its own white. */
function Letter(): React.JSX.Element | null {
  const state = useAssemble();
  const assembled = React.useMemo(
    () => build(state.assembly),
    [state.assembly, state.revision],
  );
  const letter = assembled.letters.find((candidate) => candidate.character === state.selected);
  if (!letter) return null;

  const nudge = state.assembly.tweaks[letter.character] ?? { left: 0, right: 0 };
  const em = state.assembly.metrics.unitsPerEm;

  return (
    <Section title={`The white beside ${letter.character}`} mark="letter">
      {(["left", "right"] as const).map((side) => (
        <div key={side} className="py-1">
          <Slider
            name={side === "left" ? "Left" : "Right"}
            value={nudge[side]}
            min={-em * 0.1}
            max={em * 0.1}
            step={1}
            showFill
            onValueChange={(next: number, meta?: { history?: string }) =>
              assembleStore.nudge(
                letter.character,
                { [side]: next },
                meta?.history === "merge" ? "during" : "end",
              )
            }
          />
        </div>
      ))}
      <p className="pt-1 text-2xs leading-snug text-muted-foreground">
        Measured at {Math.round(letter.bearings.left - nudge.left)} and{" "}
        {Math.round(letter.bearings.right - nudge.right)}; now{" "}
        {Math.round(letter.bearings.left)} and {Math.round(letter.bearings.right)}. These sliders
        move this letter alone, on top of what was measured.
      </p>
    </Section>
  );
}

/**
 * One pair, close up.
 *
 * Here because a measure of the closest approach catches the pairs that lean
 * apart and under-catches the ones that overhang -- a T beside an o is the
 * standing example -- and the honest answer to that is a place to fix it by
 * hand rather than a cleverer measure that is wrong about more.
 */
function Pair(): React.JSX.Element | null {
  const state = useAssemble();
  const assembled = React.useMemo(
    () => build(state.assembly),
    [state.assembly, state.revision],
  );
  const [text, setText] = React.useState("To");

  const characters = [...text].slice(0, 2);
  const left = assembled.letters.find((letter) => letter.character === characters[0]);
  const right = assembled.letters.find((letter) => letter.character === characters[1]);
  if (assembled.letters.length === 0) return null;

  const key = left && right ? kernKey(left.character, right.character) : null;
  const own = key === null ? undefined : state.assembly.kerns[key];
  const measured =
    left && right
      ? (assembled.kerning.find(
          (pair) => pair.left === left.character && pair.right === right.character,
        )?.value ?? 0)
      : 0;
  const value = own ?? measured;
  const { metrics } = state.assembly;

  return (
    <Section title="One pair" mark="pair">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label="Pair"
        data-assemble-pair-input
        className="w-16 rounded-md border border-border bg-transparent px-2 py-1 text-center text-2xs outline-none focus:border-muted-foreground"
      />

      {left && right ? (
        <>
          <svg
            viewBox={`0 ${-metrics.ascender} ${Math.max(
              left.advanceWidth + value + right.advanceWidth,
              1,
            )} ${metrics.ascender - metrics.descender}`}
            className="mt-2 h-14 w-full"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${left.character} beside ${right.character}`}
            data-assemble-pair={`${left.character}${right.character}`}
          >
            <g transform="scale(1,-1)">
              <path d={contoursToSvgPath(left.contours)} fill="var(--foreground)" fillRule="nonzero" />
              <g transform={`translate(${left.advanceWidth + value} 0)`}>
                <path
                  d={contoursToSvgPath(right.contours)}
                  fill="var(--foreground)"
                  fillRule="nonzero"
                />
              </g>
            </g>
          </svg>

          <div className="py-1">
            <Slider
              name="Kern"
              value={value}
              min={-metrics.unitsPerEm * 0.25}
              max={metrics.unitsPerEm * 0.1}
              step={1}
              showFill
              onValueChange={(next: number, meta?: { history?: string }) =>
                assembleStore.setPairKern(
                  left.character,
                  right.character,
                  next,
                  meta?.history === "merge" ? "during" : "end",
                )
              }
            />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-2xs text-muted-foreground">
              Measured at {measured}
              {own !== undefined && `, set to ${own}`}.
            </span>
            {own !== undefined && (
              <button
                type="button"
                onClick={() => assembleStore.setPairKern(left.character, right.character, null)}
                data-assemble-pair-reset
                className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
              >
                Put back
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="pt-2 text-2xs leading-snug text-muted-foreground">
          Type two characters the font has, and this shows them together with the
          kerning that was worked out for them.
        </p>
      )}
    </Section>
  );
}

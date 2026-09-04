/**
 * Building a font out of drawings.
 *
 * The screen is the character set: a box for every letter, figure and mark,
 * each holding a faint version of the character it is waiting for.
 * Double-click one and choose the drawing that goes in it. That is the whole
 * interaction, and the reason it is the whole interaction is that it asks
 * nothing of you.
 *
 * The alternative -- and what this used to be -- was to drop a heap of files
 * in and have the application work out which was which from their names. That
 * works when the names follow a convention and turns into a puzzle when they
 * do not, and either way it puts a guess between somebody and their own
 * drawings. Choosing the box first removes the guess: whatever the file is
 * called, it goes where you pointed.
 *
 * Dropping a heap still works, because someone who has already exported
 * twenty-six files should not have to place them one at a time. It fills the
 * boxes it can name and leaves the rest.
 *
 * The specimen line does more work here than in either of the other two modes.
 * In the drawn font it is a check on decisions the recipes already made; here
 * it is the only place the spacing can actually be judged, because spacing has
 * no appearance of its own -- it is only ever visible as the rhythm of letters
 * beside other letters.
 */

import * as React from "react";

import { build, type Assembled } from "@/assemble/document";
import { SLOT_GROUPS, slotsIn, type Slot } from "@/assemble/slots";
import { CoachMark } from "@/components/CoachMark";
import { Reference } from "@/components/Reference";
import { contoursToSvgPath } from "@/font/geometry";
import { tile } from "@/components/controls";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { useLibrary } from "@/state/useLibrary";
import { cn } from "@/ui/lib/utils";

type Built = ReturnType<typeof build>;

export function AssembleView(): React.JSX.Element {
  const state = useAssemble();
  const assembled = React.useMemo(() => build(state.assembly), [state.assembly, state.revision]);
  const filled = assembled.letters.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CoachMark id="assemble" />
      {/* The stage earns its room only once there is something in it. Until
          then the boxes get the screen, which is where the work is. */}
      {filled ? <Stage assembled={assembled} /> : <Instructions />}
      {filled && <Specimen assembled={assembled} />}
      <Trouble assembled={assembled} />
      <Boxes assembled={assembled} />
    </div>
  );
}

/** What to do, while there is nothing else to look at. */
function Instructions(): React.JSX.Element {
  const state = useAssemble();
  return (
    <div
      className="flex shrink-0 flex-col items-center gap-1 border-b border-border bg-[var(--canvas)] px-6 py-5"
      data-assemble-instructions
    >
      <p className="text-xs-plus font-medium">
        {state.reading ? "Reading…" : "Double-click a box and choose its drawing"}
      </p>
      <p className="max-w-xl text-center text-2xs leading-relaxed text-muted-foreground">
        One SVG per character. Whatever the file is called, it goes in the box you picked. Typeforge
        puts them all on the same baseline, sizes them against each other, and fits the spacing and
        the kerning — and every bit of that can be changed afterwards. Dropping a whole folder in at
        once still works for the files it can name.
      </p>
      {state.problem && <p className="text-2xs text-[color:var(--destructive)]">{state.problem}</p>}
    </div>
  );
}

/** The drawing being looked at, on the lines it has been put on. */
function Stage({ assembled }: { assembled: Built }): React.JSX.Element {
  const state = useAssemble();
  const letter =
    assembled.letters.find((candidate) => candidate.character === state.selected) ??
    assembled.letters[0];
  const { metrics } = state.assembly;
  const { reference } = useLibrary();

  const top = metrics.ascender + metrics.unitsPerEm * 0.08;
  const bottom = metrics.descender - metrics.unitsPerEm * 0.08;
  const left = -metrics.unitsPerEm * 0.06;
  const width = Math.max(letter.advanceWidth, 1) + metrics.unitsPerEm * 0.12;
  const hair = metrics.unitsPerEm / 260;

  return (
    <div className="relative flex min-h-0 flex-[3] items-center justify-center bg-[var(--canvas)] px-6">
      <svg
        viewBox={`${left} ${-top} ${width} ${top - bottom}`}
        className="h-full max-h-full w-auto"
        role="img"
        aria-label={`The drawing for ${letter.character}`}
        data-assemble-stage={letter.character}
      >
        <g transform="scale(1,-1)">
          {(
            [
              ["baseline", 0],
              ["x-height", metrics.xHeight],
              ["cap", metrics.capHeight],
              ["ascender", metrics.ascender],
              ["descender", metrics.descender],
            ] as const
          ).map(([label, y]) => (
            <line
              key={label}
              x1={left}
              x2={left + width}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={hair * 0.5}
            />
          ))}

          {/* The two edges of the letter's own space, which is what the
              spacing controls move and the only way to see them move. */}
          {[0, letter.advanceWidth].map((x) => (
            <line
              key={x}
              x1={x}
              x2={x}
              y1={bottom}
              y2={top}
              stroke="var(--accent)"
              strokeWidth={hair * 0.5}
              opacity={0.5}
            />
          ))}

          <Reference
            loaded={reference}
            character={letter.character}
            unitsPerEm={metrics.unitsPerEm}
          />

          <path
            d={contoursToSvgPath(letter.contours)}
            fill="var(--foreground)"
            fillRule="nonzero"
          />
        </g>
      </svg>

      <p className="pointer-events-none absolute bottom-2 left-3 text-2xs text-muted-foreground">
        {letter.file}
        <span className="pl-2 opacity-70">
          {Math.round(letter.bearings.left)} · {Math.round(letter.advanceWidth)} ·{" "}
          {Math.round(letter.bearings.right)}
        </span>
        {!letter.measured && (
          <span className="pl-2 opacity-70">placed from the rest of the set</span>
        )}
      </p>
    </div>
  );
}

/**
 * A line of type, which is the only place spacing can be judged.
 *
 * Set with the kerning applied, because a specimen that ignored the kerning
 * would be showing a font nobody is going to see.
 */
function Specimen({ assembled }: { assembled: Built }): React.JSX.Element {
  const state = useAssemble();
  const { metrics } = state.assembly;

  const byCharacter = React.useMemo(
    () => new Map(assembled.letters.map((letter) => [letter.character, letter])),
    [assembled],
  );
  const kerns = React.useMemo(
    () => new Map(assembled.kerning.map((pair) => [`${pair.left} ${pair.right}`, pair.value])),
    [assembled],
  );

  // Only what the pile can actually set, so the line is a specimen rather than
  // a report of what is missing.
  const runnable = [...state.specimen].filter((character) => byCharacter.has(character));

  let pen = 0;
  const placed = runnable.map((character, index) => {
    const letter = byCharacter.get(character)!;
    const previous = runnable[index - 1];
    if (previous) pen += kerns.get(`${previous} ${character}`) ?? 0;
    const at = pen;
    pen += letter.advanceWidth;
    return { letter, at, key: `${character}-${index}` };
  });

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-border bg-[var(--canvas)] px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          value={state.specimen}
          onChange={(event) => assembleStore.setSpecimen(event.target.value)}
          aria-label="Specimen"
          data-assemble-specimen-input
          className="w-56 rounded-md border border-border bg-transparent px-2 py-1 text-2xs outline-none focus:border-muted-foreground"
        />
        <span className="text-2xs text-muted-foreground">
          {runnable.length} of {[...state.specimen].length} set
        </span>
      </div>
      <svg
        viewBox={`0 ${-metrics.ascender} ${Math.max(pen, 1)} ${metrics.ascender - metrics.descender}`}
        className="h-16 w-full"
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Specimen"
        data-assemble-specimen
      >
        <g transform="scale(1,-1)">
          {placed.map(({ letter, at, key }) => (
            <g key={key} transform={`translate(${at} 0)`}>
              <path
                d={contoursToSvgPath(letter.contours)}
                fill="var(--foreground)"
                fillRule="nonzero"
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

/** Drawings that arrived without a box, and boxes that two of them want. */
function Trouble({ assembled }: { assembled: Built }): React.JSX.Element | null {
  if (assembled.unplaced.length === 0 && assembled.clashes.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-border px-3 py-2" data-assemble-trouble>
      {assembled.unplaced.length > 0 && (
        <p className="text-2xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">
            {assembled.unplaced.length} not placed.
          </span>{" "}
          These arrived without a box Typeforge could name from the file:{" "}
          {assembled.unplaced
            .slice(0, 6)
            .map((piece) => piece.file)
            .join(", ")}
          {assembled.unplaced.length > 6 && "…"}. Give them one in the panel.
        </p>
      )}
      {assembled.clashes.length > 0 && (
        <p className="pt-1 text-2xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Two drawings want the same box:</span>{" "}
          {assembled.clashes.join(", ")}. The first one in is being used.
        </p>
      )}
    </div>
  );
}

/**
 * The character set, as boxes.
 *
 * Grouped, because a hundred and ninety boxes in one run is a wall rather than
 * a set, and counted, because the first thing anybody wants to know is how far
 * through they are.
 */
function Boxes({ assembled }: { assembled: Built }): React.JSX.Element {
  const state = useAssemble();
  const byCharacter = React.useMemo(
    () => new Map(assembled.letters.map((letter) => [letter.character, letter])),
    [assembled],
  );

  return (
    <div className="toolcraft-scrollbar min-h-0 flex-[2] overflow-y-auto p-3" data-assemble-boxes>
      {SLOT_GROUPS.map((group) => {
        const slots = slotsIn(group);
        const done = slots.filter((slot) => byCharacter.has(slot.character)).length;
        return (
          <section key={group} className="pb-3" data-assemble-group={group}>
            <h3 className="flex items-baseline gap-2 pb-1.5">
              <span className="text-2xs font-medium">{group}</span>
              <span className="text-2xs text-muted-foreground">
                {done} of {slots.length}
              </span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {slots.map((slot) => (
                <Box
                  key={slot.character}
                  slot={slot}
                  letter={byCharacter.get(slot.character)}
                  selected={slot.character === state.selected}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * One box: a character waiting for its drawing, or the drawing it was given.
 *
 * Its own file input rather than one shared between them all, because which
 * character a file is for is decided by which box was pressed, and a shared
 * input would have to be told that separately and could be told wrong.
 */
function Box({
  slot,
  letter,
  selected,
}: {
  slot: Slot;
  letter: Assembled | undefined;
  selected: boolean;
}): React.JSX.Element {
  const state = useAssemble();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const { metrics } = state.assembly;

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => assembleStore.select(slot.character)}
        onDoubleClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          // Stopped here rather than left to the window, which would send the
          // file through the name-guessing path and quite possibly put it
          // somewhere other than the box it was dropped on.
          event.preventDefault();
          event.stopPropagation();
          setOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void assembleStore.takeInto(slot.character, file);
        }}
        aria-pressed={selected}
        aria-label={slot.label}
        title={
          letter
            ? `${slot.label} — ${letter.file}. Double-click to replace it.`
            : `${slot.label} — double-click to choose a drawing`
        }
        data-assemble-box={slot.character}
        data-assemble-filled={letter ? "yes" : "no"}
        className={tile(
          selected,
          cn(
            "flex size-12 items-center justify-center rounded-md border",
            over &&
              "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_16%,transparent)]",
          ),
        )}
      >
        {letter ? (
          <svg
            viewBox={`0 ${-metrics.ascender} ${Math.max(letter.advanceWidth, 1)} ${
              metrics.ascender - metrics.descender
            }`}
            className="h-8 w-8"
            aria-hidden
          >
            <g transform="scale(1,-1)">
              <path
                d={contoursToSvgPath(letter.contours)}
                fill="var(--foreground)"
                fillRule="nonzero"
              />
            </g>
          </svg>
        ) : (
          /* The character it is waiting for, faint enough to read as an empty
             box rather than as a letter that is already there. */
          <span
            aria-hidden
            className="select-none text-lg leading-none text-muted-foreground opacity-30"
            data-assemble-placeholder={slot.character}
          >
            {slot.character === " " ? "␣" : slot.character}
          </span>
        )}

        {/* A letter placed from the rest of the set rather than by its own
            measurements is the one worth checking, so it says so. */}
        {letter && !letter.measured && (
          <span className="absolute inset-x-1.5 bottom-0.5 h-0.5 rounded-full bg-[color:var(--muted-foreground)]" />
        )}
      </button>

      {letter && (
        <button
          type="button"
          onClick={() => assembleStore.empty(slot.character)}
          aria-label={`Empty ${slot.label}`}
          data-assemble-empty={slot.character}
          className={cn(
            "absolute -right-1 -top-1 size-4 items-center justify-center rounded-full border border-border bg-popover text-2xs leading-none text-muted-foreground hover:text-foreground",
            /* Out of the way until it is wanted -- but a control that only
               hover reaches is a control a keyboard and a touchscreen never
               do, so being the open box is enough to show it too. `hidden`
               and `flex` are never both written: they are the same property
               at the same weight, and which one won would come down to the
               order the stylesheet happened to be built in. */
            selected ? "flex" : "hidden group-hover:flex group-focus-within:flex",
          )}
        >
          ×
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        data-assemble-box-input={slot.character}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void assembleStore.takeInto(slot.character, file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

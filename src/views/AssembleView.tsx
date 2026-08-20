/**
 * Building a font out of drawings.
 *
 * The third mode, and the one that starts with nothing on screen because it
 * starts with nothing at all. Everything here is about the pile: what came in,
 * which drawing is which character, where they have been put, and how they
 * read beside each other.
 *
 * The specimen line does more work here than in either of the other two. In
 * the drawn font it is a check on decisions the recipes already made; here it
 * is the only place the spacing can actually be judged, because spacing is the
 * one thing in a font that has no appearance of its own -- it is only ever
 * visible as the rhythm of letters next to other letters.
 */

import * as React from "react";

import { CoachMark } from "@/components/CoachMark";
import { Reference } from "@/components/Reference";
import { build } from "@/assemble/document";
import { contoursToSvgPath } from "@/font/geometry";
import { tile } from "@/components/controls";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { useLibrary } from "@/state/useLibrary";
import { cn } from "@/ui/lib/utils";

export function AssembleView(): React.JSX.Element {
  const state = useAssemble();

  if (state.assembly.pieces.length === 0) return <Empty reading={state.reading} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Only once there is something to explain. The empty view is already a
          paragraph about what this does, and a tip over the top of it would be
          the same thing said twice. */}
      <CoachMark id="assemble" />
      <Stage />
      <Specimen />
      <Trouble />
      <Pile />
    </div>
  );
}

/** Nothing has been dropped in yet, so the whole view is the invitation. */
function Empty({ reading }: { reading: boolean }): React.JSX.Element {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[var(--canvas)] p-8"
      data-assemble-empty
    >
      <p className="text-xs-plus font-medium">Drop a set of SVG drawings here</p>
      <p className="max-w-md text-center text-2xs leading-relaxed text-muted-foreground">
        One file per character. Typeforge works out which is which from the file
        names, puts them all on the same baseline, sizes them against each
        other, and fits the spacing and the kerning. Everything it works out can
        be changed.
      </p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        data-assemble-choose
        className="rounded-md border border-border px-3 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
      >
        {reading ? "Reading…" : "Choose files"}
      </button>
      <FileInput inputRef={inputRef} />
    </div>
  );
}

function FileInput({
  inputRef,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
}): React.JSX.Element {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".svg,image/svg+xml"
      multiple
      className="hidden"
      data-assemble-input
      onChange={(event) => {
        void assembleStore.take([...(event.target.files ?? [])]);
        event.target.value = "";
      }}
    />
  );
}

/** The drawing being looked at, on the lines it has been put on. */
function Stage(): React.JSX.Element {
  const state = useAssemble();
  const assembled = React.useMemo(
    () => build(state.assembly),
    [state.assembly, state.revision],
  );
  const letter =
    assembled.letters.find((candidate) => candidate.character === state.selected) ??
    assembled.letters[0];
  const { metrics } = state.assembly;
  const { reference } = useLibrary();

  if (!letter) {
    return (
      <div className="flex flex-[3] items-center justify-center bg-[var(--canvas)] text-2xs text-muted-foreground">
        Nothing in the pile has been given a character yet.
      </div>
    );
  }

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

          <path d={contoursToSvgPath(letter.contours)} fill="var(--foreground)" fillRule="nonzero" />
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
function Specimen(): React.JSX.Element {
  const state = useAssemble();
  const assembled = React.useMemo(
    () => build(state.assembly),
    [state.assembly, state.revision],
  );
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
              <path d={contoursToSvgPath(letter.contours)} fill="var(--foreground)" fillRule="nonzero" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

/** What is wrong with the pile, while there is still something to do about it. */
function Trouble(): React.JSX.Element | null {
  const state = useAssemble();
  const assembled = React.useMemo(
    () => build(state.assembly),
    [state.assembly, state.revision],
  );
  if (assembled.unmapped.length === 0 && assembled.clashes.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-border px-3 py-2" data-assemble-trouble>
      {assembled.unmapped.length > 0 && (
        <p className="text-2xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">
            {assembled.unmapped.length} not placed.
          </span>{" "}
          Typeforge could not tell what character these are for:{" "}
          {assembled.unmapped.slice(0, 6).join(", ")}
          {assembled.unmapped.length > 6 && "…"}. Say so in the panel and they join the font.
        </p>
      )}
      {assembled.clashes.length > 0 && (
        <p className="pt-1 text-2xs leading-snug text-muted-foreground">
          <span className="font-medium text-foreground">Two files want the same slot:</span>{" "}
          {assembled.clashes.join(", ")}. The first one in is being used.
        </p>
      )}
    </div>
  );
}

/** Everything that came in, as the letters it has become. */
function Pile(): React.JSX.Element {
  const state = useAssemble();
  const assembled = React.useMemo(
    () => build(state.assembly),
    [state.assembly, state.revision],
  );
  const { metrics } = state.assembly;

  return (
    <div className="toolcraft-scrollbar min-h-0 flex-[2] overflow-y-auto p-3">
      <div className="flex flex-wrap gap-1.5">
        {assembled.letters.map((letter) => (
          <button
            key={letter.character}
            type="button"
            onClick={() => assembleStore.select(letter.character)}
            aria-pressed={letter.character === state.selected}
            title={`${letter.character} — ${letter.file}`}
            data-assemble-cell={letter.character}
            className={tile(
              letter.character === state.selected,
              "relative flex size-14 items-center justify-center rounded-md border",
            )}
          >
            <svg
              viewBox={`0 ${-metrics.ascender} ${Math.max(letter.advanceWidth, 1)} ${
                metrics.ascender - metrics.descender
              }`}
              className="h-9 w-9"
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
            {/* A letter placed from the rest of the set rather than by its own
                measurements is the one worth checking, so it says so. */}
            {!letter.measured && (
              <span
                className={cn(
                  "absolute bottom-0.5 left-1.5 right-1.5 h-0.5 rounded-full",
                  "bg-[color:var(--muted-foreground)]",
                )}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

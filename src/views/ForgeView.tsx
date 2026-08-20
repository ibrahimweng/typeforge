/**
 * Drawing a font from nothing.
 *
 * The letter being worked on, the whole alphabet under it, and a line of type
 * to judge it by. All three are drawn from the same description and redraw
 * together, which is the point: an edit here is never to one letter, so seeing
 * one letter change would be a lie about what just happened.
 *
 * The specimen line matters more than it looks. A letter is not judged on its
 * own -- it is judged against the ones either side of it -- so the rhythm of a
 * word is the only place a spacing decision or a shoulder that springs too high
 * actually shows.
 */

import * as React from "react";

import { CoachMark } from "@/components/CoachMark";
import { contoursToSvgPath } from "@/font/geometry";
import { letterNames } from "@/forge/build";
import { draw, isException, partsOf } from "@/forge/document";
import { handlesFor, valueAfter, type Handle } from "@/forge/handles";
import { tile } from "@/components/controls";
import { forgeStore, useForge, type Phase } from "@/state/useForge";
import { cn } from "@/ui/lib/utils";

/** What a specimen line is set in, chosen for having most of the awkward pairs. */
const SPECIMEN = "Handgloves";

export function ForgeView(): React.JSX.Element {
  const state = useForge();
  const { forge, letter } = state;

  const names = React.useMemo(() => letterNames(), []);
  const parts = React.useMemo(
    () => partsOf(letter, forge),
    [letter, forge, state.revision],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CoachMark id="forge" />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Stage letter={letter} revision={state.revision} parts={parts} />
        <Specimen revision={state.revision} />
        <Alphabet names={names} selected={letter} revision={state.revision} />
      </div>
    </div>
  );
}

/**
 * The letter being worked on, as large as the room allows, with the handles
 * that move it.
 *
 * Every handle is bound to something the font has a name for, so pulling one is
 * the same edit the panel makes and reaches the whole font the same way. The
 * guide lines are there because a number moving in a panel does not say what is
 * being measured, and a line drawn across the letter does.
 */
function Stage({
  letter,
  revision,
  parts,
}: {
  letter: string;
  revision: number;
  parts: string[];
}): React.JSX.Element {
  const state = useForge();
  const svgRef = React.useRef<SVGSVGElement>(null);
  const [held, setHeld] = React.useState<string | null>(null);

  const drawn = React.useMemo(
    () => draw(letter, state.forge),
    [letter, state.forge, revision],
  );
  const handles = React.useMemo(
    () => handlesFor(letter, state.forge.style),
    [letter, state.forge, revision],
  );
  const { metrics } = state.forge.style;

  if (!drawn) return <div className="flex-1" />;

  const top = metrics.ascender + 60;
  const bottom = metrics.descender - 60;
  const width = Math.max(drawn.advanceWidth, 1) + metrics.unitsPerEm * 0.12;
  const unit = metrics.unitsPerEm / 260;

  /*
   * A drag, in font units.
   *
   * The pointer is captured so the gesture survives leaving the handle, and the
   * whole drag is one entry in the history: without that, pulling a stem across
   * the stage would leave a hundred steps to undo one at a time.
   */
  const startDrag = (handle: Handle) => (event: React.PointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld(handle.id);

    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    // How many font units one screen pixel is worth, taken from the box the
    // browser actually gave the drawing rather than from what was asked for.
    const perPixel = width / box.width;
    const from = { x: event.clientX, y: event.clientY };

    const move = (pointer: PointerEvent) => {
      const moved =
        handle.axis === "x"
          ? (pointer.clientX - from.x) * perPixel
          : // Screen y runs down and font y runs up.
            -(pointer.clientY - from.y) * perPixel;
      apply(handle, valueAfter(handle, moved), "during");
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      // Close the run, or the next edit would fold into this drag.
      forgeStore.endGesture();
      setHeld(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
  };

  return (
    <div className="relative flex min-h-0 flex-[3] items-center justify-center bg-[var(--canvas)] px-6">
      <svg
        ref={svgRef}
        viewBox={`${-metrics.unitsPerEm * 0.06} ${-top} ${width} ${top - bottom}`}
        className="h-full max-h-full w-auto touch-none"
        role="img"
        aria-label={`The letter ${letter}`}
        data-forge-stage={letter}
      >
        <g transform="scale(1,-1)">
          {/* The lines a designer works against, so a shape can be judged
              against where it is supposed to reach rather than by eye alone. */}
          {[
            ["baseline", 0],
            ["x-height", metrics.xHeight],
            ["cap", metrics.capHeight],
            ["ascender", metrics.ascender],
            ["descender", metrics.descender],
          ].map(([label, y]) => (
            <line
              key={label as string}
              x1={-metrics.unitsPerEm * 0.06}
              x2={width}
              y1={y as number}
              y2={y as number}
              stroke="var(--border)"
              strokeWidth={unit * 0.5}
            />
          ))}

          <path d={contoursToSvgPath(drawn.contours)} fill="var(--foreground)" fillRule="nonzero" />

          {handles.map((handle) => (
            <g key={handle.id}>
              {handle.guide && (
                <line
                  x1={handle.guide.from.x}
                  y1={handle.guide.from.y}
                  x2={handle.guide.to.x}
                  y2={handle.guide.to.y}
                  stroke="var(--accent)"
                  strokeWidth={unit * (held === handle.id ? 1.2 : 0.7)}
                  strokeDasharray={`${unit * 3} ${unit * 3}`}
                  opacity={held === handle.id ? 0.9 : 0.45}
                />
              )}
              <circle
                cx={handle.at.x}
                cy={handle.at.y}
                r={unit * (held === handle.id ? 5.5 : 4)}
                fill="var(--accent)"
                stroke="var(--canvas)"
                strokeWidth={unit * 1.2}
                onPointerDown={startDrag(handle)}
                data-forge-handle={handle.id}
                className={cn(
                  "transition-[r]",
                  handle.axis === "x" ? "cursor-ew-resize" : "cursor-ns-resize",
                )}
              >
                <title>{`${handle.label}: ${handle.hint}`}</title>
              </circle>
            </g>
          ))}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-3 left-4 flex flex-wrap gap-1.5">
        {parts.map((part) => (
          <span
            key={part}
            className="rounded bg-card px-1.5 py-0.5 text-2xs text-muted-foreground"
          >
            {part}
          </span>
        ))}
      </div>

      {/* What is being pulled, and what it will reach. Said while the drag is
          happening rather than after it. */}
      {held && (
        <div className="pointer-events-none absolute right-4 top-3 rounded bg-card px-2 py-1 text-2xs text-foreground">
          {handles.find((handle) => handle.id === held)?.label}
        </div>
      )}
    </div>
  );
}

/** Send a handle's new value wherever that handle's value lives. */
function apply(handle: Handle, value: number, phase: Phase): void {
  const { drive } = handle;
  if (drive.on === "pen") forgeStore.changePen({ [drive.key]: value }, phase);
  else if (drive.on === "metrics") forgeStore.changeMetrics({ [drive.key]: value }, phase);
  else forgeStore.changePart(drive.part, { [drive.key]: value } as never, phase);
}

/**
 * A line of type at reading size.
 *
 * Set from the drawing rather than from an exported font, so it follows every
 * change immediately instead of waiting for a file to be written.
 */
function Specimen({ revision }: { revision: number }): React.JSX.Element {
  const state = useForge();
  const line = React.useMemo(() => {
    let x = 0;
    const pieces: Array<{ d: string; x: number }> = [];
    for (const character of SPECIMEN) {
      const drawn = draw(character, state.forge);
      if (!drawn) continue;
      pieces.push({ d: contoursToSvgPath(drawn.contours), x });
      x += drawn.advanceWidth;
    }
    return { pieces, width: x };
  }, [state.forge, revision]);

  const { metrics } = state.forge.style;
  if (line.width === 0) return <div />;

  return (
    <div className="flex shrink-0 items-center justify-center border-y border-border px-6 py-4">
      <svg
        viewBox={`0 ${-metrics.ascender} ${line.width} ${metrics.ascender - metrics.descender}`}
        className="h-16 w-auto max-w-full"
        role="img"
        aria-label="Specimen"
      >
        <g transform="scale(1,-1)" fill="var(--foreground)" fillRule="nonzero">
          {line.pieces.map((piece, index) => (
            <path key={index} d={piece.d} transform={`translate(${piece.x} 0)`} />
          ))}
        </g>
      </svg>
    </div>
  );
}

/** Every glyph in the font, small, so a change can be seen spreading. */
function Alphabet({
  names,
  selected,
  revision,
}: {
  names: string[];
  selected: string;
  revision: number;
}): React.JSX.Element {
  const state = useForge();
  const cells = React.useMemo(
    () =>
      names.map((name) => {
        const drawn = draw(name, state.forge);
        return {
          name,
          d: drawn ? contoursToSvgPath(drawn.contours) : "",
          width: drawn?.advanceWidth ?? 0,
          held: isException(state.forge, name),
        };
      }),
    [names, state.forge, revision],
  );

  const { metrics } = state.forge.style;

  return (
    <div className="toolcraft-scrollbar min-h-0 flex-[2] overflow-y-auto p-3">
      <div className="flex flex-wrap gap-1.5">
        {cells.map((cell) => (
          <button
            key={cell.name}
            type="button"
            onClick={() => forgeStore.select(cell.name)}
            aria-pressed={cell.name === selected}
            title={cell.held ? `${cell.name}, holding its own version` : cell.name}
            data-forge-cell={cell.name}
            className={tile(
              cell.name === selected,
              "relative flex size-14 items-center justify-center rounded-md border",
            )}
          >
            <svg
              viewBox={`0 ${-metrics.ascender} ${Math.max(cell.width, 1)} ${metrics.ascender - metrics.descender}`}
              className="h-9 w-9"
              aria-hidden
            >
              <g transform="scale(1,-1)">
                <path d={cell.d} fill="var(--foreground)" fillRule="nonzero" />
              </g>
            </svg>
            {/* A letter holding its own version of a part is marked, or the
                only way to find one again would be to remember it. */}
            {cell.held && (
              <span
                className={cn(
                  "absolute right-1 top-1 size-1.5 rounded-full",
                  "bg-[color:var(--accent)]",
                )}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

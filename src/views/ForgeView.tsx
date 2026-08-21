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
 * actually shows. It is typed rather than fixed, because the word that shows
 * the problem is different for every font: somebody working on a g needs to see
 * a g in company, and nobody can guess which company.
 */

import * as React from "react";

import { CoachMark } from "@/components/CoachMark";
import { Reference } from "@/components/Reference";
import { contoursToSvgPath } from "@/font/geometry";
import { letterNames, skeletonOf } from "@/forge/build";
import { familyOf, weighted, type Forge } from "@/forge/document";
import { nameOfWeight, weightsOf } from "@/forge/family";
import { codepointsFor } from "@/forge/typeface";
import { draw, formOf, isException, isImported, partsOf, reach, styleFor } from "@/forge/document";
import { handlesFor, valueAfter, type Handle } from "@/forge/handles";
import { familyTroubles } from "@/forge/health";
import { driveId, valueOf, whatGoverns, type Governing } from "@/forge/probe";
import { segment, tile } from "@/components/controls";
import { forgeStore, useForge, type Phase } from "@/state/useForge";
import { useLibrary } from "@/state/useLibrary";
import { cn } from "@/ui/lib/utils";

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
        <Warnings revision={state.revision} />
        <Alphabet names={names} selected={letter} revision={state.revision} />
      </div>
    </div>
  );
}

/** How far in and out the letter may be taken. */
const CLOSEST = 6;
const FURTHEST = 0.4;

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
  const [view, setView] = React.useState({ zoom: 1, x: 0, y: 0 });
  /*
   * The handle put there by pressing a spot, and what was said about it.
   *
   * Kept here rather than in the document because it is a question that was
   * asked, not a change that was made: undoing an edit should not take a handle
   * away, and it does not belong in a file anybody exports.
   */
  const [found, setFound] = React.useState<Governing | null>(null);
  const [missed, setMissed] = React.useState(false);

  const form = formOf(state.forge, letter);
  const drawn = React.useMemo(
    () => draw(letter, state.forge),
    [letter, state.forge, revision],
  );
  /*
   * A letter that came in from outside has neither.
   *
   * The recipe for it still exists and would still answer, which is the trap:
   * the skeleton it returns is the skeleton of the letter this one replaced,
   * and drawing that over somebody's own outline says the drawing is being
   * governed by handles that do not touch it.
   */
  const outside = isImported(state.forge, letter);
  const handles = React.useMemo(
    () => (outside ? [] : handlesFor(letter, state.forge.style, form)),
    [letter, state.forge, form, outside, revision],
  );
  const bones = React.useMemo(
    () =>
      state.showSkeleton && !outside
        ? skeletonOf(letter, styleFor(letter, state.forge), form)
        : [],
    [letter, state.forge, form, outside, state.showSkeleton, revision],
  );

  // A handle found on one letter means nothing on the next one.
  React.useEffect(() => {
    setFound(null);
    setMissed(false);
  }, [letter, form, outside]);

  /*
   * How far an edit through this handle would carry.
   *
   * The point of pressing a spot is to change the font, and the thing worth
   * knowing before pulling is how much of it moves. A part says how many
   * letters have it; the pen and the proportions are read by all of them.
   */
  const carries = React.useMemo(() => {
    const drive = found?.handle.drive;
    if (!drive) return "";
    if (drive.on !== "part") return "every letter";
    const { letters } = reach(state.forge, drive.part);
    return `${letters.length} ${letters.length === 1 ? "letter" : "letters"}`;
  }, [found, state.forge, revision]);

  /*
   * The found handle, with its value read afresh.
   *
   * Where it sits, which way it pulls and how fast were all measured when the
   * spot was pressed and do not change. What it is currently set to does, on
   * every drag and every touch of the panel -- and a handle holding the value
   * from when it was made would start its second drag from the first one's
   * beginning and throw away everything in between.
   */
  const probed = React.useMemo<Handle | null>(() => {
    if (!found) return null;
    const style = styleFor(letter, state.forge);
    return { ...found.handle, value: valueOf(style, found.handle.drive) };
  }, [found, letter, state.forge, revision]);

  /*
   * The hand-placed handles, less any that would say the same thing twice.
   *
   * A press on the bar of an H finds the crossbar, and the crossbar already has
   * a handle of its own sitting in the middle of the letter. Two dots driving
   * one number, a stem apart, is a question about which of them is the real
   * one.
   */
  const standing = probed
    ? handles.filter((handle) => driveId(handle.drive) !== driveId(probed.drive))
    : handles;
  const { metrics } = state.forge.style;
  const { reference } = useLibrary();

  if (!drawn) return <div className="flex-1" />;

  const top = metrics.ascender + 60;
  const bottom = metrics.descender - 60;
  const width = Math.max(drawn.advanceWidth, 1) + metrics.unitsPerEm * 0.12;
  const height = top - bottom;
  const unit = metrics.unitsPerEm / 260 / view.zoom;

  /*
   * Zoom and pan, so a join can be looked at closely.
   *
   * Zooming about the pointer rather than about the middle: at four times in,
   * the thing being examined is nowhere near the middle, and zooming about the
   * middle carries it off the edge of the screen.
   */
  const wheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const zoom = Math.min(CLOSEST, Math.max(FURTHEST, view.zoom * Math.exp(-event.deltaY / 400)));
    const at = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
    setView((was) => ({
      zoom,
      x: was.x + width * (1 / was.zoom - 1 / zoom) * at.x,
      y: was.y + height * (1 / was.zoom - 1 / zoom) * at.y,
    }));
  };

  const startPan = (event: React.PointerEvent<SVGRectElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    const from = { pointer: { x: event.clientX, y: event.clientY }, view };
    const perPixel = width / view.zoom / box.width;
    const move = (pointer: PointerEvent) => {
      setView({
        zoom: from.view.zoom,
        x: from.view.x - (pointer.clientX - from.pointer.x) * perPixel,
        // Screen y runs down and the view is written in font units, which the
        // group flips, so panning down moves the window up.
        y: from.view.y + (pointer.clientY - from.pointer.y) * perPixel,
      });
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
  };

  /** Where a pointer is, in the units the letter is drawn in. */
  const spotOf = (event: React.MouseEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    const screen = svg?.getScreenCTM();
    if (!svg || !screen) return null;
    // Through the browser's own matrix rather than by arithmetic on the box:
    // the drawing is fitted into whatever room it was given, and working the
    // fit out again by hand is a second copy of a sum the browser has already
    // done and will keep doing correctly.
    const inside = new DOMPoint(event.clientX, event.clientY).matrixTransform(screen.inverse());
    // The letter is drawn inside a flip, because font y runs up.
    return { x: inside.x, y: -inside.y };
  };

  /*
   * Press a spot, and get whatever is behind it.
   *
   * The other way to reach a control is to read the panel, which means knowing
   * that the curve where an arch leaves its stem is called the shoulder. This
   * way round asks for none of that: point at the part of the letter you want
   * to change, and the control that changes it comes to you -- as a handle on
   * the edge you pressed, and as the panel scrolled to the row it lives on.
   *
   * A letter that came in from outside is not drawn from a skeleton, so there
   * is nothing behind any of it and it is not asked.
   */
  const probe = (event: React.MouseEvent) => {
    if (outside) return;
    const spot = spotOf(event);
    if (!spot) return;
    const governing = whatGoverns(letter, styleFor(letter, state.forge), spot, form);
    setFound(governing);
    setMissed(governing === null);
    if (governing) forgeStore.showControl(driveId(governing.handle.drive));
  };

  /*
   * A drag, in font units.
   *
   * The pointer is captured so the gesture survives leaving the handle, and the
   * whole drag is one entry in the history: without that, pulling a stem across
   * the stage would leave a hundred steps to undo one at a time.
   */
  const startDrag = (handle: Handle) => (event: React.PointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld(handle.id);

    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    // How many font units one screen pixel is worth, taken from the box the
    // browser actually gave the drawing rather than from what was asked for,
    // and from how far in the view is zoomed.
    const perPixel = width / view.zoom / box.width;
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

  const left = -metrics.unitsPerEm * 0.06 + view.x;
  const viewBox = `${left} ${-top + view.y} ${width / view.zoom} ${height / view.zoom}`;

  return (
    <div className="relative flex min-h-0 flex-[3] select-none items-center justify-center bg-[var(--canvas)] px-6">
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="h-full max-h-full w-auto touch-none"
        role="img"
        aria-label={`The letter ${letter}`}
        data-forge-stage={letter}
        onWheel={wheel}
        onDoubleClick={probe}
      >
        {/* Somewhere to grab that is not the letter, for panning. */}
        <rect
          x={left}
          y={-top + view.y}
          width={width / view.zoom}
          height={height / view.zoom}
          fill="transparent"
          className="cursor-grab"
          onPointerDown={startPan}
        />
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
              x1={left}
              x2={left + width / view.zoom}
              y1={y as number}
              y2={y as number}
              stroke="var(--border)"
              strokeWidth={unit * 0.5}
            />
          ))}

          {/* Under the letter, so the letter stays the thing being looked at. */}
          <Reference
            loaded={reference}
            character={letter}
            unitsPerEm={metrics.unitsPerEm}
          />

          <path
            d={contoursToSvgPath(drawn.contours)}
            fill="var(--foreground)"
            fillRule="nonzero"
            opacity={state.showSkeleton ? 0.32 : 1}
          />

          {/*
            The skeleton, and the pen along it.

            Shown under the letter rather than over it so the ink stays the
            thing being looked at. The pen is drawn at intervals because a
            skeleton on its own does not say how wide the stroke will be, and
            with contrast it does not say which way the width runs either.
          */}
          {bones.map((bone, index) => (
            <g key={index}>
              {bone.pen.map((where, step) => (
                <ellipse
                  key={step}
                  cx={where.at.x}
                  cy={where.at.y}
                  rx={where.across}
                  ry={where.along}
                  transform={`rotate(${where.angle} ${where.at.x} ${where.at.y})`}
                  fill="var(--accent)"
                  opacity={0.12}
                />
              ))}
              <path
                d={bone.path}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={unit * 1.1}
                strokeLinecap="round"
                opacity={0.85}
              />
            </g>
          ))}

          {standing.map((handle) => (
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
                /* Pressing a handle is asking about the handle, not about the
                   letter underneath it -- so the panel is sent to its control
                   rather than the spot being read for whatever else is there. */
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  forgeStore.showControl(driveId(handle.drive));
                }}
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
          {/*
            The handle the press put there.

            Drawn larger and with a ring, because it is the answer to a question
            somebody just asked and the standing handles are not. The line
            through it says which way it pulls, which a dot on its own does not.
          */}
          {probed && (
            <g data-forge-probed={driveId(probed.drive)}>
              <line
                x1={probed.axis === "x" ? probed.at.x - unit * 14 : probed.at.x}
                y1={probed.axis === "x" ? probed.at.y : probed.at.y - unit * 14}
                x2={probed.axis === "x" ? probed.at.x + unit * 14 : probed.at.x}
                y2={probed.axis === "x" ? probed.at.y : probed.at.y + unit * 14}
                stroke="var(--accent)"
                strokeWidth={unit * 1.1}
                strokeLinecap="round"
                opacity={0.75}
              />
              <circle
                cx={probed.at.x}
                cy={probed.at.y}
                r={unit * (held === probed.id ? 7 : 5.5)}
                fill="var(--accent)"
                stroke="var(--canvas)"
                strokeWidth={unit * 1.6}
                onPointerDown={startDrag(probed)}
                onDoubleClick={(event) => event.stopPropagation()}
                data-forge-handle={probed.id}
                className={cn(
                  "transition-[r]",
                  probed.axis === "x" ? "cursor-ew-resize" : "cursor-ns-resize",
                )}
              >
                <title>{`${probed.label}: ${probed.hint}`}</title>
              </circle>
            </g>
          )}
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

      <div className="absolute left-4 top-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => forgeStore.setShowSkeleton(!state.showSkeleton)}
          aria-pressed={state.showSkeleton}
          data-forge-skeleton
          className={segment(state.showSkeleton)}
        >
          Skeleton
        </button>
        {view.zoom !== 1 && (
          <button
            type="button"
            onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
            className={segment(false)}
          >
            {view.zoom.toFixed(1)}× · fit
          </button>
        )}
      </div>

      {/* What is being pulled, and what it will reach. Said while the drag is
          happening rather than after it. */}
      {held && (
        <div className="pointer-events-none absolute right-4 top-3 rounded bg-card px-2 py-1 text-2xs text-foreground">
          {[...standing, ...(probed ? [probed] : [])].find((handle) => handle.id === held)?.label}
        </div>
      )}

      {/*
        What the press found, in the words the panel uses for it.

        Worth saying out loud rather than leaving to the dot that appeared:
        somebody who presses the arch of an n and gets a handle has learnt where
        to drag, and somebody who is told it is the shoulder has learnt what the
        thing is called and can find it again from the panel tomorrow.
      */}
      {!held && found && probed && (
        <div
          className="pointer-events-none absolute bottom-3 right-4 max-w-64 rounded bg-card px-2 py-1 text-2xs text-muted-foreground"
          data-forge-found={driveId(probed.drive)}
        >
          <span className="text-foreground">{probed.label}</span>
          {` · reaches ${carries}`}
        </div>
      )}
      {!held && missed && (
        <div
          className="pointer-events-none absolute bottom-3 right-4 max-w-64 rounded bg-card px-2 py-1 text-2xs text-muted-foreground"
          data-forge-found="nothing"
        >
          Nothing shapes that spot. Press an edge of the letter.
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

/** One line of the specimen, set in one weight of the family. */
function setLine(forge: Forge, text: string): { pieces: Array<{ d: string; x: number }>; width: number } {
  let x = 0;
  const pieces: Array<{ d: string; x: number }> = [];
  for (const character of text) {
    const name = nameOf(character);
    const drawn = name ? draw(name, forge) : null;
    if (!drawn) {
      // Anything the font has no glyph for still takes its space, or the
      // words in a specimen line would run together.
      x += forge.style.metrics.unitsPerEm * 0.26;
      continue;
    }
    if (drawn.contours.length === 0) {
      // A space, which the font does have a glyph for and does have a width
      // for -- so it gets that width rather than the guess above.
      x += drawn.advanceWidth;
      continue;
    }
    pieces.push({ d: contoursToSvgPath(drawn.contours), x });
    x += drawn.advanceWidth;
  }
  return { pieces, width: x };
}

/**
 * A line of type at reading size, in every weight the typeface has.
 *
 * Set from the drawing rather than from an exported font, so it follows every
 * change immediately instead of waiting for a file to be written. Typed rather
 * than fixed, and reversible, because a heavy face looks lighter on a dark
 * ground than on a light one and that is the difference a display face is
 * usually being chosen for.
 *
 * A family is shown as a family. Nine weights described in a dialog and never
 * seen is a promise; nine lines one under another is the thing itself, and it
 * is the only way to find out that the Black has closed up or the Thin has
 * disappeared before the files are written.
 */
function Specimen({ revision }: { revision: number }): React.JSX.Element {
  const state = useForge();
  const weights = weightsOf(familyOf(state.forge));
  const lines = React.useMemo(
    () =>
      weights.map((weight) => ({
        weight,
        name: nameOfWeight(weight),
        drawn: weight === familyOf(state.forge).drawn,
        ...setLine(weighted(state.forge, weight), state.specimen),
      })),
    // The forge and the text are what the lines are made of; the revision is
    // how everything else here knows a part moved underneath them.
    [state.forge, state.specimen, revision, weights.join()],
  );
  const { metrics } = state.forge.style;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-y border-border px-4 py-3",
        state.reversed && "bg-foreground",
      )}
    >
      <input
        value={state.specimen}
        onChange={(event) => forgeStore.setSpecimen(event.target.value)}
        aria-label="Specimen text"
        data-forge-specimen
        placeholder="Type something"
        className={cn(
          "w-40 shrink-0 rounded-md border border-border bg-card px-2 py-1 text-2xs",
          "text-foreground outline-none focus:border-[color:var(--accent)]",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden">
        {lines.map((one) =>
          one.width > 0 ? (
            <div key={one.weight} className="flex w-full min-w-0 items-center gap-2">
              {lines.length > 1 && (
                <span
                  className={cn(
                    "w-16 shrink-0 truncate text-right text-2xs tabular-nums",
                    state.reversed ? "text-[color:var(--canvas)] opacity-60" : "text-muted-foreground",
                  )}
                  data-forge-weight-label={one.weight}
                >
                  {one.name}
                </span>
              )}
              <svg
                viewBox={`0 ${-metrics.ascender} ${one.width} ${metrics.ascender - metrics.descender}`}
                className={cn("w-auto max-w-full", lines.length > 1 ? "h-7" : "h-16")}
                role="img"
                aria-label={lines.length > 1 ? `Specimen ${one.name}` : "Specimen"}
                data-forge-specimen-line={one.weight}
              >
                <g
                  transform="scale(1,-1)"
                  fill={state.reversed ? "var(--canvas)" : "var(--foreground)"}
                  fillRule="nonzero"
                >
                  {one.pieces.map((piece, index) => (
                    <path key={index} d={piece.d} transform={`translate(${piece.x} 0)`} />
                  ))}
                </g>
              </svg>
            </div>
          ) : null,
        )}
      </div>
      <button
        type="button"
        onClick={() => forgeStore.setReversed(!state.reversed)}
        aria-pressed={state.reversed}
        data-forge-reverse
        className={cn(segment(state.reversed), "shrink-0")}
      >
        Reverse
      </button>
    </div>
  );
}

/**
 * Which letter draws a character, for setting a line of type in the specimen.
 *
 * Read back off the characters the font already answers to, rather than from a
 * list kept beside them. There was such a list: two dozen marks somebody had
 * thought of, and it had already had to learn the accented letters once. Every
 * symbol added since would have had to be typed into it a second time, and
 * until somebody did, the specimen would set a line with holes in it and read
 * as a font that could not draw them.
 */
const BY_CHARACTER = new Map<string, string>();
for (const name of letterNames()) {
  for (const codepoint of codepointsFor(name)) {
    const character = String.fromCodePoint(codepoint);
    if (!BY_CHARACTER.has(character)) BY_CHARACTER.set(character, name);
  }
}

function nameOf(character: string): string | null {
  return BY_CHARACTER.get(character) ?? null;
}


/**
 * What has closed up, and where.
 *
 * The letters here cannot fold, but they can be pushed somewhere nobody meant:
 * a pen wide enough closes a counter, a spacing of nothing runs the letters
 * together. None of that is prevented -- a display face may want exactly that --
 * but finding out later is no use, so it is said while the slider that caused
 * it is still under the hand.
 */
function Warnings({ revision }: { revision: number }): React.JSX.Element | null {
  const state = useForge();
  const found = React.useMemo(() => familyTroubles(state.forge), [state.forge, revision]);
  if (found.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-border px-4 py-2" data-forge-warnings>
      {found.map((trouble) => (
        <div key={trouble.what} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-0.5">
          <span className="text-2xs font-medium text-[color:var(--accent)]">{trouble.what}</span>
          <span className="text-2xs text-muted-foreground">{trouble.fix}</span>
          <span className="flex flex-wrap gap-1">
            {trouble.letters.slice(0, 14).map((letter) => (
              <button
                key={letter}
                type="button"
                onClick={() => forgeStore.select(letter)}
                className="rounded bg-card px-1 text-2xs text-foreground transition-opacity hover:opacity-70"
              >
                {letter}
              </button>
            ))}
            {trouble.letters.length > 14 && (
              <span className="text-2xs text-muted-foreground">
                and {trouble.letters.length - 14} more
              </span>
            )}
          </span>
        </div>
      ))}
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
          shaped: Boolean(formOf(state.forge, name)),
          outside: isImported(state.forge, name),
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
            title={
              cell.outside
                ? `${cell.name}, your own drawing`
                : cell.held
                  ? `${cell.name}, holding its own version`
                  : cell.name
            }
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
                only way to find one again would be to remember it. A letter
                drawn from another skeleton is marked differently, because it is
                a different kind of difference. */}
            {cell.held && (
              <span
                className={cn(
                  "absolute right-1 top-1 size-1.5 rounded-full",
                  "bg-[color:var(--accent)]",
                )}
              />
            )}
            {cell.shaped && (
              <span
                className={cn(
                  "absolute bottom-1 right-1 size-1.5 rounded-[1px]",
                  "bg-[color:var(--accent)]",
                )}
              />
            )}
            {/* A letter that is no longer drawn at all is marked along the
                foot rather than with a dot, because it is not a variation on
                the family the way the other two are -- it has left it, and no
                edit made here will reach it again until it comes back. */}
            {cell.outside && (
              <span
                className="absolute inset-x-1.5 bottom-0.5 h-0.5 rounded-full bg-[color:var(--muted-foreground)]"
                data-forge-outside={cell.name}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

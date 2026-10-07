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
import type { Contour } from "@/font/types";
import { type Frame, inkFrame, type Placed, viewBoxOf } from "@/components/ink-frame";
import { letterNames, skeletonOf } from "@/forge/build";
import { cellBox, cellKey, PORTS, portAt, rowsOf, unitOf } from "@/forge/kit";
import { anyEffect } from "@/font/effects";
import { anyShaping } from "@/forge/layers";
import {
  effectsOf,
  familyOf,
  proof,
  unshaped,
  weighted,
  widthsFor,
  type Forge,
} from "@/forge/document";
import { NORMAL_WIDTH, styleNameOf, weightsOf } from "@/forge/family";
import { codepointsFor } from "@/forge/typeface";
import {
  draw,
  formOf,
  isException,
  isImported,
  isLaidOut,
  kitOf,
  partsOf,
  reach,
  styleFor,
  tilesFor,
} from "@/forge/document";
import { handlesFor, valueAfter, type Handle } from "@/forge/handles";
import { familyWalk, type Trouble } from "@/forge/health";
import { driveId, settingOf, whatGoverns, type Governing } from "@/forge/probe";
import { segment, tile } from "@/components/controls";
import { forgeStore, useForge, type Phase } from "@/state/useForge";
import { useLibrary } from "@/state/useLibrary";
import { cn } from "@/cn";
import { followPointer } from "@/components/follow-pointer";
import { letterLabel } from "./letter-label";
import { useNativeWheel, zoomAbout } from "./wheel";
import { useShowing } from "@/state/surface";

export function ForgeView(): React.JSX.Element {
  useShowing("forge");
  const state = useForge();
  const { forge, letter } = state;

  const names = React.useMemo(() => letterNames(), []);
  const parts = React.useMemo(() => partsOf(letter, forge), [letter, forge, state.revision]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CoachMark id="forge" />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Stage letter={letter} revision={state.revision} parts={parts} />
        <Specimen revision={state.revision} />
        {/*
         * The warnings share the strip's part of the page, under it, and take
         * nothing from the stage.
         *
         * They arrive when the walk over the font finishes, which is a moment
         * after the font holds still and several on a busy machine. Standing
         * between the specimen and the strip, the bar took its height out of
         * the stage as it came and went, so the letter shrank and moved under
         * the pointer after an edit: turning the grid on warns about the
         * letters it lays past the ascender, and the press that followed landed
         * a cell below the one aimed at. Under the strip, the only thing that
         * moves is the strip's bottom edge, and nothing is aimed at there.
         *
         * Both of these read the whole alphabet, so both wait for the drag to
         * end rather than following the live one: they catch up when the hand
         * comes off instead of holding it up.
         */}
        <div className="flex min-h-0 flex-[2] flex-col">
          <Alphabet names={names} selected={letter} />
          <Warnings revision={state.settledRevision} />
        </div>
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
   * The wheel, bound natively so it can keep the page from zooming too (see
   * `wheel.ts`). Bound up here, before the early return below, because it is
   * a hook; the handler it calls needs the drawing's size, which is only
   * known after that return, so it is handed over through a ref each render.
   */
  const onWheel = React.useRef<((event: WheelEvent) => void) | null>(null);
  useNativeWheel(svgRef, (event) => onWheel.current?.(event));
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
  const kitOn = Boolean(state.forge.kit?.on);
  /*
   * Without the cuts and the casts while a gesture is in flight.
   *
   * They are booleans over the whole outline and cost between five and forty
   * milliseconds a letter, which is nothing once and everything on every frame
   * of a drag. The full shape comes back the moment the hand stops -- see
   * `unshaped`, and `resting` on the store.
   */
  const drawn = React.useMemo(
    () => draw(letter, state.resting ? state.forge : unshaped(state.forge)),
    [letter, state.forge, state.resting, revision],
  );
  /*
   * The letter as the font last held still, which is what the stage is framed
   * by. Framed by the live drawing instead, the stage changed size mid-drag --
   * a cast is dropped for the length of a gesture, so the frame shrank on the
   * first frame of the drag and grew back after it.
   */
  const rested = React.useMemo(
    () => draw(letter, state.settled),
    [letter, state.settled, revision],
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
  /*
   * Neither a handle nor a skeleton belongs on a letter built from cells.
   *
   * The recipe would still answer, and that is the trap it shares with an
   * imported letter: what it returns is the skeleton of the letter this one
   * replaced, and drawing it over the cells says the drawing is governed by
   * handles that do not touch it.
   */
  const own = outside || (kitOn && isLaidOut(state.forge, letter));
  const handles = React.useMemo(
    () => (own ? [] : handlesFor(letter, state.forge.style, form)),
    [letter, state.forge, form, own, revision],
  );
  const bones = React.useMemo(
    () =>
      state.showSkeleton && !own ? skeletonOf(letter, styleFor(letter, state.forge), form) : [],
    [letter, state.forge, form, own, state.showSkeleton, revision],
  );

  // A handle found on one letter means nothing on the next one.
  React.useEffect(() => {
    setFound(null);
    setMissed(false);
  }, [letter, form, own]);

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
    return { ...found.handle, value: settingOf(style, found.handle.drive) };
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

  /*
   * The ascender and descender with room to spare, grown to take in any ink
   * that goes further -- a shadow thrown down past the descender, the ring of
   * an Å -- which used to run off the stage and be cut away.
   */
  const still = rested ?? drawn;
  const ink = inkFrame(metrics, [{ contours: still.contours, x: 0 }], still.advanceWidth);
  const span = within(reachOf(state.settled), ink);
  const top = Math.max(metrics.ascender + 60, -span.y);
  const bottom = Math.min(metrics.descender - 60, -(span.y + span.height));
  const pad = metrics.unitsPerEm * 0.06;
  const leftmost = Math.min(-pad, ink.x - pad / 2);
  const width =
    Math.max(Math.max(drawn.advanceWidth, 1) + pad, ink.x + ink.width + pad / 2) - leftmost;
  const height = top - bottom;
  const unit = metrics.unitsPerEm / 260 / view.zoom;

  /*
   * Zoom and pan, so a join can be looked at closely.
   *
   * Zooming about the pointer rather than about the middle: at four times in,
   * the thing being examined is nowhere near the middle, and zooming about the
   * middle carries it off the edge of the screen.
   */
  const wheel = (event: WheelEvent) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    // Every wheel over the stage is the stage's: without this Ctrl-wheel and a
    // trackpad pinch zoomed the whole page along with the letter.
    event.preventDefault();
    const at = {
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    };
    const deltaY = event.deltaY;
    // The zoom and the pan are both worked from `was`, never from `view`,
    // which is the render this handler was made in and is stale by the second
    // tick of a fast scroll.
    setView((was) =>
      zoomAbout(was, deltaY, at, { width, height }, { closest: CLOSEST, furthest: FURTHEST }),
    );
  };
  onWheel.current = wheel;

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
    // Up or cancelled, a pan is over either way and there is nothing to undo.
    followPointer({ move, end: () => {} });
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
   * A letter that came in from outside, or that is built from cells, is not
   * drawn from a skeleton -- so there is nothing behind any of it and it is
   * not asked.
   */
  const probe = (event: React.MouseEvent) => {
    if (own) return;
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
    followPointer({
      move,
      /*
       * Closed the same way whether the pointer came up or was cancelled.
       * What the drag moved has already been applied as it went, so a cancel
       * leaves it where it got to -- one undo takes it back -- and the gesture
       * has to be closed either way, or the next edit would fold into this one.
       */
      end: () => {
        forgeStore.endGesture();
        setHeld(null);
      },
    });
  };

  const left = leftmost + view.x;
  const viewBox = `${left} ${-top + view.y} ${width / view.zoom} ${height / view.zoom}`;

  return (
    <div className="relative flex min-h-0 flex-[3] select-none items-center justify-center bg-[var(--canvas)] px-6">
      <Proof letter={letter} />
      <svg
        ref={svgRef}
        viewBox={viewBox}
        className="h-full max-h-full w-auto touch-none"
        role="img"
        aria-label={`The letter ${letter}`}
        data-forge-stage={letter}
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
          <Reference loaded={reference} character={letter} unitsPerEm={metrics.unitsPerEm} />

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

          {/* The cells, over the ink, because the ink is what they made. */}
          {kitOn && <Cells letter={letter} scale={unit} />}

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
              {/* biome-ignore lint/a11y/noStaticElementInteractions: an SVG handle dragged directly; the sliders beside the canvas are the keyboard path. */}
              <circle
                cx={handle.at.x}
                cy={handle.at.y}
                r={unit * (held === handle.id ? 5.5 : 4)}
                fill="var(--accent)"
                stroke="var(--canvas)"
                strokeWidth={unit * 1.2}
                onPointerDown={startDrag(handle)}
                /* Pressing a handle is asking about the handle, not about the
                   letter underneath it — so the panel is sent to its control
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
              {/* biome-ignore lint/a11y/noStaticElementInteractions: an SVG handle dragged directly; the sliders beside the canvas are the keyboard path. */}
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
          <span key={part} className="rounded bg-card px-1.5 py-0.5 text-2xs text-muted-foreground">
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
/**
 * The letters that between them reach as far as any letter does: the tallest
 * accents, the deepest tails, the brackets that go past both lines.
 */
const FRAME_SAMPLE = [
  "Aring",
  "Eacute",
  "Ccedilla",
  "Ograve",
  "g",
  "j",
  "y",
  "p",
  "Q",
  "f",
  "parenleft",
  "braceleft",
  "dollar",
];

const reaches = new WeakMap<Forge, { revision: number; frame: Frame }>();

/**
 * How far the font's ink reaches above and below, as one frame for every
 * letter shown on the page.
 *
 * Each letter used to be framed to its own ink, which kept every one whole
 * and drew them at different sizes: an Å came out a sixth smaller than the A
 * beside it, on the stage and in the strip, and the specimen shrank the moment
 * an accented capital was typed. One frame for the font keeps them at one size
 * and on one baseline; a letter that reaches further still grows its own.
 *
 * Kept per font rather than worked out per letter, since the strip asks for it
 * once a cell.
 */
function reachOf(forge: Forge): Frame {
  const revision = forgeStore.getSnapshot().revision;
  const known = reaches.get(forge);
  if (known && known.revision === revision) return known.frame;
  const pieces = FRAME_SAMPLE.flatMap((name) => {
    const drawn = draw(name, forge);
    return drawn ? [{ contours: drawn.contours, x: 0 }] : [];
  });
  const frame = inkFrame(forge.style.metrics, pieces, 1);
  reaches.set(forge, { revision, frame });
  return frame;
}

/** The font's reach, grown to take in a frame of ink that goes further. */
function within(reach: Frame, own: Frame): { y: number; height: number } {
  const top = Math.min(reach.y, own.y);
  const bottom = Math.max(reach.y + reach.height, own.y + own.height);
  return { y: top, height: bottom - top };
}

function setLine(
  forge: Forge,
  text: string,
): { pieces: Array<{ d: string; x: number; contours: Contour[] }>; width: number } {
  let x = 0;
  const pieces: Array<{ d: string; x: number; contours: Contour[] }> = [];
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
    pieces.push({ d: contoursToSvgPath(drawn.contours), x, contours: drawn.contours });
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
  /*
   * And the widths, which the dialog offers on the same terms as the weights
   * and which this used to leave out: a Condensed ticked in the dialog was a
   * promise nothing on screen kept, while the Black ticked beside it got a
   * line of its own.
   *
   * Each other width at the weight being drawn, rather than at every weight.
   * A family of nine weights at five widths is forty-five fonts, and setting
   * the line forty-five times on every frame of a drag is the cost the line
   * below is careful about. One line a width shows what the width does; the
   * weights are already shown one line each at the Normal.
   */
  const widths = widthsFor(state.forge);
  /*
   * The same, and it matters more here: the specimen is set at every weight the
   * family has, so a line of twenty characters is eighty letters a frame.
   */
  const shown = state.resting ? state.forge : unshaped(state.forge);
  // biome-ignore lint/correctness/useExhaustiveDependencies: weights.join() and widths.join() compare by content; the arrays themselves are new every render.
  const lines = React.useMemo(() => {
    const drawn = familyOf(shown).drawn;
    const members = [
      ...weights.map((weight) => ({ weight, width: NORMAL_WIDTH })),
      ...widths
        .filter((width) => width !== NORMAL_WIDTH)
        .map((width) => ({ weight: drawn, width })),
    ];
    return members.map(({ weight, width }) => ({
      weight,
      // Named for the weight alone at the Normal, as it always was, so the
      // attributes below still say which weight a line is.
      key: width === NORMAL_WIDTH ? `${weight}` : `${weight}-${width}`,
      name: styleNameOf(weight, width),
      drawn: weight === drawn && width === NORMAL_WIDTH,
      ...setLine(weighted(shown, weight, width), state.specimen),
    }));
    // The forge and the text are what the lines are made of; the revision is
    // how everything else here knows a part moved underneath them.
  }, [shown, state.specimen, revision, weights.join(), widths.join()]);
  const { metrics } = state.forge.style;
  // Every weight on the same height, taken from all of them, so the lines stay
  // at one size and whatever reaches past the ascender or descender -- an
  // accent, a heavy tail -- is shown rather than cropped.
  const tall = React.useMemo(
    () =>
      within(
        reachOf(state.settled),
        inkFrame(
          metrics,
          lines.flatMap((one) => one.pieces),
          1,
        ),
      ),
    [lines, metrics, state.settled, revision],
  );

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
            <div key={one.key} className="flex w-full min-w-0 items-center gap-2">
              {lines.length > 1 && (
                <span
                  className={cn(
                    "shrink-0 truncate text-right text-2xs tabular-nums",
                    // Room for "SemiCondensed Bold" once there are widths.
                    widths.length > 1 ? "w-28" : "w-16",
                    state.reversed
                      ? "text-[color:var(--canvas)] opacity-60"
                      : "text-muted-foreground",
                  )}
                  data-forge-weight-label={one.key}
                >
                  {one.name}
                </span>
              )}
              <svg
                viewBox={viewBoxOf({
                  ...inkFrame(metrics, one.pieces, one.width),
                  y: tall.y,
                  height: tall.height,
                })}
                className={cn("w-auto max-w-full", lines.length > 1 ? "h-7" : "h-16")}
                role="img"
                aria-label={lines.length > 1 ? `Specimen ${one.name}` : "Specimen"}
                data-forge-specimen-line={one.key}
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
 * The letter as the tool actually left it.
 *
 * One letter, on purpose, and it is the whole of the bargain this layer makes.
 * Roughening touches every point of every outline and then resolves the result
 * with a boolean; run across the alphabet between two frames it is exactly the
 * kind of work that made this page unusable before. So the effects are shown
 * here, on the letter under the hand, and go on the rest of the font only when
 * it is exported.
 *
 * Two sizes, because the mistake this panel exists to prevent is choosing a
 * texture at poster size and finding out at twelve point that it has turned to
 * mud.
 *
 * The small row is the one letter repeated rather than a word, and that is the
 * point rather than a shortcut: it is the same drawing set again, so what is
 * small is exactly what is large. Setting a real word would mean drawing six
 * more letters through the whole layer, which is six times the cost to show
 * something this panel is not being asked.
 */
const PROOF_RUN = 7;

/**
 * How many glyphs the font draws, for the proof's size estimate: read off the
 * letters themselves rather than written down, so adding a glyph moves it. It
 * was a hard-coded 452, and stayed there when the typographic punctuation
 * added seventeen more; there is no fixed number to write here, since it
 * moves with every glyph the letters gain and differs between the bases.
 */
const GLYPH_COUNT = letterNames().length;

function Proof({ letter }: { letter: string }): React.JSX.Element | null {
  const state = useForge();
  const effects = effectsOf(state.forge);
  // Folded to its button on a phone, where the open card is most of the stage
  // and sat over the letter it was proofing.
  const [open, setOpen] = React.useState(
    () =>
      typeof window === "undefined" ||
      !(window.matchMedia?.("(max-width: 767px)")?.matches ?? false),
  );

  /*
   * Worked out when the font holds still, like the health check and for the
   * same reason -- one letter is cheap next to four hundred and fifty, and it
   * is not cheap next to a frame.
   */
  const [made, setMade] = React.useState<{
    of: Forge;
    d: string;
    width: number;
    points: number;
    /** The font's frame, grown for anything the tool pushed further. */
    y: number;
    height: number;
  } | null>(null);
  React.useEffect(() => {
    if (!anyEffect(effects) || !state.resting) return;
    let live = true;
    const waited = window.setTimeout(() => {
      if (!live) return;
      const drawn = proof(letter, state.forge);
      const width = drawn?.advanceWidth ?? 0;
      const own = inkFrame(
        state.forge.style.metrics,
        drawn ? [{ contours: drawn.contours, x: 0 }] : [],
        width,
      );
      setMade({
        of: state.forge,
        d: drawn ? contoursToSvgPath(drawn.contours) : "",
        width,
        points: drawn ? drawn.contours.reduce((sum, one) => sum + one.nodes.length, 0) : 0,
        ...within(reachOf(state.forge), own),
      });
    }, PROOF_WAIT);
    return () => {
      live = false;
      window.clearTimeout(waited);
    };
  }, [letter, state.forge, state.resting, effects]);

  if (!anyEffect(effects)) return null;
  /*
   * The frame the tool's drawing is shown in. It was a fixed share past the
   * ascender and descender, and an Å came out with its ring cut off.
   */
  const { metrics } = state.forge.style;
  const top = made ? -made.y : metrics.ascender * 1.06;
  const bottom = made ? -(made.y + made.height) : metrics.descender * 1.2;
  const stale = made !== null && made.of !== state.forge;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-forge-proof-open
        className={cn(
          "absolute bottom-3 right-3 z-10 rounded-md border border-border bg-card px-2 py-1",
          "text-2xs text-foreground transition-opacity hover:opacity-80",
        )}
      >
        Proof {letter}
      </button>
    );
  }

  return (
    <div
      data-forge-proof={letter}
      className={cn(
        "absolute bottom-3 right-3 z-10 w-56 rounded-md border border-border bg-card p-2",
        "shadow-lg",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xs font-medium text-foreground">The tool, on {letter}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Hide the proof"
          className="text-2xs text-muted-foreground transition-opacity hover:opacity-70"
        >
          Hide
        </button>
      </div>

      <div className={cn("mt-1 rounded bg-[var(--canvas)] p-1", stale && "opacity-40")}>
        <svg
          viewBox={`0 ${-top} ${Math.max(made?.width ?? 1, 1)} ${top - bottom}`}
          className="h-24 w-full"
          role="img"
          aria-label={`${letter} as the tool left it`}
          data-forge-proof-large
        >
          <g transform="scale(1,-1)">
            <path d={made?.d ?? ""} fill="var(--foreground)" fillRule="nonzero" />
          </g>
        </svg>
      </div>

      {/* The same drawing again and again, small, because a texture that reads
          at poster size can be mud at twelve point and this is where to find
          that out. */}
      <div
        className={cn(
          "mt-1 flex justify-center rounded bg-[var(--canvas)] py-1",
          stale && "opacity-40",
        )}
      >
        <svg
          viewBox={`0 ${-top} ${Math.max((made?.width ?? 1) * PROOF_RUN, 1)} ${top - bottom}`}
          className="h-5 w-full"
          role="img"
          aria-label={`${letter} repeated small`}
          data-forge-proof-small
        >
          <g transform="scale(1,-1)">
            {Array.from({ length: PROOF_RUN }, (_, at) => (
              <path
                key={at}
                d={made?.d ?? ""}
                transform={`translate(${(made?.width ?? 0) * at} 0)`}
                fill="var(--foreground)"
                fillRule="nonzero"
              />
            ))}
          </g>
        </svg>
      </div>

      <p className="pt-1 text-2xs leading-snug text-muted-foreground" data-forge-proof-cost>
        {made === null
          ? "Drawing\u2026"
          : `${made.points} points. About ${Math.round((made.points * GLYPH_COUNT * 10) / 1024)}KB across the font.`}
      </p>
      <p className="text-2xs leading-snug text-muted-foreground">
        On this letter only until you export.
      </p>
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
 * The grid, over the letter, with every place a stroke can leave a cell.
 *
 * The whole of the editing, and deliberately one thing rather than nine. A
 * cell is a set of places ink runs to, so there is one gesture -- press the
 * spot where you want the stroke to leave -- and every letterform on the grid
 * is some arrangement of having used it. There is no tile menu to learn and no
 * shape to pick out of a row: the shape is a consequence.
 *
 * Only the cell under the pointer shows all eight. Two hundred and fifty-six
 * dots over a letter is not an editor, it is a screen door, and the ones that
 * matter -- the ports that are on -- are invisible among them.
 *
 * Drawn in two passes, every cell's square and then every cell's ports, and
 * that is not tidiness. A port sits *on* the edge it names, so half of it lies
 * in the cell next door -- and drawn a cell at a time, square and ports
 * together, the next cell's square paints straight over that half. Reaching
 * for the port on a cell's east side, the pointer left the cell before it
 * arrived: the square next door took the enter, the cell under the pointer
 * changed, the eight dots vanished, and what was left under the cursor was the
 * neighbour's west port -- the same spot on the screen, a different toggle. A
 * miss then landed on the square instead, which stamps a fill. So the gesture
 * the panel describes could not be made: the dot moved away as it was reached
 * for, and hitting it did the wrong thing.
 *
 * With every port above every square the pointer never crosses into the cell
 * next door on its way to one, so the cell stays put and the port that is under
 * the cursor is the one that was aimed at. Each also carries a hit circle
 * twice its size, because these are five pixels across at the default zoom.
 */
function Cells({ letter, scale }: { letter: string; scale: number }): React.JSX.Element | null {
  const state = useForge();
  const [over, setOver] = React.useState<string | null>(null);
  const kit = kitOf(state.forge);
  const style = styleFor(letter, state.forge);
  const tiles = tilesFor(state.forge, letter);

  const unit = unitOf(style, kit.grid);
  const left = style.metrics.sidebearing;
  const rows = rowsOf(kit.grid);
  // One column past the letter, so it can be made wider by using it.
  const columns = (tiles?.columns ?? 1) + 1;

  const places = rows.flatMap((row) =>
    Array.from({ length: columns }, (_, column) => ({
      key: cellKey(column, row),
      box: cellBox(column, row, unit, left),
      cell: tiles?.cells[cellKey(column, row)],
    })),
  );

  return (
    <g data-forge-cells={letter}>
      <g data-forge-cell-squares>
        {places.map(({ key, box, cell }) => {
          const showing = over === key;
          return (
            <g key={key}>
              <rect
                x={box.xMin}
                y={box.yMin}
                width={unit}
                height={unit}
                fill={cell?.fill ? "var(--accent)" : "transparent"}
                fillOpacity={cell?.fill ? 0.14 : 1}
                stroke="var(--accent)"
                strokeWidth={scale * (showing ? 0.9 : 0.4)}
                strokeOpacity={showing ? 0.5 : 0.22}
                onPointerEnter={() => setOver(key)}
                onPointerLeave={() => setOver((was) => (was === key ? null : was))}
                /* Pressing a cell stamps whatever shape is chosen in the
                   panel into it, and pressing it again takes it out. One
                   gesture for both, so there is no eraser to go and find. */
                onPointerDown={(event) => {
                  event.stopPropagation();
                  forgeStore.stampFill(key, state.fill ?? undefined);
                }}
                data-forge-cell-box={key}
                className="cursor-crosshair"
              />
            </g>
          );
        })}
      </g>
      <g data-forge-cell-ports>
        {places.map(({ key, box, cell }) => {
          const showing = over === key;
          return PORTS.map((port) => {
            const at = portAt(port, box);
            const on = cell?.ports.includes(port) ?? false;
            if (!on && !showing) return null;
            const press = (event: React.PointerEvent) => {
              event.stopPropagation();
              forgeStore.togglePort(key, port);
            };
            return (
              <g
                key={`${key}:${port}`}
                data-forge-port={`${key}:${port}`}
                className="cursor-pointer"
              >
                {/* Twice the size, and invisible: the dot itself is five pixels
                    across at the default zoom, which is not a target. */}
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={scale * (on ? 3.4 : 2.4) * 2}
                  fill="transparent"
                  onPointerEnter={() => setOver(key)}
                  /* And the matching leave. A port is above the squares now, so
                     moving onto one takes the pointer off its own cell's
                     square and fires that square's leave — the port's enter
                     puts the cell straight back, which is the point. Without a
                     leave of its own here, the last thing to fire on the way
                     out of the grid was that enter, and the cell stayed lit
                     with all eight dots showing over a letter nothing was
                     pointing at. */
                  onPointerLeave={() => setOver((was) => (was === key ? null : was))}
                  onPointerDown={press}
                />
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={scale * (on ? 3.4 : 2.4)}
                  fill={on ? "var(--accent)" : "var(--canvas)"}
                  stroke="var(--accent)"
                  strokeWidth={scale * 0.8}
                  strokeOpacity={on ? 1 : 0.6}
                  onPointerEnter={() => setOver(key)}
                  onPointerDown={press}
                  className="pointer-events-none"
                />
                <title>{`${port} of ${key}`}</title>
              </g>
            );
          });
        })}
      </g>
    </g>
  );
}

/**
 * How long the font has to hold still before it is worth looking over.
 *
 * Longer than the store's own sixth of a second, and for a different reason:
 * that one is there so a grid is never left behind, and this one is there so a
 * pass over the whole alphabet is not started by a pause in a drag.
 */
const STILL = 600;

/**
 * How long a piece of catching-up may hold the thread before letting go of it.
 *
 * Eight milliseconds leaves half a sixty-hertz frame for everything else. It is
 * a floor rather than a ceiling -- the work is only ever put down between whole
 * letters, and a letter with a long shadow on it is seventy milliseconds all by
 * itself -- but it is the difference between a page that stutters and a page
 * that stops. Shared by the two passes that walk the font: the health check and
 * the strip catching up.
 */
const SLICE = 8;

/**
 * How often the strip shows the letters it has made so far while it catches
 * up: often enough to be seen to move, and not so often that putting four
 * hundred and fifty-two cells on the page again is most of the work.
 */
const BATCH = 120;

/** How long the letter holds still before the tool is drawn on it. */
const PROOF_WAIT = 220;

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
  /*
   * Worked out when the browser has nothing better to do, not while it has.
   *
   * The walk draws every letter in the font, at every weight the family has,
   * and asks what each one has done to itself. That is honest work for a panel
   * whose job is to name the letters that have closed up, and it is far too
   * much work to do between two frames of a drag: with a shadow switched on it
   * is fifteen seconds of arithmetic.
   *
   * It used to run whole, on every settle, and a settle was not only the end of
   * a gesture -- the store settled after a sixth of a second of quiet, so a
   * pause in the middle of a drag started the entire pass with the button still
   * down. That is where a ten-step pull of `Fillets: Size` spent most of its
   * four hundred blocked seconds.
   *
   * Now it waits for the font to hold still, and then walks it a few
   * milliseconds at a time, and is dropped if the font moves again first.
   * Nothing is lost but the promptness of a warning, and a warning that arrives
   * a moment after the letter is still a warning about the letter in front of
   * you -- whereas a slider that cannot be moved is not a slider.
   */
  /*
   * Kept with the font it was worked out for. A walk is dropped whenever the
   * font moves, so the last answer stays up until a new one arrives -- and
   * with a cut or a cast on, that can be several changes later. Shown as if
   * it were current, it named letters as closing up after the cut that closed
   * them had been switched off again. So an answer about an earlier font is
   * dimmed and said to be rechecking until the walk catches up.
   */
  const [checked, setFound] = React.useState<{ of: Forge | null; troubles: Trouble[] }>({
    of: null,
    troubles: [],
  });
  const found = checked.troubles;
  const stale = checked.of !== state.settled;
  React.useEffect(() => {
    // Not while a hand is on a control. The walk below is polite about frames,
    // but a pass that is thrown away and restarted on every one of them is
    // still the whole alphabet's worth of drawing per frame.
    if (!state.resting) return;
    let live = true;
    /*
     * Picked up again as the next task rather than at the next frame.
     *
     * Waiting for a frame between slices left the thread idle for the rest
     * of every frame: a slice is a few milliseconds and a frame sixteen, so
     * the walk ran at half speed or less on a page with nothing else to do --
     * and where a letter costs tens of milliseconds, as a cut one does, the
     * walk took two frames a letter. Firefox, slower at the booleans, took
     * longer than a test would wait for the warnings of a slotted font. A
     * task posted to a channel runs as soon as the browser has done what was
     * waiting -- input, and a frame when one is due -- so the page answers as
     * it did and the walk takes the time it costs.
     */
    const channel = new MessageChannel();
    const waited = window.setTimeout(() => {
      const walking = familyWalk(state.settled);
      // A slice short enough to fit in a frame with the drawing, so the page
      // keeps answering while the font is being looked over.
      channel.port1.onmessage = () => {
        if (!live) return;
        const until = performance.now() + SLICE;
        let step = walking.next();
        while (!step.done && performance.now() < until) step = walking.next();
        if (!live) return;
        if (step.done) setFound({ of: state.settled, troubles: step.value });
        else channel.port2.postMessage(null);
      };
      channel.port2.postMessage(null);
    }, STILL);
    return () => {
      live = false;
      window.clearTimeout(waited);
      channel.port1.onmessage = null;
      channel.port1.close();
    };
  }, [state.settled, state.resting, revision]);

  /*
   * And a check under way says so, whether or not the last one found anything.
   *
   * Only an earlier answer used to show that the letters were being looked
   * over again: starting from a font with nothing to say and switching on a
   * cut, the space under the strip stayed empty for the nine seconds the walk
   * took and then filled, which reads as the page having missed something and
   * caught up. One quiet line in the same place, under the strip, which the
   * stage does not share.
   */
  if (found.length === 0) {
    if (!stale) return null;
    return (
      <div
        className="shrink-0 border-t border-border px-4 py-2 text-2xs text-muted-foreground"
        data-forge-checking
        role="status"
        aria-busy
      >
        Checking letters…
      </div>
    );
  }
  return (
    <div
      className={cn(
        "max-h-[45%] shrink-0 overflow-y-auto border-t border-border px-4 py-2 transition-opacity",
        stale && "opacity-50",
      )}
      data-forge-warnings
      data-forge-warnings-stale={stale ? "yes" : undefined}
      aria-busy={stale}
    >
      {stale && (
        <span className="float-right text-2xs text-muted-foreground" data-forge-rechecking>
          Rechecking…
        </span>
      )}
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
                title={letter}
                // Named with the character the button shows, so what a screen
                // reader says is what is on screen; the glyph name is the title.
                aria-label={`Show ${letterLabel(letter)}`}
                data-forge-warning-letter={letter}
                className="rounded bg-card px-1 text-2xs text-foreground transition-opacity hover:opacity-70"
              >
                {letterLabel(letter)}
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

/**
 * Which of the letters are worth drawing: the ones somebody can see.
 *
 * The strip holds every glyph in the font -- four hundred and fifty-two of
 * them -- in a scrolling box that shows about a hundred and twenty-seven at a
 * time. Every one of the rest was being drawn in full on every change, and with
 * a cast switched on a letter costs several milliseconds, so nearly three
 * quarters of the most expensive work on the page was going into pictures
 * nobody was looking at.
 *
 * A letter is drawn once it has come near the box, and from then on it is
 * redrawn with the others: what this saves is the letters that have never been
 * anywhere near it, which on a font this size is most of them. Scrolling adds
 * to the set and nothing takes away from it, so a letter seen once never blanks
 * again -- there is no second pass to pay for, and nothing flickers on the way
 * back up.
 *
 * The first screenful is assumed rather than waited for. An observer only
 * reports after the browser has laid the page out, and a strip that came up
 * empty and filled in a frame later would read as a bug on every load.
 */
const FIRST_SCREEN = 128;

function useWhatIsNear(names: string[]): {
  near: ReadonlySet<string>;
  watch: (node: HTMLElement | null) => void;
} {
  const [near, setNear] = React.useState<ReadonlySet<string>>(
    () => new Set(names.slice(0, FIRST_SCREEN)),
  );
  const waiting = React.useRef<Set<string>>(new Set(names.slice(0, FIRST_SCREEN)));
  const watcher = React.useRef<IntersectionObserver | null>(null);

  if (watcher.current === null && typeof IntersectionObserver !== "undefined") {
    watcher.current = new IntersectionObserver(
      (entries) => {
        let fresh = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const name = (entry.target as HTMLElement).dataset.forgeCell;
          if (name && !waiting.current.has(name)) {
            waiting.current.add(name);
            fresh = true;
          }
          watcher.current?.unobserve(entry.target);
        }
        // One update for the whole batch, and none at all when a scroll only
        // brought back letters that had already been drawn.
        if (fresh) setNear(new Set([...waiting.current]));
      },
      /*
       * Two rows of warning, not a screen's worth.
       *
       * The margin is measured off the window, not off the strip, and the strip
       * is a fraction of the window tall -- so a screenful of margin reaches
       * many rows past it in both directions and calls most of the alphabet
       * near, which is the saving given back. Two rows is enough for a letter
       * to be ready by the time it is scrolled to.
       */
      { rootMargin: "120px 0px" },
    );
  }
  React.useEffect(() => () => watcher.current?.disconnect(), []);

  /*
   * The same function every render, on purpose.
   *
   * It is handed to four hundred and fifty-two cells as a ref, and a ref that
   * changes identity is detached and re-attached on every one of them -- which
   * is most of a render's work for a list this long, and it happens whether or
   * not anything about the cells has changed. Reading the set through a ref
   * keeps it stable without going stale.
   */
  const watch = React.useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const name = node.dataset.forgeCell;
    if (name && waiting.current.has(name)) return;
    watcher.current?.observe(node);
  }, []);

  return { near, watch };
}

/** One glyph of the strip: what to draw, and what is different about it. */
interface Cell {
  name: string;
  d: string;
  width: number;
  /**
   * The box the cell shows, grown past the ascender and descender for ink
   * that goes there. It used to be those two lines exactly, and the accents
   * of the capitals, the overshoot of an O on a face whose capitals stand at
   * the ascender, and every shadow were cut off in the strip.
   */
  frame: string;
  held: boolean;
  shaped: boolean;
  outside: boolean;
}

function cellOf(name: string, near: ReadonlySet<string>, forge: Forge): Cell {
  // A letter nobody has scrolled to yet is not drawn at all. It has an empty
  // box the right size, which is what it had while it was off screen anyway,
  // and it fills in before it arrives.
  const drawn = near.has(name) ? draw(name, forge) : null;
  const width = drawn?.advanceWidth ?? 0;
  return {
    name,
    d: drawn ? contoursToSvgPath(drawn.contours) : "",
    width,
    frame: framedIn(forge, drawn ? [{ contours: drawn.contours, x: 0 }] : [], width),
    held: isException(forge, name),
    shaped: Boolean(formOf(forge, name)),
    outside: isImported(forge, name),
  };
}

/** A viewBox on the font's shared frame, grown for ink that reaches further. */
function framedIn(forge: Forge, pieces: Placed[], width: number): string {
  const own = inkFrame(forge.style.metrics, pieces, width);
  return viewBoxOf({ ...own, ...within(reachOf(forge), own) });
}

/**
 * Whether a font has nothing cast or cut on it anywhere, so the letters the
 * strip draws for it are already the finished ones.
 *
 * Asked of the settings rather than as `unshaped(forge) === forge`, which
 * also wants the per-letter exceptions to be absent rather than empty -- and a
 * font that has ever had one has an empty table for good.
 */
function nothingShaped(forge: Forge): boolean {
  const none = (table: object | undefined) =>
    table === undefined || Object.keys(table).length === 0;
  return (
    !anyShaping(forge.cuts, forge.cast) && none(forge.cutExceptions) && none(forge.castExceptions)
  );
}

/** Near nothing: a cell made with this is an empty box the right size. */
const NOWHERE: ReadonlySet<string> = new Set();

function cellsOf(names: string[], near: ReadonlySet<string>, forge: Forge): Cell[] {
  return names.map((name) => cellOf(name, near, forge));
}

/** Every glyph in the font, small, so a change can be seen spreading. */
function Alphabet({ names, selected }: { names: string[]; selected: string }): React.JSX.Element {
  const state = useForge();
  /*
   * Four hundred and fifty-two letters, so this is where a drag is won or lost.
   *
   * Measured on the draw page with `Fillets` switched on: one ten-step pull of
   * its `Size` slider drew five thousand letters and spent seventeen of its
   * twenty-two seconds inside the shaping layers, nearly all of it here. The
   * strip follows the settled font, which is meant to keep it out of a drag
   * altogether -- but the store used to settle in any pause, and with a cast on
   * every frame is a pause, so it redrew the whole alphabet on every one.
   *
   * Both halves of that are fixed now, and this is the second: the strip holds
   * the last font it was shown at rest and catches up when the hand comes off.
   * That is what following `settled` rather than the live document was always
   * meant to buy -- the timer was quietly taking it back.
   */
  const held = React.useRef(state.settled);
  if (state.resting) held.current = state.settled;
  const settled = held.current;
  const { near, watch } = useWhatIsNear(names);

  /*
   * A font with nothing cast or cut on it is drawn straight from the newest
   * settled font, a few letters at a time, rather than held for the hand.
   *
   * The hold above is there for the layers: putting a cast back on the
   * alphabet in a pause is what made a drag stall. Without any there is
   * nothing to put back, only the letters -- and holding those too is what
   * left the strip about two seconds behind the stage on a step of the weight
   * slider from the keyboard, which never says it has finished: a sixth of a
   * second of quiet, then the second and a fifth before a run nobody closed
   * is given up for over, then the whole first screen drawn in one go.
   *
   * So the letters follow `settled`, which moves in any pause, and are made
   * in the same short slices as the shapes below, so the work never holds the
   * page and stops the moment the font moves on. Letters the font already
   * drew for the stage or the specimen come out of the drawing cache. A font
   * with layers on it keeps the hold and everything below, unchanged.
   */
  const latest = state.settled;
  const draftable = nothingShaped(latest);
  const [draft, setDraft] = React.useState<{
    of: Forge;
    cells: ReadonlyMap<string, Cell>;
  } | null>(() =>
    draftable
      ? {
          of: latest,
          cells: new Map(cellsOf(names, near, latest).map((cell) => [cell.name, cell])),
        }
      : null,
  );
  const draftNow = React.useRef(draft);
  draftNow.current = draft;
  /*
   * And set down again the moment the hand moves on. A pause in a drag
   * settles the font as well, and drafting a font the hand has already left
   * only takes the frames the next step of the drag wanted.
   */
  const moving = state.forge !== latest;
  React.useEffect(() => {
    if (!draftable || moving) return;
    // What was made for this font already is kept, as the shapes below keep
    // theirs, except a letter that was far then and is near now.
    const made = new Map<string, Cell>();
    const was = draftNow.current;
    if (was?.of === latest)
      for (const [name, cell] of was.cells) if (cell.d || !near.has(name)) made.set(name, cell);
    const order = [
      ...names.filter((name) => near.has(name) && !made.has(name)),
      ...names.filter((name) => !near.has(name) && !made.has(name)),
    ];
    if (order.length === 0) {
      if (was?.of !== latest) setDraft({ of: latest, cells: made });
      return;
    }
    let at = 0;
    let live = true;
    let shown = performance.now();
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (!live) return;
      const until = performance.now() + SLICE;
      while (at < order.length && performance.now() < until) {
        const name = order[at++];
        made.set(name, cellOf(name, near, latest));
      }
      const done = at >= order.length;
      if (done || performance.now() - shown >= BATCH) {
        shown = performance.now();
        setDraft({ of: latest, cells: new Map(made) });
      }
      if (!done) channel.port2.postMessage(null);
    };
    channel.port2.postMessage(null);
    return () => {
      live = false;
      channel.port1.onmessage = null;
      channel.port1.close();
    };
  }, [draftable, moving, latest, near, names]);

  // Without the layers, which is what the strip shows the instant a change
  // lands. Cheap enough to work out in a render: a letter with nothing cast on
  // it is a handful of contours and a short path. Not wanted at all while the
  // letters come from the draft above.
  const plain = React.useMemo(
    () => (draftable ? [] : cellsOf(names, near, unshaped(settled))),
    [draftable, names, near, settled],
  );
  /*
   * The shapes arrive a few frames after the letters do.
   *
   * Even scoped to what is on screen, putting the cast back on a hundred and
   * twenty-seven letters at once is a single stretch of work seconds long:
   * measured on the draw page, letting go of `Shadow: How far` froze the window
   * for six and a half seconds and `Rim: Thickness` for five and three
   * quarters. All of it in one task, so nothing could be clicked and nothing
   * repainted until it finished.
   *
   * So the strip shows the plain letters at once and builds the shaped ones a
   * few milliseconds at a time in the frames after, swapping the lot in when
   * the last is ready. A whole cell is made at a time -- drawn, measured and
   * spelled out as a path -- so the render that follows does no drawing at all
   * and cannot become a long task of its own however the cache happens to
   * stand.
   *
   * The page stays answerable the whole way through, and nothing is lost but
   * the promptness of a shadow on a picture nine pixels across.
   */
  /*
   * The letters made for the font the strip is showing, as they come.
   *
   * Handed over in batches rather than all at once at the end. Waiting for the
   * last letter kept every other one as it was before the change: switching
   * on Slots cut the letter on the stage at once and left the strip uncut for
   * five seconds, which reads as the strip disagreeing with the stage rather
   * than as a picture being redrawn. A batch goes up every tenth of a second or
   * so, the letters in sight first, and the rest wait their turn marked as
   * waiting.
   */
  const [ripe, setRipe] = React.useState<{
    of: Forge;
    cells: ReadonlyMap<string, Cell>;
  } | null>(null);
  const ripeNow = React.useRef(ripe);
  ripeNow.current = ripe;
  React.useEffect(() => {
    // The draft above is drawing this font, and it has no shapes to wait for.
    if (draftable) return;
    // Nothing to put back on, so what is drawn already is the finished thing.
    // Asked for rather than assigned, because this runs again whenever the
    // visible set grows, and an answer that has not changed should not cost a
    // render of four hundred and fifty-two cells to say so.
    if (unshaped(settled) === settled) {
      setRipe((was) =>
        was?.of === settled && was.cells.size === plain.length
          ? was
          : { of: settled, cells: new Map(plain.map((cell) => [cell.name, cell])) },
      );
      return;
    }
    /*
     * What was made for this font already is kept -- this runs again when a
     * scroll brings more letters near -- except a letter that was far then and
     * is near now, which was made as an empty box and has to be drawn.
     */
    const made = new Map<string, Cell>();
    if (ripeNow.current?.of === settled)
      for (const [name, cell] of ripeNow.current.cells)
        if (cell.d || !near.has(name)) made.set(name, cell);
    const order = [
      ...names.filter((name) => near.has(name) && !made.has(name)),
      ...names.filter((name) => !near.has(name) && !made.has(name)),
    ];
    if (order.length === 0) return;
    let at = 0;
    let live = true;
    let shown = performance.now();
    /*
     * Picked up again as the next task rather than at the next frame, as the
     * health check below is: waiting for a frame between slices left the
     * thread idle for the rest of every frame, and a cut letter that costs
     * tens of milliseconds took a frame of its own.
     */
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (!live) return;
      const until = performance.now() + SLICE;
      while (at < order.length && performance.now() < until) {
        const name = order[at++];
        made.set(name, cellOf(name, near, settled));
      }
      const done = at >= order.length;
      if (done || performance.now() - shown >= BATCH) {
        shown = performance.now();
        setRipe({ of: settled, cells: new Map(made) });
      }
      if (!done) channel.port2.postMessage(null);
    };
    channel.port2.postMessage(null);
    return () => {
      live = false;
      channel.port1.onmessage = null;
      channel.port1.close();
    };
  }, [draftable, settled, near, names, plain]);
  /*
   * The best each letter has, and whether it is the letter as it now stands.
   *
   * Falling back to the plain letters wholesale looked wrong in a way the
   * timings did not show: change one setting and for the better part of a
   * second every letter in the font lost its cuts and then got them back. That
   * reads as the cuts having been switched off, not as a picture being
   * redrawn -- and it is worse than useless when the change was to one letter,
   * because the other four hundred and fifty-one flicker for no reason at all.
   *
   * So a letter that already had a shape keeps it until its new one is ready,
   * and only a letter that has none -- one being scrolled to for the first
   * time -- shows the plain drawing while it waits. Either way a letter that
   * is not yet the letter as it now stands is dimmed and marked as waiting, so
   * the strip never passes off an old picture as the font.
   */
  const shown = React.useRef<ReadonlyMap<string, Cell>>(new Map());
  const cells = React.useMemo(() => {
    /*
     * Drawn from the draft: a letter it has made for the newest font is that
     * letter, and one it has not got to yet keeps what it showed, dimmed. A
     * letter never shown at all is an empty box the right size, which is what
     * it was off screen.
     */
    if (draftable) {
      const fresh = draft?.of === latest ? draft.cells : null;
      return names.map((name) => {
        const cell = fresh?.get(name);
        if (cell) return { cell, waiting: false };
        return { cell: shown.current.get(name) ?? cellOf(name, NOWHERE, latest), waiting: true };
      });
    }
    // Nothing cast or cut, and the plain letters are the letters.
    if (unshaped(settled) === settled) return plain.map((cell) => ({ cell, waiting: false }));
    const current = ripe?.of === settled ? ripe.cells : null;
    return plain.map((cell) => {
      const fresh = current?.get(cell.name);
      if (fresh) return { cell: fresh, waiting: false };
      const was = shown.current.get(cell.name);
      return { cell: was?.d ? was : cell, waiting: true };
    });
  }, [draftable, draft, latest, names, ripe, settled, plain]);
  React.useEffect(() => {
    shown.current = new Map(cells.map(({ cell }) => [cell.name, cell]));
  }, [cells]);
  const waiting = cells.some((one) => one.waiting);

  /*
   * The cells made once for what they show, not again on every change to the
   * font while the strip holds still. It follows the settled font, so during a
   * drag nothing in it changes -- but it was built afresh, four hundred and
   * fifty-two buttons, on every frame of the drag all the same, and in a
   * development build that was the largest single cost of a step of the
   * weight slider.
   */
  const letters = React.useMemo(
    () => (
      <div className="flex flex-wrap gap-1.5">
        {cells.map(({ cell, waiting: behind }) => (
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
            data-forge-cell-waiting={behind ? "yes" : undefined}
            ref={watch}
            className={tile(
              cell.name === selected,
              cn(
                "relative flex size-14 items-center justify-center rounded-md border",
                behind && "opacity-40",
              ),
            )}
          >
            {/* A size larger than it was: the frame is the whole font's reach now,
                accents and tails included, and a cell drawn at the old size
                showed every letter a quarter smaller. */}
            <svg viewBox={cell.frame} className="h-11 w-11" aria-hidden>
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
                the family the way the other two are — it has left it, and no
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
    ),
    [cells, selected, watch],
  );

  return (
    <div
      className="toolcraft-scrollbar relative min-h-0 flex-1 overflow-y-auto p-3"
      data-forge-strip
      data-forge-strip-updating={waiting ? "yes" : undefined}
      aria-busy={waiting}
    >
      {/* Held at the top as the strip scrolls, and taking no room in it: a
          note that pushed the letters about would move the one being aimed
          at. */}
      {waiting && (
        <div className="pointer-events-none sticky top-0 z-10 h-0">
          <span
            className="absolute -top-2 right-0 rounded bg-card px-1.5 py-0.5 text-2xs text-muted-foreground shadow-sm"
            data-forge-strip-note
          >
            Updating letters…
          </span>
        </div>
      )}
      {letters}
    </div>
  );
}

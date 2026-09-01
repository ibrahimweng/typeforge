/**
 * The traced letter on screen, with what it was traced from underneath it.
 *
 * One large letter and a line of type below it, and both are needed. The letter
 * is where a stroke can be seen to swell or taper; the line is where a change to
 * the hand can be judged, because weight and slant and taper are decisions about
 * how a word sits together and nothing about one letter shows that.
 *
 * The source outline is drawn under the redrawing rather than beside it. Side by
 * side, a difference of a few units is invisible; laid on top of each other, it
 * is the only thing you can see -- which is the useful arrangement when the
 * question is how far a slider has taken the letter from where it started.
 */

import * as React from "react";

import { contoursToSvgPath } from "@/font/geometry";
import { alongSpine, walkOf } from "@/quill/curve";
import { restyle } from "@/quill/controls";
import { drawTraced, useQuill, type Traced } from "@/state/useQuill";

const SPECIMEN = "handwriting";

export function QuillView(): React.JSX.Element {
  const state = useQuill();
  const { document: doc } = state;
  const traced = doc.letters.find((one) => one.glyph.name === state.letter) ?? doc.letters[0];

  if (!traced) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h2 className="text-sm font-medium">Nothing traced yet</h2>
          <p className="pt-2 text-2xs leading-relaxed text-muted-foreground">
            Read a font from the panel and every letter in it is taken apart into the strokes that
            drew it: where each one runs, and how wide the pen was at each point along it. From
            there the whole alphabet answers to one hand — heavier, more pressure, more taper,
            further slanted — rather than to a thousand separate points.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="toolcraft-scrollbar h-full overflow-auto p-6">
      <Large traced={traced} />
      <Line traced={traced} />
    </div>
  );
}

/** The letter, big, with its source under it and its skeleton over it. */
function Large({ traced }: { traced: Traced }): React.JSX.Element {
  const state = useQuill();
  const em = state.document.unitsPerEm;
  const drawn = React.useMemo(
    () => drawTraced(traced, state.document.style),
    [traced, state.document.style, state.revision],
  );

  const spines = React.useMemo(() => {
    if (!state.showSpines) return null;
    const moved = restyle(traced.glyph, state.document.style);
    return moved.strokes.map((stroke, index) => {
      const walk = walkOf(stroke.spine);
      const points: string[] = [];
      for (let step = 0; step <= 72; step++) {
        const { point } = alongSpine(stroke.spine, walk, step / 72);
        points.push(`${point.x.toFixed(1)},${point.y.toFixed(1)}`);
      }
      return (
        <polyline
          key={index}
          points={points.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={em / 160}
          strokeLinecap="round"
          opacity={0.85}
        />
      );
    });
  }, [traced, state.document.style, state.showSpines, em, state.revision]);

  const top = em * 1.05;
  const bottom = -em * 0.36;
  const width = Math.max(drawn.advanceWidth, em * 0.4);

  return (
    <div className="flex justify-center">
      <svg
        viewBox={`${-em * 0.06} ${bottom} ${width + em * 0.12} ${top - bottom}`}
        className="h-[54vh] w-auto"
        style={{ transform: "scaleY(-1)" }}
        role="img"
        aria-label={`The letter ${traced.glyph.name}`}
        data-quill-stage={traced.glyph.name}
      >
        {/* The lines the letter was written between, so the eye has something
            fixed to judge the slant and the height against. */}
        <line
          x1={-em * 0.06}
          y1={0}
          x2={width + em * 0.06}
          y2={0}
          stroke="var(--border)"
          strokeWidth={em / 400}
        />
        {state.showSource && (
          <path d={contoursToSvgPath(traced.source)} fill="var(--muted-foreground)" opacity={0.22} />
        )}
        <path d={contoursToSvgPath(drawn.contours)} fill="currentColor" fillRule="nonzero" />
        {spines}
      </svg>
    </div>
  );
}

/**
 * A line of type, which is what a change to the hand is actually judged on.
 *
 * Set from the letters that were traced rather than from a fixed word, because
 * a font read in may not have every letter of anything -- and a specimen with
 * gaps in it says less than a shorter one without.
 */
function Line({ traced }: { traced: Traced }): React.JSX.Element {
  const state = useQuill();
  const em = state.document.unitsPerEm;

  const { letters, width } = React.useMemo(() => {
    const have = new Map(state.document.letters.map((one) => [one.glyph.name, one]));
    const wanted = SPECIMEN.split("").filter((one) => have.has(one));
    const shown =
      wanted.length >= 4 ? wanted : state.document.letters.slice(0, 8).map((one) => one.glyph.name);
    let x = 0;
    const placed: Array<{ key: string; at: number; d: string }> = [];
    for (const [index, name] of shown.entries()) {
      const one = have.get(name);
      if (!one) continue;
      const drawn = drawTraced(one, state.document.style);
      const d = contoursToSvgPath(drawn.contours);
      if (d) placed.push({ key: `${name}-${index}`, at: x, d });
      x += drawn.advanceWidth;
    }
    return { letters: placed, width: Math.max(x, em) };
  }, [state.document.letters, state.document.style, state.revision, em, traced]);

  return (
    <div className="pt-6">
      <svg
        viewBox={`0 ${-em * 0.34} ${width} ${em * 1.28}`}
        className="w-full"
        style={{ transform: "scaleY(-1)" }}
        role="img"
        aria-label="A line of the traced letters"
      >
        <line x1={0} y1={0} x2={width} y2={0} stroke="var(--border)" strokeWidth={em / 500} />
        <g fill="currentColor" fillRule="nonzero">
          {letters.map((one) => (
            <path key={one.key} transform={`translate(${one.at} 0)`} d={one.d} />
          ))}
        </g>
      </svg>
    </div>
  );
}

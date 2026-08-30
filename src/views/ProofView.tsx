/**
 * The font as text, at the size text is actually read at.
 *
 * Everything else here shows a letter big, or a word big, or a table of
 * numbers. All of it is necessary and none of it is proofing: the faults that
 * matter in a text face are invisible at three hundred points and obvious at
 * eleven. A stem a shade too heavy reads as a grey patch in a paragraph and as
 * nothing at all on a canvas; spacing that is nearly even reads as a rhythm
 * that limps, and only over several lines. A specimen line cannot show either,
 * because both are properties of a block of text rather than of a word.
 *
 * So this is a page of real text, wrapped, with the size, the line height and
 * the letter-spacing where they can be reached. It draws the outlines rather
 * than installing the font, which is what makes it honest while the work is
 * still open -- an installed font is the one on disk, and the point of proofing
 * is to see the one on screen.
 */

import * as React from "react";

import { contoursToPath2D } from "@/font/geometry";
import { resolveAdvanceWidth, resolveGlyphContours } from "@/font/transform";
import type { Glyph, Typeface } from "@/font/types";
import { prepareCanvas, readToken } from "@/components/glyph-render";
import { GroundToggle } from "@/components/GroundToggle";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

/*
 * What it opens with, and why this rather than a pangram.
 *
 * A pangram proves every letter exists and proves nothing about how they sit
 * together, because no real sentence has that distribution. What a proof needs
 * is ordinary text: common letters at their common frequencies, in the pairs
 * they actually occur in, long enough to see a rhythm. Any paragraph of prose
 * does that; this one is about the thing being made, which saves explaining
 * why a font specimen is talking about foxes.
 */
const OPENING = `Type is read in paragraphs, so it is judged in paragraphs. A stem a shade too heavy reads as a grey patch here and as nothing at all on a canvas; spacing that is nearly even reads as a rhythm that limps, and only over several lines. Set the size down to eleven or twelve and look at the colour of the block rather than at any single letter. Squint, if it helps — most of what is wrong with a text face shows up first as an unevenness you can see and cannot name.`;

interface Placed {
  glyph: Glyph;
  x: number;
  line: number;
}

/**
 * The text broken into lines that fit, in font units.
 *
 * Wrapped at word boundaries by measuring, rather than by counting characters:
 * a font whose `m` is three times its `i` has no character count that means
 * anything, and the whole point of this view is that the measurements are the
 * font's own.
 */
function layout(
  typeface: Typeface,
  text: string,
  widthInUnits: number,
  tracking: number,
): { placed: Placed[]; lines: number } {
  const byCodepoint = new Map<number, Glyph>();
  for (const glyph of typeface.glyphs) {
    for (const codepoint of glyph.unicodes) {
      if (!byCodepoint.has(codepoint)) byCodepoint.set(codepoint, glyph);
    }
  }

  const placed: Placed[] = [];
  let line = 0;
  let pen = 0;

  for (const paragraph of text.split("\n")) {
    for (const word of paragraph.split(/(\s+)/)) {
      if (word === "") continue;
      const isSpace = /^\s+$/.test(word);

      // Measured before it is placed, so a word that will not fit starts the
      // next line whole rather than breaking across two.
      let width = 0;
      let previous: Glyph | null = null;
      const run: Glyph[] = [];
      for (const character of word) {
        const glyph = byCodepoint.get(character.codePointAt(0)!);
        if (!glyph) continue;
        if (previous) width += store.resolvedKerning(previous.name, glyph.name).value;
        width += resolveAdvanceWidth(glyph, typeface) + tracking;
        run.push(glyph);
        previous = glyph;
      }
      if (run.length === 0) continue;

      // A space that falls at the end of a line is dropped rather than carried,
      // which is what stops a ragged edge drifting further right every line.
      if (!isSpace && pen > 0 && pen + width > widthInUnits) {
        line += 1;
        pen = 0;
      }
      if (isSpace && pen === 0) continue;

      let previousInRun: Glyph | null = null;
      for (const glyph of run) {
        if (previousInRun) pen += store.resolvedKerning(previousInRun.name, glyph.name).value;
        placed.push({ glyph, x: pen, line });
        pen += resolveAdvanceWidth(glyph, typeface) + tracking;
        previousInRun = glyph;
      }
    }
    line += 1;
    pen = 0;
  }

  return { placed, lines: line };
}

export function ProofView(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;

  const [text, setText] = React.useState(OPENING);
  const [size, setSize] = React.useState(14);
  const [leading, setLeading] = React.useState(1.45);
  const [tracking, setTracking] = React.useState(0);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(760);

  const observerRef = React.useRef<ResizeObserver | null>(null);
  const measure = React.useCallback((element: HTMLDivElement | null) => {
    boxRef.current = element;
    observerRef.current?.disconnect();
    if (!element) return;
    const read = () => setWidth(element.clientWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  const em = typeface?.unitsPerEm ?? 1000;
  const scale = size / em;
  /*
   * The margin inside the page, in screen pixels.
   *
   * Held here rather than in the layout so the canvas is exactly as wide as
   * the page it sits in. Measuring the padded parent and drawing as though it
   * were the content box is what made the first version run its lines out past
   * the right-hand edge and get clipped: the canvas was forty-eight pixels
   * wider than the white it was drawn on.
   */
  const MARGIN = 32;
  const columnWidth = Math.max(240, width - MARGIN * 2);

  const { placed, lines } = React.useMemo(() => {
    if (!typeface) return { placed: [], lines: 0 };
    return layout(typeface, text, columnWidth / scale, tracking * (em / 1000));
  }, [typeface, text, columnWidth, scale, tracking, em, state.revision]);

  const lineHeight = size * leading;
  const height = Math.max(200, Math.ceil((lines + 1) * lineHeight) + 48);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !typeface) return;
    const context = prepareCanvas(canvas, width, height);
    if (!context) return;

    context.fillStyle = readToken("--glyph-fill", "#eeeeee", canvas);
    for (const one of placed) {
      const contours = resolveGlyphContours(one.glyph, typeface);
      if (contours.length === 0) continue;
      context.save();
      context.translate(MARGIN + one.x * scale, MARGIN + (one.line + 1) * lineHeight);
      context.scale(scale, -scale);
      context.fill(contoursToPath2D(contours), "nonzero");
      context.restore();
    }
    /*
     * Redrawn when the ground changes, which is not obvious from this list.
     *
     * The colour comes from `readToken`, which reads a custom property rather
     * than taking a prop -- so nothing in the dependencies changes when the
     * ground does, and the first version of this drew near-white letters on
     * the new white page. `state.ground` is named here to say that the paint
     * depends on it even though the pixels do not pass through it.
     */
  }, [typeface, placed, scale, lineHeight, width, height, state.revision, state.ground]);

  if (!typeface) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-2xs text-muted-foreground">Open a font to proof it.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-4 py-2 text-2xs"
        data-print-away
      >
        <Dial label="Size" value={size} min={6} max={72} step={1} onChange={setSize} suffix="px" />
        <Dial
          label="Line height"
          value={leading}
          min={0.9}
          max={2.4}
          step={0.05}
          onChange={setLeading}
        />
        <Dial
          label="Tracking"
          value={tracking}
          min={-40}
          max={120}
          step={1}
          onChange={setTracking}
          suffix="/1000"
        />
        <span className="ml-auto flex items-center gap-3">
          <span className="text-muted-foreground">
            Drawn from the outlines on screen, not from an installed font.
          </span>
          <GroundToggle />
          {/*
            The proofing advice every type designer gives is about paper:
            print it, look at it away from the screen, put it on a wall. A
            screen shows a letter lit from behind at seventy-two pixels to the
            inch and paper shows it lit from the front at three hundred, which
            is why a face that looks even on a monitor can look blotchy in a
            book. Until now this view could only be looked at.
          */}
          <button
            type="button"
            onClick={() => window.print()}
            data-print-proof
            title="Print this proof, or save it as a PDF. The page comes out on white with none of the controls on it."
            className="rounded border border-border px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Print
          </button>
        </span>
      </div>

      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto" data-proof-sheet>
        <div className="mx-auto max-w-4xl px-6 py-6">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Proof text"
            data-proof-text
            data-print-away
            rows={3}
            className="mb-5 w-full resize-y rounded-md border border-input bg-card p-3 text-2xs leading-relaxed text-foreground outline-none focus-visible:border-accent"
          />
          <div
            ref={measure}
            data-ground={state.ground}
            className="overflow-hidden rounded-md"
            style={{ background: "var(--canvas)" }}
            data-proof-page
          >
            <canvas ref={canvasRef} style={{ width, height }} className="block" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One labelled slider, with its value shown as a number you can read. */
function Dial({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  suffix?: string;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn("h-1 w-28 cursor-pointer appearance-none rounded-full bg-border", "accent-[color:var(--accent)]")}
      />
      <span className="w-14 tabular-nums text-foreground">
        {step < 1 ? value.toFixed(2) : value}
        {suffix ? <span className="pl-0.5 text-muted-foreground">{suffix}</span> : null}
      </span>
    </label>
  );
}

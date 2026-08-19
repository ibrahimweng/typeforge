/**
 * Kerning: adjusting the space between specific pairs of letters.
 *
 * Kerning is judged by eye, not by number, so the preview text is the control.
 * Click the gap between two letters to select that pair, then drag left or
 * right to tighten or open it. The whole line reflows as you drag.
 */

import * as React from "react";

import { tweenNumber } from "@/anim/motion";
import { drawGlyph, prepareCanvas, readToken, type GlyphView } from "@/components/glyph-render";
import { resolveAdvanceWidth } from "@/font/transform";
import type { Glyph, Typeface } from "@/font/types";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

interface PlacedGlyph {
  glyph: Glyph;
  /** Pen position before this glyph, in font units. */
  x: number;
  /** Kerning applied between the previous glyph and this one. */
  kern: number;
}

export function KerningView(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 900, height: 260 });
  const [selectedPair, setSelectedPair] = React.useState<{ left: string; right: string } | null>(null);
  const dragRef = React.useRef<{ startX: number; startValue: number } | null>(null);
  const [pairFilter, setPairFilter] = React.useState("");

  React.useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  const placed = React.useMemo(
    () => layoutText(typeface, state.previewText),
    [typeface, state.previewText, state.revision],
  );

  // Scale the preview so the whole line fits with room to spare.
  const view = React.useMemo<GlyphView>(() => {
    if (!typeface || placed.length === 0) return { scale: 1, originX: 0, originY: 0 };
    const totalWidth =
      placed[placed.length - 1].x + resolveAdvanceWidth(placed[placed.length - 1].glyph, typeface);
    const scale = Math.min(
      (size.width - 80) / Math.max(1, totalWidth),
      (size.height * 0.5) / Math.max(1, typeface.metrics.ascender - typeface.metrics.descender),
    );
    return { scale, originX: 40, originY: size.height * 0.72 };
  }, [typeface, placed, size]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !typeface) return;
    const context = prepareCanvas(canvas, size.width, size.height);
    if (!context) return;

    // Baseline, for reference while judging the fit.
    const baselineY = Math.round(view.originY) + 0.5;
    context.strokeStyle = readToken("--guide-metric", "#5a6070");
    context.globalAlpha = 0.35;
    context.beginPath();
    context.moveTo(0, baselineY);
    context.lineTo(size.width, baselineY);
    context.stroke();
    context.globalAlpha = 1;

    for (const item of placed) {
      drawGlyph(context, item.glyph, typeface, view, { offsetX: item.x });
    }

    // Mark the gap of the selected pair.
    if (selectedPair) {
      const index = placed.findIndex(
        (item, i) =>
          i > 0 &&
          placed[i - 1].glyph.name === selectedPair.left &&
          item.glyph.name === selectedPair.right,
      );
      if (index > 0) {
        const gapX = view.originX + placed[index].x * view.scale;
        context.strokeStyle = readToken("--node-selected", "#f5a524");
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(gapX, view.originY - typeface.metrics.ascender * view.scale);
        context.lineTo(gapX, view.originY - typeface.metrics.descender * view.scale);
        context.stroke();
      }
    }
  }, [typeface, placed, view, size, selectedPair, state.revision]);

  const pairs = React.useMemo(() => {
    if (!typeface) return [];
    const query = pairFilter.trim().toLowerCase();
    const list = query
      ? typeface.kerning.filter(
          (pair) =>
            pair.left.toLowerCase().includes(query) || pair.right.toLowerCase().includes(query),
        )
      : typeface.kerning;
    return [...list].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 400);
  }, [typeface, pairFilter, state.revision]);

  if (!typeface) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs-plus text-muted-foreground">
        Open a font to adjust its kerning.
      </div>
    );
  }

  const currentValue = selectedPair ? store.kerningFor(selectedPair.left, selectedPair.right) : 0;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <input
            value={state.previewText}
            onChange={(event) => store.setPreviewText(event.target.value)}
            placeholder="Type text to kern"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-xs-plus outline-none focus-visible:border-accent"
            aria-label="Preview text"
          />
          <span className="shrink-0 text-2xs text-muted-foreground">
            Click a gap, then drag or use the arrow keys
          </span>
        </div>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 bg-[var(--canvas)]"
          onPointerDown={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const pair = pairAtPosition(placed, view, event.clientX - rect.left);
            if (!pair) return;
            setSelectedPair(pair);
            dragRef.current = {
              startX: event.clientX,
              startValue: store.kerningFor(pair.left, pair.right),
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || !selectedPair) return;
            // Convert the drag distance back into font units so the movement
            // matches what the letters do on screen.
            const delta = (event.clientX - drag.startX) / Math.max(view.scale, 0.0001);
            store.setKerningLive(
              selectedPair.left,
              selectedPair.right,
              Math.round(drag.startValue + delta),
            );
          }}
          onPointerUp={() => {
            const drag = dragRef.current;
            dragRef.current = null;
            if (!drag || !selectedPair) return;
            const finalValue = store.kerningFor(selectedPair.left, selectedPair.right);
            if (finalValue !== drag.startValue) {
              store.setKerningLive(selectedPair.left, selectedPair.right, drag.startValue);
              store.setKerning(selectedPair.left, selectedPair.right, finalValue);
            }
          }}
        >
          <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} />
        </div>

        {selectedPair && (
          <PairEditor
            left={selectedPair.left}
            right={selectedPair.right}
            value={currentValue}
            unitsPerEm={typeface.unitsPerEm}
          />
        )}
      </div>

      <aside className="flex w-72 shrink-0 flex-col border-l border-border">
        <div className="border-b border-border px-3 py-2.5">
          <input
            value={pairFilter}
            onChange={(event) => setPairFilter(event.target.value)}
            placeholder="Filter pairs"
            className="h-7 w-full rounded-md border border-input bg-card px-2 text-2xs outline-none focus-visible:border-accent"
            aria-label="Filter kerning pairs"
          />
          <p className="pt-2 text-2xs text-muted-foreground tabular-nums">
            {typeface.kerning.length.toLocaleString()} pairs
          </p>
        </div>
        <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
          {pairs.map((pair) => (
            <button
              key={`${pair.left}/${pair.right}`}
              type="button"
              onClick={() => setSelectedPair({ left: pair.left, right: pair.right })}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-left text-2xs hover:bg-card",
                selectedPair?.left === pair.left &&
                  selectedPair?.right === pair.right &&
                  "bg-card text-accent",
              )}
            >
              <span className="truncate font-mono">
                {pair.left} / {pair.right}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{pair.value}</span>
            </button>
          ))}
          {pairs.length === 0 && (
            <p className="px-3 py-6 text-center text-2xs text-muted-foreground">No pairs yet.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function PairEditor({
  left,
  right,
  value,
  unitsPerEm,
}: {
  left: string;
  right: string;
  value: number;
  unitsPerEm: number;
}): React.JSX.Element {
  const [display, setDisplay] = React.useState(value);
  const previous = React.useRef(value);

  React.useEffect(() => {
    tweenNumber(previous.current, value, setDisplay);
    previous.current = value;
  }, [value]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowLeft" ? -1 : 1);
      store.setKerning(left, right, store.kerningFor(left, right) + step);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [left, right]);

  // Kerning is conventionally read as thousandths of an em, which is
  // comparable across fonts of different unit sizes.
  const perMille = Math.round((value / unitsPerEm) * 1000);

  return (
    <div className="flex items-center gap-4 border-t border-border px-4 py-2.5">
      <span className="font-mono text-xs-plus">
        {left} <span className="text-muted-foreground">/</span> {right}
      </span>
      <input
        type="number"
        value={Math.round(display)}
        onChange={(event) => store.setKerning(left, right, Number(event.target.value) || 0)}
        className="h-7 w-24 rounded-md border border-input bg-card px-2 text-xs-plus tabular-nums outline-none focus-visible:border-accent"
        aria-label={`Kerning between ${left} and ${right}`}
      />
      <span className="text-2xs text-muted-foreground tabular-nums">
        {perMille > 0 ? "+" : ""}
        {perMille}/1000 em
      </span>
      {value !== 0 && (
        <button
          type="button"
          onClick={() => store.setKerning(left, right, 0)}
          className="ml-auto text-2xs text-muted-foreground hover:text-foreground"
        >
          Remove pair
        </button>
      )}
    </div>
  );
}

/** Lay out a string, applying each pair's kerning as it goes. */
function layoutText(typeface: Typeface | null, text: string): PlacedGlyph[] {
  if (!typeface) return [];
  const byCodepoint = new Map<number, Glyph>();
  for (const glyph of typeface.glyphs) {
    for (const codepoint of glyph.unicodes) {
      if (!byCodepoint.has(codepoint)) byCodepoint.set(codepoint, glyph);
    }
  }

  const placed: PlacedGlyph[] = [];
  let pen = 0;
  let previous: Glyph | null = null;

  for (const character of text) {
    const glyph = byCodepoint.get(character.codePointAt(0)!);
    if (!glyph) continue;
    const kern = previous ? store.kerningFor(previous.name, glyph.name) : 0;
    pen += kern;
    placed.push({ glyph, x: pen, kern });
    pen += resolveAdvanceWidth(glyph, typeface);
    previous = glyph;
  }
  return placed;
}

/** Which pair's gap is nearest a click along the preview line. */
function pairAtPosition(
  placed: PlacedGlyph[],
  view: GlyphView,
  canvasX: number,
): { left: string; right: string } | null {
  let best: { left: string; right: string } | null = null;
  let bestDistance = Infinity;
  for (let i = 1; i < placed.length; i++) {
    const gapX = view.originX + placed[i].x * view.scale;
    const distance = Math.abs(gapX - canvasX);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { left: placed[i - 1].glyph.name, right: placed[i].glyph.name };
    }
  }
  // Ignore clicks far from any gap, so an accidental click does not select one.
  return bestDistance <= 60 ? best : null;
}

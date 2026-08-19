/**
 * Spacing: the white space on each side of a letter.
 *
 * Spacing is what makes text read evenly, and it is judged across many letters
 * at once rather than one at a time. This view is a table so values can be
 * compared down a column, with a preview strip above showing the letters in
 * their actual rhythm.
 */

import * as React from "react";

import { contoursBounds } from "@/font/geometry";
import { resolveAdvanceWidth, resolveGlyphContours } from "@/font/transform";
import { drawGlyph, glyphLabel, prepareCanvas, type GlyphView } from "@/components/glyph-render";
import type { Glyph, Typeface } from "@/font/types";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

interface Row {
  glyph: Glyph;
  left: number;
  right: number;
  advance: number;
}

export function MetricsView(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;
  const [filter, setFilter] = React.useState("");

  const rows = React.useMemo<Row[]>(() => {
    if (!typeface) return [];
    const query = filter.trim().toLowerCase();
    return typeface.glyphs
      .filter((glyph) => {
        if (glyph.contours.length === 0) return false;
        if (!query) return true;
        if (query.length === 1 && glyph.unicodes.includes(query.codePointAt(0)!)) return true;
        return glyph.name.toLowerCase().includes(query);
      })
      .slice(0, 500)
      .map((glyph) => {
        const contours = resolveGlyphContours(glyph, typeface);
        const bounds = contoursBounds(contours);
        const advance = resolveAdvanceWidth(glyph, typeface);
        return {
          glyph,
          left: Math.round(bounds.xMin),
          right: Math.round(advance - bounds.xMax),
          advance: Math.round(advance),
        };
      });
  }, [typeface, filter, state.revision]);

  if (!typeface) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs-plus text-muted-foreground">
        Open a font to adjust its spacing.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SpacingPreview typeface={typeface} revision={state.revision} text={state.previewText} />

      <div className="flex items-center gap-3 border-y border-border px-4 py-2.5">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter glyphs"
          className="h-8 w-56 rounded-md border border-input bg-card px-2.5 text-xs-plus outline-none focus-visible:border-accent"
          aria-label="Filter glyphs"
        />
        <span className="text-2xs text-muted-foreground tabular-nums">
          {rows.length.toLocaleString()} shown
        </span>
        <span className="ml-auto text-2xs text-muted-foreground">
          Sidebearings are measured from the outline, so they follow any parameter changes
        </span>
      </div>

      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-xs-plus">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border text-2xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Glyph</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-right font-medium">Left</th>
              <th className="px-4 py-2 text-right font-medium">Right</th>
              <th className="px-4 py-2 text-right font-medium">Advance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.glyph.name}
                onClick={() => store.selectGlyph(row.glyph.name)}
                className={cn(
                  "cursor-pointer border-b border-border/40 hover:bg-card",
                  state.selectedGlyph === row.glyph.name && "bg-card",
                )}
              >
                <td className="px-4 py-1.5 font-mono text-sm">{glyphLabel(row.glyph)}</td>
                <td className="px-4 py-1.5 font-mono text-2xs text-muted-foreground">
                  {row.glyph.name}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  <SidebearingInput
                    value={row.left}
                    onCommit={(next) => shiftSidebearing(row.glyph.name, next - row.left, "left")}
                  />
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  <SidebearingInput
                    value={row.right}
                    onCommit={(next) => shiftSidebearing(row.glyph.name, next - row.right, "right")}
                  />
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  <SidebearingInput
                    value={row.advance}
                    onCommit={(next) =>
                      store.editGlyph(row.glyph.name, "Set advance width", (glyph) => {
                        glyph.advanceWidth = Math.max(0, next);
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Move a glyph within its advance.
 *
 * Changing the left sidebearing slides the outline and widens the advance to
 * match, so the space on the right is untouched. Changing the right sidebearing
 * only changes the advance.
 */
function shiftSidebearing(name: string, delta: number, side: "left" | "right"): void {
  if (delta === 0) return;
  store.editGlyph(name, side === "left" ? "Set left sidebearing" : "Set right sidebearing", (glyph) => {
    if (side === "left") {
      for (const contour of glyph.contours) {
        for (const node of contour.nodes) {
          node.point = { x: node.point.x + delta, y: node.point.y };
          if (node.handleIn) node.handleIn = { x: node.handleIn.x + delta, y: node.handleIn.y };
          if (node.handleOut) node.handleOut = { x: node.handleOut.x + delta, y: node.handleOut.y };
        }
      }
    }
    glyph.advanceWidth = Math.max(0, glyph.advanceWidth + delta);
  });
}

function SidebearingInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => {
        const parsed = Number(draft);
        if (Number.isFinite(parsed) && parsed !== value) onCommit(Math.round(parsed));
        else setDraft(String(value));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
      className="h-6 w-20 rounded border border-transparent bg-transparent px-1.5 text-right tabular-nums outline-none hover:border-border focus-visible:border-accent focus-visible:bg-card"
    />
  );
}

/** The preview strip: letters at their real spacing, kerning included. */
function SpacingPreview({
  typeface,
  revision,
  text,
}: {
  typeface: Typeface;
  revision: number;
  text: string;
}): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 900, height: 120 });

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

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = prepareCanvas(canvas, size.width, size.height);
    if (!context) return;

    const byCodepoint = new Map<number, Glyph>();
    for (const glyph of typeface.glyphs) {
      for (const codepoint of glyph.unicodes) {
        if (!byCodepoint.has(codepoint)) byCodepoint.set(codepoint, glyph);
      }
    }

    const items: Array<{ glyph: Glyph; x: number }> = [];
    let pen = 0;
    let previous: Glyph | null = null;
    for (const character of text) {
      const glyph = byCodepoint.get(character.codePointAt(0)!);
      if (!glyph) continue;
      if (previous) pen += store.kerningFor(previous.name, glyph.name);
      items.push({ glyph, x: pen });
      pen += resolveAdvanceWidth(glyph, typeface);
      previous = glyph;
    }
    if (items.length === 0) return;

    const scale = Math.min(
      (size.width - 60) / Math.max(1, pen),
      (size.height * 0.6) / Math.max(1, typeface.metrics.ascender),
    );
    const view: GlyphView = { scale, originX: 30, originY: size.height * 0.78 };
    for (const item of items) {
      drawGlyph(context, item.glyph, typeface, view, { offsetX: item.x });
    }
  }, [typeface, revision, text, size]);

  return (
    <div ref={containerRef} className="h-28 shrink-0 bg-[var(--canvas)]">
      <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} />
    </div>
  );
}

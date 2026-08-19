/**
 * The font view: every glyph in the typeface, as a grid.
 *
 * A font can hold thousands of glyphs, so only the rows on screen are mounted.
 * Each visible cell draws its outline to its own small canvas, which keeps the
 * cost proportional to what is actually visible rather than to the size of the
 * font.
 */

import * as React from "react";

import { enterStaggered } from "@/anim/motion";
import { drawGlyph, fitEmSquare, formatCodepoint, glyphLabel, prepareCanvas, readToken } from "@/components/glyph-render";
import type { Glyph, Typeface } from "@/font/types";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

const CELL_SIZE = 104;
const CELL_GAP = 8;
/** Extra rows kept mounted above and below, so scrolling does not flash. */
const OVERSCAN_ROWS = 3;

export function FontGridView(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(600);
  const [columns, setColumns] = React.useState(8);

  // Track the viewport so the visible window can be computed.
  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight);
      const usable = element.clientWidth - CELL_GAP;
      setColumns(Math.max(1, Math.floor(usable / (CELL_SIZE + CELL_GAP))));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const glyphs = React.useMemo(() => filterGlyphs(typeface, state.search), [typeface, state.search, state.revision]);

  const rowHeight = CELL_SIZE + CELL_GAP;
  const rowCount = Math.ceil(glyphs.length / columns);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const lastRow = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS);
  const visible = glyphs.slice(firstRow * columns, lastRow * columns);

  if (!typeface) return <EmptyState />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <input
          value={state.search}
          onChange={(event) => store.setSearch(event.target.value)}
          placeholder="Search by letter, name or U+ code"
          className="h-8 w-72 rounded-md border border-input bg-card px-2.5 text-xs-plus text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-accent"
          aria-label="Search glyphs"
        />
        <span className="text-2xs text-muted-foreground tabular-nums">
          {glyphs.length.toLocaleString()}
          {glyphs.length === typeface.glyphs.length ? " glyphs" : ` of ${typeface.glyphs.length.toLocaleString()}`}
        </span>
        {state.selectedGlyphs.size > 0 && (
          <span className="ml-auto text-2xs text-accent tabular-nums">
            {state.selectedGlyphs.size} selected
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto p-3"
      >
        <div style={{ height: rowCount * rowHeight }} className="relative">
          <div
            className="absolute inset-x-0 grid"
            style={{
              top: firstRow * rowHeight,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: CELL_GAP,
            }}
          >
            {visible.map((glyph) => (
              <GlyphCell
                key={glyph.name}
                glyph={glyph}
                typeface={typeface}
                revision={state.revision}
                active={state.selectedGlyph === glyph.name}
                selected={state.selectedGlyphs.has(glyph.name)}
              />
            ))}
          </div>
        </div>
        {glyphs.length === 0 && (
          <p className="py-16 text-center text-xs-plus text-muted-foreground">
            No glyph matches “{state.search}”.
          </p>
        )}
      </div>
    </div>
  );
}

interface GlyphCellProps {
  glyph: Glyph;
  typeface: Typeface;
  revision: number;
  active: boolean;
  selected: boolean;
}

const GlyphCell = React.memo(function GlyphCell({
  glyph,
  typeface,
  revision,
  active,
  selected,
}: GlyphCellProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = CELL_SIZE;
    const context = prepareCanvas(canvas, size, size - 20);
    if (!context) return;
    const view = fitEmSquare(typeface, size, size - 20, 0.18);
    drawGlyph(context, glyph, typeface, view, {
      fill: readToken("--glyph-fill", "#eeeeee"),
    });
  }, [glyph, typeface, revision]);

  return (
    <button
      type="button"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          store.toggleGlyphSelection(glyph.name, true);
        } else {
          store.selectGlyph(glyph.name);
          store.clearGlyphSelection();
        }
      }}
      onDoubleClick={() => store.selectGlyph(glyph.name, { open: true })}
      title={`${glyph.name}  ${formatCodepoint(glyph.unicodes[0])}`}
      className={cn(
        "group relative flex flex-col items-center justify-between rounded-md border bg-card/40 pt-1 transition-colors",
        "hover:border-accent/60 hover:bg-card",
        active ? "border-accent bg-card" : "border-border/60",
        selected && "ring-1 ring-accent/70",
      )}
      style={{ height: CELL_SIZE }}
    >
      <canvas ref={canvasRef} style={{ width: CELL_SIZE, height: CELL_SIZE - 20 }} />
      <span className="w-full truncate px-1 pb-1 text-center text-2xs text-muted-foreground group-hover:text-foreground">
        {glyphLabel(glyph)}
      </span>
      {glyph.dirty && (
        <span
          className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-attention"
          title="Edited"
        />
      )}
    </button>
  );
});

/**
 * Match a search against the character itself, the glyph name, or a codepoint
 * written as `U+0041` or `0041`. Typing the letter you are looking for is the
 * fastest route, so that is checked first.
 */
function filterGlyphs(typeface: Typeface | null, search: string): Glyph[] {
  if (!typeface) return [];
  const query = search.trim();
  if (!query) return typeface.glyphs;

  const lower = query.toLowerCase();
  const hexMatch = /^(?:u\+)?([0-9a-f]{2,6})$/i.exec(query);
  const codepoint = hexMatch ? Number.parseInt(hexMatch[1], 16) : null;
  const asChar = [...query][0]?.codePointAt(0);

  return typeface.glyphs.filter((glyph) => {
    if (codepoint !== null && glyph.unicodes.includes(codepoint)) return true;
    if (query.length === 1 && asChar !== undefined && glyph.unicodes.includes(asChar)) return true;
    return glyph.name.toLowerCase().includes(lower);
  });
}

function EmptyState(): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current) enterStaggered(Array.from(ref.current.children) as Element[]);
  }, []);
  return (
    <div ref={ref} className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-sm font-medium text-foreground">No font open</h2>
      <p className="max-w-sm text-xs-plus text-muted-foreground">
        Drop a TrueType, OpenType, WOFF or WOFF2 file anywhere in this window, or use Open font in
        the toolbar.
      </p>
    </div>
  );
}

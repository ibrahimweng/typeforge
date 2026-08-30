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
import { PRIMARY_ACTION, tile } from "@/components/controls";
import { CoachMark } from "@/components/CoachMark";
import { cn } from "@/ui/lib/utils";

const CELL_SIZE = 104;
const CELL_GAP = 8;
/** Extra rows kept mounted above and below, so scrolling does not flash. */
const OVERSCAN_ROWS = 3;

export function FontGridView(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(600);
  const [columns, setColumns] = React.useState(8);

  /*
   * Measured through a callback ref rather than an effect, and the difference
   * was the whole of two faults.
   *
   * This used to observe from a `useEffect` with no dependencies. The component
   * returns an empty state before the grid exists, so on the first render the
   * ref was null, the effect took its early exit, and -- having no dependencies
   * -- it never ran again once a font arrived and the grid appeared. Nothing
   * was ever observed. The column count therefore sat at the eight it was
   * initialised with, on every window, for ever: which meant density got
   * *worse* on a larger monitor, and meant that on a narrow one the cells were
   * squeezed under the fixed size their canvases are drawn at, so the letters
   * spilled over their edges into the next cell along.
   *
   * A callback ref fires exactly when the node attaches and when it goes away,
   * which is the condition this actually cares about, and cannot be true before
   * the node exists.
   */
  const measure = React.useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    observerRef.current?.disconnect();
    if (!element) return;
    const read = () => {
      setViewportHeight(element.clientHeight);
      const usable = element.clientWidth - CELL_GAP;
      setColumns(Math.max(1, Math.floor(usable / (CELL_SIZE + CELL_GAP))));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    observerRef.current = observer;
  }, []);
  const observerRef = React.useRef<ResizeObserver | null>(null);
  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  const glyphs = React.useMemo(() => filterGlyphs(typeface, state.search), [typeface, state.search, state.revision]);

  const rowHeight = CELL_SIZE + CELL_GAP;
  const rowCount = Math.ceil(glyphs.length / columns);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const lastRow = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS);
  const visible = glyphs.slice(firstRow * columns, lastRow * columns);

  if (!typeface) return <EmptyState />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CoachMark id="grid" />
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
        ref={measure}
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
                name={glyph.name}
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

/*
 * A cell is told which letter it is and when the font last changed, and goes
 * and gets the rest itself.
 *
 * It used to be handed the glyph and the whole typeface. That reads well and is
 * cheap in production, and in development it costs two minutes: React's
 * performance track diffs a component's previous props against its next ones to
 * show what changed, and where the two differ it walks in and writes out what
 * it finds. A typeface is six thousand glyphs of outlines, there are eighty
 * cells on screen, and every one of them was handed the same font -- so opening
 * a second font, or reloading into one, froze the tab solid for the length of
 * that walk. Props a component does not need are not free.
 */
interface GlyphCellProps {
  /** Which glyph, by name. The font itself is fetched, not passed. */
  name: string;
  /** Bumped whenever the font changes, which is what redraws the cell. */
  revision: number;
  active: boolean;
  selected: boolean;
}

const GlyphCell = React.memo(function GlyphCell({
  name,
  revision,
  active,
  selected,
}: GlyphCellProps): React.JSX.Element | null {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  /*
   * Read rather than subscribed to. The revision above is the subscription --
   * it arrives from the view, which does subscribe -- and this is the document
   * that revision refers to. Eighty cells each holding their own subscription
   * would re-render eighty times for a keystroke in the search box.
   */
  const typeface = store.getSnapshot().typeface;
  const at = typeface?.glyphIndex.get(name);
  const glyph = typeface && at !== undefined ? typeface.glyphs[at] : undefined;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !typeface || !glyph) return;
    const size = CELL_SIZE;
    const context = prepareCanvas(canvas, size, size - 20);
    if (!context) return;
    const view = fitEmSquare(typeface, size, size - 20, 0.18);
    drawGlyph(context, glyph, typeface, view, {
      fill: readToken("--glyph-fill", "#eeeeee"),
    });
  }, [glyph, typeface, revision]);

  // A name with nothing behind it means the font changed under the row while
  // it was on screen; the next render has the right letters in it.
  if (!glyph) return null;

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
      aria-current={active ? "true" : undefined}
      aria-pressed={selected}
      data-glyph-cell={glyph.name}
      // The same thing the dot in the corner says, in a form something other
      // than an eye can read.
      data-glyph-changed={glyph.dirty ? "yes" : "no"}
      className={cn(
        "group relative flex flex-col items-center justify-between rounded-md border pt-1",
        tile(active, "bg-card/40"),
        // Picked out for a bulk action, which is a different thing from being
        // the one open in the editor.
        selected && "ring-2 ring-[color:var(--accent)]",
      )}
      style={{ height: CELL_SIZE }}
    >
      {/*
        Capped at the cell as well as sized to it.

        The canvas is drawn at a fixed size and the cells are a fraction of the
        row, so the two agree only while the column count is right. It is right
        now, and this is the guarantee that a future arithmetic slip shows up as
        a letter drawn small rather than as a letter drawn over its neighbour.
      */}
      <canvas
        ref={canvasRef}
        style={{ width: CELL_SIZE, height: CELL_SIZE - 20, maxWidth: "100%" }}
      />
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

/**
 * What there is to look at before a font is open.
 *
 * Which used to be nothing but an instruction to go and find a file. Someone
 * arriving to see what this is should be able to see it, so there is a font
 * here to open; the sample makes the difference between reading about a weight
 * slider and moving one.
 */
function EmptyState(): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current) enterStaggered(Array.from(ref.current.children) as Element[]);
  }, []);
  return (
    <div ref={ref} className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-sm font-medium text-foreground">No font open</h2>
      <p className="max-w-sm text-xs-plus text-muted-foreground">
        Drop a TrueType, OpenType, WOFF or WOFF2 file anywhere in this window, or use Open in the
        toolbar. Open takes a saved Typeforge project too.
      </p>
      <button type="button" onClick={() => void store.loadSample()} className={PRIMARY_ACTION}>
        Try the sample font
      </button>
      <p className="max-w-sm text-2xs text-muted-foreground">
        A small Latin face to take the controls for a run. Nothing is uploaded — every font you open
        stays in this browser.
      </p>
    </div>
  );
}

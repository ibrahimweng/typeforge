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
import { groupGlyphs } from "@/font/groups";
import type { Glyph, Typeface } from "@/font/types";
import { store, useAppState } from "@/state/useStore";
import { PRIMARY_ACTION, tile } from "@/components/controls";
import { CoachMark } from "@/components/CoachMark";
import { cn } from "@/ui/lib/utils";

const CELL_SIZE = 104;
const CELL_GAP = 8;
/** A group heading and the air around it, in the same units as a row of cells. */
const HEADING_HEIGHT = 28;

/**
 * One line of the grid.
 *
 * Headings and cells are the same kind of thing here -- something with a
 * height, stacked in order -- because that is what the scroll arithmetic needs
 * them to be. Keeping them in one list is what lets a heading scroll with its
 * letters instead of floating over them.
 */
type Row =
  | { kind: "heading"; name: string; count: number }
  | { kind: "cells"; glyphs: Glyph[] };
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

  /*
   * The grid, as a list of rows that are not all the same height.
   *
   * Six thousand cells cannot all be mounted -- each one holds a canvas it
   * paints a letter into -- so the grid has always drawn only the rows on
   * screen and left a spacer the height of the rest. Grouping does not change
   * that; it changes what a row is. A row is now either a heading or a run of
   * cells, the two have different heights, and finding the first one on screen
   * is therefore a walk over accumulated offsets rather than a division.
   *
   * Built in one pass and kept until the letters or the column count change,
   * because it is O(glyphs) and the thing that changes most often here is the
   * scroll position, which does not touch it.
   */
  const { rows, offsets, total } = React.useMemo(() => {
    const built: Row[] = [];
    for (const group of groupGlyphs(glyphs)) {
      built.push({ kind: "heading", name: group.name, count: group.glyphs.length });
      for (let at = 0; at < group.glyphs.length; at += columns) {
        built.push({ kind: "cells", glyphs: group.glyphs.slice(at, at + columns) });
      }
    }
    const tops: number[] = [];
    let y = 0;
    for (const row of built) {
      tops.push(y);
      y += row.kind === "heading" ? HEADING_HEIGHT : CELL_SIZE + CELL_GAP;
    }
    return { rows: built, offsets: tops, total: y };
  }, [glyphs, columns]);

  /** The first row whose bottom is past a given height, by bisection. */
  const rowAt = React.useCallback(
    (y: number): number => {
      let low = 0;
      let high = offsets.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (offsets[middle] <= y) low = middle;
        else high = middle - 1;
      }
      return low;
    },
    [offsets],
  );

  const firstRow = Math.max(0, rowAt(scrollTop) - OVERSCAN_ROWS);
  const lastRow = Math.min(rows.length, rowAt(scrollTop + viewportHeight) + 1 + OVERSCAN_ROWS);
  const visible = rows.slice(firstRow, lastRow);

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
        <div style={{ height: total }} className="relative">
          {visible.map((row, index) => {
            const at = firstRow + index;
            const top = offsets[at];
            if (row.kind === "heading") {
              return (
                /*
                 * The count beside the name, as Assemble writes it. On a
                 * search it is the one number that answers the question you
                 * typed: how many `o`s does this font have in it.
                 */
                <h3
                  key={`heading-${row.name}`}
                  data-glyph-group={row.name}
                  style={{ top, height: HEADING_HEIGHT }}
                  className="absolute inset-x-0 flex items-end gap-2 pb-1.5"
                >
                  <span className="text-2xs font-medium text-foreground">{row.name}</span>
                  <span className="text-2xs tabular-nums text-muted-foreground">{row.count}</span>
                </h3>
              );
            }
            return (
              <div
                key={`cells-${row.glyphs[0].name}`}
                className="absolute inset-x-0 grid"
                style={{
                  top,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gap: CELL_GAP,
                }}
              >
                {row.glyphs.map((glyph) => (
                  <GlyphCell
                    key={glyph.name}
                    name={glyph.name}
                    revision={state.revision}
                    active={state.selectedGlyph === glyph.name}
                    selected={state.selectedGlyphs.has(glyph.name)}
                  />
                ))}
              </div>
            );
          })}
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

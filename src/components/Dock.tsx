/**
 * The column of panels down the right, and the four things you can do to it.
 *
 * It was a fixed width holding a fixed set of panels in a fixed order, and
 * none of the three could be changed. That is the arrangement every other
 * drawing program stopped shipping in about 1994, and the reason is not
 * fashion: which panels are open, how wide they are and what order they are in
 * is most of what a person means by "how I work". A tool that decides all of
 * it for you is one you fit yourself around.
 *
 * So: drag the edge to resize, click a header to furl, drag a header to move a
 * panel, and put one away from the menu at the top. All four are remembered in
 * this browser, which is what makes them worth doing at all -- a layout you
 * have to set up again every morning is one nobody sets up.
 *
 * The panels themselves know nothing about any of this. Each hands over a name
 * and a body, and the frame around it is drawn here: one place that decides
 * what a panel header looks like, rather than six panels each drawing their
 * own and slowly disagreeing.
 *
 * Reordering is a drag *and* a pair of keys, and the keys are not an
 * afterthought. A drag is what a designer will reach for and it is unreachable
 * without a pointer, so the header answers the arrow keys with a modifier as
 * well. Both go through the same one function, so they cannot come apart.
 */

import * as React from "react";

import {
  LEAST_WIDTH,
  MOST_WIDTH,
  widthWithin,
  arrangePanels,
  inOrder,
  resetLayout,
  resizeDock,
  showPanel,
  togglePanel,
  useLayout,
} from "@/state/layout";
import { landingAmong } from "@/components/landing";
import { cn } from "@/cn";

/** One panel offered to the dock. */
export interface DockPanel {
  /** Its name in the remembered layout, so it must not change once shipped. */
  id: string;
  /** What the header says, and what the panels menu lists it as. */
  name: string;
  /** Drawn only when true. A panel with nothing to be about is not offered. */
  when?: boolean;
  /** What is under the header. Built by the caller, so a furled panel still
   * costs the work of building it -- which is cheap here and keeps the panels
   * ignorant of the dock. */
  body: React.ReactNode;
  /** A word or two beside the name, for what the panel is currently about. */
  note?: React.ReactNode;
  /**
   * The attribute the browser tests know this panel by.
   *
   * On the section rather than on the body, so it names the whole panel --
   * header included. That is where it belongs now that the dock draws the
   * header: the paths panel says how many paths there are in its header, and a
   * marker that covered only the body would say the panel no longer mentions
   * them. Which is exactly what three tests reported when the header moved.
   */
  mark?: string;
}

/** The same question, asked of the headers actually on screen. */
function landingAt(within: HTMLElement | null, y: number, carried: string, ids: string[]): number {
  const middles = ids.flatMap((id) => {
    const header = within?.querySelector<HTMLElement>(`[data-panel-header="${id}"]`);
    if (!header) return [];
    const box = header.getBoundingClientRect();
    return [{ id, middle: box.top + box.height / 2 }];
  });
  return landingAmong(middles, carried, y);
}

export function Dock({
  panels,
  label,
  head,
}: {
  panels: DockPanel[];
  /** What the whole column is called, for a screen reader. */
  label: string;
  /**
   * Whatever belongs above the panels and does not scroll with them.
   *
   * The panels menu is drawn beside it rather than in a row of its own,
   * because the caller already has a header there and a second strip holding
   * one button would be a strip of chrome to look past.
   */
  head?: React.ReactNode;
}): React.JSX.Element {
  const layout = useLayout();
  const column = React.useRef<HTMLDivElement>(null);

  /*
   * How wide the window is, so the dock can give width back on a small one.
   *
   * The fixed column this replaced was three widths, chosen by the stylesheet
   * from the window. A remembered number in pixels is not, so the ceiling has
   * to be applied here -- and it is a ceiling rather than a correction, so the
   * width somebody chose on a big screen is still theirs when they come back
   * to one.
   */
  const [windowWidth, setWindowWidth] = React.useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  React.useEffect(() => {
    const measure = (): void => setWindowWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const width = widthWithin(layout.width, windowWidth);

  const offered = panels.filter((panel) => panel.when !== false);
  const arranged = inOrder(offered, layout.order);
  const shown = arranged.filter((panel) => !layout.hidden.includes(panel.id));

  /** Which panel is being carried, and where it would land. */
  const [carrying, setCarrying] = React.useState<{ id: string; to: number } | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);

  /*
   * Moving a panel, from a drag and from the keyboard alike.
   *
   * Written once and called by both, because two implementations of "what
   * order are they in now" is how a list comes to answer the mouse and the
   * keyboard differently -- and the one that gets tested is never the one that
   * breaks.
   */
  const moveTo = React.useCallback(
    (id: string, at: number) => {
      const ids = shown.map((panel) => panel.id).filter((one) => one !== id);
      ids.splice(Math.min(ids.length, Math.max(0, at)), 0, id);
      arrangePanels(ids);
    },
    [shown],
  );

  return (
    <div className="flex shrink-0" style={{ width }}>
      {/*
        The edge, which is a control and has to look like one.

        Two pixels of border with a wider invisible grab area either side, so
        it is easy to catch without being a visible bar down the window. It is
        also a real button in the tab order: a keyboard has no way to drag, and
        a dock that can only be resized with a mouse is a dock half the people
        who need it cannot resize.
      */}
      <button
        type="button"
        aria-label={`Width of the ${label.toLowerCase()}`}
        data-dock-resize
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const startX = event.clientX;
          const startWidth = width;
          const move = (moving: PointerEvent): void => {
            // Leftwards is wider, because the dock is on the right.
            resizeDock(startWidth + (startX - moving.clientX));
          };
          const stop = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", stop);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 48 : 16;
          if (event.key === "ArrowLeft") resizeDock(width + step);
          else if (event.key === "ArrowRight") resizeDock(width - step);
          else if (event.key === "Home") resizeDock(LEAST_WIDTH);
          else if (event.key === "End") resizeDock(MOST_WIDTH);
          else return;
          event.preventDefault();
        }}
        className={cn(
          "relative w-1.5 shrink-0 cursor-col-resize border-l border-border bg-transparent",
          "transition-colors hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none",
          // Four pixels either side that catch the pointer and draw nothing,
          // so it is easy to grab without being a visible bar down the window.
          "before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']",
        )}
      />

      <aside
        aria-label={label}
        data-dock
        className="toolcraft-panel-surface flex min-w-0 flex-1 flex-col"
      >
        {/*
          The way back to a panel that has been put away, beside whatever the
          caller draws at the top of its column.

          Here rather than in the toolbar. This menu is about this column, it
          is the only way back once something is hidden, and the toolbar is
          already the most crowded strip in the application.

          No title of its own. The column is named for a screen reader on the
          element below, and a visible title saying something different from
          that name is the fault where what a control is called and what it
          reads as come apart.
        */}
        <div className="relative flex items-center gap-1 border-b border-border p-1">
          <div className="min-w-0 flex-1">{head}</div>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Which panels to show"
            data-panels-menu
            onClick={() => setMenuOpen((open) => !open)}
            className="shrink-0 rounded px-1.5 text-xs-plus leading-none text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            ⋯
          </button>
          {menuOpen && (
            <PanelsMenu
              panels={arranged}
              hidden={layout.hidden}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>

        <div ref={column} className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
          {shown.map((panel, at) => {
            const furled = layout.collapsed.includes(panel.id);
            /*
              Where the line is drawn: above the panel the carried one would
              displace, which is the `to`th of the panels that are not it.
            */
            const others = shown.filter((one) => one.id !== carrying?.id);
            const wouldLandHere =
              carrying !== null && carrying.id !== panel.id && others[carrying.to]?.id === panel.id;
            return (
              <section
                key={panel.id}
                data-panel={panel.id}
                {...(panel.mark ? { [panel.mark]: true } : {})}
                data-panel-carried={carrying?.id === panel.id ? "true" : undefined}
                className={cn(
                  "border-b border-border",
                  carrying?.id === panel.id && "opacity-50",
                  wouldLandHere && "border-t-2 border-t-accent",
                )}
              >
                <div
                  data-panel-header={panel.id}
                  className="flex items-center gap-1 px-2 py-1.5"
                  onPointerDown={(event) => {
                    /*
                      A drag starts on the header, because the body is full of
                      controls somebody is trying to use.

                      It does not start until the pointer has actually moved,
                      which is what keeps the same press able to be a click.
                      The name is both the drag handle and the button that
                      furls the panel, so a press that goes nowhere has to
                      reach the click handler untouched -- and a drag that
                      began on the first pixel of jitter would flicker the
                      panel to half opacity every time somebody furled one.
                    */
                    if (event.button !== 0) return;
                    const from = event.clientY;
                    let carried = false;
                    let landed = at;
                    const carry = (moving: PointerEvent): void => {
                      if (!carried && Math.abs(moving.clientY - from) < 4) return;
                      carried = true;
                      landed = landingAt(
                        column.current,
                        moving.clientY,
                        panel.id,
                        shown.map((one) => one.id),
                      );
                      setCarrying({ id: panel.id, to: landed });
                    };
                    const drop = (): void => {
                      window.removeEventListener("pointermove", carry);
                      window.removeEventListener("pointerup", drop);
                      /*
                        The move is made here rather than inside the updater,
                        which is where it used to be.

                        React calls an updater twice under StrictMode to catch
                        side effects in one, and this had one. It survived only
                        because `moveTo` builds the whole order afresh and so
                        gives the same answer twice; the same shape copied to
                        the tab strip, where moving is relative, put the tab
                        back where it started and did it only in development.
                        Nothing here should rely on being idempotent by luck.
                      */
                      setCarrying(null);
                      if (carried) moveTo(panel.id, landed);
                    };
                    window.addEventListener("pointermove", carry);
                    window.addEventListener("pointerup", drop);
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={!furled}
                    data-panel-furl={panel.id}
                    onClick={() => togglePanel(panel.id)}
                    onKeyDown={(event) => {
                      /*
                        The keyboard's version of the drag. Alt with the arrows,
                        which is what every list that can be reordered from a
                        keyboard uses, and which cannot be confused with moving
                        between the headers.
                      */
                      if (!event.altKey) return;
                      if (event.key === "ArrowUp") moveTo(panel.id, at - 1);
                      else if (event.key === "ArrowDown") moveTo(panel.id, at + 1);
                      else return;
                      event.preventDefault();
                    }}
                    className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 text-left active:cursor-grabbing"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "shrink-0 text-[8px] text-muted-foreground transition-transform",
                        furled && "-rotate-90",
                      )}
                    >
                      ▼
                    </span>
                    <span className="truncate text-2xs font-medium text-foreground">
                      {panel.name}
                    </span>
                    {panel.note !== undefined && (
                      <span className="ml-auto truncate pl-2 text-2xs text-muted-foreground">
                        {panel.note}
                      </span>
                    )}
                  </button>
                </div>
                {!furled && <div className="px-3 pb-3">{panel.body}</div>}
              </section>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

/** The list of panels, with the ones put away offered back. */
function PanelsMenu({
  panels,
  hidden,
  onClose,
}: {
  panels: DockPanel[];
  hidden: readonly string[];
  onClose: () => void;
}): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const away = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Which panels to show"
      data-panels-list
      className="absolute right-1 top-full z-40 mt-1 min-w-44 rounded-md border border-border bg-popover py-1 shadow-lg"
    >
      {panels.map((panel) => {
        const on = !hidden.includes(panel.id);
        return (
          <button
            key={panel.id}
            type="button"
            role="menuitemcheckbox"
            aria-checked={on}
            data-panel-toggle={panel.id}
            onClick={() => showPanel(panel.id, !on)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs-plus text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span aria-hidden className={cn("w-3 shrink-0", !on && "opacity-0")}>
              ✓
            </span>
            {panel.name}
          </button>
        );
      })}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        role="menuitem"
        data-reset-layout
        onClick={() => {
          resetLayout();
          onClose();
        }}
        className="block w-full px-3 py-1.5 text-left text-xs-plus text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        Put the panels back
      </button>
    </div>
  );
}

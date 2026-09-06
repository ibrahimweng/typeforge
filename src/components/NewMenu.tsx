/**
 * The three ways to start a font, and the way back to one you started.
 *
 * These were four buttons in a strip beside the six view tabs, in the same
 * treatment, at the same size. Two segmented controls side by side, and the
 * only way to know they were different kinds of thing was to press one: the
 * left one changes which document you are working on, the right one changes
 * which screen you are looking at it through. That is what made an application
 * with one font open read as four applications.
 *
 * Three of the four are not navigation at all. Draw, Trace and Assemble each
 * hold their own document -- a parametric description, a set of traced
 * strokes, a pile of imported drawings -- and each has a button that turns
 * what it holds into a typeface and hands it to the editor. They are where a
 * font comes from. The fourth, Edit, is not something you pick: it is where
 * you are once there is a font.
 *
 * So they belong beside Open and the library, which is the other place a font
 * comes from, and they are here.
 *
 * What this must not lose is the way back. Each of the three is a workspace
 * somebody returns to -- change the weight in Draw, hand it over, decide the
 * weight was wrong, go back -- so an entry whose half already holds something
 * says so and returns to it rather than offering to start again. That is the
 * whole reason this is a menu of six lines rather than a dialog of three: a
 * dialog that ran once and closed would have made the round trip a thing you
 * do by accident.
 */

import * as React from "react";

import type { Mode } from "@/App";
import { useMenuBehaviour } from "@/components/menu-keys";
import { OUTLINE_ACTION } from "@/components/controls";
import { useAssemble } from "@/state/useAssemble";
import { useQuill } from "@/state/useQuill";
import { useAppState } from "@/state/useStore";
import { cn } from "@/cn";

/** One way to start, and what it says once it holds something. */
interface Route {
  mode: Mode;
  /** What it says when its half is empty. */
  start: string;
  /** What it says when its half already holds work. */
  back: string;
  /** Whether it holds work now. */
  holds: boolean;
  said: string;
}

export function NewMenu({
  mode,
  opened,
  onMode,
}: {
  mode: Mode;
  /** The generators that have actually been opened. See `App.tsx` for why. */
  opened: ReadonlySet<Mode>;
  onMode: (mode: Mode) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const menu = React.useRef<HTMLDivElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);

  const quill = useQuill();
  const assemble = useAssemble();
  const loan = useAppState((state) => state.loan);
  const typeface = useAppState((state) => state.typeface);

  const close = React.useCallback((why: "escape" | "away" | "resize") => {
    setOpen(false);
    // Back to the button on Escape, which is where the focus came from and
    // what a person expects to be standing on when a menu goes away.
    if (why === "escape") button.current?.focus();
  }, []);

  const routes: Route[] = [
    {
      mode: "forge",
      start: "Draw one from a style",
      back: "Back to your drawing",
      /*
       * Having opened Draw is the test, rather than anything the drawing says
       * about itself.
       *
       * It draws a whole alphabet from a style the moment you arrive, so
       * arriving is exactly when there is something to go back to. The first
       * version asked which style the drawing had started from, which is set
       * when the module loads rather than when a person opens Draw -- so about
       * two seconds after the first screen appeared, once the deferred chunks
       * had warmed, this offered to take somebody back to a drawing nobody had
       * made.
       */
      holds: opened.has("forge"),
      said: "Pick one of twenty families and a whole alphabet is drawn for you",
    },
    {
      mode: "quill",
      start: "Trace a font you have",
      back: "Back to what you traced",
      holds: opened.has("quill") || quill.document.letters.length > 0,
      said: "Read an existing font back into strokes you can reshape",
    },
    {
      mode: "assemble",
      start: "Assemble letters you drew",
      back: "Back to your drawings",
      holds: opened.has("assemble") || assemble.assembly.pieces.length > 0,
      said: "Bring in drawings you made somewhere else and turn them into a font",
    },
  ];

  /*
   * The way back to the font, which is the other half of the round trip.
   *
   * Only from somewhere else, and only when there is one. Standing in the
   * editor it would be a line offering to take you where you already are.
   */
  const backToFont =
    mode !== "edit" && typeface
      ? { name: typeface.meta.familyName || "the font", said: "The font you have open" }
      : null;

  const held = loan !== null;

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-new-menu
        disabled={held}
        onClick={() => setOpen((was) => !was)}
        title={
          held
            ? `Finish with ${loan.letter} first — keep the drawing or throw it away.`
            : "Start a font, or go back to one you started"
        }
        className={cn(OUTLINE_ACTION, "disabled:opacity-40")}
      >
        New ▾
      </button>
      {open && (
        <Menu
          menu={menu}
          routes={routes}
          backToFont={backToFont}
          mode={mode}
          onClose={close}
          onGo={(next) => {
            onMode(next);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Menu({
  menu,
  routes,
  backToFont,
  mode,
  onClose,
  onGo,
}: {
  menu: React.RefObject<HTMLDivElement | null>;
  routes: Route[];
  backToFont: { name: string; said: string } | null;
  mode: Mode;
  onClose: (why: "escape" | "away" | "resize") => void;
  onGo: (mode: Mode) => void;
}): React.JSX.Element {
  /*
   * The focus stays on the button rather than moving into the list.
   *
   * A menu opened by a pointer at a position has nothing else holding the
   * focus, so its first line should take it. This one is opened from a button
   * that keeps it, and Escape has somewhere obvious to go back to. Pulling the
   * focus in here would take away the thing that closes it.
   */
  const { onKeyDown } = useMenuBehaviour({ menu, onClose, takeFocus: false });

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Start a font"
      data-new-list
      onKeyDown={onKeyDown}
      className="absolute right-0 top-full z-40 mt-1 min-w-64 rounded-md border border-border bg-popover py-1 shadow-lg"
    >
      {routes.map((route) => (
        <button
          key={route.mode}
          type="button"
          role="menuitem"
          data-menu-item
          data-start={route.mode}
          disabled={mode === route.mode}
          title={route.said}
          onClick={() => onGo(route.mode)}
          className={cn(
            "block w-full px-3 py-1.5 text-left text-xs-plus text-popover-foreground",
            "transition-colors hover:bg-accent hover:text-accent-foreground",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {route.holds ? route.back : route.start}
          {/*
            What it would do, under it, because "Trace a font you have" is a
            sentence somebody can read two ways and the wrong reading loses
            work. Not on the entries that go back, which say plainly enough
            where they go.
          */}
          {!route.holds && (
            <span className="block truncate pt-0.5 text-2xs text-muted-foreground">
              {route.said}
            </span>
          )}
        </button>
      ))}
      {backToFont && (
        <>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            data-menu-item
            data-back-to-font
            title={backToFont.said}
            onClick={() => onGo("edit")}
            className={cn(
              "block w-full px-3 py-1.5 text-left text-xs-plus text-popover-foreground",
              "transition-colors hover:bg-accent hover:text-accent-foreground",
            )}
          >
            Back to <span className="font-medium">{backToFont.name}</span>
          </button>
        </>
      )}
    </div>
  );
}

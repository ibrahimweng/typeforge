/**
 * File, Edit, View, Window, Help.
 *
 * A designer arriving from Adobe looks for menus first. This application had
 * none: everything it can do was reachable from a command palette and a help
 * drawer, which are both excellent and both require knowing they are there.
 * A menu bar is the one part of a desktop application nobody has to be told
 * about, and it is the only affordance that answers "what can this thing do"
 * by being read rather than by being searched.
 *
 * It is not a second description of the product. The verbs, their labels and
 * their shortcuts come from `palette/actions.ts`, which is what the palette
 * shows as well -- so a renamed command is renamed in both, and a command that
 * stops existing takes its menu line with it rather than leaving one that
 * throws. The two differ only in presentation: the palette lists where you can
 * go and leaves out where you are, while a menu lists everywhere and marks
 * where you are.
 *
 * What is not here is as deliberate as what is. There is no Object menu and no
 * Type menu, though the analysis this came from named both, because every verb
 * they would hold either needs a selection and a slider -- the warps, which are
 * a drag rather than a command -- or does not exist yet. Menus that open onto
 * nothing are worse than menus that are absent: an empty File menu is a bug
 * report, an absent one is a decision.
 *
 * The panels are the dock's own menu rather than this one's. Which panels
 * exist depends on the screen, and the list is assembled in `Inspector.tsx`
 * where that is known; reaching it from up here would mean either hoisting the
 * registry or keeping a copy, and a copy is the thing this file is careful not
 * to be. What is here is the one part of it that is global: putting the layout
 * back.
 */

import * as React from "react";

import { useMenuBehaviour } from "@/components/menu-keys";
import { appActions, VIEWS } from "@/palette/actions";
import type { AppShell, Item } from "@/palette/catalogue";
import { resetLayout } from "@/state/layout";
import { cn } from "@/cn";

/** One line of a menu. */
interface Command {
  id: string;
  label: string;
  keys?: string;
  hint?: string;
  run: () => void;
  /** False greys it rather than hiding it, so the menu keeps its shape. */
  enabled?: boolean;
  /** A tick, for a menu that says which one you are on. */
  on?: boolean;
}

type Line = Command | "rule";

interface MenuSpec {
  title: string;
  items: Line[];
}

/** What the undo pair looks like from here, whichever document is in front. */
export interface History {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

function isCommand(line: Line): line is Command {
  return line !== "rule";
}

export function menusFor(within: {
  shell: AppShell;
  history: History;
  onFontInfo: () => void;
  onToggleAcademy: () => void;
}): MenuSpec[] {
  const { shell, history, onFontInfo, onToggleAcademy } = within;

  /*
   * Looked up rather than rebuilt. An id that stops existing returns nothing
   * and the line is simply not drawn, which is why `line` returns null rather
   * than throwing: a renamed action should cost a menu entry, not the screen.
   * The test beside this file is what says the ids are still right.
   */
  const actions = appActions(shell);
  const byId = new Map<string, Item>(actions.map((item) => [item.id, item]));
  const line = (id: string, enabled = true): Command | null => {
    const item = byId.get(id);
    // An entry with nothing to run is a control the palette adjusts in place
    // rather than a verb, and there is nothing for a menu line to do with one.
    if (!item?.run) return null;
    const run = item.run;
    return { id, label: item.label, keys: item.keys, hint: item.hint, run, enabled };
  };

  const kept = (lines: Array<Line | null>): Line[] => lines.filter((one) => one !== null);

  const file: Line[] = kept([
    line("action:new"),
    "rule",
    line("action:open"),
    line("action:open-folder"),
    line("action:library"),
    line("action:reopen"),
    "rule",
    {
      id: "menu:font-info",
      label: "Font information",
      hint: "The family name, the style, and the numbers written into the file itself.",
      run: onFontInfo,
      enabled: shell.hasFont,
    },
    "rule",
    line("action:save", shell.hasFont),
    line("action:export", shell.hasFont),
  ]);

  const edit: Line[] = [
    {
      id: "menu:undo",
      label: "Undo",
      keys: "⌘Z",
      hint: "Take back the last change to whichever document is in front.",
      run: history.undo,
      enabled: history.canUndo,
    },
    {
      id: "menu:redo",
      label: "Redo",
      keys: "⌘⇧Z",
      hint: "Put back the change you just took away.",
      run: history.redo,
      enabled: history.canRedo,
    },
  ];

  /*
   * Every screen, with a tick on the one you are looking at -- which is what
   * separates this from the palette's list, and the reason the table is shared
   * rather than the rows.
   */
  const view: Line[] = VIEWS.map((one) => ({
    id: `menu:view:${one.id}`,
    label: one.label,
    hint: one.hint,
    keys: byId.get(`view:${one.id}`)?.keys,
    on: shell.mode === "edit" && shell.view === one.id,
    enabled: shell.hasFont,
    run: () => {
      shell.setMode("edit");
      shell.setView(one.id);
    },
  }));

  const fonts: Line[] = shell.openFonts.map((one, at) => ({
    id: `menu:font:${one.id}`,
    label: one.name,
    hint: "Another font you have open, with your selection and history where you left them.",
    keys: byId.get(`font:${one.id}`)?.keys,
    on: shell.mode === "edit" && at === shell.openAt,
    run: () => {
      shell.setMode("edit");
      shell.goToFont(at);
    },
  }));

  const window: Line[] = [
    ...fonts,
    ...(fonts.length > 0 ? (["rule"] as Line[]) : []),
    {
      id: "menu:reset-layout",
      label: "Put the panels back",
      hint: "Every panel shown again, in its first order, at the first width.",
      run: resetLayout,
    },
  ];

  const help: Line[] = kept([
    line("action:help"),
    {
      id: "menu:academy",
      label: "Lessons",
      hint: "How type is drawn, in short lessons, beside the tool that draws it.",
      run: onToggleAcademy,
    },
  ]);

  return [
    { title: "File", items: file },
    { title: "Edit", items: edit },
    { title: "View", items: view },
    { title: "Window", items: window },
    { title: "Help", items: help },
  ];
}

export function MenuBar(props: {
  shell: AppShell;
  history: History;
  onFontInfo: () => void;
  onToggleAcademy: () => void;
}): React.JSX.Element {
  const menus = menusFor(props);
  const [open, setOpen] = React.useState<string | null>(null);
  const titles = React.useRef<HTMLDivElement>(null);

  /*
   * What was open when the pointer went down.
   *
   * A menu closes itself on a window `pointerdown` anywhere outside it, and a
   * title is outside it -- so by the time the click arrives the menu has
   * already gone and a toggle reading the state would see nothing open and
   * open it again. Pressing the open title did nothing, twice.
   *
   * React's own handler runs at the root, which is inside the window listener
   * rather than after it, so this is read before that close and is the state
   * as the person saw it.
   */
  const wasOpen = React.useRef<string | null>(null);

  /*
   * Once one is open, moving across the titles opens the next without a second
   * click. This is the behaviour that makes a row of menus a menu bar rather
   * than a row of buttons, and it is the thing a hand raised on desktop
   * software does without deciding to.
   */
  const enter = (title: string): void => {
    if (open !== null) setOpen(title);
  };

  /*
   * The open title holds the focus, put there rather than assumed.
   *
   * WebKit does not focus a button when it is clicked -- long-standing Safari
   * behaviour, and the reason this is here rather than left to the click.
   * Without it a menu opened with the mouse left the focus on the body, so the
   * arrows walked nothing and Escape had nowhere to go back to: on Safari the
   * keyboard half of this simply did not work, in a way no amount of reading
   * the component would show.
   *
   * It also does the job the arrows used to do for themselves, so there is one
   * answer to "where is the focus" rather than two.
   */
  React.useEffect(() => {
    if (open === null) return;
    titles.current?.querySelector<HTMLButtonElement>(`[data-menu-title="${open}"]`)?.focus();
  }, [open]);

  /** The arrows walk the bar, from the titles and from inside an open menu. */
  const step = React.useCallback(
    (from: string, by: 1 | -1): void => {
      const at = menus.findIndex((menu) => menu.title === from);
      if (at < 0) return;
      setOpen(menus[(at + by + menus.length) % menus.length].title);
    },
    [menus],
  );

  return (
    <div
      ref={titles}
      role="menubar"
      aria-label="Main menu"
      data-menu-bar
      className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background px-2 py-0.5"
    >
      {menus.map((menu) => (
        <div key={menu.title} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === menu.title}
            data-menu-title={menu.title}
            onPointerDown={() => {
              wasOpen.current = open;
            }}
            onClick={() => setOpen(wasOpen.current === menu.title ? null : menu.title)}
            onMouseEnter={() => enter(menu.title)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                step(menu.title, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                step(menu.title, -1);
              } else if (event.key === "ArrowDown" && open !== menu.title) {
                event.preventDefault();
                setOpen(menu.title);
              }
            }}
            className={cn(
              "rounded px-2 py-1 text-xs-plus text-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              open === menu.title && "bg-accent text-accent-foreground",
            )}
          >
            {menu.title}
          </button>
          {open === menu.title && (
            <Dropdown
              menu={menu}
              onClose={(why) => {
                setOpen(null);
                if (why === "escape") {
                  titles.current
                    ?.querySelector<HTMLButtonElement>(`[data-menu-title="${menu.title}"]`)
                    ?.focus();
                }
              }}
              onStep={(by) => step(menu.title, by)}
              onRan={() => setOpen(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Dropdown({
  menu,
  onClose,
  onStep,
  onRan,
}: {
  menu: MenuSpec;
  onClose: (why: "escape" | "away" | "resize") => void;
  onStep: (by: 1 | -1) => void;
  onRan: () => void;
}): React.JSX.Element {
  const held = React.useRef<HTMLDivElement>(null);
  // The title keeps the focus, as it does everywhere else here: Escape then has
  // somewhere obvious to return to. See the note in `menu-keys.ts`.
  const { onKeyDown } = useMenuBehaviour({ menu: held, onClose, takeFocus: false });

  return (
    <div
      ref={held}
      role="menu"
      aria-label={menu.title}
      data-menu-list={menu.title}
      onKeyDown={(event) => {
        // The bar's own arrows first, so a left or right inside an open menu
        // moves to the neighbouring one rather than doing nothing.
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onStep(1);
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onStep(-1);
          return;
        }
        onKeyDown(event);
      }}
      className="absolute left-0 top-full z-40 mt-1 min-w-60 rounded-md border border-border bg-popover py-1 shadow-lg"
    >
      {menu.items.map((line, at) =>
        isCommand(line) ? (
          <button
            key={line.id}
            type="button"
            {...(line.on === undefined
              ? { role: "menuitem" as const }
              : { role: "menuitemradio" as const, "aria-checked": line.on })}
            data-menu-item
            data-menu-command={line.id}
            disabled={line.enabled === false}
            title={line.hint}
            onClick={() => {
              line.run();
              onRan();
            }}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs-plus",
              "text-popover-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <span aria-hidden className={cn("w-3 shrink-0", !line.on && "opacity-0")}>
              ✓
            </span>
            <span className="flex-1 truncate">{line.label}</span>
            {line.keys && (
              <kbd className="shrink-0 font-sans text-2xs text-muted-foreground">{line.keys}</kbd>
            )}
          </button>
        ) : (
          // A rule is not a thing to land on, so it is not an item.
          <div key={`rule-${at}`} aria-hidden className="my-1 h-px bg-border" />
        ),
      )}
    </div>
  );
}

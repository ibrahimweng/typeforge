/**
 * The quick action palette: one box that reaches everything.
 *
 * Two ideas, and the second is the one that matters. The first is the ordinary
 * one -- a shortcut opens a list, typing filters it, Enter runs the thing. The
 * second is that the list can be searched by describing what you want rather
 * than by naming it, because every control in this application already carries
 * a sentence saying what it does in a designer's vocabulary. "The gap between
 * letters is too big" finds kerning without either of those words appearing in
 * its name. See `search.ts` for how, and `synonyms.ts` for the words the
 * product does not use about itself.
 *
 * A control is adjusted here rather than jumped to. Somebody who typed
 * "fatter" wants the font fatter, and sending them to a panel with the right
 * slider highlighted is most of the way to an answer and not the answer. The
 * slider appears in the row, moves the real font behind the palette, and the
 * palette stays open so it can be moved again.
 */

import * as React from "react";

import { enter } from "@/anim/motion";
import { SliderControl } from "@/ui/components/controls/slider";
import { cn } from "@/ui/lib/utils";
import { catalogue, type Item, type Shell } from "./catalogue";
import { recentIds, remember } from "./recent";
import { buildIndex, PREFIXES, readQuery, search, type Hit } from "./search";

/** What the palette shows before anything is typed. */
const STARTING_POINTS = [
  "action:export",
  "action:open",
  "view:grid",
  "mode:forge",
  "param:weight",
  "action:help",
];

export interface QuickActionsProps {
  open: boolean;
  onClose: () => void;
  shell: Shell;
}

export function QuickActions({ open, onClose, shell }: QuickActionsProps): React.JSX.Element | null {
  const [typed, setTyped] = React.useState("");
  const [at, setAt] = React.useState(0);
  /** The row whose slider is showing, if any. */
  const [adjusting, setAdjusting] = React.useState<string | null>(null);
  /** A destructive action waiting to be confirmed. */
  const [confirming, setConfirming] = React.useState<Item | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  /*
   * Rebuilt whenever the shell changes, because half of what the palette
   * offers depends on where you are: the export action is named for the job in
   * front, and the modes list leaves out the one you are already in.
   */
  const items = React.useMemo(() => catalogue(shell), [shell]);
  const byId = React.useMemo(() => new Map(items.map((one) => [one.id, one])), [items]);
  const index = React.useMemo(() => buildIndex(items), [items]);

  const query = readQuery(typed);
  const showing: Hit[] = React.useMemo(() => {
    if (!typed.trim()) {
      const opening = [...recentIds(), ...STARTING_POINTS];
      const seen = new Set<string>();
      const out: Hit[] = [];
      for (const id of opening) {
        if (seen.has(id)) continue;
        seen.add(id);
        const item = byId.get(id);
        if (item) out.push({ entry: item, score: 0, because: [] });
      }
      return out;
    }
    return search(index, typed, 40);
  }, [typed, index, byId]);

  const results = React.useMemo(
    () => showing.map((hit) => byId.get(hit.entry.id)).filter((one): one is Item => Boolean(one)),
    [showing, byId],
  );

  /*
   * Which rows carry their group's heading: the best-ranked one in each group,
   * and no other.
   *
   * The list is in the order the search put it rather than gathered by group,
   * so a group can come up again further down -- and a heading printed twice
   * reads as a fault in the list rather than as an ordering.
   */
  const headings = React.useMemo(() => {
    const seen = new Set<string>();
    return results.map((item) => {
      if (seen.has(item.group)) return false;
      seen.add(item.group);
      return true;
    });
  }, [results]);

  React.useEffect(() => {
    setAt(0);
    setAdjusting(null);
  }, [typed]);

  React.useEffect(() => {
    if (!open) return;
    setTyped("");
    setAt(0);
    setAdjusting(null);
    setConfirming(null);
    // The animation and the focus both want the element on screen first.
    const id = window.requestAnimationFrame(() => {
      if (boxRef.current) enter(boxRef.current);
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Keep the highlighted row in view as the arrows walk down a long list.
  React.useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-at="${at}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const use = React.useCallback(
    (item: Item) => {
      if (item.adjust || item.choose || item.toggle) {
        // Nothing to run: it is adjusted where it stands.
        setAdjusting((was) => (was === item.id ? null : item.id));
        remember(item.id);
        return;
      }
      if (item.destructive) {
        setConfirming(item);
        return;
      }
      remember(item.id);
      item.run?.();
      onClose();
    },
    [onClose],
  );

  if (!open) return null;

  const confirm = confirming;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-6 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick actions"
        className="floating-popup-surface flex max-h-[70vh] w-[42rem] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (confirm) setConfirming(null);
            else if (adjusting) setAdjusting(null);
            else onClose();
            return;
          }
          if (confirm) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setAt((was) => Math.min(results.length - 1, was + 1));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setAt((was) => Math.max(0, was - 1));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const item = results[at];
            if (item) use(item);
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <SearchMark mark={query.mark} />
          <input
            ref={inputRef}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="What do you want to change?"
            aria-label="Search everything"
            className="h-12 flex-1 bg-transparent text-sm-plus outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-xs-plus text-muted-foreground">
              Nothing matches that. Try describing what you want to change — “the letters are too
              close together”, “rounder corners”, “a file I can install”.
            </p>
          )}
          {results.map((item, index) => (
            <Row
              key={item.id}
              item={item}
              at={index}
              chosen={index === at}
              adjusting={adjusting === item.id}
              onHover={() => setAt(index)}
              onPick={() => use(item)}
              first={headings[index]}
            />
          ))}
        </div>

        <Footer mark={query.mark} empty={!typed.trim()} />
      </div>

      {confirm && (
        <Confirm
          item={confirm}
          onCancel={() => setConfirming(null)}
          onGoOn={() => {
            remember(confirm.id);
            confirm.run?.();
            setConfirming(null);
            onClose();
          }}
        />
      )}
    </div>
  );
}

function SearchMark({ mark }: { mark: string | null }): React.JSX.Element {
  const found = PREFIXES.find((one) => one.mark === mark);
  return (
    <span
      aria-hidden
      className={cn(
        "font-mono text-sm",
        found ? "text-accent" : "text-muted-foreground",
      )}
      title={found ? `Only ${found.label}` : undefined}
    >
      {mark ?? "⌘"}
    </span>
  );
}

function Footer({ mark, empty }: { mark: string | null; empty: boolean }): React.JSX.Element {
  const found = PREFIXES.find((one) => one.mark === mark);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
      <span>
        {found
          ? `Only ${found.label}`
          : empty
            ? "Recent, then somewhere to start"
            : "Everything"}
      </span>
      <span className="flex items-center gap-3">
        {PREFIXES.map((one) => (
          <span key={one.mark}>
            <kbd className="rounded border border-border px-1 py-0.5 font-mono">{one.mark}</kbd>{" "}
            {one.label}
          </span>
        ))}
      </span>
    </div>
  );
}

interface RowProps {
  item: Item;
  at: number;
  chosen: boolean;
  adjusting: boolean;
  first: boolean;
  onHover: () => void;
  onPick: () => void;
}

function Row({ item, at, chosen, adjusting, first, onHover, onPick }: RowProps): React.JSX.Element {
  return (
    <>
      {first && (
        <p className="px-4 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {item.group}
        </p>
      )}
      <div
        data-at={at}
        role="option"
        aria-selected={chosen}
        tabIndex={-1}
        onMouseMove={onHover}
        onClick={onPick}
        className={cn(
          "cursor-pointer px-4 py-2",
          chosen ? "bg-accent/15" : "hover:bg-muted/40",
        )}
      >
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs-plus text-foreground">{item.label}</span>
          {item.where && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {item.where}
            </span>
          )}
          {item.destructive && (
            <span className="shrink-0 text-[10px] text-muted-foreground">asks first</span>
          )}
          {/*
            And the key, for the next time.

            A shortcut is learnt at the moment somebody takes the slow way to
            the thing it is for, which is exactly here. Pushed to the right, so
            the column of them reads down.
          */}
          {item.keys && (
            <kbd
              data-item-keys
              className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground"
            >
              {item.keys}
            </kbd>
          )}
        </div>
        {/*
          * The hint is the reason the result came back, so it is shown rather
          * than hidden behind a hover: a search that answers a description has
          * to say what it thinks you asked for.
          */}
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {item.hint}
        </p>
        {adjusting && <Adjuster item={item} />}
      </div>
    </>
  );
}

/**
 * The control itself, in the row, moving the real font behind the palette.
 *
 * The value is read once, when the row opens, and the slider owns it from
 * there. Read again on every change instead -- which is the obvious way to
 * write this, and how it was written first -- the slider is handed back the
 * value it had before the change it just made, snaps to it under the pointer,
 * and a drag across the whole track lands one step from where it began. The
 * font is still the truth; it is just not a truth worth asking for in the
 * middle of a gesture.
 */
function Adjuster({ item }: { item: Item }): React.JSX.Element | null {
  const [, redraw] = React.useReducer((count: number) => count + 1, 0);
  const opened = React.useRef<{ id: string; value: number } | null>(null);
  if (item.adjust && opened.current?.id !== item.id) {
    opened.current = { id: item.id, value: item.adjust.read() };
  }

  if (item.adjust) {
    return (
      <div className="mt-2" onClick={(event) => event.stopPropagation()}>
        <SliderControl
          name={item.short ?? item.label}
          value={opened.current!.value}
          min={item.adjust.min}
          max={item.adjust.max}
          step={item.adjust.step}
          showFill
          onValueChange={(next, meta) => {
            item.adjust!.write(next, meta?.history !== "merge");
          }}
        />
      </div>
    );
  }

  if (item.toggle) {
    const on = item.toggle.read();
    return (
      <button
        type="button"
        className="mt-2 rounded border border-border px-2 py-1 text-[11px]"
        onClick={(event) => {
          event.stopPropagation();
          item.toggle!.write(!on);
          redraw();
        }}
      >
        {on ? "On" : "Off"}
      </button>
    );
  }

  if (item.choose) {
    const now = item.choose.read();
    return (
      <div className="mt-2 flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
        {item.choose.options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            className={cn(
              "rounded border px-2 py-1 text-[11px]",
              option.value === now ? "border-accent text-accent" : "border-border",
            )}
            onClick={() => {
              item.choose!.write(option.value);
              redraw();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  return null;
}

function Confirm({
  item,
  onCancel,
  onGoOn,
}: {
  item: Item;
  onCancel: () => void;
  onGoOn: () => void;
}): React.JSX.Element {
  const goOn = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => goOn.current?.focus(), []);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={item.label}
        className="w-[24rem] rounded-xl border border-border bg-popover p-5 shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <p className="text-sm-plus text-foreground">{item.label}</p>
        <p className="mt-2 text-xs-plus text-muted-foreground">
          This throws away the work that is open. There is no undo for it.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 text-xs-plus"
          >
            Keep it
          </button>
          <button
            ref={goOn}
            type="button"
            onClick={onGoOn}
            className="rounded bg-accent px-3 py-1.5 text-xs-plus text-accent-foreground"
          >
            Go on
          </button>
        </div>
      </div>
    </div>
  );
}

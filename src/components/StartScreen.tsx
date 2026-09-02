/**
 * The first thing somebody sees, and the way back to work for everybody else.
 *
 * What was here before was called "No font open", and every word after that
 * headline was about files. It named four formats and a folder convention in
 * its first two sentences, put "Draw one from nothing" third, and left the
 * biggest thing this tool does -- make a typeface from nothing in about a
 * minute -- to be found by somebody who already knew to look for it.
 *
 * So the screen says what you can make rather than what you have not got, and
 * the three ways in are ranked. Drawing is first and marked, because it is the
 * one that ends with a whole alphabet on screen before anything is typed. The
 * formats are further down, under the route that needs them, where a person who
 * has a file is standing anyway.
 *
 * Somebody coming back is not shown any of this. Their work is put back before
 * the first frame is drawn, so they land in it; this screen is for a font that
 * is not there yet.
 */

import * as React from "react";

import { enterStaggered } from "@/anim/motion";
import { OUTLINE_ACTION, PRIMARY_ACTION } from "@/components/controls";
import { libraryStore } from "@/state/library-store";
import { store } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

/** One way in: what it makes, and what it wants from you. */
function Route({
  title,
  said,
  onGo,
  first,
  mark,
}: {
  title: string;
  said: string;
  onGo: () => void;
  first?: boolean;
  mark?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onGo}
      data-start-route={mark}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
        first
          ? "border-accent/60 bg-accent/5 hover:bg-accent/10"
          : "border-border hover:border-muted-foreground hover:bg-card",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-xs-plus font-medium text-foreground">{title}</span>
          {first && (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
              Start here
            </span>
          )}
        </span>
        <span className="mt-1 block text-2xs leading-relaxed text-muted-foreground">{said}</span>
      </span>
      <span
        aria-hidden
        className="mt-0.5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
    </button>
  );
}

/** Press a hidden file input by the mark the shell put on it. */
function press(mark: string): void {
  document.querySelector<HTMLInputElement>(mark)?.click();
}

export function StartScreen(): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current) enterStaggered(Array.from(ref.current.children) as Element[]);
  }, []);

  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
      <div ref={ref} className="w-full max-w-md">
        <h2 className="text-center text-base font-medium text-foreground">Make a typeface</h2>
        <p className="mt-1 text-center text-2xs text-muted-foreground">
          Three ways to start. The first gives you an alphabet straight away.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Route
            first
            mark="draw"
            title="Draw one from a style"
            said="Pick one of twenty families and a whole alphabet is drawn for you. Change the weight and the proportions until it looks like yours."
            onGo={() => store.askForMode("forge")}
          />
          <Route
            mark="trace"
            title="Trace a font you have"
            said="Read an existing font back into strokes you can reshape. Only use a font you have the right to work from."
            onGo={() => store.askForMode("quill")}
          />
          <Route
            mark="assemble"
            title="Assemble letters you drew"
            said="Bring in drawings you made somewhere else and turn them into a font."
            onGo={() => store.askForMode("assemble")}
          />
        </div>

        {/*
          The old first paragraph, moved to where it belongs.

          Somebody who has a font file wants one line and a button, not two
          paragraphs above the thing they came to do. Somebody who has not is
          no longer told about WOFF2 before they are told they can draw.
        */}
        <div className="mt-6 border-t border-border pt-5">
          <p className="text-2xs font-medium text-foreground">Or start from a font</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => press("[data-open-input]")} className={PRIMARY_ACTION}>
              Open a font
            </button>
            <button
              type="button"
              onClick={() => press("[data-open-folder-input]")}
              data-open-folder
              className={OUTLINE_ACTION}
            >
              Open a UFO folder
            </button>
            <button
              type="button"
              onClick={() => void libraryStore.show()}
              className={OUTLINE_ACTION}
            >
              Library
            </button>
            <button
              type="button"
              onClick={() => void store.loadSample()}
              className={OUTLINE_ACTION}
            >
              Try the sample font
            </button>
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
            TrueType, OpenType, WOFF, WOFF2 or a saved Typeforge project. A UFO is a folder rather
            than a file, so it has its own button. You can drop any of them anywhere in this window.
          </p>
        </div>

        <p className="mt-5 text-center text-2xs text-muted-foreground">
          Nothing is uploaded. Every font you open stays in this browser.
        </p>
      </div>
    </div>
  );
}

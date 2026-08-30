/**
 * The toolbar: what font is open, which view you are in, and the actions that
 * apply everywhere.
 */

import * as React from "react";

import type { Mode } from "@/App";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { forgeStore, useForge } from "@/state/useForge";
import { quillStore, useQuill } from "@/state/useQuill";
import { store, useAppState, type ToolId, type ViewId } from "@/state/useStore";
import {
  OUTLINE_ACTION,
  PRIMARY_ACTION,
  SEGMENT_TRACK,
  TOOLBAR_ACTION,
  segment,
} from "@/components/controls";
import { cn } from "@/ui/lib/utils";

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "grid", label: "Font" },
  { id: "glyph", label: "Glyph" },
  { id: "kerning", label: "Kerning" },
  { id: "metrics", label: "Spacing" },
  { id: "proof", label: "Proof" },
  { id: "report", label: "Checks" },
];

const TOOLS: Array<{ id: ToolId; label: string; hint: string }> = [
  { id: "select", label: "Select", hint: "Select and move points (V)" },
  { id: "pen", label: "Pen", hint: "Add points to an outline (P)" },
];

/** Whether the work is being written down between visits. */
export type Keeping = "kept" | "off" | "unknown";

const KEEPING: Record<Keeping, string> = {
  kept: "Save this project to a file. Your work is also kept in this browser.",
  off: "Save this project to a file. This browser is not keeping your work.",
  unknown: "Save this project to a file.",
};

export function TopBar({
  onOpenFile,
  onLibrary,
  onExport,
  onToggleHelp,
  helpOpen,
  mode,
  onMode,
  onSave,
  keeping,
}: {
  onOpenFile: () => void;
  onLibrary: () => void;
  onExport: () => void;
  onToggleHelp: () => void;
  helpOpen: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
  onSave: () => void;
  /** Whether the work is being kept between visits, for saying so. */
  keeping: Keeping;
}): React.JSX.Element {
  const state = useAppState();
  const forge = useForge();
  const assemble = useAssemble();
  const quill = useQuill();

  /*
   * Undo belongs to whichever document is in front.
   *
   * Wired to the imported font alone, the buttons sat there greyed out while a
   * font was being drawn, and pulling a stem across the stage could not be
   * taken back. The two halves keep their own history because they are two
   * documents, so the toolbar has to ask the one being looked at.
   */
  const history =
    mode === "forge"
      ? {
          undo: () => forgeStore.undo(),
          redo: () => forgeStore.redo(),
          canUndo: forge.canUndo,
          canRedo: forge.canRedo,
        }
      : mode === "assemble"
        ? {
            undo: () => assembleStore.undo(),
            redo: () => assembleStore.redo(),
            canUndo: assemble.canUndo,
            canRedo: assemble.canRedo,
          }
        : mode === "quill"
        ? {
            undo: () => quillStore.undo(),
            redo: () => quillStore.redo(),
            canUndo: quill.canUndo,
            canRedo: quill.canRedo,
          }
        : {
            undo: () => store.undo(),
            redo: () => store.redo(),
            canUndo: state.canUndo,
            canRedo: state.canRedo,
          };

  // Single-key shortcuts for the tools, as in every drawing application.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "v") store.setTool("select");
      if (event.key === "p") store.setTool("pen");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    /*
      Wraps rather than spills, and wraps into rows rather than into a gap.

      Every control in here is fixed-width and there are now three groups of
      them, so below about twelve hundred pixels the row is longer than the
      window — and a flex row that will not wrap does not hide its overflow, it
      puts it past the right-hand edge where nothing can reach it. Export was
      the first thing over the side, which is the one button somebody came here
      to press. A second line at a narrow window is a smaller cost than a
      missing button, and at any ordinary width nothing moves.

      What that first version got wrong was the second line. The right-hand
      group was held over there by `ml-auto`, and an auto margin does its job
      on whatever line the item lands on -- so once the group wrapped it was
      alone on a line of its own, still pushed to the right, with the whole
      width of the window empty beside it and the name of the open font
      stranded at the end of the line above. Two groups and `justify-between`
      say the same thing about a line that fits and the right thing about one
      that does not: a lone item on a line goes to the start of it, so the
      second row begins where a row begins.
    */
    <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-3 py-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-xs-plus font-medium tracking-tight">Typeforge</span>

      {/*
        The three jobs this does, which are not three views of one document.

        One word each rather than three. They were "Edit a font", "Draw a font"
        and "Assemble a font", which read better and cost about a hundred and
        thirty pixels of a toolbar that has none to spare: at thirteen hundred
        wide the name of the open font was squeezed to nothing at all. The
        group says what these are, and the longer phrasing is on the hover.
      */}
      <div className={SEGMENT_TRACK} role="group" aria-label="Mode">
        {(
          [
            ["edit", "Edit", "Edit a font somebody else made"],
            ["forge", "Draw", "Draw a font from nothing"],
            ["assemble", "Assemble", "Assemble a font from drawings"],
            ["quill", "Trace", "Read a font back into strokes and reshape it"],
          ] as Array<[Mode, string, string]>
        ).map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => onMode(id)}
            title={hint}
            className={segment(mode === id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={cn(SEGMENT_TRACK, mode !== "edit" && "hidden")} role="group" aria-label="View">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-pressed={state.view === view.id}
            onClick={() => store.setView(view.id)}
            className={segment(state.view === view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>

      {state.view === "glyph" && (
        <div className={cn(SEGMENT_TRACK, mode !== "edit" && "hidden")} role="group" aria-label="Tool">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.hint}
              aria-pressed={state.tool === tool.id}
              onClick={() => store.setTool(tool.id)}
              className={segment(state.tool === tool.id)}
            >
              {tool.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={history.undo}
          disabled={!history.canUndo}
          title="Undo (⌘Z)"
          className={TOOLBAR_ACTION}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={history.redo}
          disabled={!history.canRedo}
          title="Redo (⇧⌘Z)"
          className={TOOLBAR_ACTION}
        >
          Redo
        </button>
      </div>

      {mode === "forge" && (
        <span className="min-w-16 shrink truncate text-2xs text-muted-foreground">
          {forge.familyName}{" "}
          <span className="opacity-60">{forge.forge.base}</span>
        </span>
      )}
      {mode === "assemble" && (
        <span className="min-w-16 shrink truncate text-2xs text-muted-foreground">
          {assemble.familyName}{" "}
          <span className="opacity-60">
            {assemble.assembly.pieces.length} drawing
            {assemble.assembly.pieces.length === 1 ? "" : "s"}
          </span>
        </span>
      )}
      {mode === "edit" && state.typeface && (
        <span className="min-w-16 shrink truncate text-2xs text-muted-foreground">
          {state.typeface.meta.familyName}{" "}
          <span className="opacity-60">{state.typeface.meta.styleName}</span>
        </span>
      )}

      </div>

      <div className="flex items-center gap-2">
        {state.status && (
          <span
            className={cn(
              // Capped tight and allowed to shrink. At twenty-eight rem this
              // ran to three hundred and fifty pixels of "DejaVu Sans - 6,253
              // glyphs" and pushed the Export button clean off the right-hand
              // edge of a thirteen-hundred-wide window. The full text is on
              // the hover; the first few words are all it needs to show.
              "min-w-0 max-w-40 shrink truncate text-2xs",
              state.status.tone === "error" && "text-destructive",
              state.status.tone === "success" && "text-muted-foreground",
              state.status.tone === "info" && "text-muted-foreground",
            )}
            title={state.status.message}
          >
            {state.status.message}
          </span>
        )}
        {/*
          Said once, quietly, and only when it is worth saying.

          "Kept" is the ordinary state and needs no announcement — it is on the
          Save button's hover. What has to be visible is the other one: a
          private window, or storage switched off, means the work is not being
          kept and somebody should know that before they spend an afternoon in
          here rather than afterwards.
        */}
        {keeping === "off" && (
          <span className="shrink-0 text-2xs text-destructive" data-keeping="off">
            Not kept — save a file
          </span>
        )}
        <button
          type="button"
          onClick={onToggleHelp}
          aria-pressed={helpOpen}
          title="How Typeforge works"
          className={cn(TOOLBAR_ACTION, helpOpen && "bg-card text-foreground")}
        >
          Help
        </button>
        {/* Reachable from all three, because all three have something to do
            with somebody else's font: open it, draw from its proportions,
            borrow its spacing, or just put it behind your own letters. */}
        <button type="button" onClick={onLibrary} data-open-library className={OUTLINE_ACTION}>
          Library
        </button>
        {/*
          One door in, whatever is being brought through it.

          There were nearly two: a font opens here, and a saved project is also
          a thing somebody opens, so the toolbar was about to carry "Open font"
          next to "Open" and leave anybody to work out which was which. What
          arrives is identified from its own first bytes rather than from its
          name or from which button was pressed, so one button does both — and
          it is here in every mode, because a project can be a drawing or a
          pile of drawings as easily as a font.
        */}
        <button
          type="button"
          onClick={onOpenFile}
          title="Open a font or a saved Typeforge project"
          data-open-file
          className={OUTLINE_ACTION}
        >
          Open
        </button>
        {/*
          The work itself, as against the font that comes out of it.

          Kept separate from Export, because they are not two names for one
          thing: Export writes a font for other people to use and cannot be
          opened again, and this writes what you were doing so you can carry on
          doing it. Calling both of them "save" is how a tool ends up with
          somebody's afternoon inside a .ttf they cannot get back out.
        */}
        <button
          type="button"
          onClick={onSave}
          title={KEEPING[keeping]}
          data-save-project
          data-keeping={keeping}
          className={OUTLINE_ACTION}
        >
          Save
        </button>
        <button
          type="button"
          onClick={onExport}
          // A drawn font is always ready to leave. An imported one needs to
          // have been imported, and an assembled one needs something in the
          // pile to assemble.
          disabled={
            (mode === "edit" && !state.typeface) ||
            (mode === "assemble" && assemble.assembly.pieces.length === 0)
          }
          className={PRIMARY_ACTION}
        >
          {/*
            One word, in all four modes.

            This read "Export" in the edit mode and "Download" in the other
            three, from one line of code, and the two names described the same
            thing: a font file written out of whatever document is in front of
            you. Nothing about a drawn font makes leaving a different act from
            what an opened one does, and somebody who learns the button in one
            mode should not have to find it again in the next.

            "Export" rather than "Download" because it is the word the trade
            uses and the word every other editor puts on this button; and
            because "download" describes what the browser does afterwards
            rather than what this does, which is to build a font out of the
            drawing. The dialogs that open from here still say Download on the
            button that actually produces the file, which is the moment the
            browser really is downloading something.
          */}
          Export
        </button>
      </div>
    </header>
  );
}

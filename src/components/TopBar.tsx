/**
 * The toolbar: what font is open, which view you are in, and the actions that
 * apply everywhere.
 */

import * as React from "react";

import type { Mode } from "@/App";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { forgeStore, useForge } from "@/state/useForge";
import { quillStore, useQuill } from "@/state/useQuill";
import { store, useAppState, type ViewId } from "@/state/useStore";
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
  onFontInfo,
  onToggleHelp,
  helpOpen,
  onToggleAcademy,
  academyOpen,
  mode,
  onMode,
  onSave,
  keeping,
}: {
  onOpenFile: () => void;
  onLibrary: () => void;
  onExport: () => void;
  onFontInfo: () => void;
  onToggleHelp: () => void;
  helpOpen: boolean;
  onToggleAcademy: () => void;
  academyOpen: boolean;
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
            /*
             * Held shut over a borrowed letter.
             *
             * A letter lent to the tools from Draw has the document that was
             * open put aside behind it. Walking to another tab would leave the
             * loan on the desk and the real font in a drawer, with nothing on
             * screen to say why -- and the strip above the canvas says the only
             * ways out are keeping the drawing and throwing it away, which had
             * better be true.
             */
            disabled={state.loan !== null && id !== mode}
            title={
              state.loan === null
                ? hint
                : `Finish with ${state.loan.letter} first — keep the drawing or throw it away.`
            }
            className={cn(segment(mode === id), "disabled:opacity-40")}
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
      {/*
        And Trace, which was the one mode that named nothing.

        Three of the four said what was open -- `Untitled Regular`, `Untitled
        Sans`, `Untitled 0 drawings` -- and the fourth left the space blank, so
        the one mode whose whole subject is a font somebody else made was also
        the one that never said which font. It says what it was traced from,
        because that is the thing a person needs to be sure of here.
      */}
      {mode === "quill" && (
        <span className="min-w-16 shrink truncate text-2xs text-muted-foreground">
          {quill.document.name || "Untitled"}{" "}
          <span className="opacity-60">
            {quill.document.letters.length === 0
              ? "nothing traced"
              : `${quill.document.letters.length} letters from ${quill.document.from}`}
          </span>
        </span>
      )}
      {/*
        The font's name, which is now the way to change it.

        It has always been shown here and done nothing. A thing you can read is
        the natural place to go to change it, and it costs this toolbar
        nothing -- which matters, because there is no room on it for a button
        that would say the same.
      */}
      {mode === "edit" && state.typeface && (
        <button
          type="button"
          onClick={onFontInfo}
          data-font-name
          title="The font's name, designer, licence and lines"
          className="min-w-16 shrink truncate rounded px-1 text-left text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          {state.typeface.meta.familyName}{" "}
          <span className="opacity-60">{state.typeface.meta.styleName}</span>
        </button>
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
        {/*
          Before Help rather than after it, because it is the one somebody
          arriving needs and Help is the one they need later. `Help` answers
          "what does this control do"; `Learn` answers "I have never made a
          typeface", which is the question a first visit actually brings.
        */}
        <button
          type="button"
          onClick={onToggleAcademy}
          aria-pressed={academyOpen}
          data-open-academy
          title="Type Academy — four short courses on making type, done in the tool"
          className={cn(TOOLBAR_ACTION, academyOpen && "bg-card text-foreground")}
        >
          Learn
        </button>
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
          /*
            A drawn font is always ready to leave, because the forge always
            has a family. The other three have to have something in them: an
            imported font has to have been imported, an assembled one needs
            drawings in the pile, and a traced one needs a font to have been
            read.

            The traced case was missing, and it showed: pressing Export in
            Trace with nothing read opened a dialog offering to download "0
            letters" with its own Download greyed out. The button beside it
            that hands the letters to the editor had always known better.
          */
          disabled={
            (mode === "edit" && !state.typeface) ||
            (mode === "assemble" && assemble.assembly.pieces.length === 0) ||
            (mode === "quill" && quill.document.letters.length === 0)
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

/**
 * The toolbar: what font is open, which view you are in, and the actions that
 * apply everywhere.
 */

import * as React from "react";

import type { Mode } from "@/App";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { forgeStore, useForge } from "@/state/useForge";
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
  { id: "report", label: "Checks" },
];

const TOOLS: Array<{ id: ToolId; label: string; hint: string }> = [
  { id: "select", label: "Select", hint: "Select and move points (V)" },
  { id: "pen", label: "Pen", hint: "Add points to an outline (P)" },
];

export function TopBar({
  onOpenFile,
  onLibrary,
  onExport,
  onToggleHelp,
  helpOpen,
  mode,
  onMode,
}: {
  onOpenFile: () => void;
  onLibrary: () => void;
  onExport: () => void;
  onToggleHelp: () => void;
  helpOpen: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
}): React.JSX.Element {
  const state = useAppState();
  const forge = useForge();
  const assemble = useAssemble();

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
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3">
      <span className="text-xs-plus font-medium tracking-tight">Typeforge</span>

      {/* The three jobs this does, which are not three views of one document. */}
      <div className={SEGMENT_TRACK} role="group" aria-label="Mode">
        {(
          [
            ["edit", "Edit a font"],
            ["forge", "Draw a font"],
            ["assemble", "Assemble a font"],
          ] as Array<[Mode, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => onMode(id)}
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
        <span className="min-w-0 truncate text-2xs text-muted-foreground">
          {forge.familyName}
          <span className="pl-1.5 opacity-60">{forge.forge.base}</span>
        </span>
      )}
      {mode === "assemble" && (
        <span className="min-w-0 truncate text-2xs text-muted-foreground">
          {assemble.familyName}
          <span className="pl-1.5 opacity-60">
            {assemble.assembly.pieces.length} drawing
            {assemble.assembly.pieces.length === 1 ? "" : "s"}
          </span>
        </span>
      )}
      {mode === "edit" && state.typeface && (
        <span className="min-w-0 truncate text-2xs text-muted-foreground">
          {state.typeface.meta.familyName}
          <span className="pl-1.5 opacity-60">{state.typeface.meta.styleName}</span>
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {state.status && (
          <span
            className={cn(
              "max-w-md truncate text-2xs",
              state.status.tone === "error" && "text-destructive",
              state.status.tone === "success" && "text-muted-foreground",
              state.status.tone === "info" && "text-muted-foreground",
            )}
          >
            {state.status.message}
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
        {mode === "edit" && (
          <button type="button" onClick={onOpenFile} className={OUTLINE_ACTION}>
            Open font
          </button>
        )}
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
          {mode === "edit" ? "Export" : "Download"}
        </button>
      </div>
    </header>
  );
}

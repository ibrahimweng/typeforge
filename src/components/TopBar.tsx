/**
 * The toolbar: what font is open, which view you are in, and the actions that
 * apply everywhere.
 */

import * as React from "react";

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
  onExport,
  onToggleHelp,
  helpOpen,
}: {
  onOpenFile: () => void;
  onExport: () => void;
  onToggleHelp: () => void;
  helpOpen: boolean;
}): React.JSX.Element {
  const state = useAppState();

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

      <div className={SEGMENT_TRACK} role="group" aria-label="View">
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
        <div className={SEGMENT_TRACK} role="group" aria-label="Tool">
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
          onClick={() => store.undo()}
          disabled={!state.canUndo}
          title="Undo (⌘Z)"
          className={TOOLBAR_ACTION}
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => store.redo()}
          disabled={!state.canRedo}
          title="Redo (⇧⌘Z)"
          className={TOOLBAR_ACTION}
        >
          Redo
        </button>
      </div>

      {state.typeface && (
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
        <button
          type="button"
          onClick={onOpenFile}
          className={OUTLINE_ACTION}
        >
          Open font
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={!state.typeface}
          className={PRIMARY_ACTION}
        >
          Export
        </button>
      </div>
    </header>
  );
}

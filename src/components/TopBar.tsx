/**
 * The toolbar: what font is open, which view you are in, and the actions that
 * apply everywhere.
 */

import * as React from "react";

import { store, useAppState, type ToolId, type ViewId } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

const VIEWS: Array<{ id: ViewId; label: string }> = [
  { id: "grid", label: "Font" },
  { id: "glyph", label: "Glyph" },
  { id: "kerning", label: "Kerning" },
  { id: "metrics", label: "Spacing" },
];

const TOOLS: Array<{ id: ToolId; label: string; hint: string }> = [
  { id: "select", label: "Select", hint: "Select and move points (V)" },
  { id: "pen", label: "Pen", hint: "Add points to an outline (P)" },
];

export function TopBar({
  onOpenFile,
  onExport,
}: {
  onOpenFile: () => void;
  onExport: () => void;
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

      <div className="flex items-center gap-0.5 rounded-md bg-card/60 p-0.5">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => store.setView(view.id)}
            className={cn(
              "rounded px-2.5 py-1 text-2xs transition-colors",
              state.view === view.id
                ? "bg-card text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {view.label}
          </button>
        ))}
      </div>

      {state.view === "glyph" && (
        <div className="flex items-center gap-0.5 rounded-md bg-card/60 p-0.5">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              title={tool.hint}
              onClick={() => store.setTool(tool.id)}
              className={cn(
                "rounded px-2.5 py-1 text-2xs transition-colors",
                state.tool === tool.id
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
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
          className="rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => store.redo()}
          disabled={!state.canRedo}
          title="Redo (⇧⌘Z)"
          className="rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
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
          onClick={onOpenFile}
          className="rounded-md border border-border px-2.5 py-1 text-2xs transition-colors hover:border-muted-foreground"
        >
          Open font
        </button>
        <button
          type="button"
          onClick={onExport}
          disabled={!state.typeface}
          className="rounded-md bg-accent px-2.5 py-1 text-2xs text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Export
        </button>
      </div>
    </header>
  );
}

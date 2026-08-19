/**
 * The application shell: toolbar, the current view, and the inspector.
 *
 * A font can be dropped anywhere in the window, which is how most people will
 * open one.
 */

import * as React from "react";

import { switchView } from "@/anim/motion";
import { ExportDialog } from "@/components/ExportDialog";
import { Inspector } from "@/components/Inspector";
import { TopBar } from "@/components/TopBar";
import { store, useAppState } from "@/state/useStore";
import { FontGridView } from "@/views/FontGridView";
import { GlyphEditorView } from "@/views/GlyphEditorView";
import { KerningView } from "@/views/KerningView";
import { MetricsView } from "@/views/MetricsView";

export function App(): React.JSX.Element {
  const state = useAppState();
  const [exporting, setExporting] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const previousView = React.useRef(state.view);

  React.useEffect(() => {
    if (previousView.current !== state.view) {
      switchView(null, stageRef.current);
      previousView.current = state.view;
    }
  }, [state.view]);

  const openFiles = React.useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await store.loadFont(bytes, file.name);
  }, []);

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // Ignore the events fired while moving between child elements.
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void openFiles(event.dataTransfer.files);
      }}
    >
      <TopBar onOpenFile={() => inputRef.current?.click()} onExport={() => setExporting(true)} />

      <div className="flex min-h-0 flex-1">
        <div ref={stageRef} className="flex min-w-0 flex-1 flex-col">
          {state.view === "grid" && <FontGridView />}
          {state.view === "glyph" && <GlyphEditorView />}
          {state.view === "kerning" && <KerningView />}
          {state.view === "metrics" && <MetricsView />}
        </div>
        <Inspector />
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
        className="hidden"
        onChange={(event) => {
          void openFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-accent/10 backdrop-blur-[1px]">
          <p className="rounded-lg border border-accent bg-popover px-4 py-2.5 text-xs-plus">
            Drop to open the font
          </p>
        </div>
      )}

      {state.busy && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-pulse bg-accent" />
        </div>
      )}

      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}

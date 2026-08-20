/**
 * The application shell: toolbar, the current view, and the inspector.
 *
 * A font can be dropped anywhere in the window, which is how most people will
 * open one.
 */

import * as React from "react";

import { attachPressFeedback, switchView } from "@/anim/motion";
import { AssembleExportDialog } from "@/components/AssembleExportDialog";
import { AssemblePanel } from "@/components/AssemblePanel";
import { ExportDialog } from "@/components/ExportDialog";
import { ForgeExportDialog } from "@/components/ForgeExportDialog";
import { ForgePanel } from "@/components/ForgePanel";
import { HelpDrawer } from "@/components/HelpDrawer";
import { Inspector } from "@/components/Inspector";
import { TopBar } from "@/components/TopBar";
import { assembleStore } from "@/state/useAssemble";
import { store, useAppState } from "@/state/useStore";
import { FontGridView } from "@/views/FontGridView";
import { GlyphEditorView } from "@/views/GlyphEditorView";
import { KerningView } from "@/views/KerningView";
import { MetricsView } from "@/views/MetricsView";
import { AssembleView } from "@/views/AssembleView";
import { ForgeView } from "@/views/ForgeView";
import { ReportView } from "@/views/ReportView";

/** Which of the three jobs is in front. */
export type Mode = "edit" | "forge" | "assemble";

export function App(): React.JSX.Element {
  const state = useAppState();
  const [exporting, setExporting] = React.useState(false);
  const [helping, setHelping] = React.useState(false);
  /*
   * Which of the three jobs is in front.
   *
   * Genuinely different jobs, not three views of one document: reshaping a
   * font somebody else made, drawing one from a description, and building one
   * out of artwork that was never a font. They share the engine underneath and
   * almost nothing above it, so they are a switch rather than a view.
   *
   * Assembling is the newest and the one that needed the clearest separation.
   * It looks superficially like drawing -- letters on a stage, a specimen line
   * -- and behaves nothing like it: there are no parts, no pen, and no way to
   * change a letterform, because the letterforms arrived finished. Folding it
   * into the drawing mode would have put a panel full of controls next to
   * outlines that none of them reach.
   */
  const [mode, setMode] = React.useState<Mode>("edit");
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const previousView = React.useRef(state.view);

  // One listener covers every control in the app, including any added later.
  React.useEffect(() => attachPressFeedback(document.body), []);

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

  /*
   * What a drop means depends on which job is in front.
   *
   * A font file dropped on the editor opens it. A pile of drawings dropped on
   * the assembler joins the pile -- and it is a pile, so unlike everywhere
   * else in this application the drop takes every file rather than the first.
   */
  const dropFiles = React.useCallback(
    async (files: FileList | null) => {
      if (mode === "assemble") {
        await assembleStore.take([...(files ?? [])]);
        return;
      }
      await openFiles(files);
    },
    [mode, openFiles],
  );

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
        void dropFiles(event.dataTransfer.files);
      }}
    >
      <TopBar
        onOpenFile={() => inputRef.current?.click()}
        onExport={() => setExporting(true)}
        onToggleHelp={() => setHelping((open) => !open)}
        helpOpen={helping}
        mode={mode}
        onMode={setMode}
      />

      <div className="flex min-h-0 flex-1">
        <div ref={stageRef} className="flex min-w-0 flex-1 flex-col">
          {mode === "forge" && <ForgeView />}
          {mode === "assemble" && <AssembleView />}
          {mode === "edit" && (
            <>
              {state.view === "grid" && <FontGridView />}
              {state.view === "glyph" && <GlyphEditorView />}
              {state.view === "kerning" && <KerningView />}
              {state.view === "metrics" && <MetricsView />}
              {state.view === "report" && <ReportView />}
            </>
          )}
        </div>
        {mode === "forge" && <ForgePanel />}
        {mode === "assemble" && <AssemblePanel />}
        {mode === "edit" && <Inspector />}
        {helping && <HelpDrawer onClose={() => setHelping(false)} />}
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
            {mode === "assemble" ? "Drop the drawings in" : "Drop to open the font"}
          </p>
        </div>
      )}

      {state.busy && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden">
          <div className="h-full w-1/3 animate-pulse bg-accent" />
        </div>
      )}

      {exporting && mode === "forge" && <ForgeExportDialog onClose={() => setExporting(false)} />}
      {exporting && mode === "assemble" && (
        <AssembleExportDialog onClose={() => setExporting(false)} />
      )}
      {exporting && mode === "edit" && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}

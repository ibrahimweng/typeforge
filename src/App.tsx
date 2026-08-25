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
import { LibraryDialog } from "@/components/LibraryDialog";
import { QuickActions, useQuickActionShortcut, type Shell } from "@/palette";
import { Inspector } from "@/components/Inspector";
import { TopBar } from "@/components/TopBar";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { forgeStore, useForge } from "@/state/useForge";
import { castFor, castOf, cutsFor, cutsOf } from "@/forge/document";
import { ready as readyToCut } from "@/font/boolean";
import { detectFormat } from "@/font/parse";
import { describe, readProject } from "@/project/format";
import { keeper as makeKeeper, kept } from "@/project/keep";
import { fileNameFor, restore, session } from "@/project/session";
import type { Keeping } from "@/components/TopBar";
import { libraryStore } from "@/state/useLibrary";
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
  const forge = useForge();
  const assemble = useAssemble();
  const [exporting, setExporting] = React.useState(false);
  const [helping, setHelping] = React.useState(false);
  const [quick, setQuick] = React.useState(false);
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
  const [keeping, setKeeping] = React.useState<Keeping>("unknown");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const previousView = React.useRef(state.view);

  // One listener covers every control in the app, including any added later.
  React.useEffect(() => attachPressFeedback(document.body), []);

  /*
   * The boolean library, fetched before anything needs it.
   *
   * Cutting a letter is boolean geometry and boolean geometry is a few hundred
   * kilobytes, which is not something to load before the application has
   * appeared. It is also not something a letter can wait for: a letter is
   * drawn during a render, forty times a second while a slider moves, and
   * there is nowhere in that to await a download.
   *
   * So it is fetched once, in the background, and until it lands a letter with
   * slots through it is drawn without them -- which is an honest answer for a
   * moment rather than a wrong one for ever. When it arrives the drawing is
   * asked to happen again -- in all three halves of the application, because
   * a font somebody opened and a pile of drawings somebody dropped are cut by
   * the same library and were drawn without it for the same moment.
   */
  React.useEffect(() => {
    let live = true;
    void readyToCut().then(() => {
      if (!live) return;
      forgeStore.refresh();
      store.refresh();
      assembleStore.refresh();
    });
    return () => {
      live = false;
    };
  }, []);

  /*
   * The work, kept between visits.
   *
   * Nothing used to be. Closing the tab lost the afternoon with no prompt, and
   * for a tool somebody draws a typeface in that is the fault that costs most:
   * everything else costs time, and this one costs the drawing.
   *
   * What comes back is put back before anything is drawn, so arriving looks
   * like never having left rather than like a font appearing a moment later.
   */
  const keeper = React.useRef(makeKeeper()).current;
  const restoring = React.useRef(true);

  React.useEffect(() => {
    let live = true;
    void (async () => {
      // Named apart from the `mode` on screen: this is the one the document
      // asked for, and it is what gets written back even if putting it back
      // went wrong.
      let was: Mode = "edit";
      try {
        const saved = await kept();
        if (!live) return;
        if (saved) {
          was = saved.mode;
          const back = await restore(saved);
          if (!live) return;
          setMode(back.mode);
          if (back.halves.length > 0) {
            store.say(`Picked up where you left off — ${back.halves.join(", ")}.`);
          }
        }
      } catch {
        /*
         * A kept session that will not come back is a bad half-hour, not a
         * broken tool. Whatever is in there is left alone rather than deleted
         * -- a font that failed to parse today because of a bug is a font that
         * parses tomorrow -- and the next edit writes over it anyway.
         */
        if (live) store.say("Could not pick up where you left off.", "error");
      } finally {
        if (live) {
          // Whether this browser will keep anything is not a question with an
          // answer until something has been written, so it is asked by writing.
          setKeeping((await keeper.now(() => session(was))) ? "kept" : "off");
        }
        restoring.current = false;
      }
    })();
    return () => {
      live = false;
      keeper.stop();
    };
  }, [keeper]);

  /*
   * Written down once the drawing stops changing.
   *
   * Every store bumps a revision on every edit, so watching those catches
   * everything without any of them having to know this exists. The guard is for
   * the moment of restoring: putting a document back is itself a change, and
   * without it the first thing a restored session does is save itself again.
   */
  const revisions = `${state.revision}:${forge.revision}:${assemble.revision}:${mode}`;
  React.useEffect(() => {
    if (restoring.current) return;
    keeper.soon(() => session(mode));
  }, [revisions, keeper, mode]);

  /*
   * And written down on the way out, without waiting for the pause.
   *
   * The pause is what keeps a drag from serialising a font a hundred times a
   * second, but it also means the last second of work is still only in memory
   * -- and the last second of work is exactly what somebody has just done when
   * they close the tab. Hiding the page flushes it.
   *
   * `visibilitychange` rather than `beforeunload`: it is the one every browser
   * fires on the ways a tab actually goes away, including being swapped out on
   * a phone, and it does not offer to keep anybody here with a dialog. The
   * write is asked for and not waited on, since there may be nothing left to
   * wait with; that is a better last second than none.
   */
  React.useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && !restoring.current) {
        void keeper.now(() => session(mode));
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [keeper, mode]);

  const saveProject = React.useCallback(() => {
    const project = session(mode);
    const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileNameFor(project);
    link.click();
    // Given back after the click rather than immediately: revoked too early,
    // Safari has already thrown the download away.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    store.say(`Saved ${fileNameFor(project)} — ${describe(project)}.`);
  }, [mode]);

  const openProject = React.useCallback(async (file: File, bytes: Uint8Array) => {
    let project = null;
    try {
      project = readProject(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      project = null;
    }
    if (!project) {
      // Said as the two things it could have been, since by here it is neither
      // and "could not be read" leaves somebody guessing which one they missed.
      store.say(`${file.name} is not a font or a Typeforge project.`, "error");
      return;
    }
    const back = await restore(project);
    setMode(back.mode);
    store.say(`Opened ${file.name} — ${back.halves.join(", ") || "nothing in it"}.`);
  }, []);

  React.useEffect(() => {
    if (previousView.current !== state.view) {
      switchView(null, stageRef.current);
      previousView.current = state.view;
    }
  }, [state.view]);

  /*
   * Whatever was brought in, opened as what it is.
   *
   * A font and a saved project both arrive through this one door -- the button,
   * and the whole window as a drop target -- and which of the two it is comes
   * from the first four bytes rather than from the file's name. Names are the
   * wrong witness: browsers rename downloads, people rename files, and a
   * project saved as "Bakerloo.typeforge" is as likely to reach here called
   * "Bakerloo (1).typeforge" or nothing recognisable at all.
   */
  const openFiles = React.useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (detectFormat(bytes) !== "unknown") {
        await store.loadFont(bytes, file.name);
        return;
      }
      await openProject(file, bytes);
    },
    [openProject],
  );

  /*
   * What a drop means depends on which job is in front.
   *
   * A font file dropped on the editor opens it. A pile of drawings dropped on
   * the assembler joins the pile -- and it is a pile, so unlike everywhere
   * else in this application the drop takes every file rather than the first.
   */
  const dropFiles = React.useCallback(
    async (files: FileList | null) => {
      // A pile of drawings is what this half is for, so that is where a drop
      // goes -- unless it is one saved project, which is a thing somebody drags
      // in from wherever they keep their work and should not have to be in the
      // right half of the application to do.
      const dropped = [...(files ?? [])];
      const project = dropped.length === 1 && dropped[0].name.endsWith(".typeforge");
      if (mode === "assemble" && !project) {
        await assembleStore.take(dropped);
        return;
      }
      await openFiles(files);
    },
    [mode, openFiles],
  );

  /*
   * Everything the palette can do, gathered in one place.
   *
   * Handed to it rather than reached for, so the palette stays a description
   * of what the product offers and the wiring stays here with the rest of it.
   * Every one of these is already a button somewhere: the palette is a second
   * door to the same rooms, not a second set of rooms.
   */
  const shell: Shell = React.useMemo(
    () => ({
      mode,
      setMode,
      view: state.view,
      setView: (view) => store.setView(view),
      openFile: () => inputRef.current?.click(),
      export: () => setExporting(true),
      save: saveProject,
      newProject: () => {
        store.startBlank();
        setMode("edit");
      },
      toggleHelp: () => setHelping((was) => !was),
      library: () => void libraryStore.show(),
      selectGlyph: (name) => store.selectGlyph(name, { open: true }),
      /*
       * Read off the store rather than off this render.
       *
       * Two things go wrong when these close over the values React has in hand.
       * The palette moves a control and then reads it back to draw the slider,
       * and what it reads is the value from before the move -- so the slider
       * snaps back under the pointer and a drag across the whole track lands
       * one step from where it started. And the shell would have to be rebuilt
       * on every edit, which rebuilds the catalogue and its index: five hundred
       * entries and a word count of every hint, forty times a second while a
       * slider moves.
       *
       * Asking the store each time costs a property lookup and is always
       * right.
       */
      paramOf: (key) => store.getSnapshot().typeface?.params[key] ?? 0,
      setParam: (key, value) => store.setFamilyParam(key, value),
      partOf: (part, key) =>
        (
          forgeStore.getSnapshot().forge.style.parts[part] as Record<
            string,
            number | string | boolean
          >
        )[key],
      setPart: (part, key, value, done) =>
        forgeStore.changePart(part, { [key]: value }, done ? "end" : "during"),
      penOf: (key) =>
        (forgeStore.getSnapshot().forge.style.pen as unknown as Record<string, number>)[key],
      setPen: (key, value, done) =>
        forgeStore.changePen({ [key]: value } as never, done ? "end" : "during"),
      metricOf: (key) =>
        (forgeStore.getSnapshot().forge.style.metrics as unknown as Record<string, number>)[key],
      setMetric: (key, value, done) =>
        forgeStore.changeMetrics({ [key]: value } as never, done ? "end" : "during"),
      /*
       * Read through the same scope the cut panel reads through.
       *
       * A cut is not kept on the style beside the pen -- it belongs to the
       * document, and in letter scope a letter can be cut differently from the
       * font around it. Reading the family's value while the panel shows the
       * letter's would put a number in the palette that nothing on the canvas
       * is cut by, so the palette asks the question the panel asks.
       */
      cutOf: (cut, key) => {
        const { forge, scope, letter } = forgeStore.getSnapshot();
        const cuts = scope === "letter" ? cutsFor(letter, forge) : cutsOf(forge);
        return (cuts[cut] as unknown as Record<string, number | string | boolean>)[key];
      },
      setCut: (cut, key, value, done) =>
        forgeStore.changeCut(cut, { [key]: value } as never, done ? "end" : "during"),
      castOf: (cast, key) => {
        const { forge, scope, letter } = forgeStore.getSnapshot();
        const worn = scope === "letter" ? castFor(letter, forge) : castOf(forge);
        return (worn[cast] as unknown as Record<string, number | string | boolean>)[key];
      },
      setCast: (cast, key, value, done) =>
        forgeStore.changeCast(cast, { [key]: value } as never, done ? "end" : "during"),
      startFromBase: (name) => forgeStore.startFromBase(name),
      chooseAlternate: (letter, form) => {
        forgeStore.select(letter);
        forgeStore.chooseAlternate(form);
      },
      hasFont: Boolean(state.typeface),
    }),
    // Only what changes the shape of the catalogue: which job is in front and
    // which view it is showing. The values themselves are read live, above.
    [mode, state.view, state.typeface, saveProject],
  );

  useQuickActionShortcut(React.useCallback(() => setQuick(true), []));

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
        onLibrary={() => void libraryStore.show()}
        onExport={() => setExporting(true)}
        onToggleHelp={() => setHelping((open) => !open)}
        helpOpen={helping}
        mode={mode}
        onMode={setMode}
        onSave={saveProject}
        keeping={keeping}
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
        accept=".ttf,.otf,.woff,.woff2,.typeforge,font/ttf,font/otf,font/woff,font/woff2,application/json"
        className="hidden"
        data-open-input
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

      <QuickActions open={quick} onClose={() => setQuick(false)} shell={shell} />

      <LibraryDialog mode={mode} onMode={setMode} />

      {exporting && mode === "forge" && <ForgeExportDialog onClose={() => setExporting(false)} />}
      {exporting && mode === "assemble" && (
        <AssembleExportDialog onClose={() => setExporting(false)} />
      )}
      {exporting && mode === "edit" && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}

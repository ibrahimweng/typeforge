/**
 * The application shell: toolbar, the current view, and the inspector.
 *
 * A font can be dropped anywhere in the window, which is how most people will
 * open one.
 */

import * as React from "react";

import { attachPressFeedback, switchView } from "@/anim/motion";
import { loadingTwice } from "@/deferred";
import { GlyphEditorView } from "@/views/GlyphEditorView";
import { KerningView } from "@/views/KerningView";
import { LibraryDialog } from "@/components/LibraryDialog";
import { useQuickActionShortcut } from "@/palette/useShortcut";
import type { AppShell } from "@/palette/catalogue";
import { useAppKeys } from "@/keys/useAppKeys";
import { NextStep } from "@/components/NextStep";
import { OnLoan } from "@/components/OnLoan";
import { TopBar } from "@/components/TopBar";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import type { Typeface } from "@/font/types";
import { useDrawing } from "@/state/drawn";
import { quillStore, useQuill } from "@/state/useQuill";
import { ready as readyToCut } from "@/font/boolean";
import { detectFormat } from "@/font/parse";
import { looksJoined } from "@/quill/joined";
import { toTypeface as quillToTypeface } from "@/quill/typeface";
import { describe, readProject, type Mode as SavedMode } from "@/project/format";
import { keeper as makeKeeper, kept } from "@/project/keep";
import { fileNameFor, restore, session } from "@/project/session";
import type { Keeping } from "@/components/TopBar";
import { libraryStore } from "@/state/useLibrary";
import { store, useAppState, type ViewId } from "@/state/useStore";
import type { UfoFiles } from "@/ufo/font";
import { filesFromDrop, filesFromPicker, filesFromZip, looksZipped } from "@/ufo/intake";

/*
 * Seven of the views and all seven overlays are fetched when they are first
 * shown, rather than with the first screen.
 *
 * None of them is on screen when the application opens. It opens on a chooser
 * offering three ways to start, and every one of them sits behind a mode, a
 * view or a button. Fetching all fourteen to draw that chooser is work done for
 * a screen none of them appear on. It takes the first chunk from 1,384 kB to
 * 964 kB, and the part of it that travels compressed from 436 kB to 303 kB.
 *
 * The overlays are warmed a moment after the first screen is up, in
 * `warmDeferred` below, because each of them opens from a button and a button
 * that shows nothing until a chunk arrives reads as dead. Deferring them keeps
 * the weight off the first load. Warming them means nobody waits for one.
 *
 * Every one of them is fetched through `loadingTwice`, which asks a second time
 * if the first ask fails. That is not belt and braces: a module that fails to
 * fetch is remembered as failed, so warming turns one dropped response into a
 * screen that stays broken for the rest of the session. `deferred.ts` has the
 * whole of it.
 *
 * Two views are left out of it. GlyphEditorView and KerningView each put a
 * keydown listener on the window, so the tools and the nudges are theirs to
 * answer. Fetched on demand they answer nothing until the chunk lands, and a
 * key pressed in that gap is not late, it is gone: pressing `k` for the knife
 * straight after opening the glyph view did nothing at all. Warming the chunk
 * shortens the gap without closing it, and a dropped keystroke is not a thing
 * to fix by being quick. They load with the shell that owns the keyboard.
 *
 * The drawing engine is off the first screen too, and getting it off was not a
 * matter of deferring a view. `src/forge/` is 287 kB of the graph, and what
 * held it here was a dozen small things: the palette's catalogue of every forge
 * control, the project format asking whether a drawing was worth saving, the
 * mode panels naming every part and every base, and three components that
 * wanted nothing but a family name and whether undo was available.
 *
 * `state/drawn.ts` is what those last ones ask now -- it is the drawing seen
 * from outside the thing that draws, and it has the argument for why. The rest
 * became `React.lazy` or an `import()` inside the handler that needs them.
 *
 * One edge is left and is meant to be: `font/transform.ts` takes `shapedInk`,
 * which is on the synchronous path outlines are resolved on and reaches every
 * drawing in the application. Moving that one means making the outline path
 * async; it is a larger job than this and it is not started here. If you are
 * adding an import to something on this screen, check what it reaches --
 * `vite.config.ts` has the measurements.
 */

/**
 * One boundary per view, wrapped where the view is shown.
 *
 * React holds on to a suspended boundary's previous children instead of
 * dropping them, so a single boundary around the whole stage would keep the
 * view being left in the document until the arriving view had loaded. For that
 * moment the page would hold both, and a search for a word the two screens
 * share would find it twice. A boundary that mounts with the view inside it
 * has no previous children to hold.
 */
const Wait = ({ children }: { children: React.ReactNode }) => (
  <React.Suspense fallback={null}>{children}</React.Suspense>
);

/*
 * The command palette, which was the last overlay still arriving with the
 * first screen.
 *
 * Its catalogue enumerates every control the forge has, so importing it
 * imported the drawing engine, the letter recipes and the part specifications
 * -- eighty-six kilobytes gzipped, on a screen that has no palette open. The
 * shortcut that opens it is a hook and stays above; only the panel waits.
 */
const QuickActions = React.lazy(() =>
  loadingTwice(
    () => import("@/palette/QuickActions"),
    (m) => m.QuickActions,
  ),
);

/*
 * The four side panels, each of which is the panel for one mode out of four.
 *
 * `ForgePanel` names every part, every base and every effect the drawing
 * engine has. `AssemblePanel` and `Inspector` share the cut and cast controls
 * with it, which reach `forge/parts.ts` -- ninety kilobytes of part
 * specifications on their own. So three of the four are deferred for what they
 * drag behind them rather than for their own size, and `Inspector` for one
 * more reason besides: it shows nothing at all until a font is open, which on
 * the screen the application actually opens on is never.
 *
 * `QuillPanel` carries none of that and is deferred for the plain reason: it
 * is the panel for a mode, and three modes out of four are not it.
 */
const ForgePanel = React.lazy(() =>
  loadingTwice(
    () => import("@/components/ForgePanel"),
    (m) => m.ForgePanel,
  ),
);

const AssemblePanel = React.lazy(() =>
  loadingTwice(
    () => import("@/components/AssemblePanel"),
    (m) => m.AssemblePanel,
  ),
);

const QuillPanel = React.lazy(() =>
  loadingTwice(
    () => import("@/components/QuillPanel"),
    (m) => m.QuillPanel,
  ),
);

const Inspector = React.lazy(() =>
  loadingTwice(
    () => import("@/components/Inspector"),
    (m) => m.Inspector,
  ),
);

const FontGridView = React.lazy(() =>
  loadingTwice(
    () => import("@/views/FontGridView"),
    (m) => m.FontGridView,
  ),
);
const MetricsView = React.lazy(() =>
  loadingTwice(
    () => import("@/views/MetricsView"),
    (m) => m.MetricsView,
  ),
);
const ProofView = React.lazy(() =>
  loadingTwice(
    () => import("@/views/ProofView"),
    (m) => m.ProofView,
  ),
);
const ReportView = React.lazy(() =>
  loadingTwice(
    () => import("@/views/ReportView"),
    (m) => m.ReportView,
  ),
);
const AssembleView = React.lazy(() =>
  loadingTwice(
    () => import("@/views/AssembleView"),
    (m) => m.AssembleView,
  ),
);
const ForgeView = React.lazy(() =>
  loadingTwice(
    () => import("@/views/ForgeView"),
    (m) => m.ForgeView,
  ),
);
const QuillView = React.lazy(() =>
  loadingTwice(
    () => import("@/views/QuillView"),
    (m) => m.QuillView,
  ),
);

const AssembleExportDialog = React.lazy(() =>
  loadingTwice(
    () => import("@/components/AssembleExportDialog"),
    (m) => m.AssembleExportDialog,
  ),
);
const ExportDialog = React.lazy(() =>
  loadingTwice(
    () => import("@/components/ExportDialog"),
    (m) => m.ExportDialog,
  ),
);
const ForgeExportDialog = React.lazy(() =>
  loadingTwice(
    () => import("@/components/ForgeExportDialog"),
    (m) => m.ForgeExportDialog,
  ),
);
const FontInfoDialog = React.lazy(() =>
  loadingTwice(
    () => import("@/components/FontInfoDialog"),
    (m) => m.FontInfoDialog,
  ),
);
const QuillExportDialog = React.lazy(() =>
  loadingTwice(
    () => import("@/components/QuillExportDialog"),
    (m) => m.QuillExportDialog,
  ),
);
const AcademyDrawer = React.lazy(() =>
  loadingTwice(
    () => import("@/components/AcademyDrawer"),
    (m) => m.AcademyDrawer,
  ),
);
const HelpDrawer = React.lazy(() =>
  loadingTwice(
    () => import("@/components/HelpDrawer"),
    (m) => m.HelpDrawer,
  ),
);

/**
 * Fetch the deferred chunks once the first screen is up and the browser is idle.
 *
 * The overlays are the ones worth having in hand, because each opens from a
 * button and a button that shows nothing while a chunk arrives reads as dead.
 * The views are warmed for the same reason, a beat less urgently. A failure
 * here is ignored on purpose: nothing is waiting on it, and opening the thing
 * for real imports it again and reports the failure then.
 *
 * The side panels are warmed with the views they stand beside, and have to be:
 * a mode arriving as a stage with an empty column next to it is worse than
 * either half arriving late on its own. That the drawing engine comes down with
 * them is the point rather than a cost -- what deferring them bought is that it
 * is not in the first download, not that it is never fetched.
 */
function warmDeferred(): void {
  const nothing = () => {};
  void import("@/palette/QuickActions").catch(nothing);
  void import("@/components/ForgePanel").catch(nothing);
  void import("@/components/AssemblePanel").catch(nothing);
  void import("@/components/QuillPanel").catch(nothing);
  void import("@/components/Inspector").catch(nothing);
  void import("@/components/HelpDrawer").catch(nothing);
  void import("@/components/AcademyDrawer").catch(nothing);
  void import("@/components/FontInfoDialog").catch(nothing);
  void import("@/components/ExportDialog").catch(nothing);
  void import("@/components/ForgeExportDialog").catch(nothing);
  void import("@/components/AssembleExportDialog").catch(nothing);
  void import("@/components/QuillExportDialog").catch(nothing);
  void import("@/views/FontGridView").catch(nothing);
  void import("@/views/ForgeView").catch(nothing);
  void import("@/views/QuillView").catch(nothing);
  void import("@/views/AssembleView").catch(nothing);
  void import("@/views/MetricsView").catch(nothing);
  void import("@/views/ProofView").catch(nothing);
  void import("@/views/ReportView").catch(nothing);
}

/** Which of the three jobs is in front. */
export type Mode = "edit" | "forge" | "assemble" | "quill";

/**
 * The half a font chosen from the library is opened into.
 *
 * Three of the four, and Trace is the one left out: the library offers fonts to
 * work on, and Trace's own panel reads a font in for itself with a progress bar
 * and a stop button, because tracing one takes most of a minute. A library that
 * silently started that would be a very different button from the one next to
 * it. Somebody in Trace who picks from the library lands in Edit, which is
 * where a font opens everywhere else.
 *
 * This is *not* what a session records. A saved document keeps whichever half
 * was open, Trace included -- see `TracedProject`, where what is written and
 * what deliberately is not are argued.
 */
function libraryMode(mode: Mode): Exclude<SavedMode, "quill"> {
  return mode === "quill" ? "edit" : mode;
}

/*
 * The views the parameter panel belongs in, and the two it does not.
 *
 * It used to be in all five, which meant Corner radius, Weight and Middle
 * space sat on screen while somebody kerned a pair or read a fault report --
 * controls that reach nothing you are looking at, in a column three hundred
 * pixels wide, taken off the thing you are looking at.
 *
 * Kerning already has a panel of its own about the pairs, so the parameters
 * were a third column and the canvas was the one paying for it. What Checks
 * needed was a way to narrow the list, and that belongs beside the list. (Its
 * findings do reach the store now, but for the tab's count and the line under
 * the top bar, not for a panel out here.)
 *
 * The other three keep it. In the grid and the glyph view the parameters are
 * the subject. In the proof they are not the subject but they do reach it: the
 * paragraph on screen is drawn from these outlines, and noticing the weight is
 * a shade heavy is exactly what proofing is for.
 */
const SHOWS_INSPECTOR = new Set<ViewId>(["grid", "glyph", "metrics", "proof"]);

/**
 * What the folder somebody picked was called.
 *
 * A picked folder gives every file the path it had inside it, so the name is
 * the first segment of any of them. Only for saying so on screen -- nothing
 * about reading the font depends on it.
 */
function folderNameOf(files: FileList): string | null {
  for (const file of Array.from(files)) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (path) return path.split("/")[0];
  }
  return null;
}

export function App(): React.JSX.Element {
  const state = useAppState();
  const drawn = useDrawing();
  const assemble = useAssemble();
  const traced = useQuill();
  const [exporting, setExporting] = React.useState(false);
  const [naming, setNaming] = React.useState(false);
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
  const [learning, setLearning] = React.useState(false);

  /*
   * A view asking to be somewhere else.
   *
   * The empty font grid is the one that needs it: somebody looking at "no font
   * open" may have arrived wanting to draw a typeface rather than open one, and
   * that is a different document kind which the grid has no way to reach.
   * Cleared as soon as it is acted on, so it cannot fire twice.
   */
  React.useEffect(() => {
    if (!state.wantsMode) return;
    setMode(state.wantsMode as Mode);
    store.modeAsked();
  }, [state.wantsMode]);

  /*
   * Warm the deferred chunks once, after the first screen has had the browser to
   * itself. `requestIdleCallback` is the right moment for it and Safari only
   * shipped it in 18.4, so where it is missing a timeout stands in. Two
   * seconds is long after the first screen is up and long before anybody has
   * found the Help button.
   */
  React.useEffect(() => {
    if (typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(warmDeferred, 2_000);
      return () => window.clearTimeout(timer);
    }
    const handle = window.requestIdleCallback(warmDeferred, { timeout: 5_000 });
    return () => window.cancelIdleCallback(handle);
  }, []);
  const [dragging, setDragging] = React.useState(false);
  const [keeping, setKeeping] = React.useState<Keeping>("unknown");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const folderRef = React.useRef<HTMLInputElement>(null);
  /*
   * Set through a ref rather than written in the JSX, because React does not
   * know the attribute: `webkitdirectory` is not in its list of properties, so
   * writing it as a prop puts the string "true" on the element and the browser
   * ignores it. It has to be a real attribute, set on the node.
   */
  React.useEffect(() => {
    const input = folderRef.current;
    if (!input) return;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);
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
   * asked to happen again, because a font somebody opened and a pile of
   * drawings somebody dropped are cut by the same library and were drawn
   * without it for the same moment.
   *
   * Two stores are asked here and the third asks itself. `forge-store.ts`
   * carries the drawing engine, so naming it here would put the engine on the
   * first screen to ask it a question -- and a store nobody has imported has
   * drawn nothing to draw again. It waits on the same promise from its own
   * module instead.
   */
  React.useEffect(() => {
    let live = true;
    void readyToCut().then(() => {
      if (!live) return;
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
  /*
   * Every store's revision, and the fourth was missing for as long as Trace
   * existed.
   *
   * This string is the whole of what tells the keeper something changed. A
   * store left out of it is a store whose work is never written down -- not
   * badly, but not at all: tracing a font and moving every slider produced no
   * save, no warning, and an empty Trace view on the next visit. The counters
   * are cheap and the omission is silent, which is the argument for listing all
   * of them here rather than the ones that seemed to matter.
   */
  const revisions = `${state.revision}:${drawn.count}:${assemble.revision}:${traced.revision}:${mode}`;
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

  /**
   * A font whose letters join, sent to the engine that can read them.
   *
   * The two halves of this application are not two views of one thing. The
   * editor moves points on outlines somebody else drew; the tracer reads those
   * outlines back into the strokes that made them, and only the second can say
   * anything about a script -- because what a script is made of is a moving pen
   * and a changing pressure, and neither of those is a point on an outline.
   *
   * So a joined script opened into the editor lands in front of controls that
   * cannot reach it, one mode away from the ones that can, with nothing on
   * screen saying so. That is the failure this fixes, and it is worth fixing
   * here rather than with a note in the interface: the font is already parsed
   * at this point, the measurement is a few bounding boxes, and the answer is
   * known before anybody has looked at the wrong panel.
   *
   * Both things happen rather than one. The outlines stay loaded next door, so
   * a wrong answer costs the click back to Edit and nothing else, and a right
   * one still leaves the outlines there to be compared against.
   */
  const sendScriptToTrace = React.useCallback((bytes: Uint8Array, name: string): boolean => {
    /*
     * The font that was just opened, and a check that it really was.
     *
     * `loadFont` reports a file it could not read by setting a status and
     * leaving the previous font in place, so the store still holds a typeface
     * afterwards -- the wrong one. Without the name check, dropping a corrupt
     * file while a script was open would measure the script, agree it joins,
     * and start tracing the font that was already there.
     */
    const { typeface, fileName } = store.getSnapshot();
    if (!typeface || fileName !== name) return false;
    const verdict = looksJoined(typeface);
    if (!verdict.joined) return false;
    setMode("quill");
    // Not awaited: this is most of a minute of arithmetic in a worker, and it
    // reports its own progress. Holding the drop open until it finished would
    // freeze the door every font comes through.
    void quillStore.trace(bytes, name, verdict);
    return true;
  }, []);

  /*
   * Go to where the thing that was just opened actually is.
   *
   * Every other door does this already -- a UFO, a saved project, a typeface
   * adopted from the library -- and a plain font was the one that did not. So
   * opening one from the toolbar while standing in Draw, Assemble or Trace
   * loaded it into the editor's document and left you exactly where you were:
   * the status line reporting `Opened -- 6,253 glyphs` over a view that says
   * `Nothing traced yet`. Two statements about the same action, contradicting
   * each other on the same screen, with the font itself perfectly fine and one
   * mode away.
   *
   * Only when it really opened. `loadFont` reports a file it could not read by
   * setting a status and leaving the previous font in place, and switching mode
   * on that would walk somebody away from their work to look at the document
   * they already had.
   */
  const showWhatOpened = React.useCallback((name: string) => {
    const { typeface, fileName } = store.getSnapshot();
    if (typeface && fileName === name) setMode("edit");
  }, []);

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
  /*
   * A folder of files, which is what a UFO is.
   *
   * Reached three ways and handled once. Everything about the format lives in
   * `src/ufo`; what is here is the decision that this pile of files is a font
   * rather than something else somebody dropped.
   */
  const openUfo = React.useCallback(async (files: UfoFiles, name: string) => {
    await store.loadUfo(files, name);
    setMode("edit");
  }, []);

  /*
   * Out of a generator and into the tools.
   *
   * Both of these do what the export dialog next to them does -- draw every
   * letter once and build a typeface -- and then hand it to the editor instead
   * of to a file. Until now that typeface only ever went into a download, so
   * the only way to move a point on a letter you had drawn was to export it
   * and open the file you had just written.
   *
   * The mode switch is why they live here: the panels have no idea which mode
   * the application is in, and should not.
   */
  const takeToEditor = React.useCallback((typeface: Typeface, name: string) => {
    store.adopt(typeface, name);
    // Straight to the letter rather than to the grid, because somebody who has
    // asked to edit these letters has one in mind and is already looking at it.
    store.setView("glyph");
    setMode("edit");
  }, []);

  const editForged = React.useCallback(async () => {
    /*
     * Fetched here rather than imported above, as in `editAssembled`.
     *
     * Turning a document into a typeface is what happens when somebody presses
     * a button, and for two of the three it is done by way of something no
     * other mode needs -- the fusing of a pile of drawings, and here the
     * drawing engine itself. The store is fetched for the same reason: it
     * holds the drawing, so it holds the engine that made it.
     *
     * The traced half is the exception and is imported above. Its converter is
     * already on the first screen -- the Trace store takes `linesOf` from it --
     * so fetching it here would move nothing and rolldown says so.
     */
    const [{ forgeStore }, { toTypeface: forgeToTypeface }] = await Promise.all([
      import("@/state/useForge"),
      import("@/forge/typeface"),
    ]);
    const { forge, familyName } = forgeStore.snapshot();
    const typeface = await forgeToTypeface(forge, {
      familyName: familyName || "Untitled",
      styleName: "Regular",
      /*
       * Everything on, exactly as it is for a file.
       *
       * These three are off while the sliders are moving because each costs a
       * boolean pass over four hundred letters. This is the one place the
       * letters stop being a preview, so the version handed over is the one
       * that would have been written: fused, roughened, and with the kerning
       * measured, rather than a stack of loose strokes that would need all
       * three doing again by hand in the editor.
       */
      merge: true,
      kern: true,
      effects: true,
    });
    takeToEditor(typeface, `${familyName || "Untitled"}.ttf`);
  }, [takeToEditor]);

  const editAssembled = React.useCallback(async () => {
    const { assembly, familyName } = assembleStore.snapshot();
    const name = familyName || assembly.name || "Untitled";
    const { toTypeface: assembleToTypeface } = await import("@/assemble/typeface");
    const typeface = await assembleToTypeface(assembly, {
      familyName: name,
      styleName: "Regular",
      // Fused, as it is for a file: this is where the drawings stop being a
      // pile and start being letters.
      merge: true,
    });
    takeToEditor(typeface, `${name}.ttf`);
  }, [takeToEditor]);

  const editTraced = React.useCallback(async () => {
    const doc = quillStore.getSnapshot().document;
    const family = doc.from ? `${doc.from} Traced` : "Traced";
    const typeface = await quillToTypeface(doc.letters, doc.style, doc.unitsPerEm, {
      familyName: family,
      styleName: "Regular",
      from: doc.from || "an unnamed font",
    });
    takeToEditor(typeface, `${family}.ttf`);
  }, [takeToEditor]);

  const openFiles = React.useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;

      /*
       * More than one file means a folder was picked, and the only folder this
       * opens is a UFO. The picker sets `webkitRelativePath` on every file it
       * hands over, which is the only reason the folder can be reassembled at
       * all -- a plain multiple-file input gives the same files with no idea
       * which directory any of them was in.
       */
      if (files.length > 1) {
        const ufo = await filesFromPicker(files);
        if (ufo) {
          await openUfo(ufo, folderNameOf(files) ?? "a folder");
          return;
        }
        store.say("That folder is not a UFO: it has no metainfo.plist in it.", "error");
        return;
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (detectFormat(bytes) !== "unknown") {
        await store.loadFont(bytes, file.name);
        // A joined script is taken to Trace and traced; everything else is a
        // font to edit, and the editor is where it now lives.
        if (!sendScriptToTrace(bytes, file.name)) showWhatOpened(file.name);
        return;
      }
      // A `.ufoz` is a zipped UFO and part of the format; a folder somebody
      // compressed to send is the same thing by a different route.
      if (looksZipped(bytes)) {
        const ufo = filesFromZip(bytes);
        if (ufo) {
          await openUfo(ufo, file.name.replace(/\.(ufoz|zip)$/i, ".ufo"));
          return;
        }
      }
      await openProject(file, bytes);
    },
    [openProject, openUfo, sendScriptToTrace, showWhatOpened],
  );

  /*
   * What a drop means depends on which job is in front.
   *
   * A font file dropped on the editor opens it. A pile of drawings dropped on
   * the assembler joins the pile -- and it is a pile, so unlike everywhere
   * else in this application the drop takes every file rather than the first.
   */
  const dropFiles = React.useCallback(
    async (files: FileList | null, items?: DataTransferItemList) => {
      // A folder first, because a dropped folder also arrives as a list of the
      // files inside it and would otherwise open as whichever came first.
      if (items) {
        const ufo = await filesFromDrop(items);
        if (ufo) {
          await openUfo(ufo, "the folder you dropped");
          return;
        }
      }
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
    [mode, openFiles, openUfo],
  );

  /*
   * Everything the palette can do, gathered in one place.
   *
   * Handed to it rather than reached for, so the palette stays a description
   * of what the product offers and the wiring stays here with the rest of it.
   * Every one of these is already a button somewhere: the palette is a second
   * door to the same rooms, not a second set of rooms.
   */
  /**
   * Going to another half of the application, by any of the doors people use.
   *
   * The tabs are one door and they are held shut over a borrowed letter, which
   * the strip above the canvas depends on being true: it tells somebody the
   * only ways out are keeping the drawing and throwing it away. The command
   * palette is a second door to the same rooms and went straight past that, and
   * so did the course drawer's "take me there" -- either would have left the
   * loan on the desk and the real document in a drawer, with nothing on screen
   * to say why.
   *
   * So the refusal lives at the one place a person's navigation turns into a
   * change of mode, rather than at each door in turn, and says why rather than
   * doing nothing. The doors that *replace* the document -- opening a font,
   * restoring a project, starting a blank one, handing a whole family to the
   * editor -- go on calling `setMode` directly and are right to: each of them
   * lets go of the loan first, because choosing to open something else is a
   * decision about the same work.
   */
  const goToMode = React.useCallback((next: Mode) => {
    const { loan } = store.getSnapshot();
    if (loan) {
      store.say(`Finish with ${loan.letter} first — keep the drawing or throw it away.`, "info");
      return;
    }
    setMode(next);
  }, []);

  const shell: AppShell = React.useMemo(
    () => ({
      mode,
      setMode: goToMode,
      view: state.view,
      setView: (view) => store.setView(view),
      openFile: () => inputRef.current?.click(),
      openFolder: () => folderRef.current?.click(),
      export: () => setExporting(true),
      save: saveProject,
      addVersion: (axis: string) => void store.addMaster(axis),
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
      hasFont: Boolean(state.typeface),
    }),
    // Only what changes the shape of the catalogue: which job is in front and
    // which view it is showing. The values themselves are read live, above.
    [mode, goToMode, state.view, state.typeface, saveProject],
  );

  useQuickActionShortcut(React.useCallback(() => setQuick(true), []));
  /*
   * And the handful that are done constantly, by the names every other
   * application has already taught: Cmd-S, Cmd-E, Cmd-O, and the six views by
   * number. The palette is still the way to everything else.
   */
  useAppKeys({
    onSave: saveProject,
    onExport: React.useCallback(() => setExporting(true), []),
    onOpenFile: React.useCallback(() => inputRef.current?.click(), []),
    editing: mode === "edit" && state.typeface !== null,
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the page is a drop target for a font file; the Open button is the keyboard path.
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
        /*
         * The entries are reached for here, synchronously, and not inside the
         * handler that awaits them. A `DataTransferItemList` is emptied the
         * moment this returns, so an implementation that waits first and looks
         * afterwards finds an empty list and no folder -- which is the single
         * most common way a folder drop is got wrong.
         */
        void dropFiles(event.dataTransfer.files, event.dataTransfer.items);
      }}
    >
      <TopBar
        onOpenFile={() => inputRef.current?.click()}
        onLibrary={() => void libraryStore.show()}
        onExport={() => setExporting(true)}
        onFontInfo={() => setNaming(true)}
        onToggleHelp={() => setHelping((open) => !open)}
        helpOpen={helping}
        onToggleAcademy={() => setLearning((open) => !open)}
        academyOpen={learning}
        mode={mode}
        onMode={goToMode}
        onSave={saveProject}
        keeping={keeping}
      />

      {/*
        What to do next, under the bar and above the work.

        Across the whole strip rather than inside one view, because the answer
        is about the font and not about the screen you happen to be standing
        on, and because a beginner who does not know the order of the work
        cannot be expected to find the line that would tell them.
      */}
      <NextStep
        mode={mode}
        onName={() => setNaming(true)}
        onExport={() => setExporting(true)}
        onEditForged={() => void editForged()}
        onEditTraced={() => void editTraced()}
        onEditAssembled={() => void editAssembled()}
      />

      <div className="flex min-h-0 flex-1">
        <div ref={stageRef} className="flex min-w-0 flex-1 flex-col">
          {mode === "forge" && (
            <Wait>
              <ForgeView />
            </Wait>
          )}
          {mode === "quill" && (
            <Wait>
              <QuillView />
            </Wait>
          )}
          {mode === "assemble" && (
            <Wait>
              <AssembleView />
            </Wait>
          )}
          {mode === "edit" && (
            <>
              <OnLoan />
              {state.view === "grid" && (
                <Wait>
                  <FontGridView />
                </Wait>
              )}
              {state.view === "glyph" && <GlyphEditorView />}
              {state.view === "kerning" && <KerningView />}
              {state.view === "metrics" && (
                <Wait>
                  <MetricsView />
                </Wait>
              )}
              {state.view === "proof" && (
                <Wait>
                  <ProofView />
                </Wait>
              )}
              {state.view === "report" && (
                <Wait>
                  <ReportView />
                </Wait>
              )}
            </>
          )}
        </div>
        {mode === "forge" && (
          <Wait>
            <ForgePanel onEdit={editForged} />
          </Wait>
        )}
        {mode === "quill" && (
          <Wait>
            <QuillPanel onEdit={editTraced} />
          </Wait>
        )}
        {mode === "assemble" && (
          <Wait>
            <AssemblePanel onEdit={editAssembled} />
          </Wait>
        )}
        {/*
          And no panel of parameters before there is anything to have them.

          It said "Parameters appear once a font is open" down a column three
          hundred pixels wide, which is a fifth of the first screen given over
          to explaining its own emptiness.
        */}
        {mode === "edit" && state.typeface && SHOWS_INSPECTOR.has(state.view) && (
          <Wait>
            <Inspector />
          </Wait>
        )}
        {helping && (
          <Wait>
            <HelpDrawer onClose={() => setHelping(false)} />
          </Wait>
        )}
        {/*
          One drawer at a time, and the courses win where both are asked for.
          Two four-hundred-pixel panels beside the work leaves the work with
          nothing, and of the two the course is the one being followed.
        */}
        {learning && !helping && (
          <Wait>
            <AcademyDrawer
              mode={mode}
              onClose={() => setLearning(false)}
              onGo={(where) => {
                if (where.mode) goToMode(where.mode as Mode);
                if (where.view) store.setView(where.view as ViewId);
              }}
            />
          </Wait>
        )}
      </div>

      {/*
        A second input, and it has to be a second one.

        `webkitdirectory` is a property of the element, not of the click, so an
        input carrying it can only ever pick folders and one without it can
        only ever pick files. A single button cannot offer both, which is why
        Open opens a file and the folder has its own way in.
      */}
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden"
        data-open-folder-input
        onChange={(event) => {
          void openFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2,.typeforge,.ufoz,.zip,font/ttf,font/otf,font/woff,font/woff2,application/json,application/zip"
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

      {quick && (
        <Wait>
          <QuickActions open={quick} onClose={() => setQuick(false)} shell={shell} />
        </Wait>
      )}

      <LibraryDialog mode={libraryMode(mode)} onMode={setMode} />

      {naming && (
        <Wait>
          <FontInfoDialog onClose={() => setNaming(false)} />
        </Wait>
      )}
      {exporting && mode === "forge" && (
        <Wait>
          <ForgeExportDialog onClose={() => setExporting(false)} />
        </Wait>
      )}
      {exporting && mode === "assemble" && (
        <Wait>
          <AssembleExportDialog onClose={() => setExporting(false)} />
        </Wait>
      )}
      {exporting && mode === "edit" && (
        <Wait>
          <ExportDialog onClose={() => setExporting(false)} />
        </Wait>
      )}
      {exporting && mode === "quill" && (
        <Wait>
          <QuillExportDialog onClose={() => setExporting(false)} />
        </Wait>
      )}
    </div>
  );
}

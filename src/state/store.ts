/**
 * Application state, and the last link of the chain that holds it.
 *
 * A small observable store rather than a state library: the document is one
 * object, edits are explicit, and React subscribes through
 * `useSyncExternalStore`. That keeps the hot paths — dragging a node, moving a
 * slider — free of framework overhead.
 *
 * History records only the glyphs an edit touched, not the whole typeface. A
 * font of six thousand glyphs would make full snapshots far too expensive to
 * take on every drag.
 *
 * What is in this file is the document itself: opening one, its weights, a
 * letter lent to another mode, and undo. The rest is above it, and the note on
 * the class says how the parts fit together.
 */

import { applyEdits, fromBase64, type EditedProject, type SavedMaster } from "@/project/format";
/*
 * Renamed on the way in, because the store's own methods are called the same
 * things. Both resolve correctly -- a bare name inside a method is the module
 * one -- but which is meant should not be something a reader has to work out.
 */
import { NOTDEF, notdefGlyph } from "@/font/library";
import { readControls } from "@/font/control";
import { importFont } from "@/font/parse";
import { cloneGlyph } from "@/font/types";
import {
  AXES,
  axesOf,
  axisSpec,
  freeMasterId,
  freeMasterName,
  masterFrom,
  mastersFrom,
  soleMaster,
  WGHT,
  type Master,
} from "@/font/master";
import type { Finding } from "@/font/validate";
import {
  emptyTypeface,
  type Glyph,
  type Contour,
  type Typeface,
  type VerticalMetrics,
} from "@/font/types";
/**
 * The bundled sample, as a URL rather than as bytes: Vite emits it as a hashed
 * asset the browser caches like any other, instead of inlining 47KB of font
 * into the JavaScript everybody downloads whether they use it or not.
 */
import sampleFontUrl from "@/assets/typeforge-sample.ttf?url";
import { readUfo, writeUfo, type UfoFiles } from "@/ufo/font";

/** What the sample is called once it is open, as any other file would be. */
const SAMPLE_FILE_NAME = "TypeforgeSample-Regular.ttf";

import { firstLetterName } from "./store-core";
import { ShapingStore } from "./store-shaping";

/*
 * The document's shape lives next door, in model.ts. Re-exported here because
 * "@/state/store" is where the rest of the application asks for it, and moving
 * the file is not a reason to make fifty-seven imports move with it.
 */
// The tool ids come from the toolset and are re-exported for the same reason.
export type { ToolId, GroupId } from "@/font/toolset";

export {
  nodeKey,
  type AppState,
  type HistoryEntry,
  type Loan,
  type NodeRef,
  type ToolPhase,
  type ToolState,
  type ViewId,
} from "./model";
import type { Loan } from "./model";

/**
 * The store, assembled.
 *
 * Four thousand lines is too many to read as one class in one file, so it is
 * written as a chain:
 *
 *     StoreCore        the state, set, touch, push, say, glyph
 *     NavigationStore  which view, which letter, what is selected
 *     EditingStore     the outlines, the points, the pen, the parameters
 *     ShapingStore     anchors and components, kerning, metadata
 *     Store            the document itself, its weights, a letter on loan, undo
 *
 * A chain rather than five objects hanging off one, because every part of this
 * reaches the same state through the same four methods, and passing that around
 * as an argument would be the same coupling written out longhand. The order is
 * not arbitrary: each link calls into the ones above it and never below, which
 * is what makes it a chain and not a circle.
 *
 * Nothing outside this file knows about any of it. `store` is one object with
 * the same methods it always had.
 */
class Store extends ShapingStore {
  /**
   * Take a typeface that has already been read.
   *
   * The library has parsed the file to measure it, and parsing a few thousand
   * glyphs twice to put the same font on screen would be a second of nothing
   * happening for no reason at all.
   */
  adopt(typeface: Typeface, fileName: string): void {
    this.forgetLoan();
    this.undoStack = [];
    this.redoStack = [];
    this.controlBaseline = readControls(typeface);
    // Whatever the last UFO carried belongs to the last UFO. Left in place, a
    // font opened afterwards would go out with somebody else's background
    // layers folded into it.
    this.ufo = null;
    this.set({
      typeface,
      fileName,
      // Whatever the last file had to say belongs to the last file.
      openWarnings: [],
      /*
       * One weight, and it is this one. Every place a document is replaced
       * resets this, because a master list is a description of the font that
       * was open and means nothing about the one arriving.
       */
      masters: [soleMaster(typeface)],
      master: "m1",
      preview: null,
      /*
       * And whatever the last font's checks found belongs to the last font.
       *
       * Left in place, the tab would carry the previous font's error count over
       * a font nothing has looked at, and the line under the bar would offer to
       * fix faults that are not there. Every one of the five places a document
       * is replaced clears this for the same reason.
       */
      checks: null,
      selectedGlyph: firstLetterName(typeface),
      selectedNodes: new Set(),
      selectedGlyphs: new Set(),
      /*
       * Guides go with the font they were drawn against.
       *
       * They are kept in font units, and font units are not the same size from
       * one font to the next: a guide at 500 is the x-height of a
       * thousand-unit font and a quarter of the way up a two-thousand-unit
       * one. Left in place, they would arrive over the new font meaning
       * something else entirely.
       */
      guides: [],
      busy: false,
      status: {
        message: `Opened — ${typeface.glyphs.length.toLocaleString()} glyphs`,
        tone: "success",
        about: "edit",
      },
    });
    this.touch();
  }

  // --- versions ------------------------------------------------------------

  /*
   * A second weight, drawn rather than calculated.
   *
   * What the export could do already was synthesise one: move `params.weight`
   * and let `applyWeight` offset every node along its own normal. That is even
   * where a drawn bold is optical -- it thickens a hairline and a stem by the
   * same amount -- and the `g` it produces is the Regular's `g` inflated.
   *
   * So a master here is a real copy of the drawing, which you then change. The
   * copy is deep in the glyphs and shared in everything else: the family name,
   * the vertical metrics, the kerning and the features are one set of objects
   * held by every master, because the format writes one of each for the whole
   * variable font and a document that let them drift would describe a font that
   * cannot exist.
   */

  /** The one being drawn, which is always one of them while a font is open. */
  currentMaster(): Master | null {
    return this.state.masters.find((one) => one.id === this.state.master) ?? null;
  }

  /**
   * Copy this version into a new one, moved along one axis, and go to it.
   *
   * One axis, which is what a master is here and what the exporter is built
   * for: every version is the whole font drawn again with a single setting
   * moved, so it stands in the middle of every axis but its own. That is what
   * makes a design space a star rather than a grid -- a Bold and a Condensed
   * between them describe a Bold Condensed without anybody drawing one.
   *
   * Placed away from where the font already sits, because a second version on
   * top of the first is nobody's intention, and because two masters in the same
   * place is a font that cannot be built.
   */
  addMaster(tag = WGHT, name?: string): string | null {
    const typeface = this.state.typeface;
    const masters = this.state.masters;
    if (!typeface || masters.length === 0) return null;

    /*
     * A registered axis or nothing.
     *
     * `axisSpec` is deliberately lenient -- a document that arrives with an
     * axis this build has never heard of should still open -- and that
     * leniency is a trap on the way in: `addMaster("Bold")` read the name as a
     * tag and quietly gave the font an axis called Bold, with `fvar` ready to
     * declare it. A test caught it, which is the only reason it is not shipped.
     */
    if (!AXES.some((axis) => axis.tag === tag)) {
      this.say(`There is no ${tag} axis to add a version along.`, "error");
      return null;
    }
    const spec = axisSpec(tag);
    const here = this.currentMaster();
    const middle = masters[0].at[tag] ?? spec.normal;
    const taken = new Set(masters.map((one) => one.at[tag] ?? spec.normal));

    /*
     * Where a second version along this axis usually goes, and then further
     * out in the axis's own steps until it lands somewhere nothing else is
     * standing. Away from the middle rather than towards it, so a third weight
     * is a Black beyond the Bold rather than a Medium squeezed inside it.
     */
    const stride = Math.sign(spec.second.at - middle) * spec.step || spec.step;
    let at = spec.second.at;
    let guard = 0;
    while ((taken.has(at) || at <= spec.min || at >= spec.max) && guard < 200) {
      at += stride;
      guard += 1;
    }
    if (at <= spec.min || at >= spec.max) {
      this.say(`There is no room left on the ${spec.label.toLowerCase()} axis.`, "error");
      return null;
    }

    const wanted = name ?? spec.second.name;
    /*
     * Every version stands somewhere on every axis, including the ones added
     * after it. Written down rather than left missing, so a document says where
     * its Regular sits on the width axis instead of implying it.
     */
    const at_ = {
      ...Object.fromEntries(Object.keys(masters[0].at).map((one) => [one, masters[0].at[one]])),
      [tag]: at,
    };
    const made = masterFrom(typeface, freeMasterName(masters, wanted), at_, freeMasterId(masters));
    const filled = masters.map((one) =>
      one.at[tag] === undefined ? { ...one, at: { ...one.at, [tag]: middle } } : one,
    );

    this.set({ masters: [...filled, made] });
    this.goToMaster(made.id);
    this.say(
      `${made.name} added at ${spec.label.toLowerCase()} ${at}. It starts as a copy of ${here?.name ?? "this version"}.`,
    );
    return made.id;
  }

  /**
   * Draw a different weight.
   *
   * Nothing is written back, because nothing was ever copied out: the active
   * master's typeface *is* `state.typeface`, so every edit has been landing in
   * the right weight all along and this only changes which object that is.
   */
  goToMaster(id: string): boolean {
    const master = this.state.masters.find((one) => one.id === id);
    if (!master || master.id === this.state.master) return false;
    // The control letters are read afresh, or every later derivation in this
    // weight would be measured against the last one's.
    this.controlBaseline = readControls(master.typeface);
    this.set({
      master: id,
      typeface: master.typeface,
      selectedNodes: new Set(),
      selectedGlyphs: new Set(),
      // Asking to draw a weight is asking to stop looking between them.
      preview: null,
    });
    this.touch();
    return true;
  }

  /**
   * Look at a place in the design space rather than at a version that was drawn.
   *
   * One axis at a time from the interface -- there is a slider per axis -- and
   * the axes not named keep whatever they were at, which starts as where the
   * version in hand stands. Cleared by moving to a version, because the two
   * answer the same question and a preview left standing over a different
   * master is a screen showing neither what is drawn nor what was asked for.
   */
  setPreview(tag: string | null, value?: number): void {
    if (tag === null) {
      if (this.state.preview !== null) this.set({ preview: null });
      return;
    }
    const axes = axesOf(this.state.masters);
    const axis = axes.find((one) => one.tag === tag);
    if (!axis || value === undefined) return;
    const here = this.currentMaster();
    // Everything not being moved sits where the version in hand does, so
    // nudging one slider does not silently move the others.
    const from = this.state.preview ?? { ...(here?.at ?? {}) };
    this.set({
      preview: {
        ...from,
        [tag]: Math.round(Math.min(axis.max, Math.max(axis.min, value))),
      },
    });
  }

  /** Call this weight something else. */
  nameMaster(id: string, name: string): boolean {
    const masters = this.state.masters;
    const master = masters.find((one) => one.id === id);
    const wanted = name.trim();
    if (!master || wanted === "" || wanted === master.name) return false;
    if (masters.some((one) => one.id !== id && one.name.toLowerCase() === wanted.toLowerCase())) {
      this.say(`There is already a weight called ${wanted}.`, "error");
      return false;
    }
    master.name = wanted;
    this.set({ masters: [...masters] });
    return true;
  }

  /**
   * Move this version along one of its axes.
   *
   * Two versions in the same place cannot both be a corner of the design space,
   * so the second one is refused rather than quietly moved aside.
   */
  placeMaster(id: string, tag: string, at: number): boolean {
    const masters = this.state.masters;
    const master = masters.find((one) => one.id === id);
    if (!master) return false;
    const spec = axisSpec(tag);
    const to = Math.round(Math.min(spec.max, Math.max(spec.min, at)));
    if (to === master.at[tag]) return false;

    const moved = { ...master.at, [tag]: to };
    const clash = masters.find(
      (one) =>
        one.id !== id &&
        Object.keys(moved).every((key) => (one.at[key] ?? spec.normal) === moved[key]),
    );
    if (clash) {
      this.say(`${clash.name} is already there.`, "error");
      return false;
    }
    master.at = moved;
    this.set({ masters: [...masters] });
    return true;
  }

  /**
   * Throw a weight away, with everything drawn in it.
   *
   * Not undoable and not pretending to be: this is a whole alphabet, and an
   * undo stack that can hold one is a different piece of work. The interface
   * asks first.
   */
  removeMaster(id: string): boolean {
    const masters = this.state.masters;
    if (masters.length < 2) return false;
    const going = masters.find((one) => one.id === id);
    if (!going) return false;

    const left = masters.filter((one) => one.id !== id);
    this.set({ masters: left });
    if (this.state.master === id) {
      // Nothing is being drawn any more, so move before saying so.
      this.set({ master: "" });
      this.goToMaster(left[0].id);
    }
    this.say(`${going.name} removed.`);
    return true;
  }

  /** What the checks found, for anything that wants to say so. */
  checked(findings: Finding[], at: number): void {
    this.set({ checks: { findings, at } });
  }

  /** The edited half, for writing down. */
  snapshot():
    | { typeface: Typeface; fileName: string; masters?: SavedMaster[]; drawing?: string }
    | undefined {
    /*
     * The document of record, which during a loan is not the one on screen.
     *
     * A letter borrowed from Draw sits in a typeface of its own with one glyph
     * in it. That is a desk, not a document, and it must never be what gets
     * written down: the session is saved on a timer as well as on the button, so
     * without this a minute spent moving points on a borrowed `n` would quietly
     * replace whatever font was open with a font containing an `n`. The drawing
     * goes back to Draw and is saved as part of *that* half.
     */
    const { fileName, masters, master } = this.held ? this.held.state : this.state;
    /*
     * The first weight is what gets written as the font, not whichever one was
     * on screen when the timer went off.
     *
     * Everything the document holds beyond the drawing is shared, so any master
     * would give the same meta and the same kerning -- but `glyphs` is the one
     * thing that is not, and taking it from the Bold would save the Bold as the
     * font and the Regular as an exception to it.
     */
    const typeface = masters[0]?.typeface ?? (this.held ? this.held.state : this.state).typeface;
    if (!typeface) return undefined;
    return {
      typeface,
      fileName,
      drawing: master,
      masters: masters.map((one) => ({
        id: one.id,
        name: one.name,
        at: one.at,
        // Only what has been drawn in it, on the same terms as the font above.
        glyphs: one.typeface.glyphs.filter((glyph) => glyph.dirty),
      })),
    };
  }

  /**
   * Put a saved font back.
   *
   * The file is read again from its own bytes and the saved glyphs are laid
   * over the top, rather than the whole document being restored from the
   * document. That keeps the source tables -- the hinting, the colour, the
   * variations, everything "preserve" export hands back untouched -- which a
   * document made of glyphs would have quietly thrown away.
   */
  async restore(saved: EditedProject): Promise<void> {
    await this.loadFont(fromBase64(saved.font), saved.fileName);
    const { typeface } = this.state;
    if (!typeface) return;
    applyEdits(typeface, saved);
    /*
     * And the weights, after the letters, because every one of them is built by
     * copying this typeface -- so it has to be the restored one rather than the
     * one the file arrived as.
     */
    const masters = mastersFrom(typeface, saved.weight, saved.masters ?? []);
    // And back into the weight that was in hand, not the first one.
    const drawing = masters.find((one) => one.id === saved.drawing) ?? masters[0];
    this.set({ masters, master: drawing.id, typeface: drawing.typeface });
    this.undoStack = [];
    this.redoStack = [];
    this.set({
      status: {
        message: `Reopened — ${saved.glyphs.length.toLocaleString()} ${
          saved.glyphs.length === 1 ? "glyph" : "glyphs"
        } of your own`,
        tone: "success",
      },
    });
    this.touch();
  }

  async loadFont(bytes: Uint8Array, fileName: string): Promise<void> {
    this.forgetLoan();
    this.set({ busy: true, status: { message: `Reading ${fileName}…`, tone: "info" } });
    try {
      const { typeface, warnings } = await importFont(bytes, fileName);
      this.undoStack = [];
      this.redoStack = [];
      // A compiled font has no UFO behind it, and the one that was open
      // before is not this font's to carry.
      this.ufo = null;
      // The control letters as they arrived. Every later derivation compares
      // against this rather than against the previous edit, so editing n twice
      // expresses the total change instead of compounding.
      this.controlBaseline = readControls(typeface);
      this.set({
        typeface,
        fileName,
        openWarnings: warnings,
        // A different font, so the last one's findings go with it.
        checks: null,
        masters: [soleMaster(typeface)],
        master: "m1",
        preview: null,
        selectedGlyph: firstLetterName(typeface),
        selectedNodes: new Set(),
        selectedGlyphs: new Set(),
        busy: false,
        status: {
          /*
           * What happened, not what it is called.
           *
           * The family name sits permanently in the bar a few inches to the
           * left, so repeating it here put the same font's name on screen
           * twice, and the copy that was truncated to fit was this one. A
           * status line's job is to say what just happened; the identity of
           * the open document is the label's job, and it already does it.
           */
          message: `Opened — ${typeface.glyphs.length.toLocaleString()} glyphs${
            warnings.length
              ? `, with ${warnings.length === 1 ? "a note" : `${warnings.length} notes`} in Checks`
              : ""
          }`,
          tone: "success",
          about: "edit",
        },
      });
      this.touch();
    } catch (error) {
      this.set({
        busy: false,
        status: {
          message: error instanceof Error ? error.message : "That font could not be read.",
          tone: "error",
        },
      });
    }
  }

  /**
   * Open a UFO, which is a folder rather than a file.
   *
   * The other half of `loadFont`, and the difference is what arrives: bytes
   * there, a set of paths and their contents here. Everything about the format
   * lives in `src/ufo`, so this is only the part that has to be a store
   * action -- putting the font in front of somebody and remembering enough to
   * hand their folder back unharmed.
   *
   * `carried` is that remembering. A UFO holds things this application has no
   * idea about: background layers, private keys another tool left in the lib,
   * the images somebody is tracing over. They are kept beside the typeface and
   * written back on the way out, because opening somebody's work in progress
   * and quietly dropping half of it on save is not opening it.
   */
  async loadUfo(files: UfoFiles, folderName: string): Promise<void> {
    this.set({ busy: true, status: { message: `Reading ${folderName}…`, tone: "info" } });
    try {
      const read = readUfo(files);
      if (!read) throw new Error("That folder is not a UFO: it has no metainfo.plist in it.");
      const { typeface, carried } = read;
      if (typeface.glyphs.length === 0) {
        throw new Error("That UFO has no glyphs in it.");
      }
      this.undoStack = [];
      this.redoStack = [];
      this.controlBaseline = readControls(typeface);
      this.ufo = carried;
      this.set({
        typeface,
        fileName: folderName,
        // A different font, so the last one's findings go with it.
        checks: null,
        masters: [soleMaster(typeface)],
        master: "m1",
        preview: null,
        selectedGlyph: firstLetterName(typeface),
        selectedNodes: new Set(),
        selectedGlyphs: new Set(),
        busy: false,
        status: {
          message: `Opened — ${typeface.glyphs.length.toLocaleString()} glyphs`,
          tone: "success",
          about: "edit",
        },
      });
      this.touch();
    } catch (error) {
      this.set({
        busy: false,
        status: {
          message: error instanceof Error ? error.message : "That folder could not be read.",
          tone: "error",
        },
      });
    }
  }

  /**
   * The font as a UFO, with whatever came in with it put back.
   *
   * Answers for a font that never was one too: a drawing made here, or a
   * TrueType file opened here, goes out as a UFO with nothing carried, which
   * is a perfectly ordinary UFO that simply has no history behind it.
   */
  ufoFiles(): UfoFiles | null {
    const typeface = this.state.typeface;
    if (!typeface) return null;
    return writeUfo(typeface, this.ufo ?? undefined);
  }

  /**
   * Open the font that ships with the tool.
   *
   * Nothing in Typeforge does anything until a font is open, so without this
   * the first thing it asks of someone who has just arrived is that they go and
   * find a .ttf on their disk. The sample is a subset of DejaVu Sans, renamed
   * as its licence requires; see LICENSE-sample-font.txt.
   */
  async loadSample(): Promise<void> {
    this.set({ busy: true, status: { message: "Opening the sample…", tone: "info" } });
    try {
      const response = await fetch(sampleFontUrl);
      if (!response.ok) throw new Error(`The sample font could not be read (${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await this.loadFont(bytes, SAMPLE_FILE_NAME);
    } catch (error) {
      this.set({
        busy: false,
        status: {
          message: error instanceof Error ? error.message : "The sample font could not be read.",
          tone: "error",
        },
      });
    }
  }

  startBlank(): void {
    this.forgetLoan();
    this.undoStack = [];
    this.redoStack = [];
    /*
     * With a `.notdef` already in it.
     *
     * A new font used to fail its own checks on the first thing it said:
     * `No .notdef glyph`, an error, about a font nobody had touched yet. And
     * `.notdef` is not a design decision -- it is what the format draws for a
     * character the font does not cover, and every font must have one. Making
     * somebody add it by hand, by name, to get a clean report is asking them
     * to know a piece of trivia before they can draw anything.
     */
    const fresh = emptyTypeface();
    fresh.glyphs = [notdefGlyph(fresh.metrics)];
    fresh.glyphIndex = new Map([[NOTDEF, 0]]);
    this.set({
      typeface: fresh,
      fileName: "",
      // A different font, so the last one's findings go with it.
      checks: null,
      masters: [soleMaster(fresh)],
      master: "m1",
      preview: null,
      openWarnings: [],
      selectedGlyph: null,
      selectedNodes: new Set(),
      selectedGlyphs: new Set(),
      guides: [],
      status: null,
    });
    this.captureControlBaseline();
    this.touch();
  }

  // --- a letter on loan ---------------------------------------------------

  /**
   * Put a generator's letter on the desk, on its own, with the tools on it.
   *
   * The metrics come across with it and are not a detail. A letter is drawn
   * against its own baseline, x-height and cap height; dropped into a document
   * whose lines are somewhere else it would arrive floating in the wrong place
   * with every guide lying about it -- and the tools that snap would snap it to
   * the lie.
   *
   * Whatever was open goes into `held` whole rather than being saved field by
   * field, because a loan is a parenthesis: what comes back has to be what went
   * in, including the two history stacks. Undoing past the start of a loan and
   * finding yourself unpicking a font you opened an hour ago would be the worst
   * kind of surprise, so the loan starts with an empty history of its own and
   * the real one is handed back at the end.
   */
  borrowLetter(
    loan: Loan,
    glyph: Glyph,
    of: { unitsPerEm: number; metrics: VerticalMetrics },
  ): void {
    if (this.held) return;
    this.held = {
      state: this.state,
      undoStack: this.undoStack,
      redoStack: this.redoStack,
      ufo: this.ufo,
      controlBaseline: this.controlBaseline,
    };
    this.undoStack = [];
    this.redoStack = [];
    this.ufo = null;
    this.controlBaseline = null;

    const desk = emptyTypeface();
    desk.meta = { ...desk.meta, familyName: loan.family || "Untitled" };
    desk.unitsPerEm = of.unitsPerEm;
    desk.metrics = { ...of.metrics };
    desk.glyphs = [glyph];
    desk.glyphIndex = new Map([[glyph.name, 0]]);

    this.set({
      typeface: desk,
      fileName: "",
      // A different document, so the last one's findings go with it.
      checks: null,
      masters: [soleMaster(desk)],
      master: "m1",
      preview: null,
      openWarnings: [],
      view: "glyph",
      selectedGlyph: glyph.name,
      selectedNodes: new Set(),
      selectedGlyphs: new Set(),
      /*
       * The guides belonged to the font that has just been put aside, and a
       * guide is a number of font units: at 500 it is the x-height of a
       * thousand-unit font and a quarter of the way up a two-thousand-unit one.
       * Left in place they would stand over this letter meaning something else.
       */
      guides: [],
      drawing: false,
      highlightPath: null,
      loan,
      status: {
        /*
         * What is true now, rather than what will be true if it is kept.
         *
         * The letter has not left anything yet: nothing has changed in the
         * drawn font, and throwing the loan away leaves it exactly as it was.
         * Saying it has already gone would be the same sentence whether you
         * went on to keep it or not, which makes it useless for telling.
         */
        message: `${loan.letter} is on the desk — keep the drawing or throw it away when you are done`,
        tone: "info",
      },
    });
    this.touch();
  }

  /**
   * Take the letter off the desk and give back what it turned into.
   *
   * The advance goes back with the outline, because the letter has to keep its
   * place in the rhythm of the font: a shape drawn a little narrower than the
   * one it replaces should still sit in the width it was given, or the spacing
   * gains a hole nobody asked for. What the caller does with the pair is the
   * caller's business -- this store has no idea there is a forge.
   */
  keepLoan(): { letter: string; contours: Contour[]; advanceWidth: number } | null {
    const loan = this.state.loan;
    if (!loan) return null;
    /*
     * Found by name rather than by what happens to be selected.
     *
     * Reading the selection would hand back nothing at all if the last click had
     * landed on empty canvas, and "nothing" here means the drawing is thrown
     * away -- which is not a thing to leave resting on where a pointer was. The
     * desk holds one glyph and its name is the letter.
     */
    const drawn = this.glyph(loan.letter) ?? this.state.typeface?.glyphs[0] ?? null;
    const kept = drawn
      ? {
          letter: loan.letter,
          contours: cloneGlyph(drawn).contours,
          advanceWidth: drawn.advanceWidth,
        }
      : null;
    this.dropLoan();
    return kept;
  }

  /**
   * Let go of a loan without putting anything back, because something else has
   * taken the desk.
   *
   * Opening a font, restoring a project or starting a blank one all replace the
   * document outright -- they clear the history stacks too, which is the same
   * decision about the same work. Putting the held document back afterwards
   * would restore the font somebody had just chosen to leave, over the top of
   * the one they had just chosen to open.
   */
  private forgetLoan(): void {
    this.held = null;
    if (this.state.loan) this.set({ loan: null });
  }

  /** End the loan and put back what was on the desk, keeping nothing. */
  dropLoan(): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.undoStack = held.undoStack;
    this.redoStack = held.redoStack;
    this.ufo = held.ufo;
    this.controlBaseline = held.controlBaseline;
    this.state = { ...held.state, loan: null };
    // `touch` is what tells everybody, and it recomputes whether undo and redo
    // are live from the stacks that have just come back.
    this.touch();
  }

  // --- history ----------------------------------------------------------

  /*
   * Both of these now say what they moved.
   *
   * Neither said anything, and the change they make is often invisible from
   * where you are standing: a point put back in a letter you are no longer
   * looking at, a parameter returned to what it was, a path direction
   * corrected. Pressing Undo and seeing nothing happen is the same experience
   * as pressing a dead button, and a beginner's next move is to press it again.
   *
   * The label is quoted rather than conjugated. Every one of them is written in
   * the imperative for the undo stack -- "Close the outline", "Align points" --
   * and naming the action is honest where bending it into the past tense would
   * be a guess at English this does not need to make.
   */
  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    entry.undo();
    this.redoStack.push(entry);
    this.touch();
    this.say(`Undone: ${entry.label}`, "info");
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    entry.redo();
    this.undoStack.push(entry);
    this.touch();
    this.say(`Redone: ${entry.label}`, "info");
  }
}

export const store = new Store();

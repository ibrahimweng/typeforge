/**
 * A whole session, written down.
 *
 * Until this existed nothing was kept. Closing the tab lost an afternoon's
 * drawing with no prompt and no way back, which for a tool somebody is meant to
 * draw a typeface in is the fault that matters most -- every other shortcoming
 * costs time, and this one costs the work.
 *
 * What is written is a description rather than a picture. The drawn half is its
 * style and the handful of letters told to differ from it, which is a few
 * kilobytes for a whole typeface; the assembled half is the drawings that came
 * in; and the edited half is the font that was opened plus the glyphs that have
 * actually been touched. That last one is the reason this is a format and not a
 * `JSON.stringify` of the application: a font is six thousand glyphs, and
 * writing all of them out to record that somebody moved two would produce a
 * file of fifty megabytes describing an edit of fifty bytes.
 *
 * Everything here is plain JSON, which is what lets the same document be both
 * the file somebody saves and the thing kept in the browser between visits.
 */

import type { Assembly } from "@/assemble/document";
import type { Cast } from "@/font/cast";
import type { Forge } from "@/forge/document";
import type { Cuts } from "@/font/cuts";
import type {
  Glyph,
  GlyphParams,
  KernClass,
  KernPair,
  NamedLigature,
  NamedRule,
  NamedSet,
  Typeface,
} from "@/font/types";
// A type and nothing else: the UFO reader is fetched when a folder is opened,
// and this file is read on the first screen.
import type { UfoCarried, UfoFiles } from "@/ufo/font";

/** Which half of the application was open. */
export type Mode = "edit" | "forge" | "assemble" | "quill";

/**
 * The version of this format.
 *
 * Written into every file so that a document from an older Typeforge can be
 * recognised rather than half-read.
 *
 * Read `MIGRATIONS` below before changing this. Bumping the number without
 * writing the step that goes with it is what turns every document anybody has
 * saved into a file this application refuses to open.
 */
export const FORMAT = 2;

/**
 * The oldest version there is a path forward from.
 *
 * Every version from this one up to `FORMAT` can be read, because there is a
 * migration for each step between them. Anything older is a document from
 * before the chain was kept and there is nothing to do with it.
 */
export const OLDEST = 1;

/** A document as it sits in the file, before it is known to be one of ours. */
type Raw = Record<string, unknown>;

/**
 * What turns a document of one version into one of the next.
 *
 * `MIGRATIONS[n]` takes a document written by version `n` and gives back the
 * same document as version `n + 1` would have written it. They run in order, so
 * a version 1 document opened by version 4 goes through three of them and no
 * step has to know about any version but its own.
 *
 * What goes here is the step for a change that is not additive. A field that is
 * merely new does not need one: `readProject` fills a missing field in, so a
 * document written before it existed already reads as though it always had
 * one, and that is how most changes to this format have been made.
 *
 * The one step there is moves format 1's single `edit` into format 2's list of
 * them. That is not additive because the old field has to go: two places to
 * look for the same font is two answers with nothing to say which is newer.
 *
 * When you do bump `FORMAT`:
 *
 *   1. Add the step here under the version being left behind, so bumping
 *      `FORMAT` to 2 adds `MIGRATIONS[1]`.
 *   2. Change only what the new version changed. A step is not a validator, and
 *      what it hands on is checked by `readProject` afterwards like anything
 *      else.
 *   3. Leave `OLDEST` alone unless you are deliberately dropping support for
 *      documents that old, which costs somebody their work.
 */
const MIGRATIONS: Record<number, (document: Raw) => Raw> = {
  /*
   * 1 to 2: one edited font became several.
   *
   * The editor held a font; it now holds however many are open, in the order
   * their tabs sit in, and which of them was in front. So the one becomes a
   * list of one and the front is the only thing it can be.
   *
   * Moved rather than copied. A document carrying both `edit` and `edits`
   * would leave the reader two answers to the same question with nothing to
   * say which is the newer, and the first time they disagreed somebody would
   * get back a font they had already changed.
   */
  1: (document) => {
    const { edit, ...rest } = document;
    return edit ? { ...rest, edits: [edit], editAt: 0 } : rest;
  },
};

/**
 * Bring a document up to the current version, as far as it will come.
 *
 * Both the table of steps and the version being aimed at can be given rather
 * than reached for, and that is the whole reason this is testable. There is one
 * real step, which cannot show that steps run in order, that each is handed
 * what the one before gave back, or that a gap stops the chain -- and those are
 * exactly what a bump relies on. So a test hands this two steps of its own and
 * a target of 3. Nothing outside the tests passes either argument.
 */
export function migrate(
  raw: Raw,
  from: number,
  through: { steps?: Record<number, (document: Raw) => Raw>; upTo?: number } = {},
): Raw | null {
  const steps = through.steps ?? MIGRATIONS;
  const upTo = through.upTo ?? FORMAT;
  if (from < OLDEST) return null;
  let document = raw;
  for (let version = from; version < upTo; version++) {
    const step = steps[version];
    // A gap in the chain is a mistake in this file rather than in the document,
    // and carrying on past it would hand the reader a shape it does not know.
    if (!step) return null;
    document = step(document);
  }
  return document;
}

export interface Project {
  /** Names the format, so a file that is not one of ours says so immediately. */
  typeforge: number;
  /** When it was written, for showing in the interface. */
  saved: string;
  mode: Mode;
  draw?: DrawnProject;
  assemble?: AssembledProject;
  /**
   * The fonts open in the editor, in the order their tabs sit in.
   *
   * A list since format 2. It was one font, and keeping only the one in front
   * would have meant that opening a second and reloading lost the first --
   * work that was on screen a second earlier, gone with nothing said.
   */
  edits?: EditedProject[];
  /** Which of them was in front, so a session comes back where it was left. */
  editAt?: number;
  traced?: TracedProject;
}

export interface DrawnProject {
  forge: Forge;
  familyName: string;
  specimen: string;
}

export interface AssembledProject {
  assembly: Assembly;
  familyName: string;
  specimen: string;
}

/**
 * A font read back as strokes, and the hand laid over it.
 *
 * What is kept is the strokes and not the outlines they were read from, and
 * that is a decision rather than an economy. The strokes are the document --
 * they are what the sliders move and what an export redraws, so leaving them
 * out is what loses somebody's afternoon. The source outlines are a comparison
 * aid: they sit behind the redrawing so a change can be judged against where it
 * started, and they are somebody else's font. Writing those into a file
 * somebody keeps and sends on would be carrying a copy of that font around
 * inside a document that is not it.
 *
 * So a reopened trace has every stroke and every setting, and the ghost behind
 * them is gone until the font is read again. That is the right way round: the
 * work survives, the copy does not.
 */
export interface TracedProject {
  /** The file the strokes were read out of, for the panel to say. */
  from: string;
  /** What the font going out is called. */
  name: string;
  unitsPerEm: number;
  /** The hand, as the panel's ten controls left it. */
  style: Record<string, number>;
  /** One entry per letter: its strokes, and how far the fit strayed. */
  letters: Array<{
    name: string;
    advanceWidth: number;
    deviation: number;
    /** The strokes, exactly as the engine holds them. */
    strokes: unknown[];
    /**
     * An outline somebody drew, standing where the strokes would be.
     *
     * Written beside them rather than instead of them, so putting the letter
     * back under the hand costs a keystroke on reopening as well as during the
     * session it was drawn in.
     */
    byHand?: { contours: unknown[]; advanceWidth: number };
  }>;
}

/**
 * An edited font: the file it came from, and what has been done to it.
 *
 * The glyphs kept are the ones marked as touched. Everything else is exactly
 * what the original file said, so re-reading the file and laying these over the
 * top gives back the same document -- and a font nobody has edited yet is saved
 * as its own bytes and nothing else.
 */
export interface EditedProject {
  fileName: string;
  /**
   * The original file, as base64 -- when there was one.
   *
   * Absent for a font that never came from a file: one started blank in here,
   * or one handed over by Draw, Trace or Assemble. Those have no bytes to lay
   * anything back over, and for a long while that meant they were not written
   * down at all: the whole half was skipped, so drawing in a new font and
   * reloading gave back nothing, and the point edits made to a letter taken to
   * the tools went the same way.
   *
   * Its absence is what says which shape the rest is in. With a file, `glyphs`
   * holds the exceptions to it, because a font is six thousand letters and
   * writing all of them down to record that two moved would be fifty megabytes
   * describing fifty bytes of work. Without one, `glyphs` is the whole font --
   * which is affordable precisely because a font with no file behind it only
   * ever holds what somebody made in here.
   *
   * `features.ts` already reads a font this way round when it asks which
   * glyphs are worth looking at, and for the same reason.
   */
  font?: string;
  /**
   * The em, for a font with no file to read it from.
   *
   * Only written in that case, and it is not a detail that can be defaulted: a
   * blank font is a thousand units, an assembled one is whatever its drawings
   * were measured against, and a traced one is whatever it was traced from.
   * Restored at the wrong size, every letter in it is the wrong size.
   */
  unitsPerEm?: number;
  meta: Typeface["meta"];
  metrics: Typeface["metrics"];
  params: GlyphParams;
  /**
   * How the whole font is cut.
   *
   * A letter's own cuts ride along inside the glyph it belongs to, because a
   * letter cut its own way is a touched letter and touched letters are saved
   * whole. Only the font-wide description needs a place of its own.
   */
  cuts?: Cuts;
  /** And what is put on it, kept the same way and for the same reason. */
  cast?: Cast;
  kerning: KernPair[];
  kernClasses: KernClass[];
  /**
   * What the font substitutes, and under which feature.
   *
   * None of this was saved. It cost nothing while `alternates` was written
   * only by the forge -- which saves its own description and draws the rules
   * again -- and an edit-mode document's was always empty. The moment somebody
   * could make a ligature by hand, not saving it threw the work away on the
   * next reopen, silently, with the glyphs still there to make it look fine.
   *
   * All three optional, because every document written before this has none
   * and a reader that demands them turns those away at the door.
   */
  alternates?: NamedRule[];
  ligatures?: NamedLigature[];
  sets?: NamedSet[];
  /** Only the glyphs that have been touched. */
  glyphs: Glyph[];
  /**
   * Every glyph the font has, by name, in order -- for a font with a file.
   *
   * The touched glyphs say what changed in the letters that are still there,
   * and nothing about the ones that are not. Laid over a file that still has
   * them, a letter somebody removed came back on the next visit, and a letter
   * somebody renamed came back twice: once under its new name from `glyphs`,
   * once under its old one from the file. The list is what says which of the
   * file's letters are still in the font, and in what order.
   *
   * A name per glyph is tens of kilobytes for a large font, beside the font
   * itself at most of a megabyte, which is a price worth paying for a session
   * that gives back what was left rather than what was opened.
   *
   * Optional, because every document written before this has none, and those
   * go on being read the way they always were: letters laid over the file and
   * nothing taken away.
   */
  glyphNames?: string[];
  /**
   * What a font opened from a UFO carried that it does not model: its other
   * layers, its images, its `data` directory, the keys of its plists this
   * application does not know. Without it, a session reopened and exported
   * gave back a folder with all of that gone.
   *
   * Absent for a font that did not come from a UFO, and in every document
   * written before this existed.
   */
  ufo?: SavedUfo;
  /**
   * What the first weight is called and where it sits on the axis.
   *
   * Derivable from `meta.styleName` and `meta.weightClass` and saved anyway,
   * because a master's name is its own: somebody who calls the drawing they
   * started with "Text" has said something the style name does not.
   */
  weight?: SavedWeight;
  /**
   * The other weights of this typeface, if there are any.
   *
   * Each holds only the letters drawn in it, on the same terms as the font
   * above: a weight added to a six-thousand-glyph font and drawn in forty
   * places is forty letters on disk, not six thousand.
   *
   * Optional, because every document written before this has none and a reader
   * that demands the field turns those away at the door.
   */
  masters?: SavedMaster[];
  /**
   * Which weight was in hand.
   *
   * The document already promises to put somebody back where they were, in the
   * mode they left in and on the letter they were drawing. Coming back to the
   * Regular after an afternoon in the Black is the same broken promise one
   * level down, and it was written this way first: a test asked for the weight
   * it had been drawing and got the other one.
   */
  drawing?: string;
}

/**
 * A UFO's carried set, as JSON.
 *
 * A file is text or bytes, and JSON has no bytes, so each goes in as whichever
 * it is: text as itself, bytes as base64. Kept apart by field rather than
 * guessed at on the way back, because a PNG that happened to be valid UTF-8
 * read back as text would be written out as a different file.
 */
export interface SavedUfo {
  glyphsDirectory: string;
  files: SavedUfoFile[];
  originals?: SavedUfoFile[];
  glifKept?: Record<string, string[]>;
  unreadGlyphs?: Record<string, string>;
  kernGroupNames?: Record<string, { left: string; right: string }>;
  renamed?: Record<string, string>;
}

export interface SavedUfoFile {
  path: string;
  text?: string;
  base64?: string;
}

/** A weight's name and where it sits, without its drawing. */
export interface SavedWeight {
  name: string;
  at: Record<string, number>;
}

export interface SavedMaster extends SavedWeight {
  id: string;
  /** The letters drawn in this weight. The rest follow the first one. */
  glyphs: Glyph[];
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/*
 * Base64, done in chunks.
 *
 * `String.fromCharCode(...bytes)` is the one-liner everybody writes and it
 * throws on a real font: spreading seven hundred thousand arguments overflows
 * the call stack, and it does it at the size where somebody has finally opened
 * something worth saving.
 */
const CHUNK = 0x8000;

/*
 * The last font turned into text, kept.
 *
 * A font's bytes never change -- editing a glyph changes the model, not the
 * file it was read from -- and turning three quarters of a megabyte into base64
 * takes long enough to feel while somebody is dragging a slider. Since the
 * session is written down every time the drawing settles, that would be the
 * same work over and over for an answer that cannot have moved.
 *
 * Weak, so holding the answer does not hold the font: when the document goes,
 * this goes with it.
 */
const encoded = new WeakMap<Uint8Array, string>();

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(text);
}

function keptBase64(bytes: Uint8Array): string {
  const known = encoded.get(bytes);
  if (known !== undefined) return known;
  const text = toBase64(bytes);
  encoded.set(bytes, text);
  return text;
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/*
 * A carried set written out once and kept.
 *
 * What a UFO carries never changes after the folder is read -- it is what the
 * application does not touch -- and the session is written every time the
 * drawing settles. Base64 for a folder of tracing images is not work to do on
 * every one of those. Weak, for the reason `encoded` above is.
 */
const savedUfos = new WeakMap<UfoCarried, SavedUfo>();

function savedFiles(files: UfoFiles): SavedUfoFile[] {
  return [...files].map(([path, value]) =>
    typeof value === "string" ? { path, text: value } : { path, base64: keptBase64(value) },
  );
}

function loadedFiles(saved: unknown): UfoFiles {
  const files: UfoFiles = new Map();
  if (!Array.isArray(saved)) return files;
  for (const one of saved as SavedUfoFile[]) {
    if (typeof one?.path !== "string") continue;
    if (typeof one.text === "string") files.set(one.path, one.text);
    else if (typeof one.base64 === "string") files.set(one.path, fromBase64(one.base64));
  }
  return files;
}

/** What a UFO carried, as something a session can hold. */
export function toSavedUfo(carried: UfoCarried): SavedUfo {
  const known = savedUfos.get(carried);
  if (known) return known;
  const saved: SavedUfo = {
    glyphsDirectory: carried.glyphsDirectory,
    files: savedFiles(carried.untouched),
    originals: carried.originals ? savedFiles(carried.originals) : undefined,
    glifKept: carried.glifKept,
    unreadGlyphs: carried.unreadGlyphs,
    kernGroupNames: carried.kernGroupNames,
    renamed: carried.renamed,
  };
  savedUfos.set(carried, saved);
  return saved;
}

/**
 * And back, or null when what was saved is not one.
 *
 * Checked rather than trusted, like everything else read out of a document:
 * the worst a damaged record can do here is lose what the folder carried,
 * which is better than restoring a font that throws when it is exported.
 */
export function fromSavedUfo(saved: unknown): UfoCarried | null {
  if (typeof saved !== "object" || saved === null) return null;
  const raw = saved as Partial<SavedUfo>;
  if (typeof raw.glyphsDirectory !== "string" || !Array.isArray(raw.files)) return null;
  const record = <T>(value: unknown): T | undefined =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as T) : undefined;
  return {
    glyphsDirectory: raw.glyphsDirectory,
    untouched: loadedFiles(raw.files),
    originals: raw.originals ? loadedFiles(raw.originals) : undefined,
    glifKept: record(raw.glifKept),
    unreadGlyphs: record(raw.unreadGlyphs),
    kernGroupNames: record(raw.kernGroupNames),
    renamed: record(raw.renamed),
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface Snapshot {
  mode: Mode;
  draw?: DrawnProject;
  assemble?: AssembledProject;
  /**
   * The edited half: every font open in the editor, and every weight of each.
   *
   * `masters` is all of them including the first, whose typeface is the one
   * above -- so what gets written as the font is always the first weight, not
   * whichever one happened to be on screen when the timer went off.
   */
  edits?: Array<{
    typeface: Typeface;
    fileName: string;
    masters?: SavedMaster[];
    /** Which of them was in hand. */
    drawing?: string;
    /** What it carried, when it was opened from a UFO. */
    ufo?: UfoCarried | null;
  }>;
  /** Which font was in front, as an index into the list above. */
  editAt?: number;
  traced?: TracedProject;
}

/**
 * The session as a document.
 *
 * A half with nothing in it is left out rather than written as an empty one, so
 * a file says what was actually being worked on -- and so opening it does not
 * wipe a half the person had not touched.
 */
export function toProject(snapshot: Snapshot, at: Date): Project {
  const project: Project = {
    typeforge: FORMAT,
    saved: at.toISOString(),
    mode: snapshot.mode,
  };

  /*
   * The drawn half arrives already filtered.
   *
   * Deciding whether a drawing is worth keeping means comparing it against the
   * base it started from, which means the styles, the parts and the letter
   * recipes -- the whole drawing engine, on the first screen, to write a file
   * nobody has asked for yet. `worthKeeping` in `forge/document.ts` makes the
   * decision where those already live, and `drawingToKeep` in `state/drawn.ts`
   * is what asks it.
   */
  if (snapshot.draw) project.draw = snapshot.draw;
  if (snapshot.assemble && snapshot.assemble.assembly.pieces.length > 0) {
    project.assemble = snapshot.assemble;
  }
  /*
   * Every font that is open, and which of them was in front.
   *
   * One for one with the tabs, because there is no longer such a thing as a
   * font that cannot be written down. This used to walk the list keeping count
   * of what had been dropped, so that the index of the front font pointed at
   * what was kept rather than at what was open -- a piece of arithmetic that
   * existed only because fonts with no file behind them fell out here. Nothing
   * falls out, so it is a plain map and the index is the index.
   */
  const edits = (snapshot.edits ?? []).map((one) =>
    toEdited(one.typeface, one.fileName, one.masters, one.drawing, one.ufo),
  );
  if (edits.length > 0) {
    project.edits = edits;
    // Clamped rather than trusted, on the same terms as the reader below.
    project.editAt = Math.min(edits.length - 1, Math.max(0, Math.trunc(snapshot.editAt ?? 0)));
  }
  if (snapshot.traced && snapshot.traced.letters.length > 0) project.traced = snapshot.traced;
  return project;
}

/**
 * One font as a document, in whichever of the two shapes it has.
 *
 * Total: there is no font this cannot write. It used to refuse one with no
 * file behind it, which read as a small gap and was not -- a font started
 * blank, or drawn and taken to the tools, was simply never saved.
 */
function toEdited(
  typeface: Typeface,
  fileName: string,
  masters?: SavedMaster[],
  drawing?: string,
  ufo?: UfoCarried | null,
): EditedProject {
  const [first, ...rest] = masters ?? [];
  const source = typeface.source;
  return {
    fileName,
    font: source ? keptBase64(source.bytes) : undefined,
    // Read off the file when there is one, so it is written once rather than
    // in two places that can come to disagree.
    unitsPerEm: source ? undefined : typeface.unitsPerEm,
    meta: typeface.meta,
    metrics: typeface.metrics,
    params: typeface.params,
    cuts: typeface.cuts,
    cast: typeface.cast,
    kerning: typeface.kerning,
    kernClasses: typeface.kernClasses,
    alternates: typeface.alternates,
    ligatures: typeface.ligatures,
    sets: typeface.sets,
    // The exceptions to the file, or the whole font when there is no file for
    // anything to be an exception to.
    glyphs: source ? typeface.glyphs.filter((glyph) => glyph.dirty) : typeface.glyphs,
    // Which of the file's letters are still here, which the exceptions above
    // cannot say. Without a file, `glyphs` is the whole font and says it.
    glyphNames: source ? typeface.glyphs.map((glyph) => glyph.name) : undefined,
    ufo: ufo ? toSavedUfo(ufo) : undefined,
    weight: first ? { name: first.name, at: first.at } : undefined,
    drawing,
    // Left out entirely when there is one weight, so the ordinary document is
    // the shape it has always been.
    masters: rest.length > 0 ? rest : undefined,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** What came of trying to read a document. */
export interface Reading {
  /** The document, brought up to date, or null when it is not one of ours. */
  project: Project | null;
  /** The version that wrote it, when it said which. */
  from: number | null;
  /** What to tell somebody, when there is something worth telling them. */
  note: string | null;
}

/**
 * Read a document, refusing only what is not one.
 *
 * Everything is checked rather than trusted. A file picker takes whatever is
 * pointed at it, and a half-read document that throws three screens later is
 * worse than one that is turned away at the door.
 *
 * What is not a reason to turn one away is its version. A document older than
 * this one is brought forward through `migrate` and read normally. A document
 * newer than this one is read anyway, and this is the part worth arguing for:
 * every half below is checked on its own and dropped when it is not the shape
 * this version knows, so a document from a later Typeforge loses the halves
 * that changed and keeps the ones that did not. Refusing the file outright
 * loses those as well, and it loses them from the session too, because the
 * session is read through this same door. Somebody who opens today's work in
 * yesterday's tab should get back what yesterday can draw, not an empty
 * screen.
 */
export function readDocument(raw: unknown): Reading {
  /*
   * Nothing, and nothing to say about it either.
   *
   * The note is for what the caller could not have worked out on its own. That
   * a file is not a document is something it already knows by the time it has
   * a null, and it can say so better than this can: it has the file's name,
   * and it knows the button takes fonts as well, so what it says names both
   * things somebody might have meant. A note here would replace that sentence
   * with a worse one.
   */
  const nothing: Reading = { project: null, from: null, note: null };

  if (typeof raw !== "object" || raw === null) return nothing;
  const document = raw as Raw;

  // The field that says the file is ours at all. Anything without it is some
  // other JSON, and there is nothing here to read out of it.
  const from = document.typeforge;
  if (typeof from !== "number" || !Number.isInteger(from) || from < 1) return nothing;

  let carried: Raw = document;
  let note: string | null = null;

  if (from < FORMAT) {
    const brought = migrate(document, from);
    if (!brought) {
      return {
        project: null,
        from,
        note: `It was written by a version of Typeforge too old to read (format ${from}).`,
      };
    }
    carried = brought;
  } else if (from > FORMAT) {
    // Read anyway. What survives is whatever the halves below recognise.
    note = "It was written by a newer Typeforge. Some of it may be missing.";
  }

  // Says which version it was even when it could not be read, since by here the
  // file is one of ours and that is worth knowing.
  const project = readHalves(carried);
  if (!project) return { project: null, from, note: null };

  // Said only once there is a document to say it about, so a file that failed
  // for some other reason does not also get blamed on its version.
  return { project, from, note };
}

/**
 * The same thing for callers that only want the document.
 *
 * Kept because most of them do, and because a call that reads as a question
 * about a file should not have to unpack an answer about versions.
 */
export function readProject(raw: unknown): Project | null {
  return readDocument(raw).project;
}

/**
 * The edited fonts, each checked on its own, and which was in front.
 *
 * One unreadable font among four costs the one rather than the document, which
 * is how every other half here is treated. Dropping one moves the ones after
 * it up, so the index is clamped afterwards rather than trusted: it can then
 * name the wrong font in a document that was already damaged, which is a
 * better answer than naming none.
 */
function readEdits(project: Partial<Project>): Pick<Project, "edits" | "editAt"> {
  if (!Array.isArray(project.edits)) return {};
  /*
   * A file to lay letters over, or letters that are the whole font. Either is
   * a font; neither is an empty object, which is what a truncated record or
   * something that was never one of ours looks like.
   */
  const edits = project.edits.filter(
    (one) => typeof one?.font === "string" || Array.isArray(one?.glyphs),
  );
  if (edits.length === 0) return {};
  const wanted = Math.trunc(Number(project.editAt ?? 0)) || 0;
  return { edits, editAt: Math.min(Math.max(wanted, 0), edits.length - 1) };
}

/** The halves of a document, each checked on its own. */
function readHalves(raw: Raw): Project | null {
  const project = raw as Partial<Project>;
  if (
    project.mode !== "edit" &&
    project.mode !== "forge" &&
    project.mode !== "assemble" &&
    project.mode !== "quill"
  ) {
    return null;
  }
  return {
    typeforge: FORMAT,
    saved: typeof project.saved === "string" ? project.saved : new Date(0).toISOString(),
    mode: project.mode,
    // Filled in on the way through, so a document written before a field
    // existed reads as though it always had one.
    /*
     * A drawing needs a style; a half without one is turned away rather than
     * filled in. There is a difference between a document written before a
     * field existed -- which is most of them -- and one with nothing in it to
     * fill, which is a truncated file or a record from something that was
     * never this application. Fabricating a face for the second kind would
     * restore somebody into a drawing they never made.
     *
     * Filling in the first kind is `whole` in `forge/document.ts`, and it is
     * applied where the drawing is put back rather than here. It has to know
     * every field a style can have, which is the drawing engine -- and this
     * file is read on the first screen to say what is in the browser, for a
     * drawn half that most sessions do not have. What comes out of here is a
     * document as it was written; `restoreDrawing` makes it a current one.
     */
    draw: project.draw?.forge?.style ? (project.draw as DrawnProject) : undefined,
    assemble: project.assemble?.assembly ? project.assemble : undefined,
    ...readEdits(project),
    // Checked for its letters rather than merely for being an object: a traced
    // half with no strokes in it restores an empty Trace view claiming to be
    // where somebody left off, which is the thing this used to do by leaving
    // the half out entirely.
    traced:
      Array.isArray(project.traced?.letters) && project.traced.letters.length > 0
        ? project.traced
        : undefined,
  };
}

/** What a document holds, said in one line for the interface. */
export function describe(project: Project): string {
  const halves: string[] = [];
  if (project.draw) halves.push(`a drawn ${project.draw.familyName}`);
  if (project.assemble) {
    const count = project.assemble.assembly.pieces.length;
    halves.push(`${count} assembled ${count === 1 ? "drawing" : "drawings"}`);
  }
  // By its file name, or by what it calls itself when it never came from a
  // file -- an empty string in this list would be a half that reads as missing.
  for (const one of project.edits ?? []) halves.push(one.fileName || one.meta.familyName);
  if (project.traced) {
    const count = project.traced.letters.length;
    halves.push(`${count} traced ${count === 1 ? "letter" : "letters"}`);
  }
  if (halves.length === 0) return "nothing";
  return halves.join(", ");
}

/**
 * Lay a saved font's changes back over the file it came from.
 *
 * The glyphs in the document are the touched ones and nothing else, so they are
 * matched by name rather than by position: a font re-read from its own bytes
 * has its glyphs in the same order, but matching on that would turn a change in
 * the parser into a font whose letters had quietly swapped places.
 */
export function applyEdits(typeface: Typeface, saved: EditedProject): Typeface {
  typeface.meta = saved.meta;
  typeface.metrics = saved.metrics;
  typeface.params = saved.params;
  typeface.cuts = saved.cuts;
  typeface.cast = saved.cast;
  typeface.kerning = saved.kerning;
  typeface.kernClasses = saved.kernClasses;
  /*
   * Kept only where the document has something to say. A file written before
   * these were saved says nothing about them, which is not the same as saying
   * there are none: the font it was made from may carry its own, and reading
   * silence as emptiness would take them out.
   */
  if (saved.alternates) typeface.alternates = saved.alternates;
  if (saved.ligatures) typeface.ligatures = saved.ligatures;
  if (saved.sets) typeface.sets = saved.sets;

  for (const glyph of saved.glyphs) {
    const at = typeface.glyphIndex.get(glyph.name);
    if (at === undefined) {
      typeface.glyphIndex.set(glyph.name, typeface.glyphs.length);
      typeface.glyphs.push(glyph);
    } else {
      typeface.glyphs[at] = glyph;
    }
  }

  /*
   * And then only the letters the font still had, in the order it had them.
   *
   * This is what takes a removed letter back out of the file it was removed
   * from, and the old name of a renamed one with it -- the new name is a
   * touched glyph and arrived above. A document with no list is one written
   * before there was one, and is left as it always was.
   *
   * A saved glyph the list does not mention is kept rather than dropped. The
   * two are written together and should agree; when they do not, keeping
   * somebody's drawing is the mistake worth making.
   */
  if (Array.isArray(saved.glyphNames)) {
    const byName = new Map(typeface.glyphs.map((glyph) => [glyph.name, glyph]));
    const kept: Glyph[] = [];
    for (const name of saved.glyphNames) {
      const glyph = typeof name === "string" ? byName.get(name) : undefined;
      if (!glyph) continue;
      kept.push(glyph);
      byName.delete(name);
    }
    for (const glyph of saved.glyphs) {
      if (byName.get(glyph.name) === glyph) kept.push(glyph);
    }
    typeface.glyphs = kept;
    typeface.glyphIndex = new Map(kept.map((glyph, index) => [glyph.name, index]));
  }
  return typeface;
}

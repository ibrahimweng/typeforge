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
import { anyCut } from "@/forge/cut";
import { baseNamed, cutsOf, familyOf, startFrom, whole, type Forge } from "@/forge/document";
import type { Cuts } from "@/font/cuts";
import type { Glyph, GlyphParams, KernClass, KernPair, Typeface } from "@/font/types";

/** Which half of the application was open. */
export type Mode = "edit" | "forge" | "assemble";

/**
 * The version of this format.
 *
 * Written into every file so that a document from an older Typeforge can be
 * recognised rather than half-read. There is one version so far and this is it;
 * what matters is that the field is there before there are two.
 */
export const FORMAT = 1;

export interface Project {
  /** Names the format, so a file that is not one of ours says so immediately. */
  typeforge: number;
  /** When it was written, for showing in the interface. */
  saved: string;
  mode: Mode;
  draw?: DrawnProject;
  assemble?: AssembledProject;
  edit?: EditedProject;
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
 * An edited font: the file it came from, and what has been done to it.
 *
 * The glyphs kept are the ones marked as touched. Everything else is exactly
 * what the original file said, so re-reading the file and laying these over the
 * top gives back the same document -- and a font nobody has edited yet is saved
 * as its own bytes and nothing else.
 */
export interface EditedProject {
  fileName: string;
  /** The original file, as base64. */
  font: string;
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
  kerning: KernPair[];
  kernClasses: KernClass[];
  /** Only the glyphs that have been touched. */
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

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface Snapshot {
  mode: Mode;
  draw?: DrawnProject;
  assemble?: AssembledProject;
  edit?: { typeface: Typeface; fileName: string };
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

  if (snapshot.draw && hasDrawing(snapshot.draw)) project.draw = snapshot.draw;
  if (snapshot.assemble && snapshot.assemble.assembly.pieces.length > 0) {
    project.assemble = snapshot.assemble;
  }
  if (snapshot.edit?.typeface.source) {
    project.edit = toEdited(snapshot.edit.typeface, snapshot.edit.fileName);
  }
  return project;
}

/**
 * Whether the drawn half holds anything worth keeping.
 *
 * A base on its own is not work: the application opens on one, so saving that
 * would restore somebody into a font they never made and would overwrite the
 * one they did. Anything told to differ from the base is.
 */
function hasDrawing(drawn: DrawnProject): boolean {
  const { forge } = drawn;
  const started = baseNamed(forge.base);
  return (
    Object.keys(forge.exceptions).length > 0 ||
    Object.keys(forge.imported).length > 0 ||
    drawn.familyName !== "Untitled" ||
    // Asking for a second weight, or saying that what is drawn is the Black
    // rather than the Regular, is a decision about the typeface and one nobody
    // would want to make twice. Compared against what starting from this base
    // would have given, because half the bases are not a Regular and arriving
    // at one is not an edit.
    (started !== undefined &&
      JSON.stringify(familyOf(forge)) !== JSON.stringify(familyOf(startFrom(started)))) ||
    // A base comes with its own choice of letterforms, so an alternate only
    // counts as work when it differs from the one the base asked for.
    JSON.stringify(forge.alternates) !== JSON.stringify(started?.forms ?? {}) ||
    // Compared against the base as it ships rather than against a copy taken at
    // the start, so a session that changed one slider and put it back reads as
    // untouched -- which it is.
    (started !== undefined && JSON.stringify(forge.style) !== JSON.stringify(started)) ||
    // A cut is work of exactly the same kind, and the kind most easily lost:
    // a face with slots through it is nothing but its cuts, and a base with
    // nothing else touched would have been thrown away as an empty document.
    anyCut(cutsOf(forge)) ||
    Object.keys(forge.cutExceptions ?? {}).length > 0 ||
    // A font laid out on a grid is nothing but its cells, and a document with
    // an afternoon of them in it would have been thrown away as empty.
    Object.keys(forge.kit?.glyphs ?? {}).length > 0
  );
}

function toEdited(typeface: Typeface, fileName: string): EditedProject | undefined {
  if (!typeface.source) return undefined;
  return {
    fileName,
    font: keptBase64(typeface.source.bytes),
    meta: typeface.meta,
    metrics: typeface.metrics,
    params: typeface.params,
    cuts: typeface.cuts,
    kerning: typeface.kerning,
    kernClasses: typeface.kernClasses,
    glyphs: typeface.glyphs.filter((glyph) => glyph.dirty),
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Read a document, refusing anything that is not one.
 *
 * Everything is checked rather than trusted. A file picker takes whatever is
 * pointed at it, and a half-read document that throws three screens later is
 * worse than one that is turned away at the door.
 */
export function readProject(raw: unknown): Project | null {
  if (typeof raw !== "object" || raw === null) return null;
  const project = raw as Partial<Project>;
  if (project.typeforge !== FORMAT) return null;
  if (project.mode !== "edit" && project.mode !== "forge" && project.mode !== "assemble") {
    return null;
  }
  return {
    typeforge: FORMAT,
    saved: typeof project.saved === "string" ? project.saved : new Date(0).toISOString(),
    mode: project.mode,
    // Filled in on the way through, so a document written before a field
    // existed reads as though it always had one.
    draw: project.draw?.forge
      ? { ...project.draw, forge: whole(project.draw.forge) }
      : undefined,
    assemble: project.assemble?.assembly ? project.assemble : undefined,
    edit: project.edit?.font ? project.edit : undefined,
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
  if (project.edit) halves.push(project.edit.fileName);
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
  typeface.kerning = saved.kerning;
  typeface.kernClasses = saved.kernClasses;

  for (const glyph of saved.glyphs) {
    const at = typeface.glyphIndex.get(glyph.name);
    if (at === undefined) {
      typeface.glyphIndex.set(glyph.name, typeface.glyphs.length);
      typeface.glyphs.push(glyph);
    } else {
      typeface.glyphs[at] = glyph;
    }
  }
  return typeface;
}

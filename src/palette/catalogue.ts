/**
 * Everything the palette can reach, gathered from the registries that already
 * describe it.
 *
 * Nothing here is a second description of the product. The controls come from
 * `PARTS` and `PARAMS`, the faces from `BASES`, the alternates from
 * `ALTERNATES`, the letters from the engine's own list -- the same tables the
 * panels and the help drawer draw themselves from. A palette that kept its own
 * copy would be wrong the first time a control was renamed, and it would be
 * wrong silently, which is the worst way for a search to be wrong.
 *
 * What is written by hand is the actions, because an action is a verb and the
 * product has no table of its verbs: they live in the shell's callbacks. Those
 * are handed in rather than reached for, so this file stays a description and
 * the wiring stays in `App.tsx` where the rest of it is.
 */

import { PARAMS } from "@/components/param-specs";
import { DEFAULT_PARAMS, type GlyphParams } from "@/font/types";
import { letterNames } from "@/forge/build";
import { ALTERNATES } from "@/forge/letters";
import { PART_SPECS, type PartName } from "@/forge/parts";
import { BASES } from "@/forge/style";
import type { Mode } from "@/App";
import type { ViewId } from "@/state/store";
import type { Entry, EntryKind } from "./search";

/** A number the palette can move without leaving itself. */
export interface Adjustable {
  min: number;
  max: number;
  step: number;
  /** Where it sits now, read afresh each render. */
  read: () => number;
  write: (value: number, done: boolean) => void;
  /** Shown beside the slider, already rounded for reading. */
  format?: (value: number) => string;
}

/** A choice between named shapes, rather than a number. */
export interface Choosable {
  options: ReadonlyArray<{ value: string; label: string; hint: string }>;
  read: () => string;
  write: (value: string) => void;
}

export interface Item extends Entry {
  /** The heading it sits under. */
  group: string;
  /**
   * The name without the part in front of it.
   *
   * A control's label has to say which part it belongs to -- there are four
   * called "Projection" -- but once its own row is open the part is already
   * written directly above the slider, and printing it twice reads as a bug.
   */
  short?: string;
  /** Where picking it will take you, when that is somewhere else. */
  where?: string;
  /** Runs it. Absent for a control, which is adjusted in place instead. */
  run?: () => void;
  adjust?: Adjustable;
  choose?: Choosable;
  toggle?: { read: () => boolean; write: (on: boolean) => void };
  /**
   * True for anything that throws work away. The palette asks before running
   * one of these rather than doing it on a keystroke.
   */
  destructive?: boolean;
}

/**
 * What the shell can do, handed in so this file does not have to reach into it.
 *
 * Every one of these already exists as a button somewhere; the palette is a
 * second door to the same room, not a second implementation of it.
 */
export interface Shell {
  mode: Mode;
  setMode: (mode: Mode) => void;
  view: ViewId;
  setView: (view: ViewId) => void;
  openFile: () => void;
  export: () => void;
  save: () => void;
  newProject: () => void;
  toggleHelp: () => void;
  library: () => void;
  selectGlyph: (name: string) => void;
  /** Family parameters, for the five views that share a loaded font. */
  paramOf: (key: keyof GlyphParams) => number;
  setParam: (key: keyof GlyphParams, value: number, done: boolean) => void;
  /** Forge parts. */
  partOf: (part: PartName, key: string) => number | string | boolean;
  setPart: (part: PartName, key: string, value: number | string | boolean, done: boolean) => void;
  startFromBase: (name: string) => void;
  chooseAlternate: (letter: string, form: string) => void;
  hasFont: boolean;
}

const VIEWS: Array<{ id: ViewId; label: string; hint: string }> = [
  {
    id: "grid",
    label: "All letters",
    hint: "Every glyph in the font at once, as a chart. The place to see what is drawn, what is missing, and which letters do not match their neighbours.",
  },
  {
    id: "glyph",
    label: "Edit one letter",
    hint: "One letter, large, with its outline and nodes. Where a curve is pulled about by hand and where anchors are placed.",
  },
  {
    id: "kerning",
    label: "Kerning",
    hint: "The space between one letter and the next, pair by pair. Where a word is made to read evenly rather than in clumps.",
  },
  {
    id: "metrics",
    label: "Metrics",
    hint: "The lines a font is drawn between and the room either side of each letter: baseline, x-height, cap height, ascender, descender, sidebearings.",
  },
  {
    id: "report",
    label: "Report",
    hint: "What is wrong with the font: open contours, points off the grid, glyphs with no outline, anything that would trouble a font checker.",
  },
];

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  {
    id: "edit",
    label: "Edit a font",
    hint: "Reshape a font somebody else made. Open a file, pull its curves about, adjust the family as a whole, and write it back out.",
  },
  {
    id: "forge",
    label: "Draw a font",
    hint: "Build a typeface from a description rather than from outlines: choose a starting face, then move the named parts and watch every letter follow.",
  },
  {
    id: "assemble",
    label: "Assemble from drawings",
    hint: "Turn a pile of artwork into a font. Drop in drawings, say which letter each one is, and get a font out the other end.",
  },
];

/** The whole catalogue, in the order the empty palette shows it. */
export function catalogue(shell: Shell): Item[] {
  const items: Item[] = [];
  const add = (item: Item) => items.push(item);

  // ---- Actions -----------------------------------------------------------
  add({
    id: "action:new",
    kind: "action",
    group: "Actions",
    label: "Start a new font",
    hint: "Clear everything and begin again from nothing. Throws away the font that is open and anything drawn on it.",
    also: ["restart", "blank", "empty", "fresh", "reset", "start over", "new project"],
    destructive: true,
    run: shell.newProject,
  });
  add({
    id: "action:open",
    kind: "action",
    group: "Actions",
    label: "Upload a font",
    hint: "Open a font file or a saved project from this computer. Replaces whatever is open at the moment.",
    also: ["import", "load", "ttf", "otf", "woff", "woff2", "browse", "file", "drop"],
    destructive: true,
    run: shell.openFile,
  });
  add({
    id: "action:library",
    kind: "action",
    group: "Actions",
    label: "Open from the library",
    hint: "Pick one of the fonts that came with the tool, or something saved here earlier, without going to the file system.",
    also: ["examples", "samples", "saved", "recent", "gallery"],
    run: shell.library,
  });
  add({
    id: "action:save",
    kind: "action",
    group: "Actions",
    label: "Save the project",
    hint: "Write the whole state of the work to a project file that can be opened again later, keeping every part, cut and alternate.",
    also: ["keep", "download project", "typeforge file", "backup"],
    run: shell.save,
  });
  add({
    id: "action:export",
    kind: "action",
    group: "Actions",
    label:
      shell.mode === "assemble"
        ? "Export the assembled font"
        : shell.mode === "forge"
          ? "Export the drawn font"
          : "Export the font",
    hint: "Write a real font file out: OTF or TTF, a whole family, or one variable font with a weight axis. This is the thing you install.",
    also: ["download", "otf", "ttf", "woff", "variable", "install", "produce", "generate", "output"],
    run: shell.export,
  });
  add({
    id: "action:help",
    kind: "action",
    group: "Actions",
    label: "Help",
    hint: "What every control does, in the terms a designer would use, and a walkthrough for arriving here the first time.",
    also: ["what does", "explain", "guide", "manual", "tour", "docs"],
    run: shell.toggleHelp,
  });

  // ---- Modes and views ---------------------------------------------------
  for (const mode of MODES) {
    if (mode.id === shell.mode) continue;
    add({
      id: `mode:${mode.id}`,
      kind: "view",
      group: "Go to",
      label: mode.label,
      hint: mode.hint,
      where: "Switches what you are doing",
      run: () => shell.setMode(mode.id),
    });
  }
  for (const view of VIEWS) {
    add({
      id: `view:${view.id}`,
      kind: "view",
      group: "Go to",
      label: view.label,
      hint: view.hint,
      where: shell.mode === "edit" ? undefined : "Editing a font",
      run: () => {
        shell.setMode("edit");
        shell.setView(view.id);
      },
    });
  }

  // ---- The family's own numbers -----------------------------------------
  for (const spec of PARAMS) {
    add({
      id: `param:${spec.key}`,
      kind: "control",
      group: "Whole font",
      label: spec.label,
      hint: spec.hint,
      also: [spec.key, spec.unit ?? ""],
      where: shell.mode === "edit" ? undefined : "Editing a font",
      adjust: {
        min: spec.min,
        max: spec.max,
        step: spec.step,
        read: () => shell.paramOf(spec.key) ?? DEFAULT_PARAMS[spec.key],
        write: (value, done) => {
          shell.setMode("edit");
          shell.setParam(spec.key, value, done);
        },
        format: (value) => trim(value, spec.step),
      },
    });
  }

  // ---- The drawn face's parts -------------------------------------------
  for (const part of PART_SPECS) {
    for (const control of part.controls) {
      const id = `part:${part.name}:${control.key}`;
      const where = shell.mode === "forge" ? undefined : "Drawing a font";
      const base: Item = {
        id,
        kind: "control",
        group: part.label,
        // Named by the part as well, because "Projection" alone says nothing
        // and there are four of them.
        label: `${part.label}: ${control.label}`,
        short: control.label,
        hint: control.hint,
        also: [part.hint, part.name, control.key],
        where,
      };
      if (control.options) {
        add({
          ...base,
          choose: {
            options: control.options,
            read: () => String(shell.partOf(part.name, control.key) ?? control.options![0].value),
            write: (value) => {
              shell.setMode("forge");
              shell.setPart(part.name, control.key, value, true);
            },
          },
        });
        continue;
      }
      if (control.toggle) {
        add({
          ...base,
          toggle: {
            read: () => Boolean(shell.partOf(part.name, control.key)),
            write: (on) => {
              shell.setMode("forge");
              shell.setPart(part.name, control.key, on, true);
            },
          },
        });
        continue;
      }
      add({
        ...base,
        adjust: {
          min: control.min,
          max: control.max,
          step: control.step,
          read: () => Number(shell.partOf(part.name, control.key) ?? control.min),
          write: (value, done) => {
            shell.setMode("forge");
            shell.setPart(part.name, control.key, value, done);
          },
          format: (value) => trim(value, control.step),
        },
      });
    }
  }

  // ---- Faces -------------------------------------------------------------
  for (const base of BASES) {
    add({
      id: `face:${base.name}`,
      kind: "face",
      group: "Start from a face",
      label: base.name,
      hint: base.blurb ?? `Start drawing from the ${base.name}.`,
      also: ["base", "style", "starting point", "preset"],
      where: "Drawing a font",
      // It replaces every part with that face's, which is the work so far.
      destructive: true,
      run: () => {
        shell.setMode("forge");
        shell.startFromBase(base.name);
      },
    });
  }

  // ---- Alternates --------------------------------------------------------
  for (const [letter, forms] of Object.entries(ALTERNATES)) {
    for (const form of forms) {
      add({
        id: `alt:${letter}:${form.id}`,
        kind: "alternate",
        group: "Other letterforms",
        label: `${letter}: ${form.label}`,
        hint: form.hint,
        also: ["alternate", "variant", "another way", "different", letter],
        where: "Drawing a font",
        run: () => {
          shell.setMode("forge");
          shell.chooseAlternate(letter, form.id);
        },
      });
    }
  }

  // ---- Letters -----------------------------------------------------------
  for (const name of letterNames()) {
    const character = characterFor(name);
    add({
      id: `letter:${name}`,
      kind: "letter",
      group: "Letters",
      label: name,
      hint: character ? `The letter ${character}.` : `The glyph ${name}.`,
      also: [character ?? "", readable(name)],
      where: "Editing a font",
      run: () => {
        shell.setMode("edit");
        shell.selectGlyph(name);
        shell.setView("glyph");
      },
    });
  }

  return items;
}

/** A number written for reading rather than for arithmetic. */
function trim(value: number, step: number): string {
  const places = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return value.toFixed(places);
}

/**
 * The character a glyph name stands for, where the name is one.
 *
 * Only the plain cases, because the point is to let somebody type the letter
 * rather than its name. A glyph called `aacute` is found by its name and by
 * "a acute" through the word split; there is no need to guess at its character.
 */
function characterFor(name: string): string | null {
  if (name.length === 1) return name;
  const known: Record<string, string> = {
    space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$",
    percent: "%", ampersand: "&", quotesingle: "'", parenleft: "(",
    parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-",
    period: ".", slash: "/", zero: "0", one: "1", two: "2", three: "3",
    four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
    colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">",
    question: "?", at: "@", bracketleft: "[", backslash: "\\",
    bracketright: "]", asciicircum: "^", underscore: "_", grave: "`",
    braceleft: "{", bar: "|", braceright: "}", asciitilde: "~",
  };
  return known[name] ?? null;
}

/**
 * A glyph name split where a reader would split it.
 *
 * `Gcommaaccent` is three words to somebody looking for a comma accent and one
 * unsearchable lump to a word index. The pieces are the ones the names are
 * actually built from, which is a short list because the names come from one
 * convention.
 */
const PIECES = [
  "acute", "grave", "circumflex", "tilde", "dieresis", "macron", "breve",
  "dotaccent", "ring", "cedilla", "ogonek", "caron", "hungarumlaut",
  "commaaccent", "slash", "stroke", "bar", "superior", "inferior", "small",
  "left", "right", "single", "double", "quote", "guil", "half", "quarter",
  "three", "one", "two", "dot", "less", "greater", "equal", "plus", "minus",
];

function readable(name: string): string {
  let out = name;
  for (const piece of PIECES) out = out.split(piece).join(` ${piece} `);
  return out.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

export type { EntryKind };

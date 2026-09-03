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
import {
  CAST_SPECS,
  CUT_SPECS,
  METRIC_CONTROLS,
  PART_SPECS,
  PEN_CONTROLS,
  type PartControl,
  type PartName,
  type FieldControl,
} from "@/forge/parts";
import type { CastName } from "@/forge/cast";
import type { CutName } from "@/forge/cut";
import { BASES } from "@/forge/style";
import type { Mode } from "@/App";
import type { ViewId } from "@/state/store";
import { AXES } from "@/font/master";
import { viewKey } from "@/keys/useAppKeys";
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
  /**
   * The key that does this without opening the palette at all.
   *
   * Shown on the row, which is the one place it is certain to be read: a
   * shortcut is learnt at the moment somebody takes the slow way to the thing
   * it is for. A list of keys in the help drawer is a list somebody has to
   * decide to go and study.
   */
  keys?: string;
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
  /**
   * The folder door, which has to be its own.
   *
   * `webkitdirectory` is a property of the input element rather than of the
   * click, so an input that picks folders cannot also pick files. This is that
   * second input, not a second way of doing the same thing.
   */
  openFolder: () => void;
  export: () => void;
  save: () => void;
  newProject: () => void;
  /**
   * Ask for another version of this typeface, drawn rather than calculated.
   *
   * Here as well as on the whole-font screen because everything else the
   * application can do is reachable from this one search box, and a control
   * that is only in one place is a control somebody has to already know about.
   */
  addVersion: (axis: string) => void;
  toggleHelp: () => void;
  library: () => void;
  selectGlyph: (name: string) => void;
  /** Family parameters, for the five views that share a loaded font. */
  paramOf: (key: keyof GlyphParams) => number;
  setParam: (key: keyof GlyphParams, value: number, done: boolean) => void;
  /** Forge parts. */
  partOf: (part: PartName, key: string) => number | string | boolean;
  setPart: (part: PartName, key: string, value: number | string | boolean, done: boolean) => void;
  /**
   * The pen the forge draws with, and the lines the letters stand on.
   *
   * These are not parts -- a part belongs to a letter and these belong to the
   * whole face -- so they are their own registries and want their own readers.
   */
  penOf: (key: string) => number;
  setPen: (key: string, value: number, done: boolean) => void;
  metricOf: (key: string) => number;
  setMetric: (key: string, value: number, done: boolean) => void;
  /** What is done to the letter after it has been drawn. */
  cutOf: (cut: CutName, key: string) => number | string | boolean;
  setCut: (cut: CutName, key: string, value: number | string | boolean, done: boolean) => void;
  castOf: (cast: CastName, key: string) => number | string | boolean;
  setCast: (cast: CastName, key: string, value: number | string | boolean, done: boolean) => void;
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
    keys: "⌘O",
    kind: "action",
    group: "Actions",
    label: "Upload a font",
    hint: "Open a font file or a saved project from this computer. Replaces whatever is open at the moment.",
    also: ["import", "load", "ttf", "otf", "woff", "woff2", "browse", "file", "drop"],
    destructive: true,
    run: shell.openFile,
  });
  add({
    id: "action:open-folder",
    kind: "action",
    group: "Actions",
    label: "Open a UFO folder",
    hint: "A UFO is a folder rather than a file, which is why it has its own way in: one file input can pick files or folders and not both.",
    also: ["ufo", "folder", "directory", "source", "robofont", "glyphs", "designspace", "import"],
    destructive: true,
    run: shell.openFolder,
  });
  for (const axis of AXES) {
    add({
      id: `action:version:${axis.tag}`,
      kind: "action",
      group: "Actions",
      label: `Add a ${axis.label.toLowerCase()}`,
      hint: `Copy this version of the typeface into another one you draw ${axis.label.toLowerCase()} away from it, and the exported font blends between them. A Bold beside the Regular, a Condensed beside the wide one.`,
      also: [
        "master",
        "version",
        "variable",
        "axis",
        "interpolate",
        "family",
        "second",
        axis.tag,
        ...(axis.tag === "wght" ? ["bold", "light", "black", "weight"] : []),
        ...(axis.tag === "wdth" ? ["condensed", "narrow", "wide", "extended"] : []),
        ...(axis.tag === "slnt" ? ["italic", "oblique", "lean"] : []),
        ...(axis.tag === "opsz" ? ["display", "caption", "text size"] : []),
      ],
      run: () => shell.addVersion(axis.tag),
    });
  }
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
    keys: "⌘S",
    kind: "action",
    group: "Actions",
    label: "Save the project",
    hint: "Write the whole state of the work to a project file that can be opened again later, keeping every part, cut and alternate.",
    also: ["keep", "download project", "typeforge file", "backup"],
    run: shell.save,
  });
  add({
    id: "action:export",
    keys: "⌘E",
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
      // The six tabs answer to their own numbers, in the order they sit in.
      keys: viewKey(view.id) ?? undefined,
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
          // What it can be set to, as well as what it is. A choice between
          // named shapes carries its meaning in the options rather than in the
          // hint -- "Which edge" says "Where the saw runs" and leaves every
          // word that would find it ("left", "foot", "both flanks") sitting in
          // the five options underneath.
          also: [...(base.also ?? []), ...optionWords(control.options)],
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

  // ---- The pen, and the lines the letters stand on -----------------------
  //
  // A part belongs to a letter; these belong to the whole face, so they keep
  // their own registries -- and the first version of this file read `PARAMS`
  // and `PART_SPECS` and stopped there. That left the pen's own weight, the
  // first thing anybody drawing a face reaches for, unreachable from the
  // palette. The `Weight` that did answer to "fatter" was the whole-font
  // transform in edit mode: a different control that happens to share a name,
  // and answering with it took you out of the forge to use it.
  const drawing = shell.mode === "forge" ? undefined : "Drawing a font";

  const fields: Array<{
    group: string;
    prefix: string;
    controls: readonly FieldControl[];
    read: (key: string) => number;
    write: (key: string, value: number, done: boolean) => void;
  }> = [
    {
      group: "The pen",
      prefix: "pen",
      controls: PEN_CONTROLS,
      read: (key) => shell.penOf(key),
      write: (key, value, done) => shell.setPen(key, value, done),
    },
    {
      group: "Proportions",
      prefix: "metrics",
      controls: METRIC_CONTROLS,
      read: (key) => shell.metricOf(key),
      write: (key, value, done) => shell.setMetric(key, value, done),
    },
  ];

  for (const field of fields) {
    for (const control of field.controls) {
      const base: Item = {
        id: `${field.prefix}:${control.key}`,
        kind: "control",
        group: field.group,
        label: control.label,
        hint: control.hint,
        also: [control.key, field.group],
        where: drawing,
      };
      if (control.toggle) {
        add({
          ...base,
          toggle: {
            read: () => Boolean(field.read(control.key)),
            write: (on) => {
              shell.setMode("forge");
              field.write(control.key, on ? 1 : 0, true);
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
          read: () => field.read(control.key),
          write: (value, done) => {
            shell.setMode("forge");
            field.write(control.key, value, done);
          },
          format: (value) => trim(value, control.step),
        },
      });
    }
  }

  // ---- What is done to the letter after it has been drawn ----------------
  //
  // A cut takes ink away and a cast puts it back, and both happen once the pen
  // has finished, which is why neither is a part. Each is a switch and then its
  // own numbers, so the switch is offered too: somebody who wants slots wants
  // them turned on, not a slot thickness on a face that has no slots.
  const operations: Array<{
    prefix: string;
    specs: ReadonlyArray<{ name: string; label: string; hint: string; controls: PartControl[] }>;
    also: string;
    read: (name: string, key: string) => number | string | boolean;
    write: (name: string, key: string, value: number | string | boolean, done: boolean) => void;
  }> = [
    {
      prefix: "cut",
      specs: CUT_SPECS,
      also: "cut away",
      read: (name, key) => shell.cutOf(name as CutName, key),
      write: (name, key, value, done) => shell.setCut(name as CutName, key, value, done),
    },
    {
      prefix: "cast",
      specs: CAST_SPECS,
      also: "added to the letter",
      read: (name, key) => shell.castOf(name as CastName, key),
      write: (name, key, value, done) => shell.setCast(name as CastName, key, value, done),
    },
  ];

  for (const operation of operations) {
    for (const spec of operation.specs) {
      add({
        id: `${operation.prefix}:${spec.name}:on`,
        kind: "control",
        group: spec.label,
        label: spec.label,
        hint: spec.hint,
        also: [operation.prefix, operation.also, spec.name],
        where: drawing,
        toggle: {
          read: () => Boolean(operation.read(spec.name, "on")),
          write: (on) => {
            shell.setMode("forge");
            operation.write(spec.name, "on", on, true);
          },
        },
      });
      for (const control of spec.controls) {
        const base: Item = {
          id: `${operation.prefix}:${spec.name}:${control.key}`,
          kind: "control",
          group: spec.label,
          // Named by the operation as well, for the same reason the parts are:
          // there are four things called Thickness and three called Angle.
          label: `${spec.label}: ${control.label}`,
          short: control.label,
          hint: control.hint,
          also: [spec.hint, spec.name, control.key, operation.prefix],
          where: drawing,
        };
        // Turning a number up on an operation that is switched off does
        // nothing anybody can see, so setting one switches it on.
        const wake = (value: number | string | boolean, done: boolean) => {
          shell.setMode("forge");
          if (!operation.read(spec.name, "on")) operation.write(spec.name, "on", true, true);
          operation.write(spec.name, control.key, value, done);
        };
        if (control.options) {
          add({
            ...base,
            also: [...(base.also ?? []), ...optionWords(control.options)],
            choose: {
              options: control.options,
              read: () => String(operation.read(spec.name, control.key) ?? control.options![0].value),
              write: (value) => wake(value, true),
            },
          });
          continue;
        }
        if (control.toggle) {
          add({ ...base, toggle: { read: () => Boolean(operation.read(spec.name, control.key)), write: (on) => wake(on, true) } });
          continue;
        }
        add({
          ...base,
          adjust: {
            min: control.min,
            max: control.max,
            step: control.step,
            read: () => Number(operation.read(spec.name, control.key) ?? control.min),
            write: (value, done) => wake(value, done),
            format: (value) => trim(value, control.step),
          },
        });
      }
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

/** Everything a choice can be set to, as words the index can weigh. */
function optionWords(
  options: ReadonlyArray<{ value: string; label: string; hint: string }>,
): string[] {
  return options.flatMap((option) => [option.label, option.hint]);
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

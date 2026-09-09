/**
 * The verbs, the screens and the fonts that are open: everything the palette
 * can reach that does not need a drawing engine behind it.
 *
 * Split out of `catalogue.ts` because there are two things that show this list
 * now. The palette is fetched when somebody opens it and can afford to reach
 * the forge; the menu bar is on the first screen and cannot, since the forge
 * pulls in the engine that draws letters. A menu bar that kept its own copy of
 * these labels would be wrong the first time one was renamed, and wrong
 * silently -- which is the failure this file exists to prevent, and the same
 * argument `catalogue.ts` makes at the top of itself.
 *
 * The tables are exported as well as the items built from them, because the
 * two readers want different things from the same facts. The palette lists
 * where you can go, so it leaves out the screen you are on. A menu bar lists
 * every screen and marks the one you are on. One table, two presentations.
 */

import type { Mode } from "@/App";
import type { ViewId } from "@/state/store";
import { AXES } from "@/font/master";
import { documentKey, REOPEN_KEY, viewKey } from "@/keys/useAppKeys";
import type { AppShell, Item } from "./catalogue";

export const VIEWS: Array<{ id: ViewId; label: string; hint: string }> = [
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

export const MODES: Array<{ id: Mode; label: string; hint: string }> = [
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

/** Everything above, as the palette's rows, in the order it shows them. */
export function appActions(shell: AppShell): Item[] {
  const items: Item[] = [];
  const add = (item: Item) => items.push(item);

  // ---- Actions -----------------------------------------------------------
  add({
    id: "action:new",
    kind: "action",
    group: "Actions",
    label: "Start a new font",
    hint: "An empty font, in a tab of its own beside whatever is already open.",
    also: ["restart", "blank", "empty", "fresh", "reset", "start over", "new project"],
    run: shell.newProject,
  });
  add({
    id: "action:open",
    keys: "⌘O",
    kind: "action",
    group: "Actions",
    label: "Upload a font",
    hint: "A font file from this computer, opened beside the ones already open. A saved Typeforge project is the exception: that is a whole session, and it comes back over this one.",
    also: ["import", "load", "ttf", "otf", "woff", "woff2", "browse", "file", "drop"],
    run: shell.openFile,
  });
  add({
    id: "action:open-folder",
    kind: "action",
    group: "Actions",
    label: "Open a UFO folder",
    hint: "A UFO is a folder rather than a file, which is why it has its own way in: one file input can pick files or folders and not both.",
    also: ["ufo", "folder", "directory", "source", "robofont", "glyphs", "designspace", "import"],
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
    also: [
      "download",
      "otf",
      "ttf",
      "woff",
      "variable",
      "install",
      "produce",
      "generate",
      "output",
    ],
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

  /*
   * The way back from a cross on a tab.
   *
   * Only when there is something to come back to, because an entry that says
   * "reopen" when nothing has been closed is an entry that answers a question
   * nobody asked -- and because naming the font is what makes it worth
   * pressing: "Reopen Bakerloo" is a fact about your afternoon.
   */
  if (shell.reopenable) {
    add({
      id: "action:reopen",
      kind: "action",
      group: "Actions",
      label: `Reopen ${shell.reopenable}`,
      hint: "The last font you closed, put back in front with its history. Kept for this visit only -- a closed font is closed on the next one.",
      /*
       * Not Cmd-Shift-T, which is what every hand reaches for and what the
       * browser reopens its own tabs with -- a page cannot refuse that one or
       * even hear it. The same shape on the modifier this application has.
       */
      keys: REOPEN_KEY,
      also: ["undo close", "closed", "back", "restore", "tab", "reopen"],
      run: shell.reopenFont,
    });
  }

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

  /*
   * And the fonts that are open, by name.
   *
   * The strip of tabs is the way anybody will actually do this, and it is on
   * screen -- but it only appears once there are two, and it is the one place
   * in the application a font can be reached by typing its name. The tab in
   * front is left out: it is not somewhere to go.
   */
  shell.openFonts.forEach((one, at) => {
    if (at === shell.openAt) return;
    add({
      id: `font:${one.id}`,
      kind: "view",
      group: "Go to",
      label: one.name,
      hint: "Another font you have open. Your selection, your history and the screen you were on are all still where you left them in it.",
      // The tabs answer to Alt and their own number, in the order they sit in,
      // and to Alt with the arrows for the one either side.
      keys: documentKey(at) ?? undefined,
      also: ["font", "tab", "document", "switch", "open"],
      where: shell.mode === "edit" ? undefined : "Editing a font",
      run: () => {
        shell.setMode("edit");
        shell.goToFont(at);
      },
    });
  });

  return items;
}

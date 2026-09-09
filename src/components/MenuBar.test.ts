/**
 * That every menu line still points at something.
 *
 * The menus are built by looking commands up in `palette/actions.ts` by id, so
 * that a renamed command is renamed in both places at once. The cost of that
 * is a lookup that can miss: rename `action:export` and the Export line does
 * not break, it silently is not drawn, and the menu closes over the gap
 * without a word.
 *
 * That is the same failure this repository has now been bitten by three times
 * -- a check that passes because it stopped checking -- so it is worth a test
 * that counts rather than a test that samples. Every id the menus name has to
 * resolve, every menu has to have lines in it, and every line has to have
 * something to run.
 */

import { describe, expect, it } from "vitest";

import { menusFor, type History } from "./MenuBar";
import type { AppShell } from "@/palette/catalogue";

const history: History = { undo: () => {}, redo: () => {}, canUndo: true, canRedo: false };

function shellWith(over: Partial<AppShell> = {}): AppShell {
  return {
    mode: "edit",
    setMode: () => {},
    view: "glyph",
    setView: () => {},
    openFile: () => {},
    openFolder: () => {},
    export: () => {},
    save: () => {},
    newProject: () => {},
    addVersion: () => {},
    toggleHelp: () => {},
    library: () => {},
    selectGlyph: () => {},
    paramOf: () => 0,
    setParam: () => {},
    hasFont: true,
    openFonts: [
      { id: "font-0", name: "Bakerloo" },
      { id: "font-1", name: "Metro" },
    ],
    openAt: 0,
    goToFont: () => {},
    reopenable: "Hammersmith",
    reopenFont: () => {},
    ...over,
  } as AppShell;
}

const menus = menusFor({
  shell: shellWith(),
  history,
  onFontInfo: () => {},
  onToggleAcademy: () => {},
});

const lines = (title: string) =>
  menus.find((menu) => menu.title === title)?.items.filter((line) => line !== "rule") ?? [];

describe("the menu bar", () => {
  it("offers the five menus, in the order a desktop application puts them", () => {
    expect(menus.map((menu) => menu.title)).toEqual(["File", "Edit", "View", "Window", "Help"]);
  });

  it("has nothing empty in it", () => {
    for (const menu of menus) {
      expect(lines(menu.title).length, `${menu.title} has lines`).toBeGreaterThan(0);
    }
  });

  it("gives every line something to run", () => {
    for (const menu of menus) {
      for (const line of lines(menu.title)) {
        expect(typeof line.run, `${menu.title} / ${line.label}`).toBe("function");
      }
    }
  });

  /*
   * The lookup by id is the part that can fail quietly, so the commands that
   * come out of the catalogue are named here one by one. Rename one of these
   * in `actions.ts` and this fails, rather than the menu losing a line.
   */
  it("finds every command it looks up in the catalogue", () => {
    const named = new Set(menus.flatMap((menu) => lines(menu.title)).map((line) => line.id));
    for (const id of [
      "action:new",
      "action:open",
      "action:open-folder",
      "action:library",
      "action:reopen",
      "action:save",
      "action:export",
      "action:help",
    ]) {
      expect(named.has(id), `${id} is still in the catalogue`).toBe(true);
    }
  });

  it("marks the screen you are on and no other", () => {
    const ticked = lines("View").filter((line) => line.on);
    expect(ticked.map((line) => line.label)).toEqual(["Edit one letter"]);
  });

  it("marks the font in front and no other", () => {
    const ticked = lines("Window").filter((line) => line.on);
    expect(ticked.map((line) => line.label)).toEqual(["Bakerloo"]);
  });

  it("greys what a font is needed for, rather than hiding it", () => {
    const without = menusFor({
      shell: shellWith({ hasFont: false }),
      history,
      onFontInfo: () => {},
      onToggleAcademy: () => {},
    });
    const file = without.find((menu) => menu.title === "File")?.items ?? [];
    const save = file.find((line) => line !== "rule" && line.id === "action:save");
    const exporting = file.find((line) => line !== "rule" && line.id === "action:export");
    expect(save && save !== "rule" && save.enabled, "Save is offered but greyed").toBe(false);
    expect(exporting && exporting !== "rule" && exporting.enabled, "Export is greyed").toBe(false);
  });

  it("says which of undo and redo can be taken", () => {
    const edit = lines("Edit");
    expect(edit.find((line) => line.id === "menu:undo")?.enabled).toBe(true);
    expect(edit.find((line) => line.id === "menu:redo")?.enabled).toBe(false);
  });

  it("leaves out the way back to a font nobody has closed", () => {
    const none = menusFor({
      shell: shellWith({ reopenable: null }),
      history,
      onFontInfo: () => {},
      onToggleAcademy: () => {},
    });
    const file = none.find((menu) => menu.title === "File")?.items ?? [];
    expect(file.some((line) => line !== "rule" && line.id === "action:reopen")).toBe(false);
  });
});

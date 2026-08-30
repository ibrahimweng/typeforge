/**
 * That a folder arrives whole, however it was handed over.
 *
 * The three routes in are three different browser APIs with three different
 * ways of losing half a font, and the drop is the one worth writing tests for:
 * a directory reader hands back a hundred entries at a time and says it has
 * finished by handing back none, so a font of any size read once comes up
 * missing everything past its hundredth glyph -- plausible, and wrong.
 */

import { describe, expect, it, vi } from "vitest";

import { readUfo, type UfoFiles } from "./font";
import { writePlist } from "./plist";
import {
  filesFromDrop,
  filesFromPicker,
  filesFromZip,
  looksZipped,
  ufoNameFor,
  zipUfo,
} from "./intake";

const METAINFO = writePlist({ creator: "test", formatVersion: 3 });

/** A `File` that knows the path it had inside the folder it came from. */
function pickedFile(path: string, contents: string): File {
  const file = new File([contents], path.slice(path.lastIndexOf("/") + 1));
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("a folder picked through an input", () => {
  it("strips the folder it was in, wherever it was in it", async () => {
    const files = await filesFromPicker([
      pickedFile("MyFont.ufo/metainfo.plist", METAINFO),
      pickedFile("MyFont.ufo/glyphs/a.glif", "<glyph name='a'/>"),
    ]);
    expect([...files!.keys()].sort()).toEqual(["glyphs/a.glif", "metainfo.plist"]);
  });

  it("finds the UFO inside a folder of several things", async () => {
    // Somebody picks the folder their work is in rather than the font itself,
    // which is what happens when the picker opens on the wrong level.
    const files = await filesFromPicker([
      pickedFile("Work/notes.txt", "hello"),
      pickedFile("Work/MyFont.ufo/metainfo.plist", METAINFO),
      pickedFile("Work/MyFont.ufo/glyphs/a.glif", "<glyph name='a'/>"),
    ]);
    expect([...files!.keys()].sort()).toEqual(["glyphs/a.glif", "metainfo.plist"]);
  });

  it("leaves behind what an operating system dropped in the folder", async () => {
    const files = await filesFromPicker([
      pickedFile("MyFont.ufo/metainfo.plist", METAINFO),
      pickedFile("MyFont.ufo/.DS_Store", "mac rubbish"),
      pickedFile("MyFont.ufo/glyphs/Thumbs.db", "windows rubbish"),
    ]);
    expect([...files!.keys()]).toEqual(["metainfo.plist"]);
  });

  it("gives back nothing when the folder is not a UFO", async () => {
    expect(await filesFromPicker([pickedFile("Pictures/cat.png", "not a font")])).toBeNull();
  });
});

describe("a folder dropped on the window", () => {
  /** A fake directory entry tree, with a reader that batches as a real one does. */
  function directory(name: string, contents: Record<string, string>): FileSystemEntry {
    const entries: FileSystemEntry[] = Object.entries(contents).map(([key, value]) =>
      key.endsWith("/")
        ? directory(key.slice(0, -1), JSON.parse(value) as Record<string, string>)
        : ({
            name: key,
            isFile: true,
            isDirectory: false,
            file: (resolve: (file: File) => void) => resolve(new File([value], key)),
          } as unknown as FileSystemEntry),
    );
    let handed = 0;
    return {
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (resolve: (batch: FileSystemEntry[]) => void) => {
          // Two at a time, which is a real directory reader's hundred in
          // miniature: it says it has finished by handing back none.
          const batch = entries.slice(handed, handed + 2);
          handed += batch.length;
          resolve(batch);
        },
      }),
    } as unknown as FileSystemEntry;
  }

  const itemsFor = (entry: FileSystemEntry): DataTransferItemList =>
    [{ webkitGetAsEntry: () => entry }] as unknown as DataTransferItemList;

  it("keeps reading until the directory says it is finished", async () => {
    /*
     * The trap. A reader hands back a hundred entries at a time; a glyphs
     * folder is one file per glyph. Called once, a font opens with its first
     * hundred letters and nothing else, and nothing about it looks broken.
     */
    const glyphs: Record<string, string> = {};
    for (let at = 0; at < 250; at++) glyphs[`g${at}.glif`] = `<glyph name="g${at}"/>`;
    const tree = directory("MyFont.ufo", {
      "metainfo.plist": METAINFO,
      "glyphs/": JSON.stringify(glyphs),
    });

    const files = await filesFromDrop(itemsFor(tree));
    expect(files!.size).toBe(251);
    expect(files!.has("glyphs/g249.glif")).toBe(true);
  });

  it("reaches for the entries before anything is awaited", async () => {
    // A `DataTransferItemList` is emptied the moment the drop handler returns,
    // so an implementation that awaits first and reads it after finds nothing.
    const entry = directory("MyFont.ufo", { "metainfo.plist": METAINFO });
    const getter = vi.fn(() => entry);
    const items = [{ webkitGetAsEntry: getter }] as unknown as DataTransferItemList;
    await filesFromDrop(items);
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it("gives back nothing when what was dropped is not a folder", async () => {
    const items = [{ webkitGetAsEntry: () => null }] as unknown as DataTransferItemList;
    expect(await filesFromDrop(items)).toBeNull();
  });
});

describe("a zipped UFO", () => {
  const files: UfoFiles = new Map([
    ["metainfo.plist", METAINFO],
    ["fontinfo.plist", writePlist({ familyName: "Zipped", unitsPerEm: 1000 })],
    ["glyphs/contents.plist", writePlist({})],
  ]);

  it("comes back out of the archive it went into", () => {
    const archive = zipUfo(files, "Zipped-Regular.ufo");
    expect(looksZipped(archive)).toBe(true);
    const back = filesFromZip(archive)!;
    expect([...back.keys()].sort()).toEqual([...files.keys()].sort());
    expect(readUfo(back)!.typeface.meta.familyName).toBe("Zipped");
  });

  it("keeps a file that is bytes rather than text exactly as it was", () => {
    /*
     * A UFO can carry the images somebody is tracing over. Reading one as text
     * and writing it back would hand them a corrupted file they never asked
     * anybody to touch.
     */
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe]);
    const withImage: UfoFiles = new Map([...files, ["images/sketch.png", png]]);
    const back = filesFromZip(zipUfo(withImage, "Zipped.ufo"))!;
    expect(back.get("images/sketch.png")).toEqual(png);
  });

  it("does not care whether the folder is inside the archive or is it", () => {
    // A `.ufoz` is the folder's contents; a folder somebody compressed has the
    // folder inside. Both are what somebody means by a zipped UFO.
    const flat = filesFromZip(zipUfo(files, "Name.ufo"))!;
    expect(flat.has("metainfo.plist")).toBe(true);
  });

  it("gives back nothing for bytes that are not an archive", () => {
    expect(filesFromZip(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(looksZipped(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });
});

describe("what the folder is called", () => {
  it("is the family and the style, with nothing in it a disk will argue with", () => {
    expect(ufoNameFor("Test Sans", "Regular")).toBe("TestSans-Regular.ufo");
    // Everything a disk might argue with comes out, accents included, which
    // is what the export dialogs next door already do to a family name.
    expect(ufoNameFor("Ünïcode / Face", "Bold Italic")).toBe("ncodeFace-BoldItalic.ufo");
  });

  it("has something to say even when the font does not", () => {
    expect(ufoNameFor("", "")).toBe("Untitled-Regular.ufo");
  });
});

/**
 * That a folder goes in and the same folder comes out.
 *
 * A round trip is the strong test available here, and it is strong for a
 * particular reason: a designer's UFO is the file they work in, kept in version
 * control beside the drawings it describes. Opening it and saving it is
 * supposed to be a round trip and not a filter, so anything this application
 * does not model has to survive being read by it -- and the only way to know
 * that is to put a folder through and compare.
 */

import { describe, expect, it } from "vitest";

import type { Glyph, Typeface } from "@/font/types";
import { emptyTypeface } from "@/font/types";
import { looksLikeUfo, readUfo, textOf, writeUfo, type UfoFiles } from "./font";
import { readPlist, writePlist } from "./plist";

/** The smallest thing that is a UFO, plus whatever a test wants to add. */
function ufo(extra: Record<string, string> = {}): UfoFiles {
  return new Map(
    Object.entries({
      "metainfo.plist": writePlist({ creator: "test", formatVersion: 3 }),
      "fontinfo.plist": writePlist({
        familyName: "Test Sans",
        styleName: "Regular",
        unitsPerEm: 1000,
        ascender: 750,
        descender: -250,
        capHeight: 700,
        xHeight: 500,
      }),
      "glyphs/contents.plist": writePlist({ a: "a.glif" }),
      "glyphs/a.glif": `<?xml version="1.0" encoding="UTF-8"?>
<glyph name="a" format="2">
  <advance width="500"/>
  <unicode hex="0061"/>
  <outline><contour>
    <point x="0" y="0" type="line"/>
    <point x="100" y="0" type="line"/>
    <point x="100" y="100" type="line"/>
  </contour></outline>
</glyph>`,
      ...extra,
    }),
  );
}

function glyph(name: string, extra: Partial<Glyph> = {}): Glyph {
  return {
    name,
    unicodes: [],
    advanceWidth: 500,
    contours: [],
    components: [],
    anchors: [],
    params: {},
    dirty: false,
    ...extra,
  };
}

function typefaceWith(glyphs: Glyph[]): Typeface {
  const typeface = emptyTypeface();
  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((one, index) => [one.name, index]));
  return typeface;
}

describe("telling a UFO from a folder", () => {
  it("wants the one file the format requires", () => {
    expect(looksLikeUfo(ufo())).toBe(true);
    expect(looksLikeUfo(new Map([["glyphs/a.glif", "<glyph name='a'/>"]]))).toBe(false);
    expect(looksLikeUfo(new Map())).toBe(false);
  });

  it("gives back nothing rather than half a font", () => {
    expect(readUfo(new Map([["readme.txt", "hello"]]))).toBeNull();
  });
});

describe("reading a UFO", () => {
  it("reads the name, the em and the lines", () => {
    const { typeface } = readUfo(ufo())!;
    expect(typeface.meta.familyName).toBe("Test Sans");
    expect(typeface.meta.styleName).toBe("Regular");
    expect(typeface.unitsPerEm).toBe(1000);
    expect(typeface.metrics).toEqual({
      ascender: 750,
      descender: -250,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
    });
  });

  it("leaves a line the file did not state at something plausible", () => {
    /*
     * A UFO without an `xHeight` is not a font whose x-height is zero, it is
     * one that did not say. Reading the absence as a nought would put every
     * lowercase letter on the baseline in a view that draws the line.
     */
    const { typeface } = readUfo(
      ufo({
        "fontinfo.plist": writePlist({ familyName: "Sparse", unitsPerEm: 1000 }),
      }),
    )!;
    expect(typeface.metrics.xHeight).toBeGreaterThan(0);
    expect(typeface.metrics.descender).toBeLessThan(0);
  });

  it("takes the glyph's name from the mapping rather than from the file", () => {
    // `contents.plist` is what the rest of the folder refers to. A `.glif`
    // whose inner name disagrees is a file somebody renamed by hand.
    const { typeface } = readUfo(
      ufo({
        "glyphs/contents.plist": writePlist({ aardvark: "a.glif" }),
      }),
    )!;
    expect(typeface.glyphs.map((one) => one.name)).toEqual(["aardvark"]);
  });

  it("skips a glyph the mapping promises and the folder does not have", () => {
    const { typeface } = readUfo(
      ufo({ "glyphs/contents.plist": writePlist({ a: "a.glif", b: "b.glif" }) }),
    )!;
    expect(typeface.glyphs.map((one) => one.name)).toEqual(["a"]);
  });

  it("puts the glyphs in the order the file asks for", () => {
    const files = ufo({
      "glyphs/contents.plist": writePlist({ a: "a.glif", b: "b.glif", c: "c.glif" }),
      "glyphs/b.glif": `<glyph name="b" format="2"><advance width="1"/><outline/></glyph>`,
      "glyphs/c.glif": `<glyph name="c" format="2"><advance width="1"/><outline/></glyph>`,
      "lib.plist": writePlist({ "public.glyphOrder": ["c", "a", "b"] }),
    });
    expect(readUfo(files)!.typeface.glyphs.map((one) => one.name)).toEqual(["c", "a", "b"]);
  });

  it("sorts them when the file does not say, so the order is at least the same twice", () => {
    const files = ufo({
      "glyphs/contents.plist": writePlist({ c: "c.glif", a: "a.glif" }),
      "glyphs/c.glif": `<glyph name="c" format="2"><advance width="1"/><outline/></glyph>`,
    });
    expect(readUfo(files)!.typeface.glyphs.map((one) => one.name)).toEqual(["a", "c"]);
  });

  it("reads the layer the file calls the default one", () => {
    // A UFO can have several layers. The one that counts is named, not
    // assumed, and a background layer of sketches is not the drawing.
    const files = ufo({
      "layercontents.plist": `<?xml version="1.0"?><plist version="1.0"><array>
        <array><string>background</string><string>glyphs.background</string></array>
        <array><string>public.default</string><string>glyphs.real</string></array>
      </array></plist>`,
      "glyphs.real/contents.plist": writePlist({ z: "z.glif" }),
      "glyphs.real/z.glif": `<glyph name="z" format="2"><advance width="9"/><outline/></glyph>`,
    });
    const { typeface } = readUfo(files)!;
    expect(typeface.glyphs.map((one) => one.name)).toEqual(["z"]);
    expect(typeface.glyphs[0].advanceWidth).toBe(9);
  });
});

describe("reading the kerning", () => {
  const kerned = (
    groups: Record<string, string[]>,
    kerning: Record<string, Record<string, number>>,
  ) =>
    readUfo(
      ufo({
        "groups.plist": writePlist(groups),
        "kerning.plist": writePlist(kerning),
      }),
    )!.typeface;

  it("takes two glyphs as a pair", () => {
    const typeface = kerned({}, { A: { V: -80 } });
    expect(typeface.kerning).toEqual([{ left: "A", right: "V", value: -80 }]);
    expect(typeface.kernClasses).toEqual([]);
  });

  it("takes a group on either side as a class", () => {
    const typeface = kerned(
      { "public.kern1.A": ["A", "Aacute"], "public.kern2.V": ["V", "W"] },
      { "public.kern1.A": { "public.kern2.V": -80 } },
    );
    expect(typeface.kerning).toEqual([]);
    expect(typeface.kernClasses).toHaveLength(1);
    expect(typeface.kernClasses[0].left).toEqual(["A", "Aacute"]);
    expect(typeface.kernClasses[0].right).toEqual(["V", "W"]);
    expect(typeface.kernClasses[0].value).toBe(-80);
  });

  it("takes a group against one glyph as a class of one on that side", () => {
    // All four combinations are legal and mean something. A glyph opposite a
    // group is a class whose other side has one member in it.
    const typeface = kerned(
      { "public.kern1.A": ["A", "Aacute"] },
      { "public.kern1.A": { V: -60 } },
    );
    expect(typeface.kernClasses[0].left).toEqual(["A", "Aacute"]);
    expect(typeface.kernClasses[0].right).toEqual(["V"]);
  });

  it("ignores an entry whose value is not a number", () => {
    const typeface = kerned({}, { A: { V: "lots" } } as never);
    expect(typeface.kerning).toEqual([]);
  });
});

describe("a UFO read and written again", () => {
  it("keeps a file this application knows nothing about", () => {
    /*
     * The whole argument for reading a UFO at all. A designer's folder holds
     * their background layers, their own `lib` keys, whatever their tools put
     * in there -- and none of it is anything this application models. Losing
     * it on save would make opening a UFO here a decision to throw work away.
     */
    const files = ufo({
      "glyphs.background/contents.plist": writePlist({ a: "a.glif" }),
      "glyphs.background/a.glif": "<glyph name='a' format='2'><outline/></glyph>",
      "data/com.somebody.thing.plist": writePlist({ theirs: "kept" }),
      "images/sketch.png": "not really a png",
    });
    const { typeface, carried } = readUfo(files)!;
    const out = writeUfo(typeface, carried);

    expect(out.get("data/com.somebody.thing.plist")).toBe(
      files.get("data/com.somebody.thing.plist"),
    );
    expect(out.get("images/sketch.png")).toBe("not really a png");
    expect(out.get("glyphs.background/a.glif")).toBe(files.get("glyphs.background/a.glif"));
  });

  it("comes back saying the same thing about the font", () => {
    const first = readUfo(ufo())!;
    const again = readUfo(writeUfo(first.typeface, first.carried))!;
    expect(again.typeface.meta.familyName).toBe(first.typeface.meta.familyName);
    expect(again.typeface.unitsPerEm).toBe(first.typeface.unitsPerEm);
    expect(again.typeface.metrics).toEqual(first.typeface.metrics);
    expect(again.typeface.glyphs).toEqual(first.typeface.glyphs);
  });

  it("keeps the kerning, groups and all", () => {
    const files = ufo({
      "groups.plist": writePlist({
        "public.kern1.A": ["A", "Aacute"],
        "public.kern2.V": ["V", "W"],
      }),
      "kerning.plist": writePlist({
        "public.kern1.A": { "public.kern2.V": -80 },
        T: { o: -40 },
      }),
    });
    const first = readUfo(files)!;
    const again = readUfo(writeUfo(first.typeface, first.carried))!;
    expect(again.typeface.kerning).toEqual(first.typeface.kerning);
    expect(again.typeface.kernClasses.map((one) => [one.left, one.right, one.value])).toEqual(
      first.typeface.kernClasses.map((one) => [one.left, one.right, one.value]),
    );
  });

  it("keeps the order it was given", () => {
    const typeface = typefaceWith([glyph("c"), glyph("a"), glyph("b")]);
    const again = readUfo(writeUfo(typeface))!;
    expect(again.typeface.glyphs.map((one) => one.name)).toEqual(["c", "a", "b"]);
  });

  it("writes a font that had no UFO behind it", () => {
    // The other direction: a font drawn here, or opened from a TTF, going out
    // as a UFO for the first time. There is nothing carried, and the folder
    // still has to be a UFO.
    const typeface = typefaceWith([glyph("A", { unicodes: [0x41] }), glyph(".notdef")]);
    const out = writeUfo(typeface);
    expect(looksLikeUfo(out)).toBe(true);
    expect(out.has("glyphs/A_.glif")).toBe(true);
    expect(out.has("glyphs/_notdef.glif")).toBe(true);
    expect(readUfo(out)!.typeface.glyphs.map((one) => one.name)).toEqual(["A", ".notdef"]);
  });

  it("keeps two glyphs whose names differ only in case apart", () => {
    // One file on a Mac, two on Linux. `contents.plist` is what says which is
    // which, and the second one has to move.
    const out = writeUfo(typefaceWith([glyph("a"), glyph("A")]));
    const back = readUfo(out)!;
    expect(back.typeface.glyphs.map((one) => one.name).sort()).toEqual(["A", "a"]);
  });
});

describe("the claimed files, merged rather than replaced", () => {
  /*
   * The writer owns `fontinfo.plist`, `groups.plist`, `lib.plist` and
   * `layercontents.plist`, and used to write each from the model alone. The
   * model is a dozen keys of fontinfo, the kerning groups and one lib key, so
   * a round trip threw away the rest of every one of them.
   */
  it("keeps the fontinfo keys the model does not have, where they were", () => {
    const files = ufo({
      "fontinfo.plist": writePlist({
        familyName: "Test Sans",
        openTypeOS2Panose: [2, 11, 5, 2, 4, 5, 4, 2, 2, 4],
        unitsPerEm: 1000,
        postscriptBlueValues: [-10, 0, 500, 510],
        copyright: "Old",
      }),
    });
    const { typeface, carried } = readUfo(files)!;
    typeface.meta.familyName = "Renamed";
    typeface.meta.copyright = "";
    const info = readPlist(textOf(writeUfo(typeface, carried).get("fontinfo.plist")))!;
    expect(info.familyName).toBe("Renamed");
    expect(info.openTypeOS2Panose).toEqual([2, 11, 5, 2, 4, 5, 4, 2, 2, 4]);
    expect(info.postscriptBlueValues).toEqual([-10, 0, 500, 510]);
    // Cleared in the model is cleared in the file, not restored from it.
    expect(info.copyright).toBeUndefined();
    expect(Object.keys(info).slice(0, 3)).toEqual([
      "familyName",
      "openTypeOS2Panose",
      "unitsPerEm",
    ]);
  });

  it("keeps the groups that are not kerning, and the kerning groups' names", () => {
    const files = ufo({
      "groups.plist": writePlist({
        "public.kern1.O": ["O", "Q"],
        "public.kern2.solo": ["V"],
        topMarks: ["acutecomb", "gravecomb"],
      }),
      "kerning.plist": writePlist({ "public.kern1.O": { "public.kern2.solo": -30 } }),
    });
    const { typeface, carried } = readUfo(files)!;
    const out = writeUfo(typeface, carried);
    const groups = readPlist(textOf(out.get("groups.plist")))!;
    expect(groups.topMarks).toEqual(["acutecomb", "gravecomb"]);
    expect(groups["public.kern1.O"]).toEqual(["O", "Q"]);
    // A group of one stays a group, because that is what the file called it.
    expect(groups["public.kern2.solo"]).toEqual(["V"]);
    const kerning = readPlist(textOf(out.get("kerning.plist")))!;
    expect(kerning).toEqual({ "public.kern1.O": { "public.kern2.solo": -30 } });
  });

  it("names a class made here without taking a name the file already uses", () => {
    const files = ufo({ "groups.plist": writePlist({ "public.kern1.0": ["x", "y"] }) });
    const { typeface, carried } = readUfo(files)!;
    typeface.kernClasses = [{ id: "new", name: "new", left: ["A", "B"], right: ["V"], value: -5 }];
    const groups = readPlist(textOf(writeUfo(typeface, carried).get("groups.plist")))!;
    expect(groups["public.kern1.0"]).toEqual(["x", "y"]);
    expect(groups["public.kern1.0.1"]).toEqual(["A", "B"]);
  });

  it("keeps every lib key, a data value included", () => {
    const lib = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>com.somebody.colour</key><string>red</string>
  <key>public.glyphOrder</key><array><string>a</string></array>
  <key>com.somebody.thumb</key><data>aGVsbG8=</data>
</dict></plist>`;
    const { typeface, carried } = readUfo(ufo({ "lib.plist": lib }))!;
    const written = textOf(writeUfo(typeface, carried).get("lib.plist"));
    expect(written).toContain("<data>aGVsbG8=</data>");
    const back = readPlist(written)!;
    expect(back["com.somebody.colour"]).toBe("red");
    expect(back["public.glyphOrder"]).toEqual(["a"]);
  });

  it("lists every layer it carried, not only the default one", () => {
    const layers = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array>
  <array><string>public.default</string><string>glyphs</string></array>
  <array><string>public.background</string><string>glyphs.public.background</string></array>
</array></plist>`;
    const files = ufo({
      "layercontents.plist": layers,
      "glyphs.public.background/contents.plist": writePlist({ a: "a.glif" }),
      "glyphs.public.background/a.glif": "<glyph name='a' format='2'><outline/></glyph>",
    });
    const { typeface, carried } = readUfo(files)!;
    const out = writeUfo(typeface, carried);
    const written = textOf(out.get("layercontents.plist"));
    expect(written).toContain("<string>public.background</string>");
    expect(written).toContain("<string>glyphs.public.background</string>");
    expect(out.has("glyphs.public.background/a.glif")).toBe(true);
  });
});

describe("the parts of a glyph's file that are not its drawing", () => {
  it("keeps a glif it could not read, and keeps pointing at it", () => {
    const files = ufo({
      "glyphs/contents.plist": writePlist({ a: "a.glif", broken: "broken.glif" }),
      "glyphs/broken.glif": "<notAGlyph/>",
    });
    const first = readUfo(files)!;
    expect(first.typeface.glyphs.map((one) => one.name)).toEqual(["a"]);
    const out = writeUfo(first.typeface, first.carried);
    expect(out.get("glyphs/broken.glif")).toBe("<notAGlyph/>");
    expect(readPlist(textOf(out.get("glyphs/contents.plist")))!.broken).toBe("broken.glif");
  });

  it("keeps a glyph's lib, guidelines, image and note", () => {
    const files = ufo({
      "glyphs/a.glif": `<?xml version="1.0" encoding="UTF-8"?>
<glyph name="a" format="2">
  <advance width="500"/>
  <note>round &amp; round</note>
  <image fileName="sketch.png" xScale="0.5"/>
  <guideline x="250" angle="90" name="middle"/>
  <outline/>
  <lib><dict><key>public.markColor</key><string>1,0,0,1</string></dict></lib>
</glyph>`,
    });
    const { typeface, carried } = readUfo(files)!;
    typeface.glyphs[0].advanceWidth = 520;
    const written = textOf(writeUfo(typeface, carried).get("glyphs/a.glif"));
    expect(written).toContain('<advance width="520"/>');
    expect(written).toContain("<note>round &amp; round</note>");
    expect(written).toContain('<image fileName="sketch.png" xScale="0.5"/>');
    expect(written).toContain('<guideline x="250" angle="90" name="middle"/>');
    expect(written).toContain("<key>public.markColor</key>");
    // The lib goes last, where every other tool puts it.
    expect(written.indexOf("<lib>")).toBeGreaterThan(written.indexOf("<outline"));
  });
});

/**
 * That a plist says what the file said.
 *
 * These lean on the awkward parts rather than the ordinary ones: entities,
 * because a UFO written by somebody whose name has an accent in it contains
 * them and one of the two parsers considered here decoded neither kind;
 * malformed dictionaries, because a key with no value after it is a real shape
 * a half-written file takes; and the integer/real distinction, because a
 * `unitsPerEm` of `1000.0` is a file every other tool reads differently.
 */

import { describe, expect, it } from "vitest";

import { numberAt, readPlist, stringAt, stringsAt, writePlist, type PlistDict } from "./plist";
import { escapeXml, parseXml } from "./xml";

const wrap = (inside: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${inside}\n</dict>\n</plist>`;

describe("reading a property list", () => {
  it("reads the types a UFO uses", () => {
    const plist = readPlist(
      wrap(`
        <key>familyName</key><string>Test Sans</string>
        <key>unitsPerEm</key><integer>1000</integer>
        <key>italicAngle</key><real>-12.5</real>
        <key>isFixedPitch</key><false/>
        <key>guidelines</key><array><string>a</string><string>b</string></array>
        <key>nested</key><dict><key>deep</key><integer>7</integer></dict>
      `),
    );
    expect(plist).toEqual({
      familyName: "Test Sans",
      unitsPerEm: 1000,
      italicAngle: -12.5,
      isFixedPitch: false,
      guidelines: ["a", "b"],
      nested: { deep: 7 },
    });
  });

  it("decodes both kinds of entity", () => {
    /*
     * The measurement that chose the parser. Named entities are the five XML
     * predefines; numeric ones are how any non-ASCII character reaches a file
     * written as ASCII, which is what the Python tooling in this ecosystem
     * emits. A reader that handles one and not the other corrupts a designer's
     * name and nothing else, which is the kind of fault that ships.
     */
    const plist = readPlist(
      wrap(`<key>designer</key><string>caf&#233; &amp; co &#x41;</string>`),
    );
    expect(plist?.designer).toBe("café & co A");
  });

  it("skips a key with nothing after it rather than pairing it with the next one", () => {
    // Two keys in a row is what a half-written file looks like. Reading it as
    // `{ orphan: "value" }` would be inventing a fact about the font.
    const plist = readPlist(
      wrap(`<key>orphan</key>\n<key>real</key><string>value</string>`),
    );
    expect(plist).toEqual({ real: "value" });
  });

  it("gives back nothing for a file that is not a plist", () => {
    expect(readPlist("not xml at all <<<")).toBeNull();
    expect(readPlist("<?xml version='1.0'?><glyph name='a'/>")).toBeNull();
    // A plist whose root is an array rather than a dictionary: valid, and not
    // a shape any file in a UFO takes.
    expect(readPlist(`<plist version="1.0"><array/></plist>`)).toBeNull();
  });

  it("drops a type it cannot honestly read rather than guessing at it", () => {
    const plist = readPlist(
      wrap(`<key>d</key><data>aGk=</data>\n<key>ok</key><integer>1</integer>`),
    );
    expect(plist).toEqual({ ok: 1 });
  });
});

describe("reading one value out of a plist", () => {
  const plist: PlistDict = { name: "x", size: 12, off: false, list: ["a", 1, "b"] };

  it("answers only when the value is the type asked for", () => {
    expect(stringAt(plist, "name")).toBe("x");
    expect(stringAt(plist, "size")).toBeUndefined();
    expect(numberAt(plist, "size")).toBe(12);
    expect(numberAt(plist, "name")).toBeUndefined();
    expect(numberAt(plist, "missing")).toBeUndefined();
  });

  it("keeps the strings out of a mixed array and leaves the rest", () => {
    expect(stringsAt(plist, "list")).toEqual(["a", "b"]);
    expect(stringsAt(plist, "name")).toEqual([]);
  });
});

describe("writing a property list", () => {
  it("comes back as what went in", () => {
    const dict: PlistDict = {
      familyName: "Test Sans",
      unitsPerEm: 1000,
      italicAngle: -12.5,
      isFixedPitch: true,
      groups: { "public.kern1.O": ["O", "Q"] },
      empty: [],
      nothing: {},
    };
    expect(readPlist(writePlist(dict))).toEqual(dict);
  });

  it("keeps an integer an integer", () => {
    // `<real>1000.0</real>` where every other tool writes `<integer>1000</integer>`
    // is a difference a diff shows and a reader may act on.
    const written = writePlist({ unitsPerEm: 1000, angle: -12.5 });
    expect(written).toContain("<integer>1000</integer>");
    expect(written).toContain("<real>-12.5</real>");
  });

  it("survives a name that needs escaping, in a key and in a value", () => {
    const dict: PlistDict = { "a < b & c": 'say "hi" <now>' };
    const written = writePlist(dict);
    expect(written).not.toContain("a < b & c");
    expect(readPlist(written)).toEqual(dict);
  });

  it("opens with the declaration and the doctype every other tool writes", () => {
    const written = writePlist({ a: 1 });
    expect(written.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist')).toBe(true);
    expect(written.endsWith("</plist>\n")).toBe(true);
  });
});

describe("the XML underneath", () => {
  it("skips the declaration and finds the root", () => {
    const root = parseXml(`<?xml version="1.0"?>\n<!-- a note -->\n<glyph name="a"><advance width="5"/></glyph>`);
    expect(root?.name).toBe("glyph");
    expect(root?.attributes.name).toBe("a");
    expect(root?.children[0].attributes.width).toBe("5");
  });

  it("escapes the five characters XML reserves and no others", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
    expect(escapeXml("café")).toBe("café");
  });
});

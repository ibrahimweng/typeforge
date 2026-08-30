/**
 * A whole UFO, in and out.
 *
 * A UFO is not a file, it is a folder, and that is the single fact that shapes
 * everything here. What comes in is a set of paths and their contents; what
 * goes out is the same. Nothing in this file knows whether those paths came
 * from a folder somebody picked, a folder somebody dropped, or a zip -- that is
 * `intake.ts`'s problem, and keeping it out of here is what lets the whole
 * format be tested without a browser anywhere near it.
 *
 * The layout, of the parts this reads:
 *
 *   metainfo.plist          what wrote it, and which version of the format
 *   fontinfo.plist          the name, the em, and where the lines sit
 *   layercontents.plist     which folder holds the drawings that count
 *   glyphs/contents.plist   which file each glyph is in
 *   glyphs/*.glif           the drawings
 *   groups.plist            the kerning groups
 *   kerning.plist           the kerning
 *   lib.plist               the order the glyphs go in
 *
 * What this deliberately does not do is read every layer. A UFO can carry any
 * number of them -- a background layer of sketches, a layer of alternates
 * somebody is trying out -- and this application has one drawing per glyph, so
 * there is nowhere to put the others. The default layer is read, the rest are
 * carried through untouched on the way back out, and the alternative would be
 * to throw away somebody's sketches without saying so.
 */

import { emptyTypeface, type Glyph, type KernClass, type KernPair, type Typeface } from "@/font/types";
import { fileNameFor, readGlif, writeGlif } from "./glif";
import {
  numberAt,
  readPlist,
  stringAt,
  stringsAt,
  writePlist,
  type PlistDict,
  type PlistValue,
} from "./plist";
import { children, parseXml } from "./xml";

/**
 * A UFO as a set of paths and what is in them, with `/` between the parts.
 *
 * Text or bytes, because a UFO is both. Everything this reader understands is
 * XML and arrives as text; a folder can also carry background images somebody
 * is tracing over and whatever a `data` directory holds, and those are bytes.
 * Reading a PNG as UTF-8 and writing it back out would return a corrupted file
 * to somebody who never asked us to touch it -- which is the one thing the
 * carried set exists to prevent.
 */
export type UfoFiles = Map<string, string | Uint8Array>;

/*
 * What a file says, whichever way it arrived.
 *
 * Intake decides that: a folder picked in a browser gives bytes, a fixture
 * read from a disk in a test gives text. Every file this reader claims is XML,
 * so it can decode without asking -- and a `.glif` that is not valid UTF-8 is
 * not a `.glif`, which the readers downstream already say by giving back null.
 */
const decoder = typeof TextDecoder === "undefined" ? null : new TextDecoder();

export function textOf(value: string | Uint8Array | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return decoder ? decoder.decode(value) : "";
}

/** What is put back untouched, so reading and writing does not lose it. */
export interface UfoCarried {
  /** Every file this reader did not claim, kept exactly as it arrived. */
  untouched: UfoFiles;
  /** The folder the default layer's glyphs came out of. */
  glyphsDirectory: string;
}

/** What a read produces: the font, and what has to travel with it. */
export interface ReadUfo {
  typeface: Typeface;
  carried: UfoCarried;
}

/** The files this reader understands, and therefore replaces when it writes. */
const CLAIMED = new Set([
  "metainfo.plist",
  "fontinfo.plist",
  "layercontents.plist",
  "groups.plist",
  "kerning.plist",
  "lib.plist",
]);

/** Whether a set of files looks like a UFO at all. */
export function looksLikeUfo(files: UfoFiles): boolean {
  // `metainfo.plist` is the one file the format requires, and requiring it is
  // what tells a UFO apart from a folder that happens to have XML in it.
  return files.has("metainfo.plist");
}

/**
 * Which folder holds the drawings that count.
 *
 * `layercontents.plist` is a list of `[name, directory]` pairs, and the default
 * layer is the one called `public.default`. UFO 2 has no such file and one
 * layer, always in `glyphs`. A file that names no default layer is read as
 * naming its first, which is what every other tool does.
 */
function glyphsDirectoryOf(files: UfoFiles): string {
  const source = textOf(files.get("layercontents.plist"));
  if (!source) return "glyphs";
  const layers = layerPairs(source);
  if (layers.length === 0) return "glyphs";
  const named = layers.find((pair) => pair[0] === "public.default");
  return (named ?? layers[0])[1];
}

/**
 * The `[name, directory]` pairs out of a `layercontents.plist`.
 *
 * Walked off the tree rather than through `readPlist`, because this is the one
 * file in a UFO whose root is an array rather than a dictionary, and every
 * other caller of `readPlist` wants a dictionary or nothing. Widening it for
 * this one file would mean every other caller checking which it got.
 */
function layerPairs(source: string): Array<[string, string]> {
  const root = parseXml(source);
  if (!root || root.name !== "plist") return [];
  const outer = root.children.find((one) => one.name === "array");
  if (!outer) return [];
  const pairs: Array<[string, string]> = [];
  for (const inner of children(outer, "array")) {
    const strings = children(inner, "string");
    if (strings.length === 2) pairs.push([strings[0].text, strings[1].text]);
  }
  return pairs;
}

/** The font's name, size and lines, out of `fontinfo.plist`. */
function readFontInfo(typeface: Typeface, info: PlistDict): void {
  const em = numberAt(info, "unitsPerEm");
  if (em && em > 0) typeface.unitsPerEm = Math.round(em);

  typeface.meta = {
    ...typeface.meta,
    familyName: stringAt(info, "familyName") ?? typeface.meta.familyName,
    styleName: stringAt(info, "styleName") ?? typeface.meta.styleName,
    copyright: stringAt(info, "copyright") ?? "",
    designer: stringAt(info, "openTypeNameDesigner") ?? "",
    manufacturer: stringAt(info, "openTypeNameManufacturer") ?? "",
    license: stringAt(info, "openTypeNameLicense") ?? "",
    weightClass: numberAt(info, "openTypeOS2WeightClass") ?? typeface.meta.weightClass,
  };

  const major = numberAt(info, "versionMajor");
  const minor = numberAt(info, "versionMinor");
  if (major !== undefined) {
    typeface.meta.version = `${major}.${String(minor ?? 0).padStart(3, "0")}`;
  }

  /*
   * The lines, each only if the file gives it.
   *
   * A UFO is allowed to leave any of these out, and a font whose `xHeight` is
   * absent is not a font whose x-height is zero -- it is one that did not say.
   * Falling back to what `emptyTypeface` starts with is a plausible number
   * rather than a claim, which is the same reasoning `quill/typeface.ts` uses
   * when it has no letters to measure.
   */
  const lines = typeface.metrics;
  const ascender = numberAt(info, "ascender");
  const descender = numberAt(info, "descender");
  const capHeight = numberAt(info, "capHeight");
  const xHeight = numberAt(info, "xHeight");
  typeface.metrics = {
    ascender: ascender !== undefined ? Math.round(ascender) : lines.ascender,
    descender: descender !== undefined ? Math.round(descender) : lines.descender,
    capHeight: capHeight !== undefined ? Math.round(capHeight) : lines.capHeight,
    xHeight: xHeight !== undefined ? Math.round(xHeight) : lines.xHeight,
    lineGap: Math.round(numberAt(info, "openTypeOS2TypoLineGap") ?? 0),
  };
}

/**
 * The kerning, which a UFO states in a way this model does not.
 *
 * `kerning.plist` is a dictionary of dictionaries: the first glyph or group,
 * then the second, then the number. Either side may be a group -- a name
 * beginning `public.kern1.` on the left or `public.kern2.` on the right --
 * and the four combinations of glyph and group are all legal and all mean
 * something slightly different.
 *
 * A pair of glyphs is a pair here. Anything with a group on either side is a
 * class here, with the single glyph standing as a class of one, because that is
 * what this model has to say it with and because it is what the pair means.
 */
function readKerning(
  files: UfoFiles,
): { kerning: KernPair[]; kernClasses: KernClass[] } {
  const groups = readPlist(textOf(files.get("groups.plist"))) ?? {};
  const kerning = readPlist(textOf(files.get("kerning.plist"))) ?? {};

  const membersOf = (name: string): string[] | null => {
    const value = groups[name];
    if (!Array.isArray(value)) return null;
    const members = value.filter((one): one is string => typeof one === "string");
    return members.length > 0 ? members : null;
  };

  const pairs: KernPair[] = [];
  const classes: KernClass[] = [];

  for (const [left, seconds] of Object.entries(kerning)) {
    if (typeof seconds !== "object" || seconds === null || Array.isArray(seconds)) continue;
    for (const [right, value] of Object.entries(seconds as Record<string, PlistValue>)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const leftMembers = membersOf(left);
      const rightMembers = membersOf(right);
      if (!leftMembers && !rightMembers) {
        pairs.push({ left, right, value: Math.round(value) });
        continue;
      }
      classes.push({
        id: `${left}/${right}`,
        // The names as the file has them, so that somebody who opens the
        // kerning panel sees what they wrote in the tool they came from.
        name: `${left} / ${right}`,
        left: leftMembers ?? [left],
        right: rightMembers ?? [right],
        value: Math.round(value),
      });
    }
  }
  return { kerning: pairs, kernClasses: classes };
}

/** A UFO, as a typeface, or null if it is not one. */
export function readUfo(files: UfoFiles): ReadUfo | null {
  if (!looksLikeUfo(files)) return null;

  const typeface = emptyTypeface();
  const info = readPlist(textOf(files.get("fontinfo.plist")));
  if (info) readFontInfo(typeface, info);

  const glyphsDirectory = glyphsDirectoryOf(files);
  const contents = readPlist(textOf(files.get(`${glyphsDirectory}/contents.plist`)));

  const glyphs: Glyph[] = [];
  const readFiles = new Set<string>([`${glyphsDirectory}/contents.plist`]);
  if (contents) {
    for (const [name, fileName] of Object.entries(contents)) {
      if (typeof fileName !== "string") continue;
      const path = `${glyphsDirectory}/${fileName}`;
      if (!files.has(path)) continue;
      readFiles.add(path);
      const glyph = readGlif(textOf(files.get(path)));
      if (!glyph) continue;
      // `contents.plist` is what says which glyph a file holds. The name
      // inside the file should agree and is not guaranteed to, so the mapping
      // wins -- it is the one the rest of the folder refers to.
      glyphs.push({ ...glyph, name });
    }
  }

  /*
   * The order glyphs go in, which the file says and the folder does not.
   *
   * `contents.plist` is a dictionary and a dictionary has no order worth
   * relying on, so a UFO that cares states it in `lib.plist`. A font opened
   * without it comes back sorted, which is at least the same every time.
   */
  const lib = readPlist(textOf(files.get("lib.plist"))) ?? {};
  const order = stringsAt(lib, "public.glyphOrder");
  if (order.length > 0) {
    const place = new Map(order.map((name, index) => [name, index]));
    glyphs.sort((one, other) => {
      const a = place.get(one.name) ?? Number.MAX_SAFE_INTEGER;
      const b = place.get(other.name) ?? Number.MAX_SAFE_INTEGER;
      return a - b || one.name.localeCompare(other.name);
    });
  } else {
    glyphs.sort((one, other) => one.name.localeCompare(other.name));
  }

  typeface.glyphs = glyphs;
  typeface.glyphIndex = new Map(glyphs.map((glyph, index) => [glyph.name, index]));
  const { kerning, kernClasses } = readKerning(files);
  typeface.kerning = kerning;
  typeface.kernClasses = kernClasses;

  const untouched: UfoFiles = new Map();
  for (const [path, source] of files) {
    if (CLAIMED.has(path) || readFiles.has(path)) continue;
    untouched.set(path, source);
  }

  return { typeface, carried: { untouched, glyphsDirectory } };
}

/* --- writing ------------------------------------------------------------ */

/** A number, only if it is one, so an absent line stays absent. */
function put(dict: PlistDict, key: string, value: number | string | undefined): void {
  if (value === undefined || value === "") return;
  dict[key] = value;
}

/**
 * A typeface, as the files of a UFO.
 *
 * `carried` is what a previous read handed over: every file this format has
 * that this application does not model. Passing it back is what makes opening
 * and saving a designer's work a round trip rather than a filter -- their
 * background layers, their `lib` keys, whatever their own tools keep in there,
 * all still present in the folder that comes out.
 */
export function writeUfo(typeface: Typeface, carried?: UfoCarried): UfoFiles {
  const files: UfoFiles = new Map(carried?.untouched);
  const glyphsDirectory = carried?.glyphsDirectory ?? "glyphs";

  files.set(
    "metainfo.plist",
    writePlist({ creator: "com.typeforge", formatVersion: 3 }),
  );

  const info: PlistDict = {};
  put(info, "familyName", typeface.meta.familyName);
  put(info, "styleName", typeface.meta.styleName);
  put(info, "unitsPerEm", typeface.unitsPerEm);
  put(info, "ascender", typeface.metrics.ascender);
  put(info, "descender", typeface.metrics.descender);
  put(info, "capHeight", typeface.metrics.capHeight);
  put(info, "xHeight", typeface.metrics.xHeight);
  put(info, "copyright", typeface.meta.copyright);
  put(info, "openTypeNameDesigner", typeface.meta.designer);
  put(info, "openTypeNameManufacturer", typeface.meta.manufacturer);
  put(info, "openTypeNameLicense", typeface.meta.license);
  put(info, "openTypeOS2WeightClass", typeface.meta.weightClass);
  if (typeface.metrics.lineGap !== 0) {
    put(info, "openTypeOS2TypoLineGap", typeface.metrics.lineGap);
  }
  const [major, minor] = typeface.meta.version.split(".");
  const majorNumber = Number.parseInt(major ?? "", 10);
  if (Number.isFinite(majorNumber)) {
    info.versionMajor = majorNumber;
    info.versionMinor = Number.parseInt(minor ?? "0", 10) || 0;
  }
  files.set("fontinfo.plist", writePlist(info));

  files.set(
    "layercontents.plist",
    // Written by hand for the same reason it is read by hand: this is the one
    // file in a UFO whose root is an array.
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<array>",
      "  <array>",
      "    <string>public.default</string>",
      `    <string>${glyphsDirectory}</string>`,
      "  </array>",
      "</array>",
      "</plist>",
      "",
    ].join("\n"),
  );

  const taken = new Set<string>();
  const contents: PlistDict = {};
  for (const glyph of typeface.glyphs) {
    const fileName = fileNameFor(glyph.name, taken);
    contents[glyph.name] = fileName;
    files.set(`${glyphsDirectory}/${fileName}`, writeGlif(glyph));
  }
  files.set(`${glyphsDirectory}/contents.plist`, writePlist(contents));

  /*
   * The kerning, back the way it came.
   *
   * A class here becomes a group each side and one entry between them, which
   * is how a UFO says the same thing. The group names carry the prefixes the
   * format reserves, because a name without them is a plain glyph list that
   * kerning will not look in.
   */
  const groups: PlistDict = {};
  const kerning: PlistDict = {};
  const add = (left: string, right: string, value: number) => {
    const seconds = (kerning[left] as PlistDict | undefined) ?? {};
    seconds[right] = value;
    kerning[left] = seconds;
  };

  typeface.kernClasses.forEach((kernClass, index) => {
    // One glyph on a side is written as that glyph rather than as a group of
    // one, which is what it means and what keeps the file readable.
    const left = kernClass.left.length === 1 ? kernClass.left[0] : `public.kern1.${index}`;
    const right = kernClass.right.length === 1 ? kernClass.right[0] : `public.kern2.${index}`;
    if (kernClass.left.length > 1) groups[left] = [...kernClass.left];
    if (kernClass.right.length > 1) groups[right] = [...kernClass.right];
    add(left, right, kernClass.value);
  });
  for (const pair of typeface.kerning) add(pair.left, pair.right, pair.value);

  if (Object.keys(groups).length > 0) files.set("groups.plist", writePlist(groups));
  if (Object.keys(kerning).length > 0) files.set("kerning.plist", writePlist(kerning));

  files.set(
    "lib.plist",
    writePlist({ "public.glyphOrder": typeface.glyphs.map((glyph) => glyph.name) }),
  );

  return files;
}

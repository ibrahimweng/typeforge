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

import {
  emptyTypeface,
  type Glyph,
  type KernClass,
  type KernPair,
  type Typeface,
} from "@/font/types";
import { fileNameFor, readGlifKeeping, writeGlif } from "./glif";
import {
  numberAt,
  readPlist,
  stringAt,
  stringsAt,
  writePlist,
  type PlistDict,
  type PlistValue,
} from "./plist";
import { children, escapeXml, parseXml } from "./xml";

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
  /*
   * The rest is optional because a carried set is also written down in a saved
   * session, and one saved before these existed has none of them. Absent reads
   * as "nothing more was kept", which is what such a session means.
   */
  /**
   * The files this reader claims, as they arrived: `fontinfo.plist`,
   * `groups.plist`, `lib.plist` and `layercontents.plist`.
   *
   * Claimed is not the same as understood. This application models perhaps a
   * dozen of the hundred-odd keys `fontinfo.plist` can hold, the kerning
   * groups and none of the others, and one key of `lib.plist`. Writing those
   * files from the model alone threw the rest away -- the OS/2 fields, the
   * mark-feature groups, every key another tool left in the lib -- so the
   * writer now starts from what arrived and lays what is modelled over it.
   */
  originals?: UfoFiles;
  /**
   * What each glyph's file held that a glyph here cannot, by glyph name: the
   * note, the image, the guidelines, the glyph's own `lib`. Written out as
   * XML; `readGlifKeeping` says why they are not on the glyph itself.
   */
  glifKept?: Record<string, string[]>;
  /**
   * The glyphs `contents.plist` names whose files could not be read, and the
   * file each one is in.
   *
   * Their files stay in `untouched`, exactly as they were. Recorded here too
   * because a file alone is not enough to keep a glyph: `contents.plist` is
   * rewritten, and a `.glif` it no longer mentions is a glyph no reader will
   * find. A file this parser cannot read is not a file nobody can.
   */
  unreadGlyphs?: Record<string, string>;
  /**
   * The group names a kerning class came out of, by the class's id.
   *
   * A class here is its members and nothing else, so without this every group
   * went back out renamed to `public.kern1.0`, `public.kern1.1` and so on -- a
   * font whose groups other tools, feature files and the designer all refer to
   * by name, renamed in every file by opening and saving it.
   */
  kernGroupNames?: Record<string, { left: string; right: string }>;
  /**
   * The glyphs renamed since the file was read: the name the file has for
   * each, and the name it goes by now.
   *
   * Everything the model holds is renamed in place (`library.ts` names the
   * eight places), but the groups the model does not hold -- a mark feature's,
   * a spacing script's -- are only in `groups.plist` as it arrived, under the
   * old names. This is what lets the writer follow a rename into them rather
   * than dropping the letter out of the group as though it had been deleted.
   * Kept up by the store's rename, and taken back by its undo.
   */
  renamed?: Record<string, string>;
}

// Folding a rename into a carried set lives on its own, so that the store can
// do it without pulling the whole UFO reader into the first screen.
export { withRename } from "./renamed";

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

/**
 * The claimed files whose every key is not modelled, and which are therefore
 * kept as they arrived so the writer can lay the model over them rather than
 * replace them. `metainfo.plist` is not among them: it says who wrote the
 * folder, and that is now us. `kerning.plist` is not either: every entry in it
 * is modelled, so what the model says is the whole of it.
 */
const MERGED = new Set(["fontinfo.plist", "groups.plist", "lib.plist", "layercontents.plist"]);

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
  if (root?.name !== "plist") return [];
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
function readKerning(files: UfoFiles): {
  kerning: KernPair[];
  kernClasses: KernClass[];
  names: Record<string, { left: string; right: string }>;
} {
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
  const names: Record<string, { left: string; right: string }> = {};

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
      names[`${left}/${right}`] = { left, right };
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
  return { kerning: pairs, kernClasses: classes, names };
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
  const glifKept: Record<string, string[]> = {};
  const unreadGlyphs: Record<string, string> = {};
  const readFiles = new Set<string>([`${glyphsDirectory}/contents.plist`]);
  if (contents) {
    for (const [name, fileName] of Object.entries(contents)) {
      if (typeof fileName !== "string") continue;
      const path = `${glyphsDirectory}/${fileName}`;
      if (!files.has(path)) continue;
      const read = readGlifKeeping(textOf(files.get(path)));
      /*
       * Claimed only once it has been read. A file that is claimed is a file
       * the writer replaces, and one this parser could not read has nothing to
       * replace it with -- claiming it first is what used to delete it on the
       * next save. So it stays with everything else that is carried, and its
       * name is remembered so `contents.plist` goes on pointing at it.
       */
      if (!read) {
        unreadGlyphs[name] = fileName;
        continue;
      }
      readFiles.add(path);
      if (read.kept.length > 0) glifKept[name] = read.kept;
      // `contents.plist` is what says which glyph a file holds. The name
      // inside the file should agree and is not guaranteed to, so the mapping
      // wins -- it is the one the rest of the folder refers to.
      glyphs.push({ ...read.glyph, name });
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
  const { kerning, kernClasses, names } = readKerning(files);
  typeface.kerning = kerning;
  typeface.kernClasses = kernClasses;

  const untouched: UfoFiles = new Map();
  const originals: UfoFiles = new Map();
  for (const [path, source] of files) {
    if (MERGED.has(path)) originals.set(path, textOf(source));
    /*
     * And which glyphs the file had, which the writer needs to tell a group
     * member that has since been deleted from one that was never a glyph in
     * this folder at all. The first is a stale name to take out; the second
     * is somebody else's business -- a group can name glyphs another tool
     * keeps elsewhere -- and is left exactly as it was.
     */
    if (path === `${glyphsDirectory}/contents.plist`) originals.set(path, textOf(source));
    if (CLAIMED.has(path) || readFiles.has(path)) continue;
    untouched.set(path, source);
  }

  return {
    typeface,
    carried: {
      untouched,
      glyphsDirectory,
      originals,
      glifKept,
      unreadGlyphs,
      kernGroupNames: names,
    },
  };
}

/* --- writing ------------------------------------------------------------ */

/** A number, only if it is one, so an absent line stays absent. */
function put(dict: PlistDict, key: string, value: number | string | undefined): void {
  if (value === undefined || value === "") return;
  dict[key] = value;
}

/** The `fontinfo.plist` keys this application models, and so owns on the way out. */
const MODELLED_INFO = [
  "familyName",
  "styleName",
  "unitsPerEm",
  "ascender",
  "descender",
  "capHeight",
  "xHeight",
  "copyright",
  "openTypeNameDesigner",
  "openTypeNameManufacturer",
  "openTypeNameLicense",
  "openTypeOS2WeightClass",
  "openTypeOS2TypoLineGap",
  "versionMajor",
  "versionMinor",
];

/**
 * What the model says, laid over what the file said.
 *
 * Walked in the original's order rather than spread, so a key that was there
 * stays where it was and the file's diff is the lines that changed. A key the
 * model owns and now leaves out is gone -- a copyright somebody cleared is a
 * copyright cleared, not one to be quietly restored from the file -- and a key
 * the model has never heard of is exactly what it was.
 */
function overlay(original: PlistDict, mine: PlistDict, owned: Iterable<string>): PlistDict {
  const owns = new Set(owned);
  const out: PlistDict = {};
  for (const [key, value] of Object.entries(original)) {
    if (!owns.has(key)) out[key] = value;
    else if (key in mine) out[key] = mine[key];
  }
  for (const [key, value] of Object.entries(mine)) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/** A claimed file as it arrived, read with everything in it kept. */
function originalPlist(carried: UfoCarried | undefined, path: string): PlistDict {
  const source = carried?.originals?.get(path);
  if (source === undefined) return {};
  return readPlist(textOf(source), { keepOpaque: true }) ?? {};
}

function fontInfoOf(typeface: Typeface, original: PlistDict): PlistDict {
  const info: PlistDict = {};
  const owned = new Set(MODELLED_INFO);
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
  // Zero is what the reader makes of a gap the file did not state, so it is
  // written only when it is something else -- or when the file said zero.
  if (typeface.metrics.lineGap !== 0 || "openTypeOS2TypoLineGap" in original) {
    put(info, "openTypeOS2TypoLineGap", typeface.metrics.lineGap);
  }
  const [major, minor] = typeface.meta.version.split(".");
  const majorNumber = Number.parseInt(major ?? "", 10);
  if (Number.isFinite(majorNumber)) {
    info.versionMajor = majorNumber;
    info.versionMinor = Number.parseInt(minor ?? "0", 10) || 0;
  } else {
    // A version that is not a number is one the model cannot say, so the
    // file's own is left where it was rather than deleted.
    owned.delete("versionMajor");
    owned.delete("versionMinor");
  }
  return overlay(original, info, owned);
}

/**
 * `layercontents.plist`, with every layer the folder still has.
 *
 * The other layers are carried through untouched -- their folders are in the
 * set this writes -- and this file is the only thing that says they are
 * layers. Written with only the default one, as it used to be, the background
 * sketches were still on disk and invisible to every tool that opened the
 * folder: kept in the most useless sense there is.
 */
function layerContentsOf(carried: UfoCarried | undefined, glyphsDirectory: string): string {
  const source = carried?.originals?.get("layercontents.plist");
  const pairs = source === undefined ? [] : layerPairs(textOf(source));
  if (!pairs.some((pair) => pair[1] === glyphsDirectory)) {
    pairs.unshift(["public.default", glyphsDirectory]);
  }
  // Written by hand for the same reason it is read by hand: this is the one
  // file in a UFO whose root is an array.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<array>",
    ...pairs.flatMap(([name, directory]) => [
      "  <array>",
      `    <string>${escapeXml(name)}</string>`,
      `    <string>${escapeXml(directory)}</string>`,
      "  </array>",
    ]),
    "</array>",
    "</plist>",
    "",
  ].join("\n");
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

  files.set("metainfo.plist", writePlist({ creator: "com.typeforge", formatVersion: 3 }));
  files.set(
    "fontinfo.plist",
    writePlist(fontInfoOf(typeface, originalPlist(carried, "fontinfo.plist"))),
  );
  files.set("layercontents.plist", layerContentsOf(carried, glyphsDirectory));

  const taken = new Set<string>();
  const contents: PlistDict = {};
  /*
   * The glyphs this could not read go back into `contents.plist` first, under
   * the files they were already in, so nothing written below can land on top
   * of one. A glyph of the same name that is in the model now -- somebody made
   * one -- supersedes it, and then the old file goes, or two files would claim
   * the one name.
   */
  const unread: string[] = [];
  for (const [name, fileName] of Object.entries(carried?.unreadGlyphs ?? {})) {
    if (typeface.glyphIndex.has(name)) {
      files.delete(`${glyphsDirectory}/${fileName}`);
      continue;
    }
    taken.add(fileName.toLowerCase());
    contents[name] = fileName;
    unread.push(name);
  }
  /*
   * What each glyph's file held that the glyph cannot -- the note, the image,
   * the guidelines, its own lib -- found under the name the file had for it.
   *
   * It is kept by that name, and looked up by the glyph's name now, so a
   * renamed letter went out without any of it: the designer's note on `a`
   * was gone from `a.ss01` for nothing more than a change of name. The rename
   * map says which file name a glyph came from. A name that was renamed away
   * and has since been given to a new letter is not that letter's, so the new
   * one gets nothing rather than its predecessor's note.
   */
  const renamedFrom = new Map(
    Object.entries(carried?.renamed ?? {}).map(([was, is]) => [is, was] as const),
  );
  const keptFor = (name: string): string[] | undefined => {
    const was = renamedFrom.get(name);
    if (was !== undefined) return carried?.glifKept?.[was];
    if (carried?.renamed?.[name] !== undefined) return undefined;
    return carried?.glifKept?.[name];
  };
  for (const glyph of typeface.glyphs) {
    const fileName = fileNameFor(glyph.name, taken);
    contents[glyph.name] = fileName;
    files.set(`${glyphsDirectory}/${fileName}`, writeGlif(glyph, keptFor(glyph.name)));
  }
  files.set(`${glyphsDirectory}/contents.plist`, writePlist(contents));

  /*
   * The kerning, back the way it came.
   *
   * A class here becomes a group each side and one entry between them, which
   * is how a UFO says the same thing. The group names carry the prefixes the
   * format reserves, because a name without them is a plain glyph list that
   * kerning will not look in.
   *
   * Every group the file had that is not kerning is kept: the groups that feed
   * a mark feature or a spacing script are nothing this application models
   * and nothing it has any business deleting. A kerning class that came out
   * of a named group goes back under that name, with whatever members it has
   * now. Only a class made here, or one whose group has already been given
   * other members by a class written before it, is given a new name -- one
   * nothing in the file is already called.
   *
   * Starting from the groups as they arrived is what keeps those, and it is
   * also what went wrong three ways, because the file's groups are a record
   * of the font as it was read and the font has moved on since:
   *
   *   - A glyph deleted or renamed here stayed in every group under the name
   *     it had, naming a glyph the folder no longer has. Now a deleted one is
   *     taken out and a renamed one is followed (`renamed` above).
   *   - A kerning group whose class was removed here was still written, with
   *     nothing kerning against it. Every `public.kern1.` and `public.kern2.`
   *     group now comes from a class that is still here, and none from the
   *     file alone -- the classes *are* the kerning groups, read that way.
   *   - Which made the third: remove a class and make one with the same
   *     letters, and the letters were in the old group and the new one. The
   *     format allows a glyph in one kerning group per side, since otherwise
   *     which of two values applies has no answer, and ufoLib refuses to open
   *     a folder that breaks that. This model does let a letter sit in two
   *     classes, with the first one winning -- so a letter an earlier class
   *     already took is left out of the later group, and whatever the later
   *     class meant for it that the earlier one did not already decide is
   *     written as a pair of glyphs instead. Glyph pairs beat groups in every
   *     reader, so it means the same thing.
   */
  const original = originalPlist(carried, "groups.plist");
  const renamed = carried?.renamed ?? {};
  const present = new Set([...typeface.glyphs.map((glyph) => glyph.name), ...unread]);
  const contentsBefore = originalPlist(carried, `${glyphsDirectory}/contents.plist`);
  // Without a record of what the file had -- a session saved before one was
  // kept -- every name that is not a glyph now is treated as one that was.
  const hadBefore =
    Object.keys(contentsBefore).length > 0 ? new Set(Object.keys(contentsBefore)) : null;
  const now = (member: string): string | null => {
    const to = renamed[member];
    if (to !== undefined) return present.has(to) ? to : null;
    if (present.has(member)) return member;
    return hadBefore && !hadBefore.has(member) ? member : null;
  };

  const KERN1 = "public.kern1.";
  const KERN2 = "public.kern2.";
  const groups: PlistDict = {};
  for (const [name, members] of Object.entries(original)) {
    if (name.startsWith(KERN1) || name.startsWith(KERN2)) continue;
    if (!Array.isArray(members)) {
      groups[name] = members;
      continue;
    }
    const kept: PlistValue[] = [];
    for (const member of members) {
      if (typeof member !== "string") {
        kept.push(member);
        continue;
      }
      const to = now(member);
      if (to !== null && !kept.includes(to)) kept.push(to);
    }
    groups[name] = kept;
  }

  const kerning: PlistDict = {};
  const has = (left: string, right: string): boolean =>
    (kerning[left] as PlistDict | undefined)?.[right] !== undefined;
  const add = (left: string, right: string, value: number) => {
    const seconds = (kerning[left] as PlistDict | undefined) ?? {};
    seconds[right] = value;
    kerning[left] = seconds;
  };

  /** Which group each glyph went into, per side, and each group by members. */
  const claimed = { [KERN1]: new Map<string, string>(), [KERN2]: new Map<string, string>() };
  const byMembers = { [KERN1]: new Map<string, string>(), [KERN2]: new Map<string, string>() };
  const assigned = new Set<string>();
  const sideOf = (
    members: string[],
    preferred: string | undefined,
    prefix: typeof KERN1 | typeof KERN2,
    index: number,
  ): { name: string | null; left: string[] } => {
    // The same letters as a group already written on this side is that group:
    // a group kerned against three others reads as three classes.
    const key = JSON.stringify(members);
    const same = byMembers[prefix].get(key);
    if (same) return { name: same, left: [] };

    const taken = claimed[prefix];
    const fresh = members.filter((member) => !taken.has(member));
    const out = members.filter((member) => taken.has(member));
    if (fresh.length === 0) return { name: null, left: out };
    // One glyph on a side is written as that glyph rather than as a group of
    // one, which is what it means and what keeps the file readable -- unless
    // the file called it a group, in which case it goes back as one.
    const usePreferred = preferred?.startsWith(prefix) && !assigned.has(preferred);
    if (!usePreferred && members.length === 1) return { name: members[0], left: [] };
    let name = usePreferred ? (preferred as string) : `${prefix}${index}`;
    if (!usePreferred) {
      // Not a name the file used either, even for a group now gone: a feature
      // file somewhere may still say it, and should not find other letters.
      for (let count = 1; name in original || assigned.has(name); count++) {
        name = `${prefix}${index}.${count}`;
      }
    }
    assigned.add(name);
    byMembers[prefix].set(key, name);
    for (const member of fresh) taken.set(member, name);
    groups[name] = [...fresh];
    return { name, left: out };
  };

  typeface.kernClasses.forEach((kernClass, index) => {
    const named = carried?.kernGroupNames?.[kernClass.id];
    const left = sideOf(kernClass.left, named?.left, KERN1, index);
    const right = sideOf(kernClass.right, named?.right, KERN2, index);
    if (left.name !== null && right.name !== null) add(left.name, right.name, kernClass.value);

    // The letters left out of a group, as pairs, where no class before this
    // one has already said what they are. First class wins, as it does in
    // `resolvedKerning`.
    if (left.left.length === 0 && right.left.length === 0) return;
    const leftOut = new Set(left.left);
    const rightOut = new Set(right.left);
    const earlier = typeface.kernClasses.slice(0, index);
    for (const first of kernClass.left) {
      for (const second of kernClass.right) {
        if (!leftOut.has(first) && !rightOut.has(second)) continue;
        if (earlier.some((one) => one.left.includes(first) && one.right.includes(second))) continue;
        if (!has(first, second)) add(first, second, kernClass.value);
      }
    }
  });
  for (const pair of typeface.kerning) add(pair.left, pair.right, pair.value);

  if (Object.keys(groups).length > 0) files.set("groups.plist", writePlist(groups));
  if (Object.keys(kerning).length > 0) files.set("kerning.plist", writePlist(kerning));

  /*
   * The lib, with the one key this models laid over whatever else was in it.
   * The glyphs that could not be read keep a place in the order, at the end,
   * so a tool that can read them finds them where a font expects its glyphs.
   */
  const lib = originalPlist(carried, "lib.plist");
  lib["public.glyphOrder"] = [...typeface.glyphs.map((glyph) => glyph.name), ...unread];
  files.set("lib.plist", writePlist(lib));

  return files;
}

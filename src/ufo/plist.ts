/**
 * Property lists, which is what a UFO says everything but its outlines in.
 *
 * Five of the files in a UFO are plists: what format it is, what the font is
 * called and how tall its letters are, which glyphs are in which file, what the
 * kerning groups are, and what the kerning is. They are Apple's XML plist
 * format, and the subset that turns up in a UFO is small -- dictionaries,
 * arrays, strings, integers, reals and booleans, nested.
 *
 * Read into ordinary JavaScript values rather than into a class, because that
 * is what they are: a plist dictionary is an object and a plist array is an
 * array, and anything else here would be a layer to look through later. What
 * the readers next door need is `fontinfo.unitsPerEm`, and this is what lets
 * them write that.
 *
 * The one thing this does that a general plist library would not is refuse
 * quietly. A file that is not a plist, or a `<dict>` with a key and no value
 * after it, gives back nothing rather than throwing -- because every caller is
 * asking whether a folder is a UFO, and half an answer from a malformed file is
 * worse than no answer at all.
 */

import { attributes, escapeXml, parseXml, XML_DECLARATION, type XmlNode } from "./xml";

/** Anything a plist can hold. */
export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

/** A plist whose root is a dictionary, which every plist in a UFO has. */
export type PlistDict = Record<string, PlistValue>;

function valueOf(node: XmlNode): PlistValue | undefined {
  switch (node.name) {
    case "string":
      return node.text;
    case "integer": {
      const value = Number.parseInt(node.text, 10);
      return Number.isFinite(value) ? value : undefined;
    }
    case "real": {
      const value = Number.parseFloat(node.text);
      return Number.isFinite(value) ? value : undefined;
    }
    case "true":
      return true;
    case "false":
      return false;
    case "array":
      return node.children
        .map((one) => valueOf(one))
        .filter((one): one is PlistValue => one !== undefined);
    case "dict":
      return dictOf(node);
    /*
     * `<data>` and `<date>` are plist types a UFO does not use for anything
     * this reads, and guessing at them would be inventing a value. They come
     * back as undefined, which drops the key rather than filling it with
     * something that is not what the file said.
     */
    default:
      return undefined;
  }
}

/**
 * A `<dict>` element, as an object.
 *
 * A plist dictionary is a flat run of alternating `<key>` and value elements
 * rather than a nesting, so this walks in pairs. A key with nothing after it,
 * or two keys in a row, is a malformed file: the key is skipped rather than
 * given a value it does not have.
 */
function dictOf(node: XmlNode): PlistDict {
  const out: PlistDict = {};
  for (let at = 0; at < node.children.length; at++) {
    const key = node.children[at];
    if (key.name !== "key") continue;
    const next = node.children[at + 1];
    if (!next || next.name === "key") continue;
    const value = valueOf(next);
    if (value !== undefined) out[key.text] = value;
    at += 1;
  }
  return out;
}

/**
 * A plist file, as an object, or null if it is not one.
 *
 * Null covers a file that is not XML, is not a plist, or whose root is not a
 * dictionary. All three mean the same thing to every caller here.
 */
export function readPlist(source: string): PlistDict | null {
  const root = parseXml(source);
  if (!root || root.name !== "plist") return null;
  const dict = root.children.find((one) => one.name === "dict");
  return dict ? dictOf(dict) : null;
}

/* --- writing ------------------------------------------------------------ */

/*
 * Two spaces a level, and a tab-free file.
 *
 * The format does not care. Version control does: a UFO lives in a repository
 * beside the drawings it describes, and a file that comes back indented
 * differently is a diff across every line of something nobody edited. This is
 * the indentation `plistlib` writes, which is what the Python tools in this
 * ecosystem produce, so a file that has been through here and a file that has
 * been through `fontTools` look the same.
 */
const STEP = "  ";

function isDict(value: PlistValue): value is { [key: string]: PlistValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeValue(value: PlistValue, depth: number): string {
  const pad = STEP.repeat(depth);
  if (typeof value === "string") return `${pad}<string>${escapeXml(value)}</string>`;
  if (typeof value === "boolean") return `${pad}<${value}/>`;
  if (typeof value === "number") {
    // An integer is written as one. A plist has both types and the readers on
    // the other side of this are entitled to tell them apart -- `unitsPerEm`
    // arriving as `1000.0` is a real where every other tool writes an integer.
    return Number.isInteger(value)
      ? `${pad}<integer>${value}</integer>`
      : `${pad}<real>${value}</real>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<array/>`;
    const inside = value.map((one) => writeValue(one, depth + 1)).join("\n");
    return `${pad}<array>\n${inside}\n${pad}</array>`;
  }
  if (isDict(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return `${pad}<dict/>`;
    const inside = keys
      .map(
        (key) =>
          `${STEP.repeat(depth + 1)}<key>${escapeXml(key)}</key>\n${writeValue(value[key], depth + 1)}`,
      )
      .join("\n");
    return `${pad}<dict>\n${inside}\n${pad}</dict>`;
  }
  return `${pad}<string/>`;
}

/** A dictionary, as the text of a plist file. */
export function writePlist(dict: PlistDict): string {
  const open = `<plist${attributes([["version", "1.0"]])}>`;
  return [
    XML_DECLARATION,
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    open,
    writeValue(dict, 0),
    "</plist>",
    "",
  ].join("\n");
}

/* --- reading a value out of one, without believing it ------------------- */

/** A string under a key, or undefined if it is not there or is not one. */
export function stringAt(dict: PlistDict, key: string): string | undefined {
  const value = dict[key];
  return typeof value === "string" ? value : undefined;
}

/** A finite number under a key, or undefined. */
export function numberAt(dict: PlistDict, key: string): number | undefined {
  const value = dict[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** An array of strings under a key, dropping anything in it that is not one. */
export function stringsAt(dict: PlistDict, key: string): string[] {
  const value = dict[key];
  if (!Array.isArray(value)) return [];
  return value.filter((one): one is string => typeof one === "string");
}

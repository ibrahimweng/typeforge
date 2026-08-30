/**
 * XML, in the one shape the rest of this directory wants it in.
 *
 * A UFO is a folder of XML: a handful of property lists describing the font,
 * and one `.glif` file per glyph describing its outline. So everything here
 * starts by turning text into a tree, and this is the only place that happens.
 *
 * The parser is `fast-xml-parser` rather than something written here, and the
 * deciding fact was measured rather than assumed. UFO files are written by at
 * least five applications and edited by hand in between, so what matters is
 * being right about the awkward parts of XML rather than being small. Of the
 * two candidates, one decoded `&#233;` and `&amp;` correctly and the other
 * decoded neither -- it leaves entities to the caller, which would have meant
 * hand-writing the part of a parser most likely to be wrong. Twenty-five
 * kilobytes gzipped against a bundle that already carries a geometry library
 * and two font parsers is not a cost worth being wrong for.
 *
 * `htmlEntities` is on for that reason and is not what its name suggests: it is
 * the flag that turns on numeric character references, which are ordinary XML
 * and appear in any UFO with a non-ASCII name in it.
 *
 * What it gives back is `{ tag: [children], ":@": attributes }`, which is a
 * faithful record of the document and awkward to walk. `treeOf` turns that into
 * something with names on it once, here, so that no reader downstream has to
 * know what `":@"` means.
 *
 * Writing is done by hand, and the asymmetry is deliberate. Parsing XML means
 * being right about input somebody else wrote; writing it means escaping five
 * characters in output we control, which is ten lines and a test rather than a
 * dependency. It also keeps the exact shape of what we write ours to choose,
 * and that matters: designers keep UFOs in version control, so a file that
 * comes back with its whitespace rearranged is a diff nobody asked for.
 */

import { XMLParser } from "fast-xml-parser";

/** An element: its name, its attributes, and what is inside it. */
export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** The text directly inside this element, with entities already decoded. */
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  // Everything stays a string. A plist says what its own types are with the
  // tag around the value, and a GLIF coordinate that guesses its way to a
  // number is a coordinate that has been through a guess.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  // Numeric character references, which the name does not suggest and which
  // are plain XML. Measured: without this, `caf&#233;` arrives as five
  // literal characters.
  htmlEntities: true,
});

/** The children of one node of the parser's own ordered form. */
type Raw = Record<string, unknown>;

function nodeOf(raw: Raw): XmlNode | null {
  const name = Object.keys(raw).find((key) => key !== ":@");
  if (name === undefined || name === "#text") return null;
  const attributes = (raw[":@"] as Record<string, string> | undefined) ?? {};
  const inside = (raw[name] as Raw[] | undefined) ?? [];

  const children: XmlNode[] = [];
  let text = "";
  for (const one of inside) {
    if ("#text" in one) {
      text += String(one["#text"] ?? "");
      continue;
    }
    const child = nodeOf(one);
    if (child) children.push(child);
  }
  return { name, attributes, children, text: text.trim() };
}

/**
 * The root element of a document, or null if there is not one.
 *
 * Null rather than a throw, because every caller here is deciding whether a
 * file is the thing it hoped for, and "this is not a UFO" is an answer rather
 * than an error. The declaration and any comments before the root are skipped:
 * they are part of the document and not part of what it says.
 */
export function parseXml(source: string): XmlNode | null {
  let parsed: Raw[];
  try {
    parsed = parser.parse(source) as Raw[];
  } catch {
    return null;
  }
  for (const raw of parsed) {
    const node = nodeOf(raw);
    if (node && !node.name.startsWith("?") && !node.name.startsWith("!")) return node;
  }
  return null;
}

/** The first child with a given name, which is how these documents are shaped. */
export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((one) => one.name === name);
}

/** Every child with a given name, in document order. */
export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((one) => one.name === name);
}

/*
 * The five characters XML reserves, and nothing else.
 *
 * XML has exactly these five predefined entities -- unlike HTML, which has
 * well over two thousand -- so escaping is a closed list rather than a table.
 * The apostrophe and the quote only matter inside an attribute value, but
 * escaping them everywhere costs nothing and removes the question of which
 * context a string is about to land in.
 */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** A string, safe to put in an element or an attribute. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (one) => ESCAPES[one]);
}

/** An attribute list, in the order given, with empty values left out. */
export function attributes(pairs: Array<[string, string | number | undefined]>): string {
  return pairs
    .filter((pair): pair is [string, string | number] => pair[1] !== undefined && pair[1] !== "")
    .map(([name, value]) => ` ${name}="${escapeXml(String(value))}"`)
    .join("");
}

/** The declaration every file in a UFO opens with. */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

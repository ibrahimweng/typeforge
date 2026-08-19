/**
 * Importing a font file into the editable document model.
 *
 * opentype.js does the outline and kerning reading because it handles both
 * outline flavours and, unlike the alternatives, surfaces GPOS kerning.
 * fonteditor-core is used only to unwrap WOFF and WOFF2 into plain sfnt bytes.
 *
 * Alongside the model we keep the original tables, which is what lets "preserve"
 * export return features we never modelled (ligatures, hinting, colour,
 * variations) exactly as they arrived.
 */

import { parse as parseOpenType } from "opentype.js";

import { classifyNodes } from "./quadratic";
import { readSfnt, SFNT_CFF } from "./sfnt";
import {
  DEFAULT_PARAMS,
  type Contour,
  type Glyph,
  type GlyphNode,
  type KernPair,
  type SourceFont,
  type Typeface,
  type Vec2,
} from "./types";

export type FontFormat = "truetype" | "opentype" | "woff" | "woff2" | "unknown";

export interface ImportResult {
  typeface: Typeface;
  /** Things worth telling the user that did not stop the import. */
  warnings: string[];
}

/** Identify a file from its first four bytes rather than trusting its name. */
export function detectFormat(bytes: Uint8Array): FontFormat {
  if (bytes.length < 4) return "unknown";
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  if (tag === "OTTO") return "opentype";
  if (tag === "true" || tag === "ttcf") return "truetype";
  const version = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  if (version === 0x00010000) return "truetype";
  return "unknown";
}

/** Unwrap web font containers so everything downstream sees plain sfnt bytes. */
async function toSfntBytes(bytes: Uint8Array, format: FontFormat): Promise<Uint8Array> {
  if (format !== "woff" && format !== "woff2") return bytes;

  const { Font, woff2 } = await import("fonteditor-core");
  if (format === "woff2") {
    // The WOFF2 decoder is a WebAssembly module, loaded only when one turns up.
    await woff2.init(undefined as never);
  }
  const font = Font.create(bytes as never, {
    type: format,
    hinting: true,
    kerning: true,
  } as never);
  // Without `toBuffer` this hands back an ArrayBuffer, which is what we want in
  // the browser; the Node typings describe the Buffer variant instead.
  const written = font.write({ type: "ttf" } as never) as unknown;
  return new Uint8Array(written as ArrayBuffer);
}

export async function importFont(
  input: Uint8Array | ArrayBuffer,
  fileName = "font",
): Promise<ImportResult> {
  const warnings: string[] = [];
  const raw = input instanceof Uint8Array ? input : new Uint8Array(input);

  const format = detectFormat(raw);
  if (format === "unknown") {
    throw new Error(
      "That file does not look like a font. Typeforge reads TrueType (.ttf), OpenType (.otf), WOFF and WOFF2.",
    );
  }

  const bytes = await toSfntBytes(raw, format);
  const sfnt = readSfnt(bytes);
  const isCFF = sfnt.sfntVersion === SFNT_CFF || sfnt.tables.has("CFF ");

  const source: SourceFont = {
    bytes,
    sfntVersion: sfnt.sfntVersion,
    tables: sfnt.tables,
    isCFF,
    fileName,
  };

  // opentype.js needs its own ArrayBuffer view of the bytes.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const font = parseOpenType(buffer as ArrayBuffer);

  const unitsPerEm = font.unitsPerEm || 1000;
  const glyphs: Glyph[] = [];
  const glyphIndex = new Map<string, number>();
  const usedNames = new Set<string>();

  for (let i = 0; i < font.glyphs.length; i++) {
    const source = font.glyphs.get(i);
    const name = uniqueName(source.name ?? `glyph${i}`, usedNames);
    usedNames.add(name);

    let contours: Contour[] = [];
    try {
      contours = commandsToContours(source.path.commands);
    } catch {
      warnings.push(`Could not read the outline of "${name}"; it was imported empty.`);
    }

    glyphs.push({
      name,
      unicodes: source.unicodes ?? [],
      advanceWidth: source.advanceWidth ?? 0,
      contours,
      // opentype.js resolves composite glyphs into plain outlines, so by the
      // time we see them there are no components left to record.
      components: [],
      params: {},
      dirty: false,
    });
    glyphIndex.set(name, i);
  }

  const kerning = readKerning(font, glyphs);
  if (kerning.length > 0) {
    warnings.push(`Read ${kerning.length.toLocaleString()} kerning pairs.`);
  }

  const os2 = (font.tables.os2 ?? {}) as Record<string, number>;
  const hhea = (font.tables.hhea ?? {}) as Record<string, number>;

  const typeface: Typeface = {
    meta: {
      familyName: readName(font, "fontFamily") || stripExtension(fileName),
      styleName: readName(font, "fontSubfamily") || "Regular",
      version: readName(font, "version") || "1.000",
      designer: readName(font, "designer"),
      manufacturer: readName(font, "manufacturer"),
      copyright: readName(font, "copyright"),
      license: readName(font, "license"),
    },
    unitsPerEm,
    metrics: {
      ascender: font.ascender || hhea.ascender || Math.round(unitsPerEm * 0.8),
      descender: font.descender || hhea.descender || -Math.round(unitsPerEm * 0.2),
      capHeight: os2.sCapHeight || Math.round(unitsPerEm * 0.7),
      xHeight: os2.sxHeight || Math.round(unitsPerEm * 0.5),
      lineGap: hhea.lineGap || 0,
    },
    glyphs,
    glyphIndex,
    kerning,
    kernClasses: [],
    params: { ...DEFAULT_PARAMS },
    source,
  };

  if (isCFF) {
    warnings.push(
      "This is a PostScript-flavoured OpenType font. Exporting it as TrueType converts the curves, which is normal and lossless to the eye.",
    );
  }
  return { typeface, warnings };
}

/** Turn opentype.js path commands into the node model the editor works with. */
export function commandsToContours(commands: readonly import("opentype.js").PathCommand[]): Contour[] {
  const contours: Contour[] = [];
  let nodes: GlyphNode[] = [];
  let current: Vec2 = { x: 0, y: 0 };

  const pushContour = (closed: boolean) => {
    if (nodes.length === 0) return;
    // A closing command that lands back on the start leaves a duplicate node.
    if (nodes.length > 1) {
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (Math.abs(first.point.x - last.point.x) < 1e-6 && Math.abs(first.point.y - last.point.y) < 1e-6) {
        first.handleIn = last.handleIn;
        nodes.pop();
      }
    }
    classifyNodes(nodes);
    contours.push({ nodes, closed });
    nodes = [];
  };

  for (const command of commands) {
    switch (command.type) {
      case "M": {
        pushContour(true);
        current = { x: command.x!, y: command.y! };
        nodes.push({ point: { ...current }, handleIn: null, handleOut: null, type: "corner" });
        break;
      }
      case "L": {
        current = { x: command.x!, y: command.y! };
        nodes.push({ point: { ...current }, handleIn: null, handleOut: null, type: "corner" });
        break;
      }
      case "C": {
        const previous = nodes[nodes.length - 1];
        if (previous) previous.handleOut = { x: command.x1!, y: command.y1! };
        current = { x: command.x!, y: command.y! };
        nodes.push({
          point: { ...current },
          handleIn: { x: command.x2!, y: command.y2! },
          handleOut: null,
          type: "corner",
        });
        break;
      }
      case "Q": {
        // Raise the quadratic to the cubic that draws the identical curve.
        const previous = nodes[nodes.length - 1];
        const from = previous ? previous.point : current;
        const control = { x: command.x1!, y: command.y1! };
        const to = { x: command.x!, y: command.y! };
        if (previous) {
          previous.handleOut = {
            x: from.x + (2 / 3) * (control.x - from.x),
            y: from.y + (2 / 3) * (control.y - from.y),
          };
        }
        nodes.push({
          point: { ...to },
          handleIn: {
            x: to.x + (2 / 3) * (control.x - to.x),
            y: to.y + (2 / 3) * (control.y - to.y),
          },
          handleOut: null,
          type: "corner",
        });
        current = to;
        break;
      }
      case "Z": {
        pushContour(true);
        break;
      }
    }
  }
  pushContour(true);
  return contours;
}

/**
 * Read kerning as glyph-name pairs.
 *
 * opentype.js exposes this as `kerningPairs`, keyed by glyph id, and fills it
 * from GPOS as well as the legacy table. Its `getKerningValue` helper looks only
 * at the legacy table and returns zero for a GPOS-only font, so it is not used.
 */
function readKerning(font: import("opentype.js").Font, glyphs: Glyph[]): KernPair[] {
  const pairs: KernPair[] = [];
  for (const [key, value] of Object.entries(font.kerningPairs ?? {})) {
    if (!value) continue;
    const comma = key.indexOf(",");
    if (comma === -1) continue;
    const left = glyphs[Number(key.slice(0, comma))];
    const right = glyphs[Number(key.slice(comma + 1))];
    if (left && right) pairs.push({ left: left.name, right: right.name, value });
  }
  return pairs;
}

function readName(font: import("opentype.js").Font, key: string): string {
  const entry = font.names?.[key];
  if (!entry) return "";
  return entry.en ?? Object.values(entry)[0] ?? "";
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let suffix = 1;
  while (taken.has(`${name}.${suffix}`)) suffix++;
  return `${name}.${suffix}`;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "Untitled";
}

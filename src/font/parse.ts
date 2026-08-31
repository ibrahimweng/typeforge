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

import { readComposites } from "./composite";
import { contoursBounds } from "./geometry";
import { featuresFromGsub } from "./features";
import { readGposKerning, toKernClasses, writtenPairs } from "./gpos";
import { classifyNodes } from "./quadratic";
import { readSfnt, SFNT_CFF } from "./sfnt";
import {
  DEFAULT_PARAMS,
  type Contour,
  type Glyph,
  type GlyphNode,
  type KernClass,
  type KernPair,
  type NamedLigature,
  type NamedSet,
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
    /*
     * The WOFF2 decoder is WebAssembly, initialised only when one turns up.
     *
     * It has to be told where its own `.wasm` file is, and the reason is worth
     * writing down because the failure is nothing like the cause. In a browser
     * the decoder installs a `locateFile` hook that answers every request for a
     * `.wasm` with whatever was passed to `init` -- so calling `init()` with
     * nothing answers `undefined`, and the path is then handed to a check that
     * calls `.startsWith` on it. What reaches the screen is "Cannot read
     * properties of undefined (reading 'startsWith')", which names neither
     * WOFF2 nor this file, and every WOFF2 font fails: which is to say every
     * font Google Fonts serves, and the whole library with it.
     *
     * The file is served as our own asset rather than imported from the
     * package, because the package does not export it -- its `exports` map
     * offers `./lib/*` and nothing else, so a bundler asked for it refuses.
     * Built from the base URL so it is found under a sub-path deployment as
     * well as at a root. A test keeps the copy identical to the installed
     * package's, so an upgrade that changes the decoder cannot leave a stale
     * one behind. Node resolves the file itself and ignores this argument.
     */
    await woff2.init(`${import.meta.env.BASE_URL}woff2.wasm`);
  }

  // fonteditor-core reads through a DataView and so needs a real ArrayBuffer.
  // Handing it the Uint8Array fails inside its reader with a message that does
  // not point back here, so the conversion is done up front.
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  // WOFF stores each table zlib-compressed and expects the caller to supply a
  // synchronous inflate. fflate is a few kilobytes and works the same in the
  // browser and in Node, where DecompressionStream would only be async.
  const { unzlibSync } = await import("fflate");

  const font = Font.create(buffer, {
    type: format,
    hinting: true,
    kerning: true,
    // The reader hands over a plain number array and expects one back, so
    // convert either side of fflate, which works in typed arrays.
    inflate: (deflated: number[]) => Array.from(unzlibSync(Uint8Array.from(deflated))),
  });
  // Without `toBuffer` this hands back an ArrayBuffer, which is what we want in
  // the browser; the Node typings describe the Buffer variant instead.
  const written = font.write({ type: "ttf" }) as unknown;
  return new Uint8Array(written as ArrayBuffer);
}

/**
 * The ligatures and stylistic sets a font arrives with.
 *
 * It arrived with none. Every import set `alternates: []` and said nothing
 * about the rest, so the features panel told a face that plainly draws `fi`
 * that it had no ligatures, and a rebuild export dropped every one of them --
 * while a preserve export kept them, which is what made it survivable and also
 * what made it invisible: the two halves of the export disagreed and neither
 * said so.
 *
 * Names rather than ids, because that is what the document is written in and
 * what a rename has to be able to rewrite. A rule naming a glyph this font does
 * not have is dropped: it can only come from a table that disagrees with its
 * own glyph count, and a rule pointing at nothing fires somewhere it should not.
 *
 * Only what the document can hold -- the ligatures and the single
 * substitutions. Everything else stays in the source tables and goes back out
 * untouched on a preserve export, which is what that mode is for.
 */
function featuresOf(
  source: SourceFont | null,
  glyphs: Glyph[],
): { ligatures?: NamedLigature[]; sets?: NamedSet[] } {
  const raw = source?.tables.get("GSUB");
  if (!raw) return {};

  const { ligatures, sets } = featuresFromGsub(raw, glyphs);
  return {
    ...(ligatures.length > 0 ? { ligatures } : {}),
    ...(sets.length > 0 ? { sets } : {}),
  };
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

  // opentype.js is a few hundred kilobytes and is not needed until a font is
  // actually opened, so it is fetched on demand rather than at start-up.
  const { parse: parseOpenType } = await import("opentype.js");
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
      anchors: [],
      params: {},
      dirty: false,
    });
    glyphIndex.set(name, i);
  }

  // opentype.js flattens composite glyphs into plain outlines, so `á` arrives
  // as a drawing rather than as `a` plus `acute`. Recover the structure from
  // the glyf table, and drop the flattened outline in favour of the parts.
  const glyfTable = sfnt.tables.get("glyf");
  const locaTable = sfnt.tables.get("loca");
  const headTable = sfnt.tables.get("head");
  if (glyfTable && locaTable && headTable && headTable.length >= 52) {
    const indexToLocFormat = new DataView(
      headTable.buffer,
      headTable.byteOffset,
      headTable.byteLength,
    ).getInt16(50);
    const names = glyphs.map((glyph) => glyph.name);
    const { components, pointMatched } = readComposites(
      glyfTable,
      locaTable,
      indexToLocFormat,
      glyphs.length,
      names,
    );

    for (const [index, list] of components) {
      const glyph = glyphs[index];
      if (!glyph) continue;
      glyph.components = list;
      // A TrueType composite carries no contours of its own; what opentype.js
      // handed over was the flattened result, which the parts now supply.
      glyph.contours = [];
    }
    if (components.size > 0) {
      warnings.push(
        components.size === 1
          ? "One glyph is built from components."
          : `${components.size.toLocaleString()} glyphs are built from components.`,
      );
    }
    if (pointMatched > 0) {
      warnings.push(
        `${pointMatched} component${pointMatched === 1 ? " is" : "s are"} positioned by matching points rather than by offset, which is not modelled; they were placed at the origin.`,
      );
    }
  }

  const { kerning, kernClasses } = readAllKerning(font, glyphs, source);
  if (kerning.length > 0 || kernClasses.length > 0) {
    const parts: string[] = [];
    if (kerning.length > 0) parts.push(`${kerning.length.toLocaleString()} kerning pairs`);
    if (kernClasses.length > 0) {
      parts.push(`${kernClasses.length.toLocaleString()} class kerning rules`);
    }
    warnings.push(`Read ${parts.join(" and ")}.`);
  }

  const os2 = (font.tables.os2 ?? {}) as Record<string, number>;
  const hhea = (font.tables.hhea ?? {}) as Record<string, number>;

  /*
   * A weight this application understands, from whatever the file said.
   *
   * The specification says 1 to 1000 and the world says 100 to 900 in
   * hundreds. Fonts in the wild carry both, and a few carry the old scale of
   * 1 to 9 -- so those are multiplied up rather than read as a hairline.
   */
  function weightClassOf(value: number | undefined): number {
    if (!value || !Number.isFinite(value)) return 400;
    const scaled = value <= 9 ? value * 100 : value;
    return Math.min(1000, Math.max(1, Math.round(scaled)));
  }

  /**
   * A height read off a letter, for the fonts that do not declare one.
   *
   * `sxHeight` and `sCapHeight` arrived in version 2 of the OS/2 table, so
   * every font written against version 1 -- which includes fonts still being
   * shipped -- has neither. Falling back to a proportion of the em is what
   * this did, and for DejaVu Sans that proportion is out by nine per cent:
   * half the em is 1024 against a real x-height of 1120. Every guide, every
   * metric line and every proportion the Draw mode works from was built on
   * that number.
   *
   * So it is measured instead. The letters named here are the ones whose flat
   * top *is* the height -- an `x` has no overshoot and no terminal above the
   * line, an `H` no serif that rises past the cap -- and the first one the
   * font actually has decides it. The proportion is still there for a font
   * that has none of them.
   */
  function measuredHeight(names: string[]): number | null {
    for (const name of names) {
      const index = glyphIndex.get(name);
      if (index === undefined) continue;
      const glyph = glyphs[index];
      if (!glyph || glyph.contours.length === 0) continue;
      const top = contoursBounds(glyph.contours).yMax;
      if (Number.isFinite(top) && top > 0) return Math.round(top);
    }
    return null;
  }

  const typeface: Typeface = {
    meta: {
      familyName: readName(font, "fontFamily") || stripExtension(fileName),
      styleName: readName(font, "fontSubfamily") || "Regular",
      version: readName(font, "version") || "1.000",
      designer: readName(font, "designer"),
      manufacturer: readName(font, "manufacturer"),
      copyright: readName(font, "copyright"),
      license: readName(font, "license"),
      // What the file itself says, rather than what its style name looks like.
      weightClass: weightClassOf(os2.usWeightClass),
    },
    unitsPerEm,
    metrics: {
      ascender: font.ascender || hhea.ascender || Math.round(unitsPerEm * 0.8),
      descender: font.descender || hhea.descender || -Math.round(unitsPerEm * 0.2),
      capHeight:
        os2.sCapHeight || measuredHeight(["H", "I", "E", "T"]) || Math.round(unitsPerEm * 0.7),
      xHeight: os2.sxHeight || measuredHeight(["x", "z", "v"]) || Math.round(unitsPerEm * 0.5),
      lineGap: hhea.lineGap || 0,
    },
    glyphs,
    glyphIndex,
    kerning,
    kernClasses,
    alternates: [],
    ...featuresOf(source, glyphs),
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
    const merged = mergeCoincidentNodes(nodes, closed);
    classifyNodes(merged);
    contours.push({ nodes: merged, closed });
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
 * Fold consecutive nodes that sit on the same point into one.
 *
 * A sharp corner arrives as a segment ending at a point and the next beginning
 * at it, which reads back as two nodes in the same place with a zero-length
 * segment between them. One node carrying both handles is the same shape,
 * without the empty segment that outline checkers flag as a duplicate point.
 */
function mergeCoincidentNodes(nodes: GlyphNode[], closed: boolean): GlyphNode[] {
  if (nodes.length < 2) return nodes;
  const out: GlyphNode[] = [];

  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (
      previous &&
      Math.abs(previous.point.x - node.point.x) < 1e-6 &&
      Math.abs(previous.point.y - node.point.y) < 1e-6
    ) {
      // Keep the handle arriving at the corner and the one leaving it.
      previous.handleOut = node.handleOut ?? previous.handleOut;
      if (!previous.handleIn) previous.handleIn = node.handleIn;
      continue;
    }
    out.push(node);
  }

  // On a closed contour the last node can land back on the first, which is the
  // same corner seen from both ends of the loop.
  if (closed && out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (
      Math.abs(first.point.x - last.point.x) < 1e-6 &&
      Math.abs(first.point.y - last.point.y) < 1e-6
    ) {
      first.handleIn = last.handleIn ?? first.handleIn;
      out.pop();
    }
  }
  return out;
}

/**
 * Read kerning as glyph-name pairs.
 *
 * opentype.js exposes this as `kerningPairs`, keyed by glyph id, and fills it
 * from GPOS as well as the legacy table. Its `getKerningValue` helper looks only
 * at the legacy table and returns zero for a GPOS-only font, so it is not used.
 */
/**
 * Everything the font says about kerning.
 *
 * Two readers, and the second is not an optimisation. opentype.js surfaces
 * only kerning written pair by pair, and no font made this century writes it
 * that way -- a face with a thousand glyphs has far too many useful pairs to
 * list, so it groups them into classes and stores a grid. Inter, Roboto, Lora
 * and Playfair between them carry two hundred kilobytes of that and gave up
 * nought pairs through the first reader alone, which meant opening a real font
 * read every outline correctly and quietly threw its spacing away.
 *
 * The two are merged with the pairs winning, because that is what the font
 * means: inside a lookup the individual pairs are written ahead of the grid so
 * that a pair with an opinion of its own overrides the class it falls into.
 */
function readAllKerning(
  font: import("opentype.js").Font,
  glyphs: Glyph[],
  source: SourceFont | null,
): { kerning: KernPair[]; kernClasses: KernClass[] } {
  const kerning = readKerning(font, glyphs);

  const table = source?.tables.get("GPOS");
  if (!table) return { kerning, kernClasses: [] };

  const gpos = readGposKerning(table);
  const nameOf = (glyph: number): string | undefined => glyphs[glyph]?.name;
  const kernClasses = toKernClasses(gpos, nameOf);

  // The pairs the font wrote out one at a time, which opentype.js may have
  // found already; a set of what is there keeps them from arriving twice.
  const already = new Set(kerning.map((pair) => `${pair.left}\u0000${pair.right}`));
  for (const pair of writtenPairs(gpos)) {
    const left = nameOf(pair.left);
    const right = nameOf(pair.right);
    if (!left || !right) continue;
    const key = `${left}\u0000${right}`;
    if (already.has(key)) continue;
    already.add(key);
    kerning.push({ left, right, value: pair.value, group: pair.group });
  }

  return { kerning, kernClasses };
}

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

/**
 * Read a name-table entry.
 *
 * opentype.js groups names by platform, so the useful values live under
 * `names.windows` and `names.macintosh` rather than on `names` itself. Windows
 * is preferred because it is the record that modern systems read, with the
 * Macintosh record as the fallback for fonts that only carry one.
 */
function readName(font: import("opentype.js").Font, key: string): string {
  const names = font.names as unknown as Record<string, Record<string, Record<string, string>>>;
  if (!names) return "";

  for (const platform of ["windows", "macintosh"]) {
    const entry = names[platform]?.[key];
    if (entry) {
      const value = entry.en ?? Object.values(entry)[0];
      if (value) return value;
    }
  }
  // Older builds put the entries directly on `names`.
  const direct = names[key] as unknown as Record<string, string> | undefined;
  if (direct && typeof direct === "object") {
    const value = direct.en ?? Object.values(direct)[0];
    if (typeof value === "string") return value;
  }
  return "";
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

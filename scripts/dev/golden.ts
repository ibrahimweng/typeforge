/**
 * Whether the bases still draw exactly what they drew: a fingerprint of every
 * glyph of every base in every form, at fifteen pens and widths, three family
 * weights, a wave book replay and a variable export.
 *
 * Not a test, and its baseline is never committed: a committed baseline would
 * freeze every drawing the forge makes, and drawings are meant to change. It is
 * for one question -- "did this change move anything that was already there?"
 * -- asked of a branch against the commit it started from.
 *
 * Generate a baseline from a clean export of the starting commit, outside the
 * repository (this file need not exist at that commit: copy it in):
 *
 *   git -C <repo> archive <commit> | tar -x -C <dir>
 *   ln -s <repo>/node_modules <dir>/node_modules
 *   mkdir -p <dir>/scripts/dev && cp scripts/dev/golden.ts <dir>/scripts/dev/
 *   cd <dir> && OUT=<base.json> npx vite-node scripts/dev/golden.ts
 *
 * Check a working tree against it (from that tree's root):
 *
 *   BASELINE=<base.json> OUT=<after.json> npx vite-node scripts/dev/golden.ts
 *
 * Compare two files already written, without drawing anything:
 *
 *   BASELINE=<base.json> AFTER=<after.json> npx vite-node scripts/dev/golden.ts
 *
 * It prints `GOLDEN DIFF: EMPTY` or `GOLDEN DIFF: NON-EMPTY`, then every key
 * that differs or is missing (`LIMIT` caps how many are listed, 400 by
 * default), then the keys the baseline does not have -- new letters or forms,
 * which are listed and never counted as a difference. It exits 1 on a
 * non-empty diff. `GOLDEN_BASES=Serif,Sans` restricts the run, and the
 * comparison, to those bases. About six minutes for all 21 bases on one core.
 *
 * A key is `base|setting|letter|form`, the form `-` for the default:
 * - `pPPwWWW`: the base with `pen.weight` PP, through `widthedStyle` at WWW
 *   (the `at()` of past-black.test.ts), for PP in 30/87/142/194/260 and WWW in
 *   75/100/125;
 * - `own`, `w100`, `w900`: the base itself, and `weightedStyle` from its own
 *   weight class to 100 and 900;
 * - `book-own`, `book-p30`, `book-p260`: drawn with a wave book recorded at the
 *   base's own pen and read back at 30 and 260, as an exported family is;
 * - `var|<glyph>`, `var|held`, `var|bytes`: the variable export of a 100 to 900
 *   family drawn at 400 (the `merge: false` path in deliver.ts) -- each glyph's
 *   contour, node and line-or-curve signature in every master, the glyphs
 *   `deliver` reports as held, and the file's bytes with its clock stopped.
 *
 * The value is the first 16 hex digits of the sha256 of
 * `JSON.stringify({contours, advance})` at full double precision, never of SVG
 * text, which rounds. Everything runs in one process in a fixed order, and
 * nothing in the drawing reads the clock or a random number, so two runs on
 * the same tree write the same file.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { ready } from "@/font/boolean";
import type { Contour } from "@/font/types";
import { drawLetter, letterNames } from "@/forge/build";
import { deliver } from "@/forge/deliver";
import { startFrom, weighted } from "@/forge/document";
import { weightClassOf, weightedStyle, widthedStyle } from "@/forge/family";
import { readyToShape } from "@/forge/layers";
import { everyFormOf } from "@/forge/letters";
import { openWaveBook, type WaveBook, waveBookAt } from "@/forge/shapes";
import { BASES, type Style } from "@/forge/style";
import { toTypeface } from "@/forge/typeface";

// Fonts are resolved in place, on this one core, unless the caller says otherwise.
process.env.TYPEFORGE_THREADS ??= "0";

const PENS = [30, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
const LIMIT = Number(process.env.LIMIT ?? 400);

type Hashes = Record<string, string>;
interface Golden {
  meta: { written: string; bases: string[]; keys: number; seconds: number };
  hashes: Hashes;
}

const digest = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Per contour: open or closed, how many nodes, and each edge a line or a curve. */
function signature(contours: Contour[]): string {
  return contours
    .map((contour) => {
      const { nodes } = contour;
      const edges = contour.closed ? nodes.length : Math.max(0, nodes.length - 1);
      let kinds = "";
      for (let index = 0; index < edges; index++) {
        const a = nodes[index];
        const b = nodes[(index + 1) % nodes.length];
        kinds += a.handleOut === null && b.handleIn === null ? "l" : "c";
      }
      return `${contour.closed ? "z" : "o"}${nodes.length}:${kinds}`;
    })
    .join(" ");
}

const only = (process.env.GOLDEN_BASES ?? "").split(",").filter(Boolean);
const chosen = (name: string): boolean => only.length === 0 || only.includes(name);

function draw(hashes: Hashes, key: string, name: string, style: Style, form: string): void {
  const drawn = drawLetter(name, style, form || undefined);
  hashes[key] = digest(
    JSON.stringify(drawn ? { contours: drawn.contours, advance: drawn.advanceWidth } : null),
  );
}

async function measure(): Promise<Golden> {
  await ready();
  await readyToShape();
  const started = Date.now();
  const names = letterNames();
  const hashes: Hashes = {};
  const bases = BASES.filter((base) => chosen(base.name));
  for (const base of bases) {
    const at = Date.now();
    const settings: Array<[string, Style]> = [];
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        settings.push([
          `p${pen}w${width}`,
          widthedStyle({ ...base, pen: { ...base.pen, weight: pen } }, width),
        ]);
      }
    }
    const drawnAt = weightClassOf(base);
    settings.push(["own", base]);
    settings.push(["w100", weightedStyle(base, drawnAt, 100)]);
    settings.push(["w900", weightedStyle(base, drawnAt, 900)]);
    for (const [tag, style] of settings) {
      for (const name of names) {
        for (const { id } of everyFormOf(name)) {
          draw(hashes, `${base.name}|${tag}|${name}|${id || "-"}`, name, style, id);
        }
      }
    }

    // A family's book: recorded at the drawn pen, read back at the extremes.
    const thin = widthedStyle({ ...base, pen: { ...base.pen, weight: 30 } }, 100);
    const black = widthedStyle({ ...base, pen: { ...base.pen, weight: 260 } }, 100);
    const book: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const was = openWaveBook(book);
    try {
      for (const name of names) {
        for (const { id } of everyFormOf(name)) {
          book.lengths.clear();
          book.bowls.clear();
          book.balls.clear();
          book.corners.clear();
          const key = (tag: string) => `${base.name}|${tag}|${name}|${id || "-"}`;
          book.recording = true;
          waveBookAt(name);
          draw(hashes, key("book-own"), name, base, id);
          book.recording = false;
          waveBookAt(name);
          draw(hashes, key("book-p30"), name, thin, id);
          waveBookAt(name);
          draw(hashes, key("book-p260"), name, black, id);
        }
      }
    } finally {
      openWaveBook(was);
    }

    // The variable export, as typeface.test.ts asks for it.
    const forge = { ...startFrom(base), family: { drawn: 400, also: [100, 700, 900] } };
    const clock = Date.now;
    Date.now = () => 0;
    try {
      const delivered = await deliver(forge, {
        familyName: "Golden",
        format: "ttf",
        variable: true,
      });
      hashes[`${base.name}|var|held`] = digest(JSON.stringify(delivered.held));
      hashes[`${base.name}|var|bytes`] = createHash("sha256")
        .update(delivered.bytes)
        .digest("hex")
        .slice(0, 16);
    } finally {
      Date.now = clock;
    }
    // Each glyph's structure in every master, drawn the way `varying` draws them.
    const waves: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const masters = [];
    for (const weight of [400, 100, 700, 900]) {
      masters.push(
        await toTypeface(weighted(forge, weight), {
          familyName: "Golden",
          styleName: String(weight),
          weightClass: weight,
          waves,
          merge: false,
          kern: false,
        }),
      );
      waves.recording = false;
    }
    for (const glyph of masters[0].glyphs) {
      const signatures = masters.map((master) => {
        const index = master.glyphIndex.get(glyph.name);
        return index === undefined ? "missing" : signature(master.glyphs[index].contours);
      });
      hashes[`${base.name}|var|${glyph.name}`] = digest(signatures.join(" | "));
    }
    console.log(`${base.name}: ${((Date.now() - at) / 1000).toFixed(1)} s`);
  }
  return {
    meta: {
      written: new Date().toISOString(),
      bases: bases.map((base) => base.name),
      keys: Object.keys(hashes).length,
      seconds: Math.round((Date.now() - started) / 1000),
    },
    hashes,
  };
}

function compare(baseline: Golden, after: Golden): boolean {
  const inScope = (key: string) => chosen(key.slice(0, key.indexOf("|")));
  const differing: string[] = [];
  const missing: string[] = [];
  for (const [key, value] of Object.entries(baseline.hashes)) {
    if (!inScope(key)) continue;
    const now = after.hashes[key];
    if (now === undefined) missing.push(key);
    else if (now !== value) differing.push(key);
  }
  const added = Object.keys(after.hashes).filter(
    (key) => inScope(key) && baseline.hashes[key] === undefined,
  );
  const compared = Object.keys(baseline.hashes).filter(inScope).length;
  const empty = differing.length === 0 && missing.length === 0;
  console.log(`\nGOLDEN DIFF: ${empty ? "EMPTY" : "NON-EMPTY"}`);
  console.log(
    `${compared} baseline keys compared${only.length ? ` (bases: ${only.join(", ")})` : ""}: ` +
      `${differing.length} differ, ${missing.length} missing; ${added.length} new keys.`,
  );
  const list = (title: string, keys: string[]) => {
    if (keys.length === 0) return;
    console.log(`\n${title} (${keys.length}):`);
    for (const key of keys.slice(0, LIMIT)) console.log(`  ${key}`);
    if (keys.length > LIMIT) console.log(`  ... and ${keys.length - LIMIT} more`);
  };
  list("Differing keys", differing);
  list("Missing keys (in the baseline, not drawn now)", missing);
  list("New keys (not in the baseline; not a difference)", added);
  return empty;
}

const read = (path: string): Golden => JSON.parse(readFileSync(path, "utf8")) as Golden;

if (process.env.AFTER) {
  if (!process.env.BASELINE) throw new Error("AFTER needs a BASELINE to compare against");
  process.exitCode = compare(read(process.env.BASELINE), read(process.env.AFTER)) ? 0 : 1;
} else {
  const golden = await measure();
  const out = process.env.OUT ?? "golden.json";
  writeFileSync(out, JSON.stringify(golden));
  console.log(`${golden.meta.keys} keys in ${golden.meta.seconds} s, written to ${out}`);
  if (process.env.BASELINE) {
    process.exitCode = compare(read(process.env.BASELINE), golden) ? 0 : 1;
  }
}

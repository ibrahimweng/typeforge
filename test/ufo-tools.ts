/**
 * Reading a UFO with somebody else's implementation, to check ours.
 *
 * The same argument as `fonttools.ts` next door: a round trip through code we
 * wrote proves the two halves agree with each other and nothing more. What
 * decides whether a folder written here is a UFO is whether the tools every
 * other part of this ecosystem is built on can read it, so this asks one.
 *
 * `fontTools.ufoLib` ships inside fontTools rather than beside it, so this
 * needs nothing installed that the export tests do not already need.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import type { UfoFiles } from "../src/ufo/font";

/** Whether the UFO half of fontTools can be reached. */
export function hasUfoLib(): boolean {
  return spawnSync("python3", ["-c", "import fontTools.ufoLib"], { encoding: "utf8" }).status === 0;
}

/** Every file under a directory, keyed by its path inside it. */
export function loadUfoDirectory(root: string): UfoFiles {
  const files: UfoFiles = new Map();
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      // Always forward slashes, whatever the platform: these are paths inside
      // a UFO, which the format specifies, rather than paths on a disk.
      files.set(relative(root, path).split(sep).join("/"), readFileSync(path, "utf8"));
    }
  };
  walk(root);
  return files;
}

/** A set of files, written out as a folder somewhere temporary. */
export function writeUfoDirectory(files: UfoFiles): string {
  const root = mkdtempSync(join(tmpdir(), "typeforge-ufo-"));
  for (const [path, source] of files) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf8");
  }
  return root;
}

/** What another implementation says is in a UFO. */
export interface UfoReport {
  familyName: string;
  styleName: string;
  unitsPerEm: number;
  ascender: number | null;
  descender: number | null;
  capHeight: number | null;
  xHeight: number | null;
  copyright: string | null;
  glyphOrder: string[];
  /** Glyph name to its advance width and how many points its outline has. */
  glyphs: Record<string, { width: number; points: number; components: string[] }>;
  groups: Record<string, string[]>;
  kerning: Array<[string, string, number]>;
}

const REPORT = `
import json, sys
from fontTools.ufoLib import UFOReader
from fontTools.pens.recordingPen import RecordingPointPen

reader = UFOReader(sys.argv[1])
info = type("I", (), {})()
reader.readInfo(info)
glyphSet = reader.getGlyphSet()

glyphs = {}
for name in glyphSet.keys():
    class G:
        def __init__(self): self.width = 0; self.points = 0; self.components = []
    g = G()
    pen = RecordingPointPen()
    glyphSet.readGlyph(name, g, pen)
    points = 0
    components = []
    for op, args, kwargs in pen.value:
        if op == "addPoint": points += 1
        if op == "addComponent": components.append(args[0])
    glyphs[name] = {"width": getattr(g, "width", 0), "points": points, "components": components}

lib = reader.readLib()
print(json.dumps({
    "familyName": getattr(info, "familyName", None),
    "styleName": getattr(info, "styleName", None),
    "unitsPerEm": getattr(info, "unitsPerEm", None),
    "ascender": getattr(info, "ascender", None),
    "descender": getattr(info, "descender", None),
    "capHeight": getattr(info, "capHeight", None),
    "xHeight": getattr(info, "xHeight", None),
    "copyright": getattr(info, "copyright", None),
    "glyphOrder": lib.get("public.glyphOrder", []),
    "glyphs": glyphs,
    "groups": reader.readGroups(),
    "kerning": [[a, b, v] for (a, b), v in reader.readKerning().items()],
}))
`;

/**
 * What fontTools makes of a folder.
 *
 * Throws rather than returning null on a folder it will not read, because that
 * is the interesting outcome: a UFO this application wrote that the reference
 * implementation rejects is the fault these tests exist to catch, and its own
 * message about why is better than anything this could say instead.
 */
export function inspectUfo(root: string): UfoReport {
  const result = spawnSync("python3", ["-c", REPORT, root], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`fontTools would not read the UFO:\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as UfoReport;
}

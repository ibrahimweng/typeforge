/**
 * Checks a font against the things that quietly break it.
 *
 * Most font faults are invisible on the machine that made them and only show up
 * on someone else's screen, in a print shop, or in a language the designer does
 * not read. This is the same idea as FontBakery, the checker the type industry
 * runs before shipping, reduced to what can be judged from the document model
 * and reported while the work is still open.
 *
 * Every finding names a glyph where it can, so the report can be a way into the
 * problem rather than only a list of them.
 */

import { unreachableGlyphs } from "./features";
import { contourArea, contoursBounds, distance } from "./geometry";
import {
  contoursIntersect,
  directionIsCorrect,
  dominantConvention,
  missingExtrema,
  type OutlineFormat,
} from "./outline";
import { opticalAdvice } from "./optical";
import { resolveGlyphContours } from "./transform";
import type { Contour, Typeface } from "./types";

/*
 * Four kinds of thing a report can say, and the fourth is not like the others.
 *
 * `error`, `warning` and `info` are all about whether the font *works*: what
 * will break, what might, and what is worth knowing. `advice` is about whether
 * it *looks right*, which is a different question and has to be able to be
 * ignored -- every optical rule can be deliberately unfollowed, and a checker
 * that called those mistakes would teach people to stop reading it.
 *
 * Ranked above `info` because advice names a letter and a measurement you
 * might act on, where a note is a fact you already know.
 */
export type Severity = "error" | "warning" | "advice" | "info";

export interface Finding {
  /** Stable identifier for the check, so findings can be grouped and dismissed. */
  check: string;
  severity: Severity;
  /** One line, in the designer's terms. */
  title: string;
  /** What is wrong and what it will cost. */
  detail: string;
  /** The glyph to open, when the finding is about one. */
  glyph?: string;
  /** How many glyphs share this finding, when it has been rolled up. */
  count?: number;
}

export interface ValidateOptions {
  /** Which winding convention to judge contour direction against. */
  format?: OutlineFormat;
  /**
   * Cap on how many glyphs are examined.
   *
   * Defaulted to the whole font. It was five thousand, which kept the tab from
   * freezing by the simple method of not checking a fifth of a large one --
   * `validateWholeTypeface` below does that properly, and this is left for the
   * callers that want an answer in one go and know how big their font is.
   */
  limit?: number;
}

export interface ValidationReport {
  findings: Finding[];
  errors: number;
  warnings: number;
  /** Glyphs actually examined, which may be fewer than the font holds. */
  examined: number;
  /**
   * How many the font holds, so the two can be compared.
   *
   * `examined` on its own reads as a fact about the font rather than a limit on
   * the check: "5,000 glyphs checked" beside "0 errors" is a clean bill of
   * health for a font of five thousand and a quarter of one for a font of six
   * and a quarter thousand, and nothing on screen said which it was.
   */
  held: number;
}

export function validateTypeface(
  typeface: Typeface,
  options: ValidateOptions = {},
): ValidationReport {
  /*
   * Which way round this font winds, measured rather than assumed.
   *
   * This said `truetype` and nothing else, which was right while a font could
   * only arrive from a `.ttf`. A UFO winds the other way -- PostScript
   * convention is what the format specifies and what every tool that writes
   * one produces -- so opening a perfectly good UFO reported every round
   * letter in it as wound the wrong way. A check that is wrong about correct
   * work is worse than no check, because the one thing it teaches is to stop
   * reading it.
   */
  const format = options.format ?? dominantConvention(typeface.glyphs);
  const limit = options.limit ?? typeface.glyphs.length;
  const glyphs = typeface.glyphs.slice(0, limit);
  const faults = noFaults();
  gatherGlyphFaults(typeface, glyphs, format, faults);
  return assemble(typeface, glyphs.length, faults, format);
}

/**
 * The same check, done a piece at a time so the tab stays usable.
 *
 * Checking a font is two seconds of arithmetic on six thousand glyphs and more
 * on a bigger one, and it was all spent in one go on the thread that draws the
 * page. What stopped that from freezing the tab was a cap of five thousand --
 * which is not a fix, it is a decision to check four fifths of somebody's font
 * and print "0 errors" underneath. Broken into batches with a breath between
 * them the whole font gets looked at, nothing blocks for longer than a batch,
 * and there is something to show while it runs.
 *
 * `breathe` is a parameter so a test can drive this to completion without
 * waiting on real timers.
 */
export async function validateWholeTypeface(
  typeface: Typeface,
  options: ValidateOptions = {},
  onProgress?: (progress: CheckProgress) => void,
  breathe: () => Promise<unknown> = takeABreath,
): Promise<ValidationReport> {
  const format = options.format ?? dominantConvention(typeface.glyphs);
  const glyphs = typeface.glyphs;
  const faults = noFaults();
  for (let from = 0; from < glyphs.length; from += BATCH) {
    onProgress?.({ done: from, total: glyphs.length });
    gatherGlyphFaults(typeface, glyphs.slice(from, from + BATCH), format, faults);
    // Between batches and not after the last, so a font that fits in one batch
    // costs no wait at all.
    if (from + BATCH < glyphs.length) await breathe();
  }
  onProgress?.({ done: glyphs.length, total: glyphs.length });
  return assemble(typeface, glyphs.length, faults, format);
}

/*
 * How many glyphs are looked at between one breath and the next.
 *
 * Twenty-five, because the work turns out not to care. Over a six thousand
 * glyph font the arithmetic totals about two and a half seconds at every batch
 * size tried -- 2538ms at twenty-five, 2489ms at two hundred and fifty -- while
 * the longest unbroken stretch, which is what a person actually feels, runs
 * from 106ms to 410ms across the same range. So the small batch is free.
 *
 * Two hundred and fifty was the first guess and the comment here claimed it
 * cost eighty milliseconds a batch. It cost four hundred and ten: glyphs are
 * nothing like equal, and a batch holding one accented capital with a hundred
 * nodes costs more than a batch of twenty-five plain ones. The hundred
 * milliseconds left at twenty-five is one such glyph, and getting under it
 * would mean breaking up the middle of a glyph rather than the run of them.
 */
const BATCH = 25;

/**
 * Let the page have the thread back, without paying the timer's toll.
 *
 * `setTimeout(0)` is not nought: a browser clamps a timer nested more than a
 * few deep to four milliseconds, and this nests once per batch. Two hundred
 * and fifty batches of a six thousand glyph font would spend a second of
 * wall-clock waiting for permission to continue -- more than a third of the
 * check, all of it idle. A message posted to oneself is the same yield to the
 * event loop with no floor under it, which is what makes a small batch free.
 *
 * The timer is kept for anywhere without `MessageChannel`, which is every
 * test runner that stubs the DOM away.
 */
let breaths: MessageChannel | null = null;
const waking: Array<() => void> = [];

function takeABreath(): Promise<void> {
  if (typeof MessageChannel !== "function") {
    return new Promise((wake) => setTimeout(wake, 0));
  }
  /*
   * One channel for the life of the page, not one per breath.
   *
   * A channel is two ports and a message queue, and this is called once per
   * batch -- two hundred and fifty times for a six thousand glyph font, every
   * time the check runs. Building and closing that many is work the check does
   * not need to do, and it holds two ports per breath until the collector gets
   * to them, which is the sort of thing that is free on an idle machine and
   * not on a busy one.
   */
  if (!breaths) {
    breaths = new MessageChannel();
    breaths.port1.onmessage = () => waking.shift()?.();
  }
  return new Promise((wake) => {
    waking.push(wake);
    breaths!.port2.postMessage(null);
  });
}

/** How far through the glyphs a check has got. */
export interface CheckProgress {
  done: number;
  total: number;
}

/** Everything that is not the walk: the cheap checks, and the wording. */
function assemble(
  typeface: Typeface,
  examined: number,
  faults: GlyphFaults,
  _format: OutlineFormat,
): ValidationReport {
  const glyphs = typeface.glyphs.slice(0, examined);
  const findings: Finding[] = [];

  findings.push(...checkFontStructure(typeface));
  findings.push(...checkVerticalMetrics(typeface, glyphs.length > 0 ? glyphs : typeface.glyphs));
  findings.push(...wordGlyphFaults(faults));
  /*
   * The optical advice, last and separately.
   *
   * It measures a couple of dozen named letters rather than walking the font,
   * so it costs the same on a font of six thousand glyphs as on one of forty
   * and does not take the `limit` the rest of this respects.
   */
  findings.push(...opticalAdvice(typeface));

  const order: Record<Severity, number> = { error: 0, warning: 1, advice: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.check.localeCompare(b.check));

  return {
    findings,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    examined,
    held: typeface.glyphs.length,
  };
}

// ---------------------------------------------------------------------------
// Font-level
// ---------------------------------------------------------------------------

function checkFontStructure(typeface: Typeface): Finding[] {
  const findings: Finding[] = [];

  /*
   * Somebody else's font with your drawing in it.
   *
   * Asked of the document rather than of the name alone, because a font
   * nobody has touched is a font being looked at and there is nothing to say
   * about it. Once a letter has been edited and the name is still the one the
   * file arrived with, the file that goes out describes the font it was
   * opened from: its family, its designer, its copyright, its licence. That
   * is a derivative work that does not say it is one, and it is the first
   * thing every type licence asks of you.
   *
   * A warning rather than an error, because it is about what the file claims
   * rather than whether it works, and because there are honest reasons to
   * export an edited font under its own name -- fixing a glyph in a font you
   * drew yourself, for one.
   */
  if (typeface.source !== null && typeface.glyphs.some((glyph) => glyph.dirty)) {
    findings.push({
      check: "derivative-unnamed",
      severity: "warning",
      title: `Letters have been changed, and the font is still called ${typeface.meta.familyName}`,
      detail:
        "An exported file would carry the family name, designer, copyright and licence of the font this was opened from. Press the name in the toolbar to give the work its own.",
    });
  }

  /*
   * The letters a reader can never arrive at.
   *
   * A glyph is shown because a character maps to it, because a rule
   * substitutes it in, or because another letter is built out of it. A glyph
   * that is none of those is in the file, adds to its size, and cannot appear
   * on any screen or page -- which is exactly what drawing `f_i` and stopping
   * leaves you with, and nothing anywhere said so.
   *
   * Advice rather than a warning. It is not wrong: a face under construction is
   * full of drawings that have not been wired up yet, and saying "error" about
   * work in progress teaches people to stop reading the report. It says what is
   * missing and where to go and do it.
   */
  const unreachable = unreachableGlyphs(typeface);
  if (unreachable.length > 0) {
    const listed = unreachable.slice(0, 8).join(", ");
    findings.push({
      check: "unreachable-glyphs",
      severity: "advice",
      title:
        unreachable.length === 1
          ? `${unreachable[0]} is drawn but nothing can reach it`
          : `${unreachable.length} letters are drawn but nothing can reach them`,
      detail:
        `${listed}${unreachable.length > 8 ? `, and ${unreachable.length - 8} more` : ""}. ` +
        "No character maps to these and no feature substitutes them in, so they take up room in the " +
        "file and can never be shown. Give one a character in the letter panel, or make it a " +
        "ligature or a stylistic set in the features panel.",
      glyph: unreachable[0],
    });
  }

  const notdefIndex = typeface.glyphs.findIndex((glyph) => glyph.name === ".notdef");
  if (notdefIndex === -1) {
    findings.push({
      check: "notdef-missing",
      severity: "error",
      title: "No .notdef glyph",
      detail:
        "Every font needs a .notdef glyph. It is what gets drawn for a character the font does not cover, and its absence is a validity error.",
    });
  } else if (notdefIndex !== 0) {
    findings.push({
      check: "notdef-position",
      severity: "error",
      title: ".notdef is not the first glyph",
      detail: `.notdef must be glyph 0. It is currently at ${notdefIndex}, which some tools will reject outright.`,
      glyph: ".notdef",
    });
  }

  if (!typeface.meta.familyName.trim()) {
    findings.push({
      check: "family-name",
      severity: "error",
      title: "No family name",
      detail: "The font has no family name, so it cannot be installed or chosen in a menu.",
    });
  }

  // 1000 suits PostScript curves, 2048 suits TrueType. Powers of two matter for
  // TrueType because hinting divides the em.
  const em = typeface.unitsPerEm;
  if (em < 16 || em > 16384) {
    findings.push({
      check: "units-per-em",
      severity: "error",
      title: `Units per em is ${em}`,
      detail: "The value has to sit between 16 and 16384. Anything else is out of spec.",
    });
  }

  // Two glyphs claiming the same codepoint: only one of them will ever be used.
  const seen = new Map<number, string>();
  const clashes: string[] = [];
  for (const glyph of typeface.glyphs) {
    for (const codepoint of glyph.unicodes) {
      const owner = seen.get(codepoint);
      if (owner) clashes.push(`U+${codepoint.toString(16).toUpperCase().padStart(4, "0")} (${owner} and ${glyph.name})`);
      else seen.set(codepoint, glyph.name);
    }
  }
  if (clashes.length > 0) {
    findings.push({
      check: "duplicate-codepoints",
      severity: "error",
      title: `${clashes.length} codepoint${clashes.length === 1 ? "" : "s"} mapped twice`,
      detail: `Only one glyph can answer to a codepoint; the rest are unreachable. ${clashes.slice(0, 3).join(", ")}${clashes.length > 3 ? ", and more" : ""}.`,
      count: clashes.length,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Vertical metrics
// ---------------------------------------------------------------------------

function checkVerticalMetrics(typeface: Typeface, glyphs: Typeface["glyphs"]): Finding[] {
  const findings: Finding[] = [];
  const { ascender, descender, capHeight, xHeight, lineGap } = typeface.metrics;

  if (descender > 0) {
    findings.push({
      check: "descender-sign",
      severity: "error",
      title: "Descender is positive",
      detail: "The descender sits below the baseline, so it is written as a negative number.",
    });
  }
  if (ascender <= 0) {
    findings.push({
      check: "ascender-sign",
      severity: "error",
      title: "Ascender is not positive",
      detail: "The ascender sits above the baseline and must be greater than zero.",
    });
  }
  if (xHeight > capHeight && capHeight > 0) {
    findings.push({
      check: "x-height-above-cap",
      severity: "warning",
      title: "x-height is taller than the cap height",
      detail:
        "Lowercase would stand taller than capitals. Possible in an unusual design, but usually a mistake in the numbers.",
    });
  }
  if (lineGap !== 0) {
    findings.push({
      check: "line-gap",
      severity: "warning",
      title: `Line gap is ${lineGap}`,
      detail:
        "Line gap is read inconsistently across platforms. The usual advice is to keep it at zero and build any extra leading into the ascender and descender instead.",
    });
  }

  // The tallest thing drawn, against the space the metrics claim for it.
  let yMax = -Infinity;
  let yMin = Infinity;
  let tallest = "";
  let deepest = "";
  for (const glyph of glyphs) {
    if (glyph.contours.length === 0) continue;
    const bounds = contoursBounds(resolveGlyphContours(glyph, typeface));
    if (bounds.yMax > yMax) {
      yMax = bounds.yMax;
      tallest = glyph.name;
    }
    if (bounds.yMin < yMin) {
      yMin = bounds.yMin;
      deepest = glyph.name;
    }
  }

  if (Number.isFinite(yMax) && yMax > ascender) {
    findings.push({
      check: "outline-above-ascender",
      severity: "info",
      title: `${tallest} reaches above the ascender`,
      detail: `It rises to ${Math.round(yMax)} against an ascender of ${ascender}. That is normal for accented capitals, and export widens the Windows clipping boundary to match so nothing is cut off.`,
      glyph: tallest,
    });
  }
  if (Number.isFinite(yMin) && yMin < descender) {
    findings.push({
      check: "outline-below-descender",
      severity: "info",
      title: `${deepest} reaches below the descender`,
      detail: `It drops to ${Math.round(yMin)} against a descender of ${descender}.`,
      glyph: deepest,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Per glyph
// ---------------------------------------------------------------------------

/**
 * What a walk over the glyphs collects, before any of it is worded.
 *
 * Kept apart from the wording because the walk is the slow half and the
 * wording is not: over six thousand glyphs the walk is two seconds and the
 * roll-up is nothing, so the walk is what has to be done a piece at a time
 * while the tab stays usable, and the roll-up is what happens once at the end.
 * Rolled up per batch instead, a font would report the same fault five times
 * over with a fifth of its glyphs named in each.
 */
export interface GlyphFaults {
  openContours: string[];
  strayPoints: string[];
  duplicatePoints: string[];
  wrongDirection: string[];
  missingPoints: string[];
  negativeWidth: string[];
  selfIntersecting: string[];
}

export const noFaults = (): GlyphFaults => ({
  openContours: [],
  strayPoints: [],
  duplicatePoints: [],
  wrongDirection: [],
  missingPoints: [],
  negativeWidth: [],
  selfIntersecting: [],
});

/** Look at these glyphs and add what is wrong with them to the pile. */
export function gatherGlyphFaults(
  typeface: Typeface,
  glyphs: Typeface["glyphs"],
  format: OutlineFormat,
  into: GlyphFaults,
): void {
  const {
    openContours,
    strayPoints,
    duplicatePoints,
    wrongDirection,
    missingPoints,
    negativeWidth,
    selfIntersecting,
  } = into;

  for (const glyph of glyphs) {
    const contours = resolveGlyphContours(glyph, typeface);

    for (const contour of contours) {
      if (!contour.closed && contour.nodes.length > 1) {
        openContours.push(glyph.name);
        break;
      }
    }
    // Enclosing no area is the real test. A two-node contour with handles is
    // a perfectly good ellipse, so counting nodes would flag sound drawings.
    if (contours.some((contour) => contour.nodes.length > 0 && Math.abs(contourArea(contour)) < 1)) {
      strayPoints.push(glyph.name);
    }
    if (contours.some(hasDuplicatePoints)) duplicatePoints.push(glyph.name);
    if (contours.length > 0 && !directionIsCorrect(contours, format)) {
      wrongDirection.push(glyph.name);
    }
    if (contours.some((contour) => missingExtrema(contour) > 0)) missingPoints.push(glyph.name);
    // The stored value, not the resolved one: export clamps negatives to zero,
    // so asking the resolved width would never report the problem.
    if (glyph.advanceWidth < 0) negativeWidth.push(glyph.name);
    if (contours.length > 0 && contoursIntersect(contours)) selfIntersecting.push(glyph.name);
  }
}

/** The pile, worded. */
export function wordGlyphFaults(faults: GlyphFaults): Finding[] {
  const findings: Finding[] = [];
  const {
    openContours,
    strayPoints,
    duplicatePoints,
    wrongDirection,
    missingPoints,
    negativeWidth,
    selfIntersecting,
  } = faults;

  const rollUp = (
    names: string[],
    check: string,
    severity: Severity,
    title: (n: number) => string,
    detail: string,
  ): void => {
    if (names.length === 0) return;
    findings.push({
      check,
      severity,
      title: title(names.length),
      detail: `${detail} First: ${names.slice(0, 5).join(", ")}${names.length > 5 ? `, and ${names.length - 5} more` : ""}.`,
      glyph: names[0],
      count: names.length,
    });
  };

  rollUp(
    negativeWidth,
    "negative-advance",
    "error",
    (n) => `${n} glyph${n === 1 ? " has" : "s have"} a negative advance width`,
    "Text would run backwards over itself.",
  );
  rollUp(
    openContours,
    "open-contour",
    "error",
    (n) => `${n} glyph${n === 1 ? " has" : "s have"} an unclosed contour`,
    "An outline has to close for the fill to be defined. Open paths render unpredictably.",
  );
  rollUp(
    strayPoints,
    "stray-points",
    "warning",
    (n) => `${n} glyph${n === 1 ? " has" : "s have"} a contour that draws nothing`,
    "A stray point or a collapsed path encloses no area. It adds weight to the file and some checkers reject it.",
  );
  rollUp(
    duplicatePoints,
    "duplicate-points",
    "warning",
    (n) => `${n} glyph${n === 1 ? " has" : "s have"} points on top of each other`,
    "Two points in the same place add nothing and can confuse hinting and interpolation.",
  );
  rollUp(
    wrongDirection,
    "contour-direction",
    "warning",
    (n) => `${n} glyph${n === 1 ? " is" : "s are"} wound the wrong way`,
    "Counters must run against the shape enclosing them or they fill in solid. Export corrects this, so this is about what you are drawing rather than what ships.",
  );
  rollUp(
    missingPoints,
    "missing-extrema",
    "warning",
    (n) => `${n} glyph${n === 1 ? " has" : "s have"} a curve turning between points`,
    "Both outline formats want a point where a curve reaches its highest, lowest, leftmost or rightmost position. Export adds them, so this is about the drawing rather than the file.",
  );
  rollUp(
    selfIntersecting,
    "overlapping-contours",
    "info",
    (n) => `${n} glyph${n === 1 ? " has" : "s have"} overlapping contours`,
    "Overlaps are a normal way to draw, but they have to be merged in the exported file or they can render as holes. Typeforge does not merge them yet.",
  );

  return findings;
}

function hasDuplicatePoints(contour: Contour): boolean {
  const { nodes } = contour;
  // A lone node would compare against itself through the wrap and always match.
  // A contour that small is reported as drawing nothing instead.
  if (nodes.length < 2) return false;
  for (let i = 0; i < nodes.length; i++) {
    const next = nodes[(i + 1) % nodes.length];
    if (distance(nodes[i].point, next.point) < 1e-6) return true;
  }
  return false;
}


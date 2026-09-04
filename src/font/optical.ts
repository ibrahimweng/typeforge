/**
 * What the eye sees against what the numbers say.
 *
 * Everything in `validate.ts` next door is about whether a font *works*: an
 * open contour, a backwards advance, a glyph the format cannot express. These
 * are about whether it *looks right*, which is a different kind of question and
 * has to be asked differently.
 *
 * The rules are the old ones, and they exist because the eye is not a ruler. A
 * circle drawn to exactly the height of a square looks smaller than the square.
 * A horizontal stroke drawn to the same thickness as a vertical one looks
 * heavier. A diagonal measured across its own width reads thinner than an
 * upright of the same measure. Type has compensated for all three since punches
 * were cut by hand, and a face that does not is a face that will read as
 * slightly wrong to everyone and obviously wrong to nobody.
 *
 * So: advice, and never anything stronger. Every one of these can be
 * deliberately unfollowed -- a strict geometric face may want no overshoot at
 * all, a modular one may want every stroke identical -- and a checker that
 * called those mistakes would be teaching people to stop reading it. Each
 * finding says what was measured and what the tradition expects, and stops
 * there. None of them offers to change anything.
 *
 * What is not here is anything that needs a rendering. These are measured off
 * the outlines with a ruler laid across them, which is what makes them cheap
 * enough to run with the rest of the checks.
 */

import { contoursBounds, inkRunsAt } from "./geometry";
import { resolveGlyphContours } from "./transform";
import type { Contour, Typeface } from "./types";
// Type-only, so there is no cycle at run time: `validate.ts` imports the
// function below, and this imports nothing from it but the shape of a finding.
import type { Finding } from "./validate";

/*
 * The four numbers these rest on.
 *
 * `NO_OVERSHOOT` is how little counts as none. Overshoot is conventionally
 * one to three per cent of the height it overshoots; a third of one per cent
 * is below what any of it is for, and is what a letter drawn flat to the line
 * measures once its curve has been through a rounding.
 *
 * `SPREAD` is how far two things that should agree may differ before it is
 * worth saying: two per cent of the measure. Under that is inside the drawing
 * of the letter -- an `o` and an `e` do not have identical curves and their
 * overshoots will not be identical either.
 *
 * `STEM_SPREAD` is the same idea for stems, and is tighter at one and a half
 * per cent, because a stem is a straight line whose width is a decision rather
 * than a consequence. Two stems that differ are two decisions, and in a face
 * where they were meant to match one of them is a slip.
 *
 * `SAMPLES` is how many rulers are laid across a band. Enough that a single
 * bad one cannot carry the median, few enough to run over a whole alphabet
 * without anybody waiting.
 */
const NO_OVERSHOOT = 0.003;
const SPREAD = 0.02;
const STEM_SPREAD = 0.015;
const SAMPLES = 9;

/** Ink runs along a horizontal ruler, left to right. */
const runsAt = (contours: Contour[], y: number): Array<[number, number]> =>
  inkRunsAt(contours, y, "y");

const median = (values: number[]): number => {
  const sorted = [...values].sort((one, other) => one - other);
  return sorted[Math.floor(sorted.length / 2)];
};

/** A band of absolute heights, as fractions of a letter's own extent. */
function bandOf(contours: Contour[], from: number, to: number): [number, number] {
  const box = contoursBounds(contours);
  const span = box.yMax - box.yMin;
  return [box.yMin + span * from, box.yMin + span * to];
}

/**
 * The width of the leftmost upright stroke, measured over a band.
 *
 * The *narrowest* of the samples, not the median, and that is what makes this
 * work on a serif face. A stem is the thinnest the leftmost run ever gets:
 * a serif flares it, a shoulder joins it, a crossbar runs the whole letter
 * into one run -- every one of those makes the measurement wider and none of
 * them makes it narrower. Taking the median meant the bands had to be picked
 * to dodge all three, which worked on the sans it was written against and
 * reported a serif `H`'s foot serif as a stem two hundred units wide.
 *
 * The band is a fraction of the letter's own height rather than of a declared
 * metric, for the same reason: a font that does not declare its cap height
 * put the ruler through the wrong part of the letter.
 */
function stemWidth(contours: Contour[], from: number, to: number): number | null {
  const [low, high] = bandOf(contours, from, to);
  let narrowest = Infinity;
  let seen = 0;
  for (let step = 0; step < SAMPLES; step++) {
    const y = low + ((high - low) * step) / (SAMPLES - 1);
    const runs = runsAt(contours, y);
    if (runs.length === 0) continue;
    seen += 1;
    narrowest = Math.min(narrowest, runs[0][1] - runs[0][0]);
  }
  return seen >= SAMPLES / 2 && Number.isFinite(narrowest) ? narrowest : null;
}

/**
 * How far right the ink reaches anywhere in a band.
 *
 * For arms, which is the only thing in an `E` that reaches right. Taking the
 * furthest over a band rather than measuring at one height means the arm is
 * found wherever it happens to sit, which is the difference between a check
 * that works on one face and a check that works.
 */
function reachInBand(contours: Contour[], from: number, to: number): number | null {
  const [low, high] = bandOf(contours, from, to);
  let furthest = -Infinity;
  for (let step = 0; step < SAMPLES; step++) {
    const y = low + ((high - low) * step) / (SAMPLES - 1);
    for (const run of runsAt(contours, y)) furthest = Math.max(furthest, run[1]);
  }
  return Number.isFinite(furthest) ? furthest : null;
}

/** One piece of advice, in the shape the report already understands. */
function advise(check: string, title: string, detail: string, glyph?: string): Finding {
  return { check, severity: "advice", title, detail, glyph };
}

/**
 * Everything the eye would ask for, measured.
 *
 * Exported as one pass rather than seven so the outlines are resolved once.
 * Every check silently stands down when the letters it needs are not in the
 * font, which is most of them on a font of forty glyphs.
 */
export function opticalAdvice(typeface: Typeface): Finding[] {
  const findings: Finding[] = [];
  const { xHeight, capHeight } = typeface.metrics;
  const em = typeface.unitsPerEm || 1000;

  const shapes = new Map<string, Contour[]>();
  for (const glyph of typeface.glyphs) {
    const resolved = resolveGlyphContours(glyph, typeface);
    if (resolved.length > 0) shapes.set(glyph.name, resolved);
  }
  const has = (name: string): Contour[] | null => shapes.get(name) ?? null;

  findings.push(...overshoots(has, xHeight, capHeight));
  findings.push(...stems(has, monospaced(typeface)));
  findings.push(...flatHeights(has, xHeight, capHeight));
  findings.push(...arms(has));
  findings.push(...theDot(has, xHeight, em));

  return findings;
}

type Lookup = (name: string) => Contour[] | null;

/**
 * Whether every letter in the font is the same width.
 *
 * Measured rather than read off a flag, because `isFixedPitch` in the `post`
 * table is set by the tool that wrote the file and is missing or wrong often
 * enough to be worth not trusting. Nine tenths rather than all of them: a
 * monospaced face may still carry a handful of wide glyphs it does not claim
 * to space.
 */
function monospaced(typeface: Typeface): boolean {
  const widths = typeface.glyphs
    .filter((glyph) => glyph.contours.length > 0 && glyph.advanceWidth > 0)
    .map((glyph) => glyph.advanceWidth);
  if (widths.length < 10) return false;
  const counts = new Map<number, number>();
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1);
  const commonest = Math.max(...counts.values());
  return commonest / widths.length >= 0.9;
}

/* The round and pointed letters, and the flat line each is measured against. */
const ROUND_LOWER = ["o", "e", "c", "s", "a"];
const ROUND_UPPER = ["O", "C", "G", "S", "Q"];
/*
 * Only letters whose highest point *is* the x-height, which is fewer than the
 * letters that sit on it.
 *
 * This list was written from memory and corrected three times by real fonts.
 * `i` went first: the top of an `i`'s box is its dot, a hundred and sixty
 * units above the line, so every correctly drawn font was reported as having
 * drifted. Then `r`, whose terminal is taken past the line on purpose in most
 * faces. Then `n` and `m`, which was the one worth learning from -- the flat
 * top of an `n` is the top of its *stem*, and the shoulder beside it is a
 * curve, so it overshoots exactly as an `o` does. Their boxes are twenty-seven
 * units above the x-height in DejaVu, and that is the letter drawn right.
 *
 * What is left is the letters that are flat all the way across the top.
 */
const FLAT_LOWER = ["x", "z", "u", "v", "w"];
const FLAT_UPPER = ["H", "E", "F", "I", "L", "T", "Z"];

/**
 * The round letters against the flat ones.
 *
 * A circle drawn to exactly the height of a square looks smaller than the
 * square, so round letters are drawn a little past the line and pointed ones
 * further still. This asks two things of that: whether it was done at all, and
 * whether it was done consistently -- because an `o` that overshoots by eight
 * units beside a `c` that overshoots by two is not a decision, it is two
 * letters drawn on different days.
 */
function overshoots(has: Lookup, xHeight: number, capHeight: number): Finding[] {
  const findings: Finding[] = [];

  const measure = (names: string[], height: number, label: string, kind: string): void => {
    if (height <= 0) return;
    const found: Array<{ name: string; over: number }> = [];
    for (const name of names) {
      const contours = has(name);
      if (!contours) continue;
      found.push({ name, over: contoursBounds(contours).yMax - height });
    }
    if (found.length === 0) return;

    const flat = found.filter((one) => one.over <= height * NO_OVERSHOOT);
    if (flat.length === found.length) {
      findings.push(
        advise(
          `overshoot-missing-${kind}`,
          `The round ${label} sit flat on the line`,
          `${found.map((one) => one.name).join(", ")} reach the ${label} exactly rather than a little past it. A curve drawn to the same height as a flat stroke reads shorter than it, which is why round letters are conventionally taken one to three per cent past the line — ${Math.round(height * 0.01)} to ${Math.round(height * 0.03)} units here. A face drawn to a strict geometric grid may want none of it, in which case this is the right answer and not a fault.`,
          found[0].name,
        ),
      );
      return;
    }

    const overs = found.filter((one) => one.over > height * NO_OVERSHOOT);
    if (overs.length < 2) return;
    const most = overs.reduce((a, b) => (a.over > b.over ? a : b));
    const least = overs.reduce((a, b) => (a.over < b.over ? a : b));
    if (most.over - least.over <= height * SPREAD) return;
    findings.push(
      advise(
        `overshoot-uneven-${kind}`,
        `The round ${label} overshoot by different amounts`,
        `${most.name} goes ${Math.round(most.over)} units past the ${label} and ${least.name} goes ${Math.round(least.over)}. Letters that sit on the same line are usually taken past it by the same amount, so they read as one height rather than several.`,
        most.name,
      ),
    );
  };

  measure(ROUND_LOWER, xHeight, "x-height", "lower");
  measure(ROUND_UPPER, capHeight, "cap height", "upper");
  return findings;
}

/**
 * The upright stems, against each other.
 *
 * In most faces every lowercase stem is the same width and every capital stem
 * is the same width, and the two are close but not identical -- a capital
 * carries a little more weight because it is taller. So they are asked
 * separately, and neither is asked about the other.
 */
function stems(has: Lookup, monospaced: boolean): Finding[] {
  /*
   * A monospaced face gets no opinion about its stems.
   *
   * An `m` has to fit three stems into the width a `u` uses for two, so its
   * stems come out thinner and there is nothing else they could have done.
   * Both monospaced faces on this machine were reported for it -- DejaVu Sans
   * Mono at 184 against 167, Liberation Mono at 180 against 169 -- and both
   * are drawn exactly as a monospaced face has to be.
   */
  if (monospaced) return [];
  const findings: Finding[] = [];

  const measure = (bands: Array<[string, number, number]>, label: string, kind: string): void => {
    const found: Array<{ name: string; width: number }> = [];
    for (const [name, from, to] of bands) {
      const contours = has(name);
      if (!contours) continue;
      const width = stemWidth(contours, from, to);
      if (width !== null && width > 0) found.push({ name, width });
    }
    if (found.length < 2) return;

    const thickest = found.reduce((a, b) => (a.width > b.width ? a : b));
    const thinnest = found.reduce((a, b) => (a.width < b.width ? a : b));
    if (thickest.width - thinnest.width <= thickest.width * STEM_SPREAD) return;
    findings.push(
      advise(
        `stems-disagree-${kind}`,
        `The ${label} stems are not the same width`,
        `${thickest.name} measures ${Math.round(thickest.width)} units across its left stem and ${thinnest.name} measures ${Math.round(thinnest.width)}. A stem's width is a decision rather than a consequence of a curve, so two that differ in a face where they were meant to match are two different decisions.`,
        thinnest.name,
      ),
    );
  };

  // Bands chosen to be somewhere each letter is only a stem: below the
  // shoulder of an `n`, clear of the bar of an `H`, away from both serifs.
  /*
   * Bands as fractions of each letter's own height, well inside it.
   *
   * `i` and `l` are not here even though both are a stem and nothing else:
   * `i` carries a dot, so a fraction of its box is a fraction of something
   * taller than the stem, and `l` is an ascender. The letters left are the
   * ones whose whole height is the stem's height.
   */
  measure(
    [
      ["n", 0.2, 0.7],
      ["m", 0.2, 0.7],
      ["u", 0.35, 0.8],
    ],
    "lowercase",
    "lower",
  );
  measure(
    [
      ["H", 0.15, 0.85],
      ["I", 0.2, 0.8],
      ["E", 0.2, 0.8],
      ["L", 0.2, 0.8],
    ],
    "capital",
    "upper",
  );
  return findings;
}

/**
 * The flat letters, which should all reach the same line.
 *
 * Not the same question as overshoot and the opposite answer: a round letter
 * that stops on the line is drawn short, and a flat one that does not stop on
 * it has drifted. Both are invisible on one letter and obvious in a word.
 *
 * Measured against where the letters actually sit rather than against the
 * number the font declares, because those are two different findings and only
 * one of them is about a letter. A font whose x-height was never set has every
 * flat letter "drifting" from a default nobody chose -- which is a fault in the
 * metric, is said as one, and would otherwise have buried the real case under
 * seven copies of itself.
 */
function flatHeights(has: Lookup, xHeight: number, capHeight: number): Finding[] {
  const findings: Finding[] = [];

  const measure = (names: string[], height: number, label: string, kind: string): void => {
    if (height <= 0) return;
    const found: Array<{ name: string; top: number }> = [];
    for (const name of names) {
      const contours = has(name);
      if (!contours) continue;
      found.push({ name, top: contoursBounds(contours).yMax });
    }
    if (found.length === 0) return;

    // Where the letters say the line is. With only one of them there is no
    // second opinion, so the declared height has to serve.
    const line = found.length >= 2 ? median(found.map((one) => one.top)) : height;
    const drifted = found.filter((one) => Math.abs(one.top - line) > height * SPREAD);

    if (drifted.length > 0) {
      const worst = drifted.reduce((a, b) =>
        Math.abs(a.top - line) > Math.abs(b.top - line) ? a : b,
      );
      findings.push(
        advise(
          `height-drift-${kind}`,
          `${worst.name} sits off the ${label} the others share`,
          `It stops at ${Math.round(worst.top)} against ${Math.round(line)} for the rest of the flat-topped ${label === "x-height" ? "lowercase" : "capitals"}${drifted.length > 1 ? `, and ${drifted.length - 1} other${drifted.length === 2 ? "" : "s"} do the same` : ""}. Flat-topped letters are the ones that define the line, so one that misses it shifts the line rather than sitting off it.`,
          worst.name,
        ),
      );
      return;
    }

    if (found.length >= 2 && Math.abs(line - height) > height * SPREAD) {
      findings.push(
        advise(
          `${kind === "lower" ? "xheight" : "capheight"}-declared`,
          `The letters and the declared ${label} disagree`,
          `${found.map((one) => one.name).join(", ")} all reach ${Math.round(line)}, and the font declares a ${label} of ${Math.round(height)}. The letters are drawn consistently; it is the number that is wrong, and it is the number every other tool will believe.`,
          found[0].name,
        ),
      );
    }
  };

  measure(FLAT_LOWER, xHeight, "x-height", "lower");
  measure(FLAT_UPPER, capHeight, "cap height", "upper");
  return findings;
}

/**
 * The arms of `E`, and the top arms of `E` and `F`.
 *
 * One case, and only one, because it is the only one that reads as a mistake
 * in every tradition rather than as a choice in some. Equal arms on an `E` are
 * a decision a geometric face makes deliberately; a middle arm *longer* than
 * the other two is not a decision anybody makes.
 *
 * There was a second, comparing the top arms of `E` and `F` on the reasoning
 * that an `F` is an `E` without its foot. Real fonts disagreed: DejaVu draws
 * its `F` a hundred and sixteen units narrower than its `E`, on purpose, and
 * so do plenty of others. A rule that fires on a deliberate choice is not a
 * rule, so it is gone.
 */
function arms(has: Lookup): Finding[] {
  const findings: Finding[] = [];

  const e = has("E");
  if (e) {
    const bottom = reachInBand(e, 0.02, 0.22);
    const middle = reachInBand(e, 0.38, 0.62);
    const top = reachInBand(e, 0.78, 0.98);
    if (bottom !== null && middle !== null && top !== null) {
      if (middle > bottom && middle > top) {
        findings.push(
          advise(
            "e-middle-arm",
            "The middle arm of E is the longest of the three",
            `It reaches ${Math.round(middle)} against ${Math.round(top)} at the top and ${Math.round(bottom)} at the foot. The middle arm is conventionally the shortest of an E's three, and equal is a choice some faces make on purpose — longest is the one nobody draws deliberately.`,
            "E",
          ),
        );
      }
    }
  }
  return findings;
}

/*
 * There is no diagonal check here, and there was one.
 *
 * The rule it was written from is real and is taught everywhere: a diagonal
 * of the same measured thickness as an upright reads thinner than it, so
 * diagonals are compensated. The check asked only for the direction -- whether
 * a face had drawn its diagonals *lighter* than its stems -- on the reasoning
 * that nobody compensates that way on purpose.
 *
 * Run against eight fonts that ship on this machine, it fired on five of them:
 * DejaVu Sans, DejaVu Sans Bold, Liberation Sans, Liberation Mono and Free
 * Serif, at between ten and twelve per cent lighter every time. That is not
 * five faults. It is a convention, and it is the opposite of the one the check
 * was looking for -- because where two diagonals meet, at the apex of an `A`
 * or the vertex of a `V`, the ink concentrates and reads dark, and thinning
 * the strokes is how that is answered. Both effects are real and they pull
 * against each other, and which wins is a decision the face makes.
 *
 * So there is no rule to check, and a check that fires on five of eight
 * professionally drawn faces is exactly the thing this file's opening argues
 * against. The measurement went with it rather than being left behind unused,
 * but two traps in it are worth writing down for whoever tries again. A
 * horizontal ruler cuts a diagonal at a slant, so the run it reports is longer
 * than the stroke is thick and has to be shortened by how far the stroke
 * leans. And it is the heaviest stroke of the letter that matters, not the
 * leftmost: a serif face draws the left diagonal of an `A` thin and the right
 * one thick on purpose, and measuring the leftmost reported every serif in the
 * world as having drawn its diagonals too light.
 */

/**
 * The dot on the `i`, against the stem under it.
 *
 * The one piece of a lowercase alphabet whose size has no other constraint, so
 * it is the one most often left at whatever it was first drawn at. A dot
 * narrower than the stem it sits over reads as a mistake at any size; wider is
 * a choice, and a common one.
 */
function theDot(has: Lookup, xHeight: number, em: number): Finding[] {
  const contours = has("i");
  if (!contours || xHeight <= 0) return [];

  // The dot is whatever sits entirely above the x-height, and there is nothing
  // else up there on an `i`.
  const above = contours.filter((one) => contoursBounds([one]).yMin > xHeight * 0.9);
  if (above.length === 0) return [];
  const dot = contoursBounds(above);
  const stem = stemWidth(contours, 0.05, 0.55);
  if (stem === null || stem <= 0) return [];

  const width = dot.xMax - dot.xMin;
  if (width >= stem * (1 - STEM_SPREAD)) return [];
  return [
    advise(
      "dot-narrower-than-stem",
      "The dot on the i is narrower than its own stem",
      `The dot measures ${Math.round(width)} units across and the stem under it ${Math.round(stem)}. A dot is conventionally the stem's width or a little more — it is the one part of a lowercase alphabet whose size nothing else fixes, which is why it is the one most often left at whatever it was first drawn at. Measured on a ${Math.round(em)}-unit em.`,
      "i",
    ),
  ];
}

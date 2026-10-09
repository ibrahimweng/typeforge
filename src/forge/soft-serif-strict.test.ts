/**
 * The Soft Serif (`starts.ts`) held to the rules on its own, not against the
 * Serif drawn on its pen.
 *
 * `soft-serif.test.ts` asks that the soft finishes add nothing to what the
 * Serif already does at the Soft Serif's settings. That left room for the pen
 * itself, and the face shipped with what its pen did: held at eighteen
 * degrees with contrast 0.7, the four's diagonal and the nine's tail were cut
 * level at some masters and square at others, so the four, the nine and the
 * two fractions built of the four had their points in another order from one
 * master to the next; the lje's soft sign ran through its own bowl and
 * crossed itself at 194 and width 100; the g's link stopped just short of its
 * loop there and the g came in two pieces; and every variable font held the
 * four, the nine and the fractions still. So here the face itself is asked,
 * at every pen and width a family is drawn through and through a wave book:
 * nothing crosses itself, every letter keeps its points, every letter is one
 * piece, and a variable font holds nothing.
 *
 * With one allowance, named letter by letter. The Serif as it ships draws
 * five letters with other points at some of these settings on its own pen --
 * the section sign, the eng, both Cyrillic ze and the zeta, at the same
 * widths and weights the Soft Serif does -- and those settings are among the
 * ones every base is held to drawing exactly as it did (`scripts/dev/golden.ts`).
 * Those five may vary here no more than the shipped Serif's do: any two
 * settings at which the Serif draws one of them with the same points, the
 * Soft Serif must too. Any other letter that varies, or any of the five
 * splitting where the Serif does not, fails.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursIntersect } from "@/font/outline";
import { drawLetter, letterNames } from "./build";
import { piecesOf } from "./cut";
import { deliver } from "./deliver";
import { formOf, startFrom } from "./document";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { bowlPoint, openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { SOFT_SERIF } from "./starts";
import { SERIF, type Style } from "./style";
import { signatureText } from "./testing/signature";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
const SETTINGS = PENS.flatMap((pen) => WIDTHS.map((width) => ({ pen, width })));
const said = ({ pen, width }: { pen: number; width: number }) => `${pen}/${width}`;
const NAMES = letterNames();

/**
 * The letters the Serif as it ships already draws with other points at some
 * of these settings, on its own pen: see above.
 */
const AS_THE_SERIF = ["section", "eng", "З", "з", "ζ"];

const at = (style: Style, pen: number, width: number): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);

/** The form each letter is drawn in, as a document started from the face draws it. */
function formsFor(face: Style): (name: string) => string | undefined {
  const forge = startFrom(face);
  return (name) => formOf(forge, name) || undefined;
}

interface Drawn {
  /** Per letter: its signature at each of `SETTINGS`, in order, or null where it would not draw. */
  signature: Map<string, Array<string | null>>;
  /** `letter@pen/width` for every letter with a contour that crosses itself. */
  folds: string[];
  /** `letter@pen/width` for every letter of the alphabet drawn in more than one piece. */
  apart: string[];
}

const drawnOnce = new Map<Style, Drawn>();

/** Every letter of a face at every setting, drawn once and kept. */
function drawnAt(face: Style, names: string[], pieces: boolean): Drawn {
  const known = drawnOnce.get(face);
  if (known) return known;
  const form = formsFor(face);
  const solid = new Set(
    names.filter((name) => /^[A-Za-z]$/.test(name) && name !== "i" && name !== "j"),
  );
  const signature = new Map<string, Array<string | null>>();
  const folds: string[] = [];
  const apart: string[] = [];
  for (const setting of SETTINGS) {
    // One style per setting, every letter drawn with it, as a family draws them.
    const style = at(face, setting.pen, setting.width);
    for (const name of names) {
      const drawn = drawLetter(name, style, form(name));
      const row = signature.get(name) ?? [];
      row.push(drawn ? signatureText(drawn.contours) : null);
      signature.set(name, row);
      if (drawn?.contours.some((contour) => contoursIntersect([contour])))
        folds.push(`${name}@${said(setting)}`);
      if (pieces && drawn && solid.has(name) && piecesOf(drawn.contours) !== 1)
        apart.push(`${name}@${said(setting)}`);
    }
  }
  const out = { signature, folds, apart };
  drawnOnce.set(face, out);
  return out;
}

/** Which settings draw which points: the settings grouped by the signature they share. */
function partition(row: Array<string | null>): string[] {
  const groups = new Map<string | null, string[]>();
  row.forEach((one, index) => {
    groups.set(one, [...(groups.get(one) ?? []), said(SETTINGS[index])]);
  });
  return [...groups.values()].map((settings) => settings.join(",")).sort();
}

describe("the Soft Serif on its own, at every pen and width", () => {
  it("never crosses itself", () => {
    expect(drawnAt(SOFT_SERIF, NAMES, true).folds).toEqual([]);
  }, 300_000);

  it("keeps every letter's points at every pen and width", () => {
    const soft = drawnAt(SOFT_SERIF, NAMES, true);
    const serif = drawnAt(SERIF, AS_THE_SERIF, false);
    const wrong: string[] = [];
    for (const name of NAMES) {
      const row = soft.signature.get(name)!;
      if (row.includes(null)) wrong.push(`${name}: does not draw at every setting`);
      const split = partition(row);
      // The five the shipped Serif splits, split exactly as it does and no further.
      const allowed = AS_THE_SERIF.includes(name)
        ? partition(serif.signature.get(name)!)
        : [SETTINGS.map(said).join(",")];
      if (JSON.stringify(split) !== JSON.stringify(allowed))
        wrong.push(`${name}: ${split.join("  |  ")}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it("draws every letter of the alphabet in one piece", () => {
    expect(drawnAt(SOFT_SERIF, NAMES, true).apart).toEqual([]);
  }, 300_000);

  /*
   * Through a wave book, as an exported family draws: recorded at the face's
   * own weight and read back at 30 and 260, each drawing the same points as
   * the face's own drawing without one. Every style the book is read at is
   * drawn once first without it, as `soft-serif.test.ts` explains: what a
   * letter remembers against a style is remembered from its first drawing.
   */
  it("keeps every letter's points through a wave book, and never crosses itself there", () => {
    const form = formsFor(SOFT_SERIF);
    const thin = at(SOFT_SERIF, 30, 100);
    const black = at(SOFT_SERIF, 260, 100);
    const own = new Map<string, string | null>();
    for (const one of [SOFT_SERIF, thin, black]) {
      for (const name of NAMES) {
        const drawn = drawLetter(name, one, form(name));
        if (one === SOFT_SERIF) own.set(name, drawn ? signatureText(drawn.contours) : null);
      }
    }
    const pages: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const wrong: string[] = [];
    const was = openWaveBook(pages);
    try {
      for (const name of NAMES) {
        pages.lengths.clear();
        pages.bowls.clear();
        pages.balls.clear();
        pages.corners.clear();
        pages.recording = true;
        for (const [label, one] of [
          ["book own", SOFT_SERIF],
          ["book 30", thin],
          ["book 260", black],
        ] as const) {
          waveBookAt(name);
          const drawn = drawLetter(name, one, form(name));
          const signature = drawn ? signatureText(drawn.contours) : null;
          if (signature === null || signature !== own.get(name))
            wrong.push(`${name} ${label}: ${signature} against ${own.get(name)}`);
          if (drawn?.contours.some((contour) => contoursIntersect([contour])))
            wrong.push(`${name} ${label} crosses itself`);
          pages.recording = false;
        }
      }
    } finally {
      openWaveBook(was);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  /*
   * A variable font from 100 to 900 drawn at 400, as `typeface.test.ts`
   * asks for one: a letter `deliver` holds is one whose masters disagree,
   * set at one weight rather than run along the axis.
   */
  it("holds nothing still in a variable export", async () => {
    const forge = { ...startFrom(SOFT_SERIF), family: { drawn: 400, also: [100, 700, 900] } };
    const delivered = await deliver(forge, { familyName: "Soft", format: "ttf", variable: true });
    expect(delivered.members.map((one) => one.weight)).toEqual([100, 400, 700, 900]);
    expect(delivered.held).toEqual([]);
  }, 300_000);
});

describe("a point on a bowl", () => {
  /*
   * The lje's soft sign at 194 and width 100 on the Soft Serif's pen: a bowl
   * a hair taller than it is wide, whose quarters meet on the vertical with
   * one ending at 89.99999999999994 degrees and the next beginning at
   * 90.00000000000006. Straight up and straight down fell in neither, and
   * the bowl's centre came back for both.
   */
  const centre = { x: 735.8599355897499, y: 167.79193652048528 };
  const wide = 131.36193187324585;
  const tall = 132.20806347951472;

  it("is found on a direction that falls between two of its pieces by a rounding error", () => {
    const top = bowlPoint(centre, wide, tall, 1, 97, 90, 0.0001);
    const foot = bowlPoint(centre, wide, tall, 1, 97, -90, 0.0001);
    expect(top.x).toBeCloseTo(centre.x, 6);
    expect(top.y).toBeCloseTo(centre.y + tall, 6);
    expect(foot.x).toBeCloseTo(centre.x, 6);
    expect(foot.y).toBeCloseTo(centre.y - tall, 6);
  });

  it("is never the centre on the four plumb and level directions, however near square the bowl", () => {
    const missed: string[] = [];
    for (let step = 0; step <= 400; step++) {
      const across = wide * (0.98 + step * 0.0001);
      for (const degrees of [0, 90, 180, 270, -90]) {
        const point = bowlPoint(centre, across, tall, 1, 97, degrees, 0.0001);
        if (Math.hypot(point.x - centre.x, point.y - centre.y) < Math.min(across, tall) * 0.5)
          missed.push(`${across} at ${degrees}`);
      }
    }
    expect(missed).toEqual([]);
  });
});

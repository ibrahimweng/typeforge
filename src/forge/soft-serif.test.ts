/**
 * The Soft Serif (`starts.ts`), held to what the Serif is held to.
 *
 * It is the Serif with every soft finish turned on and its own a, y and f, on
 * a pen with more contrast at a steeper angle. So it is asked, at every pen
 * and width a family runs through, what `lora.test.ts` asks of the Serif:
 * nothing crossing itself, the same points at every master with and without
 * the wave book a family is drawn with, every letter one piece, every weight
 * heavier than the one before, nothing for the health walk to warn about, and
 * nothing a variable export has to hold still.
 *
 * Asked against the Serif at the same settings -- the Soft Serif's own pen,
 * proportions, serifs and letterforms with the soft finishes taken off --
 * rather than against the Serif as it ships. That pen draws a handful of
 * letters differently at some masters on its own (the four and nine and the
 * fractions built of them, and the Cyrillic lje, which also folds at one
 * master; the g comes apart at one), finishes or no finishes, and those are
 * the pen's to answer for. What is asked here is that the finishes add
 * nothing to them: every letter that keeps its points plain keeps them soft,
 * every master that does not fold plain does not fold soft, and so on. The
 * three letters the face draws its own way are held to the strict rule, with
 * nothing excused.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contourArea } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { removeOverlaps } from "@/font/overlap";
import { drawLetter, letterNames } from "./build";
import { piecesOf } from "./cut";
import { deliver } from "./deliver";
import { draw, formOf, startFrom, weighted, type Forge } from "./document";
import { widthedStyle } from "./family";
import { troubles } from "./health";
import { readyToShape } from "./layers";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { SOFT_SERIF } from "./starts";
import type { Style } from "./style";
import { signatureText } from "./testing/signature";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
const NAMES = letterNames();
/** The letters the Soft Serif draws its own way. */
const OWN = Object.entries({ a: "curled", y: "swung", f: "tucked" });

/** The fields that are the soft finishes, by where they live. */
const FINISHES: Record<string, string[]> = {
  slab: ["tip", "swell"],
  shoulder: ["rise"],
  bowl: ["tail", "heft", "heftTilt"],
  terminal: ["soft", "taper", "dropSize", "dropHang", "dropCurl", "dropNeck"],
  corner: ["fillet"],
};

/** A style with every soft finish taken off, which is what a style from before them was. */
function unfinished(style: Style): Style {
  const parts = { ...style.parts } as unknown as Record<string, Record<string, unknown>>;
  for (const [part, keys] of Object.entries(FINISHES)) {
    const kept = { ...parts[part] };
    for (const key of keys) delete kept[key];
    parts[part] = kept;
  }
  const metrics = { ...style.metrics } as unknown as Record<string, unknown>;
  delete metrics.dotScale;
  return {
    ...style,
    parts: parts as unknown as Style["parts"],
    metrics: metrics as unknown as Style["metrics"],
  };
}

/** The Serif at the Soft Serif's settings: its pen, proportions, serifs and forms, no finishes. */
const PLAIN = unfinished(SOFT_SERIF);

const FACES = { soft: SOFT_SERIF, plain: PLAIN } as const;
type Face = keyof typeof FACES;

const at = (style: Style, pen: number, width: number): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);

const SETTINGS = PENS.flatMap((pen) => WIDTHS.map((width) => ({ pen, width })));
const said = ({ pen, width }: { pen: number; width: number }) => `${pen}/${width}`;

/** The form each letter is drawn in, as a document started from the face draws it. */
function formsFor(face: Style): (name: string) => string | undefined {
  const forge = startFrom(face);
  return (name) => formOf(forge, name) || undefined;
}

interface Master {
  /** Per letter, per setting: its signature, or null where it would not draw. */
  signature: Map<string, Array<string | null>>;
  /** `letter@pen/width` for every contour that crosses itself. */
  folds: Set<string>;
  /**
   * Per letter: its signature at the face's own pen without a wave book, then
   * with one recorded there, then read back at 30 and 260.
   */
  book: Map<string, Array<string | null>>;
}

const measured = new Map<Face, Master>();

/** Every letter of a face at every setting, and through a wave book, drawn once and kept. */
function masters(face: Face): Master {
  const known = measured.get(face);
  if (known) return known;
  const style = FACES[face];
  const form = formsFor(style);
  const signature = new Map<string, Array<string | null>>();
  const folds = new Set<string>();
  for (const setting of SETTINGS) {
    const drawnAt = at(style, setting.pen, setting.width);
    for (const name of NAMES) {
      const drawn = drawLetter(name, drawnAt, form(name));
      const row = signature.get(name) ?? [];
      row.push(drawn ? signatureText(drawn.contours) : null);
      signature.set(name, row);
      if (drawn?.contours.some((contour) => contoursIntersect([contour])))
        folds.add(`${name}@${said(setting)}`);
    }
  }

  /*
   * The book, as an exported family draws with one (golden.ts, and
   * `typographic.test.ts`). Every style it is read at is drawn once first
   * without it: some of what a letter measures is remembered against the
   * style object -- how wide the figures are, for one -- and remembered from
   * whichever drawing came first, so a style met for the first time inside
   * the book would have measured itself under it. That is a property of the
   * engine, there on the bases as well, and not of this face.
   */
  const thin = at(style, 30, 100);
  const black = at(style, 260, 100);
  // The face's own drawing without a book opens each letter's row, so the
  // book is held to drawing what the face draws.
  const book = new Map<string, Array<string | null>>();
  for (const one of [style, thin, black]) {
    for (const name of NAMES) {
      const drawn = drawLetter(name, one, form(name));
      if (one === style) book.set(name, [drawn ? signatureText(drawn.contours) : null]);
    }
  }
  const pages: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };
  const was = openWaveBook(pages);
  try {
    for (const name of NAMES) {
      pages.lengths.clear();
      pages.bowls.clear();
      pages.balls.clear();
      pages.corners.clear();
      const row = book.get(name)!;
      pages.recording = true;
      for (const one of [style, thin, black]) {
        waveBookAt(name);
        const drawn = drawLetter(name, one, form(name));
        row.push(drawn ? signatureText(drawn.contours) : null);
        pages.recording = false;
      }
    }
  } finally {
    openWaveBook(was);
  }
  const out = { signature, folds, book };
  measured.set(face, out);
  return out;
}

/**
 * The settings a letter draws differently at, soft, that it draws the same at
 * plain: any two the plain letter shares a signature at and the soft one does
 * not. Empty when the finishes split nothing the plain face keeps together.
 */
function splits(
  soft: Array<string | null>,
  plain: Array<string | null>,
  labels: string[],
): string[] {
  const found: string[] = [];
  const groups = new Map<string | null, number[]>();
  plain.forEach((one, index) => {
    groups.set(one, [...(groups.get(one) ?? []), index]);
  });
  for (const [plainSignature, members] of groups) {
    if (plainSignature === null) continue;
    const seen = new Set(members.map((index) => soft[index]));
    if (seen.size > 1 || seen.has(null)) {
      // Said as which settings drew which, each drawing once.
      const drawings = [...seen].map((drawing) => {
        const where = members.filter((index) => soft[index] === drawing);
        return `${where.map((index) => labels[index]).join(",")} = ${drawing ?? "nothing"}`;
      });
      found.push(drawings.join("  |  "));
    }
  }
  return found;
}

describe("the Soft Serif at every master", () => {
  it("never crosses itself where the Serif at its settings does not", () => {
    const soft = masters("soft");
    const plain = masters("plain");
    const fresh = [...soft.folds].filter((one) => !plain.folds.has(one));
    expect(fresh).toEqual([]);
  }, 300_000);

  it("keeps the same points at every pen and width wherever the Serif at its settings does", () => {
    const soft = masters("soft");
    const plain = masters("plain");
    const labels = SETTINGS.map(said);
    const wrong: string[] = [];
    for (const name of NAMES) {
      for (const split of splits(soft.signature.get(name)!, plain.signature.get(name)!, labels))
        wrong.push(`${name}: ${split}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it("keeps them through a wave book wherever the Serif at its settings does", () => {
    const soft = masters("soft");
    const plain = masters("plain");
    const labels = ["own", "book own", "book 30", "book 260"];
    const wrong: string[] = [];
    for (const name of NAMES) {
      for (const split of splits(soft.book.get(name)!, plain.book.get(name)!, labels))
        wrong.push(`${name}: ${split}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it("keeps its own letters' points, unfolded, at every master and through the book, with nothing excused", () => {
    const soft = masters("soft");
    const wrong: string[] = [];
    for (const [name, form] of OWN) {
      expect(formOf(startFrom(SOFT_SERIF), name)).toBe(form);
      const seen = new Set([...soft.signature.get(name)!, ...soft.book.get(name)!]);
      if (seen.size !== 1 || seen.has(null))
        wrong.push(`${name}/${form}: ${[...seen].join(" | ")}`);
      for (const setting of SETTINGS)
        if (soft.folds.has(`${name}@${said(setting)}`))
          wrong.push(`${name}/${form} folds at ${said(setting)}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  /*
   * One piece, as `letters.test.ts` asks of every base: every letter but the
   * two with dots, where the plain face at the same setting is one.
   */
  it("draws every letter in one piece wherever the Serif at its settings does", () => {
    const solid = NAMES.filter((name) => /^[A-Za-z]$/.test(name) && name !== "i" && name !== "j");
    const soft = formsFor(SOFT_SERIF);
    const plain = formsFor(PLAIN);
    const apart: string[] = [];
    for (const setting of SETTINGS) {
      const softly = at(SOFT_SERIF, setting.pen, setting.width);
      const plainly = at(PLAIN, setting.pen, setting.width);
      for (const name of solid) {
        const drawn = drawLetter(name, softly, soft(name))!;
        if (piecesOf(drawn.contours) <= 1) continue;
        const before = drawLetter(name, plainly, plain(name))!;
        if (piecesOf(before.contours) <= 1) apart.push(`${name}@${said(setting)}`);
      }
    }
    expect(apart).toEqual([]);
    // Its own letters with nothing excused.
    for (const setting of SETTINGS) {
      const softly = at(SOFT_SERIF, setting.pen, setting.width);
      for (const [name] of OWN)
        expect(
          piecesOf(drawLetter(name, softly, soft(name))!.contours),
          `${name}@${said(setting)}`,
        ).toBe(1);
    }
  }, 300_000);
});

describe("the Soft Serif as a family", () => {
  /** The ink a letter really lays down: its strokes merged, its counters taken out. */
  async function inkOf(letter: string, forge: Forge): Promise<number> {
    const drawn = draw(letter, forge);
    if (!drawn || drawn.contours.length === 0) return 0;
    const merged = await removeOverlaps(drawn.contours, "winding");
    return merged.reduce((sum, contour) => sum + contourArea(contour), 0);
  }

  it("is lighter at a hundred than at four, and at four than at nine, at every width", async () => {
    const drawing = startFrom(SOFT_SERIF);
    const uneven: string[] = [];
    for (const width of WIDTHS) {
      const [thin, regular, black] = [100, 400, 900].map((weight) =>
        weighted(drawing, weight, width),
      );
      for (const letter of NAMES) {
        const ink = [
          await inkOf(letter, thin),
          await inkOf(letter, regular),
          await inkOf(letter, black),
        ];
        if (ink.every((one) => one === 0)) continue;
        if (!(ink[0] < ink[1] && ink[1] < ink[2]))
          uneven.push(`${letter} at ${width}: ${ink.map((one) => Math.round(one)).join(" / ")}`);
      }
    }
    expect(uneven).toEqual([]);
  }, 300_000);

  it("gives the health walk nothing to say, as it ships and at every pen and width", () => {
    expect(troubles(startFrom(SOFT_SERIF))).toEqual([]);
    const found: string[] = [];
    for (const setting of SETTINGS) {
      for (const trouble of troubles(startFrom(at(SOFT_SERIF, setting.pen, setting.width))))
        found.push(`${said(setting)}: ${trouble.what} (${trouble.letters.join(" ")})`);
    }
    expect(found).toEqual([]);
  }, 300_000);

  /*
   * A variable font from 100 to 900 drawn at 400, as `typeface.test.ts` asks
   * for one. A letter `deliver` holds is one whose masters disagree, which it
   * sets at one weight rather than let it run along the axis; the finishes
   * and forms must not add one to what the plain face holds.
   */
  it("holds nothing still in a variable export that the Serif at its settings does not", async () => {
    const held = async (face: Style) => {
      const forge = { ...startFrom(face), family: { drawn: 400, also: [100, 700, 900] } };
      const delivered = await deliver(forge, { familyName: "Soft", format: "ttf", variable: true });
      expect(delivered.members.map((one) => one.weight)).toEqual([100, 400, 700, 900]);
      return delivered.held;
    };
    const plain = new Set(await held(PLAIN));
    const soft = await held(SOFT_SERIF);
    expect(soft.filter((name) => !plain.has(name))).toEqual([]);
  }, 300_000);
});

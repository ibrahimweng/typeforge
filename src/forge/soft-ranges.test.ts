/**
 * The skeleton finishes held at every step of their controls, not only at the
 * values a face starts from: the flat tail from its smallest step up
 * (`bowl.tail`), and the heaviest heft turned every way it turns, on every
 * base (`bowl.heft`, `bowl.heftTilt`).
 *
 * Each of these was once right in the middle of its range and wrong near an
 * end of it. A tail of a few hundredths turned the Serif c's foot further up
 * instead of laying it down, far enough at some weights to hang a drop off it
 * and at others not, so the letter had more contours at some masters than at
 * others. And the heaviest heft folded the Fairground's e at the Black, where
 * the end of its bowl buried in the bar was squared round its curve before its
 * own level cut slid it on again, under the bowl's foot.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursIntersect } from "@/font/outline";
import type { Vec2 } from "@/font/types";
import { builtFrom, drawLetter, letterNames } from "./build";
import { widthedStyle } from "./family";
import { everyFormOf, recipeOf } from "./letters";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { BASES, SANS, SERIF, type Style } from "./style";
import { segmentEnd } from "./sweep";
import { withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";
import type { SpineArc, Stroke } from "./types";

beforeAll(async () => {
  await ready();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];

/** The tail's first steps: the control runs from nought to 1.5 in twentieths. */
const SMALL_TAILS = [0.02, 0.05, 0.1, 0.15, 0.2];
/** And the whole control, in order. */
const TAILS = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.15, 1.5];

const at = (face: Style, pen: number, width: number): Style =>
  widthedStyle({ ...face, pen: { ...face.pen, weight: pen } }, width);
const tailed = (style: Style, tail: number): Style => withField(style, "bowl.tail", tail);
const hefted = (style: Style, heft: number, tilt: number): Style =>
  withField(withField(style, "bowl.heft", heft), "bowl.heftTilt", tilt);

/** Whether an arc begins at the very bottom of its turn, where a tail is laid from. */
const atFoot = (one: Stroke["spine"]["segments"][number]): one is SpineArc =>
  one.kind === "arc" && Math.abs(Math.sin(one.startAngle) + 1) < 1e-9;

/**
 * Where a bowl's run ends, the way into the inside of its last turn from there
 * -- what `dress` asks to decide whether a drop hangs off that end -- and where
 * the run leaves the bottom of the bowl. The run is the open stroke with a turn
 * that begins at the bottom: the c's bowl, or the e's.
 */
function foot(strokes: Stroke[]): { end: Vec2; toward: Vec2 | null; bottom: number } | null {
  const run = strokes.find((one) => !one.spine.closed && one.spine.segments.some(atFoot));
  if (!run) return null;
  const segments = run.spine.segments;
  const first = segments.find(atFoot)!;
  const end = segmentEnd(segments[segments.length - 1]);
  let toward: Vec2 | null = null;
  for (let index = segments.length - 1; index >= 0; index--) {
    const one = segments[index];
    if (one.kind === "line") {
      if (Math.hypot(one.to.x - one.from.x, one.to.y - one.from.y) > 1e-9) break;
      continue;
    }
    if (one.radius < 1e-6) continue;
    const length = Math.hypot(one.centre.x - end.x, one.centre.y - end.y);
    toward = { x: (one.centre.x - end.x) / length, y: (one.centre.y - end.y) / length };
    break;
  }
  return { end, toward, bottom: first.centre.y - first.radius };
}

/** The faces and forms a tail is laid on: the Serif in both its c's and its e's, and the Sans. */
const TAIL_FACES: Array<[Style, "own" | "default"]> = [
  [SERIF, "own"],
  [SERIF, "default"],
  [SANS, "default"],
];
const formOf = (style: Style, name: string, form: "own" | "default") =>
  form === "own" ? style.forms?.[name] : undefined;

/**
 * Every letter whose points `make` lets differ between two pens and widths
 * where the face's own drawing has the same points (see `drift` in
 * soft-skeleton.test.ts), and whether `make` changed anything at all.
 */
function drift(
  face: Style,
  make: (style: Style) => Style,
  letters: string[],
  form: "own" | "default",
): { varies: string[]; changed: boolean } {
  const varies: string[] = [];
  let changed = false;
  for (const name of letters) {
    const under = new Map<string, Set<string>>();
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const style = at(face, pen, width);
        const plain = drawLetter(name, style, formOf(face, name, form))!.contours;
        const soft = drawLetter(name, make(style), formOf(face, name, form))!.contours;
        const key = signatureText(plain);
        under.set(key, (under.get(key) ?? new Set()).add(signatureText(soft)));
        changed ||= JSON.stringify(soft) !== JSON.stringify(plain);
      }
    }
    for (const seen of under.values()) {
      if (seen.size > 1) varies.push(`${face.name} ${name}: ${[...seen].join(" | ")}`);
    }
  }
  return { varies, changed };
}

/**
 * The same, read back from a wave book recorded at the face's own pen, as an
 * exported family is drawn (see `driftInBook` in soft-skeleton.test.ts).
 */
function driftInBook(
  face: Style,
  make: (style: Style) => Style,
  letters: string[],
  form: "own" | "default",
): string[] {
  const out: string[] = [];
  const book: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };
  const masters = (name: string, finish: (style: Style) => Style): string[] => {
    book.lengths.clear();
    book.bowls.clear();
    book.balls.clear();
    book.corners.clear();
    book.recording = true;
    waveBookAt(name);
    const own = drawLetter(name, finish(face), formOf(face, name, form))!.contours;
    const drawn = [signatureText(own)];
    book.recording = false;
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        waveBookAt(name);
        const style = finish(at(face, pen, width));
        drawn.push(signatureText(drawLetter(name, style, formOf(face, name, form))!.contours));
      }
    }
    return drawn;
  };
  const was = openWaveBook(book);
  try {
    for (const name of letters) {
      const [plainOwn, ...plain] = masters(name, (style) => style);
      const [softOwn, ...soft] = masters(name, make);
      soft.forEach((now, index) => {
        if (plain[index] === plainOwn && now !== softOwn) {
          out.push(`${face.name} ${name} at master ${index}: ${now} for ${softOwn}`);
        }
      });
    }
  } finally {
    openWaveBook(was);
  }
  return out;
}

describe("a flat tail, at every step of its control", () => {
  it("lays the foot no higher and turns it up no further as the tail grows", () => {
    const wrong: string[] = [];
    for (const [face, form] of TAIL_FACES) {
      for (const name of ["c", "e"]) {
        for (const pen of PENS) {
          for (const width of WIDTHS) {
            const style = at(face, pen, width);
            const label = `${face.name} ${name}/${form} ${pen}/${width}`;
            let last: { end: Vec2; toward: Vec2 | null; bottom: number } | null = null;
            for (const tail of TAILS) {
              const recipe = recipeOf(name, formOf(face, name, form))!;
              const now = foot(recipe(tailed(style, tail)).strokes);
              if (!now) break;
              if (last) {
                if (now.end.y > last.end.y + 1e-9) wrong.push(`${label}: rose at ${tail}`);
                // Lying further round its last turn, the end would be read as hanging.
                if (now.toward && last.toward && now.toward.y < last.toward.y - 1e-9)
                  wrong.push(`${label}: turned further up at ${tail}`);
              }
              if (now.end.y < now.bottom - 1e-9) wrong.push(`${label}: below the bowl at ${tail}`);
              last = now;
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("does something from its first step on", () => {
    for (const [face, form] of TAIL_FACES) {
      const style = at(face, 87, 100);
      const recipe = recipeOf("c", formOf(face, "c", form))!;
      const plain = foot(recipe(style).strokes)!;
      for (const tail of SMALL_TAILS) {
        const now = foot(recipe(tailed(style, tail)).strokes)!;
        expect(plain.end.y - now.end.y, `${face.name} ${form} at ${tail}`).toBeGreaterThan(0.1);
      }
    }
  });

  it("keeps the same points at every pen and width at its first steps", {
    timeout: 240_000,
  }, () => {
    for (const [face, form] of TAIL_FACES) {
      for (const tail of SMALL_TAILS) {
        const make = (style: Style) => tailed(style, tail);
        const { varies, changed } = drift(face, make, ["c", "e", "cent"], form);
        expect(varies, `${face.name} ${form} at ${tail}`).toEqual([]);
        expect(changed, `${face.name} ${form} at ${tail}`).toBe(true);
        expect(driftInBook(face, make, ["c", "e"], form), `${face.name} at ${tail}`).toEqual([]);
      }
    }
  });
});

describe("the heaviest heft, on every base", () => {
  /** The letters a base draws with an open bowl that takes a heft, in every form. */
  const heftable = (base: Style): Array<[string, string | undefined]> => {
    const style = hefted(base, 0.5, 0);
    const out: Array<[string, string | undefined]> = [];
    for (const name of letterNames()) {
      if (builtFrom(name)) continue;
      for (const { id } of everyFormOf(name)) {
        const recipe = recipeOf(name, id || undefined);
        if (recipe?.(style).strokes.some((one) => one.heftable)) out.push([name, id || undefined]);
      }
    }
    return out;
  };

  it("folds no open bowl and keeps its points, turned every way", { timeout: 240_000 }, () => {
    const wrong: string[] = [];
    let changed = 0;
    for (const base of BASES) {
      for (const [name, form] of heftable(base)) {
        for (const [heft, tilt] of [
          [0.4, 0],
          [0.5, -45],
          [0.5, 0],
          [0.5, 45],
        ]) {
          const label = `${base.name} ${name}/${form ?? "-"} at ${heft} tilted ${tilt}`;
          const under = new Map<string, Set<string>>();
          for (const pen of [142, 194, 260]) {
            for (const width of [75, 100]) {
              const style = at(base, pen, width);
              const plain = drawLetter(name, style, form)!.contours;
              const heavy = drawLetter(name, hefted(style, heft, tilt), form)!.contours;
              const key = signatureText(plain);
              under.set(key, (under.get(key) ?? new Set()).add(signatureText(heavy)));
              if (JSON.stringify(heavy) !== JSON.stringify(plain)) changed++;
              const folds = (contours: typeof plain) =>
                contours.some((contour) => contoursIntersect([contour]));
              if (folds(heavy) && !folds(plain)) wrong.push(`${label} folds at ${pen}/${width}`);
            }
          }
          for (const seen of under.values()) {
            if (seen.size > 1) wrong.push(`${label}: ${[...seen].join(" | ")}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(changed).toBeGreaterThan(0);
  });
});

/**
 * Two arms a face can set: how far the middle arm of an E reaches against the
 * arms above and below it (`metrics.middleArm`), and how much lower an r's
 * arm leaves its stem than the n's shoulder (`shoulder.armRise`).
 *
 * Each left out on every base, where the letters are drawn as they always
 * were; each moving exactly what it names, by exactly what it asks, held to
 * its range, and keeping the letter's points at every pen and width.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursIntersect } from "@/font/outline";
import type { Contour } from "@/font/types";
import { drawLetter, makeLetter } from "./build";
import { widthedStyle } from "./family";
import { readyToShape } from "./layers";
import { frame, middleBar } from "./letters/common";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { flatten } from "./soft";
import { SOFT_SERIF } from "./starts";
import { BASES, SERIF, type Style } from "./style";
import { foldSweep, withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];

const at = (style: Style, pen: number, width = 100): Style =>
  widthedStyle({ ...style, pen: { ...style.pen, weight: pen } }, width);

/** A letter's contours in its own frame, before it was slid to fit its advance. */
function unslid(name: string, style: Style): Contour[] {
  const made = makeLetter(name, style, style.forms?.[name])!;
  return made.runs.flatMap((run) =>
    run.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        ...node,
        point: { x: node.point.x - made.slide, y: node.point.y },
      })),
    })),
  );
}

/** How far right the ink reaches along a level line: the last crossing of any outline. */
function rightmost(contours: Contour[], y: number): number {
  let most = -Infinity;
  for (const { points } of flatten(contours, 48).polygons) {
    for (let k = 0; k < points.length; k++) {
      const a = points[k];
      const b = points[(k + 1) % points.length];
      if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
      most = Math.max(most, a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return most;
}

/** The E and its three-armed fellows: the F, the Æ and the Œ. */
const THREE_ARMED = ["E", "F", "AE", "OE"];

/** The style with one field taken out altogether, as a face that never set it. */
function leftOut(style: Style, field: string): Style {
  const [where, key] = field.split(".");
  const copy = structuredClone(style) as unknown as Record<string, Record<string, unknown>>;
  const holder =
    where === "metrics"
      ? copy.metrics
      : (copy.parts as unknown as Record<string, Record<string, unknown>>)[where];
  delete holder[key];
  return copy as unknown as Style;
}

describe("the middle arm", () => {
  it("is drawn as it always was where the face says nothing", () => {
    for (const given of [SERIF, SOFT_SERIF, ...BASES.slice(0, 4)]) {
      const face = leftOut(given, "metrics.middleArm");
      for (const name of THREE_ARMED) {
        const plain = drawLetter(name, at(face, 87), face.forms?.[name]);
        const said = drawLetter(
          name,
          at(withField(face, "metrics.middleArm", 0.86), 87),
          face.forms?.[name],
        );
        expect(said?.contours, `${face.name} ${name}`).toEqual(plain?.contours);
      }
    }
  });

  it("reaches the share of the arms above and below it that the face asks", () => {
    const wrong: string[] = [];
    for (const [label, face] of [
      ["Serif", SERIF],
      ["Soft Serif", SOFT_SERIF],
    ] as const) {
      for (const pen of [30, 87, 194]) {
        const style = at(face, pen);
        const f = frame(style);
        const middle = middleBar(f, f.cap);
        const top = f.cap - f.upright * f.bar;
        for (const name of ["E", "F"]) {
          // The arm's end is where its outline crosses the level of its spine;
          // the stem's middle is where it starts, the same for every arm.
          const end = (share: number) =>
            rightmost(unslid(name, withField(style, "metrics.middleArm", share)), middle);
          const [a, b, c] = [0.6, 0.8, 1].map(end);
          const full = rightmost(unslid(name, withField(style, "metrics.middleArm", 1)), top);
          // Even steps in the share are even steps in the reach, and all of it
          // is the arm above's reach.
          if (Math.abs(b - a - (c - b)) > 1e-6 || Math.abs(c - full) > 1e-6) {
            wrong.push(`${label} ${name} at ${pen}: ${a}, ${b}, ${c} against ${full}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("draws the Æ's and the Œ's middle arm shorter with the E's", () => {
    for (const name of ["AE", "OE"]) {
      const style = at(SERIF, 87);
      const f = frame(style);
      const middle = middleBar(f, f.cap);
      const long = rightmost(unslid(name, withField(style, "metrics.middleArm", 0.86)), middle);
      const short = rightmost(unslid(name, withField(style, "metrics.middleArm", 0.6)), middle);
      expect(short, name).toBeLessThan(long - 20);
    }
  });

  it("is held between half the others' reach and all of it", () => {
    const style = at(SERIF, 87);
    for (const name of THREE_ARMED) {
      const draw = (share: number) =>
        drawLetter(name, withField(style, "metrics.middleArm", share))?.contours;
      expect(draw(0.2), name).toEqual(draw(0.5));
      expect(draw(1.6), name).toEqual(draw(1));
    }
  });

  it("moves nothing but the three-armed letters", () => {
    const style = at(SERIF, 87);
    for (const name of ["H", "L", "T", "Z", "B", "P", "R", "e", "Ξ"]) {
      const plain = drawLetter(name, style);
      const short = drawLetter(name, withField(style, "metrics.middleArm", 0.6));
      expect(short?.contours, name).toEqual(plain?.contours);
    }
  });
});

/** The highest the r's arm reaches: the top of its ink right of the stem. */
function armTop(style: Style): number {
  const contours = unslid("r", style);
  const stemRight = Math.max(...contours[0].nodes.map((node) => node.point.x));
  let top = -Infinity;
  for (const { points } of flatten(contours, 48).polygons) {
    for (const point of points) if (point.x > stemRight + 5) top = Math.max(top, point.y);
  }
  return top;
}

describe("an r's arm leaving its stem lower", () => {
  it("is drawn as it always was where the face says nothing", () => {
    for (const given of [SERIF, SOFT_SERIF, ...BASES.slice(0, 4)]) {
      const face = leftOut(given, "shoulder.armRise");
      const plain = drawLetter("r", at(face, 87), face.forms?.r);
      const nought = drawLetter("r", at(withField(face, "shoulder.armRise", 0), 87), face.forms?.r);
      expect(nought?.contours, face.name).toEqual(plain?.contours);
    }
  });

  it("sets the whole arm down by the share of the x-height it asks, where there is room", () => {
    const wrong: string[] = [];
    for (const [label, face] of [
      ["Serif", SERIF],
      ["Soft Serif", withField(SOFT_SERIF, "shoulder.armRise", 0)],
    ] as const) {
      for (const pen of [30, 60, 87, 142]) {
        const style = at(face, pen);
        const plain = armOf(style);
        const arm = armOf(withField(style, "shoulder.armRise", 0.04));
        const down = style.metrics.xHeight * 0.04;
        // The arm's own outline, moved straight down and nothing else.
        const moved = plain.nodes.map((node) => [node.point.x, node.point.y - down]);
        const now = arm.nodes.map((node) => [node.point.x, node.point.y]);
        const off = Math.max(
          ...moved.map((point, k) => Math.hypot(point[0] - now[k][0], point[1] - now[k][1])),
        );
        if (moved.length !== now.length || off > 1e-6) wrong.push(`${label} at ${pen}: ${off}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("lowers the arm at every pen, never by more than it asks", () => {
    const wrong: string[] = [];
    for (const face of [SERIF, withField(SOFT_SERIF, "shoulder.armRise", 0)]) {
      for (const pen of PENS) {
        const style = at(face, pen);
        const down = style.metrics.xHeight * 0.04;
        const plain = armTop(style);
        const lowered = armTop(withField(style, "shoulder.armRise", 0.04));
        if (!(lowered < plain - down * 0.5 && lowered > plain - down - 1e-6)) {
          wrong.push(`${face.name} at ${pen}: ${plain.toFixed(1)} to ${lowered.toFixed(1)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("is held to a tenth of the x-height", () => {
    const style = at(SERIF, 87);
    expect(drawLetter("r", withField(style, "shoulder.armRise", 0.5))?.contours).toEqual(
      drawLetter("r", withField(style, "shoulder.armRise", 0.1))?.contours,
    );
  });

  it("moves nothing but the r", () => {
    const style = at(SERIF, 87);
    for (const name of ["n", "m", "h", "u", "a", "f"]) {
      const plain = drawLetter(name, style, style.forms?.[name]);
      const lowered = drawLetter(
        name,
        withField(style, "shoulder.armRise", 0.1),
        style.forms?.[name],
      );
      expect(lowered?.contours, name).toEqual(plain?.contours);
    }
  });
});

/** The r's arm as swept, in the letter's own frame: its second run's first contour. */
function armOf(style: Style): Contour {
  const made = makeLetter("r", style, style.forms?.r)!;
  const arm = made.runs[1].contours[0];
  return {
    ...arm,
    nodes: arm.nodes.map((node) => ({
      ...node,
      point: { x: node.point.x - made.slide, y: node.point.y },
    })),
  };
}

describe("both arms at every master", () => {
  const FACES: Array<[string, Style]> = [
    ["the Serif", withField(withField(SERIF, "metrics.middleArm", 0.69), "shoulder.armRise", 0.04)],
    [
      "the Soft Serif",
      withField(withField(SOFT_SERIF, "metrics.middleArm", 0.69), "shoulder.armRise", 0.04),
    ],
  ];
  const LETTERS = ["E", "F", "AE", "OE", "r", "racute", "rcaron"];

  for (const [label, face] of FACES) {
    it(`keep their points at every pen and width, and never cross themselves, on ${label}`, () => {
      const moved: string[] = [];
      const folds: string[] = [];
      for (const name of LETTERS) {
        const seen = new Set<string>();
        for (const pen of PENS) {
          for (const width of WIDTHS) {
            const drawn = drawLetter(name, at(face, pen, width), face.forms?.[name]);
            if (!drawn) continue;
            seen.add(signatureText(drawn.contours));
            if (drawn.contours.some((contour) => contoursIntersect([contour]))) {
              folds.push(`${name} at ${pen}/${width}`);
            }
          }
        }
        if (seen.size > 1) moved.push(`${name}: ${seen.size} drawings`);
      }
      expect(moved).toEqual([]);
      expect(folds).toEqual([]);
    });

    it(`keep them through a wave book, on ${label}`, () => {
      const moved: string[] = [];
      const thin = at(face, 30);
      const black = at(face, 260);
      for (const one of [face, thin, black]) {
        for (const name of LETTERS) drawLetter(name, one, face.forms?.[name]);
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
        for (const name of LETTERS) {
          pages.lengths.clear();
          pages.bowls.clear();
          pages.balls.clear();
          pages.corners.clear();
          pages.recording = true;
          const seen = new Set<string>();
          for (const one of [face, thin, black]) {
            waveBookAt(name);
            const drawn = drawLetter(name, one, face.forms?.[name]);
            if (drawn) seen.add(signatureText(drawn.contours));
            pages.recording = false;
          }
          if (seen.size > 1) moved.push(`${name}: ${seen.size} drawings`);
        }
      } finally {
        openWaveBook(was);
      }
      expect(moved).toEqual([]);
    });
  }

  it("fold nothing across the controls' weights, on the Sans with serifs and the Serif", {
    timeout: 300_000,
  }, () => {
    expect(foldSweep("metrics.middleArm", [0.5, 0.69, 1], THREE_ARMED)).toEqual([]);
    expect(
      foldSweep("shoulder.armRise", [0.04, 0.1], ["r", "racute", "rcaron", "rcommaaccent"]),
    ).toEqual([]);
  });
});

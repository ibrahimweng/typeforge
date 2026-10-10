/**
 * The soft tips: a serif's tip turned on a radius (`slab.tip`), the bar beaks
 * of an s and an S turned with it, and the dot of an i and a j drawn larger
 * or smaller (`metrics.dotScale`).
 *
 * Each is measured against the same letter drawn without it, so a test here
 * fails the moment its finish stops doing anything, and each is held to the
 * same points at every weight and width it is drawn at.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { widthedStyle } from "./family";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { flatten, pointAt, windingAt } from "./soft";
import { BASES, SANS, SERIF, type Style } from "./style";
import { foldSweep, withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";

beforeAll(async () => {
  await ready();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];

const tipped = (style: Style, tip = 1): Style => withField(style, "slab.tip", tip);
const dotted = (style: Style, scale: number): Style => withField(style, "metrics.dotScale", scale);
const atPen = (style: Style, weight: number): Style => ({
  ...style,
  pen: { ...style.pen, weight },
});

/** A face's letter in its own form. */
const draw = (name: string, style: Style) => drawLetter(name, style, style.forms?.[name])!;

/** Every letter whose points are not the same at every pen and width, with `make` applied. */
function drift(face: Style, make: (style: Style) => Style, letters: string): string[] {
  const out: string[] = [];
  let changed = false;
  for (const name of letters) {
    const seen = new Set<string>();
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const style = widthedStyle(atPen(face, pen), width);
        const soft = draw(name, make(style)).contours;
        seen.add(signatureText(soft));
        changed ||= JSON.stringify(soft) !== JSON.stringify(draw(name, style).contours);
      }
    }
    if (seen.size > 1) out.push(`${face.name} ${name}: ${[...seen].join(" | ")}`);
  }
  // And the finish did something, or the same points everywhere is no news.
  if (!changed) out.push(`${face.name} ${letters}: drawn no differently`);
  return out;
}

/** The same, drawn with a wave book recorded at the face's own pen, as a family is exported. */
function driftInBook(face: Style, make: (style: Style) => Style, letters: string): string[] {
  const out: string[] = [];
  const book: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };
  const was = openWaveBook(book);
  try {
    for (const name of letters) {
      book.lengths.clear();
      book.bowls.clear();
      book.balls.clear();
      book.corners.clear();
      book.recording = true;
      waveBookAt(name);
      const own = signatureText(draw(name, make(face)).contours);
      book.recording = false;
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          waveBookAt(name);
          const now = signatureText(
            draw(name, make(widthedStyle(atPen(face, pen), width))).contours,
          );
          if (now !== own) out.push(`${face.name} ${name} at ${pen}/${width}: ${now} for ${own}`);
        }
      }
    }
  } finally {
    openWaveBook(was);
  }
  return out;
}

const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v: Vec2): Vec2 => {
  const length = Math.hypot(v.x, v.y);
  return { x: v.x / length, y: v.y / length };
};

/**
 * The wings of a letter: contours whose cut across the tip -- the edge from
 * node 1 to node 2, or from node n-3 to node n-2 on a wing wound the other way
 * -- is a bare line in the square drawing and a curve in the soft one. Each
 * with the square drawing's points where the wing leaves its stroke (node 0,
 * or n-1) and at its two tip corners, moved as far as the soft letter was
 * moved in being spaced: a rounded tip reaches less far, and the letter is
 * set a fraction of a unit over. Where a wing leaves its stroke is not moved
 * by the rounding, so that is what says how far.
 */
function wingsOf(square: Contour[], soft: Contour[]) {
  return square.flatMap((was, index) => {
    const now = soft[index];
    const count = was.nodes.length;
    if (!now || now.nodes.length !== count || count < 4) return [];
    const bare = (nodes: GlyphNode[], from: number) =>
      nodes[from].handleOut === null && nodes[from + 1].handleIn === null;
    const cut = [1, count - 3].find((edge) => bare(was.nodes, edge) && !bare(now.nodes, edge));
    if (cut === undefined) return [];
    const [at, lowAt, highAt] = cut === 1 ? [0, 1, 2] : [count - 1, count - 2, count - 3];
    const root = was.nodes[at];
    const set = minus(now.nodes[at].point, root.point);
    const moved = (point: Vec2): Vec2 => ({ x: point.x + set.x, y: point.y + set.y });
    return [
      {
        index,
        was,
        now,
        set,
        lowAt,
        highAt,
        root: moved(root.point),
        low: moved(was.nodes[lowAt].point),
        high: moved(was.nodes[highAt].point),
      },
    ];
  });
}

/** Points along every edge of a contour, `steps` to an edge. */
function samples(contour: Contour, steps = 64): Vec2[] {
  const out: Vec2[] = [];
  const { nodes } = contour;
  for (let edge = 0; edge < nodes.length; edge++) {
    const from = nodes[edge];
    const to = nodes[(edge + 1) % nodes.length];
    for (let step = 0; step < steps; step++) out.push(pointAt(from, to, step / steps));
  }
  return out;
}

describe("soft serif tips", () => {
  it("rounds every wing tip of an l that is seen, clear of the square corners", () => {
    for (const pen of [30, 87, 260]) {
      const square = draw("l", atPen(SERIF, pen)).contours;
      const soft = draw("l", tipped(atPen(SERIF, pen))).contours;
      expect(soft.length).toBe(square.length);
      const ink = flatten(soft);
      let seen = 0;
      for (const wing of wingsOf(square, soft)) {
        const rho = Math.hypot(
          wing.now.nodes[wing.lowAt].point.x - wing.low.x,
          wing.now.nodes[wing.lowAt].point.y - wing.low.y,
        );
        // The square corners, each stepped a fifth of the radius in along the
        // diagonal of the corner it was.
        const along = unit(minus(wing.low, wing.root));
        const up = unit(minus(wing.high, wing.low));
        const inward = 0.2 * rho * Math.SQRT1_2;
        const corners = [
          { x: wing.low.x + (up.x - along.x) * inward, y: wing.low.y + (up.y - along.y) * inward },
          {
            x: wing.high.x - (up.x + along.x) * inward,
            y: wing.high.y - (up.y + along.y) * inward,
          },
        ];
        // Only where nothing else of the square letter covers it: a wing
        // buried in the stem has its corners inside the stem either way.
        const others = flatten(square.filter((_, index) => index !== wing.index));
        for (const corner of corners) {
          const was = { x: corner.x - wing.set.x, y: corner.y - wing.set.y };
          if (windingAt(others, was) !== 0) continue;
          expect(rho).toBeGreaterThan(0.5);
          expect(windingAt(ink, corner)).toBe(0);
          seen++;
        }
      }
      // Both feet and the head's flag, both corners of each.
      expect(seen, `l at ${pen}`).toBeGreaterThanOrEqual(6);
    }
  });

  it("never reaches past the square tip or below the bar, and carries its handles", () => {
    for (const name of "lnEIThimprfy") {
      for (const pen of [30, 87, 260]) {
        const square = draw(name, atPen(SERIF, pen)).contours;
        const soft = draw(name, tipped(atPen(SERIF, pen))).contours;
        const wings = wingsOf(square, soft);
        expect(wings.length, name).toBeGreaterThan(0);
        for (const wing of wings) {
          // In the square wing's own frame: along it to the tip, and up off its underside.
          const along = minus(wing.low, wing.root);
          const up = minus(wing.high, wing.low);
          const det = along.x * up.y - along.y * up.x;
          for (const point of samples(wing.now)) {
            const d = minus(point, wing.low);
            const u = (d.x * up.y - d.y * up.x) / det;
            const v = (along.x * d.y - along.y * d.x) / det;
            expect(u * Math.hypot(along.x, along.y)).toBeLessThanOrEqual(1e-6);
            expect(v * Math.hypot(up.x, up.y)).toBeGreaterThanOrEqual(-1e-6);
          }
        }
      }
    }
  });

  it("keeps the same points at every pen and width", { timeout: 120_000 }, () => {
    expect(drift(SERIF, (style) => tipped(style), "lnEIThimprfy")).toEqual([]);
    expect(driftInBook(SERIF, (style) => tipped(style), "lnEIThimprfy")).toEqual([]);
  });

  it("turns the corners of the s's and the S's bar beaks, inside the square bar", () => {
    for (const name of "sS") {
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = widthedStyle(atPen(SERIF, pen), width);
          const square = draw(name, style).contours;
          const soft = draw(name, tipped(style)).contours;
          expect(soft.length).toBe(square.length);
          let bars = 0;
          square.forEach((was, index) => {
            const bare = was.nodes.every((one) => one.handleIn === null && one.handleOut === null);
            if (was.nodes.length !== 4 || !bare) return;
            bars++;
            const now = soft[index];
            expect(now.nodes.length).toBe(6);
            const box = contoursBounds([was]);
            for (const point of samples(now)) {
              expect(point.x).toBeGreaterThanOrEqual(box.xMin - 1e-6);
              expect(point.x).toBeLessThanOrEqual(box.xMax + 1e-6);
              expect(point.y).toBeGreaterThanOrEqual(box.yMin - 1e-6);
              expect(point.y).toBeLessThanOrEqual(box.yMax + 1e-6);
            }
            // And the tip's corners are no longer there.
            const ink = flatten([now]);
            const tip = was.nodes[1].point;
            const middle = { x: (box.xMin + box.xMax) / 2, y: (box.yMin + box.yMax) / 2 };
            const inside = {
              x: tip.x + (middle.x - tip.x) * 0.02,
              y: tip.y + (middle.y - tip.y) * 0.02,
            };
            expect(windingAt(ink, inside)).toBe(0);
          });
          expect(bars, `${name} at ${pen}/${width}`).toBe(2);
        }
      }
    }
  });

  it("folds nothing at its least, middle and most", { timeout: 120_000 }, () => {
    expect(foldSweep("slab.tip", [0.05, 0.5, 1])).toEqual([]);
  });
});

describe("the dot's scale", () => {
  /** The dot of an i: its highest contour, and how far across its narrower way it is. */
  const dotOf = (style: Style, name = "i") => {
    const contours = drawLetter(name, style)!.contours;
    const dot = contours.reduce((one, other) =>
      contoursBounds([other]).yMax > contoursBounds([one]).yMax ? other : one,
    );
    const box = contoursBounds([dot]);
    return { size: Math.min(box.xMax - box.xMin, box.yMax - box.yMin), top: box.yMax };
  };
  const GEOMETRIC = BASES.find((one) => one.name === "Geometric")!;

  it("draws the dot 1.27 times as large at the regular", () => {
    // The drop face's oval, the grotesque's square and the geometric's round.
    for (const face of [SERIF, SANS, GEOMETRIC]) {
      for (const name of ["i", "j"]) {
        const was = dotOf(atPen(face, 87), name);
        const now = dotOf(dotted(atPen(face, 87), 1.27), name);
        expect(now.size / was.size, `${face.name} ${name}`).toBeCloseTo(1.27, 2);
      }
    }
  });

  it("holds a grown dot under the ascender at the Black", () => {
    for (const scale of [1.27, 1.5]) {
      for (const width of WIDTHS) {
        const style = dotted(widthedStyle(atPen(SERIF, 260), width), scale);
        const { top } = dotOf(style);
        expect(top).toBeLessThanOrEqual(style.metrics.ascender + style.metrics.overshoot);
      }
    }
  });

  it("keeps the same points at every pen and width", { timeout: 60_000 }, () => {
    expect(drift(SERIF, (style) => dotted(style, 1.27), "ij")).toEqual([]);
    // The Sans in its default forms: its own grotesque i and j dot themselves.
    const plainSans = { ...SANS, forms: {} };
    expect(drift(plainSans, (style) => dotted(style, 1.27), "ij")).toEqual([]);
  });

  it("folds nothing at its least, middle and most", { timeout: 120_000 }, () => {
    expect(foldSweep("metrics.dotScale", [0.7, 1.1, 1.5])).toEqual([]);
  });
});

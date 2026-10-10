/**
 * The soft text serif's second set of letters (`letters/soft.ts`): the belted
 * a, the wide-eyed e, the beaked s and the wedged t.
 *
 * Each is offered on every face, so the loops over every form in
 * `controls.test.ts`, `letters.test.ts`, `serif-forms.test.ts`,
 * `script.test.ts` and `ink-frame.test.ts` already hold them to the rules
 * every alternate keeps, and the Soft Serif draws all four, so
 * `soft-serif-strict.test.ts` holds them to that face's own. What is here is
 * what makes each the letter it is meant to be, and the points each keeps at
 * every pen and width -- with the face's finishes off, and with the soft
 * serif's own finishes on, which is where these letters are meant to be drawn.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready, unite } from "@/font/boolean";
import { contourArea, contoursBounds, inkRunsAt } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { removeOverlaps } from "@/font/overlap";
import type { Contour, Vec2 } from "@/font/types";
import { drawLetter, letterNames } from "./build";
import { piecesOf } from "./cut";
import { deliver } from "./deliver";
import { draw, type Forge, formOf, startFrom, weighted } from "./document";
import { widthedStyle } from "./family";
import { troubles } from "./health";
import { readyToShape } from "./layers";
import { formsOf, recipeOf } from "./letters";
import { frame, headingAt } from "./letters/common";
import { BEAKED_HOOK, BEAKED_TURN, BELTED_TILT, WEDGED_TAIL, WIDE_UPRIGHT } from "./letters/soft";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { pointAt } from "./soft";
import { SOFT_SERIF } from "./starts";
import { penReach, reachAlong } from "./sweep";
import { BASES, SANS, SERIF, type Style } from "./style";
import { withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";
import type { Stroke } from "./types";

beforeAll(async () => {
  await ready();
  await readyToShape();
});

const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
const FORMS: Array<[string, string]> = [
  ["a", "belted"],
  ["e", "wide-eyed"],
  ["s", "beaked"],
  ["t", "wedged"],
];

const atPen = (style: Style, weight: number): Style => ({
  ...style,
  pen: { ...style.pen, weight },
});

/** The soft serif's finishes (plan B2's values), laid on a face. */
function softened(style: Style): Style {
  let out = style;
  const fields: Array<[string, number]> = [
    ["metrics.dotScale", 1.27],
    ["slab.tip", 1],
    ["slab.swell", 0.3],
    ["shoulder.rise", 0.3],
    ["bowl.tail", 0.8],
    ["bowl.heft", 0.08],
    ["terminal.soft", 0.3],
    ["terminal.taper", 0.5],
    ["terminal.dropSize", 0.15],
    ["terminal.dropHang", 0.3],
    ["terminal.dropCurl", 0.6],
    ["terminal.dropNeck", 1],
    ["corner.fillet", 0.35],
  ];
  for (const [field, value] of fields) out = withField(out, field, value);
  return out;
}

/** The Serif on the soft serif's own pen, which is the pen these letters were drawn for. */
const SOFT_PEN: Style = { ...SERIF, pen: { ...SERIF.pen, weight: 84, contrast: 0.7, angle: 18 } };

/** A contour as a closed polygon, each edge in sixteen steps. */
function polygonOf(contour: Contour): Vec2[] {
  const out: Vec2[] = [];
  const { nodes } = contour;
  for (let index = 0; index < nodes.length; index++) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    for (let step = 0; step < 16; step++) out.push(pointAt(from, to, step / 16));
  }
  return out;
}

/**
 * The direction of a region's long axis, in degrees from the level, from its
 * second moments about its own centroid (Green's theorem over the polygon).
 */
function principalAxis(points: Vec2[]): number {
  let a = 0;
  let cx = 0;
  let cy = 0;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let index = 0; index < points.length; index++) {
    const p = points[index];
    const q = points[(index + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    xx += (p.y * p.y + p.y * q.y + q.y * q.y) * cross;
    yy += (p.x * p.x + p.x * q.x + q.x * q.x) * cross;
    xy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * cross;
  }
  a /= 2;
  cx /= 6 * a;
  cy /= 6 * a;
  const ixx = xx / 12 - a * cy * cy;
  const iyy = yy / 12 - a * cx * cx;
  const ixy = xy / 24 - a * cx * cy;
  const wound = Math.sign(a);
  return (Math.atan2(2 * ixy * wound, (iyy - ixx) * wound) / 2) * (180 / Math.PI);
}

/** The letter's ink as one outline: its outside and the counters it closes. */
function united(contours: Contour[]): { outside: Contour; counters: Contour[] } {
  const all = unite(contours, "winding", "whole");
  const outside = all.reduce((one, other) =>
    Math.abs(contourArea(other)) > Math.abs(contourArea(one)) ? other : one,
  );
  const wound = Math.sign(contourArea(outside));
  return { outside, counters: all.filter((one) => Math.sign(contourArea(one)) !== wound) };
}

/** Where a spine starts and ends, and which way it is going there. */
function endsOfSpine(stroke: Stroke): { from: Vec2; to: Vec2; leaves: Vec2; arrives: Vec2 } {
  const segments = stroke.spine.segments;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const start = (one: typeof first): Vec2 =>
    one.kind === "line"
      ? one.from
      : {
          x: one.centre.x + one.radius * Math.cos(one.startAngle),
          y: one.centre.y + one.radius * Math.sin(one.startAngle),
        };
  const end = (one: typeof last): Vec2 =>
    one.kind === "line"
      ? one.to
      : {
          x: one.centre.x + one.radius * Math.cos(one.endAngle),
          y: one.centre.y + one.radius * Math.sin(one.endAngle),
        };
  return {
    from: start(first),
    to: end(last),
    leaves: headingAt(first, "start"),
    arrives: headingAt(last, "end"),
  };
}

/** How far across a stroke's pen reaches either side of its spine, going `heading`. */
function halfAcross(stroke: Stroke, heading: Vec2): number {
  const left = { x: -heading.y, y: heading.x };
  const side = reachAlong(left, penReach(stroke.pen));
  return Math.abs(side.x * left.x + side.y * left.y);
}

describe("the second set of soft forms is offered", () => {
  it("as the belted a, the wide-eyed e, the beaked s and the wedged t", () => {
    for (const [name, id] of FORMS) {
      expect(formsOf(name).map((form) => form.id)).toContain(id);
    }
  });

  it("drawn as the plain letter on a joined face and with a pen held near the upright", () => {
    const joined = BASES.filter((base) => base.parts.script.on);
    expect(joined.length).toBeGreaterThan(0);
    const upright: Style = { ...SERIF, pen: { ...SERIF.pen, angle: 80 } };
    for (const style of [...joined, upright]) {
      for (const [name, id] of FORMS) {
        const plain = recipeOf(name)!(style);
        const drawn = recipeOf(name, id)!(style);
        expect(JSON.stringify(drawn.strokes), `${style.name} ${name}/${id}`).toBe(
          JSON.stringify(plain.strokes),
        );
      }
    }
  });
});

describe("the belted a", () => {
  const faces: Array<[string, Style]> = [
    ["Serif", SERIF],
    ["Serif on the soft pen", SOFT_PEN],
    ["Soft Serif", SOFT_SERIF],
    ["Sans", SANS],
  ];

  it("draws its bowl as one open stroke whose ends are both buried in the stem", () => {
    const wrong: string[] = [];
    for (const [label, face] of faces) {
      for (const pen of PENS) {
        const style = atPen(face, pen);
        const [belt, stem] = recipeOf("a", "belted")!(style).strokes;
        const said = `${label} ${pen}`;
        if (belt.spine.closed) wrong.push(`${said}: the bowl is a ring`);
        const upright = stem.spine.segments.find((one) => one.kind === "line");
        if (upright?.kind !== "line") throw new Error("no stem");
        const reach = halfAcross(stem, { x: 0, y: 1 });
        const left = upright.from.x - reach;
        const right = upright.from.x + reach;
        const { from, to, leaves, arrives } = endsOfSpine(belt);
        // Both corners of each square cut stand in the stem's ink.
        for (const [where, point, heading] of [
          ["leaves", from, leaves],
          ["joins", to, arrives],
        ] as const) {
          const across = reachAlong({ x: -heading.y, y: heading.x }, penReach(belt.pen));
          for (const corner of [point.x + across.x, point.x - across.x]) {
            if (corner < left || corner > right)
              wrong.push(`${said}: ${where} with a corner at ${corner} outside ${left}..${right}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("leaves the stem high and comes back into it low", () => {
    for (const [label, face] of faces) {
      for (const pen of PENS) {
        const style = atPen(face, pen);
        const f = frame(style);
        const [belt] = recipeOf("a", "belted")!(style).strokes;
        const { from, to } = endsOfSpine(belt);
        expect(from.y, `${label} ${pen}`).toBeGreaterThan(f.x * 0.38);
        expect(to.y, `${label} ${pen}`).toBeLessThan(f.x * 0.35);
        expect(from.y - to.y, `${label} ${pen}`).toBeGreaterThan(f.x * 0.15);
      }
    }
  });

  it("leaves the stem as a hairline, on a pen with contrast", () => {
    for (const style of [SOFT_SERIF, SOFT_PEN, SERIF]) {
      const [belt] = recipeOf("a", "belted")!(style).strokes;
      const { leaves } = endsOfSpine(belt);
      // Against the bowl's heavy side, which runs straight down.
      expect(halfAcross(belt, leaves), style.name).toBeLessThan(
        halfAcross(belt, { x: 0, y: -1 }) * 0.6,
      );
    }
  });

  it("leans its counter back", () => {
    for (const [label, face] of faces) {
      for (const pen of [30, 87, 142, 194, 260]) {
        const { counters } = united(drawLetter("a", atPen(face, pen), "belted")!.contours);
        // One counter, the bowl's: the arch over it is open.
        expect(counters.length, `${label} ${pen}`).toBe(1);
        const axis = principalAxis(polygonOf(counters[0]));
        expect(axis, `${label} ${pen}`).toBeGreaterThan(BELTED_TILT * 0.4);
        expect(axis, `${label} ${pen}`).toBeLessThan(BELTED_TILT + 20);
      }
    }
  });

  /*
   * Its counter is closed by two strokes, the belt and the stem, so the
   * health walk -- which reads a counter as a contour wound against the ink
   * -- never sees it: held open here instead, by what that walk asks of a
   * counter, at every pen and width.
   */
  it("keeps its counter open to the Black and past it", () => {
    const wrong: string[] = [];
    for (const [label, face] of faces) {
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const style = widthedStyle(atPen(face, pen), width);
          const { counters } = united(drawLetter("a", style, "belted")!.contours);
          const counter = counters[0];
          const box = counter ? contoursBounds([counter]) : null;
          const room = box
            ? Math.min(
                box.xMax - box.xMin,
                box.yMax - box.yMin,
                (Math.abs(contourArea(counter)) /
                  Math.max(box.xMax - box.xMin, box.yMax - box.yMin)) *
                  1.6,
              )
            : 0;
          if (room < style.metrics.unitsPerEm * 0.045)
            wrong.push(`${label} ${pen}/${width}: ${room.toFixed(1)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("the wide-eyed e", () => {
  it("is the old-style e written with its pen nearer the upright", () => {
    for (const style of [SOFT_SERIF, SOFT_PEN, SERIF]) {
      for (const stroke of recipeOf("e", "wide-eyed")!(style).strokes) {
        expect(stroke.pen.angle, style.name).toBeCloseTo(style.pen.angle * (1 - WIDE_UPRIGHT), 9);
      }
    }
  });

  it("draws its bar lighter than the old-style e's", () => {
    for (const style of [SOFT_SERIF, SOFT_PEN, SERIF, SANS]) {
      const [bar] = recipeOf("e", "wide-eyed")!(style).strokes;
      const [own] = recipeOf("e", "humanist")!(style).strokes;
      expect(bar.pen.weight, style.name).toBeLessThan(own.pen.weight);
    }
  });

  it("draws its eye's right side lighter than the old-style e's", () => {
    for (const face of [SOFT_SERIF, SOFT_PEN]) {
      for (const pen of [30, 87, 142, 194, 260]) {
        const style = atPen(face, pen);
        const f = frame(style);
        // Across the eye, a fifth of the x-height under the top.
        const right = (form: string): number => {
          const ink = unite(drawLetter("e", style, form)!.contours, "winding", "whole");
          const runs = inkRunsAt(ink, f.x * 0.8, "y", 16);
          const [from, to] = runs[runs.length - 1];
          return to - from;
        };
        expect(right("wide-eyed"), `${face.name} ${pen}`).toBeLessThan(right("humanist"));
      }
    }
  });
});

describe("the beaked s", () => {
  it("turns its head and foot on into beaks of their own, tighter than the turns they leave", () => {
    for (const face of [SOFT_SERIF, SERIF, SANS, SOFT_PEN]) {
      for (const pen of PENS) {
        const style = atPen(face, pen);
        const f = frame(style);
        const [stroke] = recipeOf("s", "beaked")!(style).strokes;
        const segments = stroke.spine.segments;
        const said = `${face.name} ${pen}`;
        const [beak, head] = segments;
        const [foot, tail] = segments.slice(-2);
        for (const [one, from] of [
          [beak, head],
          [tail, foot],
        ] as const) {
          if (one.kind !== "arc" || from.kind !== "arc") throw new Error(`${said}: not turns`);
          expect(one.pieces, said).toBe(1);
          expect(Math.abs(one.endAngle - one.startAngle), said).toBeCloseTo(
            (BEAKED_TURN * Math.PI) / 180,
            9,
          );
          expect(one.radius, said).toBeLessThanOrEqual(
            Math.max(f.least, f.half * BEAKED_HOOK) + 1e-9,
          );
          expect(one.radius, said).toBeLessThanOrEqual(from.radius + 1e-9);
        }
      }
    }
  });

  it("ends both beaks upright, the head's pointing down and the foot's up", () => {
    for (const face of [SOFT_SERIF, SERIF, SANS]) {
      for (const pen of PENS) {
        const [stroke] = recipeOf("s", "beaked")!(atPen(face, pen)).strokes;
        const { leaves, arrives } = endsOfSpine(stroke);
        // The run is written from the head's tip, rising into it, to the foot's.
        expect(leaves.x, `${face.name} ${pen}`).toBeCloseTo(0, 9);
        expect(leaves.y, `${face.name} ${pen}`).toBeCloseTo(1, 9);
        expect(arrives.x, `${face.name} ${pen}`).toBeCloseTo(0, 9);
        expect(arrives.y, `${face.name} ${pen}`).toBeCloseTo(1, 9);
      }
    }
  });

  it("wears no serif's beak and hangs no drop, where the old-style s stands a beak off each end", () => {
    for (const style of [SOFT_SERIF, SERIF, SOFT_PEN]) {
      expect(drawLetter("s", style, "humanist")!.contours.length, style.name).toBe(3);
      expect(drawLetter("s", style, "beaked")!.contours.length, style.name).toBe(1);
    }
    // And on the soft serif its two cuts are softened as the face's seen ends are.
    const [stroke] = recipeOf("s", "beaked")!(SOFT_SERIF).strokes;
    expect(stroke.start).toEqual({ kind: "butt", seen: true });
    expect(stroke.end).toEqual({ kind: "butt", seen: true });
  });

  it("is the old-style s on a face whose runs undulate", () => {
    for (const base of BASES.filter((one) => one.parts.wave.along !== "off")) {
      if (!(base.parts.wave.depth > 0)) continue;
      for (const pen of [30, 260]) {
        const style = atPen(base, pen);
        expect(JSON.stringify(recipeOf("s", "beaked")!(style).strokes), base.name).toBe(
          JSON.stringify(recipeOf("s", "humanist")!(style).strokes),
        );
      }
    }
  });
});

describe("the wedged t", () => {
  const faces: Array<[string, Style]> = [
    ["Soft Serif", SOFT_SERIF],
    ["Serif", SERIF],
    ["Sans", SANS],
    ["Serif with the soft finishes", softened(SOFT_PEN)],
  ];

  it("is solid under its head, with no counter between the flag and the stem, at every pen and width", () => {
    const wrong: string[] = [];
    for (const [label, face] of faces) {
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const drawn = drawLetter("t", widthedStyle(atPen(face, pen), width), "wedged")!;
          const { counters } = united(drawn.contours);
          if (counters.length > 0)
            wrong.push(
              `${label} ${pen}/${width}: ${counters.map((one) => Math.abs(contourArea(one)).toFixed(1))}`,
            );
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("lays its flag's outside along the line from the bar's foot to the stem's top right corner", () => {
    for (const [label, face] of faces) {
      for (const pen of PENS) {
        const style = atPen(face, pen);
        const [stem, flag, bar] = recipeOf("t", "wedged")!(style).strokes;
        const upright = stem.spine.segments[0];
        const run = flag.spine.segments[0];
        const crossbar = bar.spine.segments[0];
        if (upright.kind !== "line" || run.kind !== "line" || crossbar.kind !== "line")
          throw new Error("not straight");
        const said = `${label} ${pen}`;
        // A round nib, so a face that thins its rising strokes leaves it whole.
        expect(flag.pen.contrast, said).toBe(0);
        const length = Math.hypot(run.to.x - run.from.x, run.to.y - run.from.y);
        const along = { x: (run.to.x - run.from.x) / length, y: (run.to.y - run.from.y) / length };
        const half = flag.pen.weight / 2;
        // A point on the flag's outside, and how far another lies off that line.
        const on = { x: run.from.x - along.y * half, y: run.from.y + along.x * half };
        const off = (point: Vec2) => (point.x - on.x) * -along.y + (point.y - on.y) * along.x;
        const corner = {
          x: upright.from.x + halfAcross(stem, { x: 0, y: -1 }),
          y: upright.from.y,
        };
        expect(Math.abs(off(corner)), said).toBeLessThan(1e-6);
        // Its foot level with the bar's.
        const barFoot = crossbar.from.y - halfAcross(bar, { x: 1, y: 0 });
        expect(run.from.y, said).toBeCloseTo(barFoot, 6);
        // And the stem's top sloping down the same line to its left side.
        const sink = stem.start.sink ?? 0;
        const left = { x: upright.from.x - halfAcross(stem, { x: 0, y: -1 }), y: corner.y - sink };
        expect(Math.abs(off(left)), said).toBeLessThan(1e-6);
      }
    }
  });

  it("stands three hundredths shorter than the old-style t at a text weight", () => {
    for (const face of [SOFT_SERIF, SERIF]) {
      for (const pen of [30, 60, 87]) {
        const style = atPen(face, pen);
        const [stem] = recipeOf("t", "wedged")!(style).strokes;
        const [own] = recipeOf("t", "humanist")!(style).strokes;
        const top = (stroke: Stroke) => {
          const one = stroke.spine.segments[0];
          if (one.kind !== "line") throw new Error("no stem");
          return one.from.y;
        };
        expect(top(stem) / top(own), `${face.name} ${pen}`).toBeCloseTo(0.97, 9);
      }
    }
  });

  it("flicks its tail further up than the old-style t's", () => {
    for (const face of [SOFT_SERIF, SERIF, SANS]) {
      const [stem] = recipeOf("t", "wedged")!(face).strokes;
      const [own] = recipeOf("t", "humanist")!(face).strokes;
      const last = (stroke: Stroke) => stroke.spine.segments[stroke.spine.segments.length - 1];
      const tail = last(stem);
      const owned = last(own);
      if (tail.kind !== "arc" || owned.kind !== "arc") throw new Error("no tail");
      expect((tail.endAngle * 180) / Math.PI, face.name).toBeCloseTo(WEDGED_TAIL, 9);
      expect(tail.endAngle, face.name).toBeGreaterThan(owned.endAngle);
    }
  });
});

describe("the second set at every master", () => {
  /** Each form's signature at every pen and width, and with a wave book replayed at 30 and 260. */
  function signatures(face: Style, name: string, form: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const pen of PENS) {
      for (const width of WIDTHS) {
        const drawn = drawLetter(name, widthedStyle(atPen(face, pen), width), form)!;
        out.set(`${pen}/${width}`, signatureText(drawn.contours));
      }
    }
    const book: WaveBook = {
      lengths: new Map(),
      bowls: new Map(),
      balls: new Map(),
      corners: new Map(),
      recording: true,
    };
    const was = openWaveBook(book);
    try {
      waveBookAt(name);
      out.set("book", signatureText(drawLetter(name, face, form)!.contours));
      book.recording = false;
      for (const pen of [30, 260]) {
        waveBookAt(name);
        const drawn = drawLetter(name, widthedStyle(atPen(face, pen), 100), form)!;
        out.set(`book ${pen}`, signatureText(drawn.contours));
      }
    } finally {
      openWaveBook(was);
    }
    return out;
  }

  const faces: Array<[string, Style]> = [
    ["Serif", SERIF],
    ["Sans", SANS],
    ["Sans with serifs", withField(SANS, "slab.on", true)],
    ["Serif on the soft pen", SOFT_PEN],
    ["Serif with the soft finishes", softened(SOFT_PEN)],
    ["Sans with the soft finishes", softened(withField(SANS, "slab.on", true))],
    ["Soft Serif", SOFT_SERIF],
  ];

  it.each(faces)("keep their points on the %s", (label, face) => {
    const wrong: string[] = [];
    for (const [name, form] of FORMS) {
      const seen = new Set(signatures(face, name, form).values());
      if (seen.size > 1) wrong.push(`${label} ${name}/${form}: ${[...seen].join(" | ")}`);
    }
    expect(wrong).toEqual([]);
  });

  it("never fold or come apart, with or without the soft finishes, on any base", () => {
    const wrong: string[] = [];
    for (const base of BASES) {
      for (const weight of [8, 40, 92, 150, 210, 260]) {
        for (const style of [atPen(base, weight), softened(atPen(base, weight))]) {
          for (const [name, form] of FORMS) {
            const drawn = drawLetter(name, style, form)!;
            for (const contour of drawn.contours) {
              if (contoursIntersect([contour]))
                wrong.push(`${base.name} ${name}/${form} folds at ${weight}`);
            }
            const pieces = piecesOf(drawn.contours);
            if (pieces !== 1)
              wrong.push(`${base.name} ${name}/${form} in ${pieces} pieces at ${weight}`);
          }
        }
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  });
});

/*
 * The Soft Serif with the second set chosen, held to the Soft Serif's own
 * rules (`soft-serif-strict.test.ts`, `soft-serif.test.ts`) on every letter
 * that draws one of them -- the four and every letter built on them, as a
 * document picks its forms: at every pen and width a family is drawn through
 * and through a wave book nothing crosses itself, every letter keeps its
 * points and is one piece, ink grows with the weight, the health walk has
 * nothing to say and a variable font holds nothing still.
 */
describe("the Soft Serif drawn with the second set", () => {
  const FACE: Style = {
    ...SOFT_SERIF,
    forms: { ...SOFT_SERIF.forms, a: "belted", e: "wide-eyed", s: "beaked", t: "wedged" },
  };
  const SETTINGS = PENS.flatMap((pen) => WIDTHS.map((width) => ({ pen, width })));
  const at = (pen: number, width: number): Style => widthedStyle(atPen(FACE, pen), width);
  const document = startFrom(FACE);
  const formFor = (name: string) => formOf(document, name) || undefined;
  const OURS = letterNames().filter((name) => FORMS.some(([, id]) => formFor(name) === id));

  it("draws the four, and the letters built on them, in them", () => {
    for (const [name, id] of FORMS) expect(formFor(name)).toBe(id);
    expect(OURS).toEqual(expect.arrayContaining(["aacute", "eacute", "scaron", "tcaron"]));
  });

  it("never crosses itself, and keeps every letter's points and every letter whole", () => {
    const wrong: string[] = [];
    const rows = new Map<string, Set<string>>();
    for (const { pen, width } of SETTINGS) {
      const style = at(pen, width);
      for (const name of OURS) {
        const drawn = drawLetter(name, style, formFor(name))!;
        const row = rows.get(name) ?? new Set<string>();
        row.add(signatureText(drawn.contours));
        rows.set(name, row);
        if (drawn.contours.some((contour) => contoursIntersect([contour])))
          wrong.push(`${name}@${pen}/${width} crosses itself`);
        if (/^[a-z]$/.test(name) && piecesOf(drawn.contours) !== 1)
          wrong.push(`${name}@${pen}/${width} in pieces`);
      }
    }
    for (const [name, row] of rows) if (row.size > 1) wrong.push(`${name}: ${row.size} signatures`);
    expect(wrong).toEqual([]);
  }, 120_000);

  it("keeps every letter's points through a wave book", () => {
    const thin = at(30, 100);
    const black = at(260, 100);
    const own = new Map<string, string>();
    for (const one of [FACE, thin, black]) {
      for (const name of OURS) {
        const drawn = drawLetter(name, one, formFor(name))!;
        if (one === FACE) own.set(name, signatureText(drawn.contours));
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
      for (const name of OURS) {
        pages.lengths.clear();
        pages.bowls.clear();
        pages.balls.clear();
        pages.corners.clear();
        pages.recording = true;
        for (const [label, one] of [
          ["book own", FACE],
          ["book 30", thin],
          ["book 260", black],
        ] as const) {
          waveBookAt(name);
          const drawn = drawLetter(name, one, formFor(name))!;
          if (signatureText(drawn.contours) !== own.get(name)) wrong.push(`${name} ${label}`);
          if (drawn.contours.some((contour) => contoursIntersect([contour])))
            wrong.push(`${name} ${label} crosses itself`);
          pages.recording = false;
        }
      }
    } finally {
      openWaveBook(was);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("is lighter at a hundred than at four, and at four than at nine, at every width", async () => {
    const inkOf = async (name: string, forge: Forge): Promise<number> => {
      const drawn = draw(name, forge);
      if (!drawn || drawn.contours.length === 0) return 0;
      const merged = await removeOverlaps(drawn.contours, "winding");
      return merged.reduce((sum, contour) => sum + contourArea(contour), 0);
    };
    const uneven: string[] = [];
    for (const width of WIDTHS) {
      const [thin, regular, heavy] = [100, 400, 900].map((weight) =>
        weighted(document, weight, width),
      );
      for (const name of OURS) {
        const ink = [await inkOf(name, thin), await inkOf(name, regular), await inkOf(name, heavy)];
        if (!(ink[0] < ink[1] && ink[1] < ink[2])) uneven.push(`${name} at ${width}`);
      }
    }
    expect(uneven).toEqual([]);
  }, 120_000);

  it("gives the health walk nothing to say, as it ships and at every pen and width", () => {
    const found: string[] = [];
    for (const { pen, width } of [{ pen: 84, width: 100 }, ...SETTINGS]) {
      for (const trouble of troubles(startFrom(at(pen, width))))
        found.push(`${pen}/${width}: ${trouble.what} (${trouble.letters.join(" ")})`);
    }
    expect(found).toEqual([]);
  }, 300_000);

  it("holds nothing still in a variable export", async () => {
    const forge = { ...startFrom(FACE), family: { drawn: 400, also: [100, 700, 900] } };
    const delivered = await deliver(forge, { familyName: "Soft", format: "ttf", variable: true });
    expect(delivered.members.map((one) => one.weight)).toEqual([100, 400, 700, 900]);
    expect(delivered.held).toEqual([]);
  }, 300_000);
});

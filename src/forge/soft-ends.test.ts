/**
 * The soft finishes on an end: a seen cut's corners rounded (`terminal.soft`),
 * a curved end tapered (`terminal.taper`) and an arm swelled toward its beak
 * (`slab.swell`).
 *
 * Each is checked for what it draws -- the corners gone, the end narrower on
 * the end it had, the arm wider where the beak hangs and still on its line --
 * and for what it must not change: the nodes a letter is drawn with, at every
 * weight and width, with a wave book read back and without, so a variable
 * font can still be made of it; and no letter crossing itself.
 */

import { describe, expect, it } from "vitest";

import { contoursIntersect } from "@/font/outline";
import type { Contour, GlyphNode, Vec2 } from "@/font/types";
import { makeLetter } from "./build";
import { widthedStyle } from "./family";
import { openWaveBook, type WaveBook, waveBookAt } from "./shapes";
import { flatten, windingAt } from "./soft";
import { BASES, SANS, SERIF, type Style } from "./style";
import { sweep } from "./sweep";
import { foldSweep, withField } from "./testing/fold-sweep";
import { signatureText } from "./testing/signature";
import type { Pen, Stroke, Terminal } from "./types";

/** A face with the three end finishes set. */
function finished(base: Style, soft: number, taper: number, swell: number): Style {
  return withField(
    withField(withField(base, "terminal.soft", soft), "terminal.taper", taper),
    "slab.swell",
    swell,
  );
}

const atPen = (style: Style, weight: number): Style => ({
  ...style,
  pen: { ...style.pen, weight },
});

const SANS_SERIFS = withField(SANS, "slab.on", true);

/** A letter's runs, moved back by however far the drawing was slid to fit. */
function runsOf(name: string, style: Style): Contour[][] {
  const made = makeLetter(name, style, style.forms?.[name])!;
  return made.runs.map((run) =>
    run.contours.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        ...node,
        point: { x: node.point.x - made.slide, y: node.point.y },
        handleIn: node.handleIn && { x: node.handleIn.x - made.slide, y: node.handleIn.y },
        handleOut: node.handleOut && { x: node.handleOut.x - made.slide, y: node.handleOut.y },
      })),
    })),
  );
}

const unit = (v: Vec2): Vec2 => {
  const length = Math.hypot(v.x, v.y);
  return { x: v.x / length, y: v.y / length };
};
const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

function bezier(a: GlyphNode, b: GlyphNode, t: number): Vec2 {
  const p1 = a.handleOut ?? a.point;
  const p2 = b.handleIn ?? b.point;
  const u = 1 - t;
  return {
    x: u * u * u * a.point.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.point.x,
    y: u * u * u * a.point.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.point.y,
  };
}

/** How far a point lies from the line through two others. */
function offLine(point: Vec2, a: Vec2, b: Vec2): number {
  return Math.abs(cross(unit(minus(b, a)), minus(point, a)));
}

/**
 * A point `by` in from a corner of a contour, along the corner's bisector:
 * halfway between the ways its two edges leave it.
 */
function inward(nodes: GlyphNode[], corner: Vec2, by: number): Vec2 {
  const count = nodes.length;
  const at = nodes.findIndex(
    (node) => Math.hypot(node.point.x - corner.x, node.point.y - corner.y) < 1e-9,
  );
  const node = nodes[at];
  const before = nodes[(at - 1 + count) % count];
  const after = nodes[(at + 1) % count];
  const back = unit(minus(node.handleIn ?? before.handleOut ?? before.point, corner));
  const on = unit(minus(node.handleOut ?? after.handleIn ?? after.point, corner));
  const way = unit({ x: back.x + on.x, y: back.y + on.y });
  return { x: corner.x + way.x * by, y: corner.y + way.y * by };
}

const nodeCount = (contours: Contour[]): number =>
  contours.reduce((sum, contour) => sum + contour.nodes.length, 0);

describe("a softened corner", () => {
  const STROKE_PENS: Pen[] = [12, 92, 190, 260].map((weight) => ({
    weight,
    contrast: 0.55,
    angle: 8,
  }));
  const strokeOf = (pen: Pen, end: Terminal, start: Terminal = { kind: "butt" }): Stroke => ({
    spine: {
      segments: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 300, y: 0 } }],
      closed: false,
    },
    pen,
    start,
    end,
  });
  const SOFT: Terminal = { kind: "butt", open: true, soft: { left: 10, right: 10 } };

  it("adds one node a corner, and the same nodes at every pen", () => {
    const signatures = STROKE_PENS.map((pen) => {
      const [plain] = sweep(strokeOf(pen, { kind: "butt" }));
      const [soft] = sweep(strokeOf(pen, SOFT));
      expect(soft.nodes.length).toBe(plain.nodes.length + 2);
      const [both] = sweep(strokeOf(pen, SOFT, SOFT));
      expect(both.nodes.length).toBe(plain.nodes.length + 4);
      return signatureText([soft]);
    });
    expect(new Set(signatures).size).toBe(1);
  });

  it("stays inside the cut it rounds, and leaves both edges in their own direction", () => {
    for (const pen of STROKE_PENS) {
      const [plain] = sweep(strokeOf(pen, { kind: "butt" }));
      const [soft] = sweep(strokeOf(pen, SOFT));
      // The plain outline is a parallelogram, wound one way: inside is one side of every edge.
      const corners = plain.nodes.map((node) => node.point);
      const inside = (point: Vec2): boolean =>
        corners.every((a, k) => {
          const b = corners[(k + 1) % corners.length];
          const sense = Math.sign(
            cross(minus(corners[1], corners[0]), minus(corners[2], corners[1])),
          );
          return cross(unit(minus(b, a)), minus(point, a)) * sense >= -1e-9;
        });
      let curves = 0;
      const count = soft.nodes.length;
      for (let k = 0; k < count; k++) {
        const a = soft.nodes[k];
        const b = soft.nodes[(k + 1) % count];
        if (a.handleOut === null && b.handleIn === null) continue;
        curves++;
        for (let step = 0; step <= 64; step++) expect(inside(bezier(a, b, step / 64))).toBe(true);
        // G1 where the curve leaves the side and arrives on the cut.
        const before = soft.nodes[(k - 1 + count) % count];
        const after = soft.nodes[(k + 2) % count];
        const leaving = unit(minus(a.handleOut!, a.point));
        const arriving = unit(minus(b.point, b.handleIn!));
        expect(Math.abs(cross(unit(minus(a.point, before.point)), leaving))).toBeLessThan(1e-9);
        expect(Math.abs(cross(arriving, unit(minus(after.point, b.point))))).toBeLessThan(1e-9);
      }
      expect(curves).toBe(2);
    }
  });

  it("keeps its node and its curve however little it is rounded, and is nothing at nought", () => {
    const [plain] = sweep(strokeOf(STROKE_PENS[1], { kind: "butt" }));
    const [least] = sweep(strokeOf(STROKE_PENS[1], { kind: "butt", soft: { left: 1e-12 } }));
    expect(least.nodes.length).toBe(plain.nodes.length + 1);
    expect(signatureText([least])).toMatch(/c/);
    const [none] = sweep(strokeOf(STROKE_PENS[1], { kind: "butt", soft: { left: 0 } }));
    expect(none).toEqual(plain);
  });
});

describe("softened ends on the Serif", () => {
  const soft = atPen(finished(SERIF, 0.3, 0, 0), 87);
  const plain = atPen(SERIF, 87);

  it("takes the square corners off the f's crossbar and the t's flag", () => {
    for (const [name, run, pick] of [
      // The crossbar's far end: its two corners furthest right.
      [
        "f",
        1,
        (nodes: GlyphNode[]) => [...nodes].sort((a, b) => b.point.x - a.point.x).slice(0, 2),
      ],
      // The t's flag at the head: the corner on the inside of its curve, the top left.
      [
        "t",
        1,
        (nodes: GlyphNode[]) =>
          [...nodes].sort((a, b) => b.point.y - a.point.y || a.point.x - b.point.x).slice(0, 1),
      ],
      // And the t's crossbar, at its free end.
      [
        "t",
        2,
        (nodes: GlyphNode[]) => [...nodes].sort((a, b) => b.point.x - a.point.x).slice(0, 2),
      ],
    ] as const) {
      const was = runsOf(name, plain)[run][0].nodes;
      const before = flatten(runsOf(name, plain).flat());
      const ink = flatten(runsOf(name, soft).flat());
      for (const corner of pick(was)) {
        // A unit in from the corner, toward the middle of its stroke: ink before, paper now.
        const inside = inward(was, corner.point, 1);
        const label = `${name} ${run} ${JSON.stringify(corner.point)}`;
        expect(windingAt(before, inside), label).not.toBe(0);
        expect(windingAt(ink, inside), label).toBe(0);
      }
    }
  });

  it("rounds the bump beside the n's notch and leaves its flag's corner where it was", () => {
    const was = runsOf("n", plain)[0][0];
    const now = runsOf("n", soft)[0][0];
    expect(now.nodes.length).toBe(was.nodes.length + 1);
    const top = Math.max(...was.nodes.map((node) => node.point.y));
    const [high] = was.nodes.filter((node) => node.point.y === top);
    const low = was.nodes
      .filter((node) => node.point.y > top - 60 && node.point.y < top - 1e-6)
      .sort((a, b) => a.point.x - b.point.x)[0];
    // The right corner of the head is gone from the stem...
    const inside = inward(was.nodes, high.point, 1);
    expect(windingAt(flatten([was]), inside)).not.toBe(0);
    expect(windingAt(flatten([now]), inside)).toBe(0);
    // ...and the sunk corner on the flag's side is exactly where it was.
    expect(
      now.nodes.some(
        (node) => Math.hypot(node.point.x - low.point.x, node.point.y - low.point.y) < 1e-9,
      ),
    ).toBe(true);
  });
});

describe("an arm swelled toward its beak", () => {
  for (const weight of [84, 87]) {
    it(`widens the E's arms where the beak hangs and keeps them on their lines, at ${weight}`, () => {
      const plain = runsOf("E", atPen(SERIF, weight));
      const swelled = runsOf("E", atPen(finished(SERIF, 0, 0, 0.3), weight));
      // The top arm: its edge on the cap height stays there; the one under it flares.
      const was = plain[1][0].nodes.map((node) => node.point);
      const arm = swelled[1][0].nodes.map((node) => node.point);
      expect(arm.length).toBe(was.length);
      const root = Math.min(...arm.map((point) => point.x));
      const end = Math.max(...arm.map((point) => point.x));
      const near = (x: number) => (point: Vec2) => Math.abs(point.x - x) < 1;
      const top = Math.max(...was.map((point) => point.y));
      const halfAtRoot = (top - Math.min(...was.filter(near(root)).map((p) => p.y))) / 2;
      const spine = top - halfAtRoot;
      const bottomAtEnd = Math.min(...arm.filter(near(end)).map((point) => point.y));
      const bottomAtRoot = Math.min(...arm.filter(near(root)).map((point) => point.y));
      expect(Math.max(...arm.map((point) => point.y))).toBeCloseTo(top, 9);
      expect((spine - bottomAtEnd) / halfAtRoot).toBeGreaterThanOrEqual(1.25);

      // The beak's hollow arrives on the flared edge, a hair inside it as on a plain arm.
      const bottomRoot = arm.find((point) => near(root)(point) && point.y === bottomAtRoot)!;
      const bottomEnd = arm.find((point) => near(end)(point) && point.y === bottomAtEnd)!;
      // The wing reaching furthest down is the beak; the other is buried in the arm.
      const lowest = (contour: Contour) => Math.min(...contour.nodes.map((node) => node.point.y));
      const beak = swelled[1].slice(1).sort((a, b) => lowest(a) - lowest(b))[0];
      // The hollow is the wing's one curve: one end on the beak's tip, the other on the arm.
      const ends = beak.nodes.filter(
        (node) => (node.handleIn === null) !== (node.handleOut === null),
      );
      const meet = Math.min(...ends.map((node) => offLine(node.point, bottomRoot, bottomEnd)));
      expect(ends.length).toBe(2);
      expect(meet).toBeLessThanOrEqual(0.5 + 1e-6);
    });
  }
});

describe("a tapered end", () => {
  it("draws the c's foot in to the end it had, from a point where its inner side does not kink", () => {
    const plain = runsOf("c", atPen(SERIF, 87))[0][0];
    const tapered = runsOf("c", atPen(finished(SERIF, 0, 0.7, 0), 87))[0][0];
    expect(signatureText([tapered])).toBe(signatureText([plain]));
    // The two cuts are the outline's two straight edges; the foot is the lower.
    const cuts = (contour: Contour) =>
      contour.nodes
        .map((_, k) => [k, (k + 1) % contour.nodes.length])
        .filter(([k, next]) => !contour.nodes[k].handleOut && !contour.nodes[next].handleIn)
        .sort(([a], [b]) => contour.nodes[a].point.y - contour.nodes[b].point.y)[0];
    const [k, next] = cuts(plain);
    const [o, q] = [plain.nodes[k].point, plain.nodes[next].point];
    const [o2, q2] = [tapered.nodes[k].point, tapered.nodes[next].point];
    const before = Math.hypot(q.x - o.x, q.y - o.y);
    const after = Math.hypot(q2.x - o2.x, q2.y - o2.y);
    expect(after).toBeLessThanOrEqual(0.35 * before);
    // The outer corner stays, and the inner one is on the end as it was.
    expect(Math.hypot(o2.x - o.x, o2.y - o.y)).toBeLessThan(1e-9);
    expect(offLine(q2, o, q)).toBeLessThan(1e-6);
    // Walked back up the inner side, the first node not moved is where the
    // taper begins, and the side keeps its direction through it.
    const count = plain.nodes.length;
    let at = next;
    while (
      Math.hypot(
        tapered.nodes[at].point.x - plain.nodes[at].point.x,
        tapered.nodes[at].point.y - plain.nodes[at].point.y,
      ) > 1e-9
    ) {
      at = (at + 1) % count;
      expect(at).not.toBe(k);
    }
    const p0 = tapered.nodes[at];
    expect(at).not.toBe(next);
    expect(
      Math.abs(cross(unit(minus(p0.point, p0.handleIn!)), unit(minus(p0.handleOut!, p0.point)))),
    ).toBeLessThan(1e-9);
  });
});

/** The finishes on, in the middle of their range. */
const ON = (base: Style) => finished(base, 0.3, 0.5, 0.3);
const LETTERS = [..."acefnrstE"];
const PENS = [30, 60, 87, 142, 194, 260];
const WIDTHS = [75, 100, 125];
const FACES: Array<[string, Style]> = [
  ["Serif", SERIF],
  ["Sans with serifs", SANS_SERIFS],
  ["Sans", SANS],
];

/** Every setting a letter is drawn at: each pen at each width, and a wave book read back. */
function everySetting(
  name: string,
  style: Style,
  form: string | undefined,
  draw: (tag: string, drawn: Contour[]) => void,
) {
  for (const pen of PENS) {
    for (const width of WIDTHS) {
      const made = makeLetter(name, widthedStyle(atPen(style, pen), width), form)!;
      draw(`p${pen}w${width}`, made.contours);
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
    draw("book-own", makeLetter(name, style, form)!.contours);
    book.recording = false;
    for (const pen of [30, 260]) {
      waveBookAt(name);
      draw(`book-p${pen}`, makeLetter(name, widthedStyle(atPen(style, pen), 100), form)!.contours);
    }
  } finally {
    openWaveBook(was);
  }
}

/**
 * Which settings a letter is drawn with the same nodes at, as groups of tags.
 * A letter with the same nodes everywhere is one group; a few letters already
 * differ between some settings before any finish is on, and the finishes must
 * not part them any further.
 */
function partition(
  name: string,
  style: Style,
  form: string | undefined,
): { groups: string[]; signatures: string[] } {
  const seen = new Map<string, string[]>();
  everySetting(name, style, form, (tag, contours) => {
    const signature = signatureText(contours);
    seen.set(signature, [...(seen.get(signature) ?? []), tag]);
  });
  return {
    groups: [...seen.values()].map((tags) => tags.join(",")).sort(),
    signatures: [...seen.keys()].sort(),
  };
}

describe("the same nodes at every weight", () => {
  for (const [label, base] of FACES) {
    it(`on the ${label}, for ${LETTERS.join("")}, with the wave book and without`, {
      timeout: 120_000,
    }, () => {
      const parted: string[] = [];
      let finished = 0;
      for (const name of LETTERS) {
        const own = base.forms?.[name];
        for (const form of own ? [undefined, own] : [undefined]) {
          const was = partition(name, base, form);
          const now = partition(name, ON(base), form);
          if (JSON.stringify(now.groups) !== JSON.stringify(was.groups)) {
            parted.push(
              `${name}/${form ?? "-"}: ${now.groups.length} against ${was.groups.length}`,
            );
          }
          // And drawn with the finishes' own nodes: a softened corner is one more.
          if (JSON.stringify(now.signatures) !== JSON.stringify(was.signatures)) finished++;
        }
      }
      expect(parted).toEqual([]);
      expect(finished).toBeGreaterThan(0);
    });
  }

  it("and the finishes are there at every one of them", { timeout: 60_000 }, () => {
    const missing: string[] = [];
    for (const name of [..."cfnrtE"]) {
      const form = SERIF.forms?.[name];
      for (const pen of PENS) {
        for (const width of WIDTHS) {
          const plain = makeLetter(name, widthedStyle(atPen(SERIF, pen), width), form)!;
          const on = makeLetter(name, widthedStyle(atPen(ON(SERIF), pen), width), form)!;
          if (JSON.stringify(plain.contours) === JSON.stringify(on.contours)) {
            missing.push(`${name} p${pen}w${width}`);
          }
          // Every one of these has a softened corner on a stroke, which is a node more.
          const swept = (made: typeof on) => nodeCount(made.runs.map((run) => run.contours[0]));
          if (name !== "E" && swept(on) <= swept(plain)) {
            missing.push(`${name} p${pen}w${width} has no softened corner`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("a corner whose side ends on a sliver", () => {
  /*
   * A curved stroke ending on what its pieces leave over -- a sliver of arc,
   * of no length at one weight and a few units at the next, as a c's foot
   * does -- softened at its end.
   */
  const strokeOf = (sliver: number): Stroke => ({
    spine: {
      segments: [
        {
          kind: "arc",
          centre: { x: 0, y: 0 },
          radius: 200,
          startAngle: 0,
          endAngle: (80 * Math.PI) / 180,
          sweepPositive: true,
        },
        {
          kind: "arc",
          centre: { x: 0, y: 0 },
          radius: 200,
          startAngle: (80 * Math.PI) / 180,
          endAngle: ((80 + sliver) * Math.PI) / 180,
          sweepPositive: true,
        },
      ],
      closed: false,
    },
    pen: { weight: 60, contrast: 0.5, angle: 8 },
    start: { kind: "butt" },
    end: { kind: "butt", open: true, soft: { left: 10, right: 10 } },
  });
  const SLIVERS = [0, 0.3, 1, 3];

  it("is rounded as far along the side as along the cut, whatever the sliver", () => {
    const signatures = SLIVERS.map((sliver) => {
      const [outline] = sweep(strokeOf(sliver));
      const count = outline.nodes.length;
      const angle = ((80 + sliver) * Math.PI) / 180;
      const tip = { x: 200 * Math.cos(angle), y: 200 * Math.sin(angle) };
      // The end's cut: the one straight edge of any length beside the spine's end.
      const cut = outline.nodes.findIndex((node, k) => {
        const next = outline.nodes[(k + 1) % count];
        return (
          node.handleOut === null &&
          next.handleIn === null &&
          Math.hypot(next.point.x - node.point.x, next.point.y - node.point.y) > 1 &&
          Math.hypot(node.point.x - tip.x, node.point.y - tip.y) < 40
        );
      });
      expect(cut).toBeGreaterThanOrEqual(0);
      // Either side of it, a rounding, its two handles as long as each other.
      for (const [from, to] of [
        [(cut - 1 + count) % count, cut],
        [(cut + 1) % count, (cut + 2) % count],
      ]) {
        const a = outline.nodes[from];
        const b = outline.nodes[to];
        const leaving = Math.hypot(a.handleOut!.x - a.point.x, a.handleOut!.y - a.point.y);
        const arriving = Math.hypot(b.handleIn!.x - b.point.x, b.handleIn!.y - b.point.y);
        expect(leaving / arriving).toBeCloseTo(1, 6);
      }
      return signatureText([outline]);
    });
    expect(new Set(signatures).size).toBe(1);
  });
});

describe("no letter crosses itself", () => {
  /** Whether a field at a value draws a letter of the Serif differently. */
  const shows = (field: string, value: number, name: string): boolean => {
    const style = withField(SERIF, field, value);
    const form = SERIF.forms?.[name];
    return (
      JSON.stringify(makeLetter(name, style, form)!.contours) !==
      JSON.stringify(makeLetter(name, SERIF, form)!.contours)
    );
  };

  it("as the corners are softened", { timeout: 300_000 }, () => {
    expect(shows("terminal.soft", 0.5, "f")).toBe(true);
    expect(foldSweep("terminal.soft", [0.25, 0.5])).toEqual([]);
  });

  it("as the curved ends are tapered", { timeout: 300_000 }, () => {
    expect(shows("terminal.taper", 0.85, "c")).toBe(true);
    expect(foldSweep("terminal.taper", [0.425, 0.85])).toEqual([]);
  });

  it("as the arms are swelled", { timeout: 300_000 }, () => {
    expect(shows("slab.swell", 0.6, "E")).toBe(true);
    expect(foldSweep("slab.swell", [0.3, 0.6])).toEqual([]);
  });
});

describe("each finish on its own", () => {
  /*
   * The three together are checked above; each here alone, so that none of
   * them can go missing behind the other two. Softened corners are nodes more
   * on a stroke; a swell moves the nodes there are, and so does a taper, which
   * also drops the sliver of serif refused on the curve it draws in.
   */
  const swept = (made: ReturnType<typeof makeLetter>) =>
    nodeCount(made!.runs.map((run) => run.contours[0]));
  for (const [field, value, letters, adds] of [
    ["terminal.soft", 0.3, [..."cfnrt"], true],
    ["terminal.taper", 0.5, [..."ct"], false],
    ["slab.swell", 0.3, ["E"], false],
  ] as const) {
    it(`${field} draws ${letters.join("")} differently at every pen and width`, {
      timeout: 60_000,
    }, () => {
      const missing: string[] = [];
      const on = withField(SERIF, field, value);
      for (const name of letters) {
        const form = SERIF.forms?.[name];
        for (const pen of PENS) {
          for (const width of WIDTHS) {
            const plain = makeLetter(name, widthedStyle(atPen(SERIF, pen), width), form)!;
            const now = makeLetter(name, widthedStyle(atPen(on, pen), width), form)!;
            const label = `${name} p${pen}w${width}`;
            if (JSON.stringify(plain.contours) === JSON.stringify(now.contours)) {
              missing.push(label);
            }
            if (adds && swept(now) <= swept(plain)) missing.push(`${label} has no node more`);
            // Nor are the swelled arms' nodes any but the plain arms'.
            if (field === "slab.swell" && swept(now) !== swept(plain)) {
              missing.push(`${label} changed its nodes`);
            }
          }
        }
      }
      expect(missing).toEqual([]);
    });
  }
});

/** A base by its name. */
const baseNamed = (name: string): Style => {
  const found = BASES.find((one) => one.name === name);
  if (!found) throw new Error(`no base named ${name}`);
  return found;
};

describe("a long hook tapered as far as it goes", () => {
  /*
   * A question mark's hook ends on a curve that has turned through three
   * quarters of a circle, and drawn in nearly all the way its inner side ran
   * out across the outer one near the top: measured without a sign, a point
   * gone through the outer side stood as far off it as one well inside it.
   */
  const CASES: Array<[string, number[], number[]]> = [
    ["Display", [142, 194], [0.85]],
    ["Geometric", [194], [0.85]],
    ["Technical", [194], [0.85]],
    ["Slab", [194], [0.85]],
    ["Typewriter", [194], [0.85]],
    ["Wavy", [194], [0.85]],
    ["Handwriting", [30, 87, 142, 194], [0.75, 0.85]],
  ];

  it("does not cross itself, and is still tapered", { timeout: 180_000 }, () => {
    const crossed: string[] = [];
    const untouched: string[] = [];
    for (const [face, pens, values] of CASES) {
      const plain = baseNamed(face);
      for (const value of values) {
        const style = withField(plain, "terminal.taper", value);
        for (const name of ["question", "questiondown"]) {
          for (const pen of pens) {
            for (const width of WIDTHS) {
              const label = `${face} ${name} ${value} p${pen}w${width}`;
              const at = (one: Style) => widthedStyle(atPen(one, pen), width);
              const drawn = makeLetter(name, at(style))!;
              if (drawn.contours.some((contour) => contoursIntersect([contour]))) {
                crossed.push(label);
              }
              const was = makeLetter(name, at(plain))!;
              if (JSON.stringify(drawn.contours) === JSON.stringify(was.contours)) {
                untouched.push(label);
              }
            }
          }
        }
      }
    }
    expect(crossed).toEqual([]);
    expect(untouched).toEqual([]);
  });
});

describe("the same nodes where the pen moves an end", () => {
  /*
   * Letters whose ends the pen and the width move in ways the plain drawing
   * hides. A squarish c's foot and a pound sign's top, cut out of a bowl, end
   * on the bowl's curve at most widths and on its upright side at a narrow
   * one, where `endsStraight` calls them straight; and the flag of a one on a
   * grotesque is drawn from one corner at one width and from the next corner
   * round at another. Each keeps the settings it shares its nodes at with
   * every finish on.
   */
  const CASES: Array<[string, string[]]> = [
    ["Slab", ["c", "sterling"]],
    ["Typewriter", ["c", "sterling"]],
    ["Grotesque", ["one"]],
    ["Technical", ["one", "onesuperior", "onequarter", "onehalf"]],
    ["Ribbon", ["onesuperior", "onequarter", "onehalf"]],
    ["Marker", ["onesuperior"]],
  ];

  for (const [face, names] of CASES) {
    it(`on the ${face}, for ${names.join(", ")}`, { timeout: 180_000 }, () => {
      const parted: string[] = [];
      const style = baseNamed(face);
      for (const name of names) {
        const form = style.forms?.[name];
        const was = partition(name, style, form);
        for (const on of [ON(style), finished(style, 0.5, 0.85, 0.6)]) {
          const now = partition(name, on, form);
          if (JSON.stringify(now.groups) !== JSON.stringify(was.groups)) {
            parted.push(`${name}/${form ?? "-"}: ${now.groups.join(" | ")}`);
          }
        }
      }
      expect(parted).toEqual([]);
    });
  }
});

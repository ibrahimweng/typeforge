/**
 * The cut and cast layers held to the finish a foundry would send out.
 *
 * Each of these is a fault that was plainly visible on the page: a groove and
 * a rim that turned every o into a black disc, breaks that slashed a stem or
 * left a g in three pieces, fillets grown across a gap the split had just
 * opened, a crown of spikes on every chamfered corner, a rim that shut the
 * eye of a Black e, slivers left by an angled slot and a motif shrunk to a
 * speck. Each is checked on the letter it was seen on.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { unite } from "@/font/boolean";
import {
  contourArea,
  contourContainsPoint,
  contoursBounds,
  flattenContour,
  inkRunsAt,
} from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { draw, editCast, editCut, proof, setCastOrder, startFrom, type Forge } from "./document";
import { readyToShape } from "./layers";
import { piecesOf } from "./cut";
import { BASES } from "./style";

beforeAll(async () => {
  await readyToShape();
});

type Row = {
  cuts?: Record<string, Record<string, unknown>>;
  cast?: Record<string, Record<string, unknown>>;
  order?: "after" | "before";
};

function forgeOf(face: string, weight: number, row: Row): Forge {
  let forge = startFrom(BASES.find((base) => base.name === face)!);
  forge = { ...forge, style: { ...forge.style, pen: { ...forge.style.pen, weight } } };
  for (const [name, patch] of Object.entries(row.cuts ?? {})) {
    forge = editCut(forge, name as never, { on: true, ...patch } as never);
  }
  for (const [name, patch] of Object.entries(row.cast ?? {})) {
    forge = editCast(forge, name as never, { on: true, ...patch } as never);
  }
  if (row.order) forge = setCastOrder(forge, row.order);
  return forge;
}

function drawn(letter: string, forge: Forge): Contour[] {
  const made = proof(letter, forge);
  if (!made) throw new Error(`${letter} did not draw`);
  return made.contours;
}

const area = (contours: Contour[]): number =>
  unite(contours, "winding").reduce((total, contour) => total + contourArea(contour), 0);
const counters = (contours: Contour[]): number[] =>
  unite(contours, "winding")
    .map((contour) => -contourArea(contour))
    .filter((one) => one > 0);

describe("inline with a rim thrown after it", () => {
  it("keeps the counter of an o and of a g bowl open", () => {
    for (const [face, weight] of [
      ["Sans", 87],
      ["Sans", 30],
      ["Serif", 87],
    ] as const) {
      const row: Row = { cuts: { inline: {} }, cast: { outline: {} }, order: "after" };
      const rimmed = forgeOf(face, weight, row);
      const plain = forgeOf(face, weight, {});
      for (const letter of face === "Sans" ? "og" : "o") {
        const open = Math.max(0, ...counters(drawn(letter, plain)));
        const kept = Math.max(0, ...counters(drawn(letter, rimmed)));
        // The rim grows the counter in a little; it must not fill it.
        expect(kept, `${face} ${weight} ${letter}`).toBeGreaterThan(open * 0.5);
      }
    }
  });
});

describe("a rim grown round an inline", () => {
  it("keeps every groove open, round an island of ink as round a counter", () => {
    /*
     * The groove round the counter of an o, an e or a B leaves the counter's
     * wall standing in it as an island. The rim read the groove as deep as
     * the whole bowl, grew it shut from outside while the island grew into it
     * from inside, and the letters came back as solid blobs; and paper lost
     * the loop round the groove of an e, which filled it just the same.
     */
    for (const weight of [87, 30]) {
      const cut = forgeOf("Sans", weight, { cuts: { inline: {} } });
      const rimmed = forgeOf("Sans", weight, {
        cuts: { inline: {} },
        cast: { outline: {} },
        order: "after",
      });
      for (const letter of "oeabgRB") {
        expect(counters(drawn(letter, rimmed)).length, `${weight} ${letter}`).toBe(
          counters(drawn(letter, cut)).length,
        );
      }
    }
  });
});

describe("the inline on a contrast face", () => {
  it("runs down the thick strokes and leaves the hairlines alone", () => {
    for (const weight of [87, 200]) {
      const forge = forgeOf("Serif", weight, { cuts: { inline: {} } });
      // The stem of an E is grooved; its three hairline arms are not.
      expect(counters(drawn("E", forge)).length, `E at ${weight}`).toBe(1);
    }
  });

  it("still grooves every stroke of a face without contrast", () => {
    const forge = forgeOf("Sans", 87, { cuts: { inline: {} } });
    const plain = unite(drawn("E", forgeOf("Sans", 87, {})), "winding");
    const cut = unite(drawn("E", forge), "winding");
    // Down a line through the three arms: each is one run of ink uncut, and
    // two walls either side of a groove cut.
    const box = contoursBounds(plain);
    const x = box.xMin + (box.xMax - box.xMin) * 0.6;
    const arms = runsDown(plain, x, box);
    expect(arms.length).toBe(3);
    for (const [from, to] of arms) {
      expect(inkAt(cut, { x, y: (from + to) / 2 }), `arm at ${Math.round(from)}`).toBe(false);
      expect(runsDown(cut, x, { ...box, yMin: from - 1, yMax: to + 1 }).length).toBe(2);
    }
  });
});

/** Whether a point is ink: inside an odd number of the fused outlines. */
function inkAt(contours: Contour[], point: Vec2): boolean {
  return contours.filter((contour) => contourContainsPoint(contour, point)).length % 2 === 1;
}

/** The runs of ink down a vertical line, a unit at a time. */
function runsDown(
  contours: Contour[],
  x: number,
  box: { yMin: number; yMax: number },
): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start: number | null = null;
  for (let y = box.yMin - 2; y <= box.yMax + 2; y += 1) {
    const here = inkAt(contours, { x, y });
    if (here && start === null) start = y;
    if (!here && start !== null) {
      runs.push([start, y - 1]);
      start = null;
    }
  }
  return runs;
}

describe("the inline on a heavy face", () => {
  it("grooves every stem of a Black m down to its foot", () => {
    // A mask swept down each stroke crossed itself on the tight arches and
    // cut the grooves of the first two stems off half way down.
    const forge = forgeOf("Sans", 260, { cuts: { inline: {} } });
    const cut = drawn("m", forge);
    for (const y of [120, 250, 380]) {
      expect(inkRunsAt(cut, y).length, `at ${y}`).toBe(6);
    }
  });
});

describe("the split", () => {
  it("takes the bowl off the stem of a b, d, p and q and leaves the stem whole", () => {
    for (const [face, weight] of [
      ["Sans", 87],
      ["Sans", 200],
      ["Serif", 87],
    ] as const) {
      const forge = forgeOf(face, weight, { cuts: { split: {} } });
      const plain = forgeOf(face, weight, {});
      for (const letter of "bdpq") {
        const cut = drawn(letter, forge);
        const box = contoursBounds(cut);
        // The middle of the stem, read where only the stem is: the ascender
        // of a b and d, the descender of a p and q.
        const alone = box.yMin + (box.yMax - box.yMin) * ("bd".includes(letter) ? 0.9 : 0.1);
        const [stemRun] = inkRunsAt(drawn(letter, plain), alone).sort(
          (one, other) => other[1] - other[0] - (one[1] - one[0]),
        );
        const stemAt = (stemRun[0] + stemRun[1]) / 2;
        for (const share of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const y = box.yMin + (box.yMax - box.yMin) * share;
          const runs = inkRunsAt(cut, y).filter(([from, to]) => from <= stemAt && to >= stemAt);
          expect(runs.length, `${face} ${weight} ${letter} at ${share}`).toBe(1);
        }
      }
    }
  });

  it("keeps a two-storey g in one piece and the tail of a Black g whole", () => {
    const serif = forgeOf("Serif", 87, { cuts: { split: {} } });
    expect(piecesOf(drawn("g", serif))).toBe(1);
    const black = forgeOf("Sans", 200, { cuts: { split: {} } });
    // Stem-and-tail in one piece, the bowl in another: two, not four.
    expect(piecesOf(drawn("g", black))).toBe(2);
  });

  it("does not leave a Black r's arm as a crumb or cut an apex into a flag", () => {
    const black = forgeOf("Sans", 200, { cuts: { split: {} } });
    expect(piecesOf(drawn("r", black))).toBe(1);
    // The Serif A's legs meet tip to tip: the apex stays one piece with both
    // legs, and only the crossbar comes away.
    const serif = forgeOf("Serif", 87, { cuts: { split: {} } });
    expect(piecesOf(drawn("A", serif))).toBe(2);
    // And the Serif a keeps its shoulder on its stem: the bowl comes away,
    // nothing is left standing over it.
    expect(piecesOf(drawn("a", serif))).toBe(2);
  });
});

describe("the split where a stroke is drawn over another", () => {
  it("leaves the stem of a Sans a solid, with no hairline down it", () => {
    // Its stem is laid twice -- on its own and as the foot of the arch -- and
    // the break used to cut between the two copies.
    const forge = forgeOf("Sans", 87, { cuts: { split: {} } });
    const plain = drawn("a", forgeOf("Sans", 87, {}));
    const cut = drawn("a", forge);
    const [left, right] = inkRunsAt(plain, 330)
      .filter(([from, to]) => to - from > 10)
      .at(-1)!;
    const middle = (left + right) / 2;
    /*
     * Up the stem as far as the stem goes. The a rebuilt on Geist's measures
     * brings its arch down into the stem on a round shoulder, so at 480 the
     * ink has already turned away left of the stem's middle, cut or not.
     */
    const heights = [120, 330, 420, 480].filter((y) =>
      inkRunsAt(plain, y).some(([from, to]) => from <= middle && to >= middle),
    );
    expect(heights.length).toBeGreaterThanOrEqual(3);
    for (const y of heights) {
      const stem = inkRunsAt(cut, y).find(([from, to]) => from <= middle && to >= middle);
      expect(stem, `at ${y}`).toBeDefined();
      expect(stem![1] - stem![0], `at ${y}`).toBeGreaterThan((right - left) * 0.95);
    }
  });

  it("parts the second arch of an m beside the middle stem, not across the shoulder", () => {
    const forge = forgeOf("Sans", 87, { cuts: { split: {} } });
    const plain = drawn("m", forgeOf("Sans", 87, {}));
    const cut = drawn("m", forge);
    const [left, edge] = inkRunsAt(plain, 150)[1];
    const gap = 87 * 0.45;
    for (const y of [400, 450, 500]) {
      const runs = inkRunsAt(cut, y);
      // The first arch's shoulder stops inside the stem's column, and the
      // second arch starts a gap clear of the stem's side.
      const shoulder = runs.find(([from, to]) => from < left + 5 && to > left + 5);
      const next = runs.find(([from]) => from > left + 5);
      expect(shoulder?.[1], `at ${y}`).toBeLessThan(edge + 1);
      expect(next?.[0], `at ${y}`).toBeGreaterThan(edge + gap * 0.8);
    }
  });
});

describe("the split through a rim thrown first", () => {
  it("cuts through the rim, leaving no hairline across the gap", () => {
    // The rim grown first stood across every gap as a hairline, holding the
    // crossbar of an A and the arm of a k on by a thread.
    for (const weight of [87, 200]) {
      const split = forgeOf("Sans", weight, { cuts: { split: {} } });
      const both = forgeOf("Sans", weight, {
        cuts: { split: {} },
        cast: { outline: {} },
        order: "before",
      });
      for (const letter of "AHk") {
        expect(piecesOf(drawn(letter, both)), `${weight} ${letter}`).toBe(
          piecesOf(drawn(letter, split)),
        );
      }
    }
  });
});

describe("the split on a bowl drawn against its stem", () => {
  it("takes the bowl off at both joins, at every weight", () => {
    // The bowl of a D, P, B and R runs out of the stem and back into it. One
    // of the two joins was broken and the other left, and which depended on
    // the weight: the Black R kept its bowl on at the top.
    for (const weight of [87, 200]) {
      const forge = forgeOf("Sans", weight, { cuts: { split: {} } });
      for (const letter of weight === 200 ? "DPBR" : "DPB") {
        expect(piecesOf(drawn(letter, forge)), `${weight} ${letter}`).toBe(2);
      }
      // And a bar that runs into a bowl at both ends is still parted at one:
      // the bar of an e does not float in its eye.
      expect(piecesOf(drawn("e", forge)), `${weight} e`).toBe(1);
    }
  });
});

describe("the split beside an arch", () => {
  it("leaves the stem no wider than the pen, with no lip below the gap", () => {
    // The foot of the arch curves out of the stem just below the gap, and
    // stood out of its side there as a lip a few units deep.
    for (const [face, weight] of [
      ["Sans", 87],
      ["Sans", 200],
      ["Display", 205],
    ] as const) {
      const forge = forgeOf(face, weight, { cuts: { split: {} } });
      for (const letter of "nhm") {
        const solids = unite(drawn(letter, forge), "winding").filter((one) => contourArea(one) > 0);
        const stem = solids
          .map((one) => contoursBounds([one]))
          .reduce((a, b) => (b.xMin < a.xMin ? b : a));
        expect(stem.xMax - stem.xMin, `${face} ${weight} ${letter}`).toBeLessThan(weight + 0.5);
      }
    }
  });
});

describe("the split on a script", () => {
  it("leaves the short exit flick of an H and an A on, rather than cutting it loose as a dot", () => {
    for (const face of ["Formal Script", "Handwriting"]) {
      const base = BASES.find((one) => one.name === face)!;
      const forge = forgeOf(face, base.pen.weight, { cuts: { split: {} } });
      // H: the bar comes off both stems, and nothing else.
      expect(piecesOf(drawn("H", forge)), `${face} H`).toBe(3);
      // A: the bar comes off, the flick at the foot stays.
      expect(piecesOf(drawn("A", forge)), `${face} A`).toBe(2);
    }
  });

  it("still takes the short square arms off a Display E", () => {
    const forge = forgeOf("Display", BASES.find((one) => one.name === "Display")!.pen.weight, {
      cuts: { split: {} },
    });
    expect(piecesOf(drawn("E", forge))).toBe(4);
  });
});

describe("the tool's own effects on a cut letter", () => {
  it("leave a slotted Formal Script whole, loop and hairlines and all", () => {
    // The Formal Script ships with the press on. After slots, its clean-up
    // took a loop that came back near itself for a splinter and dropped the
    // tail of the g with it: three fifths of the letter gone.
    let forge = startFrom(BASES.find((base) => base.name === "Formal Script")!);
    forge = editCut(forge, "slot", { on: true, count: 3, angle: 15 });
    for (const letter of "msg") {
      const cut = area(draw(letter, forge)!.contours);
      expect(area(drawn(letter, forge)) / cut, letter).toBeGreaterThan(0.9);
    }
  });
});

describe("the weld beside the split", () => {
  it("grows no fillet across a gap the split has opened", () => {
    for (const order of ["after", "before"] as const) {
      const split = forgeOf("Sans", 87, { cuts: { split: {} } });
      const both = forgeOf("Sans", 87, { cuts: { split: {} }, cast: { weld: {} }, order });
      // Every join of this A is either the fold of one stroke or parted by
      // the split, so the weld has nothing to add.
      const before = area(drawn("A", split));
      const after = area(drawn("A", both));
      expect(Math.abs(after - before) / before, order).toBeLessThan(0.002);
      expect(piecesOf(drawn("A", both)), order).toBe(piecesOf(drawn("A", split)));
    }
  });
});

describe("the weld", () => {
  it("leaves the counter of a Serif A open at the largest size and no flag on its apex", () => {
    const plain = forgeOf("Serif", 87, {});
    const welded = forgeOf("Serif", 87, { cast: { weld: { size: 1 } } });
    const open = Math.max(...counters(drawn("A", plain)));
    const kept = Math.max(...counters(drawn("A", welded)));
    // Two fillets at the foot of a narrow counter used to meet in its middle
    // and round it into a hole; held to under half the room, they do not.
    expect(kept).toBeGreaterThan(open * 0.85);
    const top = contoursBounds(drawn("A", plain));
    const weldedTop = contoursBounds(drawn("A", forgeOf("Serif", 87, { cast: { weld: {} } })));
    expect(weldedTop.xMin).toBeGreaterThanOrEqual(top.xMin - 0.5);
    expect(weldedTop.yMax).toBeLessThanOrEqual(top.yMax + 0.5);
  });

  it("lands each fillet on the edge it meets, with no step beside it", () => {
    // The crossbar of the Sans A is thinner than its pen. A fillet built on
    // the pen's width stopped a few units short of the bar's real edge, and
    // left a notch: an outline point sitting just off the bar's top edge.
    const plain = drawn("A", forgeOf("Sans", 87, {}));
    const welded = drawn("A", forgeOf("Sans", 87, { cast: { weld: {} } }));
    // The bar's top edge: the lowest horizontal run of the counter's outline.
    const counter = unite(plain, "winding").find((contour) => contourArea(contour) < 0)!;
    const barTop = Math.min(...counter.nodes.map((node) => node.point.y));
    const near = unite(welded, "winding")
      .flatMap((contour) => contour.nodes.map((node) => node.point))
      .filter((point) => point.y > barTop + 0.5 && point.y < barTop + 8);
    // Nothing standing just above the bar: the arcs come down onto its edge.
    expect(near.length).toBe(0);
  });
});

/** Points of an outline where it turns back sharply: the tips of spikes. */
function tips(contours: Contour[]): number {
  let count = 0;
  for (const contour of contours) {
    const points = flattenContour(contour, 2);
    for (let index = 0; index < points.length; index++) {
      const a = points[(index - 1 + points.length) % points.length];
      const b = points[index];
      const c = points[(index + 1) % points.length];
      const turn = angle(a, b, c);
      if (turn > (105 * Math.PI) / 180) count++;
    }
  }
  return count;
}

function angle(a: Vec2, b: Vec2, c: Vec2): number {
  const u = { x: b.x - a.x, y: b.y - a.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  return Math.abs(Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y));
}

describe("the spur", () => {
  it("grows one point from a chamfered corner, not a crown", () => {
    for (const weight of [87, 200]) {
      const spur = forgeOf("Sans", weight, { cast: { spur: {} } });
      const both = forgeOf("Sans", weight, {
        cuts: { chamfer: {} },
        cast: { spur: {} },
        order: "after",
      });
      // The ends of the arm and leg of a k and the terminals of an a and an
      // e are cut through acute corners, which leaves more corners than two;
      // each that was not paired grew a thorn beside the point. (The Black
      // e's bar end faces its aperture and grows no point uncut, and one cut.)
      for (const letter of weight === 87 ? "HrAkea" : "HrAka") {
        expect(tips(drawn(letter, both)), `${weight} ${letter}`).toBeLessThanOrEqual(
          tips(drawn(letter, spur)),
        );
      }
    }
  });

  it("grows no point into the aperture of a Black e", () => {
    const plain = area(drawn("e", forgeOf("Sans", 200, {})));
    const spurred = area(drawn("e", forgeOf("Sans", 200, { cast: { spur: {} } })));
    // The e's own corners face across its aperture; the old points ran into it.
    expect((spurred - plain) / plain).toBeLessThan(0.01);
  });
});

describe("the rim on a heavy face", () => {
  it("keeps the counters of e and a open", () => {
    const forge = forgeOf("Sans", 200, { cast: { outline: {} } });
    for (const letter of "ea") {
      expect(counters(drawn(letter, forge)).length, letter).toBeGreaterThan(0);
    }
  });
});

describe("slots", () => {
  it("leave no splinter narrower than a hairline", () => {
    const weight = 200;
    const forge = forgeOf("Sans", weight, { cuts: { slot: { count: 3, angle: 15 } } });
    for (const letter of "aeosg") {
      for (const contour of drawn(letter, forge)) {
        const size = contourArea(contour);
        if (size <= 0 || size > weight * weight * 1.5) continue;
        // A splinter is thinner than a third of a stem the narrowest way
        // across it.
        expect(breadthOf(contour), letter).toBeGreaterThan(weight * 0.3);
      }
    }
  });
});

describe("slanted slots", () => {
  it("leave no needle of ink where a band crosses an edge at a shallow angle", () => {
    // A band laid across the top of an r's arm or an A's crossbar at fifteen
    // degrees shaved a wedge off it that tapered to nothing.
    const forge = forgeOf("Sans", 87, { cuts: { slot: { count: 3, angle: 15 } } });
    for (const letter of "Arsea") {
      let needles = 0;
      for (const contour of drawn(letter, forge)) {
        const points = flattenContour(contour, 4);
        for (let index = 0; index < points.length; index++) {
          const a = points[(index - 1 + points.length) % points.length];
          const b = points[index];
          const c = points[(index + 1) % points.length];
          // A needle: sharper than thirty degrees, both of its sides longer
          // than a quarter of a stem. A slot through the slanted cut of a
          // terminal leaves a sharp corner as short as the cut, which is not.
          const long = (p: Vec2) => Math.hypot(p.x - b.x, p.y - b.y) > 87 * 0.25;
          if (angle(a, b, c) > (150 * Math.PI) / 180 && long(a) && long(c)) needles++;
        }
      }
      expect(needles, letter).toBe(0);
    }
  });
});

/** How wide a contour is the narrowest way across its convex hull. */
function breadthOf(contour: Contour): number {
  const sorted = [...flattenContour(contour, 12)].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (points: Vec2[]) => {
    const out: Vec2[] = [];
    for (const point of points) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], point) <= 0)
        out.pop();
      out.push(point);
    }
    return out.slice(0, -1);
  };
  const hull = [...half(sorted), ...half([...sorted].reverse())];
  let least = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const run = Math.hypot(b.x - a.x, b.y - a.y);
    if (run < 1e-6) continue;
    const most = Math.max(...hull.map((p) => Math.abs(cross(a, b, p)) / run));
    least = Math.min(least, most);
  }
  return least;
}

describe("the motif", () => {
  it("never leaves a speck in a small counter", () => {
    const weight = 200;
    for (const shape of ["diamond", "ring"]) {
      const forge = forgeOf("Sans", weight, { cuts: { motif: { shape } } });
      for (const letter of "Aa") {
        for (const hole of counters(drawn(letter, forge))) {
          expect(hole, `${shape} ${letter}`).toBeGreaterThan(weight * weight * 0.15);
        }
      }
    }
  });
});

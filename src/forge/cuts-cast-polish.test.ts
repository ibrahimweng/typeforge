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
import { contourArea, contoursBounds, flattenContour, inkRunsAt } from "@/font/geometry";
import type { Contour, Vec2 } from "@/font/types";
import { editCast, editCut, proof, setCastOrder, startFrom, type Forge } from "./document";
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
    // A stem and three arms, each with its own groove.
    expect(counters(drawn("E", forge)).length).toBeGreaterThanOrEqual(4);
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
      for (const letter of "HrA") {
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

import { beforeAll, describe, expect, it } from "vitest";

import { unite } from "@/font/boolean";
import { readyToShape } from "./layers";
import {
  contourArea,
  contoursBounds,
  contoursToSvgPath,
  flattenContour,
  inkRunsAt,
} from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import type { Contour, Vec2 } from "@/font/types";
import { drawLetter } from "./build";
import { editCast, editCut, editPen, proof, startFrom } from "./document";
import { noEffects } from "./effects";
import { anyCut, noCuts, piecesOf, type Cuts, type MotifShape } from "./cut";
import { weightedStyle } from "./family";
import { BASES, type Style } from "./style";

const sans = BASES.find((base) => base.name === "Sans")!;
const display = BASES.find((base) => base.name === "Display")!;

const ink = (contours: Contour[]): number =>
  Math.abs(contours.reduce((total, contour) => total + contourArea(contour), 0));

const cutWith = (patch: (cuts: Cuts) => void): Cuts => {
  const cuts = noCuts();
  patch(cuts);
  return cuts;
};

function drawn(letter: string, style: Style, cuts?: Cuts) {
  const made = drawLetter(letter, style, undefined, cuts);
  if (!made) throw new Error(`${letter} did not draw`);
  return made;
}

/**
 * How much of a letter one setting takes away, as a share of what was there.
 *
 * Measured against the fused letter rather than against the strokes it was
 * drawn from. A letter here is overlapping pieces, so adding up their areas
 * counts every overlap twice -- and a heavy face overlaps far more than a
 * light one, which made a cut that behaves identically at both weights look
 * like it took a fifth more away from one of them.
 */
function removed(letter: string, style: Style, cuts: Cuts): number {
  const before = ink(unite(drawn(letter, style).contours, "winding"));
  const after = ink(drawn(letter, style, cuts).contours);
  return before > 0 ? 1 - after / before : 0;
}

beforeAll(async () => {
  await readyToShape();
});

describe("the cut layer", () => {
  it("is off to begin with", () => {
    expect(anyCut(noCuts())).toBe(false);
    expect(anyCut(undefined)).toBe(false);
  });

  it("leaves the letter exactly as it was when nothing is on", () => {
    for (const letter of "AEHOSaegno") {
      const plain = drawn(letter, sans);
      const through = drawn(letter, sans, noCuts());
      expect(ink(through.contours)).toBeCloseTo(ink(plain.contours), 6);
      expect(through.advanceWidth).toBeCloseTo(plain.advanceWidth, 6);
    }
  });

  it("never moves a letter or changes its width", () => {
    // The promise the spacing rests on: a cut takes ink away and so it moves
    // the letter's edges, but the letter is placed and spaced by the solid
    // drawing, so nobody cutting slots through a font respaces it by accident.
    const all = cutWith((cuts) => {
      cuts.slot = { on: true, count: 3, width: 0.4, angle: 15, inset: 0.05 };
      cuts.tooth = { on: true, pitch: 0.09, depth: 0.5, edge: "both" };
      cuts.split.on = true;
      cuts.chamfer.on = true;
    });
    for (const letter of "ABEHKMORSaebgnors") {
      expect(drawn(letter, sans, all).advanceWidth).toBeCloseTo(
        drawn(letter, sans).advanceWidth,
        6,
      );
    }
  });
});

describe("slot", () => {
  it("takes ink away and leaves the letter in pieces", () => {
    const cuts = cutWith((one) => {
      one.slot.on = true;
    });
    expect(removed("H", sans, cuts)).toBeGreaterThan(0.05);
    expect(piecesOf(drawn("H", sans, cuts).contours)).toBeGreaterThan(1);
  });

  it("cuts more bands when asked for more", () => {
    const few = cutWith((one) => {
      one.slot = { on: true, count: 2, width: 0.3, angle: 0, inset: 0.1 };
    });
    const many = cutWith((one) => {
      one.slot = { on: true, count: 6, width: 0.3, angle: 0, inset: 0.1 };
    });
    expect(piecesOf(drawn("H", sans, many).contours)).toBeGreaterThan(
      piecesOf(drawn("H", sans, few).contours),
    );
  });

  it("leaves the top and bottom of the letter alone when inset", () => {
    const cuts = cutWith((one) => {
      one.slot = { on: true, count: 2, width: 0.3, angle: 0, inset: 0.3 };
    });
    const before = contoursBounds(drawn("H", sans).contours);
    const after = contoursBounds(drawn("H", sans, cuts).contours);
    expect(after.yMax).toBeCloseTo(before.yMax, 3);
    expect(after.yMin).toBeCloseTo(before.yMin, 3);
  });
});

describe("tooth", () => {
  it("cuts one edge, or both, and leaves the letter the size it was", () => {
    const left = cutWith((one) => {
      one.tooth = { on: true, pitch: 0.1, depth: 0.4, edge: "left" };
    });
    const both = cutWith((one) => {
      one.tooth = { on: true, pitch: 0.1, depth: 0.4, edge: "both" };
    });

    // Both flanks of an H are the same, so sawing both takes about twice as
    // much as sawing one.
    const one = removed("H", sans, left);
    expect(one).toBeGreaterThan(0.01);
    expect(removed("H", sans, both) / one).toBeGreaterThan(1.7);

    /*
     * And the letter still measures the same across.
     *
     * Worth stating because it is the difference between a saw and a trim: the
     * teeth reach in from outside the letter, so the peaks between them are
     * still on the letter's original edge and the silhouette keeps its box.
     */
    const before = contoursBounds(drawn("H", sans).contours);
    const after = contoursBounds(drawn("H", sans, left).contours);
    expect(after.xMin).toBeCloseTo(before.xMin, 3);
    expect(after.xMax).toBeCloseTo(before.xMax, 3);
  });

  it("keeps the letter whole", () => {
    const cuts = cutWith((one) => {
      one.tooth.on = true;
    });
    for (const letter of "HOSaeno") {
      expect(piecesOf(drawn(letter, sans, cuts).contours)).toBe(
        piecesOf(drawn(letter, sans).contours),
      );
    }
  });

  it("runs the same number of teeth down a letter at any weight", () => {
    // Pitch is a share of the x-height rather than of the stem, so a Display
    // gets a saw and not three wedges.
    const cuts = cutWith((one) => {
      one.tooth = { on: true, pitch: 0.1, depth: 0.3, edge: "left" };
    });
    const thin = removed("H", sans, cuts);
    const fat = removed("H", display, cuts);
    expect(Math.abs(thin - fat)).toBeLessThan(0.1);
  });
});

describe("inline", () => {
  it("grooves the letter without breaking it", () => {
    const cuts = cutWith((one) => {
      one.inline.on = true;
    });
    expect(removed("H", sans, cuts)).toBeGreaterThan(0.15);
    expect(piecesOf(drawn("H", sans, cuts).contours)).toBe(1);
  });

  it("breaks out through the ends when the inset is taken off", () => {
    const held = cutWith((one) => {
      one.inline = { on: true, width: 0.34, inset: 0.6 };
    });
    const loose = cutWith((one) => {
      one.inline = { on: true, width: 0.34, inset: 0 };
    });
    expect(piecesOf(drawn("H", sans, held).contours)).toBe(1);
    expect(piecesOf(drawn("H", sans, loose).contours)).toBeGreaterThan(1);
  });
});

describe("split", () => {
  it("takes the arms off a letter that has them", () => {
    const cuts = cutWith((one) => {
      one.split.on = true;
    });
    expect(piecesOf(drawn("E", sans, cuts).contours)).toBeGreaterThan(1);
    expect(piecesOf(drawn("H", sans, cuts).contours)).toBeGreaterThan(1);
  });

  it("breaks the stroke that ends on another, not the one it ends on", () => {
    /*
     * Whichever was shorter used to give way, which says "the arm leaves its
     * stem" on a text face and the opposite on a heavy one: the stem of a
     * Display B is 545 units long and the bowl wrapping round it is 667, so
     * the stem was the shorter of the two and the break went through the
     * backbone of the letter. It came back reading as a 5.
     *
     * The stem is what has to survive, so it is checked directly: ink all the
     * way up the left of the letter, at every height a stem should be at.
     */
    const cuts = cutWith((one) => {
      one.split.on = true;
    });
    for (const letter of ["B", "P", "R"]) {
      const whole = drawn(letter, display).contours;
      const cut = drawn(letter, display, cuts).contours;
      const box = contoursBounds(whole);
      // A hand's width in from the left edge, which is inside the stem on
      // every one of these and outside every bowl.
      const stemAt = box.xMin + display.pen.weight * 0.5;
      for (const share of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        const height = box.yMin + (box.yMax - box.yMin) * share;
        const runs = inkRunsAt(cut, height).filter(([from, to]) => from <= stemAt && to >= stemAt);
        expect(runs.length, `${letter} has no stem at ${Math.round(share * 100)}%`).toBe(1);
      }
    }
  });

  it("leaves a letter drawn in one stroke alone", () => {
    // An o and an S have nothing to break: there is no second stroke to leave.
    const cuts = cutWith((one) => {
      one.split.on = true;
    });
    for (const letter of "oS") {
      expect(removed(letter, sans, cuts)).toBeCloseTo(0, 6);
    }
  });
});

describe("chamfer", () => {
  it("cuts the corners and leaves the round letters alone", () => {
    const cuts = cutWith((one) => {
      one.chamfer.on = true;
    });
    expect(removed("A", sans, cuts)).toBeGreaterThan(0.02);
    expect(removed("o", sans, cuts)).toBeCloseTo(0, 6);
  });

  it("cuts more when asked for more", () => {
    const light = cutWith((one) => {
      one.chamfer = { on: true, size: 0.3 };
    });
    const heavy = cutWith((one) => {
      one.chamfer = { on: true, size: 1.2 };
    });
    expect(removed("E", sans, heavy)).toBeGreaterThan(removed("E", sans, light));
  });

  it("leaves the corners of the counters alone", () => {
    /*
     * A corner of a counter is a corner of the paper, not of the ink: the ink
     * is on the outside of the turn there, and a chamfer is a cut off a corner
     * of ink. So the counters of an A, a B, a D and a P come out exactly the
     * size they went in.
     *
     * They did not, because the test for which side the ink was on was flipped
     * for a counter on top of the counter already running the other way -- and
     * picked out exactly these corners, putting a nick into the stem beside
     * each one.
     */
    const cuts = cutWith((one) => {
      one.chamfer = { on: true, size: 0.6 };
    });
    // Counter by counter, since a point laid beside a serif can close a pocket
    // of paper off into a counter of its own, and that is not this question.
    const counters = (contours: Contour[]): number[] =>
      contours
        .filter((one) => contourArea(one) < 0)
        .map((one) => -contourArea(one))
        .sort((a, b) => b - a);
    const kept = (bare: number[], now: number[]): boolean =>
      bare.every((area) => now.some((other) => Math.abs(other - area) / area < 0.001));
    for (const letter of ["A", "B", "D", "P"]) {
      const bare = counters(unite(drawn(letter, sans).contours, "winding", "whole"));
      const cut = counters(drawn(letter, sans, cuts).contours);
      expect(bare.length, letter).toBeGreaterThan(0);
      expect(kept(bare, cut), `${letter}: ${bare} against ${cut}`).toBe(true);
    }
  });
});

describe("an e cut in any face", () => {
  it("comes out of the union without its outline folded over itself", () => {
    /*
     * The bar of an e used to start exactly on the inside edge of the bowl's
     * left wall, at the one height where that wall runs upright -- a square
     * end laid against a curve at the point it was tangent to it. Fused, the
     * counter came back with a hair of itself folded over the bar, and a Serif
     * `e` crossed itself under the slots, the saw, the breaks and the inline
     * alike. The inline is asked here because it leaves the bar where it was.
     */
    const cuts = cutWith((one) => {
      one.inline.on = true;
    });
    const crossed: string[] = [];
    for (const style of BASES) {
      const made = drawLetter("e", style, undefined, cuts);
      if (!made) continue;
      const folded = made.contours.filter((contour) => contoursIntersect([contour])).length;
      if (folded > 0) crossed.push(style.name);
    }
    expect(crossed).toEqual([]);
  });
});

describe("motif", () => {
  it("replaces the hole rather than filling it in", () => {
    const cuts = cutWith((one) => {
      one.motif.on = true;
    });
    const before = drawn("o", sans).contours;
    const after = drawn("o", sans, cuts).contours;
    const hole = after.find((contour) => contourArea(contour) < 0);
    expect(hole).toBeDefined();
    // A diamond has four corners where a round counter has rather more.
    expect(hole!.nodes.length).toBe(4);
    // And it is smaller than the counter it replaced, so the letter gains ink.
    expect(ink(after)).toBeGreaterThan(ink(before) * 0.99);
  });

  it("offers a geometric vocabulary, and every shape of it lands", () => {
    /*
     * Named for what they are, which is a decision rather than a convenience.
     * A diamond, a lozenge and a chevron are figures that turn up in geometric
     * ornament everywhere there is any and belong exclusively to nobody; the
     * symbol sets a face like this is often reached for alongside carry
     * meaning, and two of them are living alphabets. None of those is in here.
     */
    const shapes: MotifShape[] = [
      "diamond",
      "lozenge",
      "nested",
      "triangle",
      "hourglass",
      "chevron",
      "bars",
      "square",
      "slot",
      "dot",
      "ring",
    ];
    const round = drawn("o", sans).contours;
    for (const shape of shapes) {
      const cuts = cutWith((one) => {
        one.motif = { on: true, shape, size: 1 };
      });
      const after = drawn("o", sans, cuts).contours;
      // The counter is still a hole, and it is a different hole.
      expect(
        after.some((contour) => contourArea(contour) < 0),
        shape,
      ).toBe(true);
      expect(contoursToSvgPath(after), shape).not.toBe(contoursToSvgPath(round));
      // And nothing has burst out of the letter.
      const box = contoursBounds(after);
      const was = contoursBounds(round);
      for (const edge of ["xMin", "xMax", "yMin", "yMax"] as const) {
        expect(box[edge], `${shape} ${edge}`).toBeCloseTo(was[edge], 3);
      }
    }
  });

  it("cuts more than one hole where the shape is more than one piece", () => {
    const count = (shape: MotifShape): number =>
      drawn(
        "o",
        sans,
        cutWith((one) => {
          one.motif = { on: true, shape, size: 1 };
        }),
      ).contours.filter((contour) => contourArea(contour) < 0).length;
    // Two triangles meeting at their points, and three bars.
    expect(count("hourglass")).toBe(2);
    expect(count("bars")).toBe(3);
    expect(count("diamond")).toBe(1);
    // A diamond inside a diamond is one hole with an island of ink in it, so
    // the letter gains a piece rather than a second hole.
    expect(count("nested")).toBe(1);
    expect(
      piecesOf(
        drawn(
          "o",
          sans,
          cutWith((one) => {
            one.motif = { on: true, shape: "nested", size: 1 };
          }),
        ).contours,
      ),
    ).toBe(2);
  });

  it("keeps every shape inside the counter, on the roundest and thinnest faces", () => {
    /*
     * The shapes are laid out in the box the counter fits inside, and a box is
     * bigger than the thing it bounds wherever that thing is round. Drawn
     * straight into that box, the corners of a square land out in the stroke
     * of an O rather than in its counter, and subtracting them there cuts the
     * O into four arcs. Five of the eleven shapes have corners like that, and
     * before they were fitted to the counter every one of them severed a
     * letter on the faces below -- a Didone O went to pieces under six of them.
     *
     * Counted rather than eyeballed, because a severed O still looks like an O
     * on a page until the letters are set close and the pieces drift.
     */
    const shapes: MotifShape[] = [
      "diamond",
      "lozenge",
      "nested",
      "triangle",
      "hourglass",
      "chevron",
      "bars",
      "square",
      "slot",
      "dot",
      "ring",
    ];
    const letters = ["O", "o", "Q", "D", "b", "d", "p", "q", "B", "e", "a", "g", "P", "R"];
    // The round one, the thin one, and the one whose strokes wobble.
    const faces = ["Geometric", "Didone", "Wavy"].map(
      (name) => BASES.find((base) => base.name === name)!,
    );
    // Two counters, so the shapes that stand an island in one stand two here.
    const counters: Record<string, number> = { B: 2, g: 2 };

    const severed: string[] = [];
    for (const face of faces) {
      for (const letter of letters) {
        const whole = piecesOf(drawn(letter, face).contours);
        for (const shape of shapes) {
          const islands = shape === "nested" || shape === "ring" ? (counters[letter] ?? 1) : 0;
          const cuts = cutWith((one) => {
            one.motif = { on: true, shape, size: 1 };
          });
          const after = piecesOf(drawn(letter, face, cuts).contours);
          if (after > whole + islands) severed.push(`${face.name} ${letter} ${shape}`);
        }
      }
    }
    expect(severed).toEqual([]);
    /*
     * Said out loud, because eleven shapes cut out of five letters on four
     * faces is three and a half seconds of drawing and the default is five.
     * Left to the default it passed on a quiet machine and failed on a busy
     * one, which is a test that reports the load rather than the code.
     */
  }, 30_000);

  it("leaves a letter with no counter alone", () => {
    const cuts = cutWith((one) => {
      one.motif.on = true;
    });
    expect(removed("H", sans, cuts)).toBeCloseTo(0, 6);
  });

  it("holds a large motif inside the letter", () => {
    const cuts = cutWith((one) => {
      one.motif = { on: true, shape: "square", size: 1.25 };
    });
    const before = contoursBounds(drawn("o", sans).contours);
    const after = contoursBounds(drawn("o", sans, cuts).contours);
    for (const edge of ["xMin", "xMax", "yMin", "yMax"] as const) {
      expect(after[edge]).toBeCloseTo(before[edge], 3);
    }
  });
});

describe("measured in stems", () => {
  /*
   * What the whole family rests on: one description of a cut, applied to every
   * weight, meaning the same thing at each of them.
   *
   * Which is not the same as taking the same share of every weight away, and
   * the difference is worth being exact about. A slot is a band of a fixed
   * number of stems across cutting through a letter a fixed number of stems
   * wide, so the ink it removes goes as the square of the stem while the
   * letter's own ink goes as the stem -- and a Black must lose a larger share
   * to a slot than a Thin does. A groove down the middle of every stroke is
   * the other case: it runs the length of the skeleton exactly as the stroke
   * does, so there the share is what holds.
   */
  const light = weightedStyle(sans, 400, 200);
  const bold = weightedStyle(sans, 400, 800);

  it("cuts a slot the same number of stems across at any weight", () => {
    const cuts = cutWith((one) => {
      one.slot = { on: true, count: 3, width: 0.3, angle: 0, inset: 0.1 };
    });
    /*
     * Measured as the gap the band leaves in the letter, rather than as the
     * ink it took away.
     *
     * The ink is not the same sum at both weights, and correctly so: the
     * bands sit at heights the whole font agrees on, so a band near the foot
     * of the font hangs below a capital I at a heavy weight and part of it
     * cuts nothing. What is promised is the band, and the band is what the
     * letter reports back -- the distance from the end of one piece to the
     * start of the next.
     */
    const gapsIn = (style: Style): number[] => {
      const runs = drawn("I", style, cuts)
        .contours.map((contour) => {
          const ys = contour.nodes.map((node) => node.point.y);
          return [Math.min(...ys), Math.max(...ys)] as const;
        })
        // Slivers left where a band overhangs the end of the letter are not
        // pieces, and the gap either side of one is not a slot.
        .filter(([low, high]) => high - low > style.pen.weight * 0.1)
        .sort((one, other) => one[0] - other[0]);
      return runs.slice(1).map(([low], at) => low - runs[at][1]);
    };

    for (const style of [light, bold]) {
      const gaps = gapsIn(style);
      expect(gaps.length).toBeGreaterThan(0);
      for (const gap of gaps) expect(gap / style.pen.weight).toBeCloseTo(0.3, 2);
    }
  });

  it("grooves the same share of a letter at any weight", () => {
    const cuts = cutWith((one) => {
      one.inline = { on: true, width: 0.3, inset: 0.45 };
    });
    const thin = removed("H", light, cuts);
    const heavy = removed("H", bold, cuts);
    expect(thin).toBeGreaterThan(0.15);
    expect(Math.abs(thin - heavy)).toBeLessThan(0.06);
  });
});

describe("at the ends of the weight range", () => {
  const black = weightedStyle(sans, sans.pen.weight, 200);
  const light = weightedStyle(sans, sans.pen.weight, 30);

  it("breaks an arm off flush with the stem it leaves, with no stub left on the stem", () => {
    /*
     * The gap used to be placed a stem's half width plus an eighth of a stem
     * along the arm, and turned square to the arm. On a Black that eighth was
     * a sliver twenty-five units wide left standing on the stem beside every
     * gap, and on an n -- whose arch leaves its stem heading up and over --
     * the gap was a slash across the shoulder with a wedge of arch left on top
     * of the stem. The stem is what has to come out clean: at every height
     * the arm used to join it, the ink starting at the stem's outside edge
     * runs exactly one stem across and stops.
     */
    const cuts = cutWith((one) => {
      one.split.on = true;
    });
    for (const [letter, heights] of [
      ["H", [0.45, 0.5, 0.55]],
      ["n", [0.8, 0.9]],
    ] as const) {
      const cut = drawn(letter, black, cuts).contours;
      const box = contoursBounds(cut);
      for (const share of heights) {
        const y = box.yMin + (box.yMax - box.yMin) * share;
        const [first] = inkRunsAt(cut, y);
        expect(first, `${letter} at ${share}`).toBeDefined();
        expect(first[1] - first[0], `${letter} at ${share}`).toBeCloseTo(black.pen.weight, 0);
      }
    }
  });

  it("keeps a Black e whole when the groove is let out through its ends", () => {
    /*
     * With the inset taken off, the groove used to be run a stem past both
     * ends of every stroke, as part of the stroke's own spine. The bar of an
     * e ends inside the wall of its bowl, and the bowl's tail comes back round
     * under its own start -- so the groove crossed itself, the ground inside
     * the loop came out wound as ink, and the whole lower half of a Black e
     * was cut away with it.
     */
    const cuts = cutWith((one) => {
      one.inline = { on: true, width: 0.3, inset: 0 };
    });
    for (const style of [black, sans, light]) {
      expect(removed("e", style, cuts), `pen ${style.pen.weight}`).toBeLessThan(0.45);
    }
  });

  it("chamfers every letter rather than losing some of them altogether", () => {
    /*
     * A union hands back points doubled up a hair apart wherever two strokes'
     * ends met, and each read as a corner with edges a ten-thousandth long.
     * The chamfer laid a triangle of no area on every one of them, and a
     * knife holding a few of those took the whole letter with it: a light
     * Serif H, a Black Grotesque E, a Flared s and a Brush r all came back as
     * nothing.
     */
    const cuts = cutWith((one) => {
      one.chamfer.on = true;
    });
    const face = (name: string) => BASES.find((base) => base.name === name)!;
    for (const [letter, style] of [
      ["H", weightedStyle(face("Serif"), face("Serif").pen.weight, 30)],
      ["H", weightedStyle(face("Fairground"), face("Fairground").pen.weight, 200)],
      ["k", weightedStyle(face("Fairground"), face("Fairground").pen.weight, 200)],
      ["E", weightedStyle(face("Grotesque"), face("Grotesque").pen.weight, 200)],
      ["s", face("Flared")],
      ["r", face("Brush")],
    ] as const) {
      expect(removed(letter, style, cuts), `${style.name} ${letter}`).toBeLessThan(0.1);
    }
  });

  it("grooves a light Slab b and g rather than filling their bowls in", () => {
    /*
     * The groove of a round bowl runs down the stem it is drawn against, a
     * hair from the stem's own groove, and the knife those two made was
     * fused so that taking it away filled the whole bowl in: counter, groove
     * and all, a black disc on a stick.
     */
    const cuts = cutWith((one) => {
      one.inline.on = true;
    });
    const slab = BASES.find((base) => base.name === "Slab")!;
    const light = weightedStyle(slab, slab.pen.weight, 30);
    for (const letter of "bg") {
      const holes = drawn(letter, light, cuts).contours.filter(
        (contour) => contourArea(contour) < 0,
      );
      const hole = holes.reduce((total, contour) => total - contourArea(contour), 0);
      const was = unite(drawn(letter, light).contours, "winding").reduce(
        (total, contour) => total + Math.min(0, contourArea(contour)),
        0,
      );
      expect(hole, letter).toBeGreaterThan(-was);
    }
  });

  it("opens a counter out past its edge without cutting through the stroke round it", () => {
    /*
     * A motif larger than its counter was held to the letter's silhouette,
     * which is the far side of the stroke: a square at 1.2 on a light o
     * reached through the thin sides of the bowl and cut the o into pieces.
     */
    const cuts = cutWith((one) => {
      one.motif = { on: true, shape: "square", size: 1.2 };
    });
    for (const style of [light, sans]) {
      for (const letter of "obdpq") {
        expect(
          piecesOf(drawn(letter, style, cuts).contours),
          `${letter} at ${style.pen.weight}`,
        ).toBe(1);
      }
    }
  });

  it("leaves alone a counter its shape will not go into", () => {
    /*
     * A diamond in the triangle of a 4 has to shrink until its points clear
     * the sloping side, which on a light face is a speck: the counter was
     * filled in for it and the 4 came back a solid wedge with a pinhole.
     */
    const cuts = cutWith((one) => {
      one.motif = { on: true, shape: "diamond", size: 1 };
    });
    const hole = (contours: Contour[]) =>
      contours.reduce((total, contour) => total - Math.min(0, contourArea(contour)), 0);
    const was = hole(unite(drawn("four", light).contours, "winding"));
    expect(was).toBeGreaterThan(0);
    expect(hole(drawn("four", light, cuts).contours)).toBeGreaterThan(was * 0.2);
  });

  it("leaves no chips of ink standing on their own", () => {
    /*
     * A band at the font's own heights passes a hair under the top of an r's
     * terminal and the spur of an s, and what it left above itself was a
     * speck a few units across. Nobody cut that; it is dirt.
     */
    const cuts = cutWith((one) => {
      one.slot = { on: true, count: 3, width: 0.34, angle: 0, inset: 0.14 };
    });
    for (const style of [light, sans, black]) {
      for (const letter of "rsaegRE") {
        const chips = drawn(letter, style, cuts).contours.filter(
          (contour) =>
            contourArea(contour) > 0 && contourArea(contour) < style.pen.weight ** 2 * 0.2,
        );
        expect(chips.length, `${letter} at pen ${style.pen.weight}`).toBe(0);
      }
    }
  });
});

describe("where strokes meet", () => {
  const face = (name: string) => BASES.find((base) => base.name === name)!;
  const blackOf = (name: string) => weightedStyle(face(name), face(name).pen.weight, 200);
  const breaks = cutWith((one) => {
    one.split.on = true;
  });

  it("breaks a Black R and e without leaving chips where three strokes meet", () => {
    /*
     * The bowl and the leg of an R both leave the stem at the foot of the
     * bowl, and the leg leaves the bowl there too. Three breaks cut flush
     * against three different sides left a chip of leg standing loose beside
     * the stem on a Black, and the bowl of a Black e, sliced along the top of
     * its bar, dropped a crescent of its own. What comes away is one piece.
     */
    for (const [name, letters] of [
      ["Sans", "Re"],
      ["Slab", "R"],
    ] as const) {
      const style = blackOf(name);
      for (const letter of letters) {
        const solids = drawn(letter, style, breaks).contours.filter(
          (contour) => contourArea(contour) > 0,
        );
        for (const solid of solids) {
          expect(contourArea(solid), `${name} ${letter}`).toBeGreaterThan(style.pen.weight ** 2);
        }
      }
    }
  });

  it("does not slice the top off a Black e", () => {
    // Its bowl leaves the end of the bar at a slant and runs over the counter
    // just above the bar, so a break laid flush along the bar lay along the
    // bowl instead and took a fifth of the letter with it.
    // A break is a slot a gap wide, and on the Sans -- narrower since it was
    // fitted to Geist -- the slot beside the bar is a larger share of a
    // smaller letter. A sliced-off top was a fifth.
    for (const name of ["Sans", "Slab"]) {
      expect(removed("e", blackOf(name), breaks), name).toBeLessThan(0.085);
    }
  });

  it("keeps a stem's groove whole where a bowl or an arch runs into it", () => {
    /*
     * A bowl meets its stem along the stem's own line, so its groove slid
     * into the stem's at a tangent and ran out in hair-thin points either
     * side of the join, with the wall between groove and counter thinned to
     * nothing. The bowl's groove now stops at the stem's edge, so the stem's
     * groove is a hole of its own beside the bowl's.
     */
    const cuts = cutWith((one) => {
      one.inline.on = true;
    });
    for (const name of ["Geometric", "Sans", "Serif", "Slab"]) {
      for (const letter of "abdgpqn") {
        const holes = drawn(letter, face(name), cuts).contours.filter(
          (contour) => contourArea(contour) < 0,
        );
        /*
         * On a contrast face the groove runs only down the thick of a stroke
         * (see the inline in `cut.ts`), so a bowl's groove comes in two
         * pieces, one down each thick side, and never as fewer.
         */
        const expected = letter === "n" ? 2 : 3;
        if (name === "Serif")
          expect(holes.length, `${name} ${letter}`).toBeGreaterThanOrEqual(expected);
        else expect(holes.length, `${name} ${letter}`).toBe(expected);
      }
    }
  });

  it("fuses a letter into an outline that never runs back over itself", () => {
    /*
     * Where two strokes' edges meet at the hair the fuse nudges them apart
     * by, the union came back with nodes a millionth of a unit apart stepping
     * forward, back and forward again: invisible, but a fold that every cut
     * and cast after it was handed. A Flared H at Black had one on top of
     * each serif.
     */
    const cases: Array<[string, number, string]> = [
      ["Flared", 200, "HMWXY"],
      ["Flared", 30, "GTWYd"],
      ["Brush", 30, "BDHIKR"],
    ];
    for (const [name, weight, letters] of cases) {
      const style = weightedStyle(face(name), face(name).pen.weight, weight);
      for (const letter of letters) {
        const fused = unite(drawn(letter, style).contours, "winding", "whole");
        for (const contour of fused) {
          expect(foldsBack(contour), `${name} ${letter} at ${weight}`).toBe(false);
        }
      }
    }
  });
});

describe("the settings the Draw panel offers, at its lightest and its Black pen", () => {
  const face = (name: string) => BASES.find((base) => base.name === name)!;
  /** A face as the panel sets it: the pen's own weight, with no effects. */
  const at = (name: string, weight: number) => {
    const forge = startFrom(face(name));
    return editPen({ ...forge, effects: noEffects() }, { weight });
  };

  it("fuses letters under counters and fillets without folding them", () => {
    /*
     * The letters themselves were clean, but fused they kept a fold a
     * millionth of a unit wide on top of a serif or at the foot of a stem, and
     * the counters and the fillets were handed that fold: a Brush H, n, m and
     * r at 200, a Flared E and N at 30, and a Didone k and a Slab K at 30 all
     * came back with an outline running back over itself.
     */
    const cases: Array<[string, number, string]> = [
      ["Brush", 200, "Hnmr"],
      ["Flared", 30, "HEnN"],
      ["Didone", 30, "k"],
      ["Slab", 30, "kKV"],
    ];
    for (const [name, weight, letters] of cases) {
      const plain = at(name, weight);
      for (const forge of [
        editCut(plain, "motif", { on: true }),
        editCast(plain, "weld", { on: true, size: 1 }),
      ]) {
        for (const letter of letters) {
          for (const contour of proof(letter, forge)?.contours ?? []) {
            expect(foldsBack(contour), `${name} ${letter} at ${weight}`).toBe(false);
          }
        }
      }
    }
  });

  it("breaks a script without leaving slivers across the breaks", () => {
    /*
     * Where two strokes come away from a third together, the ground both
     * their knives cross is cut as well. That piece could come back from the
     * subtraction wound the wrong way round, and fused with the rest of the
     * knife under the non-zero rule the two cancelled: a sliver stood across
     * the break at the foot of a Roundhand L, and the outline of a Formal y
     * or a Casual g ran over itself.
     */
    const cases: Array<[string, number | null, string]> = [
      ["Roundhand", null, "Lr"],
      ["Roundhand", 30, "r"],
      ["Formal Script", null, "y"],
      ["Casual Script", null, "g"],
      ["Handwriting", 200, "k"],
    ];
    for (const [name, weight, letters] of cases) {
      const plain = weight === null ? at(name, face(name).pen.weight) : at(name, weight);
      const forge = editCut(plain, "split", { on: true });
      for (const letter of letters) {
        for (const contour of proof(letter, forge)?.contours ?? []) {
          expect(foldsBack(contour), `${name} ${letter}`).toBe(false);
        }
      }
    }
  });
});

/** Whether any two edges of a flattened contour cross, strictly. */
function foldsBack(contour: Contour): boolean {
  const points = flattenContour(contour, 12);
  const count = points.length;
  const side = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < count; i++) {
    const [a, b] = [points[i], points[(i + 1) % count]];
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const [c, d] = [points[j], points[(j + 1) % count]];
      const one = side(a, b, c) * side(a, b, d);
      const two = side(c, d, a) * side(c, d, b);
      if (one < 0 && two < 0) return true;
    }
  }
  return false;
}

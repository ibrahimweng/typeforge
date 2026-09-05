/**
 * Turning a pile of drawings into a font.
 *
 * The drawings here are rectangles and discs rather than letters, and that is
 * deliberate: a rectangle of a known height at a known place has a right
 * answer that can be written down, and a letter does not. What is being
 * checked is whether the fitting puts a shape where its character says it
 * belongs and whether the spacing gives two different shapes the same white,
 * and both of those are questions about geometry.
 *
 * The one place a real letter is needed is the spacing comparison, since the
 * whole claim is that a round shape and a flat one come out looking evenly
 * spaced rather than measuring the same. So those use the shapes that make the
 * difference visible: a box, a disc and a wedge.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { readyToShape } from "@/forge/layers";
import { noCuts, type CutName, type Cuts } from "@/font/cuts";
import { contourArea, contoursBounds } from "@/font/geometry";
import type { Contour } from "@/font/types";
import {
  addPieces,
  build,
  chooseFit,
  editSpacing,
  emptyAssembly,
  guessCharacter,
  mapPiece,
  pieceFrom,
  clearSlot,
  cutHeldBy,
  cutLikeTheRest,
  cutOneWay,
  editCuts,
  pieceInto,
  putInSlot,
  setKern,
  tweak,
  type Assembly,
  type Piece,
} from "./document";
import { expectationFor, detectFit } from "./fit";
import { glyphNameFor, SLOTS, SLOT_GROUPS, slotFor, slotsIn } from "./slots";
import { DEFAULT_SPACING, silhouetteOf, insetOf } from "./spacing";
import { toTypeface } from "./typeface";
import { draw, startFrom } from "@/forge/document";
import { letterSvg } from "@/forge/exchange";
import { SANS } from "@/forge/style";

const METRICS = emptyAssembly().metrics;

/** A rectangle, in SVG coordinates: y grows downwards. */
function box(x: number, y: number, width: number, height: number): Contour {
  const corner = (px: number, py: number) => ({
    point: { x: px, y: py },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  });
  return {
    closed: true,
    nodes: [
      corner(x, y),
      corner(x + width, y),
      corner(x + width, y + height),
      corner(x, y + height),
    ],
  };
}

/** A disc, which is the shape that makes optical spacing differ from measuring. */
function disc(cx: number, cy: number, r: number): Contour {
  const k = r * 0.5522847498307936;
  const node = (x: number, y: number, hi: [number, number], ho: [number, number]) => ({
    point: { x, y },
    handleIn: { x: hi[0], y: hi[1] },
    handleOut: { x: ho[0], y: ho[1] },
    type: "smooth" as const,
  });
  return {
    closed: true,
    nodes: [
      node(cx + r, cy, [cx + r, cy - k], [cx + r, cy + k]),
      node(cx, cy + r, [cx + k, cy + r], [cx - k, cy + r]),
      node(cx - r, cy, [cx - r, cy + k], [cx - r, cy - k]),
      node(cx, cy - r, [cx - k, cy - r], [cx + k, cy - r]),
    ],
  };
}

/** A triangle standing on its base, like an A with no crossbar. */
function wedge(x: number, y: number, width: number, height: number): Contour {
  const corner = (px: number, py: number) => ({
    point: { x: px, y: py },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  });
  return {
    closed: true,
    nodes: [corner(x + width / 2, y), corner(x + width, y + height), corner(x, y + height)],
  };
}

function piece(
  file: string,
  character: string,
  contours: Contour[],
  viewWidth = 600,
  viewHeight = 800,
): Piece {
  return {
    id: file,
    file,
    character,
    contours,
    viewBox: { x: 0, y: 0, width: viewWidth, height: viewHeight },
  };
}

function from(pieces: Piece[], patch: Partial<Assembly> = {}): Assembly {
  return { ...addPieces(emptyAssembly(), pieces), ...patch };
}

describe("cutting a pile of drawings", () => {
  beforeAll(async () => {
    await readyToShape();
  });

  /*
   * An I that is one stem, an H that is two and a bar, and an O that is a
   * ring. Rectangles again, for the same reason as everywhere else here: a
   * shape with a right answer that can be written down.
   */
  const pile = (): Assembly =>
    from([
      piece("I.svg", "I", [box(240, 100, 120, 600)]),
      piece("H.svg", "H", [
        box(120, 100, 120, 600),
        box(240, 350, 120, 100),
        box(360, 100, 120, 600),
      ]),
      piece("O.svg", "O", [box(120, 100, 360, 600), box(200, 180, 200, 440)]),
    ]);

  const cutWith = (patch: (cuts: Cuts) => void): Cuts => {
    const cuts = noCuts();
    patch(cuts);
    return cuts;
  };

  const inkOf = (assembly: Assembly, character: string): number => {
    const letter = build(assembly).letters.find((one) => one.character === character);
    if (!letter) throw new Error(`${character} was not built`);
    return Math.abs(letter.contours.reduce((total, one) => total + contourArea(one), 0));
  };

  it("takes ink out of every drawing in the pile", () => {
    const plain = pile();
    const cut = editCuts(
      plain,
      cutWith((one) => {
        one.slot.on = true;
      }),
    );
    for (const character of ["I", "H", "O"]) {
      expect(inkOf(cut, character), character).toBeLessThan(inkOf(plain, character));
    }
  });

  it("spaces the drawing before it is cut, so switching a cut on reflows nothing", () => {
    /*
     * A slot takes ink out of a letter's silhouette, and a narrower silhouette
     * asks for less space either side. Measured after the cut, switching the
     * slots on would respace the whole font -- every word reflowing because of
     * a decision about how the letters look.
     */
    const plain = build(pile()).letters;
    const cut = build(
      editCuts(
        pile(),
        cutWith((one) => {
          one.slot.on = true;
        }),
      ),
    ).letters;
    // The letters really were cut, or the rest of this proves only that
    // nothing happened at all.
    expect(
      inkOf(
        editCuts(
          pile(),
          cutWith((one) => {
            one.slot.on = true;
          }),
        ),
        "H",
      ),
    ).toBeLessThan(inkOf(pile(), "H"));
    for (const was of plain) {
      const now = cut.find((one) => one.character === was.character)!;
      expect(now.advanceWidth, was.character).toBeCloseTo(was.advanceWidth, 6);
      expect(now.bearings.left, was.character).toBeCloseTo(was.bearings.left, 6);
    }
  });

  it("measures the stem after the drawings are fitted, not as they arrived", () => {
    /*
     * A pile is drawings from different programs and one can arrive ten times
     * the size of another. Only after the fit are they all in the same units,
     * so a stem read before it would be a number in whatever the file used --
     * and the same pile drawn twice as large would cut itself twice as deep.
     */
    const small = pile();
    const large = from(
      small.pieces.map((one) => ({
        ...one,
        contours: one.contours.map((contour) => ({
          ...contour,
          nodes: contour.nodes.map((node) => ({
            ...node,
            point: { x: node.point.x * 10, y: node.point.y * 10 },
          })),
        })),
        viewBox: { x: 0, y: 0, width: 6000, height: 8000 },
      })),
    );
    const cuts = cutWith((one) => {
      one.slot.on = true;
    });
    const share = (assembly: Assembly): number =>
      1 - inkOf(editCuts(assembly, cuts), "H") / inkOf(assembly, "H");
    // A real share of the letter, not two zeroes agreeing with each other.
    expect(share(small)).toBeGreaterThan(0.02);
    expect(share(large)).toBeCloseTo(share(small), 2);
  });

  it("lets one drawing be cut its own way instead of the pile's", () => {
    const plain = pile();
    const cuts = cutWith((one) => {
      one.slot.on = true;
    });
    const mixed = cutOneWay(editCuts(plain, cuts), "H", noCuts());

    // An exception standing in for the pile's rather than adding to them.
    expect(inkOf(mixed, "H")).toBeCloseTo(inkOf(plain, "H"), 6);
    expect(inkOf(mixed, "I")).toBeLessThan(inkOf(plain, "I"));

    const back = cutLikeTheRest(mixed, "H");
    expect(inkOf(back, "H")).toBeLessThan(inkOf(plain, "H"));
  });

  it("marks only the operation a drawing actually holds its own version of", () => {
    /*
     * Taking a letter out of the pile's cuts starts it as a copy of them, so
     * on that moment all six still agree. Marking every one of them as held
     * would say the drawing had been cut its own way six times over when
     * nothing had been changed at all.
     */
    const cuts = cutWith((one) => {
      one.slot.on = true;
    });
    const copied = cutOneWay(editCuts(pile(), cuts), "H", { ...noCuts(), slot: { ...cuts.slot } });
    const names: CutName[] = ["slot", "tooth", "chamfer", "split", "inline", "motif"];
    expect(names.filter((name) => cutHeldBy(copied, "H", name))).toEqual([]);

    const changed = cutOneWay(
      copied,
      "H",
      cutWith((one) => {
        one.slot.on = true;
        one.tooth.on = true;
      }),
    );
    expect(changed.cutExceptions!.H.tooth.on).toBe(true);
    expect(cutHeldBy(changed, "H", "tooth")).toBe(true);
    expect(cutHeldBy(changed, "H", "slot")).toBe(false);
  });

  it("does nothing with the two that are made out of a skeleton", () => {
    const plain = pile();
    const cut = editCuts(
      plain,
      cutWith((one) => {
        one.inline.on = true;
        one.split.on = true;
      }),
    );
    // A drawing that arrived as an outline has no spine to sweep again and no
    // join to find, so the honest answer is the drawing unchanged.
    expect(inkOf(cut, "H")).toBeCloseTo(inkOf(plain, "H"), 6);
    // And the same pile with a cut that does reach an outline is changed, so
    // what is being shown is these two declining rather than nothing working.
    expect(
      inkOf(
        editCuts(
          plain,
          cutWith((one) => {
            one.slot.on = true;
          }),
        ),
        "H",
      ),
    ).toBeLessThan(inkOf(plain, "H"));
  });
});

describe("guessing which character a file is for", () => {
  it("reads the plain ones", () => {
    expect(guessCharacter("a.svg")).toBe("a");
    expect(guessCharacter("7.svg")).toBe("7");
  });

  it("reads the UFO rule for capitals", () => {
    expect(guessCharacter("A_.svg")).toBe("A");
    expect(guessCharacter("R_.svg")).toBe("R");
  });

  it("reads a codepoint", () => {
    expect(guessCharacter("uni0041.svg")).toBe("A");
    expect(guessCharacter("u0062.svg")).toBe("b");
  });

  it("reads the names the font world uses", () => {
    expect(guessCharacter("period.svg")).toBe(".");
    expect(guessCharacter("question.svg")).toBe("?");
    expect(guessCharacter("eight.svg")).toBe("8");
  });

  it("looks past the noise a batch export puts in front", () => {
    expect(guessCharacter("07 - B.svg")).toBe("B");
    expect(guessCharacter("glyph-a.svg")).toBe("a");
    expect(guessCharacter("Artboard_1_period.svg")).toBe(".");
  });

  it("says nothing rather than guessing wildly", () => {
    expect(guessCharacter("logo-final-v3.svg")).toBe("");
    expect(guessCharacter("")).toBe("");
  });

  it("takes the letter off a sheet this application wrote", () => {
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 1000"
      data-typeforge="glyph" data-typeforge-name="g" data-typeforge-advance="500"
      data-typeforge-upm="1000" data-typeforge-top="750">
      <path d="M0 0 L100 0 L100 100 Z"/></svg>`;
    // The file is called something unhelpful and the sheet knows better.
    expect(pieceFrom("export-final.svg", sheet)?.character).toBe("g");
  });

  it("ignores a file with nothing drawn in it", () => {
    expect(pieceFrom("empty.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>")).toBeNull();
  });
});

describe("what a character should measure", () => {
  it("knows the flat capitals are the cap height", () => {
    const H = expectationFor("H", METRICS)!;
    expect(H.top).toBe(METRICS.capHeight);
    expect(H.bottom).toBe(0);
    expect(H.sure).toBe(true);
  });

  it("lets the round ones overshoot at both ends", () => {
    const O = expectationFor("O", METRICS)!;
    expect(O.top).toBeGreaterThan(METRICS.capHeight);
    expect(O.bottom).toBeLessThan(0);
  });

  it("hangs the descenders", () => {
    expect(expectationFor("p", METRICS)!.bottom).toBe(METRICS.descender);
    expect(expectationFor("g", METRICS)!.bottom).toBe(METRICS.descender);
  });

  it("takes the ascenders to the ascender", () => {
    expect(expectationFor("b", METRICS)!.top).toBe(METRICS.ascender);
    expect(expectationFor("l", METRICS)!.top).toBe(METRICS.ascender);
  });

  it("does not let the unreliable letters set the scale", () => {
    for (const character of ["t", "f", "i", "j", "J", "Q", "7"]) {
      expect(expectationFor(character, METRICS)?.sure, character).toBe(false);
    }
  });

  it("has nothing to say about a character it does not know", () => {
    expect(expectationFor("&", METRICS)).toBeNull();
  });
});

describe("fitting a set drawn on one canvas", () => {
  it("is what a shared canvas height asks for", () => {
    expect(detectFit([{ height: 800 }, { height: 800 }, { height: 800 }])).toBe("together");
    expect(detectFit([{ height: 800 }, { height: 801 }])).toBe("alone");
    // One file on its own has nothing to be in proportion with.
    expect(detectFit([{ height: 800 }])).toBe("alone");
  });

  /*
   * Three letters drawn on one canvas at 800 units tall, with the baseline
   * 100 units up from the bottom. H is 400 tall, x is 280, and p hangs 120
   * below the line. Fitted together, the H must land on the cap height and
   * the other two must keep their sizes relative to it.
   */
  const canvas = () => {
    const baseline = 700; // in SVG coordinates, y downwards
    return from([
      piece("H_.svg", "H", [box(50, baseline - 400, 300, 400)]),
      piece("x.svg", "x", [box(50, baseline - 280, 300, 280)]),
      piece("p.svg", "p", [box(50, baseline - 280, 300, 400)]),
    ]);
  };

  it("puts the cap on the cap height", () => {
    const { letters } = build(chooseFit(canvas(), "together"));
    const H = letters.find((letter) => letter.character === "H")!;
    const bounds = contoursBounds(H.contours);
    expect(bounds.yMin).toBeCloseTo(0, 3);
    expect(bounds.yMax).toBeCloseTo(METRICS.capHeight, 3);
  });

  it("keeps the other letters in proportion to it rather than stretching them", () => {
    const { letters } = build(chooseFit(canvas(), "together"));
    const x = letters.find((letter) => letter.character === "x")!;
    const bounds = contoursBounds(x.contours);
    // 280/400 of the cap height, because that is how it was drawn. Not the
    // x-height, which is what fitting each on its own would give.
    expect(bounds.yMax).toBeCloseTo((280 / 400) * METRICS.capHeight, 3);
    expect(bounds.yMin).toBeCloseTo(0, 3);
  });

  it("hangs the descender below the line, by the amount it was drawn below it", () => {
    const { letters } = build(chooseFit(canvas(), "together"));
    const p = contoursBounds(letters.find((letter) => letter.character === "p")!.contours);
    expect(p.yMin).toBeCloseTo(-(120 / 400) * METRICS.capHeight, 3);
    expect(p.yMax).toBeGreaterThan(0);
  });

  it("is not thrown off by one letter drawn at the wrong size", () => {
    // A median, not a mean: one stray file must not move everything else.
    const baseline = 700;
    const good = [
      piece("H_.svg", "H", [box(50, baseline - 400, 300, 400)]),
      piece("E_.svg", "E", [box(50, baseline - 400, 300, 400)]),
      piece("L_.svg", "L", [box(50, baseline - 400, 300, 400)]),
    ];
    const withStray = [...good, piece("N_.svg", "N", [box(50, baseline - 40, 300, 40)])];
    const clean = build(chooseFit(from(good), "together"));
    const dirty = build(chooseFit(from(withStray), "together"));
    const height = (result: ReturnType<typeof build>, character: string) =>
      contoursBounds(result.letters.find((letter) => letter.character === character)!.contours)
        .yMax;
    expect(height(dirty, "H")).toBeCloseTo(height(clean, "H"), 3);
  });
});

describe("fitting drawings made separately", () => {
  /*
   * The same three letters, each trimmed to its own artwork and exported at
   * whatever size it happened to be. Nothing about the relative sizes
   * survived, so each one has to be fitted to what its own character means.
   */
  const separate = () =>
    from([
      {
        ...piece("H_.svg", "H", [box(0, 0, 300, 900)]),
        viewBox: { x: 0, y: 0, width: 300, height: 900 },
      },
      {
        ...piece("x.svg", "x", [box(0, 0, 200, 200)]),
        viewBox: { x: 0, y: 0, width: 200, height: 200 },
      },
      {
        ...piece("p.svg", "p", [box(0, 0, 250, 400)]),
        viewBox: { x: 0, y: 0, width: 250, height: 400 },
      },
    ]);

  it("is what differing canvas heights ask for", () => {
    expect(separate().fit).toBe("alone");
  });

  it("puts each letter on the lines its own character names", () => {
    const { letters } = build(separate());
    const at = (character: string) =>
      contoursBounds(letters.find((letter) => letter.character === character)!.contours);

    expect(at("H").yMin).toBeCloseTo(0, 3);
    expect(at("H").yMax).toBeCloseTo(METRICS.capHeight, 3);
    expect(at("x").yMin).toBeCloseTo(0, 3);
    expect(at("x").yMax).toBeCloseTo(METRICS.xHeight, 3);
    expect(at("p").yMin).toBeCloseTo(METRICS.descender, 3);
    expect(at("p").yMax).toBeCloseTo(METRICS.xHeight, 3);
  });

  it("sits a character it has never heard of on the baseline", () => {
    const { letters } = build(
      from([...separate().pieces, piece("amp.svg", "&", [box(0, 0, 300, 600)])]),
    );
    const amp = letters.find((letter) => letter.character === "&")!;
    expect(contoursBounds(amp.contours).yMin).toBeCloseTo(0, 3);
    expect(amp.measured).toBe(false);
  });
});

describe("spacing by what the eye sees", () => {
  const em = METRICS.unitsPerEm;

  it("gives a flat-sided shape no discount", () => {
    const inset = insetOf(silhouetteOf([box(0, -500, 300, 500)], METRICS), DEFAULT_SPACING, em);
    expect(inset.left).toBeCloseTo(0, 3);
    expect(inset.right).toBeCloseTo(0, 3);
  });

  it("gives a round shape one, because its own curve already gave white back", () => {
    const inset = insetOf(silhouetteOf([disc(250, 250, 250)], METRICS), DEFAULT_SPACING, em);
    expect(inset.left).toBeGreaterThan(20);
    expect(inset.right).toBeGreaterThan(20);
  });

  it("gives a wedge a much larger one on the side it leans away from", () => {
    // A right-angled triangle: flat down the left, sloping away on the right.
    const corner = (x: number, y: number) => ({
      point: { x, y },
      handleIn: null,
      handleOut: null,
      type: "corner" as const,
    });
    const lean: Contour = {
      closed: true,
      nodes: [corner(0, 0), corner(0, 500), corner(300, 500)],
    };
    const inset = insetOf(silhouetteOf([lean], METRICS), DEFAULT_SPACING, em);
    const limit = DEFAULT_SPACING.depth * em;
    expect(inset.left).toBeCloseTo(0, 3);
    // Nearly all of what the eye is allowed to see, since the slope runs away
    // past the depth limit on every row but the first few.
    expect(inset.right).toBeGreaterThan(limit * 0.8);
    expect(inset.right).toBeLessThanOrEqual(limit);
  });

  it("stops looking once it is deeper in than a neighbour could see", () => {
    // A C-shape: open on the right, and open a very long way. Without the
    // depth limit the opening reads as white beside the letter and the letter
    // gets rammed into whatever follows it.
    const corner = (x: number, y: number) => ({
      point: { x, y },
      handleIn: null,
      handleOut: null,
      type: "corner" as const,
    });
    const cup: Contour = {
      closed: true,
      nodes: [
        corner(0, 0),
        corner(600, 0),
        corner(600, 80),
        corner(80, 80),
        corner(80, 420),
        corner(600, 420),
        corner(600, 500),
        corner(0, 500),
      ],
    };
    const inset = insetOf(silhouetteOf([cup], METRICS), DEFAULT_SPACING, em);
    expect(inset.right).toBeLessThanOrEqual(DEFAULT_SPACING.depth * em + 1e-6);
  });

  it("gives a round letter less white than a flat one, which is the whole point", () => {
    const assembly = from([
      piece("H_.svg", "H", [box(0, 0, 300, 700)]),
      piece("O_.svg", "O", [disc(350, 350, 350)]),
    ]);
    const { letters } = build(assembly);
    const H = letters.find((letter) => letter.character === "H")!;
    const O = letters.find((letter) => letter.character === "O")!;
    expect(O.bearings.left).toBeLessThan(H.bearings.left);
    expect(O.bearings.right).toBeLessThan(H.bearings.right);
  });

  it("opens the whole set out when asked to, and tightens it when asked", () => {
    const assembly = from([piece("H_.svg", "H", [box(0, 0, 300, 700)])]);
    const width = (a: Assembly) => build(a).letters[0].advanceWidth;
    const tight = width(editSpacing(assembly, { white: 0.01 }));
    const loose = width(editSpacing(assembly, { white: 0.08 }));
    expect(loose).toBeGreaterThan(tight);
  });

  it("never reaches across into the next letter", () => {
    // A shape that is nearly all white on both sides asks for a negative
    // sidebearing. It does not get one: that is a kern's job, and a negative
    // sidebearing would apply to every pair at once.
    const assembly = editSpacing(from([piece("A_.svg", "A", [wedge(0, 0, 700, 700)])]), {
      white: 0.005,
    });
    const [letter] = build(assembly).letters;
    expect(letter.bearings.left).toBeGreaterThanOrEqual(0);
    expect(letter.bearings.right).toBeGreaterThanOrEqual(0);
  });

  it("puts the ink where the advance says it is", () => {
    const { letters } = build(from([piece("H_.svg", "H", [box(120, 0, 300, 700)])]));
    const [letter] = letters;
    const bounds = contoursBounds(letter.contours);
    // Wherever the file drew it, the ink now starts at the left sidebearing
    // and the advance covers it plus the right one.
    expect(bounds.xMin).toBeCloseTo(letter.bearings.left, 3);
    expect(letter.advanceWidth).toBeCloseTo(bounds.xMax + letter.bearings.right, 3);
  });

  it("gives a drawing with no ink a word space rather than a measurement", () => {
    const { letters } = build(from([piece("space.svg", " ", [])]));
    expect(letters[0].advanceWidth).toBeGreaterThan(0);
  });
});

describe("kerning", () => {
  const corner = (x: number, y: number) => ({
    point: { x, y },
    handleIn: null,
    handleOut: null,
    type: "corner" as const,
  });

  /** A T: a wide arm on top of a narrow stem, which leaves white underneath. */
  const tee: Contour = {
    closed: true,
    nodes: [
      corner(0, 0),
      corner(600, 0),
      corner(600, 100),
      corner(350, 100),
      corner(350, 700),
      corner(250, 700),
      corner(250, 100),
      corner(0, 100),
    ],
  };

  it("pulls a pair together when one leans away from the other", () => {
    const assembly = from([
      piece("T_.svg", "T", [tee]),
      piece("A_.svg", "A", [wedge(0, 0, 600, 700)]),
    ]);
    const { kerning } = build(assembly);
    const pair = kerning.find((k) => k.left === "T" && k.right === "A");
    expect(pair).toBeDefined();
    expect(pair!.value).toBeLessThan(0);
  });

  it("leaves two flat-sided letters alone", () => {
    const assembly = from([
      piece("H_.svg", "H", [box(0, 0, 300, 700)]),
      piece("I_.svg", "I", [box(0, 0, 120, 700)]),
    ]);
    const { kerning } = build(assembly);
    expect(kerning.find((k) => k.left === "H" && k.right === "I")).toBeUndefined();
  });

  it("does none at all when it is turned off", () => {
    const assembly = editSpacing(
      from([piece("T_.svg", "T", [tee]), piece("A_.svg", "A", [wedge(0, 0, 600, 700)])]),
      { kern: 0 },
    );
    expect(build(assembly).kerning).toEqual([]);
  });

  it("takes a value set by hand over the one it measured", () => {
    const assembly = from([
      piece("T_.svg", "T", [tee]),
      piece("A_.svg", "A", [wedge(0, 0, 600, 700)]),
    ]);
    const measured = build(assembly).kerning.find((k) => k.left === "T" && k.right === "A")!.value;
    const byHand = build(setKern(assembly, "T", "A", -42)).kerning.find(
      (k) => k.left === "T" && k.right === "A",
    )!;
    expect(byHand.value).toBe(-42);
    expect(byHand.value).not.toBe(measured);
  });

  it("keeps a hand pair that nothing measured", () => {
    const assembly = from([
      piece("H_.svg", "H", [box(0, 0, 300, 700)]),
      piece("I_.svg", "I", [box(0, 0, 120, 700)]),
    ]);
    const { kerning } = build(setKern(assembly, "H", "I", -30));
    expect(kerning.find((k) => k.left === "H" && k.right === "I")?.value).toBe(-30);
  });
});

describe("the pile itself", () => {
  it("says which files have not been told what they are", () => {
    const assembly = from([
      piece("H_.svg", "H", [box(0, 0, 300, 700)]),
      piece("mystery.svg", "", [box(0, 0, 300, 700)]),
    ]);
    expect(build(assembly).unplaced.map((piece) => piece.file)).toEqual(["mystery.svg"]);
  });

  it("says when two files claim the same character", () => {
    const assembly = from([
      piece("a.svg", "a", [box(0, 0, 300, 500)]),
      piece("a-alt.svg", "a", [box(0, 0, 200, 500)]),
    ]);
    const { letters, clashes } = build(assembly);
    expect(clashes).toEqual(["a"]);
    expect(letters.filter((letter) => letter.character === "a")).toHaveLength(1);
    // The first one in wins, so the answer is stable rather than whichever
    // file the filesystem happened to hand over last.
    expect(letters[0].file).toBe("a.svg");
  });

  it("replaces a file dropped in twice rather than stacking it", () => {
    const first = from([piece("a.svg", "a", [box(0, 0, 300, 500)])]);
    const again = addPieces(first, [piece("a.svg", "a", [box(0, 0, 400, 500)])]);
    expect(again.pieces).toHaveLength(1);
    expect(contoursBounds(build(again).letters[0].contours).xMax).toBeGreaterThan(
      contoursBounds(build(first).letters[0].contours).xMax,
    );
  });

  it("lets a file be pointed at a different character", () => {
    const assembly = from([piece("mystery.svg", "", [box(0, 0, 300, 700)])]);
    const named = mapPiece(assembly, "mystery.svg", "H");
    expect(build(named).letters[0].character).toBe("H");
    expect(build(named).unplaced).toEqual([]);
  });

  it("nudges one letter's white without touching any other", () => {
    const assembly = from([
      piece("H_.svg", "H", [box(0, 0, 300, 700)]),
      piece("I_.svg", "I", [box(0, 0, 120, 700)]),
    ]);
    const before = build(assembly);
    const after = build(tweak(assembly, "H", { left: 40 }));
    const width = (result: ReturnType<typeof build>, character: string) =>
      result.letters.find((letter) => letter.character === character)!.advanceWidth;
    expect(width(after, "H")).toBeCloseTo(width(before, "H") + 40, 3);
    expect(width(after, "I")).toBeCloseTo(width(before, "I"), 3);
  });

  it("changes nothing about the assembly it was built from", () => {
    const assembly = from([piece("H_.svg", "H", [box(0, 0, 300, 700)])]);
    const after = tweak(assembly, "H", { left: 40 });
    expect(assembly.tweaks).toEqual({});
    expect(after.tweaks.H.left).toBe(40);
  });

  it("has nothing to build from an empty pile", () => {
    const { letters, kerning, unplaced, clashes } = build(emptyAssembly());
    expect(letters).toEqual([]);
    expect(kerning).toEqual([]);
    expect(unplaced).toEqual([]);
    expect(clashes).toEqual([]);
  });
});

/**
 * The whole thing, on real letters.
 *
 * Boxes and discs prove the arithmetic. They cannot prove that the arithmetic
 * adds up to a font, because every question that matters here -- is the
 * baseline right, are the letters in proportion, does the spacing read evenly
 * -- is a question about letterforms.
 *
 * So this takes a font the other half of the application drew, writes every
 * letter out as a sheet exactly as somebody would to work on it, and assembles
 * the sheets back into a font. Nothing in the assembler knows where they came
 * from. If the fitting and the spacing are right, what comes back should be
 * close to what went out; where it differs, the difference is the assembler's
 * own opinion, and it should be small.
 */
describe("assembling a real alphabet", () => {
  const alphabet = "HxpobcenAOEVWmTLi";

  const sheets = () => {
    const forge = startFrom(SANS);
    return alphabet.split("").map((letter) => {
      const svg = letterSvg(letter, forge)!;
      return pieceFrom(`${letter}.svg`, svg)!;
    });
  };

  const source = () => {
    const forge = startFrom(SANS);
    return { forge, metrics: forge.style.metrics };
  };

  it("reads every sheet, and knows which letter each one is", () => {
    const pieces = sheets();
    expect(pieces).toHaveLength(alphabet.length);
    expect(pieces.map((piece) => piece.character).join("")).toBe(alphabet);
  });

  it("sees one canvas, because the sheets share a height", () => {
    const assembly = addPieces(emptyAssembly(), sheets());
    expect(assembly.fit).toBe("together");
  });

  it("puts the letters back on the lines they were drawn against", () => {
    const { metrics } = source();
    const assembly = editSpacing(
      { ...addPieces(emptyAssembly(), sheets()), metrics: { ...METRICS, ...spanOf(metrics) } },
      {},
    );
    const { letters } = build(assembly);
    const at = (character: string) =>
      contoursBounds(letters.find((letter) => letter.character === character)!.contours);

    // Within a couple of units: the assembler re-derives the scale from the
    // drawings rather than being told it, so it is allowed to disagree
    // slightly and not allowed to disagree visibly.
    expect(at("H").yMin).toBeCloseTo(0, 0);
    expect(at("H").yMax).toBeCloseTo(metrics.capHeight, -0.5);
    expect(at("x").yMax).toBeCloseTo(metrics.xHeight, -0.5);
    expect(at("p").yMin).toBeCloseTo(metrics.descender, -0.5);
    // A round letter still overshoots the flat one beside it.
    expect(at("o").yMax).toBeGreaterThan(at("x").yMax);
    expect(at("o").yMin).toBeLessThan(at("x").yMin);
  });

  /*
   * The comparison has to be made against the right letters.
   *
   * The drawn font gives every letter the same sidebearing whatever its shape,
   * which is what the assembler is deliberately not doing -- so on an A or a T
   * the two must disagree, and the size of the disagreement is the whole value
   * of measuring optically. Where they must agree is on the letters where a
   * constant sidebearing happens to be the right answer: the ones that are flat
   * on both sides.
   *
   * Which is a shorter list than it looks. An E and an L are flat down the left
   * and wide open down the right, so a constant sidebearing is right about half
   * of each of them and they belong in the other test.
   */
  const FLAT_SIDED = "Hnmi";

  it("spaces a flat-sided letter where the font that drew it did", () => {
    const { forge, metrics } = source();
    const assembly = {
      ...addPieces(emptyAssembly(), sheets()),
      metrics: { ...METRICS, ...spanOf(metrics) },
    };
    const { letters } = build(assembly);

    for (const letter of letters) {
      if (!FLAT_SIDED.includes(letter.character)) continue;
      const drawn = draw(letter.character, forge)!;
      const off = Math.abs(letter.advanceWidth - drawn.advanceWidth);
      expect(
        off,
        `${letter.character}: ${letter.advanceWidth} vs ${drawn.advanceWidth}`,
      ).toBeLessThan(metrics.unitsPerEm * 0.025);
    }
  });

  it("tightens the letters a constant sidebearing was too generous to", () => {
    const { forge, metrics } = source();
    const assembly = {
      ...addPieces(emptyAssembly(), sheets()),
      metrics: { ...METRICS, ...spanOf(metrics) },
    };
    const { letters } = build(assembly);

    for (const letter of letters) {
      const drawn = draw(letter.character, forge)!;
      const off = letter.advanceWidth - drawn.advanceWidth;
      if ("AVWT".includes(letter.character)) {
        // A diagonal or an overhanging arm is mostly white beside it already.
        expect(off, letter.character).toBeLessThan(-metrics.unitsPerEm * 0.05);
      }
      // Nothing anywhere is allowed to be wildly off: the optical answer and
      // the constant one are two answers to the same question.
      expect(Math.abs(off), `${letter.character}`).toBeLessThan(metrics.unitsPerEm * 0.15);
    }
  });

  it("gives the round letters less white than the flat ones", () => {
    const assembly = {
      ...addPieces(emptyAssembly(), sheets()),
      metrics: { ...METRICS, ...spanOf(source().metrics) },
    };
    const { letters } = build(assembly);
    const bearing = (character: string) =>
      letters.find((letter) => letter.character === character)!.bearings.left;
    expect(bearing("o")).toBeLessThan(bearing("H"));
    // And the one that leans away gets least of all.
    expect(bearing("A")).toBeLessThan(bearing("o"));
  });

  it("pulls the pairs that need it together and leaves the rest alone", () => {
    const { metrics } = source();
    const assembly = {
      ...addPieces(emptyAssembly(), sheets()),
      metrics: { ...METRICS, ...spanOf(metrics) },
    };
    const { kerning } = build(assembly);
    const value = (left: string, right: string) =>
      kerning.find((pair) => pair.left === left && pair.right === right)?.value ?? 0;

    // The pairs every font kerns, and by roughly the amount every font kerns
    // them by: eight hundredths of the em, give or take.
    for (const [left, right] of [
      ["A", "V"],
      ["V", "A"],
      ["L", "T"],
    ] as const) {
      const kern = value(left, right);
      expect(kern, `${left}${right}`).toBeLessThan(-metrics.unitsPerEm * 0.04);
      expect(kern, `${left}${right}`).toBeGreaterThan(-metrics.unitsPerEm * 0.14);
    }

    // And the ones no font kerns, which is the harder half to get right: an
    // area measure would close both of these and be wrong about both.
    for (const [left, right] of [
      ["H", "H"],
      ["o", "o"],
      ["n", "n"],
      ["m", "m"],
    ] as const) {
      expect(value(left, right), `${left}${right}`).toBe(0);
    }
  });

  it("stores the pairs worth storing and not the thousands that are not", () => {
    const assembly = {
      ...addPieces(emptyAssembly(), sheets()),
      metrics: { ...METRICS, ...spanOf(source().metrics) },
    };
    const { letters, kerning } = build(assembly);
    expect(kerning.length).toBeGreaterThan(0);
    expect(kerning.length).toBeLessThan(letters.length ** 2 / 2);
  });

  it("writes a font file's worth of glyphs, kerning included", async () => {
    const assembly = {
      ...addPieces(emptyAssembly(), sheets()),
      metrics: { ...METRICS, ...spanOf(source().metrics) },
    };
    const typeface = await toTypeface(assembly, {
      familyName: "Assembled",
      styleName: "Regular",
      merge: false,
    });
    expect(typeface.glyphs.find((glyph) => glyph.name === ".notdef")).toBeDefined();
    for (const letter of alphabet) {
      const glyph = typeface.glyphs.find((candidate) => candidate.name === letter);
      expect(glyph, letter).toBeDefined();
      expect(glyph!.contours.length, letter).toBeGreaterThan(0);
      expect(glyph!.unicodes, letter).toEqual([letter.codePointAt(0)]);
    }
    expect(typeface.kerning.length).toBeGreaterThan(0);
    expect(typeface.kerning.every((pair) => Number.isInteger(pair.value))).toBe(true);
  });
});

/** The lines a forged font is drawn against, as the assembler names them. */
function spanOf(metrics: {
  unitsPerEm: number;
  capHeight: number;
  xHeight: number;
  ascender: number;
  descender: number;
  overshoot: number;
}) {
  return {
    unitsPerEm: metrics.unitsPerEm,
    capHeight: metrics.capHeight,
    xHeight: metrics.xHeight,
    ascender: metrics.ascender,
    descender: metrics.descender,
    overshoot: metrics.overshoot,
  };
}

/**
 * The boxes, and putting a drawing in one.
 *
 * The thing being checked is that choosing the box decides the character and
 * nothing else gets a vote -- not the file name, not what the file says about
 * itself. Somebody who has just pointed at a box has been clear enough.
 */
describe("a box per character", () => {
  it("has one for every letter, figure and mark", () => {
    expect(SLOTS.length).toBeGreaterThan(180);
    for (const character of "ABCXYZabcxyz0189") {
      expect(slotFor(character), character).toBeDefined();
    }
    for (const character of "!@#$%^&*()[]{};:'\",.<>/?\\|`~-_=+") {
      expect(slotFor(character), character).toBeDefined();
    }
    for (const character of "ÁÉÍÓÚÑÜÇáéíóúñüçßÆØåæø") {
      expect(slotFor(character), character).toBeDefined();
    }
  });

  it("leaves out the two characters that have no shape", () => {
    // A non-breaking space and a soft hyphen. A box nobody can fill is a box
    // that only ever reads as unfinished.
    expect(slotFor(" ")).toBeUndefined();
    expect(slotFor("­")).toBeUndefined();
  });

  it("names each one the way a font file does", () => {
    expect(glyphNameFor("A")).toBe("A");
    expect(glyphNameFor(".")).toBe("period");
    expect(glyphNameFor("&")).toBe("ampersand");
    expect(glyphNameFor("#")).toBe("numbersign");
    expect(glyphNameFor("é")).toBe("eacute");
    expect(glyphNameFor("Ñ")).toBe("Ntilde");
    expect(glyphNameFor("ß")).toBe("germandbls");
    expect(glyphNameFor("¿")).toBe("questiondown");
  });

  it("gives every box a distinct name", () => {
    const names = SLOTS.map((slot) => slot.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts every box in exactly one group", () => {
    const counted = SLOT_GROUPS.reduce((total, group) => total + slotsIn(group).length, 0);
    expect(counted).toBe(SLOTS.length);
  });
});

describe("filling a box", () => {
  const drawing = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">
    <rect x="50" y="300" width="300" height="400"/></svg>`;

  it("takes the character from the box, not from the file", () => {
    // A file whose name says one thing, dropped on a box that says another.
    const piece = pieceInto("Q", "definitely-an-a.svg", drawing)!;
    expect(piece.character).toBe("Q");
  });

  it("takes the character from the box even when the file names itself", () => {
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 1000"
      data-typeforge="glyph" data-typeforge-name="g" data-typeforge-advance="500"
      data-typeforge-upm="1000" data-typeforge-top="750">
      <path d="M0 0 L100 0 L100 100 Z"/></svg>`;
    expect(pieceInto("W", "g.svg", sheet)!.character).toBe("W");
  });

  it("says nothing came of a file with no drawing in it", () => {
    expect(
      pieceInto("A", "empty.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
    ).toBeNull();
  });

  it("replaces what was in the box before", () => {
    let assembly = putInSlot(emptyAssembly(), pieceInto("A", "first.svg", drawing)!);
    assembly = putInSlot(assembly, pieceInto("A", "second.svg", drawing)!);
    expect(assembly.pieces).toHaveLength(1);
    expect(assembly.pieces[0].file).toBe("second.svg");
  });

  it("replaces it even when the two files share a name", () => {
    // Two drawings both exported as `artwork.svg`, for two different letters.
    // Keyed by the file they would have been the same drawing.
    let assembly = putInSlot(emptyAssembly(), pieceInto("A", "artwork.svg", drawing)!);
    assembly = putInSlot(assembly, pieceInto("B", "artwork.svg", drawing)!);
    expect(assembly.pieces).toHaveLength(2);
    expect(
      build(assembly)
        .letters.map((letter) => letter.character)
        .sort(),
    ).toEqual(["A", "B"]);
  });

  it("empties one box and leaves the rest alone", () => {
    let assembly = putInSlot(emptyAssembly(), pieceInto("A", "a.svg", drawing)!);
    assembly = putInSlot(assembly, pieceInto("B", "b.svg", drawing)!);
    const after = clearSlot(assembly, "A");
    expect(build(after).letters.map((letter) => letter.character)).toEqual(["B"]);
  });

  it("changes nothing about the assembly it came from", () => {
    const before = putInSlot(emptyAssembly(), pieceInto("A", "a.svg", drawing)!);
    const after = putInSlot(before, pieceInto("B", "b.svg", drawing)!);
    expect(before.pieces).toHaveLength(1);
    expect(after.pieces).toHaveLength(2);
  });

  it("takes a drawing dropped in a heap the other way, by its name", () => {
    // The second way in is still there, and still guesses -- which is right,
    // because nobody pointed at anything.
    const assembly = addPieces(emptyAssembly(), [pieceFrom("R_.svg", drawing)!]);
    expect(build(assembly).letters[0].character).toBe("R");
  });
});

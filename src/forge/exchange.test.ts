/**
 * A letter leaving the family and coming back.
 *
 * The geometry of the trip is checked in font/svg.test.ts. What is checked
 * here is what it means for the font: that the letter lands in its own space,
 * that it stops answering to the sliders while it is out, and that putting it
 * back under the family's control puts it back exactly.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ready } from "@/font/boolean";

import { contoursBounds, contoursToSvgPath } from "@/font/geometry";
import { readSvg } from "@/font/svg";
import {
  draw,
  editCut,
  importLetter,
  isImported,
  relinkLetter,
  startFrom,
  editPen,
  type Forge,
} from "./document";
import { guidesFor, letterSvg, readLetterSvg } from "./exchange";
import { troubles } from "./health";
import { SANS, SERIF } from "./style";
import { toTypeface } from "./typeface";

/** Send a letter out and bring it straight back, untouched. */
function roundTrip(letter: string, forge = startFrom(SANS)) {
  const svg = letterSvg(letter, forge);
  expect(svg).not.toBeNull();
  const arrival = readLetterSvg(svg as string, forge);
  expect(arrival).not.toBeNull();
  return arrival!;
}

describe("the sheet", () => {
  it("carries the lines a letter is drawn against", () => {
    const forge = startFrom(SANS);
    const svg = letterSvg("n", forge) as string;
    for (const guide of guidesFor(forge)) {
      expect(svg).toContain(`>${guide.label}<`);
    }
  });

  it("names the letter it is for", () => {
    expect(letterSvg("n", startFrom(SANS)) as string).toContain('data-typeforge-name="n"');
  });

  it("is a sheet for every letter in the font, marks included", () => {
    const forge = startFrom(SERIF);
    for (const letter of ["A", "a", "period", "question", "eight"]) {
      const svg = letterSvg(letter, forge);
      expect(svg, letter).not.toBeNull();
      expect(readSvg(svg as string).contours.length, letter).toBeGreaterThan(0);
    }
  });

  it("has nothing to say about a letter that does not exist", () => {
    expect(letterSvg("ð", startFrom(SANS))).toBeNull();
  });
});

describe("coming back", () => {
  it("lands on the same coordinates it left with", () => {
    const forge = startFrom(SANS);
    const before = draw("g", forge)!;
    const arrival = roundTrip("g", forge);

    const was = contoursBounds(before.contours);
    const now = contoursBounds(arrival.contours);
    expect(now.xMin).toBeCloseTo(was.xMin, 2);
    expect(now.xMax).toBeCloseTo(was.xMax, 2);
    expect(now.yMin).toBeCloseTo(was.yMin, 2);
    expect(now.yMax).toBeCloseTo(was.yMax, 2);
  });

  it("keeps the advance the letter had, not one worked out from the drawing", () => {
    const forge = startFrom(SANS);
    const before = draw("i", forge)!;
    // A drawing narrower than the letter it replaces must not narrow the slot,
    // or the spacing of the whole font moves under a single letter's edit.
    const narrowed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"
        data-typeforge="glyph" data-typeforge-name="i" data-typeforge-advance="12"
        data-typeforge-upm="1000" data-typeforge-top="750">
        <path d="M0 0 L10 0 L10 10 Z"/></svg>`;
    const arrival = readLetterSvg(narrowed, forge, "i")!;
    expect(arrival.advanceWidth).toBe(before.advanceWidth);
  });

  it("goes into the letter it is dropped on, and says when that is not its own", () => {
    const forge = startFrom(SANS);
    const svg = letterSvg("m", forge) as string;
    const arrival = readLetterSvg(svg, forge, "w")!;
    expect(arrival.letter).toBe("w");
    expect(arrival.mismatched).toBe(true);
    expect(arrival.note?.name).toBe("m");
  });

  it("is content when the file is for the letter it is going into", () => {
    expect(roundTrip("s").mismatched).toBe(false);
  });

  it("refuses a file with no outline in it", () => {
    const forge = startFrom(SANS);
    expect(readLetterSvg("<svg xmlns='http://www.w3.org/2000/svg'></svg>", forge, "a")).toBeNull();
    expect(readLetterSvg("not an svg", forge, "a")).toBeNull();
  });

  it("has nowhere to put a file that names no letter and is dropped on nothing", () => {
    const forge = startFrom(SANS);
    const anonymous = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <rect x="0" y="0" width="5" height="5"/></svg>`;
    expect(readLetterSvg(anonymous, forge)).toBeNull();
  });
});

describe("a letter that is no longer drawn", () => {
  const taken = (letter = "a") => {
    const forge = startFrom(SANS);
    const arrival = roundTrip(letter, forge);
    return importLetter(forge, letter, {
      contours: arrival.contours,
      advanceWidth: arrival.advanceWidth,
      from: `${letter}.svg`,
    });
  };

  it("is the outline that came in, not the one the recipe would draw", () => {
    const forge = startFrom(SANS);
    const outline = {
      contours: [
        {
          closed: true,
          nodes: [
            { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" as const },
            { point: { x: 300, y: 0 }, handleIn: null, handleOut: null, type: "corner" as const },
            { point: { x: 300, y: 400 }, handleIn: null, handleOut: null, type: "corner" as const },
          ],
        },
      ],
      advanceWidth: 400,
      from: "wedge.svg",
    };
    const after = importLetter(forge, "a", outline);
    const drawn = draw("a", after)!;
    expect(drawn.contours).toHaveLength(1);
    expect(drawn.contours[0].nodes).toHaveLength(3);
    expect(drawn.advanceWidth).toBe(400);
  });

  it("says it is imported, and only it does", () => {
    const forge = taken("a");
    expect(isImported(forge, "a")).toBe(true);
    expect(isImported(forge, "b")).toBe(false);
  });

  it("does not move when the pen does, and the rest of the font does", () => {
    const forge = taken("a");
    const before = draw("a", forge)!;
    const beforeN = draw("n", forge)!;

    const heavier = editPen(forge, { weight: forge.style.pen.weight * 1.6 });
    const after = draw("a", heavier)!;
    const afterN = draw("n", heavier)!;

    const was = contoursBounds(before.contours);
    const now = contoursBounds(after.contours);
    expect(now.xMin).toBeCloseTo(was.xMin, 6);
    expect(now.xMax).toBeCloseTo(was.xMax, 6);

    // The point of the check: the family still moved. If it did not, this test
    // would pass on a font where nothing works.
    const nWas = contoursBounds(beforeN.contours);
    const nNow = contoursBounds(afterN.contours);
    expect(Math.abs(nNow.xMax - nWas.xMax)).toBeGreaterThan(1);
  });

  it("comes back to the family exactly as it was", () => {
    const forge = startFrom(SANS);
    const original = draw("e", forge)!;
    const out = importLetter(forge, "e", { contours: [], advanceWidth: 1, from: "x.svg" });
    const back = relinkLetter(out, "e");

    expect(isImported(back, "e")).toBe(false);
    const drawn = draw("e", back)!;
    expect(drawn.advanceWidth).toBe(original.advanceWidth);
    expect(drawn.contours).toEqual(original.contours);
  });

  it("is left alone by relinking a letter that never left", () => {
    const forge = taken("a");
    expect(relinkLetter(forge, "b")).toBe(forge);
  });

  it("changes nothing about the document it came from", () => {
    const forge = startFrom(SANS);
    const after = importLetter(forge, "a", { contours: [], advanceWidth: 1, from: "x.svg" });
    expect(isImported(forge, "a")).toBe(false);
    expect(isImported(after, "a")).toBe(true);
  });

  it("is still measured by the checks", () => {
    // A drawing that runs a long way over the ascender is worth being told
    // about, and being drawn by hand is no reason to stop looking.
    const forge = startFrom(SANS);
    const tall = forge.style.metrics.ascender * 2;
    const after = importLetter(forge, "a", {
      contours: [
        {
          closed: true,
          nodes: [
            { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" as const },
            { point: { x: 300, y: 0 }, handleIn: null, handleOut: null, type: "corner" as const },
            { point: { x: 300, y: tall }, handleIn: null, handleOut: null, type: "corner" as const },
          ],
        },
      ],
      advanceWidth: 400,
      from: "tall.svg",
    });
    expect(troubles(forge)).toEqual([]);
    expect(troubles(after).some((trouble) => trouble.letters.includes("a"))).toBe(true);
  });

  it("goes into the exported font like any other letter", async () => {
    const forge = taken("a");
    const typeface = await toTypeface(forge, {
      familyName: "Trip",
      styleName: "Regular",
      merge: false,
    });
    const glyph = typeface.glyphs.find((candidate) => candidate.name === "a");
    expect(glyph).toBeDefined();
    expect(glyph!.contours.length).toBeGreaterThan(0);
    expect(glyph!.advanceWidth).toBe(draw("a", forge)!.advanceWidth);
  });
});

/**
 * The cuts, on a letter the family did not draw.
 *
 * An imported letter used to pass straight through them, and the effect was a
 * font that disagreed with itself: slots across every letter but the one
 * somebody had drawn by hand, which sat in the middle of the word solid.
 */
describe("cutting a letter that came in from outside", () => {
  beforeAll(async () => {
    await ready();
  });

  const taken = (letter = "a", forge = startFrom(SANS)) => {
    const arrival = roundTrip(letter, forge);
    return importLetter(forge, letter, {
      contours: arrival.contours,
      advanceWidth: arrival.advanceWidth,
      from: `${letter}.svg`,
    });
  };

  const slotted = (forge: Forge) => editCut(forge, "slot", { on: true });
  const path = (letter: string, forge: Forge) =>
    contoursToSvgPath(draw(letter, forge)?.contours ?? []);

  it("cuts it with the rest of the font", () => {
    const outside = taken("a");
    const before = path("a", outside);
    const after = slotted(outside);

    expect(path("a", after)).not.toBe(before);
    expect(draw("a", after)!.cut!.pieces).toBeGreaterThan(1);
    // And it is cut like the letters around it, not left behind by them.
    expect(draw("n", after)!.cut!.pieces).toBeGreaterThan(1);
  });

  it("leaves it the width it arrived with", () => {
    const outside = taken("a");
    expect(draw("a", slotted(outside))!.advanceWidth).toBe(draw("a", outside)!.advanceWidth);
  });

  it("cannot reach it with the two made out of the skeleton", () => {
    const outside = taken("a");
    const before = path("a", outside);
    for (const name of ["inline", "split"] as const) {
      const after = editCut(outside, name, { on: true });
      // Nothing happens to the drawing, and nothing goes wrong either.
      expect(path("a", after), name).toBe(before);
      // While the letters that do have a skeleton are cut as usual.
      expect(path("n", after), name).not.toBe(path("n", outside));
    }
  });

  it("counts its pieces in the warnings like any other letter", () => {
    const outside = slotted(taken("a"));
    const said = troubles(outside).find((one) => one.what.includes("cut into pieces"));
    expect(said).toBeDefined();
    expect(Number(said!.what.split(" ")[0])).toBeGreaterThan(1);
  });

  it("sends the solid letter out to be drawn on, not the cut one", () => {
    /*
     * Otherwise the cut stops being a description. Export a slotted n and the
     * slots arrive in the file as part of the outline; bring it back and the
     * font cuts fresh slots through the ones already there, and the second
     * trip does it again.
     */
    const cut = slotted(startFrom(SANS));
    const sheet = letterSvg("n", cut) as string;
    const plain = letterSvg("n", startFrom(SANS)) as string;
    expect(sheet).toBe(plain);

    // So a letter that goes out and comes straight back is cut once, not twice.
    const back = taken("n", cut);
    expect(draw("n", back)!.cut!.pieces).toBe(draw("n", cut)!.cut!.pieces);
  });
});

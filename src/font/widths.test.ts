/**
 * The two pieces of the font writer that a width needed.
 *
 * The names: a Condensed Bold is a Bold in a family that is condensed
 * throughout, as far as name ids 1 and 2 can say, and the whole of it in 16
 * and 17. And the corners: a master on two axes at once is written as what is
 * left of it once the masters on one axis have been added, so a reader adding
 * all three arrives where it was drawn.
 */

import { describe, expect, it } from "vitest";

import { familyNames } from "./tables";
import { emptyTypeface } from "./types";
import { buildGvar, normalise, regionOf, scalarAt, type Axis, type Master } from "./variable";

const meta = (styleName: string, widthClass?: number) => ({
  ...emptyTypeface().meta,
  familyName: "Widened",
  styleName,
  ...(widthClass === undefined ? {} : { widthClass }),
});

describe("the names of a face with a width", () => {
  it("puts the width in the family of the old pair and the style after it", () => {
    expect(familyNames(meta("Condensed Bold", 3))).toEqual({
      familyName: "Widened Condensed",
      styleName: "Bold",
      typographicFamily: "Widened",
      typographicStyle: "Condensed Bold",
    });
    expect(familyNames(meta("Condensed", 3))).toEqual({
      familyName: "Widened Condensed",
      styleName: "Regular",
      typographicFamily: "Widened",
      typographicStyle: "Condensed",
    });
    expect(familyNames(meta("Expanded SemiBold", 7))).toEqual({
      familyName: "Widened Expanded SemiBold",
      styleName: "Regular",
      typographicFamily: "Widened",
      typographicStyle: "Expanded SemiBold",
    });
  });

  it("names everything else exactly as it did", () => {
    // No width said, or a Normal: the same answer as before there were widths,
    // whatever the style happens to be called.
    for (const style of ["Bold", "Regular", "SemiBold", "Condensed Bold", "Black Italic"]) {
      expect(familyNames(meta(style, 5))).toEqual(familyNames(meta(style)));
    }
    expect(familyNames(meta("Condensed Bold"))).toEqual({
      familyName: "Widened Condensed Bold",
      styleName: "Regular",
      typographicFamily: "Widened",
      typographicStyle: "Condensed Bold",
    });
  });
});

describe("a master at a corner", () => {
  const axes: Axis[] = [
    { tag: "wght", label: "Weight", min: 400, default: 400, max: 700 },
    { tag: "wdth", label: "Width", min: 75, default: 100, max: 100 },
  ];
  /** One glyph of one on-curve point, at `x`, with an advance of `advance`. */
  const master = (at: Record<string, number>, x: number, advance: number): Master => ({
    at,
    glyphs: [
      { points: [{ x, y: 0, onCurve: true }], advanceWidth: advance, leftSideBearing: x, xMin: x },
    ],
  });
  const regular = master({}, 100, 600);
  const masters = [
    master({ wght: 700, wdth: 100 }, 130, 680),
    master({ wght: 400, wdth: 75 }, 80, 480),
    // Drawn, and not the sum of the two: a Condensed Bold's counters close
    // on the Condensed's, so it is narrower than the Bold's gain implies.
    master({ wght: 700, wdth: 75 }, 104, 530),
  ];

  /** Where the reader puts the point and the advance at `at`, from the tuples. */
  const read = (written: ReturnType<typeof buildGvar>, at: Record<string, number>) => {
    // The point and the advance's phantom are the first and third deltas of
    // each tuple; decoded here by asking the same arithmetic the reader uses.
    const tuples = decode(written.gvar, axes.length, 1 + 4);
    const location = normalise(axes, at);
    let x = 100;
    let right = 600; // the phantom: an origin of nought, plus the advance
    for (const tuple of tuples) {
      const share = scalarAt(tuple, location);
      x += share * tuple.deltas[0].x;
      right += share * tuple.deltas[2].x;
    }
    return { x, advance: right };
  };

  it("arrives at each corner where that corner was drawn", () => {
    const written = buildGvar(axes, regular, masters, true);
    expect(written.unvarying).toEqual([]);
    expect(read(written, { wght: 700, wdth: 75 })).toEqual({ x: 104, advance: 530 });
    expect(read(written, { wght: 700, wdth: 100 })).toEqual({ x: 130, advance: 680 });
    expect(read(written, { wght: 400, wdth: 75 })).toEqual({ x: 80, advance: 480 });
    expect(read(written, { wght: 400, wdth: 100 })).toEqual({ x: 100, advance: 600 });
  });

  it("counts the Bold twice without it, which is what it is for", () => {
    // Written as a star, the corner's whole difference lands on top of the
    // Bold's and the Condensed's.
    const written = buildGvar(axes, regular, masters);
    expect(read(written, { wght: 700, wdth: 75 }).x).toBe(130 + 80 - 100 + 104 - 100);
  });

  it("writes a star exactly as it did", () => {
    const star = masters.slice(0, 2);
    expect(buildGvar(axes, regular, star, true)).toEqual(buildGvar(axes, regular, star));
  });

  it("has the regions a grid wants", () => {
    const all = [regular, ...masters];
    expect(regionOf(axes, { wght: 700, wdth: 75 }, all)).toEqual({
      peak: [1, -1],
      start: [0, -1],
      end: [1, 0],
    });
  });
});

/**
 * The tuples of the first glyph of a `gvar` written as `buildGvar` writes it:
 * every tuple with its own peak and intermediate region, and every point's
 * deltas, unpacked from the runs it packs them in.
 */
function decode(
  gvar: Uint8Array,
  axisCount: number,
  pointCount: number,
): Array<{
  peak: number[];
  start: number[];
  end: number[];
  deltas: Array<{ x: number; y: number }>;
}> {
  const view = new DataView(gvar.buffer, gvar.byteOffset, gvar.byteLength);
  const dataStart = view.getUint32(16);
  const first = dataStart + view.getUint32(20);
  const f2 = (at: number) => view.getInt16(at) / 16384;

  const countWord = view.getUint16(first);
  const count = countWord & 0x0fff;
  let data = first + view.getUint16(first + 2);
  let header = first + 4;
  const out = [];
  for (let index = 0; index < count; index++) {
    const size = view.getUint16(header);
    const index_ = view.getUint16(header + 2);
    header += 4;
    const peak: number[] = [];
    const start: number[] = [];
    const end: number[] = [];
    for (let axis = 0; axis < axisCount; axis++) peak.push(f2(header + axis * 2));
    header += axisCount * 2;
    if (index_ & 0x4000) {
      for (let axis = 0; axis < axisCount; axis++) start.push(f2(header + axis * 2));
      header += axisCount * 2;
      for (let axis = 0; axis < axisCount; axis++) end.push(f2(header + axis * 2));
      header += axisCount * 2;
    }
    // Past the one byte that says "every point".
    const values = unpack(view, data + 1, pointCount * 2);
    data += size;
    out.push({
      peak,
      start,
      end,
      deltas: Array.from({ length: pointCount }, (_, at) => ({
        x: values[at],
        y: values[pointCount + at],
      })),
    });
  }
  return out;
}

function unpack(view: DataView, from: number, wanted: number): number[] {
  const values: number[] = [];
  let at = from;
  while (values.length < wanted) {
    const control = view.getUint8(at++);
    const run = (control & 0x3f) + 1;
    if (control & 0x80) {
      for (let one = 0; one < run; one++) values.push(0);
    } else if (control & 0x40) {
      for (let one = 0; one < run; one++, at += 2) values.push(view.getInt16(at));
    } else {
      for (let one = 0; one < run; one++, at += 1) values.push(view.getInt8(at));
    }
  }
  return values;
}

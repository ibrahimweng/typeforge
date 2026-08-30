/**
 * That a contour survives the trip in both directions.
 *
 * The point of these is the three awkward cases rather than the ordinary one:
 * the wrap at the end of a closed contour, the quadratic segments a converted
 * font is full of, and a contour that does not begin where the walk would like
 * it to. Each of them is a way for a letter to come back subtly wrong rather
 * than obviously broken -- a curve flattened into a line, a bowl that has lost
 * a quarter of itself -- which is exactly the kind of fault a round-trip test
 * catches and an eye does not.
 */

import { describe, expect, it } from "vitest";

import type { Contour, Glyph } from "@/font/types";
import { fileNameFor, readGlif, writeGlif } from "./glif";

const wrap = (inside: string, name = "test") =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<glyph name="${name}" format="2">\n${inside}\n</glyph>`;

/** A glyph with nothing but what it is given. */
function glyphWith(contours: Contour[], extra: Partial<Glyph> = {}): Glyph {
  return {
    name: "test",
    unicodes: [],
    advanceWidth: 500,
    contours,
    components: [],
    anchors: [],
    params: {},
    dirty: false,
    ...extra,
  };
}

describe("reading a contour out of a glif", () => {
  it("gives each node the handles either side of it", () => {
    const glyph = readGlif(
      wrap(`<outline><contour>
        <point x="0" y="0" type="curve"/>
        <point x="10" y="10"/>
        <point x="20" y="20"/>
        <point x="30" y="30" type="curve"/>
        <point x="40" y="40"/>
        <point x="50" y="50"/>
      </contour></outline>`),
    );
    const nodes = glyph!.contours[0].nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].point).toEqual({ x: 0, y: 0 });
    expect(nodes[0].handleOut).toEqual({ x: 10, y: 10 });
    expect(nodes[1].handleIn).toEqual({ x: 20, y: 20 });
    expect(nodes[1].point).toEqual({ x: 30, y: 30 });
    expect(nodes[1].handleOut).toEqual({ x: 40, y: 40 });
  });

  it("wraps the trailing controls onto the first node", () => {
    /*
     * The trap. A closed contour's list is cyclic, so the two controls at the
     * end belong to the segment arriving back at the first point. Read left to
     * right and stopped at the end of the list, that last segment loses its
     * curve and the letter comes back with one side flattened.
     */
    const glyph = readGlif(
      wrap(`<outline><contour>
        <point x="0" y="0" type="curve"/>
        <point x="10" y="10"/>
        <point x="20" y="20"/>
        <point x="30" y="30" type="curve"/>
        <point x="40" y="40"/>
        <point x="50" y="50"/>
      </contour></outline>`),
    );
    expect(glyph!.contours[0].closed).toBe(true);
    expect(glyph!.contours[0].nodes[0].handleIn).toEqual({ x: 50, y: 50 });
  });

  it("keeps an open contour open and gives its first node no handle in", () => {
    const glyph = readGlif(
      wrap(`<outline><contour>
        <point x="0" y="0" type="move"/>
        <point x="10" y="0"/>
        <point x="20" y="0"/>
        <point x="30" y="0" type="curve"/>
      </contour></outline>`),
    );
    const contour = glyph!.contours[0];
    expect(contour.closed).toBe(false);
    expect(contour.nodes[0].handleIn).toBeNull();
    expect(contour.nodes).toHaveLength(2);
  });

  it("starts a closed contour wherever the file did", () => {
    // A list that opens on control points is legal and common in a converted
    // font. Rotating to the first on-curve point is what makes the walk work;
    // without it the first segment is read against nothing.
    const glyph = readGlif(
      wrap(`<outline><contour>
        <point x="40" y="40"/>
        <point x="50" y="50"/>
        <point x="0" y="0" type="curve"/>
        <point x="10" y="10"/>
        <point x="20" y="20"/>
        <point x="30" y="30" type="curve"/>
      </contour></outline>`),
    );
    const nodes = glyph!.contours[0].nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].point).toEqual({ x: 0, y: 0 });
    expect(nodes[0].handleIn).toEqual({ x: 50, y: 50 });
  });

  it("turns a quadratic segment into a cubic one", () => {
    const glyph = readGlif(
      wrap(`<outline><contour>
        <point x="0" y="0" type="qcurve"/>
        <point x="50" y="100"/>
        <point x="100" y="0" type="qcurve"/>
      </contour></outline>`),
    );
    const nodes = glyph!.contours[0].nodes;
    // The single control becomes two, at a third and two thirds of the way to
    // it, which is what the exact conversion gives. Compared loosely because
    // the two ways of arriving at a third differ in the last bit, and that is
    // a fact about floating point rather than about curves.
    expect(nodes[0].handleOut!.x).toBeCloseTo(100 / 3, 9);
    expect(nodes[0].handleOut!.y).toBeCloseTo(200 / 3, 9);
    expect(nodes[1].handleIn!.x).toBeCloseTo(200 / 3, 9);
    expect(nodes[1].handleIn!.y).toBeCloseTo(200 / 3, 9);
  });

  it("puts back the on-curve points a run of quadratic controls leaves out", () => {
    /*
     * TrueType writes `n` controls for `n` curves and implies the points
     * between them. One point in the file becomes more than one node here, so
     * this cannot be a point-for-point translation and a reader that assumes it
     * is loses every curve but the last.
     */
    const glyph = readGlif(
      wrap(`<outline><contour>
        <point x="0" y="0" type="qcurve"/>
        <point x="0" y="100"/>
        <point x="100" y="100"/>
        <point x="100" y="0" type="qcurve"/>
      </contour></outline>`),
    );
    const nodes = glyph!.contours[0].nodes;
    expect(nodes.length).toBeGreaterThan(2);
    // The implied point sits midway between the two controls.
    expect(nodes.some((one) => one.point.x === 50 && one.point.y === 100)).toBe(true);
  });

  it("reads a contour whose points are every one of them controls", () => {
    // Legal in TrueType and real in a converted font: a circle with no
    // on-curve points at all. Dropping it would be a hole in a letter with
    // nothing to account for it.
    const glyph = readGlif(
      wrap(`<outline><contour>
        <point x="0" y="100"/>
        <point x="100" y="100"/>
        <point x="100" y="0"/>
        <point x="0" y="0"/>
      </contour></outline>`),
    );
    expect(glyph!.contours[0].nodes.length).toBeGreaterThan(2);
    expect(glyph!.contours[0].closed).toBe(true);
  });

  it("takes the file's word for which points are smooth", () => {
    // A designer marked that point smooth. Re-deriving it from the coordinates
    // would be overruling them with arithmetic.
    const glyph = readGlif(
      wrap(`<outline><contour>
        <point x="0" y="0" type="curve" smooth="yes"/>
        <point x="10" y="10"/>
        <point x="20" y="20"/>
        <point x="30" y="30" type="curve"/>
        <point x="40" y="40"/>
        <point x="50" y="50"/>
      </contour></outline>`),
    );
    expect(glyph!.contours[0].nodes[0].type).toBe("smooth");
    expect(glyph!.contours[0].nodes[1].type).toBe("corner");
  });
});

describe("everything else in a glif", () => {
  it("reads the advance, the characters and the anchors", () => {
    const glyph = readGlif(
      wrap(
        `<advance width="1200"/>
         <unicode hex="00E1"/>
         <unicode hex="F0001"/>
         <outline/>
         <anchor name="top" x="600" y="1400"/>`,
        "aacute",
      ),
    );
    expect(glyph!.name).toBe("aacute");
    expect(glyph!.advanceWidth).toBe(1200);
    expect(glyph!.unicodes).toEqual([0xe1, 0xf0001]);
    expect(glyph!.anchors).toEqual([{ name: "top", x: 600, y: 1400 }]);
  });

  it("reads a component and the transform on it", () => {
    const glyph = readGlif(
      wrap(`<outline>
        <component base="a"/>
        <component base="acute" xOffset="100" yOffset="900" xScale="-1"/>
      </outline>`),
    );
    expect(glyph!.components[0]).toEqual({
      glyphName: "a",
      transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 },
    });
    expect(glyph!.components[1].transform).toEqual({
      a: -1,
      b: 0,
      c: 0,
      d: 1,
      dx: 100,
      dy: 900,
    });
  });

  it("gives back nothing for a file that is not a glyph", () => {
    expect(readGlif("<plist><dict/></plist>")).toBeNull();
    expect(readGlif("<glyph/>")).toBeNull();
    expect(readGlif("nonsense")).toBeNull();
  });
});

describe("a glyph written out and read back", () => {
  const roundTrips = (glyph: Glyph) => {
    const back = readGlif(writeGlif(glyph));
    expect(back).not.toBeNull();
    return back!;
  };

  it("keeps a closed curve, wrap and all", () => {
    const glyph = glyphWith([
      {
        closed: true,
        nodes: [
          { point: { x: 0, y: 0 }, handleIn: { x: 50, y: 50 }, handleOut: { x: 10, y: 10 }, type: "corner" },
          { point: { x: 30, y: 30 }, handleIn: { x: 20, y: 20 }, handleOut: { x: 40, y: 40 }, type: "smooth" },
        ],
      },
    ]);
    expect(roundTrips(glyph).contours).toEqual(glyph.contours);
  });

  it("keeps an open contour open", () => {
    const glyph = glyphWith([
      {
        closed: false,
        nodes: [
          { point: { x: 0, y: 0 }, handleIn: null, handleOut: { x: 10, y: 0 }, type: "corner" },
          { point: { x: 30, y: 0 }, handleIn: { x: 20, y: 0 }, handleOut: null, type: "corner" },
        ],
      },
    ]);
    expect(roundTrips(glyph).contours).toEqual(glyph.contours);
  });

  it("keeps a straight-sided contour straight", () => {
    const square: Contour = {
      closed: true,
      nodes: [
        { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 100, y: 100 }, handleIn: null, handleOut: null, type: "corner" },
        { point: { x: 0, y: 100 }, handleIn: null, handleOut: null, type: "corner" },
      ],
    };
    expect(roundTrips(glyphWith([square])).contours).toEqual([square]);
  });

  it("keeps the advance, the characters, the components and the anchors", () => {
    const glyph = glyphWith([], {
      name: "aacute",
      unicodes: [0xe1],
      advanceWidth: 1200,
      components: [
        { glyphName: "a", transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
        { glyphName: "acute", transform: { a: 1, b: 0, c: 0, d: 1, dx: 100, dy: 900 } },
      ],
      anchors: [{ name: "top", x: 600, y: 1400 }],
    });
    const back = roundTrips(glyph);
    expect(back.name).toBe("aacute");
    expect(back.unicodes).toEqual([0xe1]);
    expect(back.advanceWidth).toBe(1200);
    expect(back.components).toEqual(glyph.components);
    expect(back.anchors).toEqual(glyph.anchors);
  });

  it("writes a name that would break the XML around it", () => {
    const glyph = glyphWith([], { name: 'a<b&c"d' });
    expect(roundTrips(glyph).name).toBe('a<b&c"d');
  });

  it("does not write a coordinate as a float that is an integer", () => {
    // `x="0"` rather than `x="0.000000"`, which is what every other tool writes
    // and what keeps a diff to the lines that changed.
    const written = writeGlif(
      glyphWith(
        [
          {
            closed: true,
            nodes: [
              { point: { x: 0, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
              { point: { x: 100, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
              { point: { x: 100, y: 100 }, handleIn: null, handleOut: null, type: "corner" },
            ],
          },
        ],
        { advanceWidth: 500 },
      ),
    );
    expect(written).toContain('width="500"');
    // Only the coordinates: the declaration at the top says version "1.0" and
    // is not what this is about.
    for (const match of written.matchAll(/(?:x|y|width)="([^"]+)"/g)) {
      expect(match[1]).not.toContain(".");
    }
  });
});

describe("the file a glyph is stored under", () => {
  it("marks a capital, because two disks disagree about what a name is", () => {
    // `A` and `a` are one file on a Mac and two on Linux. The underscore is
    // what the format specifies to tell them apart on both.
    const taken = new Set<string>();
    expect(fileNameFor("A", taken)).toBe("A_.glif");
    expect(fileNameFor("a", taken)).toBe("a.glif");
    expect(fileNameFor("Aacute", taken)).toBe("A_acute.glif");
  });

  it("replaces what a file name cannot contain", () => {
    const taken = new Set<string>();
    expect(fileNameFor("a/b", taken)).toBe("a_b.glif");
    expect(fileNameFor("a:b*c", taken)).toBe("a_b_c.glif");
  });

  it("gets out of the way of a name Windows has reserved", () => {
    /*
     * `nul` is caught and `NUL` is not, which looks wrong and is what the
     * reference implementation does. Capitals are marked before anything asks
     * about reserved names, so by then `NUL` is `N_U_L_` and no longer one.
     * Both are safe; matching the reference exactly is what lets a folder
     * written here sit beside one written by the Python tools.
     */
    const taken = new Set<string>();
    expect(fileNameFor("con", taken)).toBe("_con.glif");
    expect(fileNameFor("nul", taken)).toBe("_nul.glif");
    expect(fileNameFor("NUL", taken)).toBe("N_U_L_.glif");
    expect(fileNameFor("a.con", taken)).toBe("a._con.glif");
  });

  it("moves a leading period out of the way, which every font needs", () => {
    // `.notdef` is in every font there has ever been, and a file whose name
    // starts with a dot is hidden on every Unix.
    const taken = new Set<string>();
    expect(fileNameFor(".notdef", taken)).toBe("_notdef.glif");
    expect(fileNameFor(".null", taken)).toBe("_null.glif");
  });

  it("moves the second glyph that wants a name already taken", () => {
    const taken = new Set<string>();
    expect(fileNameFor("a", taken)).toBe("a.glif");
    expect(fileNameFor("a", taken)).toBe("a.000000000000001.glif");
  });
});

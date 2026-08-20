/**
 * The trip out and back.
 *
 * Two things are being checked, and they are not the same thing. One is that a
 * letter this application wrote comes back where it was, which is a matter of
 * the export and the import agreeing. The other is that a file some other
 * program wrote is read correctly, which is a matter of the parser being right
 * about SVG -- and the only way to check that is against files written the way
 * those programs write them.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds } from "./geometry";
import { glyphSvg, parsePath, readSvg, svgToFontUnits } from "./svg";
import type { Contour } from "./types";

const METRICS = { top: 750, bottom: -250, advanceWidth: 600, unitsPerEm: 1000 };

const GUIDES = [
  { label: "baseline", height: 0 },
  { label: "x-height", height: 500 },
  { label: "cap height", height: 700 },
];

/** A letter-shaped thing: a stem with a bowl, so there is a counter to lose. */
function sampleContours(): Contour[] {
  const outer: Contour = {
    closed: true,
    nodes: [
      { point: { x: 80, y: 0 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 400, y: 0 }, handleIn: null, handleOut: { x: 520, y: 0 }, type: "corner" },
      { point: { x: 400, y: 500 }, handleIn: { x: 520, y: 500 }, handleOut: null, type: "corner" },
      { point: { x: 80, y: 500 }, handleIn: null, handleOut: null, type: "corner" },
    ],
  };
  const counter: Contour = {
    closed: true,
    nodes: [
      { point: { x: 180, y: 120 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 180, y: 380 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 320, y: 380 }, handleIn: null, handleOut: null, type: "corner" },
      { point: { x: 320, y: 120 }, handleIn: null, handleOut: null, type: "corner" },
    ],
  };
  return [outer, counter];
}

function sheet(contours = sampleContours()): string {
  return glyphSvg({
    name: "a",
    contours,
    advanceWidth: METRICS.advanceWidth,
    unitsPerEm: METRICS.unitsPerEm,
    top: METRICS.top,
    bottom: METRICS.bottom,
    guides: GUIDES,
    sidebearings: { left: 80, right: 80 },
  });
}

/** Every on-curve point and handle of a set of contours, in order. */
function points(contours: Contour[]): number[] {
  const out: number[] = [];
  for (const contour of contours) {
    for (const node of contour.nodes) {
      out.push(node.point.x, node.point.y);
      if (node.handleIn) out.push(node.handleIn.x, node.handleIn.y);
      if (node.handleOut) out.push(node.handleOut.x, node.handleOut.y);
    }
  }
  return out;
}

describe("the round trip", () => {
  it("brings a letter back to the coordinates it left with", () => {
    const original = sampleContours();
    const back = svgToFontUnits(readSvg(sheet(original)), METRICS);

    expect(back.advanceWidth).toBe(METRICS.advanceWidth);
    expect(back.contours).toHaveLength(original.length);
    const before = points(original);
    const after = points(back.contours);
    expect(after).toHaveLength(before.length);
    for (let index = 0; index < before.length; index++) {
      expect(after[index]).toBeCloseTo(before[index], 3);
    }
  });

  it("keeps the counter as its own contour rather than fusing it in", () => {
    const back = svgToFontUnits(readSvg(sheet()), METRICS);
    expect(back.contours).toHaveLength(2);
    expect(back.contours.every((contour) => contour.closed)).toBe(true);
  });

  it("leaves the guides out of the letter", () => {
    const back = svgToFontUnits(readSvg(sheet()), METRICS);
    // Three horizontal guides and two vertical ones, all open two-point runs.
    // Any of them read as ink would show up as an extra contour.
    expect(back.contours).toHaveLength(2);
    const bounds = contoursBounds(back.contours);
    expect(bounds.yMin).toBeCloseTo(0, 3);
    expect(bounds.yMax).toBeCloseTo(500, 3);
  });

  it("says which letter the file is for", () => {
    const drawing = readSvg(sheet());
    expect(drawing.note?.name).toBe("a");
    expect(drawing.note?.advanceWidth).toBe(600);
    expect(drawing.note?.top).toBe(750);
    expect(drawing.note?.unitsPerEm).toBe(1000);
  });

  it("survives a second trip unchanged", () => {
    const once = svgToFontUnits(readSvg(sheet()), METRICS);
    const twice = svgToFontUnits(readSvg(sheet(once.contours)), METRICS);
    const before = points(once.contours);
    const after = points(twice.contours);
    expect(after).toHaveLength(before.length);
    for (let index = 0; index < before.length; index++) {
      expect(after[index]).toBeCloseTo(before[index], 3);
    }
  });

  it("comes back in place even when the editor rewrote the viewBox", () => {
    // Illustrator likes to trim the box to the artwork. The ink has not moved,
    // and the ink is what the coordinates say, so the letter must not move
    // either.
    const original = sheet();
    const retrimmed = original.replace(/viewBox="[^"]*"/, 'viewBox="40 30 900 900"');
    const back = svgToFontUnits(readSvg(retrimmed), METRICS);
    const bounds = contoursBounds(back.contours);
    expect(bounds.yMin).toBeCloseTo(0, 3);
    expect(bounds.yMax).toBeCloseTo(500, 3);
    expect(bounds.xMin).toBeCloseTo(80, 3);
  });
});

describe("reading what other programs write", () => {
  it("follows a group transform down onto the shapes inside it", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g transform="translate(10 20) scale(2)">
        <rect x="0" y="0" width="5" height="5"/>
      </g>
    </svg>`;
    const bounds = contoursBounds(readSvg(svg).contours);
    expect(bounds.xMin).toBeCloseTo(10, 6);
    expect(bounds.yMin).toBeCloseTo(20, 6);
    expect(bounds.xMax).toBeCloseTo(20, 6);
    expect(bounds.yMax).toBeCloseTo(30, 6);
  });

  it("nests one transform inside another in the right order", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g transform="scale(2)"><g transform="translate(3 4)">
        <rect x="0" y="0" width="1" height="1"/>
      </g></g>
    </svg>`;
    const bounds = contoursBounds(readSvg(svg).contours);
    // Scaled after translating, not before: the outer transform applies to the
    // inner one's output.
    expect(bounds.xMin).toBeCloseTo(6, 6);
    expect(bounds.yMin).toBeCloseTo(8, 6);
  });

  it("stops carrying a transform once its group has closed", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g transform="translate(50 50)"><rect x="0" y="0" width="1" height="1"/></g>
      <rect x="0" y="0" width="1" height="1"/>
    </svg>`;
    const { contours } = readSvg(svg);
    expect(contours).toHaveLength(2);
    expect(contoursBounds([contours[1]]).xMin).toBeCloseTo(0, 6);
  });

  it("reads a rotation about a point", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g transform="rotate(90 10 10)"><rect x="10" y="10" width="20" height="4"/></g>
    </svg>`;
    const bounds = contoursBounds(readSvg(svg).contours);
    // A quarter turn about the rectangle's own top-left corner, which stays
    // put: the bar swings from lying to the right of it to standing below it.
    expect(bounds.xMin).toBeCloseTo(6, 6);
    expect(bounds.xMax).toBeCloseTo(10, 6);
    expect(bounds.yMin).toBeCloseTo(10, 6);
    expect(bounds.yMax).toBeCloseTo(30, 6);
  });

  it("reads a matrix", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path transform="matrix(1 0 0 -1 0 100)" d="M0 0 L10 0 L10 10 Z"/>
    </svg>`;
    const bounds = contoursBounds(readSvg(svg).contours);
    expect(bounds.yMin).toBeCloseTo(90, 6);
    expect(bounds.yMax).toBeCloseTo(100, 6);
  });

  it("reads an ellipse, a circle and a rounded rectangle", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <ellipse cx="20" cy="20" rx="10" ry="5"/>
      <circle cx="60" cy="20" r="8"/>
      <rect x="10" y="60" width="40" height="20" rx="5"/>
    </svg>`;
    const { contours } = readSvg(svg);
    expect(contours).toHaveLength(3);
    const ellipse = contoursBounds([contours[0]]);
    expect(ellipse.xMin).toBeCloseTo(10, 6);
    expect(ellipse.xMax).toBeCloseTo(30, 6);
    expect(ellipse.yMin).toBeCloseTo(15, 6);
    expect(ellipse.yMax).toBeCloseTo(25, 6);
    const circle = contoursBounds([contours[1]]);
    expect(circle.xMax - circle.xMin).toBeCloseTo(16, 6);
    const rounded = contoursBounds([contours[2]]);
    expect(rounded.xMin).toBeCloseTo(10, 6);
    expect(rounded.xMax).toBeCloseTo(50, 6);
    expect(rounded.yMax).toBeCloseTo(80, 6);
  });

  it("reads a polygon", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <polygon points="0,0 10,0 10,10 0,10"/>
    </svg>`;
    const { contours } = readSvg(svg);
    expect(contours).toHaveLength(1);
    expect(contours[0].closed).toBe(true);
    expect(contours[0].nodes).toHaveLength(4);
  });

  it("ignores what is inside defs and clipPath", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <defs><rect x="0" y="0" width="99" height="99"/></defs>
      <clipPath id="c"><circle cx="0" cy="0" r="90"/></clipPath>
      <rect x="1" y="1" width="2" height="2"/>
    </svg>`;
    const { contours } = readSvg(svg);
    expect(contours).toHaveLength(1);
    expect(contoursBounds(contours).xMax).toBeCloseTo(3, 6);
  });

  it("ignores comments, the doctype and namespaced junk", () => {
    const svg = `<?xml version="1.0"?>
      <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://x" viewBox="0 0 100 100">
        <!-- <rect x="0" y="0" width="50" height="50"/> -->
        <inkscape:namedview pagecolor="#fff"/>
        <sodipodi:namedview/>
        <rect x="1" y="1" width="2" height="2" inkscape:label="thing"/>
      </svg>`;
    const { contours } = readSvg(svg);
    expect(contours).toHaveLength(1);
  });

  it("takes a shape written with a closing tag", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <path d="M0 0 L4 0 L4 4 Z"></path>
      <rect x="6" y="6" width="2" height="2"></rect>
    </svg>`;
    expect(readSvg(svg).contours).toHaveLength(2);
  });

  it("falls back to the whole file when the ink lost its markings", () => {
    // Somebody deleted the exported path and drew their own letter over the
    // guides, so the only shapes left are inside the guide group. Handing back
    // an empty letter would be worse than handing back the guides.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g id="typeforge-guides"><rect x="1" y="1" width="2" height="2"/></g>
    </svg>`;
    expect(readSvg(svg).contours).toHaveLength(1);
  });
});

describe("path data", () => {
  it("reads the relative commands", () => {
    const [contour] = parsePath("m 10 10 l 10 0 l 0 10 z");
    expect(contour.closed).toBe(true);
    expect(contour.nodes.map((node) => [node.point.x, node.point.y])).toEqual([
      [10, 10],
      [20, 10],
      [20, 20],
    ]);
  });

  it("reads the horizontal and vertical shorthands", () => {
    const [contour] = parsePath("M0 0 H10 V10 H0 Z");
    expect(contour.nodes.map((node) => [node.point.x, node.point.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it("repeats a command over the arguments that follow it", () => {
    const [contour] = parsePath("M0 0 L10 0 20 0 30 0 Z");
    expect(contour.nodes).toHaveLength(4);
    expect(contour.nodes[3].point.x).toBe(30);
  });

  it("treats extra pairs after a moveto as a line, not another moveto", () => {
    const contours = parsePath("M0 0 10 0 10 10 Z");
    expect(contours).toHaveLength(1);
    expect(contours[0].nodes).toHaveLength(3);
  });

  it("starts a new contour at each moveto", () => {
    const contours = parsePath("M0 0 L10 0 L10 10 Z M20 0 L30 0 L30 10 Z");
    expect(contours).toHaveLength(2);
    expect(contours[1].nodes[0].point.x).toBe(20);
  });

  it("returns to the start of the subpath after a close", () => {
    const contours = parsePath("M10 10 L20 10 Z l 5 0");
    expect(contours[1].nodes[0].point).toEqual({ x: 10, y: 10 });
    expect(contours[1].nodes[1].point).toEqual({ x: 15, y: 10 });
  });

  it("drops the duplicate point a closed path ends on", () => {
    const [contour] = parsePath("M0 0 L10 0 L10 10 L0 0 Z");
    expect(contour.nodes).toHaveLength(3);
  });

  it("mirrors the control point of a smooth curve", () => {
    const [contour] = parsePath("M0 0 C 0 10 10 10 10 0 S 20 -10 20 0");
    // The reflected handle leaving (10,0) is (10,0) - ((10,10) - (10,0)).
    expect(contour.nodes[1].handleOut).toEqual({ x: 10, y: -10 });
  });

  it("raises a quadratic to a cubic", () => {
    const [contour] = parsePath("M0 0 Q 10 10 20 0");
    expect(contour.nodes[0].handleOut?.x).toBeCloseTo(20 / 3, 6);
    expect(contour.nodes[0].handleOut?.y).toBeCloseTo(20 / 3, 6);
    expect(contour.nodes[1].handleIn?.x).toBeCloseTo(20 - 20 / 3, 6);
    expect(contour.nodes[1].handleIn?.y).toBeCloseTo(20 / 3, 6);
  });

  it("mirrors the control point of a smooth quadratic", () => {
    const [contour] = parsePath("M0 0 Q 10 10 20 0 T 40 0");
    expect(contour.nodes).toHaveLength(3);
    expect(contour.nodes[2].point).toEqual({ x: 40, y: 0 });
  });

  it("reads an arc, and puts it where the arc goes", () => {
    // A half circle of radius 10 from (0,0) to (20,0). The sweep flag set
    // means increasing angle, and since SVG measures y downwards that carries
    // the arc to negative y -- over the top, on screen.
    const [contour] = parsePath("M0 0 A 10 10 0 0 1 20 0");
    const bounds = contoursBounds([contour]);
    expect(bounds.xMin).toBeCloseTo(0, 3);
    expect(bounds.xMax).toBeCloseTo(20, 3);
    expect(bounds.yMin).toBeCloseTo(-10, 2);
    expect(bounds.yMax).toBeCloseTo(0, 3);
  });

  it("reads the other side of the same arc", () => {
    const [contour] = parsePath("M0 0 A 10 10 0 0 0 20 0");
    const bounds = contoursBounds([contour]);
    expect(bounds.yMin).toBeCloseTo(0, 3);
    expect(bounds.yMax).toBeCloseTo(10, 2);
  });

  it("reads arc flags written with nothing between them", () => {
    // `a1 1 0 011 1` is legal and Inkscape writes it. Read as ordinary numbers
    // the flags come out as 011 and the rest of the path is lost.
    const tight = parsePath("M0 0a10 10 0 0110 10");
    const spaced = parsePath("M0 0 a 10 10 0 0 1 10 10");
    expect(tight[0].nodes).toHaveLength(spaced[0].nodes.length);
    for (const contours of [tight, spaced]) {
      const bounds = contoursBounds(contours);
      expect(bounds.xMin).toBeCloseTo(0, 3);
      expect(bounds.xMax).toBeCloseTo(10, 3);
      expect(bounds.yMin).toBeCloseTo(0, 3);
      expect(bounds.yMax).toBeCloseTo(10, 3);
    }
  });

  it("grows an arc too small to reach its own endpoint", () => {
    // Written by hand, and by more than one program. The specification says to
    // scale the radii up until it fits rather than to give up.
    const [contour] = parsePath("M0 0 A 1 1 0 0 1 20 0");
    const bounds = contoursBounds([contour]);
    expect(bounds.xMax).toBeCloseTo(20, 3);
    expect(bounds.yMin).toBeCloseTo(-10, 1);
  });

  it("reads exponents and numbers run together", () => {
    const [contour] = parsePath("M1e1 1e1L20-10");
    expect(contour.nodes[0].point).toEqual({ x: 10, y: 10 });
    expect(contour.nodes[1].point).toEqual({ x: 20, y: -10 });
  });

  it("reads a run of digits with no separators around the decimal points", () => {
    const [contour] = parsePath("M0 0L1.5.5.5 1.5");
    expect(contour.nodes).toHaveLength(3);
    expect(contour.nodes[1].point).toEqual({ x: 1.5, y: 0.5 });
    expect(contour.nodes[2].point).toEqual({ x: 0.5, y: 1.5 });
  });

  it("gives up on nonsense without throwing", () => {
    expect(() => parsePath("M0 0 L")).not.toThrow();
    expect(() => parsePath("qqqq")).not.toThrow();
    expect(() => readSvg("not an svg at all")).not.toThrow();
    expect(() => readSvg("<svg><g><path d=")).not.toThrow();
  });
});

describe("a letter drawn from nothing", () => {
  it("is fitted to the metrics rather than left where it was drawn", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 200">
      <rect x="10" y="0" width="80" height="200"/>
    </svg>`;
    const back = svgToFontUnits(readSvg(svg), METRICS);
    const bounds = contoursBounds(back.contours);
    // The box is the full height of the viewBox, so it fills the band.
    expect(bounds.yMax).toBeCloseTo(METRICS.top, 3);
    expect(bounds.yMin).toBeCloseTo(METRICS.bottom, 3);
    expect(back.advanceWidth).toBe(METRICS.advanceWidth);
  });

  it("scales x and y by the same amount, so nothing is squashed", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <rect x="0" y="0" width="50" height="50"/>
    </svg>`;
    const back = svgToFontUnits(readSvg(svg), METRICS);
    const bounds = contoursBounds(back.contours);
    expect(bounds.xMax - bounds.xMin).toBeCloseTo(bounds.yMax - bounds.yMin, 3);
  });

  it("reads a file that gives a width and height but no viewBox", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="100px">
      <rect x="0" y="0" width="100" height="100"/>
    </svg>`;
    const back = svgToFontUnits(readSvg(svg), METRICS);
    const bounds = contoursBounds(back.contours);
    expect(bounds.yMax - bounds.yMin).toBeCloseTo(METRICS.top - METRICS.bottom, 3);
  });
});

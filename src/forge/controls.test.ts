/**
 * The controls, taken to both ends of themselves on every letter.
 *
 * This is the test the whole half of the application exists to pass. The claim
 * is that a font drawn here cannot be spoilt by turning something up: not that
 * it is unlikely to be, or that it recovers, but that the shapes are grown from
 * a skeleton and a pen under one rule -- a stroke never turns tighter than half
 * its own width -- and that a rule of that kind either holds everywhere or is
 * not a rule.
 *
 * So every control is driven to its minimum, its middle and its maximum against
 * every letter in the font, at four weights, and every outline that comes out is
 * checked for crossing itself. Nothing here looks at whether the result is
 * handsome. It looks at whether it is a letter.
 *
 * The second test is smaller and catches a different kind of mistake. A control
 * that is offered in the panel and read by nothing looks exactly like a control
 * that works, until somebody drags it. Two of them shipped that way -- the
 * shoulder's reach and the bowl's roundness were both declared, both drawn as
 * sliders, and both read by no recipe at all.
 */

import { describe, expect, it } from "vitest";

import { contoursBounds, contoursToSvgPath } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { drawLetter, letterNames } from "./build";
import { LETTERS, formsOf } from "./letters";
import { METRIC_CONTROLS, PART_SPECS, PEN_CONTROLS, type FieldControl } from "./parts";
import { BASES, SANS, type Metrics, type Parts, type Style } from "./style";

/*
 * A base is a starting point, and the panel has to be able to show one.
 *
 * A control whose range does not cover the base it opens on is a slider pinned
 * at its end showing a value it cannot express, and the first touch of it
 * changes a font nobody edited. One base was drawn outside its control this
 * way and it took a test of something else to notice.
 */
describe("the bases sit inside their own controls", () => {
  it("every base, every control", () => {
    const outside: string[] = [];
    for (const base of BASES) {
      const em = base.metrics.unitsPerEm;
      const check = (where: string, control: FieldControl, value: unknown) => {
        if (typeof value !== "number") return;
        const scale = control.emRelative ? em : 1;
        if (value < control.min * scale - 1e-9 || value > control.max * scale + 1e-9) {
          outside.push(`${base.name} ${where}.${control.key} = ${value}`);
        }
      };
      for (const control of PEN_CONTROLS) check("pen", control, (base.pen as unknown as Record<string, unknown>)[control.key]);
      for (const control of METRIC_CONTROLS) check("metrics", control, (base.metrics as unknown as Record<string, unknown>)[control.key]);
      for (const spec of PART_SPECS) {
        const values = (base.parts as unknown as Record<string, Record<string, unknown>>)[spec.name];
        for (const control of spec.controls) check(spec.name, control as FieldControl, values?.[control.key]);
      }
    }
    expect(outside).toEqual([]);
  });
});
import type { Pen } from "./types";

const NAMES = letterNames();

/** The style with one part's field set to a value. */
function withPart(style: Style, part: string, key: string, value: number | boolean | string): Style {
  const parts = { ...style.parts } as unknown as Record<string, Record<string, unknown>>;
  parts[part] = { ...parts[part], [key]: value };
  return { ...style, parts: parts as unknown as Parts };
}

/** The style with one field of the pen or the metrics set. */
function withField(style: Style, where: "pen" | "metrics", key: string, value: number): Style {
  return where === "pen"
    ? { ...style, pen: { ...style.pen, [key]: value } as Pen }
    : { ...style, metrics: { ...style.metrics, [key]: value } as Metrics };
}

/** The three interesting places on a control, plus whatever it starts at. */
function stops(min: number, max: number): number[] {
  return [min, (min + max) / 2, max];
}

describe("no control can spoil a letter", () => {
  const weights = [12, 92, 190, 260];

  for (const spec of PART_SPECS) {
    for (const control of spec.controls) {
      it(`${spec.label} / ${control.label}`, () => {
        const scale = control.emRelative ? SANS.metrics.unitsPerEm : 1;
        const values: Array<number | boolean | string> = control.options
          ? control.options.map((option) => option.value)
          : control.toggle
            ? [false, true]
            : stops(control.min * scale, control.max * scale);

        for (const value of values) {
          for (const weight of weights) {
            // Serifs on throughout, so the bar and its bracket are actually
            // being drawn while everything else is being driven about.
            const base = withPart(
              { ...SANS, pen: { ...SANS.pen, weight } },
              "slab",
              "on",
              true,
            );
            const style = withPart(base, spec.name, control.key, value);
            for (const name of NAMES) {
              const drawn = drawLetter(name, style);
              expect(drawn, `${name} would not draw`).not.toBeNull();
              for (const contour of drawn!.contours) {
                expect(
                  contoursIntersect([contour]),
                  `${name} folds at ${spec.name}.${control.key} = ${String(value)}, weight ${weight}`,
                ).toBe(false);
              }
            }
          }
        }
      });
    }
  }

  for (const [where, controls] of [
    ["pen", PEN_CONTROLS],
    ["metrics", METRIC_CONTROLS],
  ] as Array<["pen" | "metrics", FieldControl[]]>) {
    for (const control of controls) {
      it(`${where} / ${control.label}`, () => {
        const scale = control.emRelative ? SANS.metrics.unitsPerEm : 1;
        for (const value of stops(control.min * scale, control.max * scale)) {
          for (const weight of [12, 92, 190, 260]) {
            const style = withField(
              withPart({ ...SANS, pen: { ...SANS.pen, weight } }, "slab", "on", true),
              where,
              control.key,
              value,
            );
            for (const name of NAMES) {
              for (const contour of drawLetter(name, style)!.contours) {
                expect(
                  contoursIntersect([contour]),
                  `${name} folds at ${where}.${control.key} = ${value}, weight ${weight}`,
                ).toBe(false);
              }
            }
          }
        }
      });
    }
  }

  it("the pen, from hairline to the limit and back to front", () => {
    for (const weight of [8, 40, 92, 150, 210, 260]) {
      for (const contrast of [0, 0.45, 0.9]) {
        for (const angle of [-90, -30, 0, 30, 90]) {
          const style: Style = { ...SANS, pen: { weight, contrast, angle } };
          for (const name of NAMES) {
            for (const contour of drawLetter(name, style)!.contours) {
              expect(
                contoursIntersect([contour]),
                `${name} folds at weight ${weight}, contrast ${contrast}, angle ${angle}`,
              ).toBe(false);
            }
          }
        }
      }
    }
  });
});

describe("alternates", () => {
  /*
   * An alternate is a different skeleton, so it gets the same treatment as the
   * default: it has to survive the pen at every weight it might be drawn with,
   * and it has to be a different shape from the one it is offered beside. A
   * chooser whose second option draws the first letter again is worse than no
   * chooser -- it is a promise of variety that is not there.
   */
  it("never folds, at any weight", () => {
    for (const name of NAMES) {
      for (const form of formsOf(name)) {
        for (const weight of [12, 92, 190, 260]) {
          for (const squareness of [0, 1]) {
            const style = withPart(
              withPart({ ...SANS, pen: { ...SANS.pen, weight } }, "slab", "on", true),
              "bowl",
              "squareness",
              squareness,
            );
            const drawn = drawLetter(name, style, form.id);
            expect(drawn, `${name} / ${form.label} would not draw`).not.toBeNull();
            for (const contour of drawn!.contours) {
              expect(
                contoursIntersect([contour]),
                `${name} / ${form.label} folds at weight ${weight}, squareness ${squareness}`,
              ).toBe(false);
            }
          }
        }
      }
    }
  });

  it("draws something different from the letter it is offered beside", () => {
    const same: string[] = [];
    for (const name of NAMES) {
      const forms = formsOf(name);
      const drawings = forms.map((form) => contoursToSvgPath(drawLetter(name, SANS, form.id)!.contours));
      for (let index = 1; index < forms.length; index++) {
        for (let earlier = 0; earlier < index; earlier++) {
          if (drawings[index] === drawings[earlier]) {
            same.push(`${name}: ${forms[index].label} draws the same as ${forms[earlier].label}`);
          }
        }
      }
    }
    expect(same).toEqual([]);
  });

  it("still stands on the baseline and inside the line", () => {
    for (const name of NAMES) {
      for (const form of formsOf(name)) {
        const drawn = drawLetter(name, SANS, form.id)!;
        const bounds = contoursBounds(drawn.contours);
        expect(bounds.yMax, `${name} / ${form.label} rises above the ascender`).toBeLessThanOrEqual(
          SANS.metrics.ascender + SANS.metrics.overshoot + SANS.pen.weight,
        );
        expect(bounds.yMin, `${name} / ${form.label} sinks below the descender`).toBeGreaterThanOrEqual(
          SANS.metrics.descender - SANS.metrics.overshoot - SANS.pen.weight,
        );
        expect(bounds.xMin, `${name} / ${form.label} starts left of the origin`).toBeGreaterThan(-1);
        expect(
          drawn.advanceWidth,
          `${name} / ${form.label} is wider than its own advance`,
        ).toBeGreaterThanOrEqual(bounds.xMax);
      }
    }
  });
});

describe("every starting point, at every weight", () => {
  /*
   * The eight bases are eight different sets of decisions, and each of them
   * reaches corners of the drawing the others never go near: a pen held at
   * ninety degrees, corners rounded off wider than the counter, a letter leaned
   * over. Driving the controls from the plainest of them, which is what the
   * tests above do, leaves all of that unvisited.
   *
   * Run across the bases and their alternates as well, this found six letters
   * that folded and had been folding for as long as the bases had existed --
   * an M on the ribbon face at one weight, the same M's deep alternate on
   * another, a crossed W on a narrow setting.
   */
  it("never folds, on any base, in any form", () => {
    const wrong: string[] = [];
    for (const base of BASES) {
      for (const weight of [8, 40, 92, 150, 210, 260]) {
        const style: Style = { ...base, pen: { ...base.pen, weight } };
        for (const name of NAMES) {
          for (const form of formsOf(name)) {
            const drawn = drawLetter(name, style, form.id);
            expect(drawn, `${name} would not draw on ${base.name}`).not.toBeNull();
            for (const contour of drawn!.contours) {
              if (contoursIntersect([contour])) {
                wrong.push(`${name} / ${form.label} folds on ${base.name} at weight ${weight}`);
              }
            }
          }
        }
      }
    }
    expect([...new Set(wrong)].slice(0, 8)).toEqual([]);
  });
});

describe("the one rule", () => {
  /*
   * Stated directly rather than inferred from the damage.
   *
   * Everything in this half of the application rests on a stroke never turning
   * tighter than half its own width. Checking for folded outlines finds the
   * cases where that was broken, but only after the fold, and only if the fold
   * happens to be one the crossing test can see. Checking the skeletons finds
   * it at the source: a question mark at a narrow width and a heavy weight had
   * a turn of a hundred and sixteen units drawn with a pen of two hundred and
   * sixty, and it was the skeleton that was wrong, not the sweep.
   */
  it("no stroke ever turns tighter than half its own pen", () => {
    const wrong: string[] = [];
    for (const weight of [12, 92, 190, 260]) {
      for (const width of [0.6, 1, 1.5]) {
        for (const squareness of [0, 1]) {
          const style = withPart(
            withField({ ...SANS, pen: { ...SANS.pen, weight } }, "metrics", "width", width),
            "bowl",
            "squareness",
            squareness,
          );
          for (const name of NAMES) {
            for (const stroke of LETTERS[name](style).strokes) {
              const least = stroke.pen.weight / 2;
              for (const segment of stroke.spine.segments) {
                if (segment.kind !== "arc") continue;
                if (segment.radius < least * 0.999) {
                  wrong.push(
                    `${name} turns through ${segment.radius.toFixed(1)} with a pen of ` +
                      `${stroke.pen.weight.toFixed(1)} (weight ${weight}, width ${width}, squareness ${squareness})`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(wrong.slice(0, 8)).toEqual([]);
  });
});

/**
 * Every control has something to show, on every base.
 *
 * The panel reads the style straight rather than a copy with defaults filled
 * in, which is right -- a control should show what the font actually says --
 * and means an optional setting has no value on a base that never set one.
 * That is fine for a toggle, which reads absence as off. It is not fine for a
 * slider, and the first optional setting to arrive proved it: fed an undefined
 * value, the slider threw while rendering and React unmounted the whole view,
 * so drawing a font went from working to a blank screen.
 *
 * A test at the type level would not have caught it, because the panel reaches
 * the value through an index into a record and an index into a record is
 * always allowed to come back undefined.
 *
 * This is the data half of the rule: anything the panel will draw as a slider
 * has a number on every base. The other half -- that a control declared as a
 * toggle is actually drawn as one -- is a fact about the panel, so it is
 * checked in the browser suite where the panel exists.
 */
describe("every control has a value to show", () => {
  const controls: Array<[string, FieldControl[], (style: Style) => Record<string, unknown>]> = [
    ["pen", PEN_CONTROLS, (style) => style.pen as unknown as Record<string, unknown>],
    ["metrics", METRIC_CONTROLS, (style) => style.metrics as unknown as Record<string, unknown>],
  ];

  for (const [where, list, read] of controls) {
    for (const control of list) {
      it(`${where} / ${control.label}`, () => {
        for (const base of BASES) {
          const value = read(base)[control.key];
          if (control.toggle) {
            // A toggle is allowed to be missing: absent means off, and the
            // panel draws a switch rather than a slider for it.
            expect([undefined, true, false], `${base.name}`).toContain(value);
          } else {
            expect(typeof value, `${base.name} has no ${control.key}`).toBe("number");
            expect(Number.isFinite(value as number), `${base.name}`).toBe(true);
          }
        }
      });
    }
  }

});

describe("no control is decoration", () => {
  it("every control in the panel changes at least one letter", () => {
    const dead: string[] = [];
    for (const spec of PART_SPECS) {
      for (const control of spec.controls) {
        const scale = control.emRelative ? SANS.metrics.unitsPerEm : 1;
        const [low, high] = control.options
          ? [control.options[0].value, control.options[control.options.length - 1].value]
          : control.toggle
            ? [false, true]
            : [control.min * scale, control.max * scale];

        /*
         * Serifs forced on and a corner in play, so a control that only shows
         * under those conditions is not written off as doing nothing -- and
         * tried under three faces, because the conditions a control needs are
         * not all compatible with each other. A wavelength means nothing at a
         * depth of nought and a flare's hollow means nothing at no spread; a
         * serif's bracket means nothing on a face that undulates, where the
         * bar is swept along a spine rather than drawn as a shape with a
         * fillet in it.
         */
        const plain = withPart(
          withPart(SANS, "slab", "on", true),
          "terminal",
          "kind",
          "angled",
        );
        const waving = withPart(withPart(plain, "wave", "depth", 26), "wave", "along", "both");
        const flaring = withPart(plain, "flare", "spread", 0.4);
        const balled = withPart(plain, "ball", "size", 1.2);
        const changed = [plain, waving, flaring, balled].some((ready) =>
          NAMES.some((name) => {
            const before = drawLetter(name, withPart(ready, spec.name, control.key, low));
            const after = drawLetter(name, withPart(ready, spec.name, control.key, high));
            return (
              contoursToSvgPath(before!.contours) !== contoursToSvgPath(after!.contours) ||
              before!.advanceWidth !== after!.advanceWidth
            );
          }),
        );
        if (!changed) dead.push(`${spec.name}.${control.key} (${spec.label} / ${control.label})`);
      }
    }

    for (const [where, controls] of [
      ["pen", PEN_CONTROLS],
      ["metrics", METRIC_CONTROLS],
    ] as Array<["pen" | "metrics", FieldControl[]]>) {
      for (const control of controls) {
        const scale = control.emRelative ? SANS.metrics.unitsPerEm : 1;
        const changed = NAMES.some((name) => {
          const before = drawLetter(name, withField(SANS, where, control.key, control.min * scale));
          const after = drawLetter(name, withField(SANS, where, control.key, control.max * scale));
          return (
            contoursToSvgPath(before!.contours) !== contoursToSvgPath(after!.contours) ||
            before!.advanceWidth !== after!.advanceWidth
          );
        });
        if (!changed) dead.push(`${where}.${control.key} (${control.label})`);
      }
    }
    expect(dead).toEqual([]);
  });
});

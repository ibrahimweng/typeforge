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

import { contoursToSvgPath } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { drawLetter, letterNames } from "./build";
import { PART_SPECS } from "./parts";
import { SANS, type Parts, type Style } from "./style";

const NAMES = letterNames();

/** The style with one part's field set to a value. */
function withPart(style: Style, part: string, key: string, value: number | boolean | string): Style {
  const parts = { ...style.parts } as unknown as Record<string, Record<string, unknown>>;
  parts[part] = { ...parts[part], [key]: value };
  return { ...style, parts: parts as unknown as Parts };
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

        // Serifs forced on and a corner in play, so a control that only shows
        // under those conditions is not written off as doing nothing.
        const ready = withPart(
          withPart(SANS, "slab", "on", true),
          "terminal",
          "kind",
          "angled",
        );
        const changed = NAMES.some((name) => {
          const before = drawLetter(name, withPart(ready, spec.name, control.key, low));
          const after = drawLetter(name, withPart(ready, spec.name, control.key, high));
          return (
            contoursToSvgPath(before!.contours) !== contoursToSvgPath(after!.contours) ||
            before!.advanceWidth !== after!.advanceWidth
          );
        });
        if (!changed) dead.push(`${spec.name}.${control.key} (${spec.label} / ${control.label})`);
      }
    }
    expect(dead).toEqual([]);
  });
});

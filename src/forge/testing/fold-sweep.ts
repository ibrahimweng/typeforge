/**
 * The fold check `controls.test.ts` drives every control through, for a field
 * that has no control yet.
 *
 * Every letter drawn at each value asked, at weights 12, 92, 190 and 260, on
 * two faces -- the Sans with its serifs on, as the controls are driven, and
 * the Serif, in its default forms and in its own -- and every contour that
 * comes out checked for crossing itself. Handed back as a list of what
 * folded, so a test can expect it empty and read what is wrong when it is not.
 */

import { contoursIntersect } from "@/font/outline";
import { builtFrom, drawLetter, letterNames } from "../build";
import { SANS, SERIF, type Style } from "../style";

/** The weights the controls are driven at. */
export const FOLD_WEIGHTS = [12, 92, 190, 260];

/**
 * The style with one field set, named by where it lives: `slab.tip` is a
 * part's field, `metrics.dotScale` and `pen.contrast` the metrics' and the
 * pen's.
 */
export function withField(style: Style, field: string, value: number | boolean | string): Style {
  const [where, key] = field.split(".");
  if (!where || !key) throw new Error(`a field is named as part.key: ${field}`);
  if (where === "metrics") return { ...style, metrics: { ...style.metrics, [key]: value } };
  if (where === "pen") return { ...style, pen: { ...style.pen, [key]: value } };
  const parts = { ...style.parts } as unknown as Record<string, Record<string, unknown>>;
  if (!(where in parts)) throw new Error(`no part named ${where}`);
  parts[where] = { ...parts[where], [key]: value };
  return { ...style, parts: parts as unknown as Style["parts"] };
}

/** The two faces, at a weight: the Sans with serifs on, and the Serif. */
export function foldFaces(weight: number): Array<[string, Style]> {
  return [
    ["Sans with serifs", withField({ ...SANS, pen: { ...SANS.pen, weight } }, "slab.on", true)],
    ["Serif", { ...SERIF, pen: { ...SERIF.pen, weight } }],
  ];
}

/**
 * Every letter that crosses itself with `field` at each of `values`, as
 * `face letter[/form] folds at field = value, weight w`. Letters built from
 * others (an `Aacute`) are left out, as the controls test leaves them: they
 * are their pieces, moved. `letters` narrows the list.
 */
export function foldSweep(
  field: string,
  values: Array<number | boolean | string>,
  letters?: string[],
): string[] {
  const names = letters ?? letterNames().filter((name) => !builtFrom(name));
  const folds: string[] = [];
  for (const value of values) {
    for (const weight of FOLD_WEIGHTS) {
      for (const [face, base] of foldFaces(weight)) {
        const style = withField(base, field, value);
        for (const name of names) {
          const own = style.forms?.[name];
          for (const form of own ? [undefined, own] : [undefined]) {
            const label = `${face} ${name}${form ? `/${form}` : ""}`;
            const drawn = drawLetter(name, style, form);
            if (!drawn) {
              folds.push(
                `${label} would not draw at ${field} = ${String(value)}, weight ${weight}`,
              );
              continue;
            }
            if (drawn.contours.some((contour) => contoursIntersect([contour]))) {
              folds.push(`${label} folds at ${field} = ${String(value)}, weight ${weight}`);
            }
          }
        }
      }
    }
  }
  return folds;
}

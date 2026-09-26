/**
 * The Cyrillic letters that are not already drawings the font has.
 *
 * One part of the table `LETTERS` in `../letters.ts` is assembled from, moved
 * here unchanged so the recipes can be read a group at a time. Only that file
 * imports it; see it for what a recipe is and how the table is used.
 */

import type { Style } from "../style";
import {
  at,
  bendWidth,
  BUTT,
  chain,
  cyrBe,
  cyrChe,
  cyrDe,
  cyrDje,
  cyrDzhe,
  cyrE,
  cyrEl,
  cyrEm,
  cyrEn,
  cyrGe,
  cyrGheUpturn,
  cyrHard,
  cyrI,
  cyrIe,
  cyrLje,
  cyrNje,
  cyrPe,
  cyrSha,
  cyrShcha,
  cyrSoft,
  cyrTe,
  cyrTse,
  cyrTshe,
  cyrU,
  cyrVe,
  cyrYa,
  cyrYeru,
  cyrYu,
  cyrZe,
  cyrZhe,
  finish,
  frame,
  ink,
  type LetterName,
  type Recipe,
  ring,
  straight,
} from "./common";

export const CYRILLIC_RECIPES: Record<LetterName, (style: Style) => Recipe> = {
  // --- Cyrillic ----------------------------------------------------------

  /*
   * The third alphabet, and the one where the lowercase is the capitals again.
   *
   * A Cyrillic `н` is an `Н` the height of an `n`; a `т` is a `Т`; a `п`, a
   * `м`, a `ш`, a `ц`, a `ь` and a dozen more are the same letter twice at two
   * sizes. So each shape is written once against a height, up in the helpers,
   * and asked for at the cap height and at the x-height -- which is not a
   * saving, it is the alphabet: drawn separately the two cases would drift
   * apart, and in Cyrillic that is a fault a reader sees at once.
   *
   * Twenty-four characters are drawings this font already had. Eleven capitals
   * are Latin capitals, three are Greek ones, and ten lowercase are Latin
   * lowercase -- and the `к`, which is the k with no ascender that Greenlandic
   * asked for and Greek asked for again.
   */

  "\u0411": (style) => finish(frame(style), cyrBe(frame(style), frame(style).cap)),
  "\u0414": (style) => finish(frame(style), cyrDe(frame(style), frame(style).cap)),
  "\u0416": (style) => finish(frame(style), cyrZhe(frame(style), frame(style).cap)),
  "\u0417": (style) => finish(frame(style), cyrZe(frame(style), frame(style).cap), true),
  "\u0418": (style) => finish(frame(style), cyrI(frame(style), frame(style).cap)),
  "\u041b": (style) => finish(frame(style), cyrEl(frame(style), frame(style).cap)),
  "\u0423": (style) => finish(frame(style), cyrU(frame(style), frame(style).cap)),
  "\u0426": (style) => finish(frame(style), cyrTse(frame(style), frame(style).cap)),
  "\u0427": (style) => finish(frame(style), cyrChe(frame(style), frame(style).cap)),
  "\u0428": (style) => finish(frame(style), cyrSha(frame(style), frame(style).cap)),
  "\u0429": (style) => finish(frame(style), cyrShcha(frame(style), frame(style).cap)),
  "\u042a": (style) => finish(frame(style), cyrHard(frame(style), frame(style).cap), true),
  "\u042b": (style) => finish(frame(style), cyrYeru(frame(style), frame(style).cap), true),
  "\u042c": (style) => finish(frame(style), cyrSoft(frame(style), frame(style).cap), true),
  "\u042d": (style) => finish(frame(style), cyrE(frame(style), frame(style).cap), true),
  "\u042e": (style) => finish(frame(style), cyrYu(frame(style), frame(style).cap), true),
  "\u042f": (style) => finish(frame(style), cyrYa(frame(style), frame(style).cap), true),

  /** A bowl with a curl over the top of it, which is not a small hard sign. */
  "\u0431": (style) => {
    const f = frame(style);
    const radius = Math.max(f.x * 0.37, f.least);
    const wide = bendWidth(f, radius);
    const centre = at(f.edge + wide, radius);
    return finish(
      f,
      [
        ink(f, ring(f, centre, wide, radius)),
        ink(
          f,
          chain(
            straight(
              at(centre.x - wide * 0.15, f.crest(f.asc)),
              at(centre.x + wide * 0.3, f.crest(f.asc)),
            ),
            straight(
              at(centre.x + wide * 0.3, f.crest(f.asc)),
              at(centre.x - wide * 0.55, radius * 1.5),
            ),
          ),
          f.end,
          BUTT,
        ),
      ],
      true,
    );
  },

  "\u0432": (style) => finish(frame(style), cyrVe(frame(style), frame(style).x), true),
  "\u0433": (style) => finish(frame(style), cyrGe(frame(style), frame(style).x)),
  "\u0434": (style) => finish(frame(style), cyrDe(frame(style), frame(style).x)),
  "\u0436": (style) => finish(frame(style), cyrZhe(frame(style), frame(style).x)),
  "\u0437": (style) => finish(frame(style), cyrZe(frame(style), frame(style).x), true),
  "\u0438": (style) => finish(frame(style), cyrI(frame(style), frame(style).x)),
  "\u043b": (style) => finish(frame(style), cyrEl(frame(style), frame(style).x)),
  "\u043c": (style) => finish(frame(style), cyrEm(frame(style), frame(style).x)),
  "\u043d": (style) => finish(frame(style), cyrEn(frame(style), frame(style).x)),
  "\u043f": (style) => finish(frame(style), cyrPe(frame(style), frame(style).x)),
  "\u0442": (style) => finish(frame(style), cyrTe(frame(style), frame(style).x)),
  "\u0446": (style) => finish(frame(style), cyrTse(frame(style), frame(style).x)),
  "\u0447": (style) => finish(frame(style), cyrChe(frame(style), frame(style).x)),
  "\u0448": (style) => finish(frame(style), cyrSha(frame(style), frame(style).x)),
  "\u0449": (style) => finish(frame(style), cyrShcha(frame(style), frame(style).x)),
  "\u044a": (style) => finish(frame(style), cyrHard(frame(style), frame(style).x), true),
  "\u044b": (style) => finish(frame(style), cyrYeru(frame(style), frame(style).x), true),
  "\u044c": (style) => finish(frame(style), cyrSoft(frame(style), frame(style).x), true),
  "\u044d": (style) => finish(frame(style), cyrE(frame(style), frame(style).x), true),
  "\u044e": (style) => finish(frame(style), cyrYu(frame(style), frame(style).x), true),
  "\u044f": (style) => finish(frame(style), cyrYa(frame(style), frame(style).x), true),

  /*
   * And the twelve the other Cyrillic languages want.
   *
   * Serbian and Macedonian write letters Russian does not, and two of them --
   * the lje and the nje -- are a letter tied to a soft sign, which is exactly
   * how they are built here: the shapes are already written down, so the
   * letters are a bar between two of them.
   */
  "\u0402": (style) => finish(frame(style), cyrDje(frame(style), frame(style).cap), true),
  "\u0404": (style) => finish(frame(style), cyrIe(frame(style), frame(style).cap), true),
  "\u0409": (style) => finish(frame(style), cyrLje(frame(style), frame(style).cap), true),
  "\u040a": (style) => finish(frame(style), cyrNje(frame(style), frame(style).cap), true),
  "\u040b": (style) => finish(frame(style), cyrTshe(frame(style), frame(style).cap), true),
  "\u040f": (style) => finish(frame(style), cyrDzhe(frame(style), frame(style).cap)),
  "\u0452": (style) => finish(frame(style), cyrDje(frame(style), frame(style).x), true),
  "\u0454": (style) => finish(frame(style), cyrIe(frame(style), frame(style).x), true),
  "\u0459": (style) => finish(frame(style), cyrLje(frame(style), frame(style).x), true),
  "\u045a": (style) => finish(frame(style), cyrNje(frame(style), frame(style).x), true),
  "\u045b": (style) => finish(frame(style), cyrTshe(frame(style), frame(style).x), true),
  "\u045f": (style) => finish(frame(style), cyrDzhe(frame(style), frame(style).x)),

  /** Ukrainian's ghe, which Unicode keeps out on its own two blocks later. */
  "\u0490": (style) => finish(frame(style), cyrGheUpturn(frame(style), frame(style).cap)),
  "\u0491": (style) => finish(frame(style), cyrGheUpturn(frame(style), frame(style).x)),
};

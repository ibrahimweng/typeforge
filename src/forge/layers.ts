/**
 * The door to the shaping layers, which is not always open yet.
 *
 * Cutting a letter and casting a shadow on it are booleans over an outline,
 * and they are reached from `font/transform.ts` -- the synchronous path every
 * view and the store resolve an outline on. There is nowhere in that to await
 * anything, which is why the engine used to arrive with the first screen: a
 * static import from the one function that cannot wait for a download.
 *
 * It does not have to. The shaping already answers "not yet" for a living.
 * Both layers are boolean geometry, boolean geometry is `paper`, and `paper`
 * is two hundred kilobytes fetched in the background -- so `cutInk` and
 * `castInk` have always returned the ink they were handed when it has not
 * landed. A letter with slots through it is drawn without them for a moment
 * and drawn again when the library arrives.
 *
 * So this asks the same question about one more thing. The shaping is fetched
 * on the same schedule as the library it depends on, `shapedInk` says the same
 * "not yet" in the same way until both are here, and the redraw that was
 * already waiting for one now waits for both. Nothing became async that was
 * not, and nothing is drawn wrongly that was not already drawn that way for
 * the same moment.
 *
 * What it buys is sixty-nine kilobytes -- the cutting, the casting, the
 * sweeper and the spine geometry -- off the first screen of everybody, for a
 * shape most letters do not have.
 */

import type { Contour } from "@/font/types";
import { ready as readyToCut, type Roles } from "@/font/boolean";
import { anyCast, type Cast } from "@/font/cast";
import { anyCut, type Cuts } from "@/font/cuts";
import type { CutScale, Cutting } from "./cut";
import type { shaped } from "./shaping";
import type { Stroke } from "./types";

let shaping: { shaped: typeof shaped } | null = null;
let arriving: Promise<unknown> | null = null;

/*
 * Asked for once, however many letters ask.
 *
 * `shapedInk` runs during a render, forty times a second while a slider moves,
 * so the guard is not tidiness: a fresh promise per call would be a fresh
 * promise per letter per frame.
 */
function shapingSoon(): Promise<unknown> {
  arriving ??= import("./shaping").then((module) => {
    shaping = module;
    return module;
  });
  return arriving;
}

/**
 * Both the shaping and the library it cuts with, for whoever needs the real
 * outline rather than a good enough one.
 *
 * Everything that writes a font file waits here. So does the redraw that
 * follows the first screen, which is what turns the moment above back into a
 * cut letter -- and it has to be both, because either one arriving alone still
 * draws the letter plain.
 */
export async function readyToShape(): Promise<void> {
  await Promise.all([readyToCut(), shapingSoon()]);
}

/** Whether the shaping can be done right now, rather than in a moment. */
export function shapingLoaded(): boolean {
  return shaping !== null;
}

export function shapedInk(
  ink: Contour[],
  strokes: Stroke[],
  scale: CutScale,
  cuts: Cuts | undefined,
  cast: Cast | undefined,
  roles: Roles = "winding",
): Cutting {
  // Asked before anything is fetched, because most letters have neither and
  // this is the whole of the work for them.
  if (!anyShaping(cuts, cast)) return { contours: ink };
  if (!shaping) {
    void shapingSoon();
    return { contours: ink };
  }
  return shaping.shaped(ink, strokes, scale, cuts, cast, roles);
}

/** Whether either layer has anything switched on. */
export function anyShaping(cuts: Cuts | undefined, cast: Cast | undefined): boolean {
  return anyCut(cuts) || anyCast(cast);
}

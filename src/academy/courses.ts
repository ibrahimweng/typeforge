/**
 * Teaching by task, which is the one shape of teaching this tool did not have.
 *
 * There were two already and they are both good at what they do. A tip is one
 * line that appears the first time you arrive somewhere: teaching by *place*,
 * and the right answer to "what is this view for". The help drawer is prose
 * under headings you can search: teaching by *topic*, and the right answer to
 * "what does bounce do".
 *
 * Neither answers the question somebody actually arrives with, which is "I have
 * never made a typeface and I would like to make one." That wants an order --
 * this, then this -- and it wants to know whether what you did worked. A manual
 * cannot tell you that. A course can, because it can look at the font.
 *
 * Which is the whole design here. A lesson is not a paragraph with a tick box
 * you press yourself; it is a paragraph, a task, and a *question asked of the
 * real document*. `done` reads the font you are actually making. Nobody can
 * complete this course by reading it, and nothing here can claim you learned
 * something you did not do.
 */

import type { AppState } from "@/state/store";
import type { ForgeState } from "@/state/forge-store";
import { missingExtrema } from "@/font/outline";
import { BASES } from "@/forge/style";

/** Where a lesson happens, so it can put you there rather than describe it. */
export interface Where {
  /** The document kind: the editor, the parametric drawing, and so on. */
  mode?: "edit" | "forge" | "assemble" | "quill";
  /** Which view within it. */
  view?: AppState["view"];
}

/** Everything a lesson is allowed to look at when it asks whether it is done. */
export interface Progressed {
  app: AppState;
  forge: ForgeState | null;
  /** Which mode is on screen, which the app owns rather than either store. */
  mode: string;
}

export interface Lesson {
  id: string;
  title: string;
  /**
   * The teaching, in the same voice as the rest of the tool: what is true and
   * why it matters, not what to click. A lesson whose text is a list of clicks
   * teaches somebody to use this version of this program and nothing else.
   */
  teaches: string;
  /** The thing to go and do. One sentence, in the imperative. */
  task: string;
  where?: Where;
  /**
   * Whether it has been done, asked of the real document.
   *
   * Undefined for a lesson with nothing checkable -- reading a proof, looking
   * at a letter -- which is marked by hand and says so. A check that pretended
   * to verify "you looked at it" would be a tick box wearing a disguise.
   */
  done?: (at: Progressed) => boolean;
  /** What that proved, shown once it is done. */
  learned?: string;
}

export interface Course {
  id: string;
  title: string;
  /** One sentence: who this is for and what they will have at the end. */
  about: string;
  /** Roughly how long, so somebody can decide whether to start now. */
  minutes: number;
  lessons: Lesson[];
}

// --- the questions the lessons ask -----------------------------------------

const glyphOpen = (at: Progressed) => {
  const name = at.app.selectedGlyph;
  if (!name || !at.app.typeface) return null;
  const index = at.app.typeface.glyphIndex.get(name);
  return index === undefined ? null : at.app.typeface.glyphs[index];
};

/** A shape somebody drew: closed, and enough points to hold an area. */
const drewAShape = (at: Progressed): boolean => {
  const glyph = glyphOpen(at);
  return Boolean(glyph?.contours.some((one) => one.closed && one.nodes.length >= 3));
};

/** A curve rather than a polygon: at least one point carrying a handle. */
const drewACurve = (at: Progressed): boolean => {
  const glyph = glyphOpen(at);
  return Boolean(
    glyph?.contours.some(
      (one) => one.closed && one.nodes.some((node) => node.handleIn || node.handleOut),
    ),
  );
};

export const COURSES: Course[] = [
  {
    id: "first",
    title: "Your first typeface",
    about:
      "Make a whole working font in one sitting, without drawing a letter. You will have a file you can install at the end.",
    minutes: 15,
    lessons: [
      {
        id: "first.base",
        title: "Start from a family, not a blank page",
        where: { mode: "forge" },
        teaches:
          "Almost nobody draws a typeface starting from an empty canvas, and the ones who do have twenty years in hand. A face is a set of decisions that repeat: how wide the pen is, how much it thins as it turns, where a stroke ends and how it is cut off. Choose those and the letters follow.\n\nThe twenty bases here are not twenty sets of drawings. There is one set of skeletons under all of them, and each base is a different set of answers to the same questions. That is why you can pick Geometric, change your mind, and pick Didone without losing anything: nothing was drawn, so nothing is lost.",
        task: "Open Draw and pick a base that sounds like the thing you want.",
        done: (at) => at.mode === "forge",
        learned:
          "You now have a full alphabet — capitals, lowercase, figures, punctuation — drawn from one description.",
      },
      {
        id: "first.weight",
        title: "Move one control and watch every letter follow",
        where: { mode: "forge" },
        teaches:
          "Weight is the width of the pen, and it is the control that changes a face most for the least effort. Watch what happens as you move it: the letters are redrawn at the new width rather than pushed outwards, which is why the counters — the enclosed white shapes — stay the shape they were instead of silting up.\n\nThat is the difference between a typeface and a picture of one. A picture made bold by thickening its edges closes its own holes.",
        task: "Move Weight until the text looks like something you would set a paragraph in.",
        /*
         * Asked against the base this started from rather than a fixed number.
         *
         * The twenty bases do not share a resting weight -- a Didone begins
         * heavier than a Geometric -- so a lesson demanding 92 would be already
         * complete on some faces and unreachable on others. Not against
         * `settled` either, which is the last finished gesture and so differs
         * from `forge` only while a drag is actually in flight: that check
         * would go true mid-drag and false again the moment you let go.
         */
        done: (at) => {
          if (!at.forge) return false;
          const base = BASES.find((one) => one.name === at.forge!.forge.base);
          return Boolean(base && at.forge.forge.style.pen.weight !== base.pen.weight);
        },
        learned:
          "Every letter in the font moved together, and the white inside them was defended rather than eaten.",
      },
      {
        id: "first.word",
        title: "Judge it in a word, never in a letter",
        where: { mode: "forge" },
        teaches:
          "A letter drawn alone is a drawing. A letter in a word is type. The two look different because reading is a matter of rhythm — the eye is measuring the gaps as much as the strokes — and a shape that is handsome by itself can be a hole in a line.\n\nThe specimen line is there for this. Type a real word into it, not `abcdef`: `nonsense` and `handmade` say more than the alphabet does, because they repeat the shapes that carry the rhythm.",
        task: "Type a word you know well into the specimen line and look at the gaps, not the letters.",
        learned:
          "You looked at the thing that decides whether type is any good, which is the white between the black.",
      },
      {
        id: "first.name",
        title: "Give it a name and take it away",
        where: { mode: "forge" },
        teaches:
          "A font is a file with a name inside it, and the name is what an operating system shows in a menu. Export writes a real TrueType file: not a picture, not a project, a font you can install.\n\nAdd a second weight and the whole family is drawn from the one you made — the stems in proportion, the counters giving back four fifths of what the stems gain, the spacing left alone. That is a family, and you did not draw it twice.",
        task: "Open Export, give it a name, and download it.",
        learned: "You have made a typeface. It is a file, it has your name on it, and it installs.",
      },
    ],
  },

  {
    id: "pen",
    title: "Drawing a letter by hand",
    about:
      "The pen, properly: curves rather than polygons, and the four other tools that do what a pen alone cannot.",
    minutes: 20,
    lessons: [
      {
        id: "pen.pull",
        title: "A pen that is only clicked draws polygons",
        where: { mode: "edit", view: "glyph" },
        teaches:
          "This is the one gesture nobody guesses and everything depends on. Click and you place a corner. Press, hold and *pull*, and a handle comes out of the point as you drag — the outline leaves that point as a curve, bending the way you pulled.\n\nEvery drawing program has worked this way since 1988, and every person meeting a pen tool for the first time clicks, gets a polygon, and concludes the tool is broken. It is not: you have been drawing the corners and never the curves.",
        task: "Take the pen and place three points, pulling on each one.",
        done: drewACurve,
        learned: "You drew curves rather than corners, which is the whole of what a pen is for.",
      },
      {
        id: "pen.close",
        title: "An open shape has no inside",
        where: { mode: "edit", view: "glyph" },
        teaches:
          "A shape that will not fill is almost always a shape that was never closed. An outline is a boundary, and a boundary with a gap in it does not divide anything into inside and outside — so there is nothing for the rasteriser to fill.\n\nClick the first point again to close it. Press Escape to stop drawing and leave it open, which is a real thing to want: half a letter is a legitimate thing to have. Enter finishes by closing. An outline of fewer than three points is dropped, because two points closed is a line drawn twice.",
        task: "Close an outline so it fills.",
        done: drewAShape,
        learned: "You know why a shape fills, and you have two ways to stop drawing one.",
      },
      {
        id: "pen.points",
        title: "The pen is five tools",
        where: { mode: "edit", view: "glyph" },
        teaches:
          "Click the nib again and the rest appear. Add point puts a point on an existing edge and the curve either side does not move — it is split exactly, not re-guessed. Delete point takes one out and draws the curve through its neighbours again, so losing a point costs a little accuracy rather than the whole shape. Convert point switches a point between a curve and a corner. Freehand takes a drawn line instead of a series of clicks.\n\nThey are separate tools rather than modifiers because each click then means one thing. A pen whose click sometimes started an outline and sometimes edited the letter beside it is a pen you cannot trust.",
        task: "Put a point on an edge with Add point, then take it out again with Delete point.",
        learned: "You can change a drawing without redrawing it.",
      },
      {
        id: "pen.extremes",
        title: "Put a point where the curve turns",
        where: { mode: "edit", view: "glyph" },
        teaches:
          "The rule every type-design course opens with: put a point at the top, bottom, left and right of every curve — the extremes. It is not tidiness. The hinting and the rasteriser both work from those points, and a curve whose widest place has no point on it renders worse at small sizes, where all the reading happens.\n\nPress Faults and the canvas rings the ones you are missing. It speaks only about finished shapes, so a letter you are halfway through drawing is left alone.",
        task: "Turn Faults on, then use Add extremes until the rings are gone.",
        done: (at) => {
          const glyph = glyphOpen(at);
          if (!glyph || glyph.contours.length === 0) return false;
          return glyph.contours.every((one) => !one.closed || missingExtrema(one) === 0);
        },
        learned: "Your outline is drawn the way a rasteriser wants to read it.",
      },
    ],
  },

  {
    id: "space",
    title: "Spacing, and then kerning",
    about:
      "The two are not the same job and the order matters. Most bad type is badly spaced, not badly drawn.",
    minutes: 15,
    lessons: [
      {
        id: "space.first",
        title: "Spacing is every pair; kerning is the exceptions",
        where: { mode: "edit", view: "metrics" },
        teaches:
          "Spacing is the white each letter carries on its own two sides, and it applies to every pair that letter is ever in. Kerning is an adjustment to one particular pair. There are twenty-six letters and six hundred and seventy-six pairs, so spacing is the cheap fix and kerning is the expensive one.\n\nWhich is why the order is not negotiable: space first, kern last. Kerning applied to a badly spaced font is a list of exceptions to a rule that was wrong, and it grows until every pair is on it.",
        task: "Open Spacing and compare down a column — even spacing is what makes a line read evenly.",
        learned: "You know which of the two jobs to do first, and why doing them the other way never ends.",
      },
      {
        id: "space.non",
        title: "The n, the o, and the test that never changes",
        where: { mode: "edit", view: "metrics" },
        teaches:
          "A straight-sided letter and a round one need different amounts of white, because a round side already gives some away as it turns. So the standard test is `nn`, `oo`, `no` and `on`: get those four looking even and the rest of the lowercase follows, because almost every letter is a straight side, a round side, or one of each.\n\nThe editor stands your letter between two `n`s for the same reason. It is not decoration — it is the measurement.",
        task: "Set nnoonnoo in the specimen and even out the four gaps.",
        learned: "You spaced by the method a type designer would use, rather than by nudging until it looked nice.",
      },
      {
        id: "space.kern",
        title: "Click the gap, not the letter",
        where: { mode: "edit", view: "kerning" },
        teaches:
          "Kerning is a pair, so what you select is the gap. `AV` and `To` are the famous ones: two shapes whose white leans the same way, leaving a hole that the letters' own spacing cannot close, because closing it for every `A` would ruin `An`.\n\nThat is the whole test for whether something is kerning or spacing. If fixing it here would break the same letter somewhere else, it is a pair, and it belongs in kerning.",
        task: "Kern one pair that needs it.",
        done: (at) => (at.app.typeface?.kerning.length ?? 0) > 0,
        learned: "You fixed a pair without moving a letter, which is the distinction the whole feature rests on.",
      },
    ],
  },

  {
    id: "real",
    title: "Making it a real font",
    about:
      "The things that decide whether a file works on somebody else's machine, all of which are invisible on yours.",
    minutes: 10,
    lessons: [
      {
        id: "real.checks",
        title: "Most font faults are invisible on the machine that made them",
        where: { mode: "edit", view: "report" },
        teaches:
          "A font is a program, and it runs on rasterisers you have never seen. The faults that matter are the ones your own screen quietly forgives: a contour wound the wrong way that fills as a hole, an outline that overlaps itself, a curve with no point at its extreme.\n\nChecks finds them while the work is still open, and every one is clickable through to the glyph that caused it. Running this before you export is the difference between a font and a file.",
        task: "Open Checks and read what it says about your font.",
        learned: "You looked for the faults that do not show up until somebody else opens the file.",
      },
      {
        id: "real.direction",
        title: "Which way a path runs decides whether it fills",
        where: { mode: "edit", view: "glyph" },
        teaches:
          "An `o` is two contours: the outside and the counter. Whether the inner one cuts a hole or fills solid is decided by which way round it runs relative to the outer. Get it backwards and you have a black blob where the letter's eye should be — and it can look perfectly fine in one renderer and solid in another.\n\nCorrect direction sets them the way the format expects. It is one press and it is worth doing on anything you drew by hand.",
        task: "Press Correct direction on a letter you drew.",
        learned: "Your letters fill the same way everywhere, rather than the way your own machine happens to guess.",
      },
      {
        id: "real.export",
        title: "Preserve, or rebuild",
        teaches:
          "Preserve keeps everything the font you opened was carrying — its name table, its layout features, everything this editor does not model — and swaps in your outlines. Rebuild writes a clean file from what is on screen and nothing else.\n\nIf you opened somebody's font and changed some letters, preserve. If you made this yourself, rebuild. Preserve is only available for TrueType out of a TrueType source; OpenType is always a rebuild, because the curves have to be re-encoded.",
        task: "Export your font and install it.",
        learned: "You know which of the two exports you want, and why the choice exists.",
      },
    ],
  },
];

export const courseById = (id: string): Course | undefined =>
  COURSES.find((one) => one.id === id);

export const ALL_LESSONS: Lesson[] = COURSES.flatMap((one) => one.lessons);

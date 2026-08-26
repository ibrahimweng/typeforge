/**
 * What an effect is.
 *
 * The third layer, and the one that finally lets a face say which tool drew it.
 * A cut takes ink out of the finished letter and a cast puts ink on; an effect
 * says what the edge of that ink is actually like -- ragged where a felt tip
 * dragged on paper, pooled where the pen stopped and sat, broken where the
 * brush ran dry, tapered where the hand lifted.
 *
 * It exists because the pen cannot say any of that. A pen here is a weight, a
 * contrast and an angle, which is a broad-nib model: exact, non-destructive,
 * and the reason weight cannot fold a letter. It describes a nib, a chisel
 * brush and a sans honestly, and it has no word at all for a marker -- so
 * every hand face was reduced to a slanted sans with contrast on it, which is
 * what they all looked like.
 *
 * Two rules about it, and both are deliberate.
 *
 * It runs last, after the cut and the cast. A boolean over an already-ragged
 * outline multiplies its point count and can cross itself; run afterwards, the
 * roughening perturbs a clean shape and nothing downstream has to cope.
 *
 * And it is never seen on more than one letter until the font is exported.
 * Roughening is the most expensive thing this engine can do -- it touches every
 * point of every outline -- so it is shown live on the letter being worked on
 * and baked into all of them on the way out. That is the same bargain `merge`
 * and `kern` already make, for the same reason.
 *
 * Kept beside `cuts.ts` and `cast.ts` and in the same shape, so a font somebody
 * opened can be given a texture exactly as a face drawn here can.
 */

/** Which edges of the letter are roughened. */
export type RoughReach = "all" | "outside";

/** Where the ink gathers. */
export type PoolWhere = "joins" | "ends" | "both";

/** Where along a stroke the tool pressed hardest. */
export type HeaviestAt = "start" | "middle" | "end";

export interface Effects {
  /**
   * The outline pushed off its own line, in and out, as it runs.
   *
   * The single biggest thing that makes a hand face read as made by a hand. A
   * printed letter has an edge a machine cut; a drawn one has an edge that
   * followed paper, and the difference is visible long before anything else
   * about the letterform is.
   *
   * Drawn as a displacement along the outline's own normal rather than as a
   * shape added or taken away, because that is what it is: the same letter,
   * with a less certain edge. The noise is periodic around each contour and
   * seeded, so the edge closes on itself with no seam and the same settings
   * always give the same letter -- which matters more than it sounds, because
   * a letter that came out differently every time it was drawn could not be
   * exported, cached, or compared with itself.
   */
  rough: {
    on: boolean;
    /** How far the edge wanders either side of its true line, in stem widths. */
    amplitude: number;
    /** How far it travels between wanders, in stem widths. Short is gritty; long is a wobble. */
    wavelength: number;
    /** Whether the counters wander too, or only the outside of the letter. */
    reach: RoughReach;
    /** Which edge comes out of the noise. Any whole number; there is no better or worse one. */
    seed: number;
  };
  /**
   * Ink gathered where the tool stopped, turned, or met itself.
   *
   * What a wet marker and a fountain pen both do, and what the eye reads as
   * ink rather than as fill. A stroke that simply ends leaves a machined edge;
   * one that ends in a small pool of its own ink reads as having been put
   * there by a hand that lifted.
   *
   * Found from the skeleton rather than from the outline, because the question
   * is where the tool paused and only the spine knows that. So it does nothing
   * to a letter that arrived as an outline, exactly as the fillet cast does
   * not.
   */
  pool: {
    on: boolean;
    /** How wide the pool is against the stem. */
    size: number;
    /** Whether ink gathers where strokes meet, where they stop, or both. */
    where: PoolWhere;
  };
  /**
   * The stroke broken where the tool ran dry or moved too fast.
   *
   * Dry brush, a marker on its last legs, chalk on a rough board. Small
   * elongated gaps taken out of the ink and laid along the direction the
   * stroke was drawn in, so it reads as drag rather than as damage -- the same
   * gaps scattered at random read as a letter somebody has spilled something
   * on.
   */
  skip: {
    on: boolean;
    /** How much of the letter is broken, from nothing to heavily worn. */
    density: number;
    /** How long each gap runs, in stem widths. */
    length: number;
    /** How wide each gap is against the stem. */
    width: number;
    /** Which gaps come out of the noise. */
    seed: number;
  };
  /**
   * The stroke swelling and thinning along its length rather than by direction.
   *
   * The one effect that is really about the tool's behaviour rather than its
   * edge, and the difference between a brush and a slanted pen. A broad nib
   * thins where the stroke turns across it, which the pen already does; a
   * brush thins where the hand lifted, which is a fact about position along
   * the stroke and nothing the pen can express.
   *
   * Taken off the finished outline rather than swept, because sweeping a
   * varying width is exactly what would cost this engine its exactness. Where
   * the ink stops is measured with a ray rather than worked out from the pen:
   * contrast pulls the flank in on every curve and a join pushes it out, and
   * three earlier goes at this that assumed a flank half a pen-width from the
   * spine took the bowl clean off an `a`.
   *
   * It reaches only strokes that have an end. A letter drawn as one closed ring
   * -- the o, the O, the nought -- has no start for a hand to press at and none
   * for it to lift from, so it is left alone. That is honest rather than ideal:
   * a signwriter draws an o in two strokes and this engine draws it in one, and
   * until it draws two there is nothing here to taper.
   */
  press: {
    on: boolean;
    /** Where along the stroke the tool pressed hardest. */
    at: HeaviestAt;
    /** How much thinner the stroke gets where it is lightest, as a share of the stem. */
    amount: number;
  };
}

/*
 * Settled against `scripts/tools.ts` rather than chosen, and the roughening's
 * two numbers moved a long way in the process. A short wavelength gives a
 * gritty edge that costs four hundred points a letter and disappears at
 * anything under about forty points on the page; a long one gives a wander
 * that reads clearly as a hand at a quarter of the points. Cheaper and better
 * is not a trade, so the default is the long one.
 */
export const NO_EFFECTS: Effects = {
  rough: { on: false, amplitude: 0.055, wavelength: 0.9, reach: "all", seed: 1 },
  pool: { on: false, size: 0.45, where: "both" },
  skip: { on: false, density: 0.25, length: 1.2, width: 0.22, seed: 1 },
  press: { on: false, at: "middle", amount: 0.35 },
};

export function noEffects(): Effects {
  return {
    rough: { ...NO_EFFECTS.rough },
    pool: { ...NO_EFFECTS.pool },
    skip: { ...NO_EFFECTS.skip },
    press: { ...NO_EFFECTS.press },
  };
}

export type EffectName = keyof Effects;

/*
 * In the order they are run, which is the order a hand would have imposed them:
 * the stroke's body first, then the ink it left, then where it wore through,
 * and the edge last of all. The panel lists them the same way, so what somebody
 * reads down the page is what actually happens to the letter.
 */
export const EFFECT_NAMES: EffectName[] = ["press", "pool", "skip", "rough"];

/**
 * The effects that are worked out from the skeleton rather than from the ink.
 *
 * Three of the four ask where the tool went rather than what shape it left, so
 * none of them reaches a letter that arrived from somewhere else as an outline
 * -- only the roughening does, because an edge is a thing every outline has.
 * Said here rather than in the panel that mentions it, because it is a fact
 * about the operations.
 */
export const FROM_SKELETON = new Set<EffectName>(["pool", "skip", "press"]);

/** Whether two descriptions say the same thing about one effect. */
export function sameEffect(one: Effects[EffectName], other: Effects[EffectName]): boolean {
  const mine = one as Record<string, unknown>;
  const theirs = other as Record<string, unknown>;
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  return [...keys].every((key) => mine[key] === theirs[key]);
}

/** Whether anything is switched on. */
export function anyEffect(effects: Effects | undefined): boolean {
  return effects !== undefined && EFFECT_NAMES.some((name) => effects[name].on);
}

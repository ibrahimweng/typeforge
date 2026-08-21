/**
 * What a cut is.
 *
 * The description only -- a set of switched-on operations and their sizes,
 * with no geometry in it anywhere. The doing lives in `forge/cut.ts`, next to
 * the skeleton, because two of the six are made out of the skeleton rather
 * than out of the outline.
 *
 * Split out from that file when cutting stopped being something only a face
 * drawn here could have. A font somebody opened and a pile of drawings
 * somebody made elsewhere are cut by the same description, so the description
 * has to sit under all three of them rather than inside one of them.
 */

/** Which side of the letter a saw runs along. */
export type Edge = "left" | "right" | "both" | "top" | "bottom";

/** What a counter is replaced with. */
/**
 * The shapes a counter can be replaced with.
 *
 * Geometric primitives, named for what they are. That is a decision and not
 * only a convenience -- see the note on where these forms recur, in the help.
 * A lozenge, a chevron and a nested diamond are figures that turn up in
 * geometric ornament everywhere there is any, and belong exclusively to
 * nobody; the symbol sets that a face like this is often reached for alongside
 * -- Adinkra, Nsibidi, Tifinagh -- are not that. Each of those carries
 * meaning, some of them are living scripts, and one of them has a documented
 * history of being mass-produced abroad with nothing going back to the people
 * whose symbols they are. None of them is in here, and the help says why.
 */
export type MotifShape =
  | "diamond"
  | "lozenge"
  | "nested"
  | "triangle"
  | "hourglass"
  | "chevron"
  | "bars"
  | "square"
  | "slot"
  | "dot"
  | "ring";

export interface Cuts {
  /**
   * Bands cut clean across the letter.
   *
   * The single most characteristic move of the faces this was built for, and
   * the one that reads at any size. Cut at an angle they stop looking like
   * rules across a page and start looking like the letter has been sliced.
   */
  slot: {
    on: boolean;
    /** How many bands. */
    count: number;
    /** How thick each band is, in stem widths. */
    width: number;
    /** Degrees the bands lean. */
    angle: number;
    /** How much of the letter's height is left uncut at top and bottom. */
    inset: number;
  };
  /**
   * A saw run along one edge of the letter.
   *
   * Cut as a comb of notches across the whole letter rather than fitted to its
   * outline, which is what a saw does: wherever the comb meets ink it leaves
   * teeth, and where it meets nothing it does nothing.
   */
  tooth: {
    on: boolean;
    /**
     * Distance from one tooth to the next, as a share of the x-height.
     *
     * The one size here that is not in stems, and deliberately. How fine a saw
     * looks is how many teeth run down the side of a letter, and a letter is
     * the same height at every weight -- so measured in stems the same setting
     * gave a Display half as many teeth as a Sans, each twice the size, and
     * what had been a saw on one face was three wedges on the other.
     */
    pitch: number;
    /** How far each notch reaches in, in stem widths. */
    depth: number;
    edge: Edge;
  };
  /** Corners cut off square. Applied last, so it also finds the corners the other cuts made. */
  chamfer: {
    on: boolean;
    /** How far back along each edge the cut starts, in stem widths. */
    size: number;
  };
  /**
   * A gap wherever two strokes run into each other.
   *
   * Found from the skeleton rather than from the outline: a join is two spines
   * passing within a stem of each other, which is a fact about how the letter
   * was built and does not have to be recovered from the ink afterwards.
   *
   * Cut square across the shorter of the two strokes rather than as a hole at
   * the crossing. Which stroke gives way is the whole difference between a
   * letter that has been taken apart and a letter with a chip out of it: the
   * arm of an E leaves the stem, the stem carries on.
   *
   * The other one that cannot reach an imported letter: without spines there
   * is nothing to find a join in, and an outline alone does not say which of
   * the two shapes crossing at a corner was the arm.
   */
  split: {
    on: boolean;
    /** How wide the gap is, in stem widths. */
    size: number;
  };
  /**
   * A groove down the middle of every stroke.
   *
   * The same skeleton swept a second time with a much thinner pen, and taken
   * away. Which is why it follows the letter exactly and costs almost nothing
   * to work out -- the hard part, where the middle of a stroke runs, is the
   * thing this half of the application already knows.
   *
   * It is also why this is one of the two that cannot reach a letter somebody
   * drew elsewhere: an imported outline has no middle to run down. Nothing
   * happens rather than something wrong, and the panel says so.
   */
  inline: {
    on: boolean;
    /** How wide the groove is, as a share of the stem. */
    width: number;
    /** How far short of each stroke end it stops, in stem widths. Zero lets it break out. */
    inset: number;
  };
  /** The hole inside a letter, replaced by a shape. */
  motif: {
    on: boolean;
    shape: MotifShape;
    /** How large, against the hole it replaces. One fills it. */
    size: number;
  };
}

/** A font that has had nothing taken out of it. */
export const NO_CUTS: Cuts = {
  slot: { on: false, count: 2, width: 0.34, angle: 0, inset: 0.14 },
  tooth: { on: false, pitch: 0.11, depth: 0.3, edge: "left" },
  chamfer: { on: false, size: 0.5 },
  split: { on: false, size: 0.45 },
  inline: { on: false, width: 0.3, inset: 0.45 },
  motif: { on: false, shape: "diamond", size: 1 },
};

export function noCuts(): Cuts {
  return {
    slot: { ...NO_CUTS.slot },
    tooth: { ...NO_CUTS.tooth },
    chamfer: { ...NO_CUTS.chamfer },
    split: { ...NO_CUTS.split },
    inline: { ...NO_CUTS.inline },
    motif: { ...NO_CUTS.motif },
  };
}

export type CutName = keyof Cuts;

export const CUT_NAMES: CutName[] = ["slot", "tooth", "inline", "motif", "split", "chamfer"];

/**
 * The two cuts made out of the skeleton rather than out of the outline.
 *
 * A groove is the spine swept again; a break is where two spines meet. Both
 * need to know how the letter was built, so neither can reach a letter that
 * arrived as an outline from somewhere else.
 *
 * Named here rather than in the panel that mentions it, because it is a fact
 * about the operation and not about how it is described. The panel reads this.
 */
export const FROM_SKELETON = new Set<CutName>(["inline", "split"]);

/**
 * Whether two descriptions say the same thing about one operation.
 *
 * For the badge that marks an operation a letter holds its own version of.
 * Holding an exception is not the same as differing from it: a letter taken
 * out of the font's cuts starts as a copy of them, so on the moment it is
 * taken out every one of the six still agrees, and marking all six as held
 * would say the letter had been cut its own way six times over when nothing
 * had been changed at all.
 */
export function sameCut(one: Cuts[CutName], other: Cuts[CutName]): boolean {
  const mine = one as Record<string, unknown>;
  const theirs = other as Record<string, unknown>;
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
  return [...keys].every((key) => mine[key] === theirs[key]);
}

/** Whether anything is switched on. */
export function anyCut(cuts: Cuts | undefined): boolean {
  return cuts !== undefined && CUT_NAMES.some((name) => cuts[name].on);
}

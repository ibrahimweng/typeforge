/**
 * A font being assembled from drawings.
 *
 * The third thing this application does, and deliberately not a variation on
 * either of the other two. Editing reshapes a font somebody else made. Drawing
 * grows one from a description. Assembling starts from a pile of artwork that
 * was never meant to be a font at all -- lettering, a logo alphabet, a set of
 * shapes drawn in whatever tool the person drawing them prefers -- and turns
 * it into one.
 *
 * What it has to supply is everything the artwork does not have: which drawing
 * is which character, how big the letters are relative to each other, where
 * the baseline is, how much white goes either side, and which pairs need
 * pulling together. All five are worked out from the drawings and all five can
 * be overruled, because a measurement is a good first answer and never the
 * last one.
 *
 * Editing returns a new assembly rather than changing this one, so undo is a
 * matter of keeping the previous value.
 */

import { anyCut, noCuts, NO_CUTS, sameCut, type CutName, type Cuts } from "@/font/cuts";
import { contoursBounds } from "@/font/geometry";
import { measuredStem } from "@/font/stem";
import { cutInk } from "@/forge/cut";
import { readSvg, type SvgBox } from "@/font/svg";
import type { Contour, KernPair } from "@/font/types";
import { detectFit, fitted, placements, type FitMetrics, type FitMode, type Placement } from "./fit";
import {
  DEFAULT_SPACING,
  kernPairs,
  silhouetteOf,
  spaceOne,
  type Placed,
  type SpacingSettings,
  type Spaced,
} from "./spacing";

/** One drawing that came in, in the coordinates it came in with. */
export interface Piece {
  /**
   * What this drawing is, as far as the pile is concerned.
   *
   * Not the file name, and the difference is the point. A drawing chosen for a
   * particular box is that box's drawing however the file was called, and
   * choosing a second one for it replaces the first -- so its identity is the
   * slot. A drawing that arrived in a heap has no slot yet, so its identity is
   * the file it came in, which is what makes dropping a corrected export over
   * the top do what it looks like it does.
   */
  id: string;
  /** The file it arrived in, for saying where it came from. */
  file: string;
  /** Which character it fills. Empty until it is given one. */
  character: string;
  contours: Contour[];
  viewBox: SvgBox;
}

/** A hand adjustment laid over what was measured, in font units. */
export interface Tweak {
  left: number;
  right: number;
}

export interface Assembly {
  name: string;
  pieces: Piece[];
  metrics: FitMetrics;
  fit: FitMode;
  /** Set when the fit was chosen by hand rather than detected. */
  fitChosen: boolean;
  spacing: SpacingSettings;
  /** Sidebearing adjustments, by character. */
  tweaks: Record<string, Tweak>;
  /** Kerning changed by hand, by "left right", overriding what was measured. */
  kerns: Record<string, number>;
  /** How the whole pile is cut. Undefined is the same as nothing switched on. */
  cuts?: Cuts;
  /**
   * Drawings cut their own way rather than the pile's, by character.
   *
   * An exception rather than an addition: a drawing either goes along with the
   * pile or is cut its own way. Half the pile's cuts merged with half a
   * letter's own is not a description anybody wrote.
   */
  cutExceptions?: Record<string, Cuts>;
}

export const DEFAULT_METRICS: FitMetrics = {
  unitsPerEm: 1000,
  capHeight: 700,
  xHeight: 500,
  ascender: 750,
  descender: -250,
  overshoot: 10,
};

export function emptyAssembly(): Assembly {
  return {
    name: "Untitled",
    pieces: [],
    metrics: { ...DEFAULT_METRICS },
    fit: "alone",
    fitChosen: false,
    spacing: { ...DEFAULT_SPACING },
    tweaks: {},
    kerns: {},
  };
}

/** How one character is cut: its own way if it says so, the pile's otherwise. */
export function cutsFor(character: string, assembly: Assembly): Cuts | undefined {
  return assembly.cutExceptions?.[character] ?? assembly.cuts;
}

/** Whether anything anywhere in the pile is switched on. */
export function anythingCut(assembly: Assembly): boolean {
  if (anyCut(assembly.cuts)) return true;
  return Object.values(assembly.cutExceptions ?? {}).some((cuts) => anyCut(cuts));
}

export function editCuts(assembly: Assembly, cuts: Cuts | undefined): Assembly {
  return { ...assembly, cuts };
}

export function cutOneWay(assembly: Assembly, character: string, cuts: Cuts): Assembly {
  return {
    ...assembly,
    cutExceptions: { ...assembly.cutExceptions, [character]: cuts },
  };
}

export function cutLikeTheRest(assembly: Assembly, character: string): Assembly {
  if (!assembly.cutExceptions?.[character]) return assembly;
  const rest = { ...assembly.cutExceptions };
  delete rest[character];
  return { ...assembly, cutExceptions: rest };
}

export function isCutException(assembly: Assembly, character: string): boolean {
  return assembly.cutExceptions?.[character] !== undefined;
}

/** Whether this character's own cuts say something different about one operation. */
export function cutHeldBy(assembly: Assembly, character: string, name: CutName): boolean {
  const own = assembly.cutExceptions?.[character];
  if (!own) return false;
  return !sameCut(own[name], (assembly.cuts ?? NO_CUTS)[name]);
}

/** A pile with nothing taken out of it, for a panel to start from. */
export function cutsOrNone(assembly: Assembly): Cuts {
  return assembly.cuts ?? noCuts();
}

// ---------------------------------------------------------------------------
// Taking files in
// ---------------------------------------------------------------------------

/**
 * What character a file is probably for.
 *
 * Every convention anybody actually uses, tried in order of how much it says.
 * A file called `A_.svg` is following the UFO naming rule and means a capital
 * A; one called `uni0041.svg` says so in hex; one called `a.svg` means a. The
 * guess is only ever a starting point -- the panel shows what was guessed and
 * the mapping is a control, not a conclusion -- so it is better for this to
 * offer something wrong and visible than nothing at all.
 */
export function guessCharacter(file: string): string {
  const stem = file
    .replace(/\.[^.]*$/, "")
    .replace(/^.*[/\\]/, "")
    .trim();
  if (!stem) return "";

  // The UFO rule: a capital is written with an underscore after it.
  const ufo = /^([A-Za-z])_$/.exec(stem);
  if (ufo) return ufo[1].toUpperCase();

  const hex = /^(?:uni|u\+?)([0-9a-fA-F]{4,6})$/.exec(stem);
  if (hex) {
    const code = Number.parseInt(hex[1], 16);
    if (Number.isFinite(code) && code > 0) return String.fromCodePoint(code);
  }

  if (stem.length === 1) return stem;

  const named = NAMED[stem.toLowerCase()];
  if (named) return named;

  // `glyph-a`, `letter_A_`, `07 - B`: take the last thing that looks like a
  // name, since the noise is nearly always a prefix.
  const tail = stem.split(/[\s_\-.]+/).filter(Boolean).pop();
  if (tail && tail !== stem) return guessCharacter(tail);

  return "";
}

/** The names the font world already gives to the characters that are not letters. */
const NAMED: Record<string, string> = {
  space: " ",
  exclam: "!",
  quotedbl: '"',
  quotesingle: "'",
  parenleft: "(",
  parenright: ")",
  comma: ",",
  hyphen: "-",
  period: ".",
  slash: "/",
  colon: ":",
  semicolon: ";",
  question: "?",
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

/**
 * Read one file into a piece.
 *
 * Returns null for a file with nothing drawable in it rather than adding an
 * empty slot: a stray file dragged in with the rest should be ignored, not
 * turned into a blank letter that quietly exports.
 */
export function pieceFrom(file: string, text: string): Piece | null {
  const drawing = readSvg(text);
  if (drawing.contours.length === 0) return null;
  return {
    id: file,
    file,
    character: drawing.note?.name?.length === 1 ? drawing.note.name : guessCharacter(file),
    contours: drawing.contours,
    viewBox: drawing.viewBox,
  };
}

/**
 * Read a file for a box that was chosen first.
 *
 * Nothing is guessed. The character is not read off the file name, or off
 * whatever the file says about itself, because you already said which box this
 * is for by clicking it -- and a guess that disagrees with what somebody just
 * pointed at is a guess that has no business winning.
 */
export function pieceInto(character: string, file: string, text: string): Piece | null {
  const drawing = readSvg(text);
  if (drawing.contours.length === 0) return null;
  return {
    id: `slot:${character}`,
    file,
    character,
    contours: drawing.contours,
    viewBox: drawing.viewBox,
  };
}

/**
 * Put a drawing in a box, replacing whatever was there.
 *
 * By the box rather than by the file, so choosing a second drawing for the
 * same letter swaps it out -- which is what filling a box twice looks like it
 * should do, and what dropping two differently named files on it would
 * otherwise fail to do.
 */
export function putInSlot(assembly: Assembly, piece: Piece): Assembly {
  const pieces = assembly.pieces.filter(
    (existing) => existing.id !== piece.id && existing.character !== piece.character,
  );
  pieces.push(piece);
  return {
    ...assembly,
    pieces,
    fit: assembly.fitChosen ? assembly.fit : detectFit(pieces.map((each) => each.viewBox)),
  };
}

/** Empty one box, leaving the rest of the pile alone. */
export function clearSlot(assembly: Assembly, character: string): Assembly {
  return {
    ...assembly,
    pieces: assembly.pieces.filter((piece) => piece.character !== character),
  };
}

/**
 * Add files to an assembly.
 *
 * A file replaces one of the same name rather than joining it, so dropping a
 * corrected export over the top does what it looks like it does.
 */
export function addPieces(assembly: Assembly, incoming: Piece[]): Assembly {
  if (incoming.length === 0) return assembly;
  const byId = new Map(assembly.pieces.map((piece) => [piece.id, piece]));
  for (const piece of incoming) byId.set(piece.id, piece);
  const pieces = [...byId.values()];
  return {
    ...assembly,
    pieces,
    // The detection is about the shape of the pile, so it is re-asked whenever
    // the pile changes -- unless somebody has already answered it themselves.
    fit: assembly.fitChosen ? assembly.fit : detectFit(pieces.map((piece) => piece.viewBox)),
  };
}

export function removePiece(assembly: Assembly, id: string): Assembly {
  return { ...assembly, pieces: assembly.pieces.filter((piece) => piece.id !== id) };
}

/** Say which character a drawing is for. */
export function mapPiece(assembly: Assembly, id: string, character: string): Assembly {
  return {
    ...assembly,
    pieces: assembly.pieces.map((piece) => (piece.id === id ? { ...piece, character } : piece)),
  };
}

export function chooseFit(assembly: Assembly, fit: FitMode): Assembly {
  return { ...assembly, fit, fitChosen: true };
}

export function editMetrics(assembly: Assembly, patch: Partial<FitMetrics>): Assembly {
  return { ...assembly, metrics: { ...assembly.metrics, ...patch } };
}

export function editSpacing(assembly: Assembly, patch: Partial<SpacingSettings>): Assembly {
  return { ...assembly, spacing: { ...assembly.spacing, ...patch } };
}

/** Nudge one letter's white, on top of what was measured. */
export function tweak(assembly: Assembly, character: string, patch: Partial<Tweak>): Assembly {
  const existing = assembly.tweaks[character] ?? { left: 0, right: 0 };
  return {
    ...assembly,
    tweaks: { ...assembly.tweaks, [character]: { ...existing, ...patch } },
  };
}

export function kernKey(left: string, right: string): string {
  return `${left} ${right}`;
}

/** Set one pair by hand, or put it back to what was measured. */
export function setKern(
  assembly: Assembly,
  left: string,
  right: string,
  value: number | null,
): Assembly {
  const kerns = { ...assembly.kerns };
  if (value === null) delete kerns[kernKey(left, right)];
  else kerns[kernKey(left, right)] = value;
  return { ...assembly, kerns };
}

// ---------------------------------------------------------------------------
// Working it out
// ---------------------------------------------------------------------------

/** One character, fitted, spaced, and ready to look at or write out. */
export interface Assembled {
  character: string;
  /** The pile's name for the drawing, for removing or replacing it. */
  id: string;
  file: string;
  contours: Contour[];
  advanceWidth: number;
  /** White either side, after any hand adjustment. */
  bearings: Spaced;
  placement: Placement;
  /** True when the letter settled its own placement rather than inheriting it. */
  measured: boolean;
}

export interface Built {
  letters: Assembled[];
  kerning: KernPair[];
  /** Drawings that have arrived without a box to go in. */
  unplaced: Piece[];
  /** Characters more than one file claims. */
  clashes: string[];
}

/**
 * Turn the pile into a font's worth of letters.
 *
 * Held against the assembly it was built from, because every view wants this
 * and a change to one slider would otherwise re-measure fifty silhouettes
 * three times over for one movement.
 */
const built = new WeakMap<Assembly, Built>();

export function build(assembly: Assembly): Built {
  const kept = built.get(assembly);
  if (kept) return kept;

  const mapped = assembly.pieces.filter((piece) => piece.character !== "");
  const unplaced = assembly.pieces.filter((piece) => piece.character === "");

  // First file wins a contested character, and the rest are named rather than
  // dropped silently: two files both called "a" is a mistake somebody wants
  // to know about.
  const taken = new Set<string>();
  const clashes: string[] = [];
  const chosen: Piece[] = [];
  for (const piece of mapped) {
    if (taken.has(piece.character)) {
      if (!clashes.includes(piece.character)) clashes.push(piece.character);
      continue;
    }
    taken.add(piece.character);
    chosen.push(piece);
  }

  const where = placements(chosen, assembly.metrics, assembly.fit);
  const placed: Placed[] = [];
  const letters: Assembled[] = [];

  /*
   * Fitted first, all of them, before anything is cut.
   *
   * A cut is described in stem widths, and the stem has to be measured off the
   * drawings -- nothing here was drawn with a pen that could be asked. But a
   * pile of SVGs arrives at whatever size the program that made them used, and
   * one drawing in the pile can be ten times another. Only after the fit are
   * they all in the same units, so only after the fit is there a stem to
   * measure.
   */
  const shapes = new Map<string, Contour[]>();
  for (const piece of chosen) {
    const placement = where.get(piece.character) ?? { scale: 1, shift: 0, measured: false };
    shapes.set(piece.character, fitted(piece.contours, placement));
  }
  const cutting = anythingCut(assembly);
  const scale = cutting
    ? {
        stem: measuredStem(
          [...shapes].map(([character, contours]) => ({ name: character, contours })),
          assembly.metrics,
        ),
        ascender: assembly.metrics.ascender,
        descender: assembly.metrics.descender,
        xHeight: assembly.metrics.xHeight,
      }
    : null;

  for (const piece of chosen) {
    const placement = where.get(piece.character) ?? { scale: 1, shift: 0, measured: false };
    const contours = shapes.get(piece.character) ?? fitted(piece.contours, placement);
    /*
     * Spacing is measured on the letter before it is cut, and that is the
     * whole point of doing it in this order.
     *
     * A slot through a letter takes ink out of its silhouette, and a narrower
     * silhouette asks for less space either side. Measured after the cut,
     * switching the slots on would respace the entire font -- every word would
     * reflow because of a decision about how the letters look. So the letter
     * is spaced as the solid shape it was drawn as, and the cuts are taken out
     * of what gets handed on. It is the same rule the drawn side follows.
     */
    const silhouette = silhouetteOf(contours, assembly.metrics);
    const measuredSpace = spaceOne(silhouette, assembly.spacing, assembly.metrics);

    const nudge = assembly.tweaks[piece.character];
    const bearings: Spaced = nudge
      ? {
          left: measuredSpace.left + nudge.left,
          right: measuredSpace.right + nudge.right,
          advanceWidth: measuredSpace.advanceWidth + nudge.left + nudge.right,
        }
      : measuredSpace;

    placed.push({ character: piece.character, silhouette, spaced: bearings });
    letters.push({
      character: piece.character,
      id: piece.id,
      file: piece.file,
      // Shifted so the letter's own ink starts at its left sidebearing, which
      // is what an advance is measured from. Until this point a drawing has
      // been wherever its file put it.
      //
      // Nesting rather than winding: these outlines came out of somebody
      // else's program and nothing has promised which way a counter is wound.
      contours: shifted(
        scale
          ? cutInk(contours, [], scale, cutsFor(piece.character, assembly) ?? noCuts(), "nesting")
              .contours
          : contours,
        bearings.left,
      ),
      advanceWidth: bearings.advanceWidth,
      bearings,
      placement,
      measured: placement.measured,
    });
  }

  const measuredKerns = kernPairs(placed, assembly.spacing, assembly.metrics);
  const kerning = withHandKerns(measuredKerns, assembly.kerns);

  const result: Built = { letters, kerning, unplaced, clashes };
  built.set(assembly, result);
  return result;
}

/** Hand values win, and a hand value on a pair nothing measured is still a pair. */
function withHandKerns(measured: KernPair[], hand: Record<string, number>): KernPair[] {
  if (Object.keys(hand).length === 0) return measured;
  const out = measured.map((pair) => {
    const own = hand[kernKey(pair.left, pair.right)];
    return own === undefined ? pair : { ...pair, value: own };
  });
  const seen = new Set(out.map((pair) => kernKey(pair.left, pair.right)));
  for (const [key, value] of Object.entries(hand)) {
    if (seen.has(key)) continue;
    const [left, right] = key.split(" ");
    if (left && right) out.push({ left, right, value });
  }
  return out;
}

function shifted(contours: Contour[], to: number): Contour[] {
  const inkLeft = contoursBounds(contours).xMin;
  const by = Number.isFinite(inkLeft) ? to - inkLeft : 0;
  if (Math.abs(by) < 1e-9) return contours;
  const move = (point: { x: number; y: number }) => ({ x: point.x + by, y: point.y });
  return contours.map((contour) => ({
    closed: contour.closed,
    nodes: contour.nodes.map((node) => ({
      point: move(node.point),
      handleIn: node.handleIn ? move(node.handleIn) : null,
      handleOut: node.handleOut ? move(node.handleOut) : null,
      type: node.type,
    })),
  }));
}

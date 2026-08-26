/**
 * A font being forged.
 *
 * One style, which every letter reads, and a short list of letters that have
 * been told to differ. That is the whole document: there are no per-letter
 * drawings to keep in step, because there are no per-letter drawings.
 *
 * The behaviour this exists for is the one that is easy to state and easy to
 * get wrong. Change the serif while looking at a p, and the p is not what
 * changed -- the serif is. Every letter that wears one wears the new one, and
 * nothing has to be copied anywhere for that to happen. A letter that should
 * keep the old serif says so explicitly, and then it is the only one that does.
 *
 * Editing returns a new document rather than changing this one, which is what
 * makes undo a matter of keeping the previous value rather than of working out
 * how to reverse an edit.
 */

import { decidedBy, drawLetter, letterNames, type Drawn } from "./build";
import { anyCast, CAST_NAMES, noCast, sameCast, type Cast, type CastName } from "./cast";
import { anyCut, CUT_NAMES, noCuts, scaleOf, type CutName, type Cuts } from "./cut";
import { anyEffect, effectInk, noEffects, type EffectName, type Effects } from "./effects";
import { anyShaping, shapedInk } from "./layers";
import {
  emptyKit,
  hasTiles,
  seedTiles,
  type Cell,
  type Fill,
  type Grid,
  type Kit,
  type Port,
  type Tiles,
} from "./kit";
import { recipeOf } from "./letters";
import type { Imported } from "./exchange";
import { weightClassOf, weightedStyle, type Family } from "./family";
import { partsUsedBy, type PartName } from "./parts";
import { BASES, type Parts, type Style } from "./style";

/** A letter that has been told to differ, and in what. */
export type Overrides = Partial<{ [K in keyof Parts]: Partial<Parts[K]> }>;

/** The same, for the cuts: a letter that is cut differently from the rest. */
export type CutOverrides = Partial<{ [K in keyof Cuts]: Partial<Cuts[K]> }>;

/** The same for the cast, minus the order, which is never a letter's own. */
export type CastOverrides = Partial<{ [K in CastName]: Partial<Cast[K]> }>;

export interface Forge {
  /** Which base this started from, for saying so and for starting again. */
  base: string;
  /** What every letter reads unless it has been told otherwise. */
  style: Style;
  /** Letters that have been told otherwise, and only those. */
  exceptions: Record<string, Overrides>;
  /**
   * Letters drawn from a different skeleton, and only those.
   *
   * Kept apart from the exceptions because it is a different kind of decision.
   * An exception says this letter keeps its own version of a part the rest of
   * the font shares. An alternate says this letter is a different shape --
   * which every part still reaches, exactly as it reaches the default.
   */
  alternates: Record<string, string>;
  /**
   * Letters that are no longer drawn at all.
   *
   * The third kind of decision, and the only one that leaves the parametric
   * system rather than moving within it. An exception and an alternate are
   * both still descriptions -- turn a slider and they answer. An imported
   * letter is an outline somebody drew, and there is nothing left to turn: the
   * weight control cannot reach it, because there is no pen.
   *
   * That is a real cost and it is why this is kept separate and said out loud
   * in the panel rather than folded in quietly. Putting a letter back under
   * the family's control is one call, and then it is drawn again from the
   * description it never stopped having.
   */
  imported: Record<string, Imported>;
  /**
   * What is taken out of every letter after it has been drawn.
   *
   * Kept here rather than on the style because it is not a decision about the
   * pen. Everything in the style describes how a stroke is made; a cut is what
   * happens to the letter afterwards, and the two stay separable -- which is
   * why turning the weight up on a face full of slots redraws the letters
   * heavier and cuts the same slots through them.
   *
   * Optional because documents saved before there were cuts do not have it.
   */
  cuts?: Cuts;
  /**
   * What is put on every letter.
   *
   * Beside the cuts and on the same terms: a description re-read every time a
   * letter is drawn, so a heavier face throws the same shadow off its heavier
   * letters. Optional for the same reason -- documents saved before there was
   * a cast do not have one.
   */
  cast?: Cast;
  /**
   * Letters cut differently from the rest, and only those.
   *
   * The same kind of decision as an exception to a part, and kept the same
   * way: this letter keeps its own version of one cut, and every other letter
   * and every other cut carry on reading the font's.
   */
  cutExceptions?: Record<string, CutOverrides>;
  /** Letters cast differently from the rest, on the same terms. */
  castExceptions?: Record<string, CastOverrides>;
  /**
   * Letters built on a grid out of a small set of parts, rather than drawn.
   *
   * The third way to make a letter here, and the only one that is a different
   * construction rather than a different setting -- so it is kept whole and
   * apart, and switched on and off in one place. A letter the kit has no cells
   * for is still drawn from its recipe, which is what lets a kit cover the
   * capitals and leave the rest of the font alone.
   *
   * Optional because documents saved before there was a kit do not have one.
   */
  kit?: Kit;
  /**
   * The weights this typeface has, and which of them is the one on screen.
   *
   * The style above describes one weight. Everything else in the family is
   * worked out from it, so there is nothing here to keep in step: this says
   * only which weights exist, and `family.ts` says what each of them is.
   *
   * Optional because documents saved before there were families do not have
   * it. `whole` below fills it in, so nothing downstream has to ask twice.
   */
  family?: Family;
  /**
   * What the tool that drew the letters was like.
   *
   * The third layer, beside the cuts and the cast and on the same terms: a
   * description re-read every time a letter is drawn, so a heavier face is
   * roughened at its own weight rather than at the weight it was set up at.
   *
   * Kept on the document rather than on the style because it is a decision
   * about the tool, not about the pen -- the same distinction that keeps the
   * cuts out of the style. And unlike either of them it is not applied to the
   * font while it is being worked on: see `proof`, and the note in
   * `@/font/effects` on why a live view of it is one letter and not four
   * hundred and fifty-two.
   *
   * Optional because documents saved before there were effects do not have it.
   */
  effects?: Effects;
}

const ALONE: Family = { drawn: 400, also: [] };

/**
 * A document with everything a current one has.
 *
 * Somewhere to put the filling-in that a format gains over time, so that the
 * rest of the application can read a field without wondering whether the file
 * it came out of predates it. One place to look, rather than a `??` at every
 * use.
 */
export function whole(forge: Forge): Forge {
  if (forge.family && forge.cuts && forge.kit && forge.cast) return forge;
  return {
    ...forge,
    family: forge.family ?? { ...ALONE },
    cuts: forge.cuts ?? noCuts(),
    cast: forge.cast ?? noCast(),
    cutExceptions: forge.cutExceptions ?? {},
    kit: forge.kit ?? emptyKit(),
  };
}

/** The weights of this document, which is at least the one being drawn. */
export function familyOf(forge: Forge): Family {
  return forge.family ?? ALONE;
}

/**
 * The same document at another weight.
 *
 * The letters told to differ come along, because an exception says this letter
 * keeps its own version of a part -- and a part is a shape, not a weight. A p
 * with its own serif reach has that reach in the Bold too, which is what
 * somebody who set it meant.
 */
export function weighted(forge: Forge, wanted: number): Forge {
  const family = familyOf(forge);
  if (wanted === family.drawn) return forge;
  return { ...forge, style: weightedStyle(forge.style, family.drawn, wanted) };
}

export function startFrom(base: Style): Forge {
  return {
    base: base.name,
    style: clone(base),
    exceptions: {},
    alternates: { ...base.forms },
    imported: {},
    cuts: noCuts(),
    cast: noCast(),
    // A face that says what drew it starts with it switched on, or its name is
    // a promise nobody kept: see `Style.effects`.
    effects: base.effects ? { ...noEffects(), ...base.effects } : noEffects(),
    cutExceptions: {},
    kit: emptyKit(),
    // Asked rather than assumed. A face is whatever weight its own stem says
    // it is, and half the bases here are not a Regular.
    family: { drawn: weightClassOf(base), also: [] },
  };
}

/** Say which weights the typeface has. The one being drawn is always one. */
export function setFamily(forge: Forge, family: Family): Forge {
  return { ...forge, family: { drawn: family.drawn, also: [...new Set(family.also)].sort((a, b) => a - b) } };
}

/**
 * Put a letter somebody else drew into a slot.
 *
 * The advance comes in with it rather than being worked out from the outline,
 * because the letter has to keep its place in the rhythm of the font. A drawn
 * shape that is a little narrower than what it replaces should still sit in
 * the same width, or the spacing table gains a hole nobody asked for.
 */
export function importLetter(forge: Forge, letter: string, outline: Imported): Forge {
  return { ...forge, imported: { ...forge.imported, [letter]: outline } };
}

/** Put a letter back under the family's control, to be drawn again. */
export function relinkLetter(forge: Forge, letter: string): Forge {
  if (!(letter in forge.imported)) return forge;
  const imported = { ...forge.imported };
  delete imported[letter];
  return { ...forge, imported };
}

/** Whether this letter is an outline rather than a description. */
export function isImported(forge: Forge, letter: string): boolean {
  return letter in forge.imported;
}

/** Draw this letter from a different skeleton, or put it back to the default. */
export function chooseForm(forge: Forge, letter: string, form: string): Forge {
  const alternates = { ...forge.alternates };
  // Asked of an accented letter or of a symbol built out of one, the choice
  // lands on the letter underneath.
  const owner = decidedBy(letter);
  if (form) alternates[owner] = form;
  else delete alternates[owner];
  return { ...forge, alternates };
}

/**
 * Which form a letter is drawn in.
 *
 * An accented letter reads its base's answer rather than keeping one of its
 * own, and so does a symbol built out of a letter. Choosing a single-storey a
 * is a decision about the a, and an `á` or an `ª` that carried on with the
 * other one would be the same letter twice in one font.
 */
export function formOf(forge: Forge, letter: string): string {
  return forge.alternates[decidedBy(letter)] ?? "";
}

export function baseNamed(name: string): Style | undefined {
  return BASES.find((style) => style.name === name);
}

/** What is taken out of every letter, unless a letter says otherwise. */
export function cutsOf(forge: Forge): Cuts {
  return forge.cuts ?? noCuts();
}

/**
 * What is taken out of one letter.
 *
 * The font's, unless this letter is an exception, in which case the font's
 * with that letter's differences laid over it. The same shape `styleFor` has,
 * and for the same reason: a letter says how it differs, not what it is.
 */
export function cutsFor(letter: string, forge: Forge): Cuts {
  const exception = forge.cutExceptions?.[letter];
  const cuts = cutsOf(forge);
  if (!exception) return cuts;

  const merged: Record<string, unknown> = { ...cuts };
  for (const [name, patch] of Object.entries(exception)) {
    merged[name] = { ...(merged[name] as object), ...patch };
  }
  return merged as unknown as Cuts;
}

export function castOf(forge: Forge): Cast {
  return forge.cast ?? noCast();
}

/** What is put on one letter: the font's, with that letter's differences over it. */
export function castFor(letter: string, forge: Forge): Cast {
  const exception = forge.castExceptions?.[letter];
  const cast = castOf(forge);
  if (!exception) return cast;

  const merged: Record<string, unknown> = { ...cast };
  for (const [name, patch] of Object.entries(exception)) {
    merged[name] = typeof patch === "object" ? { ...(merged[name] as object), ...patch } : patch;
  }
  return merged as unknown as Cast;
}

/** Change something in the cast, for the font or for one letter. */
export function editCast(
  forge: Forge,
  name: CastName,
  patch: Partial<Cast[CastName]>,
  letter?: string,
): Forge {
  if (letter === undefined) {
    return { ...forge, cast: { ...castOf(forge), [name]: { ...castOf(forge)[name], ...patch } } };
  }
  const existing = forge.castExceptions?.[letter] ?? {};
  return {
    ...forge,
    castExceptions: {
      ...forge.castExceptions,
      [letter]: { ...existing, [name]: { ...(existing[name] ?? {}), ...patch } },
    },
  };
}

/** Which way round the two layers go. A decision about the font, never a letter. */
export function setCastOrder(forge: Forge, order: Cast["order"]): Forge {
  return { ...forge, cast: { ...castOf(forge), order } };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export function effectsOf(forge: Forge): Effects {
  return forge.effects ?? noEffects();
}

/**
 * Change something about the tool.
 *
 * A decision about the font and never about one letter, which is the one place
 * this parts company with the cut and the cast. Those two describe things done
 * to a letter, and a letter can reasonably be done to differently. This
 * describes what drew the font, and a font drawn with two different markers is
 * not a font.
 */
export function editEffect(
  forge: Forge,
  name: EffectName,
  patch: Partial<Effects[EffectName]>,
): Forge {
  const effects = effectsOf(forge);
  return { ...forge, effects: { ...effects, [name]: { ...effects[name], ...patch } } };
}

/**
 * One letter as the tool actually left it.
 *
 * The only way to see the effects while the font is being worked on, and it
 * reaches exactly one letter on purpose. Roughening is the most expensive thing
 * here -- it touches every point of every outline and then resolves the result
 * with a boolean -- and the whole reason the draw page keeps up is that no
 * expensive layer is ever run over the alphabet between two frames.
 *
 * So this is what the proofing panel calls, for the letter under the hand, and
 * the exporter is the only other caller. Everything else on the page goes on
 * asking `draw` and getting the letter without them.
 *
 * Remembered against the document like every other drawing, and in a book of
 * its own, so a letter drawn both ways is kept both ways rather than one
 * evicting the other.
 */
export function proof(letter: string, forge: Forge): Drawn | null {
  const effects = effectsOf(forge);
  if (!anyEffect(effects)) return draw(letter, forge);
  return remembered(proofs, forge, letter, () => {
    if (forge.imported[letter]) {
      // Nothing here has a skeleton, so only the roughening reaches it -- and
      // it reaches it through the same call, which is what keeps an imported
      // letter looking like it belongs to the font it has joined.
      const drawn = draw(letter, forge);
      if (!drawn) return null;
      return {
        ...drawn,
        contours: effectInk(drawn.contours, [], scaleOf(forge.style), effects),
      };
    }
    return drawLetter(
      letter,
      styleFor(letter, forge),
      formOf(forge, letter),
      cutsFor(letter, forge),
      forge.kit,
      castFor(letter, forge),
      effects,
    );
  });
}

/** The operations this letter holds its own version of. */
export function castHeldBy(forge: Forge, letter: string): CastName[] {
  const own = forge.castExceptions?.[letter];
  if (!own) return [];
  const mine = castFor(letter, forge);
  const font = castOf(forge);
  return CAST_NAMES.filter((name) => name in own && !sameCast(mine[name], font[name]));
}

/** Give a letter back to the font's cast. */
export function releaseCast(forge: Forge, letter: string, name: CastName): Forge {
  const own = forge.castExceptions?.[letter];
  if (!own || !(name in own)) return forge;
  const rest = { ...own };
  delete rest[name];
  const exceptions = { ...forge.castExceptions };
  if (Object.keys(rest).length === 0) delete exceptions[letter];
  else exceptions[letter] = rest;
  return { ...forge, castExceptions: exceptions };
}

/**
 * Change a cut.
 *
 * With no letter named the change is to the whole font, which is the ordinary
 * case: a face is cut one way. Naming a letter makes that letter an exception,
 * for the letter that needs one slot fewer because it has nowhere to put it.
 */
export function editCut(
  forge: Forge,
  name: CutName,
  patch: Partial<Cuts[CutName]>,
  letter?: string,
): Forge {
  if (letter === undefined) {
    return { ...forge, cuts: { ...cutsOf(forge), [name]: { ...cutsOf(forge)[name], ...patch } } };
  }
  const existing = forge.cutExceptions?.[letter] ?? {};
  return {
    ...forge,
    cutExceptions: {
      ...forge.cutExceptions,
      [letter]: { ...existing, [name]: { ...(existing[name] ?? {}), ...patch } },
    },
  };
}

/** Cut this letter the way the rest of the font is cut. */
export function clearCutException(forge: Forge, letter: string, name?: CutName): Forge {
  const existing = forge.cutExceptions?.[letter];
  if (!existing) return forge;

  const cutExceptions = { ...forge.cutExceptions };
  if (name === undefined) {
    delete cutExceptions[letter];
  } else {
    const remaining = { ...existing };
    delete remaining[name];
    if (Object.keys(remaining).length === 0) delete cutExceptions[letter];
    else cutExceptions[letter] = remaining;
  }
  return { ...forge, cutExceptions };
}

export function isCutException(forge: Forge, letter: string, name?: CutName): boolean {
  const exception = forge.cutExceptions?.[letter];
  if (!exception) return false;
  return name === undefined ? true : exception[name] !== undefined;
}

/**
 * What a change to this cut is about to reach, in letters.
 *
 * Said before the edit, as it is for the parts. A cut lands on every letter in
 * the font rather than on the ones that happen to have a part, so what this
 * mostly reports is how many letters are holding their own version.
 */
export function cutReach(forge: Forge, name: CutName): { letters: string[]; held: string[] } {
  const letters: string[] = [];
  const held: string[] = [];
  for (const letter of letterNames()) {
    if (isCutException(forge, letter, name)) held.push(letter);
    else letters.push(letter);
  }
  return { letters, held };
}

/**
 * Whether this document takes anything out of anything.
 *
 * The font's own cuts, and the letters that hold their own. Asked in one place
 * because the two callers would otherwise carry half the rule each, and the
 * half that gets left out is the exceptions: a font with nothing cut font-wide
 * and one letter slotted on its own is still a font with a cut in it, and it
 * is exactly the case a check on the font's own settings sails past.
 */
export function anythingCut(forge: Forge): boolean {
  if (anyCut(cutsOf(forge)) || anyCast(castOf(forge))) return true;
  return Object.values(forge.cutExceptions ?? {}).some((held) =>
    Object.values(held).some((patch) => patch?.on),
  );
}

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

export function kitOf(forge: Forge): Kit {
  return forge.kit ?? emptyKit();
}

/** Whether this letter is built from cells rather than drawn from a skeleton. */
export function isLaidOut(forge: Forge, letter: string): boolean {
  const kit = kitOf(forge);
  return kit.on && hasTiles(kit, letter);
}

/** The cells one letter is built from, or nothing if it has not been laid out. */
export function tilesFor(forge: Forge, letter: string): Tiles | undefined {
  return kitOf(forge).glyphs[letter];
}

function withKit(forge: Forge, patch: Partial<Kit>): Forge {
  return { ...forge, kit: { ...kitOf(forge), ...patch } };
}

/** Build the letters from cells, or go back to drawing them. */
export function useKit(forge: Forge, on: boolean): Forge {
  return withKit(forge, { on });
}

export function editGrid(forge: Forge, patch: Partial<Grid>): Forge {
  return withKit(forge, { grid: { ...kitOf(forge).grid, ...patch } });
}

export function editRoundness(forge: Forge, roundness: number): Forge {
  return withKit(forge, { roundness });
}

/**
 * Turn one place on one cell's boundary on or off.
 *
 * The whole of the editing, and deliberately: a cell is a set of places ink
 * runs to, so there is one thing to change and every letterform on the grid is
 * some arrangement of having changed it. No tile menu to learn, no shape to
 * pick from a row of nine -- press the spot where you want the stroke to leave.
 */
export function togglePort(forge: Forge, letter: string, key: string, port: Port): Forge {
  const kit = kitOf(forge);
  const tiles = kit.glyphs[letter] ?? { columns: 1, cells: {} };
  const cell: Cell = tiles.cells[key] ?? { ports: [] };
  const ports = cell.ports.includes(port)
    ? cell.ports.filter((one) => one !== port)
    : [...cell.ports, port];

  const cells = { ...tiles.cells };
  if (ports.length === 0 && !cell.fill) delete cells[key];
  else cells[key] = { ...cell, ports };

  return withKit(forge, {
    glyphs: { ...kit.glyphs, [letter]: { ...tiles, columns: widthFor(tiles, cells), cells } },
  });
}

/**
 * Put a filled shape in a cell, or take it out again.
 *
 * Stamping the same shape onto a cell that already has it clears it, so one
 * gesture both places and removes and there is no eraser to find. Passing
 * nothing clears whatever is there.
 */
export function stampFill(forge: Forge, letter: string, key: string, fill?: Fill): Forge {
  const kit = kitOf(forge);
  const tiles = kit.glyphs[letter] ?? { columns: 1, cells: {} };
  const cell: Cell = tiles.cells[key] ?? { ports: [] };
  const same =
    cell.fill !== undefined && fill !== undefined
      ? cell.fill.kind === fill.kind && cell.fill.turn === fill.turn
      : false;
  const next = same || fill === undefined ? undefined : fill;

  const cells = { ...tiles.cells };
  if (!next && cell.ports.length === 0) delete cells[key];
  else cells[key] = { ports: cell.ports, ...(next ? { fill: next } : {}) };

  return withKit(forge, {
    glyphs: { ...kit.glyphs, [letter]: { ...tiles, columns: widthFor(tiles, cells), cells } },
  });
}

/** How wide a letter is once a cell has been added past its right-hand edge. */
function widthFor(tiles: Tiles, cells: Record<string, Cell>): number {
  let widest = 1;
  for (const key of Object.keys(cells)) {
    const column = Number(key.split(",")[0]);
    if (Number.isFinite(column)) widest = Math.max(widest, column + 1);
  }
  return Math.max(widest, Math.min(tiles.columns, widest));
}

/** How many cells wide a letter stands. Its own decision, and its spacing. */
export function setColumns(forge: Forge, letter: string, columns: number): Forge {
  const kit = kitOf(forge);
  const tiles = kit.glyphs[letter];
  if (!tiles) return forge;
  return withKit(forge, {
    glyphs: { ...kit.glyphs, [letter]: { ...tiles, columns: Math.max(1, Math.round(columns)) } },
  });
}

/** Empty a letter's cells, to start it again from nothing. */
export function clearTiles(forge: Forge, letter: string): Forge {
  const kit = kitOf(forge);
  if (!(letter in kit.glyphs)) return forge;
  const glyphs = { ...kit.glyphs };
  delete glyphs[letter];
  return withKit(forge, { glyphs });
}

/**
 * Lay letters onto the grid from the skeletons the font already has.
 *
 * With no letters named it does the lot, which is how a kit starts: an
 * alphabet to argue with rather than an empty sheet. Named, it puts one letter
 * back to what the skeleton says, which is the undo for a cell editor.
 */
export function layOut(forge: Forge, letters?: string[]): Forge {
  const kit = kitOf(forge);
  const glyphs = { ...kit.glyphs };
  for (const letter of letters ?? letterNames()) {
    const recipe = recipeOf(letter, formOf(forge, letter));
    if (!recipe) continue;
    const tiles = seedTiles(recipe(styleFor(letter, forge)).strokes, styleFor(letter, forge), kit);
    if (tiles) glyphs[letter] = tiles;
    else delete glyphs[letter];
  }
  return withKit(forge, { glyphs });
}

/** Every cut that some letter has been told to differ in. */
export function cutsHeldBy(forge: Forge, letter: string): CutName[] {
  return CUT_NAMES.filter((name) => isCutException(forge, letter, name));
}

/**
 * The style one letter is drawn with.
 *
 * The family's, unless this letter is an exception, in which case the family's
 * with that letter's differences laid over it.
 */
export function styleFor(letter: string, forge: Forge): Style {
  const exception = forge.exceptions[letter];
  if (!exception) return forge.style;

  // Merged field by field through a plain record. The parts are five different
  // shapes, and asking the type system to prove that a patch for one of them
  // fits whichever one this is means writing the merge out five times.
  const merged: Record<string, unknown> = { ...forge.style.parts };
  for (const [part, patch] of Object.entries(exception)) {
    merged[part] = { ...(merged[part] as object), ...patch };
  }
  return { ...forge.style, parts: merged as unknown as Parts };
}

/**
 * Drawings, kept for as long as the document they belong to is.
 *
 * A change to a slider redraws the alphabet strip, and then the warnings walk
 * the same alphabet asking what closed up, and then the specimen line draws
 * some of it again. That is the same work three times over for one movement of
 * one control.
 *
 * Held on the document itself rather than on a key made out of its contents,
 * because an edit returns a new document and the old one becomes unreachable --
 * so the entries for it are collected without anything having to decide when a
 * cache has gone stale. There is no stale state to get wrong: a document that
 * still exists has not changed, and one that has changed is a different object.
 */
const drawings = new WeakMap<Forge, Map<string, Drawn | null>>();
const solids = new WeakMap<Forge, Map<string, Drawn | null>>();
/*
 * Letters as the tool left them, kept apart from the letters as the font has
 * them, because they are two different answers to the same question and a
 * proofing panel asking for one must not be handed the other.
 */
const proofs = new WeakMap<Forge, Map<string, Drawn | null>>();

function remembered(
  where: WeakMap<Forge, Map<string, Drawn | null>>,
  forge: Forge,
  letter: string,
  make: () => Drawn | null,
): Drawn | null {
  let kept = where.get(forge);
  if (!kept) {
    kept = new Map();
    where.set(forge, kept);
  }
  if (kept.has(letter)) return kept.get(letter) ?? null;
  const drawn = make();
  kept.set(letter, drawn);
  return drawn;
}

/**
 * The same document with the shaping layers left off, for while a gesture is in
 * flight.
 *
 * A cut and a cast are booleans over the whole outline and they cost between
 * five and forty milliseconds a letter, which is nothing once and everything
 * sixty times a second. Measured on the draw page before this: one ten-step
 * pull of `Fillets: Size` blocked the main thread for four hundred and
 * twenty-three seconds, in single tasks of up to thirty-eight.
 *
 * Kept here rather than at the call sites so that the letter drawn under the
 * hand and the letter drawn when the hand stops come from one function and
 * cannot drift apart. The forge handed back is a shallow copy with the two
 * layers switched off, made once per forge so the drawing cache still has
 * something stable to key on.
 */
const plainly = new WeakMap<Forge, Forge>();

export function unshaped(forge: Forge): Forge {
  // A font with nothing switched on is already this, and handing back a copy
  // of it would be a second document drawing the same letters -- every one of
  // them a fresh miss in a cache that had them.
  if (!anyShaping(forge.cuts, forge.cast) && forge.cutExceptions === undefined
      && forge.castExceptions === undefined) {
    return forge;
  }
  const kept = plainly.get(forge);
  if (kept) return kept;
  // The per-letter exceptions go with them: a letter cut differently from the
  // rest is still a letter with no cut on it while the hand is moving. Nothing
  // else is touched, so the letterform itself -- its parts, its alternates,
  // whatever was imported for it -- is exactly what it always was.
  const plain: Forge = {
    ...forge,
    cuts: noCuts(),
    cast: noCast(),
    cutExceptions: undefined,
    castExceptions: undefined,
  };
  plainly.set(forge, plain);
  return plain;
}

/**
 * A letter as the font has it: drawn, or brought in from outside, and in
 * either case with whatever the font takes out of it taken out.
 *
 * Everything downstream -- the grid, the specimen, the checks, the exporters --
 * asks this one question and gets one answer whichever kind of letter it is.
 */
export function draw(letter: string, forge: Forge): Drawn | null {
  return remembered(drawings, forge, letter, () => {
    const outside = forge.imported[letter];
    if (!outside) {
      return drawLetter(
        letter,
        styleFor(letter, forge),
        formOf(forge, letter),
        cutsFor(letter, forge),
        forge.kit,
        castFor(letter, forge),
      );
    }

    /*
     * A letter somebody drew elsewhere is still cut.
     *
     * It used to pass straight through, and the effect was a font that
     * disagreed with itself: slots across every letter but the ampersand,
     * which sat in the middle of the word solid. A cut is a decision about the
     * font, and a letter that has joined the font is in it.
     *
     * Four of the six reach it. The other two are made out of the skeleton --
     * a groove is the spine swept again, a break is where two spines meet --
     * and there is no skeleton here, so they do nothing. Said in the panel
     * rather than left to be discovered.
     *
     * Measured against the font's own pen, because the letter has none: a slot
     * through the ampersand is the thickness a slot is in this font.
     *
     * And the shape is read rather than the winding believed. Everything swept
     * here winds its counters against its ink on purpose; an outline that
     * arrived from a drawing program has whatever winding that program left,
     * and taking it at its word turns a counter into a piece of ink.
     */
    const cutting = shapedInk(
      outside.contours,
      [],
      scaleOf(forge.style),
      cutsFor(letter, forge),
      castFor(letter, forge),
      "nesting",
    );
    return {
      contours: cutting.contours,
      // The advance it arrived with, whatever the cut did to its edges -- the
      // same promise every drawn letter is given.
      advanceWidth: outside.advanceWidth,
      cut: cutting.cut,
    };
  });
}

/**
 * The same letter with nothing taken out of it.
 *
 * For the trip out to a drawing program and back. What leaves has to be the
 * letter the cuts are applied *to*, not the letter after them: hand somebody a
 * slotted n to edit and the slots come back baked into the outline, and then
 * the font cuts fresh slots through the ones already there.
 *
 * So the sheet carries the solid letter, the drawing that returns replaces the
 * solid letter, and the cuts go on carrying on -- which is the whole point of
 * their being a description rather than an edit.
 */
export function solid(letter: string, forge: Forge): Drawn | null {
  if (!anythingCut(forge)) return draw(letter, forge);
  return remembered(solids, forge, letter, () => {
    const outside = forge.imported[letter];
    return outside
      ? { contours: outside.contours, advanceWidth: outside.advanceWidth }
      : drawLetter(letter, styleFor(letter, forge), formOf(forge, letter), undefined, forge.kit);
  });
}

/**
 * Change a part.
 *
 * With no letter named the change is to the family, which is the ordinary case
 * and the one worth making easy: it reaches every letter that has that part.
 * Naming a letter makes that letter an exception instead, and leaves the rest
 * of the font alone.
 */
export function editPart(
  forge: Forge,
  part: PartName,
  patch: Partial<Parts[PartName]>,
  letter?: string,
): Forge {
  if (letter === undefined) {
    return {
      ...forge,
      style: {
        ...forge.style,
        parts: { ...forge.style.parts, [part]: { ...forge.style.parts[part], ...patch } },
      },
    };
  }

  const existing = forge.exceptions[letter] ?? {};
  return {
    ...forge,
    exceptions: {
      ...forge.exceptions,
      [letter]: { ...existing, [part]: { ...(existing[part] ?? {}), ...patch } },
    },
  };
}

/** Put a letter back on the family's own terms. */
export function clearException(forge: Forge, letter: string, part?: PartName): Forge {
  const existing = forge.exceptions[letter];
  if (!existing) return forge;

  const exceptions = { ...forge.exceptions };
  if (part === undefined) {
    delete exceptions[letter];
  } else {
    const remaining = { ...existing };
    delete remaining[part];
    if (Object.keys(remaining).length === 0) delete exceptions[letter];
    else exceptions[letter] = remaining;
  }
  return { ...forge, exceptions };
}

export function isException(forge: Forge, letter: string, part?: PartName): boolean {
  const exception = forge.exceptions[letter];
  if (!exception) return false;
  return part === undefined ? true : exception[part] !== undefined;
}

/** Change something about the pen, which every letter reads without exception. */
export function editPen(forge: Forge, patch: Partial<Style["pen"]>): Forge {
  return { ...forge, style: { ...forge.style, pen: { ...forge.style.pen, ...patch } } };
}

export function editMetrics(forge: Forge, patch: Partial<Style["metrics"]>): Forge {
  return { ...forge, style: { ...forge.style, metrics: { ...forge.style.metrics, ...patch } } };
}

/**
 * What an edit to this part is about to change, in letters.
 *
 * Said before the edit rather than discovered after it. Moving the serif is a
 * change to sixty glyphs, and a tool that lets that happen without mentioning
 * it is not being helpful.
 */
export function reach(forge: Forge, part: PartName): { letters: string[]; held: string[] } {
  const letters: string[] = [];
  const held: string[] = [];
  for (const letter of letterNames()) {
    if (!usesPart(letter, part, forge)) continue;
    if (isException(forge, letter, part)) held.push(letter);
    else letters.push(letter);
  }
  return { letters, held };
}

function usesPart(letter: string, part: PartName, forge: Forge): boolean {
  return partsOf(letter, forge).includes(part);
}

const partsCache = new WeakMap<Style, Map<string, PartName[]>>();

/** Which parts a letter has, cached per style because it means drawing it. */
export function partsOf(letter: string, forge: Forge): PartName[] {
  const style = styleFor(letter, forge);
  let forStyle = partsCache.get(style);
  if (!forStyle) {
    forStyle = new Map();
    partsCache.set(style, forStyle);
  }
  // Keyed by the form as well as the letter: a double-storey a is a different
  // skeleton and may want a different set of parts from a single-storey one, so
  // a cache that only knew the letter would answer for whichever was asked
  // first and go on answering that after the form had changed.
  const form = formOf(forge, letter);
  const key = `${letter}\u0000${form}`;
  const known = forStyle.get(key);
  if (known) return known;
  const found = partsUsedBy(letter, style, form);
  forStyle.set(key, found);
  return found;
}

function clone(style: Style): Style {
  return {
    ...style,
    metrics: { ...style.metrics },
    pen: { ...style.pen },
    parts: {
      slab: { ...style.parts.slab },
      shoulder: { ...style.parts.shoulder },
      bowl: { ...style.parts.bowl },
      corner: { ...style.parts.corner },
      terminal: { ...style.parts.terminal },
      crossbar: { ...style.parts.crossbar },
      ball: { ...style.parts.ball },
      flare: { ...style.parts.flare },
      wave: { ...style.parts.wave },
    },
  };
}

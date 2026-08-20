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

import { drawLetter, letterNames, type Drawn } from "./build";
import { partsUsedBy, type PartName } from "./parts";
import { BASES, type Parts, type Style } from "./style";

/** A letter that has been told to differ, and in what. */
export type Overrides = Partial<{ [K in keyof Parts]: Partial<Parts[K]> }>;

export interface Forge {
  /** Which base this started from, for saying so and for starting again. */
  base: string;
  /** What every letter reads unless it has been told otherwise. */
  style: Style;
  /** Letters that have been told otherwise, and only those. */
  exceptions: Record<string, Overrides>;
}

export function startFrom(base: Style): Forge {
  return { base: base.name, style: clone(base), exceptions: {} };
}

export function baseNamed(name: string): Style | undefined {
  return BASES.find((style) => style.name === name);
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

export function draw(letter: string, forge: Forge): Drawn | null {
  return drawLetter(letter, styleFor(letter, forge));
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
  const known = forStyle.get(letter);
  if (known) return known;
  const found = partsUsedBy(letter, style);
  forStyle.set(letter, found);
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
      terminal: { ...style.parts.terminal },
      crossbar: { ...style.parts.crossbar },
    },
  };
}

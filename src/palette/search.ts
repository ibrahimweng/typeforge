/**
 * Ranking what the product can do against what somebody typed.
 *
 * Word-based rather than a model, and the reason is the corpus: every control
 * already carries a sentence written in a designer's vocabulary, so the words
 * to match against are the words somebody would use. What that leaves to build
 * is a ranking that behaves when the query is a fragment ("kern"), when it is a
 * name ("corner radius"), and when it is a description of a problem ("the o
 * looks too round") -- three quite different things arriving through one box.
 *
 * Nothing here is fitted to a benchmark. Each weight below is a statement about
 * which of two results a person would rather see first, and the ordering they
 * produce is checked in `search.test.ts` against queries written as sentences.
 */

import { impliedBy } from "./synonyms";
import { uniqueWords, wordsOf } from "./words";

/** Something the palette can offer. */
export interface Entry {
  id: string;
  /** What it is called, which is what gets matched hardest. */
  label: string;
  /** What it does, in the product's own words. The corpus. */
  hint: string;
  /**
   * Anything else worth matching that is neither: the part a control belongs
   * to, a letter's character and Unicode name, a face's blurb.
   */
  also?: readonly string[];
  kind: EntryKind;
}

export type EntryKind = "action" | "view" | "control" | "letter" | "face" | "alternate";

/** What each prefix narrows the search to, and what to call it on screen. */
export const PREFIXES: ReadonlyArray<{ mark: string; kinds: readonly EntryKind[]; label: string }> = [
  { mark: ">", kinds: ["action", "view"], label: "actions" },
  { mark: "#", kinds: ["letter"], label: "letters" },
  { mark: "~", kinds: ["control"], label: "controls" },
];

export interface Query {
  /** What is left after any prefix is taken off. */
  text: string;
  /** The kinds the prefix allows, or null for all of them. */
  kinds: readonly EntryKind[] | null;
  mark: string | null;
}

/** A typed line, split into the filter it asks for and the words it searches by. */
export function readQuery(raw: string): Query {
  const found = PREFIXES.find((one) => raw.startsWith(one.mark));
  if (!found) return { text: raw.trim(), kinds: null, mark: null };
  return { text: raw.slice(found.mark.length).trim(), kinds: found.kinds, mark: found.mark };
}

/**
 * An entry with its words counted out once.
 *
 * Built ahead of the first keystroke because the catalogue is a few hundred
 * entries and the hints are sentences: doing this per keystroke is the
 * difference between a palette that answers while you type and one that
 * stutters.
 */
interface Indexed {
  entry: Entry;
  label: string;
  labelWords: string[];
  /** Every word in the hint and the extras, each counted once. */
  bodyWords: Set<string>;
}

export interface Index {
  items: Indexed[];
  /**
   * How much a word is worth, by how few entries carry it.
   *
   * Without this the hints work against themselves. "Stroke" appears in a
   * hundred of them and "aperture" in two, so an unweighted count ranks every
   * control in the product above the right one for any query mentioning a
   * stroke. Weighting by rarity is what turns a pile of sentences into an
   * index: the words that separate entries are exactly the rare ones.
   */
  worth: Map<string, number>;
}

export function buildIndex(entries: readonly Entry[]): Index {
  const items: Indexed[] = entries.map((entry) => ({
    entry,
    label: entry.label.toLowerCase(),
    labelWords: wordsOf(entry.label),
    bodyWords: new Set([
      ...uniqueWords(entry.hint),
      ...(entry.also ?? []).flatMap((one) => uniqueWords(one)),
    ]),
  }));

  const carrying = new Map<string, number>();
  for (const item of items) {
    for (const word of new Set([...item.labelWords, ...item.bodyWords])) {
      carrying.set(word, (carrying.get(word) ?? 0) + 1);
    }
  }
  const worth = new Map<string, number>();
  for (const [word, count] of carrying) {
    // Plain inverse document frequency, floored at nothing so a word in every
    // entry is worth nothing rather than working against the entry that has it.
    worth.set(word, Math.max(0, Math.log(items.length / count)));
  }
  return { items, worth };
}

export interface Hit {
  entry: Entry;
  score: number;
  /** Which words earned it, for showing why a result came back. */
  because: string[];
}

/*
 * What each kind of agreement is worth.
 *
 * The order matters more than the numbers. Somebody who types the name of a
 * thing wants that thing, and no amount of prose agreement should outrank it --
 * so a name match is worth more than any number of hint matches can reach. What
 * the hints are for is the other question, the one with no name in it, and
 * there the rare words carry the weight.
 */
const NAMED = 1000;
const NAME_STARTS = 400;
const NAME_WORD = 200;
const NAME_INSIDE = 90;
const HINT_WORD = 24;
const IMPLIED_WORD = 18;
const LOOSE = 6;

/*
 * How much a kind is worth once it has agreed with the query.
 *
 * A description of a change should find the control that makes it. The letter
 * `s` and the alternate "s: Flat-sided" both agree with a query about the s,
 * and neither of them changes anything about the face -- so on equal evidence
 * they sit below the controls and the actions. Typing a name still finds them
 * outright, because naming a thing outscores describing one by more than this
 * ever takes away, and the `#` prefix ranks letters among themselves where
 * this has no say at all.
 */
const BY_KIND: Record<EntryKind, number> = {
  action: 1,
  view: 1,
  control: 1,
  face: 0.9,
  alternate: 0.55,
  letter: 0.5,
};

/**
 * Whether the typed letters appear in order somewhere in the label.
 *
 * For the half-typed and the mistyped: "crnr rds" reaches the corner radius.
 * Worth little, because it also reaches a dozen other things, and it is here to
 * stop the palette going blank rather than to decide anything.
 */
function threadsThrough(needle: string, haystack: string): boolean {
  if (!needle) return false;
  let at = 0;
  for (const letter of needle) {
    at = haystack.indexOf(letter, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

export function search(index: Index, raw: string, limit = 40): Hit[] {
  const query = readQuery(raw);
  const allowed = query.kinds ? new Set(query.kinds) : null;
  const typed = query.text.toLowerCase().trim();
  const words = wordsOf(query.text);
  const implied = impliedBy(words);

  const hits: Hit[] = [];
  for (const item of index.items) {
    if (allowed && !allowed.has(item.entry.kind)) continue;

    // With a prefix and nothing typed, the filter alone is the query.
    if (!typed) {
      hits.push({ entry: item.entry, score: 0, because: [] });
      continue;
    }

    let score = 0;
    const because: string[] = [];

    /*
     * A single letter only finds a letter when it is the whole query.
     *
     * There are four hundred and fifty glyphs and their names are as short as
     * one character, so any sentence with an "I" or an "a" in it agreed with
     * two of them perfectly and pushed the answer down the list: "i want feet
     * on the letters" came back with the letter i above the serif controls.
     * Typing one character is a real thing to do, and it means that letter --
     * anything longer is a sentence, and a sentence is not about the letter i.
     */
    const oneLetter = item.entry.kind === "letter" && item.entry.label.length === 1;
    if (oneLetter && words.length > 1 && !allowed) continue;

    if (item.label === typed) score += NAMED;
    else if (item.label.startsWith(typed)) score += NAME_STARTS;
    else if (item.label.includes(typed)) score += NAME_INSIDE;

    for (const word of words) {
      const worth = index.worth.get(word) ?? Math.log(index.items.length);
      if (item.labelWords.includes(word)) {
        score += NAME_WORD + worth * 10;
        because.push(word);
        continue;
      }
      if (item.bodyWords.has(word)) {
        score += HINT_WORD + worth * 12;
        because.push(word);
      }
    }

    /*
     * One typed word, one score, however many of its synonyms land.
     *
     * The best agreement each typed word can find, rather than the sum of all
     * of them -- see `impliedBy`. A name still beats prose here as it does
     * above, because somebody typing a word for a thing wants the thing.
     */
    for (const [word, listed] of implied) {
      if (item.labelWords.includes(word) || item.bodyWords.has(word)) continue;
      let best = 0;
      let found = "";
      for (const other of listed) {
        if (words.includes(other)) continue;
        const worth = index.worth.get(other) ?? 0;
        const here = item.labelWords.includes(other)
          ? NAME_WORD * 0.8 + worth * 8
          : item.bodyWords.has(other)
            ? IMPLIED_WORD + worth * 8
            : 0;
        if (here > best) {
          best = here;
          found = other;
        }
      }
      /*
       * And a vague query prefers the general control.
       *
       * A word typed straight means the thing was named; a word reached
       * through a synonym means it was described, and a description belongs to
       * the control that covers the most. "Fatter" is about the weight of the
       * whole font, not the thickness of its crossbars -- and both of those
       * carry the word "thick" in their names, so nothing but generality tells
       * them apart. Divided by how many words are in the name, the one-word
       * control wins and the part-and-field one comes second, which is the
       * order somebody typing an adjective wants them in.
       */
      if (best > 0) {
        score += best / Math.max(1, item.labelWords.length);
        because.push(found);
      }
    }

    if (score === 0 && threadsThrough(typed.replace(/\s+/g, ""), item.label.replace(/\s+/g, ""))) {
      score += LOOSE;
    }

    if (score > 0) {
      hits.push({
        entry: item.entry,
        score: score * BY_KIND[item.entry.kind],
        because: [...new Set(because)],
      });
    }
  }

  /*
   * Ties broken by the shorter name.
   *
   * Two entries agreeing with a query equally well are not equally good
   * answers: the one with less in its name is the more general, and the more
   * general is what somebody who typed a general word meant. "Weight" before
   * "Weight of the crossbar".
   */
  hits.sort((one, other) =>
    other.score - one.score || one.entry.label.length - other.entry.label.length ||
    one.entry.label.localeCompare(other.entry.label),
  );
  return hits.slice(0, limit);
}

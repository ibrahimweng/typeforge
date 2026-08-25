/**
 * Which entries the palette cannot be talked into finding.
 *
 * The palette's promise is that somebody who does not know what a control is
 * called can describe what they want and be shown it. That promise is testable
 * without guessing at what anybody would type, because every entry already
 * carries a sentence saying what it does: take an entry's own description,
 * strike out the words of its name, and search with what is left. If a
 * control's own description will not find it, nothing a person types will.
 *
 * Two queries per entry, because the whole sentence is not what anybody types:
 *
 *   long   the whole description less the name. The generous test. Failing it
 *          means the entry is unreachable by any wording of its own idea.
 *   short  the three words of the description that separate it best from the
 *          rest of the product, by the same rarity weighting the search uses,
 *          less the name. This is the shape of a real query.
 *
 * Found at rank 8 or better, which is what a person sees without scrolling.
 *
 *   npx vite-node scripts/reach.ts
 */

import { catalogue, type Item, type Shell } from "@/palette/catalogue";
import { buildIndex, search } from "@/palette/search";
import { uniqueWords, wordsOf } from "@/palette/words";

const SEEN = 8;

/** A shell that answers every question and does nothing, so the catalogue builds. */
const shell: Shell = {
  mode: "forge",
  setMode: () => {},
  view: "grid",
  setView: () => {},
  openFile: () => {},
  export: () => {},
  save: () => {},
  newProject: () => {},
  toggleHelp: () => {},
  library: () => {},
  selectGlyph: () => {},
  paramOf: () => 0,
  setParam: () => {},
  partOf: () => 0,
  setPart: () => {},
  penOf: () => 0,
  setPen: () => {},
  metricOf: () => 0,
  setMetric: () => {},
  cutOf: () => 0,
  setCut: () => {},
  castOf: () => 0,
  setCast: () => {},
  startFromBase: () => {},
  chooseAlternate: () => {},
  hasFont: true,
} as unknown as Shell;

const items: Item[] = catalogue(shell);
const index = buildIndex(items);

/** The words of a name, stemmed, so a query can be stripped of them. */
function nameWords(item: Item): Set<string> {
  return new Set(uniqueWords(item.label));
}

/** The description with the name struck out. */
function described(item: Item, words: number | null): string {
  const own = nameWords(item);
  const body = uniqueWords(item.hint).filter((word) => !own.has(word));
  if (words === null) return body.join(" ");
  return [...body]
    .sort((a, b) => (index.worth.get(b) ?? 0) - (index.worth.get(a) ?? 0))
    .slice(0, words)
    .join(" ");
}

function rankOf(query: string, id: string): number | null {
  if (!query.trim()) return null;
  const hits = search(index, query, 60);
  const at = hits.findIndex((hit) => hit.entry.id === id);
  return at < 0 ? null : at + 1;
}

const byKind = new Map<string, { total: number; lost: number }>();
const lost: Array<{ item: Item; long: number | null; short: number | null; query: string }> = [];
let noWords = 0;

for (const item of items) {
  const long = described(item, null);
  const short = described(item, 3);
  if (!long.trim()) {
    noWords += 1;
    continue;
  }
  const atLong = rankOf(long, item.id);
  const atShort = rankOf(short, item.id);
  const tally = byKind.get(item.kind) ?? { total: 0, lost: 0 };
  tally.total += 1;
  const missed = (atLong === null || atLong > SEEN) && (atShort === null || atShort > SEEN);
  if (missed) {
    tally.lost += 1;
    lost.push({ item, long: atLong, short: atShort, query: short });
  }
  byKind.set(item.kind, tally);
}

console.log(`${items.length} entries, ${noWords} with no description to search by\n`);
console.log("Reachable by their own description, by kind:");
for (const [kind, tally] of [...byKind].sort((a, b) => b[1].lost - a[1].lost)) {
  const found = tally.total - tally.lost;
  const share = ((found / tally.total) * 100).toFixed(0);
  console.log(`  ${kind.padEnd(10)} ${String(found).padStart(4)}/${String(tally.total).padEnd(4)} ${share}%`);
}

console.log(`\n${lost.length} entries no wording of their own description reaches:\n`);
for (const one of lost.slice(0, 60)) {
  const long = one.long === null ? "not found" : `rank ${one.long}`;
  const short = one.short === null ? "not found" : `rank ${one.short}`;
  console.log(`  ${one.item.kind.padEnd(9)} ${one.item.label}`);
  console.log(`      whole description: ${long}   three words: ${short}`);
  console.log(`      those three words: "${one.query}"`);
}
if (lost.length > 60) console.log(`  ...and ${lost.length - 60} more`);

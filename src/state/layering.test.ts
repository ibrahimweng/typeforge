/**
 * The rule the store's chain of classes keeps, checked rather than trusted.
 *
 * The document's methods are spread over eight classes that inherit from one
 * another: `StoreCore`, then navigation, editing, outlines, the pen,
 * parameters, shaping, and `Store` at the end. That shape gets a bad name, and
 * usually deserves it -- inheritance used to cut a large file up leaves every
 * layer able to reach every other, and what starts as an order becomes a knot.
 *
 * This one is not a knot, and the measurements are worth writing down because
 * they are what makes the shape defensible:
 *
 *   - No layer refers to anything declared above it. Not a call, not a field,
 *     and there is no `super` anywhere. The chain is strictly one directional.
 *   - What crosses a layer boundary is seventeen names. Ten are methods, six of
 *     them the kernel on `StoreCore`. Seven are fields on that same kernel,
 *     read and in a few places written from above.
 *
 * So it is a small shared kernel with seven modules of methods on top, written
 * as inheritance because that is what gives the application one flat `store.x`
 * to call without a delegating facade for a hundred and sixty-four methods.
 *
 * The fields are where it is loosest, and they are the reason the first count
 * of this was wrong: counting calls alone gave nine names and a tidier story
 * than the truth. `SHARED` below lists all of it, which is the point of
 * writing the number down rather than describing it.
 *
 * What was missing is that none of it was enforced. The discipline was real and
 * entirely invisible: nothing stopped the next person calling up the chain, and
 * the first one who did would turn a readable order into the knot this pattern
 * is known for, silently. That is what this file is. It does not make the
 * design better. It makes it stay.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The chain, lowest first.
 *
 * Checked against the source below rather than taken on trust, so inserting a
 * class into the middle without listing it here fails rather than quietly
 * escaping every rule in this file.
 */
const CHAIN = [
  "store-core",
  "store-navigation",
  "store-editing",
  "store-outlines",
  "store-pen",
  "store-parameters",
  "store-shaping",
  "store",
] as const;

/**
 * What one layer is allowed to reach down for.
 *
 * Not a limit on what `StoreCore` may hold, but on what the layers above it
 * lean on, which is the number that says how tangled this is. Adding a name
 * here is a decision: it widens the contract every layer above is written
 * against, and it should be visible in a diff rather than absorbed.
 *
 * The fields are the half worth looking at twice. Counting only the calls
 * gives nine names and a tidy story about a kernel of methods; counting the
 * fields as well gives seventeen, and says something truer -- the layers do
 * not only call down, they read and write the kernel's own state. `state` is
 * inherent, since the document is what all of this is about. The rest are
 * `StoreCore` internals that upper layers reach into, and the direction to
 * travel is fewer of them rather than more. `clearHistory` was made for that
 * reason: `undoStack` and `redoStack` were being emptied by hand in six places
 * in `store.ts`, and now are not.
 */
const SHARED = new Set([
  // The kernel's methods. Everything is built on these five.
  "set",
  "touch",
  "say",
  "push",
  "glyph",
  "clearHistory",
  // Four helpers that earned their place higher up the chain.
  "editGlyph",
  "editGlyphLive",
  "captureControlBaseline",
  "setSelectedNodes",
  // And the kernel's own state, reached directly. `state` is the document and
  // belongs to everyone. The others are internals, and each one is somewhere
  // the encapsulation is thinner than it looks.
  "state",
  "held",
  "ufo",
  "controlBaseline",
  "controlOutlines",
  "controlLinks",
  "undoStack",
  "redoStack",
]);

const sourceOf = (layer: string): string => readFileSync(`src/state/${layer}.ts`, "utf8");

/**
 * Where a layer's class is declared, anchored to the start of a line.
 *
 * Anchored because the first attempt was not, and `store.ts` has the word
 * "class" in a comment eighty lines above the real declaration -- so the
 * reader took `says`, out of "the class says how the parts fit together", for
 * the name of the class and found it extended nothing. The first test below
 * caught it, which is the argument for that test existing.
 */
const DECLARATION = /^(?:export )?(?:abstract )?class (\w+)(?: extends (\w+))?/m;

/**
 * The members a layer declares, by reading its class body.
 *
 * Text rather than types, which is crude and is the reason for the first test
 * below: a reader that matched nothing would make every other test here pass
 * by finding no violations in no data, and a green suite that checks nothing
 * is worse than no suite. So the parser is made to prove it found something
 * before anything is concluded from it.
 */
function declaredIn(layer: string): Set<string> {
  const source = sourceOf(layer);
  const at = DECLARATION.exec(source);
  const body = source.slice(at ? at.index : 0);
  const modifiers =
    "(?:public |protected |private |abstract |static |readonly |async |override |get |set )*";
  const methods = [
    ...body.matchAll(new RegExp(`^  ${modifiers}([a-zA-Z_]\\w*)\\s*(?:<[^>]*>)?\\(`, "gm")),
  ];
  const fields = [...body.matchAll(new RegExp(`^  ${modifiers}([a-zA-Z_]\\w*)\\s*[:=]`, "gm"))];
  const found = new Set([...methods, ...fields].map((match) => match[1]));
  for (const keyword of ["if", "for", "while", "switch", "catch", "return", "constructor"]) {
    found.delete(keyword);
  }
  return found;
}

/** Every `this.something` a layer mentions, whether it calls it or not. */
function referencedIn(layer: string): Set<string> {
  return new Set([...sourceOf(layer).matchAll(/this\.([a-zA-Z_]\w*)/g)].map((match) => match[1]));
}

describe("the store's chain of classes", () => {
  it("is the chain this file thinks it is", () => {
    /*
     * Read off the `extends` clauses, so a layer added in the middle is caught
     * here rather than sailing past every rule below by not being listed.
     */
    const classNameOf = (layer: string) => DECLARATION.exec(sourceOf(layer));

    const links = CHAIN.map((layer) => {
      const found = classNameOf(layer);
      expect(found, `${layer} should declare a class`).not.toBeNull();
      return { layer, name: found![1], parent: found![2] };
    });

    expect(links[0].parent, "StoreCore should extend nothing").toBeUndefined();
    for (let at = 1; at < links.length; at++) {
      expect(links[at].parent, `${links[at].layer} should extend the layer below it`).toBe(
        links[at - 1].name,
      );
    }
  });

  it("has a parser that actually finds something", () => {
    /*
     * The guard on every conclusion below. These numbers are floors well under
     * what each file holds today, so they survive ordinary editing and still
     * fail loudly if the reading above ever silently stops matching.
     */
    const counts = Object.fromEntries(CHAIN.map((layer) => [layer, declaredIn(layer).size]));
    for (const layer of CHAIN) {
      expect(counts[layer], `${layer}: the parser found nothing`).toBeGreaterThan(4);
    }
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    expect(total, "the chain should declare well over a hundred members").toBeGreaterThan(120);
  });

  it("never reaches up", () => {
    /*
     * The one that matters. A layer calling something declared above it is a
     * cycle: the two can no longer be read, moved or reasoned about apart, and
     * the order the files are in stops meaning anything.
     *
     * Measured as zero when this was written, across every reference and not
     * only calls.
     */
    const owner = new Map<string, string>();
    for (const layer of CHAIN) {
      for (const name of declaredIn(layer)) if (!owner.has(name)) owner.set(name, layer);
    }

    const upward: string[] = [];
    CHAIN.forEach((layer, at) => {
      for (const name of referencedIn(layer)) {
        const from = owner.get(name);
        if (from && CHAIN.indexOf(from as (typeof CHAIN)[number]) > at) {
          upward.push(`${layer} reaches up to ${name}, which ${from} declares`);
        }
      }
    });

    expect(upward).toEqual([]);
  });

  it("leans on nothing below but the shared few", () => {
    /*
     * The other half. Nothing here is wrong in itself -- a layer using the
     * layer below is what a chain is for -- but the *number* of things it uses
     * is the difference between a kernel and a pile. Nine names is a kernel.
     *
     * A failure here is not a bug. It is a new name crossing a boundary, and
     * the fix is usually to add it to `SHARED` on purpose, having looked at
     * whether it belongs on `StoreCore` instead.
     */
    const owner = new Map<string, string>();
    for (const layer of CHAIN) {
      for (const name of declaredIn(layer)) if (!owner.has(name)) owner.set(name, layer);
    }

    const unexpected: string[] = [];
    CHAIN.forEach((layer, at) => {
      for (const name of referencedIn(layer)) {
        const from = owner.get(name);
        if (!from || from === layer) continue;
        if (CHAIN.indexOf(from as (typeof CHAIN)[number]) >= at) continue;
        if (!SHARED.has(name)) unexpected.push(`${layer} uses ${name} from ${from}`);
      }
    });

    expect(unexpected).toEqual([]);
  });

  it("keeps `super` out of it", () => {
    // A chain with no `super` is one where no layer overrides another, so a
    // method means the same thing wherever it is read from.
    for (const layer of CHAIN) {
      expect(sourceOf(layer), `${layer} should not call super`).not.toMatch(/\bsuper\./);
    }
  });
});

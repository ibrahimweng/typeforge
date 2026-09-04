/**
 * The three that shape a font rather than a letter: anchors and components,
 * kerning, and the metadata a file carries.
 *
 * They sit above editing because each of them edits letters to do its work.
 * Building the accented set writes glyphs; reading the control letters writes
 * glyphs; both go through `editGlyph` so that one undo takes the lot back.
 */

import { buildAccents, deriveAnchors, suggestAnchors, looksLikeMark } from "@/font/accents";
import { buildsOn, dependentsOf } from "@/font/composite";
/*
 * Renamed on the way in, because the store's own methods are called the same
 * things. Both resolve correctly -- a bare name inside a method is the module
 * one -- but which is meant should not be something a reader has to work out.
 */
import {
  addGlyph as putGlyphIn,
  claimedBy,
  duplicateGlyph as copyGlyphTo,
  freeNameNear,
  nameIsFree,
  removeGlyph as takeGlyphOut,
  renameGlyph as callGlyph,
} from "@/font/library";
import {
  addLigature as putLigatureIn,
  addToSet as putInSet,
  removeFromSet as takeOutOfSet,
  removeLigature as takeLigatureOut,
} from "@/font/features";
import { cloneGlyph } from "@/font/types";
import { alignMasters } from "@/font/master";
import type { Anchor, Contour, KernClass, KernPair, Typeface } from "@/font/types";
import { nodeKey } from "./model";
import { firstLetterName } from "./store-core";
import { EditingStore } from "./store-editing";

export abstract class ShapingStore extends EditingStore {
  /** Move an anchor, or add it if the glyph does not carry one by that name. */
  setAnchor(glyphName: string, name: string, x: number, y: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(glyphName);
    if (index === undefined) return;

    const glyph = typeface.glyphs[index];
    const before = glyph.anchors.map((a) => ({ ...a }));
    const existing = glyph.anchors.find((a) => a.name === name);
    if (existing) {
      existing.x = Math.round(x);
      existing.y = Math.round(y);
    } else {
      glyph.anchors.push({ name, x: Math.round(x), y: Math.round(y) });
    }
    const after = glyph.anchors.map((a) => ({ ...a }));

    this.push({
      label: `Move ${name} anchor`,
      undo: () => {
        typeface.glyphs[index].anchors = before.map((a) => ({ ...a }));
      },
      redo: () => {
        typeface.glyphs[index].anchors = after.map((a) => ({ ...a }));
      },
    });
    this.touch();
  }

  /** Live anchor movement during a drag; history is recorded on release. */
  setAnchorLive(glyphName: string, name: string, x: number, y: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(glyphName);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    const existing = glyph.anchors.find((a) => a.name === name);
    if (existing) {
      existing.x = Math.round(x);
      existing.y = Math.round(y);
    } else {
      glyph.anchors.push({ name, x: Math.round(x), y: Math.round(y) });
    }
    this.touch();
  }

  removeAnchor(glyphName: string, name: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.glyphIndex.get(glyphName);
    if (index === undefined) return;
    const glyph = typeface.glyphs[index];
    const before = glyph.anchors.map((a) => ({ ...a }));
    const after = before.filter((a) => a.name !== name);
    glyph.anchors = after.map((a) => ({ ...a }));
    this.push({
      label: `Remove ${name} anchor`,
      undo: () => {
        typeface.glyphs[index].anchors = before.map((a) => ({ ...a }));
      },
      redo: () => {
        typeface.glyphs[index].anchors = after.map((a) => ({ ...a }));
      },
    });
    this.touch();
  }

  anchorsFor(glyphName: string): Anchor[] {
    return this.glyph(glyphName)?.anchors ?? [];
  }

  /** Put default anchors on a glyph, as a starting position to drag from. */
  suggestAnchorsFor(glyphName: string): void {
    const typeface = this.state.typeface;
    const glyph = this.glyph(glyphName);
    if (!typeface || !glyph) return;
    const before = glyph.anchors.map((a) => ({ ...a }));
    const after = suggestAnchors(glyph, typeface, looksLikeMark(glyph));
    if (after.length === 0) return;

    const index = typeface.glyphIndex.get(glyphName)!;
    typeface.glyphs[index].anchors = after;
    this.push({
      label: "Suggest anchors",
      undo: () => {
        typeface.glyphs[index].anchors = before.map((a) => ({ ...a }));
      },
      redo: () => {
        typeface.glyphs[index].anchors = after.map((a) => ({ ...a }));
      },
    });
    this.touch();
  }

  /** Read anchor positions out of the composites the font already has. */
  deriveAnchorsFromFont(): { bases: number; marks: number } {
    const typeface = this.state.typeface;
    if (!typeface) return { bases: 0, marks: 0 };
    const before = typeface.glyphs.map((g) => g.anchors.map((a) => ({ ...a })));
    const result = deriveAnchors(typeface);
    const after = typeface.glyphs.map((g) => g.anchors.map((a) => ({ ...a })));

    this.push({
      label: "Read anchors from the font",
      undo: () => {
        typeface.glyphs.forEach((g, i) => {
          g.anchors = before[i].map((a) => ({ ...a }));
        });
      },
      redo: () => {
        typeface.glyphs.forEach((g, i) => {
          g.anchors = after[i].map((a) => ({ ...a }));
        });
      },
    });
    this.touch();
    return result;
  }

  /** Build every accented letter the font has the parts for. */
  buildAccentedGlyphs(overwrite = false): { built: string[]; skipped: number } {
    const typeface = this.state.typeface;
    if (!typeface) return { built: [], skipped: 0 };

    const snapshot = typeface.glyphs.map(cloneGlyph);
    const result = buildAccents(typeface, { overwriteDrawn: overwrite });
    if (result.built.length === 0) return { built: [], skipped: result.skipped.length };

    const after = typeface.glyphs.map(cloneGlyph);
    this.push({
      label: `Build ${result.built.length} accented glyph${result.built.length === 1 ? "" : "s"}`,
      undo: () => {
        typeface.glyphs = snapshot.map(cloneGlyph);
      },
      redo: () => {
        typeface.glyphs = after.map(cloneGlyph);
      },
    });
    this.touch();
    return { built: result.built, skipped: result.skipped.length };
  }

  /** Glyphs that would change if this one were edited. */
  dependents(glyphName: string): string[] {
    const typeface = this.state.typeface;
    return typeface ? dependentsOf(typeface, glyphName) : [];
  }

  /**
   * Build a letter out of another one, by hand.
   *
   * `removeComponent` has always been here and nothing has ever added one
   * except the accent builder, which runs on its own -- so a letter could be
   * taken apart and never put together on purpose. Which is the wrong way
   * round: the reason components exist is that a correction to an `a` should
   * reach every letter built on it, and that is worth having on a `ffi` or a
   * `¼` as much as on an `á`.
   *
   * Refused where it would build a letter out of itself, directly or through a
   * chain of others. A component that refers back to its own letter is a
   * drawing with no bottom to it, and every renderer that meets one either
   * gives up or hangs.
   */
  addComponent(glyphName: string, part: string): boolean {
    const typeface = this.state.typeface;
    const glyph = this.glyph(glyphName);
    if (!typeface || !glyph || !typeface.glyphIndex.has(part)) return false;

    if (part === glyphName || buildsOn(typeface, part, glyphName)) {
      this.say(
        `${part} is already built from ${glyphName}, so this would have no bottom to it.`,
        "error",
      );
      return false;
    }

    this.editGlyph(glyphName, "Add a part", (one) => {
      one.components = [
        ...one.components,
        { glyphName: part, transform: { a: 1, b: 0, c: 0, d: 1, dx: 0, dy: 0 } },
      ];
    });
    this.say(
      `${glyphName} is now built from ${part}. Drag it into place on the canvas.`,
      "success",
    );
    return true;
  }

  removeComponent(glyphName: string, position: number): void {
    this.editGlyph(glyphName, "Remove component", (glyph) => {
      glyph.components.splice(position, 1);
    });
  }

  setKerning(left: string, right: string, value: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const existingIndex = typeface.kerning.findIndex(
      (pair) => pair.left === left && pair.right === right,
    );
    const before: KernPair[] = typeface.kerning;

    const next = [...typeface.kerning];
    if (value === 0) {
      if (existingIndex >= 0) next.splice(existingIndex, 1);
    } else if (existingIndex >= 0) {
      next[existingIndex] = { left, right, value };
    } else {
      next.push({ left, right, value });
    }
    typeface.kerning = next;

    this.push({
      label: `Kern ${left}/${right}`,
      undo: () => {
        typeface.kerning = before;
      },
      redo: () => {
        typeface.kerning = next;
      },
    });
    this.touch();
  }

  /** Live kerning update during a drag; history is recorded on release. */
  setKerningLive(left: string, right: string, value: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const index = typeface.kerning.findIndex((pair) => pair.left === left && pair.right === right);
    if (value === 0) {
      if (index >= 0) typeface.kerning = typeface.kerning.filter((_, i) => i !== index);
    } else if (index >= 0) {
      const next = [...typeface.kerning];
      next[index] = { left, right, value };
      typeface.kerning = next;
    } else {
      typeface.kerning = [...typeface.kerning, { left, right, value }];
    }
    this.touch();
  }

  /**
   * Create a kerning class seeded from a pair.
   *
   * Class kerning is how a font avoids storing a value for every combination:
   * one entry covers every glyph on the left against every glyph on the right.
   * Starting from a pair the designer already chose is the natural way in.
   */
  addKernClass(left: string, right: string, value: number): string {
    const typeface = this.state.typeface;
    if (!typeface) return "";
    const id = `class-${typeface.kernClasses.length + 1}-${left}-${right}`;
    const created: KernClass = {
      id,
      name: `${left} / ${right}`,
      left: [left],
      right: [right],
      value,
    };
    const before = typeface.kernClasses;
    const next = [...before, created];
    typeface.kernClasses = next;
    this.push({
      label: "Add kerning class",
      undo: () => {
        typeface.kernClasses = before;
      },
      redo: () => {
        typeface.kernClasses = next;
      },
    });
    this.touch();
    return id;
  }

  updateKernClass(id: string, patch: Partial<Omit<KernClass, "id">>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = typeface.kernClasses;
    const next = before.map((kernClass) =>
      kernClass.id === id ? { ...kernClass, ...patch } : kernClass,
    );
    typeface.kernClasses = next;
    this.push({
      label: "Edit kerning class",
      undo: () => {
        typeface.kernClasses = before;
      },
      redo: () => {
        typeface.kernClasses = next;
      },
    });
    this.touch();
  }

  removeKernClass(id: string): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = typeface.kernClasses;
    const next = before.filter((kernClass) => kernClass.id !== id);
    typeface.kernClasses = next;
    this.push({
      label: "Remove kerning class",
      undo: () => {
        typeface.kernClasses = before;
      },
      redo: () => {
        typeface.kernClasses = next;
      },
    });
    this.touch();
  }

  /**
   * The kerning that applies to a pair, individual value first.
   *
   * This mirrors how a shaper resolves it: the individual pair subtable is
   * listed before the class subtable in GPOS, so a specific value overrides the
   * class the pair belongs to.
   */
  resolvedKerning(
    left: string,
    right: string,
  ): { value: number; source: "pair" | "class" | "none" } {
    const typeface = this.state.typeface;
    if (!typeface) return { value: 0, source: "none" };
    const pair = typeface.kerning.find((entry) => entry.left === left && entry.right === right);
    if (pair) return { value: pair.value, source: "pair" };
    const kernClass = typeface.kernClasses.find(
      (entry) => entry.left.includes(left) && entry.right.includes(right),
    );
    if (kernClass) return { value: kernClass.value, source: "class" };
    return { value: 0, source: "none" };
  }

  kerningFor(left: string, right: string): number {
    const typeface = this.state.typeface;
    if (!typeface) return 0;
    return typeface.kerning.find((pair) => pair.left === left && pair.right === right)?.value ?? 0;
  }

  /*
   * Making and unmaking letters.
   *
   * None of this existed, and its absence made `startBlank` a dead end: it
   * hands back a typeface with an empty glyph list, and there was no way to
   * put anything into it.
   *
   * All of them go through `editFont` below rather than `editGlyph`, because
   * every one changes something outside a single glyph -- the glyph list, the
   * index, the kerning, the classes, the ligature rules -- and undo has to put
   * all of it back.
   */

  /**
   * One structural change to the font, with an undo that restores all of it.
   *
   * `editGlyph` snapshots one letter, which is right for redrawing one and
   * useless here: renaming `a` rewrites kern pairs, class memberships,
   * ligature rules and the components of every letter built on it. So this
   * snapshots every collection a name can be written into and puts them all
   * back together.
   *
   * Every one of them, taken from the one list that says how many there are --
   * `library.ts` names eight places and this has to hold all of them. It held
   * five, which was right until a ligature could be made by hand and then was
   * an undo that took the letter back and left the rule pointing at it.
   *
   * The copies are shallow, which is what makes this cheap enough to do on a
   * font of six thousand letters: the library functions replace the arrays
   * they change rather than reaching into them, so holding the old arrays is
   * enough to hold the old state.
   */
  private editFont(label: string, mutate: (typeface: Typeface) => boolean): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;

    const hold = (one: Typeface) => ({
      glyphs: one.glyphs,
      glyphIndex: one.glyphIndex,
      kerning: one.kerning,
      kernClasses: one.kernClasses,
      alternates: one.alternates,
      ligatures: one.ligatures,
      sets: one.sets,
    });

    const before = hold(typeface);
    if (!mutate(typeface)) return false;
    const after = hold(typeface);

    /*
     * Adding, removing or renaming a letter is a change to the document rather
     * than to the drawing, so it lands in every weight.
     *
     * The glyph list is the one thing a master copies rather than shares and
     * still has to agree about: a letter added in the Regular and missing from
     * the Bold cannot vary, and is a difference nobody would think to look for.
     * Detected off the array's identity, which the library's own add and remove
     * replace rather than mutate, so a kerning or feature edit through here
     * costs nothing.
     */
    const structural = before.glyphs !== after.glyphs;
    const spread = () => {
      if (structural) alignMasters(typeface, this.state.masters);
    };
    spread();

    this.push({
      label,
      undo: () => {
        Object.assign(typeface, before);
        spread();
      },
      redo: () => {
        Object.assign(typeface, after);
        spread();
      },
    });
    this.touch();
    return true;
  }

  /** Put a new, empty letter in the font and open it. */
  addGlyph(name: string, unicodes: number[] = []): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const wanted = name.trim();
    if (wanted.length === 0) {
      this.say("A letter needs a name.", "error");
      return false;
    }
    if (!nameIsFree(typeface, wanted)) {
      this.say(`There is already a letter called ${wanted}.`, "error");
      return false;
    }
    const taken = unicodes.map((one) => claimedBy(typeface, one, wanted)).find(Boolean);
    if (taken) {
      this.say(`${taken} already answers to that character.`, "error");
      return false;
    }

    const made = this.editFont("Add a letter", (one) => putGlyphIn(one, wanted, unicodes) !== null);
    if (made) {
      this.set({ selectedGlyph: wanted, selectedNodes: new Set(), view: "glyph" });
      this.say(`Added ${wanted}.`, "success");
    }
    return made;
  }

  /**
   * Take a letter out, having said what goes with it.
   *
   * The letters built on this one are named before anything happens, because
   * they are what somebody would not have thought of: deleting an `a` takes
   * the `a` out of every accented letter built from it, and those letters stay
   * in the font looking like the accent on its own.
   */
  removeGlyph(name: string): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const built = dependentsOf(typeface, name);

    const gone = this.editFont("Remove a letter", (one) => takeGlyphOut(one, name));
    if (!gone) return false;

    if (this.state.selectedGlyph === name) {
      this.set({ selectedGlyph: firstLetterName(typeface), selectedNodes: new Set() });
    }
    this.say(
      built.length === 0
        ? `Removed ${name}.`
        : `Removed ${name}, and took it out of ${built.length} letter${built.length === 1 ? "" : "s"} built on it: ${built.slice(0, 4).join(", ")}${built.length > 4 ? "…" : ""}.`,
      built.length === 0 ? "success" : "info",
    );
    return true;
  }

  /** Give a letter a different name, everywhere the old one was written. */
  renameGlyph(from: string, to: string): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const wanted = to.trim();
    if (wanted.length === 0 || wanted === from) return false;
    if (!nameIsFree(typeface, wanted)) {
      this.say(`There is already a letter called ${wanted}.`, "error");
      return false;
    }

    const done = this.editFont("Rename a letter", (one) => callGlyph(one, from, wanted));
    if (done && this.state.selectedGlyph === from) this.set({ selectedGlyph: wanted });
    return done;
  }

  /** A copy of a letter under a new name, without the character it answers to. */
  duplicateGlyph(name: string): string | null {
    const typeface = this.state.typeface;
    if (!typeface) return null;
    const into = freeNameNear(typeface, name);
    const made = this.editFont(
      "Duplicate a letter",
      (one) => copyGlyphTo(one, name, into) !== null,
    );
    if (!made) return null;
    this.set({ selectedGlyph: into, selectedNodes: new Set() });
    this.say(
      `Copied ${name} to ${into}. It answers to no character until you give it one.`,
      "success",
    );
    return into;
  }

  /*
   * The rules that draw one thing for another.
   *
   * Through `editFont` like the rest of the structural changes, because a
   * feature is not part of any one glyph: undo has to put the whole rule back,
   * and a rule names letters that other operations rewrite.
   */

  /** Join a run of letters into one drawing of them together. */
  addLigature(components: string[], ligature: string): boolean {
    const made = this.editFont("Add a ligature", (one) => putLigatureIn(one, components, ligature));
    if (made) this.say(`${components.join(" ")} now draws as ${ligature}.`, "success");
    else this.say(`Could not make a ligature of ${components.join(" ")}.`, "error");
    return made;
  }

  /** Take a ligature out, leaving the drawing it used behind. */
  removeLigature(components: string[]): boolean {
    const gone = this.editFont("Remove a ligature", (one) => takeLigatureOut(one, components));
    if (gone) {
      this.say(
        `${components.join(" ")} draws as separate letters again. The drawing is still in the font.`,
        "success",
      );
    }
    return gone;
  }

  /** Put one letter's second drawing under a tag a reader can switch on. */
  addToSet(tag: string, label: string, plain: string, alternate: string): boolean {
    const made = this.editFont("Add to a set", (one) =>
      putInSet(one, tag, label, plain, alternate),
    );
    if (made) this.say(`${alternate} is now ${plain} under ${tag}.`, "success");
    else this.say(`Could not put ${plain} into ${tag}.`, "error");
    return made;
  }

  /** Take one letter out of a set, and the set with it if it was the last. */
  removeFromSet(tag: string, plain: string): boolean {
    return this.editFont("Remove from a set", (one) => takeOutOfSet(one, tag, plain));
  }

  /**
   * Which characters a letter answers to.
   *
   * Refused rather than merged when another letter already claims one: two
   * glyphs on the same codepoint is a font where one of them can never be
   * typed, and which one wins is decided by the order they happen to sit in.
   */
  setCodepoints(name: string, unicodes: number[]): boolean {
    const typeface = this.state.typeface;
    const glyph = this.glyph(name);
    if (!typeface || !glyph) return false;

    for (const codepoint of unicodes) {
      const holder = claimedBy(typeface, codepoint, name);
      if (holder) {
        this.say(`${holder} already answers to that character.`, "error");
        return false;
      }
    }
    const wanted = [...new Set(unicodes)].sort((one, other) => one - other);
    if (wanted.join() === [...glyph.unicodes].sort((one, other) => one - other).join())
      return false;

    this.editGlyph(name, "Set the character", (one) => {
      one.unicodes = wanted;
    });
    return true;
  }

  /*
   * Carrying a drawing from one letter to another.
   *
   * There was no clipboard of any kind, which meant an `m` could not be
   * started from an `n` -- and starting an `m` from an `n` is how an `m` is
   * started. The whole argument for a type family is that the letters share
   * their parts, and every one of those parts had to be drawn again by hand.
   *
   * Kept here rather than in the system clipboard, and that is a decision
   * rather than a shortcut: the system one holds text, and putting outlines
   * through it means inventing a serialisation, asking for a permission the
   * browser may refuse, and handling whatever somebody happens to have copied
   * from somewhere else. What this is for is one letter to another inside one
   * font, and for that a variable is the whole of it.
   */
  private carried: Contour[] = [];

  /** Take a copy of what is picked, or of the whole letter when nothing is. */
  copyOutlines(glyphName: string): number {
    const glyph = this.glyph(glyphName);
    if (!glyph || glyph.contours.length === 0) return 0;

    const picked = this.state.selectedNodes;
    const wanted =
      picked.size === 0
        ? glyph.contours
        : glyph.contours.filter((contour, index) =>
            contour.nodes.every((_, node) => picked.has(nodeKey({ contour: index, node }))),
          );
    if (wanted.length === 0) {
      this.say("Pick whole paths to copy, or none to copy the letter.", "error");
      return 0;
    }

    // Copied deeply, because the letter it came from goes on being edited and
    // a shared node would follow it.
    this.carried = wanted.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        point: { ...node.point },
        handleIn: node.handleIn ? { ...node.handleIn } : null,
        handleOut: node.handleOut ? { ...node.handleOut } : null,
        type: node.type,
      })),
    }));
    this.say(
      `Copied ${this.carried.length} path${this.carried.length === 1 ? "" : "s"}.`,
      "success",
    );
    return this.carried.length;
  }

  /** Whether there is anything to paste. */
  get carrying(): number {
    return this.carried.length;
  }

  /**
   * Put what was copied into a letter, alongside what is already there.
   *
   * Added rather than replacing, because that is what somebody starting an `m`
   * from an `n` wants: the shoulder arrives beside the stems rather than
   * instead of them. Deleting the letter first is one key away for the times
   * it is not.
   */
  pasteOutlines(glyphName: string): boolean {
    const glyph = this.glyph(glyphName);
    if (!glyph || this.carried.length === 0) return false;

    const arriving = this.carried.map((contour) => ({
      ...contour,
      nodes: contour.nodes.map((node) => ({
        point: { ...node.point },
        handleIn: node.handleIn ? { ...node.handleIn } : null,
        handleOut: node.handleOut ? { ...node.handleOut } : null,
        type: node.type,
      })),
    }));
    const from = glyph.contours.length;

    this.editGlyph(glyphName, "Paste paths", (one) => {
      one.contours = [...one.contours, ...arriving];
    });
    // Left picked, because what arrives is almost always in the wrong place
    // and moving it is the next thing that happens.
    const keys: string[] = [];
    arriving.forEach((contour, index) => {
      contour.nodes.forEach((_, node) => {
        keys.push(nodeKey({ contour: from + index, node }));
      });
    });
    this.set({ selectedNodes: new Set(keys) });
    this.say(`Pasted ${arriving.length} path${arriving.length === 1 ? "" : "s"}.`, "success");
    return true;
  }

  /*
   * The font's own identity, and the lines it is drawn between.
   *
   * Both of these existed for a long time with nothing calling them, which is
   * how a font opened in this editor kept the name of the file it came from
   * whatever was done to it. Redrawing every letter of DejaVu Sans and
   * exporting gave a file still called DejaVu Sans, still carrying DejaVu's
   * copyright and still naming DejaVu's designer -- which is not a missing
   * field, it is a derivative work that does not say so.
   *
   * They push an edit each, because a name is an edit. Committed rather than
   * typed: a field that pushed on every keystroke would put nineteen entries
   * on the stack for one family name, and undo would walk back through the
   * spelling of it.
   */
  setMeta(partial: Partial<Typeface["meta"]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = { ...typeface.meta };
    const after = { ...typeface.meta, ...partial };
    if (
      Object.keys(partial).every(
        (key) => before[key as keyof typeof before] === after[key as keyof typeof after],
      )
    ) {
      return;
    }
    typeface.meta = after;
    this.push({
      label: "Change the font's details",
      undo: () => {
        typeface.meta = { ...before };
      },
      redo: () => {
        typeface.meta = { ...after };
      },
    });
    this.touch();
  }

  setMetrics(partial: Partial<Typeface["metrics"]>): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const before = { ...typeface.metrics };
    const after = { ...typeface.metrics, ...partial };
    if (
      Object.keys(partial).every(
        (key) => before[key as keyof typeof before] === after[key as keyof typeof after],
      )
    ) {
      return;
    }
    typeface.metrics = after;
    this.push({
      label: "Change the font's lines",
      undo: () => {
        typeface.metrics = { ...before };
      },
      redo: () => {
        typeface.metrics = { ...after };
      },
    });
    this.touch();
  }
}

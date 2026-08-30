/**
 * What a letter is, and what can be done to the letter rather than to its
 * drawing.
 *
 * Its name, the characters it answers to, and the four operations that make
 * and unmake it. None of this existed: a font opened here could have its
 * letters redrawn and nothing else -- no letter could be added, taken out,
 * renamed, or told which character it is. A glyph's codepoints were shown in a
 * grid cell's hover text and used by the search box, and were otherwise
 * unreachable.
 *
 * Above the panels that act on the drawing, because it is a level up from
 * them: those change what the letter looks like, these change whether it is
 * there and what it is called.
 */

import * as React from "react";

import { freeNameNear } from "@/font/library";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

const ACTION = cn(
  "rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors",
  "hover:border-accent hover:text-foreground disabled:opacity-40 disabled:hover:border-border",
);

/**
 * Codepoints as somebody would write them, and back again.
 *
 * Two forms, and no third: `U+0041`, which is how a font's documentation
 * writes a character and how somebody looking one up will have it on the
 * clipboard, or the character itself.
 *
 * Bare hex was accepted at first and had to go, because `A` is valid hex. A
 * person typing `A` into a field labelled Character means the letter A, and
 * read as hex it is U+000A, a line feed -- a letter put on a different
 * character entirely, silently, by the one input most likely to be typed. The
 * ambiguity cannot be resolved by guessing which was meant, so it is not
 * guessed at: `U+` says hex, and anything else is taken at face value.
 */
const asText = (unicodes: number[]): string =>
  unicodes.map((one) => `U+${one.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");

export function parseCodepoints(text: string): number[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const part of parts) {
    if (/^[Uu]\+[0-9a-fA-F]{1,6}$/.test(part)) {
      const value = Number.parseInt(part.slice(2), 16);
      if (value > 0x10ffff) return null;
      out.push(value);
      continue;
    }
    // One character, counted in code points rather than in units, so an emoji
    // written as a surrogate pair is the one character it looks like.
    const characters = [...part];
    if (characters.length !== 1) return null;
    out.push(characters[0].codePointAt(0)!);
  }
  return out;
}

export function LetterPanel(): React.JSX.Element | null {
  const state = useAppState();
  const glyph = state.selectedGlyph ? store.glyph(state.selectedGlyph) : null;

  /*
   * The two fields hold what is being typed, and take what the letter says
   * only when the letter changes underneath them.
   *
   * The first version resynced whenever the glyph did, with `glyph.unicodes`
   * in the dependency list -- an array, whose identity changes every time the
   * store replaces the glyph, which several operations here do. So a store
   * update landing mid-edit put the old name back into the field while
   * somebody was typing in it, and the rename that followed on blur was a
   * rename to the name it already had. Keyed on which letter this is instead,
   * which is the only thing that should ever overwrite what somebody typed.
   */
  const [name, setName] = React.useState("");
  const [codes, setCodes] = React.useState("");
  const showing = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (showing.current === (glyph?.name ?? null)) return;
    showing.current = glyph?.name ?? null;
    setName(glyph?.name ?? "");
    setCodes(glyph ? asText(glyph.unicodes) : "");
  }, [glyph?.name, glyph]);

  if (!glyph) return null;
  const letter = glyph.name;

  const commitCodes = (): void => {
    const parsed = parseCodepoints(codes);
    if (parsed === null) {
      store.say("Write the character itself, or as U+0041. Several go separated by spaces.", "error");
      setCodes(asText(glyph.unicodes));
      return;
    }
    if (!store.setCodepoints(letter, parsed)) setCodes(asText(glyph.unicodes));
  };

  return (
    <section className="border-b border-border p-3" data-letter-panel>
      <h3 className="pb-2 text-2xs font-medium">This letter</h3>

      <label className="flex flex-col gap-1 pb-2">
        <span className="text-2xs text-muted-foreground">Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name !== letter && !store.renameGlyph(letter, name)) setName(letter);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setName(letter);
          }}
          aria-label="Letter name"
          className="h-7 rounded border border-input bg-card px-2 font-mono text-2xs outline-none focus-visible:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1 pb-2">
        <span className="text-2xs text-muted-foreground">Character</span>
        <input
          value={codes}
          onChange={(event) => setCodes(event.target.value)}
          onBlur={commitCodes}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setCodes(asText(glyph.unicodes));
          }}
          placeholder="A or U+0041"
          aria-label="Characters this letter answers to"
          className="h-7 rounded border border-input bg-card px-2 font-mono text-2xs outline-none focus-visible:border-accent"
        />
      </label>

      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => store.duplicateGlyph(letter)} className={ACTION}
          title="A copy of this letter under a new name. The copy answers to no character until you give it one.">
          Duplicate
        </button>
        <button type="button" onClick={() => state.typeface && store.addGlyph(freeNameNear(state.typeface, "newGlyph"))} className={ACTION}
          title="A new, empty letter. Give it a name and a character, then draw in it.">
          New letter
        </button>
        {/*
          Deleting says what goes with it rather than asking first. Undo is one
          key away and holds the whole change -- the letter, the kern pairs,
          the class memberships and the components of everything built on it --
          which is a better answer than a dialog nobody reads.
        */}
        <button type="button" onClick={() => store.removeGlyph(letter)} className={ACTION}
          title="Take this letter out of the font, along with its kerning and its place in anything built on it. Undo puts all of it back.">
          Delete
        </button>
      </div>
    </section>
  );
}

/**
 * The letters this font draws for more than one character.
 *
 * There was no way to make one. A person could draw `f_i`, name it by the
 * convention every font tool follows, watch it appear in the grid, and export
 * it -- and no reader would ever see it, because nothing wrote the rule that
 * selects it. The drawing was in the file and unreachable.
 *
 * Two things are offered rather than asked for, because both are already
 * written down somewhere and making somebody type them again is making them do
 * the font's bookkeeping:
 *
 *   - the standard ligatures, filtered to the ones whose letters this font
 *     actually has, so `ffl` is not offered to a face with no `l`
 *   - the stylistic sets the glyph names are already asking for -- `a.ss01`
 *     says what it is, and a person who has drawn twenty of them wants them
 *     switched on, not re-entered one at a time
 *
 * Under Build, beside how a letter is put together, because that is what this
 * is: not how a letter looks, but what the font does with it.
 */

import * as React from "react";

import {
  drawingFor,
  labelFor,
  suggestedLigatures,
  suggestedSets,
  unreachableGlyphs,
} from "@/font/features";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

const ROW = cn(
  "flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5",
);

const SMALL = cn(
  "rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground",
  "transition-colors hover:border-accent hover:text-foreground",
);

export function FeaturesPanel(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;
  const [joining, setJoining] = React.useState("");

  if (!typeface) return <></>;

  const ligatures = typeface.ligatures ?? [];
  const sets = typeface.sets ?? [];
  const offered = suggestedLigatures(typeface);
  const waiting = suggestedSets(typeface);
  const unreachable = unreachableGlyphs(typeface);

  /*
   * One press makes the whole thing: the drawing if it is not there, and the
   * rule either way. Splitting it in two -- make the glyph, then come back and
   * wire it up -- is the split that leaves people with unreachable drawings,
   * which is the fault this panel exists to close.
   */
  const make = (components: string[]): void => {
    const drawing = drawingFor(typeface, components);
    if (!typeface.glyphIndex.has(drawing)) {
      if (!store.addGlyph(drawing)) return;
    }
    store.addLigature(components, drawing);
  };

  const joinTyped = (): void => {
    const components = joining
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (components.length < 2) {
      store.say(
        "A ligature joins two letters or more. Write their names with spaces between.",
        "error",
      );
      return;
    }
    const missing = components.filter((one) => !typeface.glyphIndex.has(one));
    if (missing.length > 0) {
      store.say(`This font has no ${missing.join(", ")}.`, "error");
      return;
    }
    make(components);
    setJoining("");
  };

  return (
    <div className="flex flex-col gap-4" data-features-panel>
      <section>
        <Heading>Ligatures</Heading>
        <p className="pb-2 text-2xs leading-relaxed text-muted-foreground">
          Letters a reader types separately and the font draws as one. On by default, which is the
          point of them.
        </p>

        {ligatures.length === 0 ? (
          <p className="pb-2 text-2xs text-muted-foreground">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 pb-2">
            {ligatures.map((one) => (
              <li key={one.ligature} className={ROW} data-ligature={one.ligature}>
                <span className="min-w-0 truncate font-mono text-2xs text-foreground">
                  {one.components.join(" ")} → {one.ligature}
                </span>
                <button
                  type="button"
                  className={SMALL}
                  title={`Stop drawing ${one.components.join(" ")} as one. The drawing stays in the font.`}
                  onClick={() => store.removeLigature(one.components)}
                >
                  Undo
                </button>
              </li>
            ))}
          </ul>
        )}

        {offered.length > 0 && (
          <>
            <div className="pb-1 text-2xs text-muted-foreground">
              This font has the letters for these
            </div>
            <div className="flex flex-wrap gap-1 pb-2">
              {offered.map((one) => (
                <button
                  key={one.drawing}
                  type="button"
                  className={SMALL}
                  data-make-ligature={one.drawing}
                  title={
                    one.drawn
                      ? `Draw ${one.components.join(" ")} as the ${one.drawing} already in this font.`
                      : `Make ${one.drawing} and draw ${one.components.join(" ")} as it.`
                  }
                  onClick={() => make(one.components)}
                >
                  <span className="font-mono">{one.components.join("")}</span>
                  {!one.drawn && <span className="pl-1 text-[10px] opacity-60">new</span>}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex gap-1">
          <input
            value={joining}
            onChange={(event) => setJoining(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") joinTyped();
            }}
            placeholder="s t"
            aria-label="Letters to join"
            className="h-7 min-w-0 flex-1 rounded border border-input bg-card px-2 font-mono text-2xs outline-none focus-visible:border-accent"
          />
          <button type="button" onClick={joinTyped} className={SMALL}>
            Join
          </button>
        </div>
      </section>

      <section>
        <Heading>Stylistic sets</Heading>
        <p className="pb-2 text-2xs leading-relaxed text-muted-foreground">
          Second drawings a reader switches on by name — a single-storey a, old figures. Off unless
          asked for, which is what makes them a choice rather than the face.
        </p>

        {sets.length === 0 ? (
          <p className="pb-2 text-2xs text-muted-foreground">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 pb-2">
            {sets.map((set) => (
              <li key={set.tag} className="rounded-md border border-border p-2" data-set={set.tag}>
                <div className="flex items-baseline justify-between gap-2 pb-1">
                  <span className="font-mono text-2xs text-foreground">{set.tag}</span>
                  <span className="truncate text-2xs text-muted-foreground">{set.label}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {set.swaps.map((swap) => (
                    <button
                      key={swap.plain}
                      type="button"
                      className={cn(SMALL, "font-mono")}
                      title={`Take ${swap.plain} out of ${set.tag}. The drawing stays in the font.`}
                      onClick={() => store.removeFromSet(set.tag, swap.plain)}
                    >
                      {swap.plain} → {swap.alternate} ×
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {[...waiting.entries()].map(([tag, swaps]) => (
          <button
            key={tag}
            type="button"
            data-wire-set={tag}
            onClick={() => {
              for (const one of swaps) store.addToSet(tag, labelFor(tag), one.plain, one.alternate);
            }}
            className={cn(
              "w-full rounded-md border border-border px-2 py-1.5 text-left text-2xs",
              "text-muted-foreground transition-colors hover:border-accent hover:text-foreground",
            )}
          >
            Switch on {swaps.length} {swaps.length === 1 ? "letter" : "letters"} named{" "}
            <span className="font-mono">.{tag}</span>
            <span className="block pt-0.5 opacity-70">{labelFor(tag)}</span>
          </button>
        ))}
      </section>

      {/*
        The count, where the thing that fixes it is. The checks page says the
        same and is a page away; this is the panel somebody is already standing
        in when they have just drawn something nothing can reach.
      */}
      {unreachable.length > 0 && (
        <p className="text-2xs leading-relaxed text-muted-foreground">
          <span className="text-[color:var(--attention)]">
            {unreachable.length} {unreachable.length === 1 ? "letter is" : "letters are"} drawn and
            unreachable
          </span>{" "}
          — no character types {unreachable.length === 1 ? "it" : "them"} and no rule brings{" "}
          {unreachable.length === 1 ? "it" : "them"} in:{" "}
          <span className="font-mono">{unreachable.slice(0, 6).join(", ")}</span>
          {unreachable.length > 6 && `, and ${unreachable.length - 6} more`}.
        </p>
      )}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className="pb-1.5 text-2xs font-medium text-foreground">{children}</h3>;
}

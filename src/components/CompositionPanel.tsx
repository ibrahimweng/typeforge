/**
 * How a letter is put together: the parts it is made from, and the points other
 * glyphs attach to.
 *
 * This is where the saving in a large character set comes from. `á` is not a
 * drawing but an arrangement, so correcting the `a` corrects every accented
 * form of it at once, and the panel says how many that is before you start.
 */

import * as React from "react";

import { pulse } from "@/anim/motion";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

export function CompositionPanel(): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;
  const glyph = store.glyph(state.selectedGlyph);
  const [note, setNote] = React.useState<string | null>(null);
  const noteRef = React.useRef<HTMLParagraphElement>(null);

  React.useEffect(() => {
    if (note && noteRef.current) pulse(noteRef.current);
  }, [note]);

  if (!typeface) return <></>;

  const dependents = glyph ? store.dependents(glyph.name) : [];
  const buildable = typeface.glyphs.filter((g) => g.components.length > 0).length;

  return (
    <div className="flex flex-col gap-4">
      {glyph ? (
        <>
          <section>
            <Heading>Built from</Heading>
            {glyph.components.length === 0 ? (
              <p className="text-2xs leading-snug text-muted-foreground">
                {glyph.name} is drawn directly. Accented letters are usually built from a letter
                and a mark instead, so a correction to the letter reaches all of them.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {glyph.components.map((component, position) => (
                  <li
                    key={`${component.glyphName}-${position}`}
                    className="flex items-center gap-2 rounded border border-border bg-card/40 px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => store.selectGlyph(component.glyphName, { open: true })}
                      className="min-w-0 flex-1 truncate text-left font-mono text-2xs text-foreground hover:text-accent"
                      title={`Open ${component.glyphName}`}
                    >
                      {component.glyphName}
                    </button>
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      {Math.round(component.transform.dx)}, {Math.round(component.transform.dy)}
                    </span>
                    <button
                      type="button"
                      onClick={() => store.removeComponent(glyph.name, position)}
                      className="shrink-0 text-2xs text-muted-foreground hover:text-destructive"
                      title="Remove this part"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <Heading>Anchors</Heading>
            {glyph.anchors.length === 0 ? (
              <p className="pb-1.5 text-2xs leading-snug text-muted-foreground">
                None yet. A letter carries <code className="font-mono">top</code> where an accent
                sits; a mark carries <code className="font-mono">_top</code> where it attaches.
              </p>
            ) : (
              <ul className="flex flex-col gap-1 pb-1.5">
                {glyph.anchors.map((anchor) => (
                  <li
                    key={anchor.name}
                    className="flex items-center gap-2 rounded border border-border bg-card/40 px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs text-[var(--inspect)]">
                      {anchor.name}
                    </span>
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      {anchor.x}, {anchor.y}
                    </span>
                    <button
                      type="button"
                      onClick={() => store.removeAnchor(glyph.name, anchor.name)}
                      className="shrink-0 text-2xs text-muted-foreground hover:text-destructive"
                      title="Remove this anchor"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Action
              onClick={() => {
                store.suggestAnchorsFor(glyph.name);
                setNote(`Placed anchors on ${glyph.name}. Drag them in the editor.`);
              }}
            >
              Suggest anchors for {glyph.name}
            </Action>
          </section>

          {dependents.length > 0 && (
            <section>
              <Heading>Used by</Heading>
              <p className="pb-1.5 text-2xs leading-snug text-muted-foreground">
                {dependents.length} glyph{dependents.length === 1 ? "" : "s"} are built from{" "}
                {glyph.name}. Editing it changes all of them.
              </p>
              <div className="flex flex-wrap gap-1">
                {dependents.slice(0, 24).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => store.selectGlyph(name, { open: true })}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
                  >
                    {name}
                  </button>
                ))}
                {dependents.length > 24 && (
                  <span className="px-1 py-0.5 text-2xs text-muted-foreground">
                    and {dependents.length - 24} more
                  </span>
                )}
              </div>
            </section>
          )}
        </>
      ) : (
        <p className="text-2xs text-muted-foreground">Choose a glyph to see how it is built.</p>
      )}

      <section className="border-t border-border pt-3">
        <Heading>Whole font</Heading>
        <p className="pb-2 text-2xs leading-snug text-muted-foreground">
          {buildable.toLocaleString()} of {typeface.glyphs.length.toLocaleString()} glyphs are
          built from parts.
        </p>
        <div className="flex flex-col gap-1.5">
          <Action
            onClick={() => {
              const { bases, marks } = store.deriveAnchorsFromFont();
              setNote(
                bases + marks === 0
                  ? "No composites to read anchor positions from."
                  : `Read anchors from ${bases} letters and ${marks} marks.`,
              );
            }}
          >
            Read anchors from the font
          </Action>
          <Action
            onClick={() => {
              const { built, skipped } = store.buildAccentedGlyphs();
              setNote(
                built.length === 0
                  ? `Nothing to build. ${skipped} accented glyphs were already there.`
                  : `Built ${built.length} accented glyphs, leaving ${skipped} that already existed.`,
              );
            }}
          >
            Build accented glyphs
          </Action>
        </div>
        {note && (
          <p ref={noteRef} className="pt-2 text-2xs leading-snug text-accent">
            {note}
          </p>
        )}
      </section>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h3 className="pb-1.5 text-2xs font-medium text-foreground">{children}</h3>;
}

function Action({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-md border border-border px-2 py-1.5 text-2xs text-muted-foreground",
        "transition-colors hover:border-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

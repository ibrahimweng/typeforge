/**
 * The help reference.
 *
 * A drawer over the inspector rather than a page of its own, because most of
 * what needs explaining here is a control, and a control is far easier to
 * understand while you can still see it move. Reading what the shoulder slider
 * does with the letters hidden behind a full-screen panel would be the one
 * arrangement that fails at the only job this has.
 *
 * The parameter section is generated from the same list the inspector draws its
 * sliders from, so it cannot come to describe a control that is no longer
 * there.
 */

import * as React from "react";

import { PARAM_GROUPS, PARAMS } from "@/components/param-specs";
import { OUTLINE_ACTION } from "@/components/controls";
import { forgetTips, seenTipCount, subscribeToTips } from "@/help/tips";

const VIEWS: Array<[string, string]> = [
  ["Font", "Every glyph in the file. Search by letter, by name or by U+ code; select several to change them at once."],
  ["Glyph", "One letter, up close. Drag points and handles, or draw new ones with the pen."],
  ["Kerning", "The space between particular pairs. Click a gap and drag."],
  ["Spacing", "The space either side of every letter, as a table you can read down."],
  ["Checks", "What is wrong with the font before anyone else finds out."],
];

const SHORTCUTS: Array<[string, string]> = [
  ["V", "Select tool"],
  ["P", "Pen tool"],
  ["⌘Z", "Undo"],
  ["⇧⌘Z", "Redo"],
  ["Esc", "Close a dialog"],
];

export function HelpDrawer({ onClose }: { onClose: () => void }): React.JSX.Element {
  const dismissed = React.useSyncExternalStore(subscribeToTips, seenTipCount, () => 0);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-label="Help"
      className="toolcraft-panel-surface flex w-96 shrink-0 flex-col border-l border-border"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-xs-plus font-medium">How Typeforge works</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          className="rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="toolcraft-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <Section title="What this is">
          <p>
            Typeforge opens a font, lets you reshape it, and writes a valid TrueType or OpenType
            file back out. Nothing you change is baked in: the parameters sit on top of the drawn
            outlines and are re-evaluated on every render, so any of them can go back to where it
            started at any time.
          </p>
        </Section>

        <Section title="The two ways to change a whole family">
          <p>
            <Term>Parameters.</Term> Move a slider and every glyph follows. This is the direct
            route, and the one to use when you know what you want — half a unit more weight, five
            degrees of slant.
          </p>
          <p>
            <Term>Control letters.</Term> Edit one of n, o, H, O, 0, 1 or 3 by hand and Typeforge
            measures what you did to it — heavier, wider, taller, a more open counter — and applies
            the same to the rest of the alphabet. This is the route to use when you would rather
            draw the answer than name it. Type designers work from these letters for the same
            reason: get n and o right and most of the lowercase follows.
          </p>
        </Section>

        <Section title="The views">
          <dl className="space-y-2">
            {VIEWS.map(([name, what]) => (
              <div key={name}>
                <dt className="text-2xs font-medium text-foreground">{name}</dt>
                <dd className="text-2xs leading-snug text-muted-foreground">{what}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {PARAM_GROUPS.map((group) => (
          <Section key={group.title} title={group.title}>
            <p>{group.blurb}</p>
            <dl className="space-y-2">
              {group.keys.map((key) => {
                const spec = PARAMS.find((param) => param.key === key);
                if (!spec) return null;
                return (
                  <div key={String(key)}>
                    <dt className="text-2xs font-medium text-foreground">{spec.label}</dt>
                    <dd className="text-2xs leading-snug text-muted-foreground">{spec.hint}</dd>
                  </div>
                );
              })}
            </dl>
          </Section>
        ))}

        <Section title="Why a slider sometimes stops">
          <p>
            Every letter has a limit. Thin a stroke past half its own width and its two sides pass
            through each other; embolden past the white space beside it and the gap closes and turns
            inside out. Typeforge stops each point short of that, so a stroke that has run out of
            room stays a hairline instead of disappearing, and a letter that cannot take any more
            weight simply stops taking it. If one letter appears to stop growing before the others,
            that is the reason, and it is doing what it should.
          </p>
        </Section>

        <Section title="Getting it back out">
          <p>
            <Term>Preserve</Term> keeps everything the font you opened was carrying — its name
            table, its layout features, everything Typeforge does not edit — and swaps in your
            outlines. <Term>Rebuild</Term> writes a clean file from what is on screen and nothing
            else. Preserve is only available for TrueType out of a TrueType source; OpenType is
            always a rebuild, because the curves have to be re-encoded.
          </p>
        </Section>

        <Section title="Keyboard">
          <dl className="space-y-1">
            {SHORTCUTS.map(([key, what]) => (
              <div key={key} className="flex items-baseline gap-3">
                <dt className="w-14 shrink-0 font-mono text-2xs text-foreground">{key}</dt>
                <dd className="text-2xs text-muted-foreground">{what}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <div className="border-t border-border pt-4">
          <button type="button" onClick={forgetTips} disabled={dismissed === 0} className={OUTLINE_ACTION}>
            Show the tips again
          </button>
          <p className="pt-2 text-2xs text-muted-foreground">
            {dismissed === 0
              ? "No tips dismissed yet."
              : `${dismissed} dismissed. This brings them all back.`}
          </p>
        </div>
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-2 text-2xs leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/** A term being defined, rather than merely emphasised. */
function Term({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="font-medium text-foreground">{children}</span>;
}

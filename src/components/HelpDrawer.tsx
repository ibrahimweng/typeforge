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
import { METRIC_CONTROLS, PART_SPECS, PEN_CONTROLS } from "@/forge/parts";
import { FAMILIES, type Family } from "@/forge/style";
import { forgetTips, seenTipCount, subscribeToTips } from "@/help/tips";

const VIEWS: Array<[string, string]> = [
  ["Font", "Every glyph in the file. Search by letter, by name or by U+ code; select several to change them at once."],
  ["Glyph", "One letter, up close. Drag points and handles, or draw new ones with the pen."],
  ["Kerning", "The space between particular pairs. Click a gap and drag."],
  ["Spacing", "The space either side of every letter, as a table you can read down."],
  ["Checks", "What is wrong with the font before anyone else finds out."],
];

/*
 * Which controls carry the differences inside a family.
 *
 * The family hints in style.ts say what a family is; this says where to pull to
 * move between the faces within one, because "a serif" and "which three numbers
 * make a slab a didone" are different questions and only the second one tells
 * you what to touch.
 */
const FAMILY_CONTROLS: Record<Family, string> = {
  sans: "Move within it with bowl squareness, aperture, shoulder springing and the pen's contrast: a grotesque is a tighter, squarer, more even sans, a geometric a rounder and wider one.",
  serif: "Move within it with serif reach, depth and bracket, and with contrast. A slab is a thick serif barely bracketed; a didone is a thin one on a high-contrast pen; an old-style sits between them with the bracket up.",
  display:
    "Move within it with weight past what text would take, then with the parts a text face leaves off -- wave depth and wavelength, flare spread and hollow, ball size and overhang.",
  hand: "Move within it with pen angle, contrast and slant. Those three say which tool is being remembered; the terminal cut says how it was lifted off the paper.",
};

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
          <Section key={group.title} title={group.title} half="imported">
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

        <Section title="Drawing a font from nothing" half="drawn">
          <p>
            <Term>Draw a font</Term> is the other half. There is no font to open: a letter is
            described by where its strokes run and how wide the pen is, and the outline is worked
            out from that description every time it is needed. Nothing is traced from anything, so
            what comes out is yours to use without crediting anyone.
          </p>
          <p>
            That is also why nothing here can be spoilt by turning a control up. Weight is an input
            to the drawing rather than a shove applied to a finished outline: ask for a heavier cut
            and the letter is drawn again, thicker. One rule holds everywhere -- a stroke never
            turns tighter than half its own width, and no shape is smaller than the pen drawing it.
            Where a setting asks for less, the letter grows instead of closing up.
          </p>
          <p>
            <Term>Every edit reaches the whole font.</Term> Draw the serif you want on a p and what
            you changed is the serif, so every letter that wears one wears the new one. A letter
            told to keep its own version says so, and it is the only one that does. The one
            exception is the shape of a letter: choosing a two-storey a says nothing about the g.
          </p>
        </Section>

        <Section title="The families of type" half="drawn">
          <p>
            Every base belongs to one of four families, and the gallery is grouped by them. A family
            is not a lock: it says which handful of controls carries most of the difference between
            the faces inside it, so you know where to start pulling.
          </p>
          <dl className="space-y-2">
            {FAMILIES.map((family) => (
              <div key={family.id}>
                <dt className="text-2xs font-medium text-foreground">{family.label}</dt>
                <dd className="text-2xs leading-snug text-muted-foreground">
                  {family.hint} {FAMILY_CONTROLS[family.id]}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Nothing stops you crossing them. Serifs are a toggle, so a sans is a serif with the bar
            switched off; the wave, the flare and the ball are parts like any other, and turning one
            on inside a text face is how most display faces started.
          </p>
        </Section>

        <Section title="The pen and the proportions" half="drawn">
          <dl className="space-y-2">
            {[...PEN_CONTROLS, ...METRIC_CONTROLS].map((control) => (
              <div key={control.key}>
                <dt className="text-2xs font-medium text-foreground">{control.label}</dt>
                <dd className="text-2xs leading-snug text-muted-foreground">{control.hint}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {PART_SPECS.map((spec) => (
          <Section key={spec.name} title={spec.label} half="drawn">
            <p>{spec.hint}</p>
            <dl className="space-y-2">
              {spec.controls.map((control) => (
                <div key={control.key}>
                  <dt className="text-2xs font-medium text-foreground">{control.label}</dt>
                  <dd className="text-2xs leading-snug text-muted-foreground">{control.hint}</dd>
                </div>
              ))}
            </dl>
          </Section>
        ))}

        <Section title="Drawing one letter yourself" half="drawn">
          <p>
            Some letter will not come out of a skeleton and a pen. Every font
            has one -- an ampersand, a g, a piece of lettering that is the
            reason you started -- and no arrangement of sliders reaches it. So
            any letter can leave as an SVG, be drawn in whatever tool you draw
            best in, and come back into the space it left.
          </p>
          <p>
            The sheet carries the metrics as guides: the baseline, the
            x-height, the cap height, the two sidebearings. They are there to
            draw against and are ignored on the way back, so you can move them,
            hide them or delete them without changing what returns. Everything
            is in font units, so a coordinate that leaves is the coordinate
            that arrives.
          </p>
          <p>
            <Term>The letter keeps its advance.</Term> A drawing narrower than
            what it replaces still sits in the same width, because the rhythm
            of a font is not one letter's decision. Drop a sheet onto a
            different letter than it was drawn for and it goes where you
            dropped it, and says so.
          </p>
          <p>
            What it costs is worth knowing before you spend it. A letter that
            came in from outside is an outline rather than a description, so
            nothing in the panel reaches it any more -- there is no pen behind
            it to make heavier. It is marked in the alphabet, and one button
            hands it back to the family, which draws it again from the
            description it never stopped having.
          </p>
        </Section>

        <Section title="Assembling a font from artwork" half="assembled">
          <p>
            The third thing this does, and it starts from neither a font nor a
            description. <Term>Assemble</Term> takes a pile of SVG drawings --
            lettering, a logo alphabet, whatever was drawn wherever you draw --
            and makes a font of them. Nothing is redrawn: the outlines that come
            out are the outlines that went in.
          </p>
          <p>
            What it supplies is everything artwork does not have. Which drawing
            is which character, taken from the file names and shown so it can be
            corrected. How big the letters are relative to each other. Where the
            baseline is. How much white goes either side of each one, and which
            pairs need pulling together.
          </p>
          <p>
            <Term>The letters tell it where they belong.</Term> An H is as tall
            as the caps are, an x is as tall as the lowercase is, a p hangs by
            the descender: measure the ones whose height is known and the scale
            and the baseline fall out. The ones that settle nothing -- a t stops
            somewhere between two lines, an i is mostly its dot -- are placed by
            what the others worked out, and marked, so you know which to look at
            twice.
          </p>
          <p>
            <Term>Spacing is measured by eye, not by box.</Term> Twenty-six
            letters given the same white either side read as a ransom note,
            because an H fills its box and an A does not. So each letter's
            silhouette is sampled down its height and the sidebearing is
            whatever makes the white come out even. A flat-sided letter gets the
            full measure, a round one a little less, an A much less.
          </p>
          <p>
            <Term>Kerning is measured where two letters come closest.</Term>
            Which is why two round letters come out untouched -- they are
            already as near each other as anything else is -- and an A beside a
            V comes out pulled well in. The pairs it is weakest on are the ones
            where a letter overhangs rather than leans away, a T beside an o
            being the standing example, and the pair editor is there for exactly
            those.
          </p>
          <p>
            Every number it works out can be overruled, and the measured value
            stays visible beside your version, so nothing is lost by trying
            something.
          </p>
        </Section>

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
  half,
}: {
  title: string;
  children: React.ReactNode;
  /*
   * Which of the three jobs this section is about.
   *
   * All three have a weight, a width and a spacing, and they mean different
   * things: a parameter laid over somebody else's outlines, how wide the pen
   * is, and how much white a measurement asked for. Marking the sections says
   * which is which to anything reading the drawer, and keeps a check that
   * every slider in a panel is explained from being answered by a section
   * about a different job that happens to share a word.
   */
  half?: "imported" | "drawn" | "assembled";
}): React.JSX.Element {
  return (
    <section className="space-y-2" data-help-half={half}>
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

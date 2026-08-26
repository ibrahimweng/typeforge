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
import { CAST_SPECS, CUT_SPECS, METRIC_CONTROLS, PART_SPECS, PEN_CONTROLS } from "@/forge/parts";
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
  script:
    "Move within it with the join: how high it hands over, how far it reaches and how much it swings. Reach is the letter-spacing as well as the shape of the join, because on a joined face they are the same thing. Loop opens the ascenders, and irregularity is how steady the hand is.",
};

const SHORTCUTS: Array<[string, string]> = [
  ["Space", "Quick actions"],
  ["⌘K", "Quick actions, even while typing"],
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
          <p>
            <Term>Double-click any edge of the letter</Term> to find the control behind it without
            knowing what it is called. Press the curve where an arch leaves its stem and you get the
            shoulder; press the side of a stem and you get the weight; press the foot of a serifed l
            and you get the serif. A handle appears where you pressed, the panel scrolls to the row
            that control lives on, and the drag reaches the whole font like every other edit. Which
            control is behind a spot is measured rather than looked up: each candidate is nudged,
            the letter is drawn again, and the one that moves the place you pressed wins -- which is
            also how the handle knows how fast to follow your pointer.
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

        <Section title="Building on a grid" half="drawn">
          <p>
            The third way to make a letter here, and it exists because the
            other two cannot reach a whole family of type. A skeleton and a pen
            give you a letter whose strokes go where a hand would take them;
            cutting takes material out of one. Neither describes a face whose
            letters are assembled out of a handful of shapes repeated on a grid
            -- the kind designed as a system first and an alphabet second,
            where what makes it a typeface is that every letter is made of the
            same few parts.
          </p>
          <p>
            <Term>A cell holds the places ink runs to.</Term> Eight of them:
            the middle of each edge and each corner, which between them cover
            every direction a stroke leaves a square in. Press one to send a
            stroke out through it. Two facing each other are a run straight
            through; two on the same edge are a run along it; anything else
            turns through the middle. Double-click the middle of a cell to fill
            it in outright.
          </p>
          <p>
            It is not a second drawing program, which is the point.{" "}
            <Term>The pen still draws these letters</Term>, so weight,
            contrast, pen angle and terminals all still reach them, the family
            still has every weight, and the cuts still cut them. Turn the
            weight up on a font built from cells and it gets heavier, because
            the cells were never the ink -- they are where the ink runs.
          </p>
          <p>
            Switching it on lays the whole alphabet onto the grid from the
            skeletons this font already has, because a hundred and ninety
            glyphs placed cell by cell is not a workflow anybody finishes. What
            arrives is an approximation and is meant to be: a stem lands on the
            grid exactly, a shoulder lands on the nearest places a stroke is
            allowed to leave a square, and a diagonal is re-routed to run at
            one of the eight angles a grid has. Every cell of it is one press
            to change, and any letter can be laid out again or emptied.
          </p>
        </Section>

        <Section title="Cutting" half="drawn">
          <p>
            Everything above adds ink: a spine is drawn and a pen is swept
            along it. That reaches a great many typefaces and it cannot reach
            the ones whose character is in what has been taken away -- a slot
            through a stem, a saw along an edge, a groove down the middle of
            every stroke, a counter that is a diamond rather than a hole. None
            of those is a shape a pen makes, at any weight or any angle.
          </p>
          <p>
            So the cuts are a second layer, and they run after the first. The
            strokes are swept exactly as they always were, fused into one
            shape, and then material is taken out of that shape.{" "}
            <Term>Every control above still reaches the result:</Term> turn the
            weight up on a face full of slots and the letters are redrawn
            heavier with the same slots cut through them.
          </p>
          <p>
            Sizes are in stem widths rather than in units, for the reason the
            serif learned the hard way: a slot forty units across is a groove
            on a display face and a letter in two halves on a hairline. In
            stems it means the same thing everywhere, so a whole family cut
            from one description stays cut the same way at every weight.
          </p>
          <p>
            A cut can sever a letter, and sometimes that is the point -- a
            stencil face is letters in pieces. The warnings say when it has
            happened and to which letters, so it is a decision rather than a
            surprise.
          </p>
          <p>
            <Term>All three halves of this application cut.</Term> A font you
            opened is cut from its Parameters panel and a pile of drawings from
            its own; the description is the same one, and so is everything
            above about stem widths and about a cut being a decision you can
            take back. What differs is what a cut has to work with. A face
            drawn here knows how thick its stems are, because a pen drew them;
            a font and a pile do not, so it is measured off their own letters
            -- ruled across an I or an l or an H, whichever they have. And two
            of the six are made out of the skeleton a letter was drawn from: an
            outline out of a file has none, so the groove and the break do
            nothing there and say so on the control rather than leaving you to
            work it out from a drawing that did not change.
          </p>
        </Section>

        <Section title="Casting" half="drawn">
          <p>
            The cut layer's other half, pointed the other way. A cut takes ink
            out of the letter after it is drawn; a cast puts ink on. Between
            them they reach the moves that belong to the letter as a whole
            rather than to any stroke in it -- a block shadow thrown off it, a
            rim grown all round it, a point built out of every corner, a join
            filled in.
          </p>
          <p>
            Four operations, each the opposite of one of the cuts.{" "}
            <Term>The shadow</Term> against the slots,{" "}
            <Term>the rim</Term> against the groove,{" "}
            <Term>the points</Term> against the chamfer, and{" "}
            <Term>the fillets</Term> against the break. Sizes are in stem
            widths for the same reason and by the same argument: a shadow forty
            units long is a hint on a display face and a doubling on a
            hairline.
          </p>
          <p>
            <Term>Which layer goes first is yours to say,</Term> because the
            two orders are two different pictures. Cut first and the shadow is
            thrown by the letter as it now is, so a slot through the face shows
            as a slot through the shadow -- an object with a shadow behind it.
            Cast first and the face and its shadow are one block for the cut to
            slice, which can put a band across the shadow where the face has
            none.
          </p>
          <p>
            A cast never changes how much room a letter takes. That is the same
            promise a cut makes and for the same reason: a shadow that respaced
            the font would reflow every word in it the moment you turned the
            slider. Shadows overlap into the letter beside them, which is what
            block-shadow lettering has always done.
          </p>
          <p>
            <Term>The rim closes counters as it opens the outside,</Term> which
            is what growing a shape does rather than a fault to be found later:
            on a light face half a stem of rim will fill the eye of an e. And
            the fillets are the one operation here made out of the skeleton a
            letter was drawn from, so like the groove and the break they do
            nothing to a letter that arrived as an outline, and say so.
          </p>
        </Section>

        {CAST_SPECS.map((spec) => (
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

        {CUT_SPECS.map((spec) => (
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

        <Section title="Where the counter shapes come from" half="drawn">
          <p>
            The shapes a counter can be replaced with are geometric primitives,
            named for what they are: a diamond, a lozenge, a chevron, an
            hourglass, a comb, a nested diamond.{" "}
            <Term>That is a decision, not only a convenience.</Term>
          </p>
          <p>
            Those figures turn up in geometric ornament everywhere there is
            any, and belong exclusively to nobody. The symbol sets a face like
            this is often reached for alongside are not like that.{" "}
            <Term>Adinkra</Term> symbols carry proverbs and concepts, are protected
            as heritage under Ghanaian law, and have been mass-produced abroad
            since the 1990s with nothing going back to the people whose symbols
            they are -- and no international law that would let Ghana stop it.{" "}
            <Term>Bògòlanfini</Term> motifs are read in combination, and
            together give expression to a proverb, a song or an event.{" "}
            <Term>Nsibidi</Term>, <Term>Tifinagh</Term> and the{" "}
            <Term>Ge'ez</Term> script are writing systems; the last two are in
            daily use today. A living alphabet used as a hole in somebody
            else's letter is not a motif.
          </p>
          <p>
            So none of them ships here as a shape to pick off a menu, and this
            tool does not offer a preset with a continent's name on it. What it
            offers is the geometry, and the note that if you are working from a
            particular tradition, the right thing is to go to it directly --
            and, where the work is somebody's rather than everybody's, to name
            them. Esther Mahlangu is the reason Ndebele wall painting is known
            outside South Africa, and hers is the rare case where a tradition's
            geometry travelled with its author's name attached to it. And going
            directly is worth it on the craft alone: Shoowa cut-pile cloth
            builds its patterns by combining a handful of figures, and the
            published analyses draw each design out from its basic motif --
            which is the same move this tool makes with cells and counters,
            done better and centuries earlier.
          </p>
          <p>
            Worth reading, and where these notes come from: Boatema Boateng,{" "}
            <em>The Copyright Thing Doesn't Work Here: Adinkra and Kente Cloth
            and Intellectual Property in Ghana</em> (University of Minnesota
            Press, 2011); J. Janewa OseiTutu, "Harmonizing Cultural IP across
            Borders: Fashionable Bags &amp; Ghanaian Adinkra Symbols"{" "}
            (<em>Akron Law Review</em> 51, 2017); the Metropolitan Museum of
            Art's catalogue entry for a Bamana bògòlanfini, which is where the
            reading of the motifs above comes from; Georges Meurant,{" "}
            <em>Shoowa Design: African Textiles from the Kingdom of Kuba</em>{" "}
            (Thames &amp; Hudson, 1986); and, on Mahlangu, "Esther Mahlangu:
            how the famous South African artist keeps her Ndebele culture
            alive" in <em>The Conversation</em>.
          </p>
        </Section>

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
            the pen and the parts no longer reach it -- there is nothing behind
            it to make heavier. It is marked in the alphabet, and one button
            hands it back to the family, which draws it again from the
            description it never stopped having.
          </p>
          <p>
            <Term>The cuts still reach it.</Term> A slot, a saw, a chamfer and
            a counter shape are taken out of whatever the letter is, so your
            drawing is cut with the rest of the font and at the same heights --
            which is what stops the one letter you drew by hand sitting solid
            in the middle of a striped word. The two made out of the skeleton,
            the inline and the breaks, are the exception: your drawing has no
            skeleton for them to follow, so they leave it alone and the panel
            says so while you are looking at it.
          </p>
          <p>
            What goes out on the sheet is the letter before any of that. Send a
            slotted n out and the slots would arrive as part of the outline,
            and the font would then cut fresh slots through the ones already
            there. The sheet carries the solid letter, so a cut stays a
            description and goes on applying to whatever comes back.
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

        <Section title="The font library" half="library">
          <p>
            Every family in the Google Fonts catalogue, reachable from the
            toolbar in all three modes, and four things to do with one. They are
            four different relationships, and they differ in exactly how much of
            somebody else's typeface you end up carrying — so the library says
            which is which rather than leaving it to be assumed.
          </p>
          <p>
            <Term>Open it.</Term> Everything: outlines, spacing, kerning,
            straight into the editor. Which is fine, because these are fonts
            licensed to be taken and remade.
          </p>
          <p>
            <Term>Show it behind your letters.</Term> Nothing at all. The
            reference sits under the letter you are drawing, at the same body
            size, and is gone the moment you put it down. It is the oldest way
            of learning to draw type: where your bowl is heavier or your
            shoulder springs later stops being a matter of opinion.
          </p>
          <p>
            <Term>Borrow its spacing and kerning.</Term> Numbers about white,
            and nothing drawn. A well-made text face has had months of work put
            into how much room each letter is given and which pairs need
            pulling together, and that work fits around your shapes as well as
            it fitted around theirs. It arrives as an adjustment on top of what
            Assemble measured, so one undo takes it back off.
          </p>
          <p>
            <Term>Start a drawing from it.</Term> Its proportions — how tall the
            lowercase stands against the capitals, how wide the pen was, how
            much thinner the horizontals are, whether the strokes are serifed
            and how far they reach — and then the letters are drawn from that
            description by the same machinery that draws everything else here.
            Not one of its curves comes across. That distinction is worth being
            exact about: proportions are not protected and never have been, and
            they are the reason there are five hundred grotesques that all look
            like each other. Outlines are. So the numbers travel and the shapes
            do not.
          </p>
          <p>
            Everything the library says about a font is measured off its
            outlines rather than read from its name or its metadata — which is
            why it can tell a serif from a sans in a font that ships no glyph
            names, and why it reads the lean of a face that declares itself
            upright and is not.
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
  half?: "imported" | "drawn" | "assembled" | "library";
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

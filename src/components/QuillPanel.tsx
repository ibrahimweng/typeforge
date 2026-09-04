/**
 * The panel for the traced font: read one in, then reshape it.
 *
 * Two halves, and the order is the workflow rather than a grouping. At the top,
 * where the letters came from and what reading them cost -- because a fit is a
 * guess and the panel should say how good a guess before it offers to change
 * anything. Below, the hand: ten controls that reach every letter at once.
 *
 * There is no per-letter scope switch here, and its absence is the point. The
 * forge next door has one because its letters share a description, so an edit
 * has to say whether it means the family or the one letter. Here each letter
 * owns its own strokes already, so the only thing that *can* be shared is the
 * hand -- and the hand is what these controls are.
 */

import * as React from "react";

import { QUILL_CONTROLS, type QuillStyle } from "@/quill/controls";
import { drawTraced, quillStore, useQuill, type Phase } from "@/state/useQuill";
import { OUTLINE_ACTION, segment, SEGMENT_TRACK } from "./controls";
import { SliderControl as Slider } from "@/ui/components/controls/slider";
import { TakeToEditor } from "@/components/TakeToEditor";
import { store } from "@/state/useStore";
import { WIDE_PANEL } from "@/components/controls";
import { cn } from "@/ui/lib/utils";

export function QuillPanel({ onEdit }: { onEdit: () => Promise<void> }): React.JSX.Element {
  const state = useQuill();
  const { document: doc, letter } = state;
  const traced = doc.letters.find((one) => one.glyph.name === letter) ?? doc.letters[0];
  const file = React.useRef<HTMLInputElement>(null);

  /*
   * What the drawing actually promised, read off the letter on screen.
   *
   * Recomputed with the letter and the hand rather than remembered, because it
   * changes with both: a stroke that was exact at one width stops being exact
   * the moment the slant shears its arcs into cubics, and a panel that went on
   * claiming otherwise would be the most misleading thing here.
   */
  const drawn = React.useMemo(
    () => (traced ? drawTraced(traced, doc.style) : null),
    [traced, doc.style, state.revision],
  );

  /*
   * Whether there is an outline behind the redrawing at all.
   *
   * A trace read from a font has one; a trace reopened from a saved project
   * does not, because the file keeps the strokes and leaves the other font's
   * outlines out of it. Asked of the letter on screen rather than of the
   * document, since that is the one the toggle would draw.
   */
  const hasSource = (traced?.source.length ?? 0) > 0;

  return (
    <aside
      aria-label="Quill"
      className={cn(
        WIDE_PANEL,
        "toolcraft-panel-surface flex shrink-0 flex-col border-l border-border",
      )}
    >
      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-border p-3">
          <h3 className="pb-2 text-2xs font-medium">The letters</h3>
          <input
            ref={file}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            className="hidden"
            onChange={async (event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (!chosen) return;
              await quillStore.trace(new Uint8Array(await chosen.arrayBuffer()), chosen.name);
            }}
          />
          <button
            type="button"
            className={cn(OUTLINE_ACTION, "w-full")}
            onClick={() => file.current?.click()}
          >
            {doc.letters.length > 0 ? "Read another font" : "Read a font"}
          </button>

          {state.routed && <WhyHere />}

          {state.progress && <Reading />}

          {state.trouble && (
            <p className="pt-2 text-2xs leading-snug text-[color:var(--destructive,#b4483f)]">
              {state.trouble}
            </p>
          )}

          {doc.letters.length > 0 ? (
            <>
              <label className="block pt-3">
                <span className="text-2xs text-muted-foreground">This font is called</span>
                <input
                  value={doc.name}
                  onChange={(event) => quillStore.setName(event.target.value)}
                  aria-label="Traced font name"
                  data-quill-name
                  className="mt-1 h-8 w-full rounded-md border border-input bg-card px-2.5 text-xs-plus text-foreground outline-none focus-visible:border-accent"
                />
              </label>
              <p className="pt-2 text-2xs leading-snug text-muted-foreground">
                {doc.letters.length} letters from{" "}
                <span className="text-foreground">{doc.from}</span>, read back as strokes.{" "}
                {traced ? `${traced.glyph.strokes.length} in this one.` : ""}
              </p>
              {drawn && (
                <p className="pt-1 text-2xs leading-snug text-muted-foreground">
                  {drawn.exactness.exact
                    ? "Every stroke here offsets in closed form, so this letter cannot fold at any width."
                    : `Fitted rather than exact, to within ${drawn.exactness.deviation.toFixed(2)} units.`}
                </p>
              )}
              {/*
                What pen this font reads as having been written with.

                Read out of the whole alphabet at once by asking which pen makes
                the pressure along the strokes flattest -- because a pen has one
                angle and a letter's strokes run every way, so only a real pen
                explains all of them at once. Reported and not applied, for the
                reasons in `tracing.ts`.

                Worth saying because of the two sliders below it. "Nib contrast"
                and "Nib angle" are the hardest pair here to use blind, and a
                person told that the face they just read is a blade of 0.38 held
                at ten degrees has somewhere to start rather than a guess.
              */}
              {doc.hand && (
                <p className="pt-1 text-2xs leading-snug text-muted-foreground" data-quill-hand>
                  This face reads as a pen held at{" "}
                  <span className="text-foreground">{Math.round(doc.hand.angle)}°</span> with a
                  blade of <span className="text-foreground">{doc.hand.contrast.toFixed(2)}</span>,
                  which explains {Math.round(doc.hand.flatter * 100)} per cent of the width it
                  varies by. The two nib controls below start there.
                </p>
              )}
            </>
          ) : (
            <p className="pt-2 text-2xs leading-snug text-muted-foreground">
              Reading a font recovers the strokes that drew each letter — where they run and how
              wide the pen was along them — so the letters can be reshaped rather than merely
              nudged. Point it only at a font you have the right to derive from.
            </p>
          )}
        </section>

        {doc.letters.length > 0 && (
          <>
            <section className="border-b border-border p-3">
              <div className="flex items-baseline justify-between pb-2">
                <h3 className="text-2xs font-medium">Letter</h3>
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {traced?.glyph.strokes.length ?? 0} strokes
                </span>
              </div>
              <div className="flex flex-wrap gap-0.5">
                {doc.letters.map((one) => (
                  <button
                    key={one.glyph.name}
                    type="button"
                    aria-pressed={one.glyph.name === letter}
                    onClick={() => quillStore.setLetter(one.glyph.name)}
                    className={cn(
                      "min-w-6 rounded px-1 py-0.5 text-2xs transition-colors",
                      one.glyph.name === letter
                        ? "bg-background font-medium text-foreground ring-1 ring-[color:var(--border)]"
                        : "text-muted-foreground hover:bg-card hover:text-foreground",
                    )}
                  >
                    {one.glyph.name}
                  </button>
                ))}
              </div>
              <QuillTrip key={letter} letter={letter} byHand={Boolean(traced?.byHand)} />
            </section>

            <section className="border-b border-border p-3">
              <h3 className="pb-2 text-2xs font-medium">Shown</h3>
              <div className={SEGMENT_TRACK} role="group" aria-label="What is drawn">
                <button
                  type="button"
                  aria-pressed={state.showSource && hasSource}
                  disabled={!hasSource}
                  onClick={() => quillStore.setShowSource(!state.showSource)}
                  className={cn(
                    segment(state.showSource && hasSource, "flex-1"),
                    !hasSource && "opacity-40",
                  )}
                  title={
                    hasSource
                      ? undefined
                      : "Nothing to compare against until the font is read again"
                  }
                >
                  Source under
                </button>
                <button
                  type="button"
                  aria-pressed={state.showSpines}
                  onClick={() => quillStore.setShowSpines(!state.showSpines)}
                  className={segment(state.showSpines, "flex-1")}
                >
                  Centre-lines
                </button>
              </div>
              <p className="pt-2 text-2xs leading-snug text-muted-foreground">
                {hasSource
                  ? "The source is the outline the strokes were read from. It stays where it was however far the hand below is moved, so it is the thing to judge a change against."
                  : "This trace was reopened from a saved project, which keeps the strokes and not the outlines they were read from — those are the other font, and they are not written into your file. Read the font again to compare against it."}
              </p>
            </section>

            <section className="border-b border-border p-3">
              <div className="flex items-baseline justify-between pb-2">
                <h3 className="text-2xs font-medium">The hand</h3>
                <button
                  type="button"
                  onClick={() => quillStore.resetStyle()}
                  className="text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70"
                >
                  as read
                </button>
              </div>
              {QUILL_CONTROLS.map((control) => (
                <Hand key={control.key} control={control} />
              ))}
              <p className="pt-2 text-2xs leading-snug text-muted-foreground">
                Every one of these reaches all {doc.letters.length} letters. The strokes underneath
                are untouched, so any of it can be put back with the button above.
              </p>
            </section>
          </>
        )}
      </div>
      {/*
        Outside the scrolling column, at the foot, for the reason it is in the
        forge's panel: everything above reshapes the hand, and this is the one
        thing that takes the letters somewhere else.
      */}
      <TakeToEditor
        onEdit={onEdit}
        what="every traced letter"
        disabled={doc.letters.length === 0}
      />
    </aside>
  );
}

/**
 * Why the application moved on its own.
 *
 * A font dropped anywhere opens in the editor, and one whose letters join is
 * read into strokes here instead. That is a decision taken on somebody's
 * behalf, and the thing that makes it acceptable rather than mysterious is that
 * it says what it measured -- so a person who disagrees knows what to disagree
 * with, and a person whose text face landed here by mistake can see that it was
 * a measurement rather than a whim, and go back.
 */
function WhyHere(): React.JSX.Element | null {
  const routed = useQuill().routed;
  if (!routed) return null;
  const overhangs = routed.sidebearing < 0;
  return (
    <p className="pt-2 text-2xs leading-snug text-muted-foreground" data-quill-routed="joined">
      Sent here because this face joins: {routed.reaching} of {routed.tested} lowercase letters run{" "}
      {overhangs
        ? `past their own advance, by ${Math.abs(routed.sidebearing * 100).toFixed(1)}% of the em at the median`
        : "to the edge of their own advance"}
      . The outlines are still open in Edit.
    </p>
  );
}

/**
 * How far through the font the reading is.
 *
 * A bar and a count rather than a spinner, because this takes most of a minute
 * and a spinner that says only "working" for that long is indistinguishable
 * from one that has hung. The letter being read is named beside it: on a font
 * that stalls, the name is what says where.
 *
 * The bar is only honest once the total is known, and the total is not known
 * until the font has been parsed and its characters counted -- a second or two
 * on a large one. Until then it says so in words rather than drawing a bar at
 * nought, which would read as no progress rather than as nothing measured yet.
 */
function Reading(): React.JSX.Element {
  const state = useQuill();
  const progress = state.progress;
  const known = Boolean(progress && progress.total > 0);
  const share = known ? Math.min(1, progress!.done / progress!.total) : 0;

  return (
    <div className="pt-2" data-quill-progress={known ? String(progress!.done) : "counting"}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xs text-muted-foreground">
          {known ? (
            <>
              Reading{" "}
              {progress!.letter ? (
                <span className="text-foreground">{progress!.letter}</span>
              ) : (
                "the last of them"
              )}
            </>
          ) : (
            "Counting the letters…"
          )}
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {known ? `${progress!.done} of ${progress!.total}` : ""}
        </span>
      </div>
      <div
        className="mt-1 h-1 w-full overflow-hidden rounded-full bg-card"
        role="progressbar"
        aria-label="Reading the font"
        aria-valuemin={0}
        aria-valuemax={known ? progress!.total : undefined}
        aria-valuenow={known ? progress!.done : undefined}
      >
        <div
          className={cn(
            "h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-150",
            !known && "animate-pulse w-1/4",
          )}
          style={known ? { width: `${(share * 100).toFixed(1)}%` } : undefined}
        />
      </div>
      <button
        type="button"
        onClick={() => quillStore.stopTracing()}
        className="pt-1.5 text-2xs text-[color:var(--accent)] transition-opacity hover:opacity-70"
      >
        stop
      </button>
    </div>
  );
}

/** One control of the hand, wired to the store. */
function Hand({ control }: { control: (typeof QUILL_CONTROLS)[number] }): React.JSX.Element {
  const state = useQuill();
  const value = (state.document.style as unknown as Record<string, number>)[control.key];
  return (
    <div className="py-1" data-quill-control={control.key}>
      <Slider
        name={control.label}
        value={value}
        min={control.min}
        max={control.max}
        step={control.step}
        showFill
        onValueChange={(next: number, meta?: { history?: string }) => {
          /*
           * `merge` is the middle of a drag and anything else is the end of
           * one. Told apart so a drag lands on the undo stack once rather than
           * sixty times, which is the same arrangement the forge's sliders use.
           */
          const phase: Phase = meta?.history === "merge" ? "during" : "end";
          quillStore.changeStyle({ [control.key]: next } as Partial<QuillStyle>, phase);
        }}
      />
      <p className="pt-0.5 text-2xs leading-snug text-muted-foreground">{control.hint}</p>
    </div>
  );
}

/**
 * Taking one traced letter to the tools, and putting it back.
 *
 * The one thing a recovered stroke cannot do is the letter you have in your
 * head that no set of strokes reaches -- and there is always one, because what
 * came back is a guess about how a shape was made rather than a record of it.
 * Draw has had this for a while and Trace, which needs it at least as much,
 * had only the whole-font hand-over at the bottom of the panel: the only way to
 * move a point on one traced letter was to take all seventy of them out of the
 * engine that drew them.
 *
 * What it costs is said rather than discovered. A letter that comes back is an
 * outline, and the hand above cannot reach it -- there are no strokes left
 * underneath to reshape. Putting it back under the hand is one button, and the
 * strokes are still there when it is: they never went anywhere.
 */
function QuillTrip({ letter, byHand }: { letter: string; byHand: boolean }): React.JSX.Element {
  const [problem, setProblem] = React.useState<string | null>(null);

  const here = (): void => {
    const lent = quillStore.letterAsGlyph(letter);
    if (!lent) {
      setProblem(`${letter} has nothing drawn in it to work on.`);
      return;
    }
    store.borrowLetter({ letter, family: lent.family, from: "quill" }, lent.glyph, {
      unitsPerEm: lent.unitsPerEm,
      metrics: lent.metrics,
    });
    store.askForMode("edit");
  };

  return (
    <div className="pt-2" data-quill-trip={letter}>
      <button
        type="button"
        onClick={here}
        data-quill-draw-here={letter}
        title={`Puts ${letter} on the canvas on its own, with the pen, the knife, the shapes and every other tool pointed at it. It comes back into this slot at the width it left with, as an outline — the hand above has no strokes left to reshape, and one button gives them back.`}
        className="w-full rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-accent hover:bg-card"
      >
        {byHand ? `Work on ${letter} with the tools` : `Draw ${letter} with the tools`}
      </button>
      {problem && (
        <p className="pt-2 text-2xs leading-snug text-[color:var(--destructive)]">{problem}</p>
      )}
      {byHand && (
        <div className="pt-2" data-quill-byhand={letter}>
          <p className="text-2xs leading-snug text-muted-foreground">
            {letter} is your drawing. It keeps its advance, and the hand above no longer reaches it
            — there are no strokes left underneath to reshape. The strokes it was read from are
            still here, so giving it back costs one press.
          </p>
          <button
            type="button"
            onClick={() => quillStore.redrawLetter(letter)}
            data-quill-redraw={letter}
            className="mt-1.5 w-full rounded-md border border-border px-2 py-1.5 text-2xs transition-colors hover:border-muted-foreground hover:bg-card"
          >
            Draw it from its strokes again
          </button>
        </div>
      )}
    </div>
  );
}

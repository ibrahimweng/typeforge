/**
 * What the font calls itself, and the lines it is drawn between.
 *
 * Neither of these could be changed at all, and the first of the two is the
 * reason this exists rather than a nicety. A font opened here kept the
 * identity of the file it came from whatever was done to it: redraw every
 * letter of DejaVu Sans, export, and the file is still called DejaVu Sans,
 * still carries DejaVu's copyright, still names DejaVu's designer, still
 * claims DejaVu's licence. That is not a missing field. It is a derivative
 * work that does not say it is one, and it is the thing every type licence
 * asks of you first.
 *
 * Reached by pressing the font's name in the toolbar, where the name has
 * always been shown. A thing you can read is the natural place to go to change
 * it, and it saves a button on a toolbar that has none to spare.
 *
 * The two halves are one dialog because they are one question -- what is this
 * font -- asked about its name and about its measurements. Keeping them apart
 * would mean two ways in for the same answer.
 */

import * as React from "react";

import { enter } from "@/anim/motion";
import { NumberField } from "@/components/NumberField";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

/** One labelled text field, committed rather than typed. */
function Text({
  label,
  value,
  hint,
  lines,
  onCommit,
}: {
  label: string;
  value: string;
  hint?: string;
  /**
   * How many lines the field stands, for the ones that hold a paragraph.
   *
   * A copyright notice and a licence are sentences, and DejaVu's are both
   * longer than the box: "Copyright (c) 2003 by Bitstream, Inc. All Rights
   * Reserve" was where the first one stopped being visible. A field somebody
   * cannot read is a field they cannot check, and these two are the ones the
   * type licences care about.
   */
  lines?: number;
  onCommit: (next: string) => void;
}): React.JSX.Element {
  /*
   * Held locally while it is being typed and handed over on the way out.
   *
   * The store pushes an edit for every call, so a field that reported each
   * keystroke would put nineteen entries on the undo stack for one family
   * name and make undo walk back through the spelling of it.
   */
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);

  return (
    <label className="flex flex-col gap-1 pb-3">
      <span className="text-2xs text-muted-foreground">{label}</span>
      {lines ? (
        <textarea
          value={draft}
          rows={lines}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onCommit(draft)}
          /*
            No Enter to finish, because Enter is a line here. Escape still puts
            it back, and leaving the field still commits, which is how every
            other field in this dialog behaves.
          */
          onKeyDown={(event) => {
            if (event.key === "Escape") setDraft(value);
          }}
          className={cn(
            "resize-y rounded-md border border-input bg-card px-2.5 py-1.5 text-xs-plus text-foreground",
            "outline-none focus-visible:border-accent",
          )}
        />
      ) : (
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onCommit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(value);
          }}
          className={cn(
            "h-8 rounded-md border border-input bg-card px-2.5 text-xs-plus text-foreground",
            "outline-none focus-visible:border-accent",
          )}
        />
      )}
      {hint && <span className="text-2xs leading-snug text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** One labelled number, in font units. */
function Measure({
  label,
  value,
  hint,
  onCommit,
}: {
  label: string;
  value: number;
  hint: string;
  onCommit: (next: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 pb-2.5">
      <div className="min-w-0">
        <div className="text-2xs text-foreground">{label}</div>
        <div className="text-2xs leading-snug text-muted-foreground">{hint}</div>
      </div>
      <NumberField label={label} className="w-20 shrink-0" value={value} onCommit={onCommit} />
    </div>
  );
}

export function FontInfoDialog({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const state = useAppState();
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (panelRef.current) enter(panelRef.current, { distance: 10 });
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const typeface = state.typeface;
  if (!typeface) return null;
  const { meta, metrics } = typeface;

  /*
   * Whether this is somebody else's font with your drawing in it.
   *
   * Asked of the document rather than of the name alone: a font nobody has
   * touched is a font being looked at, and there is nothing to say about it.
   * Once a letter has been edited and the name is still the one the file
   * arrived with, the name is the thing standing between the work and a
   * licence it may not have.
   */
  const opened = typeface.source !== null;
  const edited = typeface.glyphs.some((glyph) => glyph.dirty);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        /*
          A fixed head and foot with the middle scrolling, rather than one long
          panel that scrolls entire.

          There is more in here than fits a nine-hundred-pixel window, and the
          first version put the only button below the fold: the dialog opened
          with no visible way to close it. Escape worked and so did clicking
          away, but neither is a thing that is on screen.
        */
        className="floating-popup-surface flex max-h-full w-[30rem] flex-col rounded-xl border border-border bg-popover shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Font details"
        data-font-info
      >
        <h2 className="shrink-0 border-b border-border p-4 text-sm font-medium">This font</h2>
        <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
          {opened && edited && (
            <p
              className="mb-4 rounded-md border border-[var(--attention)]/40 bg-[var(--attention)]/10 p-2.5 text-2xs leading-relaxed text-[var(--attention)]"
              data-derivative-note
            >
              You have changed letters in a font that came from a file. Give it a name of its own
              and put your own copyright and licence on it before exporting — what is here now
              describes the font you opened, not the one you are making.
            </p>
          )}

          <Text
            label="Family"
            value={meta.familyName}
            hint="What the font is called. This is the name that appears in every menu that lists it."
            onCommit={(familyName) => store.setMeta({ familyName })}
          />
          <Text
            label="Style"
            value={meta.styleName}
            hint="Regular, Italic, Bold — which member of the family this file is."
            onCommit={(styleName) => store.setMeta({ styleName })}
          />
          <Text
            label="Version"
            value={meta.version}
            onCommit={(version) => store.setMeta({ version })}
          />
          <Text
            label="Designer"
            value={meta.designer}
            onCommit={(designer) => store.setMeta({ designer })}
          />
          <Text
            label="Copyright"
            value={meta.copyright}
            lines={2}
            onCommit={(copyright) => store.setMeta({ copyright })}
          />
          <Text
            label="Licence"
            value={meta.license}
            lines={4}
            hint="The terms the font goes out under. A font drawn on top of somebody else's is bound by theirs."
            onCommit={(license) => store.setMeta({ license })}
          />

          <h3 className="border-t border-border pb-3 pt-4 text-2xs font-medium">The lines</h3>
          <Measure
            label="Cap height"
            value={metrics.capHeight}
            hint="How tall the capitals stand."
            onCommit={(capHeight) => store.setMetrics({ capHeight })}
          />
          <Measure
            label="x-height"
            value={metrics.xHeight}
            hint="How tall the lowercase stands."
            onCommit={(xHeight) => store.setMetrics({ xHeight })}
          />
          <Measure
            label="Ascender"
            value={metrics.ascender}
            hint="How far a b or an l reaches above the x-height."
            onCommit={(ascender) => store.setMetrics({ ascender })}
          />
          <Measure
            label="Descender"
            value={metrics.descender}
            hint="How far a p or a g hangs below the baseline. Negative."
            onCommit={(descender) => store.setMetrics({ descender })}
          />
          <Measure
            label="Line gap"
            value={metrics.lineGap}
            hint="Extra space between lines, on top of the ascender and descender."
            onCommit={(lineGap) => store.setMetrics({ lineGap })}
          />

          {/*
          Shown and not editable, which is a decision rather than an omission.
          The em is the unit every coordinate in the font is counted in, so
          changing this number without moving a single point would resize the
          whole font by the ratio between the old one and the new -- silently,
          and with nothing on screen to show it had happened.
        */}
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <div>
              <div className="text-2xs text-foreground">Units per em</div>
              <div className="text-2xs leading-snug text-muted-foreground">
                What every measurement above is counted in. Fixed when the font was made: changing
                it would resize every letter without moving a point.
              </div>
            </div>
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
              {typeface.unitsPerEm}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

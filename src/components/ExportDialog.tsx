/**
 * Export.
 *
 * The two choices that matter are the format and how much of the imported font
 * to carry forward. Both are stated in plain terms, because picking "rebuild"
 * on a font full of ligatures quietly throws them away, and that should never
 * be a surprise.
 */

import * as React from "react";

import { enter, refuse } from "@/anim/motion";
import { CoachMark } from "@/components/CoachMark";
import { exportFont, toDownloadBlob, type ExportFidelity, type ExportFormat } from "@/font/export";
import { varyByDrawnWeights, varyByWeight } from "@/font/masters";
import { store, useAppState } from "@/state/useStore";
import { ufoNameFor, zipUfo } from "@/ufo/intake";
import { cn } from "@/ui/lib/utils";

export function ExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;

  /*
   * What is being left with, which is not always a font.
   *
   * `ExportFormat` is the font exporter's own type and stays that way: it
   * lists what `exportFont` can build, and a UFO is not something it builds.
   * Widening it there would put a case in the encoder for a format that never
   * reaches it.
   */
  const [format, setFormat] = React.useState<ExportFormat | "ufo" | "variable">("ttf");
  const [fidelity, setFidelity] = React.useState<ExportFidelity>("preserve");
  const [includeKerning, setIncludeKerning] = React.useState(true);
  const [mergeOverlaps, setMergeOverlaps] = React.useState(true);
  const [working, setWorking] = React.useState(false);
  const [notes, setNotes] = React.useState<string[]>([]);
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

  if (!typeface) return <></>;

  // OpenType is always a rebuild, because the curves have to be re-encoded as
  // PostScript. Say so rather than letting the choice look available.
  const preserveAvailable =
    format === "ttf" && typeface.source !== null && !typeface.source.isCFF;

  /*
   * How this font would vary, and whether it can at all.
   *
   * Two ways, and the drawn one wins. If somebody has drawn a second weight,
   * those drawings are the masters and there is nothing to work out. If not,
   * the ends of the weight slider are synthesised -- which is a machine-made
   * bold, even where a drawn one is optical, and worth saying so.
   *
   * A font already at one end of that slider has nowhere to go, and an axis
   * whose default sits on its own limit is worse than no axis. Said here rather
   * than refused at the end, because a choice that is going to fail should look
   * unavailable before it is made.
   */
  const drawn = varyByDrawnWeights(state.masters);
  const varyingOptions = drawn ?? varyByWeight(typeface);
  const canVary = varyingOptions !== null;

  const handleExport = async (): Promise<void> => {
    setWorking(true);
    setNotes([]);
    try {
      // Yield once so the button's pending state paints before the main thread
      // is taken by encoding.
      await new Promise((resolve) => setTimeout(resolve, 0));

      if (format === "ufo") {
        const files = store.ufoFiles();
        if (!files) throw new Error("There is no font open to write.");
        const name = ufoNameFor(typeface.meta.familyName, typeface.meta.styleName);
        const archive = zipUfo(files, name);
        const url = URL.createObjectURL(
          new Blob([archive as BlobPart], { type: "application/zip" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name}.zip`;
        link.click();
        URL.revokeObjectURL(url);
        store.setStatus({
          message: `Wrote ${name} (${formatBytes(archive.length)})`,
          tone: "success",
        });
        onClose();
        return;
      }

      /*
       * A varying font is a TrueType file: the movement lives in `gvar`, which
       * describes points, and a `.otf` has none to describe. And it is always a
       * rebuild -- the outlines are re-encoded so that every master splits its
       * curves the same number of ways, which is the whole reason the points
       * line up between them. See `PIECES_PER_CURVE` in `variable.ts`.
       */
      const varying = format === "variable" ? varyingOptions : null;
      const result = await exportFont(typeface, {
        // Narrowed by the branch above, which returns for the one value this
        // does not accept.
        format: format === "variable" ? "ttf" : format,
        fidelity: varying ? "rebuild" : preserveAvailable ? fidelity : "rebuild",
        includeKerning,
        mergeOverlaps,
        ...(varying ? { variable: varying } : {}),
      });

      const url = URL.createObjectURL(toDownloadBlob(result));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);

      setNotes(result.notes);
      store.setStatus({
        message: `Exported ${result.fileName} (${formatBytes(result.bytes.length)})`,
        tone: "success",
      });
      if (result.notes.length === 0) onClose();
    } catch (error) {
      if (panelRef.current) refuse(panelRef.current);
      store.setStatus({
        message: error instanceof Error ? error.message : "The export failed.",
        tone: "error",
      });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        /*
          Bounded, and scrolling inside itself.

          A centred flex child taller than the window is clipped at both ends
          and cannot be scrolled to, so anything past the fold is not merely
          hard to reach -- it is not reachable at all, and a click aimed at it
          lands on the backdrop, which closes the dialog. This is 805 pixels
          tall without the name field and 963 with it, so on a 600-pixel window
          the Download button was already off the bottom before either; at 720
          it had seven pixels showing, and the field above took those away and
          stopped the export happening at all.
        */
        className="floating-popup-surface toolcraft-scrollbar max-h-[calc(100vh-3rem)] w-[30rem] overflow-y-auto rounded-xl border border-border bg-popover p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Download font"
      >
        <h2 className="pb-4 text-sm font-medium">Download this font</h2>

        <CoachMark id="export" className="-mx-5 mb-4 border-t border-border" />

        {/*
          What the file will say it is, where the decision is actually taken.

          This is the one dialog of the four that never mentioned it. Draw,
          Assemble and Trace all name the font on the way out; here the name
          came from whatever file was opened, and with "Everything from the
          original" above it so did the designer, the copyright and the licence.
          So a person could open somebody else's font, redraw every letter, and
          ship a file still claiming to be theirs -- without a word about it at
          the moment of shipping.

          It is the same `setMeta` the font dialog uses, so the two cannot come
          to disagree, and it is here as well as there because "what is this
          font called" is a question you answer when you name a file, not one
          you remember to have answered a page away.
        */}
        <Field label="Name">
          <input
            value={typeface.meta.familyName}
            onChange={(event) => store.setMeta({ familyName: event.target.value })}
            data-export-family
            aria-label="Family name"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs-plus outline-none focus:border-accent"
          />
          <input
            value={typeface.meta.styleName}
            onChange={(event) => store.setMeta({ styleName: event.target.value })}
            data-export-style
            aria-label="Style name"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs-plus outline-none focus:border-accent"
          />
          <p className="text-2xs leading-snug text-muted-foreground">
            The name every menu will list this under. A font drawn on top of somebody else's is a
            derivative work and has to say what it is — the designer, copyright and licence are in{" "}
            <span className="text-foreground">This font</span>, in the bar above.
          </p>
        </Field>

        <Field label="Format">
          <Choice
            selected={format === "ttf"}
            onSelect={() => setFormat("ttf")}
            title="TrueType (.ttf)"
            description="Quadratic curves. The widest support, and the format most web and system use expects."
          />
          <Choice
            selected={format === "otf"}
            onSelect={() => setFormat("otf")}
            title="OpenType (.otf)"
            description="PostScript curves, matching how the outlines are drawn here. Preferred by print workflows."
          />
          {/*
            One file that holds every weight, and a slider between them.

            The machinery to write it has been here since the forge learned to
            ship a family, and it takes masters as whole typefaces -- so nothing
            about it was ever particular to a font drawn from nothing. Only the
            forge could reach it, and a font somebody opened or drew here could
            not be shipped as a varying one at all, though this half of the
            application is already a machine for drawing the same alphabet at
            any weight.

            Two ways to get the masters, and the drawn one wins. A font with a
            second weight drawn uses those drawings; a font without one falls
            back to the two ends of the weight slider, which is a machine-made
            bold -- even where a drawn one is optical, and thickening a hairline
            and a stem by the same amount. That is worth saying out loud in the
            description rather than shipping quietly, and it is why a font
            already sitting at one end of that slider cannot have this at all:
            an axis whose default is its own limit is a slider that only runs
            one way.
          */}
          <Choice
            selected={format === "variable"}
            onSelect={() => canVary && setFormat("variable")}
            disabled={!canVary}
            title="Variable (.ttf)"
            description={
              drawn
                ? `One file, every weight, and a slider between them. Built from the ${state.masters.length} weights you drew: ${state.masters.map((one) => one.name).join(", ")}.`
                : canVary
                  ? "One file, every weight, and a slider between them. The two ends of the Weight control become the ends of the axis — a calculated bold rather than a drawn one. Add a weight on the Font screen to draw the other end yourself."
                  : "Needs room on the Weight control, or a second weight drawn on the Font screen. This font is at one end of the control, so there is nothing for an axis to reach."
            }
          />
          {/*
            The fourth one is not a font, and that is the point of it.

            A `.ttf` and a `.otf` are what a font becomes at the end; a UFO is
            what it is while somebody is still drawing it, and it is the file
            that goes back into RoboFont or Glyphs or a build. Leaving with
            only a compiled font means leaving with something you cannot open
            again and keep working in, which is what makes an editor a filter.

            It goes out as a zip because a UFO is a folder and a page cannot
            hand back a folder. Every operating system expands it into one.
          */}
          <Choice
            selected={format === "ufo"}
            onSelect={() => setFormat("ufo")}
            title="UFO (a folder, zipped)"
            description="The source a designer works in, not a compiled font. Opens in RoboFont, Glyphs and fontmake, and can be opened again here."
          />
        </Field>

        {/*
          Both of the questions below are about compiling, and a UFO is not
          compiled: there is nothing to preserve from an original because the
          outlines go out as outlines, and nothing to merge because overlaps
          are what a source file is supposed to keep. Hiding them is better
          than showing two controls that quietly do nothing.
        */}
        {format !== "ufo" && format !== "variable" && (
        <>
        <Field label="What to carry over">
          <Choice
            selected={fidelity === "preserve" && preserveAvailable}
            onSelect={() => setFidelity("preserve")}
            disabled={!preserveAvailable}
            title="Everything from the original"
            description={
              preserveAvailable
                ? "Ligatures, alternates and hinting are kept, and untouched glyphs are copied across unchanged."
                : format === "otf"
                  ? "Not available for OpenType: the curves are re-encoded, so the font is rebuilt."
                  : "Not available: there is no imported TrueType font to preserve from."
            }
          />
          <Choice
            selected={fidelity === "rebuild" || !preserveAvailable}
            onSelect={() => setFidelity("rebuild")}
            title="Only what this editor manages"
            description="Outlines, spacing, kerning and names. Smaller and fully predictable, but ligatures, alternates and hinting are dropped."
          />
        </Field>

        <div className="grid gap-2 pb-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs-plus">
            <input
              type="checkbox"
              checked={includeKerning}
              onChange={(event) => setIncludeKerning(event.target.checked)}
              className="size-3.5 accent-[var(--accent)]"
            />
            <span>
              Include kerning{" "}
              <span className="text-2xs text-muted-foreground tabular-nums">
                {typeface.kerning.length.toLocaleString()} pairs
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2 text-xs-plus">
            <input
              type="checkbox"
              checked={mergeOverlaps}
              onChange={(event) => setMergeOverlaps(event.target.checked)}
              className="mt-1 size-3.5 shrink-0 accent-[var(--accent)]"
            />
            <span>
              Merge overlapping contours
              <span className="block text-2xs leading-snug text-muted-foreground">
                Drawing letters as overlapping pieces is normal, but a font file cannot carry
                them: some renderers drop the overlap out as a hole. Turning this off writes your
                contours exactly as drawn, and takes a few seconds less.
              </span>
            </span>
          </label>
        </div>
        </>
        )}

        {notes.length > 0 && (
          <ul className="mb-4 space-y-1 rounded-md border border-attention/40 bg-attention/10 p-2.5">
            {notes.map((note) => (
              <li key={note} className="text-2xs leading-snug text-attention">
                {note}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs-plus text-muted-foreground hover:text-foreground"
          >
            {notes.length > 0 ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={working}
            className="rounded-md bg-accent px-3 py-1.5 text-xs-plus text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {working ? "Writing…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="pb-4">
      <p className="pb-1.5 text-2xs text-muted-foreground">{label}</p>
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  description,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "rounded-lg border p-2.5 text-left transition-colors",
        selected ? "border-accent bg-accent/10" : "border-border hover:border-muted-foreground",
        disabled && "cursor-not-allowed opacity-45 hover:border-border",
      )}
    >
      <span className="block text-xs-plus text-foreground">{title}</span>
      <span className="block pt-0.5 text-2xs leading-snug text-muted-foreground">{description}</span>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

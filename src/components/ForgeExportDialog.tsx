/**
 * Taking a forged font out of the browser.
 *
 * Simpler than exporting an imported font, because there is nothing to carry
 * forward: no name table somebody else wrote, no layout features to preserve,
 * no source file whose bytes have to survive. The letters go in and a font
 * comes out, and the only real decision is which of the two formats.
 *
 * The strokes are fused on the way. A serif is a bar laid over a stem and an
 * arch overlaps the stem it springs from -- correct to draw, correct to edit,
 * and impossible to store: under the even-odd rule some renderers and most
 * print pipelines use, the overlapping region drops out and leaves a hole.
 */

import * as React from "react";
import { anyEffect } from "@/font/effects";

import { enter, refuse } from "@/anim/motion";
import type { ExportFormat } from "@/font/export";
import { deliver } from "@/forge/deliver";
import { familyOf } from "@/forge/document";
import { WEIGHTS, weightsOf } from "@/forge/family";
import { forgeStore, useForge } from "@/state/useForge";
import { OUTLINE_ACTION, PRIMARY_ACTION } from "@/components/controls";
import { cn } from "@/ui/lib/utils";

export function ForgeExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useForge();
  /*
   * Three choices rather than two, and the third is not a format.
   *
   * A variable font is a TrueType file; what makes it one is that the whole
   * family is inside it with the differences stored alongside. But that is not
   * how anybody picks one -- they pick the kind of file they want -- so it sits
   * beside the two formats and is turned into a format and a flag here.
   */
  const [kind, setKind] = React.useState<"ttf" | "otf" | "variable">("ttf");
  // Whether anything the tool leaves is switched on, which decides both what
  // this costs and what it can be written as.
  const textured = anyEffect(state.forge.effects);
  const format: ExportFormat = kind === "otf" ? "otf" : "ttf";
  const [working, setWorking] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
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

  const family = familyOf(state.forge);
  const weights = weightsOf(family);
  // A variable font of one weight is a font, so the choice steps back to a
  // plain one rather than being refused at the moment somebody presses it.
  React.useEffect(() => {
    if (kind === "variable" && weights.length < 2) setKind("ttf");
  }, [kind, weights.length]);

  const download = async (): Promise<void> => {
    setWorking(true);
    setProblem(null);
    try {
      const written = await deliver(state.forge, {
        familyName: state.familyName || "Untitled",
        format,
        variable: kind === "variable",
      });
      const url = URL.createObjectURL(
        new Blob([written.bytes as BlobPart], {
          type: written.fileName.endsWith(".zip")
            ? "application/zip"
            : format === "otf"
              ? "font/otf"
              : "font/ttf",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = written.fileName;
      link.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (error) {
      if (panelRef.current) refuse(panelRef.current);
      setProblem(error instanceof Error ? error.message : "The font could not be written.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className="floating-popup-surface w-[28rem] rounded-xl border border-border bg-popover p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Download font"
      >
        <h2 className="pb-4 text-sm font-medium">Download your font</h2>

        <label className="block pb-4">
          <span className="text-2xs text-muted-foreground">Name</span>
          <input
            value={state.familyName}
            onChange={(event) => forgeStore.setFamilyName(event.target.value)}
            aria-label="Font name"
            className="mt-1 h-8 w-full rounded-md border border-input bg-card px-2.5 text-xs-plus text-foreground outline-none focus-visible:border-accent"
          />
        </label>

        {/*
          The weights, which is what makes this a typeface rather than a font.

          Every one of them is drawn from the one on screen, so this is a
          decision about how many files come out rather than about how much
          drawing there is left to do. The one being drawn cannot be turned
          off: it is the font, and the rest are worked out from it.
        */}
        <span className="text-2xs text-muted-foreground">Weights</span>
        <div className="flex flex-wrap gap-1 pb-1 pt-1.5" role="group" aria-label="Weights">
          {WEIGHTS.map(({ weight, name }) => {
            const on = weights.includes(weight);
            const drawn = weight === family.drawn;
            return (
              <button
                key={weight}
                type="button"
                onClick={() => forgeStore.toggleWeight(weight)}
                disabled={drawn}
                aria-pressed={on}
                data-weight={weight}
                data-weight-on={on ? "yes" : "no"}
                title={
                  drawn
                    ? `${name} is the weight you are drawing, so it is always in the family`
                    : `${name} — drawn from what is on screen at ${weight}`
                }
                className={cn(
                  "rounded-md border px-2 py-1 text-2xs transition-colors",
                  on
                    ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_10%,transparent)] text-foreground"
                    : "border-border text-muted-foreground hover:border-muted-foreground hover:bg-card",
                  drawn && "cursor-default",
                )}
              >
                {name}
                {drawn && <span className="pl-1 opacity-60">·</span>}
              </button>
            );
          })}
        </div>
        {/*
          Which of the nine the drawing on screen is.

          It is asked because it is not always four hundred and getting it
          wrong quietly ruins the family: a display face is already the weight
          of somebody else's Bold, and called a Regular and given a Bold of its
          own it is asked for a stem half again as wide as the one that was
          already closing its counters. The tool guesses from the stem when the
          font is started, and this is where the guess is corrected.
        */}
        <label className="flex items-center gap-2 pt-1.5">
          <span className="text-2xs text-muted-foreground">This drawing is the</span>
          <select
            value={family.drawn}
            onChange={(event) => forgeStore.setDrawnWeight(Number(event.target.value))}
            aria-label="Which weight is being drawn"
            data-drawn-weight
            className="h-7 rounded-md border border-input bg-card px-1.5 text-2xs text-foreground outline-none focus-visible:border-accent"
          >
            {WEIGHTS.map(({ weight, name }) => (
              <option key={weight} value={weight}>
                {name}
              </option>
            ))}
          </select>
        </label>

        {textured && (
          /*
           * Said here rather than discovered afterwards.
           *
           * Two masters join only where they are drawn with the same points in
           * the same order, and a wander measured in stem widths along a
           * perimeter is not the same wander at two weights. So a textured
           * family is written as separate files, which is the honest answer
           * rather than a variable font whose axis tears its letters apart
           * halfway along.
           */
          <p className="pb-3 text-2xs leading-snug text-[color:var(--accent)]" data-tool-note>
            The tool is baked into every letter on the way out, which takes a
            few seconds a weight. It cannot be a variable font: the rough edge
            is drawn to the stem, so two weights come out with different points
            and there is nothing to slide between.
          </p>
        )}

        <p className="pb-4 pt-1 text-2xs leading-snug text-muted-foreground" data-weight-note>
          {weights.length === 1
            ? "One weight. Add another and the whole family is drawn from this one — the stems in proportion to the number, the counters giving back four fifths of what the stems gain, the spacing left alone."
            : kind === "variable"
              ? `${weights.length} weights in one file, and every weight between them: the file carries the ends and works out the rest.`
              : `${weights.length} weights, downloaded together as a zip. They install as one family.`}
        </p>

        <span className="text-2xs text-muted-foreground">Format</span>
        <div className="flex gap-2 pb-4 pt-1.5">
          {(
            [
              ["ttf", "TrueType", "The widest support, and what most systems expect.", true],
              ["otf", "OpenType", "Cubic curves, as this font is drawn in.", true],
              [
                "variable",
                "Variable",
                textured
                  ? "Not with a tool on the font: see below."
                  : weights.length > 1
                    ? "One file with a weight slider from end to end."
                    : "Needs more than one weight.",
                weights.length > 1 && !textured,
              ],
            ] as Array<["ttf" | "otf" | "variable", string, string, boolean]>
          ).map(([id, label, note, allowed]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKind(id)}
              disabled={!allowed}
              aria-pressed={kind === id}
              data-format={id}
              className={cn(
                "flex-1 rounded-md border p-2.5 text-left transition-colors",
                kind === id
                  ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_10%,transparent)]"
                  : "border-border hover:border-muted-foreground hover:bg-card",
                !allowed && "cursor-default opacity-50 hover:border-border hover:bg-transparent",
              )}
            >
              <span className="block text-2xs font-medium text-foreground">{label}</span>
              <span className="block pt-0.5 text-2xs leading-snug text-muted-foreground">
                {note}
              </span>
            </button>
          ))}
        </div>

        <p className="pb-4 text-2xs leading-relaxed text-muted-foreground">
          Every shape in this file was drawn from a skeleton here. Nothing is traced from or
          derived from another typeface, so there is nobody to credit and nothing to license — it
          is yours to use, sell or give away.
        </p>

        {problem && <p className="pb-3 text-2xs text-destructive">{problem}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={OUTLINE_ACTION}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={working}
            data-download-family
            className={PRIMARY_ACTION}
          >
            {working ? "Writing…" : weights.length === 1 ? "Download" : `Download ${weights.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

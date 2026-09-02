/**
 * Taking an assembled font out of the browser.
 *
 * The same two formats and the same fuse as the drawn font, and one difference
 * worth saying out loud on the way past: these shapes came from somewhere. A
 * font drawn from a skeleton here is nobody else's work; a font assembled from
 * drawings is exactly as much yours as the drawings were, and the application
 * has no way of knowing whether they were. So it says so rather than putting a
 * claim in the file that might not be true.
 */

import * as React from "react";

import { toTypeface } from "@/assemble/typeface";
import { build } from "@/assemble/document";
import { enter, refuse } from "@/anim/motion";
import { exportFont, toDownloadBlob, type ExportFormat } from "@/font/export";
import { assembleStore, useAssemble } from "@/state/useAssemble";
import { OUTLINE_ACTION, PRIMARY_ACTION } from "@/components/controls";
import { cn } from "@/ui/lib/utils";

export function AssembleExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useAssemble();
  const [format, setFormat] = React.useState<ExportFormat>("ttf");
  const [working, setWorking] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const assembled = React.useMemo(
    () => build(state.assembly),
    [state.assembly, state.revision],
  );

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

  const download = async (): Promise<void> => {
    setWorking(true);
    setProblem(null);
    try {
      const typeface = await toTypeface(state.assembly, {
        familyName: state.familyName || "Untitled",
        styleName: "Regular",
        merge: true,
      });
      const result = await exportFont(typeface, {
        format,
        // Nothing to preserve: there was never a source font.
        fidelity: "rebuild",
        includeKerning: true,
        mergeOverlaps: true,
      });
      const url = URL.createObjectURL(toDownloadBlob(result));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
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
        /*
          Bounded, and scrolling inside itself, for the reason the editor's
          export dialog is: a centred flex child taller than the window is
          clipped at both ends and cannot be scrolled to, so anything past the
          fold is unreachable and a click aimed at it lands on the backdrop --
          which closes the dialog rather than pressing the button.
        */
        className="floating-popup-surface toolcraft-scrollbar max-h-[calc(100vh-3rem)] w-[28rem] overflow-y-auto rounded-xl border border-border bg-popover p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Download font"
      >
        <h2 className="pb-4 text-sm font-medium">Download your font</h2>

        <label className="block pb-4">
          <span className="text-2xs text-muted-foreground">Name</span>
          <input
            value={state.familyName}
            onChange={(event) => assembleStore.setFamilyName(event.target.value)}
            aria-label="Font name"
            className="mt-1 h-8 w-full rounded-md border border-input bg-card px-2.5 text-xs-plus text-foreground outline-none focus-visible:border-accent"
          />
        </label>

        <span className="text-2xs text-muted-foreground">Format</span>
        <div className="flex gap-2 pb-4 pt-1.5">
          {(
            [
              ["ttf", "TrueType", "The widest support, and what most systems expect."],
              ["otf", "OpenType", "Cubic curves, as the drawings came in."],
            ] as Array<[ExportFormat, string, string]>
          ).map(([id, label, note]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFormat(id)}
              aria-pressed={format === id}
              className={cn(
                "flex-1 rounded-md border p-2.5 text-left transition-colors",
                format === id
                  ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_10%,transparent)]"
                  : "border-border hover:border-muted-foreground hover:bg-card",
              )}
            >
              <span className="block text-2xs font-medium text-foreground">{label}</span>
              <span className="block pt-0.5 text-2xs leading-snug text-muted-foreground">
                {note}
              </span>
            </button>
          ))}
        </div>

        <p className="pb-2 text-2xs leading-relaxed text-muted-foreground">
          {assembled.letters.length} character{assembled.letters.length === 1 ? "" : "s"}, with{" "}
          {assembled.kerning.length} kerning pair
          {assembled.kerning.length === 1 ? "" : "s"}.
          {assembled.unplaced.length > 0 &&
            ` ${assembled.unplaced.length} drawing${
              assembled.unplaced.length === 1 ? "" : "s"
            } still without a character, and ${
              assembled.unplaced.length === 1 ? "it" : "they"
            } will not be in the file.`}
        </p>

        <p className="pb-4 text-2xs leading-relaxed text-muted-foreground">
          These outlines are the drawings you brought in. Typeforge has put them
          on the same lines and worked out the spacing; it has not drawn
          anything, so whatever the drawings were yours to do, the font is too.
        </p>

        {problem && <p className="pb-3 text-2xs text-destructive">{problem}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={OUTLINE_ACTION}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={working || assembled.letters.length === 0}
            className={PRIMARY_ACTION}
          >
            {working ? "Writing…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}

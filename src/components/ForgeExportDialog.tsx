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

import { enter, refuse } from "@/anim/motion";
import { exportFont, toDownloadBlob, type ExportFormat } from "@/font/export";
import { toTypeface } from "@/forge/typeface";
import { forgeStore, useForge } from "@/state/useForge";
import { OUTLINE_ACTION, PRIMARY_ACTION } from "@/components/controls";
import { cn } from "@/ui/lib/utils";

export function ForgeExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useForge();
  const [format, setFormat] = React.useState<ExportFormat>("ttf");
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

  const download = async (): Promise<void> => {
    setWorking(true);
    setProblem(null);
    try {
      const typeface = await toTypeface(state.forge, {
        familyName: state.familyName || "Untitled",
        styleName: "Regular",
        merge: true,
      });
      const result = await exportFont(typeface, {
        format,
        // Nothing to preserve: there was never a source font.
        fidelity: "rebuild",
        includeKerning: false,
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

        <span className="text-2xs text-muted-foreground">Format</span>
        <div className="flex gap-2 pb-4 pt-1.5">
          {(
            [
              ["ttf", "TrueType", "The widest support, and what most systems expect."],
              ["otf", "OpenType", "Cubic curves, as this font is drawn in."],
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
            className={PRIMARY_ACTION}
          >
            {working ? "Writing…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}

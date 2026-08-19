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
import { exportFont, toDownloadBlob, type ExportFidelity, type ExportFormat } from "@/font/export";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

export function ExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useAppState();
  const typeface = state.typeface;

  const [format, setFormat] = React.useState<ExportFormat>("ttf");
  const [fidelity, setFidelity] = React.useState<ExportFidelity>("preserve");
  const [includeKerning, setIncludeKerning] = React.useState(true);
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

  const handleExport = async (): Promise<void> => {
    setWorking(true);
    setNotes([]);
    try {
      // Yield once so the button's pending state paints before the main thread
      // is taken by encoding.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = await exportFont(typeface, {
        format,
        fidelity: preserveAvailable ? fidelity : "rebuild",
        includeKerning,
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
        className="floating-popup-surface w-[30rem] rounded-xl border border-border bg-popover p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Export font"
      >
        <h2 className="pb-4 text-sm font-medium">Export font</h2>

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
        </Field>

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

        <label className="flex cursor-pointer items-center gap-2 pb-4 text-xs-plus">
          <input
            type="checkbox"
            checked={includeKerning}
            onChange={(event) => setIncludeKerning(event.target.checked)}
            className="size-3.5 accent-[var(--accent)]"
          />
          <span>
            Include kerning
            <span className="pl-1.5 text-2xs text-muted-foreground tabular-nums">
              {typeface.kerning.length.toLocaleString()} pairs
            </span>
          </span>
        </label>

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
            {working ? "Building…" : "Export"}
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

/**
 * Writing out a font that was read back as strokes.
 *
 * Shorter than the other two export dialogs, and the shortness is the point:
 * there is one weight because there is one trace, no family to draw because
 * nothing here is generated, and nothing to carry over from an original file
 * because what was read in was outlines and what goes out is a redrawing of
 * them. The only real decisions are the name and the curve format.
 *
 * What it does say, and says before the button rather than after, is what this
 * file is. Everywhere else in the application an export is your own work. Here
 * it is somebody else's letters recovered and redrawn, which is a derivative
 * work of their font whatever the representation in between, and the licence
 * that governs it is theirs and not ours. That belongs on screen at the moment
 * somebody is about to make the file, not in a help page they will not open.
 */

import * as React from "react";

import { enter, refuse } from "@/anim/motion";
import { exportFont, type ExportFormat } from "@/font/export";
import { toTypeface } from "@/quill/typeface";
import { quillStore, useQuill } from "@/state/useQuill";
import { OUTLINE_ACTION, PRIMARY_ACTION } from "@/components/controls";
import { cn } from "@/ui/lib/utils";

/** A file name that will survive a download folder. */
function fileNameFor(family: string, format: ExportFormat): string {
  const stem = family.trim().replace(/[^A-Za-z0-9]+/g, "") || "Traced";
  return `${stem}-Regular.${format}`;
}

export function QuillExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const state = useQuill();
  const { document: doc } = state;
  const [format, setFormat] = React.useState<ExportFormat>("ttf");
  const [name, setName] = React.useState(() => doc.name);
  const [working, setWorking] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (panelRef.current) enter(panelRef.current);
  }, []);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const download = async (): Promise<void> => {
    setWorking(true);
    setProblem(null);
    try {
      const family = name.trim() || "Traced";
      quillStore.setName(family);
      const typeface = await toTypeface(doc.letters, doc.style, doc.unitsPerEm, {
        familyName: family,
        styleName: "Regular",
        from: doc.from || "an unnamed font",
      });
      const written = await exportFont(typeface, {
        format,
        // Nothing to preserve: the source file's tables describe outlines that
        // are not the ones going out.
        fidelity: "rebuild",
        includeKerning: false,
        // Already fused in `toTypeface`, where the argument for it is written.
        mergeOverlaps: false,
      });
      const url = URL.createObjectURL(
        new Blob([written.bytes as BlobPart], {
          type: format === "otf" ? "font/otf" : "font/ttf",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFor(family, format);
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

  const choice = (on: boolean) =>
    cn(
      "flex-1 rounded-md border p-3 text-left transition-colors",
      on
        ? "border-accent bg-accent/10"
        : "border-border bg-card hover:border-[color:var(--muted-foreground)]",
    );

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
        aria-label="Download traced font"
      >
        <h2 className="pb-4 text-sm font-medium">Download the traced font</h2>

        <label className="block pb-4">
          <span className="text-2xs text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Font name"
            className="mt-1 h-8 w-full rounded-md border border-input bg-card px-2.5 text-xs-plus text-foreground outline-none focus-visible:border-accent"
          />
        </label>

        <span className="text-2xs text-muted-foreground">Format</span>
        <div className="flex gap-2 pb-4 pt-1.5" role="group" aria-label="Format">
          <button
            type="button"
            aria-pressed={format === "ttf"}
            onClick={() => setFormat("ttf")}
            data-quill-format="ttf"
            className={choice(format === "ttf")}
          >
            <span className="block text-xs-plus text-foreground">TrueType</span>
            <span className="block pt-1 text-2xs leading-snug text-muted-foreground">
              The widest support, and what most systems expect.
            </span>
          </button>
          <button
            type="button"
            aria-pressed={format === "otf"}
            onClick={() => setFormat("otf")}
            data-quill-format="otf"
            className={choice(format === "otf")}
          >
            <span className="block text-xs-plus text-foreground">OpenType</span>
            <span className="block pt-1 text-2xs leading-snug text-muted-foreground">
              Cubic curves, which is how these strokes are swept.
            </span>
          </button>
        </div>

        <p className="pb-2 text-2xs leading-relaxed text-muted-foreground">
          {doc.letters.length} letters, redrawn from the strokes recovered from{" "}
          <span className="text-foreground">{doc.from || "an unnamed font"}</span> with the hand
          you have set. The lines of the font — x-height, cap height, ascender, descender — are
          measured off these letters rather than carried over, so they describe what is actually
          being written.
        </p>

        {/*
          Said here, once, in the place where it matters.

          Not a warning and not a refusal: deriving from a font you have the
          right to derive from is ordinary work, and this half of the
          application exists to do it. What it is is a fact about the file
          somebody is one click from making, and it is easier to check a licence
          before the file exists than after it has been sent to somebody.
        */}
        <p
          className="mb-4 rounded-md border border-border bg-card p-2.5 text-2xs leading-relaxed text-muted-foreground"
          data-quill-derivative
        >
          This file is a derivative work of{" "}
          <span className="text-foreground">{doc.from || "the font you read in"}</span>. Its
          licence governs what you may do with what comes out, and the copyright field in the
          file says so. Point this only at a font you have the right to derive from.
        </p>

        {problem && (
          <p className="pb-3 text-2xs leading-snug text-[color:var(--destructive,#b4483f)]">
            {problem}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={OUTLINE_ACTION}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={working || doc.letters.length === 0}
            data-quill-download
            className={cn(PRIMARY_ACTION, (working || doc.letters.length === 0) && "opacity-60")}
          >
            {working ? "Writing…" : "Download"}
          </button>
        </div>
      </div>
    </div>
  );
}

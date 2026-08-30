/**
 * The checks view.
 *
 * Most font faults are invisible on the machine that made them and only show up
 * on someone else's screen. This is where they become visible while the work is
 * still open, with a way into the glyph that caused each one.
 *
 * Checking a large font walks every outline, so it runs when asked rather than
 * on every keystroke.
 */

import * as React from "react";

import { enterStaggered } from "@/anim/motion";
import { CoachMark } from "@/components/CoachMark";
import { validateTypeface, type Finding, type Severity, type ValidationReport } from "@/font/validate";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Note",
};

export function ReportView(): React.JSX.Element {
  const state = useAppState();
  const [report, setReport] = React.useState<ValidationReport | null>(null);
  const [running, setRunning] = React.useState(false);
  const [ranAt, setRanAt] = React.useState<number | null>(null);
  const [shown, setShown] = React.useState<Record<Severity, boolean>>({
    error: true,
    warning: true,
    info: true,
  });
  const listRef = React.useRef<HTMLDivElement>(null);

  const toggle = (severity: Severity) =>
    setShown((was) => ({ ...was, [severity]: !was[severity] }));

  const counts = React.useMemo(() => {
    const tally: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
    for (const finding of report?.findings ?? []) tally[finding.severity] += 1;
    return tally;
  }, [report]);

  const visible = React.useMemo(
    () => (report?.findings ?? []).filter((finding) => shown[finding.severity]),
    [report, shown],
  );

  const run = React.useCallback(async () => {
    if (!state.typeface) return;
    setRunning(true);
    // Let the pending state paint before the main thread goes to work.
    await new Promise((resolve) => setTimeout(resolve, 0));
    setReport(validateTypeface(state.typeface, { format: "truetype" }));
    setRanAt(state.revision);
    setRunning(false);
  }, [state.typeface, state.revision]);

  // Check once when a font is first opened, so the view is never empty.
  React.useEffect(() => {
    if (state.typeface && report === null && !running) void run();
  }, [state.typeface, report, running, run]);

  React.useEffect(() => {
    if (report && listRef.current) {
      enterStaggered(Array.from(listRef.current.children) as Element[], { step: 12 });
    }
  }, [report]);

  if (!state.typeface) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs-plus text-muted-foreground">
        Open a font to check it.
      </div>
    );
  }

  const stale = report !== null && ranAt !== state.revision;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CoachMark id="report" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        {report && (
          <>
            {/*
              The counts, and the counts are the filter.

              A report of six hundred findings is read by severity: you fix the
              errors, then you decide about the warnings, and the notes are
              mostly things you already know. The three numbers were on screen
              already and did nothing, which is a waste of the one control the
              list needed -- there was no way to put the notes away and look at
              what is actually wrong.

              Pressed is showing. A severity with nothing in it is not a
              filter, so it stays a plain number rather than becoming a button
              that changes nothing when pressed.
            */}
            <Count value={counts.error} label="error" tone="error" on={shown.error}
              onToggle={() => toggle("error")} />
            <Count value={counts.warning} label="warning" tone="warning" on={shown.warning}
              onToggle={() => toggle("warning")} />
            <Count value={counts.info} label="note" tone="info" on={shown.info}
              onToggle={() => toggle("info")} />
            <span className="text-2xs text-muted-foreground tabular-nums">
              {report.examined.toLocaleString()} glyphs checked
            </span>
          </>
        )}
        {stale && (
          <span className="text-2xs text-[var(--attention)]">
            The font has changed since this ran
          </span>
        )}
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-2xs transition-colors hover:border-accent hover:text-foreground disabled:opacity-50"
        >
          {running ? "Checking…" : stale ? "Check again" : "Run checks"}
        </button>
      </div>

      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        {report && report.findings.length === 0 && (
          <p className="py-16 text-center text-xs-plus text-muted-foreground">
            Nothing to report. Every check passed.
          </p>
        )}
        {/*
          Told apart from the line above it, because they mean opposite things:
          a clean font and a list you have hidden all of look identical
          otherwise, and one of them is good news.
        */}
        {report && report.findings.length > 0 && visible.length === 0 && (
          <p className="py-16 text-center text-xs-plus text-muted-foreground">
            {report.findings.length} findings, all of them put away. Turn a severity back on
            above.
          </p>
        )}
        <div ref={listRef} className="mx-auto flex max-w-3xl flex-col gap-2">
          {visible.map((finding) => (
            <FindingRow key={`${finding.check}-${finding.glyph ?? ""}`} finding={finding} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Count({
  value,
  label,
  tone,
  on,
  onToggle,
}: {
  value: number;
  label: string;
  tone: Severity;
  on: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const colour =
    tone === "error"
      ? "text-destructive"
      : tone === "warning"
        ? "text-[var(--attention)]"
        : "text-foreground";
  const words = `${value} ${label}${value === 1 ? "" : "s"}`;

  if (value === 0) {
    return <span className="text-2xs tabular-nums text-muted-foreground">{words}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      data-severity={tone}
      title={on ? `Put the ${label}s away` : `Show the ${label}s again`}
      className={cn(
        "rounded border px-1.5 py-0.5 text-2xs tabular-nums transition-colors",
        on ? cn("border-border bg-card", colour) : "border-transparent text-muted-foreground line-through",
      )}
    >
      {words}
    </button>
  );
}

function FindingRow({ finding }: { finding: Finding }): React.JSX.Element {
  return (
    <div
      data-finding={finding.severity}
      className={cn(
        "rounded-md border bg-card/40 p-3",
        finding.severity === "error"
          ? "border-destructive/50"
          : finding.severity === "warning"
            ? "border-[var(--attention)]/40"
            : "border-border",
      )}
    >
      <div className="flex items-baseline gap-2.5">
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium",
            finding.severity === "error"
              ? "bg-destructive/15 text-destructive"
              : finding.severity === "warning"
                ? "bg-[var(--attention)]/15 text-[var(--attention)]"
                : "bg-muted text-muted-foreground",
          )}
        >
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <span className="min-w-0 flex-1 text-xs-plus text-foreground">{finding.title}</span>
        {finding.glyph && (
          <button
            type="button"
            onClick={() => store.selectGlyph(finding.glyph!, { open: true })}
            className="shrink-0 text-2xs text-accent hover:underline"
          >
            Open {finding.glyph}
          </button>
        )}
      </div>
      <p className="pl-[3.6rem] pt-1 text-2xs leading-relaxed text-muted-foreground">
        {finding.detail}
      </p>
    </div>
  );
}

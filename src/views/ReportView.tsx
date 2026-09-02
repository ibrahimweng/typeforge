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
import {
  validateWholeTypeface,
  type CheckProgress,
  type Finding,
  type Severity,
  type ValidationReport,
} from "@/font/validate";
import { NothingDrawnYet } from "@/components/NothingDrawnYet";
import {
  SEVERITY_BADGE,
  SEVERITY_EDGE,
  SEVERITY_LABEL,
  SEVERITY_TEXT,
} from "@/components/severity";
import { hasLetters } from "@/font/library";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

export function ReportView(): React.JSX.Element {
  const state = useAppState();
  const [report, setReport] = React.useState<ValidationReport | null>(null);
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<CheckProgress | null>(null);
  const [ranAt, setRanAt] = React.useState<number | null>(null);
  const [shown, setShown] = React.useState<Record<Severity, boolean>>({
    error: true,
    warning: true,
    advice: true,
    info: true,
  });
  const listRef = React.useRef<HTMLDivElement>(null);

  const toggle = (severity: Severity) =>
    setShown((was) => ({ ...was, [severity]: !was[severity] }));

  const counts = React.useMemo(() => {
    const tally: Record<Severity, number> = { error: 0, warning: 0, advice: 0, info: 0 };
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
    setProgress({ done: 0, total: state.typeface.glyphs.length });
    // Let the pending state paint before the main thread goes to work.
    await new Promise((resolve) => setTimeout(resolve, 0));
    /*
     * The whole font, a batch at a time.
     *
     * This used to be one synchronous call capped at five thousand glyphs,
     * which kept the tab from freezing by not checking a fifth of a large font
     * and printing "0 errors" underneath. Now it breathes between batches: the
     * page stays usable, the count runs up while it works, and nothing is left
     * out.
     */
    const found = await validateWholeTypeface(
      state.typeface,
      { format: "truetype" },
      setProgress,
    );
    setReport(found);
    setRanAt(state.revision);
    /*
     * And told to the store, so the rest of the application can say so.
     *
     * This view knowing about the faults and nothing else knowing is how a
     * fault ships: the line under the top bar cannot point at one, the tab
     * cannot carry a count, and somebody has to remember to come here.
     */
    store.checked(found.findings, state.revision);
    setProgress(null);
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

  // A font with no letters is a different thing from no font, and every view
  // used to say the same about both.
  if (!hasLetters(state.typeface)) return <NothingDrawnYet what="check" />;

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
            {/*
              Advice is not a fault and is coloured as one it is not. It is a
              second opinion on the drawing -- every optical rule can be
              deliberately unfollowed -- so it takes the accent the application
              uses for things worth looking at rather than the red and amber it
              uses for things that are wrong.
            */}
            <Count value={counts.advice} label="piece of advice" tone="advice" on={shown.advice}
              onToggle={() => toggle("advice")} />
            <Count value={counts.info} label="note" tone="info" on={shown.info}
              onToggle={() => toggle("info")} />
            <span className="text-2xs text-muted-foreground tabular-nums">
              {report.examined.toLocaleString()} {report.examined === 1 ? "glyph" : "glyphs"}{" "}
              checked
            </span>
            {/*
              Kept, though nothing reaches it any more.

              The check used to stop at five thousand glyphs and say nothing
              about it, so a quarter of a large font went unexamined behind a
              headline of "0 errors"; this is what said so. It now checks the
              whole font, so `held` and `examined` agree and this stays dark --
              but the report can still be built with a limit, and a limit
              nobody is told about is indistinguishable from a clean result.
            */}
            {report.held > report.examined && (
              <span className="text-2xs text-[var(--attention)] tabular-nums">
                {(report.held - report.examined).toLocaleString()} not checked — this stopped at{" "}
                {report.examined.toLocaleString()}
              </span>
            )}
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
          {/*
            How far through, rather than merely that it is working.

            The same reasoning the tracer's progress bar is built on: this now
            walks the whole font instead of the first five thousand, so on a
            large one it has something to say for a few seconds, and a button
            that says only "Checking…" for that long is indistinguishable from
            one that has hung.
          */}
          {running
            ? progress && progress.total > 0
              ? `Checking… ${Math.round((progress.done / progress.total) * 100)}%`
              : "Checking…"
            : stale
              ? "Check again"
              : "Run checks"}
        </button>
      </div>

      <div className="toolcraft-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        {/*
          What the importer had to say about the file, which had nowhere to be
          said.

          These were appended to the status line in the top bar, which is capped
          at ten rem and truncates: a warning about the font somebody had just
          opened appeared as four characters and an ellipsis, and the rest of it
          lived in a tooltip nobody had a reason to hover. Here they sit above
          the findings and outside them, because they are facts about the *file*
          rather than about the drawing -- nothing in the letters is going to
          fix one, and running the checks again will not clear one either.
        */}
        {state.openWarnings.length > 0 && (
          <div
            data-open-warnings
            className="mb-4 rounded-md border border-[color:var(--attention)] bg-card p-3"
          >
            <p className="pb-1 text-2xs font-medium text-[var(--attention)]">
              {state.openWarnings.length === 1
                ? "One thing about the file this came from"
                : `${state.openWarnings.length} things about the file this came from`}
            </p>
            <ul className="space-y-1">
              {state.openWarnings.map((warning) => (
                <li key={warning} className="text-2xs leading-snug text-muted-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}
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
  const colour = SEVERITY_TEXT[tone];
  // "1 piece of advice" and "4 pieces of advice": the plural is not on the end.
  const words = value === 1 ? `${value} ${label}` : `${value} ${label.replace("piece of", "pieces of")}${label.startsWith("piece") ? "" : "s"}`;

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
        SEVERITY_EDGE[finding.severity],
      )}
    >
      <div className="flex items-baseline gap-2.5">
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium",
            SEVERITY_BADGE[finding.severity],
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

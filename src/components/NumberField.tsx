/**
 * A number you type, committed when you leave it.
 *
 * Shared rather than copied, because two places now edit the same numbers -- the
 * Spacing table down a column, and the glyph editor beside the letter -- and a
 * second copy of "when does this take effect" is how two views come to disagree
 * about whether Escape cancels.
 *
 * Committed on blur and on Enter rather than on every keystroke, which matters
 * more here than it looks. These fields drive an undoable edit: keystroke-by-
 * keystroke would put four entries on the undo stack for typing "1200", and
 * would briefly apply an advance width of 1 on the way there.
 */

import * as React from "react";

import { cn } from "@/ui/lib/utils";

export function NumberField({
  value,
  onCommit,
  label,
  className,
  disabled,
  decimals = 0,
}: {
  value: number;
  onCommit: (next: number) => void;
  label: string;
  className?: string;
  disabled?: boolean;
  /**
   * How many decimal places this field keeps. Nought, and it rounds.
   *
   * Every number this held was a font unit, where a fraction of a unit means
   * nothing and rounding is right. The pen's blade is not: it runs nought to
   * one, so rounding turned every value a person typed into one of the two
   * ends -- a pen asked for at 0.55 came back a blade with no thickness.
   */
  decimals?: number;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(String(value));
  // Follows the value when it changes underneath -- a nudge with the arrow
  // keys, an undo, a parameter that moved the outline -- so the field never
  // shows a number the glyph no longer has.
  React.useEffect(() => setDraft(String(value)), [value]);

  return (
    <input
      value={draft}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => {
        const parsed = Number(draft);
        const settled = decimals > 0 ? Number(parsed.toFixed(decimals)) : Math.round(parsed);
        if (Number.isFinite(parsed) && settled !== value) onCommit(settled);
        else setDraft(String(value));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
        // Kept off the canvas behind it, which nudges the selection on the
        // arrow keys and would otherwise move the point being typed about.
        event.stopPropagation();
      }}
      className={cn(
        "h-6 w-16 rounded border border-transparent bg-transparent px-1.5 text-right tabular-nums outline-none",
        "hover:border-border focus-visible:border-accent focus-visible:bg-card",
        disabled && "opacity-40",
        className,
      )}
    />
  );
}

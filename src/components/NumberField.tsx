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

import { cn } from "@/cn";

/**
 * What a draft settles to when the field is left: the number to commit, or
 * `null` for "put the old value back".
 *
 * Pulled out of the component so the rules can be tested without a DOM, and
 * because the rule that went wrong here was one of these rather than anything
 * to do with React. `Number("")` is 0, not NaN, so a field someone cleared and
 * walked away from used to commit a zero -- an advance width of nothing, a
 * kerning pair wiped -- when what a person clearing a field and leaving it
 * almost always means is "never mind". Blank, or only spaces, reverts.
 *
 * Also `null` when the number would not change, so that leaving a field the
 * way it was found does not put an entry on the undo stack.
 */
export function settleDraft(draft: string, value: number, decimals = 0): number | null {
  if (draft.trim() === "") return null;
  const parsed = Number(draft);
  if (!Number.isFinite(parsed)) return null;
  const settled = decimals > 0 ? Number(parsed.toFixed(decimals)) : Math.round(parsed);
  return settled === value ? null : settled;
}

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
  /*
   * Set by Escape, read by the blur that Escape causes.
   *
   * Escape used to reset the draft and then blur, and the blur committed. The
   * reset is a state update, so it had not landed yet when `onBlur` ran in the
   * same event: the handler still closed over the typed draft and committed
   * exactly what Escape was meant to throw away. A ref is read at the moment
   * of the blur rather than at the last render, so it cannot be stale.
   */
  const cancelling = React.useRef(false);
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
        if (cancelling.current) {
          cancelling.current = false;
          setDraft(String(value));
          return;
        }
        const settled = settleDraft(draft, value, decimals);
        if (settled !== null) onCommit(settled);
        else setDraft(String(value));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelling.current = true;
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

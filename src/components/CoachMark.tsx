/**
 * A tip shown once, where it applies.
 *
 * Deliberately not an overlay. A spotlight tour teaches a sequence, which is
 * the wrong shape for a tool people arrive at from different directions -- one
 * person opens a font to change its weight, another to fix one letter's
 * spacing, and neither wants to be walked past the other's screen first. This
 * takes a line of space at the top of whatever you opened, says the one thing
 * that is not visible from looking at it, and goes away.
 */

import * as React from "react";

import { holdTipSlot, markTipSeen, subscribeToTips, TIPS, tipOnDuty, type TipId } from "@/help/tips";
import { cn } from "@/ui/lib/utils";

export function CoachMark({ id, className }: { id: TipId; className?: string }): React.JSX.Element | null {
  // Say this mark is on screen, so the rule about showing one at a time knows
  // it is in the running.
  React.useEffect(() => holdTipSlot(id), [id]);

  // Read through a subscription so the help drawer's "show tips again" brings
  // them back without a reload.
  const onDuty = React.useSyncExternalStore(
    subscribeToTips,
    tipOnDuty,
    () => null, // Server-rendered: show nothing, so none of them flash in and out.
  );
  const [dismissing, setDismissing] = React.useState(false);

  if (onDuty !== id) return null;

  return (
    <div
      role="note"
      data-coach-mark={id}
      className={cn(
        "flex items-start gap-3 border-b border-border bg-[color:color-mix(in_oklab,var(--accent)_7%,transparent)] px-4 py-2",
        "transition-opacity duration-150",
        dismissing && "opacity-0",
        className,
      )}
    >
      <p className="min-w-0 flex-1 text-2xs leading-snug text-muted-foreground">{TIPS[id]}</p>
      <button
        type="button"
        onClick={() => {
          setDismissing(true);
          // Let the fade finish before the element leaves, so a row of content
          // does not jump up under the pointer mid-click.
          window.setTimeout(() => markTipSeen(id), 150);
        }}
        className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
      >
        Got it
      </button>
    </div>
  );
}

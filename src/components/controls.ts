/**
 * How interactive controls look.
 *
 * Defined once so the toolbar and the panels cannot drift apart. They were
 * written separately and had already diverged: the same segmented control read
 * differently depending on which side of the window it was on.
 *
 * Two things this fixes.
 *
 * A selected tab used to be bg-card sitting on a bg-card/60 track -- the same
 * colour at two opacities, a difference of forty percent alpha on a small
 * shape. Which view you were in was genuinely hard to see. Selection now
 * changes the surface, the text weight and the ring together, so it reads at a
 * glance rather than on inspection.
 *
 * Hover used to change only the text colour, so nothing happened until the
 * pointer was already on the label. The whole control now lights up, which is
 * what makes a row of tabs feel like buttons rather than text.
 */

import { cn } from "@/ui/lib/utils";

/** The track a segmented control sits in. */
export const SEGMENT_TRACK = "flex items-center gap-0.5 rounded-md bg-card/60 p-0.5";

/**
 * One segment of a segmented control: a view tab, a tool, a panel scope.
 *
 * The selected segment is lifted off the track with its own surface and a ring;
 * the rest are quiet until hovered.
 */
export function segment(selected: boolean, extra?: string): string {
  return cn(
    "rounded px-2.5 py-1 text-2xs transition-colors",
    selected
      ? "bg-background font-medium text-foreground ring-1 ring-[color:var(--border)]"
      : "text-muted-foreground hover:bg-card hover:text-foreground",
    extra,
  );
}

/** A quiet action that lives in a toolbar, such as undo. */
export const TOOLBAR_ACTION =
  "rounded px-2 py-1 text-2xs text-muted-foreground transition-colors " +
  "hover:bg-card hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent " +
  "disabled:hover:text-muted-foreground";

/** An outlined action, such as opening a font. */
export const OUTLINE_ACTION =
  "rounded-md border border-border px-2.5 py-1 text-2xs transition-colors " +
  "hover:border-muted-foreground hover:bg-card";

/** The one action a screen is really for. */
export const PRIMARY_ACTION =
  "rounded-md bg-accent px-2.5 py-1 text-2xs text-accent-foreground transition-[background-color,opacity] " +
  "hover:bg-[color:color-mix(in_oklab,var(--accent)_88%,white)] disabled:opacity-40";

/**
 * A tile that can be picked, such as a glyph in the grid or a control letter.
 *
 * Selection is shown with the accent rather than a border colour alone, so a
 * picked tile is distinguishable from one merely hovered.
 */
export function tile(selected: boolean, extra?: string): string {
  return cn(
    "transition-colors",
    selected
      ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_12%,transparent)]"
      : "border-border hover:border-muted-foreground hover:bg-card",
    extra,
  );
}

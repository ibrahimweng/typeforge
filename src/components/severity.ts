/**
 * How a fault is named and coloured, in every place a fault is shown.
 *
 * There are two of those now -- the Checks view, which lists what is wrong with
 * the font, and the strip above the canvas, which says what is wrong with the
 * letter in front of you -- and the same fault has to look the same in both or
 * a person learns the colours twice.
 *
 * Advice is not coloured as a fault on purpose. Errors and warnings are about
 * whether the font works; advice is a second opinion on the drawing, and every
 * optical rule can be deliberately unfollowed, so it takes the accent this
 * application uses for things worth looking at rather than the red and amber it
 * uses for things that are wrong.
 */

import type { Severity } from "@/font/validate";

/** What the severity is called on screen. */
export const SEVERITY_LABEL: Record<Severity, string> = {
  error: "Error",
  warning: "Warning",
  advice: "Advice",
  info: "Note",
};

/** The little block the label sits in. */
export const SEVERITY_BADGE: Record<Severity, string> = {
  error: "bg-destructive/15 text-destructive",
  warning: "bg-[var(--attention)]/15 text-[var(--attention)]",
  advice: "bg-accent/15 text-accent",
  info: "bg-muted text-muted-foreground",
};

/** The edge around a whole finding. */
export const SEVERITY_EDGE: Record<Severity, string> = {
  error: "border-destructive/50",
  warning: "border-[var(--attention)]/40",
  advice: "border-accent/40",
  info: "border-border",
};

/** The colour of a bare count. */
export const SEVERITY_TEXT: Record<Severity, string> = {
  error: "text-destructive",
  warning: "text-[var(--attention)]",
  advice: "text-accent",
  info: "text-foreground",
};

/**
 * What is wrong with the letter you are looking at, above the letter.
 *
 * The application could already find every one of these faults and only ever
 * said so on a separate page, after you had finished and gone looking. That is
 * the wrong moment: an unclosed outline is a thing to fix while the pen is
 * still in your hand, and a beginner does not know to go and check.
 *
 * So the same checks run against this one glyph -- one rather than six thousand,
 * which costs nothing -- and say what they find here, in the second person,
 * about this letter. Nothing is cached, so nothing can be out of date, and the
 * strip is not drawn at all when there is nothing to say. It never becomes
 * furniture.
 */

import * as React from "react";

import { SEVERITY_BADGE, SEVERITY_EDGE, SEVERITY_LABEL } from "@/components/severity";
import { faultsOfGlyph } from "@/font/validate";
import type { Glyph, Typeface } from "@/font/types";
import { cn } from "@/ui/lib/utils";

export function GlyphFaults({
  typeface,
  glyph,
  revision,
}: {
  typeface: Typeface;
  glyph: Glyph;
  /** Bumped on every edit, so this is asked again after every one of them. */
  revision: number;
}): React.JSX.Element | null {
  /*
   * The revision is in here on purpose, and it is the dependency that matters.
   *
   * A glyph is edited in place in the store, so the object identity survives a
   * point being dragged and this would answer with the outline as it was when
   * the letter was opened. The revision is what says an edit happened.
   */
  const findings = React.useMemo(
    () => faultsOfGlyph(typeface, glyph),
    [typeface, glyph, revision],
  );

  if (findings.length === 0) return null;

  /*
   * Laid over the canvas rather than above it, which is not a decoration.
   *
   * The first version took its own row in the column, so the moment a fault
   * appeared the canvas moved down by the height of the strip -- while the pen
   * was still in the hand that had just caused it. Drawing the third point of
   * an open contour shifted the drawing under the pointer by thirty pixels,
   * and the first test written for this caught it by then missing the point it
   * had aimed at. A message about a mistake must not move the work.
   *
   * `pointer-events-none` for the same reason: this sits on the one surface in
   * the application that is drawn on, and nothing informational may swallow a
   * click meant for the pen.
   *
   * Worst first, so the edge takes the colour of the worst.
   */
  return (
    <div
      data-glyph-faults={findings.length}
      aria-label={`What is wrong with ${glyph.name}`}
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-1 border-b bg-background/85 px-4 py-1.5 backdrop-blur-sm",
        SEVERITY_EDGE[findings[0].severity],
      )}
    >
      {findings.map((finding) => (
        <div
          key={finding.check}
          data-glyph-fault={finding.severity}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-2xs"
        >
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-medium",
              SEVERITY_BADGE[finding.severity],
            )}
          >
            {SEVERITY_LABEL[finding.severity]}
          </span>
          <span className="text-foreground">{finding.title}.</span>
          <span className="min-w-0 flex-1 text-muted-foreground">{finding.detail}</span>
        </div>
      ))}
    </div>
  );
}

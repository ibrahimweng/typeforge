/**
 * Which document a check was run on, so its answer is only ever given to that
 * document.
 *
 * A check runs for seconds on a large font, breathing between batches, and
 * the application does not stop while it runs: somebody can switch tabs, open
 * another font, or borrow a letter. The Checks view used to hold one report
 * for whatever happened to be in front, so after a switch the last font's
 * findings stayed on screen under the new font's name -- and a run still going
 * when the switch happened finished by writing the old font's faults into the
 * new one's record, where the top bar and the tab count read them from.
 *
 * The view is not keyed per document from outside, and cannot be from here,
 * so it asks this instead: every run is stamped with the document it started
 * on and a number, and its results are thrown away unless both still hold
 * when they arrive.
 */

import type { AppState } from "@/state/model";

/**
 * The font in front, as something that can be compared.
 *
 * The tab's id rather than the typeface, because the typeface is a new object
 * after every edit and an edit is not a different document. A borrowed letter
 * is: during a loan the typeface in front is a desk with one glyph on it, and
 * a report about the whole font is not a report about that.
 */
export function documentKey(state: Pick<AppState, "open" | "openAt" | "loan">): string {
  const id = state.open[state.openAt]?.id ?? "";
  return state.loan ? `${id}#loan` : id;
}

/** Thrown out of a run that somebody else has since superseded. */
export class Superseded extends Error {
  constructor() {
    super("superseded");
    this.name = "Superseded";
  }
}

/**
 * The runs of one view, numbered, so only the latest may speak.
 *
 * `start` hands out a ticket; `current` says whether that ticket is still the
 * one that counts -- the newest issued, not cancelled, and on the document
 * that is in front now. `cancel` voids every ticket, which is what switching
 * document does.
 */
export class RunGuard {
  private issued = 0;

  start(document: string): { run: number; document: string } {
    this.issued += 1;
    return { run: this.issued, document };
  }

  cancel(): void {
    this.issued += 1;
  }

  current(ticket: { run: number; document: string }, now: string): boolean {
    return ticket.run === this.issued && ticket.document === now;
  }
}

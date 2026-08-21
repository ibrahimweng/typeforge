/**
 * The session, gathered from the three halves and handed back to them.
 *
 * The application keeps three documents -- a font being edited, a font being
 * drawn, a font being assembled -- in three stores that know nothing about each
 * other, which is right: an edit to a bowl has no business reaching the pile of
 * SVGs. Saving is the one operation that has to see all three at once, so it
 * lives here rather than in any of them.
 *
 * Restoring puts back only the halves the document actually holds. Somebody who
 * saved a drawing and then opened a font should not find the font wiped by a
 * file that never mentioned one.
 */

import { assembleStore } from "@/state/useAssemble";
import { forgeStore } from "@/state/useForge";
import { store } from "@/state/useStore";
import { toProject, type Mode, type Project } from "./format";

/** Everything worth keeping, as it stands. */
export function session(mode: Mode, at = new Date()): Project {
  return toProject(
    {
      mode,
      draw: forgeStore.snapshot(),
      assemble: assembleStore.snapshot(),
      edit: store.snapshot(),
    },
    at,
  );
}

export interface Restored {
  /** Which half to show, which is the one that was open when it was saved. */
  mode: Mode;
  /** What came back, in the words the interface uses. */
  halves: string[];
}

/**
 * Put a document back.
 *
 * The edited half is last and is awaited, because it is the only one that has
 * to read a font file to do its work -- the other two are objects and land
 * immediately.
 */
export async function restore(project: Project): Promise<Restored> {
  const halves: string[] = [];

  if (project.draw) {
    forgeStore.restore(project.draw);
    halves.push("the drawing");
  }
  if (project.assemble) {
    assembleStore.restore(project.assemble);
    halves.push("the assembled set");
  }
  if (project.edit) {
    await store.restore(project.edit);
    halves.push(project.edit.fileName);
  }

  return { mode: project.mode, halves };
}

/** A file name for a saved session, from whatever it is a font of. */
export function fileNameFor(project: Project): string {
  const named =
    project.draw?.familyName ??
    project.assemble?.familyName ??
    project.edit?.meta.familyName ??
    "Untitled";
  const tidy = named.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Untitled";
  return `${tidy}.typeforge`;
}

/**
 * The session, gathered from the three halves and handed back to them.
 *
 * The application keeps four documents -- a font being edited, a font being
 * drawn, a font being assembled, a font read back as strokes -- in four stores
 * that know nothing about each other, which is right: an edit to a bowl has no
 * business reaching the pile of SVGs. Saving is the one operation that has to
 * see all four at once, so it lives here rather than in any of them.
 *
 * Restoring puts back only the halves the document actually holds. Somebody who
 * saved a drawing and then opened a font should not find the font wiped by a
 * file that never mentioned one.
 */

import { assembleStore } from "@/state/useAssemble";
import { drawingToKeep, restoreDrawing } from "@/state/drawn";
import { quillStore } from "@/state/useQuill";
import { store } from "@/state/useStore";
import { toProject, type Mode, type Project } from "./format";

/**
 * Everything worth keeping, as it stands.
 *
 * Three of the four halves are asked directly and the drawn one is not, because
 * the store that holds it carries the drawing engine and is not loaded until
 * somebody opens that half. `drawingToKeep` answers for it: nothing at all
 * until the store exists, and nothing after that either unless what is in it is
 * work rather than the style the application opens on.
 */
export function session(mode: Mode, at = new Date()): Project {
  return toProject(
    {
      mode,
      draw: drawingToKeep(),
      assemble: assembleStore.snapshot(),
      edit: store.snapshot(),
      traced: quillStore.snapshot(),
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
 * The edited half is late and is awaited, because it has to read a font file to
 * do its work. The drawn half is awaited for a different reason: putting it
 * back means fetching the engine that draws it, and the mode this returns is
 * acted on the moment it lands.
 */
export async function restore(project: Project): Promise<Restored> {
  const halves: string[] = [];

  if (project.draw) {
    await restoreDrawing(project.draw);
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
  if (project.traced) {
    quillStore.restoreSaved(project.traced);
    halves.push(`${project.traced.letters.length} traced letters`);
  }

  return { mode: project.mode, halves };
}

/** A file name for a saved session, from whatever it is a font of. */
export function fileNameFor(project: Project): string {
  const named =
    project.draw?.familyName ??
    project.assemble?.familyName ??
    project.edit?.meta.familyName ??
    project.traced?.name ??
    "Untitled";
  const tidy = named.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Untitled";
  return `${tidy}.typeforge`;
}

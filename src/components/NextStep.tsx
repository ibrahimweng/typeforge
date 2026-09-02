/**
 * One line saying what to do next, and the button that does it.
 *
 * A person who has never drawn a typeface knows what each screen shows and not
 * what it is for. Everything this tool can do was reachable and nothing said
 * which of it to do first, so the order of the work had to be known before you
 * arrived. This says it: the next unfinished thing, in a sentence, with the
 * one control that starts it.
 *
 * What it will not do is guess. Every step below is read off the document
 * itself -- how many letters there are, what the font is called, whether
 * anything is kerned, whether there is a drawing to hand over -- so the line is
 * never wrong about the state of the work. Nothing here records what you have
 * looked at, because a step that says "you have not visited spacing" is a claim
 * about a person rather than about a font.
 *
 * Somebody who knows the craft turns it off. Once, from the line itself, and it
 * stays off in this browser.
 */

import * as React from "react";

import { OUTLINE_ACTION, PRIMARY_ACTION } from "@/components/controls";
import type { Mode } from "@/App";
import { hasLetters } from "@/font/library";
import { useAssemble } from "@/state/useAssemble";
import { useForge } from "@/state/useForge";
import { useQuill } from "@/state/useQuill";
import { store, useAppState } from "@/state/useStore";

const OFF = "typeforge.nextStep.off";

/** Whether the line has been turned off for good, in this browser. */
function silenced(): boolean {
  try {
    return globalThis.localStorage?.getItem(OFF) === "yes";
  } catch {
    // A browser with storage blocked is a browser that gets the line every
    // visit, which is better than one that throws on the way to drawing.
    return false;
  }
}

/** What to do next, said plainly, with the one thing that starts it. */
interface Step {
  /*
   * Which step this is, so a change of step is a change of key.
   *
   * Every label below is also chosen not to be the label of a button already on
   * screen. Two buttons reading "Export" is a thing a person has to look twice
   * at, and it made twelve tests ambiguous besides.
   */
  id: string;
  said: string;
  action?: { label: string; go: () => void };
}

export function NextStep({
  mode,
  onName,
  onExport,
  onEditForged,
  onEditTraced,
  onEditAssembled,
}: {
  mode: Mode;
  onName: () => void;
  onExport: () => void;
  onEditForged: () => void;
  onEditTraced: () => void;
  onEditAssembled: () => void;
}): React.JSX.Element | null {
  const state = useAppState();
  const forge = useForge();
  const quill = useQuill();
  const assemble = useAssemble();
  const [off, setOff] = React.useState(silenced);

  const step = React.useMemo<Step | null>(() => {
    if (mode === "forge") {
      /*
       * Undo is the honest test of "has this person changed anything". The
       * forge draws a whole alphabet before you arrive, so a letter on screen
       * says nothing; a thing on the undo stack says you did it.
       */
      if (!forge.canUndo)
        return {
          id: "forge-touch",
          said: "Pick a style on the right, then drag Weight to make it yours.",
        };
      return {
        id: "forge-hand",
        said: "Happy with it? Take the letters to the editor to shape them by hand.",
        action: { label: "Open in the editor", go: onEditForged },
      };
    }

    if (mode === "quill") {
      if (quill.document.letters.length === 0)
        return {
          id: "quill-read",
          said: "Choose a font on the right to read it back into strokes you can reshape.",
        };
      return {
        id: "quill-hand",
        said: "The strokes are yours to change. Take them to the editor when you want the pen tools.",
        action: { label: "Open in the editor", go: onEditTraced },
      };
    }

    if (mode === "assemble") {
      if (assemble.assembly.pieces.length === 0)
        return {
          id: "assemble-add",
          said: "Add the drawings you made elsewhere, on the right, and they become letters.",
        };
      return {
        id: "assemble-hand",
        said: "Take the letters to the editor to space them and shape them.",
        action: { label: "Open in the editor", go: onEditAssembled },
      };
    }

    const typeface = state.typeface;
    // No font, no next step: the start screen is the whole of the screen.
    if (!typeface) return null;

    if (!hasLetters(typeface))
      return {
        id: "edit-letters",
        said: "Nothing is drawn yet. Start with a letter.",
        action: {
          label: "Add a letter",
          go: () => {
            store.setView("grid");
          },
        },
      };

    const name = typeface.meta.familyName.trim();
    if (name === "" || name.startsWith("Untitled"))
      return {
        id: "edit-name",
        said: "Give your font a name. It is what every menu will list it under.",
        action: { label: "Name it", go: onName },
      };

    if (typeface.kerning.length === 0)
      return {
        id: "edit-kern",
        said: "Some pairs of letters sit too far apart or too close. Kerning fixes those.",
        action: {
          label: "Open kerning",
          go: () => {
            store.setView("kerning");
          },
        },
      };

    /*
     * And no rung for the checks, on purpose, until they are live.
     *
     * The obvious one -- "you have not looked at Checks yet" -- is a claim
     * about a person rather than about a font, which is the one thing this line
     * does not do. The honest version is "this font has faults", and that means
     * running a whole-font validation, which is the slow job with a progress
     * bar. It joins the ladder when the report becomes something the rest of
     * the app can read rather than something one view computes for itself.
     */
    return {
      id: "edit-export",
      said: "That is a font. Write it out and install it.",
      action: { label: "Export the font", go: onExport },
    };
  }, [
    mode,
    forge.canUndo,
    quill.document.letters.length,
    assemble.assembly.pieces.length,
    state.typeface,
    onName,
    onExport,
    onEditForged,
    onEditTraced,
    onEditAssembled,
  ]);

  if (off || !step) return null;

  return (
    <div
      data-next-step={step.id}
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-accent/5 px-3 py-1.5"
    >
      <span className="min-w-0 flex-1 truncate text-2xs text-foreground">{step.said}</span>
      {step.action && (
        <button type="button" onClick={step.action.go} className={PRIMARY_ACTION}>
          {step.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setOff(true);
          try {
            globalThis.localStorage?.setItem(OFF, "yes");
          } catch {
            // Turned off for this visit, which is the whole of what was asked.
          }
        }}
        title="Stop showing what to do next"
        className={OUTLINE_ACTION}
      >
        Turn this off
      </button>
    </div>
  );
}

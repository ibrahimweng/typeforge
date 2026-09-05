/**
 * The palette's half of the shell: reading and writing a drawing.
 *
 * These twelve were built in App.tsx and handed down. Every one of them
 * reaches `forgeStore`, and `forgeStore` imports the drawing engine, so App
 * was importing the engine on the first screen in order to describe controls
 * for a palette nobody had opened.
 *
 * They are here instead, in the palette, which is fetched when it is first
 * shown. Nothing about them changed on the way: they still read the store on
 * every call rather than closing over a render, for the reason the note in
 * App.tsx gives -- a palette that reads a value it wrote a frame ago draws the
 * slider back where it started.
 */

import { castFor, castOf, cutsFor, cutsOf } from "@/forge/read";
import { forgeStore } from "@/state/useForge";

import type { CastName } from "@/forge/cast";
import type { CutName } from "@/forge/cut";
import type { ForgeShell } from "./catalogue";

export function forgeControls(): ForgeShell {
  return {
    partOf: (part, key) =>
      (
        forgeStore.getSnapshot().forge.style.parts[part] as Record<
          string,
          number | string | boolean
        >
      )[key],
    setPart: (part, key, value, done) =>
      forgeStore.changePart(part, { [key]: value }, done ? "end" : "during"),
    penOf: (key) =>
      (forgeStore.getSnapshot().forge.style.pen as unknown as Record<string, number>)[key],
    setPen: (key, value, done) =>
      forgeStore.changePen({ [key]: value } as never, done ? "end" : "during"),
    metricOf: (key) =>
      (forgeStore.getSnapshot().forge.style.metrics as unknown as Record<string, number>)[key],
    setMetric: (key, value, done) =>
      forgeStore.changeMetrics({ [key]: value } as never, done ? "end" : "during"),
    /*
     * Read through the same scope the cut panel reads through.
     *
     * A cut is not kept on the style beside the pen -- it belongs to the
     * document, and in letter scope a letter can be cut differently from the
     * font around it. Reading the family's value while the panel shows the
     * letter's would put a number in the palette that nothing on the canvas is
     * cut by, so the palette asks the question the panel asks.
     */
    cutOf: (cut: CutName, key: string) => {
      const { forge, scope, letter } = forgeStore.getSnapshot();
      const cuts = scope === "letter" ? cutsFor(letter, forge) : cutsOf(forge);
      return (cuts[cut] as unknown as Record<string, number | string | boolean>)[key];
    },
    setCut: (cut, key, value, done) =>
      forgeStore.changeCut(cut, { [key]: value } as never, done ? "end" : "during"),
    castOf: (cast: CastName, key: string) => {
      const { forge, scope, letter } = forgeStore.getSnapshot();
      const worn = scope === "letter" ? castFor(letter, forge) : castOf(forge);
      return (worn[cast] as unknown as Record<string, number | string | boolean>)[key];
    },
    setCast: (cast, key, value, done) =>
      forgeStore.changeCast(cast, { [key]: value } as never, done ? "end" : "during"),
    startFromBase: (name) => forgeStore.startFromBase(name),
    chooseAlternate: (letter, form) => {
      forgeStore.select(letter);
      forgeStore.chooseAlternate(form);
    },
  };
}

/**
 * Documents written before the fields they are missing.
 *
 * This application writes the drawing into the browser as it goes and reads it
 * back on the next visit, so every field added to a drawing is a field that
 * somebody's kept document does not have. That is fine for an optional one and
 * fatal for a required one: a `parts` object with a key missing is not a
 * document that reads a little oddly, it is `undefined.on` thrown on the first
 * letter drawn, and with the whole tree unmounted and the page nearly black
 * what the person sees is a black screen with nothing on it.
 *
 * Which is what happened. The join went in as a required part, the reader was
 * not told, and anybody who had opened the page before that day lost it.
 *
 * So this walks the parts the current shape has and checks each one can be
 * missing -- not the one that was missed last time. A test naming `script`
 * would have been written the same day the bug was, and would have passed.
 */
import { describe, expect, it } from "vitest";

import { drawLetter } from "@/forge/build";
import { startFrom, whole, type Forge } from "@/forge/document";
import { BASES, SANS, type Parts } from "@/forge/style";
import { readProject } from "./format";

/*
 * A document as the application gets it: read from the file, then filled in.
 *
 * Those are two steps rather than one. `readProject` hands back the drawing as
 * it was written, and `whole` makes it a current one -- and `whole` has to know
 * every field a style can have, which is the drawing engine. Reading happens on
 * the first screen, to say what is in the browser; filling in waits until
 * somebody actually opens a drawing. `forgeStore.restore` is where they meet.
 */
function opened(raw: unknown): Forge | undefined {
  const project = readProject(raw);
  return project?.draw ? whole(project.draw.forge) : undefined;
}

/** A document as it would have been written before `part` existed. */
function savedWithout(part: string): unknown {
  const forge = JSON.parse(JSON.stringify(startFrom(SANS)));
  delete forge.style.parts[part];
  return {
    typeforge: 1,
    saved: new Date(0).toISOString(),
    mode: "forge",
    draw: { familyName: "Kept", forge },
  };
}

const PARTS = Object.keys(SANS.parts) as Array<keyof Parts>;

describe("a drawing kept before a part existed", () => {
  it("has parts to check", () => {
    expect(PARTS.length).toBeGreaterThan(5);
  });

  it.each(PARTS)("still opens when %s is missing, and still draws", (part) => {
    const forge = opened(savedWithout(part));
    expect(forge).toBeTruthy();
    const style = forge!.style;
    expect(style.parts[part]).toBeDefined();
    // The letter is the real check: a filled-in part that is filled in wrongly
    // throws here rather than in front of somebody.
    expect(drawLetter("n", style)!.contours.length).toBeGreaterThan(0);
  });

  /*
   * The neutral setting, not the current face's. A part that did not exist was
   * a part nobody had set, so what the drawing was actually made with is
   * whatever that part does when it is doing nothing.
   */
  it("fills a missing part with the setting that changes nothing", () => {
    const style = opened(savedWithout("script"))!.style;
    expect(style.parts.script).toEqual(SANS.parts.script);
    expect(style.parts.script.on).toBe(false);
  });

  it("leaves a document that has everything exactly as it was", () => {
    for (const base of BASES) {
      const forge = startFrom(base);
      expect(whole(forge).style.parts).toEqual(forge.style.parts);
    }
  });

  /*
   * And the fields above `parts`, which were filled in before this and are
   * checked here so that the two kinds of filling-in cannot drift apart.
   */
  it("still fills the document's own fields", () => {
    const bare = JSON.parse(JSON.stringify(startFrom(SANS)));
    delete bare.family;
    delete bare.cuts;
    delete bare.cast;
    delete bare.kit;
    const back = whole(bare);
    expect(back.family).toBeDefined();
    expect(back.cuts).toBeDefined();
    expect(back.cast).toBeDefined();
    expect(back.kit).toBeDefined();
  });
});

/*
 * The cases a review found after the first version of this shipped. Each one is
 * a way the filling-in could look right and not be: a field inside a group
 * rather than the group itself, a null where a key was expected, a document
 * with nothing in it at all.
 */
describe("the quieter ways a kept drawing can be out of date", () => {
  const aged = (edit: (forge: Record<string, never>) => void): unknown => {
    const forge = JSON.parse(JSON.stringify(startFrom(SANS)));
    edit(forge);
    return {
      typeforge: 1,
      saved: new Date(0).toISOString(),
      mode: "forge",
      draw: { familyName: "Kept", forge },
    };
  };

  /*
   * The loud case throws and is over with. This one does not: a measurement
   * built on a missing number is NaN, every measurement built on that is NaN,
   * and a font of NaN coordinates draws nothing whatever and says nothing
   * either.
   */
  it("fills a field missing from inside a part, not just a whole part", () => {
    const style = opened(
      aged((forge) => {
        delete (forge as any).draw;
        delete (forge as any).style.parts.bowl.width;
        delete (forge as any).style.parts.slab.bracket;
      }),
    )!.style;
    expect(style.parts.bowl.width).toBe(SANS.parts.bowl.width);
    expect(style.parts.slab.bracket).toBe(SANS.parts.slab.bracket);
    const drawn = drawLetter("o", style)!;
    for (const contour of drawn.contours) {
      for (const node of contour.nodes) {
        expect(Number.isFinite(node.point.x) && Number.isFinite(node.point.y)).toBe(true);
      }
    }
  });

  it("fills the metrics and the pen the same way", () => {
    const style = opened(
      aged((forge) => {
        delete (forge as any).style.metrics.width;
        delete (forge as any).style.pen.contrast;
      }),
    )!.style;
    expect(style.metrics.width).toBe(SANS.metrics.width);
    expect(style.pen.contrast).toBe(SANS.pen.contrast);
  });

  /*
   * A key written as JSON null rather than left out, which is what plenty of
   * tools do. It is not undefined, so a check for undefined walks past it and
   * the letter throws on `null.on` instead of on `undefined.on`.
   */
  it("treats a null as missing rather than as a setting", () => {
    const style = opened(
      aged((forge) => {
        (forge as any).style.parts.script = null;
        (forge as any).style.parts.ball = null;
      }),
    )!.style;
    expect(style.parts.script).toEqual(SANS.parts.script);
    expect(drawLetter("n", style)!.contours.length).toBeGreaterThan(0);
  });

  /*
   * Key order is not usually anybody's business. It is here: whether there is
   * work worth keeping is decided by comparing two `JSON.stringify` results, so
   * a document whose keys came back shuffled would read as changed for ever and
   * be written over the top of itself on every edit.
   */
  it("gives the parts back in the order the plain face has them", () => {
    const style = opened(
      aged((forge) => {
        // A group that is not the last one, which is the case that can shuffle.
        delete (forge as any).style.parts.bowl;
      }),
    )!.style;
    expect(Object.keys(style.parts)).toEqual(Object.keys(SANS.parts));
  });

  it("keeps a setting this version no longer knows about", () => {
    const style = opened(
      aged((forge) => {
        (forge as any).style.parts.gargoyle = { on: true };
      }),
    )!.style;
    expect((style.parts as any).gargoyle).toEqual({ on: true });
  });

  /*
   * The tool settings gained their budget a day after the rest of them, so a
   * drawing kept in between has one and not the other -- and an undefined
   * budget is not an unlimited one, it is a cap that is quietly never applied.
   */
  it("fills a tool setting added after the tool was", () => {
    const effects = opened(
      aged((forge) => {
        (forge as any).effects = {
          rough: { on: true, amplitude: 0.05, wavelength: 0.9, reach: "all", seed: 1 },
        };
      }),
    )!.effects!;
    expect(effects.budget).toBeGreaterThan(0);
    expect(effects.pool).toBeDefined();
    expect(effects.rough.on).toBe(true);
  });

  it("leaves a drawing with no tool settings without any", () => {
    const forge = opened(
      aged((forge) => {
        delete (forge as any).effects;
      }),
    );
    expect(forge!.effects).toBeUndefined();
  });

  /*
   * And a document with no drawing in it at all is turned away rather than
   * fabricated. Before this it threw, and it threw inside a database event
   * handler where nothing was waiting to catch it.
   */
  it("turns away a document with no style rather than fabricating one", () => {
    const bare = aged((forge) => {
      delete (forge as any).style;
    });
    expect(() => readProject(bare)).not.toThrow();
    expect(readProject(bare)?.draw).toBeUndefined();
  });
});

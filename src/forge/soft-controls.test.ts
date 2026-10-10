/**
 * The soft finishes, as the panel offers them.
 *
 * Eight of the soft serif's settings are sliders: the tips and arms of the
 * serif, the cuts and the taper of a terminal, the inside of a join, the tail
 * and the heft of a bowl, and the rise of an arch. The rest -- the four that
 * shape a pear, which way the heft leans, the size of the dot -- are set by a
 * starting face and are not offered, so the panel cannot be used to reach a
 * setting nobody has checked a control for.
 *
 * The controls test already drives every slider in `PART_SPECS` from one end
 * to the other on the Sans, and asks that each one moves some letter. What it
 * cannot know is what these eight were meant to be, and that is what is
 * written down here: their names, their ranges, that a face which has never
 * been given one opens at its plain drawing, and that their names cannot be
 * mistaken by the browser suite for the controls it already looks for.
 */

import { describe, expect, it } from "vitest";

import { idleControl } from "@/components/part-idle";
import { contoursToSvgPath } from "@/font/geometry";
import { catalogue, type Item, type Shell } from "@/palette/catalogue";
import { drawLetter } from "./build";
import {
  CAST_SPECS,
  CUT_SPECS,
  EFFECT_SPECS,
  METRIC_CONTROLS,
  PART_SPECS,
  PEN_CONTROLS,
  SCRIPT_CONTROLS,
  type PartControl,
} from "./parts";
import { driveId, whatGoverns } from "./probe";
import { BASES, SANS, SERIF, type Parts, type Style } from "./style";
import { foldSweep } from "./testing/fold-sweep";

/** What each new slider is, and a letter on the Serif it is there to move. */
const SOFT: Array<{
  part: string;
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** The soft serif's own setting, for the letters below. */
  start: number;
  letter: string;
}> = [
  {
    part: "slab",
    key: "tip",
    label: "Soft tips",
    min: 0,
    max: 1,
    step: 0.05,
    start: 1,
    letter: "l",
  },
  {
    part: "slab",
    key: "swell",
    label: "Arm flare",
    min: 0,
    max: 0.6,
    step: 0.05,
    start: 0.3,
    letter: "E",
  },
  {
    part: "terminal",
    key: "soft",
    label: "Softened cuts",
    min: 0,
    max: 0.5,
    step: 0.05,
    start: 0.3,
    letter: "t",
  },
  {
    part: "terminal",
    key: "taper",
    label: "Taper",
    min: 0,
    max: 0.85,
    step: 0.05,
    start: 0.5,
    letter: "c",
  },
  {
    part: "corner",
    key: "fillet",
    label: "Inside rounding",
    min: 0,
    max: 1,
    step: 0.05,
    start: 0.35,
    letter: "E",
  },
  {
    part: "bowl",
    key: "tail",
    label: "Flat tail",
    min: 0,
    max: 1.5,
    step: 0.05,
    start: 0.8,
    letter: "c",
  },
  {
    part: "bowl",
    key: "heft",
    label: "Heft",
    min: 0,
    max: 0.5,
    step: 0.02,
    start: 0.08,
    letter: "o",
  },
  {
    part: "shoulder",
    key: "rise",
    label: "Rise",
    min: 0,
    max: 0.8,
    step: 0.05,
    start: 0.3,
    letter: "n",
  },
];

/** The soft fields that are set by a starting face and never offered. */
const HIDDEN: Array<[string, string]> = [
  ["terminal", "dropSize"],
  ["terminal", "dropHang"],
  ["terminal", "dropCurl"],
  ["terminal", "dropNeck"],
  ["bowl", "heftTilt"],
];

function controlOf(part: string, key: string): PartControl | undefined {
  return PART_SPECS.find((spec) => spec.name === part)?.controls.find(
    (control) => control.key === key,
  );
}

function partsOf(style: Style): Record<string, Record<string, unknown>> {
  return style.parts as unknown as Record<string, Record<string, unknown>>;
}

function withPart(style: Style, part: string, key: string, value: unknown): Style {
  const parts = { ...partsOf(style) };
  parts[part] = { ...parts[part], [key]: value };
  return { ...style, parts: parts as unknown as Parts };
}

const isNew = (part: string, key: string) =>
  SOFT.some((one) => one.part === part && one.key === key);

describe("the soft finishes in the panel", () => {
  it.each(SOFT.map((one) => [`${one.part}.${one.key}`, one] as const))(
    "offers %s with its own name and range",
    (_, one) => {
      const control = controlOf(one.part, one.key);
      expect(control, `no ${one.label} on the ${one.part}`).toBeDefined();
      expect(control).toMatchObject({
        label: one.label,
        min: one.min,
        max: one.max,
        step: one.step,
      });
      // A plain number: neither a switch, nor a choice, nor a length in ems.
      expect(control!.toggle).toBeFalsy();
      expect(control!.options).toBeUndefined();
      expect(control!.emRelative).toBeFalsy();
      expect(control!.hint.length).toBeGreaterThan(40);
      // The soft serif's own setting is one the slider can show.
      expect(one.start).toBeGreaterThanOrEqual(one.min);
      expect(one.start).toBeLessThanOrEqual(one.max);
    },
  );

  it("keeps the drops, the heft's lean and the dot out of it", () => {
    for (const [part, key] of HIDDEN) {
      expect(controlOf(part, key), `${part}.${key} is offered`).toBeUndefined();
    }
    expect(METRIC_CONTROLS.map((control) => control.key)).not.toContain("dotScale");
  });

  /*
   * Every slider a base never sets is one of these eight. A ninth would be a
   * field reached from the panel that no base, and no test of the bases, has
   * ever drawn with.
   */
  it("adds no other slider that the bases leave unset", () => {
    const unset: string[] = [];
    for (const spec of PART_SPECS) {
      for (const control of spec.controls) {
        if (control.toggle || control.options) continue;
        const somewhere = BASES.some(
          (base) => partsOf(base)[spec.name]?.[control.key] !== undefined,
        );
        if (!somewhere) unset.push(`${spec.name}.${control.key}`);
      }
    }
    expect(unset.sort()).toEqual(SOFT.map((one) => `${one.part}.${one.key}`).sort());
  });

  /*
   * Left out of every base, so every face opens at the drawing it always had,
   * and the slider's floor is nought, which is what the panel shows for a value
   * that is not there and what the drawing reads it as.
   */
  it("opens at nought on every base, which is the plain drawing", () => {
    for (const base of BASES) {
      for (const one of SOFT) {
        expect(partsOf(base)[one.part]?.[one.key], `${base.name} sets ${one.key}`).toBeUndefined();
      }
    }
    for (const one of SOFT) expect(controlOf(one.part, one.key)!.min).toBe(0);
  });
});

describe("the names cannot be mistaken for another control", () => {
  // The names the panel actually shows, rather than the ones written above.
  const labels = SOFT.map((one) => controlOf(one.part, one.key)?.label ?? one.label);

  /*
   * The browser suite finds a control by the name it announces, and a name not
   * asked for exactly matches any name with it inside, whatever the case.
   * "Weight" would find a "Heft weight"; "Serifs" would find a second switch.
   */
  it("holds none of the words the browser suite looks for", () => {
    const sought = [
      "weight",
      "size",
      "reach",
      "contrast",
      "squareness",
      "width",
      "kern",
      "crossbar",
      "serifs",
      "pixel grid",
    ];
    for (const label of labels) {
      for (const word of sought) {
        expect(label.toLowerCase(), `${label} answers to "${word}"`).not.toContain(word);
      }
    }
  });

  it("is a slider, so it adds no switch and no button", () => {
    // A switch would answer to "Serifs"; a choice would add a button that a
    // search for Round or Angled could land on.
    for (const one of SOFT) {
      const control = controlOf(one.part, one.key)!;
      expect(control.toggle, one.label).toBeFalsy();
      expect(control.options, one.label).toBeUndefined();
      expect(control.label).not.toMatch(/\bround\b|angled/i);
    }
  });

  it("shares a name with nothing else in the panel", () => {
    const others = [
      ...PEN_CONTROLS,
      ...METRIC_CONTROLS,
      ...SCRIPT_CONTROLS,
      ...PART_SPECS.flatMap((spec) =>
        spec.controls.filter((control) => !isNew(spec.name, control.key)),
      ),
      ...CUT_SPECS.flatMap((spec) => spec.controls),
      ...CAST_SPECS.flatMap((spec) => spec.controls),
      ...EFFECT_SPECS.flatMap((spec) => spec.controls),
    ].map((control) => control.label.toLowerCase());
    const sections = [...PART_SPECS, ...CUT_SPECS, ...CAST_SPECS, ...EFFECT_SPECS].map((spec) =>
      spec.label.toLowerCase(),
    );
    for (const label of labels) {
      expect(others, label).not.toContain(label.toLowerCase());
      expect(sections, label).not.toContain(label.toLowerCase());
    }
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("the soft finishes are never dimmed by a rule of their own", () => {
  /*
   * The terminal's Cut is dimmed under every finish but Angled, and the browser
   * suite reads that row by its text alone, so a second dimmed row in the same
   * part would make it ambiguous. Taper and Softened cuts stay live whatever
   * the finish.
   */
  it("leaves the terminal's two live under every finish", () => {
    for (const kind of ["butt", "level", "angled", "round", "teardrop"]) {
      const values = { ...SERIF.parts.terminal, kind } as never;
      expect(idleControl("terminal", "soft", values), kind).toBe(false);
      expect(idleControl("terminal", "taper", values), kind).toBe(false);
    }
  });

  it("leaves every one live on every base that has the part switched on", () => {
    for (const base of BASES) {
      for (const one of SOFT) {
        const values = partsOf(base)[one.part] as never;
        const switched = partsOf(base)[one.part]?.on;
        if (switched === false) continue;
        expect(idleControl(one.part as never, one.key, values), `${base.name} ${one.key}`).toBe(
          false,
        );
      }
    }
  });

  /*
   * The two on the serif go quiet with the serifs, through the switch the part
   * already has -- the same rule that quiets Reach and Depth -- and that is
   * true of them: with no serif there is no tip to round and no beak to flare.
   */
  it("goes quiet on the serif only when the serifs are off, where it does nothing", () => {
    for (const key of ["tip", "swell"]) {
      expect(idleControl("slab", key, { ...SANS.parts.slab, on: false } as never)).toBe(true);
      expect(idleControl("slab", key, { ...SANS.parts.slab, on: true } as never)).toBe(false);
      const one = SOFT.find((each) => each.key === key)!;
      for (const letter of ["l", "n", "E", "T", "H"]) {
        const plain = drawLetter(letter, withPart(SANS, "slab", key, 0))!;
        const most = drawLetter(letter, withPart(SANS, "slab", key, one.max))!;
        expect(contoursToSvgPath(most.contours), `${letter} ${key}`).toBe(
          contoursToSvgPath(plain.contours),
        );
      }
    }
  });
});

describe("each one moves the letter it was made for", () => {
  it.each(SOFT.map((one) => [`${one.part}.${one.key}`, one] as const))(
    "%s on the Serif",
    (_, one) => {
      const absent = drawLetter(one.letter, SERIF)!;
      const nought = drawLetter(one.letter, withPart(SERIF, one.part, one.key, 0))!;
      const set = drawLetter(one.letter, withPart(SERIF, one.part, one.key, one.start))!;
      // Nought is the plain drawing, exactly.
      expect(JSON.stringify(nought.contours)).toBe(JSON.stringify(absent.contours));
      expect(nought.advanceWidth).toBe(absent.advanceWidth);
      // And the soft serif's own setting is not.
      expect(contoursToSvgPath(set.contours)).not.toBe(contoursToSvgPath(absent.contours));
    },
  );
});

describe("the soft finishes cannot spoil a Serif letter", () => {
  /*
   * The controls test drives every slider on the Sans with its serifs on. The
   * Serif is what these were made for, so they are driven there as well, at
   * the same three stops of the range the panel offers, at the same four
   * weights, in the Serif's default forms and its own.
   */
  for (const one of SOFT) {
    it(`${one.label}`, { timeout: 240_000 }, () => {
      const control = controlOf(one.part, one.key)!;
      const stops = [control.min, (control.min + control.max) / 2, control.max];
      expect(foldSweep(`${one.part}.${one.key}`, stops)).toEqual([]);
    });
  }
});

describe("the palette offers them as the panel does", () => {
  const shell = {
    mode: "forge",
    setMode: () => {},
    view: "grid",
    setView: () => {},
    openFile: () => {},
    export: () => {},
    save: () => {},
    newProject: () => {},
    addVersion: () => {},
    toggleHelp: () => {},
    library: () => {},
    selectGlyph: () => {},
    paramOf: () => 0,
    setParam: () => {},
    // A font that has never been given a soft finish has no value for it.
    partOf: () => undefined,
    setPart: () => {},
    penOf: () => 0,
    setPen: () => {},
    metricOf: () => 0,
    setMetric: () => {},
    cutOf: () => 0,
    setCut: () => {},
    castOf: () => 0,
    setCast: () => {},
    startFromBase: () => {},
    chooseAlternate: () => {},
    hasFont: true,
    openFonts: [{ id: "font-0", name: "Bakerloo" }],
    openAt: 0,
    goToFont: () => {},
    reopenable: null,
    reopenFont: () => {},
  } as unknown as Shell;

  it("with the same range, reading an untouched one as nought", () => {
    const items = catalogue(shell);
    for (const one of SOFT) {
      const item: Item | undefined = items.find(
        (candidate) => candidate.id === `part:${one.part}:${one.key}`,
      );
      expect(item, `${one.label} is not in the palette`).toBeDefined();
      expect(item!.short).toBe(one.label);
      expect(item!.adjust).toBeDefined();
      expect(item!.adjust!.min).toBe(one.min);
      expect(item!.adjust!.max).toBe(one.max);
      expect(item!.adjust!.step).toBe(one.step);
      expect(item!.adjust!.read()).toBe(0);
    }
  });
});

describe("pressing a softened letter", () => {
  /*
   * A face with the eight set names them as the controls behind a spot; each
   * answer has to be a control the panel has, at a value the control allows,
   * with a drag speed that moves something.
   */
  const soft = SOFT.reduce<Style>(
    (style, one) => withPart(style, one.part, one.key, one.start),
    SERIF,
  );
  const known = new Set(
    PART_SPECS.flatMap((spec) =>
      spec.controls.map((control) => `part:${spec.name}:${control.key}`),
    ),
  );

  it("names only controls the panel has, at values they allow", { timeout: 120_000 }, () => {
    const named = new Set<string>();
    for (const letter of ["n", "o", "E", "c", "t", "l"]) {
      const drawn = drawLetter(letter, soft)!;
      const points = drawn.contours.flatMap((contour) => contour.nodes.map((node) => node.point));
      for (
        let index = 0;
        index < points.length;
        index += Math.max(1, Math.ceil(points.length / 10))
      ) {
        const found = whatGoverns(letter, soft, points[index]);
        if (!found) continue;
        const { handle } = found;
        const id = driveId(handle.drive);
        named.add(id);
        if (handle.drive.on !== "part") continue;
        expect(known.has(id), id).toBe(true);
        expect(handle.value).toBeGreaterThanOrEqual(handle.min - 1e-9);
        expect(handle.value).toBeLessThanOrEqual(handle.max + 1e-9);
        expect(Number.isFinite(handle.perUnit)).toBe(true);
        expect(handle.perUnit).not.toBe(0);
      }
    }
    expect(named.size).toBeGreaterThan(0);
  });
});

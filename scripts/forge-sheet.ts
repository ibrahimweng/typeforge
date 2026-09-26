/**
 * A drawn face under each of its parts and layers, one row a setting.
 *
 * The Draw mode's own controls -- slab serifs, the shoulder, the crossbar,
 * the bowl -- and the cuts and the cast with their skeleton to work from,
 * which is where the breaks, the inline and the fillets can reach. One SVG per
 * row, and a line per letter whose outline crosses itself or is not finite.
 *
 *   FACE=Sans OUT=dir npx vite-node scripts/forge-sheet.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contoursToSvgPath } from "@/font/geometry";
import { contoursIntersect } from "@/font/outline";
import { editCast, editCut, editEffect, proof, startFrom, type Forge } from "@/forge/document";
import { readyToShape } from "@/forge/layers";
import { BASES } from "@/forge/style";

const out = process.env.OUT ?? ".";
const text = process.env.TEXT ?? "HAEnmhrkaegsRBbo48";
mkdirSync(out, { recursive: true });
await readyToShape();

const base = BASES.find((one) => one.name === (process.env.FACE ?? "Sans")) ?? BASES[0];
type Step = (forge: Forge) => Forge;
const parts =
  (patch: Record<string, Record<string, unknown>>): Step =>
  (forge) => ({
    ...forge,
    style: {
      ...forge.style,
      parts: Object.fromEntries(
        Object.entries(forge.style.parts).map(([key, value]) => [
          key,
          { ...(value as object), ...(patch[key] ?? {}) },
        ]),
      ) as Forge["style"]["parts"],
    },
  });
const cut =
  (name: string, patch: Record<string, unknown>): Step =>
  (forge) =>
    editCut(forge, name as never, { on: true, ...patch } as never);
const cast =
  (name: string, patch: Record<string, unknown>): Step =>
  (forge) =>
    editCast(forge, name as never, { on: true, ...patch } as never);
const effect =
  (name: string, patch: Record<string, unknown>): Step =>
  (forge) =>
    editEffect(forge, name as never, { on: true, ...patch } as never);

const rows: Record<string, Step[]> = {
  rest: [],
  "slab on": [parts({ slab: { on: true } })],
  "slab long": [parts({ slab: { on: true, projection: 1.2, thickness: 1 } })],
  "slab bracketed": [parts({ slab: { on: true, bracket: 0.5 } })],
  "shoulder low": [parts({ shoulder: { spring: 0.3 } })],
  "shoulder high": [parts({ shoulder: { spring: 0.9, reach: 1.4 } })],
  "crossbar high": [parts({ crossbar: { height: 0.7 } })],
  "crossbar low": [parts({ crossbar: { height: 0.3, weight: 1.6 } })],
  "bowl square": [parts({ bowl: { squareness: 0.9, aperture: 0.4 } })],
  slots: [cut("slot", { count: 3, angle: 15 })],
  saw: [cut("tooth", { edge: "both" })],
  breaks: [cut("split", {})],
  inline: [cut("inline", {})],
  counters: [cut("motif", {})],
  chamfer: [cut("chamfer", {})],
  shadow: [cast("extrude", {})],
  rim: [cast("outline", {})],
  points: [cast("spur", {})],
  fillets: [cast("weld", { size: 1 })],
  "mix slab+cuts": [
    parts({ slab: { on: true } }),
    cut("slot", {}),
    cut("split", {}),
    cast("extrude", {}),
  ],
  "mix all": [
    parts({ slab: { on: true }, crossbar: { height: 0.65 } }),
    cut("inline", {}),
    cut("tooth", {}),
    cast("weld", {}),
    cast("outline", {}),
  ],
};
if (process.env.EFFECTS) {
  rows.pressure = [effect("pressure", {})];
  rows.rough = [effect("rough", {})];
}

const em = base.metrics.unitsPerEm;
for (const [name, steps] of Object.entries(rows)) {
  let forge = startFrom(base);
  for (const step of steps) forge = step(forge);
  let x = 0;
  const drawn: string[] = [];
  const faults: string[] = [];
  for (const letter of text) {
    let result;
    try {
      result = proof(letter, forge);
    } catch (error) {
      faults.push(`${letter}: threw ${(error as Error).message}`);
      continue;
    }
    if (!result) continue;
    if (
      result.contours.some((c) =>
        c.nodes.some((n) => !Number.isFinite(n.point.x) || !Number.isFinite(n.point.y)),
      )
    )
      faults.push(`${letter}: NaN`);
    const crossed = result.contours.filter((c) => contoursIntersect([c])).length;
    if (crossed) faults.push(`${letter}: ${crossed} crossed`);
    drawn.push(
      `<g transform="translate(${x + em * 0.1},${em * 0.95}) scale(1,-1)"><path d="${contoursToSvgPath(result.contours)}" fill="black"/></g>`,
    );
    x += Math.max(result.advanceWidth, em * 0.3) + em * 0.1;
  }
  const width = x + em * 0.2;
  writeFileSync(
    join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${em * 1.25}" width="${width / 5}" height="${(em * 1.25) / 5}"><rect width="100%" height="100%" fill="white"/>${drawn.join("")}</svg>`,
  );
  console.log(`${name}: ${faults.length ? faults.join("; ") : "ok"}`);
}

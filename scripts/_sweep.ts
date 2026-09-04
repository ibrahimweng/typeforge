import { ready } from "@/font/boolean";
import { contoursBounds } from "@/font/geometry";
import { draw, startFrom } from "@/forge/document";
import { dialledTo, likenessBy } from "@/forge/likeness";
import { ROUNDHAND } from "@/forge/style";
await ready();
const FLAT = ["n", "m", "u", "r", "i"],
  ASC = ["l", "b", "d", "h", "k"];
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
function look(s: any) {
  const forge = startFrom(s),
    em = s.metrics.unitsPerEm;
  const bx = (n: string) => {
    const d = draw(n, forge);
    return d?.contours.length ? contoursBounds(d.contours) : null;
  };
  const flat = FLAT.map(bx).filter(Boolean) as any[];
  const xh = med(flat.map((b) => b.yMax));
  const feet = flat.map((b) => b.yMin);
  const asc = Math.max(...(ASC.map(bx).filter(Boolean) as any[]).map((b) => b.yMax));
  return { bounce: (Math.max(...feet) - Math.min(...feet)) / xh, xh: xh / em, asc: asc / em };
}
const dial = (base: any, irr: number) => ({
  ...base,
  parts: { ...base.parts, script: { ...base.parts.script, irregularity: irr } },
});
console.log("FLOWING  (target bounce 0.033, xh 0.332, asc 0.720)");
console.log("  irreg   bounce    xh      asc");
const flow: any = dialledTo(likenessBy("flowing")!);
for (const irr of [0.2, 0.3, 0.4, 0.5, 0.7, 0.9]) {
  const r = look(dial(flow, irr));
  console.log(
    `  ${irr.toFixed(2)}    ${r.bounce.toFixed(3)}   ${r.xh.toFixed(3)}   ${r.asc.toFixed(3)}`,
  );
}
console.log("\nROUNDHAND base  (wants ~0.017, between 0.033 and 0.000)");
console.log("  irreg   bounce    xh      asc");
for (const irr of [0.15, 0.2, 0.25, 0.3, 0.45, 0.9]) {
  const r = look(dial(ROUNDHAND, irr));
  console.log(
    `  ${irr.toFixed(2)}    ${r.bounce.toFixed(3)}   ${r.xh.toFixed(3)}   ${r.asc.toFixed(3)}`,
  );
}

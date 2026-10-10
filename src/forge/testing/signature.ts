/**
 * What a drawing has to keep the same at every master of a variable font, for
 * tests to compare.
 *
 * `agrees` in font/master.ts compares how many contours and how many nodes a
 * glyph has. That is not all two masters must share: the glyf writer turns an
 * edge with neither handle into one point and any other edge into a run of
 * quadratics, so an edge that is a line at one weight and a curve at another
 * gives the two masters different points even with the same nodes. This
 * catches that as well.
 */

import type { Contour } from "@/font/types";

/** One contour's structure. */
export interface ContourSignature {
  closed: boolean;
  nodes: number;
  /**
   * Every edge in order, `l` where it is a straight line -- the leaving
   * node's `handleOut` and the arriving node's `handleIn` both missing -- and
   * `c` otherwise. A closed contour's edge from its last node back to its
   * first is included; an open one has none.
   */
  edges: string;
}

export function signatureOf(contours: Contour[]): ContourSignature[] {
  return contours.map((contour) => {
    const { nodes } = contour;
    const count = contour.closed ? nodes.length : Math.max(0, nodes.length - 1);
    let edges = "";
    for (let index = 0; index < count; index++) {
      const from = nodes[index];
      const to = nodes[(index + 1) % nodes.length];
      edges += from.handleOut === null && to.handleIn === null ? "l" : "c";
    }
    return { closed: contour.closed, nodes: nodes.length, edges };
  });
}

/** The same, written on one line: `z4:lclc o2:l`, for comparing or printing. */
export function signatureText(contours: Contour[]): string {
  return signatureOf(contours)
    .map((one) => `${one.closed ? "z" : "o"}${one.nodes}:${one.edges}`)
    .join(" ");
}

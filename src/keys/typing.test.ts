/**
 * Which focused elements keep the palette's space bar for themselves.
 *
 * Run without a page, so the elements are stand-ins: an `HTMLElement` class
 * put on the global for the length of the file, with only the handful of
 * members `typing.ts` reads.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { busy, interactive } from "./typing";

class FakeElement {
  isContentEditable = false;
  type = "";
  constructor(
    public tagName: string,
    private attrs: Record<string, string> = {},
  ) {
    if (attrs.type) this.type = attrs.type;
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name: string): boolean {
    return name in this.attrs;
  }
}

const had = (globalThis as { HTMLElement?: unknown }).HTMLElement;
beforeAll(() => {
  (globalThis as { HTMLElement?: unknown }).HTMLElement = FakeElement;
});
afterAll(() => {
  (globalThis as { HTMLElement?: unknown }).HTMLElement = had;
});

const el = (tag: string, attrs?: Record<string, string>) =>
  new FakeElement(tag, attrs) as unknown as HTMLElement;

describe("controls that keep the space bar", () => {
  it("counts buttons, links, summaries and selects", () => {
    expect(interactive(el("BUTTON"))).toBe(true);
    expect(interactive(el("A", { href: "#" }))).toBe(true);
    expect(interactive(el("SUMMARY"))).toBe(true);
    expect(interactive(el("SELECT"))).toBe(true);
    expect(interactive(el("INPUT", { type: "range" }))).toBe(true);
  });

  it("counts anything with a pressable role or in the tab order", () => {
    expect(interactive(el("DIV", { role: "button" }))).toBe(true);
    expect(interactive(el("LI", { role: "menuitem" }))).toBe(true);
    expect(interactive(el("DIV", { tabindex: "0" }))).toBe(true);
  });

  it("leaves the page, a canvas and plain elements to the palette", () => {
    expect(interactive(el("BODY"))).toBe(false);
    expect(interactive(el("CANVAS", { tabindex: "0", role: "application" }))).toBe(false);
    expect(interactive(el("DIV"))).toBe(false);
    expect(interactive(el("A"))).toBe(false);
    expect(interactive(el("DIV", { tabindex: "-1" }))).toBe(false);
    expect(interactive(null)).toBe(false);
  });

  it("stays wider than busy, which the other bare keys ask", () => {
    expect(busy(el("BUTTON"))).toBe(false);
    expect(busy(el("INPUT", { type: "checkbox" }))).toBe(true);
    expect(interactive(el("INPUT", { type: "checkbox" }))).toBe(true);
  });
});

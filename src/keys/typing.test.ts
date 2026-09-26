/**
 * Which focused elements keep the palette's space bar for themselves.
 *
 * Run without a page, so the elements are stand-ins: an `HTMLElement` class
 * put on the global for the length of the file, with only the handful of
 * members `typing.ts` reads.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { busy } from "./typing";

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

describe("what keeps the palette's space bar", () => {
  it("leaves a focused button, link or summary to the palette", () => {
    // A click leaves the focus on the button it pressed; a space that stood
    // aside for buttons would stop working after almost any click.
    expect(busy(el("BUTTON"))).toBe(false);
    expect(busy(el("A", { href: "#" }))).toBe(false);
    expect(busy(el("SUMMARY"))).toBe(false);
    expect(busy(el("DIV", { role: "button" }))).toBe(false);
  });

  it("keeps it for the controls with nothing but a space to press them", () => {
    expect(busy(el("INPUT", { type: "checkbox" }))).toBe(true);
    expect(busy(el("INPUT", { type: "radio" }))).toBe(true);
    expect(busy(el("DIV", { role: "switch" }))).toBe(true);
  });

  it("keeps it for somewhere text is typed", () => {
    expect(busy(el("INPUT", { type: "text" }))).toBe(true);
    expect(busy(el("TEXTAREA"))).toBe(true);
  });

  it("leaves the page and nothing at all to the palette", () => {
    expect(busy(el("BODY"))).toBe(false);
    expect(busy(null)).toBe(false);
  });
});

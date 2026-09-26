/**
 * The two answers a modal dialog needs without a page: whether one is up, and
 * where Tab goes at the ends of one.
 */

import { describe, expect, it } from "vitest";

import { modalOpen, wrapTab } from "./modal";

describe("whether a modal is open", () => {
  it("asks the document for anything marked aria-modal", () => {
    const asked: string[] = [];
    const up = {
      querySelector: (selector: string) => {
        asked.push(selector);
        return {} as Element;
      },
    };
    expect(modalOpen(up)).toBe(true);
    expect(asked).toEqual(['[aria-modal="true"]']);
  });

  it("is not open with nothing marked, or with no document at all", () => {
    expect(modalOpen({ querySelector: () => null })).toBe(false);
    expect(modalOpen(null)).toBe(false);
  });
});

describe("Tab inside a dialog", () => {
  const items = ["name", "format", "cancel", "download"];

  it("wraps from the last control to the first", () => {
    expect(wrapTab(items, "download", false)).toBe("name");
  });

  it("wraps from the first control to the last on Shift-Tab", () => {
    expect(wrapTab(items, "name", true)).toBe("download");
  });

  it("leaves the steps between to the browser", () => {
    expect(wrapTab(items, "format", false)).toBeNull();
    expect(wrapTab(items, "format", true)).toBeNull();
    expect(wrapTab(items, "name", false)).toBeNull();
    expect(wrapTab(items, "download", true)).toBeNull();
  });

  it("brings a focus that has strayed outside back to an end", () => {
    expect(wrapTab(items, null, false)).toBe("name");
    expect(wrapTab(items, "the page behind", true)).toBe("download");
  });

  it("has nowhere to go with nothing to focus", () => {
    expect(wrapTab([], null, false)).toBeNull();
  });
});

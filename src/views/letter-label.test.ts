import { describe, expect, it } from "vitest";

import { letterLabel } from "./letter-label";

describe("the name a letter goes by on a button", () => {
  it("is the character, not the glyph name", () => {
    expect(letterLabel("ccedilla")).toBe("ç");
    expect(letterLabel("scommaaccent")).toBe("ș");
    expect(letterLabel("parenleft")).toBe("(");
    expect(letterLabel("a")).toBe("a");
  });

  it("puts a mark on a dotted circle and leaves nameless glyphs as named", () => {
    expect(letterLabel("grave")).toBe("◌̀");
    expect(letterLabel("space")).toBe("space");
    expect(letterLabel("not-a-glyph")).toBe("not-a-glyph");
  });
});

import { describe, expect, it } from "vitest";

import { documentLine } from "./StatusBar";

const open = {
  typeface: null,
  drawing: { familyName: "My Sans", base: "Sans" },
  assembly: { familyName: "Untitled", pieces: 1 },
  trace: { name: "" },
};

describe("what the status bar says is open", () => {
  it("names the drawing on the Draw page rather than saying nothing is open", () => {
    expect(documentLine("forge", open)).toBe("My Sans — drawn from Sans");
    expect(documentLine("forge", open)).not.toContain("Nothing open");
  });

  it("names what each other mode has open", () => {
    expect(documentLine("assemble", open)).toBe("Untitled — 1 drawing");
    expect(documentLine("quill", open)).toBe("Tracing Untitled");
    expect(documentLine("edit", open)).toBe("Nothing open");
    expect(
      documentLine("edit", { ...open, typeface: { familyName: "DejaVu Sans", letters: 6253 } }),
    ).toBe("DejaVu Sans — 6,253 letters");
  });
});

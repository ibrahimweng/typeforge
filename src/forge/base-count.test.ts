import { describe, expect, it } from "vitest";

import { BASE_COUNT, inWords } from "./base-count";
import { BASES } from "./style";

describe("the number of styles the front door promises", () => {
  it("is the number there are", () => {
    expect(BASE_COUNT).toBe(BASES.length);
  });

  it("is written out as a word", () => {
    expect(inWords(21)).toBe("twenty-one");
    expect(inWords(20)).toBe("twenty");
    expect(inWords(7)).toBe("seven");
  });
});

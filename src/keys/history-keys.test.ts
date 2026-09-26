/**
 * Which presses are undo and redo, for the handler that now answers them
 * everywhere rather than only on the glyph canvas.
 */

import { describe, expect, it } from "vitest";

import { historyChord } from "./history-keys";

const press = (over: Partial<Parameters<typeof historyChord>[0]>) =>
  historyChord({
    key: "z",
    code: "KeyZ",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  });

describe("the undo chords", () => {
  it("reads Cmd-Z and Ctrl-Z as undo", () => {
    expect(press({ metaKey: true })).toBe("undo");
    expect(press({ ctrlKey: true })).toBe("undo");
  });

  it("reads Shift with either as redo, with the capital the key reports", () => {
    expect(press({ metaKey: true, shiftKey: true, key: "Z" })).toBe("redo");
    expect(press({ ctrlKey: true, shiftKey: true, key: "Z" })).toBe("redo");
  });

  it("follows the key rather than the letter on a layout that moves it", () => {
    expect(press({ metaKey: true, key: "y", code: "KeyZ" })).toBe("undo");
  });

  it("leaves a bare z, and Alt, to whoever else wants them", () => {
    expect(press({})).toBeNull();
    expect(press({ metaKey: true, altKey: true })).toBeNull();
  });

  it("is not some other chord", () => {
    expect(press({ metaKey: true, key: "s", code: "KeyS" })).toBeNull();
  });
});

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

  it("follows the letter printed on the key on a layout that moves it", () => {
    // QWERTZ: the key in QWERTY's Z position is Y, and Ctrl-Y is not undo.
    expect(press({ ctrlKey: true, key: "y", code: "KeyZ" })).toBeNull();
    // ...and its Z sits where QWERTY has Y.
    expect(press({ ctrlKey: true, key: "z", code: "KeyY" })).toBe("undo");
    // Dvorak: QWERTY's Z position is the semicolon.
    expect(press({ metaKey: true, key: ";", code: "KeyZ" })).toBeNull();
    expect(press({ metaKey: true, key: "z", code: "Slash" })).toBe("undo");
  });

  it("falls back to the position on a layout with no Latin letters", () => {
    // Russian: the Z position reports "я".
    expect(press({ metaKey: true, key: "я", code: "KeyZ" })).toBe("undo");
    expect(press({ metaKey: true, shiftKey: true, key: "Я", code: "KeyZ" })).toBe("redo");
    expect(press({ metaKey: true, key: "ч", code: "KeyX" })).toBeNull();
  });

  it("leaves a bare z, and Alt, to whoever else wants them", () => {
    expect(press({})).toBeNull();
    expect(press({ metaKey: true, altKey: true })).toBeNull();
  });

  it("is not some other chord", () => {
    expect(press({ metaKey: true, key: "s", code: "KeyS" })).toBeNull();
  });
});

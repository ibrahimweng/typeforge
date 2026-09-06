/**
 * Whether a key pressed anywhere on the page was meant for the drawing.
 *
 * Three separate listeners answer keys about a letter: the editing keys in
 * `glyph-keys.ts`, the space that puts the hand out in `hand.ts`, and the
 * single letters that take up a tool in `ToolPalette.tsx`. All three are bound
 * to the window, because a key pressed at a canvas has to reach a handler that
 * also knows about the store, and all three have to answer the same question
 * before they act on anything.
 *
 * They used to answer it three different ways, and one of them was a keyboard
 * trap: `Tab` was answered wherever the focus was, so with a letter open
 * nobody on a keyboard could leave the button they were standing on. The rule
 * that fixed it is here so the next listener gets it for nothing rather than
 * inventing a fourth version.
 *
 * `document.body` counts as the canvas. That is where the focus sits before
 * anything has been clicked, and a fresh page should still answer a key. The
 * canvas takes focus when it is pointed at, so clicking a point and then
 * pressing an arrow works the way it always has.
 *
 * What this deliberately does not do is list tag names. The old version
 * checked for an `input` and a `textarea`, which is a list that is wrong the
 * moment somebody adds a control that is neither -- and the way to be right
 * about a control nobody has written yet is to ask where the focus is rather
 * than what it is called.
 */

export function meantForTheCanvas(canvas: HTMLCanvasElement | null): boolean {
  const focused = document.activeElement;
  if (focused === null || focused === document.body) return true;
  return focused === canvas;
}

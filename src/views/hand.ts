/**
 * Space to put the hand out, which is how a canvas has been panned since 1990.
 *
 * The canvas could already be panned two ways: the middle button, and alt with
 * a drag. Neither is the one anybody reaches for. Every drawing program made
 * in the last thirty years pans on space, and it is the first thing a designer
 * does on arriving at a canvas that is bigger than the window -- so a tool
 * that does not answer it feels wrong within about ten seconds, before
 * anything has been drawn.
 *
 * Space rather than a hand tool in the rail, because the point of it is that
 * it is held. You are in the middle of drawing a curve, the letter needs to
 * move, and you want the pen back the instant you let go. A tool you have to
 * take up and put down again is a different thing that happens to move the
 * canvas.
 *
 * Two states rather than one, because they are read at different times. The
 * ref is read inside a pointer handler, which runs between renders and would
 * see a stale value off the state. The boolean is what the cursor is drawn
 * from, and a cursor that does not change is a hand nobody knows they have.
 *
 * Space was the palette's before this, everywhere in the application, and it
 * still is everywhere there is nothing to pan. Over a letter on a canvas it is
 * the hand's, and `useQuickActionShortcut` stands aside for it there rather
 * than the two of them racing over which window listener the browser calls
 * first. The palette keeps Cmd-K on every screen including this one.
 *
 * Let go of space in the middle of a drag and the drag carries on. That is
 * deliberate and it is what the reference programs do: the gesture that is
 * running was started as a pan, and taking the canvas out from under a moving
 * hand because a finger came off a key early is the kind of correctness
 * nobody asked for.
 */

import * as React from "react";

import { meantForTheCanvas } from "./canvas-focus";

export interface Hand {
  /** Whether space is down, for the handlers that run between renders. */
  held: React.RefObject<boolean>;
  /** The same fact, for the cursor, which only changes on a render. */
  out: boolean;
}

export function useHand(canvas: React.RefObject<HTMLCanvasElement | null>): Hand {
  const held = React.useRef(false);
  const [out, setOut] = React.useState(false);

  React.useEffect(() => {
    const put = (down: boolean): void => {
      held.current = down;
      setOut(down);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || event.repeat) return;
      /*
       * Not while the focus is on a control. Space is how a button is pressed
       * from the keyboard, and taking it here would leave every button on the
       * page pressable by mouse only -- which is the same fault as the Tab
       * trap this guard was written for, with a different key.
       */
      if (!meantForTheCanvas(canvas.current)) return;
      // Or the page scrolls, which is what space does to a document by default.
      event.preventDefault();
      put(true);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      put(false);
    };

    /*
     * And down again whenever the window stops listening.
     *
     * A key released while another window has the focus never arrives here, so
     * without this the hand stays out for the rest of the session and the pen
     * appears to have stopped working. Command-Tab away mid-drag is the way
     * anybody would find it.
     */
    const onBlur = (): void => put(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [canvas]);

  return { held, out };
}

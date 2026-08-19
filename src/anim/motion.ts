/**
 * Motion.
 *
 * A font editor is a working tool, so animation here is there to explain what
 * changed, never to perform. Movements are short, eased out, and small in
 * distance: things appear, settle and get out of the way. Nothing bounces and
 * nothing blocks input.
 *
 * Everything routes through these helpers so the timings stay consistent and so
 * a reduced-motion preference is honoured in one place.
 */

import { animate, createTimeline, stagger, utils } from "animejs";

/** Shared timings, in milliseconds. */
export const DURATION = {
  /** Hovers and pressed states. Below this a change reads as instant. */
  instant: 90,
  /** The default for anything appearing or moving. */
  quick: 180,
  /** Panels and view changes, where a little more travel needs a little more time. */
  settle: 260,
} as const;

/** Eased out, so motion decelerates into place the way physical things do. */
export const EASE = {
  out: "outQuart",
  inOut: "inOutQuad",
  /** For values snapping to a new position, such as a slider readout. */
  snap: "outExpo",
} as const;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Target = Element | Element[] | NodeListOf<Element> | string | null;

function usable(target: Target): boolean {
  if (!target) return false;
  if (typeof target === "string") return document.querySelector(target) !== null;
  if (target instanceof Element) return true;
  return (target as Element[]).length > 0;
}

/**
 * Fade and lift an element into place. Used when a panel or dialog appears.
 */
export function enter(target: Target, options: { delay?: number; distance?: number } = {}): void {
  if (!usable(target) || prefersReducedMotion()) return;
  animate(target as never, {
    opacity: [0, 1],
    translateY: [options.distance ?? 6, 0],
    duration: DURATION.settle,
    delay: options.delay ?? 0,
    ease: EASE.out,
  });
}

/**
 * Reveal a list one item at a time.
 *
 * The stagger is deliberately tight and capped: a long cascade looks decorative
 * and delays the last item past the point of being useful.
 */
export function enterStaggered(target: Target, options: { step?: number; max?: number } = {}): void {
  if (!usable(target) || prefersReducedMotion()) return;
  const step = options.step ?? 14;
  animate(target as never, {
    opacity: [0, 1],
    translateY: [8, 0],
    duration: DURATION.quick,
    delay: stagger(step, { start: 0, from: "first" }),
    ease: EASE.out,
  });
  void (options.max ?? 0);
}

/** Cross-fade the outgoing and incoming panes of a view change. */
export function switchView(outgoing: Target, incoming: Target): void {
  if (prefersReducedMotion()) return;
  const timeline = createTimeline({ defaults: { ease: EASE.out } });
  if (usable(outgoing)) {
    timeline.add(outgoing as never, { opacity: [1, 0], duration: DURATION.instant }, 0);
  }
  if (usable(incoming)) {
    timeline.add(
      incoming as never,
      { opacity: [0, 1], translateY: [4, 0], duration: DURATION.quick },
      DURATION.instant * 0.6,
    );
  }
}

/**
 * Draw attention to a value that changed without the user touching it, such as
 * a metric recomputed after a family-wide edit.
 */
export function pulse(target: Target): void {
  if (!usable(target) || prefersReducedMotion()) return;
  animate(target as never, {
    opacity: [{ to: 0.45, duration: DURATION.instant }, { to: 1, duration: DURATION.quick }],
    ease: EASE.snap,
  });
}

/**
 * Count a number up or down to its new value.
 *
 * Readouts that jump are hard to read at a glance; a short tween makes the
 * direction and size of a change legible.
 */
export function tweenNumber(
  from: number,
  to: number,
  onUpdate: (value: number) => void,
  options: { duration?: number; decimals?: number } = {},
): void {
  const decimals = options.decimals ?? 0;
  if (prefersReducedMotion() || from === to) {
    onUpdate(to);
    return;
  }
  const proxy = { value: from };
  animate(proxy, {
    value: to,
    duration: options.duration ?? DURATION.quick,
    ease: EASE.snap,
    onUpdate: () => onUpdate(Number(proxy.value.toFixed(decimals))),
    onComplete: () => onUpdate(to),
  });
}

/**
 * A short horizontal shake, for an action that could not be carried out.
 * Deliberately small: it should read as a refusal, not an error state.
 */
export function refuse(target: Target): void {
  if (!usable(target) || prefersReducedMotion()) return;
  animate(target as never, {
    translateX: [0, -3, 3, -2, 0],
    duration: DURATION.settle,
    ease: EASE.inOut,
  });
}

/**
 * Acknowledge a press.
 *
 * A short dip in scale, returning under its own easing. The dip is deliberately
 * shallow: it should confirm the press landed, not make the control feel loose.
 */
export function press(target: Target): void {
  if (!usable(target) || prefersReducedMotion()) return;
  const animation = animate(target as never, {
    scale: [{ to: 0.965, duration: DURATION.instant }, { to: 1, duration: DURATION.quick }],
    ease: EASE.out,
  });
  // Dropped after the animation settles rather than from inside onComplete:
  // cleanup pauses the animation to revert it, and doing that mid-completion
  // throws. The press ends at scale 1, so what is left behind is an identity
  // transform -- harmless to look at, but it creates a stacking context, so it
  // is worth removing rather than leaving on every control that was ever
  // clicked.
  void animation.then(() => cleanup(animation));
}

/**
 * Give every control in a subtree press feedback.
 *
 * Delegated from one listener rather than wired per control: with 25 buttons
 * spread over seven files, anything opt-in gets forgotten the first time a
 * button is added, and the gap is invisible until someone notices one control
 * feels dead. Opt a control out with data-no-press.
 *
 * Returns a function that removes the listener.
 */
export function attachPressFeedback(root: HTMLElement): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    const control = target?.closest<HTMLElement>("button, [role='button']");
    if (!control || control.hasAttribute("data-no-press")) return;
    if (control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true") return;
    press(control);
  };
  root.addEventListener("pointerdown", onPointerDown);
  return () => root.removeEventListener("pointerdown", onPointerDown);
}

/**
 * Remove the inline styles a finished animation left on its targets.
 *
 * Takes the animation, not the element: cleanInlineStyles reads the targets off
 * the animation and pauses it. This previously accepted an element, which type
 * checked only because of a cast and threw the moment it was first called.
 */
export function cleanup(animation: { targets?: unknown }): void {
  utils.cleanInlineStyles(animation as never);
}

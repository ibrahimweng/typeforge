/**
 * That a drag ends on a cancel as well as on a release, and stops listening
 * either way.
 */

import { describe, expect, it, vi } from "vitest";

import { followPointer } from "./follow-pointer";

const fire = (target: EventTarget, type: string) => target.dispatchEvent(new Event(type));

describe("following a pointer", () => {
  it("follows moves until the pointer comes up, and then stops", () => {
    const target = new EventTarget();
    const move = vi.fn();
    const end = vi.fn();
    followPointer({ move, end }, target);

    fire(target, "pointermove");
    fire(target, "pointermove");
    fire(target, "pointerup");
    fire(target, "pointermove");
    fire(target, "pointerup");

    expect(move).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledOnce();
    expect(end.mock.calls[0][0]).toBe("up");
  });

  it("ends on a cancel, says so, and stops listening", () => {
    const target = new EventTarget();
    const move = vi.fn();
    const end = vi.fn();
    followPointer({ move, end }, target);

    fire(target, "pointercancel");
    fire(target, "pointermove");
    fire(target, "pointerup");

    expect(move).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
    expect(end.mock.calls[0][0]).toBe("cancel");
  });

  it("can be stopped from outside without ending", () => {
    const target = new EventTarget();
    const end = vi.fn();
    const stop = followPointer({ move: () => {}, end }, target);
    stop();
    fire(target, "pointerup");
    expect(end).not.toHaveBeenCalled();
  });
});

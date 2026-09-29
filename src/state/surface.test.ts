import { describe, expect, it } from "vitest";

import { subscribeToSurface, surfaceGone, surfaceNow, surfaceShown } from "./surface";

describe("which generator is on screen", () => {
  it("is the view that last came on, and nothing once it goes", () => {
    let told = 0;
    const stop = subscribeToSurface(() => told++);
    expect(surfaceNow()).toBeNull();
    surfaceShown("forge");
    expect(surfaceNow()).toBe("forge");
    surfaceShown("forge");
    expect(told, "said once, not again for the same view").toBe(1);
    surfaceGone("forge");
    expect(surfaceNow()).toBeNull();
    stop();
  });

  it("is not cleared by a view leaving after another arrived", () => {
    // Whatever order a switch of mode runs the two effects in.
    surfaceShown("forge");
    surfaceShown("quill");
    surfaceGone("forge");
    expect(surfaceNow()).toBe("quill");
    surfaceGone("quill");
  });
});

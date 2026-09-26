/**
 * Which document a check belongs to, and which run of it may still report.
 */

import { describe, expect, it } from "vitest";

import type { AppState } from "@/state/model";

import { documentKey, RunGuard } from "./report-run";

const front = (id: string, loan: AppState["loan"] = null) => ({
  open: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ],
  openAt: id === "a" ? 0 : 1,
  loan,
});

describe("the document a check is about", () => {
  it("is the tab in front, whatever the typeface object is", () => {
    expect(documentKey(front("a"))).toBe("a");
    expect(documentKey(front("b"))).not.toBe(documentKey(front("a")));
  });

  it("is a different one while a letter is on loan", () => {
    const lent = front("a", {} as AppState["loan"]);
    expect(documentKey(lent)).not.toBe(documentKey(front("a")));
  });
});

describe("which run may report", () => {
  it("lets the newest run on the same document speak", () => {
    const guard = new RunGuard();
    const ticket = guard.start("a");
    expect(guard.current(ticket, "a")).toBe(true);
  });

  it("silences a run once the document in front has changed", () => {
    const guard = new RunGuard();
    const ticket = guard.start("a");
    expect(guard.current(ticket, "b")).toBe(false);
  });

  it("silences a run superseded by a newer one, or cancelled", () => {
    const guard = new RunGuard();
    const first = guard.start("a");
    const second = guard.start("a");
    expect(guard.current(first, "a")).toBe(false);
    expect(guard.current(second, "a")).toBe(true);
    guard.cancel();
    expect(guard.current(second, "a")).toBe(false);
  });
});

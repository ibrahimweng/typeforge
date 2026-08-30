/**
 * Which ground the type is being looked at on.
 *
 * Two words rather than an icon, because the choice is not obvious enough to
 * carry a symbol: a sun and a moon would say "theme", and this is not a theme.
 * The chrome does not move. What changes is the surface a letter is drawn on,
 * in the places where a letter is being judged rather than operated.
 */

import * as React from "react";

import { store, useAppState } from "@/state/useStore";
import { segment, SEGMENT_TRACK } from "@/components/controls";

export function GroundToggle(): React.JSX.Element {
  const ground = useAppState().ground;
  return (
    <div className={SEGMENT_TRACK} role="group" aria-label="Ground" data-ground-toggle>
      {(["dark", "light"] as const).map((which) => (
        <button
          key={which}
          type="button"
          aria-pressed={ground === which}
          onClick={() => store.setGround(which)}
          title={
            which === "light"
              ? "Black type on white, which is what most of it will be read as"
              : "White type on black"
          }
          className={segment(ground === which, "px-2")}
        >
          {which === "dark" ? "On black" : "On white"}
        </button>
      ))}
    </div>
  );
}

/**
 * The named warps, in the strip beside the tool that uses them.
 *
 * The box on the canvas does everything a matrix or a quad can: scale, turn,
 * skew, distort, lay back. These are the ones that bend the inside of the box
 * while its corners stay put, and they are here rather than on the box because
 * there is nothing to grab for them. A bulge has no corner. What it has is a
 * name and an amount, which is a picker and a slider.
 *
 * ## Why the slider works the way it does
 *
 * Every move of it is applied from the outlines the letter had when the
 * gesture began, not from the ones on screen. Applied to what is drawn, each
 * step would bend an already bent letter and the amount would run away from
 * the number under the pointer -- and a field warp that cuts would cut its own
 * cuts, so dragging from nought to a half and back to nought would leave a
 * letter with four times the points and none of the shape.
 *
 * Letting go writes one entry to the history. Dragging writes none, which is
 * what makes the whole sweep one thing to take back.
 *
 * ## What it costs
 *
 * These are the only transforms here that add points, and they have to: only a
 * matrix takes a cubic to a cubic, so a stem drawn with two points has nothing
 * between them for a bulge to move. The count is shown beside the slider while
 * it is being dragged, because a letter that quietly went from forty points to
 * three hundred is a letter somebody finds out about at the exporter.
 */

import * as React from "react";

import { fieldMove, WARPS, type Cost, type WarpName } from "@/font/warp";
import { boxRound } from "@/views/transform-box";
import { store, useAppState } from "@/state/useStore";
import { parseNodeKey } from "@/views/glyph-pointer";
import type { Contour, Vec2 } from "@/font/types";
import { cn } from "@/cn";

const SWITCH =
  "rounded border px-2 py-1 text-2xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent";

export function WarpControl({ glyphName }: { glyphName: string }): React.JSX.Element | null {
  const selected = useAppState((state) => state.selectedNodes);
  const [name, setName] = React.useState<WarpName>("bulge");
  const [amount, setAmount] = React.useState(0);
  const [cost, setCost] = React.useState<Cost | null>(null);

  /*
   * What the gesture started from: the outlines, the selection, and the box.
   *
   * Taken when the slider is first touched and held until it is let go. All
   * three have to be the ones from the start -- the box included, since a warp
   * that moved the points would otherwise be measured against a box that had
   * moved with them, and the bend would wander as the slider moved.
   */
  const began = React.useRef<{
    contours: Contour[];
    picked: Set<string>;
    box: { left: number; right: number; bottom: number; top: number };
  } | null>(null);

  /*
   * Whether the slider is still being held.
   *
   * `onBlur` settles as well as `onPointerUp`, because a keyboard sweep never
   * sends a pointer up and would otherwise never be written down. But a blur
   * can also arrive in the middle of a drag -- Firefox is where this was
   * caught -- and settling there ends the gesture early: the baseline is
   * cleared, the next move of the same drag calls `start()` again, and the
   * outlines it takes as "before" are the ones the warp has already bent.
   *
   * What that costs is undo. The sweep is written down as one entry whose
   * before is that half-bent state, so taking it back returns the letter to
   * the middle of a drag nobody asked to stop at, with the points the cutting
   * added still in it. Eight points came back as twenty-four.
   *
   * So a blur only settles when the hand is off it.
   */
  const holding = React.useRef(false);

  /*
   * The end of the gesture is listened for on the window, not on the slider.
   *
   * Settling on the element's own pointer up looks right and is not enough: a
   * range input's thumb may or may not hold the pointer capture, and where it
   * does not the release lands on whatever the pointer is over instead. Then
   * nothing settles at all -- no entry is written, and the undo that follows
   * takes back whatever came before the warp while the bend stays on the
   * letter. Firefox is where that showed, and the first fix here missed it
   * because it was still asking the element.
   *
   * The window sees the release wherever it happens. The handler is idle
   * unless the slider is being held, so it costs nothing the rest of the time.
   */
  const settleRef = React.useRef<() => void>(() => {});
  // The amount as it is now, for a settle that runs from a window event and
  // must not answer with whatever a render happened to close over.
  const amountNow = React.useRef(0);
  amountNow.current = amount;
  const letGo = React.useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    settleRef.current();
  }, []);
  React.useEffect(() => {
    window.addEventListener("pointerup", letGo);
    window.addEventListener("pointercancel", letGo);
    return () => {
      window.removeEventListener("pointerup", letGo);
      window.removeEventListener("pointercancel", letGo);
    };
  }, [letGo]);

  const start = React.useCallback((): boolean => {
    const glyph = store.glyph(glyphName);
    if (!glyph) return false;
    const picked = new Set(store.getSnapshot().selectedNodes);
    const points = [...picked]
      .map(parseNodeKey)
      .map((ref) => glyph.contours[ref.contour]?.nodes[ref.node]?.point)
      .filter((point): point is Vec2 => point !== undefined);
    const box = boxRound(points);
    if (!box || box.right === box.left || box.top === box.bottom) return false;
    began.current = {
      contours: glyph.contours.map((one) => ({
        ...one,
        nodes: one.nodes.map((node) => ({ ...node })),
      })),
      picked,
      box,
    };
    return true;
  }, [glyphName]);

  const bend = React.useCallback(
    (to: number) => {
      const from = began.current;
      if (!from) return;
      setCost(
        store.warpSelection(
          glyphName,
          from.contours,
          from.picked,
          fieldMove(from.box, name, to),
          // Cutting is what makes a field warp follow the bend rather than
          // moving four points and leaving the lines between them straight.
          { cut: true },
        ),
      );
    },
    [glyphName, name],
  );

  /** Let go: one entry in the history for the whole sweep, or none at all. */
  const settle = React.useCallback(() => {
    const from = began.current;
    began.current = null;
    setCost(null);
    if (!from) return;
    if (amountNow.current === 0) {
      // Back where it started is not an edit. Putting the outlines back by
      // hand rather than trusting the last frame, because a sweep out and back
      // through a cutting warp does not return the points it took.
      store.editGlyphLive(glyphName, (one) => {
        one.contours = from.contours;
      });
      store.setSelectedNodes(from.picked);
      return;
    }
    const glyph = store.glyph(glyphName);
    if (glyph) {
      store.commitGlyphEdit(glyphName, `${labelOf(name)} the selection`, {
        ...glyph,
        contours: from.contours,
      });
    }
    setAmount(0);
  }, [amount, glyphName, name]);

  // Kept current, because `settle` is rebuilt as the amount changes and the
  // window handler above must call the one that knows where the sweep ended.
  settleRef.current = settle;

  // Two points is the least that has a box with any size in it to bend.
  if (selected.size < 2) return null;

  return (
    <span className="flex items-center gap-2" data-warp-control>
      <select
        aria-label="Which warp"
        data-warp-name
        value={name}
        onChange={(event) => setName(event.target.value as WarpName)}
        title={WARPS.find((one) => one.id === name)?.hint}
        className={cn(SWITCH, "border-border bg-card text-foreground")}
      >
        {WARPS.map((warp) => (
          <option key={warp.id} value={warp.id} title={warp.hint}>
            {warp.name}
          </option>
        ))}
      </select>
      <input
        type="range"
        aria-label="How much"
        data-warp-amount
        min={-100}
        max={100}
        value={Math.round(amount * 100)}
        onPointerDown={() => {
          holding.current = start();
        }}
        onKeyDown={() => began.current ?? start()}
        onChange={(event) => {
          const to = Number(event.target.value) / 100;
          setAmount(to);
          /*
           * A change with no gesture behind it starts nothing.
           *
           * The baseline used to be taken here for any change that arrived
           * without one, which is what a keyboard sweep needs -- but a pointer
           * release can be followed by one last change, and taking a baseline
           * from that one takes it from outlines the warp has already bent.
           * The sweep is then written down twice: once properly, and once more
           * from the middle of itself, and the undo that follows lands in that
           * middle. Firefox is where the trailing change showed up.
           *
           * A keyboard sweep has its baseline from `onKeyDown` before any
           * change arrives, so requiring a gesture here costs it nothing.
           */
          if (!began.current) {
            if (!holding.current) return;
            if (!start()) return;
          }
          bend(to);
        }}
        onPointerUp={letGo}
        /*
         * A cancelled pointer is a finished gesture too -- a drag the browser
         * takes over, a touch turned into a scroll -- and leaving it held
         * would strand the sweep with nothing to write it down.
         */
        onPointerCancel={letGo}
        onBlur={() => {
          if (!holding.current) settle();
        }}
        className="h-6 w-28 accent-[color:var(--accent)]"
      />
      <span className="w-8 text-2xs tabular-nums text-muted-foreground" data-warp-said>
        {Math.round(amount * 100)}
      </span>
      {/*
        What it is about to cost, while it is being dragged.

        These are the only transforms here that add points, and a letter that
        quietly went from forty to three hundred is one somebody finds out
        about at the exporter.
      */}
      {cost && cost.after !== cost.before && (
        <span className="text-2xs text-[color:var(--attention)]" data-warp-cost>
          {cost.before} → {cost.after} points
        </span>
      )}
    </span>
  );
}

/** The verb for the history, which reads better than the noun. */
function labelOf(name: WarpName): string {
  const found = WARPS.find((one) => one.id === name);
  return found ? found.name : "Warp";
}

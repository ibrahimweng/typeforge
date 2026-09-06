/**
 * The menu a right click on the letter opens.
 *
 * Everything in it could already be done. Deleting a point was a tool you took
 * up from the rail and then put down again; reversing a path was a button in a
 * panel on the far right; opening a closed outline was a tool most people never
 * found. All of them are operations on a particular point or a particular path,
 * and all of them were reached by first saying which one somewhere else.
 *
 * A right click says which one by being on it. That is the whole of the idea,
 * and it is why every drawing program has had this menu for thirty years: the
 * thing under the pointer is the argument, so the menu can be short and every
 * line in it can be a verb.
 *
 * What is offered depends on what was clicked, and nothing is listed that
 * would do nothing. A menu with six greyed lines is a menu that has to be read
 * before it can be dismissed. So a click on a point offers the point's
 * operations, a click on an edge offers the path's, and a click on empty
 * canvas offers the ones that are about the whole letter.
 *
 * Nothing here is new behaviour. Every line calls the same store method the
 * panel or the tool already called, which is deliberate: a second way to reach
 * an operation should be a second door into the same room.
 */

import * as React from "react";

import { nodeKey, store, type NodeRef } from "@/state/useStore";
import { useMenuBehaviour, type Dismissal } from "@/components/menu-keys";
import { parseNodeKey } from "@/views/glyph-pointer";
import { cn } from "@/cn";

/** What was under the pointer when the menu was asked for. */
export interface MenuTarget {
  /** Where to draw it, in client coordinates. */
  x: number;
  y: number;
  /** The point under the pointer, if there was one. */
  node: NodeRef | null;
  /** The edge under the pointer, if there was one, and where along it. */
  edge: { contour: number; index: number; t: number } | null;
}

/** One line of the menu. A missing `run` is a line that would do nothing. */
interface Item {
  label: string;
  run?: () => void;
  /** Draws a rule above this line rather than a line of its own. */
  apart?: boolean;
}

/**
 * The lines, worked out from what was clicked.
 *
 * Built as a list rather than as markup so the rules between the groups can be
 * put in after the empty entries are dropped. A separator above a group that
 * turned out to have nothing in it is the one piece of a context menu that
 * always looks broken.
 */
function itemsFor(target: MenuTarget, glyphName: string, selected: ReadonlySet<string>): Item[] {
  const items: Item[] = [];
  const contour = target.node?.contour ?? target.edge?.contour ?? null;

  if (target.node) {
    /*
     * The point's own operations, on the point that was clicked.
     *
     * When several points are picked and this is one of them, the delete acts
     * on all of them: right-clicking inside a selection to act on the
     * selection is what every program does, and picking six points and then
     * losing five of them to a right click would be its own kind of wrong.
     */
    const picked = selected.has(nodeKey(target.node));
    const refs = picked && selected.size > 1 ? [...selected].map(parseNodeKey) : [target.node];
    items.push({
      label: refs.length > 1 ? `Delete ${refs.length} points` : "Delete point",
      run: () => void store.removePoints(glyphName, refs),
    });
    items.push({
      label: "Corner or curve",
      run: () => void store.convertPoint(glyphName, target.node!),
    });
    items.push({
      label: "Open the path here",
      run: () => void store.openContourAt(glyphName, target.node!.contour, target.node!.node),
    });
  }

  if (target.edge && !target.node) {
    items.push({
      label: "Add a point here",
      run: () =>
        void store.addPointOn(glyphName, target.edge!.contour, target.edge!.index, target.edge!.t),
    });
  }

  if (contour !== null) {
    items.push({
      label: "Select this path",
      apart: items.length > 0,
      run: () => store.selectAllNodes(glyphName, contour),
    });
    items.push({
      label: "Reverse its direction",
      run: () => store.reverseContour(glyphName, contour),
    });
    items.push({
      label: "Delete this path",
      run: () => store.removeContour(glyphName, contour),
    });
  }

  // And the ones about the whole letter, which are offered wherever you click.
  items.push({
    label: "Select every point",
    apart: items.length > 0,
    run: () => store.selectAllNodes(glyphName),
  });
  if (selected.size > 0) {
    items.push({ label: "Pick nothing", run: () => store.setSelectedNodes([]) });
  }
  items.push({
    label: "Add the missing extremes",
    apart: true,
    run: () => store.addExtremes(glyphName),
  });
  items.push({
    label: "Round to whole units",
    run: () => store.roundSelection(glyphName),
  });
  items.push({
    label: "Set the path directions",
    run: () => store.correctPathDirection(glyphName),
  });

  return items;
}

/**
 * Put the focus back on the letter, having taken it to open the menu.
 *
 * Both ways out of the menu that are a decision rather than a change of
 * subject: Escape, and choosing a line. Without it the focus is on a button
 * that is about to be removed, and a focus that lands nowhere goes to the
 * body -- from where the next Tab starts at the top of the page rather than
 * where the person was standing.
 *
 * Not on a click elsewhere, which is a change of subject: somebody who clicked
 * a panel wants to be in the panel.
 */
function backToTheDrawing(): void {
  document.querySelector<HTMLCanvasElement>("[data-glyph-canvas]")?.focus();
}

export function CanvasMenu({
  target,
  glyphName,
  selected,
  onClose,
}: {
  target: MenuTarget;
  glyphName: string;
  selected: ReadonlySet<string>;
  onClose: () => void;
}): React.JSX.Element {
  const items = React.useMemo(
    () => itemsFor(target, glyphName, selected),
    [target, glyphName, selected],
  );
  const ref = React.useRef<HTMLDivElement>(null);

  /*
   * The keys and the ways out, shared with the menu that starts a font.
   *
   * Both say `role="menu"`, which is a promise to a screen reader that the
   * arrows walk them. Two copies of that promise is how one of them comes to
   * be broken quietly, so it is kept in one place.
   *
   * This one takes the focus as it opens: a right click puts a menu where the
   * pointer is and nothing else is holding the focus, so the first line should
   * have it. Escape puts it back on the drawing rather than on a button that
   * is about to be removed -- a focus that lands nowhere goes to the body, and
   * from there the next Tab starts at the top of the page rather than where
   * the person was standing. A click elsewhere does not, because that is a
   * change of subject: somebody who clicked a panel wants to be in the panel.
   */
  const { onKeyDown } = useMenuBehaviour({
    menu: ref,
    onClose: React.useCallback(
      (why: Dismissal) => {
        if (why === "escape") backToTheDrawing();
        onClose();
      },
      [onClose],
    ),
  });

  /*
   * Kept on screen, measured after it is drawn.
   *
   * A right click near the bottom right of the window puts the corner of a
   * menu off the edge of it, and this one is opened at the pointer by
   * definition -- so the case is not an edge case, it is what happens whenever
   * somebody works in the bottom half of the canvas.
   */
  const [at, setAt] = React.useState({ left: target.x, top: target.y });
  React.useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    setAt({
      left: Math.max(margin, Math.min(target.x, window.innerWidth - box.width - margin)),
      top: Math.max(margin, Math.min(target.y, window.innerHeight - box.height - margin)),
    });
  }, [target]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="What to do with this"
      data-canvas-menu
      onKeyDown={onKeyDown}
      style={{ left: at.left, top: at.top }}
      className="fixed z-50 min-w-52 rounded-md border border-border bg-popover py-1 shadow-lg"
    >
      {items.map((item, index) => (
        <React.Fragment key={item.label}>
          {item.apart && index > 0 && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            data-canvas-menu-item
            data-menu-item
            disabled={!item.run}
            onClick={() => {
              item.run?.();
              backToTheDrawing();
              onClose();
            }}
            className={cn(
              "block w-full px-3 py-1.5 text-left text-xs-plus text-popover-foreground",
              "transition-colors hover:bg-accent hover:text-accent-foreground",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

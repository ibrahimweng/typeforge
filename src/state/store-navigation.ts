/**
 * Moving about: which view is up, which letter is open, what is selected.
 *
 * Nothing here changes the document, so nothing here calls `touch`. It reads
 * the state and it writes the state, and that is the whole of it.
 */

import { NEARLY_STRAIGHT, offSmooth } from "@/font/marks";
import {
  groupOf,
  nextIn,
  toolsIn,
  type GroupId as Group,
  type ToolId as Tool,
} from "@/font/toolset";

import type { AppState, ToolState, ViewId } from "./model";
import { nodeKey } from "./model";
import { StoreCore } from "./store-core";

export abstract class NavigationStore extends StoreCore {
  setView(view: ViewId): void {
    this.set({ view });
  }
  /**
   * What the tool in hand is doing.
   *
   * Set from the canvas as a gesture runs. Compared before it is stored,
   * because this fires on every pointer move and a `set` that changes nothing
   * still re-renders every subscriber -- which on a canvas redrawing six
   * thousand glyph outlines is the difference between a drag that follows the
   * pointer and one that does not.
   */
  setToolState(next: ToolState): void {
    const now = this.state.toolState;
    if (now.phase === next.phase && now.says === next.says) return;
    this.set({ toolState: next });
  }

  setTool(tool: Tool): void {
    /*
     * Picking the tool you already have changes nothing, and must say nothing.
     *
     * Clearing the phase is what stops a stale sentence from the last tool
     * sitting under the new one, and the editor fills it back in on a change of
     * tool. Cleared without a change there is nothing to fill it back in, so the
     * line went blank and fell through to its default -- which is how choosing
     * the rectangle from the flyout while already holding the rectangle left
     * `Select one point to type its position` under a rectangle tool.
     */
    if (tool === this.state.tool) return;
    // A tool picked up mid-anything starts from nothing, which is also what
    // stops a stale sentence from the last tool sitting under the new one.
    this.set({
      tool,
      lastInGroup: { ...this.state.lastInGroup, [groupOf(tool)]: tool },
      toolState: { phase: "idle", says: "" },
    });
  }

  /**
   * Take up a group: the tool you last used from it, or the next one along if
   * you are already in it.
   *
   * What the group's single key does, and what its button does. The second
   * press walking the group is how every drawing program spends it, and it is
   * the only way to reach a tool without opening the flyout.
   */
  takeUpGroup(group: Group): void {
    const inGroup = toolsIn(group).some((one) => one.id === this.state.tool);
    this.setTool(inGroup ? nextIn(group, this.state.tool) : this.state.lastInGroup[group]);
  }
  /** Change what stands either side of the glyph being edited. */
  setContext(context: Partial<AppState["context"]>): void {
    this.set({ context: { ...this.state.context, ...context } });
  }

  /**
   * Swap the ground the type is drawn on.
   *
   * Only state. The two surfaces that honour it render the attribute
   * themselves, which is what keeps this from being a theme and what keeps
   * the store out of the document.
   *
   * It was briefly the other way round -- an effect writing the attribute on
   * the root -- and that is worth recording, because the failure was not
   * obvious. Effects fire child before parent, so every canvas repainted
   * before the attribute landed, read `--glyph-fill` off a root that still
   * said dark, and drew near-white letters on the new white page; the
   * attribute arrived a moment later with nothing left to repaint. Rendering
   * it removes the question: React commits the attribute before it runs the
   * effect that paints.
   */
  setGround(ground: AppState["ground"]): void {
    this.set({ ground });
  }

  /** Put a guide across the canvas or down it, in font units. */
  addGuide(at: number, axis: "x" | "y" = "y"): void {
    this.set({ guides: [...this.state.guides, { axis, at: Math.round(at) }] });
  }

  /** Move one, while it is being dragged. Its axis is fixed when it is made. */
  moveGuide(index: number, at: number): void {
    const guides = this.state.guides.map((one, position) =>
      position === index ? { ...one, at: Math.round(at) } : one,
    );
    this.set({ guides });
  }

  removeGuide(index: number): void {
    this.set({ guides: this.state.guides.filter((_, at) => at !== index) });
  }

  clearGuides(): void {
    if (this.state.guides.length === 0) return;
    this.set({ guides: [] });
  }

  /**
   * Whether a dragged point is pulled onto the lines worth landing on.
   *
   * On to begin with, and a switch rather than a modifier because the two
   * modifiers a drag already uses are taken: shift holds a drag to one axis
   * and alt pans the canvas. A third would be a chord nobody would find.
   */
  setSnapping(snapping: boolean): void {
    this.set({ snapping });
  }

  /** Whether the canvas rings the faults that cannot be seen by looking. */
  /** Light one path on the canvas, or none. Compared before storing, because
   * this fires on every pointer move across the list and each change repaints
   * the whole canvas. */
  setHighlightPath(index: number | null): void {
    if (this.state.highlightPath !== index) this.set({ highlightPath: index });
  }

  /** Ask the app to change document kind, from a view that cannot. */
  askForMode(mode: string): void {
    this.set({ wantsMode: mode });
  }

  /** The app has acted on the request and it must not fire again. */
  modeAsked(): void {
    if (this.state.wantsMode !== null) this.set({ wantsMode: null });
  }

  /** The pen has begun, or gone on with, an outline. */
  startDrawing(): void {
    if (!this.state.drawing) this.set({ drawing: true });
  }

  setPolygonSides(sides: number): void {
    this.set({ polygonSides: Math.max(3, Math.min(24, Math.round(sides))) });
  }

  setMarks(marks: boolean): void {
    this.set({ marks });
  }
  setSearch(search: string): void {
    this.set({ search });
  }
  setPreviewText(previewText: string): void {
    this.set({ previewText });
  }
  setStatus(status: AppState["status"]): void {
    this.set({ status });
  }

  selectGlyph(name: string | null, options: { open?: boolean } = {}): void {
    this.set({
      selectedGlyph: name,
      selectedNodes: new Set(),
      view: options.open ? "glyph" : this.state.view,
    });
  }

  setSelectedNodes(keys: Iterable<string>): void {
    this.set({ selectedNodes: new Set(keys) });
  }

  /*
   * Picking points when there are a great many of them.
   *
   * A marquee and a click are the whole of what this had, which works up to
   * about a dozen points and stops working entirely on a traced or imported
   * outline of two hundred. The three below are what every editor offers
   * instead, and each answers a question a rubber band cannot: "this shape, not
   * the one behind it", "every corner, wherever they are", "the next one along
   * so I can walk the path".
   */

  /** Every point in the letter, or every point in one contour. */
  selectAllNodes(glyphName: string, contour?: number): void {
    const glyph = this.glyph(glyphName);
    if (!glyph) return;
    const keys: string[] = [];
    glyph.contours.forEach((one, at) => {
      if (contour !== undefined && at !== contour) return;
      one.nodes.forEach((_, node) => {
        keys.push(nodeKey({ contour: at, node }));
      });
    });
    this.setSelectedNodes(keys);
    this.say(
      keys.length === 0
        ? "Nothing to pick."
        : `${keys.length} ${keys.length === 1 ? "point" : "points"} picked.`,
      "info",
    );
  }

  /**
   * Every point of one kind.
   *
   * The one that saves the most work: "make every corner smooth" and "round
   * every corner onto the grid" are both a single operation once the corners
   * are picked, and picking them by hand on a letter with forty of them is the
   * reason nobody does it.
   *
   * Asks the geometry rather than the stored type where the two can disagree: a
   * node typed `smooth` whose handles are twenty degrees apart is a corner to
   * everything that reads the font, whatever the file calls it.
   *
   * A point with fewer than two handles has no angle to measure and counts as a
   * corner, which is right for the case that matters -- every point of a square
   * -- and arguable for a tangent, where a straight runs into a curve. `Smooth`
   * is the operation somebody reaches for after picking, and running it on a
   * tangent does nothing, so the cost of the arguable case is nothing.
   */
  selectNodesOfKind(glyphName: string, kind: "corner" | "smooth" | "handleless"): void {
    const glyph = this.glyph(glyphName);
    if (!glyph) return;
    const keys: string[] = [];
    glyph.contours.forEach((one, at) => {
      one.nodes.forEach((node, index) => {
        const off = offSmooth(node);
        const matches =
          kind === "handleless"
            ? !node.handleIn && !node.handleOut
            : off === null
              ? kind === "corner"
              : kind === "smooth"
                ? off <= NEARLY_STRAIGHT
                : off > NEARLY_STRAIGHT;
        if (matches) keys.push(nodeKey({ contour: at, node: index }));
      });
    });
    this.setSelectedNodes(keys);
    const named = kind === "handleless" ? "straight-line points" : `${kind} points`;
    this.say(keys.length === 0 ? `No ${named}.` : `${keys.length} ${named} picked.`, "info");
  }

  /**
   * The next point along the path, which is how a path gets walked.
   *
   * Tab in every drawing program there is, and the only way to inspect a
   * hundred-point outline point by point without hunting for each with the
   * pointer. Wraps within the contour rather than running off the end, because
   * a contour is a loop and walking one should be able to go round.
   */
  stepSelection(glyphName: string, by: 1 | -1): void {
    const glyph = this.glyph(glyphName);
    if (!glyph || glyph.contours.length === 0) return;

    const picked = [...this.state.selectedNodes].map((key) => {
      const [contour, node] = key.split(":").map(Number);
      return { contour, node };
    });
    // From nothing, start at the first point rather than nowhere.
    const from = picked[picked.length - 1] ?? { contour: 0, node: by === 1 ? -1 : 0 };
    const contour = glyph.contours[from.contour];
    if (!contour || contour.nodes.length === 0) return;
    const count = contour.nodes.length;
    const next = (((from.node + by) % count) + count) % count;
    this.setSelectedNodes([nodeKey({ contour: from.contour, node: next })]);
  }

  toggleGlyphSelection(name: string, additive: boolean): void {
    const next = new Set(additive ? this.state.selectedGlyphs : []);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.set({ selectedGlyphs: next });
  }

  clearGlyphSelection(): void {
    this.set({ selectedGlyphs: new Set() });
  }
}

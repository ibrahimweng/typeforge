/**
 * What tools there are, and which ones belong together.
 *
 * Six tools sat in a flat column, which is what you do with six. The pen alone
 * has four jobs -- place points, take them out, put one on an edge, change what
 * a point is -- and every one of them was either a modifier nobody could guess
 * or not there at all. Thirteen tools in a flat column is a column of thirteen
 * icons nobody can tell apart, so they group: one button per group showing the
 * tool you last used from it, and the rest a click away.
 *
 * This is the arrangement every drawing program has had since Illustrator 88,
 * for the reason that has kept it: the four pen tools are one idea with four
 * verbs, and a person looking for "take this point out" looks under the nib.
 *
 * Here rather than in the palette because three other things read it -- the
 * canvas decides what a click does, the store validates a saved tool, and the
 * status line asks which group is in hand. A list of tools that lives inside
 * the component drawing the buttons is a list only the buttons agree with.
 */

/** Every tool, in the order its group presents it. */
export type ToolId =
  // Select
  | "select"
  | "selectPath"
  | "lasso"
  // Pen
  | "pen"
  | "freehand"
  | "addPoint"
  | "deletePoint"
  | "convertPoint"
  // Shapes
  | "rectangle"
  | "ellipse"
  | "polygon"
  // Knife
  | "knife"
  | "scissors";

export type GroupId = "select" | "pen" | "shape" | "knife";

export interface ToolInfo {
  id: ToolId;
  group: GroupId;
  name: string;
  /** One line, shown on the flyout row and in the button's hover. */
  hint: string;
}

/**
 * The tools, grouped.
 *
 * Order within a group is the order of the flyout, and the first of each is
 * what the group starts on. `pencil` became `freehand` and moved under the pen
 * on the argument that it is one: a pen that takes a drawn line instead of a
 * series of clicks. It was a top-level icon of its own, which put the two ways
 * of drawing the same outline in two different places.
 */
export const TOOLS: ToolInfo[] = [
  {
    id: "select",
    group: "select",
    name: "Select",
    hint: "Pick and move points and handles. Drag a box to pick several.",
  },
  {
    id: "selectPath",
    group: "select",
    name: "Select path",
    hint: "Pick a whole shape at once, rather than the points in it.",
  },
  {
    id: "lasso",
    group: "select",
    name: "Lasso",
    hint: "Draw a ring round the points to pick. What a box cannot do on a curve.",
  },

  {
    id: "pen",
    group: "pen",
    name: "Pen",
    hint: "Click for a corner; hold and pull for a curve. Escape finishes, or click the first point to close.",
  },
  {
    id: "freehand",
    group: "pen",
    name: "Freehand",
    hint: "Draw a line as you would with a pencil. It is fitted to curves when you let go.",
  },
  {
    id: "addPoint",
    group: "pen",
    name: "Add point",
    hint: "Click an edge to put a point on it. The curve either side does not move.",
  },
  {
    id: "deletePoint",
    group: "pen",
    name: "Delete point",
    hint: "Click a point to take it out. The curve through its neighbours is drawn again.",
  },
  {
    id: "convertPoint",
    group: "pen",
    name: "Convert point",
    hint: "Click a point to turn a curve into a corner and back. Pull to bring a handle out of a corner.",
  },

  {
    id: "rectangle",
    group: "shape",
    name: "Rectangle",
    hint: "Drag a rectangle. Shift for a square, alt from the middle.",
  },
  {
    id: "ellipse",
    group: "shape",
    name: "Ellipse",
    hint: "Drag an ellipse. Shift for a circle, alt from the middle.",
  },
  {
    id: "polygon",
    group: "shape",
    name: "Polygon",
    hint: "Drag a regular polygon. Shift holds it upright; the side count is in the panel.",
  },

  {
    id: "knife",
    group: "knife",
    name: "Knife",
    hint: "Drag a line right across a shape to cut it in two.",
  },
  {
    id: "scissors",
    group: "knife",
    name: "Scissors",
    hint: "Click a point or an edge to open the shape there, rather than cutting it in two.",
  },
];

const BY_ID = new Map(TOOLS.map((one) => [one.id, one]));

export function toolInfo(id: ToolId): ToolInfo {
  // Every ToolId is in the list above, and the map is built from that list;
  // the fallback is here so a saved tool from an older version cannot crash
  // the editor on the way in.
  return BY_ID.get(id) ?? TOOLS[0];
}

export function isToolId(value: string): value is ToolId {
  return BY_ID.has(value as ToolId);
}

export function groupOf(id: ToolId): GroupId {
  return toolInfo(id).group;
}

export function toolsIn(group: GroupId): ToolInfo[] {
  return TOOLS.filter((one) => one.group === group);
}

/**
 * The groups, with the single key each answers to.
 *
 * One key per group rather than one per tool, because thirteen single-key
 * shortcuts is more than a keyboard has room for next to everything else the
 * editor binds, and because the group is the thing a person means: `P` for
 * "the pen, whichever of them I had". Pressing it again walks the group, which
 * is how Illustrator, Figma and Sketch all spend the second press.
 */
export const GROUPS: { id: GroupId; name: string; key: string }[] = [
  { id: "select", name: "Select", key: "V" },
  { id: "pen", name: "Pen", key: "P" },
  { id: "shape", name: "Shapes", key: "R" },
  { id: "knife", name: "Knife", key: "K" },
];

/** The next tool in the group, for the second press of the group's key. */
export function nextIn(group: GroupId, current: ToolId): ToolId {
  const list = toolsIn(group);
  const at = list.findIndex((one) => one.id === current);
  return list[(at + 1) % list.length].id;
}

/**
 * Which tools work on a point, an edge, or a whole shape that is already there.
 *
 * The canvas asks this to decide whether to light what is under the pointer:
 * a tool that edits something has to show which something, and a tool that
 * makes new outlines must not, or every hover over a letter lights it up.
 */
export function editsWhatIsThere(id: ToolId): boolean {
  return id === "addPoint" || id === "deletePoint" || id === "convertPoint" || id === "scissors";
}

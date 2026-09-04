import { retracted } from "@/font/pen";
import { cloneGlyph } from "@/font/types";
import type { Glyph, Vec2 } from "@/font/types";
import { dominantConvention } from "@/font/outline";
import { followPens, inkOf, penAtNodes, type SavedPen } from "@/quill/written";
import type { QuillSegment, QuillStroke } from "@/quill/types";
import { strokeToContour } from "@/font/freehand";
import { isClockwise, reverseContour as flipContour } from "@/font/geometry";
import { OutlineStore } from "./store-outlines";

export abstract class PenStore extends OutlineStore {
  /**
   * Put a freehand stroke into the letter.
   *
   * Wound the way the font is wound, for the same reason a dragged shape is: a
   * stroke drawn anticlockwise into a clockwise font would cut a hole through
   * whatever it was drawn over. Which way a hand happened to go round a bowl
   * is not a decision about filling.
   */
  addStroke(glyphName: string, trail: Vec2[]): boolean {
    const typeface = this.state.typeface;
    if (!typeface) return false;
    const drawn = strokeToContour(trail);
    if (!drawn) return false;

    const clockwise = dominantConvention(typeface.glyphs) === "truetype";
    const contour = drawn.closed && isClockwise(drawn) !== clockwise ? flipContour(drawn) : drawn;

    this.editGlyph(glyphName, "Draw freehand", (one) => {
      one.contours = [...one.contours, contour];
    });
    return true;
  }

  /**
   * The pen a fresh stroke is written with.
   *
   * Held on the desk rather than on the letter, because it is the hand rather
   * than the drawing: somebody who sets a pen to forty degrees means the next
   * stroke as much as this one, and having to set it again per stroke is what
   * makes an alphabet come out inconsistent.
   */
  get pen(): { width: number; contrast: number; angle: number } {
    return this.state.pen;
  }

  setPen(pen: Partial<{ width: number; contrast: number; angle: number }>): void {
    this.set({ pen: { ...this.state.pen, ...pen } });
  }

  /** The strokes of a letter, or an empty list where it was not written. */
  strokesOf(name: string): QuillStroke[] {
    return this.glyph(name)?.written?.strokes ?? [];
  }

  /**
   * Bring a written letter's ink back into step with its strokes.
   *
   * Called after every change to the strokes, and it is the reason the rest of
   * the application never has to know a pen was involved: the contours are
   * always what the strokes sweep to, so the proof page and the exporter and
   * every path tool go on reading contours.
   *
   * A letter that has been expanded is left alone. There the outlines are the
   * letter and the strokes are only kept so it can be taken back.
   */
  private reswept(glyph: Glyph): void {
    const written = glyph.written;
    if (!written || written.expanded) return;
    glyph.contours = inkOf(written.strokes, this.state.typeface?.unitsPerEm ?? 1000);
  }

  /**
   * Start a written stroke, or add a point to the one being written.
   *
   * The mirror of the pen's `addPoint`, and deliberately the same gesture: a
   * click puts a corner down, a pull brings a curve out of it. What differs is
   * what the line means. The pen's line is the edge of the letter and this one
   * is its middle, so this one is not the shape -- the shape is what the pen
   * sweeps along it, and it appears the moment there are two points.
   */
  writePoint(name: string, at: Vec2): void {
    const glyph = this.glyph(name);
    if (!glyph) return;
    /*
     * Writing on a letter whose ink has been taken puts it back to strokes.
     *
     * Because otherwise the stroke goes in and the letter does not move: the
     * ink stopped following the strokes when it was taken, so `reswept` is a
     * no-op and the person is drawing into nothing while the status line
     * cheerfully offers to fill it in. Nothing is lost by going back, and this
     * is why: an expanded letter still carrying its strokes is one nobody has
     * hand-edited, since the first edit clears them. So the outlines here are
     * exactly what the sweep made and re-sweeping them changes nothing.
     */
    if (glyph.written?.expanded) this.unexpandWritten(name);
    const { width, contrast, angle } = this.state.pen;
    const using = this.state.usingPen ?? undefined;
    const going = this.state.writing;

    /*
     * A click with nothing being written starts a stroke rather than adding to
     * the last one, and this is the distinction the pen next door had to learn
     * too. "Is the last stroke open" is a fact about the shape; "is somebody
     * part way through writing one" is a fact about the session. With one flag
     * for both, a stroke finished with Escape was still the open one, so the
     * next click reached back and extended it -- and two strokes of an `n` came
     * out as a single zig-zag through the middle of the letter.
     *
     * The stroke starts empty and carries no segment, because one point is a
     * place and not a stroke. The point waits on the desk until a second click
     * gives it somewhere to go.
     */
    if (!going || going.name !== name) {
      this.editGlyph(name, "Write", (editing) => {
        const written = editing.written ?? { strokes: [] };
        written.strokes.push({
          spine: { segments: [], closed: false },
          width: [{ at: 0, width }],
          nib: [{ at: 0, contrast, angle, ...(using ? { pen: using } : {}) }],
          start: { kind: "butt" },
          end: { kind: "butt" },
          join: "round",
        });
        editing.written = written;
      });
      this.set({ writing: { name, from: { ...at } } });
      return;
    }

    this.editGlyph(name, "Write", (editing) => {
      const strokes = editing.written?.strokes ?? [];
      const open = strokes[strokes.length - 1];
      if (!open || open.spine.closed) return;
      const segments = open.spine.segments;
      const last = segments[segments.length - 1];
      const from = last && last.kind !== "arc" ? last.to : going.from;
      /*
       * A straight cubic rather than a line, so that pulling a handle out of
       * either end has somewhere to pull from. A line segment would have to be
       * replaced by a cubic the moment somebody curved it, and the spine would
       * change kind under a gesture that was meant to shape it.
       */
      segments.push({
        kind: "cubic",
        from: { ...from },
        c1: { ...from },
        c2: { ...at },
        to: { ...at },
      });
      open.nib = penAtNodes(open.spine, open.nib);
      this.reswept(editing);
    });
  }

  /**
   * The classical calligraphic grid, measured in pen widths.
   *
   * A calligrapher does not set an x-height in units, they set it in nib
   * widths: a Textura at four and a half, a Roundhand at five, a display hand
   * at three. That is the whole construction of a written alphabet and it is
   * the one piece of the craft the guides could not express -- so somebody who
   * knows exactly what they are doing had to work out that 4.5 nibs of a
   * sixty-unit pen is two hundred and seventy units, and type it.
   *
   * The ascender and descender each run two pen widths beyond, which is the
   * classical proportion, and the vertical metrics are set to match so the
   * proof page and the exporter agree with the guides.
   */
  writtenGrid(nibs: number): void {
    const typeface = this.state.typeface;
    if (!typeface) return;
    const width = Math.max(1, this.state.pen.width);
    const xHeight = Math.round(width * nibs);
    const beyond = Math.round(width * 2);
    const metrics = {
      ...typeface.metrics,
      xHeight,
      capHeight: xHeight + beyond,
      ascender: xHeight + beyond,
      descender: -beyond,
    };
    typeface.metrics = metrics;
    this.set({
      guides: [
        { axis: "y" as const, at: 0 },
        { axis: "y" as const, at: xHeight },
        { axis: "y" as const, at: xHeight + beyond },
        { axis: "y" as const, at: -beyond },
        // One pen width in from the left, which is the distance Textura sets
        // between two stems and the usual place a written letter starts.
        { axis: "x" as const, at: Math.round(width) },
      ],
    });
    this.say(
      `Guides at ${nibs} pen widths: x-height ${xHeight}, and ${beyond} beyond each way.`,
      "success",
    );
  }

  // -------------------------------------------------------------------------
  // Saved pens
  // -------------------------------------------------------------------------

  get pens(): SavedPen[] {
    return this.state.pens;
  }

  /**
   * Write the next stroke with a saved pen, or with the hand's own again.
   *
   * Also sets the hand's three numbers to the pen's, so the panel shows what
   * will actually be drawn rather than a set of numbers the saved pen is about
   * to override.
   */
  usePen(id: string | null): void {
    if (!id) {
      this.set({ usingPen: null });
      return;
    }
    const saved = this.state.pens.find((one) => one.id === id);
    if (!saved) return;
    this.set({
      usingPen: id,
      pen: { width: saved.width, contrast: saved.contrast, angle: saved.angle },
    });
  }

  /**
   * Save the pen in hand under a name.
   *
   * From whatever the panel is currently showing, which is either a stop that
   * was picked or the hand's own -- so "make this a pen" works from a letter
   * that came out well, which is how somebody who is not thinking in numbers
   * arrives at a set of pens.
   *
   * The name is a starting point rather than a question. Asked for up front it
   * was a browser prompt, the only one in the application: unstyled, blocking,
   * and with no way to change the answer afterwards. Given a name straight away
   * the pen exists, and the row it lands in is a field to type over -- which is
   * how a version is named next door, and means renaming works for the five
   * pens that ship as well as the ones somebody makes.
   */
  savePen(name: string): string | null {
    const taken = new Set(this.state.pens.map((one) => one.name));
    let trimmed = name.trim() || "Pen";
    // A duplicate name is not wrong, but two rows reading the same thing are
    // two rows nobody can tell apart.
    if (taken.has(trimmed)) {
      let at = 2;
      while (taken.has(`${trimmed} ${at}`)) at += 1;
      trimmed = `${trimmed} ${at}`;
    }
    const { width, contrast, angle } = this.state.pen;
    const id = `pen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.set({
      pens: [...this.state.pens, { id, name: trimmed, width, contrast, angle }],
      usingPen: id,
    });
    this.say(`Saved as ${trimmed}. Type over the name to change it.`, "success");
    return id;
  }

  /**
   * Change a saved pen, and with it every stroke that follows it.
   *
   * The whole point of the feature and the one operation that has to reach
   * outside the letter in hand: every written glyph in the font is brought back
   * into line, and their outlines re-swept. One history entry for all of it,
   * because it is one act.
   */
  editPen(id: string, change: Partial<Omit<SavedPen, "id">>): void {
    const typeface = this.state.typeface;
    const before = this.state.pens;
    const after = before.map((one) => (one.id === id ? { ...one, ...change } : one));
    this.set({ pens: after });
    if (change.name !== undefined && Object.keys(change).length === 1) return;
    if (!typeface) return;

    const touched: Array<{ index: number; was: Glyph }> = [];
    typeface.glyphs.forEach((glyph, index) => {
      if (!glyph.written?.strokes.some((one) => one.nib.some((stop) => stop.pen === id))) return;
      touched.push({ index, was: cloneGlyph(glyph) });
      glyph.written.strokes = followPens(glyph.written.strokes, after);
      this.reswept(glyph);
      glyph.dirty = true;
    });
    if (touched.length === 0) return;

    const now = touched.map(({ index }) => cloneGlyph(typeface.glyphs[index]));
    this.push({
      label: "Change the pen",
      undo: () => {
        this.set({ pens: before });
        touched.forEach(({ index, was }) => {
          typeface.glyphs[index] = cloneGlyph(was);
        });
      },
      redo: () => {
        this.set({ pens: after });
        touched.forEach(({ index }, at) => {
          typeface.glyphs[index] = cloneGlyph(now[at]);
        });
      },
    });
    this.touch();
    this.say(
      `${touched.length} letter${touched.length === 1 ? "" : "s"} followed the pen.`,
      "success",
    );
  }

  /**
   * Put a saved pen on a stop, or take a stop off the pen it follows.
   *
   * Detaching keeps the numbers rather than resetting them, because the point
   * of detaching is that this one place is nearly right and needs to be its
   * own -- and a detach that reset the pen would throw away the thing being
   * kept.
   */
  setStopPen(name: string, stroke: number, stop: number, id: string | null): void {
    const saved = id ? this.state.pens.find((one) => one.id === id) : undefined;
    this.editGlyph(name, id ? "Use the pen" : "Free the pen", (editing) => {
      const one = editing.written?.strokes[stroke];
      const held = one?.nib[stop];
      if (!one || !held) return;
      if (saved) {
        held.pen = saved.id;
        held.contrast = saved.contrast;
        held.angle = saved.angle;
        one.width = [{ at: 0, width: saved.width }];
      } else {
        delete held.pen;
      }
      this.reswept(editing);
    });
  }

  /** Take a saved pen away. Strokes that followed it keep the shape they had. */
  deletePen(id: string): void {
    const typeface = this.state.typeface;
    this.set({
      pens: this.state.pens.filter((one) => one.id !== id),
      usingPen: this.state.usingPen === id ? null : this.state.usingPen,
    });
    if (!typeface) return;
    /*
     * Detached rather than left pointing at nothing. `penOf` falls back to the
     * stop's own values for a pen that is gone, so the letters would look right
     * either way -- but a stop that names a pen the font does not have is a
     * thing somebody has to explain later.
     */
    for (const glyph of typeface.glyphs) {
      for (const one of glyph.written?.strokes ?? []) {
        for (const stop of one.nib) if (stop.pen === id) delete stop.pen;
      }
    }
    this.touch();
  }

  /** Which pen the panel is showing. */
  get stop(): { stroke: number; stop: number } | null {
    return this.state.stop;
  }

  /** Show this pen in the panel, and light its ellipse on the canvas. */
  pickStop(stroke: number, stop: number): void {
    this.set({ stop: { stroke, stop } });
  }

  /** Whether a stroke is part-written and waiting for more points. */
  get writing(): { name: string; from: Vec2 } | null {
    return this.state.writing;
  }

  /** Finish the stroke being written, leaving its ends loose. */
  finishStroke(): void {
    if (!this.state.writing) return;
    this.set({ writing: null });
  }

  /** Close the stroke being written into a ring, as an `o` is written. */
  closeStroke(name: string): boolean {
    const strokes = this.strokesOf(name);
    const open = strokes[strokes.length - 1];
    if (!open || open.spine.closed || open.spine.segments.length < 2) return false;
    this.editGlyph(name, "Close the stroke", (editing) => {
      const written = editing.written;
      const last = written?.strokes[written.strokes.length - 1];
      if (!last) return;
      last.spine.closed = true;
      last.nib = penAtNodes(last.spine, last.nib);
      this.reswept(editing);
    });
    this.set({ writing: null });
    this.say("Stroke closed.", "success");
    return true;
  }

  /**
   * Change the pen at one stop of one stroke.
   *
   * Where turning the pen actually happens. `width` is the axis the pen is held
   * along and belongs to the width profile, so setting it here sets the whole
   * stroke's width; `contrast` and `angle` belong to the stop and are what a
   * turning pen changes between stops.
   */
  setStrokePen(
    name: string,
    stroke: number,
    stop: number,
    pen: Partial<{ width: number; contrast: number; angle: number }>,
    live = false,
  ): void {
    const change = (editing: Glyph): void => {
      const one = editing.written?.strokes[stroke];
      if (!one) return;
      const held = one.nib[stop];
      if (!held) return;
      if (pen.contrast !== undefined) held.contrast = pen.contrast;
      if (pen.angle !== undefined) held.angle = pen.angle;
      if (pen.width !== undefined) one.width = [{ at: 0, width: pen.width }];
      this.reswept(editing);
    };
    if (live) this.editGlyphLive(name, change);
    else this.editGlyph(name, "Change the pen", change);
  }

  /** Move one point of a written stroke's spine. */
  moveStrokePoint(name: string, stroke: number, node: number, to: Vec2, live = false): void {
    const change = (editing: Glyph): void => {
      const one = editing.written?.strokes[stroke];
      if (!one) return;
      const segments = one.spine.segments;
      /*
       * A node is the meeting of two segments, so moving it moves the end of
       * one and the start of the next, and the handles that sat on the old
       * place go with it. Anything that moved only one side would open a gap in
       * the spine, which sweeps as two strokes rather than one.
       */
      const before = segments[node - 1];
      const after = segments[node];
      const from =
        before && before.kind !== "arc"
          ? before.to
          : after && after.kind !== "arc"
            ? after.from
            : undefined;
      if (!from) return;
      const shift = { x: to.x - from.x, y: to.y - from.y };
      const nudge = (point: Vec2 | undefined): void => {
        if (!point) return;
        point.x += shift.x;
        point.y += shift.y;
      };
      if (before && before.kind === "cubic") {
        nudge(before.c2);
        before.to = { ...to };
      }
      if (after && after.kind === "cubic") {
        nudge(after.c1);
        after.from = { ...to };
      }
      this.reswept(editing);
    };
    if (live) this.editGlyphLive(name, change);
    else this.editGlyph(name, "Move the stroke", change);
  }

  /**
   * Pull the curve out of the point a stroke was just written to.
   *
   * The spine is a chain of cubics, so the handle being pulled is the one
   * leaving the point just placed, and the one arriving at it is that mirrored
   * -- which is what makes the stroke run through the point smoothly rather
   * than turning a corner there. Live, and recorded once when the pointer comes
   * up, like every other drag.
   */
  pullStroke(name: string, stroke: number, node: number, to: Vec2): void {
    this.editGlyphLive(name, (editing) => {
      const one = editing.written?.strokes[stroke];
      const segments = one?.spine.segments;
      if (!one || !segments) return;
      const arrived = segments[node - 1];
      if (arrived?.kind !== "cubic") return;
      const point = arrived.to;
      arrived.c2 = { x: point.x - (to.x - point.x), y: point.y - (to.y - point.y) };
      const leaving = segments[node];
      if (leaving && leaving.kind === "cubic") leaving.c1 = { ...to };
      this.reswept(editing);
    });
  }

  /** Take a written stroke out of the letter. */
  deleteStroke(name: string, stroke: number): void {
    this.editGlyph(name, "Delete the stroke", (editing) => {
      const written = editing.written;
      if (!written) return;
      written.strokes.splice(stroke, 1);
      if (written.strokes.length === 0) editing.written = undefined;
      else this.reswept(editing);
      if (written.strokes.length === 0) editing.contours = [];
    });
  }

  /**
   * Write a stroke from a line drawn in one movement.
   *
   * The freehand tool's answer, and the same fitting the outline freehand uses:
   * a trail of pointer positions in, a handful of curves out. Writing is the
   * gesture this suits best of anything in the editor, because a written
   * letter *is* a movement -- the outline freehand is a person imitating a
   * curve and this is a person making one.
   */
  writeTrail(name: string, trail: Vec2[]): boolean {
    if (trail.length < 2) return false;
    const fitted = strokeToContour(trail, { closeWithin: 0 });
    if (!fitted || fitted.nodes.length < 2) return false;
    const { width, contrast, angle } = this.state.pen;
    const using = this.state.usingPen ?? undefined;
    const segments: QuillSegment[] = [];
    for (let index = 1; index < fitted.nodes.length; index++) {
      const from = fitted.nodes[index - 1];
      const to = fitted.nodes[index];
      segments.push({
        kind: "cubic",
        from: { ...from.point },
        c1: { ...(from.handleOut ?? from.point) },
        c2: { ...(to.handleIn ?? to.point) },
        to: { ...to.point },
      });
    }
    if (segments.length === 0) return false;
    this.editGlyph(name, "Write", (editing) => {
      const written = editing.written ?? { strokes: [] };
      const spine = { segments, closed: false };
      written.strokes.push({
        spine,
        width: [{ at: 0, width }],
        nib: penAtNodes(spine, [{ at: 0, contrast, angle, ...(using ? { pen: using } : {}) }]),
        start: { kind: "butt" },
        end: { kind: "butt" },
        join: "round",
      });
      editing.written = written;
      this.reswept(editing);
    });
    this.set({ writing: null });
    return true;
  }

  /**
   * Take a written letter's ink as its own, so the outline tools can reach it.
   *
   * The escape hatch, and the reason writing does not have to be able to draw
   * everything: write the letter, take the ink, and fix the one curve that is
   * wrong with the tools that are already here. The strokes stay, so it can be
   * put back for as long as nobody has edited the outlines.
   */
  expandWritten(name: string): boolean {
    const glyph = this.glyph(name);
    if (!glyph?.written || glyph.written.expanded) return false;
    this.editGlyph(name, "Take the ink", (editing) => {
      if (editing.written) editing.written.expanded = true;
    });
    this.say("The ink is the letter now. The strokes are kept, so this can be undone.", "success");
    return true;
  }

  /** Put an expanded letter back to its strokes. */
  unexpandWritten(name: string): boolean {
    const glyph = this.glyph(name);
    if (!glyph?.written?.expanded) return false;
    this.editGlyph(name, "Back to strokes", (editing) => {
      if (!editing.written) return;
      editing.written.expanded = false;
      this.reswept(editing);
    });
    this.say("Back to strokes.", "success");
    return true;
  }

  /**
   * Take the outgoing handle off the point the pen last placed.
   *
   * Clicking that point is how a curve is ended: the handle on the arriving
   * side stays and the leaving one goes, so the next click draws a straight
   * line out of a curve. Without it a curve could only ever be followed by
   * another curve.
   */
  retractLast(glyphName: string): boolean {
    const glyph = this.glyph(glyphName);
    const contour = glyph?.contours[glyph.contours.length - 1];
    if (!glyph || !contour || contour.closed || contour.nodes.length === 0) return false;
    const last = contour.nodes[contour.nodes.length - 1];
    if (!last.handleOut) return false;

    this.editGlyph(glyphName, "End the curve", (one) => {
      const editing = one.contours[one.contours.length - 1];
      const node = editing?.nodes[editing.nodes.length - 1];
      if (node) Object.assign(node, retracted(node));
    });
    return true;
  }
}

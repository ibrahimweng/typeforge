/**
 * The letters that drive the rest.
 *
 * Editing one of these carries the whole font with it, which is a large enough
 * consequence that it should never be a surprise. This shows which letters have
 * that power, lets you open one, and reports what the last edit actually pushed
 * out, in the units a type designer would use.
 */

import * as React from "react";

import { pulse } from "@/anim/motion";
import { CONTROL_GLYPHS, CONTROL_GROUPS } from "@/font/control";
import { drawGlyph, fitEmSquare, prepareCanvas, readToken } from "@/components/glyph-render";
import { store, useAppState } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

const GROUP_LABELS: Record<string, string> = {
  lowercase: "Lowercase",
  capitals: "Capitals",
  figures: "Figures",
};

/** What the letter is called on screen, rather than in the font. */
const DISPLAY: Record<string, string> = { zero: "0", one: "1", three: "3" };

function ControlThumb({ name }: { name: string }): React.JSX.Element {
  const state = useAppState();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const glyph = store.glyph(name);
  const typeface = state.typeface;
  const selected = state.selectedGlyph === name;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !typeface || !glyph) return;
    const context = prepareCanvas(canvas, 44, 44);
    if (!context) return;
    context.clearRect(0, 0, 44, 44);
    const view = fitEmSquare(typeface, 44, 44, 0.2);
    drawGlyph(context, glyph, typeface, view, {
      fill: readToken("--glyph-fill", "#eeeeee"),
      centreOnOutline: true,
    });
  }, [glyph, typeface, state.revision]);

  if (!glyph) {
    return (
      <div
        title={`${DISPLAY[name] ?? name} is not in this font`}
        className="flex size-11 items-center justify-center rounded-md border border-dashed border-border text-2xs text-muted-foreground opacity-50"
      >
        {DISPLAY[name] ?? name}
      </div>
    );
  }

  return (
    <button
      type="button"
      title={`Open ${DISPLAY[name] ?? name}. Editing it moves the whole font.`}
      onClick={() => {
        store.selectGlyph(name, { open: true });
        store.setView("glyph");
      }}
      className={cn(
        "flex size-11 items-center justify-center rounded-md border transition-colors",
        selected
          ? "border-[color:var(--accent)] bg-card"
          : "border-border hover:border-muted-foreground",
      )}
    >
      <canvas ref={canvasRef} style={{ width: 44, height: 44 }} />
    </button>
  );
}

export function ControlLetters(): React.JSX.Element | null {
  const state = useAppState();
  const noticeRef = React.useRef<HTMLDivElement>(null);
  const changes = state.lastDerivation;

  React.useEffect(() => {
    if (changes.length > 0 && noticeRef.current) pulse(noticeRef.current);
  }, [changes]);

  if (!state.typeface) return null;

  const present = CONTROL_GLYPHS.filter((name) => store.glyph(name) !== null).length;
  const followers = state.typeface.glyphs.length - present;

  return (
    <section className="border-b border-border p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-2xs font-medium">Control letters</h3>
        <span className="text-2xs text-muted-foreground">{present} of {CONTROL_GLYPHS.length}</span>
      </div>
      <p className="mb-2.5 text-2xs leading-relaxed text-muted-foreground">
        Draw these and the rest follows. Their stem, height and counter set the
        family; {followers.toLocaleString()} other glyphs match them.
      </p>

      {Object.entries(CONTROL_GROUPS).map(([group, names]) => (
        <div key={group} className="mb-2 last:mb-0">
          <div className="mb-1 text-2xs text-muted-foreground">{GROUP_LABELS[group] ?? group}</div>
          <div className="flex gap-1.5">
            {names.map((name) => (
              <ControlThumb key={name} name={name} />
            ))}
          </div>
        </div>
      ))}

      {changes.length > 0 && (
        <div
          ref={noticeRef}
          className="mt-2.5 rounded-md border border-border bg-card/60 p-2"
        >
          <div className="mb-1 text-2xs font-medium">Last change carried across</div>
          <ul className="space-y-0.5">
            {changes.map((change, index) => (
              <li
                key={`${change.glyph}-${change.quality}-${index}`}
                className="flex items-baseline justify-between gap-2 text-2xs text-muted-foreground tabular-nums"
              >
                <span>
                  {DISPLAY[change.glyph] ?? change.glyph} {change.quality}
                </span>
                <span>
                  {Math.round(change.from)} → {Math.round(change.to)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

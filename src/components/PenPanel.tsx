/**
 * The pen, as three numbers beside the letter being written.
 *
 * The canvas is where the pen is actually set -- take hold of the ellipse and
 * turn it -- and this is the other half of that, for the two things dragging is
 * bad at: saying exactly forty degrees, and knowing what the pen you are
 * holding currently is without hunting for its handles.
 *
 * Which pen it shows depends on what is picked. With a stop of a stroke chosen
 * it is that stop's pen, and editing it turns the pen at that one place, which
 * is what makes a stroke's pen able to change along its length. With nothing
 * chosen it is the hand's own pen, the one the next stroke will be written
 * with -- and that is the one somebody sets first, before there is anything to
 * pick.
 */

import * as React from "react";

import { NumberField } from "./NumberField";
import { store, useAppState } from "@/state/useStore";
import { isOnePen, nibAt } from "@/quill/sweep";

/** One number of the pen, with its name and its unit. */
function Field({
  label,
  hint,
  value,
  least,
  most,
  suffix,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  least: number;
  most: number;
  suffix?: string;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5" title={hint}>
      <span className="w-16 shrink-0 text-2xs text-muted-foreground">{label}</span>
      <NumberField
        value={value}
        label={label}
        className="w-16"
        onCommit={(next) => onChange(Math.min(most, Math.max(least, next)))}
      />
      {suffix ? <span className="text-2xs text-muted-foreground">{suffix}</span> : null}
    </span>
  );
}

export function PenPanel({ glyphName }: { glyphName: string }): React.JSX.Element {
  const state = useAppState();
  const strokes = store.strokesOf(glyphName);
  const chosen = state.stop;
  const stroke = chosen ? strokes[chosen.stroke] : undefined;
  const stop = chosen && stroke ? stroke.nib[chosen.stop] : undefined;

  /*
   * The pen being shown, and it is one of two different things.
   *
   * A chosen stop is a pen that exists in the letter. With nothing chosen there
   * is no pen in the letter to show, so this is the hand's -- and saying which
   * of the two is on screen matters, because editing them does different
   * things: one turns the pen at one place in one stroke, the other sets what
   * the next stroke will be written with.
   */
  const showing =
    stroke && stop
      ? {
          width: stroke.width[0]?.width ?? 0,
          contrast: stop.contrast,
          angle: stop.angle,
        }
      : state.pen;

  const change = (pen: Partial<{ width: number; contrast: number; angle: number }>): void => {
    if (chosen && stroke && stop) store.setStrokePen(glyphName, chosen.stroke, chosen.stop, pen);
    else store.setPen(pen);
  };

  /*
   * Whether the pen actually turns, which is not the same as having more than
   * one stop.
   *
   * A freshly written stroke gets a stop at every point that was put down, so
   * that the pen has a handle everywhere somebody might want to turn it. All of
   * those stops hold the same pen until one is changed -- so counting them said
   * "the pen turns from 30 degrees to 30 degrees", which is worse than saying
   * nothing.
   */
  const turning = stroke ? !isOnePen(stroke.nib) : false;

  return (
    <div className="flex flex-col gap-2" data-pen-panel>
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-medium text-foreground">Pen</h3>
        <span className="text-2xs text-muted-foreground" data-pen-scope>
          {chosen && stroke
            ? `stroke ${chosen.stroke + 1}, point ${chosen.stop + 1}`
            : "for the next stroke"}
        </span>
      </div>

      <Field
        label="Width"
        hint="How wide the pen is across the edge it is held on. The whole stroke's width, because a pen does not change size between one point and the next without being told to."
        value={Math.round(showing.width)}
        least={1}
        most={600}
        onChange={(width) => change({ width })}
      />
      <Field
        label="Blade"
        hint="How much of a blade the pen is. Nought is round, so the stroke is the same weight whichever way it goes. One is an edge with no thickness at all, which is what gives blackletter its hairlines."
        value={Number(showing.contrast.toFixed(2))}
        least={0}
        most={1}
        onChange={(contrast) => change({ contrast })}
      />
      <Field
        label="Angle"
        hint="Which way the pen is held, in degrees. Only does anything once the pen is a blade rather than round."
        value={Math.round(showing.angle)}
        least={-180}
        most={360}
        suffix="°"
        onChange={(angle) => change({ angle })}
      />

      {/*
        What the pen is doing along the stroke, said in one line.

        A turning pen is the one thing here somebody cannot see from three
        numbers, because three numbers describe one place and turning is a
        difference between two. So the line says whether it turns and by how
        much, and a stroke that does not turn says so too -- otherwise its
        absence reads as a feature that is missing rather than one not in use.
      */}
      {/*
        The grid a written alphabet is actually built on.

        An x-height in pen widths rather than in units, because that is how the
        proportion is held: four and a half for a Textura, five for a
        Roundhand, three for a display hand. Somebody who knows the craft had
        to convert it by hand before this, and somebody who does not had no way
        to find out that the proportion is the thing that matters.
      */}
      <div className="flex items-center gap-1.5 pt-1" data-written-grid>
        <span className="w-16 shrink-0 text-2xs text-muted-foreground">Grid</span>
        {[3, 4.5, 5].map((nibs) => (
          <button
            key={nibs}
            type="button"
            onClick={() => store.writtenGrid(nibs)}
            title={`Guides for an x-height of ${nibs} pen widths, with two more each way for the ascender and descender.`}
            className="rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            {nibs}×
          </button>
        ))}
        <span className="text-2xs text-muted-foreground">pen widths</span>
      </div>

      {stroke ? (
        <p className="text-2xs text-muted-foreground" data-pen-along>
          {turning
            ? `The pen turns from ${Math.round(nibAt(stroke.nib, 0).angle)}° to ${Math.round(
                nibAt(stroke.nib, 1).angle,
              )}° along this stroke.`
            : "The pen is held the same way along the whole stroke. Turn it at one point to change that."}
        </p>
      ) : (
        <p className="text-2xs text-muted-foreground" data-pen-along>
          Draw a stroke down the middle of the letter and the pen fills it in.
        </p>
      )}
    </div>
  );
}

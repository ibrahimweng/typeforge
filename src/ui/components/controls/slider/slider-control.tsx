"use client";

import * as React from "react";

import {
  EditableSliderValueLabel,
  Field,
  getNumericValueLabelWidthReference,
  Slider,
} from "../../primitives";
import { ControlFieldLabel } from "../../control-layout";
import { cn } from "../../../lib/utils";
import {
  clampSliderValue,
  applySliderValueLabelUnit,
  formatSliderValueWithUnit,
  getSliderControlValue,
  parseSliderValueLabel,
} from "./slider-value";
import {
  createControlHistoryGroupId,
  type ControlChangeMeta,
  type ControlValueChangeHandler,
} from "../control-types";

export type SliderControlProps = {
  baseValue?: number;
  className?: string;
  disabled?: boolean;
  markerCount?: number;
  max?: number;
  min?: number;
  name: string;
  onValueChange?: ControlValueChangeHandler<number>;
  showFill?: boolean;
  step?: number;
  unit?: string;
  value: number;
  valueLabel?: string;
  variant?: "continuous" | "discrete";
};

export function SliderControl({
  baseValue,
  className,
  disabled = false,
  markerCount,
  max = 100,
  min = 0,
  name,
  onValueChange,
  showFill,
  step = 1,
  unit,
  value,
  valueLabel,
  variant = "continuous",
}: SliderControlProps): React.JSX.Element {
  const [currentValue, setCurrentValue] = React.useState(value);
  const liveHistoryGroupRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  const displayValueLabel =
    valueLabel && currentValue === value
      ? applySliderValueLabelUnit(valueLabel, unit)
      : formatSliderValueWithUnit(currentValue, step, unit);

  function getLiveHistoryMeta(): ControlChangeMeta {
    liveHistoryGroupRef.current ??= createControlHistoryGroupId(`slider:${name}`);

    return {
      history: "merge",
      historyGroup: liveHistoryGroupRef.current,
    };
  }

  function finishLiveHistoryGroup(): void {
    liveHistoryGroupRef.current = null;
  }

  function commitValue(nextValue: number, meta?: ControlChangeMeta): void {
    const clampedValue = clampSliderValue(nextValue, min, max);

    setCurrentValue(clampedValue);
    onValueChange?.(clampedValue, meta);
  }

  function stepEditableValue(direction: -1 | 1, currentDraft: string): string | undefined {
    const parsedDraftValue = parseSliderValueLabel(currentDraft);
    const baseValue = typeof parsedDraftValue === "number" ? parsedDraftValue : currentValue;
    const nextValue = clampSliderValue(baseValue + direction * step, min, max);

    commitValue(nextValue, getLiveHistoryMeta());

    return formatSliderValueWithUnit(nextValue, step, unit);
  }

  return (
    <Field className={cn("min-w-0 gap-1!", className)} data-disabled={disabled}>
      <div className="flex w-full min-w-0 items-center justify-between gap-3">
        <ControlFieldLabel>{name}</ControlFieldLabel>
        <div className="inline-flex h-5 shrink-0 items-center gap-1.5">
          <EditableSliderValueLabel
            ariaLabel={`${name} value`}
            disabled={disabled}
            maxValueLabel={getNumericValueLabelWidthReference(displayValueLabel, { max, min })}
            onCommit={(nextValueLabel) => {
              const parsedValue = parseSliderValueLabel(nextValueLabel);

              if (typeof parsedValue === "number") {
                commitValue(parsedValue);
              }

              finishLiveHistoryGroup();
            }}
            onStep={stepEditableValue}
            valueLabel={displayValueLabel}
          />
        </div>
      </div>
      <Slider
        getAriaLabel={() => name}
        markerCount={markerCount}
        max={max}
        min={min}
        disabled={disabled}
        onValueChange={(nextValue) => {
          const resolvedValue = getSliderControlValue(nextValue);

          if (typeof resolvedValue === "number") {
            commitValue(resolvedValue, getLiveHistoryMeta());
          }
        }}
        /*
         * Say that the drag has ended, not just that the history group has.
         *
         * The value changes during a drag carry `history: "merge"`, which is
         * how a listener knows one movement is still in progress. Nothing said
         * that it had stopped: this fired on pointer-up and cleared the group
         * silently, so the last thing a listener ever heard was another
         * "still going".
         *
         * Downstream that left every drag permanently open, and anything
         * waiting for a hand to come off a control had to guess -- by a timer,
         * which fires in any pause long enough, so a slow frame read as a
         * finished gesture. Sending the committed value with no merge on it
         * makes the end of a drag a fact rather than an inference.
         */
        onValueCommitted={(nextValue, details) => {
          /*
           * A key is not a hand coming off the control.
           *
           * The slider commits on every arrow press as well as on pointer-up,
           * and treating those alike would end the run after each press --
           * sixty presses, sixty entries in the history, and sixty undos to
           * take back one adjustment. So a keyboard commit says nothing and the
           * run stays open, which is what it was before this and what the
           * trailing catch-up downstream is there to close. The group is closed
           * exactly as it always was, so nothing else about a keyboard run
           * changes.
           */
          if (details.reason === "keyboard") {
            finishLiveHistoryGroup();
            return;
          }
          const resolvedValue = getSliderControlValue(nextValue);

          if (typeof resolvedValue === "number") {
            commitValue(resolvedValue);
          }
          finishLiveHistoryGroup();
        }}
        resetValue={typeof baseValue === "number" ? [baseValue] : undefined}
        showFill={showFill}
        step={step}
        value={[currentValue]}
        variant={variant}
      />
    </Field>
  );
}

/**
 * The small square button the tool palettes are made of.
 *
 * Here rather than in either palette because two copies of a button drift:
 * one gets a hover state the other does not, and a row of tools where half
 * behave differently reads as broken long before anybody can say why.
 */

import * as React from "react";

import { cn } from "@/ui/lib/utils";

export function ToolButton({
  onClick,
  title,
  disabled,
  children,
  wide,
  named,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
  wide?: boolean;
  /*
   * A fuller name than the label, for when the label alone is ambiguous.
   *
   * `Smooths` in the picking row and `Smooth` in the row below it are two
   * different operations whose labels differ by one letter, and to anything
   * reading names rather than looking at rows -- a screen reader, a test --
   * they are indistinguishable. The visible label stays short because the row
   * it sits in says what it is for.
   */
  named?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={named}
      className={cn(
        "rounded border border-border px-1.5 py-1 text-2xs text-muted-foreground transition-colors",
        "hover:border-accent hover:text-foreground disabled:opacity-40 disabled:hover:border-border",
        wide && "flex-1",
      )}
    >
      {children}
    </button>
  );
}

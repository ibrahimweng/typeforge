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
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
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

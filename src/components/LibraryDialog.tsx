/**
 * The font library.
 *
 * Every font in the Google Fonts catalogue, and four things to do with one.
 * The four are not variations on each other -- they are the four honest
 * relationships you can have with somebody else's typeface, and they differ
 * in exactly how much of it you end up carrying.
 *
 * Opening it takes everything, which is fine, because these are fonts licensed
 * to be taken and remade. Referencing it takes nothing at all: the letters sit
 * behind yours as a guide and are gone when you put them down. Borrowing takes
 * the spacing, which is a set of numbers about white rather than anything
 * drawn. Starting from it takes the proportions -- how tall against how wide,
 * how heavy, how much contrast -- and draws entirely new letters from them.
 *
 * That last one is worth being exact about, since it is the one that sounds
 * like copying and is not. Proportions are not protected and never have been;
 * they are the reason there are five hundred grotesques and they all look like
 * each other. Outlines are. So the numbers travel, the shapes do not, and the
 * dialog says which is happening rather than leaving it to be assumed.
 */

import * as React from "react";

import { enter } from "@/anim/motion";
import { contoursToSvgPath } from "@/font/geometry";
import { OUTLINE_ACTION, segment } from "@/components/controls";
import { glyphFor } from "@/library/measure";
import { seedFrom } from "@/library/seed";
import type { LibraryCategory, LibraryFont } from "@/library/catalogue";
import { libraryStore, useLibrary, type LoadedFont } from "@/state/useLibrary";
import { forgeStore } from "@/state/useForge";
import { assembleStore } from "@/state/useAssemble";
import { store } from "@/state/useStore";
import { cn } from "@/ui/lib/utils";

const CATEGORIES: Array<[LibraryCategory | "all", string]> = [
  ["all", "All"],
  ["sans-serif", "Sans"],
  ["serif", "Serif"],
  ["display", "Display"],
  ["handwriting", "Hand"],
  ["monospace", "Mono"],
];

export function LibraryDialog({
  mode,
  onMode,
}: {
  mode: "edit" | "forge" | "assemble";
  onMode: (mode: "edit" | "forge" | "assemble") => void;
}): React.JSX.Element | null {
  const state = useLibrary();
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (state.open && panelRef.current) enter(panelRef.current, { distance: 10 });
  }, [state.open]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") libraryStore.hide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!state.open) return null;
  const fonts = libraryStore.visible();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={() => libraryStore.hide()}
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className="floating-popup-surface flex h-[34rem] w-[48rem] flex-col rounded-xl border border-border bg-popover shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Font library"
        data-library
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border p-3">
          <h2 className="text-sm font-medium">Font library</h2>
          <input
            value={state.query}
            onChange={(event) => libraryStore.setQuery(event.target.value)}
            placeholder="Search families"
            aria-label="Search families"
            data-library-search
            className="ml-2 h-7 w-48 rounded-md border border-input bg-card px-2 text-2xs outline-none focus-visible:border-accent"
          />
          <div className="flex gap-0.5" role="group" aria-label="Kind">
            {CATEGORIES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={state.category === id}
                onClick={() => libraryStore.setCategory(id)}
                data-library-category={id}
                className={segment(state.category === id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => libraryStore.hide()}
            aria-label="Close the library"
            className="ml-auto rounded px-2 py-1 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <Families fonts={fonts} />
          <Chosen mode={mode} onMode={onMode} />
        </div>

        <Footer />
      </div>
    </div>
  );
}

/** The list of families, however many the source gave. */
function Families({ fonts }: { fonts: LibraryFont[] }): React.JSX.Element {
  const state = useLibrary();

  if (!state.catalogue) {
    return (
      <div className="flex w-64 shrink-0 items-center justify-center border-r border-border text-2xs text-muted-foreground">
        {state.busy ? "Fetching the catalogue…" : "No catalogue."}
      </div>
    );
  }

  return (
    <div
      className="toolcraft-scrollbar w-64 shrink-0 overflow-y-auto border-r border-border"
      data-library-list
    >
      {fonts.length === 0 && (
        <p className="p-3 text-2xs text-muted-foreground">Nothing matches that.</p>
      )}
      {fonts.slice(0, 400).map((font) => (
        <button
          key={font.id}
          type="button"
          onClick={() => void libraryStore.load(font)}
          aria-pressed={state.loaded?.font.id === font.id}
          data-library-font={font.id}
          className={cn(
            "block w-full px-3 py-1.5 text-left text-2xs transition-colors",
            state.loaded?.font.id === font.id
              ? "bg-[color:color-mix(in_oklab,var(--accent)_14%,transparent)] text-foreground"
              : "text-muted-foreground hover:bg-card hover:text-foreground",
          )}
        >
          {font.family}
        </button>
      ))}
      {fonts.length > 400 && (
        <p className="p-3 text-2xs text-muted-foreground">
          {fonts.length - 400} more. Search to narrow it.
        </p>
      )}
    </div>
  );
}

/** The font being looked at, what it is made of, and what can be done with it. */
function Chosen({
  mode,
  onMode,
}: {
  mode: "edit" | "forge" | "assemble";
  onMode: (mode: "edit" | "forge" | "assemble") => void;
}): React.JSX.Element {
  const state = useLibrary();
  const loaded = state.loaded;

  if (!loaded) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center p-6 text-center text-2xs leading-relaxed text-muted-foreground">
        {state.busy ? "Fetching…" : "Choose a family to see what it is made of."}
      </div>
    );
  }

  return (
    <div className="toolcraft-scrollbar min-w-0 flex-1 overflow-y-auto p-4" data-library-chosen>
      <h3 className="text-xs-plus font-medium">{loaded.font.family}</h3>
      <Sample loaded={loaded} />
      <What loaded={loaded} />
      <Actions loaded={loaded} mode={mode} onMode={onMode} />
    </div>
  );
}

/** A line of the font's own letters, drawn from its outlines. */
function Sample({ loaded }: { loaded: LoadedFont }): React.JSX.Element {
  const { typeface } = loaded;
  const em = typeface.unitsPerEm;
  const glyphs = React.useMemo(() => {
    let pen = 0;
    const placed: Array<{ d: string; at: number; key: string }> = [];
    for (const [index, character] of [..."Hamburgefonstiv"].entries()) {
      const glyph = glyphFor(typeface, character);
      if (!glyph) continue;
      placed.push({ d: contoursToSvgPath(glyph.contours), at: pen, key: `${character}${index}` });
      pen += glyph.advanceWidth;
    }
    return { placed, width: Math.max(pen, 1) };
  }, [typeface]);

  return (
    <svg
      viewBox={`0 ${-typeface.metrics.ascender} ${glyphs.width} ${
        typeface.metrics.ascender - typeface.metrics.descender
      }`}
      className="mt-2 h-14 w-full"
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={`${loaded.font.family} sample`}
      data-library-sample
    >
      <g transform="scale(1,-1)">
        {glyphs.placed.map((glyph) => (
          <g key={glyph.key} transform={`translate(${glyph.at} 0)`}>
            <path d={glyph.d} fill="var(--foreground)" fillRule="nonzero" />
          </g>
        ))}
      </g>
      <title>{`${loaded.font.family}, ${em} units to the em`}</title>
    </svg>
  );
}

/** What the measurement found, in the words a designer would use. */
function What({ loaded }: { loaded: LoadedFont }): React.JSX.Element {
  const { measured } = loaded;
  const em = measured.unitsPerEm;
  const share = (value: number | null) =>
    value === null ? "—" : `${Math.round((value / em) * 1000)}`;

  const rows: Array<[string, string]> = [
    ["x-height", `${share(measured.xHeight)} / 1000`],
    ["Cap height", `${share(measured.capHeight)} / 1000`],
    ["Stem", measured.stem === null ? "—" : `${share(measured.stem)} / 1000`],
    ["Contrast", measured.contrast === null ? "—" : measured.contrast.toFixed(2)],
    ["Serifs", measured.serif === null ? "—" : measured.serif ? "yes" : "no"],
    ["Lean", measured.slant === 0 ? "upright" : `${measured.slant}°`],
    ["Spacing", measured.sidebearing === null ? "—" : `${share(measured.sidebearing)} / 1000`],
  ];
  if (measured.monospaced) rows.push(["Width", "every letter the same"]);
  if (measured.joining) rows.push(["Joins up", "yes, the letters touch"]);

  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5" data-library-measured>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <dt className="text-2xs text-muted-foreground">{label}</dt>
          <dd className="text-2xs text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The four things worth doing with somebody else's font. */
function Actions({
  loaded,
  mode,
  onMode,
}: {
  loaded: LoadedFont;
  mode: "edit" | "forge" | "assemble";
  onMode: (mode: "edit" | "forge" | "assemble") => void;
}): React.JSX.Element {
  const state = useLibrary();
  const [said, setSaid] = React.useState<string | null>(null);
  const referencing = state.reference?.font.id === loaded.font.id;

  const openIt = (): void => {
    store.adopt(loaded.typeface, `${loaded.font.family}.ttf`);
    onMode("edit");
    libraryStore.hide();
  };

  const seedIt = (): void => {
    const seeded = seedFrom(loaded.measured, `My ${loaded.font.family}`);
    forgeStore.startFromStyle(seeded.style, seeded.base);
    onMode("forge");
    libraryStore.hide();
  };

  const borrowIt = (): void => {
    const taken = assembleStore.borrowFrom(loaded.typeface);
    setSaid(
      taken.letters === 0
        ? "None of your letters are in that font, so there was nothing to take."
        : `Took the spacing for ${taken.letters} letter${taken.letters === 1 ? "" : "s"}` +
            (taken.pairs > 0
              ? ` and ${taken.pairs} kerning pair${taken.pairs === 1 ? "" : "s"}.`
              : "."),
    );
  };

  return (
    <div className="mt-4 space-y-2" data-library-actions>
      <Action
        label="Open it"
        note="Everything: the outlines, the spacing, the kerning. These are fonts licensed to be taken and remade."
        onClick={openIt}
        mark="open"
      />
      <Action
        label="Start a drawing from it"
        note={`Its proportions, drawn again from nothing: ${
          seedFrom(loaded.measured).base
        } as the starting point. Not one of its curves comes across.`}
        onClick={seedIt}
        mark="seed"
      />
      <Action
        label={referencing ? "Stop showing it behind" : "Show it behind your letters"}
        note="A guide to draw against, in Draw and Assemble. Nothing is taken; it is gone when you put it down."
        onClick={() => libraryStore.setReference(referencing ? null : loaded)}
        pressed={referencing}
        mark="reference"
      />
      <Action
        label="Borrow its spacing and kerning"
        note={
          mode === "assemble"
            ? "The white it leaves beside each letter, and the pairs it pulls together, laid over your drawings."
            : "For a font you are assembling from drawings. Switch to Assemble and drop some in first."
        }
        onClick={borrowIt}
        disabled={mode !== "assemble"}
        mark="borrow"
      />
      {said && <p className="pt-1 text-2xs leading-snug text-muted-foreground">{said}</p>}
    </div>
  );
}

function Action({
  label,
  note,
  onClick,
  disabled,
  pressed,
  mark,
}: {
  label: string;
  note: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  mark: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      data-library-action={mark}
      className={cn(
        "block w-full rounded-md border p-2.5 text-left transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        pressed
          ? "border-[color:var(--accent)] bg-[color:color-mix(in_oklab,var(--accent)_10%,transparent)]"
          : "border-border hover:border-muted-foreground hover:bg-card",
      )}
    >
      <span className="block text-2xs font-medium text-foreground">{label}</span>
      <span className="block pt-0.5 text-2xs leading-snug text-muted-foreground">{note}</span>
    </button>
  );
}

/** Where the list came from, and what to do when it could not be reached. */
function Footer(): React.JSX.Element {
  const state = useLibrary();
  const [showing, setShowing] = React.useState(false);

  const where =
    state.catalogue?.from === "fontsource"
      ? `${state.catalogue.fonts.length.toLocaleString()} families, from Fontsource`
      : state.catalogue?.from === "google"
        ? `${state.catalogue.fonts.length.toLocaleString()} families, from Google Fonts`
        : `${state.catalogue?.fonts.length ?? 0} families, built in`;

  return (
    <footer className="shrink-0 border-t border-border p-2.5" data-library-footer>
      <div className="flex items-center gap-2">
        <span className="text-2xs text-muted-foreground">{where}</span>
        {state.catalogue?.from === "builtin" && (
          <button
            type="button"
            onClick={() => setShowing((was) => !was)}
            data-library-key-toggle
            className="rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Use a Google Fonts key
          </button>
        )}
        <button
          type="button"
          onClick={() => void libraryStore.refresh()}
          disabled={state.busy}
          className="ml-auto rounded px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          {state.busy ? "Fetching…" : "Try again"}
        </button>
      </div>

      {state.problem && (
        <p className="pt-1 text-2xs leading-snug text-muted-foreground">{state.problem}</p>
      )}

      {showing && (
        <div className="flex items-center gap-2 pt-2">
          <input
            value={state.googleKey}
            onChange={(event) => libraryStore.setGoogleKey(event.target.value)}
            placeholder="Google Fonts API key"
            aria-label="Google Fonts API key"
            data-library-key
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-2xs outline-none focus-visible:border-accent"
          />
          <button
            type="button"
            onClick={() => void libraryStore.refresh()}
            className={OUTLINE_ACTION}
          >
            Use it
          </button>
        </div>
      )}
    </footer>
  );
}

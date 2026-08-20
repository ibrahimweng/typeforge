/**
 * The list of fonts you can reach from here.
 *
 * Two sources, and the choice between them is about what they ask of the
 * person using the tool rather than about which has more fonts in it.
 * Fontsource publishes the whole Google Fonts catalogue as plain JSON with no
 * key, no sign-up and no origin restriction, so it is the one that works the
 * moment the page loads. Google's own developer API has the same catalogue and
 * demands an API key for it, which is a reasonable thing for Google to want
 * and an unreasonable thing to make somebody do before they can look at a list
 * of fonts -- so it is there for anyone who has a key and never asked for.
 *
 * Neither is required. A short built-in list keeps the feature usable when
 * both are unreachable, which on a locked-down network is not a hypothetical,
 * and it is marked as short so nobody concludes the catalogue is thirty fonts.
 */

/** What the font world calls the kinds of face, which is not what this app does. */
export type LibraryCategory =
  | "sans-serif"
  | "serif"
  | "display"
  | "handwriting"
  | "monospace";

export interface LibraryFont {
  /** Lower-case hyphenated, as Fontsource names them: `playfair-display`. */
  id: string;
  family: string;
  category: LibraryCategory;
  /** Weights the family publishes, lightest first. */
  weights: number[];
  /** `normal`, `italic`, or both. */
  styles: string[];
  variable: boolean;
}

export type CatalogueSource = "fontsource" | "google" | "builtin";

export interface Catalogue {
  fonts: LibraryFont[];
  from: CatalogueSource;
  /** Said out loud when the full list could not be reached. */
  problem: string | null;
}

const FONTSOURCE = "https://api.fontsource.org/v1/fonts";
const GOOGLE = "https://www.googleapis.com/webfonts/v1/webfonts";

const CATEGORIES = new Set<LibraryCategory>([
  "sans-serif",
  "serif",
  "display",
  "handwriting",
  "monospace",
]);

/**
 * Fetch the catalogue.
 *
 * Tries the keyless source, then the keyed one if a key was given, then gives
 * back the built-in list rather than nothing. Every failure is caught: a font
 * picker that throws because a third-party service is down is worse than one
 * that offers thirty families and says so.
 */
export async function fetchCatalogue(options: {
  googleKey?: string;
  signal?: AbortSignal;
} = {}): Promise<Catalogue> {
  const problems: string[] = [];

  try {
    const fonts = await fromFontsource(options.signal);
    if (fonts.length > 0) return { fonts, from: "fontsource", problem: null };
    problems.push("Fontsource returned nothing.");
  } catch (error) {
    problems.push(`Fontsource: ${reason(error)}`);
  }

  if (options.googleKey) {
    try {
      const fonts = await fromGoogle(options.googleKey, options.signal);
      if (fonts.length > 0) return { fonts, from: "google", problem: null };
      problems.push("Google returned nothing.");
    } catch (error) {
      problems.push(`Google Fonts: ${reason(error)}`);
    }
  }

  return {
    fonts: BUILT_IN,
    from: "builtin",
    problem: `${problems.join(" ")} Showing a short built-in list instead.`,
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "could not be reached";
}

async function fromFontsource(signal?: AbortSignal): Promise<LibraryFont[]> {
  const response = await fetch(FONTSOURCE, { signal });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("answered with something that is not a list");
  return body.map(readFontsource).filter((font): font is LibraryFont => font !== null);
}

/**
 * One entry, read defensively.
 *
 * Everything is checked rather than trusted, and an entry that does not make
 * sense is dropped rather than allowed through as a font with no weights that
 * fails later when somebody clicks it.
 */
function readFontsource(raw: unknown): LibraryFont | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const id = typeof entry.id === "string" ? entry.id : null;
  const family = typeof entry.family === "string" ? entry.family : null;
  if (!id || !family) return null;

  const weights = Array.isArray(entry.weights)
    ? entry.weights.filter((weight): weight is number => typeof weight === "number").sort((a, b) => a - b)
    : [];
  const styles = Array.isArray(entry.styles)
    ? entry.styles.filter((style): style is string => typeof style === "string")
    : [];

  return {
    id,
    family,
    category: categoryOf(entry.category),
    weights: weights.length > 0 ? weights : [400],
    styles: styles.length > 0 ? styles : ["normal"],
    variable: entry.variable !== undefined && entry.variable !== false,
  };
}

async function fromGoogle(key: string, signal?: AbortSignal): Promise<LibraryFont[]> {
  const response = await fetch(`${GOOGLE}?key=${encodeURIComponent(key)}&sort=popularity`, {
    signal,
  });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  const body = (await response.json()) as { items?: unknown };
  if (!Array.isArray(body.items)) throw new Error("answered with no list of fonts");

  return body.items
    .map((raw): LibraryFont | null => {
      if (typeof raw !== "object" || raw === null) return null;
      const entry = raw as Record<string, unknown>;
      const family = typeof entry.family === "string" ? entry.family : null;
      if (!family) return null;
      // Google publishes variants as "400", "700italic", "regular", "italic".
      const variants = Array.isArray(entry.variants)
        ? entry.variants.filter((v): v is string => typeof v === "string")
        : [];
      const weights = [
        ...new Set(
          variants.map((variant) => {
            const digits = /^(\d+)/.exec(variant);
            return digits ? Number(digits[1]) : 400;
          }),
        ),
      ].sort((a, b) => a - b);
      const styles = variants.some((variant) => variant.includes("italic"))
        ? ["normal", "italic"]
        : ["normal"];
      return {
        id: idFor(family),
        family,
        category: categoryOf(entry.category),
        weights: weights.length > 0 ? weights : [400],
        styles,
        variable: false,
      };
    })
    .filter((font): font is LibraryFont => font !== null);
}

function categoryOf(raw: unknown): LibraryCategory {
  if (typeof raw === "string" && CATEGORIES.has(raw as LibraryCategory)) {
    return raw as LibraryCategory;
  }
  return "sans-serif";
}

/** The id Fontsource gives a family, which is also what its CDN paths use. */
export function idFor(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/**
 * Narrow the list.
 *
 * Families whose name starts with what was typed come first, then the ones
 * that merely contain it. Typing "roboto" should not put Roboto Condensed
 * Italic above Roboto, and sorting alphabetically inside a plain substring
 * match does exactly that.
 */
export function search(
  fonts: LibraryFont[],
  query: string,
  category: LibraryCategory | "all" = "all",
): LibraryFont[] {
  const wanted = query.trim().toLowerCase();
  const matching = fonts.filter(
    (font) => category === "all" || font.category === category,
  );
  if (!wanted) return matching;

  const starts: LibraryFont[] = [];
  const contains: LibraryFont[] = [];
  for (const font of matching) {
    const name = font.family.toLowerCase();
    if (name.startsWith(wanted)) starts.push(font);
    else if (name.includes(wanted)) contains.push(font);
  }
  return [...starts, ...contains];
}

// ---------------------------------------------------------------------------
// The list of last resort
// ---------------------------------------------------------------------------

/**
 * Enough families to be useful when nothing can be reached.
 *
 * Chosen to span the four kinds rather than by popularity: whatever somebody
 * came here to do, there should be something in this list close enough to it
 * to be worth borrowing from.
 */
const BUILT_IN: LibraryFont[] = (
  [
    ["Inter", "sans-serif"],
    ["Roboto", "sans-serif"],
    ["Open Sans", "sans-serif"],
    ["Lato", "sans-serif"],
    ["Montserrat", "sans-serif"],
    ["Work Sans", "sans-serif"],
    ["Josefin Sans", "sans-serif"],
    ["Oswald", "sans-serif"],
    ["Archivo", "sans-serif"],
    ["Manrope", "sans-serif"],
    ["Source Sans 3", "sans-serif"],
    ["Nunito", "sans-serif"],
    ["Merriweather", "serif"],
    ["Lora", "serif"],
    ["Playfair Display", "serif"],
    ["EB Garamond", "serif"],
    ["Libre Baskerville", "serif"],
    ["Bodoni Moda", "serif"],
    ["Source Serif 4", "serif"],
    ["Crimson Pro", "serif"],
    ["Roboto Slab", "serif"],
    ["Zilla Slab", "serif"],
    ["Spectral", "serif"],
    ["Cormorant", "serif"],
    ["Abril Fatface", "display"],
    ["Bungee", "display"],
    ["Righteous", "display"],
    ["Bebas Neue", "display"],
    ["Alfa Slab One", "display"],
    ["Lobster", "display"],
    ["Fredoka", "display"],
    ["Rubik Mono One", "display"],
    ["Dancing Script", "handwriting"],
    ["Pacifico", "handwriting"],
    ["Caveat", "handwriting"],
    ["Kalam", "handwriting"],
    ["Shadows Into Light", "handwriting"],
    ["Satisfy", "handwriting"],
    ["Roboto Mono", "monospace"],
    ["Space Mono", "monospace"],
    ["IBM Plex Mono", "monospace"],
    ["JetBrains Mono", "monospace"],
    ["Fira Code", "monospace"],
    ["Inconsolata", "monospace"],
  ] as Array<[string, LibraryCategory]>
).map(([family, category]) => ({
  id: idFor(family),
  family,
  category,
  weights: [400, 700],
  styles: ["normal"],
  variable: false,
}));

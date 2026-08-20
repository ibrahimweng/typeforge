/**
 * The font library's state.
 *
 * One catalogue, fetched once and kept; one font loaded at a time, because
 * loading one means parsing a few hundred kilobytes into a few thousand glyphs
 * and there is never a reason to hold two.
 *
 * The loaded font is deliberately not a document. Nothing here is being
 * edited: it is a thing to look at, take measurements off, and put down again.
 * Opening one into the editor hands it to that store and this one forgets it.
 */

import {
  fetchCatalogue,
  search,
  type Catalogue,
  type LibraryCategory,
  type LibraryFont,
} from "@/library/catalogue";
import { download } from "@/library/download";
import { importFont } from "@/font/parse";
import { measure, type Measured } from "@/library/measure";
import type { Typeface } from "@/font/types";

/** A font that has been fetched and read. */
export interface LoadedFont {
  font: LibraryFont;
  weight: number;
  italic: boolean;
  typeface: Typeface;
  measured: Measured;
  /** Which of the two services answered. */
  from: string;
}

export interface LibraryState {
  open: boolean;
  catalogue: Catalogue | null;
  /** True while the catalogue or a font is being fetched. */
  busy: boolean;
  query: string;
  category: LibraryCategory | "all";
  /** The font being looked at, once it has been fetched and read. */
  loaded: LoadedFont | null;
  /** Kept on screen behind the letters, until it is put down. */
  reference: LoadedFont | null;
  problem: string | null;
  /** A Google Fonts API key, if the person using this has one. */
  googleKey: string;
  revision: number;
}

const KEY_STORAGE = "typeforge.library.googleKey";

class LibraryStore {
  private state: LibraryState = {
    open: false,
    catalogue: null,
    busy: false,
    query: "",
    category: "all",
    loaded: null,
    reference: null,
    problem: null,
    googleKey: readKey(),
    revision: 0,
  };

  private listeners = new Set<() => void>();
  /** Cancels a fetch that is no longer wanted, so a fast typist is not queued. */
  private inFlight: AbortController | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LibraryState => this.state;

  private set(patch: Partial<LibraryState>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const listener of this.listeners) listener();
  }

  async show(): Promise<void> {
    this.set({ open: true });
    if (!this.state.catalogue) await this.refresh();
  }

  hide(): void {
    this.set({ open: false });
  }

  /** Fetch the catalogue, or fetch it again after a key was given. */
  async refresh(): Promise<void> {
    this.set({ busy: true, problem: null });
    const catalogue = await fetchCatalogue({ googleKey: this.state.googleKey || undefined });
    this.set({ catalogue, busy: false, problem: catalogue.problem });
  }

  setQuery(query: string): void {
    this.set({ query });
  }

  setCategory(category: LibraryCategory | "all"): void {
    this.set({ category });
  }

  setGoogleKey(googleKey: string): void {
    writeKey(googleKey);
    this.set({ googleKey });
  }

  /** What the list is showing, given what has been typed and chosen. */
  visible(): LibraryFont[] {
    const catalogue = this.state.catalogue;
    if (!catalogue) return [];
    return search(catalogue.fonts, this.state.query, this.state.category);
  }

  /**
   * Fetch one font and read it.
   *
   * Any fetch already running is abandoned rather than allowed to finish and
   * overwrite this one: clicking down a list is how anybody uses a font
   * picker, and the answer that arrives last should be the one that was asked
   * for last, not the one that happened to be slowest.
   */
  async load(font: LibraryFont, weight = 400, italic = false): Promise<LoadedFont | null> {
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;
    this.set({ busy: true, problem: null });

    try {
      const fetched = await download({ font, weight, italic }, controller.signal);
      const { typeface } = await importFont(fetched.bytes, fetched.fileName);
      if (controller.signal.aborted) return null;
      const loaded: LoadedFont = {
        font,
        weight,
        italic,
        typeface,
        measured: measure(typeface),
        from: fetched.from,
      };
      this.set({ loaded, busy: false });
      return loaded;
    } catch (error) {
      if (controller.signal.aborted) return null;
      this.set({
        busy: false,
        problem: error instanceof Error ? error.message : "That font could not be fetched.",
      });
      return null;
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  /** Keep this font on screen behind the letters, or stop. */
  setReference(reference: LoadedFont | null): void {
    this.set({ reference });
  }

  clearProblem(): void {
    this.set({ problem: null });
  }
}

/*
 * The key is the one thing here worth remembering between visits, and it
 * belongs to the person rather than to the document, so it goes to local
 * storage rather than into a font. Wrapped because storage is not always
 * writable -- Safari in private browsing throws rather than failing quietly.
 */
function readKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function writeKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Nothing to be done, and not worth taking the view down for.
  }
}

export const libraryStore = new LibraryStore();

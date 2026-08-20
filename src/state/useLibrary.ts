import { useSyncExternalStore } from "react";

import { libraryStore, type LibraryState } from "./library-store";

/** Subscribe to the font library. */
export function useLibrary(): LibraryState {
  return useSyncExternalStore(
    libraryStore.subscribe,
    libraryStore.getSnapshot,
    libraryStore.getSnapshot,
  );
}

export { libraryStore } from "./library-store";
export type { LibraryState, LoadedFont } from "./library-store";

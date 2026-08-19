import { useSyncExternalStore } from "react";

import { store, type AppState } from "./store";

/** Subscribe to the whole application state. */
export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export { store, nodeKey } from "./store";
export type { AppState, NodeRef, ToolId, ViewId } from "./store";

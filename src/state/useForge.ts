import { useSyncExternalStore } from "react";

import { forgeStore, type ForgeState } from "./forge-store";

/** Subscribe to the font being drawn. */
export function useForge(): ForgeState {
  return useSyncExternalStore(forgeStore.subscribe, forgeStore.getSnapshot, forgeStore.getSnapshot);
}

export { forgeStore } from "./forge-store";
export type { ForgeState, Phase, Scope } from "./forge-store";

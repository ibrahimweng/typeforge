import { useSyncExternalStore } from "react";

import { assembleStore, type AssembleState } from "./assemble-store";

/** Subscribe to the font being assembled. */
export function useAssemble(): AssembleState {
  return useSyncExternalStore(
    assembleStore.subscribe,
    assembleStore.getSnapshot,
    assembleStore.getSnapshot,
  );
}

export { assembleStore } from "./assemble-store";
export type { AssembleState } from "./assemble-store";

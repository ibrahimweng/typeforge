import { useSyncExternalStore } from "react";

import { quillStore, type QuillState } from "./quill-store";

/** Subscribe to the font being traced. */
export function useQuill(): QuillState {
  return useSyncExternalStore(quillStore.subscribe, quillStore.getSnapshot, quillStore.getSnapshot);
}

export { quillStore, drawTraced } from "./quill-store";
export type { QuillState, QuillDocument, Traced, Phase } from "./quill-store";

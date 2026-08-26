/**
 * Keeping the work between visits.
 *
 * Saving to a file is the answer to "I want this on my other machine". It is
 * not the answer to "the tab closed", because nobody saves before the thing
 * they did not expect -- so the session is written down as it goes, and finding
 * it again is not something anybody has to have remembered to arrange.
 *
 * In IndexedDB rather than `localStorage`. A font is most of a megabyte before
 * anybody has drawn anything, `localStorage` is a five-megabyte cupboard shared
 * with everything else on the origin, and it throws when full -- which would
 * make the feature fail exactly when there was most to lose. IndexedDB is asked
 * for real storage and answers in bytes rather than characters.
 *
 * Nothing here ever throws at the caller. Storage can be switched off, full, or
 * refused in a private window, and none of those are a reason for the drawing
 * on screen to stop working: the work carries on and the interface says it is
 * not being kept.
 */

import { readProject, type Project } from "./format";

const DATABASE = "typeforge";
const STORE = "session";
const ONE = "current";

/** How long the drawing has to sit still before it is written down. */
export const SETTLE = 900;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** Write the session down. Answers whether it went. */
export async function keep(project: Project): Promise<boolean> {
  const database = await open();
  if (!database) return false;
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(project, ONE);
      transaction.oncomplete = () => {
        database.close();
        resolve(true);
      };
      transaction.onerror = () => {
        database.close();
        resolve(false);
      };
      transaction.onabort = () => {
        database.close();
        resolve(false);
      };
    } catch {
      database.close();
      resolve(false);
    }
  });
}

/** What was kept last time, if anything, and if it is still readable. */
export async function kept(): Promise<Project | null> {
  const database = await open();
  if (!database) return null;
  return new Promise((resolve) => {
    try {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(ONE);
      request.onsuccess = () => {
        database.close();
        /*
         * Guarded, because this runs after the try below has already returned.
         *
         * A throw in here escapes into the database's own event handler, and
         * the promise around it then neither resolves nor rejects -- so the
         * caller waits for a session that never arrives, the flag saying a
         * restore is in progress is never put down, and nothing is written to
         * disk again for the rest of the visit. Silently: no error, no message,
         * and the drawing on screen carries on as though it were being kept.
         */
        try {
          // Read through the same door a file goes through, so a session
          // written by an older Typeforge is turned away rather than
          // half-restored.
          resolve(readProject(request.result));
        } catch {
          resolve(null);
        }
      };
      request.onerror = () => {
        database.close();
        resolve(null);
      };
    } catch {
      database.close();
      resolve(null);
    }
  });
}

/** Throw away what was kept, for starting again on purpose. */
export async function forget(): Promise<void> {
  const database = await open();
  if (!database) return;
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(ONE);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        resolve();
      };
    } catch {
      database.close();
      resolve();
    }
  });
}

/**
 * Write the session down once it has stopped changing.
 *
 * Dragging a slider is a hundred edits a second and every one of them is a new
 * document; writing each would spend the whole frame budget serialising a font
 * nobody has finished adjusting. Waiting for the hand to come off the control
 * turns that into one write.
 */
export function keeper(settle = SETTLE): {
  soon: (make: () => Project) => void;
  now: (make: () => Project) => Promise<boolean>;
  stop: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const now = async (make: () => Project): Promise<boolean> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      return await keep(make());
    } catch {
      return false;
    }
  };

  return {
    soon(make) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void now(make);
      }, settle);
    },
    now,
    stop() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

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
          /*
           * Read through the same door a file goes through, which is what
           * makes an old session worth keeping rather than something to step
           * around: `readProject` brings a document forward through the
           * migrations and reads what it can of one from a newer Typeforge,
           * and both of those matter more here than for a file. A file that
           * will not open is a file somebody still has. A session that will
           * not open is gone.
           */
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
      /*
       * And when the browser takes the transaction away, which is not an error.
       *
       * A transaction that fails fires `error` at the request and then `abort`
       * at the transaction, so the handler above catches that kind. The other
       * kind has no error in it: the work was done and the commit never
       * happened, because the tab was going away or the storage was reclaimed.
       * Only `abort` fires for those, and without this the promise never
       * settles at all.
       *
       * Which matters here more than it looks, because of who waits on it. The
       * one caller is the "clear the kept work and reload" button in
       * `Boundary`, on the screen somebody reaches when the application has
       * already broken once -- and it waits for this before reloading, on
       * purpose, so the reload does not cancel the write. A promise that never
       * resolves makes that button do nothing at all, silently, which is the
       * exact fault the waiting was added to fix.
       */
      transaction.onabort = () => {
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
export function keeper(
  settle = SETTLE,
  /**
   * Told after every write, whether it went or not.
   *
   * This is the whole reason the boolean below is worth returning. Without it
   * `soon` was the only path that ran during ordinary work and it threw its
   * answer away, so the one question anybody has -- is my work being kept --
   * was answered once at startup and never asked again. Storage that filled up
   * an hour in went on failing quietly while the interface said it was fine,
   * which is the failure this whole file exists to avoid.
   */
  told?: (kept: boolean) => void,
): {
  soon: (make: () => Project) => void;
  now: (make: () => Project) => Promise<boolean>;
  stop: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the browser has been asked to hold on to this. Asked once. */
  let asked = false;

  const now = async (make: () => Project): Promise<boolean> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    let went = false;
    try {
      went = await keep(make());
    } catch {
      went = false;
    }
    told?.(went);
    /*
     * And once something has actually been written, ask to keep it.
     *
     * After the first write rather than before it, because there is no point
     * asking a browser to hold on to storage this origin turns out not to have.
     * `askToPersist` says what the request is for.
     */
    if (went && !asked) {
      asked = true;
      void askToPersist();
    }
    return went;
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

/**
 * Ask the browser not to throw this away.
 *
 * Written data is not kept data. Storage an origin has not asked to persist is
 * evictable: browsers clear it when the disk is under pressure, and WebKit
 * clears it after seven days without a visit whether the disk is under pressure
 * or not. So the session survives closing the tab, which is what it was built
 * for, and then quietly does not survive a fortnight's holiday, which is the
 * case somebody is most likely to be relying on it for.
 *
 * Answers true when the browser agreed, false when it declined, and null when
 * it has no opinion to give because the API is not there. Nothing is done
 * differently on a refusal: eviction is a possibility rather than an event, and
 * telling somebody their work "might" be cleared some day is a warning they can
 * do nothing with. The Save button is the answer to that and it is always
 * there.
 */
export async function askToPersist(): Promise<boolean | null> {
  try {
    if (typeof navigator === "undefined") return null;
    const storage = navigator.storage;
    if (!storage || typeof storage.persist !== "function") return null;
    // Already granted is the common case on a return visit, and asking again
    // costs a prompt in the browsers that show one.
    if (typeof storage.persisted === "function" && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}

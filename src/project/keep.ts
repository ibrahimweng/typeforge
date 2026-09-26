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
/**
 * The one record every tab used to share, and still the one read when there
 * is nothing newer.
 *
 * Every open tab wrote its session here, and every one of them wrote it when
 * it was hidden whether or not anything had changed -- so two tabs open on two
 * fonts took turns overwriting each other, and which font came back on the
 * next visit was whichever tab happened to be looked away from last. Not the
 * one that was worked on; the one that was *left*, which for somebody who
 * glanced at an old tab on the way to closing the browser was the afternoon
 * gone.
 *
 * Each tab now writes to a record of its own, keyed below, and a visit picks
 * up the one that was written most recently -- which, since a tab now only
 * writes when it has something new to write, is the one most recently worked
 * on. This key is still read as one of the candidates, so a session kept
 * before the change comes back exactly as it did, and it ages out like any
 * other once there are newer ones.
 */
const ONE = "current";
/** A tab's own record. */
const SLOT = "tab:";
/**
 * How many tabs' sessions are held at once.
 *
 * Enough that no tab somebody still has open loses its record to the others,
 * few enough that the quota this module exists to survive is not spent on
 * copies of the same font from tabs closed last month. Trimmed oldest first,
 * once a visit, and never the visiting tab's own.
 */
export const SLOTS = 8;
/** Where a tab remembers which record is its own, across a reload. */
const TAB_KEY = "typeforge:tab";

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

/*
 * Which tab this is.
 *
 * In `sessionStorage`, which is the one store a browser keeps per tab: it
 * survives a reload, so reloading puts back this tab's own work rather than
 * whichever tab wrote last, and it dies with the tab, so a new tab starts a
 * record of its own.
 *
 * With one hole in it, and a Web Lock to fill it. "Duplicate tab" copies
 * `sessionStorage` along with everything else, and then two live tabs believe
 * they are the same one and are back to overwriting each other. So a tab
 * holds a lock named for its id for as long as it is open; a duplicate that
 * finds the lock already taken knows it is a copy and takes a new id. Where
 * the browser has no locks the check is skipped -- which is the old fault
 * returning in one unusual case, rather than a new one.
 */
function freshId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Falls through to the plain one below.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Hold a tab's lock for the life of the page. False when another tab has it. */
function hold(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
      if (!locks || typeof locks.request !== "function") {
        resolve(true);
        return;
      }
      locks
        .request(`${TAB_KEY}:${id}`, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          resolve(true);
          // Never settled, so the lock is let go of only when the page is.
          return new Promise<void>(() => {});
        })
        .catch(() => resolve(true));
    } catch {
      resolve(true);
    }
  });
}

/** Work out which tab this is, claiming a new id if it is a copy of another. */
export async function claimTab(): Promise<string> {
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(TAB_KEY);
  } catch {
    id = null;
  }
  if (!id || !(await hold(id))) {
    id = freshId();
    await hold(id);
  }
  try {
    sessionStorage.setItem(TAB_KEY, id);
  } catch {
    // A tab that cannot remember its id gets a new record on reload, and the
    // newest record is what a new record is restored from. Nothing is lost.
  }
  return id;
}

let claimed: Promise<string> | null = null;

/** This tab's id, claimed once per page. */
export function thisTab(): Promise<string> {
  claimed ??= claimTab();
  return claimed;
}

/**
 * Write the session down. Answers whether it went.
 *
 * Into this tab's own record when it is told which tab it is, and into the
 * old shared one when it is not -- which nothing in the application does any
 * more, and which is kept so that a caller that has not heard of tabs still
 * writes something that `kept` reads back.
 */
export async function keep(project: Project, tab?: string | null): Promise<boolean> {
  const database = await open();
  if (!database) return false;
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(project, tab ? `${SLOT}${tab}` : ONE);
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

/** When a record was written, for picking the newest. Nought when it cannot say. */
function writtenAt(record: unknown): number {
  const saved = (record as { saved?: unknown } | null)?.saved;
  const at = typeof saved === "string" ? Date.parse(saved) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
}

/**
 * What was kept last time, if anything, and if it is still readable.
 *
 * This tab's own record first, when it has one -- a reload is somebody
 * wanting back what was in front of them, not what another tab was doing --
 * and otherwise the newest record of any tab, the old shared one included.
 * A record that will not read is stepped over for the next newest rather than
 * ending the search: one bad session should not cost the good one behind it.
 *
 * And the records past the newest `SLOTS` are thrown away on the way, in the
 * same transaction. Once a visit is often enough, and this is the one place
 * that already has every record in hand.
 */
export async function kept(tab?: string | null): Promise<Project | null> {
  const database = await open();
  if (!database) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (project: Project | null) => {
      if (settled) return;
      settled = true;
      database.close();
      resolve(project);
    };
    try {
      const store = database.transaction(STORE, "readwrite").objectStore(STORE);
      const keysRequest = store.getAllKeys();
      const valuesRequest = store.getAll();
      keysRequest.onerror = () => finish(null);
      valuesRequest.onerror = () => finish(null);
      valuesRequest.onsuccess = () => {
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
          // Both lists come back in key order, which is what pairs them.
          const keys = keysRequest.result as IDBValidKey[];
          const values = valuesRequest.result as unknown[];
          const own = tab ? `${SLOT}${tab}` : null;
          const records = keys
            .map((key, at) => ({ key: String(key), value: values[at] }))
            .filter((one) => one.key === ONE || one.key.startsWith(SLOT))
            .sort((one, other) => {
              if (one.key === own) return -1;
              if (other.key === own) return 1;
              return writtenAt(other.value) - writtenAt(one.value);
            });

          let found: Project | null = null;
          for (const record of records) {
            /*
             * Read through the same door a file goes through, which is what
             * makes an old session worth keeping rather than something to
             * step around: `readProject` brings a document forward through
             * the migrations and reads what it can of one from a newer
             * Typeforge, and both of those matter more here than for a file.
             * A file that will not open is a file somebody still has. A
             * session that will not open is gone.
             */
            try {
              found = readProject(record.value);
            } catch {
              found = null;
            }
            if (found) break;
          }

          // Trimmed by age alone, and never this tab's own.
          const byAge = records
            .filter((one) => one.key !== own)
            .sort((one, other) => writtenAt(other.value) - writtenAt(one.value));
          for (const stale of byAge.slice(own ? SLOTS - 1 : SLOTS)) {
            try {
              store.delete(stale.key);
            } catch {
              // Tidying is not worth failing a restore over.
            }
          }
          finish(found);
        } catch {
          finish(null);
        }
      };
    } catch {
      finish(null);
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
      // Every tab's record and the old shared one, since starting again from
      // a broken session and finding another tab's copy of it is no start.
      transaction.objectStore(STORE).clear();
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
  /**
   * Which tab's record to write, or nothing for the old shared one. A promise
   * because claiming a tab asks the browser for a lock; see `thisTab`.
   */
  tab: Promise<string | null> | string | null = null,
): {
  soon: (make: () => Project) => void;
  now: (make: () => Project) => Promise<boolean>;
  flush: (make: () => Project) => Promise<boolean>;
  stop: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the browser has been asked to hold on to this. Asked once. */
  let asked = false;
  /**
   * Whether something has changed since the last write that went.
   *
   * Set by `soon`, which is what every change calls, and put down by a write
   * that went. It is what `flush` asks, and the reason it exists is the other
   * half of the fault written up over `ONE`: hiding a tab wrote its session
   * whether or not anything had happened in it, so merely looking away from
   * a tab was an edit as far as the next visit could tell. A tab with nothing
   * new to say now says nothing.
   */
  let pending = false;

  const now = async (make: () => Project): Promise<boolean> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // Put down before the write rather than after it, so a change that lands
    // while the write is in flight raises it again instead of being lost.
    pending = false;
    let went = false;
    try {
      const slot = await tab;
      went = await keep(make(), slot);
    } catch {
      went = false;
    }
    if (!went) pending = true;
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
      pending = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void now(make);
      }, settle);
    },
    now,
    /** Write at once, but only if something changed since the last write. */
    flush(make) {
      return pending ? now(make) : Promise.resolve(false);
    },
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

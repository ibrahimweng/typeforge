/**
 * Keeping the work between visits.
 *
 * Every claim this file makes is about a browser that is not cooperating,
 * because the cooperating case is the one nobody loses an afternoon to. Storage
 * can be switched off, full, refused in a private window, or taken away halfway
 * through -- and the promise this module hands back is what the application
 * waits on. A promise that resolves `false` in those cases is a tool that says
 * it is not keeping anything. A promise that never resolves at all is a tool
 * that has stopped, without saying so.
 *
 * Node has no IndexedDB, so the browser's side of the conversation is written
 * here. That is not a compromise -- it is the only way to ask for a quota
 * failure, a blocked upgrade or a transaction the browser took away, which are
 * exactly the answers worth testing and none of which a real database can be
 * talked into on demand.
 *
 * Three guards in `keep.ts` are deliberately not tested, because no test can
 * tell whether they are there: the check for `indexedDB` being absent, which
 * the `try` under it would catch anyway; the check that the store is not
 * already made, which cannot run while the version stays at 1; and each
 * transaction's `onerror`, which is reached only on the way to the `onabort`
 * beside it. All three are the same answer arrived at twice, and belt and
 * braces on a promise that has to settle is worth keeping. Listed here so the
 * next person reads their absence as a decision rather than an oversight.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { FORMAT, type Project } from "./format";
import { SETTLE, forget, keep, keeper, kept } from "./keep";

type Handler = (() => void) | null;

/** How a transaction finishes. */
type Ending =
  | "complete"
  /*
   * Something in it failed -- a quota, a constraint. The browser fires `error`
   * at the request, it bubbles to the transaction, and then `abort` follows.
   * Both, in that order, which is why the fake fires both.
   */
  | "error"
  /*
   * The browser took it away. The work was done and the commit never came:
   * the tab was closing, or the storage was reclaimed. No error is fired for
   * this kind, only `abort`.
   */
  | "abort";

interface Faults {
  /** Asking for the database throws, as it did in a Firefox private window. */
  openThrows?: boolean;
  /** Asking for the database fails, or waits on a connection in another tab. */
  opening?: "error" | "blocked";
  /** Reaching for the store throws, as it does when the store is not there. */
  noStore?: boolean;
  /** How a writing transaction ends. */
  writing?: Ending;
  /** Reading the one record fails. */
  readFails?: boolean;
}

/**
 * A browser's IndexedDB, as much of it as this module talks to.
 *
 * Small on purpose: `open`, one store, `put`, `get`, `delete`, and the handful
 * of events the module listens for. Every fault it can be asked for is one a
 * real browser produces, and the ordering it fires them in -- requests before
 * the transaction ends, `error` before `abort` -- is the ordering the spec
 * gives, because handlers that resolve a promise are order-sensitive by
 * definition.
 */
function browser(faults: Faults = {}, held = new Map<string, unknown>()) {
  const connections: { shut: boolean }[] = [];
  let stores = 0;

  const objectStore = (queue: (settle: () => void) => void) => ({
    put(value: unknown, key: string) {
      held.set(key, value);
    },
    delete(key: string) {
      held.delete(key);
    },
    get(key: string) {
      const request: { result: unknown; onsuccess: Handler; onerror: Handler } = {
        result: undefined,
        onsuccess: null,
        onerror: null,
      };
      queue(() => {
        if (faults.readFails) {
          request.onerror?.();
          return;
        }
        request.result = held.get(key);
        request.onsuccess?.();
      });
      return request;
    },
  });

  // A connection per `open`, as a browser hands them out, so that closing one
  // of them can be told apart from closing the same one twice.
  const connect = () => {
    const connection = { shut: false };
    connections.push(connection);
    return connection;
  };

  const openDatabase = (connection: { shut: boolean }) => ({
    objectStoreNames: { contains: () => stores > 0 },
    createObjectStore() {
      stores += 1;
    },
    close() {
      connection.shut = true;
    },
    transaction(_name: string, _mode: IDBTransactionMode) {
      if (faults.noStore) throw new Error("NotFoundError");
      const requests: (() => void)[] = [];
      const transaction = {
        oncomplete: null as Handler,
        onerror: null as Handler,
        onabort: null as Handler,
        objectStore: () => objectStore((settle) => requests.push(settle)),
      };
      // On a microtask rather than a timer, so a test holding the clock still
      // sees the database answer.
      queueMicrotask(() => {
        for (const settle of requests) settle();
        const ending = faults.writing ?? "complete";
        if (ending === "complete") transaction.oncomplete?.();
        if (ending === "error") transaction.onerror?.();
        if (ending !== "complete") transaction.onabort?.();
      });
      return transaction;
    },
  });

  return {
    held,
    /** How many connections were handed out. */
    opened: () => connections.length,
    /** How many of them were let go of again. */
    closed: () => connections.filter((one) => one.shut).length,
    /** Whether the store was made, and how many times. */
    stores: () => stores,
    indexedDB: {
      open() {
        if (faults.openThrows) throw new Error("refused");
        const request = {
          result: openDatabase(connect()),
          onupgradeneeded: null as Handler,
          onsuccess: null as Handler,
          onerror: null as Handler,
          onblocked: null as Handler,
        };
        queueMicrotask(() => {
          if (faults.opening === "error") request.onerror?.();
          else if (faults.opening === "blocked") request.onblocked?.();
          else {
            if (stores === 0) request.onupgradeneeded?.();
            request.onsuccess?.();
          }
        });
        return request;
      },
    },
  };
}

/** The fake, in place of the browser's, for the length of one test. */
function running(faults: Faults = {}, held?: Map<string, unknown>) {
  const fake = browser(faults, held);
  vi.stubGlobal("indexedDB", fake.indexedDB);
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const session = (over: Partial<Project> = {}): Project =>
  ({
    typeforge: FORMAT,
    saved: "2026-01-02T03:04:05.000Z",
    mode: "edit",
    edit: { font: {}, fileName: "Inter.ttf" },
    ...over,
  }) as Project;

/**
 * Whether a promise settles at all, which for this module is most of the point.
 *
 * `await` on a promise that never resolves is a test that hangs until the
 * runner's timeout and then reports thirty seconds of nothing. Racing it
 * against a tick names the fault instead.
 */
async function settles<T>(promise: Promise<T>): Promise<T | "never settled"> {
  return await Promise.race([
    promise,
    new Promise<"never settled">((resolve) => setTimeout(() => resolve("never settled"), 50)),
  ]);
}

describe("a browser that will not keep anything", () => {
  /*
   * No IndexedDB at all: an old browser, or one with storage switched off.
   *
   * The whole file is written so that this is an answer rather than a fault,
   * and the answer has to be a resolved promise -- the application awaits all
   * three of these before it will draw anything.
   */
  it("says no rather than throwing when there is no database to ask", async () => {
    expect(typeof indexedDB).toBe("undefined");
    expect(await settles(keep(session()))).toBe(false);
    expect(await settles(kept())).toBeNull();
    expect(await settles(forget().then(() => "done"))).toBe("done");
  });

  /*
   * Firefox's private windows used to throw on `indexedDB.open` rather than
   * fail it, which is a different shape of no and reaches a different branch.
   */
  it("says no when asking for the database throws", async () => {
    running({ openThrows: true });
    expect(await settles(keep(session()))).toBe(false);
    expect(await settles(kept())).toBeNull();
    expect(await settles(forget().then(() => "done"))).toBe("done");
  });

  it("says no when the database refuses to open", async () => {
    running({ opening: "error" });
    expect(await settles(keep(session()))).toBe(false);
    expect(await settles(kept())).toBeNull();
  });

  /*
   * Blocked is another tab holding the database open across a version change.
   * Waiting for that tab to close is not something a page that wants to draw
   * can do, so it is treated as a no with the option of a yes next time.
   */
  it("says no rather than waiting when another tab is holding the database", async () => {
    running({ opening: "blocked" });
    expect(await settles(keep(session()))).toBe(false);
    expect(await settles(kept())).toBeNull();
  });

  /*
   * A database that opens without the store in it. Real, and not exotic: an
   * upgrade that was interrupted leaves exactly this. `transaction` throws
   * synchronously for it, which is the one failure that does not arrive as an
   * event and so is the one a promise-shaped module is likeliest to drop.
   */
  it("says no when the store is not in the database that opened", async () => {
    running({ noStore: true });
    expect(await settles(keep(session()))).toBe(false);
    expect(await settles(kept())).toBeNull();
    expect(await settles(forget().then(() => "done"))).toBe("done");
  });
});

describe("writing the session down", () => {
  it("makes the store the first time and not again", async () => {
    const fake = running();
    expect(await keep(session())).toBe(true);
    expect(fake.stores()).toBe(1);
    expect(await keep(session())).toBe(true);
    expect(fake.stores()).toBe(1);
  });

  /*
   * One record, replaced. A session per save would be a font of most of a
   * megabyte accumulating every time somebody let go of a slider, and the
   * feature would end by filling the quota it exists to survive.
   */
  it("keeps the latest session and not a pile of them", async () => {
    const fake = running();
    await keep(session({ mode: "edit" }));
    await keep(session({ mode: "forge" }));
    expect([...fake.held.keys()]).toEqual(["current"]);
    expect(await kept()).toMatchObject({ mode: "forge" });
  });

  /*
   * A full quota is the failure this module was written in expectation of --
   * see the file's own comment about `localStorage` throwing when full.
   */
  it("says no when the write fails", async () => {
    running({ writing: "error" });
    expect(await settles(keep(session()))).toBe(false);
  });

  it("says no when the browser takes the transaction away", async () => {
    running({ writing: "abort" });
    expect(await settles(keep(session()))).toBe(false);
  });

  /*
   * Every path lets go of the connection.
   *
   * A connection left open is not a leak that shows up as a leak: it is the
   * next tab's upgrade blocking forever on this one. Each call opens its own,
   * so each call has to close its own -- including the ones that failed, which
   * are the paths where forgetting is easy.
   */
  it("lets go of every connection it opened, whether the write went or not", async () => {
    const good = running();
    await keep(session());
    await kept();
    await forget();
    expect(good.opened()).toBe(3);
    expect(good.closed()).toBe(3);

    vi.unstubAllGlobals();
    const bad = running({ writing: "error" });
    await keep(session());
    await kept();
    await forget();
    expect(bad.opened()).toBe(3);
    expect(bad.closed()).toBe(3);

    vi.unstubAllGlobals();
    const gone = running({ writing: "abort" });
    await keep(session());
    await forget();
    expect(gone.opened()).toBe(2);
    expect(gone.closed()).toBe(2);

    vi.unstubAllGlobals();
    const missing = running({ noStore: true });
    await keep(session());
    await kept();
    await forget();
    expect(missing.opened()).toBe(3);
    expect(missing.closed()).toBe(3);
  });
});

describe("reading what was kept", () => {
  it("brings back what was written", async () => {
    running();
    await keep(session({ mode: "quill" }));
    expect(await kept()).toMatchObject({ mode: "quill", saved: "2026-01-02T03:04:05.000Z" });
  });

  it("has nothing to bring back on a first visit", async () => {
    running();
    expect(await kept()).toBeNull();
  });

  /*
   * Through the same door a file goes through.
   *
   * A session written by an older Typeforge is the same problem as a holiday
   * photo handed to the file picker, and `readProject` is the one place that
   * decides. Restoring half of a document nobody can name would be worse than
   * starting empty.
   */
  it("turns away a session it cannot read", async () => {
    const held = new Map<string, unknown>([["current", { typeforge: FORMAT - 1, mode: "edit" }]]);
    running({}, held);
    expect(await kept()).toBeNull();
  });

  it("says nothing rather than failing when the read fails", async () => {
    running({ readFails: true });
    expect(await settles(kept())).toBeNull();
  });

  /**
   * The guard that keeps a bad record from stopping the whole visit.
   *
   * Reading the record happens inside the database's own event handler, which
   * has already returned as far as the promise is concerned. A throw in there
   * escapes into the browser: the promise neither resolves nor rejects, the
   * flag saying a restore is in progress is never put down, and nothing is
   * written to disk again for the rest of the visit -- with no error and no
   * message, while the drawing on screen carries on as though it were kept.
   *
   * A record that throws when it is read is arranged here rather than found,
   * because a real one has been through a structured clone and is plain data.
   * What is being held is not that a browser can produce one; it is that if
   * reading ever throws, the caller is told no instead of waiting forever.
   */
  it("settles even when reading the record throws", async () => {
    const held = new Map<string, unknown>([
      [
        "current",
        {
          typeforge: FORMAT,
          mode: "edit",
          get edit(): never {
            throw new Error("unreadable");
          },
        },
      ],
    ]);
    running({}, held);
    expect(await settles(kept())).toBeNull();
  });
});

describe("throwing the kept session away", () => {
  it("removes it, so the next visit starts empty", async () => {
    const fake = running();
    await keep(session());
    expect(fake.held.size).toBe(1);
    await forget();
    expect(fake.held.size).toBe(0);
    expect(await kept()).toBeNull();
  });

  it("finishes when the delete fails", async () => {
    running({ writing: "error" });
    expect(await settles(forget().then(() => "done"))).toBe("done");
  });

  /**
   * The one that made a button do nothing.
   *
   * `forget` is awaited by "clear the kept work and reload" in `Boundary` --
   * the screen somebody reaches when the application has already broken once --
   * and the waiting is deliberate: reloading without it cancels the delete, and
   * the page comes back with the same broken document and throws again.
   *
   * Which makes a promise that never settles the same fault by the other route.
   * A transaction the browser takes away fires `abort` and no error, and that
   * is exactly what a tab on its way out does to a transaction. `keep` handled
   * it and this did not, so the button waited on a promise with nothing behind
   * it and the reload never came.
   */
  it("finishes when the browser takes the transaction away", async () => {
    running({ writing: "abort" });
    expect(await settles(forget().then(() => "done"))).toBe("done");
  });
});

describe("waiting for the drawing to stop changing", () => {
  /*
   * A drag is a hundred documents a second and every one of them is a font.
   * Writing each would spend the frame budget serialising something nobody has
   * finished adjusting, so the write waits for the hand to come off.
   */
  it("writes once for a run of changes, at the end of it", async () => {
    vi.useFakeTimers();
    const fake = running();
    const write = keeper(100);
    let made = 0;
    const make = () => {
      made += 1;
      return session();
    };

    for (let i = 0; i < 50; i += 1) {
      write.soon(make);
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(made).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(made).toBe(1);
    expect(fake.held.size).toBe(1);
  });

  it("waits the whole settle and not a moment less", async () => {
    vi.useFakeTimers();
    running();
    const write = keeper(100);
    let made = 0;
    write.soon(() => {
      made += 1;
      return session();
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(made).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(made).toBe(1);
  });

  it("waits the settle the application asks for when told nothing else", async () => {
    vi.useFakeTimers();
    running();
    const write = keeper();
    let made = 0;
    write.soon(() => {
      made += 1;
      return session();
    });

    await vi.advanceTimersByTimeAsync(SETTLE - 1);
    expect(made).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(made).toBe(1);
  });

  /*
   * Hiding the tab writes without waiting, and the pending write has to go with
   * it -- otherwise the last second of work is written twice, the second time
   * from a page that may not be there to finish it.
   */
  it("writes at once when asked, and drops the write that was waiting", async () => {
    vi.useFakeTimers();
    running();
    const write = keeper(100);
    let made = 0;
    const make = () => {
      made += 1;
      return session();
    };

    write.soon(make);
    expect(await write.now(make)).toBe(true);
    expect(made).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(made).toBe(1);
  });

  /*
   * And stopping drops it too. This is what unmounting calls, and a write
   * arriving after the application has gone is a write of whatever the stores
   * happen to hold at that moment.
   */
  it("drops the waiting write when it is stopped", async () => {
    vi.useFakeTimers();
    const fake = running();
    const write = keeper(100);
    let made = 0;

    write.soon(() => {
      made += 1;
      return session();
    });
    write.stop();

    await vi.advanceTimersByTimeAsync(1000);
    expect(made).toBe(0);
    expect(fake.held.size).toBe(0);
  });

  /*
   * Gathering the session reaches into four stores, and a store mid-restore can
   * throw. The interface reads the answer as whether the browser is keeping
   * anything, so a throw here would be reported as a storage failure and, worse,
   * would escape an event handler on the way.
   */
  it("says no rather than throwing when the session cannot be gathered", async () => {
    running();
    const write = keeper(100);
    expect(
      await write.now(() => {
        throw new Error("a store was mid-restore");
      }),
    ).toBe(false);
  });

  it("says no when there is a session to write and nowhere to write it", async () => {
    running({ writing: "error" });
    const write = keeper(100);
    expect(await write.now(() => session())).toBe(false);
  });
});

/**
 * That a download's URL outlives the click that starts it.
 *
 * Revoked on the next line, Safari has nothing left to fetch by the time it
 * starts the download, and the file silently never arrives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadBlob, KEEP_URL_FOR } from "./download";

afterEach(() => vi.restoreAllMocks());

describe("handing a file to the browser", () => {
  it("clicks a link named for the file and gives the URL back only later", () => {
    const made = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:font");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const link = { href: "", download: "", click: vi.fn() };
    const waiting: Array<{ run: () => void; ms: number }> = [];

    downloadBlob(new Blob(["x"]), "Bakerloo.ttf", {
      doc: { createElement: () => link as unknown as HTMLElement } as Pick<
        Document,
        "createElement"
      >,
      later: (run, ms) => waiting.push({ run, ms }),
    });

    expect(made).toHaveBeenCalledOnce();
    expect(link.href).toBe("blob:font");
    expect(link.download).toBe("Bakerloo.ttf");
    expect(link.click).toHaveBeenCalledOnce();
    expect(revoked).not.toHaveBeenCalled();

    expect(waiting).toHaveLength(1);
    expect(waiting[0].ms).toBe(KEEP_URL_FOR);
    waiting[0].run();
    expect(revoked).toHaveBeenCalledWith("blob:font");
  });
});

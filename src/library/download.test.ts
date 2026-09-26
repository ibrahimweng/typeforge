/**
 * Which file the library takes, and how long it waits for it.
 *
 * No network, as with the rest of the library's tests: `fetch` is stood in
 * for, and what is checked is what this application asks for and what it does
 * with the answer. The stylesheets are the shape Google sends a browser -- see
 * `google-css.fixture.ts` -- because the fault these are here for was a picker
 * written against the shape Google sends everything else.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { categoryOf, fetchCatalogue, search, type LibraryFont } from "./catalogue";
import { download, pickFontFile, subsetFor } from "./download";
import { GOOGLE_SUBSETS, googleStylesheet, gstaticUrl } from "./google-css.fixture";
import { within } from "./within";

const ROBOTO: LibraryFont = {
  id: "roboto",
  family: "Roboto",
  category: "sans-serif",
  weights: [400, 700],
  styles: ["normal", "italic"],
  variable: false,
  subsets: ["cyrillic", "cyrillic-ext", "greek", "latin", "latin-ext", "vietnamese"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("choosing a file out of Google's stylesheet", () => {
  it("takes the Latin subset, not the first one named", () => {
    const css = googleStylesheet("Roboto");
    // The fixture is only worth testing against if Latin is not first in it.
    expect(css.indexOf("/* cyrillic-ext */")).toBeLessThan(css.indexOf("/* latin */"));
    expect(pickFontFile(css)).toBe(gstaticUrl("roboto", "latin"));
  });

  it("does not mistake Latin Extended for Latin", () => {
    // latin-ext comes immediately before latin, and has no A in it.
    const css = googleStylesheet("Roboto");
    expect(pickFontFile(css)).not.toBe(gstaticUrl("roboto", "latin-ext"));
  });

  it("finds the Latin by its range when the blocks are not labelled", () => {
    const css = googleStylesheet("Roboto", 400, { labelled: false });
    expect(pickFontFile(css)).toBe(gstaticUrl("roboto", "latin"));
  });

  it("reads lower-case and single code point ranges", () => {
    const css = googleStylesheet("Noto Sans JP", 400, {
      labelled: false,
      subsets: [
        ["118", "U+21-22, U+27-2a, U+41-4d, U+4f-5d"],
        ["0", "U+25ee8, U+25f23"],
      ].reverse() as Array<[string, string]>,
    });
    expect(pickFontFile(css)).toBe(gstaticUrl("notosansjp", "118"));
  });

  it("takes the whole file when the stylesheet names only one", () => {
    // What the endpoint sends a client it does not take for a browser.
    const css =
      "@font-face {\n  font-family: 'Roboto';\n  src: url(https://fonts.gstatic.com/s/roboto/v1/whole.ttf) format('truetype');\n}\n";
    expect(pickFontFile(css)).toBe("https://fonts.gstatic.com/s/roboto/v1/whole.ttf");
  });

  it("still opens a family with no Latin in it at all", () => {
    const css = googleStylesheet("Khmer", 400, {
      subsets: [["khmer", "U+1780-17FF, U+19E0-19FF, U+200C-200D, U+25CC"]],
    });
    expect(pickFontFile(css)).toBe(gstaticUrl("khmer", "khmer"));
  });

  it("says so when there is nothing to take", () => {
    expect(pickFontFile("/* latin */ @font-face { font-family: 'X'; }")).toBeNull();
    expect(pickFontFile("")).toBeNull();
  });

  it("asks for the file the stylesheet chose", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return url.startsWith("https://fonts.googleapis.com/")
          ? new Response(googleStylesheet("Roboto"))
          : new Response(new Uint8Array([0, 1, 0, 0]));
      }),
    );
    const got = await download({ font: ROBOTO, weight: 400, italic: false });
    expect(got.from).toBe("google");
    expect(asked[1]).toBe(gstaticUrl("roboto", "latin"));
    expect(asked).toHaveLength(2);
  });
});

describe("asking Fontsource's CDN for a file", () => {
  /** Google down, so the second route is taken; returns the URL it asked for. */
  async function fontsourceUrlFor(font: LibraryFont): Promise<string> {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return url.startsWith("https://fonts.googleapis.com/")
          ? new Response("no", { status: 503 })
          : new Response(new Uint8Array([0, 1, 0, 0]));
      }),
    );
    const got = await download({ font, weight: 400, italic: false });
    expect(got.from).toBe("fontsource");
    return asked[asked.length - 1];
  }

  it("asks for Latin when the family has it", async () => {
    expect(await fontsourceUrlFor(ROBOTO)).toMatch(/\/roboto@latest\/latin-400-normal\.ttf$/);
  });

  it("asks for a subset the family has when Latin is not one", async () => {
    const khmer = { ...ROBOTO, id: "khmer", family: "Khmer", subsets: ["khmer"] };
    expect(subsetFor(khmer)).toBe("khmer");
    expect(await fontsourceUrlFor(khmer)).toMatch(/\/khmer@latest\/khmer-400-normal\.ttf$/);
  });

  it("assumes Latin when the catalogue did not say", () => {
    expect(subsetFor({ ...ROBOTO, subsets: undefined })).toBe("latin");
  });
});

describe("waiting for a server that does not answer", () => {
  /** A `fetch` that never resolves, but does notice being aborted. */
  function hanging(): typeof fetch {
    return ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
  }

  it("gives up at the deadline and says that is why", async () => {
    await expect(within(20, undefined, (signal) => hanging()("x", { signal }))).rejects.toThrow(
      "did not answer within 20 milliseconds",
    );
  });

  it("does not call being cancelled a timeout", async () => {
    const controller = new AbortController();
    const pending = within(60_000, controller.signal, (signal) => hanging()("x", { signal }));
    controller.abort();
    await expect(pending).rejects.not.toThrow(/did not answer/);
  });

  it("falls back to the built-in list rather than waiting forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hanging());
    const pending = fetchCatalogue();
    await vi.advanceTimersByTimeAsync(60_000);
    const catalogue = await pending;
    expect(catalogue.from).toBe("builtin");
    expect(catalogue.problem).toContain("did not answer within");
  });

  it("stops waiting for a font file and tries the other host", async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      asked.push(url);
      return url.startsWith("https://cdn.jsdelivr.net/")
        ? Promise.resolve(new Response(new Uint8Array([0, 1, 0, 0])))
        : hanging()(url, init);
    });
    const pending = download({ font: ROBOTO, weight: 400, italic: false });
    await vi.advanceTimersByTimeAsync(60_000);
    const got = await pending;
    expect(got.from).toBe("fontsource");
  });
});

describe("the kinds a family can be", () => {
  it("files a kind it does not know under Other, not Sans", () => {
    expect(categoryOf("sans-serif")).toBe("sans-serif");
    expect(categoryOf("other")).toBe("other");
    expect(categoryOf("blackletter")).toBe("other");
    expect(categoryOf(undefined)).toBe("other");
  });

  it("leaves icon sets out and keeps the rest out of Sans", async () => {
    const entry = (id: string, category: string) => ({
      id,
      family: id,
      category,
      weights: [400],
      styles: ["normal"],
      subsets: ["latin"],
      variable: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              entry("inter", "sans-serif"),
              entry("dseg7-classic", "other"),
              entry("material-symbols", "icons"),
            ]),
          ),
      ),
    );
    const catalogue = await fetchCatalogue();
    expect(catalogue.fonts.map((font) => font.id)).toEqual(["inter", "dseg7-classic"]);
    expect(search(catalogue.fonts, "", "sans-serif").map((font) => font.id)).toEqual(["inter"]);
    expect(search(catalogue.fonts, "", "other").map((font) => font.id)).toEqual(["dseg7-classic"]);
    expect(catalogue.fonts[0].subsets).toEqual(["latin"]);
  });
});

// Keeps the fixture honest: Latin is last, as Google sends it.
it("the fixture puts Latin last", () => {
  expect(GOOGLE_SUBSETS.at(-1)?.[0]).toBe("latin");
});

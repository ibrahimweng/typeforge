/**
 * The deployment's security policy, checked against what the application does.
 *
 * vercel.json is the only place the policy lives, and until this file nothing
 * read it but Vercel. So nothing noticed when it forbade something the
 * application needs: the WOFF2 decoder builds its bindings with `new
 * Function`, the policy did not allow 'unsafe-eval', and every compressed
 * font failed to open on the deployed site while every test passed.
 *
 * This is the quick half of the check -- no browser, no build -- and it reads
 * the policy source by source, so a failure here names the directive and the
 * thing that needs it. e2e/csp.spec.ts is the other half: the built
 * application, served with these headers, opening a WOFF2 and reaching the
 * library's hosts, with the browser itself reporting any violation. That one
 * catches a need nobody has written down here yet; this one says which line
 * of the policy to look at.
 *
 * It also holds the policy down. 'unsafe-eval' is there because a dependency
 * cannot work without it, and that is the only loosening the policy has; the
 * last test here fails if anything wider arrives beside it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

interface Header {
  key: string;
  value: string;
}

const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
  headers: Array<{ source: string; headers: Header[] }>;
};

const everywhere = vercel.headers.find((rule) => rule.source === "/(.*)")?.headers ?? [];
const header = (key: string) => everywhere.find((entry) => entry.key === key)?.value;

/** `default-src 'self'; script-src ...` as a map of directive to its sources. */
function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

const policy = directives(header("Content-Security-Policy") ?? "");

/**
 * The sources a fetch directive falls back to when it is not given.
 * `worker-src` falls back to `script-src` and then `default-src`; the others
 * to `default-src`.
 */
function sourcesFor(directive: string): string[] {
  const fallbacks = directive === "worker-src" ? ["script-src", "default-src"] : ["default-src"];
  for (const name of [directive, ...fallbacks]) {
    const sources = policy.get(name);
    if (sources) return sources;
  }
  return [];
}

/**
 * Every https origin the library's source names in a string.
 *
 * Read out of the files rather than listed here, so a new host added to
 * catalogue.ts or download.ts cannot be forgotten in the policy -- which is
 * exactly how it would be forgotten, since the dev server has no policy and
 * the new host works there. Strings only, so a URL in a comment explaining
 * something is not mistaken for a host the application calls.
 */
function hostsTheLibraryCalls(): string[] {
  const dir = join(ROOT, "src", "library");
  const origins = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!/\.ts$/.test(name) || /\.(test|fixture)\.ts$/.test(name)) continue;
    const source = readFileSync(join(dir, name), "utf8");
    for (const match of source.matchAll(/["'`](https:\/\/[a-z0-9.-]+)/gi)) {
      origins.add(new URL(match[1]).origin);
    }
    // The stylesheet route fetches files from a host it only names in a
    // pattern, since the address comes from Google's answer.
    for (const match of source.matchAll(/https:\\\/\\\/([a-z0-9\\.-]+)\\\//gi)) {
      origins.add(`https://${match[1].replace(/\\\./g, ".")}`);
    }
  }
  return [...origins].sort();
}

describe("the deployment's security policy", () => {
  it("is there", () => {
    expect(policy.size).toBeGreaterThan(0);
    expect(sourcesFor("default-src")).toContain("'self'");
  });

  it("lets the WOFF2 decoder build its bindings", () => {
    // Emscripten's embind assembles a function per binding with `new Function`.
    // If the decoder ever stops doing that, this first check fails and says
    // the policy can lose 'unsafe-eval' -- which it should, at once.
    const decoder = readFileSync(
      join(ROOT, "node_modules", "fonteditor-core", "woff2", "woff2.js"),
      "utf8",
    );
    expect(decoder, "the decoder no longer needs eval; drop 'unsafe-eval'").toContain(
      "new Function",
    );
    expect(sourcesFor("script-src")).toContain("'unsafe-eval'");
  });

  it("lets WebAssembly compile, and fetches the .wasm from our own origin", () => {
    // Without 'wasm-unsafe-eval' (or 'unsafe-eval', which the policy should not
    // be leaning on for this) `WebAssembly.instantiate` is refused outright.
    expect(sourcesFor("script-src")).toContain("'wasm-unsafe-eval'");
    // parse.ts asks for `${BASE_URL}woff2.wasm`, which is a fetch.
    expect(sourcesFor("connect-src")).toContain("'self'");
    expect(readFileSync(join(ROOT, "public", "woff2.wasm")).length).toBeGreaterThan(0);
  });

  it("lets the tracing worker start", () => {
    // quill-store.ts starts it from a module URL, which the build emits as a
    // file of our own.
    expect(sourcesFor("worker-src")).toContain("'self'");
  });

  it("reaches every host the font library calls", () => {
    const hosts = hostsTheLibraryCalls();
    // A floor, so a change to how the hosts are written that this no longer
    // reads is a failure and not a pass over an empty list.
    expect(hosts).toEqual(
      expect.arrayContaining([
        "https://api.fontsource.org",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
      ]),
    );
    const allowed = sourcesFor("connect-src");
    for (const host of hosts) {
      expect(allowed, `connect-src does not allow ${host}`).toContain(host);
    }
  });

  it("allows nothing wider than it has to", () => {
    const scripts = sourcesFor("script-src");
    // 'unsafe-inline' would make the rest of the policy decoration: any
    // injected <script> would run. Vite's build emits no inline script, and
    // the preview smoke test in e2e/csp.spec.ts would fail if it started to.
    for (const loose of ["'unsafe-inline'", "*", "https:", "http:", "data:", "blob:"]) {
      expect(scripts, `script-src allows ${loose}`).not.toContain(loose);
    }
    for (const directive of ["connect-src", "default-src", "worker-src"]) {
      expect(sourcesFor(directive), `${directive} allows anything`).not.toContain("*");
    }
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
  });

  it("comes with the headers that go with it", () => {
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Referrer-Policy")).toBeTruthy();
  });
});

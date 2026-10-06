/**
 * How a Node thread finds this source's modules by the names it gives them:
 * `@/` is the source folder, and an import names a file without its `.ts`.
 * Vite does this for the page, the tests and the scripts; a thread started by
 * `resolve-node.ts` runs outside Vite and is told here. Anything else is left
 * to Node.
 */

import { existsSync, statSync } from "node:fs";
import type { ResolveHook } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE = new URL("../", import.meta.url);

function file(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

export const resolve: ResolveHook = (specifier, context, next) => {
  let url: URL | null = null;
  if (specifier.startsWith("@/")) url = new URL(specifier.slice(2), SOURCE);
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL)
    url = new URL(specifier, context.parentURL);
  if (url?.protocol === "file:") {
    const path = fileURLToPath(url);
    if (!file(path)) {
      for (const ending of [".ts", "/index.ts"]) {
        if (file(path + ending)) return next(pathToFileURL(path + ending).href, context);
      }
    }
    return next(url.href, context);
  }
  return next(specifier, context);
};

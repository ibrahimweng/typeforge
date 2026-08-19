# Third-party notices

## Toolcraft UI (`src/ui/`)

The interface components in `src/ui/` come from **Toolcraft** by Pixel Point
(https://toolcraft.sh), taken from the `@pixel-point/toolcraft` package. They
are used under the Toolcraft Designer License, which permits personal,
internal, educational and designer client work.

That license does **not** permit selling this application as a standalone
product, or including it in a paid AI software product, app builder, website
builder, design-to-code service, template marketplace or competing generator.
Those uses need a separate commercial license from Pixel Point.

If this project ever changes from a client deliverable into something sold or
offered as a product, replace `src/ui/` before that happens. Everything in
`src/font/` is original work with no such restriction, and the components used
elsewhere in the app are ordinary open-source packages.

## Font libraries

- **opentype.js** — MIT. Parses TrueType and OpenType outlines and kerning.
- **fonteditor-core** — MIT. Reads and writes `glyf` TrueType tables, and
  handles WOFF and WOFF2.

## Animation

- **anime.js** v4 — MIT.

## Test fonts

Tests read a font from the host system and skip when none is found. No font
binaries are committed to this repository.

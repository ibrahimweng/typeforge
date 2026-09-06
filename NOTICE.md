# Third-party notices

## Toolcraft UI (`src/ui/`)

The interface components in `src/ui/` come from **Toolcraft** by Pixel Point
(https://toolcraft.sh), taken from the `@pixel-point/toolcraft` package. They
are used under the Toolcraft Designer License, which permits personal,
internal, educational and designer client work.

**What is left of it: one slider, 47 files, about 5,500 lines.**

It was 191 files and 23,635 lines, and the application imported three things
out of all of that: a `cn` helper, one slider, and a stylesheet. The other 144
files were unreachable — no import anywhere led to them — so they are gone.
Deleting them also took the compiled stylesheet from 334 KB to 200 KB, because
Tailwind had been generating utilities for components nobody could open.

`cn` came over to `src/cn.ts`, which is six lines of `clsx` and `tailwind-merge`
written the way every project using Tailwind writes them. Both are ordinary MIT
packages this project already depends on. That one move accounted for forty of
the forty-six places the application touched this library.

So one component stands between this repository and being MIT throughout. It is
built on `@base-ui/react/slider`, which is MIT and already a direct dependency,
so replacing it is possible rather than theoretical. It is a design decision
rather than a cleanup: sliders are the primary control in a tool for drawing
type, and how they feel is the product.

`src/licensed.test.ts` holds the numbers above and fails if they grow.

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

## The bundled sample font

`src/assets/typeforge-sample.ttf` is a subset of **DejaVu Sans**, distributed
under the Bitstream Vera Fonts Copyright. That licence permits modification and
redistribution provided the result is renamed to a name containing neither
"Bitstream" nor "Vera", and provided the notice travels with it. The font is
renamed to *Typeforge Sample* and the notice is in `LICENSE-sample-font.txt`.

`scripts/build-sample-font.py` rebuilds the file from a DejaVu Sans on the host,
so what is committed is reproducible rather than a binary of unclear origin.

## Test fonts

Tests read a font from the host system and skip when none is found. The sample
above is the only font binary in this repository.

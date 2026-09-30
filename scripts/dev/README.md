# Dev tools

One-off instruments for looking at what a test cannot judge. No npm script, CI
job or test runs any of these; each was written to settle one question and is
kept so the question can be asked again. Run the TypeScript ones through Vite,
which resolves the `@/` imports:

```bash
npx vite-node scripts/dev/<name>.ts
```

Each file's header says what it takes (usually environment variables such as
`FONT`, `REF`, `OUT` or `SHEET_BASES`) and what it prints or writes. Where a
tool reads a reference font, point it only at a font you have the right to
derive from.

## Sheets to look at

| File | What it does |
| --- | --- |
| `sheet.ts` | Whatever glyphs it is given, across every base, as an SVG page. |
| `faces.ts` | A line of type from each base, so the base picker can be judged. |
| `forge-sheet.ts` | A drawn face under each of its parts and layers, one row a setting. |
| `compare-sheet.ts` | A reference font above a Draw face, same text and scale (`LORA` required). |
| `params-sheet.ts` | A font's letters under the family controls, one SVG per setting. |
| `params-zoom.ts` | A few letters large, reshaped outline filled and drawn outline traced over it. |
| `effects-sheet.ts` | A font under each effect, cut and cast setting, one row a setting. |
| `tools.ts` | The effects layer, one row per setting. |
| `cuts.ts` | The cut layer, one row per operation. |
| `motifs.ts` | The counter shapes, one row per shape. |
| `kit.ts` | The alphabet as the grid makes it, one cell per letter. |
| `fused.ts` | The letter as the pen laid it beside the letter as the file holds it. |
| `arches.ts` | Noordzij's three ways of making a letter, drawn from one skeleton. |
| `colour.ts` | A face at several pen weights, to choose its colour by eye. |
| `specimen.ts` | The joined faces set as words. |
| `writing.ts` | A joined face set as running text. |
| `pairs.ts` | The pairs a joined script gets wrong, set both ways. |
| `beside.ts` | The reference's letters beside ours at the same x-height. |
| `over.ts` | Our letter laid over the reference's, one cell per letter. |
| `scallop.ts` | The seam between two letters, drawn big. |
| `traceshot.ts` | The tracer's redraw over the source ink. |

## Measurements

| File | What it does |
| --- | --- |
| `tally.ts` | How many letters each face leaves standing, over all sixteen faces. |
| `ink.ts` | Every letter's ink and bounds at every weight, one line each, for diffing. |
| `merged-ink.ts` | The same after the strokes are fused. |
| `moved.ts` | How far the drawn weight moved, glyph by glyph, between two runs. |
| `drawnbytes.ts` | A fingerprint of every face's outlines at its drawn weight. |
| `bones.ts` | Whether a letter's spine has the same pieces at every weight. |
| `standing.ts` | Which letters cannot follow the weight axis, and where they come apart. |
| `whole.ts` | Every script-face letter in one piece or not, across the weight axis. |
| `apart.ts` | How far each base stands from the plain Sans. |
| `likeness.ts` | Which of eight proportions a drawn face reached against a reference. |
| `slowest.ts` | Which letters cost the most to cast, and how much. |
| `drag-bench.mjs` | How long one slider drag blocks the page, in a real browser. |
| `bake.ts` | What a textured font costs, and whether it is still a valid font. |
| `weigh.ts` | Where a delivered font's bytes go, table by table. |
| `reach.ts` | Which palette entries their own descriptions cannot find. |

## Joined scripts against a reference

| File | What it does |
| --- | --- |
| `against.ts` | The joining faces against the references, one set of numbers per face. |
| `letter.ts` | The same comparison, letter by letter. |
| `bar.ts` | Whether a set word has a rule of join tails drawn through it. |
| `bends.ts` | The curve of each letter, ours against the reference's. |
| `enters.ts` | Where a join begins and ends, read off the letter. |
| `seam.ts` | The height the reference hands over at. |
| `ride.ts` | How far each letter rides above and below its two lines. |
| `scan.ts` | A letter's runs of ink across, at given heights. |
| `joins.ts` | Whether a joined face's letters actually reach each other. |
| `joinsub.ts` | Exports each script face and reads its contextual alternates back. |
| `joinsub.py` | The fontTools half of `joinsub.ts`: prints the GSUB rules in a file. |
| `shape.py` | The HarfBuzz half of `joinsub.ts`: shapes words and prints the glyphs. |

## The tracer

| File | What it does |
| --- | --- |
| `trace.ts` | How much of a drawn font the fitter gets back, letter by letter. |
| `where.ts` | Where a traced letter goes wrong: missed ink or invented ink. |
| `worst.ts` | Where a traced letter's worst point is, and which way it is wrong. |
| `tracetol.ts` | Nodes and error against the spine and sweep tolerances. |
| `hand.ts` | What pen a font was written with, read out of its letters. |
| `loop.ts` | An alphabet written with a known pen, swept, and read back. |
| `blend.ts` | Blending the pen against blending the outline, measured. |

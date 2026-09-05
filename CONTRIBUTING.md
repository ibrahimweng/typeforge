# Contributing

The README says what Typeforge is and how to run it. This is the part that is
easy to get wrong.

```bash
npm install
npm run dev
```

## Install the things the tests quietly need

`npm test` passes on a machine with none of these. It just checks less, and says
nothing about it — fifteen test files skip themselves rather than fail when
what they need is absent, which is the right behaviour for a suite that has to
run anywhere and a poor one for deciding a change is sound.

```bash
pip install fonttools brotli uharfbuzz
sudo apt-get install -y --no-install-recommends fonts-dejavu-core   # or any DejaVu Sans
```

**fontTools** is the reference implementation the export tests check against,
rather than against this project's own reader. **uharfbuzz** is what actually
lays out text with a font, and is how the joins and the ligatures are checked.
**A system font** is what the tests that read a real typeface read; `fixtures.ts`
lists the paths it looks in.

HarfBuzz was once missing from CI, so every test that shapes a word skipped
there and said nothing: the joins and the ligatures were only ever checked on
whichever machine happened to have it. Assume the same about your own until you
have installed all three.

## What CI will run

```bash
npm run lint         # Biome, formatting and lint together
npm run typecheck    # tsc -b --noEmit
npm test             # vitest, about four minutes
npm run build        # type checks again, then builds
npm run test:browser # Playwright, 243 tests, about twenty minutes
```

The browser suite is the slow one and it is worth running before a change to
anything a pointer touches. One file at a time is usually enough while you work:

```bash
npx playwright test e2e/writing.spec.ts
```

`npm run coverage` measures the unit suite. It is off by default because
instrumenting every file costs six times the run — four minutes becomes
twenty-six — and the budgets for the slow integration tests are multiplied when
it is on, which is what `longEnoughFor` in `test/fixtures.ts` is for.

Read what the checks print rather than assuming. A `biome check` put in a
backgrounded command and never read is how `main` came to sit red for an
afternoon.

## How the comments here work

Comments in this repository say **why**, and often name the bug that made the
code what it is. That is deliberate and it is the house style:

> A click with nothing being written starts a stroke rather than adding to the
> last one [...] With one flag for both, a stroke finished with Escape was still
> the open one, so the next click reached back and extended it — and two strokes
> of an `n` came out as a single zig-zag through the middle of the letter.

A comment restating the code is worse than none. A comment recording what went
wrong, what was measured, or which of two reasonable options was taken and what
it cost, is the most valuable thing in the file. Write those.

The same goes for a pull request: what changed is in the diff, so say why, and
say what you checked rather than that you checked.

## Two things to know before adding an import

**The first screen has a budget.** The drawing engine was pulled onto it by a
dozen small imports — a toolbar greying out a button, the project format asking
whether a drawing was worth saving. `vite.config.ts` carries the measurements
and the method. If you are adding an import to something that renders on the
first screen, check what it reaches before you do.

**`src/ui/` is not ours.** It comes from Toolcraft under a licence that does not
permit selling this application as a product; `NOTICE.md` has the terms. Do not
edit it, and do not turn on production sourcemaps, which would publish it.
Everything in `src/font/` is original work and depends on no framework.

## Tests

New behaviour wants a test, and the useful ones read as a sentence about what a
person would notice going wrong — `two strokes of an n come out as one line`
rather than `writePoint works`. Pin the promise, not the implementation.

If you are fixing a bug, write the test that fails first, and watch it fail. A
test written afterwards is written to match what the code does, which is not the
same as what it should do. One in `e2e/glyph.spec.ts` waited for the edited half
of a session to exist before reloading — true from the moment a font is open, so
it was satisfied before the edit it was about had happened. It passed either
way, until a change in timing made it fail for the first time and the wait
turned out to have been checking nothing.

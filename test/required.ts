/**
 * A requirement that means different things on different machines.
 *
 * fontTools, HarfBuzz and a system font are what proves this project writes
 * real fonts rather than files its own reader happens to like. None of them is
 * an npm dependency, so a checkout on a machine without them skips those tests
 * instead of failing -- which is right, and is the reason somebody can clone
 * this and get a green run.
 *
 * In CI it is the opposite. The workflow installs all three on purpose, so
 * their absence there is not a machine without them, it is the coverage
 * quietly disappearing while the run stays green. That has happened twice and
 * both are written down in this repository: HarfBuzz was missing from CI, so
 * every test that shapes a word skipped and said nothing, and the joins and
 * the ligatures were "only ever checked on a machine that happened to have
 * it"; and the WOFF fixtures were read from paths nothing created, so the web
 * font import path had no coverage at all.
 *
 * Neither was found by a failing test. Both were found by somebody eventually
 * noticing. So the same skip is a skip locally and a failure in CI.
 */

/*
 * GitHub Actions sets CI=true, as does every other runner worth naming. A
 * developer who sets it by hand gets the strict reading, which is a reasonable
 * thing to have asked for.
 */
const IN_CI = Boolean(process.env.CI);

/**
 * Whether a tool is here, and whether being without it is allowed.
 *
 * Returns false where the tests may skip, and throws where they may not.
 */
export function insist(present: boolean, tool: string, install: string): boolean {
  if (present) return true;
  if (!IN_CI) return false;
  throw new Error(
    [
      `${tool} is not installed, and this is CI.`,
      "",
      "Locally that is a skip. Here it means a block of tests is about to",
      "report nothing and leave the run green, which is how this coverage has",
      "gone missing before.",
      "",
      `Install it, or take the tests out on purpose:  ${install}`,
    ].join("\n"),
  );
}

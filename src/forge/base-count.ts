/**
 * How many styles Draw starts from, said as a word.
 *
 * The front door and the New menu both promise a number, and they said
 * "twenty" for as long as there were twenty-one. The list itself is in
 * `style.ts`, which is most of the drawing engine and is kept off the first
 * screen on purpose, so the count lives here on its own and a test holds it to
 * the length of that list: add a style and the test says which line to change.
 */
export const BASE_COUNT = 21;

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** A count under a hundred as it is written in a sentence. */
export function inWords(count: number): string {
  if (count < 20) return ONES[count];
  if (count >= 100) return String(count);
  const tens = TENS[Math.floor(count / 10)];
  return count % 10 === 0 ? tens : `${tens}-${ONES[count % 10]}`;
}

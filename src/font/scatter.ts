/**
 * A letter's own two random numbers.
 *
 * Both engines scatter a line of type -- the forge bounces and leans a drawn
 * face, the quill does the same to a traced one -- and this is the one thing
 * they should not disagree about: an `e` that bounced one way in a drawn face
 * and the other way in a traced one would look like a bug in whichever the
 * reader saw second. So it is imported by both rather than copied into either.
 *
 * It lives here rather than in `forge/script.ts`, where it was written,
 * because it is a hash function and not a piece of the forge -- and being in
 * there meant that a store the quill half needs on the first screen pulled in
 * eighteen hundred lines of brush script to hash a one-character name.
 */

/**
 * Two numbers between minus a half and a half, from a letter's name.
 *
 * The seed the bounce and the lean are drawn from, and it has to actually
 * scatter or neither of them is a bounce. It did not.
 *
 * What was here was FNV-1a -- hash the bytes, take ten bits out of the middle
 * for one number and ten from higher up for the other. That is a sound hash for
 * a word and it falls apart completely on a name one character long, because a
 * single round of multiply-and-xor does not diffuse: with only the low seven
 * bits of the input varying, the ten bits pulled out of the product vary almost
 * linearly with the character code. Printed for `a` through `z` the results
 * came out in alphabetical order, which is the giveaway -- a hash whose output
 * you can sort is not a hash.
 *
 * The cost was the whole control. Across the twenty-six lowercase letters the
 * bounce seed spanned five hundredths of its range instead of all of it, and
 * every value was negative. So the unsteadiness never made a letter sit high
 * against its neighbour sitting low; it moved the entire lowercase down by very
 * nearly one amount. Turned up, the alphabet sank together and the *spread* --
 * which is the only part anybody sees -- barely moved. It looked exactly like a
 * control at the end of its range, and it was a control that had never been
 * connected to what it was named after.
 *
 * The fix is the standard avalanche finaliser, three shift-xor-multiply rounds,
 * which is what FNV-1a wants after it for short keys. Every input bit now
 * reaches every output bit. The seeds span their range, they are as often
 * positive as negative, and sorting them gives back nothing.
 *
 * Still worked out from the letter's own name, and still the same numbers on
 * every machine and every run: this is asked once per letter and has to be
 * boring rather than uniform. A letter that came out somewhere different each
 * time it was drawn could not be cached, compared with itself, or exported.
 */
export function scatterOf(name: string): { first: number; second: number } {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // The avalanche. Without these three rounds the bits below are the input
  // rearranged rather than mixed.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return {
    first: ((hash >>> 8) & 1023) / 1023 - 0.5,
    second: ((hash >>> 20) & 1023) / 1023 - 0.5,
  };
}

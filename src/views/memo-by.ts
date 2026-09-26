/**
 * One answer per distinct key, worked out the first time it is asked for.
 *
 * For the proof, which draws a paragraph by resolving each letter's outline
 * into a path -- components flattened, then a `Path2D` built -- and did that
 * once for every character placed on every redraw. A paragraph of body text is
 * a few hundred characters made of perhaps thirty letters, so nearly all of
 * that work was the same work again, and a redraw happens on every tick of the
 * size and line-height dials. Asked through this, each letter is resolved
 * once, and the answer is kept for as long as the caller keeps the function.
 *
 * Keyed by identity through a `Map`, so an object key is the same key only if
 * it is the same object -- which is exactly the guarantee wanted of a glyph,
 * since an edited glyph is a new object.
 */
export function memoBy<K, V>(compute: (key: K) => V): (key: K) => V {
  const known = new Map<K, V>();
  return (key) => {
    if (known.has(key)) return known.get(key) as V;
    const value = compute(key);
    known.set(key, value);
    return value;
  };
}

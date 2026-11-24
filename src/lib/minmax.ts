/**
 * Math.min / Math.max over arrays of any length. Math.min(...big) overflows the
 * call stack around ~100k values; these loop instead. Same results as Math.min/max,
 * including Infinity / -Infinity for an empty array and NaN if any value is NaN.
 */
export function arrMin(xs: readonly number[]): number {
  let m = Infinity
  for (const x of xs) {
    if (x !== x) return NaN
    if (x < m) m = x
  }
  return m
}

export function arrMax(xs: readonly number[]): number {
  let m = -Infinity
  for (const x of xs) {
    if (x !== x) return NaN
    if (x > m) m = x
  }
  return m
}

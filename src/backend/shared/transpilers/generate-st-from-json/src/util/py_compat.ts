/**
 * Python-compatibility helpers.
 *
 * These functions exist to eliminate the few well-known places where JS and
 * Python disagree on string formatting, comparison, or container ordering.
 * Every numeric stringification in the transpiler core must route through
 * `pyRepr`; every "sort by tuple key" must route through `tupleCompare`.
 */

/**
 * Python's `repr(float)` / `str(float)` (they're the same for numeric types).
 *
 * Differences from `String(n)` this fixes:
 *   - `-0.0` (Python) vs `0` (JS)
 *   - `nan`, `inf`, `-inf` (Python) vs `NaN`, `Infinity`, `-Infinity` (JS)
 *   - `1.0` (Python) vs `1` (JS) for integer-valued floats
 *   - `1e-05` (Python, zero-padded exponent, switch threshold `exp < -4`)
 *     vs `1e-7` (JS, switch threshold `exp < -6`)
 *   - `1e+16` (Python, switch threshold `exp >= 16`) vs JS varying threshold
 *
 * `kind` lets the caller assert the Python type:
 *   - `'float'` (default): always emits a decimal or scientific representation
 *     with the float invariants above.
 *   - `'int'`: integer formatting (no trailing `.0`, no scientific notation).
 *     Callers are responsible for ensuring `n` is integer-valued.
 */
export function pyRepr(n: number, kind: 'int' | 'float' = 'float'): string {
  if (kind === 'int') {
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`pyRepr(${n}, 'int'): value is not an integer`)
    }
    return n.toString(10)
  }

  if (Number.isNaN(n)) return 'nan'
  if (n === Infinity) return 'inf'
  if (n === -Infinity) return '-inf'
  if (n === 0) return Object.is(n, -0) ? '-0.0' : '0.0'

  const expStr = n.toExponential()
  const eIdx = expStr.indexOf('e')
  const exp = parseInt(expStr.slice(eIdx + 1), 10)

  if (exp >= -4 && exp < 16) {
    let s = n.toString(10)
    if (s.includes('e') || s.includes('E')) {
      // JS dropped to scientific within Python's fixed range; expand.
      s = expandSci(n)
    }
    if (!s.includes('.')) s += '.0'
    return s
  }

  // Scientific notation, Python style: `<mantissa>e[+-]NN` (>= 2 exponent digits).
  // Python keeps the mantissa as-is (no padded `.0`); JS toExponential matches.
  const mantissa = expStr.slice(0, eIdx)
  const sign = exp < 0 ? '-' : '+'
  const expAbs = Math.abs(exp).toString().padStart(2, '0')
  return `${mantissa}e${sign}${expAbs}`
}

function expandSci(n: number): string {
  // Build the fixed-form string from the exponential form so we don't lose digits.
  const expStr = n.toExponential()
  const [mantissa, expPart] = expStr.split('e')
  const exp = parseInt(expPart, 10)
  const negative = mantissa.startsWith('-')
  const m = negative ? mantissa.slice(1) : mantissa
  const dot = m.indexOf('.')
  const digits = dot < 0 ? m : m.slice(0, dot) + m.slice(dot + 1)
  const intPartLen = (dot < 0 ? m.length : dot) + exp
  let out: string
  if (intPartLen <= 0) {
    out = '0.' + '0'.repeat(-intPartLen) + digits.replace(/0+$/, '')
  } else if (intPartLen >= digits.length) {
    out = digits + '0'.repeat(intPartLen - digits.length) + '.0'
  } else {
    const intP = digits.slice(0, intPartLen)
    const fracP = digits.slice(intPartLen).replace(/0+$/, '') || '0'
    out = `${intP}.${fracP}`
  }
  return negative ? `-${out}` : out
}

/**
 * Lexicographic comparison of two tuples, matching Python's tuple `<`.
 *
 * Use as a sort comparator anywhere Python does `sorted(items, key=lambda x: (a, b, c))`:
 *
 *     items.sort((x, y) => tupleCompare(keyOf(x), keyOf(y)))
 *
 * Supports nested tuples (arrays), numbers, strings, booleans, and null.
 * Mixed types at the same position throw, mirroring Python 3's `TypeError`.
 */
export function tupleCompare(a: readonly unknown[], b: readonly unknown[]): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const c = scalarCompare(a[i], b[i])
    if (c !== 0) return c
  }
  return a.length - b.length
}

function scalarCompare(av: unknown, bv: unknown): number {
  if (av === bv) return 0
  if (av === null && bv === null) return 0
  if (av === null) return -1
  if (bv === null) return 1
  if (typeof av === 'boolean' && typeof bv === 'boolean') {
    return (av ? 1 : 0) - (bv ? 1 : 0)
  }
  if (typeof av === 'number' && typeof bv === 'number') {
    if (Number.isNaN(av) || Number.isNaN(bv)) {
      throw new Error('tupleCompare: NaN is not orderable')
    }
    return av < bv ? -1 : 1
  }
  if (typeof av === 'string' && typeof bv === 'string') {
    return av < bv ? -1 : 1
  }
  if (Array.isArray(av) && Array.isArray(bv)) {
    return tupleCompare(av, bv)
  }
  throw new Error(
    `tupleCompare: cannot compare ${typeof av} with ${typeof bv} (Python would raise TypeError)`,
  )
}

/**
 * Insertion-ordered map. Mirrors Python `dict` / `OrderedDict` semantics.
 *
 * Wraps `Map` to give a stable `entries()` / `keys()` / `values()` iteration
 * order matching insertion, with key equality via `===` (so integer-like
 * string keys don't collide the way they do in plain `Object`).
 *
 * Prefer this type over `Record<string, T>` in any code that the transpiler
 * iterates and stringifies — `Object.keys()` reorders integer-like keys
 * numerically, which is the kind of silent divergence we cannot afford.
 */
export type OrderedMap<K, V> = Map<K, V>

export function orderedMap<K, V>(entries: Iterable<readonly [K, V]> = []): OrderedMap<K, V> {
  return new Map(entries)
}

/**
 * Merge entries into an OrderedMap, preserving Python `dict.update` semantics:
 * existing keys retain their original insertion order; new keys are appended.
 */
export function omUpdate<K, V>(target: OrderedMap<K, V>, source: Iterable<readonly [K, V]>): void {
  for (const [k, v] of source) {
    target.set(k, v)
  }
}

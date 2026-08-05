/**
 * IEC 61131-3 duration literal parser — the inverse of `formatTimeValue`
 * in `variable-sizes.ts`.
 *
 * strucpp stores TIME as int64 nanoseconds, so forcing a TIME variable
 * means turning the user's `T#10s` / `1h30m` text into a nanosecond
 * count. The watch panel renders durations without the `T#` prefix
 * (`3s800ms`), so prefix-less input is accepted too — whatever the panel
 * displays can be typed straight back in.
 */

const NS_PER_UNIT: Record<string, bigint> = {
  d: 86_400_000_000_000n,
  h: 3_600_000_000_000n,
  m: 60_000_000_000n,
  s: 1_000_000_000n,
  ms: 1_000_000n,
  us: 1_000n,
  ns: 1n,
}

/** Largest unit first — also the order IEC requires in a literal. */
const UNIT_ORDER = ['d', 'h', 'm', 's', 'ms', 'us', 'ns']

const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n

/** Two-character units come first so `ms` never tokenises as `m` + `s`. */
const COMPONENT = /^(\d[\d_]*(?:\.\d[\d_]*)?)(ms|us|ns|d|h|m|s)/i

const HINT = 'Use IEC duration units, e.g. T#10s, 1h30m, 250ms, T#-1s500ms.'

/**
 * Parse an IEC duration literal into signed nanoseconds.
 *
 * Accepts `T#` / `TIME#` / `LT#` / `LTIME#` or no prefix at all, a sign
 * on either side of the prefix, `_` digit separators, unit chains
 * (`1h30m`), overflow units (`90s`), and a fraction on the smallest
 * unit (`1.5s`). Throws an Error with a user-facing message otherwise —
 * callers surface it as-is.
 */
export function parseDurationLiteral(input: string): bigint {
  let body = input.trim()
  let negative = false

  if (/^[+-]/.test(body)) {
    negative = body.startsWith('-')
    body = body.slice(1)
  }

  const prefix = /^(?:ltime|time|lt|t)#/i.exec(body)
  if (prefix) body = body.slice(prefix[0].length)

  // IEC writes the sign after the prefix (`T#-5s`); tolerate either side.
  if (/^[+-]/.test(body)) {
    if (body.startsWith('-')) negative = !negative
    body = body.slice(1)
  }

  let rest = body.replace(/\s+/g, '')
  if (rest === '') throw new Error(`Invalid TIME value: "${input}". ${HINT}`)

  let totalNs = 0n
  let smallestSeen = -1
  let sawFraction = false

  while (rest !== '') {
    const match = COMPONENT.exec(rest)
    if (!match) throw new Error(`Invalid TIME value: "${input}". ${HINT}`)

    const [component, digits, unitText] = match
    const unit = unitText.toLowerCase()
    const position = UNIT_ORDER.indexOf(unit)
    if (position <= smallestSeen) {
      throw new Error(`TIME units must appear once, largest first (d h m s ms us ns): "${input}"`)
    }
    if (sawFraction) {
      throw new Error(`Only the smallest unit of a TIME value may be fractional: "${input}"`)
    }

    const [whole, fraction] = digits.replace(/_/g, '').split('.')
    totalNs += BigInt(whole) * NS_PER_UNIT[unit]
    if (fraction !== undefined) {
      sawFraction = true
      // Round half away from zero on the magnitude; the sign lands below.
      const scale = 10n ** BigInt(fraction.length)
      totalNs += (BigInt(fraction) * NS_PER_UNIT[unit] * 2n + scale) / (scale * 2n)
    }

    smallestSeen = position
    rest = rest.slice(component.length)
  }

  const signed = negative ? -totalNs : totalNs
  if (signed < INT64_MIN || signed > INT64_MAX) throw new Error(`TIME value out of range: "${input}"`)
  return signed
}

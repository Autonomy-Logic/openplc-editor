import { parseDurationLiteral } from '../iec-duration'

const NS_PER_MS = 1_000_000n
const NS_PER_SEC = 1_000_000_000n
const NS_PER_MIN = 60n * NS_PER_SEC
const NS_PER_HOUR = 60n * NS_PER_MIN
const NS_PER_DAY = 24n * NS_PER_HOUR

describe('parseDurationLiteral', () => {
  it('parses a single component with every unit', () => {
    expect(parseDurationLiteral('2d')).toBe(2n * NS_PER_DAY)
    expect(parseDurationLiteral('3h')).toBe(3n * NS_PER_HOUR)
    expect(parseDurationLiteral('4m')).toBe(4n * NS_PER_MIN)
    expect(parseDurationLiteral('10s')).toBe(10n * NS_PER_SEC)
    expect(parseDurationLiteral('250ms')).toBe(250n * NS_PER_MS)
    expect(parseDurationLiteral('7us')).toBe(7_000n)
    expect(parseDurationLiteral('9ns')).toBe(9n)
  })

  it('accepts the T# / TIME# / LT# / LTIME# prefixes, case-insensitively', () => {
    expect(parseDurationLiteral('T#10s')).toBe(10n * NS_PER_SEC)
    expect(parseDurationLiteral('t#10s')).toBe(10n * NS_PER_SEC)
    expect(parseDurationLiteral('TIME#10S')).toBe(10n * NS_PER_SEC)
    expect(parseDurationLiteral('LT#10s')).toBe(10n * NS_PER_SEC)
    expect(parseDurationLiteral('ltime#10s')).toBe(10n * NS_PER_SEC)
  })

  it('sums a chain of descending units', () => {
    expect(parseDurationLiteral('1h30m')).toBe(NS_PER_HOUR + 30n * NS_PER_MIN)
    expect(parseDurationLiteral('T#1d2h3m4s5ms6us7ns')).toBe(
      NS_PER_DAY + 2n * NS_PER_HOUR + 3n * NS_PER_MIN + 4n * NS_PER_SEC + 5n * NS_PER_MS + 6_000n + 7n,
    )
  })

  it('round-trips what the watch panel renders', () => {
    // formatTimeValue emits prefix-less, at most two components.
    expect(parseDurationLiteral('3s800ms')).toBe(3n * NS_PER_SEC + 800n * NS_PER_MS)
    expect(parseDurationLiteral('2d3h')).toBe(2n * NS_PER_DAY + 3n * NS_PER_HOUR)
    expect(parseDurationLiteral('0s')).toBe(0n)
    expect(parseDurationLiteral('-5s')).toBe(-5n * NS_PER_SEC)
  })

  it('allows overflow units (90s is not clamped to a minute)', () => {
    expect(parseDurationLiteral('90s')).toBe(90n * NS_PER_SEC)
    expect(parseDurationLiteral('T#5000ms')).toBe(5n * NS_PER_SEC)
  })

  it('accepts a sign on either side of the prefix', () => {
    expect(parseDurationLiteral('T#-5s')).toBe(-5n * NS_PER_SEC)
    expect(parseDurationLiteral('-T#5s')).toBe(-5n * NS_PER_SEC)
    expect(parseDurationLiteral('+T#5s')).toBe(5n * NS_PER_SEC)
    expect(parseDurationLiteral('+5s')).toBe(5n * NS_PER_SEC)
    // Sign on both sides cancels out.
    expect(parseDurationLiteral('-T#-5s')).toBe(5n * NS_PER_SEC)
  })

  it('ignores underscore digit separators and internal whitespace', () => {
    expect(parseDurationLiteral('T#1_000ms')).toBe(NS_PER_SEC)
    expect(parseDurationLiteral('T#1d 2h')).toBe(NS_PER_DAY + 2n * NS_PER_HOUR)
  })

  it('accepts a fraction on the smallest unit', () => {
    expect(parseDurationLiteral('1.5s')).toBe(1_500n * NS_PER_MS)
    expect(parseDurationLiteral('T#1m0.25s')).toBe(NS_PER_MIN + 250n * NS_PER_MS)
    // Sub-nanosecond fractions round half away from zero.
    expect(parseDurationLiteral('0.0000000005s')).toBe(1n)
    expect(parseDurationLiteral('0.0000000004s')).toBe(0n)
    expect(parseDurationLiteral('-1.5s')).toBe(-1_500n * NS_PER_MS)
  })

  it('rejects an empty or unit-less value', () => {
    expect(() => parseDurationLiteral('')).toThrow(/Invalid TIME value/)
    expect(() => parseDurationLiteral('   ')).toThrow(/Invalid TIME value/)
    expect(() => parseDurationLiteral('T#')).toThrow(/Invalid TIME value/)
    expect(() => parseDurationLiteral('10')).toThrow(/Invalid TIME value/)
    expect(() => parseDurationLiteral('abc')).toThrow(/Invalid TIME value/)
  })

  it('rejects trailing junk after a valid component', () => {
    expect(() => parseDurationLiteral('10s!')).toThrow(/Invalid TIME value/)
    expect(() => parseDurationLiteral('10sec')).toThrow(/Invalid TIME value/)
  })

  it('rejects repeated or ascending units', () => {
    expect(() => parseDurationLiteral('1s1s')).toThrow(/largest first/)
    expect(() => parseDurationLiteral('30m1h')).toThrow(/largest first/)
    expect(() => parseDurationLiteral('500ms1s')).toThrow(/largest first/)
  })

  it('rejects a fraction on anything but the smallest unit', () => {
    expect(() => parseDurationLiteral('1.5h30m')).toThrow(/smallest unit/)
  })

  it('rejects values outside the int64 nanosecond range', () => {
    expect(() => parseDurationLiteral('106752d')).toThrow(/out of range/)
    expect(() => parseDurationLiteral('-106752d')).toThrow(/out of range/)
    // Just inside the range still parses.
    expect(parseDurationLiteral('106751d')).toBe(106751n * NS_PER_DAY)
  })
})

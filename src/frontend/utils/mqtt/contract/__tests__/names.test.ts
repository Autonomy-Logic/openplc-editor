import vectors from '../fixtures/names/name-vectors.json'
import {
  collisionKey,
  decodeSegment,
  defaultMetricName,
  defaultTopic,
  defaultTopicPrefix,
  encodeIndexSegment,
  encodeNameSegment,
  findDestinationConflicts,
  type PublishMode,
  type SourceToken,
  utf8Length,
  validateClientId,
  validateMetricName,
  validateNodeId,
  validateTopic,
} from '../names'

type VectorValue = string | { repeat: string; count: number }
type RawToken = { role: string; name?: string; indices?: number[] }

const valueOf = (raw: VectorValue): string => (typeof raw === 'string' ? raw : raw.repeat.repeat(raw.count))

const tokensOf = (raw: RawToken[]): SourceToken[] =>
  raw.map((t): SourceToken => {
    if (t.role === 'index') return { role: 'index', indices: t.indices ?? [] }
    if (t.role === 'instance' || t.role === 'program' || t.role === 'variable' || t.role === 'field') {
      return { role: t.role, name: t.name ?? '' }
    }
    throw new Error(`unknown role ${t.role}`)
  })

const modeOf = (raw: string): PublishMode => {
  if (raw === 'generic' || raw === 'sparkplug_b') return raw
  throw new Error(`unknown mode ${raw}`)
}

describe('MQTT destination name rules (shared vectors)', () => {
  it('reads the expected vector contract', () => {
    expect(vectors.contract).toBe('openplc-mqtt-name-vectors')
    expect(vectors.version).toBe(1)
  })

  it.each(vectors.nameSegments)('round-trips name segment $segment', ({ token, segment }) => {
    expect(encodeNameSegment(token)).toBe(segment)
    expect(decodeSegment(segment)).toEqual({ kind: 'name', name: token })
  })

  it.each(vectors.invalidNameTokens)('rejects name token with $error', ({ token, error }) => {
    expect(() => encodeNameSegment(token)).toThrow(error)
  })

  it.each(vectors.indexSegments)('round-trips index segment $segment', ({ indices, segment }) => {
    expect(encodeIndexSegment(indices)).toBe(segment)
    expect(decodeSegment(segment)).toEqual({ kind: 'index', indices })
  })

  it('rejects non-integer and empty indices', () => {
    expect(() => encodeIndexSegment([1.5])).toThrow('index_invalid')
    expect(() => encodeIndexSegment([])).toThrow('index_empty')
    expect(encodeIndexSegment([-0])).toBe('0')
  })

  it.each(vectors.invalidSegments)('rejects segment %j', (segment) => {
    expect(() => decodeSegment(segment)).toThrow('segment_invalid')
  })

  it.each(vectors.defaults)('builds default destinations $topic', ({ clientId, tokens, topic, metric }) => {
    const source = tokensOf(tokens)
    const built = defaultTopic(defaultTopicPrefix(clientId), source)
    expect(built).toBe(topic)
    expect(validateTopic(built)).toBeNull()
    expect(defaultMetricName(source)).toBe(metric)
    expect(validateMetricName(metric)).toBeNull()
    const decoded = built.split('/').slice(2).map(decodeSegment)
    expect(decoded).toEqual(
      source.map((t) => (t.role === 'index' ? { kind: 'index', indices: t.indices } : { kind: 'name', name: t.name })),
    )
  })

  it.each(vectors.invalidSources)('rejects source with $error', ({ tokens, error }) => {
    const source = tokensOf(tokens)
    expect(() => defaultTopic('p', source)).toThrow(error)
    expect(() => defaultMetricName(source)).toThrow(error)
  })

  const check = (
    validator: (value: string) => string | null,
    cases: Array<{ value: VectorValue; error: string | null }>,
  ) => {
    for (const c of cases) {
      expect([JSON.stringify(c.value), validator(valueOf(c.value))]).toEqual([JSON.stringify(c.value), c.error])
    }
  }

  it('validates topics', () => check(validateTopic, vectors.topics))
  it('validates metric names', () => check(validateMetricName, vectors.metrics))
  it('validates Sparkplug node identifiers', () => check(validateNodeId, vectors.nodeIds))
  it('validates client identifiers', () => check(validateClientId, vectors.clientIds))

  it.each(vectors.collisionKeys)('computes collision key $key', ({ value, key }) => {
    expect(collisionKey(value)).toBe(key)
  })

  it.each(vectors.conflicts)('finds $mode conflicts', ({ mode, destinations, conflicts }) => {
    expect(findDestinationConflicts(modeOf(mode), destinations)).toEqual(conflicts)
  })

  it('measures UTF-8 length by code point', () => {
    expect(utf8Length('aé€\u{1F600}')).toBe(1 + 2 + 3 + 4)
  })
})

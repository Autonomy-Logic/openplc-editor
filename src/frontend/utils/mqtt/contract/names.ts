// Mirror of the runtime's mqtt/contract/names.py; both are pinned by fixtures/names/name-vectors.json.

export const MAX_DESTINATION_BYTES = 512
export const MAX_NODE_ID_BYTES = 128
export const MAX_CLIENT_ID_CHARS = 64
export const TOPIC_PREFIX_ROOT = 'openplc'
export const RESERVED_METRIC_NAMES: readonly string[] = ['bdSeq']
export const RESERVED_METRIC_PREFIXES: readonly string[] = ['Node Control/']

export type TokenRole = 'instance' | 'program' | 'variable' | 'field' | 'index'

export interface NameToken {
  role: Exclude<TokenRole, 'index'>
  name: string
}

export interface IndexToken {
  role: 'index'
  indices: number[]
}

export type SourceToken = NameToken | IndexToken

export type DecodedSegment = { kind: 'name'; name: string } | { kind: 'index'; indices: number[] }

export interface DestinationConflict {
  code: 'topic_duplicate' | 'metric_collision'
  first: number
  second: number
}

export type PublishMode = 'generic' | 'sparkplug_b'

const SAFE_SEGMENT_CHAR = /^[A-Za-z0-9_]$/
const ASCII_DIGIT = /^[0-9]$/
const INDEX_SEGMENT = /^-?(0|[1-9][0-9]*)(,-?(0|[1-9][0-9]*))*$/
const PERCENT_TRIPLET = /^%[0-9A-F]{2}$/
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const OUTER_WHITESPACE = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
])

const isControl = (codePoint: number): boolean => codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)

const isSurrogate = (codePoint: number): boolean => codePoint >= 0xd800 && codePoint <= 0xdfff

/** Iterating a string by code point yields a lone surrogate as its own unit. */
const hasLoneSurrogate = (value: string): boolean => {
  for (const ch of value) {
    if (isSurrogate(ch.codePointAt(0) ?? 0)) return true
  }
  return false
}

const utf8Bytes = (ch: string): number[] => {
  const cp = ch.codePointAt(0) ?? 0
  if (cp < 0x80) return [cp]
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)]
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)]
}

export const utf8Length = (value: string): number => {
  let total = 0
  for (const ch of value) total += utf8Bytes(ch).length
  return total
}

const decodeUtf8 = (bytes: number[]): string | null => {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    let need = 0
    let cp = 0
    let min = 0
    if (b0 < 0x80) {
      cp = b0
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1
      cp = b0 & 0x1f
      min = 0x80
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2
      cp = b0 & 0x0f
      min = 0x800
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3
      cp = b0 & 0x07
      min = 0x10000
    } else {
      return null
    }
    if (i + need >= bytes.length && need > 0) return null
    for (let k = 1; k <= need; k++) {
      const b = bytes[i + k]
      if (b === undefined || (b & 0xc0) !== 0x80) return null
      cp = (cp << 6) | (b & 0x3f)
    }
    if (need > 0 && (cp < min || cp > 0x10ffff || isSurrogate(cp))) return null
    out += String.fromCodePoint(cp)
    i += need + 1
  }
  return out
}

/** Reversible, collision-free segment for an identifier token. */
export const encodeNameSegment = (name: string): string => {
  if (name === '') throw new Error('token_empty')
  if (hasLoneSurrogate(name)) throw new Error('token_invalid_unicode')
  let out = ''
  let first = true
  for (const ch of name) {
    if (SAFE_SEGMENT_CHAR.test(ch) && !(first && ASCII_DIGIT.test(ch))) {
      out += ch
    } else {
      out += utf8Bytes(ch)
        .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
        .join('')
    }
    first = false
  }
  return out
}

export const encodeIndexSegment = (indices: readonly number[]): string => {
  if (indices.length === 0) throw new Error('index_empty')
  if (!indices.every((i) => Number.isSafeInteger(i))) throw new Error('index_invalid')
  return indices.map((i) => String(i === 0 ? 0 : i)).join(',')
}

export const decodeSegment = (segment: string): DecodedSegment => {
  if (INDEX_SEGMENT.test(segment)) {
    const parts = segment.split(',')
    if (parts.includes('-0')) throw new Error('segment_invalid')
    return { kind: 'index', indices: parts.map((p) => Number.parseInt(p, 10)) }
  }
  const bytes: number[] = []
  let position = 0
  while (position < segment.length) {
    const ch = segment[position]
    if (ch === '%') {
      const triplet = segment.slice(position, position + 3)
      if (!PERCENT_TRIPLET.test(triplet)) throw new Error('segment_invalid')
      bytes.push(Number.parseInt(triplet.slice(1), 16))
      position += 3
    } else if (SAFE_SEGMENT_CHAR.test(ch)) {
      bytes.push(ch.charCodeAt(0))
      position += 1
    } else {
      throw new Error('segment_invalid')
    }
  }
  const name = decodeUtf8(bytes)
  if (name === null || name === '' || encodeNameSegment(name) !== segment) throw new Error('segment_invalid')
  return { kind: 'name', name }
}

const segmentsOf = (tokens: readonly SourceToken[]): string[] => {
  if (tokens.length === 0 || tokens[0].role === 'index') throw new Error('source_invalid')
  return tokens.map((t) => (t.role === 'index' ? encodeIndexSegment(t.indices) : encodeNameSegment(t.name)))
}

export const defaultTopicPrefix = (clientId: string): string => `${TOPIC_PREFIX_ROOT}/${clientId}`

export const defaultTopic = (prefix: string, tokens: readonly SourceToken[]): string =>
  [prefix, ...segmentsOf(tokens)].join('/')

export const defaultMetricName = (tokens: readonly SourceToken[]): string => {
  const segments = segmentsOf(tokens)
  let out = ''
  tokens.forEach((token, i) => {
    out += token.role === 'index' ? `[${segments[i]}]` : `${out === '' ? '' : '.'}${segments[i]}`
  })
  return out
}

/** Key under which two metric names are considered the same name. */
export const collisionKey = (name: string): string => name.normalize('NFKC').toUpperCase().normalize('NFKC')

const anyCodePoint = (value: string, predicate: (cp: number, ch: string) => boolean): boolean => {
  for (const ch of value) {
    if (predicate(ch.codePointAt(0) ?? 0, ch)) return true
  }
  return false
}

export const validateTopic = (topic: string): string | null => {
  if (topic === '') return 'topic_empty'
  if (hasLoneSurrogate(topic)) return 'topic_invalid_unicode'
  if (utf8Length(topic) > MAX_DESTINATION_BYTES) return 'topic_too_long'
  if (anyCodePoint(topic, (cp, ch) => ch === '+' || ch === '#' || isControl(cp))) return 'topic_invalid_char'
  if (topic.startsWith('$')) return 'topic_reserved_prefix'
  if (topic.split('/').some((segment) => segment === '')) return 'topic_empty_segment'
  return null
}

export const validateMetricName = (name: string): string | null => {
  if (name === '') return 'metric_empty'
  if (hasLoneSurrogate(name)) return 'metric_invalid_unicode'
  if (utf8Length(name) > MAX_DESTINATION_BYTES) return 'metric_too_long'
  if (anyCodePoint(name, (cp) => isControl(cp))) return 'metric_invalid_char'
  const key = collisionKey(name)
  if (RESERVED_METRIC_NAMES.some((reserved) => key === collisionKey(reserved))) return 'metric_reserved'
  if (RESERVED_METRIC_PREFIXES.some((prefix) => key.startsWith(collisionKey(prefix)))) return 'metric_reserved'
  return null
}

/** Sparkplug Group ID / Edge Node ID. */
export const validateNodeId = (value: string): string | null => {
  if (value === '') return 'node_id_empty'
  if (hasLoneSurrogate(value)) return 'node_id_invalid_unicode'
  if (utf8Length(value) > MAX_NODE_ID_BYTES) return 'node_id_too_long'
  if (anyCodePoint(value, (cp, ch) => ch === '/' || ch === '+' || ch === '#' || isControl(cp))) {
    return 'node_id_invalid_char'
  }
  const codePoints = Array.from(value, (ch) => ch.codePointAt(0) ?? 0)
  if (OUTER_WHITESPACE.has(codePoints[0]) || OUTER_WHITESPACE.has(codePoints[codePoints.length - 1])) {
    return 'node_id_outer_whitespace'
  }
  return null
}

export const validateClientId = (value: string): string | null =>
  CLIENT_ID.test(value) && value.length <= MAX_CLIENT_ID_CHARS ? null : 'client_id_invalid'

export const findDestinationConflicts = (mode: PublishMode, destinations: readonly string[]): DestinationConflict[] => {
  const seen = new Map<string, number>()
  const conflicts: DestinationConflict[] = []
  const code = mode === 'generic' ? 'topic_duplicate' : 'metric_collision'
  destinations.forEach((destination, position) => {
    const key = mode === 'generic' ? destination : collisionKey(destination)
    const first = seen.get(key)
    if (first === undefined) seen.set(key, position)
    else conflicts.push({ code, first, second: position })
  })
  return conflicts
}

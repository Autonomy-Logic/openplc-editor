// Small defensive helpers for navigating fast-xml-parser's untyped output.
// The parser config (parse-xml-document.ts) forces known repeating elements
// into arrays, but leaf/absent values still arrive as `unknown` — e.g. an
// empty element (`<dataTypes/>`) parses to `''`, not `{}` or `undefined`.

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function asArray<T = unknown>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

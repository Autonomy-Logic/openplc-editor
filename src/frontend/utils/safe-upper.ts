/**
 * Case-insensitive identifier helpers.
 *
 * IEC 61131-3 treats variable / FB / function / type names as
 * case-insensitive — the editor canonicalises to uppercase as the
 * comparison key (matches what strucpp does internally).  The
 * helpers in this module wrap `.toUpperCase()` with a runtime guard
 * so the editor doesn't crash when a render-path stumbles on a
 * malformed entry (missing name, legacy / partially-loaded project
 * data, etc.).
 *
 * Why a helper rather than 100+ inline `?.toUpperCase() ?? ''` patches:
 *
 *   - One audit point.  The list of "places that uppercase
 *     identifier-shaped strings" grows organically; centralising
 *     the safety check stops every new call site from re-introducing
 *     the same `Cannot read properties of undefined (reading
 *     'toUpperCase')` regression.
 *
 *   - One predictable behaviour.  Empty input yields an empty
 *     string, which falls out of every `.filter()` / `.includes()`
 *     comparison naturally — no need for ad-hoc null checks at each
 *     consumer.
 */

/**
 * Uppercase a value if it's a non-empty string, otherwise return ''.
 * The empty-string fallback is benign for the typical filter /
 * includes use cases: `''.toUpperCase().includes(needle)` is false
 * unless `needle` is also empty, in which case every row matches —
 * which is the desired "show all" behaviour while the user hasn't
 * typed a filter yet.
 */
export function safeUpper(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase() : ''
}

/**
 * Type-narrowing predicate: keeps only entries whose `name` is a
 * non-empty string.  Use with `.filter()` before mapping `name` →
 * `name.toUpperCase()` so the deref is always safe.
 */
export function hasStringName<T extends { name?: unknown }>(
  entry: T,
): entry is T & { name: string } {
  return typeof entry.name === 'string' && entry.name.length > 0
}

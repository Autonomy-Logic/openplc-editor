/**
 * Merge an author's overrides onto a default object.
 *
 * Objects merge key by key; arrays and every scalar replace. An array is a
 * whole list in every protocol config that has one — data blocks, users,
 * address-space nodes, I/O groups — so merging them element-wise would make
 * "remove the second data block" impossible to express.
 *
 * `undefined` never overwrites: a spec that omits a key keeps the default,
 * which is what lets `describe` redact a secret and `apply` preserve it.
 * `null` DOES overwrite, because several config fields are nullable and
 * clearing them has to be expressible.
 */
export function mergeOverrides<T>(base: T, overrides: unknown): T {
  if (overrides === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides as T

  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue
    merged[key] = key in merged ? mergeOverrides(merged[key], value) : value
  }
  return merged as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

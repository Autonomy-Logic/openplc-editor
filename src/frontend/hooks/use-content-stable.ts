import { useRef } from 'react'

export const mapsEqual = <K, V>(a: Map<K, V>, b: Map<K, V>): boolean => {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    if (!b.has(key) || b.get(key) !== value) return false
  }
  return true
}

/**
 * Returns the previous instance while `isEqual` says the content is
 * unchanged, so downstream memos keyed on the value skip recomputation when
 * a producer replaces it with an equivalent one (e.g. debug-poll Maps that
 * didn't touch this consumer's entries).
 */
export function useContentStable<T>(value: T, isEqual: (previous: T, next: T) => boolean): T {
  const ref = useRef(value)
  if (ref.current !== value && !isEqual(ref.current, value)) {
    ref.current = value
  }
  return ref.current
}

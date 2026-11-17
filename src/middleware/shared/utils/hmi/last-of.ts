/** The last item of `items`, or undefined when it is empty. */
export function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined
}

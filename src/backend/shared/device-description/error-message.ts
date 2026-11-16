/** The message of a thrown value, or `fallback` when it has none. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  return String(err) || fallback
}

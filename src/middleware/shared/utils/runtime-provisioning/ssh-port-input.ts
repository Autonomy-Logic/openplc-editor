const DECIMAL_DIGITS = /^[0-9]+$/
const MIN_PORT = 1
const MAX_PORT = 65535

export function parseSshPortInput(text: string): { ok: true; port: number } | { ok: false } {
  const trimmed = text.trim()
  if (!DECIMAL_DIGITS.test(trimmed)) return { ok: false }
  const port = Number(trimmed)
  if (port < MIN_PORT || port > MAX_PORT) return { ok: false }
  return { ok: true, port }
}

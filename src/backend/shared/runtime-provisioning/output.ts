export const LINE_CHAR_LIMIT = 4096

export const DIALOG_LINE_LIMIT = 200

export const CONSOLE_LINE_LIMIT = 10_000

export const POLL_READ_BYTES = 65_536

export const LINE_TRUNCATION_MARKER = ' [line truncated]'

export const OUTPUT_TRUNCATED_LINE = '[output truncated]'

export const PASSWORD_MASK = '********'

export function scrubPassword(text: string, password: string): string {
  if (password === '' || !text.includes(password)) return text
  const masked = text.split(password).join(PASSWORD_MASK)
  if (!masked.includes(password)) return masked
  let removed = text
  while (removed.includes(password)) removed = removed.split(password).join('')
  return removed
}

function truncateLine(line: string): string {
  return line.length > LINE_CHAR_LIMIT ? `${line.slice(0, LINE_CHAR_LIMIT)}${LINE_TRUNCATION_MARKER}` : line
}

export function createLinePipeline(password: string): {
  push(chunk: string, options: { startsMidLine: boolean }): string[]
  end(): string[]
} {
  const holdLimit = LINE_CHAR_LIMIT + password.length
  let held = ''
  let discarding = false
  const finish = (line: string): string =>
    truncateLine(scrubPassword(line.endsWith('\r') ? line.slice(0, -1) : line, password))
  const capHeld = (): string[] => {
    if (held.length <= holdLimit) return []
    const scrubbed = scrubPassword(held, password)
    const kept = scrubbed.slice(0, Math.max(scrubbed.length - Math.max(password.length - 1, 0), 0))
    held = ''
    discarding = true
    return [`${kept.slice(0, LINE_CHAR_LIMIT)}${LINE_TRUNCATION_MARKER}`]
  }
  return {
    push(chunk, { startsMidLine }) {
      if (startsMidLine) {
        held = ''
        discarding = true
      }
      const firstNewline = chunk.indexOf('\n')
      if (firstNewline < 0) {
        if (discarding) return []
        held += chunk
        return capHeld()
      }
      const parts = chunk.split('\n')
      const first = discarding ? [] : [held + parts[0]]
      discarding = false
      held = parts[parts.length - 1]
      return [...[...first, ...parts.slice(1, -1)].map(finish), ...capHeld()]
    },
    end() {
      const last = discarding || held === '' ? [] : [finish(held)]
      held = ''
      discarding = false
      return last
    },
  }
}

export function createConsoleBound(): { accept(line: string): string[] } {
  let accepted = 0
  let truncationReported = false
  return {
    accept(line) {
      if (accepted < CONSOLE_LINE_LIMIT) {
        accepted += 1
        return [line]
      }
      if (truncationReported) return []
      truncationReported = true
      return [OUTPUT_TRUNCATED_LINE]
    },
  }
}

export function createDialogTail(): { push(line: string): void; lines(): string[]; latest(): string | null } {
  const kept: string[] = []
  return {
    push(line) {
      kept.push(line)
      if (kept.length > DIALOG_LINE_LIMIT) kept.shift()
    },
    lines() {
      return [...kept]
    },
    latest() {
      return kept.length > 0 ? kept[kept.length - 1] : null
    },
  }
}

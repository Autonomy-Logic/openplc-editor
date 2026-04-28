/**
 * Sanitize a user-typed branch name into a value that satisfies our git
 * branch validation rules (mirrored from the backend's `validateBranchName`).
 * Mirrors the spirit of VS Code's behavior: rather than rejecting a typo,
 * show the user what their input *will become* so they can adjust live.
 *
 * Rules applied (in order):
 *   1. Strip combining diacritics (`café` → `cafe`).
 *   2. Strip remaining non-ASCII (kanji, emojis, etc.) — git allows them in
 *      principle but they break too many downstream tools, and the backend
 *      now rejects them.
 *   3. Replace whitespace and the forbidden chars (`~^:?*[]\`) with `-`.
 *   4. Collapse `..` and `@{` sequences.
 *   5. Collapse runs of `-` into a single `-`.
 *   6. Strip leading/trailing `.`, `/`, `-`.
 *   7. Strip trailing `.lock`.
 *   8. Strip ASCII control characters.
 *   9. Truncate to 255.
 */
export function sanitizeBranchName(input: string): string {
  if (!input) return ''

  let result = input

  // Decompose accented chars into base + combining marks, then drop the marks.
  // Non-ASCII characters that don't decompose into ASCII (e.g. kanji) survive
  // this step and are stripped by the next.
  result = result.normalize('NFD').replace(/[̀-ͯ]/g, '')

  // Strip non-ASCII (anything outside printable ASCII range).
  result = result.replace(/[^\x20-\x7E]/g, '')

  // Whitespace and forbidden-anywhere characters → '-'.
  result = result.replace(/[\s~^:?*[\]\\]/g, '-')

  // Forbidden sequences.
  result = result.replace(/\.\.+/g, '-')
  result = result.replace(/@\{/g, '-')

  // Strip ASCII control chars (defensive — most are filtered above).
  result = result
    .split('')
    .filter((c) => {
      const code = c.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f
    })
    .join('')

  // Collapse runs of '-' to a single '-'.
  result = result.replace(/-+/g, '-')

  // Strip leading/trailing '.', '/', '-'.
  result = result.replace(/^[./-]+/, '').replace(/[./-]+$/, '')

  // Strip trailing '.lock' (case-insensitive).
  result = result.replace(/\.lock$/i, '')

  // Truncate.
  if (result.length > 255) result = result.slice(0, 255)

  return result
}

export type BranchNameFeedback = {
  sanitized: string
  /** True when the user-typed input had to be transformed by the sanitizer. */
  changed: boolean
  /**
   * User-facing notes about what was rewritten. Each note is a short, neutral
   * sentence — combine in a list under the input.
   */
  notes: string[]
  /**
   * Hard error preventing submission (independent of `changed`):
   * empty after sanitization, or stripped to nothing.
   */
  error: string | null
}

/**
 * Inspect the user input and return both the sanitized form and the list of
 * "changes" (e.g. "Spaces will be replaced with '-'"). The CreateBranchPopover
 * uses this to render a live preview without reaching the backend.
 */
export function getBranchNameFeedback(input: string): BranchNameFeedback {
  const sanitized = sanitizeBranchName(input)
  const changed = sanitized !== input
  const notes: string[] = []

  if (input.length > 0 && /\s/.test(input)) {
    notes.push("Spaces will be replaced with '-'.")
  }
  if (/[^\x20-\x7E]/.test(input.normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
    notes.push('Non-ASCII characters (e.g. kanji, emojis) will be removed.')
  }
  if (/[̀-ͯ]/.test(input.normalize('NFD'))) {
    notes.push('Accent marks will be stripped (e.g. "é" → "e").')
  }
  if (/[~^:?*[\]\\]/.test(input)) {
    notes.push("Characters ~ ^ : ? * [ ] \\ will be replaced with '-'.")
  }
  if (input.includes('..')) {
    notes.push("Sequences of '.' will be replaced with '-'.")
  }
  if (input.includes('@{')) {
    notes.push("'@{' is not allowed and will be replaced with '-'.")
  }
  if (/^[./-]/.test(input) || /[./-]$/.test(input)) {
    notes.push("Leading/trailing '.', '/' or '-' will be stripped.")
  }
  if (/\.lock$/i.test(input)) {
    notes.push("'.lock' suffix is reserved and will be stripped.")
  }
  if (input.length > 255) {
    notes.push('Names longer than 255 characters will be truncated.')
  }

  let error: string | null = null
  if (input.trim().length > 0 && sanitized.length === 0) {
    error = 'No valid characters left after sanitization.'
  }

  return { sanitized, changed, notes, error }
}

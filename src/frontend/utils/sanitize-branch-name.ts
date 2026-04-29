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
 *
 * `sanitizeBranchName` returns just the cleaned string. `sanitizeBranchNameDetailed`
 * also returns the set of transforms that actually happened, which feeds the
 * live-preview notes in `getBranchNameFeedback` without re-running the regex
 * chain a second time.
 */

type TransformKind =
  | 'spaces-replaced'
  | 'non-ascii-stripped'
  | 'diacritics-stripped'
  | 'forbidden-chars-replaced'
  | 'dot-sequences-replaced'
  | 'at-brace-replaced'
  | 'leading-or-trailing-stripped'
  | 'lock-suffix-stripped'
  | 'truncated'

const TRANSFORM_NOTES: Record<TransformKind, string> = {
  'spaces-replaced': "Spaces will be replaced with '-'.",
  'non-ascii-stripped': 'Non-ASCII characters (e.g. kanji, emojis) will be removed.',
  'diacritics-stripped': 'Accent marks will be stripped (e.g. "é" → "e").',
  'forbidden-chars-replaced': "Characters ~ ^ : ? * [ ] \\ will be replaced with '-'.",
  'dot-sequences-replaced': "Sequences of '.' will be replaced with '-'.",
  'at-brace-replaced': "'@{' is not allowed and will be replaced with '-'.",
  'leading-or-trailing-stripped': "Leading/trailing '.', '/' or '-' will be stripped.",
  'lock-suffix-stripped': "'.lock' suffix is reserved and will be stripped.",
  truncated: 'Names longer than 255 characters will be truncated.',
}

// Fixed display order for notes in the live preview, independent of the
// internal transform order in the sanitizer. Keep in sync with the original
// `getBranchNameFeedback` ordering so existing screenshots/tests still match.
const NOTE_ORDER: readonly TransformKind[] = [
  'spaces-replaced',
  'non-ascii-stripped',
  'diacritics-stripped',
  'forbidden-chars-replaced',
  'dot-sequences-replaced',
  'at-brace-replaced',
  'leading-or-trailing-stripped',
  'lock-suffix-stripped',
  'truncated',
]

function sanitizeBranchNameDetailed(input: string): { result: string; transforms: Set<TransformKind> } {
  const transforms = new Set<TransformKind>()
  if (!input) return { result: '', transforms }

  // Decompose accented chars into base + combining marks.
  const decomposed = input.normalize('NFD')
  const withoutDiacritics = decomposed.replace(/[̀-ͯ]/g, '')
  if (withoutDiacritics !== decomposed) transforms.add('diacritics-stripped')

  // Strip non-ASCII (anything outside printable ASCII range).
  let result = withoutDiacritics.replace(/[^\x20-\x7E]/g, '')
  if (result !== withoutDiacritics) transforms.add('non-ascii-stripped')

  // Whitespace and forbidden-anywhere characters → '-'.
  // We split spaces from the other forbidden chars so the user gets a
  // targeted note ("spaces" vs "~ ^ : ? *…").
  const beforeSpaces = result
  result = result.replace(/\s+/g, '-')
  if (result !== beforeSpaces) transforms.add('spaces-replaced')

  const beforeForbidden = result
  result = result.replace(/[~^:?*[\]\\]/g, '-')
  if (result !== beforeForbidden) transforms.add('forbidden-chars-replaced')

  // Forbidden sequences.
  const beforeDots = result
  result = result.replace(/\.\.+/g, '-')
  if (result !== beforeDots) transforms.add('dot-sequences-replaced')

  const beforeAtBrace = result
  result = result.replace(/@\{/g, '-')
  if (result !== beforeAtBrace) transforms.add('at-brace-replaced')

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
  const beforeEdges = result
  result = result.replace(/^[./-]+/, '').replace(/[./-]+$/, '')
  if (result !== beforeEdges) transforms.add('leading-or-trailing-stripped')

  // Strip trailing '.lock' (case-insensitive).
  const beforeLock = result
  result = result.replace(/\.lock$/i, '')
  if (result !== beforeLock) transforms.add('lock-suffix-stripped')

  // Truncate.
  if (result.length > 255) {
    result = result.slice(0, 255)
    transforms.add('truncated')
  }

  return { result, transforms }
}

export function sanitizeBranchName(input: string): string {
  return sanitizeBranchNameDetailed(input).result
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
  const { result: sanitized, transforms } = sanitizeBranchNameDetailed(input)
  const notes: string[] = []
  for (const kind of NOTE_ORDER) {
    if (transforms.has(kind)) notes.push(TRANSFORM_NOTES[kind])
  }

  let error: string | null = null
  if (input.trim().length > 0 && sanitized.length === 0) {
    error = 'No valid characters left after sanitization.'
  }

  return { sanitized, changed: sanitized !== input, notes, error }
}

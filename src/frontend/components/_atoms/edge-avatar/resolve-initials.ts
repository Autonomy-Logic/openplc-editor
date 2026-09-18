/**
 * Up to two initials from the display name.
 *
 * `customInitials` wins when the account set them: a user who chose "AL" should
 * not see something else derived from a name they may have typed differently.
 *
 * Separate module so the avatar file exports only its component — Fast Refresh
 * stops working on files that mix components with other exports.
 */
export function resolveInitials(name: string, customInitials?: string | null): string {
  if (customInitials?.trim()) {
    return firstCodePoints(customInitials.trim(), 2).toUpperCase()
  }

  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)

  if (parts.length === 0) {
    return '?'
  }

  if (parts.length === 1) {
    return firstCodePoints(parts[0], 2).toUpperCase()
  }

  return `${firstCodePoints(parts[0], 1)}${firstCodePoints(parts[parts.length - 1], 1)}`.toUpperCase()
}

/**
 * The first `count` code points of a string.
 *
 * `slice(0, 2)` and `[0]` count UTF-16 code units, which cut through the middle of a
 * surrogate pair: a name starting with an emoji or any astral-plane character
 * rendered half a pair, which draws as a replacement glyph. `Array.from` iterates
 * code points, so such a character survives whole.
 *
 * Code points, not grapheme clusters — a flag or a ZWJ sequence is still more than
 * one of these, which is not worth an `Intl.Segmenter` for a two-character avatar.
 */
function firstCodePoints(value: string, count: number): string {
  return Array.from(value).slice(0, count).join('')
}

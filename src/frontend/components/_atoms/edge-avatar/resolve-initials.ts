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
    return customInitials.trim().slice(0, 2).toUpperCase()
  }

  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)

  if (parts.length === 0) {
    return '?'
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

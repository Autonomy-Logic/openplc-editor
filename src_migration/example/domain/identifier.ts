/** Why a name is not a valid identifier. Kept as data so outer layers decide how to word it. */
export type IdentifierViolation = 'empty' | 'invalid-format'

// IEC 61131-3: letter or underscore first, no consecutive or trailing underscores.
const IEC_IDENTIFIER = /^(?:[A-Za-z]|_[A-Za-z0-9])(?:_?[A-Za-z0-9])*$/

/** Pure check of the identifier syntax; returns `null` when the name is valid. */
export function checkIdentifier(name: string): IdentifierViolation | null {
  if (name.length === 0) return 'empty'
  return IEC_IDENTIFIER.test(name) ? null : 'invalid-format'
}

/** IEC identifiers are case-insensitive, so `Motor` and `MOTOR` name the same variable. */
export function sameIdentifier(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase()
}

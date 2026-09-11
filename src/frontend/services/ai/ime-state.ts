/**
 * Tracks whether an IME composition (e.g. CJK input) is currently active in any
 * Monaco editor. While composing, the inline-completion provider must not treat
 * intermediate composition characters as type-through divergence, and must not
 * fire new completion requests. Lives next to the provider and is wired from the
 * shared Monaco registration via that editor's composition events, so both builds
 * suppress type-through the same way.
 */
let composing = false

export function setImeComposing(value: boolean): void {
  composing = value
}

export function isImeComposing(): boolean {
  return composing
}

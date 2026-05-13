/**
 * VPP screen persistence-key resolution — the single source of truth
 * for which key under `vendorScreenData` a given screen section
 * stores its data through.
 *
 * Used by:
 *
 *   - The shipped layouts (form, io-table, module-slots) on the
 *     write side: `setVendorScreenData(getSectionPersistenceKey(sec), …)`.
 *   - The vendor-screen tab editor on the dirty-tracking side:
 *     `collectScreenPersistenceKeys(screenDef)` returns the set of
 *     keys this screen owns.
 *   - The save / revert handlers in `services/save-actions.ts`:
 *     same `collectScreenPersistenceKeys` call to know which slice
 *     of `vendorScreenData` to read-modify-write.
 *
 * Centralising the convention here keeps the contract enforceable
 * by code rather than copy-paste.  Schema-side: every `section` in
 * a valid VPP screen has an `id` (required) and optionally an
 * explicit `persistence` (closed-enum string) — this helper falls
 * back to `id` when `persistence` is missing, matching the
 * established editor convention.
 */

/**
 * Minimal shape of a section that participates in persistence.  Kept
 * intentionally narrow: only the fields the persistence-key
 * resolution actually reads.  The full section type
 * (`ScreenSection` in the renderer) is a superset.
 */
export interface PersistableSection {
  id?: unknown
  persistence?: unknown
}

/**
 * The single source of truth for "which key under
 * `vendorScreenData` does this section persist into?"
 *
 * Returns `null` when the section is malformed (no usable `id` or
 * `persistence`) — the schema requires `id`, but the runtime guard
 * keeps a broken VPP package from silently dropping writes.
 */
export function getSectionPersistenceKey(section: PersistableSection | null | undefined): string | null {
  if (!section || typeof section !== 'object') return null
  if (typeof section.persistence === 'string' && section.persistence.length > 0) return section.persistence
  if (typeof section.id === 'string' && section.id.length > 0) return section.id
  return null
}

/**
 * Resolve every `vendorScreenData` key a screen definition will
 * persist through.  This is the per-screen owned set the editor
 * uses for dirty tracking, surgical save, and revert.
 *
 * Walks `screenDefinition.sections[]` and pulls each section's
 * resolved persistence key.  Drops sections that have no usable
 * key.  Empty array when the screen has no `sections` or the
 * definition shape is unrecognised — callers fall through to a
 * no-op in that case.
 */
export function collectScreenPersistenceKeys(screenDefinition: unknown): string[] {
  if (!screenDefinition || typeof screenDefinition !== 'object') return []
  const sections = (screenDefinition as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return []
  const out: string[] = []
  for (const s of sections) {
    const key = getSectionPersistenceKey(s as PersistableSection | null)
    if (key !== null) out.push(key)
  }
  return out
}

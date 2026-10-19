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
  layout?: unknown
}

export const VENDOR_DOCUMENT_LAYOUT = 'vendor-document'
export const DATAPOINT_IO_TABLE_LAYOUT = 'datapoint-io-table'
export const DEVICE_SETUP_KEY = 'device-setup'
export const IO_MAPPING_KEY = 'io-mapping'
const DEFAULT_CONFIGURATOR_KEY = 'configurator'

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
  // Reads what a configurator section wrote, so its key is fixed.
  if (section.layout === DATAPOINT_IO_TABLE_LAYOUT) return IO_MAPPING_KEY
  if (typeof section.persistence === 'string' && section.persistence.length > 0) return section.persistence
  if (section.layout === VENDOR_DOCUMENT_LAYOUT) return DEFAULT_CONFIGURATOR_KEY
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
  const out: string[] = []
  const add = (key: string) => {
    if (!out.includes(key)) out.push(key)
  }
  for (const section of screenSections(screenDefinition)) {
    const key = getSectionPersistenceKey(section)
    if (key === null) continue
    add(key)
    // A configurator section writes the device setup and the I/O mapping derived from it in the same store write.
    if (section.layout === VENDOR_DOCUMENT_LAYOUT || section.layout === DATAPOINT_IO_TABLE_LAYOUT) {
      add(DEVICE_SETUP_KEY)
      add(IO_MAPPING_KEY)
    }
  }
  return out
}

/** Keys under `vendorScreenData` that hold an embedded configurator's opaque archive. */
export function collectConfiguratorKeys(screenDefinition: unknown): string[] {
  const out: string[] = []
  for (const section of screenSections(screenDefinition)) {
    if (section.layout !== VENDOR_DOCUMENT_LAYOUT) continue
    const key = getSectionPersistenceKey(section)
    if (key !== null && !out.includes(key)) out.push(key)
  }
  return out
}

function hasConfiguratorSection(screenDefinition: unknown): boolean {
  return screenSections(screenDefinition).some(
    (section) => section.layout === VENDOR_DOCUMENT_LAYOUT || section.layout === DATAPOINT_IO_TABLE_LAYOUT,
  )
}

/** Screens of a board that show the configurator or its I/O Mapping; they share their keys, so they save, revert and go unsaved together. */
export function configuratorScreenNames(screens: Record<string, unknown> | undefined): string[] {
  if (!screens) return []
  return Object.keys(screens).filter((name) => hasConfiguratorSection(screens[name]))
}

/** The screen itself, plus every configurator screen of the board when it is one. */
export function linkedScreenNames(screens: Record<string, unknown> | undefined, screenName: string): string[] {
  const linked = configuratorScreenNames(screens)
  return linked.includes(screenName) ? linked : [screenName]
}

/** `collectScreenPersistenceKeys` over the screen and the screens linked to it. */
export function collectLinkedScreenKeys(screens: Record<string, unknown> | undefined, screenName: string): string[] {
  const keys = linkedScreenNames(screens, screenName).flatMap((name) => collectScreenPersistenceKeys(screens?.[name]))
  return Array.from(new Set(keys))
}

/** `collectConfiguratorKeys` over the screen and the screens linked to it. */
export function collectLinkedConfiguratorKeys(
  screens: Record<string, unknown> | undefined,
  screenName: string,
): string[] {
  const keys = linkedScreenNames(screens, screenName).flatMap((name) => collectConfiguratorKeys(screens?.[name]))
  return Array.from(new Set(keys))
}

function screenSections(screenDefinition: unknown): PersistableSection[] {
  if (!screenDefinition || typeof screenDefinition !== 'object' || !('sections' in screenDefinition)) return []
  const { sections } = screenDefinition
  if (!Array.isArray(sections)) return []
  return sections.filter((section): section is PersistableSection => !!section && typeof section === 'object')
}

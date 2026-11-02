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
  source?: unknown
  // Opt-in override for the vpp-extensions screen id. Multiple sections in the
  // same screen may share the same `storageId` to persist into one bucket
  // (e.g. a Connection form + a Variables table that both back one Data Hub
  // payload). Ignored unless `persistence === "vpp-extensions"`.
  storageId?: unknown
}

export const VENDOR_DOCUMENT_LAYOUT = 'vendor-document'
export const IO_TABLE_LAYOUT = 'io-table'
/** `io-table` source that lists the station a configurator reported, read-only. */
export const DEVICE_SETUP_SOURCE = 'device-setup'
export const DEVICE_SETUP_KEY = 'device-setup'
export const IO_MAPPING_KEY = 'io-mapping'
export const MODULE_CONFIGURATION_KEY = 'module-configuration'
export const VPP_EXTENSIONS_PERSISTENCE = 'vpp-extensions'
const CONFIGURATOR_KEY = 'configurator'

export function isDeviceSetupIoTable(section: PersistableSection): boolean {
  return section.layout === IO_TABLE_LAYOUT && section.source === DEVICE_SETUP_SOURCE
}

export function isVppExtensionsSection(section: PersistableSection): boolean {
  return section.persistence === VPP_EXTENSIONS_PERSISTENCE
}

/**
 * The single source of truth for "which key under
 * `vendorScreenData` does this section persist into?"
 *
 * Returns `null` when the section is malformed (no usable `id` or
 * `persistence`) — the schema requires `id`, but the runtime guard
 * keeps a broken VPP package from silently dropping writes.
 *
 * `vpp-extensions` sections also return `null`: their data lives in
 * `project.data.vppExtensions[packageId][screenId]`, serialized in bulk
 * by `save-actions`, not under `vendorScreenData`. Call
 * `getSectionVppExtensionScreenId` to resolve their screen id instead.
 */
export function getSectionPersistenceKey(section: PersistableSection | null | undefined): string | null {
  if (!section || typeof section !== 'object') return null
  // The configurator and the table it drives use fixed keys: the build reads the archive from `configurator`.
  if (isDeviceSetupIoTable(section)) return IO_MAPPING_KEY
  // vpp-extensions sections are routed through the project store's vppExtensions API, not vendorScreenData.
  if (isVppExtensionsSection(section)) return null
  // An explicit `persistence` wins over the layout default, so a VPP can ship a `vendor-document`
  // screen that stores opaque VPP-extension data instead of a configurator archive.
  if (typeof section.persistence === 'string' && section.persistence.length > 0) return section.persistence
  if (section.layout === VENDOR_DOCUMENT_LAYOUT) return CONFIGURATOR_KEY
  if (typeof section.id === 'string' && section.id.length > 0) return section.id
  return null
}

/**
 * Screen id under `project.data.vppExtensions[packageId]` where this
 * section's data lives. Returns `null` for sections that do not use the
 * vpp-extensions persistence slice.
 *
 * `storageId` is an opt-in override: multiple sections in the same screen
 * declaring the same `storageId` share one vpp-extensions bucket, so a
 * Connection form and a Variables table can feed a single flat payload
 * the runtime emitter consumes. Default is `section.id`.
 */
export function getSectionVppExtensionScreenId(section: PersistableSection | null | undefined): string | null {
  if (!section || typeof section !== 'object') return null
  if (!isVppExtensionsSection(section)) return null
  if (typeof section.storageId === 'string' && section.storageId.length > 0) return section.storageId
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
    // A configurator section writes the device setup, its module slots and their I/O mapping in one store write.
    if (section.layout === VENDOR_DOCUMENT_LAYOUT || isDeviceSetupIoTable(section)) {
      if (isDeviceSetupIoTable(section)) add(CONFIGURATOR_KEY)
      add(DEVICE_SETUP_KEY)
      add(MODULE_CONFIGURATION_KEY)
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
    (section) => section.layout === VENDOR_DOCUMENT_LAYOUT || isDeviceSetupIoTable(section),
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

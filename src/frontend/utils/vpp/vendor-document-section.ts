import { getSectionPersistenceKey, type PersistableSection } from './persistence-keys'

/** Fields of a `vendor-document` screen section; the section comes from a vendor package and is untrusted. */
export interface VendorDocumentSectionInput extends PersistableSection {
  document?: unknown
  controllers?: unknown
  bundleVersion?: unknown
}

export interface VendorDocumentSection {
  /** Page inside the package that hosts the configurator. */
  documentPath: string
  bundleVersion: string
  /** Device board name → controller type id passed to `setController`. */
  controllers: Record<string, string>
  configuratorKey: string
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readControllers(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const controllers: Record<string, string> = {}
  for (const [board, controller] of Object.entries(value)) {
    if (typeof controller === 'string' && controller.length > 0) controllers[board] = controller
  }
  return Object.keys(controllers).length > 0 ? controllers : null
}

/** The section's fields, or `null` when any is missing or malformed. */
export function readVendorDocumentSection(section: VendorDocumentSectionInput): VendorDocumentSection | null {
  const documentPath = nonEmptyString(section.document)
  const bundleVersion = nonEmptyString(section.bundleVersion)
  const controllers = readControllers(section.controllers)
  const configuratorKey = getSectionPersistenceKey(section)
  if (!documentPath || !bundleVersion || !controllers || !configuratorKey) return null
  return { documentPath, bundleVersion, controllers, configuratorKey }
}

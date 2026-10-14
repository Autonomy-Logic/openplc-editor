/**
 * Desktop URL of a file inside an installed vendor package, served by the main
 * process under `vpp-doc://<packageId>/<path>`.
 *
 * The scheme is registered as `standard`, so Chromium lowercases the host: the
 * package id travels lowercased and the main process matches it without case.
 */

export const VENDOR_DOCUMENT_SCHEME = 'vpp-doc'

const PACKAGE_ID_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/

export function buildVendorDocumentUrl(packageId: string, relPath: string): string | null {
  if (!PACKAGE_ID_RE.test(packageId)) return null
  const segments = relPath.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) return null
  return `${VENDOR_DOCUMENT_SCHEME}://${packageId.toLowerCase()}/${segments.map(encodeURIComponent).join('/')}`
}

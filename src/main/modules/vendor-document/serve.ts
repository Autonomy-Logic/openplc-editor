/**
 * Handler for `vpp-doc://<packageId>/<path>`: serves files of an installed vendor
 * package to the sandboxed configurator iframe. The package is resolved only
 * through the registry and every file must stay inside that package's directory.
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { assertPathContained } from '../../../backend/editor/utils/path-containment'
import { VENDOR_DOCUMENT_SCHEME } from '../../../middleware/shared/vendor-document/document-url'

export const VENDOR_DOCUMENT_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; form-action 'none'"

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export interface RegisteredPackage {
  packageId: string
  path: string
}

export interface VendorDocumentHandlerDeps {
  listPackages(): RegisteredPackage[]
}

function parseUrl(value: string | undefined): URL | null {
  try {
    return value ? new URL(value) : null
  } catch {
    return null
  }
}

/** True when a frame showing a package document tries to navigate outside that package; CSP cannot block this. */
export function leavesVendorDocument(fromUrl: string | undefined, toUrl: string): boolean {
  const from = parseUrl(fromUrl)
  if (from?.protocol !== `${VENDOR_DOCUMENT_SCHEME}:`) return false
  const to = parseUrl(toUrl)
  return to?.protocol !== from.protocol || to.host !== from.host
}

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Content-Security-Policy': VENDOR_DOCUMENT_CSP } })
}

/** The host arrives lowercased; two registered ids that differ only by case are refused as ambiguous. */
function resolvePackageDir(packages: RegisteredPackage[], host: string): string | null {
  const matches = packages.filter((pkg) => pkg.packageId.toLowerCase() === host)
  return matches.length === 1 ? matches[0].path : null
}

function decodeRelPath(pathname: string): string | null {
  try {
    const segments = pathname
      .split('/')
      .filter((segment) => segment.length > 0)
      .map(decodeURIComponent)
    if (segments.length === 0 || segments.some((s) => s === '.' || s === '..' || /[\\/\0]/.test(s))) return null
    return segments.join('/')
  } catch {
    return null
  }
}

async function resolveContainedFile(packageDir: string, relPath: string): Promise<string | null> {
  try {
    const root = await realpath(packageDir)
    const file = await realpath(path.join(root, relPath))
    assertPathContained(root, file, 'vendor document path')
    if (file === root) return null
    return (await stat(file)).isFile() ? file : null
  } catch {
    return null
  }
}

export function createVendorDocumentHandler(deps: VendorDocumentHandlerDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET')
      return new Response(null, { status: 405, headers: { 'Content-Security-Policy': VENDOR_DOCUMENT_CSP } })

    const url = new URL(request.url)
    // The vendor bundle probes its dev server here; a 404 keeps it from reloading.
    if (url.pathname === '/esbuild') return notFound()

    const packageDir = resolvePackageDir(deps.listPackages(), url.hostname.toLowerCase())
    const relPath = decodeRelPath(url.pathname)
    if (packageDir === null || relPath === null) return notFound()

    const file = await resolveContainedFile(packageDir, relPath)
    if (file === null) return notFound()

    let body: Uint8Array
    try {
      body = new Uint8Array(await readFile(file))
    } catch {
      return notFound()
    }
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': VENDOR_DOCUMENT_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    })
  }
}

/**
 * Buy-license deep link (D68a) — carries the device INTO the Edge purchase page.
 *
 * The page is `/buy` on the Edge **web app** (not the API host), and it needs
 * both ids up front: it validates `deviceId` against `/^[0-9a-fA-F]{32}$/` and
 * resolves the VPP through `GET vpp-catalog/v1/vpps/:vppId`. That `vppId` is the
 * **reverse-domain package id** (`package.id`, e.g.
 * `com.openplc.raspberry-pi-licensed`) — NOT a database id — which is exactly
 * what the editor already holds as `boardInfo.vpp.packageId`, so no lookup is
 * needed to build the link.
 *
 * A link missing either id lands the buyer on "Invalid purchase link" with no
 * way forward, so an incomplete input resolves to `null` here and the caller
 * says something useful instead of opening a dead end.
 */

export interface LicenseBuyLinkInput {
  /** Absolute base URL of the Edge web app, or a same-origin prefix on web. */
  baseUrl: string
  /** Reverse-domain package id of the licensable VPP (`package.id`). */
  vppId: string | undefined
  /** The derived licensing identity (32 hex chars), NOT the hardware anchor. */
  deviceId: string | undefined
}

/** Mirrors the `/buy` page's own guard — reject before navigating, not after. */
const DEVICE_ID_RE = /^[0-9a-f]{32}$/i

function withoutTrailingSlash(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * Build the `/buy?vppId=…&deviceId=…` URL, or `null` when the ids can't produce
 * a link the purchase page will accept.
 */
export function buildLicenseBuyUrl({ baseUrl, vppId, deviceId }: LicenseBuyLinkInput): string | null {
  const vpp = vppId?.trim()
  const device = deviceId?.trim()
  if (!vpp || !device || !DEVICE_ID_RE.test(device)) return null

  const query = new URLSearchParams({ vppId: vpp, deviceId: device }).toString()
  const path = `${withoutTrailingSlash(baseUrl)}/buy`

  try {
    // Single-argument form on purpose: it preserves a base path, so an Edge app
    // hosted under a sub-path still gets `/prefix/buy` instead of `/buy`.
    const url = new URL(path)
    url.search = query
    return url.toString()
  } catch {
    // Not absolute — the web build can be configured with a same-origin prefix
    // (`VITE_EDGE_FRONTEND_URL=/`). A root-relative link is correct there; the
    // editor never reaches this branch (its adapter always yields an origin).
    return `${path}?${query}`
  }
}

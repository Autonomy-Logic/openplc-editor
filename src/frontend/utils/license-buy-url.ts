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
  /**
   * Raw Ed25519 public key (64 hex chars) of the device's proof-of-possession
   * keypair (ADR-0002), derived in main from the hardware anchor.
   *
   * The purchase is the ONLY moment that binds a key to a device — an endpoint
   * that let anyone register one would hand the device to whoever learns its id
   * first — so this link is how the key gets there. Once bound, `/activate` and
   * `/recover` require a signature, and knowing the (public, copyable)
   * `deviceId` stops being enough to collect a license.
   *
   * Optional, and a missing key does NOT block the purchase: the buy flow shipped
   * before the proof did, and refusing to sell to an older editor would trade a
   * paying customer for a property they cannot supply.
   */
  devicePublicKey?: string | undefined
}

/** Mirrors the `/buy` page's own guard — reject before navigating, not after. */
const DEVICE_ID_RE = /^[0-9a-f]{32}$/i
/** Raw Ed25519 public key: 32 bytes. Mirrors the page + DTO guard. */
const DEVICE_PUBLIC_KEY_RE = /^[0-9a-f]{64}$/i

function withoutTrailingSlash(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * Build the `/buy?vppId=…&deviceId=…` URL, or `null` when the ids can't produce
 * a link the purchase page will accept.
 */
export function buildLicenseBuyUrl({ baseUrl, vppId, deviceId, devicePublicKey }: LicenseBuyLinkInput): string | null {
  const vpp = vppId?.trim()
  const device = deviceId?.trim()
  if (!vpp || !device || !DEVICE_ID_RE.test(device)) return null

  // A malformed key is DROPPED rather than turned into a null link. The two ids
  // are what the page cannot work without; the key is an add-on, and killing a
  // purchase over it would cost the sale to gain nothing — the page would refuse
  // the same value anyway. The device is then licensed unbound, which the backend
  // logs on every activation, so this does not disappear quietly.
  const key = devicePublicKey?.trim()
  const query = new URLSearchParams({
    vppId: vpp,
    deviceId: device,
    ...(key && DEVICE_PUBLIC_KEY_RE.test(key) ? { devicePublicKey: key } : {}),
  }).toString()
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

/**
 * Mock data + helpers for the VPP license flow (UI-only, no backend yet).
 *
 * Reflects the approved (offline-first) design AND the canonical backend model
 * (Marcone's doc): there is NO background polling and NO cloud "device status".
 * The device holds its own license; the editor checks it on upload.
 *
 * Model mapping (per device, single VPP):
 *   - 'demo'     → no Activation for this device (unlicensed).
 *   - 'pending'  → purchase started; an Entitlement/Order exists but this
 *                  device isn't bound yet — the Activation (bind a seat +
 *                  issue the VppLicense) happens on the next upload (online).
 *   - 'licensed' → Activation done; VppLicense written to the hardware.
 *
 * Out of scope for v1 (deferred): the multi-seat pool UX (buy N, activate on
 * several devices / "activate an already-owned seat") — needs its own design
 * round. Here a purchase is a 1-seat entitlement activated on this device.
 * Swap for the real `LicensePort` later (task E1/E8).
 */

export type LicensePhase = 'demo' | 'pending' | 'licensed'

// TODO(G3): confirm 10 vs 15 min with the team.
export const DEMO_MINUTES = 15
export const LICENSE_PRICE = 'US$ 25'

// Session-only phase per VPP, so it survives closing the modal / switching
// boards (mock of what the device + backend would report on upload).
const sessionPhase = new Map<string, LicensePhase>()

export const getPhase = (vppKey: string): LicensePhase => sessionPhase.get(vppKey) ?? 'demo'

export const setPhase = (vppKey: string, phase: LicensePhase): void => {
  sessionPhase.set(vppKey, phase)
}

// Stable, fake device id derived from the vpp key — stands in for the real
// 16-byte device_id the runtime derives from the hardware
// (SHA-256("openplc-dev-v1|"+anchor)[:16]). Formatted as 32 hex chars so it
// matches what the Edge /buy page + activate endpoint expect.
export const mockHardwareId = (seed: string): string => {
  let hex = ''
  let h = 2166136261
  for (let chunk = 0; chunk < 4; chunk++) {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h = Math.imul(h ^ (chunk + 1), 16777619)
    hex += (h >>> 0).toString(16).padStart(8, '0')
  }
  return hex // 32 hex chars = 16 bytes
}

// Base URL of the Autonomy Edge web app (where the /buy page lives). Same host
// used by the Help menu links.
//
// Resolution (mirrors `package-adapter.ts`'s VPP_CATALOG_URL):
//   1. `process.env.EDGE_WEB_URL` — injected at webpack build time via
//      `EnvironmentPlugin` (renderer dev + prod). Set it before `npm run dev`
//      to point at a local Edge:  `EDGE_WEB_URL=http://localhost:5173 npm run dev`.
//      Empty in shipped builds (CI leaves it unset) → falls through to (2).
//   2. `PRODUCTION_EDGE_WEB_URL` — the hardcoded production host below.
const PRODUCTION_EDGE_WEB_URL = 'https://edge.autonomylogic.com'
export const EDGE_WEB_URL = process.env.EDGE_WEB_URL || PRODUCTION_EDGE_WEB_URL

// The purchase link the editor opens in the browser: the Edge /buy page,
// carrying the VPP + device so the Edge can start the (guest or account)
// checkout. No auth/secret in the URL — see the /buy page + C2.
export const buildBuyUrl = (vppId: string, deviceId: string): string =>
  `${EDGE_WEB_URL}/buy?vppId=${encodeURIComponent(vppId)}&deviceId=${encodeURIComponent(deviceId)}`

/**
 * Mock data + helpers for the VPP license flow (UI-only, no backend yet).
 *
 * Reflects the approved (offline-first) design: there is NO background polling
 * and NO cloud "device status". The device holds its own license; the editor
 * checks it on upload. A purchase started in the browser stays "pending" until
 * the next upload (online) activates it. Swap for the real `LicensePort` later
 * (task E1/E8).
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

// Stable, fake hardware id (hash-looking) derived from the vpp key — stands in
// for the real unique hardware id the runtime reads from the device.
export const mockHardwareId = (seed: string): string => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return `sha256:${hex}${hex}`
}

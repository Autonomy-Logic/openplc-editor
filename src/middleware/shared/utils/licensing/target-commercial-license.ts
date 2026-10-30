/**
 * Commercial licence status of a runtime target: whether the OpenPLC Runtime
 * on it runs under a commercial licence or under the GPLv3. The status only
 * decides what the editor shows; nothing is ever blocked by it.
 */

import type { DeviceLicenseState } from '../../ports/device-port'
import type { RuntimeLicenseMode } from '../../ports/types'
import type { RuntimeCommercialLicense } from './runtime-commercial-license'

/** Approved wording, shown verbatim wherever the target is unlicensed. */
export const COMMERCIAL_LICENSE_DISCLAIMER =
  'This target does not have a commercial license, therefore your program is running under the GPLv3 terms ' +
  "of the open source license. Make sure you have checked the GPLv3 restrictions. In general, if you're using " +
  'this program in a commercial setting you may need to obtain a commercial license.'

/**
 * - `licensed`: commercial licence in place (vendor-paid VPP, paid VPP with a valid licence, or a runtime licence).
 * - `unlicensed`: GPLv3; the disclaimer is shown.
 * - `vpp-flow`: paid VPP without a valid licence; the VPP purchase flow speaks instead of the disclaimer.
 * - `unknown`: not enough information (the runtime does not report a licence); nothing is shown.
 */
export type TargetCommercialLicenseStatus = 'licensed' | 'unlicensed' | 'vpp-flow' | 'unknown'

export interface TargetCommercialLicenseInput {
  /** `package.runtimeLicense` of the board's VPP; `user` for a board without one or a package without the field. */
  mode: RuntimeLicenseMode
  /** The VPP licence state the editor holds for this device, or null when none was read. */
  vppLicense: DeviceLicenseState | null
  /** The `license` value of the runtime's `/api/status`, or null when it reports none. */
  runtimeLicense: RuntimeCommercialLicense | null
}

export function resolveTargetCommercialLicense({
  mode,
  vppLicense,
  runtimeLicense,
}: TargetCommercialLicenseInput): TargetCommercialLicenseStatus {
  if (mode === 'vendor') return 'licensed'
  if (mode === 'vpp') return vppLicense?.state === 'licensed' ? 'licensed' : 'vpp-flow'
  if (runtimeLicense === 'commercial') return 'licensed'
  if (runtimeLicense === 'gpl') return 'unlicensed'
  return 'unknown'
}

const RULE = '*'.repeat(72)

/** The disclaimer framed for the console, one entry per line. */
export function commercialLicenseConsoleLines(): string[] {
  return [RULE, COMMERCIAL_LICENSE_DISCLAIMER, RULE]
}

const HARDWARE_ID_RE = /^hw2:[0-9a-f]{64}$/

/**
 * `/buy?hardwareId=…` on the Edge web app, or null for an ID the page would refuse.
 * In a vPLC the ID is the host's, so the purchase adds seats to that host.
 */
export function buildRuntimeLicenseBuyUrl(baseUrl: string, hardwareId: string | null | undefined): string | null {
  const id = hardwareId?.trim()
  if (!id || !HARDWARE_ID_RE.test(id)) return null

  const query = new URLSearchParams({ hardwareId: id }).toString()
  const path = `${baseUrl.replace(/\/+$/, '')}/buy`
  try {
    const url = new URL(path)
    url.search = query
    return url.toString()
  } catch {
    return `${path}?${query}`
  }
}

/**
 * Commercial licence status of a runtime target: whether the OpenPLC Runtime
 * on it runs under a commercial licence or under the GPLv3. The status only
 * decides what the editor shows; nothing is ever blocked by it.
 */

import { compareParsedVersions, parseVersion } from '../../../../frontend/utils/semver'
import type { DeviceLicenseState } from '../../ports/device-port'
import type { RuntimeLicenseMode } from '../../ports/types'
import { frameConsoleNotice } from './console-notice'
import type { RuntimeCommercialLicense, RuntimeHardwareElement } from './runtime-commercial-license'

/** Approved wording, shown verbatim wherever the target is unlicensed. */
export const COMMERCIAL_LICENSE_DISCLAIMER =
  'This target does not have a commercial license, therefore your program is running under the GPLv3 terms ' +
  "of the open source license. Make sure you have checked the GPLv3 restrictions. In general, if you're using " +
  'this program in a commercial setting you may need to obtain a commercial license.'

/**
 * - `licensed`: commercial licence in place (vendor-paid VPP, paid VPP with a valid licence, or a runtime licence).
 * - `unlicensed`: GPLv3; the disclaimer is shown.
 * - `vpp-flow`: paid VPP without a valid licence; the VPP purchase flow speaks instead of the disclaimer.
 * - `mit`: an OpenPLC Runtime v4 older than `DUAL_LICENSE_MIN_RUNTIME_VERSION`; covered by the MIT licence, no licence check.
 * - `unknown`: not enough information (no runtime licence was verified); nothing is shown.
 */
export type TargetCommercialLicenseStatus = 'licensed' | 'unlicensed' | 'vpp-flow' | 'mit' | 'unknown'

/** First OpenPLC Runtime version under the GPLv3 or commercial licence. */
export const DUAL_LICENSE_MIN_RUNTIME_VERSION = '4.4.0'

/** Text shown for a runtime covered by the MIT licence. */
export const MIT_LICENSE_NOTICE = 'The OpenPLC Runtime version on this target is covered by the MIT license.'

/**
 * True for an OpenPLC Runtime v4 version below `DUAL_LICENSE_MIN_RUNTIME_VERSION`.
 * Pre-release suffixes do not count (`4.4.0-rc.1` is 4.4.0); a missing or unreadable version answers false.
 */
export function isMitLicensedRuntime(runtimeVersion: string | null | undefined): boolean {
  const version = parseVersion(runtimeVersion)
  const minimum = parseVersion(DUAL_LICENSE_MIN_RUNTIME_VERSION)
  if (!version || !minimum || version.major !== minimum.major) return false
  return compareParsedVersions(version, minimum) < 0
}

export interface TargetCommercialLicenseInput {
  /** `package.runtimeLicense` of the board's VPP; `user` for a board without one or a package without the field. */
  mode: RuntimeLicenseMode
  /** The VPP licence state the editor holds for this device, or null when none was read. */
  vppLicense: DeviceLicenseState | null
  /** The runtime licence the editor verified from `GET /api/runtime-license`, or null when none was verified. */
  runtimeLicense: RuntimeCommercialLicense | null
  /** Version the connected OpenPLC Runtime reports; null or omitted for a built-in board. */
  runtimeVersion?: string | null
}

export function resolveTargetCommercialLicense({
  mode,
  vppLicense,
  runtimeLicense,
  runtimeVersion,
}: TargetCommercialLicenseInput): TargetCommercialLicenseStatus {
  if (isMitLicensedRuntime(runtimeVersion)) return 'mit'
  if (mode === 'vendor') return 'licensed'
  if (mode === 'vpp') return vppLicense?.state === 'licensed' ? 'licensed' : 'vpp-flow'
  if (runtimeLicense === 'commercial') return 'licensed'
  if (runtimeLicense === 'gpl') return 'unlicensed'
  return 'unknown'
}

/** The disclaimer framed for the console, one entry per line, each no wider than the rules. */
export function commercialLicenseConsoleLines(): string[] {
  return frameConsoleNotice(COMMERCIAL_LICENSE_DISCLAIMER)
}

const HARDWARE_ID_RE = /^hw2:[0-9a-f]{64}$/

/** base64url (no padding) of the JSON `[{kind,hash}]` list, as the purchase page reads `elements`. */
export function encodeRuntimeHardwareElements(elements: readonly RuntimeHardwareElement[]): string {
  const json = JSON.stringify(elements.map(({ kind, hash }) => ({ kind, hash })))
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * `/buy?hardwareId=…[&elements=…]` on the Edge web app, or null for an ID the page would refuse.
 * `elements`, when known, lets the page tell a vPLC from a device and find its host.
 */
export function buildRuntimeLicenseBuyUrl(
  baseUrl: string,
  hardwareId: string | null | undefined,
  elements?: readonly RuntimeHardwareElement[] | null,
): string | null {
  const id = hardwareId?.trim()
  if (!id || !HARDWARE_ID_RE.test(id)) return null

  const params = new URLSearchParams({ hardwareId: id })
  if (elements && elements.length > 0) params.set('elements', encodeRuntimeHardwareElements(elements))
  const query = params.toString()
  const path = `${baseUrl.replace(/\/+$/, '')}/buy`
  try {
    const url = new URL(path)
    url.search = query
    return url.toString()
  } catch {
    return `${path}?${query}`
  }
}

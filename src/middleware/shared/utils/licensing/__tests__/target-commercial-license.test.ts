import type { DeviceLicenseState } from '../../../ports/device-port'
import {
  buildRuntimeLicenseBuyUrl,
  COMMERCIAL_LICENSE_DISCLAIMER,
  commercialLicenseConsoleLines,
  resolveTargetCommercialLicense,
} from '../target-commercial-license'

const ID = `hw2:${'ab'.repeat(32)}`

const LICENSED: DeviceLicenseState = { state: 'licensed', how: 'already-stored' }
const DEMO: DeviceLicenseState = { state: 'unlicensed', entitlementChecked: true }
const NOT_ASKED: DeviceLicenseState = { state: 'unlicensed', entitlementChecked: false }
const FAILED: DeviceLicenseState = { state: 'check-failed', error: 'timeout' }

describe('resolveTargetCommercialLicense', () => {
  it('licenses a vendor-paid VPP whatever the runtime reports', () => {
    for (const runtimeLicense of ['gpl', 'commercial', null] as const) {
      expect(resolveTargetCommercialLicense({ mode: 'vendor', vppLicense: null, runtimeLicense })).toBe('licensed')
    }
  })

  it('licenses a paid VPP only with a valid VPP licence', () => {
    expect(resolveTargetCommercialLicense({ mode: 'vpp', vppLicense: LICENSED, runtimeLicense: 'gpl' })).toBe(
      'licensed',
    )
  })

  it('hands a paid VPP without a valid licence to the VPP purchase flow, never the disclaimer', () => {
    for (const vppLicense of [DEMO, NOT_ASKED, FAILED, { state: 'unsupported' } as const, null]) {
      for (const runtimeLicense of ['gpl', 'commercial', null] as const) {
        expect(resolveTargetCommercialLicense({ mode: 'vpp', vppLicense, runtimeLicense })).toBe('vpp-flow')
      }
    }
  })

  it('follows the runtime licence for a user-licensed target', () => {
    expect(resolveTargetCommercialLicense({ mode: 'user', vppLicense: null, runtimeLicense: 'commercial' })).toBe(
      'licensed',
    )
    expect(resolveTargetCommercialLicense({ mode: 'user', vppLicense: null, runtimeLicense: 'gpl' })).toBe('unlicensed')
  })

  it('ignores a VPP licence on a user-licensed target', () => {
    expect(resolveTargetCommercialLicense({ mode: 'user', vppLicense: LICENSED, runtimeLicense: 'gpl' })).toBe(
      'unlicensed',
    )
  })

  it('shows nothing for a runtime that does not report a licence', () => {
    expect(resolveTargetCommercialLicense({ mode: 'user', vppLicense: null, runtimeLicense: null })).toBe('unknown')
  })
})

describe('commercialLicenseConsoleLines', () => {
  it('frames the approved text between rules of asterisks', () => {
    const [top, text, bottom] = commercialLicenseConsoleLines()
    expect(top).toMatch(/^\*{10,}$/)
    expect(bottom).toBe(top)
    expect(text).toBe(COMMERCIAL_LICENSE_DISCLAIMER)
  })
})

describe('buildRuntimeLicenseBuyUrl', () => {
  it('links the purchase page with the hardware ID', () => {
    expect(buildRuntimeLicenseBuyUrl('https://edge.autonomylogic.com/', ID)).toBe(
      `https://edge.autonomylogic.com/buy?hardwareId=${encodeURIComponent(ID)}`,
    )
  })

  it('keeps a base path and supports a same-origin prefix', () => {
    expect(buildRuntimeLicenseBuyUrl('https://example.com/edge', ID)).toBe(
      `https://example.com/edge/buy?hardwareId=${encodeURIComponent(ID)}`,
    )
    expect(buildRuntimeLicenseBuyUrl('/', ID)).toBe(`/buy?hardwareId=${encodeURIComponent(ID)}`)
  })

  it('refuses a missing or malformed ID', () => {
    expect(buildRuntimeLicenseBuyUrl('https://edge.autonomylogic.com', null)).toBeNull()
    expect(buildRuntimeLicenseBuyUrl('https://edge.autonomylogic.com', 'hw2:abc')).toBeNull()
    expect(buildRuntimeLicenseBuyUrl('https://edge.autonomylogic.com', `${ID}&seats=99`)).toBeNull()
  })
})

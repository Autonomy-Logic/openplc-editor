import type { DeviceLicenseState } from '../../../ports/device-port'
import {
  buildRuntimeLicenseBuyUrl,
  COMMERCIAL_LICENSE_DISCLAIMER,
  commercialLicenseConsoleLines,
  isMitLicensedRuntime,
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

describe('isMitLicensedRuntime', () => {
  it.each(['4.3.2', 'v4.3.9', '4.0.0', 'v4', '4.3', ' v4.3.2 ', '4.3.9-rc.2'])('is MIT for runtime %p', (version) => {
    expect(isMitLicensedRuntime(version)).toBe(true)
  })

  it.each(['4.4.0', 'v4.4.0', '4.4.0-rc.1', 'v4.4.0-rc.1', '4.4', '4.10.0', 'v4.4.1', '5.0.0'])(
    'is not MIT for runtime %p',
    (version) => {
      expect(isMitLicensedRuntime(version)).toBe(false)
    },
  )

  it.each([null, undefined, '', 'dev', 'garbage', '4.1 beta', '3.0.0'])('is not MIT for %p', (version) => {
    expect(isMitLicensedRuntime(version)).toBe(false)
  })
})

describe('resolveTargetCommercialLicense with a runtime version', () => {
  it('resolves an older runtime to MIT whatever the licence or VPP says', () => {
    for (const mode of ['user', 'vendor', 'vpp'] as const) {
      for (const runtimeLicense of ['gpl', 'commercial', null] as const) {
        expect(
          resolveTargetCommercialLicense({ mode, vppLicense: DEMO, runtimeLicense, runtimeVersion: 'v4.3.2' }),
        ).toBe('mit')
      }
    }
  })

  it('keeps the normal check from 4.4.0 and for a missing or unreadable version', () => {
    for (const runtimeVersion of ['4.4.0', 'v4.4.0', '4.4.0-rc.1', '4.10.0', null, 'dev', undefined]) {
      expect(
        resolveTargetCommercialLicense({ mode: 'user', vppLicense: null, runtimeLicense: 'gpl', runtimeVersion }),
      ).toBe('unlicensed')
      expect(
        resolveTargetCommercialLicense({
          mode: 'user',
          vppLicense: null,
          runtimeLicense: 'commercial',
          runtimeVersion,
        }),
      ).toBe('licensed')
    }
  })
})

describe('commercialLicenseConsoleLines', () => {
  it('frames the approved text between rules of asterisks', () => {
    const lines = commercialLicenseConsoleLines()
    const top = lines[0]
    expect(top).toMatch(/^\*{72}$/)
    expect(lines.at(-1)).toBe(top)
    expect(lines.slice(1, -1).join(' ')).toBe(COMMERCIAL_LICENSE_DISCLAIMER)
  })

  it('wraps the text so no line is wider than the rules', () => {
    const lines = commercialLicenseConsoleLines()
    const text = lines.slice(1, -1)
    expect(text.length).toBeGreaterThan(1)
    for (const line of text) {
      expect(line.length).toBeLessThanOrEqual(lines[0].length)
      expect(line).toBe(line.trim())
    }
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

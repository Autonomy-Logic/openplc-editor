import type { BoardInfo, VppMetadata } from '../../../ports/types'
import { resolveLicensingTarget } from '../resolve-licensing-target'

/** A minimally-valid BoardInfo; each test overrides only what it is about. */
function board(overrides: Partial<BoardInfo> = {}): BoardInfo {
  return {
    compiler: 'arduino-cli',
    core: 'esp32:esp32',
    preview: '',
    specs: {},
    ...overrides,
  }
}

/** VPP metadata for a package id; the rest is inert filler this unit ignores. */
function vpp(packageId: string): VppMetadata {
  return {
    packageId,
    vendor: 'Espressif',
    deviceId: 'esp32-generic',
    packagePath: '/packages/espressif',
    screens: {},
    moduleSystem: { enabled: false, maxSlots: 0, modules: [] },
  }
}

const LICENSED_VPP = vpp('com.openplc.espressif-licensed')

describe('resolveLicensingTarget', () => {
  it('reports a licensable VPP with just its package id', () => {
    const target = resolveLicensingTarget(board({ vpp: LICENSED_VPP, capabilities: { isLicensable: true } }))

    // Deliberately only the package id. There is no "can this board store a
    // licence" companion: every licensable VPP targets hardware that persists
    // one, so the answer would be constant, and the DEVICE is what gets asked.
    expect(target).toEqual({ licensable: true, packageId: 'com.openplc.espressif-licensed' })
  })

  it('is not licensable for a VPP that does not declare it', () => {
    const target = resolveLicensingTarget(board({ vpp: vpp('com.openplc.espressif') }))

    expect(target).toEqual({ licensable: false, reason: 'not-licensable' })
  })

  it('is not licensable for a plain non-VPP board', () => {
    // The common case: every built-in hals.json board, and the reason this
    // function has to be cheap — a connect here must carry no licensing traffic.
    expect(resolveLicensingTarget(board())).toEqual({ licensable: false, reason: 'not-licensable' })
  })

  it('is not licensable for the simulator', () => {
    expect(resolveLicensingTarget(board({ compiler: 'simulator' }))).toEqual({
      licensable: false,
      reason: 'not-licensable',
    })
  })

  it('is not licensable for runtime v4', () => {
    expect(resolveLicensingTarget(board({ compiler: 'openplc-compiler' }))).toEqual({
      licensable: false,
      reason: 'not-licensable',
    })
  })

  it('never treats an explicit isLicensable:false as licensable, even on a VPP board', () => {
    const target = resolveLicensingTarget(board({ vpp: LICENSED_VPP, capabilities: { isLicensable: false } }))

    expect(target).toEqual({ licensable: false, reason: 'not-licensable' })
  })

  it('reports a broken manifest distinctly when isLicensable is set with no package id', () => {
    // Distinct from `not-licensable` on purpose: this is a manifest someone has
    // to fix, not a product that is simply free. Treating it as licensable would
    // mean calling activate with nothing to identify the product, then telling the
    // user to buy something the editor cannot name.
    const target = resolveLicensingTarget(board({ capabilities: { isLicensable: true } }))

    expect(target).toEqual({ licensable: false, reason: 'no-package-id' })
  })

  it('treats a blank package id as missing rather than as an id', () => {
    const target = resolveLicensingTarget(
      board({ vpp: { ...LICENSED_VPP, packageId: '   ' }, capabilities: { isLicensable: true } }),
    )

    expect(target).toEqual({ licensable: false, reason: 'no-package-id' })
  })

  it('handles an absent board without a null dance at the call site', () => {
    expect(resolveLicensingTarget(null)).toEqual({ licensable: false, reason: 'not-licensable' })
    expect(resolveLicensingTarget(undefined)).toEqual({ licensable: false, reason: 'not-licensable' })
  })
})

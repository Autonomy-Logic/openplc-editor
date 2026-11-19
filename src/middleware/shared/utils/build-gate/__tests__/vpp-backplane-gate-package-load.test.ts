import type { VppTargetLoadState } from '../../../ports/vpp-target-mechanisms'
import { evaluateVppBackplaneGate, vppGateStateFor } from '../vpp-backplane-gate'

const STILL_LOADING =
  'The package of the selected vPLC is still loading. Wait until it finishes in Device > Edge Devices.'
const DID_NOT_LOAD = 'The package of the selected vPLC did not load. Open Device > Edge Devices and click Try again.'
const PACKAGE_ID = 'com.synergy-logic.slm-rp4'

type LoadStatus = VppTargetLoadState['status']

const LOADING_STATUSES: LoadStatus[] = ['downloading', 'verifying']
const NOT_LOADED: [LoadStatus, string][] = [
  ['downloading', STILL_LOADING],
  ['verifying', STILL_LOADING],
  ['error', DID_NOT_LOAD],
]

/** A vPLC that holds the backplane and runs `PACKAGE_ID`, unless told otherwise. */
function vplc(overrides: { backplaneAccess?: boolean } = {}) {
  return {
    backplaneAccess: true,
    vpp: { packageId: PACKAGE_ID, version: '1.0.0', contentHash: 'sha256:x' },
    ...overrides,
  }
}

describe('vppGateStateFor: the load state of the vPLC package', () => {
  it.each([
    ['downloading', 'loading'],
    ['verifying', 'loading'],
    ['error', 'failed'],
  ] as const)('maps %s to %s', (status, expected) => {
    const state = vppGateStateFor({
      vplcProvidesVendorBoards: true,
      board: { vpp: { packageId: PACKAGE_ID } },
      target: vplc(),
      targetLoadStatus: status,
    })
    expect(state.targetPackageLoad).toBe(expected)
  })

  it.each(['idle', 'ready', undefined] as const)('sets no load for %s', (status) => {
    const state = vppGateStateFor({
      vplcProvidesVendorBoards: true,
      board: { vpp: { packageId: PACKAGE_ID } },
      target: vplc(),
      targetLoadStatus: status,
    })
    expect(state.targetPackageLoad).toBeUndefined()
  })

  it.each(['downloading', 'verifying', 'error'] as const)('sets no load on the desktop for %s', (status) => {
    const state = vppGateStateFor({
      vplcProvidesVendorBoards: false,
      board: { vpp: { packageId: PACKAGE_ID } },
      target: vplc(),
      targetLoadStatus: status,
    })
    expect(state.targetPackageLoad).toBeUndefined()
  })

  it.each([
    ['a vPLC created without a package', { backplaneAccess: true, vpp: null }],
    ['a host that reported no package field', { backplaneAccess: true }],
    ['no vPLC', null],
  ] as const)('sets no load for %s', (_label, target) => {
    for (const status of ['downloading', 'verifying', 'error'] as const) {
      const state = vppGateStateFor({
        vplcProvidesVendorBoards: true,
        board: { vpp: { packageId: PACKAGE_ID } },
        target,
        targetLoadStatus: status,
      })
      expect(state.targetPackageLoad).toBeUndefined()
    }
  })
})

describe('evaluateVppBackplaneGate: a vPLC package that did not load', () => {
  it.each(NOT_LOADED)(
    'refuses a board the vPLC does not have while the load is %s, instead of saying the vPLC lacks it',
    (status, reason) => {
      const verdict = evaluateVppBackplaneGate(
        vppGateStateFor({
          vplcProvidesVendorBoards: true,
          board: undefined,
          boardName: 'SLM-RP4',
          target: vplc(),
          targetLoadStatus: status,
        }),
      )
      expect(verdict).toEqual({ kind: 'refuse', reason })
    },
  )

  it.each(NOT_LOADED)('refuses a resolved vendor board while the load is %s', (status, reason) => {
    const verdict = evaluateVppBackplaneGate(
      vppGateStateFor({
        vplcProvidesVendorBoards: true,
        board: { vpp: { packageId: PACKAGE_ID } },
        target: vplc(),
        targetLoadStatus: status,
      }),
    )
    expect(verdict).toEqual({ kind: 'refuse', reason })
  })

  it.each(NOT_LOADED)('names the load before the backplane refusal while the load is %s', (status, reason) => {
    const verdict = evaluateVppBackplaneGate(
      vppGateStateFor({
        vplcProvidesVendorBoards: true,
        board: { vpp: { packageId: PACKAGE_ID } },
        target: vplc({ backplaneAccess: false }),
        targetLoadStatus: status,
      }),
    )
    expect(verdict).toEqual({ kind: 'refuse', reason })
  })

  it.each([...LOADING_STATUSES, 'error'] as const)(
    'allows a resolved board no vendor package provides while the load is %s',
    (status) => {
      expect(
        evaluateVppBackplaneGate(
          vppGateStateFor({
            vplcProvidesVendorBoards: true,
            board: {},
            boardName: 'Uno',
            target: vplc(),
            targetLoadStatus: status,
          }),
        ),
      ).toEqual({ kind: 'allow' })
    },
  )

  it('allows a resolved vendor board once the package is ready', () => {
    expect(
      evaluateVppBackplaneGate(
        vppGateStateFor({
          vplcProvidesVendorBoards: true,
          board: { vpp: { packageId: PACKAGE_ID } },
          target: vplc(),
          targetLoadStatus: 'ready',
        }),
      ),
    ).toEqual({ kind: 'allow' })
  })

  it('gates nothing on the desktop whatever the load state', () => {
    for (const board of [{ vpp: { packageId: PACKAGE_ID } }, undefined]) {
      expect(
        evaluateVppBackplaneGate(
          vppGateStateFor({
            vplcProvidesVendorBoards: false,
            board,
            boardName: 'SLM-RP4',
            target: vplc(),
            targetLoadStatus: 'error',
          }),
        ),
      ).toEqual({ kind: 'allow' })
    }
  })

  it('keeps the no-package refusal for a vPLC created without a package', () => {
    const verdict = evaluateVppBackplaneGate(
      vppGateStateFor({
        vplcProvidesVendorBoards: true,
        board: { vpp: { packageId: PACKAGE_ID } },
        target: { backplaneAccess: true, vpp: null },
        targetLoadStatus: 'error',
      }),
    )
    expect(verdict).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('without a vendor package') })
  })

  it('refuses a vendor board with no vPLC as before, even with a load set', () => {
    const verdict = evaluateVppBackplaneGate({
      isVppBoard: true,
      hasTargetVplc: false,
      vplcProvidesVendorBoards: true,
      backplaneAccess: undefined,
      targetPackageLoad: 'failed',
    })
    expect(verdict).toMatchObject({ kind: 'refuse', reason: expect.stringContaining('Select a vPLC') })
  })
})

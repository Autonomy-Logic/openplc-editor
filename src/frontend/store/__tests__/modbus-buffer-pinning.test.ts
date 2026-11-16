/**
 * The 1024 placeholder must not become the project.
 *
 * Creating a Modbus server showed 1024 in every field with none of it stored.
 * Two things conspired, and both are pinned here:
 *
 *  1. the screen rendered DEFAULT_BUFFER_MAPPING as if the project held it;
 *  2. and editing ONE field persisted all EIGHT, because the reducer merged
 *     over those defaults -- handing the project back the fixed image of 8192
 *     bits and 1024 registers this work exists to remove.
 *
 * `compute-io-image` reads a persisted count as a REQUEST and an absent one as
 * "expose whatever the image turns out to be", so the difference between
 * stored and displayed decides the size of the image.
 */
import { createStore } from 'zustand/vanilla'

import type { PLCServer } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console'
import { createDeviceSlice } from '../slices/device'
import { createEditorSlice } from '../slices/editor'
import { createLibrarySlice } from '../slices/library'
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSliceRoot } from '../slices/project/types'

const makeStore = () =>
  createStore<ProjectSliceRoot>()((...a) => ({
    ...createProjectSlice(...a),
    ...createDeviceSlice(...a),
    ...createConsoleSlice(...a),
    ...createEditorSlice(...a),
    ...createLibrarySlice(...a),
  }))

const seedServer = (s: ReturnType<typeof makeStore>) => {
  const cur = s.getState().project
  const server: PLCServer = {
    name: 'mb',
    protocol: 'modbus-tcp',
    modbusSlaveConfig: { enabled: true, transports: ['tcp'], networkInterface: '0.0.0.0', port: 502 },
  } as PLCServer
  s.setState({ project: { ...cur, data: { ...cur.data, servers: [server] } } })
}

const mappingOf = (s: ReturnType<typeof makeStore>) =>
  s.getState().project.data.servers![0].modbusSlaveConfig!.bufferMapping

describe('Modbus counts: stored versus displayed', () => {
  it('carries no count at all on a new server', () => {
    const s = makeStore()
    seedServer(s)
    expect(mappingOf(s)).toBeUndefined()
  })

  it('stores only the field that was edited', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { holdingRegisters: { qwCount: 16 } } })

    const m = mappingOf(s)!
    expect(m.holdingRegisters?.qwCount).toBe(16)
    // and NOTHING besides it
    expect(m.holdingRegisters?.mwCount).toBeUndefined()
    expect(m.coils).toBeUndefined()
    expect(m.discreteInputs).toBeUndefined()
    expect(m.inputRegisters).toBeUndefined()
  })

  it('a second field erases neither the first nor materialises the rest', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { holdingRegisters: { qwCount: 16 } } })
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { coils: { qxBits: 24 } } })

    const m = mappingOf(s)!
    expect(m.holdingRegisters?.qwCount).toBe(16)
    expect(m.coils?.qxBits).toBe(24)
    expect(m.discreteInputs).toBeUndefined()
    expect(m.inputRegisters).toBeUndefined()
  })

  it('clearing a field returns the segment to the image', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { coils: { qxBits: 64 } } })
    s.getState().projectActions.clearServerBufferCount('mb', 'coils', 'qxBits')

    // Not the field, not an empty group, not an empty mapping: absent is absent.
    expect(mappingOf(s)).toBeUndefined()
  })

  it('clearing a field does not take its neighbours with it', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { coils: { qxBits: 64, mxBits: 8 } } })
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { inputRegisters: { iwCount: 2 } } })
    s.getState().projectActions.clearServerBufferCount('mb', 'coils', 'qxBits')

    const m = mappingOf(s)!
    expect(m.coils?.qxBits).toBeUndefined()
    expect(m.coils?.mxBits).toBe(8)
    expect(m.inputRegisters?.iwCount).toBe(2)
  })

  it.each([
    ['holdingRegisters', 'qwCount'],
    ['holdingRegisters', 'mwCount'],
    ['holdingRegisters', 'mdCount'],
    ['holdingRegisters', 'mlCount'],
    ['coils', 'qxBits'],
    ['coils', 'mxBits'],
    ['discreteInputs', 'ixBits'],
    ['inputRegisters', 'iwCount'],
  ] as const)('clears %s.%s and the emptied group goes with it', (group, field) => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { [group]: { [field]: 7 } } })
    expect(JSON.stringify(mappingOf(s))).toContain('7')

    s.getState().projectActions.clearServerBufferCount('mb', group, field)
    expect(mappingOf(s)).toBeUndefined()
  })

  it('clearing what was never stored creates nothing', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.clearServerBufferCount('mb', 'holdingRegisters', 'qwCount')
    expect(mappingOf(s)).toBeUndefined()
  })

  it('zero stays stored: it is a request, not an absence', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { coils: { qxBits: 0 } } })
    expect(mappingOf(s)!.coils?.qxBits).toBe(0)
  })

  it('no 1024 appears on its own', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { coils: { qxBits: 8 } } })
    // The exact symptom: 1024 registers and 8192 bits nobody asked for.
    expect(JSON.stringify(mappingOf(s))).not.toContain('1024')
    expect(JSON.stringify(mappingOf(s))).not.toContain('8192')
  })
})

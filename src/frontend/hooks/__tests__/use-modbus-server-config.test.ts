/**
 * What the Modbus buffer panel offers as "what you get".
 *
 * A segment the project does not pin follows the I/O image, and the screen
 * shows that number greyed out. It used to show DEFAULT_BUFFER_MAPPING -- 1024
 * registers and 8192 bits, the fixed image this work removes -- so the one
 * figure the panel presented as the outcome was the one thing it would not be.
 *
 * The round trip matters as much as the number: typing pins a count, and
 * clearing the field has to unpin it, or a number typed once could only ever
 * be replaced by another number.
 */

import { act, renderHook } from '@testing-library/react'

import type { ModbusBufferMapping, PLCServer } from '@root/middleware/shared/ports/types'

import type { OpenPLCStore } from '../../store'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useModbusServerConfig } from '../use-modbus-server-config'

let store: OpenPLCStore

const BOARD = 'OpenPLC Runtime v4'

const server = (bufferMapping?: ModbusBufferMapping): PLCServer =>
  ({
    name: 'mb',
    protocol: 'modbus-tcp',
    modbusSlaveConfig: {
      enabled: true,
      transports: ['tcp'],
      networkInterface: '0.0.0.0',
      port: 502,
      ...(bufferMapping ? { bufferMapping } : {}),
    },
  }) as PLCServer

/** An EtherCAT channel is a producer on Runtime v4; a pin is not. */
const ethercatAt = (iecLocation: string) => ({
  name: 'ecat',
  ethercatConfig: { devices: [{ name: 'slave1', channelMappings: [{ channelId: 'c0', iecLocation }] }] },
})

function seed(options: { servers?: unknown[]; remoteDevices?: unknown[] } = {}) {
  store = createTestStore()
  const state = store.getState()
  store.setState({
    ...state,
    project: {
      ...state.project,
      data: {
        ...state.project.data,
        pous: [],
        servers: options.servers ?? [server()],
        remoteDevices: options.remoteDevices ?? [],
        configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
      },
    },
    deviceDefinitions: {
      ...state.deviceDefinitions,
      configuration: { ...state.deviceDefinitions.configuration, deviceBoard: BOARD },
      pinMapping: { ...state.deviceDefinitions.pinMapping, pinsByBoard: {} },
    },
    deviceAvailableOptions: {
      ...state.deviceAvailableOptions,
      availableBoards: new Map([[BOARD, { compiler: 'openplc-compiler' }]]),
    },
  } as never)
}

const mappingOf = () => store.getState().project.data.servers?.[0].modbusSlaveConfig?.bufferMapping

describe('useModbusServerConfig buffer counts', () => {
  it('offers zero, not 1024, for a project that produces nothing', () => {
    seed()
    const { result } = renderHook(() => useModbusServerConfig('mb'), { wrapper: createStoreWrapper(store) })

    expect(result.current.pinnedSegments.size).toBe(0)
    expect(result.current.buffers).toEqual({ QW: 0, MW: 0, MD: 0, ML: 0, QX: 0, MX: 0, IX: 0, IW: 0 })
    // The exact symptom: the panel presenting the fixed image as the outcome.
    expect(JSON.stringify(result.current.buffers)).not.toContain('1024')
    expect(JSON.stringify(result.current.buffers)).not.toContain('8192')
  })

  it('follows the image where the project produces something', () => {
    // %QX0.3 is bit 3, so the image carries four bits of bool output.
    seed({ remoteDevices: [ethercatAt('%QX0.3')] })
    const { result } = renderHook(() => useModbusServerConfig('mb'), { wrapper: createStoreWrapper(store) })

    expect(result.current.buffers.QX).toBe(4)
    expect(result.current.pinnedSegments.has('QX')).toBe(false)
    // And the areas nothing reaches stay at zero rather than borrowing it.
    expect(result.current.buffers.IX).toBe(0)
  })

  it('a pinned count wins over the image, and only for its own segment', () => {
    seed({ servers: [server({ coils: { qxBits: 64 } })], remoteDevices: [ethercatAt('%QX0.3')] })
    const { result } = renderHook(() => useModbusServerConfig('mb'), { wrapper: createStoreWrapper(store) })

    expect(result.current.buffers.QX).toBe(64)
    expect(result.current.pinnedSegments.has('QX')).toBe(true)
    expect(result.current.buffers.QW).toBe(0)
    expect(result.current.pinnedSegments.has('QW')).toBe(false)
  })

  it('clearing a count unpins the segment and leaves nothing behind', () => {
    seed({ servers: [server({ coils: { qxBits: 64 } })], remoteDevices: [ethercatAt('%QX0.3')] })
    const { result, rerender } = renderHook(() => useModbusServerConfig('mb'), { wrapper: createStoreWrapper(store) })

    act(() => result.current.actions.clearBufferCount('coils', 'qxBits'))
    rerender()

    expect(mappingOf()).toBeUndefined()
    expect(result.current.pinnedSegments.has('QX')).toBe(false)
    expect(result.current.buffers.QX).toBe(4)
  })

  it('zero is a pinned request, not an absence', () => {
    seed({ servers: [server({ coils: { qxBits: 0 } })], remoteDevices: [ethercatAt('%QX0.3')] })
    const { result } = renderHook(() => useModbusServerConfig('mb'), { wrapper: createStoreWrapper(store) })

    // The whole point of the tip: 0 publishes nothing while the image keeps
    // the four bits the EtherCAT channel produces.
    expect(result.current.buffers.QX).toBe(0)
    expect(result.current.pinnedSegments.has('QX')).toBe(true)
  })
})

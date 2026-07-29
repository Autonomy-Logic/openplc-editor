/**
 * FC 0x49 (run/stop control) PDU codec tests.
 *
 * These bytes are the contract between the editor and the baremetal runtime's
 * `plcControl()` handler in ModbusSlave.cpp, so the layouts are asserted
 * byte-for-byte rather than round-tripped through the builder.
 */

import {
  buildPlcStateQueryRequest,
  buildPlcStateSetRequest,
  parsePlcControlResponse,
} from '../modbus-pdu'
import { ModbusDebugResponse, ModbusFunctionCode, PlcRuntimeState, PlcSwitchPosition } from '../../simulator/types'

describe('FC 0x49 request builders', () => {
  it('builds a QUERY request as [FC][0x00][0x00]', () => {
    expect(Array.from(buildPlcStateQueryRequest())).toEqual([0x49, 0x00, 0x00])
  })

  it('builds SET_STATE RUN as [FC][0x01][0x01]', () => {
    expect(Array.from(buildPlcStateSetRequest(PlcRuntimeState.RUNNING))).toEqual([0x49, 0x01, 0x01])
  })

  it('builds SET_STATE STOP as [FC][0x01][0x00]', () => {
    expect(Array.from(buildPlcStateSetRequest(PlcRuntimeState.STOPPED))).toEqual([0x49, 0x01, 0x00])
  })

  it('uses the function code reserved past the debug streaming range', () => {
    // 0x46-0x48 are reserved for planned debug subscription codes.
    expect(ModbusFunctionCode.PLC_CONTROL).toBe(0x49)
  })
})

describe('parsePlcControlResponse', () => {
  const frame = (status: number, state: number, position: number) =>
    new Uint8Array([ModbusFunctionCode.PLC_CONTROL, status, state, position])

  it('parses a running device with the switch in RUN', () => {
    const result = parsePlcControlResponse(
      frame(ModbusDebugResponse.SUCCESS, PlcRuntimeState.RUNNING, PlcSwitchPosition.RUN),
    )
    expect(result).toEqual({
      success: true,
      state: PlcRuntimeState.RUNNING,
      switchPosition: PlcSwitchPosition.RUN,
    })
  })

  it('parses a stopped device with the switch in STOP', () => {
    const result = parsePlcControlResponse(
      frame(ModbusDebugResponse.SUCCESS, PlcRuntimeState.STOPPED, PlcSwitchPosition.STOP),
    )
    expect(result.success).toBe(true)
    expect(result.state).toBe(PlcRuntimeState.STOPPED)
    expect(result.switchPosition).toBe(PlcSwitchPosition.STOP)
    expect(result.refusedBySwitch).toBeUndefined()
  })

  it('flags a RUN refused by the hardware switch', () => {
    const result = parsePlcControlResponse(
      frame(ModbusDebugResponse.REFUSED_BY_SWITCH, PlcRuntimeState.STOPPED, PlcSwitchPosition.STOP),
    )
    // Not a success, and specifically identified so the editor shows the
    // "flip the switch to RUN" warning rather than a generic failure.
    expect(result.success).toBe(false)
    expect(result.refusedBySwitch).toBe(true)
    expect(result.state).toBe(PlcRuntimeState.STOPPED)
    expect(result.switchPosition).toBe(PlcSwitchPosition.STOP)
  })

  it('reports ERROR state', () => {
    const result = parsePlcControlResponse(
      frame(ModbusDebugResponse.SUCCESS, PlcRuntimeState.ERROR, PlcSwitchPosition.RUN),
    )
    expect(result.state).toBe(PlcRuntimeState.ERROR)
  })

  it('detects old firmware via the Modbus exception form', () => {
    // A runtime built before FC 0x49 answers (FC | 0x80). The editor turns this
    // into "rebuild and upload", never an error, so field devices don't look
    // broken after an editor upgrade.
    const result = parsePlcControlResponse(new Uint8Array([0x49 + 0x80, 0x01]))
    expect(result.unsupported).toBe(true)
    expect(result.success).toBe(false)
  })

  it('rejects a mismatched function code', () => {
    const result = parsePlcControlResponse(new Uint8Array([0x44, 0x7e, 0x01, 0x01]))
    expect(result.success).toBe(false)
    expect(result.unsupported).toBeUndefined()
    expect(result.error).toMatch(/mismatch/i)
  })

  it('rejects a truncated response', () => {
    expect(parsePlcControlResponse(new Uint8Array([])).success).toBe(false)
    expect(parsePlcControlResponse(new Uint8Array([0x49, 0x7e])).success).toBe(false)
  })
})

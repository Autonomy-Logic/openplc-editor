/**
 * getBoardId() on the editor Modbus clients (FC 0x48).
 *
 * Both clients reuse the shared buildGetBoardIdRequest/parseGetBoardIdResponse
 * and slice the pure PDU out of their transport frame before parsing:
 *   - RTU: sendRequestImpl prepends 6 zero bytes then [slaveId][FC][status]...,
 *     so the pure PDU starts at offset 7.
 *   - TCP: the MBAP header is 6 bytes then [unitId][FC][status]..., so the pure
 *     PDU also starts at offset 7.
 * We stub the private send method to drive the response frame directly.
 */

import { ModbusDebugResponse, ModbusFunctionCode, ModbusTcpClient } from '../modbus-client'
import { ModbusRtuClient } from '../modbus-rtu-client'

// -- RTU frame: [6 zero padding][slaveId][FC][status][id_len][id...] ----------
function rtuFrame(fc: number, status: number, payload: number[]): Buffer {
  const body = [1 /* slaveId */, fc, status, ...payload]
  const buf = Buffer.alloc(6 + body.length)
  for (let i = 0; i < body.length; i++) buf.writeUInt8(body[i], 6 + i)
  return buf
}

// -- TCP frame: [txnId:2][proto:2][len:2][unitId][FC][status][id_len][id...] ---
function tcpFrame(txnId: number, fc: number, status: number, payload: number[]): Buffer {
  const pdu = [fc, status, ...payload]
  const buf = Buffer.alloc(7 + pdu.length)
  buf.writeUInt16BE(txnId, 0)
  buf.writeUInt16BE(0x0000, 2)
  buf.writeUInt16BE(1 + pdu.length, 4)
  buf.writeUInt8(0x00, 6)
  for (let i = 0; i < pdu.length; i++) buf.writeUInt8(pdu[i], 7 + i)
  return buf
}

describe('ModbusRtuClient.getBoardId', () => {
  let client: ModbusRtuClient

  beforeEach(() => {
    client = new ModbusRtuClient({ port: 'x', baudRate: 115200, slaveId: 1, timeout: 100 })
  })

  const stub = (frame: Buffer) => {
    ;(client as unknown as { sendRequest: () => Promise<Buffer> }).sendRequest = jest.fn().mockResolvedValue(frame)
  }

  it('returns id bytes and hex on success', async () => {
    stub(rtuFrame(ModbusFunctionCode.DEBUG_GET_BOARD_ID, ModbusDebugResponse.SUCCESS, [0x03, 0x0a, 0xbc, 0x01]))
    const result = await client.getBoardId()
    expect(result.success).toBe(true)
    expect(Array.from(result.boardId!)).toEqual([0x0a, 0xbc, 0x01])
    expect(result.boardIdHex).toBe('0abc01')
  })

  it('handles id_len = 0 as success with empty id', async () => {
    stub(rtuFrame(ModbusFunctionCode.DEBUG_GET_BOARD_ID, ModbusDebugResponse.SUCCESS, [0x00]))
    const result = await client.getBoardId()
    expect(result.success).toBe(true)
    expect(result.boardIdHex).toBe('')
  })

  it('returns error on function code mismatch', async () => {
    stub(rtuFrame(0x99, ModbusDebugResponse.SUCCESS, [0x00]))
    const result = await client.getBoardId()
    expect(result.success).toBe(false)
    expect(result.error).toBe('Function code mismatch')
  })

  it('returns error on too-short frame', async () => {
    // Frame with fewer than 9 bytes total.
    stub(Buffer.alloc(8))
    const result = await client.getBoardId()
    expect(result.success).toBe(false)
    expect(result.error).toContain('too short')
  })

  it('returns error when sendRequest throws', async () => {
    ;(client as unknown as { sendRequest: () => Promise<Buffer> }).sendRequest = jest
      .fn()
      .mockRejectedValue(new Error('boom'))
    const result = await client.getBoardId()
    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
  })
})

describe('ModbusTcpClient.getBoardId', () => {
  let client: ModbusTcpClient

  beforeEach(() => {
    client = new ModbusTcpClient({ host: 'h', port: 502, timeout: 100 })
    // Pretend the socket is connected.
    ;(client as unknown as { socket: object }).socket = {}
  })

  const stub = (frame: Buffer) => {
    ;(client as unknown as { sendTcpRequest: () => Promise<Buffer> }).sendTcpRequest = jest
      .fn()
      .mockResolvedValue(frame)
  }

  it('returns error when not connected', async () => {
    ;(client as unknown as { socket: null }).socket = null
    const result = await client.getBoardId()
    expect(result.success).toBe(false)
    expect(result.error).toBe('Not connected to target')
  })

  it('returns id bytes and hex on success', async () => {
    // First call increments the transaction id to 1.
    stub(tcpFrame(1, ModbusFunctionCode.DEBUG_GET_BOARD_ID, ModbusDebugResponse.SUCCESS, [0x03, 0xde, 0xad, 0xbe]))
    const result = await client.getBoardId()
    expect(result.success).toBe(true)
    expect(Array.from(result.boardId!)).toEqual([0xde, 0xad, 0xbe])
    expect(result.boardIdHex).toBe('deadbe')
  })

  it('returns error on transaction id mismatch', async () => {
    stub(tcpFrame(99, ModbusFunctionCode.DEBUG_GET_BOARD_ID, ModbusDebugResponse.SUCCESS, [0x00]))
    const result = await client.getBoardId()
    expect(result.success).toBe(false)
    expect(result.error).toBe('Transaction ID mismatch')
  })

  it('returns error on too-short frame', async () => {
    stub(Buffer.alloc(8))
    const result = await client.getBoardId()
    expect(result.success).toBe(false)
    expect(result.error).toContain('too short')
  })

  it('returns error when sendTcpRequest throws', async () => {
    ;(client as unknown as { sendTcpRequest: () => Promise<Buffer> }).sendTcpRequest = jest
      .fn()
      .mockRejectedValue(new Error('boom'))
    const result = await client.getBoardId()
    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
  })
})

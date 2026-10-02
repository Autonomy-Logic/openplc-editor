/**
 * FC 0x4e replies grow with the number of tasks, so a link can deliver one in
 * pieces, and a board with many tasks answers a page at a time. Both clients
 * must gather each whole reply, and ask for every page.
 */

import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:net'

import { ModbusTcpClient } from '../modbus-client'
import { ModbusRtuClient } from '../modbus-rtu-client'

const u32 = (value: number): number[] => [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]

/** Task names on the board, and a page of them as the firmware encodes it (version 2). */
const TASKS = ['MAINTASK', 'NET_TASK', 'SLOW', 'LOGGER', 'ALARMS']
const PAGE_SIZE = 3

function page(first: number): Buffer {
  const tasks = TASKS.slice(first, first + PAGE_SIZE)
  return Buffer.from([
    0x4e,
    0x7e,
    2,
    TASKS.length,
    first,
    tasks.length,
    ...tasks.flatMap((name, i) => [
      name.length,
      ...Buffer.from(name),
      ...[first + i + 1, 0, 1, 2, 3, 4, 5, 6, 7, 2048, 0, 10_000].flatMap(u32),
    ]),
    2,
    ...[1, 0, 2, 3, 0, 4].flatMap(u32),
    ...[1, 2, 3, 10_000, 0].flatMap(u32),
  ])
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('ModbusTcpClient.getTaskStats', () => {
  let server: Server
  let port = 0
  let requests: number[][]

  beforeEach(async () => {
    requests = []
    server = createServer((socket) => {
      socket.on('data', (request) => {
        // [MBAP:6][unit][FC][flags][first]
        requests.push(Array.from(request.subarray(7)))
        const pdu = page(request.readUInt8(9))
        const header = Buffer.alloc(7)
        header.writeUInt16BE(request.readUInt16BE(0), 0)
        header.writeUInt16BE(0, 2)
        header.writeUInt16BE(1 + pdu.length, 4)
        header.writeUInt8(0, 6)
        const reply = Buffer.concat([new Uint8Array(header), new Uint8Array(pdu)])
        // Three segments, the first ending inside the MBAP header, with gaps.
        socket.write(new Uint8Array(reply.subarray(0, 3)))
        void sleep(15).then(() => socket.write(new Uint8Array(reply.subarray(3, 20))))
        void sleep(30).then(() => socket.write(new Uint8Array(reply.subarray(20))))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    port = typeof address === 'object' && address !== null ? address.port : 0
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('waits for each whole reply the MBAP length announces, and reads every page', async () => {
    const client = new ModbusTcpClient({ host: '127.0.0.1', port, timeout: 1000 })
    await client.connect()
    const result = await client.getTaskStats(true)
    client.disconnect()
    expect(result.error).toBeUndefined()
    expect(result.stats?.tasks.map((task) => task.name)).toEqual(TASKS)
    expect(requests).toEqual([
      [0x4e, 1, 0],
      [0x4e, 1, 3],
    ])
  })
})

/** The status every firmware answers: [FC][SUCCESS][running][tick:4][uptime:4]. */
const STATUS = Buffer.from([0x46, 0x7e, 1, 0, 0, 0, 1, 0, 0, 0, 1])

/** A serial board: answers a statistics request with `reply(first)` after
 *  `replyDelayMs`, its status with `status`, or either not at all. */
class FakeSerialPort extends EventEmitter {
  isOpen = false
  requests: number[][] = []
  reply: (first: number) => Buffer | null = (first) => page(first)
  replyDelayMs = 0
  status: Buffer | null = STATUS

  open() {
    this.isOpen = true
    this.emit('open')
  }

  write(data: Uint8Array, callback?: (err?: Error | null) => void) {
    callback?.(null)
    // Statistics: [id][FC][flags][first][crc:2]; status: [id][FC][crc:2].
    const isStatus = data[1] === 0x46
    this.requests.push(Array.from(data.subarray(1, isStatus ? 2 : 4)))
    const pdu = isStatus ? this.status : this.reply(data[3])
    if (!pdu) return
    // [id][PDU][crc:2], in two chunks with a gap longer than the idle timeout.
    const frame = Buffer.concat([new Uint8Array([1]), new Uint8Array(pdu), new Uint8Array([0, 0])])
    const delay = isStatus ? 0 : this.replyDelayMs
    setTimeout(() => this.emit('data', frame.subarray(0, Math.min(30, frame.length))), delay)
    if (frame.length > 30) void sleep(delay + 25).then(() => this.emit('data', frame.subarray(30)))
  }

  flush(callback?: (err?: Error | null) => void) {
    callback?.(null)
  }
}

async function rtuClient(serialPort: FakeSerialPort, timeout = 500): Promise<ModbusRtuClient> {
  const client = new ModbusRtuClient({ port: 'x', baudRate: 115200, slaveId: 1, timeout, serialPort })
  await client.connect()
  return client
}

describe('ModbusRtuClient.getTaskStats', () => {
  it('reads each page to the end its task names announce, across a gap in the serial stream', async () => {
    const serialPort = new FakeSerialPort()
    const client = await rtuClient(serialPort)
    const result = await client.getTaskStats(true)
    expect(result.error).toBeUndefined()
    expect(result.stats?.tasks.map((task) => task.name)).toEqual(TASKS)
    expect(serialPort.requests).toEqual([
      [0x4e, 1, 0],
      [0x4e, 1, 3],
    ])
  })

  it('takes an exception reply as a board not in RTOS mode', async () => {
    const serialPort = new FakeSerialPort()
    serialPort.reply = () => Buffer.from([0xce, 0x01])
    const client = await rtuClient(serialPort)
    expect(await client.getTaskStats()).toMatchObject({ success: false, unsupported: true })
  })

  it('takes a board that answers its status but never the statistics as not in RTOS mode', async () => {
    const serialPort = new FakeSerialPort()
    serialPort.reply = () => null
    const client = await rtuClient(serialPort, 300)
    const result = await client.getTaskStats()
    expect(result).toMatchObject({ success: false, unsupported: true })
    expect(serialPort.requests).toEqual([[0x4e, 0, 0], [0x46]])
  })

  it('takes a board that answers nothing as busy, to retry, never as not in RTOS mode', async () => {
    // A board in RTOS mode whose only core a task keeps busy answers every
    // request late; silence says nothing about which firmware it runs.
    const serialPort = new FakeSerialPort()
    serialPort.reply = () => null
    serialPort.status = null
    const client = await rtuClient(serialPort, 300)
    const result = await client.getTaskStats()
    expect(result.success).toBe(false)
    expect(result.unsupported).toBeUndefined()
    expect(result.error).toMatch(/timeout/i)
  })

  it('waits for a late reply as long as for any other request', async () => {
    const serialPort = new FakeSerialPort()
    serialPort.replyDelayMs = 1200
    const client = await rtuClient(serialPort, 2000)
    const result = await client.getTaskStats()
    expect(result.error).toBeUndefined()
    expect(result.stats?.tasks.map((task) => task.name)).toEqual(TASKS)
  })

  it('takes a lost second page as a failure, to retry, though the board never answered before', async () => {
    const serialPort = new FakeSerialPort()
    serialPort.reply = (first) => (first === 0 ? page(0) : null)
    const client = await rtuClient(serialPort, 300)
    const result = await client.getTaskStats()
    expect(result.success).toBe(false)
    expect(result.unsupported).toBeUndefined()
    expect(result.error).toBe('Request timeout')
  })

  it('takes silence from a board that has answered before as a failure, to retry', async () => {
    const serialPort = new FakeSerialPort()
    const client = await rtuClient(serialPort, 300)
    expect((await client.getTaskStats()).success).toBe(true)
    serialPort.reply = () => null
    const result = await client.getTaskStats()
    expect(result.success).toBe(false)
    expect(result.unsupported).toBeUndefined()
    expect(result.error).toBe('Request timeout')
  })
})

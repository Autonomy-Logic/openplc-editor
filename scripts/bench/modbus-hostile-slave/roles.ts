import net from 'node:net'
import { Duplex } from 'node:stream'

import { FC, readRequestPdu, rtuAdu, takeTcpFrames, tcpAdu } from './frames'
import { ClientRole, Clock, Log } from './scenario'

/** A board endpoint given on the command line. */
export type Endpoint = { host: string; port: number }

/** Unit id of the board's debugger on its default UART. */
export const DEBUGGER_UNIT = 1

/** Registers read by the client role: %QW0..%QW9, holding registers 0 to 9 of the board's server. */
const CLIENT_READ = { address: 0, quantity: 10 }

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

/** AS-04 row 1: Modbus TCP client that reads holding registers 0-9 of the board's server, reconnecting on demand. */
export function tcpClientRole(board: Endpoint, log: Log): ClientRole & { close: () => void } {
  let socket: net.Socket | null = null
  let connected = false
  let outbox: Buffer[] = []
  let tid = 0
  let pending = Buffer.alloc(0)

  const open = (): net.Socket => {
    const created = net.connect({ host: board.host, port: board.port })
    created.on('connect', () => {
      connected = true
      log({ event: 'connected', host: board.host, port: board.port, localPort: created.localPort })
      outbox.splice(0).forEach((frame) => created.write(frame))
    })
    created.on('data', (chunk: Buffer) => {
      log({ event: 'rx', hex: hex(chunk) })
      const taken = takeTcpFrames(Buffer.concat([pending, chunk]))
      pending = taken.rest
      taken.frames.forEach((frame) => {
        const fc = frame.pdu[0]
        const response = { event: 'response', tid: frame.tid, unit: frame.unit, fc }
        if (fc !== FC.readHoldingRegisters) {
          log({ ...response, hex: hex(frame.pdu) })
          return
        }
        const count = frame.pdu.length >= 2 ? frame.pdu[1] : -1
        if (count % 2 !== 0 || count !== frame.pdu.length - 2) {
          log({ ...response, malformed: true, hex: hex(frame.pdu) })
          return
        }
        const values = Array.from({ length: count >> 1 }, (_, index) => frame.pdu.readUInt16BE(2 + index * 2))
        log({ ...response, values, hex: hex(frame.pdu) })
      })
    })
    created.on('error', (error: NodeJS.ErrnoException) =>
      log({ event: 'error', code: error.code, message: error.message }),
    )
    created.on('close', () => {
      log({ event: 'closed', localPort: created.localPort })
      if (socket === created) {
        socket = null
        connected = false
        outbox = []
        pending = Buffer.alloc(0)
      }
    })
    return created
  }

  return {
    request: () => {
      tid = (tid + 1) & 0xffff
      const frame = tcpAdu(
        { tid, unit: 1 },
        readRequestPdu(FC.readHoldingRegisters, CLIENT_READ.address, CLIENT_READ.quantity),
      )
      log({ event: 'request', tid, unit: 1, fc: FC.readHoldingRegisters, ...CLIENT_READ })
      log({ event: 'tx', hex: hex(frame) })
      socket = socket ?? open()
      if (connected) {
        socket.write(frame)
      } else {
        outbox.push(frame)
      }
    },
    close: () => {
      socket?.destroy()
      socket = null
    },
  }
}

/** AS-04 rows 2 and 3: requests written on a second serial line, every byte received logged. */
export function serialClientRole(
  stream: Duplex,
  frame: Buffer,
  describe: Record<string, unknown>,
  log: Log,
): ClientRole {
  stream.on('data', (chunk: Buffer) => log({ event: 'rx', hex: hex(chunk) }))
  return {
    request: () => {
      log({ event: 'request', ...describe })
      log({ event: 'tx', hex: hex(frame) })
      stream.write(frame)
    },
  }
}

/** The RTU frame of a debugger read (FC 0x44) of the given `arr:elem` debug addresses, to the debugger's unit id. */
export function debuggerReadFrame(addresses: ReadonlyArray<{ arr: number; elem: number }>): Buffer {
  const pdu = Buffer.alloc(3 + addresses.length * 3)
  pdu.writeUInt8(FC.debugGetList, 0)
  pdu.writeUInt16BE(addresses.length, 1)
  addresses.forEach(({ arr, elem }, index) => {
    pdu.writeUInt8(arr, 3 + index * 3)
    pdu.writeUInt16BE(elem, 4 + index * 3)
  })
  return rtuAdu(DEBUGGER_UNIT, pdu)
}

/** The RTU frame of a read of holding registers 0-9 of the board's RTU server at `unit`. */
export function rtuMasterReadFrame(unit: number): Buffer {
  return rtuAdu(unit, readRequestPdu(FC.readHoldingRegisters, CLIENT_READ.address, CLIENT_READ.quantity))
}

/** Timing of the connection holder. */
export const ATTACKER_TIMING = { connectTimeoutMs: 3_000, retryMs: 250 }

/**
 * The `attacker` role: opens connections to `target` one after another and holds each one. In `hold` mode (AS-08)
 * it never stops. In `saturate` mode (AS-13) it stops at the first attempt that gets no SYN-ACK after one that did,
 * and releases every held connection `releaseAfterMs` later.
 */
export function startAttacker(options: {
  target: Endpoint
  mode: 'hold' | 'saturate'
  releaseAfterMs: number
  clock: Clock
  log: Log
}): { stop: () => void } {
  const { target, clock, log } = options
  const held = new Set<net.Socket>()
  let stopped = false
  let saturated = false
  let lastSynAckUs: number | null = null
  let timer: unknown = null

  const schedule = (ms: number, callback: () => void): void => {
    timer = clock.setTimeout(() => {
      timer = null
      callback()
    }, ms)
  }

  const release = (): void => {
    log({ event: 'phase', phase: 'released', connections: held.size })
    held.forEach((socket) => socket.destroy())
    held.clear()
  }

  const attempt = (): void => {
    if (stopped || saturated) {
      return
    }
    const socket = net.connect({ host: target.host, port: target.port })
    let established = false
    socket.setTimeout(ATTACKER_TIMING.connectTimeoutMs, () => {
      if (!established) {
        const error: NodeJS.ErrnoException = new Error('connect timed out')
        error.code = 'ETIMEDOUT'
        socket.destroy(error)
      }
    })
    socket.on('connect', () => {
      established = true
      socket.setTimeout(0)
      lastSynAckUs = clock.nowUs()
      held.add(socket)
      log({ event: 'connected', host: target.host, port: target.port, localPort: socket.localPort, held: held.size })
      schedule(0, attempt)
    })
    socket.on('data', (chunk: Buffer) => log({ event: 'rx', localPort: socket.localPort, hex: hex(chunk) }))
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (established) {
        log({ event: 'error', localPort: socket.localPort, code: error.code })
        return
      }
      log({ event: 'connect-failed', code: error.code })
      if (options.mode === 'saturate' && lastSynAckUs !== null) {
        saturated = true
        log({ event: 'phase', phase: 'saturated', last_syn_ack_us: lastSynAckUs, connections: held.size })
        schedule(options.releaseAfterMs, release)
      } else {
        schedule(ATTACKER_TIMING.retryMs, attempt)
      }
    })
    socket.on('close', () => {
      if (established && held.delete(socket)) {
        log({ event: 'closed', localPort: socket.localPort, held: held.size })
      }
    })
  }

  log({ event: 'phase', phase: options.mode === 'hold' ? 'hold' : 'saturate', host: target.host, port: target.port })
  attempt()
  return {
    stop: () => {
      stopped = true
      if (timer !== null) {
        clock.clearTimeout(timer)
      }
      held.forEach((socket) => socket.destroy())
      held.clear()
    },
  }
}

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import {
  freePort,
  isLogLine,
  LogLine,
  readLog,
  REPO_ROOT,
  RunningCli,
  startCli,
  TcpMaster,
  waitForListening,
  waitForLog,
} from './helpers/cli'
import {
  GROUPS,
  hex,
  range,
  readPdu,
  registersAnswerPdu,
  tcpFrame,
  tcpRead,
  tcpRegistersAnswer,
} from './helpers/modbus'

const workDir = mkdtempSync(path.join(os.tmpdir(), 'modbus-hostile-slave-'))

after(() => {
  rmSync(workDir, { recursive: true, force: true })
})

/** Starts the CLI listening on an ephemeral loopback port and returns it with its port and log file. */
async function listen(name: string, args: readonly string[]): Promise<{ cli: RunningCli; port: number; log: string }> {
  const log = path.join(workDir, `${name}.jsonl`)
  const cli = startCli([...args, '--tcp-listen', '127.0.0.1:0', '--log', log])
  const port = await waitForListening(cli, log)
  return { cli, port, log }
}

describe('normal scenario over loopback TCP, register map from --map', { timeout: 60_000 }, () => {
  let cli: RunningCli
  let master: TcpMaster

  before(async () => {
    const map = path.join(workDir, 'map.json')
    writeFileSync(
      map,
      JSON.stringify({
        coils: { '0': 1, '1': 0, '2': 1 },
        discreteInputs: { '0': 0, '1': 1 },
        holdingRegisters: { '0': 1234, '1': 65535 },
        inputRegisters: { '0': 42, '1': 7 },
      }),
    )
    const started = await listen('normal', ['--scenario', 'normal', '--map', map])
    cli = started.cli
    master = await TcpMaster.connect(started.port)
  })

  after(async () => {
    await master?.close()
    await cli?.stop()
  })

  async function ask(transactionId: number, pdu: Buffer): Promise<string> {
    master.send(tcpFrame(transactionId, pdu))
    return hex(await master.readFrame())
  }

  test('FC 1 reads the coils of the map', async () => {
    assert.equal(await ask(1, readPdu(1, 0, 3)), hex(tcpFrame(1, Buffer.from([0x01, 0x01, 0x05]))))
  })

  test('FC 2 reads the discrete inputs of the map', async () => {
    assert.equal(await ask(2, readPdu(2, 0, 2)), hex(tcpFrame(2, Buffer.from([0x02, 0x01, 0x02]))))
  })

  test('FC 3 reads the holding registers of the map', async () => {
    assert.equal(await ask(3, readPdu(3, 0, 2)), hex(tcpFrame(3, registersAnswerPdu([1234, 65535]))))
  })

  test('FC 4 reads the input registers of the map', async () => {
    assert.equal(await ask(4, readPdu(4, 0, 2)), hex(tcpFrame(4, registersAnswerPdu([42, 7], 4))))
  })

  test('FC 5 echoes the write and the coil reads back on', async () => {
    const write = Buffer.from([0x05, 0x00, 0x03, 0xff, 0x00])
    assert.equal(await ask(5, write), hex(tcpFrame(5, write)))
    assert.equal(await ask(6, readPdu(1, 3, 1)), hex(tcpFrame(6, Buffer.from([0x01, 0x01, 0x01]))))
  })

  test('FC 6 echoes the write and the register reads back', async () => {
    const write = Buffer.from([0x06, 0x00, 0x02, 0x11, 0x11])
    assert.equal(await ask(7, write), hex(tcpFrame(7, write)))
    assert.equal(await ask(8, readPdu(3, 2, 1)), hex(tcpFrame(8, registersAnswerPdu([0x1111]))))
  })

  test('FC 15 answers address and quantity and the coils read back', async () => {
    const write = Buffer.from([0x0f, 0x00, 0x08, 0x00, 0x03, 0x01, 0x05])
    assert.equal(await ask(9, write), hex(tcpFrame(9, Buffer.from([0x0f, 0x00, 0x08, 0x00, 0x03]))))
    assert.equal(await ask(10, readPdu(1, 8, 3)), hex(tcpFrame(10, Buffer.from([0x01, 0x01, 0x05]))))
  })

  test('FC 16 answers address and quantity and the registers read back', async () => {
    const write = Buffer.from([0x10, 0x00, 0x04, 0x00, 0x02, 0x04, 0xab, 0xcd, 0x01, 0x02])
    assert.equal(await ask(11, write), hex(tcpFrame(11, Buffer.from([0x10, 0x00, 0x04, 0x00, 0x02]))))
    assert.equal(await ask(12, readPdu(3, 4, 2)), hex(tcpFrame(12, registersAnswerPdu([0xabcd, 0x0102]))))
  })
})

describe('script log (--log) of a loopback session', { timeout: 60_000 }, () => {
  let lines: LogLine[]
  let port: number
  let clientPort: number
  let exit: { code: number | null; signal: NodeJS.Signals | null }
  const requests = [tcpRead(1, GROUPS.g1), tcpFrame(2, Buffer.from([0x06, 0x00, 0x02, 0x11, 0x11]))]
  const answers: Buffer[] = []

  before(async () => {
    const started = await listen('log', ['--scenario', 'normal'])
    port = started.port
    const master = await TcpMaster.connect(port)
    clientPort = master.socket.localPort ?? -1
    for (const request of requests) {
      master.send(request)
      answers.push(await master.readFrame())
    }
    await master.close()
    await waitForLog(started.log, (current) => current.some((line) => line.event === 'closed'))
    exit = await started.cli.stop()
    lines = readLog(started.log)
  })

  test('SIGTERM stops the tool with exit code 0', () => {
    assert.deepEqual(exit, { code: 0, signal: null })
  })

  test('every line carries an integer microsecond timestamp t_us', () => {
    assert.ok(lines.length > 0)
    assert.ok(
      lines.every((line) => Number.isInteger(line.t_us) && Number(line.t_us) >= 0),
      JSON.stringify(lines),
    )
  })

  test('timestamps never go back and grow over the session', () => {
    const stamps = lines.map((line) => Number(line.t_us))
    assert.ok(
      stamps.every((stamp, index) => index === 0 || stamp >= stamps[index - 1]),
      stamps.join(', '),
    )
    assert.ok(stamps[stamps.length - 1] > stamps[0])
  })

  test('logs listening once, with the bound port', () => {
    const listening = lines.filter((line) => line.event === 'listening')
    assert.equal(listening.length, 1)
    assert.equal(listening[0].port, port)
  })

  test("logs the connection accepted and closed with the client's port", () => {
    const accepted = lines.filter((line) => line.event === 'accepted')
    const closed = lines.filter((line) => line.event === 'closed')
    assert.deepEqual(
      accepted.map((line) => line.peerPort),
      [clientPort],
    )
    assert.deepEqual(
      closed.map((line) => line.peerPort),
      [clientPort],
    )
  })

  test('logs one request line per request, decoded', () => {
    const decoded = lines
      .filter((line) => line.event === 'request')
      .map(({ tid, unit, fc, address }) => ({ tid, unit, fc, address }))
    assert.deepEqual(decoded, [
      { tid: 1, unit: 1, fc: 3, address: 0 },
      { tid: 2, unit: 1, fc: 6, address: 2 },
    ])
    assert.equal(lines.find((line) => line.event === 'request')?.quantity, 10)
  })

  test('logs every byte received and sent as hex', () => {
    const joined = (event: string) =>
      lines
        .filter((line) => line.event === event)
        .map((line) => String(line.hex).toLowerCase())
        .join('')
    assert.equal(joined('rx'), requests.map(hex).join(''))
    assert.equal(joined('tx'), answers.map(hex).join(''))
  })
})

describe('AS-03 ordering on loopback TCP', { timeout: 60_000 }, () => {
  test("answers G3 with 23130, then on G2's request sends G1's response before G2's", async () => {
    const { cli, port } = await listen('as-03', ['--scenario', 'AS-03'])
    try {
      const master = await TcpMaster.connect(port)
      master.send(tcpRead(1, GROUPS.g3))
      assert.equal(hex(await master.readFrame()), hex(tcpRegistersAnswer(1, [23130])))
      master.send(tcpRead(2, GROUPS.g1))
      master.send(tcpRead(3, GROUPS.g2Pair))
      assert.equal(hex(await master.readFrame()), hex(tcpRegistersAnswer(2, range(1111, 1120))))
      assert.equal(hex(await master.readFrame()), hex(tcpRegistersAnswer(3, [3333, 4444])))
      await master.close()
    } finally {
      await cli.stop()
    }
  })
})

describe('AS-07 with --duration-scale on loopback TCP', { timeout: 60_000 }, () => {
  test('floods 0xFF for the scaled 60 s and then answers 4321, 8765', async () => {
    const { cli, port } = await listen('as-07', ['--scenario', 'AS-07', '--duration-scale', '0.001'])
    try {
      const master = await TcpMaster.connect(port)
      master.send(tcpRead(1, GROUPS.g1))
      assert.ok((await master.skipWhile(0xff)) > 0, 'no 0xFF before the answer')
      assert.equal(hex(await master.readFrame()), hex(tcpRegistersAnswer(1, [4321, 8765])))
      await master.close()
    } finally {
      await cli.stop()
    }
  })
})

describe('AS-04 row 1 with the client role against --board', { timeout: 60_000 }, () => {
  test("reads the board's holding registers 0-9 before each G1 answer, 200 ms late, counter +1 per poll", async () => {
    const boardReads: Array<{ fc: number; address: number; quantity: number }> = []
    const board = net.createServer((socket) => {
      let pending = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 6 && pending.length >= 6 + pending.readUInt16BE(4)) {
          const frame = pending.subarray(0, 6 + pending.readUInt16BE(4))
          pending = pending.subarray(frame.length)
          const quantity = frame.readUInt16BE(10)
          boardReads.push({ fc: frame[7], address: frame.readUInt16BE(8), quantity })
          socket.write(tcpRegistersAnswer(frame.readUInt16BE(0), new Array<number>(quantity).fill(0)))
        }
      })
    })
    const boardPort = await freePort()
    await new Promise<void>((resolve) => board.listen(boardPort, '127.0.0.1', resolve))
    let cli: RunningCli | null = null
    try {
      const started = await listen('as-04', ['--scenario', 'AS-04', '--row', '1', '--board', `127.0.0.1:${boardPort}`])
      cli = started.cli
      const master = await TcpMaster.connect(started.port)
      const counters: number[] = []
      for (let poll = 1; poll <= 3; poll += 1) {
        const sentAt = performance.now()
        master.send(tcpRead(poll, GROUPS.g1))
        const answer = await master.readFrame()
        const elapsed = performance.now() - sentAt
        assert.ok(elapsed >= 190, `poll ${poll} answered after ${elapsed.toFixed(0)} ms`)
        assert.equal(hex(answer.subarray(0, 9)), hex(tcpRegistersAnswer(poll, range(1, 10)).subarray(0, 9)))
        assert.deepEqual(boardReads.slice(poll - 1, poll), [{ fc: 3, address: 0, quantity: 10 }])
        counters.push(answer.readUInt16BE(9))
      }
      assert.deepEqual(counters, [counters[0], counters[0] + 1, counters[0] + 2])
      await master.close()
    } finally {
      await cli?.stop()
      await new Promise<void>((resolve) => board.close(() => resolve()))
    }
  })
})

describe('AS-04 row 1 client given a short FC 3 answer by the board', { timeout: 60_000 }, () => {
  const SHORT_ANSWER = Buffer.from('0001000000050103140001', 'hex')
  let lines: LogLine[] = []
  let aliveAfterShortAnswer = false
  let boardConnections = 0
  let boardRequests = 0
  let exit: { code: number | null; signal: NodeJS.Signals | null } = { code: null, signal: null }

  before(async () => {
    const board = net.createServer((socket) => {
      boardConnections += 1
      let pending = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 6 && pending.length >= 6 + pending.readUInt16BE(4)) {
          const frame = pending.subarray(0, 6 + pending.readUInt16BE(4))
          pending = pending.subarray(frame.length)
          boardRequests += 1
          socket.write(boardRequests === 1 ? SHORT_ANSWER : tcpRegistersAnswer(frame.readUInt16BE(0), range(1, 10)))
        }
      })
    })
    const boardPort = await freePort()
    await new Promise<void>((resolve) => board.listen(boardPort, '127.0.0.1', resolve))
    try {
      const started = await listen('as-04-short', [
        '--scenario',
        'AS-04',
        '--row',
        '1',
        '--board',
        `127.0.0.1:${boardPort}`,
      ])
      const responses = (current: LogLine[]): LogLine[] => current.filter((line) => line.event === 'response')
      try {
        const master = await TcpMaster.connect(started.port)
        master.send(tcpRead(1, GROUPS.g1))
        await waitForLog(started.log, (current) => responses(current).length >= 1)
        aliveAfterShortAnswer = started.cli.child.exitCode === null && started.cli.child.signalCode === null
        await master.readFrame()
        master.send(tcpRead(2, GROUPS.g1))
        await master.readFrame()
        await waitForLog(started.log, (current) => responses(current).length >= 2)
        await master.close()
      } catch {
        aliveAfterShortAnswer = aliveAfterShortAnswer && started.cli.child.exitCode === null
      }
      exit = await started.cli.stop()
      lines = readLog(started.log)
    } finally {
      await new Promise<void>((resolve) => board.close(() => resolve()))
    }
  })

  test('keeps running after the short answer', () => {
    assert.equal(aliveAfterShortAnswer, true)
  })

  test('logs the short answer as malformed, with the PDU hex and no values', () => {
    const first = lines.find((line) => line.event === 'response')
    assert.deepEqual(first && { malformed: first.malformed, hex: first.hex, hasValues: 'values' in first }, {
      malformed: true,
      hex: '03140001',
      hasValues: false,
    })
  })

  test('keeps its one connection to the board and reads the board again', () => {
    assert.deepEqual({ boardConnections, boardRequests }, { boardConnections: 1, boardRequests: 2 })
  })

  test('still logs the values of a well-formed answer', () => {
    const decoded = lines.filter((line) => line.event === 'response' && Array.isArray(line.values))
    assert.deepEqual(
      decoded.map((line) => line.values),
      [range(1, 10)],
    )
  })

  test('writes its stopped line and exits 0 on SIGTERM', () => {
    assert.deepEqual(
      { exit, stopped: lines.some((line) => line.event === 'stopped') },
      { exit: { code: 0, signal: null }, stopped: true },
    )
  })
})

describe('CLI boundaries', { timeout: 60_000 }, () => {
  test(
    'binds only to the address given: 127.0.0.2 is refused while 127.0.0.1 listens',
    { skip: process.platform !== 'linux' },
    async () => {
      const { cli, port } = await listen('bind', ['--scenario', 'normal'])
      try {
        const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
          const socket = net.connect({ host: '127.0.0.2', port }, () => {
            socket.destroy()
            resolve(null)
          })
          socket.once('error', resolve)
        })
        assert.equal(error?.code, 'ECONNREFUSED')
      } finally {
        await cli.stop()
      }
    },
  )

  test('refuses an unknown scenario, naming it, with a non-zero exit and never listens', async () => {
    const log = path.join(workDir, 'unknown.jsonl')
    const cli = startCli(['--scenario', 'AS-99', '--tcp-listen', '127.0.0.1:0', '--log', log])
    const exit = await cli.exited
    assert.notEqual(exit.code, 0)
    assert.match(cli.stderr, /AS-99/)
    assert.equal(
      readLog(log).some((line) => line.event === 'listening'),
      false,
    )
  })

  test('refuses TC10 over TCP with exit code 2, saying it does not run over TCP', async () => {
    const cli = startCli(['--scenario', 'TC10', '--row', '1', '--tcp-listen', '127.0.0.1:0'])
    const exit = await cli.exited
    assert.deepEqual({ code: exit.code, overTcp: /does not run over TCP/.test(cli.stderr) }, { code: 2, overTcp: true })
  })

  test('refuses TC10 row 4 with exit code 2, naming the rows 1..3', async () => {
    const port = path.join(workDir, 'no-such-port')
    const cli = startCli(['--scenario', 'TC10', '--row', '4', '--serial', port, '--baud', '9600'])
    const exit = await cli.exited
    assert.deepEqual({ code: exit.code, rows: /--row 1\.\.3/.test(cli.stderr) }, { code: 2, rows: true })
  })

  test("lists TC10 among the known scenarios in an unknown scenario's message", async () => {
    const cli = startCli(['--scenario', 'AS-99', '--tcp-listen', '127.0.0.1:0'])
    await cli.exited
    assert.match(cli.stderr, /known scenarios: .*\bTC10\b/)
  })

  test('package.json wires bench:hostile-slave to the CLI and test:bench to these tests', () => {
    const manifest: unknown = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))
    const scripts = isLogLine(manifest) && isLogLine(manifest.scripts) ? manifest.scripts : {}
    assert.match(String(scripts['bench:hostile-slave'] ?? ''), /scripts\/bench\/modbus-hostile-slave\/cli\.ts/)
    assert.match(String(scripts['test:bench'] ?? ''), /--require ts-node\/register --test/)
    assert.match(String(scripts['test:bench'] ?? ''), /scripts\/bench\/modbus-hostile-slave\/__tests__\//)
  })
})

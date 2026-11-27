import assert from 'node:assert/strict'
import path from 'node:path'
import { afterEach, describe, test } from 'node:test'

import { loadRegisterMap } from '../registers'
import { checkScenario, createScenario, FLOOD_MS, runSlave, RunningSlave, ScenarioEngine } from '../scenario'
import { FakeClock, settle } from './helpers/fake-clock'
import { MemoryLink } from './helpers/memory-link'
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
import { OpenSlave, openSlave } from './helpers/slave'

let current: OpenSlave | null = null

function start(scenario: string, row?: number): OpenSlave {
  current = openSlave(scenario, 'tcp', row)
  return current
}

afterEach(() => {
  current?.stop()
  current = null
})

/** Plays AS-01's first step (G1 101..110, G2 23130), the baseline of AS-01 and AS-02, and checks both answers. */
async function playBaseline(slave: OpenSlave): Promise<void> {
  assert.equal(hex(await slave.link.exchange(tcpRead(1, GROUPS.g1))), hex(tcpRegistersAnswer(1, range(101, 110))))
  assert.equal(hex(await slave.link.exchange(tcpRead(2, GROUPS.g2))), hex(tcpRegistersAnswer(2, [23130])))
}

describe('AS-01 over TCP', () => {
  test('answers G1 with 101..110 and G2 with 23130 first', async () => {
    await playBaseline(start('AS-01'))
  })

  test('then answers G1 with MBAP length 65535 followed by 1000 bytes', async () => {
    const slave = start('AS-01')
    await playBaseline(slave)
    const answer = await slave.link.exchange(tcpRead(3, GROUPS.g1))
    assert.equal(hex(answer.subarray(0, 6)), '00030000ffff')
    assert.equal(answer.length, 6 + 1000)
  })

  test("then answers G1's next request with 501..510", async () => {
    const slave = start('AS-01')
    await playBaseline(slave)
    await slave.link.exchange(tcpRead(3, GROUPS.g1))
    assert.equal(hex(await slave.link.exchange(tcpRead(4, GROUPS.g1))), hex(tcpRegistersAnswer(4, range(501, 510))))
  })

  test('logs every request decoded with transaction id, unit id, FC, address and quantity', async () => {
    const slave = start('AS-01')
    await slave.link.exchange(tcpRead(7, GROUPS.g1))
    const requests = slave.events.filter((event) => event.event === 'request')
    assert.equal(requests.length, 1)
    const { tid, unit, fc, address, quantity } = requests[0]
    assert.deepEqual({ tid, unit, fc, address, quantity }, { tid: 7, unit: 1, fc: 3, address: 0, quantity: 10 })
  })

  test('logs the bytes received and sent as hex', async () => {
    const slave = start('AS-01')
    await slave.link.exchange(tcpRead(7, GROUPS.g1))
    const received = slave.events
      .filter((event) => event.event === 'rx')
      .map((event) => String(event.hex).toLowerCase())
    const sent = slave.events.filter((event) => event.event === 'tx').map((event) => String(event.hex).toLowerCase())
    assert.equal(received.join(''), hex(tcpRead(7, GROUPS.g1)))
    assert.equal(sent.join(''), hex(tcpRegistersAnswer(7, range(101, 110))))
  })
})

describe('AS-02 over TCP, after the baseline answers', () => {
  const rows: Array<{ row: number; rule: string; header: string; length: number }> = [
    { row: 1, rule: 'byte count 40, 40 data bytes, MBAP length 43', header: '00030000002b010328', length: 9 + 40 },
    { row: 2, rule: 'byte count 10, 10 data bytes, MBAP length 13', header: '00030000000d01030a', length: 9 + 10 },
    { row: 3, rule: 'byte count 20, only 6 data bytes, MBAP length 9', header: '000300000009010314', length: 9 + 6 },
    { row: 4, rule: 'MBAP length 23 then only 9 bytes', header: '000300000017010314', length: 6 + 9 },
    { row: 6, rule: 'a valid answer with transaction id + 1', header: '000400000017010314', length: 29 },
    { row: 7, rule: 'a valid answer with protocol id 0x0001', header: '000300010017010314', length: 29 },
    { row: 8, rule: 'a valid answer with unit id 2', header: '000300000017020314', length: 29 },
    { row: 9, rule: 'a valid answer with FC 0x04', header: '000300000017010414', length: 29 },
  ]

  for (const { row, rule, header, length } of rows) {
    test(`row ${row} answers G1 with ${rule}`, async () => {
      const slave = start('AS-02', row)
      await playBaseline(slave)
      const answer = await slave.link.exchange(tcpRead(3, GROUPS.g1))
      assert.equal(hex(answer.subarray(0, 9)), header)
      assert.equal(answer.length, length)
    })
  }

  test('row 4 stays silent after the 9 bytes', async () => {
    const slave = start('AS-02', 4)
    await playBaseline(slave)
    await slave.link.exchange(tcpRead(3, GROUPS.g1))
    await slave.clock.advance(10_000)
    assert.equal(slave.link.take().length, 0)
  })

  test("row 5 answers G1 with the exception frame 0x83 0x02 under G1's transaction id", async () => {
    const slave = start('AS-02', 5)
    await playBaseline(slave)
    const answer = await slave.link.exchange(tcpRead(3, GROUPS.g1))
    assert.equal(hex(answer), hex(tcpFrame(3, Buffer.from([0x83, 0x02]))))
  })
})

describe('AS-03 over TCP', () => {
  test('answers G3 once with 23130', async () => {
    const slave = start('AS-03')
    assert.equal(hex(await slave.link.exchange(tcpRead(1, GROUPS.g3))), hex(tcpRegistersAnswer(1, [23130])))
  })

  test('does not answer G1', async () => {
    const slave = start('AS-03')
    await slave.link.exchange(tcpRead(1, GROUPS.g3))
    assert.equal((await slave.link.exchange(tcpRead(2, GROUPS.g1), 5_000)).length, 0)
  })

  test("on G2's request sends G1's response (1111..1120) and then G2's response (3333, 4444)", async () => {
    const slave = start('AS-03')
    await slave.link.exchange(tcpRead(1, GROUPS.g3))
    await slave.link.exchange(tcpRead(2, GROUPS.g1), 5_000)
    const answer = await slave.link.exchange(tcpRead(3, GROUPS.g2Pair))
    assert.equal(
      hex(answer),
      hex(Buffer.concat([tcpRegistersAnswer(2, range(1111, 1120)), tcpRegistersAnswer(3, [3333, 4444])])),
    )
  })
})

describe('AS-06 over TCP', () => {
  test('sends the response one byte every 400 ms', async () => {
    const slave = start('AS-06')
    slave.link.stream.push(tcpRead(1, GROUPS.g1))
    await settle()
    for (let step = 0; step < 32; step += 1) {
      await slave.clock.advance(400)
    }
    const writes = slave.link.writes
    assert.ok(
      writes.every((write) => write.bytes.length === 1),
      `block sizes ${writes.map((w) => w.bytes.length)}`,
    )
    const intervals = writes.slice(1).map((write, index) => write.atMs - writes[index].atMs)
    assert.ok(
      intervals.every((interval) => Math.abs(interval - 400) <= 10),
      `intervals ${intervals.join(', ')}`,
    )
    assert.ok(writes[0].atMs <= 400, `first byte at ${writes[0].atMs} ms`)
  })

  test("the bytes sent one by one form a G1 answer under the request's transaction id", async () => {
    const slave = start('AS-06')
    slave.link.stream.push(tcpRead(1, GROUPS.g1))
    await settle()
    for (let step = 0; step < 32; step += 1) {
      await slave.clock.advance(400)
    }
    const answer = slave.link.all()
    assert.equal(answer.length, 29)
    assert.equal(hex(answer.subarray(0, 9)), '000100000017010314')
  })
})

describe('AS-07 over TCP', { timeout: 60_000 }, () => {
  test('floods 0xFF continuously from the first request', async () => {
    const slave = start('AS-07')
    slave.link.stream.push(tcpRead(1, GROUPS.g1))
    await slave.clock.advance(5)
    const first = slave.link.take()
    await slave.clock.advance(5)
    const second = slave.link.take()
    assert.ok(first.length > 0 && second.length > 0, `flood blocks ${first.length}, ${second.length}`)
    assert.ok(Buffer.concat([first, second]).every((byte) => byte === 0xff))
  })

  test('after 60 s stops the flood and answers 4321, 8765', async () => {
    const slave = start('AS-07')
    slave.link.stream.push(tcpRead(1, GROUPS.g1))
    await settle()
    await slave.clock.advance(59_000)
    assert.ok(
      slave.link.all().every((byte) => byte === 0xff),
      'answered before 60 s',
    )
    await slave.clock.advance(1_100)
    const all = slave.link.all()
    const answerStart = all.findIndex((byte) => byte !== 0xff)
    assert.ok(answerStart > 0, 'no 0xFF before the answer')
    assert.equal(hex(all.subarray(answerStart)), hex(tcpRegistersAnswer(1, [4321, 8765])))
    slave.link.take()
    await slave.clock.advance(100)
    assert.equal(slave.link.take().length, 0, 'flood still running after the answer')
  })
})

/** Duration scale of the multi-connection AS-07 tests: a 600 ms flood instead of 60 s. */
const SHORT_FLOOD_SCALE = 0.01

/** One scenario engine shared by several TCP connections, as the CLI runs it, on a virtual clock. */
class SharedEngine {
  readonly clock = new FakeClock()
  readonly events: Array<Record<string, unknown>> = []
  private readonly running: RunningSlave[] = []
  private readonly engine: ScenarioEngine

  constructor(scenario: string) {
    this.engine = createScenario({
      scenario,
      transport: 'tcp',
      log: this.log,
      clock: this.timers(),
      durationScale: SHORT_FLOOD_SCALE,
    })
  }

  private readonly log = (event: Record<string, unknown>): void => {
    this.events.push(event)
  }

  private timers() {
    return { nowUs: this.clock.nowUs, setTimeout: this.clock.setTimeout, clearTimeout: this.clock.clearTimeout }
  }

  /** Opens a new connection on the shared engine. */
  open(): { link: MemoryLink; close: () => void } {
    const link = new MemoryLink(this.clock)
    const slave = runSlave({
      scenario: 'AS-07',
      transport: 'tcp',
      stream: link.stream,
      engine: this.engine,
      log: this.log,
      clock: this.timers(),
      durationScale: SHORT_FLOOD_SCALE,
    })
    this.running.push(slave)
    return { link, close: () => slave.stop() }
  }

  stop(): void {
    this.running.forEach((slave) => slave.stop())
    this.engine.stop()
  }
}

const isFlood = (bytes: Buffer): boolean => bytes.length > 0 && bytes.every((byte) => byte === 0xff)

describe('AS-07 over TCP with reconnections', () => {
  let shared: SharedEngine | null = null

  function engine(): SharedEngine {
    shared = new SharedEngine('AS-07')
    return shared
  }

  afterEach(() => {
    shared?.stop()
    shared = null
  })

  test('floods the connection the board opens after closing the first one', async () => {
    const run = engine()
    const first = run.open()
    first.link.stream.push(tcpRead(1, GROUPS.g1))
    await run.clock.advance(5)
    first.close()
    const second = run.open()

    second.link.stream.push(tcpRead(2, GROUPS.g1))
    await run.clock.advance(100)

    assert.ok(isFlood(second.link.all()), `second connection got ${second.link.all().length} bytes`)
  })

  test('floods a connection attached during the window before it sends anything', async () => {
    const run = engine()
    const first = run.open()
    first.link.stream.push(tcpRead(1, GROUPS.g1))
    await run.clock.advance(5)

    const idle = run.open()
    await run.clock.advance(100)

    assert.ok(isFlood(idle.link.all()), `idle connection got ${idle.link.all().length} bytes`)
  })

  test('still logs a request made during the window as withheld', async () => {
    const run = engine()
    const first = run.open()
    first.link.stream.push(tcpRead(1, GROUPS.g1))
    await run.clock.advance(5)
    const second = run.open()

    second.link.stream.push(tcpRead(2, GROUPS.g1))
    await run.clock.advance(5)

    assert.deepEqual(
      run.events.filter((event) => event.event === 'withheld').map((event) => event.tid),
      [2],
    )
  })

  test('stops the flood on every connection when the window ends', async () => {
    const run = engine()
    const first = run.open()
    first.link.stream.push(tcpRead(1, GROUPS.g1))
    await run.clock.advance(5)
    first.close()
    const second = run.open()
    const idle = run.open()
    second.link.stream.push(tcpRead(2, GROUPS.g1))
    await run.clock.advance(FLOOD_MS * SHORT_FLOOD_SCALE + 50)
    second.link.take()
    idle.link.take()

    await run.clock.advance(100)

    assert.deepEqual(
      { second: second.link.take().length, idle: idle.link.take().length },
      { second: 0, idle: 0 },
      'the flood still runs after the window',
    )
  })

  test('answers the next G1 request on the second connection with 4321, 8765 after the window', async () => {
    const run = engine()
    const first = run.open()
    first.link.stream.push(tcpRead(1, GROUPS.g1))
    await run.clock.advance(5)
    first.close()
    const second = run.open()
    second.link.stream.push(tcpRead(2, GROUPS.g1))
    await run.clock.advance(FLOOD_MS * SHORT_FLOOD_SCALE + 50)

    const answer = await second.link.exchange(tcpRead(3, GROUPS.g1))

    assert.equal(hex(answer), hex(tcpRegistersAnswer(3, [4321, 8765])))
  })
})

/** The bench map TC28 runs with: holding registers 0 and 1 read 1234 and 5678. */
const TC28_MAP = path.resolve(__dirname, '../../modbus-master/maps/g1-1234-5678.json')

/** TC28's poll of one device: FC 3, two registers from offset 0, on `unit`. */
const tc28Read = (tid: number, unit: number, quantity = 2): Buffer => tcpFrame(tid, readPdu(3, 0, quantity), unit)

/** The answer of `unit` to a TC28 poll carrying `values`. */
const tc28Answer = (tid: number, unit: number, values: readonly number[]): Buffer =>
  tcpFrame(tid, registersAnswerPdu(values), unit)

/** The number of unit-1 FC 3 requests TC28 answers at once before it starts delaying them. */
const TC28_PROMPT_POLLS = 20

describe('TC28 over TCP: the slave 1 answers late after 20 prompt ones', () => {
  function startTc28(row: number, durationScale?: number): OpenSlave {
    current = openSlave('TC28', 'tcp', row, { map: loadRegisterMap(TC28_MAP), durationScale })
    return current
  }

  async function playPromptPolls(slave: OpenSlave): Promise<number> {
    let tid = 1
    for (let poll = 0; poll < TC28_PROMPT_POLLS; poll += 1) {
      await slave.link.exchange(tc28Read(tid, 1), 1)
      tid += 1
      await slave.link.exchange(tc28Read(tid, 2), 1)
      tid += 1
    }
    return tid
  }

  test('answers the first 20 unit-1 polls at once with the map, 1234 and 5678', async () => {
    const slave = startTc28(1)
    for (let tid = 1; tid <= TC28_PROMPT_POLLS; tid += 1) {
      assert.equal(hex(await slave.link.exchange(tc28Read(tid, 1), 1)), hex(tc28Answer(tid, 1, [1234, 5678])))
    }
  })

  for (const { row, delayMs } of [
    { row: 1, delayMs: 200 },
    { row: 2, delayMs: 500 },
  ]) {
    test(`row ${row} answers the 21st unit-1 poll ${delayMs} ms later with 4321, 8765, not before`, async () => {
      const slave = startTc28(row)
      const tid = await playPromptPolls(slave)
      const early = await slave.link.exchange(tc28Read(tid, 1), delayMs - 1)
      await slave.clock.advance(1)
      assert.deepEqual(
        { early: hex(early), onTime: hex(slave.link.take()) },
        { early: '', onTime: hex(tc28Answer(tid, 1, [4321, 8765])) },
      )
    })

    test(`row ${row} logs one phase event carrying the ${delayMs} ms delay`, async () => {
      const slave = startTc28(row)
      const tid = await playPromptPolls(slave)
      for (let poll = 0; poll < 3; poll += 1) {
        await slave.link.exchange(tc28Read(tid + poll, 1), delayMs)
      }
      const phases = slave.events.filter((event) => event.event === 'phase')
      assert.equal(phases.length, 1, JSON.stringify(phases))
      assert.ok(Object.values(phases[0]).includes(delayMs), `phase event ${JSON.stringify(phases[0])}`)
    })
  }

  test('counts only unit-1 polls toward the 20 prompt answers', async () => {
    const slave = startTc28(1)
    const late: number[] = []
    let tid = 1
    for (let poll = 1; poll <= TC28_PROMPT_POLLS + 1; poll += 1) {
      await slave.link.exchange(tc28Read(tid, 2), 1)
      tid += 1
      if (hex(await slave.link.exchange(tc28Read(tid, 1), 1)) !== hex(tc28Answer(tid, 1, [1234, 5678]))) {
        late.push(poll)
      }
      tid += 1
    }
    assert.deepEqual(late, [TC28_PROMPT_POLLS + 1])
  })

  test('answers unit-2 polls at once throughout, also while a unit-1 answer is held', async () => {
    const slave = startTc28(2)
    const tid = await playPromptPolls(slave)
    await slave.link.exchange(tc28Read(tid, 1), 1)
    assert.equal(hex(await slave.link.exchange(tc28Read(tid + 1, 2), 1)), hex(tc28Answer(tid + 1, 2, [1234, 5678])))
  })

  test('answers 0 for any register of a late answer beyond the second', async () => {
    const slave = startTc28(1)
    const tid = await playPromptPolls(slave)
    assert.equal(hex(await slave.link.exchange(tc28Read(tid, 1, 3), 200)), hex(tc28Answer(tid, 1, [4321, 8765, 0])))
  })

  test('sends no late answer once the connection closed', async () => {
    const slave = startTc28(1)
    const tid = await playPromptPolls(slave)
    await slave.link.exchange(tc28Read(tid, 1), 1)
    slave.link.stream.destroy()
    await settle()
    await slave.clock.advance(1_000)
    assert.equal(slave.link.take().length, 0)
  })

  test('keeps the 200 ms delay of row 1 under --duration-scale', async () => {
    const slave = startTc28(1, 0.01)
    const tid = await playPromptPolls(slave)
    const early = await slave.link.exchange(tc28Read(tid, 1), 199)
    await slave.clock.advance(1)
    assert.deepEqual(
      { early: hex(early), onTime: hex(slave.link.take()) },
      { early: '', onTime: hex(tc28Answer(tid, 1, [4321, 8765])) },
    )
  })

  test('refuses row 3, a missing row and RTU', () => {
    assert.deepEqual(
      [
        () => checkScenario('TC28', 3, 'tcp'),
        () => checkScenario('TC28', undefined, 'tcp'),
        () => checkScenario('TC28', 1, 'rtu'),
      ].map((call) => {
        try {
          call()
          return 'accepted'
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }),
      ['scenario "TC28" needs --row 1..2', 'scenario "TC28" needs --row 1..2', 'scenario "TC28" does not run over RTU'],
    )
  })
})

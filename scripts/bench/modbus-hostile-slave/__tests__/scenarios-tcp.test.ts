import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import { settle } from './helpers/fake-clock'
import { GROUPS, hex, range, tcpFrame, tcpRead, tcpRegistersAnswer } from './helpers/modbus'
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

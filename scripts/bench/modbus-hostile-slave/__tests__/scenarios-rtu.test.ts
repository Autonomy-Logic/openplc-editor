import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import { crc16Modbus } from '../frames'
import { settle } from './helpers/fake-clock'
import {
  GROUPS,
  hasValidCrc,
  hex,
  range,
  readPdu,
  rtuFrame,
  rtuRead,
  rtuRegistersAnswer,
  words,
} from './helpers/modbus'
import { OpenSlave, openSlave } from './helpers/slave'

let current: OpenSlave | null = null

function start(scenario: string, row?: number): OpenSlave {
  current = openSlave(scenario, 'rtu', row)
  return current
}

afterEach(() => {
  current?.stop()
  current = null
})

describe('normal over RTU', () => {
  test('echoes an FC 6 write and reads the written register back with FC 3', async () => {
    const slave = start('normal')
    const write = rtuFrame(Buffer.from([0x06, 0x00, 0x05, 0x04, 0xd2]))
    assert.equal(hex(await slave.link.exchange(write)), hex(write))
    assert.equal(hex(await slave.link.exchange(rtuFrame(readPdu(3, 5, 1)))), hex(rtuRegistersAnswer([1234])))
  })

  test('reads an address absent from the map as 0', async () => {
    const slave = start('normal')
    assert.equal(hex(await slave.link.exchange(rtuFrame(readPdu(3, 40, 2)))), hex(rtuRegistersAnswer([0, 0])))
  })
})

describe('AS-07 over RTU', { timeout: 60_000 }, () => {
  test('floods 0xFF with no gap from the first request', async () => {
    const slave = start('AS-07')
    slave.link.stream.push(rtuRead(GROUPS.g1))
    await slave.clock.advance(5)
    const first = slave.link.take()
    await slave.clock.advance(5)
    const second = slave.link.take()
    assert.ok(first.length > 0 && second.length > 0, `flood blocks ${first.length}, ${second.length}`)
    assert.ok(Buffer.concat([first, second]).every((byte) => byte === 0xff))
  })

  test('after 60 s stops the flood and answers 4321, 8765 with a valid CRC', async () => {
    const slave = start('AS-07')
    slave.link.stream.push(rtuRead(GROUPS.g1))
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
    assert.equal(hex(all.subarray(answerStart)), hex(rtuRegistersAnswer([4321, 8765])))
    slave.link.take()
    await slave.clock.advance(100)
    assert.equal(slave.link.take().length, 0, 'flood still running after the answer')
  })
})

describe('AS-11 over RTU', () => {
  test('row 1 answers G1 with slave 1, FC 3, byte count 40, 40 data bytes and a valid CRC', async () => {
    const slave = start('AS-11', 1)
    const answer = await slave.link.exchange(rtuRead(GROUPS.g1))
    assert.equal(hex(answer.subarray(0, 3)), '010328')
    assert.equal(answer.length, 3 + 40 + 2)
    assert.ok(hasValidCrc(answer), `CRC of ${hex(answer)}`)
  })

  test('row 2 answers G1 with 300 bytes in one run, starting with slave 1 and FC 3', async () => {
    const slave = start('AS-11', 2)
    const answer = await slave.link.exchange(rtuRead(GROUPS.g1))
    assert.equal(hex(answer.subarray(0, 2)), '0103')
    assert.equal(answer.length, 300)
  })

  test("row 2 then answers G1's next request with 501..510", async () => {
    const slave = start('AS-11', 2)
    await slave.link.exchange(rtuRead(GROUPS.g1))
    assert.equal(hex(await slave.link.exchange(rtuRead(GROUPS.g1))), hex(rtuRegistersAnswer(range(501, 510))))
  })
})

describe('AS-12 over RTU', () => {
  test('answers G3 once with 23130', async () => {
    const slave = start('AS-12')
    assert.equal(hex(await slave.link.exchange(rtuRead(GROUPS.g3))), hex(rtuRegistersAnswer([23130])))
  })

  test('does not answer G1', async () => {
    const slave = start('AS-12')
    await slave.link.exchange(rtuRead(GROUPS.g3))
    assert.equal((await slave.link.exchange(rtuRead(GROUPS.g1), 5_000)).length, 0)
  })

  test("answers G2's request with G1's response: byte count 20, 1111..1120, valid CRC", async () => {
    const slave = start('AS-12')
    await slave.link.exchange(rtuRead(GROUPS.g3))
    await slave.link.exchange(rtuRead(GROUPS.g1), 5_000)
    assert.equal(hex(await slave.link.exchange(rtuRead(GROUPS.g2Pair))), hex(rtuRegistersAnswer(range(1111, 1120))))
  })

  test("answers G2's next request with 3333, 4444", async () => {
    const slave = start('AS-12')
    await slave.link.exchange(rtuRead(GROUPS.g3))
    await slave.link.exchange(rtuRead(GROUPS.g1), 5_000)
    await slave.link.exchange(rtuRead(GROUPS.g2Pair))
    assert.equal(hex(await slave.link.exchange(rtuRead(GROUPS.g2Pair))), hex(rtuRegistersAnswer([3333, 4444])))
  })
})

describe('TC10 over RTU', () => {
  const MALFORMED_DATA = Buffer.concat([Buffer.from([20]), words(range(201, 210))])

  function badCrcFrame(): Buffer {
    const body = Buffer.concat([Buffer.from([0x01, 0x03]), MALFORMED_DATA])
    const inverted = crc16Modbus(body) ^ 0xffff
    return Buffer.concat([body, Buffer.from([inverted & 0xff, inverted >> 8])])
  }

  const rows: Array<{ row: number; rule: string; expected: () => Buffer }> = [
    {
      row: 1,
      rule: 'slave id 2, FC 3, byte count 20, 20 data bytes, valid CRC',
      expected: () => rtuFrame(Buffer.concat([Buffer.from([0x03]), MALFORMED_DATA]), 2),
    },
    {
      row: 2,
      rule: 'slave id 1, FC 0x04, byte count 20, 20 data bytes, valid CRC',
      expected: () => rtuFrame(Buffer.concat([Buffer.from([0x04]), MALFORMED_DATA]), 1),
    },
    {
      row: 3,
      rule: 'slave id 1, FC 3, byte count 20, 20 data bytes, both CRC bytes inverted',
      expected: badCrcFrame,
    },
  ]

  for (const { row, rule, expected } of rows) {
    test(`row ${row} answers the first G1 request with ${rule}`, async () => {
      const slave = start('TC10', row)
      assert.equal(hex(await slave.link.exchange(rtuRead(GROUPS.g1))), hex(expected()))
    })

    test(`row ${row} then answers G1 with 501..510`, async () => {
      const slave = start('TC10', row)
      await slave.link.exchange(rtuRead(GROUPS.g1))
      assert.equal(hex(await slave.link.exchange(rtuRead(GROUPS.g1))), hex(rtuRegistersAnswer(range(501, 510))))
    })

    test(`row ${row} answers G2 as the normal scenario does`, async () => {
      const normal = start('normal')
      const normalAnswer = await normal.link.exchange(rtuRead(GROUPS.g2))
      normal.stop()
      const slave = start('TC10', row)

      assert.equal(hex(await slave.link.exchange(rtuRead(GROUPS.g2))), hex(normalAnswer))
    })
  }

  test('row 3 inverts both bytes of a CRC the reference computes', async () => {
    const slave = start('TC10', 3)
    const answer = await slave.link.exchange(rtuRead(GROUPS.g1))
    const restored = Buffer.from(answer)
    restored[restored.length - 2] ^= 0xff
    restored[restored.length - 1] ^= 0xff

    assert.deepEqual({ sent: hasValidCrc(answer), restored: hasValidCrc(restored) }, { sent: false, restored: true })
  })
})

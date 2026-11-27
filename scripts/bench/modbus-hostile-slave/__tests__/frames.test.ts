import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { crc16Modbus } from '../frames'

describe('crc16Modbus', () => {
  test('gives the CRC-16/MODBUS check value 0x4B37 for the ASCII string 123456789', () => {
    assert.equal(crc16Modbus(Buffer.from('123456789', 'ascii')), 0x4b37)
  })

  test('gives 0xCDC5 (wire bytes C5 CD) for the request 01 03 00 00 00 0A', () => {
    assert.equal(crc16Modbus(Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a])), 0xcdc5)
  })

  test('gives 0x0A84 (wire bytes 84 0A) for the request 01 03 00 00 00 01', () => {
    assert.equal(crc16Modbus(Buffer.from([0x01, 0x03, 0x00, 0x00, 0x00, 0x01])), 0x0a84)
  })

  test('gives 0x0B98 (wire bytes 98 0B) for the request 01 06 00 01 00 03', () => {
    assert.equal(crc16Modbus(Buffer.from([0x01, 0x06, 0x00, 0x01, 0x00, 0x03])), 0x0b98)
  })

  test('gives the initial value 0xFFFF for no bytes', () => {
    assert.equal(crc16Modbus(new Uint8Array(0)), 0xffff)
  })

  test('gives 0 over a frame followed by its own CRC, low byte first', () => {
    const body = Buffer.from([0x01, 0x03, 0x14, ...Array.from({ length: 20 }, (_, index) => index * 7)])
    const crc = crc16Modbus(body)
    assert.equal(crc16Modbus(Buffer.concat([body, Buffer.from([crc & 0xff, crc >> 8])])), 0)
  })
})

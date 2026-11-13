/** Default poll groups of the tool: G1, G2 (one register, two in AS-03 and AS-12) and G3, all FC 3 on unit 1. */
export const GROUPS = {
  g1: { address: 0, quantity: 10 },
  g2: { address: 10, quantity: 1 },
  g2Pair: { address: 10, quantity: 2 },
  g3: { address: 20, quantity: 1 },
} as const

/** Reference CRC-16/MODBUS, independent of the tool, used to build RTU requests and check RTU answers. */
export function referenceCrc(data: Uint8Array): number {
  let crc = 0xffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1
    }
  }
  return crc
}

/** Big-endian 16-bit words as bytes. */
export function words(values: readonly number[]): Buffer {
  const out = Buffer.alloc(values.length * 2)
  values.forEach((value, index) => out.writeUInt16BE(value, index * 2))
  return out
}

/** Consecutive register values from `first` to `last`, both included. */
export function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

/** A Modbus TCP frame: MBAP header (protocol 0, length from the PDU) followed by the unit id and the PDU. */
export function tcpFrame(transactionId: number, pdu: Buffer, unitId = 1): Buffer {
  const header = Buffer.alloc(7)
  header.writeUInt16BE(transactionId, 0)
  header.writeUInt16BE(0, 2)
  header.writeUInt16BE(pdu.length + 1, 4)
  header.writeUInt8(unitId, 6)
  return Buffer.concat([header, pdu])
}

/** A Modbus RTU frame: slave id, PDU and the CRC, low byte first. */
export function rtuFrame(pdu: Buffer, slaveId = 1): Buffer {
  const body = Buffer.concat([Buffer.from([slaveId]), pdu])
  const crc = referenceCrc(body)
  return Buffer.concat([body, Buffer.from([crc & 0xff, crc >> 8])])
}

/** PDU of a read request (FC 1, 2, 3 or 4). */
export function readPdu(functionCode: number, address: number, quantity: number): Buffer {
  const pdu = Buffer.alloc(5)
  pdu.writeUInt8(functionCode, 0)
  pdu.writeUInt16BE(address, 1)
  pdu.writeUInt16BE(quantity, 3)
  return pdu
}

/** PDU of a register read answer (FC 3 or 4). */
export function registersAnswerPdu(values: readonly number[], functionCode = 3): Buffer {
  return Buffer.concat([Buffer.from([functionCode, values.length * 2]), words(values)])
}

/** A Modbus TCP FC 3 request for a poll group. */
export function tcpRead(transactionId: number, group: { address: number; quantity: number }): Buffer {
  return tcpFrame(transactionId, readPdu(3, group.address, group.quantity))
}

/** The well-formed Modbus TCP FC 3 answer carrying `values`. */
export function tcpRegistersAnswer(transactionId: number, values: readonly number[]): Buffer {
  return tcpFrame(transactionId, registersAnswerPdu(values))
}

/** A Modbus RTU FC 3 request for a poll group on slave 1. */
export function rtuRead(group: { address: number; quantity: number }): Buffer {
  return rtuFrame(readPdu(3, group.address, group.quantity))
}

/** The well-formed Modbus RTU FC 3 answer of slave 1 carrying `values`. */
export function rtuRegistersAnswer(values: readonly number[]): Buffer {
  return rtuFrame(registersAnswerPdu(values))
}

/** True when the last two bytes of an RTU frame are the CRC of the bytes before them. */
export function hasValidCrc(frame: Buffer): boolean {
  if (frame.length < 3) {
    return false
  }
  const crc = referenceCrc(frame.subarray(0, frame.length - 2))
  return frame[frame.length - 2] === (crc & 0xff) && frame[frame.length - 1] === crc >> 8
}

/** Lowercase hex of the bytes, without separators. */
export function hex(bytes: Buffer): string {
  return bytes.toString('hex')
}

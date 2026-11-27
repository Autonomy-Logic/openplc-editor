/** Unit id the tool answers as, on TCP and RTU. */
export const SLAVE_UNIT = 1

/** Modbus function codes the tool decodes. */
export const FC = {
  readCoils: 0x01,
  readDiscreteInputs: 0x02,
  readHoldingRegisters: 0x03,
  readInputRegisters: 0x04,
  writeSingleCoil: 0x05,
  writeSingleRegister: 0x06,
  writeMultipleCoils: 0x0f,
  writeMultipleRegisters: 0x10,
  debugGetList: 0x44,
} as const

/** Modbus exception codes. */
export const EXCEPTION = {
  illegalFunction: 0x01,
  illegalDataAddress: 0x02,
  illegalDataValue: 0x03,
} as const

/** CRC-16/MODBUS (polynomial 0xA001 reflected, initial value 0xFFFF) of `data`. */
export function crc16Modbus(data: Uint8Array): number {
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
  values.forEach((value, index) => out.writeUInt16BE(value & 0xffff, index * 2))
  return out
}

/** Consecutive values from `first` to `last`, both included. */
export function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

/** MBAP header fields; `length` defaults to the unit id plus the PDU, `protocol` to 0. */
export type MbapFields = { tid: number; unit: number; protocol?: number; length?: number }

/** A Modbus TCP ADU: the MBAP header followed by the unit id and `pdu`. */
export function tcpAdu(fields: MbapFields, pdu: Uint8Array): Buffer {
  const header = Buffer.alloc(7)
  header.writeUInt16BE(fields.tid & 0xffff, 0)
  header.writeUInt16BE(fields.protocol ?? 0, 2)
  header.writeUInt16BE(fields.length ?? pdu.length + 1, 4)
  header.writeUInt8(fields.unit, 6)
  return Buffer.concat([header, pdu])
}

/** A Modbus RTU ADU: the unit id, `pdu` and the CRC, low byte first. */
export function rtuAdu(unit: number, pdu: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from([unit]), pdu])
  const crc = crc16Modbus(body)
  return Buffer.concat([body, Buffer.from([crc & 0xff, crc >> 8])])
}

/** PDU of a register read answer carrying `values`. */
export function registersAnswerPdu(values: readonly number[], functionCode: number = FC.readHoldingRegisters): Buffer {
  return Buffer.concat([Buffer.from([functionCode, values.length * 2]), words(values)])
}

/** PDU of a read request (FC 1, 2, 3 or 4). */
export function readRequestPdu(functionCode: number, address: number, quantity: number): Buffer {
  const pdu = Buffer.alloc(5)
  pdu.writeUInt8(functionCode, 0)
  pdu.writeUInt16BE(address, 1)
  pdu.writeUInt16BE(quantity, 3)
  return pdu
}

/** PDU of an exception answer to `functionCode`. */
export function exceptionPdu(functionCode: number, code: number): Buffer {
  return Buffer.from([(functionCode | 0x80) & 0xff, code])
}

/** A request taken off the wire: `tid` is set on TCP only. */
export type Request = {
  tid?: number
  unit: number
  pdu: Buffer
  fc: number
  address?: number
  quantity?: number
}

/** Function code, starting address and quantity of a request PDU, where the PDU carries them. */
export function describePdu(pdu: Buffer): { fc: number; address?: number; quantity?: number } {
  const fc = pdu.length > 0 ? pdu[0] : -1
  const address = pdu.length >= 3 ? pdu.readUInt16BE(1) : undefined
  switch (fc) {
    case FC.readCoils:
    case FC.readDiscreteInputs:
    case FC.readHoldingRegisters:
    case FC.readInputRegisters:
    case FC.writeMultipleCoils:
    case FC.writeMultipleRegisters:
      return { fc, address, quantity: pdu.length >= 5 ? pdu.readUInt16BE(3) : undefined }
    case FC.writeSingleCoil:
    case FC.writeSingleRegister:
      return { fc, address, quantity: 1 }
    default:
      return { fc }
  }
}

/** One Modbus TCP frame taken off the wire. */
export type TcpFrame = { tid: number; unit: number; pdu: Buffer }

/** Splits a TCP byte stream into frames; bytes that cannot start an MBAP header are returned as `discarded`. */
export function takeTcpFrames(buffer: Buffer): { frames: TcpFrame[]; rest: Buffer; discarded: Buffer } {
  const frames: TcpFrame[] = []
  let offset = 0
  while (buffer.length - offset >= 6) {
    const protocol = buffer.readUInt16BE(offset + 2)
    const length = buffer.readUInt16BE(offset + 4)
    if (protocol !== 0 || length < 2 || length > 254) {
      return { frames, rest: Buffer.alloc(0), discarded: Buffer.from(buffer.subarray(offset)) }
    }
    if (buffer.length - offset < 6 + length) {
      break
    }
    frames.push({
      tid: buffer.readUInt16BE(offset),
      unit: buffer[offset + 6],
      pdu: Buffer.from(buffer.subarray(offset + 7, offset + 6 + length)),
    })
    offset += 6 + length
  }
  return { frames, rest: Buffer.from(buffer.subarray(offset)), discarded: Buffer.alloc(0) }
}

/** Splits a TCP byte stream into requests; bytes that cannot start an MBAP header are returned as `discarded`. */
export function takeTcpRequests(buffer: Buffer): { requests: Request[]; rest: Buffer; discarded: Buffer } {
  const { frames, rest, discarded } = takeTcpFrames(buffer)
  return { requests: frames.map((frame) => ({ ...frame, ...describePdu(frame.pdu) })), rest, discarded }
}

function rtuRequestLength(buffer: Buffer, offset: number): number | null {
  if (buffer.length - offset < 2) {
    return null
  }
  switch (buffer[offset + 1]) {
    case FC.readCoils:
    case FC.readDiscreteInputs:
    case FC.readHoldingRegisters:
    case FC.readInputRegisters:
    case FC.writeSingleCoil:
    case FC.writeSingleRegister:
      return 8
    case FC.writeMultipleCoils:
    case FC.writeMultipleRegisters:
      return buffer.length - offset < 7 ? null : 9 + buffer[offset + 6]
    default:
      return 0
  }
}

/**
 * Splits an RTU byte stream into requests. A frame is sized by its function code and kept only when its CRC holds;
 * otherwise one byte is dropped and the search goes on, and the dropped bytes are returned as `discarded`.
 */
export function takeRtuRequests(buffer: Buffer): { requests: Request[]; rest: Buffer; discarded: Buffer } {
  const requests: Request[] = []
  const discarded: number[] = []
  let offset = 0
  for (;;) {
    const length = rtuRequestLength(buffer, offset)
    if (length === null || buffer.length - offset < length) {
      break
    }
    const frame = buffer.subarray(offset, offset + length)
    if (length === 0 || crc16Modbus(frame) !== 0) {
      discarded.push(buffer[offset])
      offset += 1
      continue
    }
    const pdu = Buffer.from(frame.subarray(1, length - 2))
    requests.push({ unit: frame[0], pdu, ...describePdu(pdu) })
    offset += length
  }
  return { requests, rest: Buffer.from(buffer.subarray(offset)), discarded: Buffer.from(discarded) }
}

/** The answer to `request` on `transport`, built from an answer PDU, with the request's tid and unit id. */
export function answerFrame(transport: 'tcp' | 'rtu', request: Request, pdu: Uint8Array): Buffer {
  return transport === 'tcp' ? tcpAdu({ tid: request.tid ?? 0, unit: request.unit }, pdu) : rtuAdu(request.unit, pdu)
}

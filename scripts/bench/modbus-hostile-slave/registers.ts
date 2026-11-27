import { readFileSync } from 'node:fs'

import { EXCEPTION, exceptionPdu, FC, registersAnswerPdu } from './frames'

/** The four Modbus data tables of the `normal` slave, keyed by address; an absent address reads 0. */
export type RegisterTables = {
  coils: Map<number, number>
  discreteInputs: Map<number, number>
  holdingRegisters: Map<number, number>
  inputRegisters: Map<number, number>
}

const TABLES = ['coils', 'discreteInputs', 'holdingRegisters', 'inputRegisters'] as const
type TableName = (typeof TABLES)[number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTable(name: TableName, value: unknown): Map<number, number> {
  const table = new Map<number, number>()
  if (value === undefined) {
    return table
  }
  if (!isRecord(value)) {
    throw new Error(`register map: "${name}" must be an object of address to value`)
  }
  const isBit = name === 'coils' || name === 'discreteInputs'
  for (const [key, raw] of Object.entries(value)) {
    const address = Number(key)
    if (!/^\d+$/.test(key) || address > 0xffff) {
      throw new Error(`register map: "${name}" address "${key}" is not an integer from 0 to 65535`)
    }
    const numeric = typeof raw === 'boolean' ? Number(raw) : raw
    const valid =
      typeof numeric === 'number' && Number.isInteger(numeric) && numeric >= 0 && numeric <= (isBit ? 1 : 0xffff)
    if (!valid) {
      throw new Error(
        `register map: "${name}" value at ${key} must be ${isBit ? '0 or 1' : 'an integer from 0 to 65535'}`,
      )
    }
    table.set(address, numeric)
  }
  return table
}

/** Builds the tables from parsed JSON `{ coils, discreteInputs, holdingRegisters, inputRegisters }`. */
export function parseRegisterMap(json: unknown): RegisterTables {
  if (!isRecord(json)) {
    throw new Error('register map: the file must hold a JSON object')
  }
  const unknownKeys = Object.keys(json).filter((key) => !TABLES.some((table) => table === key))
  if (unknownKeys.length > 0) {
    throw new Error(`register map: unknown table ${unknownKeys.join(', ')}`)
  }
  return {
    coils: parseTable('coils', json.coils),
    discreteInputs: parseTable('discreteInputs', json.discreteInputs),
    holdingRegisters: parseTable('holdingRegisters', json.holdingRegisters),
    inputRegisters: parseTable('inputRegisters', json.inputRegisters),
  }
}

/** Reads and parses a register map file. */
export function loadRegisterMap(file: string): RegisterTables {
  return parseRegisterMap(JSON.parse(readFileSync(file, 'utf8')))
}

/** Empty tables: every address reads 0. */
export function emptyRegisterMap(): RegisterTables {
  return parseRegisterMap({})
}

function readBits(table: Map<number, number>, fc: number, address: number, quantity: number): Buffer {
  const out = Buffer.alloc(2 + Math.ceil(quantity / 8))
  out[0] = fc
  out[1] = out.length - 2
  for (let index = 0; index < quantity; index += 1) {
    if ((table.get(address + index) ?? 0) !== 0) {
      out[2 + (index >> 3)] |= 1 << (index & 7)
    }
  }
  return out
}

function readRegisters(table: Map<number, number>, fc: number, address: number, quantity: number): Buffer {
  return registersAnswerPdu(
    Array.from({ length: quantity }, (_, index) => table.get(address + index) ?? 0),
    fc,
  )
}

function readAnswer(tables: RegisterTables, pdu: Buffer): Buffer {
  const fc = pdu[0]
  if (pdu.length !== 5) {
    return exceptionPdu(fc, EXCEPTION.illegalDataValue)
  }
  const address = pdu.readUInt16BE(1)
  const quantity = pdu.readUInt16BE(3)
  const isBit = fc === FC.readCoils || fc === FC.readDiscreteInputs
  if (quantity < 1 || quantity > (isBit ? 2000 : 125)) {
    return exceptionPdu(fc, EXCEPTION.illegalDataValue)
  }
  if (address + quantity > 0x10000) {
    return exceptionPdu(fc, EXCEPTION.illegalDataAddress)
  }
  switch (fc) {
    case FC.readCoils:
      return readBits(tables.coils, fc, address, quantity)
    case FC.readDiscreteInputs:
      return readBits(tables.discreteInputs, fc, address, quantity)
    case FC.readHoldingRegisters:
      return readRegisters(tables.holdingRegisters, fc, address, quantity)
    default:
      return readRegisters(tables.inputRegisters, fc, address, quantity)
  }
}

function writeSingle(tables: RegisterTables, pdu: Buffer): Buffer {
  const fc = pdu[0]
  if (pdu.length !== 5) {
    return exceptionPdu(fc, EXCEPTION.illegalDataValue)
  }
  const address = pdu.readUInt16BE(1)
  const value = pdu.readUInt16BE(3)
  if (fc === FC.writeSingleCoil) {
    if (value !== 0xff00 && value !== 0x0000) {
      return exceptionPdu(fc, EXCEPTION.illegalDataValue)
    }
    tables.coils.set(address, value === 0xff00 ? 1 : 0)
  } else {
    tables.holdingRegisters.set(address, value)
  }
  return Buffer.from(pdu)
}

function writeMultiple(tables: RegisterTables, pdu: Buffer): Buffer {
  const fc = pdu[0]
  if (pdu.length < 6) {
    return exceptionPdu(fc, EXCEPTION.illegalDataValue)
  }
  const address = pdu.readUInt16BE(1)
  const quantity = pdu.readUInt16BE(3)
  const byteCount = pdu[5]
  const isBit = fc === FC.writeMultipleCoils
  const expectedBytes = isBit ? Math.ceil(quantity / 8) : quantity * 2
  if (quantity < 1 || quantity > (isBit ? 1968 : 123) || byteCount !== expectedBytes || pdu.length !== 6 + byteCount) {
    return exceptionPdu(fc, EXCEPTION.illegalDataValue)
  }
  if (address + quantity > 0x10000) {
    return exceptionPdu(fc, EXCEPTION.illegalDataAddress)
  }
  for (let index = 0; index < quantity; index += 1) {
    if (isBit) {
      tables.coils.set(address + index, (pdu[6 + (index >> 3)] >> (index & 7)) & 1)
    } else {
      tables.holdingRegisters.set(address + index, pdu.readUInt16BE(6 + index * 2))
    }
  }
  return Buffer.from(pdu.subarray(0, 5))
}

/** The answer PDU of a well-behaved slave to `pdu` (FC 1, 2, 3, 4, 5, 6, 15 and 16), updating `tables` on writes. */
export function answerFromTables(tables: RegisterTables, pdu: Buffer): Buffer {
  const fc = pdu.length > 0 ? pdu[0] : 0
  switch (fc) {
    case FC.readCoils:
    case FC.readDiscreteInputs:
    case FC.readHoldingRegisters:
    case FC.readInputRegisters:
      return readAnswer(tables, pdu)
    case FC.writeSingleCoil:
    case FC.writeSingleRegister:
      return writeSingle(tables, pdu)
    case FC.writeMultipleCoils:
    case FC.writeMultipleRegisters:
      return writeMultiple(tables, pdu)
    default:
      return exceptionPdu(fc, EXCEPTION.illegalFunction)
  }
}

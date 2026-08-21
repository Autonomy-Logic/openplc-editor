/**
 * Modbus slave address map: which Modbus address a given IEC located
 * variable answers on.
 *
 * Within each Modbus block the configured IEC segments are laid out
 * **sequentially from address 0 of that block**, sized in that block's
 * addressable unit (bits for coils / discrete inputs, 16-bit registers for
 * holding / input registers):
 *
 * | Block             | FCs      | Segments, in order                          |
 * |-------------------|----------|---------------------------------------------|
 * | Holding registers | 3/6/16   | `%QW` → `%MW` → `%MD` (2 regs) → `%ML` (4)  |
 * | Coils             | 1/5/15   | `%QX` → `%MX`                               |
 * | Discrete inputs   | 2        | `%IX`                                       |
 * | Input registers   | 4        | `%IW`                                       |
 *
 * The authority for this layout is the runtime's Modbus slave plugin
 * (`core/src/drivers/plugins/python/modbus_slave/simple_modbus.py`, classes
 * `OpenPLCSegmented{Coils,HoldingRegisters}DataBlock`) fed by the
 * `conf/modbus_slave.json` this editor emits in `generate-modbus-slave-config`.
 * Both sides derive the boundaries independently from the same counts, so a
 * change here without a matching change there silently misreports where a
 * variable lives. Keep the arithmetic in step with that file.
 *
 * Beyond the per-segment ranges this module also answers the three questions
 * the reference table asks of it: what sits at index *i* of a segment (the
 * address matrix), where a given address lives (the search box), and the whole
 * map as a file (the CSV export).
 *
 * Pure — no I/O, no store, no React.
 */

import type { ModbusBufferMapping } from '../../../middleware/shared/ports/types'
import { DEFAULT_BUFFER_MAPPING } from './generate-modbus-slave-config'

/** Addressable unit of a Modbus block. */
type ModbusBlockKind = 'bit' | 'register'

/** IEC width of one value in a segment. */
type IecType = 'BOOL' | 'WORD' | 'DWORD' | 'LWORD'

type SectionId = 'holding' | 'coils' | 'discrete' | 'input'

interface ModiconRange {
  start: string
  end: string
}

interface AddressMappingRow {
  segment: string
  iecType: IecType
  /** Addressable unit of the block this row lives in. */
  unit: ModbusBlockKind
  /**
   * Registers each value occupies: 2 for `%MD`, 4 for `%ML`, 1 for everything
   * else. This stride is why consecutive IEC values do not sit on consecutive
   * Modbus offsets, and it is the reason the matrix exists.
   */
  registersPerValue: number
  plcAddressStart: string
  plcAddressEnd: string
  modbusStart: number
  modbusEnd: number
  /** Number of IEC values in the segment. */
  count: number
  /** Addresses the segment occupies: `count * registersPerValue`. */
  modbusCount: number
  /** Cells per matrix row — a byte for bits, sixteen for registers. */
  perRow: number
  disabled: boolean
}

interface AddressMappingSection {
  id: SectionId
  title: string
  kind: ModbusBlockKind
  /**
   * First address of the block in the 5-digit Modicon convention: `400001` for
   * holding registers, `300001` for input registers, `100001` for discrete
   * inputs and `1` for coils.
   */
  modiconBase: number
  totalAddresses: number
  /** `null` when the block holds nothing — there is no range to name. */
  modiconRange: ModiconRange | null
  rows: AddressMappingRow[]
}

interface ModbusAddressMapping {
  holdingRegisters: AddressMappingSection
  coils: AddressMappingSection
  discreteInputs: AddressMappingSection
  inputRegisters: AddressMappingSection
}

/** Where a searched address turned out to live. */
interface AddressHit {
  sectionId: SectionId
  segment: string
  offset: number
  /** Row of the segment's matrix holding the hit, so the UI can scroll to it. */
  matrixRow: number
}

interface AddressQueryResult {
  hits: AddressHit[]
  /** Set only when the query was understood but matched nothing. */
  error: string | null
}

const BITS_PER_BYTE = 8
const REGISTERS_PER_MATRIX_ROW = 16

/**
 * `%QX<byte>.<bit>` — the IEC 61131-3 bit convention, where `bit` is 0…7.
 * So bit index 7 is `%QX0.7` and bit index 8 rolls over to `%QX1.0`.
 */
function formatBitAddress(prefix: string, bitIndex: number): string {
  const byteIndex = Math.floor(bitIndex / BITS_PER_BYTE)
  const bit = bitIndex % BITS_PER_BYTE
  return `${prefix}${byteIndex}.${bit}`
}

/**
 * The 5-digit Modicon convention datasheets and SCADA tools print: the block's
 * base plus the offset, so holding register offset 0 is `400001` and coil
 * offset 0 is `000001`. It names the same register the offset does, one base
 * apart — which is the most common source of off-by-one in Modbus
 * integration, and the reason both are on screen at once.
 */
function formatModiconAddress(modiconBase: number, offset: number): string {
  return String(modiconBase + offset).padStart(6, '0')
}

function buildModiconRange(modiconBase: number, totalAddresses: number): ModiconRange | null {
  if (totalAddresses === 0) return null
  return {
    start: formatModiconAddress(modiconBase, 0),
    end: formatModiconAddress(modiconBase, totalAddresses - 1),
  }
}

/**
 * Fill in every count the caller left out.
 *
 * `initializeServerProtocolConfig` seeds a Modbus server without a
 * `bufferMapping` at all, so a freshly created server reaches us as
 * `undefined` and has to report the defaults the runtime would apply. Older
 * projects can also carry a partially populated object.
 */
function withDefaults(bufferMapping: ModbusBufferMapping | undefined) {
  const holding = bufferMapping?.holdingRegisters
  const coils = bufferMapping?.coils
  const discreteInputs = bufferMapping?.discreteInputs
  const inputRegisters = bufferMapping?.inputRegisters

  return {
    holdingRegisters: {
      qwCount: holding?.qwCount ?? DEFAULT_BUFFER_MAPPING.holdingRegisters.qwCount,
      mwCount: holding?.mwCount ?? DEFAULT_BUFFER_MAPPING.holdingRegisters.mwCount,
      mdCount: holding?.mdCount ?? DEFAULT_BUFFER_MAPPING.holdingRegisters.mdCount,
      mlCount: holding?.mlCount ?? DEFAULT_BUFFER_MAPPING.holdingRegisters.mlCount,
    },
    coils: {
      qxBits: coils?.qxBits ?? DEFAULT_BUFFER_MAPPING.coils.qxBits,
      mxBits: coils?.mxBits ?? DEFAULT_BUFFER_MAPPING.coils.mxBits,
    },
    discreteInputs: {
      ixBits: discreteInputs?.ixBits ?? DEFAULT_BUFFER_MAPPING.discreteInputs.ixBits,
    },
    inputRegisters: {
      iwCount: inputRegisters?.iwCount ?? DEFAULT_BUFFER_MAPPING.inputRegisters.iwCount,
    },
  }
}

/**
 * One segment, laid out from `start`.
 *
 * `count` is a number of IEC **values**, never of registers — `mdCount: 1024`
 * means 1024 `%MD` variables occupying 2048 registers, which is also how
 * `simple_modbus.py` reads it. Treating it as a register budget would halve
 * every `%MD` and `%ML` segment on screen.
 */
function buildRow(
  segment: string,
  iecType: IecType,
  unit: ModbusBlockKind,
  registersPerValue: number,
  start: number,
  count: number,
): AddressMappingRow {
  const modbusCount = count * registersPerValue
  const lastIndex = Math.max(0, count - 1)
  const isBit = unit === 'bit'

  return {
    segment,
    iecType,
    unit,
    registersPerValue,
    plcAddressStart: isBit ? formatBitAddress(segment, 0) : `${segment}0`,
    plcAddressEnd: isBit ? formatBitAddress(segment, lastIndex) : `${segment}${lastIndex}`,
    modbusStart: start,
    modbusEnd: Math.max(start, start + modbusCount - 1),
    count,
    modbusCount,
    perRow: isBit ? BITS_PER_BYTE : REGISTERS_PER_MATRIX_ROW,
    disabled: count === 0,
  }
}

function buildSection(
  id: SectionId,
  title: string,
  kind: ModbusBlockKind,
  modiconBase: number,
  rows: AddressMappingRow[],
): AddressMappingSection {
  const totalAddresses = rows.reduce((sum, row) => sum + row.modbusCount, 0)
  return {
    id,
    title,
    kind,
    modiconBase,
    totalAddresses,
    modiconRange: buildModiconRange(modiconBase, totalAddresses),
    rows,
  }
}

/**
 * Compute the full Modbus ↔ IEC address map for a buffer configuration.
 *
 * A segment sized 0 is reported as `disabled` rather than omitted, so the
 * table shows the reader that the segment exists and is switched off (the
 * `%MX` default) instead of leaving them wondering where it went.
 */
function calculateModbusAddressMapping(bufferMapping?: ModbusBufferMapping): ModbusAddressMapping {
  const { holdingRegisters, coils, discreteInputs, inputRegisters } = withDefaults(bufferMapping)

  const qw = buildRow('%QW', 'WORD', 'register', 1, 0, holdingRegisters.qwCount)
  const mw = buildRow('%MW', 'WORD', 'register', 1, qw.modbusStart + qw.modbusCount, holdingRegisters.mwCount)
  const md = buildRow('%MD', 'DWORD', 'register', 2, mw.modbusStart + mw.modbusCount, holdingRegisters.mdCount)
  const ml = buildRow('%ML', 'LWORD', 'register', 4, md.modbusStart + md.modbusCount, holdingRegisters.mlCount)

  const qx = buildRow('%QX', 'BOOL', 'bit', 1, 0, coils.qxBits)
  const mx = buildRow('%MX', 'BOOL', 'bit', 1, qx.modbusStart + qx.modbusCount, coils.mxBits)

  return {
    holdingRegisters: buildSection('holding', 'Holding Registers', 'register', 400001, [qw, mw, md, ml]),
    coils: buildSection('coils', 'Coils', 'bit', 1, [qx, mx]),
    discreteInputs: buildSection('discrete', 'Discrete Inputs', 'bit', 100001, [
      buildRow('%IX', 'BOOL', 'bit', 1, 0, discreteInputs.ixBits),
    ]),
    inputRegisters: buildSection('input', 'Input Registers', 'register', 300001, [
      buildRow('%IW', 'WORD', 'register', 1, 0, inputRegisters.iwCount),
    ]),
  }
}

/** Sections in the order the reference table renders them. */
function sectionsOf(mapping: ModbusAddressMapping): AddressMappingSection[] {
  return [mapping.holdingRegisters, mapping.coils, mapping.discreteInputs, mapping.inputRegisters]
}

/** Modbus offset the value at `index` of this segment answers on. */
function offsetForIndex(row: AddressMappingRow, index: number): number {
  return row.modbusStart + index * row.registersPerValue
}

/** IEC address of the value at `index` of this segment. */
function plcAddressForIndex(row: AddressMappingRow, index: number): string {
  return row.unit === 'bit' ? formatBitAddress(row.segment, index) : `${row.segment}${index}`
}

/** How many matrix rows the segment needs. */
function matrixRowCount(row: AddressMappingRow): number {
  return Math.ceil(row.count / row.perRow)
}

/**
 * Leftmost label of a matrix row: the byte for a bit segment, the first index
 * of the run for a register segment.
 */
function matrixRowLabel(row: AddressMappingRow, matrixRow: number): string {
  return row.unit === 'bit' ? `${row.segment}${matrixRow}` : `${row.segment}${matrixRow * row.perRow}`
}

const IEC_ADDRESS_PATTERN = /^%?([QMI])([XWDL])(\d+)(?:\.(\d+))?$/
const BYTE_BIT_PATTERN = /^(\d+)\.(\d+)$/
const DIGITS_PATTERN = /^\d+$/
/** A six-digit query is read as Modicon; anything shorter as a raw offset. */
const MODICON_DIGITS = 6

function hitFor(section: AddressMappingSection, row: AddressMappingRow, index: number): AddressHit {
  return {
    sectionId: section.id,
    segment: row.segment,
    offset: offsetForIndex(row, index),
    matrixRow: Math.floor(index / row.perRow),
  }
}

/**
 * Resolve what the user typed into the search box to the addresses it names.
 *
 * Four forms are accepted, in this order: an IEC address (`%QX37.4`, `%MW12`),
 * a bare `byte.bit` read as a coil, a six-digit Modicon address, and any other
 * run of digits read as a raw offset.
 *
 * More than one hit is normal rather than exceptional: every block numbers its
 * offsets from zero, so offset `12` exists in all four of them at once. The UI
 * says as much instead of silently picking one.
 */
function resolveAddressQuery(query: string, mapping: ModbusAddressMapping): AddressQueryResult {
  const normalized = query.trim().toUpperCase().replace(/\s+/g, '')
  if (!normalized) return { hits: [], error: null }

  const sections = sectionsOf(mapping)
  const iecMatch = IEC_ADDRESS_PATTERN.exec(normalized)

  if (iecMatch) {
    const [, area, width, indexText, bitText] = iecMatch
    const segment = `%${area}${width}`
    const hits: AddressHit[] = []

    for (const section of sections) {
      for (const row of section.rows) {
        if (row.segment !== segment) continue

        let index: number
        if (row.unit === 'bit') {
          const bit = bitText === undefined ? 0 : Number.parseInt(bitText, 10)
          if (bit >= BITS_PER_BYTE) return { hits: [], error: 'Bit index must be 0-7' }
          index = Number.parseInt(indexText, 10) * BITS_PER_BYTE + bit
        } else {
          if (bitText !== undefined) return { hits: [], error: `${segment} is not a bit address` }
          index = Number.parseInt(indexText, 10)
        }

        if (index < row.count) hits.push(hitFor(section, row, index))
      }
    }

    return { hits, error: hits.length ? null : `${segment} is outside the configured range` }
  }

  const byteBitMatch = BYTE_BIT_PATTERN.exec(normalized)
  if (byteBitMatch) return resolveAddressQuery(`%QX${byteBitMatch[1]}.${byteBitMatch[2]}`, mapping)

  if (!DIGITS_PATTERN.test(normalized)) return { hits: [], error: 'Unrecognized address format' }

  const value = Number.parseInt(normalized, 10)
  const asModicon = normalized.length === MODICON_DIGITS
  const hits: AddressHit[] = []

  for (const section of sections) {
    let offset: number | null = null
    if (asModicon) {
      const relative = value - section.modiconBase
      if (relative >= 0 && relative < section.totalAddresses) offset = relative
    } else if (value < section.totalAddresses) {
      offset = value
    }
    if (offset === null) continue

    for (const row of section.rows) {
      if (offset >= row.modbusStart && offset < row.modbusStart + row.modbusCount) {
        hits.push(hitFor(section, row, Math.floor((offset - row.modbusStart) / row.registersPerValue)))
      }
    }
  }

  return { hits, error: hits.length ? null : 'No address matches that value' }
}

const CSV_HEADER = 'block,segment,plc_address,modbus_offset,modicon_address,registers,iec_type'

/**
 * The whole map as CSV, one line per IEC value.
 *
 * Both address conventions are always emitted, so the file does not depend on
 * which one the screen happened to be showing when it was exported. Disabled
 * segments contribute nothing — there is no address to name.
 */
function mappingToCsv(mapping: ModbusAddressMapping): string {
  const lines = [CSV_HEADER]

  for (const section of sectionsOf(mapping)) {
    for (const row of section.rows) {
      for (let index = 0; index < row.count; index++) {
        const offset = offsetForIndex(row, index)
        lines.push(
          [
            section.title,
            row.segment,
            plcAddressForIndex(row, index),
            offset,
            formatModiconAddress(section.modiconBase, offset),
            row.registersPerValue,
            row.iecType,
          ].join(','),
        )
      }
    }
  }

  return `${lines.join('\n')}\n`
}

export {
  calculateModbusAddressMapping,
  formatBitAddress,
  formatModiconAddress,
  mappingToCsv,
  matrixRowCount,
  matrixRowLabel,
  offsetForIndex,
  plcAddressForIndex,
  resolveAddressQuery,
  sectionsOf,
}
export type {
  AddressHit,
  AddressMappingRow,
  AddressMappingSection,
  AddressQueryResult,
  IecType,
  ModbusAddressMapping,
  ModbusBlockKind,
  ModiconRange,
  SectionId,
}

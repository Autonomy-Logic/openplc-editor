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
 * Pure — no I/O, no store, no React.
 */

import type { ModbusBufferMapping } from '../../../middleware/shared/ports/types'
import { DEFAULT_BUFFER_MAPPING } from './generate-modbus-slave-config'

/** One IEC value inside a segment: where it answers and how wide it is. */
interface AddressMappingEntry {
  plcAddress: string
  offset: number
  bits: number
}

interface ModiconRange {
  start: string
  end: string
}

/** What `listSegmentEntries` left out, or `null` when it listed everything. */
interface OmittedEntries {
  count: number
  fromOffset: number
  toOffset: number
}

interface SegmentEntries {
  entries: AddressMappingEntry[]
  omitted: OmittedEntries | null
}

interface AddressMappingRow {
  segment: string
  /** Addressable unit of the block this row lives in — drives entry width. */
  unit: 'bit' | 'register'
  plcAddressStart: string
  plcAddressEnd: string
  modbusStart: number
  modbusEnd: number
  count: number
  modbusCount: number
  regsPerValue?: number
  disabled: boolean
}

interface AddressMappingSection {
  title: string
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

/**
 * `%QX<byte>.<bit>` — the IEC 61131-3 bit convention, where `bit` is 0…7.
 * So bit index 7 is `%QX0.7` and bit index 8 rolls over to `%QX1.0`.
 */
function formatBitAddress(prefix: string, bitIndex: number): string {
  const byteIndex = Math.floor(bitIndex / 8)
  const bit = bitIndex % 8
  return `${prefix}${byteIndex}.${bit}`
}

/**
 * The 5-digit Modicon convention datasheets and SCADA tools print: a block
 * digit followed by the **1-based** address, so holding register offset 0 is
 * `400001`. It names the same register the `offset` column does, one base
 * apart — which is the single most common source of off-by-one in Modbus
 * integration, and the reason both are on screen at once.
 */
function formatModiconAddress(blockDigit: string, offset: number): string {
  return `${blockDigit}${String(offset + 1).padStart(5, '0')}`
}

function buildModiconRange(blockDigit: string, totalAddresses: number): ModiconRange | null {
  if (totalAddresses === 0) return null
  return {
    start: formatModiconAddress(blockDigit, 0),
    end: formatModiconAddress(blockDigit, totalAddresses - 1),
  }
}

/**
 * How many entries `listSegmentEntries` will list before it stops counting.
 *
 * A default configuration is far larger than anyone reads: `%QX` alone is 8192
 * bits, and putting one row per bit in the DOM costs more than it informs.
 */
const MAX_LISTED_ENTRIES = 256

/**
 * Expand one segment into its individual IEC values — the address, the Modbus
 * offset it answers on, and its width.
 *
 * A `%MD` value spans two registers and a `%ML` four, so consecutive values do
 * not sit on consecutive offsets; that stride is the whole reason this list is
 * worth showing rather than leaving the reader to compute it.
 *
 * Truncated at `limit`, and what was dropped comes back in `omitted` so the
 * caller can say so instead of quietly showing a partial list.
 */
function listSegmentEntries(row: AddressMappingRow, limit: number = MAX_LISTED_ENTRIES): SegmentEntries {
  if (row.disabled) return { entries: [], omitted: null }

  const isBit = row.unit === 'bit'
  const stride = isBit ? 1 : (row.regsPerValue ?? 1)
  const bits = isBit ? 1 : stride * 16

  const listed = Math.min(row.count, limit)
  const entries: AddressMappingEntry[] = []
  for (let index = 0; index < listed; index++) {
    entries.push({
      plcAddress: isBit ? formatBitAddress(row.segment, index) : `${row.segment}${index}`,
      offset: row.modbusStart + index * stride,
      bits,
    })
  }

  const omittedCount = row.count - listed
  return {
    entries,
    omitted:
      omittedCount > 0
        ? { count: omittedCount, fromOffset: row.modbusStart + listed * stride, toOffset: row.modbusEnd }
        : null,
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
 * Compute the full Modbus ↔ IEC address map for a buffer configuration.
 *
 * A segment sized 0 is reported as `disabled` rather than omitted, so the
 * table shows the reader that the segment exists and is switched off (the
 * `%MX` default) instead of leaving them wondering where it went.
 */
function calculateModbusAddressMapping(bufferMapping?: ModbusBufferMapping): ModbusAddressMapping {
  const { holdingRegisters, coils, discreteInputs, inputRegisters } = withDefaults(bufferMapping)

  const qwStart = 0
  const qwEnd = holdingRegisters.qwCount > 0 ? holdingRegisters.qwCount - 1 : -1

  const mwStart = holdingRegisters.qwCount
  const mwEnd = holdingRegisters.mwCount > 0 ? mwStart + holdingRegisters.mwCount - 1 : mwStart - 1

  const mdStart = mwStart + holdingRegisters.mwCount
  const mdModbusCount = holdingRegisters.mdCount * 2
  const mdEnd = holdingRegisters.mdCount > 0 ? mdStart + mdModbusCount - 1 : mdStart - 1

  const mlStart = mdStart + mdModbusCount
  const mlModbusCount = holdingRegisters.mlCount * 4
  const mlEnd = holdingRegisters.mlCount > 0 ? mlStart + mlModbusCount - 1 : mlStart - 1

  const totalHoldingRegisters = holdingRegisters.qwCount + holdingRegisters.mwCount + mdModbusCount + mlModbusCount

  const qxStart = 0
  const qxEnd = coils.qxBits > 0 ? coils.qxBits - 1 : -1

  const mxStart = coils.qxBits
  const mxEnd = coils.mxBits > 0 ? mxStart + coils.mxBits - 1 : mxStart - 1

  const totalCoils = coils.qxBits + coils.mxBits

  return {
    holdingRegisters: {
      title: 'Holding Registers',
      totalAddresses: totalHoldingRegisters,
      modiconRange: buildModiconRange('4', totalHoldingRegisters),
      rows: [
        {
          segment: '%QW',
          unit: 'register',
          plcAddressStart: '%QW0',
          plcAddressEnd: `%QW${Math.max(0, holdingRegisters.qwCount - 1)}`,
          modbusStart: qwStart,
          modbusEnd: Math.max(0, qwEnd),
          count: holdingRegisters.qwCount,
          modbusCount: holdingRegisters.qwCount,
          disabled: holdingRegisters.qwCount === 0,
        },
        {
          segment: '%MW',
          unit: 'register',
          plcAddressStart: '%MW0',
          plcAddressEnd: `%MW${Math.max(0, holdingRegisters.mwCount - 1)}`,
          modbusStart: mwStart,
          modbusEnd: Math.max(mwStart, mwEnd),
          count: holdingRegisters.mwCount,
          modbusCount: holdingRegisters.mwCount,
          disabled: holdingRegisters.mwCount === 0,
        },
        {
          segment: '%MD',
          unit: 'register',
          plcAddressStart: '%MD0',
          plcAddressEnd: `%MD${Math.max(0, holdingRegisters.mdCount - 1)}`,
          modbusStart: mdStart,
          modbusEnd: Math.max(mdStart, mdEnd),
          count: holdingRegisters.mdCount,
          modbusCount: mdModbusCount,
          regsPerValue: 2,
          disabled: holdingRegisters.mdCount === 0,
        },
        {
          segment: '%ML',
          unit: 'register',
          plcAddressStart: '%ML0',
          plcAddressEnd: `%ML${Math.max(0, holdingRegisters.mlCount - 1)}`,
          modbusStart: mlStart,
          modbusEnd: Math.max(mlStart, mlEnd),
          count: holdingRegisters.mlCount,
          modbusCount: mlModbusCount,
          regsPerValue: 4,
          disabled: holdingRegisters.mlCount === 0,
        },
      ],
    },
    coils: {
      title: 'Coils',
      totalAddresses: totalCoils,
      modiconRange: buildModiconRange('0', totalCoils),
      rows: [
        {
          segment: '%QX',
          unit: 'bit',
          plcAddressStart: '%QX0.0',
          plcAddressEnd: formatBitAddress('%QX', Math.max(0, coils.qxBits - 1)),
          modbusStart: qxStart,
          modbusEnd: Math.max(0, qxEnd),
          count: coils.qxBits,
          modbusCount: coils.qxBits,
          disabled: coils.qxBits === 0,
        },
        {
          segment: '%MX',
          unit: 'bit',
          plcAddressStart: '%MX0.0',
          plcAddressEnd: formatBitAddress('%MX', Math.max(0, coils.mxBits - 1)),
          modbusStart: mxStart,
          modbusEnd: Math.max(mxStart, mxEnd),
          count: coils.mxBits,
          modbusCount: coils.mxBits,
          disabled: coils.mxBits === 0,
        },
      ],
    },
    discreteInputs: {
      title: 'Discrete Inputs',
      totalAddresses: discreteInputs.ixBits,
      modiconRange: buildModiconRange('1', discreteInputs.ixBits),
      rows: [
        {
          segment: '%IX',
          unit: 'bit',
          plcAddressStart: '%IX0.0',
          plcAddressEnd: formatBitAddress('%IX', Math.max(0, discreteInputs.ixBits - 1)),
          modbusStart: 0,
          modbusEnd: Math.max(0, discreteInputs.ixBits - 1),
          count: discreteInputs.ixBits,
          modbusCount: discreteInputs.ixBits,
          disabled: discreteInputs.ixBits === 0,
        },
      ],
    },
    inputRegisters: {
      title: 'Input Registers',
      totalAddresses: inputRegisters.iwCount,
      modiconRange: buildModiconRange('3', inputRegisters.iwCount),
      rows: [
        {
          segment: '%IW',
          unit: 'register',
          plcAddressStart: '%IW0',
          plcAddressEnd: `%IW${Math.max(0, inputRegisters.iwCount - 1)}`,
          modbusStart: 0,
          modbusEnd: Math.max(0, inputRegisters.iwCount - 1),
          count: inputRegisters.iwCount,
          modbusCount: inputRegisters.iwCount,
          disabled: inputRegisters.iwCount === 0,
        },
      ],
    },
  }
}

export { calculateModbusAddressMapping, formatBitAddress, formatModiconAddress, listSegmentEntries, MAX_LISTED_ENTRIES }
export type {
  AddressMappingEntry,
  AddressMappingRow,
  AddressMappingSection,
  ModbusAddressMapping,
  ModiconRange,
  SegmentEntries,
}

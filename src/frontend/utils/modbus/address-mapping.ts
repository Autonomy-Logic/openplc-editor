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

interface AddressMappingRow {
  segment: string
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
      rows: [
        {
          segment: '%QW',
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
      rows: [
        {
          segment: '%QX',
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
      rows: [
        {
          segment: '%IX',
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
      rows: [
        {
          segment: '%IW',
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

export { calculateModbusAddressMapping, formatBitAddress }
export type { AddressMappingRow, AddressMappingSection, ModbusAddressMapping }

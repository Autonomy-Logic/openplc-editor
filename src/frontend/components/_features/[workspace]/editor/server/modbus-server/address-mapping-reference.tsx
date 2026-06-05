import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronDownIcon } from '@radix-ui/react-icons'
import { useMemo, useState } from 'react'

import { cn } from '../../../../../../utils/cn'

// ---------------------------------------------------------------------------
// Types (self-contained — modbus utils not yet migrated)
// ---------------------------------------------------------------------------

interface ModbusSlaveBufferMapping {
  holdingRegisters: {
    qwCount: number
    mwCount: number
    mdCount: number
    mlCount: number
  }
  coils: {
    qxBits: number
    mxBits: number
  }
  discreteInputs: {
    ixBits: number
  }
  inputRegisters: {
    iwCount: number
  }
}

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
  functionCodes: string
  totalAddresses: number
  rows: AddressMappingRow[]
}

interface ModbusAddressMapping {
  holdingRegisters: AddressMappingSection
  coils: AddressMappingSection
  discreteInputs: AddressMappingSection
  inputRegisters: AddressMappingSection
}

// ---------------------------------------------------------------------------
// Address mapping calculation
// ---------------------------------------------------------------------------

function formatBitAddress(prefix: string, bitIndex: number): string {
  const byteIndex = Math.floor(bitIndex / 8)
  const bit = bitIndex % 8
  return `${prefix}${byteIndex}.${bit}`
}

function calculateModbusAddressMapping(bufferMapping: ModbusSlaveBufferMapping): ModbusAddressMapping {
  const { holdingRegisters, coils, discreteInputs, inputRegisters } = bufferMapping

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
      functionCodes: 'FC 3/6/16',
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
      functionCodes: 'FC 1/5/15',
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
      functionCodes: 'FC 2',
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
      functionCodes: 'FC 4',
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

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface MappingTableProps {
  section: AddressMappingSection
  isRegisterType: boolean
}

const MappingTable = ({ section, isRegisterType }: MappingTableProps) => {
  const countLabel = isRegisterType ? 'Registers' : 'Bits'

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <h4 className='text-xs font-medium text-neutral-700 dark:text-neutral-300'>
          {section.title}{' '}
          <span className='font-normal text-neutral-500 dark:text-neutral-400'>({section.functionCodes})</span>
        </h4>
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>
          Total: {section.totalAddresses.toLocaleString()}{' '}
          {section.totalAddresses === 1 ? countLabel.slice(0, -1) : countLabel.toLowerCase()}
        </span>
      </div>

      <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'>
        <table className='w-full text-xs'>
          <thead>
            <tr className='bg-neutral-100 text-left dark:bg-neutral-800'>
              <th className='px-3 py-1.5 font-medium text-neutral-600 dark:text-neutral-400'>Segment</th>
              <th className='px-3 py-1.5 font-medium text-neutral-600 dark:text-neutral-400'>PLC Address Range</th>
              <th className='px-3 py-1.5 font-medium text-neutral-600 dark:text-neutral-400'>Modbus Addresses</th>
              <th className='px-3 py-1.5 text-right font-medium text-neutral-600 dark:text-neutral-400'>
                {countLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row: AddressMappingRow) => (
              <tr
                key={row.segment}
                className={cn(
                  'border-t border-neutral-200 dark:border-neutral-700',
                  row.disabled && 'bg-neutral-50 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600',
                )}
              >
                <td className='px-3 py-1.5 font-mono font-medium'>{row.segment}</td>
                <td className='px-3 py-1.5 font-mono'>
                  {row.disabled ? (
                    <span className='italic'>disabled</span>
                  ) : (
                    `${row.plcAddressStart} - ${row.plcAddressEnd}`
                  )}
                </td>
                <td className='px-3 py-1.5 font-mono'>
                  {row.disabled ? (
                    <span className='italic'>-</span>
                  ) : (
                    <>
                      {row.modbusStart.toLocaleString()} - {row.modbusEnd.toLocaleString()}
                      {row.regsPerValue && (
                        <span className='ml-1 text-neutral-500 dark:text-neutral-400'>(x{row.regsPerValue})</span>
                      )}
                    </>
                  )}
                </td>
                <td className='px-3 py-1.5 text-right font-mono'>
                  {row.disabled ? '0' : row.modbusCount.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface AddressMappingReferenceProps {
  bufferMapping: ModbusSlaveBufferMapping
  defaultExpanded?: boolean
}

const AddressMappingReference = ({ bufferMapping, defaultExpanded = false }: AddressMappingReferenceProps) => {
  const [isOpen, setIsOpen] = useState(defaultExpanded)

  const mapping = useMemo(() => calculateModbusAddressMapping(bufferMapping), [bufferMapping])

  return (
    <CollapsiblePrimitive.Root open={isOpen} onOpenChange={setIsOpen}>
      <div className='rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'>
        <CollapsiblePrimitive.Trigger className='flex w-full items-center justify-between px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800'>
          <h3 className='font-caption text-sm font-semibold text-neutral-950 dark:text-white'>
            Address Mapping Reference
          </h3>
          <ChevronDownIcon
            className={cn(
              'h-4 w-4 text-neutral-500 transition-transform duration-200 dark:text-neutral-400',
              isOpen && 'rotate-180',
            )}
          />
        </CollapsiblePrimitive.Trigger>

        <CollapsiblePrimitive.Content className='overflow-hidden data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown'>
          <div className='flex flex-col gap-4 border-t border-neutral-200 p-4 dark:border-neutral-700'>
            <p className='text-xs text-neutral-600 dark:text-neutral-400'>
              This reference shows how IEC 61131-3 PLC addresses map to Modbus addresses based on your current buffer
              configuration. The mapping is sequential within each Modbus data block type.
            </p>

            <MappingTable section={mapping.holdingRegisters} isRegisterType={true} />
            <MappingTable section={mapping.coils} isRegisterType={false} />
            <MappingTable section={mapping.discreteInputs} isRegisterType={false} />
            <MappingTable section={mapping.inputRegisters} isRegisterType={true} />
          </div>
        </CollapsiblePrimitive.Content>
      </div>
    </CollapsiblePrimitive.Root>
  )
}

export { AddressMappingReference }
export type { AddressMappingRow, AddressMappingSection, ModbusSlaveBufferMapping }

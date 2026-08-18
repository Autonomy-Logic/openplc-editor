import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import type { ModbusBufferMapping } from '@root/middleware/shared/ports/types'
import { useMemo, useState } from 'react'

import { cn } from '../../../../../../utils/cn'
import type {
  AddressMappingRow,
  AddressMappingSection,
  SegmentEntries,
} from '../../../../../../utils/modbus/address-mapping'
import { calculateModbusAddressMapping, listSegmentEntries } from '../../../../../../utils/modbus/address-mapping'

const NO_ENTRIES: SegmentEntries = { entries: [], omitted: null }

interface SegmentRowProps {
  row: AddressMappingRow
}

const SegmentRow = ({ row }: SegmentRowProps) => {
  const [isOpen, setIsOpen] = useState(false)

  // Only pay for the expansion once it is asked for: a segment can hold
  // thousands of values and most of them are never opened.
  const { entries, omitted } = useMemo(() => (isOpen ? listSegmentEntries(row) : NO_ENTRIES), [isOpen, row])

  return (
    <>
      <tr
        className={cn(
          'border-t border-neutral-200 dark:border-neutral-700',
          row.disabled && 'bg-neutral-50 text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600',
        )}
      >
        <td className='px-3 py-1.5 font-mono font-medium'>
          {row.disabled ? (
            <span className='pl-4'>{row.segment}</span>
          ) : (
            <button
              type='button'
              onClick={() => setIsOpen((open) => !open)}
              aria-expanded={isOpen}
              className='flex items-center gap-1 font-mono font-medium hover:text-brand dark:hover:text-brand-light'
            >
              <ChevronRightIcon className={cn('h-3 w-3 shrink-0 transition-transform', isOpen && 'rotate-90')} />
              {row.segment}
            </button>
          )}
        </td>
        <td className='px-3 py-1.5 font-mono'>
          {row.disabled ? <span className='italic'>disabled</span> : `${row.plcAddressStart} - ${row.plcAddressEnd}`}
        </td>
        <td className='px-3 py-1.5 font-mono'>
          {row.disabled ? <span className='italic'>-</span> : `${row.modbusStart} - ${row.modbusEnd}`}
        </td>
        <td className='px-3 py-1.5 text-right font-mono'>{row.disabled ? '0' : row.modbusCount.toLocaleString()}</td>
      </tr>

      {entries.map((entry) => (
        <tr
          key={entry.plcAddress}
          className='border-t border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900'
        >
          <td className='px-3 py-1' />
          <td className='px-3 py-1 font-mono text-neutral-700 dark:text-neutral-300'>{entry.plcAddress}</td>
          <td className='px-3 py-1 font-mono text-brand dark:text-brand-light'>{entry.offset}</td>
          <td className='px-3 py-1 text-right font-mono text-neutral-500 dark:text-neutral-400'>
            {entry.bits} {entry.bits === 1 ? 'bit' : 'bits'}
          </td>
        </tr>
      ))}

      {omitted && (
        <tr className='border-t border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900'>
          <td className='px-3 py-1' />
          <td className='px-3 py-1 italic text-neutral-500 dark:text-neutral-400' colSpan={3}>
            {omitted.count.toLocaleString()} more, offsets {omitted.fromOffset} - {omitted.toOffset}
          </td>
        </tr>
      )}
    </>
  )
}

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
          {section.title}
          {section.modiconRange && (
            <span className='ml-2 font-mono text-xs font-normal text-neutral-500 dark:text-neutral-400'>
              {section.modiconRange.start} - {section.modiconRange.end}
            </span>
          )}
        </h4>
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>
          Total: {section.totalAddresses.toLocaleString()}{' '}
          {section.totalAddresses === 1 ? countLabel.slice(0, -1).toLowerCase() : countLabel.toLowerCase()}
        </span>
      </div>

      <div className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'>
        {/* Fixed widths, not auto: the four sections render as four sibling
         *  tables, and auto layout sizes each one to its own longest cell, so
         *  the columns drift out of line from one section to the next. */}
        <table className='w-full table-fixed text-xs'>
          <thead>
            <tr className='bg-neutral-100 text-left dark:bg-neutral-800'>
              <th className='w-[16%] px-3 py-1.5 font-medium text-neutral-600 dark:text-neutral-400'>Segment</th>
              <th className='w-[30%] px-3 py-1.5 font-medium text-neutral-600 dark:text-neutral-400'>
                PLC Address Range
              </th>
              <th className='w-[34%] px-3 py-1.5 font-medium text-neutral-600 dark:text-neutral-400'>Offset</th>
              <th className='w-[20%] px-3 py-1.5 text-right font-medium text-neutral-600 dark:text-neutral-400'>
                {countLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row: AddressMappingRow) => (
              <SegmentRow key={row.segment} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface AddressMappingReferenceProps {
  bufferMapping?: ModbusBufferMapping
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
              configuration. The mapping is sequential within each Modbus data block type. Expand a segment to list its
              individual addresses; the range next to each block title is the 1-based Modicon form of the same
              addresses.
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

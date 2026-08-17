import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronDownIcon } from '@radix-ui/react-icons'
import type { ModbusBufferMapping } from '@root/middleware/shared/ports/types'
import { useMemo, useState } from 'react'

import { cn } from '../../../../../../utils/cn'
import type { AddressMappingRow, AddressMappingSection } from '../../../../../../utils/modbus/address-mapping'
import { calculateModbusAddressMapping } from '../../../../../../utils/modbus/address-mapping'

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

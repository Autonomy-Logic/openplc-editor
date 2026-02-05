import { ArrowIcon } from '@root/renderer/assets/icons'
import type { ESIRepositoryItem } from '@root/types/ethercat/esi-types'
import { cn } from '@root/utils'
import { useCallback, useState } from 'react'

type ESIRepositoryTableProps = {
  repository: ESIRepositoryItem[]
  onRemoveItem: (itemId: string) => void | Promise<void>
  onClearAll: () => void | Promise<void>
}

/**
 * ESI Repository Table Component
 *
 * Displays loaded ESI files with expandable rows showing contained devices.
 */
const ESIRepositoryTable = ({ repository, onRemoveItem, onClearAll }: ESIRepositoryTableProps) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  const handleToggleExpand = useCallback((itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }, [])

  if (repository.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed border-neutral-300 p-8 dark:border-neutral-700'>
        <p className='text-sm text-neutral-500 dark:text-neutral-400'>
          No ESI files loaded. Upload files above to populate the repository.
        </p>
      </div>
    )
  }

  const totalDevices = repository.reduce((sum, item) => sum + item.devices.length, 0)

  return (
    <div className='flex flex-1 flex-col gap-2 overflow-hidden'>
      {/* Header with count and clear button */}
      <div className='flex items-center justify-between'>
        <span className='text-xs font-medium text-neutral-700 dark:text-neutral-300'>
          Loaded Files ({repository.length}) - {totalDevices} device(s)
        </span>
        <button
          onClick={() => void onClearAll()}
          className='text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300'
        >
          Clear All
        </button>
      </div>

      {/* Repository list */}
      <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
        <table className='w-full table-fixed'>
          <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
            <tr>
              <th className='w-8 px-2 py-2'></th>
              <th className='w-[35%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Filename
              </th>
              <th className='w-[30%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Vendor
              </th>
              <th className='w-[15%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Devices
              </th>
              <th className='px-2 py-2 text-right text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {repository.map((item) => (
              <RepositoryItemRow
                key={item.id}
                item={item}
                isExpanded={expandedItems.has(item.id)}
                onToggleExpand={() => handleToggleExpand(item.id)}
                onRemove={() => void onRemoveItem(item.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type RepositoryItemRowProps = {
  item: ESIRepositoryItem
  isExpanded: boolean
  onToggleExpand: () => void
  onRemove: () => void
}

const RepositoryItemRow = ({ item, isExpanded, onToggleExpand, onRemove }: RepositoryItemRowProps) => {
  return (
    <>
      {/* Main row */}
      <tr className='cursor-pointer border-b border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50'>
        <td className='px-2 py-2'>
          <button onClick={onToggleExpand} className='flex items-center justify-center'>
            <ArrowIcon
              direction='right'
              className={cn('h-4 w-4 stroke-brand-light transition-all', isExpanded && 'rotate-270 stroke-brand')}
            />
          </button>
        </td>
        <td className='px-2 py-2'>
          <div className='flex items-center gap-2'>
            <svg
              className='h-4 w-4 text-neutral-500 dark:text-neutral-400'
              fill='none'
              viewBox='0 0 24 24'
              stroke='currentColor'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={1.5}
                d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
              />
            </svg>
            <span className='truncate text-sm font-medium text-neutral-950 dark:text-neutral-100' title={item.filename}>
              {item.filename}
            </span>
            {item.warnings && item.warnings.length > 0 && (
              <span className='rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'>
                {item.warnings.length} warning(s)
              </span>
            )}
          </div>
        </td>
        <td className='px-2 py-2'>
          <span className='text-sm text-neutral-700 dark:text-neutral-300'>{item.vendor.name}</span>
          <span className='ml-1 font-mono text-xs text-neutral-500 dark:text-neutral-500'>({item.vendor.id})</span>
        </td>
        <td className='px-2 py-2 text-sm text-neutral-700 dark:text-neutral-300'>{item.devices.length}</td>
        <td className='px-2 py-2 text-right'>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className='text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300'
          >
            Remove
          </button>
        </td>
      </tr>

      {/* Expanded device rows */}
      {isExpanded &&
        item.devices.map((device, index) => (
          <tr
            key={`${item.id}-${index}`}
            className='border-b border-neutral-100 bg-neutral-50 dark:border-neutral-900 dark:bg-neutral-900/50'
          >
            <td className='px-2 py-1'></td>
            <td className='px-2 py-1 pl-8' colSpan={4}>
              <div className='flex items-center gap-4'>
                <div className='flex items-center gap-2'>
                  <svg className='h-3.5 w-3.5 text-brand' fill='none' viewBox='0 0 24 24' stroke='currentColor'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z'
                    />
                  </svg>
                  <span className='text-sm font-medium text-neutral-800 dark:text-neutral-200'>{device.name}</span>
                </div>
                <span className='font-mono text-xs text-neutral-500 dark:text-neutral-400'>
                  {device.type.productCode}
                </span>
                <span className='font-mono text-xs text-neutral-500 dark:text-neutral-400'>
                  Rev: {device.type.revisionNo}
                </span>
                {device.groupName && (
                  <span className='rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'>
                    {device.groupName}
                  </span>
                )}
              </div>
            </td>
          </tr>
        ))}

      {/* Warnings row */}
      {isExpanded && item.warnings && item.warnings.length > 0 && (
        <tr className='border-b border-neutral-100 bg-yellow-50 dark:border-neutral-900 dark:bg-yellow-900/10'>
          <td className='px-2 py-1'></td>
          <td className='px-2 py-1 pl-8' colSpan={4}>
            <div className='flex flex-col gap-0.5'>
              {item.warnings.map((warning, index) => (
                <span key={index} className='text-xs text-yellow-700 dark:text-yellow-400'>
                  {warning}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export { ESIRepositoryTable }

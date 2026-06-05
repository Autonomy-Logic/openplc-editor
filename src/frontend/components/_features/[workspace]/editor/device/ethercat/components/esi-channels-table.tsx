import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { cn } from '@root/frontend/utils/cn'
import type { ESIChannel } from '@root/middleware/shared/ports/esi-types'
import { useMemo, useState } from 'react'

type ESIChannelsTableProps = {
  channels: ESIChannel[]
  onChannelSelect?: (channelId: string, selected: boolean) => void
  onChannelSelectAll?: (selected: boolean) => void
  selectedChannels?: Set<string>
  showSelection?: boolean
}

type FilterDirection = 'all' | 'input' | 'output'

/**
 * ESI Channels Table Component
 *
 * Displays PDO channels from an ESI file with filtering and selection capabilities.
 */
const ESIChannelsTable = ({
  channels,
  onChannelSelect,
  onChannelSelectAll,
  selectedChannels = new Set(),
  showSelection = true,
}: ESIChannelsTableProps) => {
  const [filterDirection, setFilterDirection] = useState<FilterDirection>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Filter channels based on direction and search
  const filteredChannels = useMemo(() => {
    return channels.filter((channel) => {
      // Direction filter
      if (filterDirection !== 'all' && channel.direction !== filterDirection) {
        return false
      }

      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        return (
          channel.name.toLowerCase().includes(search) ||
          channel.pdoName.toLowerCase().includes(search) ||
          channel.dataType.toLowerCase().includes(search) ||
          channel.entryIndex.toLowerCase().includes(search)
        )
      }

      return true
    })
  }, [channels, filterDirection, searchTerm])

  // Count by direction
  const inputCount = channels.filter((c) => c.direction === 'input').length
  const outputCount = channels.filter((c) => c.direction === 'output').length

  // Check if all filtered channels are selected
  const allSelected = filteredChannels.length > 0 && filteredChannels.every((c) => selectedChannels.has(c.id))
  const someSelected = filteredChannels.some((c) => selectedChannels.has(c.id))

  const handleSelectAll = () => {
    if (onChannelSelectAll) {
      onChannelSelectAll(!allSelected)
    }
  }

  return (
    <div className='flex flex-col gap-3'>
      {/* Filters */}
      <div className='flex flex-wrap items-center gap-3'>
        {/* Direction Filter */}
        <div className='flex gap-2'>
          <button
            onClick={() => setFilterDirection('all')}
            className={cn(
              'h-7 rounded-md px-3 text-xs font-medium transition-colors',
              filterDirection === 'all'
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-100 text-brand-light dark:bg-neutral-900 dark:text-neutral-700',
            )}
          >
            All ({channels.length})
          </button>
          <button
            onClick={() => setFilterDirection('input')}
            className={cn(
              'h-7 rounded-md px-3 text-xs font-medium transition-colors',
              filterDirection === 'input'
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-100 text-brand-light dark:bg-neutral-900 dark:text-neutral-700',
            )}
          >
            Inputs ({inputCount})
          </button>
          <button
            onClick={() => setFilterDirection('output')}
            className={cn(
              'h-7 rounded-md px-3 text-xs font-medium transition-colors',
              filterDirection === 'output'
                ? 'bg-blue-500 text-white'
                : 'bg-neutral-100 text-brand-light dark:bg-neutral-900 dark:text-neutral-700',
            )}
          >
            Outputs ({outputCount})
          </button>
        </div>

        {/* Search */}
        <input
          type='text'
          placeholder='Search channels...'
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className='h-[30px] rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
        />

        {/* Selection count */}
        {showSelection && selectedChannels.size > 0 && (
          <span className='text-xs text-neutral-500 dark:text-neutral-400'>
            {selectedChannels.size} channel(s) selected
          </span>
        )}
      </div>

      {/* Table */}
      <div className='flex-1 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
        <table className='w-full table-fixed'>
          <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
            <tr>
              {showSelection && (
                <th className='w-[40px] px-2 py-2'>
                  <Checkbox
                    checked={someSelected && !allSelected ? 'indeterminate' : allSelected}
                    onCheckedChange={handleSelectAll}
                  />
                </th>
              )}
              <th className='w-[8%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Dir
              </th>
              <th className='w-[25%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Name
              </th>
              <th className='w-[15%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                PDO
              </th>
              <th className='w-[12%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Index
              </th>
              <th className='w-[10%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Type
              </th>
              <th className='w-[8%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Bits
              </th>
              <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                IEC Type
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredChannels.length === 0 ? (
              <tr>
                <td
                  colSpan={showSelection ? 8 : 7}
                  className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'
                >
                  {channels.length === 0 ? 'No channels available' : 'No channels match the current filter'}
                </td>
              </tr>
            ) : (
              filteredChannels.map((channel) => (
                <tr
                  key={channel.id}
                  onClick={() => showSelection && onChannelSelect?.(channel.id, !selectedChannels.has(channel.id))}
                  className={cn(
                    'cursor-pointer border-b border-neutral-200 transition-colors dark:border-neutral-800',
                    'hover:bg-neutral-50 dark:hover:bg-neutral-800/50',
                    selectedChannels.has(channel.id) && 'bg-brand/10 dark:bg-brand/20',
                  )}
                >
                  {showSelection && (
                    <td className='px-2 py-2'>
                      <Checkbox
                        checked={selectedChannels.has(channel.id)}
                        onCheckedChange={(checked) => onChannelSelect?.(channel.id, !!checked)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                  )}
                  <td className='px-2 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    {channel.direction === 'input' ? 'Input' : 'Output'}
                  </td>
                  <td
                    className='truncate px-2 py-2 text-sm font-medium text-neutral-950 dark:text-neutral-100'
                    title={channel.name}
                  >
                    {channel.name}
                  </td>
                  <td
                    className='truncate px-2 py-2 text-xs text-neutral-600 dark:text-neutral-400'
                    title={channel.pdoName}
                  >
                    {channel.pdoName}
                  </td>
                  <td className='px-2 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                    {channel.entryIndex}:{channel.entrySubIndex}
                  </td>
                  <td className='px-2 py-2 text-xs text-neutral-600 dark:text-neutral-400'>{channel.dataType}</td>
                  <td className='px-2 py-2 text-xs text-neutral-600 dark:text-neutral-400'>{channel.bitLen}</td>
                  <td className='px-2 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                    {channel.iecType}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export { ESIChannelsTable }

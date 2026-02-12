import type { ESIChannel, EtherCATChannelMapping } from '@root/types/ethercat/esi-types'
import { cn } from '@root/utils'
import { useCallback, useMemo, useState } from 'react'

type ChannelMappingTableProps = {
  channels: ESIChannel[]
  mappings: EtherCATChannelMapping[]
  onAliasChange: (channelId: string, newAlias: string) => void
}

type FilterDirection = 'all' | 'input' | 'output'

/**
 * Alias cell with local state to avoid re-rendering the entire table on every keystroke.
 */
const AliasCell = ({
  channelId,
  alias,
  onAliasChange,
}: {
  channelId: string
  alias: string
  onAliasChange: (channelId: string, newAlias: string) => void
}) => {
  const [localAlias, setLocalAlias] = useState(alias)

  const handleBlur = useCallback(() => {
    if (localAlias !== alias) {
      onAliasChange(channelId, localAlias)
    }
  }, [channelId, localAlias, alias, onAliasChange])

  return (
    <input
      type='text'
      value={localAlias}
      onChange={(e) => setLocalAlias(e.target.value)}
      onBlur={handleBlur}
      placeholder='Alias'
      className='h-[24px] w-full rounded border border-neutral-300 bg-white px-1.5 font-mono text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
    />
  )
}

/**
 * Channel Mapping Table Component
 *
 * Displays channels with auto-generated IEC 61131-3 located variable addresses (read-only)
 * and editable alias column.
 */
const ChannelMappingTable = ({ channels, mappings, onAliasChange }: ChannelMappingTableProps) => {
  const [filterDirection, setFilterDirection] = useState<FilterDirection>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Build a lookup map from channelId to mapping
  const mappingMap = useMemo(() => {
    const map = new Map<string, EtherCATChannelMapping>()
    for (const m of mappings) {
      map.set(m.channelId, m)
    }
    return map
  }, [mappings])

  // Filter channels based on direction and search
  const filteredChannels = useMemo(() => {
    return channels.filter((channel) => {
      if (filterDirection !== 'all' && channel.direction !== filterDirection) {
        return false
      }

      if (searchTerm) {
        const search = searchTerm.toLowerCase()
        const mapping = mappingMap.get(channel.id)
        return (
          channel.name.toLowerCase().includes(search) ||
          channel.dataType.toLowerCase().includes(search) ||
          channel.entryIndex.toLowerCase().includes(search) ||
          channel.iecType.toLowerCase().includes(search) ||
          (mapping?.iecLocation.toLowerCase().includes(search) ?? false) ||
          (mapping?.alias?.toLowerCase().includes(search) ?? false)
        )
      }

      return true
    })
  }, [channels, filterDirection, searchTerm, mappingMap])

  const inputCount = channels.filter((c) => c.direction === 'input').length
  const outputCount = channels.filter((c) => c.direction === 'output').length

  return (
    <div className='flex flex-col gap-3'>
      {/* Filters */}
      <div className='flex flex-wrap items-center gap-3'>
        {/* Direction Filter */}
        <div className='flex rounded-md border border-neutral-300 dark:border-neutral-700'>
          <button
            onClick={() => setFilterDirection('all')}
            className={cn(
              'px-3 py-1 text-xs font-medium transition-colors',
              filterDirection === 'all'
                ? 'bg-brand text-white'
                : 'bg-white text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800',
            )}
          >
            All ({channels.length})
          </button>
          <button
            onClick={() => setFilterDirection('input')}
            className={cn(
              'border-l border-neutral-300 px-3 py-1 text-xs font-medium transition-colors dark:border-neutral-700',
              filterDirection === 'input'
                ? 'bg-green-500 text-white'
                : 'bg-white text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800',
            )}
          >
            Inputs ({inputCount})
          </button>
          <button
            onClick={() => setFilterDirection('output')}
            className={cn(
              'border-l border-neutral-300 px-3 py-1 text-xs font-medium transition-colors dark:border-neutral-700',
              filterDirection === 'output'
                ? 'bg-blue-500 text-white'
                : 'bg-white text-neutral-700 hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800',
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
      </div>

      {/* Table */}
      <div className='max-h-[400px] overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
        <table className='w-full table-fixed'>
          <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
            <tr>
              <th className='w-[7%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Dir
              </th>
              <th className='w-[18%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Name
              </th>
              <th className='w-[10%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Index
              </th>
              <th className='w-[9%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Type
              </th>
              <th className='w-[6%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Bits
              </th>
              <th className='w-[9%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                IEC Type
              </th>
              <th className='w-[14%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                IEC Location
              </th>
              <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Alias</th>
            </tr>
          </thead>
          <tbody>
            {filteredChannels.length === 0 ? (
              <tr>
                <td colSpan={8} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                  {channels.length === 0 ? 'No channels available' : 'No channels match the current filter'}
                </td>
              </tr>
            ) : (
              filteredChannels.map((channel) => {
                const mapping = mappingMap.get(channel.id)
                return (
                  <tr
                    key={channel.id}
                    className='border-b border-neutral-200 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50'
                  >
                    <td className='px-2 py-1.5'>
                      <span
                        className={cn(
                          'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
                          channel.direction === 'input'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
                        )}
                      >
                        {channel.direction === 'input' ? 'IN' : 'OUT'}
                      </span>
                    </td>
                    <td
                      className='truncate px-2 py-1.5 text-sm font-medium text-neutral-950 dark:text-neutral-100'
                      title={channel.name}
                    >
                      {channel.name}
                    </td>
                    <td className='px-2 py-1.5 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                      {channel.entryIndex}:{channel.entrySubIndex}
                    </td>
                    <td className='px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400'>{channel.dataType}</td>
                    <td className='px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400'>{channel.bitLen}</td>
                    <td className='px-2 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                      {channel.iecType}
                    </td>
                    <td className='px-2 py-1.5 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                      {mapping?.iecLocation ?? ''}
                    </td>
                    <td className='px-2 py-1.5'>
                      <AliasCell channelId={channel.id} alias={mapping?.alias ?? ''} onAliasChange={onAliasChange} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export { ChannelMappingTable }

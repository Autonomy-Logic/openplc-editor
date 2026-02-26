import type { SDOConfigurationEntry } from '@root/types/ethercat/esi-types'
import { cn } from '@root/utils'
import { useCallback, useMemo, useState } from 'react'

type SdoParametersTableProps = {
  sdoConfigurations: SDOConfigurationEntry[]
  onUpdateSdoConfigurations: (configs: SDOConfigurationEntry[]) => void
}

/**
 * Get numeric range for a data type.
 */
function getDataTypeRange(dataType: string, bitLength: number): { min: number; max: number } | null {
  const upper = dataType.toUpperCase()

  if (upper === 'BOOL') return { min: 0, max: 1 }
  if (upper === 'USINT' || upper === 'UINT8') return { min: 0, max: 255 }
  if (upper === 'SINT' || upper === 'INT8') return { min: -128, max: 127 }
  if (upper === 'UINT' || upper === 'UINT16') return { min: 0, max: 65535 }
  if (upper === 'INT' || upper === 'INT16') return { min: -32768, max: 32767 }
  if (upper === 'UDINT' || upper === 'UINT32') return { min: 0, max: 4294967295 }
  if (upper === 'DINT' || upper === 'INT32') return { min: -2147483648, max: 2147483647 }

  // Fallback based on bit length for unsigned
  if (bitLength > 0 && bitLength <= 32) {
    return { min: 0, max: Math.pow(2, bitLength) - 1 }
  }

  return null
}

/**
 * Check if the data type is boolean.
 */
function isBoolType(dataType: string): boolean {
  return dataType.toUpperCase() === 'BOOL'
}

/**
 * Value cell with local state to avoid re-rendering the entire table on every keystroke.
 */
const ValueCell = ({
  entry,
  onValueChange,
}: {
  entry: SDOConfigurationEntry
  onValueChange: (index: string, subIndex: number, value: string) => void
}) => {
  const [localValue, setLocalValue] = useState(entry.value)

  const handleBlur = useCallback(() => {
    if (localValue !== entry.value) {
      // Validate before committing
      const range = getDataTypeRange(entry.dataType, entry.bitLength)
      if (range && localValue !== '') {
        const num = Number(localValue)
        if (!isNaN(num)) {
          const clamped = Math.max(range.min, Math.min(range.max, num))
          const clampedStr = String(clamped)
          setLocalValue(clampedStr)
          onValueChange(entry.index, entry.subIndex, clampedStr)
          return
        }
      }
      onValueChange(entry.index, entry.subIndex, localValue)
    }
  }, [entry.index, entry.subIndex, entry.value, entry.dataType, entry.bitLength, localValue, onValueChange])

  if (isBoolType(entry.dataType)) {
    return (
      <input
        type='checkbox'
        checked={localValue === '1' || localValue.toLowerCase() === 'true'}
        onChange={(e) => {
          const newVal = e.target.checked ? '1' : '0'
          setLocalValue(newVal)
          onValueChange(entry.index, entry.subIndex, newVal)
        }}
        className='h-4 w-4 accent-brand'
      />
    )
  }

  const range = getDataTypeRange(entry.dataType, entry.bitLength)

  return (
    <input
      type='number'
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      min={range?.min}
      max={range?.max}
      className='h-[24px] w-full max-w-[120px] rounded border border-neutral-300 bg-white px-1.5 font-mono text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
    />
  )
}

/**
 * SDO Parameters Table Component
 *
 * Displays configurable SDO startup parameters extracted from the CoE Object Dictionary.
 * Allows editing values that will be written to the slave during EtherCAT startup.
 */
const SdoParametersTable = ({ sdoConfigurations, onUpdateSdoConfigurations }: SdoParametersTableProps) => {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredEntries = useMemo(() => {
    if (!searchTerm) return sdoConfigurations

    const search = searchTerm.toLowerCase()
    return sdoConfigurations.filter(
      (entry) =>
        entry.name.toLowerCase().includes(search) ||
        entry.objectName.toLowerCase().includes(search) ||
        entry.index.toLowerCase().includes(search) ||
        entry.dataType.toLowerCase().includes(search),
    )
  }, [sdoConfigurations, searchTerm])

  const handleValueChange = useCallback(
    (index: string, subIndex: number, value: string) => {
      const updated = sdoConfigurations.map((entry) =>
        entry.index === index && entry.subIndex === subIndex ? { ...entry, value } : entry,
      )
      onUpdateSdoConfigurations(updated)
    },
    [sdoConfigurations, onUpdateSdoConfigurations],
  )

  const handleResetAll = useCallback(() => {
    const reset = sdoConfigurations.map((entry) => ({ ...entry, value: entry.defaultValue }))
    onUpdateSdoConfigurations(reset)
  }, [sdoConfigurations, onUpdateSdoConfigurations])

  const hasModifiedValues = sdoConfigurations.some((entry) => entry.value !== entry.defaultValue)

  return (
    <div className='flex flex-col gap-3'>
      {/* Toolbar */}
      <div className='flex flex-wrap items-center gap-3'>
        <input
          type='text'
          placeholder='Search parameters...'
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className='h-[30px] rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
        />
        <button
          onClick={handleResetAll}
          disabled={!hasModifiedValues}
          className={cn(
            'h-[30px] rounded-md border border-neutral-300 px-3 text-xs font-medium transition-colors',
            'bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          Reset All to Defaults
        </button>
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>
          {sdoConfigurations.length} parameter(s)
          {hasModifiedValues && ' — modified values highlighted'}
        </span>
      </div>

      {/* Table */}
      <div className='max-h-[400px] overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
        <table className='w-full table-fixed'>
          <thead className='sticky top-0 bg-neutral-100 dark:bg-neutral-900'>
            <tr>
              <th className='w-[12%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Index
              </th>
              <th className='w-[6%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Sub
              </th>
              <th className='w-[22%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Name
              </th>
              <th className='w-[12%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Type
              </th>
              <th className='w-[8%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Bits
              </th>
              <th className='w-[12%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Default
              </th>
              <th className='w-[14%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Value
              </th>
              <th className='px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>Object</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={8} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                  {sdoConfigurations.length === 0
                    ? 'No configurable SDO parameters found'
                    : 'No parameters match the current filter'}
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => {
                const isModified = entry.value !== entry.defaultValue
                return (
                  <tr
                    key={`${entry.index}-${entry.subIndex}`}
                    className={cn(
                      'border-b border-neutral-200 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50',
                      isModified && 'bg-amber-50/50 dark:bg-amber-900/10',
                    )}
                  >
                    <td className='px-2 py-1.5 font-mono text-xs text-neutral-700 dark:text-neutral-300'>
                      {entry.index}
                    </td>
                    <td className='px-2 py-1.5 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
                      {entry.subIndex}
                    </td>
                    <td
                      className='truncate px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300'
                      title={entry.name}
                    >
                      {entry.name}
                    </td>
                    <td className='px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400'>{entry.dataType}</td>
                    <td className='px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400'>{entry.bitLength}</td>
                    <td className='px-2 py-1.5 font-mono text-xs text-neutral-500 dark:text-neutral-500'>
                      {entry.defaultValue || '-'}
                    </td>
                    <td className='px-2 py-1.5'>
                      <ValueCell entry={entry} onValueChange={handleValueChange} />
                    </td>
                    <td
                      className='truncate px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-500'
                      title={entry.objectName}
                    >
                      {entry.objectName}
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

export { SdoParametersTable }

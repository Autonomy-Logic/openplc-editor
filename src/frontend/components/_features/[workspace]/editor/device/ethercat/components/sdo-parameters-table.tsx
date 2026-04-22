import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { cn } from '@root/frontend/utils/cn'
import type { SDOConfigurationEntry } from '@root/middleware/shared/ports/esi-types'
import { useCallback, useEffect, useMemo, useState } from 'react'

type SdoParametersTableProps = {
  sdoConfigurations: SDOConfigurationEntry[]
  onUpdateSdoConfigurations: (configs: SDOConfigurationEntry[]) => void
}

/**
 * A group of SDO entries sharing the same parent object (index + objectName).
 */
interface SdoObjectGroup {
  index: string
  objectName: string
  entries: SDOConfigurationEntry[]
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
  if (upper === 'REAL' || upper === 'REAL32' || upper === 'FLOAT') return { min: -3.4028235e38, max: 3.4028235e38 }
  if (upper === 'LREAL' || upper === 'REAL64' || upper === 'DOUBLE')
    return { min: -1.7976931348623157e308, max: 1.7976931348623157e308 }

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

  useEffect(() => {
    setLocalValue(entry.value)
  }, [entry.value])

  const handleBlur = useCallback(() => {
    if (localValue !== entry.value) {
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
  const isFloat = ['REAL', 'REAL32', 'FLOAT', 'LREAL', 'REAL64', 'DOUBLE'].includes(entry.dataType.toUpperCase())
  const isNumeric = range !== null

  return (
    <input
      type={isNumeric ? 'number' : 'text'}
      step={isFloat ? 'any' : undefined}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      min={isNumeric ? range?.min : undefined}
      max={isNumeric ? range?.max : undefined}
      className='h-[24px] w-full max-w-[120px] rounded border border-neutral-300 bg-white px-1.5 font-mono text-xs text-neutral-700 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
    />
  )
}

/**
 * SDO Parameters Table Component
 *
 * Displays configurable SDO startup parameters grouped by parent CoE object.
 * Each object is a collapsible section header; sub-items are shown as editable rows beneath.
 */
const SdoParametersTable = ({ sdoConfigurations, onUpdateSdoConfigurations }: SdoParametersTableProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Group entries by parent object index
  const groups = useMemo<SdoObjectGroup[]>(() => {
    const map = new Map<string, SdoObjectGroup>()
    for (const entry of sdoConfigurations) {
      const existing = map.get(entry.index)
      if (existing) {
        existing.entries.push(entry)
      } else {
        map.set(entry.index, { index: entry.index, objectName: entry.objectName, entries: [entry] })
      }
    }
    return Array.from(map.values())
  }, [sdoConfigurations])

  // Filter groups and entries by search term
  const filteredGroups = useMemo<SdoObjectGroup[]>(() => {
    if (!searchTerm) return groups

    const search = searchTerm.toLowerCase()
    const result: SdoObjectGroup[] = []

    for (const group of groups) {
      // If group name/index matches, include entire group
      if (group.objectName.toLowerCase().includes(search) || group.index.toLowerCase().includes(search)) {
        result.push(group)
        continue
      }

      // Otherwise filter entries within the group
      const matchedEntries = group.entries.filter(
        (entry) =>
          entry.name.toLowerCase().includes(search) ||
          entry.dataType.toLowerCase().includes(search) ||
          entry.index.toLowerCase().includes(search),
      )

      if (matchedEntries.length > 0) {
        result.push({ ...group, entries: matchedEntries })
      }
    }

    return result
  }, [groups, searchTerm])

  const handleToggleGroup = useCallback((index: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  const handleExpandAll = useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  const handleCollapseAll = useCallback(() => {
    setCollapsedGroups(new Set(groups.map((g) => g.index)))
  }, [groups])

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
  const totalEntries = sdoConfigurations.length

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
        <div className='flex items-center gap-1'>
          <button
            onClick={handleExpandAll}
            className='h-[30px] rounded-md border border-neutral-300 px-2 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
          >
            Expand All
          </button>
          <button
            onClick={handleCollapseAll}
            className='h-[30px] rounded-md border border-neutral-300 px-2 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
          >
            Collapse All
          </button>
        </div>
        <span className='text-xs text-neutral-500 dark:text-neutral-400'>
          {filteredGroups.length} object(s), {totalEntries} parameter(s)
          {hasModifiedValues && ' — modified values highlighted'}
        </span>
      </div>

      {/* Table */}
      <div className='max-h-[400px] overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800'>
        <table className='w-full table-fixed'>
          <thead className='sticky top-0 z-10 bg-neutral-100 dark:bg-neutral-900'>
            <tr>
              <th className='w-[6%] px-2 py-2'></th>
              <th className='w-[14%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Sub
              </th>
              <th className='w-[26%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Name
              </th>
              <th className='w-[12%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Type
              </th>
              <th className='w-[8%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Bits
              </th>
              <th className='w-[14%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Default
              </th>
              <th className='w-[20%] px-2 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300'>
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={7} className='px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400'>
                  {sdoConfigurations.length === 0
                    ? 'No configurable SDO parameters found'
                    : 'No parameters match the current filter'}
                </td>
              </tr>
            ) : (
              filteredGroups.map((group) => {
                const isCollapsed = collapsedGroups.has(group.index)
                const groupHasModified = group.entries.some((e) => e.value !== e.defaultValue)

                return (
                  <GroupRows
                    key={group.index}
                    group={group}
                    isCollapsed={isCollapsed}
                    hasModified={groupHasModified}
                    onToggle={() => handleToggleGroup(group.index)}
                    onValueChange={handleValueChange}
                  />
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Renders a group header row + its sub-item rows (when expanded).
 * Extracted as a component to avoid key issues with fragments in map.
 */
const GroupRows = ({
  group,
  isCollapsed,
  hasModified,
  onToggle,
  onValueChange,
}: {
  group: SdoObjectGroup
  isCollapsed: boolean
  hasModified: boolean
  onToggle: () => void
  onValueChange: (index: string, subIndex: number, value: string) => void
}) => {
  return (
    <>
      {/* Group header row */}
      <tr
        onClick={onToggle}
        className='cursor-pointer border-b border-neutral-200 bg-neutral-50 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-850 dark:hover:bg-neutral-800'
      >
        <td className='px-2 py-1.5'>
          <ArrowIcon
            direction='right'
            className={cn('h-3.5 w-3.5 stroke-brand-light transition-transform', !isCollapsed && 'rotate-270')}
          />
        </td>
        <td colSpan={6} className='px-2 py-1.5'>
          <div className='flex items-center gap-2'>
            <span className='font-mono text-xs font-semibold text-brand dark:text-brand-light'>{group.index}</span>
            <span className='text-xs font-medium text-neutral-800 dark:text-neutral-200'>{group.objectName}</span>
            <span className='text-xs text-neutral-500 dark:text-neutral-500'>
              ({group.entries.length} param{group.entries.length !== 1 && 's'})
            </span>
            {hasModified && (
              <span className='rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'>
                modified
              </span>
            )}
          </div>
        </td>
      </tr>

      {/* Sub-item rows */}
      {!isCollapsed &&
        group.entries.map((entry) => {
          const isModified = entry.value !== entry.defaultValue
          return (
            <tr
              key={`${entry.index}-${entry.subIndex}`}
              className={cn(
                'border-b border-neutral-200 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50',
                isModified && 'bg-amber-50/50 dark:bg-amber-900/10',
              )}
            >
              <td className='px-2 py-1.5'></td>
              <td className='px-2 py-1.5 font-mono text-xs text-neutral-600 dark:text-neutral-400'>{entry.subIndex}</td>
              <td className='truncate px-2 py-1.5 text-xs text-neutral-700 dark:text-neutral-300' title={entry.name}>
                {entry.name}
              </td>
              <td className='px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400'>{entry.dataType}</td>
              <td className='px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400'>{entry.bitLength}</td>
              <td className='px-2 py-1.5 font-mono text-xs text-neutral-500 dark:text-neutral-500'>
                {entry.defaultValue || '-'}
              </td>
              <td className='px-2 py-1.5'>
                <ValueCell entry={entry} onValueChange={onValueChange} />
              </td>
            </tr>
          )
        })}
    </>
  )
}

export { SdoParametersTable }

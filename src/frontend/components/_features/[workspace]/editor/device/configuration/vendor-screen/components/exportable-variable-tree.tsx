import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import type { ExportableVariable } from '@root/middleware/shared/vendor-document/protocol'
import { useEffect, useMemo, useState } from 'react'

import type { ExportableGroup } from './group-exportable-variables'

type ExportableVariableTreeProps = {
  groups: ReadonlyArray<ExportableGroup>
  selectedQualifiers: ReadonlySet<string>
  disabled: boolean
  readonly: boolean
  filter: string
  onToggleVariable: (variable: ExportableVariable, next: boolean) => void
  onToggleGroup: (group: ExportableGroup, next: 'all' | 'none') => void
}

type GroupSelectionState = 'all' | 'some' | 'none'

function selectionStateOf(group: ExportableGroup, selected: ReadonlySet<string>): GroupSelectionState {
  if (group.variables.length === 0) return 'none'
  let n = 0
  for (const v of group.variables) if (selected.has(v.qualifier)) n++
  if (n === 0) return 'none'
  if (n === group.variables.length) return 'all'
  return 'some'
}

/**
 * Hierarchical left pane of the variable-tree-picker layout. Each group is a
 * program POU or the GVL node; leaves are the project's `ExportableVariable`s.
 * A group-level tri-state checkbox selects or clears every variable under it;
 * the active filter hides groups whose leaves do not match and auto-expands
 * every surviving group so the matches are immediately visible.
 */
export function ExportableVariableTree({
  groups,
  selectedQualifiers,
  disabled,
  readonly,
  filter,
  onToggleVariable,
  onToggleGroup,
}: ExportableVariableTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.map((g) => g.key)))

  // Keep the expansion set in sync with the group list so a newly added POU
  // defaults to open and a removed one does not linger as a stale key.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev)
      const known = new Set(groups.map((g) => g.key))
      for (const key of prev) if (!known.has(key)) next.delete(key)
      for (const g of groups) if (!next.has(g.key) && !prev.has(g.key) && prev.size === 0) next.add(g.key)
      return next
    })
  }, [groups])

  const normalizedFilter = filter.trim().toLowerCase()
  const matcher = useMemo(() => {
    if (!normalizedFilter) return () => true
    return (v: ExportableVariable) => v.qualifier.toLowerCase().includes(normalizedFilter)
  }, [normalizedFilter])

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <p className='p-3 font-caption text-cp-base text-neutral-500 dark:text-neutral-400'>
        No exportable variables in this project yet. Create a POU with VAR declarations.
      </p>
    )
  }

  const visibleGroups = groups
    .map((group) => ({ group, matched: group.variables.filter(matcher) }))
    .filter(({ matched }) => !normalizedFilter || matched.length > 0)

  if (visibleGroups.length === 0) {
    return (
      <p className='p-3 font-caption text-cp-base text-neutral-500 dark:text-neutral-400'>
        No variables match the filter.
      </p>
    )
  }

  return (
    <ul className='flex flex-col gap-1 p-2'>
      {visibleGroups.map(({ group, matched }) => {
        const state = selectionStateOf(group, selectedQualifiers)
        const open = normalizedFilter ? true : expanded.has(group.key)
        const selectedCount = group.variables.reduce((acc, v) => acc + (selectedQualifiers.has(v.qualifier) ? 1 : 0), 0)
        return (
          <li key={group.key} className='flex flex-col'>
            <div className='flex items-center gap-2 rounded px-1 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800'>
              <button
                type='button'
                aria-label={open ? `Collapse ${group.label}` : `Expand ${group.label}`}
                className='flex h-4 w-4 items-center justify-center text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                onClick={() => toggleExpand(group.key)}
              >
                {open ? <ChevronDownIcon className='h-3.5 w-3.5' /> : <ChevronRightIcon className='h-3.5 w-3.5' />}
              </button>
              <Checkbox
                aria-label={`Select all variables in ${group.label}`}
                checked={state === 'all' ? true : state === 'some' ? 'indeterminate' : false}
                disabled={disabled || readonly || group.variables.length === 0}
                onCheckedChange={(next) => {
                  if (disabled || readonly) return
                  onToggleGroup(group, next === true ? 'all' : 'none')
                }}
              />
              <span className='font-caption text-cp-base font-semibold text-neutral-950 dark:text-white'>
                {group.label}
              </span>
              <span className='font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
                ({group.kind === 'gvl' ? 'GVL' : 'Program'} · {selectedCount}/{group.variables.length})
              </span>
            </div>
            {open && (
              <ul className='mt-0.5 flex flex-col gap-0.5 pl-10'>
                {matched.map((variable) => (
                  <li
                    key={variable.qualifier}
                    className='flex items-center gap-2 rounded px-1 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  >
                    <Checkbox
                      aria-label={`Expose ${variable.qualifier}`}
                      checked={selectedQualifiers.has(variable.qualifier)}
                      disabled={disabled || readonly}
                      onCheckedChange={(next) => onToggleVariable(variable, next === true)}
                    />
                    <span className='flex-1 font-caption text-cp-base text-neutral-850 dark:text-neutral-300'>
                      {variable.qualifier}
                    </span>
                    <span className='font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
                      {variable.type}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

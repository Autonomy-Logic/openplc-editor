import type { ExportableVariable } from '@root/middleware/shared/vendor-document/protocol'
import { useEffect, useMemo, useState } from 'react'

import { ExportableVariableTree } from '../components/exportable-variable-tree'
import { type ExportableGroup, groupByScope } from '../components/group-exportable-variables'
import { SelectedExportsList } from '../components/selected-exports-list'
import type { ScreenSection } from '../index'
import { useExportableVariables } from '../use-exportable-variables'
import { useSectionStorage } from '../use-section-storage'

/** How long the user has to stop typing in the search box before the filter commits. */
const SEARCH_DEBOUNCE_MS = 300

/** Shape of each entry written to `storage.values.exports`. Flat on purpose so
 *  the emitter contract never has to learn the tree the UI draws on top of it. */
type ExportEntry = { qualifier: string; direction: 'RO' | 'RW' }

type SearchSpec = { field?: string; placeholder?: string }

type VariableTreePickerLayoutProps = {
  section: ScreenSection
  // Set by the section-renderer when the section's `enabledWhen` evaluates to
  // false. The two panes still render (so the user sees current state) but
  // every control is inert until the gate opens.
  disabled?: boolean
}

/** Narrow `storage.values.exports` into the shape the UI needs, dropping any
 *  entry the schema check rejects. Shared with the roundtrip test fixture. */
function readExportsFromStorage(raw: unknown): ExportEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ExportEntry[] = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    const q = (e as { qualifier?: unknown }).qualifier
    const d = (e as { direction?: unknown }).direction
    if (typeof q === 'string' && (d === 'RO' || d === 'RW')) out.push({ qualifier: q, direction: d })
  }
  return out
}

/**
 * Hierarchical picker for Data Hub exports. Left pane groups the project's
 * exportable variables by scope (programs first, GVLs last); right pane lists
 * the current selection with an inline Access dropdown and a remove button.
 * Persistence is the same flat `storage.exports[]` the table layout wrote, so
 * downstream (emitter, PlcModelPort, host-query handler) stays untouched.
 */
function VariableTreePickerLayout({ section, disabled = false }: VariableTreePickerLayoutProps) {
  const storage = useSectionStorage(section)
  const variables = useExportableVariables()

  const search = useMemo(
    () => (section.search && typeof section.search === 'object' ? (section.search as SearchSpec) : null) ?? null,
    [section.search],
  )

  const groups = useMemo(() => groupByScope(variables), [variables])

  const exports: ReadonlyArray<ExportEntry> = useMemo(
    () => readExportsFromStorage(storage.values.exports),
    [storage.values.exports],
  )

  const selectedQualifiers = useMemo(() => {
    const s = new Set<string>()
    for (const e of exports) s.add(e.qualifier)
    return s
  }, [exports])

  const [searchInput, setSearchInput] = useState('')
  const [filter, setFilter] = useState('')
  useEffect(() => {
    const handle = window.setTimeout(() => setFilter(searchInput), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [searchInput])

  const commitExports = (next: ExportEntry[]) => {
    if (disabled || storage.readonly) return
    storage.setField('exports', next)
  }

  const toggleVariable = (variable: ExportableVariable, next: boolean) => {
    if (next) {
      if (selectedQualifiers.has(variable.qualifier)) return
      commitExports([...exports, { qualifier: variable.qualifier, direction: 'RO' }])
    } else {
      commitExports(exports.filter((e) => e.qualifier !== variable.qualifier))
    }
  }

  const toggleGroup = (group: ExportableGroup, next: 'all' | 'none') => {
    if (next === 'all') {
      const additions: ExportEntry[] = []
      for (const v of group.variables) {
        if (!selectedQualifiers.has(v.qualifier)) additions.push({ qualifier: v.qualifier, direction: 'RO' })
      }
      if (additions.length === 0) return
      commitExports([...exports, ...additions])
    } else {
      const toRemove = new Set(group.variables.map((v) => v.qualifier))
      commitExports(exports.filter((e) => !toRemove.has(e.qualifier)))
    }
  }

  const setDirection = (qualifier: string, direction: 'RO' | 'RW') => {
    if (!selectedQualifiers.has(qualifier)) return
    commitExports(exports.map((e) => (e.qualifier === qualifier ? { qualifier, direction } : e)))
  }

  const removeQualifier = (qualifier: string) => {
    commitExports(exports.filter((e) => e.qualifier !== qualifier))
  }

  return (
    <div className='flex min-h-[400px] flex-col gap-3'>
      {search && (
        <div className='flex items-center gap-2'>
          <input
            type='text'
            value={searchInput}
            placeholder={search.placeholder ?? 'Filter...'}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label='Filter variables'
            disabled={disabled}
            className='flex h-[32px] w-72 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-base font-medium text-neutral-850 outline-none focus:border-brand-medium-dark disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
          />
        </div>
      )}
      <div className='grid min-h-[360px] grid-cols-2 gap-3'>
        <section
          aria-label='Available PLC variables'
          className='flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
        >
          <header className='border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
            <h3 className='font-caption text-cp-base font-semibold text-neutral-950 dark:text-white'>
              Available PLC Variables
            </h3>
          </header>
          <div className='flex-1 overflow-y-auto'>
            <ExportableVariableTree
              groups={groups}
              selectedQualifiers={selectedQualifiers}
              disabled={disabled}
              readonly={storage.readonly}
              filter={filter}
              onToggleVariable={toggleVariable}
              onToggleGroup={toggleGroup}
            />
          </div>
        </section>
        <section
          aria-label='Selected for Data Hub'
          className='flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
        >
          <header className='border-b border-neutral-200 px-3 py-2 dark:border-neutral-800'>
            <h3 className='font-caption text-cp-base font-semibold text-neutral-950 dark:text-white'>
              Selected for Data Hub ({exports.length})
            </h3>
          </header>
          <div className='flex-1 overflow-y-auto'>
            <SelectedExportsList
              exports={exports}
              disabled={disabled}
              readonly={storage.readonly}
              onSetDirection={setDirection}
              onRemove={removeQualifier}
            />
          </div>
        </section>
      </div>
    </div>
  )
}

export { VariableTreePickerLayout }

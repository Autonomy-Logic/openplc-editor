import { Checkbox } from '@root/frontend/components/_atoms/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@root/frontend/components/_atoms/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@root/frontend/components/_atoms/table'
import type { ExportableVariable } from '@root/middleware/shared/vendor-document/protocol'
import {
  type ColumnFiltersState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'

import type { ScreenSection } from '../index'
import { useExportableVariables } from '../use-exportable-variables'
import { useSectionStorage } from '../use-section-storage'

/** How long the user has to stop typing in the search box before the filter commits. */
const SEARCH_DEBOUNCE_MS = 300

/** Shape of each entry written to `storage.values.exports` — matches the Data Hub emitter contract. */
type ExportEntry = { qualifier: string; direction: 'RO' | 'RW' }

type ColumnDef = {
  id: string
  label: string
  type?: 'text' | 'select' | 'variable-picker' | 'number' | 'boolean'
  readonly?: boolean
  options?: string[]
}

type SearchSpec = { field: string; placeholder?: string }

type TableLayoutProps = {
  section: ScreenSection
  // Passed down by the section-renderer when the section's `enabledWhen`
  // evaluates to false. The table still renders — rows and the toggle are
  // visible — but every input is inert, so the user sees what the data
  // would be while knowing it cannot change until the gate opens.
  disabled?: boolean
}

const columnHelper = createColumnHelper<ExportableVariable>()

function TableLayout({ section, disabled = false }: TableLayoutProps) {
  const storage = useSectionStorage(section)
  const variables = useExportableVariables()

  const columns = (Array.isArray(section.columns) ? (section.columns as ColumnDef[]) : []).filter(
    (c): c is ColumnDef => !!c && typeof c.id === 'string' && typeof c.label === 'string',
  )
  const search = (section.search && typeof section.search === 'object' ? (section.search as SearchSpec) : null) ?? null

  // Current exports[] from storage, treated as the source of truth for
  // row selection and per-row direction. The checkbox is derived from
  // membership; the access select is derived from the entry.
  const exports: ReadonlyArray<ExportEntry> = useMemo(() => {
    const raw = storage.values.exports
    if (!Array.isArray(raw)) return []
    return raw
      .filter((e): e is ExportEntry => {
        if (!e || typeof e !== 'object') return false
        const q = (e as { qualifier?: unknown }).qualifier
        const d = (e as { direction?: unknown }).direction
        return typeof q === 'string' && (d === 'RO' || d === 'RW')
      })
      .map((e) => ({ qualifier: e.qualifier, direction: e.direction }))
  }, [storage.values.exports])

  const selectedIndex = useMemo(() => {
    const map = new Map<string, 'RO' | 'RW'>()
    for (const e of exports) map.set(e.qualifier, e.direction)
    return map
  }, [exports])

  // Flip the exposure of one qualifier. Preserves the existing direction when
  // the user is re-selecting a row they had deselected moments ago.
  const toggleQualifier = (qualifier: string, exposed: boolean) => {
    if (disabled || storage.readonly) return
    let next: ExportEntry[]
    if (exposed) {
      if (selectedIndex.has(qualifier)) return
      next = [...exports, { qualifier, direction: 'RO' }]
    } else {
      next = exports.filter((e) => e.qualifier !== qualifier)
    }
    storage.setField('exports', next)
  }

  const setDirection = (qualifier: string, direction: 'RO' | 'RW') => {
    if (disabled || storage.readonly) return
    if (!selectedIndex.has(qualifier)) return
    const next = exports.map((e) => (e.qualifier === qualifier ? { qualifier, direction } : e))
    storage.setField('exports', next)
  }

  // Debounced search. Keyed by the configured column id so the state resets
  // cleanly when the schema's `search.field` changes.
  const [searchInput, setSearchInput] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  useEffect(() => {
    if (!search) return
    const handle = window.setTimeout(() => {
      setColumnFilters(searchInput.length > 0 ? [{ id: search.field, value: searchInput }] : [])
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [searchInput, search?.field])

  const columnDefs = useMemo(() => {
    // Column widths — override the TableHead atom's default `w-[200px]
    // lg:w-[300px] 2xl:w-[375px]` so headers do not stretch past their cells.
    // Qualifier takes the remaining width via `auto`; the fixed sizes below
    // land on `style={{width: ...}}` for both <th> and <td>, which beats the
    // atom's Tailwind width classes.
    const SELECTION_WIDTH = 48
    const TYPE_WIDTH = 96
    const ACCESS_WIDTH = 140

    const selectionColumn = columnHelper.display({
      id: '__select',
      size: SELECTION_WIDTH,
      header: ({ table }) => {
        const allSelected = variables.length > 0 && variables.every((v) => selectedIndex.has(v.qualifier))
        const someSelected = !allSelected && variables.some((v) => selectedIndex.has(v.qualifier))
        return (
          <div className='flex justify-center'>
            <Checkbox
              aria-label='Select all variables'
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              disabled={disabled || storage.readonly || variables.length === 0}
              onCheckedChange={(next) => {
                if (disabled || storage.readonly) return
                if (next === true) {
                  const additions = variables
                    .filter((v) => !selectedIndex.has(v.qualifier))
                    .map((v) => ({ qualifier: v.qualifier, direction: 'RO' as const }))
                  if (additions.length === 0) return
                  storage.setField('exports', [...exports, ...additions])
                } else {
                  storage.setField('exports', [])
                }
                table.resetRowSelection()
              }}
            />
          </div>
        )
      },
      cell: ({ row }) => {
        const qualifier = row.original.qualifier
        return (
          <div className='flex justify-center'>
            <Checkbox
              aria-label={`Expose ${qualifier}`}
              checked={selectedIndex.has(qualifier)}
              disabled={disabled || storage.readonly}
              onCheckedChange={(next) => toggleQualifier(qualifier, next === true)}
            />
          </div>
        )
      },
    })

    const schemaColumns = columns.map((col) =>
      col.id === 'access'
        ? columnHelper.display({
            id: 'access',
            size: ACCESS_WIDTH,
            header: col.label,
            cell: ({ row }) => {
              const qualifier = row.original.qualifier
              const direction = selectedIndex.get(qualifier) ?? 'RO'
              const isSelected = selectedIndex.has(qualifier)
              return (
                <div className='flex justify-center'>
                  <Select
                    value={direction}
                    onValueChange={(v) => setDirection(qualifier, v === 'RW' ? 'RW' : 'RO')}
                    disabled={disabled || storage.readonly || !isSelected}
                  >
                    <SelectTrigger
                      aria-label={`Access for ${qualifier}`}
                      placeholder='RO'
                      withIndicator
                      className='flex h-[26px] w-24 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-0.5 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark data-[disabled]:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                    />
                    <SelectContent
                      className='h-fit w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                      sideOffset={4}
                      position='popper'
                      align='center'
                      side='bottom'
                    >
                      {(col.options && col.options.length > 0 ? col.options : ['RO', 'RW']).map((opt) => (
                        <SelectItem
                          key={opt}
                          value={opt}
                          className='flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                        >
                          <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                            {opt}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            },
          })
        : columnHelper.accessor((row) => (col.id === 'type' ? row.type : col.id === 'qualifier' ? row.qualifier : ''), {
            id: col.id,
            size: col.id === 'type' ? TYPE_WIDTH : undefined,
            header: col.label,
            cell: (info) => (
              <span
                className={`block font-caption text-cp-sm text-neutral-850 dark:text-neutral-300 ${
                  col.id === 'qualifier' ? 'text-left' : 'text-center'
                }`}
              >
                {String(info.getValue() ?? '')}
              </span>
            ),
            // TanStack's `includesString` is case-insensitive and handles undefined gracefully.
            filterFn: 'includesString',
          }),
    )

    return [selectionColumn, ...schemaColumns]
  }, [columns, variables, selectedIndex, exports, disabled, storage.readonly, storage.setField])

  const table = useReactTable({
    data: variables as ExportableVariable[],
    columns: columnDefs,
    state: { columnFilters },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className='flex flex-col gap-3'>
      {search && (
        <div className='flex items-center gap-2'>
          <input
            type='text'
            value={searchInput}
            placeholder={search.placeholder ?? 'Filter...'}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label='Filter variables'
            disabled={disabled}
            className='flex h-[30px] w-72 items-center rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark disabled:opacity-50 dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
          />
          <span className='font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
            {table.getFilteredRowModel().rows.length} of {variables.length}
          </span>
        </div>
      )}

      {variables.length === 0 ? (
        <p className='font-caption text-cp-sm text-neutral-500 dark:text-neutral-400'>
          No exportable variables in this project yet. Create a POU with VAR declarations.
        </p>
      ) : (
        <Table context='table-layout' className='w-full'>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} tableHasHeader>
                {headerGroup.headers.map((header) => {
                  const explicitSize = header.column.columnDef.size
                  const widthStyle: CSSProperties =
                    explicitSize !== undefined ? { width: explicitSize } : { width: 'auto' }
                  const align = header.column.id === 'qualifier' ? 'text-left' : 'text-center'
                  return (
                    <TableHead
                      key={header.id}
                      style={widthStyle}
                      className={`font-caption text-cp-sm font-medium text-neutral-500 dark:text-neutral-400 ${align}`}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const explicitSize = cell.column.columnDef.size
                  const widthStyle: CSSProperties =
                    explicitSize !== undefined ? { width: explicitSize } : { width: 'auto' }
                  return (
                    <TableCell key={cell.id} style={widthStyle} className='px-2 py-1'>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export { TableLayout }

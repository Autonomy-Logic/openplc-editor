import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronDownIcon, ChevronRightIcon, Cross2Icon, DownloadIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons'
import type { ModbusBufferMapping } from '@root/middleware/shared/ports/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../../../../../../utils/cn'
import type {
  AddressMappingRow,
  AddressMappingSection,
  AddressQueryResult,
  ModbusBlockKind,
} from '../../../../../../utils/modbus/address-mapping'
import {
  calculateModbusAddressMapping,
  formatModiconAddress,
  mappingToCsv,
  matrixRowCount,
  matrixRowLabel,
  offsetForIndex,
  plcAddressForIndex,
  resolveAddressQuery,
  sectionsOf,
} from '../../../../../../utils/modbus/address-mapping'

/** Which convention the matrix prints. Both name the same register. */
type AddressMode = 'offset' | 'modicon'

/** Fixed row height is what lets the matrix virtualise: see MatrixRows. */
const ROW_HEIGHT = 30
const VIEWPORT_HEIGHT = 360
const OVERSCAN_ROWS = 5
const LABEL_WIDTH = 76

const EMPTY_RESULT: AddressQueryResult = { hits: [], error: null }

const segmentKey = (sectionId: string, segment: string) => `${sectionId}:${segment}`

/** `1 register`, not `1 registers` — a single-address segment is legal. */
const addressUnit = (kind: ModbusBlockKind, count: number) =>
  `${kind === 'bit' ? 'bit' : 'register'}${count === 1 ? '' : 's'}`

interface MatrixRowProps {
  section: AddressMappingSection
  row: AddressMappingRow
  matrixRow: number
  mode: AddressMode
  hitOffsets: Set<number>
  striped: boolean
  onCopy: (label: string, text: string) => void
}

const MatrixRow = ({ section, row, matrixRow, mode, hitOffsets, striped, onCopy }: MatrixRowProps) => {
  const indexes = Array.from({ length: row.perRow }, (_, column) => {
    const index = matrixRow * row.perRow + column
    return index < row.count ? index : null
  })
  const rowHit = indexes.some((index) => index !== null && hitOffsets.has(offsetForIndex(row, index)))

  return (
    <div
      style={{ ...matrixGridStyle(row), height: ROW_HEIGHT, alignItems: 'center' }}
      className={cn('px-3', rowHit && 'bg-brand/5', !rowHit && striped && 'bg-neutral-50 dark:bg-neutral-900')}
    >
      <div
        className={cn(
          'font-mono text-xs',
          rowHit ? 'text-brand dark:text-brand-light' : 'text-neutral-500 dark:text-neutral-400',
        )}
      >
        {matrixRowLabel(row, matrixRow)}
      </div>
      {indexes.map((index, column) => {
        if (index === null) {
          return (
            <div key={column} className='select-none text-center text-neutral-300 dark:text-neutral-700'>
              ·
            </div>
          )
        }
        const offset = offsetForIndex(row, index)
        const modicon = formatModiconAddress(section.modiconBase, offset)
        const plcAddress = plcAddressForIndex(row, index)
        const shown = mode === 'offset' ? offset.toString() : modicon

        return (
          <button
            key={column}
            type='button'
            onClick={() => onCopy(plcAddress, shown)}
            title={`${plcAddress} · offset ${offset} · modicon ${modicon}`}
            className={cn(
              'h-6 rounded font-mono text-[11px] transition-colors',
              hitOffsets.has(offset)
                ? 'bg-brand/20 ring-brand/60 text-brand ring-1 dark:text-brand-light'
                : 'text-neutral-700 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800',
            )}
          >
            {shown}
          </button>
        )
      })}
    </div>
  )
}

const matrixGridStyle = (row: AddressMappingRow) => ({
  display: 'grid',
  gridTemplateColumns: `${LABEL_WIDTH}px repeat(${row.perRow}, minmax(0, 1fr))`,
  columnGap: 2,
})

interface AddressMatrixProps {
  section: AddressMappingSection
  row: AddressMappingRow
  mode: AddressMode
  hitOffsets: Set<number>
  scrollTop: number
  onScroll: (scrollTop: number) => void
  scrollRef: (element: HTMLDivElement | null) => void
  onCopy: (label: string, text: string) => void
}

/**
 * The segment's addresses, folded into rows and windowed to what is in view.
 *
 * A default configuration puts 8192 bits in `%QX`; even folded eight to a row
 * that is a thousand rows, and the reader wants one of them. Rows are a fixed
 * height so the window can be computed instead of measured, and spacers above
 * and below keep the scrollbar honest.
 */
const AddressMatrix = ({
  section,
  row,
  mode,
  hitOffsets,
  scrollTop,
  onScroll,
  scrollRef,
  onCopy,
}: AddressMatrixProps) => {
  const rowCount = matrixRowCount(row)
  const height = Math.min(VIEWPORT_HEIGHT, rowCount * ROW_HEIGHT)
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
  const last = Math.min(rowCount, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN_ROWS)

  const visible = []
  for (let matrixRow = first; matrixRow < last; matrixRow++) visible.push(matrixRow)

  const columnLabel = (column: number) => (row.unit === 'bit' ? `.${column}` : `+${column}`)

  return (
    <div className='overflow-x-auto'>
      <div
        style={matrixGridStyle(row)}
        className='border-b border-neutral-200 bg-neutral-100 px-3 py-1.5 font-mono text-[11px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400'
      >
        <div>{row.unit === 'bit' ? 'byte' : 'base'}</div>
        {Array.from({ length: row.perRow }, (_, column) => (
          <div key={column} className='text-center'>
            {columnLabel(column)}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
        style={{ height, overflowY: 'auto' }}
      >
        <div style={{ height: first * ROW_HEIGHT }} />
        {visible.map((matrixRow) => (
          <MatrixRow
            key={matrixRow}
            section={section}
            row={row}
            matrixRow={matrixRow}
            mode={mode}
            hitOffsets={hitOffsets}
            striped={matrixRow % 2 === 1}
            onCopy={onCopy}
          />
        ))}
        <div style={{ height: (rowCount - last) * ROW_HEIGHT }} />
      </div>
    </div>
  )
}

interface SegmentRowProps {
  section: AddressMappingSection
  row: AddressMappingRow
  mode: AddressMode
  hitOffsets: Set<number>
  isOpen: boolean
  onToggle: () => void
  scrollTop: number
  onScroll: (scrollTop: number) => void
  scrollRef: (element: HTMLDivElement | null) => void
  onCopy: (label: string, text: string) => void
}

const SegmentRow = ({
  section,
  row,
  mode,
  hitOffsets,
  isOpen,
  onToggle,
  scrollTop,
  onScroll,
  scrollRef,
  onCopy,
}: SegmentRowProps) => {
  return (
    <div className='border-b border-neutral-200 last:border-b-0 dark:border-neutral-700'>
      <button
        type='button'
        onClick={onToggle}
        disabled={row.disabled}
        className='flex w-full items-center gap-3 px-3 py-2 text-left disabled:cursor-default'
      >
        {row.disabled ? (
          <span className='w-3.5 shrink-0' />
        ) : isOpen ? (
          <ChevronDownIcon className='h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400' />
        ) : (
          <ChevronRightIcon className='h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400' />
        )}
        <span className='w-14 shrink-0 font-mono text-xs text-neutral-950 dark:text-neutral-100'>{row.segment}</span>
        <span className='w-44 shrink-0 font-mono text-xs text-neutral-600 dark:text-neutral-400'>
          {row.disabled ? 'not configured' : `${row.plcAddressStart} - ${row.plcAddressEnd}`}
        </span>
        <span className='flex-1 font-mono text-[11px] text-neutral-500 dark:text-neutral-500'>
          {row.disabled
            ? ''
            : `${row.iecType}${row.registersPerValue > 1 ? ` · ${row.registersPerValue} registers each` : ''}`}
        </span>
        <span className='font-mono text-xs text-neutral-500 dark:text-neutral-400'>
          {row.disabled ? '—' : `${row.modbusCount.toLocaleString()} ${addressUnit(section.kind, row.modbusCount)}`}
        </span>
      </button>

      {isOpen && !row.disabled && (
        <div className='border-t border-neutral-200 dark:border-neutral-700'>
          <AddressMatrix
            section={section}
            row={row}
            mode={mode}
            hitOffsets={hitOffsets}
            scrollTop={scrollTop}
            onScroll={onScroll}
            scrollRef={scrollRef}
            onCopy={onCopy}
          />
        </div>
      )}
    </div>
  )
}

interface AddressMappingReferenceProps {
  bufferMapping?: ModbusBufferMapping
  defaultExpanded?: boolean
}

const AddressMappingReference = ({ bufferMapping, defaultExpanded = false }: AddressMappingReferenceProps) => {
  const [isOpen, setIsOpen] = useState(defaultExpanded)
  const [mode, setMode] = useState<AddressMode>('offset')
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<AddressQueryResult>(EMPTY_RESULT)
  const [openSegments, setOpenSegments] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)
  // Held here rather than inside each matrix so a segment keeps its place when
  // it is collapsed and reopened.
  const [scrollTops, setScrollTops] = useState<Record<string, number>>({})
  const scrollElements = useRef<Record<string, HTMLDivElement | null>>({})

  const mapping = useMemo(() => calculateModbusAddressMapping(bufferMapping), [bufferMapping])
  const hitOffsets = useMemo(() => new Set(result.hits.map((hit) => hit.offset)), [result])

  const scrollRefFor = useCallback(
    (key: string) => (element: HTMLDivElement | null) => {
      scrollElements.current[key] = element
    },
    [],
  )

  // A resized buffer moves every boundary, so a hit found against the old
  // layout would point at an address that no longer exists.
  useEffect(() => {
    setResult(EMPTY_RESULT)
  }, [mapping])

  const runSearch = (value: string) => {
    setQuery(value)
    const next = resolveAddressQuery(value, mapping)
    setResult(next)
    if (next.hits.length) {
      setOpenSegments((current) => {
        const expanded = { ...current }
        next.hits.forEach((hit) => {
          expanded[segmentKey(hit.sectionId, hit.segment)] = true
        })
        return expanded
      })
    }
  }

  // Scrolling has to wait for the segment the search just expanded to mount.
  useEffect(() => {
    const hit = result.hits[0]
    if (!hit) return
    const timer = setTimeout(() => {
      const element = scrollElements.current[segmentKey(hit.sectionId, hit.segment)]
      if (element) element.scrollTop = Math.max(0, hit.matrixRow * ROW_HEIGHT - VIEWPORT_HEIGHT / 3)
    }, 40)
    return () => clearTimeout(timer)
  }, [result])

  const copyAddress = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {
      /* clipboard unavailable — the toast still tells the reader the value */
    })
    setToast(`${label} → ${text}`)
  }

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 1400)
    return () => clearTimeout(timer)
  }, [toast])

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([mappingToCsv(mapping)], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'modbus-address-mapping.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

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
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <p className='text-xs text-neutral-600 dark:text-neutral-400'>
                Search accepts <span className='font-mono'>%QX37.4</span>, <span className='font-mono'>%MW12</span>,
                offset <span className='font-mono'>300</span> or modicon <span className='font-mono'>000301</span>.
                Click any address to copy it.
              </p>

              <div className='flex items-center gap-2'>
                <div className='flex rounded border border-neutral-300 p-0.5 text-xs dark:border-neutral-700'>
                  {(['offset', 'modicon'] as const).map((option) => (
                    <button
                      key={option}
                      type='button'
                      onClick={() => setMode(option)}
                      className={cn(
                        'rounded px-2 py-1 font-mono',
                        mode === option
                          ? 'bg-neutral-200 text-neutral-950 dark:bg-neutral-700 dark:text-white'
                          : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>

                <div className='relative'>
                  <MagnifyingGlassIcon className='absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500' />
                  <input
                    value={query}
                    onChange={(event) => runSearch(event.target.value)}
                    placeholder='%QX37.4'
                    className='w-44 rounded border border-neutral-300 bg-white py-1.5 pl-8 pr-7 font-mono text-xs text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300'
                  />
                  {query && (
                    <button
                      type='button'
                      onClick={() => runSearch('')}
                      aria-label='Clear search'
                      className='absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                    >
                      <Cross2Icon className='h-3 w-3' />
                    </button>
                  )}
                </div>

                <button
                  type='button'
                  onClick={exportCsv}
                  title='Export the whole mapping as CSV'
                  className='flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800'
                >
                  <DownloadIcon className='h-3.5 w-3.5' />
                  CSV
                </button>
              </div>
            </div>

            {result.error && <p className='text-xs text-red-500 dark:text-red-400'>{result.error}</p>}
            {result.hits.length > 1 && (
              <p className='text-xs text-brand dark:text-brand-light'>
                {result.hits.length} matches across blocks — every block numbers its offsets from zero.
              </p>
            )}

            <div className='flex flex-col gap-4'>
              {sectionsOf(mapping).map((section) => (
                <div
                  key={section.id}
                  className='overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'
                >
                  <div className='flex items-center justify-between bg-neutral-100 px-3 py-2 dark:bg-neutral-800'>
                    <div className='flex items-center gap-3'>
                      <span className='text-xs font-medium text-neutral-950 dark:text-neutral-100'>
                        {section.title}
                      </span>
                      <span className='font-mono text-xs text-neutral-500 dark:text-neutral-400'>
                        {section.modiconRange ? `${section.modiconRange.start} - ${section.modiconRange.end}` : 'empty'}
                      </span>
                    </div>
                    <span className='font-mono text-xs text-neutral-500 dark:text-neutral-400'>
                      {section.totalAddresses.toLocaleString()} {addressUnit(section.kind, section.totalAddresses)}
                    </span>
                  </div>

                  <div>
                    {section.rows.map((row) => {
                      const key = segmentKey(section.id, row.segment)
                      return (
                        <SegmentRow
                          key={key}
                          section={section}
                          row={row}
                          mode={mode}
                          hitOffsets={hitOffsets}
                          isOpen={!!openSegments[key]}
                          onToggle={() => setOpenSegments((current) => ({ ...current, [key]: !current[key] }))}
                          scrollTop={scrollTops[key] ?? 0}
                          onScroll={(top) => setScrollTops((current) => ({ ...current, [key]: top }))}
                          scrollRef={scrollRefFor(key)}
                          onCopy={copyAddress}
                        />
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CollapsiblePrimitive.Content>
      </div>

      {toast && (
        <div className='fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-mono text-xs text-neutral-950 shadow-lg dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100'>
          {toast}
        </div>
      )}
    </CollapsiblePrimitive.Root>
  )
}

export { AddressMappingReference }

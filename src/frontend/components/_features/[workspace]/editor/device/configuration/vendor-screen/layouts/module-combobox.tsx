import * as Popover from '@radix-ui/react-popover'
import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { InputWithRef } from '@root/frontend/components/_atoms/input'
import { cn } from '@root/frontend/utils/cn'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { ModuleDefinition } from '../index'

const EMPTY_VALUE = ''

type ModuleComboboxProps = {
  /** Modules eligible for this slot (already filtered for locked/fixed rules). */
  modules: ModuleDefinition[]
  /** Currently selected module id, or '' for an empty slot. */
  value: string
  onChange: (moduleId: string) => void
  disabled?: boolean
  /** Whether the "-- Empty --" choice is offered (physical, non-locked slots). */
  allowEmpty?: boolean
  ariaLabel?: string
}

/**
 * Filterable, alphabetically-sorted module picker for backplane slots.
 *
 * Replaces a plain <Select> so a long module catalogue can be narrowed by
 * typing — matching the type-to-filter pattern used elsewhere in the editor.
 * The module set is server-provided and fixed, so (unlike the EtherCAT
 * interface selector) there is no custom-value entry.
 */
const ModuleCombobox = ({
  modules,
  value,
  onChange,
  disabled = false,
  allowEmpty = false,
  ariaLabel,
}: ModuleComboboxProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  // Alphabetical by display name (case-insensitive). The server order is
  // arbitrary, which made long catalogues hard to scan.
  const sortedModules = useMemo(
    () => [...modules].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [modules],
  )

  // Narrow by the typed text (name or description).
  const filteredModules = useMemo(() => {
    const query = inputValue.trim().toLowerCase()
    if (!query) return sortedModules
    return sortedModules.filter(
      (m) => m.name.toLowerCase().includes(query) || (m.description?.toLowerCase().includes(query) ?? false),
    )
  }, [sortedModules, inputValue])

  const selected = value ? modules.find((m) => m.id === value) : undefined

  // Reset the filter and focus the input when the popover opens.
  useEffect(() => {
    if (!isOpen) return
    setInputValue('')
    setHighlightedIndex(-1)
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [isOpen])

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  const commit = (moduleId: string) => {
    onChange(moduleId)
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev < filteredModules.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredModules.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && highlightedIndex < filteredModules.length) {
        commit(filteredModules[highlightedIndex].id)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={(open) => !disabled && setIsOpen(open)}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type='button'
          aria-label={ariaLabel}
          disabled={disabled}
          className='flex h-[32px] w-80 cursor-pointer items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-3 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none disabled:cursor-not-allowed disabled:opacity-60 data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
        >
          <span className={cn('truncate', !selected && 'italic text-neutral-500 dark:text-neutral-400')}>
            {selected?.name ?? '-- Empty --'}
          </span>
          <ArrowIcon size='sm' className={cn('rotate-270 stroke-brand transition-all', isOpen && 'rotate-90')} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={5}
          align='start'
          className='z-50 w-[--radix-popover-trigger-width] min-w-[200px] rounded-lg border border-neutral-100 bg-white shadow-lg outline-none dark:border-brand-medium-dark dark:bg-neutral-950'
        >
          <div className='p-2'>
            <InputWithRef
              ref={inputRef}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
                setHighlightedIndex(-1)
              }}
              onKeyDown={handleKeyDown}
              placeholder='Filter modules...'
              className='h-[28px] w-full rounded-md border border-neutral-200 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
            />
          </div>
          <div className='max-h-[240px] overflow-y-auto'>
            {allowEmpty && !inputValue.trim() && (
              <div
                role='option'
                aria-selected={!value}
                onClick={() => commit(EMPTY_VALUE)}
                className={cn(
                  'flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                  !value && 'bg-neutral-200 dark:bg-neutral-850',
                )}
              >
                <span className='font-caption text-cp-sm font-medium italic text-neutral-500 dark:text-neutral-400'>
                  -- Empty --
                </span>
              </div>
            )}
            {filteredModules.length > 0 ? (
              filteredModules.map((mod, index) => (
                <div
                  key={mod.id}
                  ref={(el) => (optionRefs.current[index] = el)}
                  role='option'
                  aria-selected={value === mod.id || highlightedIndex === index}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commit(mod.id)}
                  className={cn(
                    'flex w-full cursor-pointer items-center px-2 py-[6px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                    (value === mod.id || highlightedIndex === index) && 'bg-neutral-200 dark:bg-neutral-850',
                  )}
                >
                  <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                    {mod.name}
                  </span>
                </div>
              ))
            ) : (
              <div className='px-2 py-2 text-center text-xs text-neutral-500'>No matching modules.</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export { ModuleCombobox }

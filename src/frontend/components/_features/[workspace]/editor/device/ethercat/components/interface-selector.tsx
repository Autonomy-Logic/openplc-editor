import * as Popover from '@radix-ui/react-popover'
import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { PlusIcon } from '@root/frontend/assets/icons/interface/Plus'
import { InputWithRef } from '@root/frontend/components/_atoms/input'
import { Label } from '@root/frontend/components/_atoms/label'
import type { NetworkInterface } from '@root/types/ethercat'
import { cn } from '@root/frontend/utils/cn'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type InterfaceSelectorProps = {
  interfaces: NetworkInterface[]
  selectedInterface: string
  onSelectInterface: (value: string) => void
  isLoading: boolean
  error: string | null
}

/**
 * Editable combobox for network interface selection.
 * Shows a dropdown with available interfaces from runtime, but also allows typing custom values.
 * Follows the same pattern as the Modbus RTU SerialPortCombobox.
 */
const InterfaceSelector = ({
  interfaces,
  selectedInterface,
  onSelectInterface,
  isLoading,
  error,
}: InterfaceSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [inputValue, setInputValue] = useState(selectedInterface)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLDivElement | null>>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  // Sync input value with external value changes
  useEffect(() => {
    setInputValue(selectedInterface)
  }, [selectedInterface])

  // Build options from interfaces
  const options = useMemo(
    () => interfaces.map((iface) => ({ value: iface.name, label: iface.description || iface.name })),
    [interfaces],
  )

  // Filter options based on input
  const filteredOptions = useMemo(() => {
    if (!inputValue.trim()) return options
    const lowerInput = inputValue.toLowerCase()
    return options.filter(
      (opt) => opt.value.toLowerCase().includes(lowerInput) || opt.label.toLowerCase().includes(lowerInput),
    )
  }, [options, inputValue])

  // Focus input and select all text when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
        const currentIndex = options.findIndex((opt) => opt.value === selectedInterface)
        setHighlightedIndex(currentIndex >= 0 ? currentIndex : -1)
      }, 0)
    }
  }, [isOpen, options, selectedInterface])

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex, filteredOptions.length])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value)
    setHighlightedIndex(-1)
  }

  const handleInputBlur = () => {
    if (inputValue !== selectedInterface) {
      onSelectInterface(inputValue)
    }
  }

  const handleSelectOption = useCallback(
    (optionValue: string) => {
      setInputValue(optionValue)
      onSelectInterface(optionValue)
      setIsOpen(false)
    },
    [onSelectInterface],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        handleSelectOption(filteredOptions[highlightedIndex].value)
      } else if (inputValue.trim()) {
        onSelectInterface(inputValue.trim())
        setIsOpen(false)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && inputValue.trim() !== selectedInterface) {
      onSelectInterface(inputValue.trim())
    }
    setIsOpen(open)
  }

  return (
    <div className='flex flex-col gap-1'>
      <Label className='text-xs text-neutral-950 dark:text-white'>Network Interface</Label>
      <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>
          <button
            type='button'
            className='flex h-[30px] w-full min-w-[200px] max-w-[300px] items-center justify-between gap-1 rounded-md border border-neutral-300 bg-white px-2 py-1 font-caption font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
          >
            <span className='truncate text-xs font-normal text-neutral-700 dark:text-neutral-100'>
              {selectedInterface || 'Select interface'}
            </span>
            <ArrowIcon size='sm' className={cn('rotate-270 stroke-brand transition-all', isOpen && 'rotate-90')} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={5}
            align='start'
            className='z-50 w-[--radix-popover-trigger-width] min-w-[200px] rounded-lg border border-neutral-300 bg-white shadow-lg outline-none dark:border-brand-medium-dark dark:bg-neutral-950'
          >
            <div className='p-2'>
              <InputWithRef
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                placeholder='eth0'
                className='h-[28px] w-full rounded-md border border-neutral-200 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
              />
            </div>
            <div className='max-h-[200px] overflow-y-auto'>
              {isLoading ? (
                <div className='flex items-center justify-center py-2 text-xs text-neutral-500'>
                  Loading interfaces...
                </div>
              ) : filteredOptions.length > 0 ? (
                filteredOptions.map((option, index) => (
                  <div
                    key={option.value}
                    ref={(el) => (optionRefs.current[index] = el)}
                    className={cn(
                      'flex w-full cursor-pointer flex-col px-2 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-800',
                      (selectedInterface === option.value || highlightedIndex === index) &&
                        'bg-neutral-100 dark:bg-neutral-800',
                    )}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => handleSelectOption(option.value)}
                    role='option'
                    aria-selected={highlightedIndex === index}
                  >
                    <span className='text-start font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                      {option.value}
                    </span>
                    {option.label !== option.value && (
                      <span className='text-start font-caption text-[10px] font-normal text-neutral-500 dark:text-neutral-400'>
                        {option.label}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className='px-2 py-2 text-center text-xs text-neutral-500'>
                  {options.length === 0
                    ? 'No interfaces available. Type a custom value.'
                    : 'No matches. Type a custom value.'}
                </div>
              )}
            </div>
            {inputValue.trim() && !filteredOptions.some((opt) => opt.value === inputValue.trim()) && (
              <div
                className='flex cursor-pointer items-center gap-2 border-t border-neutral-200 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
                onClick={() => handleSelectOption(inputValue.trim())}
              >
                <PlusIcon className='h-3 w-3 stroke-brand' />
                <span className='font-caption text-xs font-normal text-neutral-700 dark:text-neutral-100'>
                  Use "{inputValue.trim()}"
                </span>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {error && <p className='text-xs text-red-500 dark:text-red-400'>{error}</p>}
    </div>
  )
}

export { InterfaceSelector }

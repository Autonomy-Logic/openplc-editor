import { useCallback, useRef, useState } from 'react'

type AIChatInputProps = {
  onSend: (message: string) => void
  onCancel: () => void
  isLoading: boolean
  /** No AI transport on this platform — the composer is inert and says so. */
  disabled?: boolean
}

export const AIChatInput = ({ onSend, onCancel, isLoading, disabled = false }: AIChatInputProps) => {
  const [input, setInput] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isLoading || disabled) return
    onSend(trimmed)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isLoading, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  const hasDraft = input.trim().length > 0 && !disabled

  return (
    <div className='border-t border-neutral-100 px-3 pb-3 pt-2.5 dark:border-white/5'>
      <div
        className={`rounded-[10px] border px-2.5 pb-2 pt-2.5 transition-[box-shadow,border-color] duration-150 ${
          isFocused
            ? 'border-[rgba(4,100,251,0.8)] bg-[#f6f8fb] shadow-[0_0_0_1px_rgba(4,100,251,0.8),0_0_0_4px_rgba(4,100,251,0.15)] dark:bg-[#111827]'
            : 'border-neutral-200 bg-[#f6f8fb] dark:border-[#1f2937] dark:bg-[#111827]'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          placeholder={disabled ? 'AI is not available on this platform.' : 'Ask about your PLC code…'}
          rows={1}
          className='w-full resize-none border-none bg-transparent text-[13px] text-neutral-900 placeholder-neutral-400 outline-none dark:text-neutral-100 dark:placeholder-neutral-500'
        />
        <div className='mt-1.5 flex items-center gap-1.5'>
          {/*
            Attach-context and mention buttons are hidden until those features
            ship. They stay in the tree (not removed) per product request, but
            must be invisible and non-interactable: `hidden` removes them from
            layout, `disabled` + `tabIndex={-1}` + `aria-hidden` keep them out
            of mouse, keyboard, and assistive-tech reach.
          */}
          <button
            type='button'
            title='Attach context'
            disabled
            aria-hidden='true'
            tabIndex={-1}
            className='hidden h-6 w-6 place-items-center rounded text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
          >
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.75'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path d='m21 12-8.5 8.5a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7L9.5 18a2 2 0 0 1-2.8-2.8l8.5-8.5' />
            </svg>
          </button>
          <button
            type='button'
            title='Mention file/variable'
            disabled
            aria-hidden='true'
            tabIndex={-1}
            className='hidden h-6 w-6 place-items-center rounded text-neutral-400 transition-colors hover:bg-neutral-200/60 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
          >
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.75'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <circle cx='12' cy='12' r='4' />
              <path d='M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8' />
            </svg>
          </button>
          <span className='flex-1 text-center text-[10px] text-neutral-400 dark:text-neutral-500'>
            Shift+Enter for new line
          </span>
          {isLoading ? (
            <button
              type='button'
              onClick={onCancel}
              className='grid h-[26px] w-[26px] place-items-center rounded-md bg-red-500 text-white transition-colors hover:bg-red-600'
              title='Stop generating'
            >
              <svg width='10' height='10' viewBox='0 0 10 10'>
                <rect width='10' height='10' rx='1' fill='currentColor' />
              </svg>
            </button>
          ) : (
            <button
              type='button'
              onClick={handleSubmit}
              disabled={!hasDraft}
              className={`grid h-[26px] w-[26px] place-items-center rounded-md transition-colors ${
                hasDraft
                  ? 'bg-brand text-white hover:bg-brand-medium-dark'
                  : 'cursor-default border border-neutral-200 bg-neutral-100/60 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-500'
              }`}
              title='Send (Enter)'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M12 19V5M6 11l6-6 6 6' />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

import { useOpenPLCStore } from '../../../../store'
import { useCallback, useRef, useState } from 'react'

type AIChatInputProps = {
  onSend: (message: string) => void
  onCancel: () => void
  isLoading: boolean
  selectedText?: string
}

export const AIChatInput = ({ onSend, onCancel, isLoading, selectedText }: AIChatInputProps) => {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const model = useOpenPLCStore.useAi().model
  const { setAIModel } = useOpenPLCStore.useAiActions()

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return
    onSend(trimmed)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, isLoading, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleQuickAction = (action: 'explain' | 'refactor') => {
    if (!selectedText) return
    const prefix = action === 'explain' ? 'Explain this code:\n\n' : 'Refactor this code:\n\n'
    const message = `${prefix}\`\`\`\n${selectedText}\n\`\`\``
    onSend(message)
  }

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  return (
    <div className='flex flex-col gap-1.5 border-t border-neutral-200 p-2 dark:border-neutral-700'>
      {selectedText && (
        <div className='flex gap-1'>
          <button
            onClick={() => handleQuickAction('explain')}
            className='rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
          >
            Explain selection
          </button>
          <button
            onClick={() => handleQuickAction('refactor')}
            className='rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
          >
            Refactor selection
          </button>
        </div>
      )}

      <div className='flex items-end gap-1'>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder='Ask about your PLC code...'
          rows={1}
          className='flex-1 resize-none rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-900 placeholder-neutral-400 outline-none focus:border-brand dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:border-brand-light'
        />
        {isLoading ? (
          <button
            onClick={onCancel}
            className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600'
            title='Stop generating'
          >
            <svg width='10' height='10' viewBox='0 0 10 10'>
              <rect width='10' height='10' rx='1' fill='currentColor' />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className='flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand text-white hover:bg-brand-medium disabled:cursor-not-allowed disabled:opacity-40'
            title='Send message'
          >
            <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
              <path d='M1 11L11 6L1 1V5L8 6L1 7V11Z' fill='currentColor' />
            </svg>
          </button>
        )}
      </div>

      <div className='flex items-center justify-between'>
        <select
          value={model}
          onChange={(e) => setAIModel(e.target.value as 'haiku' | 'sonnet')}
          className='rounded border border-neutral-200 bg-white px-1 py-0.5 text-[10px] text-neutral-600 outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400'
        >
          <option value='haiku'>Haiku (Fast)</option>
          <option value='sonnet'>Sonnet (Best)</option>
        </select>
        <span className='text-[10px] text-neutral-400'>Shift+Enter for new line</span>
      </div>
    </div>
  )
}
